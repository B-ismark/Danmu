// The pure post-process between a detector and the scene builder: measure, then
// merge. Both steps are shared by the cloud path and the on-device one.
//
// This is where CLAUDE.md rule 2 — "dimensions come from code, not AI" — is
// actually applied to a photograph: the AI's guessed position and size are
// discarded and recomputed from the calibrated camera. It sat as a private
// function inside app/onboarding/detect/page.tsx, where nothing could test the
// one decision it makes (which projection measures this object), so it moved
// here. It is pure — no React, no DOM, no fetch.
//
// `dedupeDetections` moved here from lib/detection.ts for two reasons. It has to
// run AFTER the measurement, not inside the Gemini call (see `refineDetections`),
// and it is not a cloud concern at all: the on-device detector needs the same
// merge, and nothing about the local path should sit behind a module that pulls
// in the Gemini SDK.

import { anchorFor } from './physics';
import { placeCeilingObject, placeFloorObject, placeWallObject, type CameraCal } from './photo-geometry';
import type { Detection } from './detection';
import { defaultAxisFor, defaultDepthFor, type Category, type Shape } from './scene-spec';
import type { CaptureSlot } from './storage';

/** Room extent in METRES. `depth` is the N–S dimension.
 *
 *  `height` is required, not optional, and that is the point: it is the only thing
 *  that locates the ceiling plane, so a caller that forgot it would silently stop
 *  measuring every fan and pendant in the room rather than fail to compile. */
export type RoomDims = { width: number; depth: number; height: number };

/** One calibrated camera per wall the user actually photographed. A slot with no
 *  entry has no calibration — a normal outcome for a partial capture, not a
 *  failure, and `geoRefine` returns such detections untouched. */
export type CalMap = Partial<Record<CaptureSlot, CameraCal>>;

// Replace the AI's guessed position/size with values computed from projective
// geometry: bbox bottom edge → floor position; angular size × distance → real
// W and H. Depth genuinely cannot be observed from one photo, so it falls back
// to the category's typical depth narrowed by the shape's range — never a
// literal — and clampDims gates everything downstream. AI keeps naming and
// classifying only.
export function geoRefine(d: Detection, cals: CalMap, room: RoomDims): Detection {
  const cal = cals[d.slot];
  if (!cal) return d;
  const cat = (d.category ?? 'other') as Category;
  const shape = (d.shape ?? 'box') as Shape;
  const anchor = anchorFor(cat, shape);
  const depth = d.dimMM?.[1] ?? defaultDepthFor(cat, shape);

  // A curtain whose shape resolves to the ceiling is still CLOTH ON A WALL — the
  // exception predates the ceiling placer and survives it, because the question
  // that branch answers is "which plane is this object on", and cloth is on the
  // wall plane whatever the anchor table calls it.
  if (anchor === 'ceiling' && d.category !== 'curtain') {
    const g = placeCeilingObject(d.box, d.slot, room, cal);
    if (!g) return d;
    // Width is measured. HEIGHT IS NOT — the bbox of something seen from below
    // has a foreshortened diameter in it, not a thickness (see
    // `placeCeilingObject`), so it falls back the same way depth does.
    return {
      ...d,
      position: g.position,
      yaw: typeof d.yaw === 'number' ? d.yaw : g.yaw,
      dimMM: [g.widthMM, depth, d.dimMM?.[2] ?? defaultAxisFor(cat, shape, 2)],
    };
  }

  const g =
    anchor === 'floor'
      ? placeFloorObject(d.box, d.slot, room, cal)
      : placeWallObject(d.box, d.slot, room, cal);
  if (!g) return d;
  return {
    ...d,
    position: g.position,
    yaw: typeof d.yaw === 'number' ? d.yaw : g.yaw,
    dimMM: [g.widthMM, depth, g.heightMM],
  };
}

/** How close two same-category detections have to be, in metres, before they are
 *  judged one object seen twice.
 *
 *  Tiered, because one number cannot serve both ends of the catalogue. At the flat
 *  0.6 m this replaces, four identical dining chairs 0.55 m apart collapsed to
 *  TWO — real furniture deleted by the rule whose whole job is deleting
 *  duplicates — and loosening the number to better catch a bed seen from two
 *  walls would have eaten more of them.
 *
 *  What each tier answers is "how close can two DIFFERENT items of this category
 *  legitimately sit", so it tracks the item's own footprint: dining chairs tuck
 *  against each other, wardrobes do not. The other direction is one object
 *  measured from two walls, where the two estimates disagree by roughly the
 *  calibration error, so a tight tier means such a pair survives as two rows.
 *  That is the safe way to be wrong, and this file already argues why: a
 *  duplicate the user deletes in one tap beats a real piece that never appears.
 *
 *  Not derived from the catalogue's own widths, though it could be — half a
 *  typical width lands close to these numbers. Three named bands are easier to
 *  reason about at a glance than a formula whose output nobody can predict, and
 *  the merge distance is not the same quantity as the furniture's size: it is
 *  about how far two MEASUREMENTS of one thing can drift. */
type MergeTier = 'tight' | 'medium' | 'loose';

const MERGE_M: Record<MergeTier, number> = { tight: 0.35, medium: 0.6, loose: 0.9 };

/** Anything not named here is `medium`, which is the flat value this replaced. */
const MERGE_TIER: Partial<Record<Category, MergeTier>> = {
  // Small things that legitimately sit shoulder to shoulder: dining chairs at
  // ~0.5 m centres, two table lamps on one sideboard, a cluster of pots, dual
  // monitors, a gallery wall of frames, a pair of nightstands.
  chair: 'tight',
  nightstand: 'tight',
  ottoman: 'tight',
  lamp: 'tight',
  plant: 'tight',
  monitor: 'tight',
  painting: 'tight',
  mirror: 'tight',
  // Metre-and-a-half-plus footprints. Two of these are never 0.9 m apart, and
  // being large they are also the ones a single wall photo clips, so two views
  // of one item disagree the most.
  sofa: 'loose',
  bed: 'loose',
  wardrobe: 'loose',
  rug: 'loose',
  curtain: 'loose',
};

/** Exported for tests, and because a wrong tier is a piece of furniture the user
 *  loses without being told. */
export function mergeDistanceFor(category: Category): number {
  return MERGE_M[MERGE_TIER[category] ?? 'medium'];
}

/** How much two boxes in the same photo overlap, as intersection over union.
 *
 *  The standard measure, and it is here because the fixed 12%-of-the-image centre
 *  distance it replaces was SCALE-BLIND. Two bedside tables 0.55 m apart against a
 *  far wall image as two 7%-wide boxes 9% apart — they do not touch, and there is a
 *  visible gap between them, and the old rule merged them because 9% < 12%. That is
 *  the same failure as the flat 0.6 m cross-slot distance: one absolute number
 *  standing in for a question about proportion. A duplicate box from one detector
 *  overlaps its twin almost entirely; two small neighbours overlap not at all, at
 *  any distance from the camera.
 *
 *  Deliberately NOT intersection-over-minimum, which would also merge a box nested
 *  inside a much larger one — a shelf inside a bookcase, both called 'shelf'. IoU
 *  keeps both, and keeping both is the safe way to be wrong here: a duplicate the
 *  user deletes in one tap beats a real piece that never appears. */
function boxIoU(a: Detection['box'], b: Detection['box']): number {
  const ix = Math.max(0, Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]));
  const iy = Math.max(0, Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]));
  const inter = ix * iy;
  const union = a[2] * a[3] + b[2] * b[3] - inter;
  return union > 0 ? inter / union : 0;
}

/** Two boxes in one photo are the same object at or above this overlap. Mid-range
 *  for non-maximum suppression, which normally runs 0.5–0.7; the low end, because
 *  the two boxes here come from one pass over one image rather than from a sliding
 *  window, so a genuine double-box is nearly coincident and anything ambiguous is
 *  better kept. */
const SAME_BOX_IOU = 0.5;

/** Drop near-identical detections. Two rules:
 *
 *  1. Same slot + same category + bounding boxes overlapping by `SAME_BOX_IOU` —
 *     one object boxed twice in the same photo.
 *  2. Same label + same category, in ANY slot including the same one, but only
 *     when their estimated 3D positions agree to within that category's own merge
 *     distance — one object seen from two walls, or boxed twice in one photo
 *     without the boxes overlapping enough for rule 1.
 *
 *  Rule 2 carries no slot test on purpose. Its headline case is cross-slot, but a
 *  detector that boxes one sofa as two non-overlapping halves in a single photo is
 *  caught here rather than by rule 1, and both are the same question: do these two
 *  rows measure to one place. `tests/detect-pipeline.test.ts` depends on the wider
 *  reading — its gallery-pair fixtures are same-slot.
 *
 *  Rule 2 is the ONLY mechanism for the cross-slot case, deliberately. The prompt
 *  used to ask the model to name the other slots in an `alsoSeenIn` field, which no
 *  code ever read. Two independent measurements landing in the same place is better
 *  evidence than the model's own opinion about which walls it saw something in — and
 *  asking for that opinion would put AI judgement back into the decision
 *  `refineDetections` just moved onto measurements.
 *
 *  Rule 2 used to match on the label alone, with no positional test at all, so any
 *  two objects the model named identically collapsed into one: four matching
 *  dining chairs, a pair of bedside tables, two curtains on the same wall. On the
 *  one path in the product that spends the user's quota, that quietly threw away
 *  correct results. When either detection has no `position` there is nothing to
 *  compare, and we keep both — a duplicate the user can delete beats a real piece
 *  of furniture that never appears.
 *
 *  **The label test that survives at the bottom of rule 2 is a decision, not a
 *  leftover.** Dropping it — so that position alone decides — was proposed, priced
 *  and refused: see the second describe block in `tests/detect-pipeline.test.ts`,
 *  which holds both directions as tests. It costs a real piece of furniture on
 *  every run where two same-category pieces sit closer than their tier (two
 *  paintings 0.30 m apart against painting's 0.35 m), and buys back a duplicate
 *  that is one tap from gone. Same asymmetry as everywhere else in this file.
 *
 *  Exported for tests: this is pure logic that decides what the user gets from the
 *  one call that spends their quota. */
export function dedupeDetections(items: Detection[]): Detection[] {
  const out: Detection[] = [];
  for (const d of items) {
    const isDup = out.some((o) => {
      if (o.category !== d.category) return false;
      // Same photo — heavily overlapping boxes mean one object boxed twice.
      if (o.slot === d.slot && boxIoU(o.box, d.box) >= SAME_BOX_IOU) return true;
      // Different photos — same name AND same place.
      if (o.label.toLowerCase().trim() !== d.label.toLowerCase().trim()) return false;
      if (!o.position || !d.position) return false;
      const dist = Math.hypot(o.position.x - d.position.x, o.position.z - d.position.z);
      return dist < mergeDistanceFor(d.category);
    });
    if (!isDup) out.push(d);
  }
  return out;
}

/** Detector output → what the review screen shows. The ORDER is the point.
 *
 *  Measurement first: `dedupeDetections` compares 3D centres, so running it
 *  before the geometry pass compared the AI's guessed positions — the very
 *  numbers `geoRefine` exists to replace. A merge decides what exists in the
 *  room, and deciding it on AI geometry is CLAUDE.md rule 2 violated one layer
 *  above where rule 2 is enforced.
 *
 *  `room` is null when the room's own dimensions are unknown, in which case
 *  nothing can be measured and only the cloud path's self-reported positions are
 *  available to merge on. That is the old behaviour, kept deliberately: an
 *  unmeasurable photo is not a reason to stop merging.
 *
 *  Runs before any uid is minted, so there is no survivorship question to get
 *  wrong here — see the note on `confirmed` in app/onboarding/detect/page.tsx. */
export function refineDetections(dets: Detection[], cals: CalMap, room: RoomDims | null): Detection[] {
  return dedupeDetections(room ? dets.map((d) => geoRefine(d, cals, room)) : dets);
}

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
import {
  frameCuts,
  locateOnWall,
  placeCeilingObject,
  placeFloorObject,
  placeWallObject,
  type CameraCal,
} from './photo-geometry';
import type { Detection } from './detection';
import { defaultAxisFor, defaultDepthFor, isRoundPart, sceneShapeFor, type Category } from './scene-spec';
import type { CaptureSlot } from './storage';
import type { Footprint } from './footprint';

/** Room extent in METRES. `depth` is the N–S dimension.
 *
 *  `height` is required, not optional, and that is the point: it is the only thing
 *  that locates the ceiling plane, so a caller that forgot it would silently stop
 *  measuring every fan and pendant in the room rather than fail to compile. */
export type RoomDims = {
  width: number;
  depth: number;
  height: number;
  /** The room's own outline. Required, not optional, and for the same reason `height`
   *  is: `onFramedSurface` bounds a decoded lateral offset against the wall's real
   *  ends, and a caller that omitted this would get the bounding box back — which is
   *  exactly the defect it exists to fix, silently. `roomFootprint` derives it from a
   *  saved room in one line. */
  footprint: Footprint;
};

/** One calibrated camera per wall the user actually photographed. A slot with no
 *  entry has no calibration — a normal outcome for a partial capture, not a
 *  failure, and `geoRefine` returns such detections untouched. */
export type CalMap = Partial<Record<CaptureSlot, CameraCal>>;

// Replace the AI's guessed position/size with values computed from projective
// geometry: bbox bottom edge → floor position; angular size × distance → real
// W and H. Depth genuinely cannot be observed from one photo, so it comes from
// the category's typical depth narrowed by the shape's range — never a literal —
// and clampDims gates everything downstream. AI keeps naming and classifying only.
//
// For a FLOOR or WALL piece that default is no longer only a filler for the axis
// nobody measured: both placers READ it, because a bbox edge is a corner of a solid
// rather than a point on a plane — a floor piece's bottom row is its near face, and
// a wall piece's back is on the plaster with its body in the room. So both branches
// stop preferring `d.dimMM[1]`, and that is rule 2 rather than tidiness: the AI's
// depth guess would otherwise move a measurement. The same catalogue number is what
// the piece is drawn with, so a hint kept for the render beside a default used for
// the maths cannot leave the two disagreeing.
//
// The CEILING branch is the one place `d.dimMM[1]` still wins, and it is not an
// oversight: `placeCeilingObject` reads one row of a disc and takes no depth, so
// nothing there turns a depth into a measurement.
export function geoRefine(d: Detection, cals: CalMap, room: RoomDims): Detection {
  const cal = cals[d.slot];
  if (!cal) return d;
  const cat = (d.category ?? 'other') as Category;
  // The shape the room will BUILD this row as, by the room's own rule — never the
  // raw hint with `box` for a blank. The on-device detector names almost no shapes,
  // so that blank was the normal case, and a `ceiling light` came through as a lamp
  // shaped like a box: a floor piece. Its box is above the horizon, so the floor
  // placer refused it, and the room then built the pendant the label says it is and
  // hung it by the wall of whichever photo saw it — one per photo. A row measured as
  // one shape and built as another is measured on the wrong plane, with the wrong
  // depth, and compared for repeats as something it is not.
  const shape = sceneShapeFor(cat, d.label, d.shape);
  const anchor = anchorFor(cat, shape);
  const catalogueDepth = defaultDepthFor(cat, shape);
  // Named for its only consumer. It was `hintedDepth`, read by two branches of
  // three; a name that outlives the second consumer reads as a ladder the other
  // branches are also on.
  const ceilingDepth = d.dimMM?.[1] ?? catalogueDepth;

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
      dimMM: [g.widthMM, ceilingDepth, d.dimMM?.[2] ?? defaultAxisFor(cat, shape, 2)],
    };
  }

  // ONE footprint for both placers, because it answers one question — what shape is
  // this piece in plan — and the two placers differ only in what pins its depth
  // axis. Roundness is read off the SAME (category, shape) pair as the depth, so the
  // number a piece is measured by and the footprint it is inverted as cannot
  // disagree — and both are the shape the room builds, so a round table named only
  // by its word is measured round.
  //
  // `whole` is the same catalogue again, for the sides the photo's edge cut off: what
  // the box did not see is not a size the camera measured, and a cut piece read as
  // its visible part is the scan coming back too small (`PieceFootprint.whole`).
  const foot = {
    depthM: catalogueDepth / 1000,
    round: isRoundPart(shape),
    whole: { widthM: defaultAxisFor(cat, shape, 0) / 1000, heightM: defaultAxisFor(cat, shape, 2) / 1000 },
  };
  const g =
    anchor === 'floor'
      ? placeFloorObject(d.box, d.slot, room, cal, foot)
      : placeWallObject(d.box, d.slot, room, cal, foot);
  if (!g) return d;
  return {
    ...d,
    position: g.position,
    yaw: typeof d.yaw === 'number' ? d.yaw : g.yaw,
    dimMM: [g.widthMM, catalogueDepth, g.heightMM],
  };
}

/** WHERE a wall row is, when `geoRefine` could not measure it — position and heading,
 *  never size. Returns the row itself when there is nothing to locate: a floor or
 *  ceiling piece, an uncalibrated photo, or a line of sight that meets no wall.
 *
 *  Its own function rather than a fourth branch of `geoRefine`, because the two answer
 *  different questions and a caller needs to be able to ask the first alone.
 *  `geoRefine` returning the SAME object is how `lib/label-repair.ts` knows a row went
 *  unmeasured, and a return-wall piece has to stay unmeasured there: its size was read
 *  against the wrong wall, so a verdict on its label would be a verdict on nothing.
 *  Folding the location in would hand back a new object and a measured-looking row.
 *
 *  The size stays whatever the row already had — the cloud path's hint, or nothing —
 *  and `buildSceneFromRoom` clamps it like any other hint. The heading follows
 *  `geoRefine`'s precedent: the model's own yaw wins where it gave one. */
export function geoLocate(d: Detection, cals: CalMap, room: RoomDims): Detection {
  const cal = cals[d.slot];
  if (!cal) return d;
  const cat = (d.category ?? 'other') as Category;
  const shape = sceneShapeFor(cat, d.label, d.shape);
  const anchor = anchorFor(cat, shape);
  // The same plane split `geoRefine` makes, curtain exception included.
  if (anchor === 'floor' || (anchor === 'ceiling' && d.category !== 'curtain')) return d;
  const g = locateOnWall(d.box, d.slot, room.footprint, cal, {
    depthM: defaultDepthFor(cat, shape) / 1000,
    round: isRoundPart(shape),
  });
  if (!g) return d;
  return { ...d, position: g.position, yaw: typeof d.yaw === 'number' ? d.yaw : g.yaw };
}

/** Measure a row where the camera can, and otherwise locate it where it can — the one
 *  call every path that turns a photo into rows makes. A row `geoRefine` measured comes
 *  back measured; one it refused comes back from `geoLocate`, which adds a position and
 *  nothing else. */
export function geoPlace(d: Detection, cals: CalMap, room: RoomDims): Detection {
  const measured = geoRefine(d, cals, room);
  return measured === d ? geoLocate(d, cals, room) : measured;
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

/** Words the two detectors use for the same thing. The on-device path runs two
 *  models over every photo — Open Images names (`Couch`, `Houseplant`, `Bookcase`)
 *  and the world prompts (`Sofa`, `Potted plant`, `Bookshelf`) — so one sofa seen from
 *  two walls could come back as a couch in one photo and a sofa in the other, and
 *  rule 2's label test kept both. Only TRUE synonyms: a loveseat beside a sofa, or a
 *  ceiling fan above a standing one, are two pieces, and that asymmetry is the
 *  reason the label test exists. */
const SAME_THING: readonly (readonly string[])[] = [
  ['sofa', 'couch', 'studio couch'],
  ['tv', 'television'],
  ['plant', 'houseplant', 'potted plant'],
  ['bookshelf', 'bookcase'],
  ['fan', 'electric fan', 'mechanical fan', 'standing fan'],
  ['dining table', 'kitchen & dining room table'],
  ['cabinet', 'storage cabinet', 'cupboard', 'cabinetry'],
  ['curtain', 'window curtain'],
  ['clothes rail', 'clothes rack', 'hanging clothes'],
  ['nightstand', 'bedside table'],
  ['fridge', 'refrigerator'],
];
const CANONICAL = new Map(SAME_THING.flatMap((g) => g.map((w) => [w, g[0]] as const)));

/** A label reduced to the word rule 2 compares: lowercased, trimmed, synonyms folded. */
export function sameThingKey(label: string): string {
  const l = label.toLowerCase().trim();
  return CANONICAL.get(l) ?? l;
}

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
 *  `measured` names the rows the camera sized. Without it the first sighting of a pair
 *  survives, which is the old rule and the right one for rows that are all measured or
 *  all hints; with it, a measured sighting replaces an unmeasured one it merges with.
 *  It decides which row is handed back and never which rows merge, so the same list
 *  gives the same number of rows with the set or without it.
 *
 *  Exported for tests: this is pure logic that decides what the user gets from the
 *  one call that spends their quota. */
export function dedupeDetections(items: Detection[], measured?: ReadonlySet<Detection>): Detection[] {
  // A group is compared through the row that FOUNDED it across photos, and through
  // every row in it within one, and hands back its survivor.
  const groups: Detection[][] = [];
  const out: Detection[] = [];
  for (const d of items) {
    const at = groups.findIndex((g) => {
      const o = g[0];
      if (o.category !== d.category) return false;
      // Same photo — heavily overlapping boxes mean one object boxed twice. Asked of
      // every sighting in the group, not only its founder: a print founded from the
      // north photo and joined from the east one is still boxed twice in the east
      // photo, and asking the founder alone could not see it — two photos, and
      // `wall art` is not `painting` — so the print came out twice. A box that
      // overlaps a group's own box that heavily cannot reach anywhere new, which is
      // why this one rule may ask the members and the one below may not.
      if (g.some((m) => m.slot === d.slot && boxIoU(m.box, d.box) >= SAME_BOX_IOU)) return true;
      // Different photos — same name AND same place.
      if (sameThingKey(o.label) !== sameThingKey(d.label)) return false;
      if (!o.position || !d.position) return false;
      const dist = Math.hypot(o.position.x - d.position.x, o.position.z - d.position.z);
      return dist < mergeDistanceFor(d.category);
    });
    if (at < 0) {
      groups.push([d]);
      out.push(d);
      continue;
    }
    groups[at].push(d);
    // Which sighting SURVIVES is the second half of the merge, and first-come was only
    // ever safe while every row with a position had been measured. A located row has a
    // position and no size of its own, so when it arrived first — the east photo before
    // the north one — it ate the measurement and the piece went into the room at its
    // catalogue size. The measured row takes its place, in its place in the list.
    //
    // And ONLY its place: later rows are still compared against the founder, and the
    // members, never the survivor. They used to be compared against the survivor, so a
    // measurement arriving mid-group moved the group — to another photo, which lost the
    // same-photo rule for the founder's own double box, and up to a tier's distance
    // across the floor, where it swallowed a second bed the founder was never near.
    // The members are every row that joined, whichever survives, so choosing a
    // survivor never changes a count.
    //
    // And a sighting that saw the piece WHOLE outranks one the photo's edge cut off, one
    // step down the same ladder: a cut row is measured, but on its cut side its size is
    // the catalogue's, grown from the edge it did see (`PieceFootprint.whole`). Before
    // that growth a cut row was refused outright and so never competed; now it has a
    // position, and first-come handed the room the typical size where another photo had
    // measured the real one.
    if (survivorRank(d, measured) > survivorRank(out[at], measured)) out[at] = d;
  }
  return out;
}

/** How much of a piece a row measured: nothing (located, or no measurement asked
 *  for), some of it (the photo's edge cut it off), or all of it. */
function survivorRank(d: Detection, measured: ReadonlySet<Detection> | undefined): number {
  if (!measured?.has(d)) return 0;
  const c = frameCuts(d.box);
  return c.left || c.right || c.top || c.bottom ? 1 : 2;
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
  if (!room) return dedupeDetections(dets);
  // `geoPlace` written out, because the merge needs to know which rows it measured and
  // `geoPlace`'s answer cannot say: a located row is a new object too.
  const measured = new Set<Detection>();
  const placed = dets.map((d) => {
    const m = geoRefine(d, cals, room);
    if (m === d) return geoLocate(d, cals, room);
    measured.add(m);
    return m;
  });
  return dedupeDetections(placed, measured);
}

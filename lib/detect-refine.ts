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
import { placeFloorObject, placeWallObject, type CameraCal } from './photo-geometry';
import type { Detection } from './detection';
import { defaultDepthFor, type Category, type Shape } from './scene-spec';
import type { CaptureSlot } from './storage';

/** Room floor extent in METRES. `depth` is the N–S dimension. */
export type RoomDims = { width: number; depth: number };

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
  if (anchor === 'ceiling' && d.category !== 'curtain') return d; // fan/pendant: not on the wall plane
  const g =
    anchor === 'floor'
      ? placeFloorObject(d.box, d.slot, room, cal)
      : placeWallObject(d.box, d.slot, room, cal);
  if (!g) return d;
  const depth = d.dimMM?.[1] ?? defaultDepthFor(cat, shape);
  return {
    ...d,
    position: g.position,
    yaw: typeof d.yaw === 'number' ? d.yaw : g.yaw,
    dimMM: [g.widthMM, depth, g.heightMM],
  };
}

/** Two detections are the same physical object if their estimated 3D centres are
 *  within this many metres of each other. Generous enough to catch one object
 *  reported twice from two walls, tight enough that a pair of nightstands either
 *  side of a bed (~1.5 m apart) stays two objects. */
const SAME_OBJECT_M = 0.6;

/** Drop near-identical detections. Two rules:
 *
 *  1. Same slot + same category + bbox centres within ~12% on each axis — one
 *     object boxed twice in the same photo.
 *  2. Same label + same category ACROSS slots, but only when their estimated 3D
 *     positions agree — one object seen from two walls with `alsoSeenIn` omitted.
 *
 *  Rule 2 used to match on the label alone, with no positional test at all, so any
 *  two objects the model named identically collapsed into one: four matching
 *  dining chairs, a pair of bedside tables, two curtains on the same wall. On the
 *  one path in the product that spends the user's quota, that quietly threw away
 *  correct results. When either detection has no `position` there is nothing to
 *  compare, and we keep both — a duplicate the user can delete beats a real piece
 *  of furniture that never appears.
 *
 *  Exported for tests: this is pure logic that decides what the user gets from the
 *  one call that spends their quota. */
export function dedupeDetections(items: Detection[]): Detection[] {
  const out: Detection[] = [];
  for (const d of items) {
    const cx = d.box[0] + d.box[2] / 2;
    const cy = d.box[1] + d.box[3] / 2;
    const isDup = out.some((o) => {
      if (o.category !== d.category) return false;
      // Same photo — overlapping bbox centres mean one object boxed twice.
      if (o.slot === d.slot) {
        const ocx = o.box[0] + o.box[2] / 2;
        const ocy = o.box[1] + o.box[3] / 2;
        if (Math.abs(ocx - cx) < 0.12 && Math.abs(ocy - cy) < 0.12) return true;
      }
      // Different photos — same name AND same place.
      if (o.label.toLowerCase().trim() !== d.label.toLowerCase().trim()) return false;
      if (!o.position || !d.position) return false;
      const dist = Math.hypot(o.position.x - d.position.x, o.position.z - d.position.z);
      return dist < SAME_OBJECT_M;
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

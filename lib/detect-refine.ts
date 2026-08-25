// The geometry pass over a detection.
//
// This is where CLAUDE.md rule 2 — "dimensions come from code, not AI" — is
// actually applied to a photograph: the AI's guessed position and size are
// discarded and recomputed from the calibrated camera. It sat as a private
// function inside app/onboarding/detect/page.tsx, where nothing could test the
// one decision it makes (which projection measures this object), so it moved
// here. It is pure — no React, no DOM, no fetch.

import { anchorFor } from './physics';
import { placeFloorObject, placeWallObject, type CameraCal } from './photo-geometry';
import type { Detection } from './detection';
import type { Category, Shape } from './scene-spec';
import type { CaptureSlot } from './storage';

/** Room floor extent in METRES. `depth` is the N–S dimension. */
export type RoomDims = { width: number; depth: number };

/** One calibrated camera per wall the user actually photographed. A slot with no
 *  entry has no calibration — a normal outcome for a partial capture, not a
 *  failure, and `geoRefine` returns such detections untouched. */
export type CalMap = Partial<Record<CaptureSlot, CameraCal>>;

// Replace the AI's guessed position/size with values computed from projective
// geometry: bbox bottom edge → floor position; angular size × distance → real
// W and H. Depth stays a category default (single photo can't observe it) and
// clampDims gates everything downstream. AI keeps naming/classifying only.
export function geoRefine(d: Detection, cals: CalMap, room: RoomDims): Detection {
  const cal = cals[d.slot];
  if (!cal) return d;
  const anchor = anchorFor((d.category ?? 'other') as Category, (d.shape ?? 'box') as Shape);
  if (anchor === 'ceiling' && d.category !== 'curtain') return d; // fan/pendant: not on the wall plane
  const g =
    anchor === 'floor'
      ? placeFloorObject(d.box, d.slot, room, cal)
      : placeWallObject(d.box, d.slot, room, cal);
  if (!g) return d;
  const depth = d.dimMM?.[1] ?? 500;
  return {
    ...d,
    position: g.position,
    yaw: typeof d.yaw === 'number' ? d.yaw : g.yaw,
    dimMM: [g.widthMM, depth, g.heightMM],
  };
}

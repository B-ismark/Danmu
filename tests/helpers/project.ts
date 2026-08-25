// The forward camera model, written independently of lib/photo-geometry.ts.
//
// `photo-geometry` inverts a 2D box into a 3D placement. This projects a known 3D
// placement into a 2D box. Two implementations of the same pinhole geometry, going
// opposite directions, so a round-trip through both is a real check rather than a
// tautology — which is the whole reason it is written out longhand here instead of
// calling `ray` and `tanX`.
//
// It lives in tests/helpers/ because two suites need it and the app needs neither:
// tests/photo-geometry.test.ts, where the inverse is checked against hand-computed
// cases, and tests/detect-pipeline.test.ts, where it manufactures the boxes a whole
// synthetic room's worth of detections is built from.
//
// **What a round-trip through this CANNOT test** is the projection itself. Both
// directions share one camera model by construction, so a wrong shared assumption —
// the tangent convention, the slot axes — cancels out and no assertion notices.
// That is what the hand-computed cases in photo-geometry.test.ts are for. Everything
// DOWNSTREAM of the projection is fair game.

import { CAM_HEIGHT, type CameraCal } from '@/lib/photo-geometry';
import type { CaptureSlot } from '@/lib/storage';

export type Box = [number, number, number, number];

/** Which world axis runs left-to-right across each slot's image, as a unit XZ
 *  vector. Mirrors `slotToWorld` in the lib, derived here from the capture rig's
 *  own description rather than read out of it. */
export const ALONG: Record<CaptureSlot, [number, number]> = {
  n: [1, 0], // looking −Z: image right is +X
  s: [-1, 0], // looking +Z: mirrored
  e: [0, 1], // looking +X: image right is +Z
  w: [0, -1], // looking −X: image right is −Z
};

/** Project a world point into normalized image coords for the slot camera.
 *  Honours `cal.height` and `cal.tiltRad`, so one helper generates the level cases
 *  and the tilted ones. */
export function project(slot: CaptureSlot, x: number, y: number, z: number, cal: CameraCal): [number, number] {
  // world → camera frame (forward, right, up)
  let forward = 0;
  let right = 0;
  switch (slot) {
    case 'n':
      forward = -z;
      right = x;
      break;
    case 's':
      forward = z;
      right = -x;
      break;
    case 'e':
      forward = x;
      right = z;
      break;
    case 'w':
      forward = -x;
      right = -z;
      break;
  }
  const up = y - (cal.height ?? CAM_HEIGHT);
  // Rotate the world offset back into the untilted lens frame — the inverse of the
  // rotation lib/photo-geometry applies to each ray.
  const th = cal.tiltRad ?? 0;
  const c = Math.cos(th);
  const s = Math.sin(th);
  const upCam = up * c + forward * s;
  const fwdCam = -up * s + forward * c;
  const u = right / fwdCam / cal.k + 0.5;
  const v = 0.5 - (upCam / fwdCam) * (cal.aspect / cal.k);
  return [u, v];
}

function extent(pts: Array<[number, number]>): Box {
  const us = pts.map((p) => p[0]);
  const vs = pts.map((p) => p[1]);
  const u0 = Math.min(...us);
  const v0 = Math.min(...vs);
  return [u0, v0, Math.max(...us) - u0, Math.max(...vs) - v0];
}

/** bbox of a wall-parallel rectangle (width w, height h) standing on the floor at
 *  world centre (x, z).
 *
 *  Projects the four corners and takes their extent rather than deriving a
 *  half-width analytically: under tilt a fronto-parallel rectangle images as a
 *  trapezoid, and the bounding box of a trapezoid is what a detector would actually
 *  hand us. */
export function bboxOfFloorObject(
  slot: CaptureSlot,
  x: number,
  z: number,
  wM: number,
  hM: number,
  cal: CameraCal,
): Box {
  const [ax, az] = ALONG[slot];
  const pts: Array<[number, number]> = [];
  for (const sgn of [-1, 1]) {
    for (const y of [0, hM]) {
      pts.push(project(slot, x + ax * sgn * (wM / 2), y, z + az * sgn * (wM / 2), cal));
    }
  }
  return extent(pts);
}

/** bbox of a flat panel of width w and height h hung on a wall, centred at world
 *  (x, y, z). Spans the slot's own left-to-right axis, so it is correct on the E/W
 *  walls as well as N/S. */
export function bboxOfWallPanel(
  slot: CaptureSlot,
  x: number,
  y: number,
  z: number,
  wM: number,
  hM: number,
  cal: CameraCal,
): Box {
  const [ax, az] = ALONG[slot];
  const pts: Array<[number, number]> = [];
  for (const sgn of [-1, 1]) {
    for (const dy of [-hM / 2, hM / 2]) {
      pts.push(project(slot, x + ax * sgn * (wM / 2), y + dy, z + az * sgn * (wM / 2), cal));
    }
  }
  return extent(pts);
}

/** bbox of a flat horizontal DISC of diameter `dM` lying on the ceiling, centred at
 *  world (x, z) — a ceiling fan or a flush pendant.
 *
 *  Sampled around the rim rather than at four corners, because the silhouette of a
 *  circle is not the projection of its bounding square: the widest image point is
 *  where the ray is TANGENT to the rim, which sits nearer the camera than the
 *  circle's lateral extreme. Corners would build `placeCeilingObject`'s own
 *  approximation into the thing meant to check it. */
export function bboxOfCeilingDisc(
  slot: CaptureSlot,
  x: number,
  z: number,
  dM: number,
  cal: CameraCal,
  ceilingM: number,
): Box {
  const r = dM / 2;
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < 720; i++) {
    const a = (i / 720) * 2 * Math.PI;
    pts.push(project(slot, x + r * Math.cos(a), ceilingM, z + r * Math.sin(a), cal));
  }
  return extent(pts);
}

/** Is the whole box inside the frame?
 *
 *  Worth asserting on every fixture rather than assuming. A real detector can only
 *  ever hand over a box it could see, so a synthetic box hanging off the edge of the
 *  image is not a hard case — it is an impossible one, and a placer fed it measures
 *  something that was never photographed. Both anchors have a distance below which
 *  their surface leaves a level frame entirely (see `placeCeilingObject`), and a
 *  fixture that trips it fails here rather than a hundred lines downstream. */
export function inFrame(box: Box): boolean {
  return box[0] >= 0 && box[1] >= 0 && box[0] + box[2] <= 1 && box[1] + box[3] <= 1;
}

// Resizing by pulling a side. Pure, so the arithmetic the 3D stretch handles run
// on is testable without a canvas.
//
// The handles replaced a scale gizmo that put nine controls on the piece's pivot
// (three coloured cubes, three grey, three planes) and grew the piece from its
// centre, so both sides moved and nothing said which of the nine did what. A
// handle here sits on ONE face and moves THAT face: the opposite side stays where
// it stands, which is what pulling a side means everywhere else people resize
// things.
//
// Sizes still come from code: every answer passes through the caller's clamp,
// which is `clampDims` (CLAUDE.md rule 2). A pull past the range stops at it.

import { frontVector, localToWorld } from './geometry';

export type StretchAxis = 'width' | 'depth' | 'height';

/** Which entry of `dimMM` ([W, D, H]) each handle changes. */
export const STRETCH_INDEX: Record<StretchAxis, 0 | 1 | 2> = { width: 0, depth: 1, height: 2 };

type Dim3 = [number, number, number];
type Vec3 = [number, number, number];

/** The world direction a handle's face points, for a piece turned to `rot`, on
 *  `side` (+1 or −1) of it. Width is the piece's own local X, depth its local Z
 *  (its front), height is up. */
export function stretchDirection(rot: number, axis: StretchAxis, side: 1 | -1): Vec3 {
  if (axis === 'height') return [0, side, 0];
  const [x, z] = axis === 'width' ? localToWorld(rot, 1, 0) : frontVector(rot);
  return [x * side, 0, z * side];
}

/** How far the pointer has pulled the face outward, in metres: the pointer's
 *  travel since the press, projected onto the face's direction. Negative pushes
 *  the face in. */
export function pulledBy(start: Vec3, now: Vec3, dir: Vec3): number {
  return (now[0] - start[0]) * dir[0] + (now[1] - start[1]) * dir[1] + (now[2] - start[2]) * dir[2];
}

/** The size after a pull. Only the pulled axis changes; it is rounded to the snap
 *  step (whole millimetres with snap off), never below one step, then clamped. */
export function stretchedDim(
  start: Dim3,
  axis: StretchAxis,
  pulledM: number,
  stepMM: number | null,
  clamp: (d: Dim3) => Dim3,
): Dim3 {
  const i = STRETCH_INDEX[axis];
  const step = stepMM ?? 1;
  const raw = start[i] + pulledM * 1000;
  const next: Dim3 = [start[0], start[1], start[2]];
  next[i] = Math.max(step, Math.round(raw / step) * step);
  return clamp(next);
}

/**
 * Where the piece's origin goes so the face OPPOSITE the handle stays put.
 *
 * Width and depth: the centre moves half the growth toward the pulled side.
 * Height: a floor-standing piece's origin is its base, so pulling the top moves
 * nothing; a centred piece (wall, ceiling) moves half the growth toward the
 * pulled side, keeping the other edge where it was.
 *
 * Derived from the START of the gesture every frame, never from the last frame,
 * so a frame the resolve corrected does not become the next frame's base.
 */
export function stretchedOrigin(
  startPos: Vec3,
  rot: number,
  axis: StretchAxis,
  side: 1 | -1,
  startDim: Dim3,
  dim: Dim3,
  floorStanding: boolean,
): Vec3 {
  const i = STRETCH_INDEX[axis];
  const grown = (dim[i] - startDim[i]) / 1000;
  if (axis === 'height') {
    if (floorStanding) return [startPos[0], side > 0 ? startPos[1] : startPos[1] - grown, startPos[2]];
    return [startPos[0], startPos[1] + (side * grown) / 2, startPos[2]];
  }
  const d = stretchDirection(rot, axis, side);
  return [startPos[0] + (d[0] * grown) / 2, startPos[1], startPos[2] + (d[2] * grown) / 2];
}

/** Which side of the piece a width or depth handle sits on: the one facing the
 *  camera, so it is never hidden behind the piece it belongs to. A tie (camera
 *  exactly edge-on) takes the positive side. */
export function facingSide(rot: number, axis: 'width' | 'depth', centre: Vec3, camera: Vec3): 1 | -1 {
  const d = stretchDirection(rot, axis, 1);
  const toCam = (camera[0] - centre[0]) * d[0] + (camera[2] - centre[2]) * d[2];
  return toCam < 0 ? -1 : 1;
}

/** The plane a handle is dragged across: it contains the handle's direction and
 *  faces the camera as squarely as that allows, so pointer travel along the
 *  direction is read at full strength. A horizontal plane would do for width and
 *  depth from above and go edge-on as the camera drops to eye level, where a
 *  pixel of travel is metres of pull. Unit normal, or null when the camera looks
 *  straight down the direction and there is no travel along it to read. */
export function dragPlaneNormal(dir: Vec3, toCamera: Vec3): Vec3 | null {
  const k = toCamera[0] * dir[0] + toCamera[1] * dir[1] + toCamera[2] * dir[2];
  const n: Vec3 = [toCamera[0] - dir[0] * k, toCamera[1] - dir[1] * k, toCamera[2] - dir[2] * k];
  const len = Math.hypot(n[0], n[1], n[2]);
  if (len < 1e-6 * Math.max(1, Math.hypot(toCamera[0], toCamera[1], toCamera[2]))) return null;
  return [n[0] / len, n[1] / len, n[2] / len];
}

// Dragging a wall piece ON its wall — up and down as well as along.
//
// A floor drag follows the pointer across a horizontal plane at the piece's own
// height, and for a TV or a framed print that plane is the wrong one: the finger
// moves up the wall and the piece slides away from it, then snaps back, and its
// height never changes. So a piece that follows the pointer up
// (`followsPointerUp`) is dragged across the vertical plane of its own wall, and
// the grip is kept in that wall's frame — along it and up it — so the spot you
// took hold of stays under the finger, including after the piece turns a corner
// onto the next wall.
//
// Pure and camera-free: the caller hands in the ray. Where the piece is finally
// allowed to go — flush to which wall, at what height, snapped to what grid — is
// still `resolvePlacement`'s answer; this only says where the pointer is asking.

import { frontVector, localToWorld } from './geometry';

type Vec3 = [number, number, number];

/** How squarely the pointer ray has to meet the wall (|cos| against its normal)
 *  for the wall plane to be trusted. Below this the ray grazes the wall and a
 *  pixel of pointer travel is metres along it — so the press falls back to the
 *  floor-plane drag, and a mid-drag frame that grazes is skipped. */
export const MIN_WALL_FACING = 0.2;

/** Where the ray meets the vertical plane through `through` that faces `rot`'s
 *  front, or null when it grazes that plane or meets it behind the camera. */
export function wallPlaneHit(origin: Vec3, dir: Vec3, through: Vec3, rot: number): Vec3 | null {
  const [nx, nz] = frontVector(rot);
  const len = Math.hypot(dir[0], dir[1], dir[2]);
  if (len === 0) return null;
  const denom = dir[0] * nx + dir[2] * nz;
  if (Math.abs(denom) / len < MIN_WALL_FACING) return null;
  const t = ((through[0] - origin[0]) * nx + (through[2] - origin[2]) * nz) / denom;
  if (!(t > 0)) return null;
  return [origin[0] + dir[0] * t, origin[1] + dir[1] * t, origin[2] + dir[2] * t];
}

/** Where on the piece the pointer took hold, in its wall's frame: metres along
 *  the wall (the piece's local X) and up it, from the piece's origin. */
export type WallGrip = { along: number; up: number };

export function wallGrip(hit: Vec3, pos: Vec3, rot: number): WallGrip {
  const [tx, tz] = localToWorld(rot, 1, 0);
  return { along: (hit[0] - pos[0]) * tx + (hit[2] - pos[2]) * tz, up: hit[1] - pos[1] };
}

/** Where the piece's origin goes so its grip sits under `hit`. `rot` is the
 *  piece's angle NOW, which after a corner is the next wall's: the grip is re-laid
 *  along that wall rather than along the one it was measured on. */
export function wallTarget(hit: Vec3, grip: WallGrip, rot: number): Vec3 {
  const [tx, tz] = localToWorld(rot, 1, 0);
  return [hit[0] - tx * grip.along, hit[1] - grip.up, hit[2] - tz * grip.along];
}

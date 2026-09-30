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
// It also changes walls. The plane above is the piece's OWN wall, so the pointer
// could carry it round a corner but never across the room: aim at the far wall and
// the ray met the near wall's plane somewhere behind the camera, or outdoors. So a
// frame whose pointer is on a DIFFERENT wall's inner face — clearly off the corner
// it shares with this one, `WALL_SWITCH_M` — takes the piece onto that wall
// (`wallDragTarget`). Asked on the preview: "I should be able to move a tv … to
// the other walls when i drag it to them". The pointer over the floor or the
// ceiling asks for no change of wall, so a drag down the room stays on its wall.
//
// Pure and camera-free: the caller hands in the ray. Where the piece is finally
// allowed to go — flush to which wall, at what height, snapped to what grid — is
// still `resolvePlacement`'s answer; this only says where the pointer is asking.

import { edgeProjection, frontVector, localToWorld, nearestEdge, polygonWinding } from './geometry';
import type { Footprint } from './footprint';

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

/** How far past the shared corner the pointer has to be on another wall before
 *  the piece changes to it. Without it the corner is a line the pointer cannot sit
 *  on: a TV held there flips between the two walls every frame the pointer
 *  trembles. Measured from the piece's current wall, so it is the same margin
 *  going back. */
export const WALL_SWITCH_M = 0.15;

/** The wall whose inner face the pointer ray meets first, and where, or null when
 *  the ray leaves through the floor, the ceiling or a gap: only a point ON the
 *  plaster, between the floor and `roomHeight`, is a wall under the pointer. An
 *  outer face does not count, so from the dollhouse view — the near walls culled —
 *  the answer is the wall the person can see. A grazing ray is refused for the
 *  reason `MIN_WALL_FACING` gives. */
export function wallUnderPointer(
  origin: Vec3,
  dir: Vec3,
  footprint: Footprint,
  roomHeight: number,
): { index: number; hit: Vec3 } | null {
  const n = footprint.length;
  if (n < 3) return null;
  const len = Math.hypot(dir[0], dir[1], dir[2]);
  if (len === 0) return null;
  const w = polygonWinding(footprint);
  let best: { index: number; hit: Vec3; t: number } | null = null;
  for (let i = 0; i < n; i++) {
    const a = footprint[i];
    const b = footprint[(i + 1) % n];
    const e = edgeProjection(footprint, i, a[0], a[1], w);
    if (!e) continue;
    // The inner face looks along the INWARD normal, so the ray meets it heading out.
    const denom = dir[0] * e.nx + dir[2] * e.nz;
    if (-denom / len < MIN_WALL_FACING) continue;
    const t = ((a[0] - origin[0]) * e.nx + (a[1] - origin[2]) * e.nz) / denom;
    if (!(t > 0) || (best && t >= best.t)) continue;
    const hit: Vec3 = [origin[0] + dir[0] * t, origin[1] + dir[1] * t, origin[2] + dir[2] * t];
    if (hit[1] < 0 || hit[1] > roomHeight) continue;
    const abx = b[0] - a[0];
    const abz = b[1] - a[1];
    const s = ((hit[0] - a[0]) * abx + (hit[2] - a[1]) * abz) / (abx * abx + abz * abz);
    if (s < 0 || s > 1) continue;
    best = { index: i, hit, t };
  }
  return best && { index: best.index, hit: best.hit };
}

/** Where a wall drag's pointer asks the piece at `pos` (turned `rot`) to go: onto
 *  the wall under the pointer when that is another wall and clearly so, otherwise
 *  along its own wall's plane as before. Null for a frame to skip. The piece's
 *  turn to face the room from its new wall is `resolvePlacement`'s, which snaps a
 *  wall rider to the wall nearest the point this returns — and that is the wall
 *  the pointer is on, because the point is on its face. */
export function wallDragTarget(
  origin: Vec3,
  dir: Vec3,
  pos: Vec3,
  rot: number,
  grip: WallGrip,
  footprint: Footprint,
  roomHeight: number,
): Vec3 | null {
  const own = nearestEdge(footprint, pos[0], pos[2]);
  const under = own ? wallUnderPointer(origin, dir, footprint, roomHeight) : null;
  if (own && under && under.index !== own.index) {
    // Off the current wall's LINE, not its segment: for the wall round a corner that
    // is the distance from the corner, and the far wall is always clear of it.
    const a = footprint[own.index];
    const off = Math.abs((under.hit[0] - a[0]) * own.nx + (under.hit[2] - a[1]) * own.nz);
    if (off > WALL_SWITCH_M) {
      const e = edgeProjection(footprint, under.index, under.hit[0], under.hit[2]);
      if (e) return wallTarget(under.hit, grip, e.yaw);
    }
  }
  const hit = wallPlaneHit(origin, dir, pos, rot);
  return hit && wallTarget(hit, grip, rot);
}

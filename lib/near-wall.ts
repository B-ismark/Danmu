// Does the dollhouse cut-away take this wall piece with it?
//
// The shell hides whichever wall stands between the camera and the room by
// back-face culling (`components/three/RoomShell.tsx`): a wall's front face points
// into the room, so from outside it the GPU simply skips it. The pieces fixed to
// that wall — a window, the curtains in front of it, a painting, a TV — are not
// part of the wall's mesh, so they stayed, hanging in mid-air across the front of
// the view: the one wall the cut-away exists to remove still blocked the room.
//
// A wall piece's front (local +Z, `frontVector`) faces into the room and its back
// lies against the plaster, so the question the GPU asks of the wall can be asked of
// the piece: is the camera on the far side of the plane through the piece's back?
// That is the same plane to within the piece's snap gap, so the piece goes exactly
// when its wall does, and comes back with it — no second rule to drift from the
// first. Only the horizontal position matters: a wall is vertical.

import { frontVector } from './geometry';

/** True when `cam` stands behind the wall a piece at `pos`/`rot` is mounted on.
 *  `depthM` is the piece's rendered depth in metres (its back sits `depthM / 2`
 *  behind its centre). */
export function cutAwayWithWall(
  cam: readonly [number, number, number],
  pos: readonly [number, number, number],
  rot: number,
  depthM: number,
): boolean {
  const [fx, fz] = frontVector(rot);
  const backX = pos[0] - fx * (depthM / 2);
  const backZ = pos[2] - fz * (depthM / 2);
  return (cam[0] - backX) * fx + (cam[2] - backZ) * fz < 0;
}

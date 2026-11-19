// Which menu a right-click in the plan means when a wall and a piece are both
// under it.
//
// The plan draws a wall-mounted piece — a TV, a window, a door — ON its wall's
// line, above the wall's hit target. So a right-click on the stretch of wall a TV
// covers reached the TV, and the wall's own menu (split, join, paint, move, add an
// opening) could not be opened there at all. The plan is the tab where you edit
// walls, and the stretch behind a TV is not a stretch you should have to avoid.
//
// The rule, in three parts:
//   · On bare floor inside the wall's band, the wall — the band is wider than the
//     line so a wall can be hit at all, and nothing else is there.
//   · Over a piece that RIDES the wall (TV, window, door), the room side is the
//     piece's and the far side of the line is the wall's. The plan draws a wall
//     piece straddling the line — a TV's centre was measured ~3 mm inside it in
//     the probe — so no width "on the plaster" separates the two; an earlier draft
//     gave the wall a line's width inside the room, and that handed the TV's own
//     body to the wall: the same bug pointed the other way. The room's outline is
//     the one edge both drawings agree on.
//   · A piece that STANDS in the room (a sofa against the plaster) or hangs from
//     the ceiling keeps the press everywhere. Its menu is what a press on it means.
// A wall piece's own menu also offers "The wall behind it…", so neither is ever
// more than one row from the other.

import { anchorFor } from './physics';
import { nearestWall, pointInFootprint, type Footprint } from './footprint';
import type { Category, Shape } from './scene-spec';

export type PressedWall = { index: number; t: number };

/**
 * The wall this press means, or null when it means the piece (or the room).
 *
 * `band` is the wall's hit half-width in metres — the caller's, since only the
 * caller knows how many metres a screen pixel is. `piece` is what the pointer is
 * over, or null for bare floor.
 */
export function wallUnderPress(
  poly: Footprint,
  x: number,
  z: number,
  band: number,
  piece: { category: Category; shape: Shape } | null,
): PressedWall | null {
  const hit = nearestWall(poly, x, z);
  if (!hit || hit.dist > band) return null;
  const wall = { index: hit.index, t: hit.t };
  if (!piece) return wall;
  // A ceiling fan is "wall-mounted" to the renderer (`isWallMountedPart`) and
  // rides no wall, so it is asked by anchor, not by that flag.
  if (!ridesWall(piece.category, piece.shape)) return null;
  return pointInFootprint(x, z, poly) ? null : wall;
}

/** Whether a piece hangs on a wall — a TV, a window, a door, an air conditioner —
 *  as opposed to standing on the floor or hanging from the ceiling. */
export function ridesWall(category: Category, shape: Shape): boolean {
  return anchorFor(category, shape).startsWith('wall');
}

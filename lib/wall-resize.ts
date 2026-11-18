// What a typed size change owes the wall it is made on.
//
// A drag puts a wall piece's BACK on the plaster (`snapToWall`, through `hangOnWall`),
// but a size typed into the Inspector is not a drag: it rewrote `dims` and nothing else,
// so the piece grew about its centre. A TV or print made deeper sank half the difference
// into the plaster, one made shallower stood off it in the air, and a window made deeper
// kept the curtain over it where the shallow window had let it hang, with the new sill
// showing through its folds (docs/what-is-still-open.md § 58).
//
// So a resize of any piece that rides a wall answers, by the same call a drag makes:
//   · where the resized piece now stands — back to the plaster on its own wall (a
//     curtain also clearing any sill behind it). Nothing rides a wall piece —
//     `findSupportDetailed` never offers a mounted piece as a support — so there is no
//     company to carry;
//   · for a window, which curtains hung over it must move, and to where. Only the ones
//     whose hang actually CHANGES with this window's new size: a curtain on another wall,
//     further along, or over a window that did not get deeper is not touched. That also
//     makes a shallower window bring its curtain back in, which is the same re-hang read
//     the other way.
//
// The re-seat moves along the wall's normal only. Width and height grow about the
// centre as before — the piece stays where it was put along the wall and up it.
//
// Pure, so it can be tested without a store.
import { backOf } from './drag-resolve';
import { nearestEdge } from './geometry';
import { hangOnWall, ridesWall } from './physics';
import type { Footprint } from './footprint';
import type { ScenePart } from './scene-spec';

export interface RehangMove {
  id: string;
  pos: [number, number, number];
}

/** Below this the re-hang is the same spot; writing it would only stamp an override. */
const SAME_SPOT_M = 1e-6;

/** The wall a piece hangs on, read off its BACK — from its centre a piece in a corner
 *  is a tie between two walls. */
function wallOf(p: ScenePart, footprint: Footprint): number | null {
  const [bx, bz] = backOf(p.pos, p.rot, p.dimMM);
  return nearestEdge(footprint, bx, bz)?.index ?? null;
}

function hang(p: ScenePart, dimMM: [number, number, number], footprint: Footprint, neighbours: readonly ScenePart[], edge: number | null) {
  return hangOnWall([p.pos[0], 0, p.pos[2]], dimMM, footprint, p.shape, neighbours, edge);
}

/** The moves a resize of `id` to `dimMM` owes the room, given the room as it stands
 *  (`scene` is RESOLVED — effective positions and sizes — with `id` still at its old
 *  size). Empty for anything that does not ride a wall. */
export function rehangForResize(
  scene: readonly ScenePart[],
  id: string,
  dimMM: [number, number, number],
  footprint: Footprint,
): RehangMove[] {
  const piece = scene.find((p) => p.id === id);
  if (!piece || !ridesWall(piece.category, piece.shape)) return [];
  const edge = wallOf(piece, footprint);
  if (edge === null) return [];

  const others = scene.filter((p) => p.id !== id);
  const moves: RehangMove[] = [];
  const seated = hang(piece, dimMM, footprint, others, edge);
  const at: [number, number, number] = [seated.x, piece.pos[1], seated.z];
  const after: ScenePart = { ...piece, dimMM, pos: at };
  if (Math.hypot(seated.x - piece.pos[0], seated.z - piece.pos[2]) > SAME_SPOT_M) {
    moves.push({ id, pos: at });
  }
  if (piece.shape !== 'window') return moves;

  for (const c of others) {
    if (c.shape !== 'curtain' || !ridesWall(c.category, c.shape)) continue;
    const cEdge = wallOf(c, footprint);
    if (cEdge === null) continue;
    const rest = others.filter((p) => p.id !== c.id);
    const before = hang(c, c.dimMM, footprint, [...rest, piece], cEdge);
    const now = hang(c, c.dimMM, footprint, [...rest, after], cEdge);
    // Only a change THIS window caused. A curtain that some other sill holds where it is
    // stays put.
    if (Math.hypot(now.x - before.x, now.z - before.z) <= SAME_SPOT_M) continue;
    moves.push({ id: c.id, pos: [now.x, c.pos[1], now.z] });
  }
  return moves;
}

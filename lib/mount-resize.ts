// What a typed size change owes the surface a piece is mounted on.
//
// A drag puts a wall piece's BACK on the plaster (`snapToWall`, through `hangOnWall`)
// and holds a hung piece inside the floor-to-ceiling band, but a size typed into the
// Inspector is not a drag: it rewrote `dims` and nothing else, so the piece grew about
// its centre. A TV or print made deeper sank half the difference into the plaster, one
// made shallower stood off it in the air; a ceiling fan made taller pushed its top
// through the slab and one made shorter dropped away from it; a door made taller lifted
// its threshold off the floor; and a window made deeper kept the curtain over it where
// the shallow window had let it hang, with the new sill showing through its folds
// (docs/what-is-still-open.md § 58).
//
// So a resize of any mounted piece answers, by the rules the rest of the app already
// uses for it:
//   · ACROSS the wall — back to the plaster on its own wall, by the call a drag makes (a
//     curtain also clearing any sill behind it). Along the wall nothing changes: width
//     grows about the centre, so a piece stays where it was put. Nothing rides a mounted
//     piece — `findSupportDetailed` never offers one as a support — so there is no
//     company to carry;
//   · UP the wall — by what the piece hangs from (`heightForResize`): a ceiling fixture,
//     a curtain or an air conditioner keeps its TOP where it was, a door keeps its
//     threshold on the floor, and a TV, print or window keeps its centre, because that is
//     the height a person chose for it;
//   · for a window, which curtains hung over it must move, and to where. Only the ones
//     whose hang actually CHANGES with this window's new size: a curtain on another wall,
//     further along, or over a window that did not get deeper is not touched. That also
//     makes a shallower window bring its curtain back in, which is the same re-hang read
//     the other way.
//
// Pure, so it can be tested without a store.
import { backOf } from './drag-resolve';
import { nearestEdge } from './geometry';
import { anchorFor, hangOnWall, MOUNT_PAD, ridesWall } from './physics';
import type { Category, Shape } from './scene-spec';
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

/** Where a mounted piece's centre goes when its height changes from `oldMM` to `newMM`.
 *
 *  The same reading of the anchors `heightForNewCeiling` makes for a room whose ceiling
 *  moves: `ceiling` and `wall-high` hang from the slab, so they keep their top; a door
 *  (`wall-floor`) stands on its threshold, so it keeps its bottom; the rest keep their
 *  centre. Then held inside the room by the same band a drag clamps to — except a door,
 *  whose canonical height is `h / 2` with no pad (see `MOUNT_PAD`). A piece too tall for
 *  the room keeps its real height and pokes through, as everywhere else (rule 2). A
 *  floor piece's `pos[1]` is its base, so it never moves. */
export function heightForResize(
  category: Category,
  shape: Shape,
  y: number,
  oldMM: number,
  newMM: number,
  roomHeight: number,
): number {
  const anchor = anchorFor(category, shape);
  if (anchor === 'floor') return y;
  const grown = (newMM - oldMM) / 1000;
  if (anchor === 'wall-floor') return y + grown / 2;
  const next = anchor === 'ceiling' || anchor === 'wall-high' ? y - grown / 2 : y;
  const h = newMM / 1000;
  return Math.max(h / 2 + MOUNT_PAD, Math.min(roomHeight - h / 2 - MOUNT_PAD, next));
}

/** The moves a resize of `id` to `dimMM` owes the room, given the room as it stands
 *  (`scene` is RESOLVED — effective positions and sizes — with `id` still at its old
 *  size). Empty for a floor piece, and for any resize that moves nothing. */
export function rehangForResize(
  scene: readonly ScenePart[],
  id: string,
  dimMM: [number, number, number],
  footprint: Footprint,
  roomHeight: number,
): RehangMove[] {
  const piece = scene.find((p) => p.id === id);
  // A floor piece falls through to no move: its height is its base and it rides no wall.
  if (!piece) return [];

  const others = scene.filter((p) => p.id !== id);
  const y = heightForResize(piece.category, piece.shape, piece.pos[1], piece.dimMM[2], dimMM[2], roomHeight);
  let [x, z] = [piece.pos[0], piece.pos[2]];
  if (ridesWall(piece.category, piece.shape)) {
    const edge = wallOf(piece, footprint);
    if (edge !== null) {
      const seated = hang(piece, dimMM, footprint, others, edge);
      [x, z] = [seated.x, seated.z];
    }
  }
  const at: [number, number, number] = [x, y, z];
  const after: ScenePart = { ...piece, dimMM, pos: at };
  const moves: RehangMove[] = [];
  if (Math.hypot(x - piece.pos[0], y - piece.pos[1], z - piece.pos[2]) > SAME_SPOT_M) moves.push({ id, pos: at });
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

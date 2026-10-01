// The room as it first arrived — what "Start over" puts back.
//
// The button used to be "Put everything back", and it did less than it said:
// `resetTransforms()` dropped the move / turn / size overrides and left every piece
// added since, every recolour and every hidden piece where it was. A person pressing
// it after an afternoon of trying things expects the room they started with — the
// scan's furniture, or the starter arrangement — and got their additions shuffled
// back to wherever the Library first dropped them.
//
// The start is REBUILT, not remembered: `buildSceneFromRoom` on the record the room
// was opened from (`useScene.startSource`), the same call that furnished it the first
// time. A snapshot taken at load could not be the start, because what loads is the
// SAVED scene — the room as it was left, not as it began.
//
// It puts back the WALLS as well, the ones the start is built for. They used to
// stay where they had been dragged, and a start rebuilt for walls that have moved is a
// different arrangement: the user dragged one wall of a fresh starter room, pressed
// Start over and got a room re-laid with pieces nobody had touched. A wall drag also
// carries what stands against the wall (`lib/wall-actions.ts`), so there was no
// separating "the walls changed" from "the furniture changed" anyway. So the start is
// the whole room as it opened — `useScene.startRoom`, its walls and height, and the
// pieces built for those — and putting it back never re-lays anything. Paint, the site
// and the lighting are the look, not the room, and stay.
//
// What that leaves, written down rather than fixed: a starter whose walls were moved
// and SAVED reopens with those walls as its start and its pieces laid out for the old
// ones, so the button is offered on a room nobody has touched since it opened, and
// pressing it fits the starter to the walls it opened with. The walls it was first
// furnished for are not kept anywhere.
//
// Pure, so it can be tested without the stores; the store writes are the caller's.

import { buildSceneFromRoom, defaultScene, normalizeStoredParts, type ScenePart } from './scene-spec';
import type { RoomShape } from './scene-store';
import type { RoomData } from './storage';

/** The pieces the room started with, laid out in the walls of `room`. */
export function startingParts(source: RoomData | null, room: RoomShape): ScenePart[] {
  const built = source
    ? buildSceneFromRoom({
        ...source,
        width: room.width,
        depth: room.depth,
        height: room.height,
        layoutId: room.layoutId,
        footprint: room.footprint,
      })
    : defaultScene(room.layoutId, room.width, room.depth, { footprint: room.footprint, height: room.height });
  // Through the same re-derivation a saved scene gets on the way in (`RoomSync`), so
  // the two sides of the compare have been through the same steps. It is the identity
  // on a fresh build today, for every preset — `tests/room-start.test.ts` holds that —
  // and it is here so a derivation added to it later cannot make every saved room read
  // as edited.
  return normalizeStoredParts(built);
}

/** The per-piece edits that live beside the scene rather than in it. */
export type PieceEdits = {
  positions: Record<string, unknown>;
  rotations: Record<string, unknown>;
  dims: Record<string, unknown>;
  hidden: Record<string, boolean>;
};

/** Is there anything for "Start over" to undo? Any edit at all — a piece moved,
 *  turned, resized or hidden, a wall moved or the ceiling changed, or the scene itself
 *  differing from its start: a piece added or deleted, recoloured, restyled or swapped.
 *  Compared by CONTENT, because the saved scene is a fresh array with equal pieces,
 *  never the same one. */
export function hasEditsSinceStart(
  parts: ScenePart[],
  start: ScenePart[],
  edits: PieceEdits,
  room: RoomShape,
  startRoom: RoomShape,
): boolean {
  return hasPieceEdits(edits) || !sameWalls(room, startRoom) || !sameParts(parts, start);
}

/** The room's shell is the one it opened with: the same outline at the same height.
 *  The paint, the site and the "typical size" mark are not compared, because Start
 *  over does not put them back. */
export function sameWalls(a: RoomShape, b: RoomShape): boolean {
  return (
    a.layoutId === b.layoutId &&
    sameValue(a.width, b.width) &&
    sameValue(a.depth, b.depth) &&
    sameValue(a.height, b.height) &&
    sameValue(a.footprint, b.footprint)
  );
}

/** The cheap half: anything in the override maps. Asked first, so a room that has
 *  been edited never pays for building its start. */
export function hasPieceEdits(edits: PieceEdits): boolean {
  return (
    Object.keys(edits.positions).length > 0 ||
    Object.keys(edits.rotations).length > 0 ||
    Object.keys(edits.dims).length > 0 ||
    Object.values(edits.hidden).some(Boolean)
  );
}

/** The scene is its start, piece for piece. */
export function sameParts(parts: ScenePart[], start: ScenePart[]): boolean {
  return sameValue(parts, start);
}

/** Structural equality over plain data. A key holding `undefined` counts as absent,
 *  which is what a saved-and-reloaded record does with it. */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-9;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const bb = b as unknown[];
    return a.length === bb.length && a.every((v, i) => sameValue(v, bb[i]));
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(ao), ...Object.keys(bo)]);
  for (const k of keys) if (!sameValue(ao[k], bo[k])) return false;
  return true;
}

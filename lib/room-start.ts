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
// Built against the room's CURRENT shell, not the one in the record. The walls are
// not part of what this undoes (the size boxes and the wall handles have their own
// way back), and a starter furnished for walls that have since moved puts its pieces
// through the plaster — the defect `buildSceneFromRoom`'s own comment describes.
//
// Pure, so it can be tested without the stores; the store writes are the caller's.

import { buildSceneFromRoom, defaultScene, normalizeStoredParts, type ScenePart } from './scene-spec';
import type { RoomShape } from './scene-store';
import type { RoomData } from './storage';

/** The pieces the room started with, laid out in today's walls. */
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
  // Through the same re-derivation a saved scene gets on the way in, so an untouched
  // room compares equal to its own start rather than differing by a derived flag.
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
 *  turned, resized or hidden, or the scene itself differing from its start: a piece
 *  added or deleted, recoloured, restyled or swapped. Compared by CONTENT, because the
 *  saved scene is a fresh array with equal pieces, never the same one. */
export function hasEditsSinceStart(parts: ScenePart[], start: ScenePart[], edits: PieceEdits): boolean {
  if (
    Object.keys(edits.positions).length > 0 ||
    Object.keys(edits.rotations).length > 0 ||
    Object.keys(edits.dims).length > 0 ||
    Object.values(edits.hidden).some(Boolean)
  )
    return true;
  return !sameValue(parts, start);
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

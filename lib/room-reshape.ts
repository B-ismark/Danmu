// Changing a room's shape on the way to its photos — the one place a shape is changed
// after the room exists.
//
// Why it exists at all: nothing reads a room's outline off its photographs (a square-on
// wall shot is the degenerate case for every method that could — CLAUDE.md rule 2), so
// the outline is the person's answer, and a wrong answer is the most expensive input in
// the app. Every size taken off a photo is measured from the wall `wallFrame` finds in
// that outline; a T read as a rectangle measured its stem wall 2.27× too large. The
// photos screen therefore keeps the shape in view and lets it be changed there, and the
// last step before the scan asks whether the plan looks like the room.
//
// It is pure, so the rule can be tested without IndexedDB; the write is the caller's,
// through `roomStore.editRoom`.

import { presetById, typicalOf, ROOM_PRESETS, type PresetId } from './room-presets';
import { footprintForLayout } from './footprint';
import type { LayoutId, RoomData } from './storage';

type ShapeFacts = {
  layoutId: RoomData['layoutId'] | undefined;
  width: number;
  depth: number;
  footprint?: RoomData['footprint'];
};

/** Is the room's stored outline still its preset's own, at its own size? A STORED
 *  footprint is not evidence of a dragged wall: the studio writes the outline back on
 *  every save of the room shell (painting a wall, choosing a floor), so a room opened
 *  in the studio and never reshaped carries the preset's polygon verbatim. Only a
 *  polygon that differs from it is someone's work. */
export function isPresetOutline(room: ShapeFacts): boolean {
  const fp = room.footprint;
  if (!fp || fp.length === 0) return true;
  if (!ROOM_PRESETS.some((p) => p.id === room.layoutId)) return false;
  const own = footprintForLayout(room.layoutId as LayoutId, room.width, room.depth);
  if (own.length !== fp.length) return false;
  return own.every(([x, z], i) => Math.abs(x - fp[i][0]) < 1e-6 && Math.abs(z - fp[i][1]) < 1e-6);
}

/** Is the room's shape still the picker's answer, so changing it undoes nothing?
 *
 *  Two things make it someone's work rather than a choice: a wall dragged in the studio
 *  (a `footprint` that is not the preset's own — see `isPresetOutline`), and a saved
 *  arrangement (scene or moves), whose pieces were laid out against the old walls. A
 *  SCAN alone is not one: it is measured from the outline, so `reshapeRoom` clears it
 *  and the scan screen looks again, and the dialog says so before the press. Swapping the outline under
 *  either would quietly redraw a room someone shaped by hand, so the photos screen shows
 *  the shape without offering to change it. A shape that is not one of the presets
 *  (`custom`, from a scene file) is not the picker's answer either. */
export function canReshape(room: ShapeFacts, arranged: boolean): boolean {
  if (arranged) return false;
  if (!ROOM_PRESETS.some((p) => p.id === room.layoutId)) return false;
  return isPresetOutline(room);
}

/** The room as the new shape. What moves with the shape and what stays:
 *
 *  · the outline: the new preset's, and no stored footprint (only `canReshape` rooms
 *    reach here, which have none — it is cleared anyway so the result cannot carry one);
 *  · the size: a room still at its shape's TYPICAL size (`roughSize`) takes the new
 *    shape's typical size, because the old one described a different shape. A size the
 *    person typed is theirs — wall to wall at the widest point, which does not depend on
 *    the outline — and is kept;
 *  · the name: a room still called after its old shape's starter ("Living room") takes
 *    the new one's; a name the person chose is kept;
 *  · the scan (`detectedObjects`): cleared. Every position and wall size in it was
 *    measured from the old outline's walls (`wallFrame`), and a scan kept across the
 *    swap would build old-outline geometry inside the new one. The scan screen finds
 *    no scan and looks at the photos again;
 *  · wall paint (`wallColors`): cleared. It is keyed by edge INDEX, and edge 3 of a
 *    rectangle is not edge 3 of an L, so kept paint would land on a different wall;
 *  · everything else, the photos included, is untouched. The four walls a photo can be
 *    filed under are the same four whatever the outline. */
export function reshapeRoom(room: RoomData, to: PresetId): RoomData {
  const next = presetById(to);
  const old = ROOM_PRESETS.find((p) => p.id === room.layoutId);
  const out: RoomData = { ...room, layoutId: to };
  delete out.footprint;
  delete out.detectedObjects;
  delete out.wallColors;
  if (room.roughSize) {
    const size = typicalOf(next);
    out.width = size.width;
    out.depth = size.depth;
    out.height = size.height;
  }
  if (old && room.name === old.starter) out.name = next.starter;
  return out;
}

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
import type { RoomData } from './storage';

/** Is the room's shape still the picker's answer, so changing it undoes nothing?
 *
 *  Two things make it someone's work rather than a choice: a wall dragged in the studio
 *  (`footprint`, which overrides the preset on load), and a saved arrangement (scene or
 *  moves), whose pieces were laid out against the old walls. Swapping the outline under
 *  either would quietly redraw a room someone shaped by hand, so the photos screen shows
 *  the shape without offering to change it. A shape that is not one of the presets
 *  (`custom`, from a scene file) is not the picker's answer either. */
export function canReshape(room: { layoutId: RoomData['layoutId'] | undefined; footprint?: RoomData['footprint'] }, arranged: boolean): boolean {
  if (arranged) return false;
  if (room.footprint && room.footprint.length > 0) return false;
  return ROOM_PRESETS.some((p) => p.id === room.layoutId);
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
 *  · everything else, the photos included, is untouched. The four walls a photo can be
 *    filed under are the same four whatever the outline. */
export function reshapeRoom(room: RoomData, to: PresetId): RoomData {
  const next = presetById(to);
  const old = ROOM_PRESETS.find((p) => p.id === room.layoutId);
  const out: RoomData = { ...room, layoutId: to };
  delete out.footprint;
  if (room.roughSize) {
    const size = typicalOf(next);
    out.width = size.width;
    out.depth = size.depth;
    out.height = size.height;
  }
  if (old && room.name === old.starter) out.name = next.starter;
  return out;
}

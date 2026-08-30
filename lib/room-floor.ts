// How small the room is allowed to get, given what is standing in it.
//
// The user's own framing of the ask: *"the room be reduced moves models along
// until the model width won't allow any further reduction of room width."* So a
// shrink has a stop, and the stop is the widest single piece on the axis being
// squeezed. `docs/what-is-still-open.md` § 22 records the decision that this is
// the WHOLE mechanism — `ROOM_SIDE_M.min` stays at 1 m ("permit corridors")
// rather than being raised to a standard-small-room side, because
// `lib/scene-file.ts` treats an out-of-range width or depth as fatal and raising
// the floor would have made previously-saved small rooms refuse to open.
//
// It lives in its own module rather than in `dimension-ranges.ts` for the reason
// that file states about itself: it is a rule over `ScenePart`s, and
// `dimension-ranges.ts` deliberately knows nothing about parts — `applyRoomEdits`
// takes a plain number per axis so it can stay pure over `RoomDims`.
//
// TWO consumers, which is the whole reason it is a value and not a check written
// where it was first needed: the dims editor (`RoomDimsEditor` → `applyRoomEdits`)
// and every wall move (`lib/wall-actions.ts`, itself the single chokepoint for the
// four wall surfaces). Those are the same two paths that made § 21 — one operation,
// two entry points, one of them carrying its own copy of the rule.

import { footExtentAlong, footFromPart } from './geometry';
import { ROOM_SIDE_M } from './dimension-ranges';
import type { ScenePart } from './scene-spec';

/** Which side of the room's bounding box a stop is about. Deliberately the two
 *  floor axes only: a ceiling is bounded by `ROOM_HEIGHT_M` and nothing standing
 *  on the floor may shorten it — a piece taller than the ceiling keeps its real
 *  height and `lib/clearance.ts` reports it, which is rule 2's "say so, never
 *  silently resize it to fit" and is a different answer from this one. */
export type FloorAxis = 'width' | 'depth';

/** The piece that stops the shrink, and how much room it needs. */
export type FloorStop = {
  /** Metres of that axis the piece needs — its full extent, not a half. */
  metres: number;
  id: string;
  /** For the sentence. The message has to NAME the piece: "the room will not go
   *  narrower" with nothing pointed at is the refusal the user cannot act on. */
  name: string;
};

/**
 * The widest single piece along `axis`, or null for an empty room.
 *
 * EVERY part counts, and the filter that looks like it belongs here does not:
 * `floorBlockers` (`lib/clearance.ts`) drops rugs, wall-hung items and anything
 * under 250 mm tall, because it answers "what gets in a walker's way". This
 * answers "what has to fit inside the shell", and a 3 m rug needs 3 m of floor
 * exactly as a 3 m sofa does. A door needs its width of wall; a ceiling fan needs
 * its diameter. Reusing the walker's filter here would let a shrink cut a rug in
 * half and say nothing.
 *
 * A NECESSARY condition, not a sufficient one. The room's `width` is its
 * footprint's bounding-box width, so a piece needing 2.4 m along x cannot be in a
 * room whose box is narrower — but on an L or a T it can still fail to fit in the
 * bay it is standing in. That remainder is `lib/clearance.ts`'s to report; a stop
 * that tried to answer it would have to know where the shrink is going to leave
 * every piece, which is `lib/wall-move.ts`'s question and not this one.
 *
 * Rotated extent, via `footExtentAlong`, so a piece turned 45° needs the room its
 * corners reach and a ROUND piece needs its diameter rather than its box: those
 * differ by 248.5 mm on a 1200 mm round table, which is a quarter of a metre of
 * room refused for nothing.
 *
 * Hand it RESOLVED parts (`currentRoomScene()`), never `useScene.parts`. A piece
 * the user has resized carries the new size in the `useStudio` override, and
 * measuring the authored `dimMM` is the `settleHeights` scar exactly — the rule
 * answers about a piece nobody can see.
 */
export function furnitureFloor(parts: readonly ScenePart[], axis: FloorAxis): FloorStop | null {
  const dx = axis === 'width' ? 1 : 0;
  const dz = axis === 'width' ? 0 : 1;
  let best: FloorStop | null = null;
  for (const p of parts) {
    const metres = 2 * footExtentAlong(footFromPart(p.pos, p.rot, p.dimMM, p.circle), dx, dz);
    if (!Number.isFinite(metres)) continue;
    if (best === null || metres > best.metres) best = { metres, id: p.id, name: p.name };
  }
  return best;
}

/**
 * The smallest this axis may become: the hard floor, raised by the furniture, and
 * then **never above what the room already is**.
 *
 * That last clamp is the half that is easy to leave out and impossible to see
 * afterwards. A room can already be narrower than the piece standing in it — the
 * piece was resized, or it arrived in a scene file, or it was placed before this
 * rule existed. Without the clamp the floor sits ABOVE the current width, and then
 * two things go wrong at once and both look like a different bug: `NumberField`
 * clamps the value up to its own `min`, so one press of a chevron silently GROWS
 * the room (rule 2 in the other direction — a resize nobody asked for); and a wall
 * drag outward is refused, because the prospective width is still below the floor,
 * so the one gesture that could fix the situation is the one blocked.
 *
 * With the clamp the room is frozen on that axis rather than moved: pushing out is
 * allowed (it only ever increases), pulling in is refused, and the stop relaxes on
 * its own once the room is wider than the piece again.
 *
 * `current` is the room's live side in metres — `footprintBounds(...).width` /
 * `.depth`, or `room.width` / `room.depth`, which `moveWall` keeps in step.
 */
export function roomFloor(stop: FloorStop | null, current: number): number {
  return Math.max(ROOM_SIDE_M.min, Math.min(stop?.metres ?? 0, current));
}

/** Both axes at once, for the two callers that need the pair. Returns the metres
 *  a control or a clamp should use, and the stop that explains it — separately,
 *  because a bound is a number and a message needs a name, and folding them into
 *  one shape led the first version to hand `NumberField` an object. */
export function roomFloors(
  parts: readonly ScenePart[],
  current: { width: number; depth: number },
): Record<FloorAxis, { metres: number; stop: FloorStop | null }> {
  const w = furnitureFloor(parts, 'width');
  const d = furnitureFloor(parts, 'depth');
  return {
    width: { metres: roomFloor(w, current.width), stop: w },
    depth: { metres: roomFloor(d, current.depth), stop: d },
  };
}

/** The sentence. One phrasing, shared by the dims editor and the wall move, so the
 *  two surfaces cannot come to describe the same refusal differently — which is
 *  what `lib/refusal.ts` exists to prevent for the drag surfaces.
 *
 *  `size` is the piece's own extent, already formatted in the user's unit: this
 *  takes a string rather than a `DimUnit`, because `lib/units.ts` formatting is the
 *  caller's business and threading the unit in here would make this module the
 *  second place that decides how a measurement reads.
 *
 *  `fits` is whether the room currently holds the piece at all, and it earns its
 *  place by being the difference between a true sentence and a false one. When a
 *  room is ALREADY narrower than something standing in it, `roomFloor` pins the
 *  floor to the current side rather than to the piece — so a single phrasing built
 *  around the bound would announce that a 4 m sectional "needs 3 m", which is both
 *  wrong and unactionable. Name the piece's real size in both branches and let the
 *  clause differ. */
export function floorRefusal(stop: FloorStop, axis: FloorAxis, size: string, fits: boolean): string {
  const way = axis === 'width' ? 'narrower' : 'shallower';
  return fits
    ? `“${stop.name}” needs ${size} — the room will not go ${way} than that.`
    : `“${stop.name}” is ${size} and already does not fit — the room will not get any ${way}.`;
}

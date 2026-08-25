// What is under this point of the floor plan, and in what order.
//
// The 2D plan is SVG, so it has no equivalent of R3F's depth-sorted
// `e.intersections`. `document.elementsFromPoint` would be the DOM answer, but it
// reports whatever the browser painted last — which is an accident of array
// order — and it needs a `data-part-id` on every shape to map an element back to
// a piece. So the plan asks geometry instead: the same `Foot` the collision maths
// and the renderer already use, which is what makes a round piece test against
// the ellipse INSCRIBED in its box rather than the box (see lib/geometry.ts —
// a circle's bounding square is 27% bigger than the circle and all of it is in
// the corners).
//
// `planPaintOrder` exists so that "what you see on top" and "what a click
// selects" cannot disagree. Before it, the plan painted in store order — i.e.
// insertion order — so a rug added last covered every piece on it, and the
// topmost thing under the cursor was decided by the order the user happened to
// add furniture in. Ordering by descending footprint area is also just what a
// floor plan wants: the rug under the table under the lamp.
//
// Hidden parts are NOT filtered here. Whether a hidden piece can be picked is the
// caller's policy (the plan filters them out, matching the 3D tree), and a
// geometry helper that silently drops candidates is one nobody can reuse.
//
// EVERY function here reads `part.pos` / `part.rot` / `part.dimMM` straight, so the
// parts handed in must already be at their EFFECTIVE transform — `useRoomScene()`
// or `resolveParts`, never `useScene.getState().parts`. A part's authored transform
// and the user's override live in two layers (see CLAUDE.md), and hit-testing the
// authored one is wrong the instant anything has been dragged: the outline gets
// drawn where the piece is and the click lands where it was born. `ResolveInput`
// in lib/drag-resolve.ts spells the same requirement out about the same trap; this
// file was missing the sentence.

import { footFromPart, footOverlap, footArea, pointInFoot, type Foot } from './geometry';
import type { ScenePart } from './scene-spec';

/** A part's plan footprint — rectangle, or the inscribed ellipse if it is round. */
export function footOf(part: ScenePart): Foot {
  return footFromPart(part.pos, part.rot, part.dimMM, part.circle);
}

/**
 * Back-to-front: what to paint first, so the biggest piece ends up underneath.
 * Stable — equal areas keep their original relative order — so the drawing does
 * not reshuffle when two pieces happen to match.
 *
 * Parts at their EFFECTIVE transform, as everywhere in this file.
 */
export function planPaintOrder<T extends ScenePart>(parts: T[]): T[] {
  return parts
    .map((part, i) => ({ part, i, area: footArea(footOf(part)) }))
    .sort((a, b) => b.area - a.area || a.i - b.i)
    .map((r) => r.part);
}

/**
 * The ids under a world point, front-to-back — the exact reverse of what
 * `planPaintOrder` draws, so the first entry is the piece a plain click gets.
 * Empty when the point is over bare floor, which callers must treat as "nothing
 * here" rather than as a click on the room.
 */
export function hitsAt(x: number, z: number, parts: ScenePart[]): string[] {
  const ids: string[] = [];
  for (const part of planPaintOrder(parts)) {
    if (pointInFoot(x, z, footOf(part))) ids.unshift(part.id);
  }
  return ids;
}

/** A marquee, in world coordinates. Either corner may be the start of the drag. */
export type PlanRect = { x0: number; z0: number; x1: number; z1: number };

/**
 * The ids a marquee catches, front-to-back like `hitsAt`.
 *
 * Intersect semantics, not contain: brushing a piece takes it. That is what every
 * 2D tool's default marquee does, and the alternative punishes the common case —
 * a sofa against the wall you cannot fully enclose without dragging outside the
 * room.
 */
export function hitsInRect(rect: PlanRect, parts: ScenePart[]): string[] {
  const box: Foot = {
    cx: (rect.x0 + rect.x1) / 2,
    cz: (rect.z0 + rect.z1) / 2,
    hw: Math.abs(rect.x1 - rect.x0) / 2,
    hd: Math.abs(rect.z1 - rect.z0) / 2,
    rot: 0,
  };
  const ids: string[] = [];
  for (const part of planPaintOrder(parts)) {
    if (footOverlap(box, footOf(part))) ids.unshift(part.id);
  }
  return ids;
}

/** How far apart two presses may be and still count as the same spot, in SCREEN
 *  pixels.
 *
 *  Screen rather than world, which is the correction: Alt-click is a gesture of the
 *  hand, and "did the hand stay put" is a question about pixels. Measured in metres
 *  of floor — as this was — the tolerance becomes a function of the camera. Pulled
 *  back in the 3D tab, 60 mm of floor is a pixel or two, so the cycle restarted on
 *  a twitch and Alt-click could not step past the second piece; pushed in close it
 *  forgave a press half a sofa away. The plan's own press was already recording
 *  client pixels for its click-versus-drag test, so the two halves of one gesture
 *  were being measured in different units.
 *
 *  Deliberately larger than that 4 px slop: every press still close enough to count
 *  as a click must also still count as the same spot, or the cycle resets at exactly
 *  the moment a click registers. */
export const SAME_SPOT_PX = 10;

/** The state one Alt-click cycle carries between presses — where the press was in
 *  client pixels, what it found there, and how deep into the stack we are. Held in
 *  a ref, never in a store: it is the memory of a gesture, and it must not survive
 *  a scene edit. */
export type CycleState = { sx: number; sy: number; ids: string[]; index: number };

/**
 * Where the next Alt-click should land, given the last one.
 *
 * Two coordinate spaces, and they are not interchangeable: `world` is the point on
 * the floor, which decides WHICH pieces are candidates; `screen` is where the
 * pointer was in client pixels, which decides whether this is the same press
 * repeated. See `SAME_SPOT_PX`.
 *
 * Returns the id to select plus the cycle state to remember. The candidate list has
 * to be re-derived every press — a piece may have been deleted, hidden, moved or
 * undone since the last one — so the previous cycle is honoured only while its id
 * sequence still matches. Otherwise this is a fresh press, which is the safe
 * reading.
 */
export function nextInCycle(
  world: { x: number; z: number },
  screen: { x: number; y: number },
  parts: ScenePart[],
  prev: CycleState | null,
) {
  return cycleThrough(screen.x, screen.y, hitsAt(world.x, world.z, parts), prev);
}

/**
 * The same step, over candidates somebody else found — the 3D tab's, which come
 * from the depth-sorted raycast it already performs rather than from a footprint
 * test. Shared so both surfaces cycle by identical rules; a picker that wrapped
 * in one view and dead-ended in the other would be two features.
 */
export function cycleThrough(
  /** The press, in CLIENT PIXELS — not world units. See `SAME_SPOT_PX`. */
  sx: number,
  sy: number,
  candidates: string[],
  prev: CycleState | null,
): { id: string | null; state: CycleState | null; candidates: string[]; fresh: boolean } {
  if (candidates.length === 0) return { id: null, state: null, candidates, fresh: true };

  const sameSpot =
    !!prev && Math.hypot(prev.sx - sx, prev.sy - sy) <= SAME_SPOT_PX && sameSequence(prev.ids, candidates);
  // Wrapping rather than stopping at the end is what makes this read as cycling
  // and not as a dead end.
  const index = sameSpot ? (prev.index + 1) % candidates.length : 0;
  // `fresh` is what tells a caller this is a NEW question rather than the next
  // step of one already being asked — which is how the menu knows to open on the
  // first press and stay out of the way afterwards. Inferring it from `index === 0`
  // would also fire on the wrap-around, reopening the menu mid-cycle.
  return { id: candidates[index], state: { sx, sy, ids: candidates, index }, candidates, fresh: !sameSpot };
}

function sameSequence(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

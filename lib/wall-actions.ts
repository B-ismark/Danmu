'use client';

// The one way to move a wall.
//
// Four places move walls — the 3D handle (`components/three/WallHandles.tsx`), the
// plan's handle and its arrow-key nudge (`components/studio/PlanView.tsx`) and the
// inspector's ±10 cm buttons — and each used to call `useScene.moveWall` straight,
// which moved the polygon and nothing else. Teaching four call sites to carry the
// furniture standing on the wall is exactly how `layout-rules.ts` came to exist:
// consumers with private copies of the same rule drift. So they all call this.
//
// It lives outside both stores because it spans them. The wall is `useScene`
// (structure); a piece's position is a `useStudio` override
// (`positions[id] ?? part.pos`, resolved by `lib/room-scene.ts`), and the override
// is the layer that WINS. Writing `part.pos` in the scene store would be silently
// discarded for every piece the user has ever dragged, so the carry writes
// overrides — the same channel a drag or the gizmo writes, already persisted per
// room and already in the undo stack.
//
// Undo is one entry for the whole gesture: `lib/history.ts` snapshots both stores
// behind a 250 ms debounce, so the wall and everything it carried undo together.

import { useSettings, useStudio } from './store';
import { currentRoomScene } from './room-scene';
import { attachedToWall, carryAttached } from './wall-move';
import { footprintBounds, offsetWall, wallOutwardNormal } from './footprint';
import { useScene } from './scene-store';
import { announce } from './announce';
import { ROOM_SIDE_EPS, ROOM_SIDE_M } from './dimension-ranges';
import { floorRefusal, furnitureFloor, roomFloor, type FloorAxis } from './room-floor';
import { formatDim } from './units';
import type { ScenePart } from './scene-spec';

/**
 * Ids of everything wall `index` will take with it.
 *
 * Call this ONCE when a drag starts and hand the result to every
 * `moveWallCarrying` of that gesture. Re-resolving attachment per frame lets a
 * piece sitting near the tolerance detach halfway through a drag and never
 * rejoin — the wall visibly walks away from its own sofa.
 */
export function wallAttachments(index: number): string[] {
  // A new gesture gets to hear the refusal again, however recently the last one
  // said the same thing. Without this a user who backs off a stopped wall, lets go
  // and pushes into it a second time is refused in silence.
  said = null;
  return attachedToWall(currentRoomScene(), useScene.getState().room.footprint, index);
}

// ─── The refusal ────────────────────────────────────────────────────────────
//
// Every one of the four wall surfaces used to be refused in SILENCE, and the
// arrow-key nudge was worse than silent: `PlanView.onWallKeyDown` announced
// "moved in. Room is now 3.0 by 2.4" unconditionally, on a press that had moved
// nothing. `moveWallCarrying` already returned the applied delta for exactly this
// and **not one of its four call sites read it** — the repo's own "a finding the
// caller drops is a finding that does not exist", in the file whose whole purpose
// is to stop four callers each carrying their own copy of a rule.
//
// So the sentence is said HERE, once, rather than handed back four times. That is
// only possible because `announce` is `lib/announce.ts` now; it used to sit in a
// component, and a rule in `lib/` reaching for it would have inverted the one
// import direction this codebase keeps.

/** The last thing said, so a drag that is refused for eighty consecutive frames
 *  says it once. `announce` deliberately re-speaks identical text (its live region
 *  needs a content change to fire at all), so the de-duplication has to be here —
 *  the same shape as `PlanView`'s `announcedRef`, hoisted to the chokepoint the
 *  four surfaces already share. Reset by `wallAttachments` and by any move that
 *  is taken. */
let said: string | null = null;

function say(message: string): void {
  if (message === said) return;
  said = message;
  announce(message);
}

/** Why this wall move cannot be taken, or null. Reads the prospective bounds
 *  rather than the applied ones, so it can name the reason before the store gets a
 *  chance to refuse the same move without one. */
function wallRefusal(
  next: { width: number; depth: number },
  current: { width: number; depth: number },
  parts: ScenePart[],
): string | null {
  const unit = useSettings.getState().dimUnit;
  const size = (metres: number) => `${formatDim(metres * 1000, unit)} ${unit}`;
  for (const axis of ['width', 'depth'] as FloorAxis[]) {
    if (next[axis] > ROOM_SIDE_M.max + ROOM_SIDE_EPS)
      return `The room will not go ${axis === 'width' ? 'wider' : 'deeper'} than ${size(ROOM_SIDE_M.max)}.`;
    const stop = furnitureFloor(parts, axis);
    if (next[axis] >= roomFloor(stop, current[axis]) - ROOM_SIDE_EPS) continue;
    // Same ordering rule as `applyRoomEdits`: name the piece while the piece is
    // what is binding, and fall back to the static range when it is not — below
    // the hard floor there is no piece to point at, and a refusal pointing at
    // nothing is the one the user cannot act on.
    // `+ ROOM_SIDE_EPS` on the fits test as well, and it is the same reason as the
    // comparison above rather than a second tolerance: a wall walked exactly onto
    // its stop sits at 2.3999999999999995, so a bare `<=` reports a 2.4 m piece as
    // not fitting a 2.4 m room and flips the sentence to "already does not fit" at
    // the one value the user is most likely to be standing on. Seen in a browser
    // immediately after the first tolerance was added — the fix moved the defect
    // from the geometry into the wording.
    if (stop && stop.metres > ROOM_SIDE_M.min)
      return floorRefusal(stop, axis, size(stop.metres), stop.metres <= current[axis] + ROOM_SIDE_EPS);
    return `The room will not go ${axis === 'width' ? 'narrower' : 'shallower'} than ${size(ROOM_SIDE_M.min)}.`;
  }
  return null;
}

/**
 * Move wall `index` by `delta` metres along its outward normal and carry what is
 * attached to it. Returns the delta actually applied — **0 when it was refused**,
 * which a caller that says anything about the move afterwards has to read: the
 * plan's arrow-key nudge announced a move it had not made for as long as this
 * return value went unread by all four of them.
 *
 * A refusal speaks for itself here (see `wallRefusal`), so a caller has nothing to
 * report and only needs to avoid contradicting it.
 *
 * Pass `ids` from `wallAttachments` during a drag; omit it for a one-shot nudge
 * (arrow key, inspector button), where resolving attachment fresh is correct.
 */
export function moveWallCarrying(index: number, delta: number, ids?: string[]): number {
  const before = useScene.getState().room.footprint;
  const resolved = currentRoomScene();
  const attached = ids ?? attachedToWall(resolved, before, index);
  // Judged on the prospective polygon, BEFORE the store is asked. `moveWall` runs
  // the same `offsetWall` and applies the same hard bounds, and it returns 0 for
  // every reason without distinguishing them — so asking first is what lets the
  // refusal name the piece. The duplicated `offsetWall` is a few vertices; the
  // duplicated THRESHOLD would be the drift, and there is none: both ends of the
  // static range are `ROOM_SIDE_M` and the furniture end is `lib/room-floor.ts`,
  // read here and by `RoomDimsEditor` and by nothing else.
  const refusal = wallRefusal(footprintBounds(offsetWall(before, index, delta)), footprintBounds(before), resolved);
  if (refusal !== null) {
    say(refusal);
    return 0;
  }
  // Read before the move: the moved edge translates along this normal and keeps its
  // direction, so one reading holds for the whole gesture — but the polygon object
  // does not, so take it from `before`.
  const outward = wallOutwardNormal(before, index);
  const applied = useScene.getState().moveWall(index, delta);
  // Clamped anyway. `wallRefusal` covers every bound `moveWall` enforces, so this
  // is unreachable today and is kept as the honest handling of a store that
  // enforces its own rules: the wall did not move, so nothing on it may move
  // either. Not silent — a refusal nobody can hear is what this whole section
  // exists to end.
  if (applied === 0) {
    say('That wall will not move any further.');
    return 0;
  }
  said = null;
  if (attached.length === 0) return applied;
  const after = useScene.getState().room.footprint;
  const moves = carryAttached(attached, currentRoomScene(), before, after, outward, applied);
  useStudio.getState().setTransformsFor(moves);
  return applied;
}

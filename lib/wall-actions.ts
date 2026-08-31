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
import { floorRefusal, furnitureFloor, namesTheStop, roomFloor, type FloorAxis } from './room-floor';
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

/** How long the same refusal about the same wall stays stale, in ms. Long enough
 *  to cover a drag held against a stop; short enough that a deliberate second
 *  press is heard. */
const REPEAT_MS = 1000;

/** The last refusal spoken, keyed by WALL and by text, with the time it was said.
 *
 *  `announce` deliberately re-speaks identical text — its live region needs a
 *  content change to fire at all — so the de-duplication has to live here. Three
 *  things about the key are load-bearing, and the first version got all three
 *  wrong in a way no test caught:
 *
 *  · **Keyed by wall index.** The sentence names the piece and the axis and NOT
 *    the wall, so two walls on the same axis produce byte-identical text. Refuse
 *    the west wall with an arrow key, then focus the east wall and refuse that:
 *    the second was swallowed, and a screen-reader user could not tell whether it
 *    had moved.
 *  · **Rate-limited rather than cleared on an accepted move.** Clearing on
 *    acceptance is what made a later refusal news again, and it also made a wall
 *    held against its stop spam the reader: the floor is `min(stop, current)`, so
 *    an OUTWARD frame is always accepted, and a hand that is not perfectly still
 *    reverses direction every few frames — accept, clear, refuse, speak, tens of
 *    times a second. The clock does both jobs at once.
 *  · **Still reset by `wallAttachments`**, so a new drag is heard immediately
 *    rather than waiting out the second. That covers the two drag surfaces; the
 *    arrow key and the Inspector's buttons never call it, which is exactly why
 *    the key and the clock have to carry the rest. */
let said: { key: string; at: number } | null = null;

function say(index: number, cur: { width: number; depth: number }, message: string): void {
  // The ROOM's own size is in the key, alongside the wall and the text. A refusal
  // is only stale while nothing about it has changed, and a room that has resized
  // between two identical sentences is a different refusal — so this is the
  // "cleared on an accepted move" rule expressed as part of the key rather than as
  // a separate reset, which is what stops the clock from swallowing a genuine
  // second refusal.
  //
  // It also closes a leak the clock alone had: this is module state, so two
  // different ROOMS with a same-named piece on the same wall index produced the
  // same key. Opening room B within a second of refusing room A silently ate B's
  // refusal. The unit suite found it first — every test in it runs inside one
  // millisecond, so the first refusal muted the next six.
  const key = `${index}|${cur.width.toFixed(3)}x${cur.depth.toFixed(3)}|${message}`;
  const now = Date.now();
  if (said && said.key === key && now - said.at < REPEAT_MS) return;
  said = { key, at: now };
  announce(message);
}

/**
 * The largest part of `delta` that keeps both sides in range — `delta` itself when
 * the whole move fits, a smaller step in the same direction when it runs into a
 * bound, and 0 when there is nowhere to go.
 *
 * A wall STOPS at its limit; it does not refuse to move. The first version rejected
 * the whole frame, and that is wrong for a gesture rather than merely strict,
 * because both drag surfaces feed this a raw per-frame pointer delta:
 * `svgToWorldAt` divides by `zoom`, so at the plan's minimum 0.4 one frame of a
 * brisk drag is ~250 mm of floor. From 2.61 m the next frame asks for 2.36, is
 * refused whole, and the wall sticks at 2.61 under a message promising 2.40 —
 * while `prevTotal` advances on the refused frame, so the wall never catches the
 * pointer again for the rest of the gesture. A flick left it a metre short. The
 * smallest room the drag could reach was a function of pointer speed and zoom.
 *
 * It also lands the wall exactly ON the bound instead of a float hair under it,
 * which is what `lib/scene-file.ts` needs: a room walked to its 1 m floor by
 * repeated addition stores 0.99999999999999844, and that width is fatal on import.
 *
 * Linear in `delta`, which is exact here: `offsetWall` translates one edge along a
 * fixed normal, so each side of the bounding box moves at a constant rate per unit
 * of delta. The rate is measured from the probe rather than assumed, so it needs no
 * knowledge of which wall faces which axis — and a wall that changes neither side
 * (rate 0) is simply never the binding one.
 */
function permittedDelta(
  delta: number,
  cur: { width: number; depth: number },
  next: { width: number; depth: number },
  limits: Record<FloorAxis, { min: number; max: number }>,
): number {
  if (delta === 0) return 0;
  let allowed = delta;
  for (const axis of ['width', 'depth'] as FloorAxis[]) {
    const rate = (next[axis] - cur[axis]) / delta;
    if (Math.abs(rate) < 1e-12) continue;
    const bound =
      next[axis] < limits[axis].min - ROOM_SIDE_EPS
        ? limits[axis].min
        : next[axis] > limits[axis].max + ROOM_SIDE_EPS
          ? limits[axis].max
          : null;
    if (bound === null) continue;
    const room = (bound - cur[axis]) / rate;
    // `room` is in delta's own units and carries ITS sign, so the test is on the
    // sign AGREEING, not on being positive — an inward step is negative, and an
    // earlier `room <= 0` guard swallowed every one of them, permitting nothing on
    // the half of the gesture this whole feature is about.
    //
    // The magnitude tolerance is the half that fires: a wall sitting exactly ON its
    // bound computes float dust rather than zero, and 1.55e-15 m of permitted
    // travel is not a move — returning it lets a caller believe a step was taken.
    //
    // **The sign half is unreachable today and is kept deliberately**, which is the
    // `layout-shuffle` treatment of a mutation no test kills rather than a claim
    // that one does. Reaching it needs `room` to point away from `delta`, i.e. a
    // side already past the bound it is being tested against — and it cannot be:
    // the low bound comes from `roomFloor`, which clamps to the current side, so
    // `min <= cur` by construction, and the high bound is `ROOM_SIDE_M.max`, which
    // `moveWall` has never let a side exceed. Both invariants live in other files
    // and neither is enforced here, so the guard is what stops a change to either
    // from turning into a wall that walks the wrong way.
    if (room * delta <= 0 || Math.abs(room) <= ROOM_SIDE_EPS) return 0;
    if (Math.abs(room) < Math.abs(allowed)) allowed = room;
  }
  return allowed;
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
    // Which rule to name is `namesTheStop`'s answer, not a comparison written out
    // here. It WAS written out here, against a DIFFERENT operand from the one
    // `applyRoomEdits` used — raw `stop.metres` against the hard floor, where the
    // editor compared the clamped floor. `roomFloor` is `max(min, min(stop,
    // current))`, so the two agree only while the room is wider than 1 m: in a 1 m
    // room holding a 2.4 m sectional the wall named the sectional and the dims
    // field named the static range. One rule, one refusal, two surfaces giving two
    // different causes — which is the drift this file exists to prevent, committed
    // inside the file itself.
    if (namesTheStop(stop, current[axis])) return floorRefusal(stop, axis, current[axis], unit);
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
  const cur = footprintBounds(before);
  const asked = footprintBounds(offsetWall(before, index, delta));
  const refusal = wallRefusal(asked, cur, resolved);
  if (refusal !== null) {
    say(index, cur, refusal);
    // Say it AND take as much of the step as fits. The two are not alternatives:
    // the wall stops at the stop, and the sentence explains why it stopped there.
    const limits = {
      width: { min: roomFloor(furnitureFloor(resolved, 'width'), cur.width), max: ROOM_SIDE_M.max },
      depth: { min: roomFloor(furnitureFloor(resolved, 'depth'), cur.depth), max: ROOM_SIDE_M.max },
    };
    delta = permittedDelta(delta, cur, asked, limits);
    if (delta === 0) return 0;
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
    say(index, cur, 'That wall will not move any further.');
    return 0;
  }
  if (attached.length === 0) return applied;
  const after = useScene.getState().room.footprint;
  const moves = carryAttached(attached, currentRoomScene(), before, after, outward, applied);
  useStudio.getState().setTransformsFor(moves);
  return applied;
}

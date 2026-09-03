// What a finished gesture still has to SAY.
//
// A drag, a turn and a scale can all end somewhere the piece does not fit, and in
// every one of those cases the placement is TAKEN anyway. That is deliberate and
// `PlanView`'s turn states the reason in its own comment: refusing an invalid frame
// would make a piece in a tight corner unturnable, which no report has ever asked
// for. So the only thing separating "the app constrained it" from "the app let the
// couch cut through the wall" is whether anything says so, and for how long.
//
// It used to be nothing, on one of the two surfaces. `Draggable.commit()` ended with
// `setDragInvalid(false)` and `setLive(null)` on every path, so 3D computed the
// refusal and cleared it on the same tick, while the plan held a red outline. Reported
// by the user as a couch cutting through the walls instead of being constrained —
// which is what it looks like when the geometry is right and the tell is missing.
//
// This file exists so the rule is a value rather than a shape repeated in two
// components, and so it can be tested at all: the decision used to live inside an R3F
// component, where reaching it means a WebGL context. Same reason `lib/drag-click.ts`
// is not in `store.ts`.

/** Every piece to outline, and the one to name. */
export type Refusal = {
  /** Pieces to draw refused. The dragged piece is always first and always present —
   *  it is the one outline guaranteed to be on screen, and a refusal with nothing
   *  visible reads as the gesture being broken. */
  ids: string[];
  /** The member that ran out of room, when the piece under the hand is not itself the
   *  problem. Undefined when it is: "blocked" is the honest word then, and naming a
   *  member would point at the wrong piece. */
  by?: string;
};

/** How long a refusal stays up after the gesture that caused it has ended, in ms.
 *
 *  Shared between the two surfaces on purpose. `PlanView` fades its outline over this
 *  and `Draggable` holds the live channel for it; two tabs disagreeing about how long
 *  a refusal is visible is the next version of one of them not showing it at all. */
export const REFUSAL_HOLD_MS = 500;

/** Null when the gesture ended somewhere legal — which is the common case and the
 *  only one where a caller may clear what it was showing.
 *
 *  Both flags are required rather than defaulted, because the two failures are
 *  different and a caller that knows about only one of them is the bug this replaces:
 *  `placementValid` is the piece under the hand, `convoyValid` is whether its company
 *  could follow. */
export function refusalAfterGesture(input: {
  draggedId: string;
  /** `Resolved.valid` for the dragged piece, AFTER any invalid-drop fallback — the
   *  fallback is where a rotate or a scale ends up, and it is not always legal: it
   *  rests the piece where it already stands, and for those two gestures the only
   *  thing that changed is the extent being tested against the walls. */
  placementValid: boolean;
  /** `ConvoyResult.valid`. */
  convoyValid: boolean;
  /** `ConvoyResult.blockedIds` — members that could not follow. */
  blockedIds?: readonly string[];
  /** `ConvoyResult.blocked?.name`. */
  blockedByName?: string;
}): Refusal | null {
  const { draggedId, placementValid, convoyValid, blockedIds = [], blockedByName } = input;
  if (placementValid && convoyValid) return null;
  // Deduplicated, and the dragged piece is pinned to the front rather than merely
  // included: `blockedIds` may or may not already hold it depending on which of the
  // two checks failed, and an outline set whose order depends on that is an outline
  // set that reorders under the user for no reason.
  const ids = [draggedId, ...blockedIds.filter((id) => id !== draggedId)];
  return { ids, by: placementValid ? blockedByName : undefined };
}

/** Below this, in metres, the difference is float noise from the resolve rather than
 *  a nudge anybody could see. One millimetre — the finest translate snap in the app
 *  is ten. */
export const TURN_NUDGE_EPS = 0.001;

/**
 * How far a TURN slid the piece, in metres across the floor. Zero for a turn that
 * happened where it stood.
 *
 * **This exists because `valid` cannot answer it, and § B.14 turns on the
 * difference.** `resolvePlacement` computes `valid = inRoom && !collides` against the
 * position it has already CLAMPED, so a turn whose new footprint would have crossed a
 * wall — and which the clamp then pulled back inside — comes back perfectly valid,
 * with nothing anywhere saying the piece moved. For a drag that is right: the pointer
 * chose a spot, the clamp is visible, and `shovedIntoRoom` covers the case that is
 * not. For a turn it is the thing this app must never do. The user asked for an
 * ANGLE. The position was not part of the request, and moving it silently to make the
 * action succeed is rule 2's "say so, never silently resize it to fit" with the size
 * left alone — which is, word for word, what `spinSelection`'s docblock claimed the
 * app already did while `spinSelection` was the one turn path with no clamp at all.
 *
 * The move is still TAKEN. Refusing it would make a piece in a tight corner
 * unturnable, which no report has asked for (§ B.14, decided 2026-09-03: keep and
 * report). So this is not a veto, it is the sentence.
 *
 * **Only the y-less plane.** A turn can legitimately change `y` — a wall rider
 * re-aimed by the wall it lands on — and that is the wall's answer rather than a
 * nudge.
 */
export function turnNudge(
  from: readonly [number, number, number],
  to: readonly [number, number, number],
): number {
  const d = Math.hypot(to[0] - from[0], to[2] - from[2]);
  return d > TURN_NUDGE_EPS ? d : 0;
}

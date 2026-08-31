'use client';

// A press the gizmo takes is not a press on furniture — and the furniture finds
// out second.
//
// Reported as: *"I selected bed to rotate but the rotate control overlaps the
// nightstand and it ended up moving the nightstand."*
//
// The gizmo is not doing anything wrong. It rotates the piece it is attached to,
// and there is nothing for it to hit-test. What goes wrong is that the SAME press
// is delivered twice, because R3F cannot see the gizmo at all:
//
//   · R3F raycasts `internal.interaction` — the objects that carry event handlers.
//     drei's `<TransformControls>` is a `<primitive>` with none, so the ring, the
//     arrows and the planes are transparent to picking. A press aimed at a handle
//     goes straight through to whatever furniture sits behind it, and that piece
//     starts a direct drag of its own.
//   · `Draggable.onPointerDown` already has three guards that would refuse such a
//     press — `gizmoActive`, `_gestureOwner`, `gestureOwnedByOther` — and every
//     one of them reads state the gizmo sets in its `mouseDown`, which has not
//     happened yet. Both listen on the same element (drei passes R3F's
//     `events.connected` as the controls' `domElement`), R3F registered it at
//     Canvas mount and the controls when the piece was selected, so R3F's dispatch
//     is always first. **Ordering, not logic, is what was missing.**
//
// So the claim is UNDONE rather than pre-empted. Nothing the press set up has
// moved anything yet — `drag.current`, the pointer capture, `draggingId` — so
// handing it back in the gizmo's own `mouseDown`, which arrives microseconds
// later in the same DOM dispatch, is enough.
//
// **Asking the gizmo beats hit-testing for it.** The alternative was a
// capture-phase listener that re-ran the gizmo's hover test at the press point
// and refused the press up front. It would work, and it is worse: it reads
// `axis`, `dragging`, `enabled` and `pointerHover`, all of which three-stdlib
// declares `private`, so it is a cast today and a silent no-op the day any of
// them is renamed. `onMouseDown` is drei's own documented prop, it fires only
// when `pointerDown` found an axis, and `onPointerDown` re-runs `pointerHover` at
// the press point first — which is what makes the answer right for a FINGER too,
// where there is no previous hover to read. Two surfaces cannot disagree about
// which presses the gizmo took when only one of them decides.
//
// This module is the state, and it is deliberately not in `useStudio`: written
// and consumed inside one event-loop turn, nothing renders from it, and a store
// write between a pointerup and the click it produces would re-run every
// selector. It is also what lets `tests/gizmo-press.test.ts` be a plain node test
// — importing `lib/store.ts` drags in zustand's `persist` and needs localStorage.
// Same reasoning, same shape and the same scars as `lib/drag-click.ts`, which is
// its sibling: read that one too before changing this.

/** Undoes everything a press set up on one piece. */
type Release = () => void;

/** The direct drag that has taken the press in flight, if any. At most one — a
 *  second finger is refused by `Draggable`'s own `_gestureOwner` gate long before
 *  it gets here.
 *
 *  **The window this is open for is the press, NOT the gesture, and that is the
 *  whole of its safety.** The claim below is lossless only because nothing has
 *  happened yet; a hold left standing into a live drag is a teardown waiting to be
 *  run on a gesture somebody is in the middle of. It is reachable on touch, where
 *  two pointers exist at once: press a drawer unit, dwell past 280 ms so it picks
 *  up, start sliding it, then put a second finger on the gizmo ring of the piece
 *  that is still SELECTED. `Draggable` refuses the second press at
 *  `_gestureOwner`, so it installs no hold of its own — and three-stdlib's
 *  `TransformControls` has no multi-pointer guard, finds an axis and dispatches
 *  `mouseDown`, which would take the FIRST finger's press back: the drawer stops
 *  following, `commit()` never runs for it, and 3D keeps drawing it where the drag
 *  left it while the store, the plan and any saved file hold the old position.
 *
 *  So `Draggable` gives the hold back the moment the press turns into something —
 *  the touch pick-up, and both places `started` is set. Three extra
 *  `releasePress` calls, and they are not tidiness. */
let holder: { id: string; release: Release } | null = null;

/** Armed for the click that ends a gizmo gesture. */
let pendingClick = false;

/** A direct drag has taken the press in flight. `release` gives it back.
 *
 *  **A replacement DROPS the previous hold's `release` without running it, and that
 *  is the decision rather than an omission.** Reaching here with one already
 *  standing means a press began while another had not ended, which `Draggable`'s
 *  own `_gestureOwner` and `gestureOwnedByOther` gates already refuse — so a
 *  survivor is a piece whose gesture is over by every other measure. Running its
 *  teardown now would release a pointer capture, clear `_gestureOwner` and call
 *  `setDragging(null)` in the middle of the press that has just begun on ANOTHER
 *  piece: the tidy-looking version of this line is the more damaging one.
 *  Pinned, because "tidy up the stale hold first" survived a twelve-mutation sweep
 *  with every test green. */
export function holdPress(id: string, release: Release): void {
  holder = { id, release };
}

/** The press ended, was given up, or turned into a gesture of its own.
 *
 *  **`pointercancel` is a fourth ending and reaches none of the callers**, because
 *  R3F never dispatches `onPointerCancel` to an instance (the long note in
 *  `Draggable.tsx` has the dist reference). So a cancelled touch — the browser
 *  claiming the gesture, an Android long-press menu, an app switch — can leave a
 *  hold standing, and the next gizmo press runs a dead press's teardown. Every
 *  statement in it is idempotent on a press that is already over, which is why
 *  this is a residue rather than a defect: clearing a null timer, nulling a null
 *  `drag.current`, an id-guarded `_gestureOwner`, a `detachTouch` over an empty
 *  map, a `releasePointerCapture` inside a `try`, and a `setDragging` guarded on
 *  the id. It writes no cursor, deliberately — that one was NOT idempotent, and it
 *  is the reason this paragraph is worth keeping rather than deleting.
 *
 *  **Only the holder may let go.** Without the id test, any piece finishing any
 *  gesture would drop a hold belonging to another one, and the gizmo would then
 *  find nothing to take the press back from — which is the whole defect again,
 *  reachable from a second pointer. */
export function releasePress(id: string): void {
  if (holder?.id === id) holder = null;
}

/** The gizmo has taken the press R3F already handed to a piece of furniture.
 *  Hands it back and arms the click gate. Returns the id it took it from, or
 *  `null` when the press landed on no furniture at all.
 *
 *  **The gate is armed in both cases, and the `null` case is the one that is easy
 *  to miss.** A ring passing over bare floor, or over the selected piece's own
 *  body, still ends in a DOM click; landing on the piece itself that click is not
 *  harmless, because a plain click is `selectionForPick` — so rotating the
 *  primary of a merged group would drill INTO it and leave the user turning one
 *  drawer unit instead of the bed they had.
 *
 *  The holder is cleared BEFORE `release` runs, and the two orders agree on every
 *  input that does not throw — `holder = null` happens either way — which is
 *  exactly why the swap is easy to make and hard to notice. They stop agreeing
 *  when the teardown throws: cleared after, the hold is left standing and the next
 *  gesture tears the same piece down a second time. Pinned in
 *  `tests/gizmo-press.test.ts`, and that is the only thing pinning it. */
export function claimPressForGizmo(): string | null {
  const had = holder;
  holder = null;
  pendingClick = true;
  had?.release();
  return had?.id ?? null;
}

/** True for the click that ends a gizmo gesture — whichever mesh it lands on,
 *  once. No part id, for exactly the reason `lib/drag-click.ts` sets out at
 *  length: the click a gesture produces does not always land on the piece the
 *  gesture belonged to, and asking whose flag it is lets a click on a DIFFERENT
 *  mesh eat it and select itself.
 *
 *  **Three consumers, because a ring sweeps over three kinds of thing.**
 *  `Pickable.onClick` for furniture, `RoomShell`'s wall mesh, and `Room`'s
 *  `onPointerMissed` for bare floor. Furniture alone leaves the gate armed with
 *  nothing to consume it whenever a rotate finishes over plaster or air, and an
 *  armed gate outlives its gesture: the next press that would clear it can be one
 *  that never reaches `Draggable` at all — `WallHandles` stops propagation on its
 *  own knob — so the gate goes on to eat an ordinary selection one gesture later.
 *  Each of the three is also right on its own terms: a gesture is not a click on
 *  whatever it happened to finish over, so a rotate must not select a wall or
 *  clear the selection either. */
export function consumeGizmoClick(): boolean {
  const had = pendingClick;
  pendingClick = false;
  return had;
}

/** Drop a gate no click came for — called when the next press begins.
 *
 *  A gesture released off-mesh produces no click, and a gate left standing would
 *  swallow the next real one. Nothing can slip through the gap: every click on a
 *  piece is preceded by a press on it, and the press clears this. */
export function clearGizmoClick(): void {
  pendingClick = false;
}

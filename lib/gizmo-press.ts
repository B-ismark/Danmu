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
 *  it gets here. */
let holder: { id: string; release: Release } | null = null;

/** Armed for the click that ends a gizmo gesture. */
let pendingClick = false;

/** A direct drag has taken the press in flight. `release` gives it back. */
export function holdPress(id: string, release: Release): void {
  holder = { id, release };
}

/** The press ended, or was given up, the ordinary way.
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
 *  The holder is cleared BEFORE `release` runs. Every real teardown ends by
 *  calling `releasePress` itself, so in the ordinary case the two orders agree —
 *  which is exactly why this is easy to swap and hard to notice. They stop
 *  agreeing when a teardown does not reach that line: released after, a throw
 *  leaves the hold standing and the next gesture tears the same piece down a
 *  second time. Pinned in `tests/gizmo-press.test.ts`. */
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
 *  mesh eat it and select itself. */
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

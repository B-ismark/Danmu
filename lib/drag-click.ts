'use client';

// The click a drag ends with.
//
// A 3D drag that moved finishes as a DOM click, and `Pickable`'s click handler
// means "select just this piece". Together those two silently undid every
// multi-piece drag in the 3D tab: the set moved, and then the click ending the
// gesture collapsed the selection down to one piece. Harmless for a single
// selection (it was already selected) and hidden for a MERGED group, whose plain
// click re-selects the whole group — which is why the symptom read as "sometimes
// only one moves" rather than as a plain bug.
//
// **The gate has no part id, and that absence is the fix.** The first version
// recorded which piece was dragged, asked the arriving click "are you that
// piece?", and cleared the flag either way — so a click that raycast onto a
// DIFFERENT piece consumed the flag, got `false`, and selected itself: the same
// collapse through another mesh. It is not hypothetical. The dragged piece does
// follow the pointer, but a rug dragged under a table ends up BEHIND it and the
// ray hits the table; `Pickable`'s own `gestureOwnedByOther` guard cannot help,
// because `Draggable` has already released the pointer capture and cleared
// `draggingId` by the time the click is dispatched. A drag is not a click on
// anything, so there is nothing to compare and no id to hold. Storing one that
// nothing branches on would be dead plumbing wearing a decision's name.
//
// Its own module rather than a field on `useStudio`: it is written and consumed
// inside one event-loop turn, nothing renders from it, and a store write here
// would re-run every selector between the pointerup and the click. Living
// outside the store is also what lets `tests/drag-click.test.ts` be a plain node
// test — importing `lib/store.ts` drags in zustand's `persist` and needs
// localStorage, so a gate parked there could only be tested under jsdom.

let pending = false;

/** Called on pointer-up by a 3D drag that actually moved. */
export function suppressClickAfterDrag() {
  pending = true;
}

/** True for the click that ends that drag — whichever mesh it lands on, once.
 *
 *  Cleared whether or not a click ever arrives, because a gesture released
 *  off-mesh produces none and a flag left standing would swallow the next real
 *  click. Nothing can slip through in the gap: every click on a piece is
 *  preceded by a press on it, and the press calls `clearDragClick`. */
export function consumeDragClick(): boolean {
  const had = pending;
  pending = false;
  return had;
}

/** Drop a flag no click came for — called when the next press begins. */
export function clearDragClick() {
  pending = false;
}

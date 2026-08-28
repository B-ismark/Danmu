// Undo / redo for the detect screen's review, and nothing else.
//
// That review is the one place in this app where a user's work lives entirely in
// component state: `detections` and `confirmed` are `useState` until `finish()` writes
// them, which is deliberate (a review is not a room yet, which is also why the detect
// screen's mark deliberately has no href). The cost was that a mistyped rename or a
// mis-tapped delete had no way back, and renaming is exactly where a slip happens —
// reported in those words.
//
// `lib/history.ts` cannot serve this. It is the studio's zustand history: it snapshots
// `useStudio` on a debounce, it is gated on `draggingId`, and it knows about positions
// and rotations. None of that exists here.
//
// **Why a snapshot rather than a diff.** `deleteDetection` re-indexes `confirmed` by
// hand, because `confirmed` is a Set of array INDICES and removing row 2 has to shift
// every confirmation above it down one. An undo has to RESTORE that mapping, not
// recompute it — recomputing is what produced it, and the same recomputation run
// backwards is not the inverse. So an entry carries both halves outright.
//
// `confirmed` is a sorted array in the snapshot rather than a `Set`, so an entry is
// comparable and serialisable. Nothing serialises one today; the point is that the
// snapshot is a value, which is what makes this module pure and testable in node.

/** Everything the review screen can undo. Not the whole screen: `activeSlot`,
 *  `linked` and the add-box mode are where the user is LOOKING, not what they have
 *  done, and putting a camera position into an undo step makes Ctrl+Z jump the view. */
export type ReviewState<D> = {
  detections: readonly D[];
  /** Indices into `detections`, ascending. */
  confirmed: readonly number[];
};

export type ReviewHistory<D> = {
  /** Oldest first. The last entry is the state BEFORE the newest change. */
  readonly past: readonly ReviewState<D>[];
  /** Newest first: `redo` pops from the front. */
  readonly future: readonly ReviewState<D>[];
};

/** How many steps back the review remembers.
 *
 *  A detection carries a `box`, a `dimMM` and a `position`, so an entry is small —
 *  but there are as many entries as edits, and a review of thirty pieces that the
 *  user works through row by row is a hundred edits. Bounded so a long session
 *  cannot grow without limit, and generous enough that the bound is not the thing
 *  the user hits. */
export const HISTORY_LIMIT = 50;

export function emptyHistory<D>(): ReviewHistory<D> {
  return { past: [], future: [] };
}

/** Record the state as it stands BEFORE a change is applied.
 *
 *  Called by every mutator, before it mutates. That ordering is the whole contract:
 *  an entry is what `undo` should return to, so it is the old state and never the
 *  new one.
 *
 *  Recording clears `future`, because a new edit made after an undo is a fork and
 *  the abandoned branch is no longer reachable. That is the standard rule and it is
 *  stated because the alternative — keeping it — produces a redo that resurrects
 *  work the user has already replaced. */
export function record<D>(h: ReviewHistory<D>, before: ReviewState<D>): ReviewHistory<D> {
  const past = [...h.past, before];
  return { past: past.length > HISTORY_LIMIT ? past.slice(past.length - HISTORY_LIMIT) : past, future: [] };
}

export function canUndo<D>(h: ReviewHistory<D>): boolean {
  return h.past.length > 0;
}

export function canRedo<D>(h: ReviewHistory<D>): boolean {
  return h.future.length > 0;
}

/** Step back. `current` is where the screen is now, and it becomes the redo entry.
 *
 *  Returns `null` when there is nothing to undo, so a caller cannot accidentally
 *  apply an empty step — the alternative, returning the input unchanged, means a
 *  caller that forgets to check still re-renders and still looks like it did
 *  something. */
export function undo<D>(
  h: ReviewHistory<D>,
  current: ReviewState<D>,
): { history: ReviewHistory<D>; state: ReviewState<D> } | null {
  if (h.past.length === 0) return null;
  const state = h.past[h.past.length - 1];
  return {
    history: { past: h.past.slice(0, -1), future: [current, ...h.future] },
    state,
  };
}

/** Step forward. Mirror of `undo`: `current` becomes the undo entry. */
export function redo<D>(
  h: ReviewHistory<D>,
  current: ReviewState<D>,
): { history: ReviewHistory<D>; state: ReviewState<D> } | null {
  if (h.future.length === 0) return null;
  const [state, ...rest] = h.future;
  return {
    history: { past: [...h.past, current], future: rest },
    state,
  };
}

/** A `Set` of indices as the snapshot's sorted array.
 *
 *  Here rather than at the call site so both directions of the conversion live
 *  together — the codec lesson from `lib/detection-record.ts`, where a hand-written
 *  read and a hand-written write drifted and silently dropped a field. */
export function snapshotConfirmed(confirmed: ReadonlySet<number>): number[] {
  return [...confirmed].sort((a, b) => a - b);
}

/** …and back. */
export function restoreConfirmed(confirmed: readonly number[]): Set<number> {
  return new Set(confirmed);
}

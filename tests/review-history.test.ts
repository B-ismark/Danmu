// Undo / redo over the detect screen's review.
//
// The review lives entirely in component state until `finish()` writes it, so a
// mistyped rename or a mis-tapped delete had no way back — and renaming is exactly
// where a slip happens.
//
// The assertion that matters most is the `confirmed` one. That set is indices into the
// detections array, and `deleteDetection` re-indexes it by hand; an undo has to
// RESTORE that mapping rather than recompute it, because recomputing is what produced
// it and running the same recomputation backwards is not its inverse.

import { describe, expect, it } from 'vitest';
import {
  HISTORY_LIMIT,
  canRedo,
  canUndo,
  emptyHistory,
  record,
  redo,
  restoreConfirmed,
  snapshotConfirmed,
  undo,
  type ReviewState,
} from '@/lib/review-history';

/** Stand-ins for detections: this module is generic in `D` on purpose, so its tests
 *  do not need a Detection, a CalMap or a room. */
type Row = { name: string };
const rows = (...names: string[]): Row[] => names.map((name) => ({ name }));
const state = (names: string[], confirmed: number[]): ReviewState<Row> => ({
  detections: rows(...names),
  confirmed,
});

describe('an empty history', () => {
  it('can do neither', () => {
    const h = emptyHistory<Row>();
    expect(canUndo(h)).toBe(false);
    expect(canRedo(h)).toBe(false);
  });

  it('returns null rather than a no-op step', () => {
    // A caller that forgets to check `canUndo` must not get something that looks like
    // it worked: returning the input unchanged still re-renders and still reads as a
    // successful undo that did nothing.
    const h = emptyHistory<Row>();
    expect(undo(h, state(['a'], []))).toBeNull();
    expect(redo(h, state(['a'], []))).toBeNull();
  });
});

describe('one edit, undone', () => {
  it('puts back the state as it stood BEFORE the change', () => {
    const before = state(['bed'], [0]);
    const after = state(['fridge'], [0]);
    const h = record(emptyHistory<Row>(), before);
    const back = undo(h, after);
    expect(back).not.toBeNull();
    expect(back!.state).toEqual(before);
  });

  it('makes the change redoable, and redo returns exactly what was undone', () => {
    const before = state(['bed'], [0]);
    const after = state(['fridge'], [0]);
    const h1 = record(emptyHistory<Row>(), before);
    const undone = undo(h1, after)!;
    expect(canRedo(undone.history)).toBe(true);
    const again = redo(undone.history, undone.state)!;
    expect(again.state).toEqual(after);
    // And we are back where we started, so the pair is a true round trip.
    expect(canUndo(again.history)).toBe(true);
    expect(canRedo(again.history)).toBe(false);
  });
});

describe('the confirmed mapping', () => {
  it('is restored, not recomputed, across a delete', () => {
    // Three rows with the second and third confirmed. Deleting row 0 shifts those
    // confirmations down to 0 and 1 — that is what `deleteDetection` does by hand.
    // Undo has to put back {1, 2}, and nothing about the restored detections says
    // which indices were confirmed, which is why the snapshot carries them.
    const before = state(['a', 'b', 'c'], [1, 2]);
    const afterDelete = state(['b', 'c'], [0, 1]);
    const h = record(emptyHistory<Row>(), before);
    const back = undo(h, afterDelete)!;
    expect(back.state.detections).toEqual(rows('a', 'b', 'c'));
    expect(back.state.confirmed).toEqual([1, 2]);
  });

  it('round-trips a Set through the snapshot codec', () => {
    // Both directions in one assertion, because a hand-written read and a hand-written
    // write drifting apart is what `lib/detection-record.ts` exists to warn about.
    const live = new Set([4, 0, 2]);
    const snap = snapshotConfirmed(live);
    expect(snap, 'the snapshot is sorted, so two equal sets compare equal').toEqual([0, 2, 4]);
    expect(restoreConfirmed(snap)).toEqual(live);
  });
});

describe('a new edit after an undo', () => {
  it('discards the abandoned branch', () => {
    // Standard, and stated because the alternative produces a redo that resurrects
    // work the user has already replaced.
    const s0 = state(['a'], []);
    const s1 = state(['b'], []);
    const s2 = state(['c'], []);
    const h1 = record(emptyHistory<Row>(), s0);
    const undone = undo(h1, s1)!;
    expect(canRedo(undone.history)).toBe(true);
    const forked = record(undone.history, s0);
    expect(canRedo(forked), 'recording must clear the future').toBe(false);
    expect(undo(forked, s2)!.state).toEqual(s0);
  });
});

describe('the bound', () => {
  it('keeps the most RECENT entries when it overflows', () => {
    // Dropping from the wrong end is the bug that looks like a working history until
    // someone undoes more than once: the step nearest the present is the one a user
    // reaches for first, so it is the one that must never be evicted.
    let h = emptyHistory<Row>();
    for (let i = 0; i < HISTORY_LIMIT + 10; i++) h = record(h, state([`s${i}`], []));
    expect(h.past.length).toBe(HISTORY_LIMIT);
    const back = undo(h, state(['now'], []))!;
    expect(back.state.detections).toEqual(rows(`s${HISTORY_LIMIT + 9}`));
    // The oldest survivor is the one HISTORY_LIMIT steps back, not entry 0.
    expect(h.past[0].detections).toEqual(rows(`s${10}`));
  });

  it('never exceeds the bound however many edits are made', () => {
    let h = emptyHistory<Row>();
    for (let i = 0; i < HISTORY_LIMIT * 3; i++) {
      h = record(h, state([`s${i}`], []));
      expect(h.past.length).toBeLessThanOrEqual(HISTORY_LIMIT);
    }
  });
});

describe('several steps', () => {
  it('walks back and forward through them in order', () => {
    const steps = [state(['a'], []), state(['b'], []), state(['c'], [])];
    const now = state(['d'], []);
    let h = emptyHistory<Row>();
    for (const s of steps) h = record(h, s);

    let cur = now;
    const seen: string[] = [];
    for (;;) {
      const r = undo(h, cur);
      if (!r) break;
      h = r.history;
      cur = r.state;
      seen.push(cur.detections[0].name);
    }
    expect(seen, 'undo walks newest-first').toEqual(['c', 'b', 'a']);

    const forward: string[] = [];
    for (;;) {
      const r = redo(h, cur);
      if (!r) break;
      h = r.history;
      cur = r.state;
      forward.push(cur.detections[0].name);
    }
    expect(forward, 'redo walks back out in the same order').toEqual(['b', 'c', 'd']);
  });
});

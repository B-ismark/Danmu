'use client';

// Transform history — undo/redo stack of immutable snapshots.
// Bounded ring buffer to keep memory in check on long sessions.

import { create } from 'zustand';
import { useStudio } from './store';

export type Snapshot = {
  positions: Record<string, [number, number, number]>;
  rotations: Record<string, number>;
  dims: Record<string, [number, number, number]>;
};

const MAX = 80;

type HistoryState = {
  past: Snapshot[];
  future: Snapshot[];
  /** suspends recording during programmatic restores so undo doesn't push them */
  suspended: boolean;
  push: (s: Snapshot) => void;
  undo: () => Snapshot | undefined;
  redo: () => Snapshot | undefined;
  reset: () => void;
};

export const useHistory = create<HistoryState>((set, get) => ({
  past: [],
  future: [],
  suspended: false,
  push: (s) => {
    if (get().suspended) return;
    const past = [...get().past, s];
    if (past.length > MAX) past.shift();
    set({ past, future: [] });
  },
  undo: () => {
    const { past, future } = get();
    if (past.length < 2) return undefined;
    // last entry is current; the one before is the prior state we want to restore
    const prior = past[past.length - 2];
    const current = past[past.length - 1];
    set({ past: past.slice(0, -1), future: [current, ...future] });
    return prior;
  },
  redo: () => {
    const { past, future } = get();
    if (future.length === 0) return undefined;
    const [next, ...rest] = future;
    set({ past: [...past, next], future: rest });
    return next;
  },
  reset: () => set({ past: [], future: [] }),
}));

let lastSnapshot: Snapshot | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

/** Start recording transform changes from the studio store into history. Idempotent. */
export function startHistoryRecording() {
  return useStudio.subscribe((state, prev) => {
    if (
      state.positions === prev.positions &&
      state.rotations === prev.rotations &&
      state.dims === prev.dims
    )
      return;
    if (timer) clearTimeout(timer);
    // Debounce: drag emits dozens of mid-frame changes; commit a single snapshot
    // ~250ms after the user stops to avoid filling the stack with intermediate states.
    timer = setTimeout(() => {
      const snap: Snapshot = {
        positions: state.positions,
        rotations: state.rotations,
        dims: state.dims,
      };
      // skip pushing if equivalent to last
      if (lastSnapshot && shallowEq(snap, lastSnapshot)) return;
      lastSnapshot = snap;
      useHistory.getState().push(snap);
    }, 250);
  });
}

function shallowEq(a: Snapshot, b: Snapshot): boolean {
  return a.positions === b.positions && a.rotations === b.rotations && a.dims === b.dims;
}

export function applySnapshot(snap: Snapshot) {
  const h = useHistory.getState();
  h.suspended = true;
  useStudio.getState().loadTransforms(snap);
  // small async unsuspend so subscribe fires after state settles
  setTimeout(() => {
    useHistory.setState({ suspended: false });
  }, 0);
}

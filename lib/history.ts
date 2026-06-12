'use client';

// Undo/redo stack of immutable snapshots. Covers BOTH stores:
//   useStudio — transform overrides (move / rotate / scale)
//   useScene  — structure (add / delete / swap parts, wall paint, room resize)
// Bounded ring buffer to keep memory in check on long sessions.

import { create } from 'zustand';
import { useStudio } from './store';
import { useScene, type RoomShape } from './scene-store';
import type { ScenePart } from './scene-spec';

export type Snapshot = {
  positions: Record<string, [number, number, number]>;
  rotations: Record<string, number>;
  dims: Record<string, [number, number, number]>;
  parts: ScenePart[];
  room: RoomShape;
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

function takeSnapshot(): Snapshot {
  const t = useStudio.getState();
  const sc = useScene.getState();
  return {
    positions: t.positions,
    rotations: t.rotations,
    dims: t.dims,
    parts: sc.parts,
    room: sc.room,
  };
}

function scheduleSnapshot() {
  if (timer) clearTimeout(timer);
  // Debounce: drag emits dozens of mid-frame changes; commit a single snapshot
  // ~250ms after the user stops to avoid filling the stack with intermediate states.
  timer = setTimeout(() => {
    const snap = takeSnapshot();
    if (lastSnapshot && shallowEq(snap, lastSnapshot)) return;
    lastSnapshot = snap;
    useHistory.getState().push(snap);
  }, 250);
}

/** Start recording transform + structure changes into history. Idempotent. */
export function startHistoryRecording() {
  const unsubStudio = useStudio.subscribe((state, prev) => {
    if (
      state.positions === prev.positions &&
      state.rotations === prev.rotations &&
      state.dims === prev.dims
    )
      return;
    scheduleSnapshot();
  });
  const unsubScene = useScene.subscribe((state, prev) => {
    if (state.parts === prev.parts && state.room === prev.room) return;
    scheduleSnapshot();
  });
  return () => {
    unsubStudio();
    unsubScene();
  };
}

function shallowEq(a: Snapshot, b: Snapshot): boolean {
  return (
    a.positions === b.positions &&
    a.rotations === b.rotations &&
    a.dims === b.dims &&
    a.parts === b.parts &&
    a.room === b.room
  );
}

export function applySnapshot(snap: Snapshot) {
  const h = useHistory.getState();
  h.suspended = true;
  // Cancel any pending debounce and mark the restored state as "already
  // recorded" — otherwise the subscription re-fires 250ms later (after
  // un-suspend), pushes the restored state, and wipes the redo stack.
  if (timer) clearTimeout(timer);
  lastSnapshot = snap;
  useStudio.getState().loadTransforms(snap);
  useScene.setState({ parts: snap.parts, room: snap.room });
  // small async unsuspend so subscribe fires after state settles
  setTimeout(() => {
    useHistory.setState({ suspended: false });
  }, 0);
}

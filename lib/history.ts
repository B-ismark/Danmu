'use client';

// Undo/redo stack of immutable snapshots. Covers BOTH stores:
//   useStudio — transform overrides (move / rotate / scale)
//   useScene  — structure (add / delete / swap parts, wall paint, room resize)
// Bounded ring buffer to keep memory in check on long sessions.

import { create } from 'zustand';
import { useStudio, type Lighting } from './store';
import { useScene, type RoomShape } from './scene-store';
import type { ScenePart } from './scene-spec';

export type Snapshot = {
  positions: Record<string, [number, number, number]>;
  rotations: Record<string, number>;
  dims: Record<string, [number, number, number]>;
  /** rigid-parenting relationships (childId -> parentId). An edit to the
   *  arrangement, not a view preference — undoing a desk-move-with-cascade
   *  should also undo whatever it carried along, and undoing further should
   *  put the relationship itself back the way it was. */
  parentIds: Record<string, string>;
  parts: ScenePart[];
  room: RoomShape;
  /** Lighting mood belongs in history because applying a theme changes it in
   *  the same gesture as the colours. Without it, undoing a theme reverted
   *  every colour and left the room in the theme's light — a state the UI could
   *  not name. `quality` / `dressed` stay out: they are view preferences, not
   *  part of the design being edited. */
  lighting: Lighting;
  /** Which parts are hidden. This is an edit to the arrangement, not a view
   *  preference — it is saved per room alongside the transforms — so it belongs
   *  in history. Without it, pressing H and then Ctrl+Z undid the edit BEFORE the
   *  hide, and walking back past a hide left the part hidden in a state the stack
   *  did not describe. The help card advertises Ctrl+Z two lines under H. */
  hidden: Record<string, boolean>;
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
    parentIds: t.parentIds,
    parts: sc.parts,
    room: sc.room,
    lighting: t.lighting,
    hidden: t.hidden,
  };
}

/** Record the room's loaded state as the baseline to undo *back to*.
 *
 *  `undo()` restores `past[length - 2]`, so with a single entry there is nothing
 *  to return to and the first edit of a session was unreachable forever — the
 *  worst case being a first action of Delete. Call this once the room's real
 *  parts and transforms are in the stores (RoomSync), NOT from
 *  startHistoryRecording: subscribing happens before the room loads, so the
 *  baseline would be the default starter scene and the first undo would wipe
 *  the user's actual room. */
export function seedHistory() {
  const snap = takeSnapshot();
  lastSnapshot = snap;
  useHistory.setState({ past: [snap], future: [] });
}

function scheduleSnapshot() {
  if (timer) clearTimeout(timer);
  // NOTHING is recorded while a gesture is in flight, and the debounce below is
  // not what makes that true — it is what made it false.
  //
  // During a 3D drag the store is deliberately HALF WRITTEN. `Draggable` animates
  // the piece under the hand by writing its own object3D and only writes that
  // piece's override at the drop, while the convoy's members go through the store
  // on every legal frame (`liveUpdate` → `setTransformsFor`). So mid-gesture the
  // store says: company moved, piece under the hand still at home. Any pause
  // longer than the debounce turns that into a snapshot — and the debounce cannot
  // help, because a pause longer than the debounce IS the window it opens. One
  // Ctrl+Z afterwards then restored exactly that state: the dragged piece went
  // back and its companions stayed where the drag had left them, which is what
  // "select the lamp, then the side table, drag, undo, and only the side table
  // comes back" was. A single-piece drag was immune, because with no company
  // `co.moves` is empty, `setTransformsFor` returns `{}` and the subscription
  // below never fires — so it read as a multi-select bug, and it was one.
  //
  // The gesture, not the timer, is the unit of an undo step. `draggingId` is set
  // for the whole of one in both tabs, and `startHistoryRecording` takes the
  // snapshot when it clears.
  //
  // The pending timer is cancelled rather than left to fire: an edit made less
  // than 250ms before a drag began therefore lands in the SAME undo entry as the
  // drag instead of its own. That is coalescing, not loss — the state before both
  // is still the entry underneath — and it is the right trade against recording a
  // room that never existed.
  if (useStudio.getState().draggingId) return;
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
    // A gesture ENDING is a reason to snapshot in its own right, even though
    // `draggingId` is not part of a `Snapshot`. The two tabs order the release
    // differently — one clears `draggingId` before `commit()` writes and one
    // after — and this covers both: writes that land after the flag clears
    // schedule normally through the fields below, and writes that landed while it
    // was still set were refused by the gate in `scheduleSnapshot` and are picked
    // up here. Escape-cancel comes through the same door, which is what makes a
    // cancelled drag cost no undo step it can be told apart from.
    if (prev.draggingId && !state.draggingId) {
      scheduleSnapshot();
      return;
    }
    if (
      state.positions === prev.positions &&
      state.rotations === prev.rotations &&
      state.dims === prev.dims &&
      state.parentIds === prev.parentIds &&
      state.lighting === prev.lighting &&
      state.hidden === prev.hidden
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
    a.parentIds === b.parentIds &&
    a.parts === b.parts &&
    a.room === b.room &&
    a.lighting === b.lighting &&
    a.hidden === b.hidden
  );
}

export function applySnapshot(snap: Snapshot) {
  // setState, not a direct mutation of the object getState() hands back. The
  // in-place version worked only because push() happened to read `suspended` off
  // that same object; anything that froze or cloned state (immer, a devtools
  // middleware) would have turned it into a silent no-op, and then every restore
  // would push itself onto the stack and wipe the redo branch.
  useHistory.setState({ suspended: true });
  // Cancel any pending debounce and mark the restored state as "already
  // recorded" — otherwise the subscription re-fires 250ms later (after
  // un-suspend), pushes the restored state, and wipes the redo stack.
  if (timer) clearTimeout(timer);
  lastSnapshot = snap;
  useStudio.getState().loadTransforms(snap);
  useStudio.getState().setLighting(snap.lighting);
  useStudio.getState().setHiddenMap(snap.hidden);
  useStudio.getState().setParentIds(snap.parentIds);
  useScene.setState({ parts: snap.parts, room: snap.room });
  // small async unsuspend so subscribe fires after state settles
  setTimeout(() => {
    useHistory.setState({ suspended: false });
  }, 0);
}

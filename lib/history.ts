'use client';

// Undo/redo stack of immutable snapshots. Covers BOTH stores:
//   useStudio — transform overrides (move / rotate / scale), and the selection
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
  /** The selection, all three fields of it, because the user’s ruling is that this
   *  platform behaves like Blender: *"in blender, actions and selections are both
   *  affectted by undo and redoing so wouldn’t it be best to do the same for this
   *  platform too?"*
   *
   *  It rides in the SAME entry as the edit rather than in a history of its own, so
   *  undoing a move puts back the selection that made the move — the pieces come back
   *  highlighted where they landed, which is the state the user was actually in.
   *
   *  All three, and not just `selection`: they are mutually exclusive by construction
   *  (`setSelected` clears `selectedWall` and `setSelectedWall` clears the part
   *  selection), so restoring a subset can produce a pair the store’s own setters can
   *  never make. `frameSelectedToken` deliberately stays out — it is a nudge counter,
   *  and replaying it would re-aim the camera on every undo. */
  selectedPartId: string | null;
  selection: string[];
  /** Index into `room.footprint`, so it goes stale in a way a part id does not — see
   *  `applySnapshot`. */
  selectedWall: number | null;
};

const MAX = 80;

type HistoryState = {
  past: Snapshot[];
  future: Snapshot[];
  /** suspends recording during programmatic restores so undo doesn't push them */
  suspended: boolean;
  /** Whether `past[past.length - 1]` was pushed by a change that touched ONLY the
   *  selection. It is what lets a run of clicks coalesce; see `push`. */
  topIsSelectionOnly: boolean;
  push: (s: Snapshot, selectionOnly?: boolean) => void;
  undo: () => Snapshot | undefined;
  redo: () => Snapshot | undefined;
  reset: () => void;
};

export const useHistory = create<HistoryState>((set, get) => ({
  past: [],
  future: [],
  suspended: false,
  topIsSelectionOnly: false,
  // A RUN of selection changes is ONE undo step, and that is not a nicety.
  //
  // Blender’s own complaint about selection-in-undo is a run of clicks flooding the
  // stack, and here the stack is a ring of MAX — so without coalescing, clicking
  // around the room 80 times discards every edit the user actually made. That is data
  // loss wearing the shape of a preference.
  //
  // The rule is narrow on purpose: replace the top entry only when the new change is
  // selection-only AND the entry it would replace was itself selection-only. So the
  // first click after an edit PUSHES — the edit’s own selection is preserved
  // underneath it and stays reachable — and the second through eightieth overwrite
  // that one entry. Undo then walks back to the selection the last edit ended with,
  // and back again to before the run.
  //
  // It never overwrites an entry that recorded an edit, which is the property that
  // makes this safe rather than clever.
  push: (s, selectionOnly = false) => {
    if (get().suspended) return;
    const { past, topIsSelectionOnly } = get();
    if (selectionOnly && topIsSelectionOnly && past.length > 1) {
      set({ past: [...past.slice(0, -1), s], future: [] });
      return;
    }
    const next = [...past, s];
    if (next.length > MAX) next.shift();
    set({ past: next, future: [], topIsSelectionOnly: selectionOnly });
  },
  undo: () => {
    const { past, future } = get();
    if (past.length < 2) return undefined;
    // last entry is current; the one before is the prior state we want to restore
    const prior = past[past.length - 2];
    const current = past[past.length - 1];
    // `false`, always: after a restore the top entry is one this stack did not just
    // push, and whether IT was selection-only is not tracked per entry. Claiming
    // otherwise would let the next click overwrite a restored state, which is the one
    // way this coalescing could destroy history rather than compress it.
    set({ past: past.slice(0, -1), future: [current, ...future], topIsSelectionOnly: false });
    return prior;
  },
  redo: () => {
    const { past, future } = get();
    if (future.length === 0) return undefined;
    const [next, ...rest] = future;
    set({ past: [...past, next], future: rest, topIsSelectionOnly: false });
    return next;
  },
  reset: () => set({ past: [], future: [], topIsSelectionOnly: false }),
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
    selectedPartId: t.selectedPartId,
    selection: t.selection,
    selectedWall: t.selectedWall,
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
  useHistory.setState({ past: [snap], future: [], topIsSelectionOnly: false });
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
    if (lastSnapshot && sameEdit(snap, lastSnapshot) && sameSelection(snap, lastSnapshot)) return;
    // Selection-only means every EDIT field is identical and only the selection moved.
    // With no previous snapshot at all this is the first entry and has nothing to
    // coalesce into, so it is not selection-only whatever it contains.
    const selectionOnly = lastSnapshot !== null && sameEdit(snap, lastSnapshot);
    lastSnapshot = snap;
    useHistory.getState().push(snap, selectionOnly);
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
      state.hidden === prev.hidden &&
      state.selectedPartId === prev.selectedPartId &&
      state.selection === prev.selection &&
      state.selectedWall === prev.selectedWall
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

/** Everything a snapshot holds EXCEPT the selection. Kept apart from
 *  `sameSelection` because "did the edit change" and "did the selection change" are
 *  now two different questions, and `scheduleSnapshot` needs both answers. */
function sameEdit(a: Snapshot, b: Snapshot): boolean {
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

/** By CONTENT, not by reference, which is the one place this cannot copy the rest of
 *  the file. Every other field is replaced wholesale by its setter, so `===` answers
 *  it; `selection` is rebuilt on each call — `setSelected` writes a fresh
 *  `id ? [id] : []` — so clicking the SAME piece twice yields two arrays that are
 *  equal and not identical. Under a reference compare that pushed an undo entry for a
 *  selection that had not changed. */
function sameSelection(a: Snapshot, b: Snapshot): boolean {
  return (
    a.selectedPartId === b.selectedPartId &&
    a.selectedWall === b.selectedWall &&
    a.selection.length === b.selection.length &&
    a.selection.every((id, i) => id === b.selection[i])
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
  // A stored selection names things that may not be there any more, on TWO axes, and
  // this is the hazard § H.10 said to build first rather than discover.
  //
  // Part ids: an entry’s `parts` and `selection` are captured in one
  // `takeSnapshot`, and the app’s own delete path (`removeParts`) drops the doomed
  // ids from the selection, so a snapshot THIS module took is already consistent — but a
  // snapshot is a plain object and every future writer of one is on the honour system.
  // The filter is what stops the gizmo and the Inspector being handed an id nothing in
  // the room answers to.
  //
  // `selectedWall` is the axis the write-up did NOT name, and it is the sharper one,
  // because it is an INDEX into `room.footprint` rather than a name. Undoing across a
  // layout change moves the wall count under it — a U has eight edges and a rect four —
  // so wall 7 restored into a rectangle indexes nothing, and `WallInspector` is handed
  // it directly. Cleared rather than clamped: wall 3 of a rectangle is not the wall the
  // user had, and silently selecting a different one is worse than selecting none.
  const alive = new Set(snap.parts.map((p) => p.id));
  const wallCount = snap.room.footprint.length;
  useStudio.setState({
    selection: snap.selection.filter((id) => alive.has(id)),
    selectedPartId:
      snap.selectedPartId !== null && alive.has(snap.selectedPartId) ? snap.selectedPartId : null,
    selectedWall:
      snap.selectedWall !== null && snap.selectedWall >= 0 && snap.selectedWall < wallCount
        ? snap.selectedWall
        : null,
  });
  // small async unsuspend so subscribe fires after state settles
  setTimeout(() => {
    useHistory.setState({ suspended: false });
  }, 0);
}

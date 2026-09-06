// @vitest-environment jsdom
//
// The undo stack had no tests, and every bug it has had was an off-by-one in the
// same place: `undo()` restores `past[length - 2]`, so what is or is not in the
// stack decides whether the FIRST edit of a session is reachable at all.
//
// jsdom because useStudio persists through zustand's `persist` middleware, which
// wants localStorage; the logic under test is otherwise pure.

import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  useHistory,
  seedHistory,
  applySnapshot,
  startHistoryRecording,
  type Snapshot,
} from '@/lib/history';
import { useStudio } from '@/lib/store';
import { useScene } from '@/lib/scene-store';

function snapshot(over: Partial<Snapshot> = {}): Snapshot {
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
    ...over,
  };
}

beforeEach(() => {
  useHistory.setState({ past: [], future: [], suspended: false, topIsSelectionOnly: false });
  // `hidden`/`parentIds` are not part of loadTransforms — applySnapshot
  // restores them through their own setters for the same reason, so reset
  // them the same way.
  useStudio.getState().loadTransforms({ positions: {}, rotations: {}, dims: {} });
  useStudio.getState().setHiddenMap({});
  useStudio.getState().setParentIds({});
  // The selection is part of a snapshot now, so a test that leaves one behind changes
  // what the NEXT test’s baseline contains. `setSelectedWall(null)` second because it
  // and `setSelected` clear each other.
  useStudio.getState().setSelected(null);
  useStudio.getState().setSelectedWall(null);
});

describe('the stack', () => {
  it('needs a baseline before the first edit can be undone', async () => {
    // The whole reason seedHistory exists. Without it the stack holds one entry
    // (the edit), `past.length < 2`, and the first action of a session — worst
    // case a Delete — is unreachable forever.
    useHistory.getState().push(snapshot({ rotations: { 'sofa-1': 1 } }));
    expect(useHistory.getState().undo()).toBeUndefined();

    useHistory.setState({ past: [], future: [] });
    seedHistory();
    useHistory.getState().push(snapshot({ rotations: { 'sofa-1': 1 } }));
    expect(useHistory.getState().undo()).toBeDefined();
  });

  it('walks back and forward over several edits', () => {
    seedHistory();
    const a = snapshot({ rotations: { x: 1 } });
    const b = snapshot({ rotations: { x: 2 } });
    useHistory.getState().push(a);
    useHistory.getState().push(b);

    expect(useHistory.getState().undo()).toBe(a);
    expect(useHistory.getState().undo()?.rotations).toEqual({});
    // Exhausted — the baseline is the floor, not an error.
    expect(useHistory.getState().undo()).toBeUndefined();

    expect(useHistory.getState().redo()).toBe(a);
    expect(useHistory.getState().redo()).toBe(b);
    expect(useHistory.getState().redo()).toBeUndefined();
  });

  it('drops the redo branch when a new edit follows an undo', () => {
    seedHistory();
    useHistory.getState().push(snapshot({ rotations: { x: 1 } }));
    useHistory.getState().undo();
    expect(useHistory.getState().future).toHaveLength(1);

    useHistory.getState().push(snapshot({ rotations: { y: 9 } }));
    expect(useHistory.getState().future).toEqual([]);
  });

  it('records nothing while suspended', () => {
    seedHistory();
    useHistory.setState({ suspended: true });
    useHistory.getState().push(snapshot({ rotations: { x: 1 } }));
    expect(useHistory.getState().past).toHaveLength(1);
  });

  it('bounds the stack rather than growing forever', () => {
    seedHistory();
    for (let i = 0; i < 200; i++) {
      useHistory.getState().push(snapshot({ rotations: { x: i } }));
    }
    const { past } = useHistory.getState();
    expect(past.length).toBeLessThanOrEqual(80);
    // The newest edit survives the trim; the oldest is what gets dropped.
    expect(past[past.length - 1].rotations).toEqual({ x: 199 });
  });

  it('reset clears both directions', () => {
    seedHistory();
    useHistory.getState().push(snapshot({ rotations: { x: 1 } }));
    useHistory.getState().undo();
    useHistory.getState().reset();
    expect(useHistory.getState().past).toEqual([]);
    expect(useHistory.getState().future).toEqual([]);
  });
});

describe('what a snapshot covers', () => {
  it('carries hidden parts, so undoing a hide unhides', () => {
    // This is the field that was missing: pressing V then Ctrl+Z undid the edit
    // BEFORE the hide, and walking back past a hide left the part hidden in a
    // state the stack did not describe.
    seedHistory();
    const before = useHistory.getState().past[0];
    expect(before.hidden).toEqual({});

    useStudio.getState().toggleHidden('sofa-1');
    const after = snapshot();
    expect(after.hidden).toEqual({ 'sofa-1': true });
    useHistory.getState().push(after);

    const restored = useHistory.getState().undo();
    expect(restored?.hidden).toEqual({});
    applySnapshot(restored!);
    expect(useStudio.getState().hidden).toEqual({});
  });

  it('carries rigid-parenting relationships, so undoing a desk-move-with-cascade also undoes the relationship', () => {
    seedHistory();
    const before = useHistory.getState().past[0];
    expect(before.parentIds).toEqual({});

    useStudio.getState().setParent('laptop-1', 'desk-1');
    const after = snapshot();
    expect(after.parentIds).toEqual({ 'laptop-1': 'desk-1' });
    useHistory.getState().push(after);

    const restored = useHistory.getState().undo();
    expect(restored?.parentIds).toEqual({});
    applySnapshot(restored!);
    expect(useStudio.getState().parentIds).toEqual({});
  });

  it('carries the lighting mood, so undoing a theme does not leave its light', () => {
    seedHistory();
    const originalLighting = useStudio.getState().lighting;
    useStudio.getState().setLighting('evening');
    useHistory.getState().push(snapshot());

    const restored = useHistory.getState().undo();
    expect(restored?.lighting).toBe(originalLighting);
    applySnapshot(restored!);
    expect(useStudio.getState().lighting).toBe(originalLighting);
  });

  it('restores structure as well as transforms', () => {
    seedHistory();
    const original = useScene.getState().parts;
    useScene.setState({ parts: original.slice(0, 1) });
    useHistory.getState().push(snapshot());

    applySnapshot(useHistory.getState().undo()!);
    expect(useScene.getState().parts).toBe(original);
  });
});

describe('applySnapshot', () => {
  it('suspends recording while it restores, then releases it', async () => {
    vi.useFakeTimers();
    try {
      seedHistory();
      const snap = snapshot({ rotations: { x: 1 } });
      applySnapshot(snap);
      // Suspended synchronously — otherwise the restore records itself and wipes
      // the redo branch. Asserted through setState rather than a mutated object:
      // the in-place version worked only by accident.
      expect(useHistory.getState().suspended).toBe(true);
      await vi.advanceTimersByTimeAsync(1);
      expect(useHistory.getState().suspended).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancels a pending debounce, so a restore is not re-recorded', async () => {
    vi.useFakeTimers();
    const stop = startHistoryRecording();
    try {
      seedHistory();
      // An edit schedules a snapshot 250 ms out…
      useStudio.getState().setRotation('sofa-1', 0.5);
      // …and a restore lands before it fires.
      applySnapshot(useHistory.getState().past[0]);
      await vi.advanceTimersByTimeAsync(600);

      // The restore must not have queued itself onto the stack.
      expect(useHistory.getState().past).toHaveLength(1);
      expect(useHistory.getState().future).toEqual([]);
    } finally {
      stop();
      vi.useRealTimers();
    }
  });
});

describe('startHistoryRecording', () => {
  it('records a real edit once the debounce elapses', async () => {
    vi.useFakeTimers();
    const stop = startHistoryRecording();
    try {
      seedHistory();
      useStudio.getState().setPosition('sofa-1', [1, 0, 2]);
      expect(useHistory.getState().past).toHaveLength(1); // still debouncing
      await vi.advanceTimersByTimeAsync(300);
      expect(useHistory.getState().past).toHaveLength(2);
      expect(useHistory.getState().past[1].positions['sofa-1']).toEqual([1, 0, 2]);
    } finally {
      stop();
      vi.useRealTimers();
    }
  });

  it('collapses a burst of drag updates into one entry', async () => {
    vi.useFakeTimers();
    const stop = startHistoryRecording();
    try {
      seedHistory();
      for (let i = 0; i < 30; i++) {
        useStudio.getState().setPosition('sofa-1', [i / 10, 0, 0]);
        await vi.advanceTimersByTimeAsync(10);
      }
      await vi.advanceTimersByTimeAsync(300);
      expect(useHistory.getState().past).toHaveLength(2);
    } finally {
      stop();
      vi.useRealTimers();
    }
  });

  it('records a hide, because hiding a part is an edit', async () => {
    // The subscription's early-return compares each field it cares about. Leave
    // `hidden` out of that comparison and a hide-only change looks like "nothing
    // changed", so pressing V never lands on the stack and Ctrl+Z skips over it to
    // the edit before.
    vi.useFakeTimers();
    const stop = startHistoryRecording();
    try {
      seedHistory();
      useStudio.getState().toggleHidden('sofa-1');
      await vi.advanceTimersByTimeAsync(300);
      expect(useHistory.getState().past).toHaveLength(2);
      expect(useHistory.getState().past[1].hidden).toEqual({ 'sofa-1': true });
    } finally {
      stop();
      vi.useRealTimers();
    }
  });

  it('ignores a change to a view preference', async () => {
    vi.useFakeTimers();
    const stop = startHistoryRecording();
    try {
      seedHistory();
      // `quality` is explicitly out of the snapshot — a view preference, not part
      // of the design being edited.
      useStudio.getState().setQuality('low');
      await vi.advanceTimersByTimeAsync(600);
      expect(useHistory.getState().past).toHaveLength(1);
    } finally {
      stop();
      vi.useRealTimers();
    }
  });

  describe('a drag is one undo step, and never a half-written one', () => {
    // The bug this covers, in the user's words: "select the lamp, then the side
    // table, drag them, undo — only the side table comes back."
    //
    // The mechanism is asymmetric and that is the whole difficulty. Mid-drag the
    // 3D tab has written the CONVOY's members into the store (`liveUpdate` →
    // `setTransformsFor`) while the piece under the hand is still moving as an
    // object3D, its override unwritten until the drop. So the store, mid-gesture,
    // describes a room that never existed. The debounce cannot save it: any pause
    // longer than 250 ms IS the window.
    //
    // Beware the symmetric case here — with both pieces written the test passes
    // either way. `member` must move while `dragged` does not.
    it('records nothing while draggingId is set, however long the pause', async () => {
      vi.useFakeTimers();
      const stop = startHistoryRecording();
      try {
        seedHistory();
        useStudio.getState().setDragging('dragged');
        // The convoy's half of a live frame, and only that half.
        useStudio.getState().setTransformsFor([{ id: 'member', pos: [1, 0, 0] }]);
        // Four debounce windows. Before the gate, the first one pushed.
        await vi.advanceTimersByTimeAsync(1000);
        expect(useHistory.getState().past).toHaveLength(1);
      } finally {
        useStudio.getState().setDragging(null);
        stop();
        vi.useRealTimers();
      }
    });

    it('records the whole gesture, both pieces, once it ends', async () => {
      vi.useFakeTimers();
      const stop = startHistoryRecording();
      try {
        seedHistory();
        useStudio.getState().setDragging('dragged');
        useStudio.getState().setTransformsFor([{ id: 'member', pos: [1, 0, 0] }]);
        await vi.advanceTimersByTimeAsync(1000);
        // The drop: this tab writes the dragged piece and then clears the flag.
        useStudio.getState().setPosition('dragged', [2, 0, 0]);
        useStudio.getState().setDragging(null);
        await vi.advanceTimersByTimeAsync(300);

        const { past } = useHistory.getState();
        expect(past).toHaveLength(2);
        // One entry, holding BOTH — which is what makes one Ctrl+Z put both back.
        expect(past[1].positions.dragged).toEqual([2, 0, 0]);
        expect(past[1].positions.member).toEqual([1, 0, 0]);
        // And the entry underneath holds NEITHER.
        expect(past[0].positions.dragged).toBeUndefined();
        expect(past[0].positions.member).toBeUndefined();
        // The claim the comment above used to make for those two lines, stated
        // where it can actually fail. `past[0]` is the SEED, taken right after the
        // beforeEach cleared every override, so it is empty under every mutation —
        // delete the mid-drag guard in lib/history.ts and only the length assertion
        // goes red, while the two lines advertised as load-bearing sit there being
        // true. What a slipped mid-gesture snapshot actually looks like is an entry
        // holding the member's live position with the dragged piece still absent,
        // and that is a statement about the whole stack.
        for (const snap of past) {
          expect(
            snap.positions.member !== undefined && snap.positions.dragged === undefined,
            'a snapshot was taken mid-gesture',
          ).toBe(false);
        }
      } finally {
        stop();
        vi.useRealTimers();
      }
    });

    it('takes the snapshot even when the release writes before the flag clears', async () => {
      // The other tab's ordering. `commit()` writes while `draggingId` is still
      // set, so the gate refuses those writes and the ONLY thing that can record
      // them is the flag's own transition to null.
      vi.useFakeTimers();
      const stop = startHistoryRecording();
      try {
        seedHistory();
        useStudio.getState().setDragging('dragged');
        useStudio.getState().setTransformsFor([
          { id: 'member', pos: [1, 0, 0] },
          { id: 'dragged', pos: [2, 0, 0] },
        ]);
        useStudio.getState().setDragging(null);
        await vi.advanceTimersByTimeAsync(300);

        const { past } = useHistory.getState();
        expect(past).toHaveLength(2);
        expect(past[1].positions.dragged).toEqual([2, 0, 0]);
        expect(past[1].positions.member).toEqual([1, 0, 0]);
      } finally {
        stop();
        vi.useRealTimers();
      }
    });
  });

  it('stops recording once unsubscribed', async () => {
    vi.useFakeTimers();
    const stop = startHistoryRecording();
    seedHistory();
    stop();
    try {
      useStudio.getState().setPosition('sofa-1', [5, 0, 5]);
      await vi.advanceTimersByTimeAsync(600);
      expect(useHistory.getState().past).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

// The user’s ruling, in their own words: *"in blender, actions and selections are both
// affectted by undo and redoing so wouldn’t it be best to do the same for this platform
// too?"* — so selection rides in the main stack rather than in a history beside it.
//
// The recommendation this overrode was a SEPARATE history, and the reason to note that
// here is that the two designs fail differently: a separate history cannot flood the
// main stack, and this one can. Every test below the first is about that, or about the
// staleness a shared stack creates and a separate one would not have.
describe('the selection is part of the undo stack', () => {
  it('carries the selection, so undoing a move puts back the pieces that made it', () => {
    // Undo has to land on a NON-EMPTY selection that differs from the live one, or this
    // asserts nothing: the first version walked back to the empty baseline while the
    // store was also empty, and passed identically with the selection left out of a
    // `Snapshot` entirely. An assertion whose expected value is already on screen is
    // decoration.
    const parts = useScene.getState().parts;
    const [a, b, c] = [parts[0].id, parts[1].id, parts[2].id];
    seedHistory();

    // A move made with two pieces selected…
    useStudio.getState().setSelection([a, b], b);
    useStudio.getState().setPosition(a, [1, 0, 2]);
    useHistory.getState().push(snapshot());

    // …then a second move, made with something else selected.
    useStudio.getState().setSelected(c);
    useStudio.getState().setPosition(a, [5, 0, 6]);
    useHistory.getState().push(snapshot());

    const restored = useHistory.getState().undo();
    expect(restored?.selection).toEqual([a, b]);
    expect(restored?.selectedPartId).toBe(b);

    applySnapshot(restored!);
    // The pieces come back highlighted where they landed, which is the state the user
    // was actually in when they made the move. That is the whole behaviour the ruling
    // asked for.
    expect(useStudio.getState().selection).toEqual([a, b]);
    expect(useStudio.getState().selectedPartId).toBe(b);
    expect(useStudio.getState().positions[a]).toEqual([1, 0, 2]);
  });

  it('restores a wall selection too, since a wall edit is made with a wall selected', () => {
    seedHistory();
    useStudio.getState().setSelectedWall(1);
    const snap = snapshot();
    expect(snap.selectedWall).toBe(1);
    useStudio.getState().setSelectedWall(null);
    applySnapshot(snap);
    expect(useStudio.getState().selectedWall).toBe(1);
  });

  it('the entry the RECORDER builds carries all three selection fields', async () => {
    // Not `snapshot()` — the real `takeSnapshot`, reached by letting the subscription
    // fire. This test exists because of a survivor: zeroing `selection` inside
    // `takeSnapshot` killed nothing, since every assertion about a recorded selection
    // ran against this file’s OWN factory, which is a hand-kept copy of the production
    // one. A fixture that mirrors the thing under test cannot report it drifting.
    //
    // Three fields asserted separately and none of them empty, because a check against
    // the value a field already holds is not a check: the primary and the multi-set have
    // to differ, and the wall has to be a real index rather than the null it starts at.
    vi.useFakeTimers();
    const stop = startHistoryRecording();
    try {
      const [a, b] = useScene.getState().parts.slice(0, 2).map((p) => p.id);
      seedHistory();
      useStudio.getState().setSelection([a, b], a);
      await vi.advanceTimersByTimeAsync(300);

      const entry = useHistory.getState().past[1];
      expect(entry.selection).toEqual([a, b]);
      expect(entry.selectedPartId).toBe(a);
      expect(entry.selectedWall).toBeNull();

      // …and the wall, which the part selection cannot reach: they clear each other, so
      // this is the only way to see `selectedWall` travel.
      useStudio.getState().setSelectedWall(1);
      await vi.advanceTimersByTimeAsync(300);
      const walled = useHistory.getState().past[useHistory.getState().past.length - 1];
      expect(walled.selectedWall).toBe(1);
      expect(walled.selection).toEqual([]);
    } finally {
      stop();
      vi.useRealTimers();
    }
  });
  it('a run of clicks costs ONE undo step, not one per click', async () => {
    // The failure this prevents is not untidiness. The stack is a ring of 80, so
    // without coalescing, clicking around the room discards real edits off the far end.
    vi.useFakeTimers();
    const stop = startHistoryRecording();
    try {
      const ids = useScene.getState().parts.slice(0, 6).map((p) => p.id);
      seedHistory();
      for (const id of ids) {
        useStudio.getState().setSelected(id);
        await vi.advanceTimersByTimeAsync(300);
      }
      // One entry for the whole run, on top of the baseline — and it holds the LAST
      // click, not the first.
      expect(useHistory.getState().past).toHaveLength(2);
      expect(useHistory.getState().past[1].selectedPartId).toBe(ids[ids.length - 1]);
    } finally {
      stop();
      vi.useRealTimers();
    }
  });

  it('the first click after an edit pushes, so the edit is never overwritten', async () => {
    // The narrow half of the coalescing rule. If a selection-only change could replace
    // ANY top entry, the entry recording the edit would be the one it replaced, and the
    // edit would become unreachable — compression turning into loss.
    vi.useFakeTimers();
    const stop = startHistoryRecording();
    try {
      const [a, b] = useScene.getState().parts.slice(0, 2).map((p) => p.id);
      seedHistory();
      useStudio.getState().setPosition(a, [3, 0, 4]);
      await vi.advanceTimersByTimeAsync(300);
      expect(useHistory.getState().past).toHaveLength(2);

      useStudio.getState().setSelected(b);
      await vi.advanceTimersByTimeAsync(300);
      // Three, not two: the click did not eat the move.
      expect(useHistory.getState().past).toHaveLength(3);
      expect(useHistory.getState().past[1].positions[a]).toEqual([3, 0, 4]);

      // And undo still reaches the state before the move.
      expect(useHistory.getState().undo()?.selectedPartId).toBeNull();
    } finally {
      stop();
      vi.useRealTimers();
    }
  });

  it('clicking the same piece twice records nothing at all', async () => {
    // `setSelected` writes a fresh `id ? [id] : []` every call, so the array is a new
    // reference with identical contents. Under the reference compare every other field
    // uses, a second click on the same piece was an undo entry for nothing.
    vi.useFakeTimers();
    const stop = startHistoryRecording();
    try {
      const a = useScene.getState().parts[0].id;
      seedHistory();
      useStudio.getState().setSelected(a);
      await vi.advanceTimersByTimeAsync(300);
      expect(useHistory.getState().past).toHaveLength(2);

      useStudio.getState().setSelected(a);
      await vi.advanceTimersByTimeAsync(300);
      expect(useHistory.getState().past).toHaveLength(2);
    } finally {
      stop();
      vi.useRealTimers();
    }
  });

  it('a click after an undo does not overwrite the entry the undo restored', async () => {
    // `topIsSelectionOnly` describes an entry THIS stack pushed. After a restore the top
    // is an entry it did not push, so the flag is cleared rather than guessed at — the
    // one path by which coalescing could destroy history instead of compressing it.
    //
    // THE EDIT BELOW IS LOAD-BEARING and the first version of this test did not have it.
    // Undoing a two-click run leaves the stack one deep, and `push` refuses to coalesce
    // into a stack of one anyway (`past.length > 1`) — so deleting the flag reset from
    // `undo` changed nothing here and the mutation SURVIVED. A guard only runs in a
    // state the fixture has to build: the undo has to land on a stack still deep enough
    // for coalescing to be possible.
    vi.useFakeTimers();
    const stop = startHistoryRecording();
    try {
      const [a, b, c, d] = useScene.getState().parts.slice(0, 4).map((p) => p.id);
      seedHistory();
      useStudio.getState().setPosition(a, [2, 0, 2]);
      await vi.advanceTimersByTimeAsync(300);
      useStudio.getState().setSelected(b);
      await vi.advanceTimersByTimeAsync(300);
      useStudio.getState().setSelected(c);
      await vi.advanceTimersByTimeAsync(300);
      // baseline, the move, and one coalesced entry for both clicks
      expect(useHistory.getState().past).toHaveLength(3);

      applySnapshot(useHistory.getState().undo()!);
      await vi.advanceTimersByTimeAsync(300);
      const depthAfterUndo = useHistory.getState().past.length;
      expect(depthAfterUndo).toBe(2);

      useStudio.getState().setSelected(d);
      await vi.advanceTimersByTimeAsync(300);
      // Pushed beside the restored entry, not over it — the move is still reachable.
      expect(useHistory.getState().past.length).toBe(depthAfterUndo + 1);
      expect(useHistory.getState().past[1].positions[a]).toEqual([2, 0, 2]);
    } finally {
      stop();
      vi.useRealTimers();
    }
  });
});

// Both of these are what § H.10 meant by "a stored selection names part ids that a
// main-stack undo can make stale", plus the axis it did not name. The app’s own delete
// path keeps `parts` and `selection` consistent, so these snapshots are built by hand
// rather than driven through the UI — which is the point: a `Snapshot` is a plain
// object, and the guard exists for whoever writes the next producer of one.
describe('a restored selection is filtered, on both axes', () => {
  it('drops ids the restored room does not contain', () => {
    const parts = useScene.getState().parts;
    const alive = parts[0].id;
    const snap = snapshot({
      parts: [parts[0]],
      selection: [alive, 'ghost-1'],
      selectedPartId: 'ghost-1',
    });
    applySnapshot(snap);
    expect(useStudio.getState().selection).toEqual([alive]);
    // The primary named a piece that is not in the room, so it clears rather than
    // falling back to another one: the gizmo attaches to `selectedPartId` alone.
    expect(useStudio.getState().selectedPartId).toBeNull();
  });

  it('clears a wall index the restored footprint cannot reach', () => {
    // The sharper axis, and the one the write-up missed: `selectedWall` is an INDEX. A U
    // has eight edges and a rectangle four, so undoing across a layout change leaves a 7
    // pointing at nothing, and `WallInspector` is handed it directly.
    const room = useScene.getState().room;
    expect(room.footprint.length).toBeLessThan(8);
    applySnapshot(snapshot({ selectedWall: 7 }));
    // Cleared, not clamped: wall 3 of a rectangle is not the wall the user had.
    expect(useStudio.getState().selectedWall).toBeNull();
  });

  it('keeps a wall index the footprint does reach', () => {
    // The control. Without it the assertion above passes just as well against a filter
    // that clears every wall, which is a different feature.
    applySnapshot(snapshot({ selectedWall: 0 }));
    expect(useStudio.getState().selectedWall).toBe(0);
  });

  it('draws the line between the LAST wall and the one past it', () => {
    // 0 and 7 are both a long way from the edge, and that is exactly where this test
    // family sat until a sweep for the pattern found it: widening the bound to
    // `<= wallCount` — which admits index 4 in a four-walled room — left all 30 tests
    // green. A guard tested only far from its boundary is a guard tested nowhere near
    // the thing it decides.
    //
    // Both indices are DERIVED from the footprint rather than typed, so this keeps
    // meaning the same thing if a preset ever changes shape underneath it.
    const walls = useScene.getState().room.footprint.length;
    expect(walls, 'a room with no walls would make both cases vacuous').toBeGreaterThan(0);

    applySnapshot(snapshot({ selectedWall: walls - 1 }));
    expect(useStudio.getState().selectedWall, 'the last real wall survives').toBe(walls - 1);

    applySnapshot(snapshot({ selectedWall: walls }));
    expect(useStudio.getState().selectedWall, 'one past the last is not a wall').toBeNull();
  });

  it('clears a negative wall index', () => {
    // The other end of the same bound. `>= 0` is the half that a `> 0` slip would break,
    // and it is cheap to hold from both sides — a constant asserted from one end is free
    // at the other.
    applySnapshot(snapshot({ selectedWall: -1 }));
    expect(useStudio.getState().selectedWall).toBeNull();
  });
});

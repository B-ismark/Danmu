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
    ...over,
  };
}

beforeEach(() => {
  useHistory.setState({ past: [], future: [], suspended: false });
  // `hidden`/`parentIds` are not part of loadTransforms — applySnapshot
  // restores them through their own setters for the same reason, so reset
  // them the same way.
  useStudio.getState().loadTransforms({ positions: {}, rotations: {}, dims: {} });
  useStudio.getState().setHiddenMap({});
  useStudio.getState().setParentIds({});
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
        // And the entry underneath holds NEITHER. This is the assertion that
        // fails when a mid-drag snapshot slips in: `past[0]` would then carry the
        // member at [1,0,0] with `dragged` absent, and undoing to it is exactly
        // the reported symptom.
        expect(past[0].positions.dragged).toBeUndefined();
        expect(past[0].positions.member).toBeUndefined();
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

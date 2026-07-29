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
    parts: sc.parts,
    room: sc.room,
    lighting: t.lighting,
    hidden: t.hidden,
    ...over,
  };
}

beforeEach(() => {
  useHistory.setState({ past: [], future: [], suspended: false });
  // `hidden` is not part of loadTransforms — applySnapshot restores it through
  // setHiddenMap for the same reason, so reset it the same way.
  useStudio.getState().loadTransforms({ positions: {}, rotations: {}, dims: {} });
  useStudio.getState().setHiddenMap({});
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

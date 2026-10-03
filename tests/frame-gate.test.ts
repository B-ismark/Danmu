// `frameGate` — at most once a frame, and at once when nothing has run this frame.
//
// The Library drag's ghost used the trailing form (every dragover waits for the next
// animation frame), so the ghost stood where the pointer WAS. These hold the three
// properties the lag fix rests on, against a hand-cranked frame clock: the first event
// runs synchronously, a burst inside one frame collapses into ONE run with the newest
// arguments on the next frame, and cancel forgets a pending run.

import { describe, expect, it, vi } from 'vitest';
import { frameGate } from '@/lib/frame-gate';

function clock() {
  let next = 1;
  const queue = new Map<number, () => void>();
  return {
    raf: (cb: () => void) => {
      const id = next++;
      queue.set(id, cb);
      return id;
    },
    caf: (id: number) => void queue.delete(id),
    /** Run every callback queued before this frame began, as a browser does. */
    frame() {
      const due = [...queue.entries()];
      queue.clear();
      for (const [, cb] of due) cb();
    },
    pending: () => queue.size,
  };
}

describe('frameGate', () => {
  it('runs the first event of a frame AT ONCE, not on the next frame', () => {
    const c = clock();
    const run = vi.fn();
    const gate = frameGate(run, c.raf, c.caf);
    gate.call(1);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenLastCalledWith(1);
  });

  it('collapses a burst within one frame into one run, with the NEWEST arguments, next frame', () => {
    const c = clock();
    const run = vi.fn();
    const gate = frameGate(run, c.raf, c.caf);
    gate.call(1);
    gate.call(2);
    gate.call(3);
    expect(run).toHaveBeenCalledTimes(1);
    c.frame();
    expect(run).toHaveBeenCalledTimes(2);
    expect(run).toHaveBeenLastCalledWith(3);
    // That trailing run was the new frame's: one more event in it still waits.
    gate.call(4);
    expect(run).toHaveBeenCalledTimes(2);
    c.frame();
    expect(run).toHaveBeenLastCalledWith(4);
  });

  it('a quiet frame re-arms it: the next event after one runs at once again', () => {
    const c = clock();
    const run = vi.fn();
    const gate = frameGate(run, c.raf, c.caf);
    gate.call(1);
    c.frame(); // nothing pending: the gate opens
    expect(c.pending()).toBe(0);
    gate.call(2);
    expect(run).toHaveBeenCalledTimes(2);
    expect(run).toHaveBeenLastCalledWith(2);
  });

  it('runs at most once per frame however many events arrive', () => {
    const c = clock();
    const run = vi.fn();
    const gate = frameGate(run, c.raf, c.caf);
    for (let f = 0; f < 10; f++) {
      for (let i = 0; i < 7; i++) gate.call(f * 10 + i);
      c.frame();
    }
    // 10 frames: one leading run, then one trailing run per frame.
    expect(run).toHaveBeenCalledTimes(11);
  });

  it('cancel forgets a pending run — a drag that left or dropped leaves nothing behind', () => {
    const c = clock();
    const run = vi.fn();
    const gate = frameGate(run, c.raf, c.caf);
    gate.call(1);
    gate.call(2);
    gate.cancel();
    c.frame();
    expect(run).toHaveBeenCalledTimes(1);
    // And it is open again straight away.
    gate.call(3);
    expect(run).toHaveBeenLastCalledWith(3);
  });
});

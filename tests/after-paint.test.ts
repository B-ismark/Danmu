// The whole value of `afterPaint` is an ordering, so every assertion here is about
// WHEN the callback runs and nothing else. Two of them exist because the obvious
// implementations pass the other one: running synchronously passes "runs exactly
// once", and a single `requestAnimationFrame` passes "not synchronous" while still
// blocking the paint it was added to wait for.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { afterPaint } from '@/lib/after-paint';

type Raf = (cb: FrameRequestCallback) => number;

/** Install a fake rAF that queues callbacks instead of running them, so a test
 *  can step frame by frame. Returns the queue and a `frame()` that drains exactly
 *  one frame's worth — callbacks registered DURING a frame wait for the next one,
 *  which is the property the two-frame yield depends on. */
function fakeRaf() {
  let queue: FrameRequestCallback[] = [];
  const raf: Raf = (cb) => {
    queue.push(cb);
    return queue.length;
  };
  const frame = () => {
    const due = queue;
    queue = [];
    for (const cb of due) cb(0);
    return due.length;
  };
  return { raf, frame, pending: () => queue.length };
}

const realRaf = globalThis.requestAnimationFrame;

afterEach(() => {
  if (realRaf) globalThis.requestAnimationFrame = realRaf;
  else delete (globalThis as { requestAnimationFrame?: Raf }).requestAnimationFrame;
  vi.useRealTimers();
});

describe('afterPaint', () => {
  it('never runs the callback synchronously', () => {
    const { raf } = fakeRaf();
    globalThis.requestAnimationFrame = raf as typeof globalThis.requestAnimationFrame;
    const ran = vi.fn();
    afterPaint(ran);
    expect(ran).not.toHaveBeenCalled();
  });

  it('waits for a SECOND frame, so the first frame is free to paint', () => {
    const { raf, frame } = fakeRaf();
    globalThis.requestAnimationFrame = raf as typeof globalThis.requestAnimationFrame;
    const ran = vi.fn();
    afterPaint(ran);

    // Frame one: a rAF callback runs BEFORE that frame is presented, so doing the
    // work here would block the very paint the caller is waiting for. This is the
    // assertion that fails if the two frames are collapsed into one, and it is the
    // only reason this module exists rather than a bare `requestAnimationFrame`.
    expect(frame()).toBe(1);
    expect(ran).not.toHaveBeenCalled();

    // Frame two: the first frame has been presented, so the busy state is on
    // screen and the thread may now be blocked.
    frame();
    expect(ran).toHaveBeenCalledTimes(1);
  });

  it('runs exactly once, not once per frame', () => {
    const { raf, frame } = fakeRaf();
    globalThis.requestAnimationFrame = raf as typeof globalThis.requestAnimationFrame;
    const ran = vi.fn();
    afterPaint(ran);
    frame();
    frame();
    frame();
    frame();
    expect(ran).toHaveBeenCalledTimes(1);
  });

  it('falls back to a timer where there is no rAF at all', () => {
    vi.useFakeTimers();
    delete (globalThis as { requestAnimationFrame?: Raf }).requestAnimationFrame;
    const ran = vi.fn();
    afterPaint(ran);
    // Still not synchronous — that is the half of the contract that survives when
    // there is no paint to wait for.
    expect(ran).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(ran).toHaveBeenCalledTimes(1);
  });

  it('does not reach for a timer when rAF is available', () => {
    vi.useFakeTimers();
    const { raf, frame } = fakeRaf();
    globalThis.requestAnimationFrame = raf as typeof globalThis.requestAnimationFrame;
    const ran = vi.fn();
    afterPaint(ran);
    // A belt-and-braces implementation that scheduled both would run the work on
    // whichever fired first, which is the timer — i.e. before the paint, i.e. the
    // bug this module is here to prevent.
    expect(vi.getTimerCount()).toBe(0);
    frame();
    frame();
    expect(ran).toHaveBeenCalledTimes(1);
  });
});

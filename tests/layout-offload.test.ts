// The arranging worker's page side: same answer as the direct call on every path,
// and no path on which a press waits forever.
//
// Node has no `Worker`, so the worker is stood in for by `FakeWorker`, which runs
// the REAL `lib/layout.worker.ts` handler and passes both directions through
// `structuredClone` — the same algorithm `postMessage` uses. That is the half a
// same-thread test could not see: a result carrying a function or a class instance
// would pass a direct call and throw `DataCloneError` across a real thread.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { lockedForSolve, solveLayout } from '@/lib/layout-solve';
import { lockedForShuffle, shuffleRoom } from '@/lib/layout-shuffle';
import type { LayoutRequest, LayoutResponse } from '@/lib/layout-worker-protocol';
import { defaultScene } from '@/lib/scene-spec';
import { footprintForLayout } from '@/lib/footprint';

// Every floor piece turned a quarter, so the room is wrong enough that a solve
// moves things and the comparison is over a real answer rather than "nothing".
const parts = defaultScene('t', 6, 5).map((p) => (p.wallMounted ? p : { ...p, rot: p.rot + Math.PI / 2 }));
const footprint = footprintForLayout('t', 6, 5);
const room = { footprint, height: 2.6 };
const solveArgs = { parts, footprint, locked: lockedForSolve(parts, {}, null), opts: { seed: 3, mode: 'arrange' as const } };
const shuffleArgs = { parts, room, locked: lockedForShuffle(parts, {}), opts: { attempt: 1, history: [] } };

type Mode = 'real' | 'throw-on-construct' | 'error-after-post' | 'reply-error';
let mode: Mode = 'real';
let constructed = 0;
let handler: ((e: { data: LayoutRequest }) => void) | null = null;

class FakeWorker {
  onmessage: ((e: { data: LayoutResponse }) => void) | null = null;
  onerror: ((e: { message: string }) => void) | null = null;
  onmessageerror: ((e: unknown) => void) | null = null;
  constructor() {
    constructed++;
    if (mode === 'throw-on-construct') throw new Error('no module workers here');
  }
  postMessage(req: LayoutRequest) {
    const data = structuredClone(req);
    // Odd ids answer later than even ones, so two requests in flight are answered
    // out of order — which is what makes "matched by id" testable at all.
    setTimeout(() => {
      if (mode === 'error-after-post') return this.onerror?.({ message: 'chunk failed to load' });
      if (mode === 'reply-error') return this.onmessage?.({ data: { id: data.id, ok: false, error: 'solver threw' } });
      handler!({ data });
    }, data.id % 2 ? 20 : 0);
  }
  /** Where the worker module's `self.postMessage` lands. */
  deliver(res: LayoutResponse) {
    this.onmessage?.({ data: structuredClone(res) });
  }
  terminate() {}
}

/** The worker the page constructed — the one the stubbed `self.postMessage` answers through. */
const instances: FakeWorker[] = [];
const live = () => instances[instances.length - 1];

beforeEach(async () => {
  vi.resetModules();
  mode = 'real';
  constructed = 0;
  // The worker module assigns `self.onmessage` and calls `self.postMessage`.
  const self = {
    onmessage: null as unknown,
    postMessage: (res: LayoutResponse) => live().deliver(res),
  };
  vi.stubGlobal('self', self);
  vi.stubGlobal(
    'Worker',
    class extends FakeWorker {
      constructor() {
        super();
        instances.push(this);
      }
    },
  );
  await import('@/lib/layout.worker');
  handler = self.onmessage as typeof handler;
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  instances.length = 0;
});

describe('solveOffThread / shuffleOffThread', () => {
  it('a solve through the worker is the direct answer, after a structured clone both ways', async () => {
    const { solveOffThread } = await import('@/lib/layout-offload');
    const direct = solveLayout(solveArgs.parts, solveArgs.footprint, solveArgs.locked, solveArgs.opts);
    expect(direct.moved.length).toBeGreaterThan(0); // a real answer, not an empty one
    await expect(solveOffThread(solveArgs)).resolves.toEqual(direct);
    expect(constructed).toBe(1);
  });

  it('a shuffle through the worker is the direct answer', async () => {
    const { shuffleOffThread } = await import('@/lib/layout-offload');
    const direct = shuffleRoom(shuffleArgs.parts, shuffleArgs.room, shuffleArgs.locked, shuffleArgs.opts);
    expect(direct).not.toBeNull();
    await expect(shuffleOffThread(shuffleArgs)).resolves.toEqual(direct);
  });

  it('one worker serves every press', async () => {
    const { solveOffThread } = await import('@/lib/layout-offload');
    await solveOffThread(solveArgs);
    await solveOffThread({ ...solveArgs, opts: { ...solveArgs.opts, seed: 4 } });
    expect(constructed).toBe(1);
  });

  it('concurrent requests are answered by id, not by arrival', async () => {
    const { solveOffThread } = await import('@/lib/layout-offload');
    const a = { ...solveArgs, opts: { ...solveArgs.opts, seed: 1 } };
    const b = { ...solveArgs, opts: { ...solveArgs.opts, seed: 2 } };
    const [ra, rb] = await Promise.all([solveOffThread(a), solveOffThread(b)]);
    expect(ra).toEqual(solveLayout(a.parts, a.footprint, a.locked, a.opts));
    expect(rb).toEqual(solveLayout(b.parts, b.footprint, b.locked, b.opts));
  });

  it('with no Worker at all, it runs inline and still answers', async () => {
    vi.stubGlobal('Worker', undefined);
    const { solveOffThread } = await import('@/lib/layout-offload');
    await expect(solveOffThread(solveArgs)).resolves.toEqual(
      solveLayout(solveArgs.parts, solveArgs.footprint, solveArgs.locked, solveArgs.opts),
    );
  });

  it('a worker that cannot be constructed falls back inline, and is not retried', async () => {
    mode = 'throw-on-construct';
    const { solveOffThread } = await import('@/lib/layout-offload');
    const direct = solveLayout(solveArgs.parts, solveArgs.footprint, solveArgs.locked, solveArgs.opts);
    await expect(solveOffThread(solveArgs)).resolves.toEqual(direct);
    await expect(solveOffThread(solveArgs)).resolves.toEqual(direct);
    expect(constructed).toBe(1);
  });

  it('a worker that errors mid-request answers that request inline rather than leaving it pending', async () => {
    mode = 'error-after-post';
    const { solveOffThread } = await import('@/lib/layout-offload');
    await expect(solveOffThread(solveArgs)).resolves.toEqual(
      solveLayout(solveArgs.parts, solveArgs.footprint, solveArgs.locked, solveArgs.opts),
    );
    // …and the next press does not try the broken worker again.
    mode = 'real';
    await solveOffThread(solveArgs);
    expect(constructed).toBe(1);
  });

  it('a solver that throws inside the worker rejects, so the error still surfaces', async () => {
    mode = 'reply-error';
    const { solveOffThread } = await import('@/lib/layout-offload');
    await expect(solveOffThread(solveArgs)).rejects.toThrow('solver threw');
  });
});

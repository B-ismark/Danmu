// When the canvas veil may lift: once a frame has been drawn, not when one begins.
// See lib/first-frame.ts for the dark-canvas report this answers.
import { describe, expect, it } from 'vitest';
import { firstFrameWatch, GRACE_MS, STRIKES } from '@/lib/first-frame';

function rig() {
  const log: string[] = [];
  const nextQ: (() => void)[] = [];
  const timers: { f: () => void; ms: number }[] = [];
  const w = firstFrameWatch({
    drawn: () => log.push('drawn'),
    failed: () => log.push('failed'),
    nudge: () => log.push('nudge'),
    next: (f) => nextQ.push(f),
    later: (f, ms) => timers.push({ f, ms }),
  });
  const flush = () => nextQ.splice(0).forEach((f) => f());
  const fire = () => timers.splice(0).forEach((t) => t.f());
  return { w, log, flush, fire, timers };
}

describe('the first frame', () => {
  it('a frame that starts is not yet drawn; one the browser moves past cleanly is', () => {
    const r = rig();
    r.w.frame();
    expect(r.log).toEqual([]);
    r.flush();
    expect(r.log).toEqual(['drawn']);
    r.w.frame();
    r.flush();
    expect(r.log).toEqual(['drawn']);
  });

  it('a frame that threw, with a loop that never runs again, is reported — not uncovered', () => {
    const r = rig();
    r.w.frame();
    r.w.error();
    r.flush();
    expect(r.log).toEqual(['nudge']);
    expect(r.timers.map((t) => t.ms)).toEqual([GRACE_MS]);
    r.fire();
    expect(r.log).toEqual(['nudge', 'failed']);
  });

  it('an unrelated error in a loop that is alive does not fail it: the next clean frame lifts the veil', () => {
    const r = rig();
    r.w.frame();
    r.w.error();
    r.flush();
    r.w.frame();
    r.flush();
    r.fire();
    expect(r.log).toEqual(['nudge', 'drawn']);
  });

  it('a loop that drew again inside the grace is alive, even when its check has not landed yet', () => {
    const r = rig();
    r.w.frame();
    r.w.error();
    r.flush();
    r.w.frame();
    r.fire();
    expect(r.log).toEqual(['nudge']);
    r.flush();
    expect(r.log).toEqual(['nudge', 'drawn']);
  });

  it('a loop that keeps running and keeps throwing is a failure too — the crash that was actually seen', () => {
    const r = rig();
    for (let i = 0; i < STRIKES; i++) {
      r.w.frame();
      r.w.error();
      r.flush();
    }
    expect(r.log.at(-1)).toBe('failed');
    expect(r.log.filter((x) => x === 'nudge')).toHaveLength(STRIKES - 1);
    r.fire();
    expect(r.log.filter((x) => x === 'failed')).toHaveLength(1);
  });
});

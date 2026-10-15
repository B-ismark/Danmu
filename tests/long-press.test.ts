import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createLongPress, armsLongPress, movedPastSlop, LONG_PRESS_MS } from '@/lib/long-press';

describe('long press', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const make = (enabled = true) => {
    const fire = vi.fn();
    return { fire, lp: createLongPress(fire, { enabled: () => enabled }) };
  };

  it('arms for touch only', () => {
    expect(armsLongPress('touch', true)).toBe(true);
    expect(armsLongPress('mouse', true)).toBe(false);
    expect(armsLongPress('pen', true)).toBe(false);
    expect(armsLongPress('touch', false)).toBe(false);
  });

  it('fires after the hold and swallows exactly the next click', () => {
    const { fire, lp } = make();
    lp.down(10, 10, 'touch');
    vi.advanceTimersByTime(LONG_PRESS_MS - 1);
    expect(fire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fire).toHaveBeenCalledTimes(1);
    expect(lp.consumeClick()).toBe(true);
    expect(lp.consumeClick()).toBe(false);
  });

  it('a short tap does not fire and its click is NOT swallowed', () => {
    const { fire, lp } = make();
    lp.down(0, 0, 'touch');
    vi.advanceTimersByTime(200);
    lp.cancel();
    vi.advanceTimersByTime(1000);
    expect(fire).not.toHaveBeenCalled();
    expect(lp.consumeClick()).toBe(false);
  });

  it('moving more than 8px cancels; 8px exactly does not', () => {
    expect(movedPastSlop(8, 0)).toBe(false);
    expect(movedPastSlop(6, 6)).toBe(true);
    const a = make();
    a.lp.down(0, 0, 'touch');
    a.lp.move(8, 0);
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(a.fire).toHaveBeenCalledTimes(1);
    const b = make();
    b.lp.down(0, 0, 'touch');
    b.lp.move(0, 9);
    vi.advanceTimersByTime(LONG_PRESS_MS * 2);
    expect(b.fire).not.toHaveBeenCalled();
    expect(b.lp.consumeClick()).toBe(false);
  });

  it('never arms for a mouse, so a held click on a draggable row is untouched', () => {
    const { fire, lp } = make();
    lp.down(0, 0, 'mouse');
    vi.advanceTimersByTime(5000);
    expect(fire).not.toHaveBeenCalled();
    expect(lp.consumeClick()).toBe(false);
  });

  it('does not arm when the host cannot mark', () => {
    const { fire, lp } = make(false);
    lp.down(0, 0, 'touch');
    vi.advanceTimersByTime(5000);
    expect(fire).not.toHaveBeenCalled();
  });

  it('a fired hold whose click never came cannot eat the next tap', () => {
    const { lp } = make();
    lp.down(0, 0, 'touch');
    vi.advanceTimersByTime(LONG_PRESS_MS);
    lp.down(0, 0, 'touch');
    lp.cancel();
    expect(lp.consumeClick()).toBe(false);
  });
});

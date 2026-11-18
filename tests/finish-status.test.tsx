// @vitest-environment jsdom
//
// What the finish status line says, and when. A quick build says nothing at all —
// not on screen, not to a screen reader — and a slow one is closed out loud, because
// emptying a live region announces nothing.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { clearPending, markPending } from '@/lib/finish-loading';
import { FinishStatus, SAY_AFTER_MS } from '@/components/studio/FinishStatus';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('the finish status line', () => {
  it('says nothing about a build that finishes inside the beat', () => {
    vi.useFakeTimers();
    render(<FinishStatus channel="floor" saying="Laying the new floor…" done="Floor laid" />);
    const region = screen.getByRole('status');
    act(() => markPending('floor', 'a'));
    act(() => vi.advanceTimersByTime(SAY_AFTER_MS - 50));
    expect(region.textContent).toBe('');
    act(() => clearPending('floor', 'a'));
    act(() => vi.advanceTimersByTime(SAY_AFTER_MS * 4));
    expect(region.textContent).toBe('');
  });

  it('says a slow build, then says it finished, then goes quiet', () => {
    vi.useFakeTimers();
    render(<FinishStatus channel="floor" saying="Laying the new floor…" done="Floor laid" />);
    const region = screen.getByRole('status');
    act(() => markPending('floor', 'b'));
    act(() => vi.advanceTimersByTime(SAY_AFTER_MS + 10));
    expect(region.textContent).toBe('Laying the new floor…');
    act(() => clearPending('floor', 'b'));
    expect(region.textContent).toBe('Floor laid');
    act(() => vi.advanceTimersByTime(5000));
    expect(region.textContent).toBe('');
  });
});

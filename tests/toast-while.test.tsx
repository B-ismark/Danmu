// @vitest-environment jsdom
//
// The working toast: said only when work is slow enough to need it, and gone when it
// ends, whichever way it ends. A card that flashes for one frame before the result
// replaces it is flicker; a card left up after the work failed is a spinner that
// never stops.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';

vi.mock('next/navigation', async () => (await import('./helpers/mount')).navigationMock('toast-room'));

const { StorageToast, toastWhile, SAY_WORKING_AFTER_MS } = await import('@/components/ui/StorageToast');

const later = <T,>(ms: number, value: T, fail = false) =>
  new Promise<T>((resolve, reject) => setTimeout(() => (fail ? reject(new Error('nope')) : resolve(value)), ms));

beforeEach(() => {
  vi.useFakeTimers();
  render(<StorageToast />);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('toastWhile', () => {
  it('says nothing about work that finishes quickly', async () => {
    let done = false;
    void toastWhile({ title: 'Arranging your room…' }, () => later(SAY_WORKING_AFTER_MS - 50, 1)).then(() => (done = true));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SAY_WORKING_AFTER_MS + 200);
    });
    expect(done).toBe(true);
    expect(screen.queryByText('Arranging your room…')).toBeNull();
  });

  it('says it is working once the work is slow, and takes that down when it ends', async () => {
    const run = toastWhile({ title: 'Arranging your room…' }, () => later(SAY_WORKING_AFTER_MS * 3, 'answer'));
    // Still working, and not yet slow: nothing said.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SAY_WORKING_AFTER_MS - 10);
    });
    expect(screen.queryByText('Arranging your room…')).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20);
    });
    expect(screen.getByText('Arranging your room…')).toBeTruthy();
    // Inside the one live region, so it is announced as it appears.
    expect(screen.getByText('Arranging your room…').closest('[aria-live="polite"]')).not.toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SAY_WORKING_AFTER_MS * 3);
    });
    await expect(run).resolves.toBe('answer');
    expect(screen.queryByText('Arranging your room…')).toBeNull();
  });

  it('takes the working toast down when the work fails, and still fails', async () => {
    const run = toastWhile({ title: 'Re-fitting your room…' }, () => later(SAY_WORKING_AFTER_MS * 2, 0, true));
    const settled = run.catch((e: Error) => e.message);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SAY_WORKING_AFTER_MS + 10);
    });
    expect(screen.getByText('Re-fitting your room…')).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SAY_WORKING_AFTER_MS * 2);
    });
    expect(await settled).toBe('nope');
    expect(screen.queryByText('Re-fitting your room…')).toBeNull();
  });
});

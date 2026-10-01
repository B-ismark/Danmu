// @vitest-environment jsdom
//
// Settings' Back sits at the right end of the page heading and is always there. It
// used to sit above the heading on the left, and only when Settings knew where it
// was opened from, so a Settings opened from the rooms page had its one way out in
// the bar's far corner.
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }));
vi.mock('next/navigation', async () => (await import('./helpers/mount')).navigationMock(null, { router }));

const { default: SettingsPage } = await import('@/app/settings/page');

afterEach(() => {
  cleanup();
  router.push.mockClear();
  router.back.mockClear();
  window.history.replaceState(null, '', '/');
});

function open(address: string) {
  window.history.replaceState(null, '', address);
  render(<SettingsPage />);
}

describe("Settings' Back", () => {
  it('is there when Settings was opened from the rooms page, and goes to the rooms', () => {
    open('/settings');
    const back = screen.getByRole('button', { name: 'Back to your rooms' });
    fireEvent.click(back);
    // jsdom has no navigation timing, so the tab's start is unknown: by address.
    expect(router.push).toHaveBeenCalledWith('/');
    expect(router.back).not.toHaveBeenCalled();
  });

  it('names the place it was opened from, and goes there', () => {
    open('/settings?from=%2Fonboarding%2Fdetect');
    fireEvent.click(screen.getByRole('button', { name: 'Back to the scan' }));
    expect(router.push).toHaveBeenCalledWith('/onboarding/detect');
  });

  it('sits in the heading row, after the heading, and is the only Back', () => {
    open('/settings?from=%2Fonboarding%2Fdetect');
    const heading = screen.getByRole('heading', { level: 1, name: 'Settings' });
    const back = screen.getByRole('button', { name: 'Back to the scan' });
    const block = heading.parentElement!;
    const row = block.parentElement!;
    // In the row, beside the heading's block rather than inside it or above it.
    expect(back.parentElement).toBe(row);
    expect(block.contains(back)).toBe(false);
    expect(heading.compareDocumentPosition(back) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /^Back/ })).toHaveLength(1);
  });
});

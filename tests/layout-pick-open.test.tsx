// @vitest-environment jsdom
//
// The footprint page's two ways in. A click picks a shape and shows it; a double
// click starts that shape. The shortcut is offered in words only where there is a
// mouse to double-click with.
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }));
vi.mock('next/navigation', async () => (await import('./helpers/mount')).navigationMock(null, { router }));

import LayoutPickPage from '@/app/onboarding/layout-pick/page';
import { roomStore } from '@/lib/storage';
import { quietResizeObserver, viewportAt } from './helpers/mount';

// The preview measures itself; jsdom has no layout to measure, and none is needed here.
quietResizeObserver();

let restore: (() => void) | null = null;
afterEach(() => {
  cleanup();
  router.push.mockClear();
  restore?.();
  restore = null;
});

async function opened(): Promise<string> {
  await waitFor(() => expect(router.push).toHaveBeenCalledTimes(1));
  const href = router.push.mock.calls[0][0] as string;
  const id = /^\/room\/([^/]+)\/model$/.exec(href)?.[1];
  expect(id, `pushed ${href}`).toBeTruthy();
  return id!;
}

describe('the footprint page', () => {
  it('opens the shape a double click lands on', async () => {
    render(<LayoutPickPage />);
    const u = screen.getByRole('radio', { name: /^U-Shape/ });
    // What a browser sends for one double click: two clicks, then the dblclick.
    fireEvent.click(u);
    fireEvent.click(u);
    // The clicks only pick it.
    expect(u.getAttribute('aria-checked')).toBe('true');
    expect(router.push).not.toHaveBeenCalled();
    fireEvent.doubleClick(u);
    const room = await roomStore.loadRoom(await opened());
    expect(room?.layoutId).toBe('u');
    expect(room?.name).toBe('Bedroom');
  });

  it('starts the picked shape from the button', async () => {
    render(<LayoutPickPage />);
    fireEvent.click(screen.getByRole('radio', { name: /^T-Shape/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Start decorating/ }));
    const room = await roomStore.loadRoom(await opened());
    expect(room?.layoutId).toBe('t');
  });

  it('puts both ways on in one row', () => {
    // The row's own layout is CSS, asserted in tests/reflow.test.ts.
    render(<LayoutPickPage />);
    const start = screen.getByRole('button', { name: /^Start decorating/ });
    const photo = screen.getByRole('button', { name: /^Photograph my real room first/ });
    expect(start.parentElement).toBe(photo.parentElement);
    expect(start.parentElement?.classList.contains('action-row')).toBe(true);
  });

  it('arriving for photos, leads with the photo way in, and a double click follows it', async () => {
    // The empty Rooms page's "Photograph your room" lands here with ?then=photos.
    window.history.replaceState(null, '', '/onboarding/layout-pick?then=photos');
    try {
      render(<LayoutPickPage />);
      const photo = await screen.findByRole('button', { name: /^Photograph my real room first/ });
      await waitFor(() => expect(photo.className).toContain('ds-btn--accent'));
      const start = screen.getByRole('button', { name: /^Start decorating/ });
      expect(start.className).not.toContain('ds-btn--accent');
      // First in the DOM, so Tab and a screen reader meet it first too — not a
      // visual reorder over an unchanged source order.
      expect(photo.compareDocumentPosition(start) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      fireEvent.doubleClick(screen.getByRole('radio', { name: /^L-Shape/ }));
      await waitFor(() => expect(router.push).toHaveBeenCalledTimes(1));
      expect(router.push.mock.calls[0][0]).toBe('/onboarding/capture');
    } finally {
      window.history.replaceState(null, '', '/');
    }
  });

  it('arriving any other way, Start decorating leads', () => {
    render(<LayoutPickPage />);
    const photo = screen.getByRole('button', { name: /^Photograph my real room first/ });
    const start = screen.getByRole('button', { name: /^Start decorating/ });
    expect(start.className).toContain('ds-btn--accent');
    expect(start.compareDocumentPosition(photo) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('says double-click to a mouse, and not to a finger', () => {
    // Said on the shape card itself, as its tooltip, rather than in a standing
    // sentence over the row: the shortcut is told where it works.
    render(<LayoutPickPage />);
    const cards = screen.getAllByRole('radio');
    expect(cards.every((c) => /Double-click to start/.test(c.getAttribute('title') ?? ''))).toBe(true);
    cleanup();
    restore = viewportAt(390, { touch: true });
    render(<LayoutPickPage />);
    expect(screen.getAllByRole('radio').some((c) => c.hasAttribute('title'))).toBe(false);
    expect(screen.queryByText(/double-click/i)).toBeNull();
  });
});

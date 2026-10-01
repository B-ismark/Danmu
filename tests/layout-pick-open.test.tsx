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

  it('says double-click to a mouse, and not to a finger', () => {
    render(<LayoutPickPage />);
    expect(screen.getByText(/double-click it to start/)).toBeTruthy();
    cleanup();
    restore = viewportAt(390, { touch: true });
    render(<LayoutPickPage />);
    expect(screen.queryByText(/double-click/)).toBeNull();
    expect(screen.getByText('Pick one to see it below.')).toBeTruthy();
  });
});

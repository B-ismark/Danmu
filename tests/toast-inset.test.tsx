// @vitest-environment jsdom
//
// An add's fit result must stand clear of the open Library card. The card publishes its
// left edge; the toast host reads it. Both halves are asserted, because either alone
// passes while the toast still prints on the list.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';

vi.mock('next/navigation', async () => (await import('./helpers/mount')).navigationMock('toast-inset-room'));

const { StorageToast, toast } = await import('@/components/ui/StorageToast');
const { publishToastInset, toastInsetFor, TOAST_INSET_VAR, TOAST_EDGE_PX } = await import('@/lib/toast-inset');

afterEach(() => {
  cleanup();
  document.documentElement.style.removeProperty(TOAST_INSET_VAR);
});

describe('toast inset', () => {
  it('clears a card docked at the right of a 1280px window', () => {
    // Card 268px wide, 12px from a 1280 canvas edge at x=1280 -> left 1000.
    expect(toastInsetFor(1000, 1280)).toBe(280 + TOAST_EDGE_PX);
  });

  it('never squeezes the host below a readable width', () => {
    expect(toastInsetFor(20, 600)).toBe(600 - 200 - TOAST_EDGE_PX);
    expect(toastInsetFor(900, 600)).toBe(TOAST_EDGE_PX);
  });

  it('publishes while the card is open and restores the resting margin when it closes', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    el.getBoundingClientRect = () => ({ left: window.innerWidth - 300 }) as DOMRect;
    const stop = publishToastInset(el);
    expect(document.documentElement.style.getPropertyValue(TOAST_INSET_VAR)).toBe('316px');
    stop();
    expect(document.documentElement.style.getPropertyValue(TOAST_INSET_VAR)).toBe('');
  });

  it('has the toast host read that variable for its right edge', () => {
    render(<StorageToast />);
    act(() => {
      toast({ title: 'Sofa added', message: 'It goes in, but it is tight.' });
    });
    const host = document.querySelector('[role="status"]') as HTMLElement;
    expect(host.style.right).toContain(TOAST_INSET_VAR);
  });
});

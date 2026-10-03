// @vitest-environment jsdom
//
// "Typical sizes" is a floating callout beside the Room section's size fields, not a
// note inside the section. This holds the four things that make it that: it shows only
// for a rough room that has loaded, it can be sent away (for that room, for the
// session), "These are right" is still a real answer, and the old inline note is gone.
//
// jsdom has no layout, so the anchor's rect is given by hand — which is also what
// lets the "anchor not visible" case be a rect of zero rather than an assertion about
// a stylesheet.
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useScene } from '@/lib/scene-store';
import type { RoomData } from '@/lib/storage';
import { viewportAt } from './helpers/mount';

const h = vi.hoisted(() => ({ id: 'rough-a' }));
vi.mock('next/navigation', async () => {
  const nav = (await import('./helpers/mount')).navigationMock('rough-a', 'model');
  return { ...nav, useParams: () => ({ roomId: h.id }) };
});

const { RoomDimsEditor } = await import('@/components/studio/RoomDimsEditor');

let nextId = 0;
function open(rough: boolean) {
  h.id = `rough-${nextId++}`;
  useScene.getState().loadFromRoom({
    id: h.id, createdAt: 0, name: 'R', layoutId: 'rect', width: 4, depth: 3.5, height: 2.6, ...(rough ? { roughSize: true } : {}),
  } as RoomData);
  useScene.getState().setHydrated(h.id);
}

const callout = () => document.querySelector('.rough-callout');
const dismiss = () => screen.queryByRole('button', { name: 'Dismiss' });
const confirm = () => screen.queryByRole('button', { name: 'These are right' });

let rect = { top: 100, bottom: 200, left: 20, right: 240, width: 220, height: 100 };
const realRect = Element.prototype.getBoundingClientRect;
beforeEach(() => {
  cleanup();
  rect = { top: 100, bottom: 200, left: 20, right: 240, width: 220, height: 100 };
  Element.prototype.getBoundingClientRect = function (this: Element) {
    if (this.hasAttribute('data-room-dims')) return { ...rect, x: rect.left, y: rect.top, toJSON: () => ({}) } as DOMRect;
    return realRect.call(this);
  };
});
afterEach(() => {
  Element.prototype.getBoundingClientRect = realRect;
});

describe('the rough-size callout', () => {
  it('shows for a rough room, with a Dismiss and a "These are right"', () => {
    open(true);
    render(<RoomDimsEditor />);
    expect(callout()).not.toBeNull();
    expect(screen.getByText('These are typical sizes')).toBeTruthy();
    expect(dismiss()).not.toBeNull();
    expect(confirm()).not.toBeNull();
  });

  it('is not inside the rail section any more', () => {
    open(true);
    const { container } = render(<RoomDimsEditor />);
    expect(container.querySelector('.rough-note')).toBeNull();
    expect(container.textContent).not.toContain('Typical sizes');
    // It is portalled out of the rail, which would clip it.
    expect(container.querySelector('.rough-callout')).toBeNull();
    expect(document.body.querySelector('.rough-callout')).not.toBeNull();
  });

  it('does not render for a room with a size of its own', () => {
    open(false);
    render(<RoomDimsEditor />);
    expect(callout()).toBeNull();
  });

  it('does not render before the room has loaded', () => {
    open(true);
    useScene.getState().setHydrated(null);
    render(<RoomDimsEditor />);
    expect(callout()).toBeNull();
  });

  it('is hidden while the size fields are not visible', () => {
    open(true);
    // A collapsed rail keeps the row's height and loses its width (or the reverse).
    rect = { top: 100, bottom: 200, left: 20, right: 20, width: 0, height: 100 };
    render(<RoomDimsEditor />);
    expect(callout()).toBeNull();
  });

  it('is hidden while the size fields are scrolled out of view', () => {
    open(true);
    rect = { top: -300, bottom: -200, left: 20, right: 240, width: 220, height: 100 };
    render(<RoomDimsEditor />);
    expect(callout()).toBeNull();
  });

  it('Dismiss hides it, and it stays hidden on a re-render of the same room', () => {
    open(true);
    const { rerender } = render(<RoomDimsEditor />);
    fireEvent.click(dismiss()!);
    expect(callout()).toBeNull();
    rerender(<RoomDimsEditor />);
    expect(callout()).toBeNull();
    cleanup();
    render(<RoomDimsEditor />);
    expect(callout()).toBeNull();
    // Dismissing does not answer the question: the room is still rough.
    expect(useScene.getState().room.roughSize).toBe(true);
  });

  it('a dismissal belongs to the room, not to the session', () => {
    open(true);
    render(<RoomDimsEditor />);
    fireEvent.click(dismiss()!);
    cleanup();
    open(true);
    render(<RoomDimsEditor />);
    expect(callout()).not.toBeNull();
  });

  it('Escape closes it', () => {
    open(true);
    render(<RoomDimsEditor />);
    fireEvent.keyDown(confirm()!, { key: 'Escape' });
    expect(callout()).toBeNull();
  });

  it('does not take focus on mount', () => {
    open(true);
    render(<RoomDimsEditor />);
    expect(callout()!.contains(document.activeElement)).toBe(false);
  });

  it('"These are right" confirms the size and the callout goes', () => {
    open(true);
    render(<RoomDimsEditor />);
    fireEvent.click(confirm()!);
    expect(useScene.getState().room.roughSize).toBeUndefined();
    expect(callout()).toBeNull();
  });

  it('typing a size takes it away without a dismissal', () => {
    open(true);
    render(<RoomDimsEditor />);
    act(() => useScene.getState().setRoom({ width: 4.4, depth: 3.5, height: 2.6 }));
    expect(callout()).toBeNull();
  });

  it('is a card at the top of the screen on a phone, still with its close button', () => {
    const restore = viewportAt(390, { touch: true });
    try {
      open(true);
      rect = { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 }; // no anchor needed
      render(<RoomDimsEditor />);
      expect(callout()!.classList.contains('rough-callout--phone')).toBe(true);
      expect(dismiss()).not.toBeNull();
    } finally {
      restore();
    }
  });
});

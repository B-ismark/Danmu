// @vitest-environment jsdom
//
// Ctrl/Cmd + \ puts everything but the room away, Figma's binding for the same idea.
//
// Mounted through the real studio layout around the real plan page, because what is
// under test is the FRAME — the top bar the layout owns, the rails the shell owns,
// the floating chrome the page owns — and a harness that re-assembled those would be
// testing its own assembly.
//
// Every piece of chrome hides itself with an INLINE `display: none`, and that is
// what this asserts. A stylesheet rule was the first version for the floating
// clusters, and the browser showed it doing nothing: their `display: flex` is inline,
// which no selector outranks — and jsdom applies no stylesheet, so a test here could
// not have told. What it still cannot see is layout: the room actually taking the full
// width is a browser item (`docs/visual-check.md`).
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { useStudio } from '@/lib/store';
import { STUDIO_SURFACE_ID } from '@/components/studio/KeyboardShortcuts';
import { STUDIO_CANVAS_ID } from '@/components/studio/CatalogPanel';
import { RAIL_ID } from '@/components/studio/shells/DockedShell';
import { isHideInterfaceKey } from '@/lib/hide-interface';
import { viewportAt } from './helpers/mount';

vi.mock('next/navigation', async () => (await import('./helpers/mount')).navigationMock('hide-interface-room'));
vi.mock('@/components/three/RoomHost', () => ({ RoomHostProvider: () => null, RoomSlot: () => null, useRoomHost: () => null }));

const { default: PlanPageAlone } = await import('@/app/room/[roomId]/plan/page');
const { default: StudioLayout } = await import('@/app/room/[roomId]/layout');
function Studio() {
  return (
    <StudioLayout>
      <PlanPageAlone />
    </StudioLayout>
  );
}

let restore: () => void = () => {};
beforeEach(() => {
  cleanup();
  useStudio.setState({ uiHidden: false, catalogOpen: false, railLeftOpen: true, railRightOpen: true });
});
afterEach(() => restore());

const surface = () => document.getElementById(STUDIO_SURFACE_ID)!;
const hideKey = (target: Element = surface(), init: KeyboardEventInit = {}) =>
  fireEvent.keyDown(target, { key: '\\', code: 'Backslash', ctrlKey: true, ...init });
// The laptop bar is a div, not a <header>; its breadcrumb is the landmark it carries.
const topBar = () => screen.queryByRole('navigation', { name: 'Breadcrumb' });
const showButton = () => screen.queryByRole('button', { name: /Show interface/ });
/** The floating clusters over the canvas, and whether each is out of sight. */
const floating = () => Array.from(document.querySelectorAll<HTMLElement>('.canvas-chrome'));

describe('the shortcut itself', () => {
  it('is Ctrl or Cmd with the backslash key, by character or by physical key', () => {
    expect(isHideInterfaceKey({ key: '\\', code: 'Backslash', ctrlKey: true, metaKey: false, altKey: false })).toBe(true);
    expect(isHideInterfaceKey({ key: '\\', code: 'Backslash', ctrlKey: false, metaKey: true, altKey: false })).toBe(true);
    // A layout where the physical key types something else: the key is still the key.
    expect(isHideInterfaceKey({ key: '#', code: 'Backslash', ctrlKey: true, metaKey: false, altKey: false })).toBe(true);
  });

  it('is not the bare key, and not AltGr — which is how some layouts TYPE a backslash', () => {
    expect(isHideInterfaceKey({ key: '\\', code: 'Backslash', ctrlKey: false, metaKey: false, altKey: false })).toBe(false);
    expect(isHideInterfaceKey({ key: '\\', code: 'Minus', ctrlKey: true, metaKey: false, altKey: true })).toBe(false);
    expect(isHideInterfaceKey({ key: ']', code: 'BracketRight', ctrlKey: true, metaKey: false, altKey: false })).toBe(false);
  });
});

describe('on a laptop, rails beside the room', () => {
  beforeEach(() => {
    restore = viewportAt(1440);
  });

  it('puts the top bar and both rails away, and brings them back', () => {
    render(<Studio />);
    // Everything is there to begin with, or "gone" below is free.
    expect(topBar()).not.toBeNull();
    expect(document.getElementById(RAIL_ID.left)!.style.display).not.toBe('none');
    expect(showButton()).toBeNull();

    hideKey();
    expect(useStudio.getState().uiHidden).toBe(true);
    expect(topBar(), 'the top bar').toBeNull();
    expect(document.getElementById(RAIL_ID.left)!.style.display, 'the left rail').toBe('none');
    expect(document.getElementById(RAIL_ID.right)!.style.display, 'the right rail').toBe('none');
    // With both rails out of the grid, the room is the one column there is.
    const grid = document.getElementById(RAIL_ID.left)!.parentElement!;
    expect(grid.style.gridTemplateColumns).toBe('1fr');
    // The floating clusters over the canvas: tools, view controls, the aide.
    expect(floating().length, 'there were clusters to hide').toBeGreaterThan(1);
    expect(floating().map((el) => el.style.display)).toEqual(floating().map(() => 'none'));
    expect(showButton(), 'the way back, for a hand without a keyboard').not.toBeNull();

    hideKey();
    expect(useStudio.getState().uiHidden).toBe(false);
    expect(topBar()).not.toBeNull();
    expect(document.getElementById(RAIL_ID.left)!.style.display).not.toBe('none');
    expect(floating().some((el) => el.style.display === 'none')).toBe(false);
    expect(showButton()).toBeNull();
  });

  it('puts an open Library card away too, and it is still open when the interface returns', () => {
    useStudio.setState({ catalogOpen: true });
    render(<Studio />);
    const card = () => screen.getByText('Library').closest('.ds-card') as HTMLElement;
    expect(card().style.display).not.toBe('none');
    hideKey();
    expect(card().style.display).toBe('none');
    expect(useStudio.getState().catalogOpen, 'hidden, not closed').toBe(true);
    hideKey();
    expect(card().style.display).not.toBe('none');
  });

  it('never remounts the room: the same canvas element before, during and after', () => {
    // The whole reason the rails are display:none rather than unrendered — the
    // camera, the plan's zoom and a half-typed field all live under these nodes.
    render(<Studio />);
    const before = document.getElementById(STUDIO_CANVAS_ID);
    const leftBefore = document.getElementById(RAIL_ID.left);
    expect(before).not.toBeNull();
    hideKey();
    expect(document.getElementById(STUDIO_CANVAS_ID)).toBe(before);
    hideKey();
    expect(document.getElementById(STUDIO_CANVAS_ID)).toBe(before);
    expect(document.getElementById(RAIL_ID.left), 'nor the rail and what is in it').toBe(leftBefore);
  });

  it('works from inside a rail’s text field, and hands the keys back to the room', () => {
    render(<Studio />);
    const field = document.getElementById(RAIL_ID.left)!.querySelector('input');
    expect(field, 'a field in the rail to type in').not.toBeNull();
    field!.focus();
    hideKey(field!);
    expect(useStudio.getState().uiHidden).toBe(true);
    expect(document.activeElement, 'focus left the field that just went away').toBe(surface());
  });

  it('the Show interface button brings it all back, and leaves the keyboard on the room', () => {
    render(<Studio />);
    hideKey();
    fireEvent.click(showButton()!);
    expect(useStudio.getState().uiHidden).toBe(false);
    expect(topBar()).not.toBeNull();
    expect(document.activeElement).toBe(surface());
  });

  it('the View menu offers it, for someone who does not know the key', () => {
    render(<Studio />);
    fireEvent.click(screen.getByRole('button', { name: 'View settings' }));
    fireEvent.click(screen.getByRole('button', { name: /Hide interface/ }));
    expect(useStudio.getState().uiHidden).toBe(true);
    expect(topBar()).toBeNull();
  });

  it('is cleared when the room is left, so the next one does not open bare', () => {
    const { unmount } = render(<Studio />);
    hideKey();
    unmount();
    expect(useStudio.getState().uiHidden).toBe(false);
  });
});

describe('on a phone, toolbar and sheet', () => {
  beforeEach(() => {
    restore = viewportAt(390, { touch: true });
  });

  it('puts the toolbar and the sheet away, and keeps them mounted', () => {
    render(<Studio />);
    const toolbar = screen.getByRole('navigation', { name: 'Studio' });
    const sheet = document.getElementById('studio-sheet')!;
    expect(toolbar.style.display).not.toBe('none');

    hideKey();
    expect(toolbar.style.display).toBe('none');
    expect(sheet.style.display).toBe('none');
    expect(showButton(), 'a phone has no Ctrl key, so this is its only way back').not.toBeNull();

    fireEvent.click(showButton()!);
    expect(screen.getByRole('navigation', { name: 'Studio' })).toBe(toolbar);
    expect(toolbar.style.display).not.toBe('none');
  });
});

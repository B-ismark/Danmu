// @vitest-environment jsdom
//
// The View controls (floor grid, decor, sounds, quality) left the right rail for a
// gear in the top bar. They were set once and never touched again, and they sat below
// the selected piece's panel, where they took space from the thing people came to
// edit. Two homes now and only two: the gear's popover on a laptop or tablet, and the
// phone toolbar's own View sheet, where there is no top-bar room for a gear.
import 'fake-indexeddb/auto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useStudio } from '@/lib/store';
import { useScene } from '@/lib/scene-store';
import type { ScenePart } from '@/lib/scene-spec';
import { viewportAt } from './helpers/mount';
import { stripComments } from './helpers/source';

vi.mock('next/navigation', async () => (await import('./helpers/mount')).navigationMock('view-room', 'model'));

const { ViewMenu } = await import('@/components/studio/ViewMenu');
const { StudioHelp } = await import('@/components/studio/StudioHelp');
const { StudioShell } = await import('@/components/studio/StudioShell');

const code = (rel: string) => stripComments(readFileSync(join(process.cwd(), rel), 'utf8'));

afterEach(() => cleanup());

describe('the gear', () => {
  it('opens the view controls, and Escape closes them back onto the gear', () => {
    render(<ViewMenu />);
    const gear = screen.getByRole('button', { name: 'View settings' });
    fireEvent.click(gear);
    const group = screen.getByRole('group', { name: 'View settings' });
    expect(group.textContent).toContain('Floor grid');
    expect(group.textContent).toContain('Quality');
    expect(gear.getAttribute('aria-expanded')).toBe('true');

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('group', { name: 'View settings' })).toBeNull();
    expect(document.activeElement).toBe(gear);
  });

  it('sends Settings the room it was opened from, so Settings can go back to it', () => {
    render(<ViewMenu />);
    fireEvent.click(screen.getByRole('button', { name: 'View settings' }));
    const link = screen.getByRole('link', { name: /Units, detection and storage/ });
    expect(link.getAttribute('href')).toBe('/settings?from=%2Froom%2Fview-room%2Fmodel');
  });

  it('a press outside closes it; a press inside does not', () => {
    render(<ViewMenu />);
    fireEvent.click(screen.getByRole('button', { name: 'View settings' }));
    fireEvent.pointerDown(screen.getByRole('group', { name: 'View settings' }));
    expect(screen.queryByRole('group', { name: 'View settings' })).not.toBeNull();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('group', { name: 'View settings' })).toBeNull();
  });

  it('and Help is a modal: it takes the screen, so it and View never stack', () => {
    // Help used to be a popover that had to let go when another opened. It is a dialog
    // over a scrim now, so View cannot be reached while it is up; closing it (Esc, the
    // scrim, or its own close button) gives focus back to the "?".
    render(
      <>
        <ViewMenu />
        <StudioHelp />
      </>,
    );
    const help = screen.getByRole('button', { name: 'How this works' });
    fireEvent.click(help);
    expect(help.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('dialog', { name: 'How this works' }).getAttribute('aria-modal')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Close help' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(help.getAttribute('aria-expanded')).toBe('false');
  });

  it("Help's Escape closes it and puts focus back on the button", () => {
    render(<StudioHelp />);
    const help = screen.getByRole('button', { name: 'How this works' });
    // The app's own Tooltip names it on hover; a native title would be a second label.
    expect(help.hasAttribute('title')).toBe(false);
    help.focus();
    fireEvent.click(help);
    expect(screen.queryByRole('dialog')).not.toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(help.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(help);
  });

  it('sits left of help in the top bar', () => {
    const src = code('app/room/[roomId]/layout.tsx');
    const at = (tag: string) => src.indexOf(tag);
    expect(at('<ViewMenu />')).toBeGreaterThan(-1);
    expect(at('<ViewMenu />')).toBeLessThan(at('<StudioHelp />'));
  });
});

describe('where the view controls live', () => {
  it('exactly the gear and the phone sheet render them', () => {
    // Swept, not listed: a third copy is most likely to appear in a file nobody thought
    // to name here.
    const tsx = (dir: string): string[] =>
      readdirSync(join(process.cwd(), dir), { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? tsx(join(dir, e.name)) : e.name.endsWith('.tsx') ? [join(dir, e.name)] : [],
      );
    const files = [...tsx('components'), ...tsx('app')];
    // A floor of NAMED files, not a count: a count is passed by a sweep that found the
    // wrong 40 files. These are the rail bodies the controls used to sit in.
    expect(files).toEqual(expect.arrayContaining(['components/studio/shells/shell-parts.tsx', 'components/studio/Inspector.tsx', 'app/room/[roomId]/layout.tsx']));
    const homes = files.filter((f) => code(f).includes('<ViewOptions')).sort();
    expect(homes).toEqual(['components/studio/ViewMenu.tsx', 'components/studio/shells/SheetShell.tsx']);
  });

  it('picking a piece while the View sheet is up swaps it for that piece', () => {
    // The toolbar trades View for the piece's own button once something is selected,
    // so a sheet left on View would show view settings with no button pressed, over
    // the piece just chosen.
    const sofa = { id: 'sofa-1', name: 'Sofa', shape: 'sofa', category: 'sofa', dimMM: [2000, 900, 850], pos: [0, 0, 0], rot: 0, color: '#b07a52' } as unknown as ScenePart;
    useScene.getState().setParts([sofa]);
    useStudio.setState({ selectedPartId: null, selection: [], selectedWall: null, catalogOpen: false });
    const restore = viewportAt(390, { touch: true });
    try {
      render(
        <StudioShell loadingLabel="Building your room">
          <main>room</main>
        </StudioShell>,
      );
      const view = screen.getByRole('button', { name: 'View' });
      fireEvent.click(view);
      expect(view.getAttribute('aria-expanded')).toBe('true');
      act(() => useStudio.getState().setSelected('sofa-1'));
      expect(screen.getByRole('button', { name: 'Sofa' }).getAttribute('aria-expanded')).toBe('true');
    } finally {
      restore();
      useStudio.setState({ selectedPartId: null, selection: [] });
    }
  });

  it("the phone's View button opens the View sheet, not Details", () => {
    const src = code('components/studio/shells/SheetShell.tsx');
    expect(src).toMatch(/onPress=\{\(\) => show\('view'\)\}/);
    expect(src).toMatch(/panel === 'view' && [\s\S]{0,120}<ViewOptions \/>/);
  });
});

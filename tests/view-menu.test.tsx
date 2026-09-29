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
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { stripComments } from './helpers/source';

vi.mock('next/navigation', async () => (await import('./helpers/mount')).navigationMock('view-room', 'model'));

const { ViewMenu } = await import('@/components/studio/ViewMenu');

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

  it('a press outside closes it; a press inside does not', () => {
    render(<ViewMenu />);
    fireEvent.click(screen.getByRole('button', { name: 'View settings' }));
    fireEvent.pointerDown(screen.getByRole('group', { name: 'View settings' }));
    expect(screen.queryByRole('group', { name: 'View settings' })).not.toBeNull();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('group', { name: 'View settings' })).toBeNull();
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

  it("the phone's View button opens the View sheet, not Details", () => {
    const src = code('components/studio/shells/SheetShell.tsx');
    expect(src).toMatch(/onPress=\{\(\) => show\('view'\)\}/);
    expect(src).toMatch(/panel === 'view' && [\s\S]{0,120}<ViewOptions \/>/);
  });
});

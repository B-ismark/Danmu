// @vitest-environment jsdom
//
// The tablet pane (`SheetShell`'s `PaneShell`, between the phone sheet and the docked
// rails) has two tabs, Room and Details. A new selection points it at Details, the tab
// that acts on what was picked. That switch runs during render, against the selection
// last seen (it used to be an effect, which painted the Room tab under the new pick for
// a frame); this holds that it happens at all, and only on a NEW selection — a re-render
// with the same one must not drag someone back off the Room tab they chose.
import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useScene } from '@/lib/scene-store';
import { useStudio } from '@/lib/store';
import type { ScenePart } from '@/lib/scene-spec';
import { viewportAt } from './helpers/mount';

vi.mock('next/navigation', async () => (await import('./helpers/mount')).navigationMock('pane-tab-room'));

const { StudioShell } = await import('@/components/studio/StudioShell');

// The tablet band's top, read from where it is declared, as `tests/compact-rail-widths`
// does — a hard-coded width here would be a second source of truth for the breakpoint.
const STACK_MAX = Number(
  /STACK_WIDTH = (\d+)/.exec(
    readFileSync(join(process.cwd(), 'components', 'studio', 'NarrowViewportBanner.tsx'), 'utf8'),
  )![1],
);

const part = (id: string, name: string): ScenePart =>
  ({ id, name, category: 'chair', shape: 'chair-armchair', dimMM: [500, 500, 900], pos: [0, 0.45, 0], rot: 0, locked: false }) as ScenePart;

let restore: (() => void) | null = null;
beforeEach(() => {
  restore = viewportAt(STACK_MAX);
  useScene.setState({ parts: [part('a', 'Armchair'), part('b', 'Bench')] });
  useStudio.setState({ selection: [], selectedPartId: null, selectedWall: null });
});
afterEach(() => {
  cleanup();
  restore?.();
  restore = null;
});

const tab = (name: RegExp) => screen.getByRole('tab', { name });
const pick = (id: string | null) =>
  act(() => {
    useStudio.setState({ selection: id ? [id] : [], selectedPartId: id });
  });

describe('the tablet pane follows a new selection to Details', () => {
  it('opens on Room, and moves to Details when something is picked', () => {
    render(
      <StudioShell loadingLabel="Building your room">
        <main>room</main>
      </StudioShell>,
    );
    expect(document.querySelector('.pane-shell'), 'not the tablet pane — the rest proves nothing').not.toBeNull();
    expect(tab(/^Room$/).getAttribute('aria-selected')).toBe('true');

    pick('a');
    expect(tab(/Armchair/).getAttribute('aria-selected'), 'stayed on Room under a new pick').toBe('true');
  });

  it('leaves a chosen Room tab alone until the selection actually changes', () => {
    render(
      <StudioShell loadingLabel="Building your room">
        <main>room</main>
      </StudioShell>,
    );
    pick('a');
    fireEvent.click(tab(/^Room$/));
    expect(tab(/^Room$/).getAttribute('aria-selected')).toBe('true');

    // Something unrelated re-renders the shell: the same pick must not pull the tab back.
    act(() => {
      useStudio.setState({ draggingId: null });
    });
    expect(tab(/^Room$/).getAttribute('aria-selected'), 'pulled off Room with no new pick').toBe('true');

    pick('b');
    expect(tab(/Bench/).getAttribute('aria-selected'), 'a new pick did not move it').toBe('true');
  });
});

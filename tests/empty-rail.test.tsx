// @vitest-environment jsdom
//
// The right rail's verbs live where the eye is. With nothing selected the panel's own
// prompt — "click a piece … or press Add" — carries Add and Start over directly under
// it, and the pinned footer steps aside; with a selection the footer is the
// selection's verb beside Add, and Start over on a row beneath. Each clause counts the
// WHOLE rail, because the failure this guards is a verb shown twice (or not at all)
// when one surface learns about a state the other already handles.
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { useScene } from '@/lib/scene-store';
import { useStudio } from '@/lib/store';

vi.mock('next/navigation', async () => (await import('./helpers/mount')).navigationMock('empty-rail-room', 'model'));

const { RailFooter } = await import('@/components/studio/RailFooter');
const { EmptyInspector } = await import('@/components/studio/EmptyInspector');

// Mirrors the Inspector's own condition for the empty panel.
function Rail() {
  const id = useStudio((s) => s.selectedPartId);
  const wall = useStudio((s) => s.selectedWall);
  const named = useScene((s) => s.parts.some((p) => p.id === id));
  return (
    <>
      {wall === null && !named && <EmptyInspector />}
      <RailFooter />
    </>
  );
}

const adds = () => screen.queryAllByRole('button', { name: 'Add a piece to the room' });
const startOvers = () => screen.queryAllByRole('button', { name: /^Start over/ });
const footer = () => document.querySelector('.rail-footer');

beforeEach(() => {
  cleanup();
  useScene.getState().loadFromRoom(undefined);
  const st = useStudio.getState();
  st.resetTransforms();
  st.setSelected(null);
  st.setSelectedWall(null);
  st.setCatalogOpen(false);
});

describe('with nothing selected', () => {
  it('puts Add under the prompt, once, and no footer at all', () => {
    render(<Rail />);
    expect(screen.getByText(/a piece to style it/)).toBeTruthy();
    expect(screen.getByText(/press Add to bring something in from the Library/)).toBeTruthy();
    expect(adds()).toHaveLength(1);
    expect(adds()[0].closest('.empty-inspector__actions')).not.toBeNull();
    expect(footer()).toBeNull();
  });

  it('offers Start over there too, once, and only after a change', () => {
    const { unmount } = render(<Rail />);
    expect(startOvers()).toHaveLength(0);
    unmount();
    useScene.getState().moveWall(0, 0.3);
    render(<Rail />);
    expect(startOvers()).toHaveLength(1);
    expect(startOvers()[0].closest('.empty-inspector__actions')).not.toBeNull();
  });
});

describe('with a piece selected', () => {
  it('keeps Delete beside Add in the footer, Start over on a row beneath', () => {
    const id = useScene.getState().parts[0].id;
    useScene.getState().moveWall(0, 0.3);
    useStudio.getState().setSelected(id);
    render(<Rail />);
    expect(document.querySelector('.empty-inspector')).toBeNull();
    const row = footer()!.querySelector('.rail-footer__row')!;
    expect(row.querySelector('button[aria-label^="Delete"]')).not.toBeNull();
    expect(adds()).toHaveLength(1);
    expect(row.contains(adds()[0])).toBe(true);
    // Add is a direct cell of the two-column row, with no auto margin pushing it.
    const cell = adds()[0].closest('div')!;
    expect(cell.parentElement).toBe(row);
    expect(cell.getAttribute('style') ?? '').not.toMatch(/margin/);
    expect(startOvers()).toHaveLength(1);
    expect(row.contains(startOvers()[0])).toBe(false);
    expect(footer()!.contains(startOvers()[0])).toBe(true);
  });
});

describe('the Add button', () => {
  it('is the solid moss primary, not a tinted outline', () => {
    render(<Rail />);
    const add = adds()[0];
    expect(add.className).toContain('ds-btn--accent');
    expect(add.getAttribute('style') ?? '').not.toMatch(/accent-tint/);
    expect(add.className).toContain('rail-cta');
  });
});

describe('the paint picker', () => {
  // "Two rows, then a button for your own" is a count: the curated dabs plus the
  // mixer must fill exactly two rows of the grid, or a third row of one appears.
  it('fills exactly two rows, the mixer taking the last cell', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('components/studio/Inspector.tsx', 'utf8');
    const table = /const SWATCHES: Swatch\[\] = \[([\s\S]*?)\n\];/.exec(src)![1];
    const dabs = [...table.matchAll(/\{ hex: '#[0-9A-F]{6}', name: '[^']+' \}/g)].length;
    const columns = Number(/const SWATCH_COLUMNS = (\d+);/.exec(src)![1]);
    expect(dabs).toBe(13);
    expect(dabs + 1).toBe(2 * columns);
    expect(src).toContain('gridTemplateColumns: `repeat(${SWATCH_COLUMNS}, 1fr)`');
  });
});

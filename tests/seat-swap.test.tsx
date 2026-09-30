// @vitest-environment jsdom
//
// § H.6.3's one caller that asks about a piece that does not exist yet: the Inspector's
// **Change the model**. It re-grounds the piece for its NEW kind — and the snapshot it
// hands `findSupportDetailed` still holds the OLD kind under the same id. So the kind has
// to be stated, not looked up: a table lamp on a dining table swapped for a dining chair
// must come down to the floor, because a chair tucks under a dining table rather than
// standing on it. Asked with the lamp's kind, it stayed on the tabletop.
//
// `tests/seat-support.test.ts` covers the pure function; this file is here because the
// defect it guards is at the CALL SITE — the one place the kind handed and the kind
// stored disagree — and a unit test of the function cannot see which one a caller
// passes. Mounted through the real plan page, like `tests/mount-height-refusal.test.tsx`.
//
// What it does NOT prove: nothing about the 3D tab, whose Inspector is the same
// component but whose page cannot be mounted here (R3F).
import 'fake-indexeddb/auto';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { footprintForLayout } from '@/lib/footprint';
import { useScene } from '@/lib/scene-store';
import { useStudio } from '@/lib/store';
import type { ScenePart } from '@/lib/scene-spec';

vi.mock('next/navigation', async () => (await import('./helpers/mount')).navigationMock('seat-swap-room'));

const { default: PlanPage } = await import('@/app/room/[roomId]/plan/page');

/** A dining table: `roleOf` reads a `desk-standard` at 750 mm with a 1.6 m span as one,
 *  which is what makes a dining chair its floor-sharer. */
const TABLE: ScenePart = {
  id: 'table',
  name: 'Dining table',
  category: 'table',
  shape: 'desk-standard',
  dimMM: [1600, 900, 750],
  pos: [0, 0, 0],
  rot: 0,
} as ScenePart;
const TOP = 0.75;

/** A lamp standing on it, dead centre. What it is swapped FOR decides where it lands. */
const LAMP: ScenePart = {
  id: 'lamp',
  name: 'Table lamp',
  category: 'lamp',
  shape: 'lamp-table',
  dimMM: [250, 250, 500],
  pos: [0, TOP, 0],
  rot: 0,
} as ScenePart;

beforeEach(() => {
  cleanup();
  useScene.setState({
    parts: [TABLE, LAMP],
    room: {
      ...useScene.getState().room,
      width: 4,
      depth: 4,
      height: 2.5,
      footprint: footprintForLayout('rect', 4, 4),
      layoutId: 'rect',
    },
  });
  // The lamp rides the table, as a lamp placed there would.
  useStudio.setState({
    positions: {},
    rotations: {},
    dims: {},
    parentIds: { lamp: 'table' },
    selection: ['lamp'],
    selectedPartId: 'lamp',
  });
});

/** Open the swap dialog and press the Library row whose name is `label`. The dialog's
 *  search box is seeded with the piece's own name, so it is retyped first — otherwise
 *  only lamps are on offer and the row being looked for is not there to press. */
function swapTo(label: string) {
  render(<PlanPage />);
  fireEvent.click(screen.getByText('Change the model'));
  fireEvent.change(screen.getByLabelText('Search the Library'), { target: { value: label } });
  const row = screen.getAllByRole('button').find((b) => b.textContent?.trim() === label);
  expect(row, `no Library row named ${label}`).toBeTruthy();
  fireEvent.click(row!);
}

describe('Change the model re-grounds for the kind it is changing TO', () => {
  it('the premise: the lamp stands on the table before anything is pressed', () => {
    render(<PlanPage />);
    expect(useScene.getState().parts.find((p) => p.id === 'lamp')?.pos[1]).toBe(TOP);
    expect(useStudio.getState().parentIds.lamp).toBe('table');
  });

  it('a lamp swapped for a dining chair comes down to the floor, riding nothing', () => {
    swapTo('Dining chair');
    const s = useStudio.getState();
    // The swap happened at all, or the two assertions after it are about a lamp.
    expect(useScene.getState().parts.find((p) => p.id === 'lamp')?.shape).toBe('chair-dining');
    expect(s.positions.lamp?.[1]).toBe(0);
    expect(s.parentIds.lamp).toBeUndefined();
  });

  it('while a lamp swapped for a laptop stays on the tabletop — the pair that makes it the seat rule', () => {
    swapTo('Laptop');
    const s = useStudio.getState();
    expect(useScene.getState().parts.find((p) => p.id === 'lamp')?.shape).toBe('laptop');
    expect(s.positions.lamp?.[1]).toBe(TOP);
    expect(s.parentIds.lamp).toBe('table');
  });
});

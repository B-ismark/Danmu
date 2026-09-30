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
// The same call site had a second hole of the same kind: it handed the probe the new
// kind's turn but not its OUTLINE, so a swap to a round piece was asked as the square
// around it. The last block below holds that half.
//
// What it does NOT prove: nothing about the 3D tab, whose Inspector is the same
// component but whose page cannot be mounted here (R3F).
import 'fake-indexeddb/auto';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { footprintForLayout } from '@/lib/footprint';
import { useScene } from '@/lib/scene-store';
import { useStudio } from '@/lib/store';
import { findSupportDetailed, restingOn } from '@/lib/physics';
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

describe('…and asks with the OUTLINE of the kind it is changing to', () => {
  it('a piece swapped for a table lamp more than half over the table’s corner stands on it', () => {
    // 50 mm in from the corner on both axes: 49% of the square around a 250 mm lamp is
    // over the table, and more than half of the lamp. Asked as that square, the swap put
    // it on the floor.
    const at: [number, number] = [0.8 - 0.05, 0.45 - 0.05];
    const lampDim: [number, number, number] = [250, 250, 500];
    const self = { id: 'corner', category: 'lamp', shape: 'lamp-table' } as const;
    expect(findSupportDetailed([TABLE], self, at[0], at[1], lampDim, 0, undefined)).toBeNull();
    expect(findSupportDetailed([TABLE], self, at[0], at[1], lampDim, 0, true)?.id).toBe('table');

    const laptop: ScenePart = { id: 'corner', name: 'Laptop', category: 'monitor', shape: 'laptop', dimMM: [340, 240, 220], pos: [at[0], 0, at[1]], rot: 0 } as ScenePart;
    useScene.setState({ parts: [TABLE, laptop] });
    useStudio.setState({ parentIds: {}, selection: ['corner'], selectedPartId: 'corner' });
    swapTo('Table lamp');
    const s = useStudio.getState();
    const lamp = useScene.getState().parts.find((p) => p.id === 'corner')!;
    expect(lamp.shape).toBe('lamp-table');
    expect(s.positions.corner?.[1]).toBe(TOP);
    expect(s.parentIds.corner).toBe('table');
    // And it is STORED as the outline it was asked as. The swap's patch changes the shape,
    // and the stored `circle` stayed the laptop's square, so every later reader disagreed
    // with the answer just acted on — the Inspector's banner, asking the state question
    // of the stored part, said it was floating.
    expect(lamp.circle).toBe(true);
    const on = restingOn([TABLE, lamp], 'corner', s.positions.corner!, lamp.rot, lamp.dimMM, lamp.category, lamp.shape, lamp.circle);
    expect(on).toEqual({ on: 'part', id: 'table', gap: 0 });
  });

  it('and with the TURN the piece keeps, which here keeps a laptop off the table', () => {
    // The other direction, and the parameter that was already passed — pinned beside the
    // outline so the pair is held, not half of it. A laptop turned a quarter, 10 mm in
    // from the table's end and 120 mm in from its side: unturned, 53% of it would be
    // over the table; turned, 46% is, and it stays on the floor.
    const at: [number, number] = [0.8 - 0.01, 0.45 - 0.12];
    const dim: [number, number, number] = [340, 240, 220];
    const self = { id: 'corner', category: 'monitor', shape: 'laptop' } as const;
    expect(findSupportDetailed([TABLE], self, at[0], at[1], dim, 0, undefined)?.id).toBe('table');
    expect(findSupportDetailed([TABLE], self, at[0], at[1], dim, Math.PI / 2, undefined)).toBeNull();

    // Round, as `addPart` stores a plant, so the swap has an outline to leave behind.
    const plant: ScenePart = { id: 'corner', name: 'Plant', category: 'plant', shape: 'plant', dimMM: [300, 300, 600], pos: [at[0], 0, at[1]], rot: Math.PI / 2, circle: true } as ScenePart;
    useScene.setState({ parts: [TABLE, plant] });
    useStudio.setState({ parentIds: {}, selection: ['corner'], selectedPartId: 'corner' });
    swapTo('Laptop');
    const s = useStudio.getState();
    const laptop = useScene.getState().parts.find((p) => p.id === 'corner')!;
    expect(laptop.shape).toBe('laptop');
    expect(s.positions.corner?.[1]).toBe(0);
    expect(s.parentIds.corner).toBeUndefined();
    // The plant's round outline does not come along: a laptop is a square.
    expect(laptop.circle).toBeUndefined();
  });
});

// @vitest-environment jsdom
//
// § H.6.7 — the Inspector's Floor and Wall buttons take what stands on a piece along.
//
// Wall moved the piece alone: press it on a nightstand and its lamp stayed where the
// nightstand had been, standing on air. It is asked of the same relation a drag plans its
// company from, so a lamp the room came with — which no drag ever linked — goes too.
//
// Floor never had the defect, and the test for it pins why: it moves a piece only
// upright, and the height pass already brings down whatever stands on it. So Floor writes
// nothing for the lamp. A transform write is never free — it becomes an override a
// re-scan will not move — and one that only restates the height pass's answer is that
// cost for nothing.
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useStudio } from '@/lib/store';
import { useScene } from '@/lib/scene-store';
import { footprintForLayout } from '@/lib/footprint';
import { currentRoomScene } from '@/lib/room-scene';
import type { ScenePart } from '@/lib/scene-spec';

vi.mock('next/navigation', async () => (await import('./helpers/mount')).navigationMock('rider-room', 'model'));
const { Inspector } = await import('@/components/studio/Inspector');

const part = (over: Partial<ScenePart> & Pick<ScenePart, 'id'>): ScenePart =>
  ({
    name: 'Piece', category: 'other', shape: 'box', locked: false,
    dimMM: [600, 400, 700], pos: [0, 0, 0], rot: 0, wallMounted: false,
    ...over,
  }) as ScenePart;

const lamp = (pos: [number, number, number]) =>
  part({ id: 'lamp', name: 'Lamp', category: 'lamp', shape: 'lamp-table', dimMM: [250, 250, 500], pos });

function room(parts: ScenePart[], selected: string) {
  useScene.setState({
    parts,
    room: { ...useScene.getState().room, width: 6, depth: 5, height: 2.5, footprint: footprintForLayout('rect', 6, 5), layoutId: 'rect' },
  });
  useStudio.setState({
    positions: {}, rotations: {}, dims: {}, parentIds: {}, hidden: {},
    selection: [selected], selectedPartId: selected, selectedWall: null,
  });
}

const at = (id: string) => currentRoomScene().find((p) => p.id === id)!;

beforeEach(() => useStudio.setState({ selectedWall: null }));
afterEach(() => cleanup());

describe('the Floor and Wall buttons carry what stands on the piece (§ H.6.7)', () => {
  it('Wall takes the lamp to the wall with its nightstand', () => {
    // Nearest wall is the north one, 1 m away; the lamp stands 50 mm in front of the
    // nightstand's middle, and no drag has ever linked it.
    room([
      part({ id: 'ns', name: 'Nightstand', category: 'nightstand', shape: 'nightstand', dimMM: [450, 400, 550], pos: [0, 0, -1.5] }),
      lamp([0, 0.55, -1.45]),
    ], 'ns');
    render(<Inspector />);
    fireEvent.click(screen.getByTitle('Move to the nearest wall and face the room'));

    const ns = at('ns');
    const l = at('lamp');
    // It really did go to the wall — otherwise "the lamp kept its offset" is free.
    expect(ns.pos[2]).toBeLessThan(-2);
    expect(l.pos[0]).toBeCloseTo(ns.pos[0], 6);
    expect(l.pos[2]).toBeCloseTo(ns.pos[2] + 0.05, 6);
    expect(l.pos[1]).toBeCloseTo(0.55, 6);
  });

  it('turns the lamp with the nightstand when the wall turns it', () => {
    // Near the west wall, facing north. Wall turns it to face the room, so the lamp
    // 50 mm in front of it has to swing round to stay in front — a translation alone
    // leaves it off to one side.
    room([
      part({ id: 'ns', name: 'Nightstand', category: 'nightstand', shape: 'nightstand', dimMM: [450, 400, 550], pos: [-2.5, 0, 0] }),
      lamp([-2.5, 0.55, 0.05]),
    ], 'ns');
    render(<Inspector />);
    fireEvent.click(screen.getByTitle('Move to the nearest wall and face the room'));

    const ns = at('ns');
    const l = at('lamp');
    expect(ns.rot).toBeCloseTo(Math.PI / 2, 6);
    expect(l.rot).toBeCloseTo(Math.PI / 2, 6);
    expect(l.pos[0]).toBeCloseTo(ns.pos[0] + 0.05, 6);
    expect(l.pos[2]).toBeCloseTo(ns.pos[2], 6);
  });

  it('Floor brings the lamp down with the piece it stands on', () => {
    // A box standing 750 mm up with a lamp on its 1.05 m top.
    room([
      part({ id: 'box', name: 'Box', dimMM: [400, 400, 300], pos: [1, 0.75, 0] }),
      lamp([1, 1.05, 0]),
    ], 'box');
    render(<Inspector />);
    fireEvent.click(screen.getByTitle('Put this piece on the floor, without moving it sideways'));

    expect(at('box').pos[1]).toBe(0);
    const l = at('lamp');
    expect(l.pos[1]).toBeCloseTo(0.3, 6);
    expect(l.pos[0]).toBeCloseTo(1, 6);
    expect(l.pos[2]).toBeCloseTo(0, 6);
    // …by the height pass, not by a write of its own.
    expect(useStudio.getState().positions.lamp).toBeUndefined();
  });
});

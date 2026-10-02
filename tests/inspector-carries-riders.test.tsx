// @vitest-environment jsdom
//
// § H.6.7 — the Inspector's Floor and Wall buttons take what stands on a piece along.
//
// Wall moved the piece alone: press it on a nightstand and its lamp stayed where the
// nightstand had been, standing on air. It is asked of the same relation a drag plans its
// company from, so a lamp the room came with — which no drag ever linked — goes too.
//
// Floor moves a piece only upright, and the height pass brings down most of what stands
// on it, so Floor writes only the riders the height pass cannot. A transform write is
// never free — it becomes an override a re-scan will not move — and one that only
// restates the height pass's answer is that cost for nothing. The rider the height pass
// cannot bring down is one with a stored position whose link was only inferred: it
// follows such a link only while the support's top differs from its AUTHORED top, so a
// nightstand floored back to where the room put it left the lamp at desk height.
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
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

  it('Floor brings down a lamp that was carried up onto a desk with its nightstand', () => {
    // The room put the nightstand on the floor and the lamp on it; a drag then took the
    // pair up onto the desk. Only the nightstand's landing is recorded — the lamp came
    // along and was written at desk height. Floor takes the nightstand back to its
    // authored height, where the inferred link no longer lifts anything.
    room([
      part({ id: 'desk', name: 'Desk', category: 'desk', shape: 'desk-standard', dimMM: [1200, 600, 750], pos: [1, 0, 0] }),
      part({ id: 'ns', name: 'Nightstand', category: 'nightstand', shape: 'nightstand', dimMM: [450, 400, 550], pos: [-1, 0, 0] }),
      lamp([-1, 0.55, 0]),
    ], 'ns');
    useStudio.setState({
      positions: { ns: [1, 0.75, 0], lamp: [1, 1.3, 0] },
      parentIds: { ns: 'desk' },
    });
    expect(at('lamp').pos[1]).toBeCloseTo(1.3, 6);
    render(<Inspector />);
    fireEvent.click(screen.getByTitle('Put this piece on the floor, without moving it sideways'));

    expect(at('ns').pos[1]).toBe(0);
    expect(at('lamp').pos[1]).toBeCloseTo(0.55, 6);
    expect(at('lamp').pos[0]).toBeCloseTo(1, 6);
  });
});

describe('Wall takes the selection and says when it cannot (§ H.6.7)', () => {
  const WALL = 'Move to the nearest wall and face the room';
  const box = (id: string, name: string, pos: [number, number, number]) =>
    part({ id, name, dimMM: [400, 400, 500], pos });
  /** The note under the buttons. Not `getByRole('status')`: the panel's announcer is
   *  one too. */
  const note = () => screen.queryByText(/stopped short|Nothing moved|already against|will not fit against/);

  it('moves the rest of the selection with the piece', () => {
    room([box('a', 'Crate', [0, 0, -1.5]), box('b', 'Stool', [1.5, 0, -1.0])], 'a');
    useStudio.setState({ selection: ['a', 'b'] });
    render(<Inspector />);
    fireEvent.click(screen.getByTitle(WALL));
    const step = at('a').pos[2] - -1.5;
    expect(step).toBeLessThan(-0.5);
    expect(at('b').pos[2]).toBeCloseTo(-1.0 + step, 6);
    expect(note()).toBeNull();
  });

  it('records what the piece was set down on', () => {
    // A lamp sent to the wall from its nightstand lands on the floor there, so the link
    // that would carry it with the nightstand goes.
    room([
      part({ id: 'ns', name: 'Nightstand', category: 'nightstand', shape: 'nightstand', dimMM: [450, 400, 550], pos: [0, 0, 0] }),
      lamp([0, 0.55, 0]),
    ], 'lamp');
    useStudio.setState({ parentIds: { lamp: 'ns' } });
    render(<Inspector />);
    fireEvent.click(screen.getByTitle(WALL));
    expect(at('lamp').pos[1]).toBe(0);
    expect(useStudio.getState().parentIds).toEqual({});
  });

  it('says why nothing moved, until the piece is moved some other way', () => {
    // The stool's wall spot is taken by a post too small to stand on, so it cannot
    // follow; the whole press is refused and the panel names the stool.
    room([
      box('a', 'Crate', [0, 0, -1.5]),
      box('b', 'Stool', [1.5, 0, -1.5]),
      part({ id: 'post', name: 'Post', dimMM: [150, 150, 900], pos: [1.5, 0, -2.28] }),
    ], 'a');
    useStudio.setState({ selection: ['a', 'b'] });
    render(<Inspector />);
    fireEvent.click(screen.getByTitle(WALL));
    expect(at('a').pos).toEqual([0, 0, -1.5]);
    expect(at('b').pos).toEqual([1.5, 0, -1.5]);
    expect(useStudio.getState().positions).toEqual({});
    expect(note()?.textContent).toBe('Nothing moved: Stool has no room to follow.');
    expect(note()?.closest('[role="status"]')).not.toBeNull();
    // A sentence about where the crate WAS is not left under it once it is elsewhere.
    act(() => useStudio.getState().setPosition('a', [0, 0, 0]));
    expect(note()).toBeNull();
  });
});

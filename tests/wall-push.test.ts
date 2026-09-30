// A wall coming in pushes what it meets, and stops where the pushed stack runs out
// of room. Asked for on the preview: "Walls should move sofas and the other models
// too" — the carry took a wall's own pieces, and the wall walked straight through
// the sofa standing out in the room.

import { describe, expect, it } from 'vitest';
import { carryForResize, pushedByWall } from '@/lib/wall-move';
import { footprintForLayout } from '@/lib/footprint';
import type { ScenePart } from '@/lib/scene-spec';

// 6 × 6, edge 0 the North wall at z = -3; coming in means +z.
const ROOM = footprintForLayout('rect', 6, 6);
const NORTH = 0;

function part(over: Partial<ScenePart> & { id: string }): ScenePart {
  return { category: 'other', name: over.id, shape: 'box', pos: [0, 0, 0], rot: 0, dimMM: [1000, 600, 800], locked: false, ...over };
}

/** In the middle of the room: its near face is 2.55 m off the North wall. */
const sofa = part({ id: 'sofa', name: 'Sofa', category: 'sofa', shape: 'sofa', dimMM: [2000, 900, 800] });
const z = (moves: { id: string; pos: [number, number, number] }[], id: string) => moves.find((m) => m.id === id)?.pos[2];

describe('a wall pushes what it meets', () => {
  it('leaves a piece alone until the wall reaches it, then pushes it flush', () => {
    expect(pushedByWall([sofa], ROOM, NORTH, 2.5, [], {}).moves).toEqual([]);
    const r = pushedByWall([sofa], ROOM, NORTH, 2.8, [], {});
    expect(r.inward).toBe(2.8);
    expect(r.stoppedBy).toBeNull();
    expect(z(r.moves, 'sofa')).toBeCloseTo(0.25, 9);
  });

  it('pushes piece against piece', () => {
    // A coffee table between the wall and the sofa: the wall meets the table, the
    // table meets the sofa.
    const table = part({ id: 'table', pos: [0.3, 0, -1], dimMM: [1000, 600, 450] });
    // Table near face 1.7 m in, far face 2.3; the sofa's front 2.55. At 1.9 the
    // table has gone 0.2 and stops 50 mm short of the sofa.
    const r = pushedByWall([table, sofa], ROOM, NORTH, 1.9, [], {});
    expect(z(r.moves, 'table')).toBeCloseTo(-0.8, 9);
    expect(z(r.moves, 'sofa')).toBeUndefined();
    // At 2.5 the table has gone 0.8, its far face at 3.1: 0.55 past the sofa's front.
    const r2 = pushedByWall([table, sofa], ROOM, NORTH, 2.5, [], {});
    expect(z(r2.moves, 'table')).toBeCloseTo(-0.2, 9);
    expect(z(r2.moves, 'sofa')).toBeCloseTo(0.55, 9);
  });

  it('a piece the wall carries pushes what stands in front of it', () => {
    const own = part({ id: 'own', pos: [0, 0, -2.5], dimMM: [1000, 900, 800] });
    // `own` carried with the wall: its far face at 0.95 m in, the sofa 1.6 m off it.
    const r = pushedByWall([own, sofa], ROOM, NORTH, 1.8, ['own'], {});
    expect(z(r.moves, 'own')).toBeUndefined(); // the carry moves it, not the push
    expect(z(r.moves, 'sofa')).toBeCloseTo(0.2, 9);
  });

  it('only meets what shares its height', () => {
    // A pendant hung over the path, well above a low table: the table goes under it.
    const low = part({ id: 'low', pos: [0, 0, -2], dimMM: [800, 600, 400] });
    const pendant = part({ id: 'pendant', category: 'lamp', shape: 'lamp-pendant', pos: [0, 2.0, -1.2], dimMM: [300, 300, 300] });
    // The table's near face 0.7 m in, the pendant's 1.65: at 1.2 only the table is met.
    const r = pushedByWall([low, pendant], ROOM, NORTH, 1.2, [], {});
    expect(z(r.moves, 'low')).toBeCloseTo(-1.5, 9);
    expect(z(r.moves, 'pendant')).toBeUndefined();
  });

  it('pushes a rug with the wall, and never with furniture', () => {
    const own = part({ id: 'own', pos: [0, 0, -2.5], dimMM: [1000, 900, 800] });
    const rug = part({ id: 'rug', category: 'rug', shape: 'rug', pos: [0, 0, -1], dimMM: [2000, 1400, 10] });
    // The rug's edge is 1.3 m in. At 0.8 the carried piece's far face (1.75) is
    // over it, and the rug has not moved; at 1.8 the wall itself has gone 0.5 past.
    expect(z(pushedByWall([own, rug], ROOM, NORTH, 0.8, ['own'], {}).moves, 'rug')).toBeUndefined();
    expect(z(pushedByWall([own, rug], ROOM, NORTH, 1.8, ['own'], {}).moves, 'rug')).toBeCloseTo(-0.5, 9);
  });

  it('takes each set whole — a merged mate, and the lamp resting on a table', () => {
    const mate = part({ id: 'mate', pos: [2.5, 0, 2], dimMM: [400, 400, 400], groupId: 'g' });
    const table = part({ id: 'table', pos: [-2, 0, 0], dimMM: [800, 800, 750] });
    const lamp = part({ id: 'lamp', category: 'lamp', shape: 'lamp-table', pos: [-2, 0.75, 0.2], dimMM: [200, 200, 400] });
    const parts = [{ ...sofa, groupId: 'g' }, mate, table, lamp];
    const r = pushedByWall(parts, ROOM, NORTH, 2.8, [], { lamp: 'table' });
    expect(z(r.moves, 'sofa')).toBeCloseTo(0.25, 9);
    expect(z(r.moves, 'mate')).toBeCloseTo(2.25, 9);
    // Table near face 2.6 m in: 0.2. The lamp goes with it.
    expect(z(r.moves, 'table')).toBeCloseTo(0.2, 9);
    expect(z(r.moves, 'lamp')).toBeCloseTo(0.4, 9);
  });

  it('a piece only pushes what is in line with it across the wall', () => {
    // The table is pushed into the band in front of it; the sofa stands beside that
    // band, not in it, and the wall has not reached it yet.
    const table = part({ id: 'table', pos: [-2, 0, -1.7], dimMM: [1000, 600, 450] });
    const aside = { ...sofa, pos: [1.5, 0, -0.55] as [number, number, number] };
    const r = pushedByWall([table, aside], ROOM, NORTH, 1.8, [], {});
    expect(z(r.moves, 'table')).toBeCloseTo(-0.9, 9);
    expect(z(r.moves, 'sofa')).toBeUndefined();
  });

  it('a rug the wall carries pushes nothing', () => {
    // Carried in, the rug's far edge slides under the sofa standing past it.
    const rug = part({ id: 'rug', category: 'rug', shape: 'rug', pos: [0, 0, -2.5], dimMM: [2000, 1000, 10] });
    const past = { ...sofa, pos: [0, 0, -1.35] as [number, number, number] };
    expect(pushedByWall([rug, past], ROOM, NORTH, 0.5, ['rug'], {}).moves).toEqual([]);
  });

  it('a piece already through the plaster moves with the wall, no further', () => {
    // A detection that landed 100 mm into the wall, handed in as not carried.
    const through = part({ id: 'through', pos: [0, 0, -3 + 0.35], dimMM: [1000, 900, 800] });
    expect(z(pushedByWall([through], ROOM, NORTH, 0.5, [], {}).moves, 'through')).toBeCloseTo(-2.15, 9);
  });

  it('asks nothing of a wall going out', () => {
    expect(pushedByWall([sofa], ROOM, NORTH, 0, [], {})).toEqual({ inward: 0, moves: [], stoppedBy: null });
    expect(pushedByWall([sofa], ROOM, NORTH, -1, [], {})).toEqual({ inward: 0, moves: [], stoppedBy: null });
  });
});

describe('the wall stops where the stack runs out of room, and names what stopped it', () => {
  it('at the far wall', () => {
    // The sofa's back reaches the South wall when the North wall is 5.1 m in.
    const r = pushedByWall([sofa], ROOM, NORTH, 5.5, [], {});
    expect(r.inward).toBeGreaterThan(5.09);
    expect(r.inward).toBeLessThan(5.105);
    expect(r.stoppedBy).toEqual({ id: 'sofa', name: 'Sofa', reason: 'room' });
    expect(z(r.moves, 'sofa')! + 0.45).toBeLessThanOrEqual(3 + 0.002 + 1e-9);
  });

  it('at a locked piece, where it touched it', () => {
    const r = pushedByWall([{ ...sofa, locked: true }], ROOM, NORTH, 3, [], {});
    expect(r.inward).toBeCloseTo(2.55, 6);
    expect(r.stoppedBy).toEqual({ id: 'sofa', name: 'Sofa', reason: 'locked' });
    expect(r.moves).toEqual([]);
  });

  it('at a piece hung on the far wall, which it cannot slide', () => {
    const tv = part({ id: 'tv', name: 'TV', category: 'tv', shape: 'tv', wallMounted: true, rot: Math.PI, pos: [0, 1.4, 3 - 0.03], dimMM: [1400, 60, 800] });
    const r = pushedByWall([tv], ROOM, NORTH, 5.99, [], {});
    expect(r.stoppedBy?.reason).toBe('wall');
    expect(r.inward).toBeCloseTo(6 - 0.06, 6);
  });

  it('slides a piece hung on a side wall along it', () => {
    // A print on the East wall, 1 m from the North corner: 600 mm wide along it, so
    // its near edge is 0.7 m in and 1.5 m of travel slides it 0.8.
    const print = part({ id: 'print', category: 'painting', shape: 'painting', wallMounted: true, rot: -Math.PI / 2, pos: [3 - 0.015, 1.5, -2], dimMM: [600, 30, 400] });
    const r = pushedByWall([print], ROOM, NORTH, 1.5, [], {});
    expect(r.stoppedBy).toBeNull();
    expect(z(r.moves, 'print')).toBeCloseTo(-1.2, 9);
  });

  it('slides a piece hung on a side wall only as far as the corner', () => {
    // 1 m from the South corner: 600 mm wide, so 0.7 m of slide is all there is.
    const print = part({ id: 'print', name: 'Print', category: 'painting', shape: 'painting', wallMounted: true, rot: -Math.PI / 2, pos: [3 - 0.015, 1.5, 2], dimMM: [600, 30, 400] });
    const r = pushedByWall([print], ROOM, NORTH, 5.5, [], {});
    expect(r.stoppedBy).toEqual({ id: 'print', name: 'Print', reason: 'room' });
    expect(z(r.moves, 'print')! + 0.3).toBeLessThanOrEqual(3 + 0.002 + 1e-6);
    expect(z(r.moves, 'print')).toBeGreaterThan(2.69);
  });

  it('a set stops the wall when any member cannot go', () => {
    const mate = part({ id: 'mate', pos: [2.5, 0, 2.6], dimMM: [400, 400, 400], groupId: 'g' });
    // The mate's back reaches the South wall after 0.2 of push: 2.75 m in.
    const r = pushedByWall([{ ...sofa, groupId: 'g' }, mate], ROOM, NORTH, 4, [], {});
    expect(r.inward).toBeCloseTo(2.75, 2);
    expect(r.stoppedBy?.id).toBe('mate');
  });
});

describe('a typed resize pushes too', () => {
  it('moves a piece the shrinking wall meets, and leaves one it does not', () => {
    // 6 → 4 deep moves the North wall 1 m in. `near` is 0.75 m off it — too far
    // to be carried, near enough to be met.
    const near = part({ id: 'near', pos: [0, 0, -1.8], dimMM: [1000, 900, 800] });
    const moved = carryForResize([near, { ...sofa, pos: [0, 0, 0] }], ROOM, footprintForLayout('rect', 6, 4), {});
    expect(moved.map((m) => m.id)).toEqual(['near']);
    expect(moved[0].pos[2]).toBeCloseTo(-1.55, 9);
  });
});

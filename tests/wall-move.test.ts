import { describe, expect, it } from 'vitest';
import { attachedToWall, carryAttached } from '../lib/wall-move';
import { footprintForLayout, offsetWall, wallOutwardNormal } from '../lib/footprint';
import type { ScenePart } from '../lib/scene-spec';
import { WALL_GAP } from '../lib/layout-rules';

// A 4 x 4 rectangle. footprintForLayout('rect') winds [-hw,-hd] → [hw,-hd] →
// [hw,hd] → [-hw,hd], so edge 0 is the North wall (z = -2) and edge 1 the East
// wall (x = +2).
const ROOM = footprintForLayout('rect', 4, 4);
const NORTH = 0;
const EAST = 1;

function part(over: Partial<ScenePart> & { id: string }): ScenePart {
  return {
    category: 'other',
    name: over.id,
    shape: 'box',
    pos: [0, 0, 0],
    rot: 0,
    dimMM: [1000, 600, 800],
    locked: false,
    ...over,
  };
}

/** Standing against the North wall: back face WALL_GAP off the plaster. */
const sofa = part({ id: 'sofa', category: 'sofa', shape: 'sofa', dimMM: [2000, 900, 800], pos: [0, 0, -2 + WALL_GAP + 0.45] });
/** In the middle of the floor. */
const table = part({ id: 'table', shape: 'coffee-table', pos: [0, 0, 0], dimMM: [1000, 600, 400] });
/** Mounted IN the North wall. */
const window0 = part({ id: 'window', shape: 'window', wallMounted: true, pos: [0.5, 1.2, -2], dimMM: [1200, 100, 1200] });
/** Against the East wall, not the North one. */
const shelf = part({ id: 'shelf', category: 'shelf', shape: 'bookshelf', rot: -Math.PI / 2, dimMM: [1600, 300, 1800], pos: [2 - WALL_GAP - 0.15, 0, 0.4] });

describe('attachedToWall', () => {
  it('takes what is against the wall and what is mounted in it', () => {
    const ids = attachedToWall([sofa, table, window0, shelf], ROOM, NORTH);
    expect(ids).toEqual(['sofa', 'window']);
  });

  it('leaves furniture on a neighbouring wall alone — that wall stretches, it does not travel', () => {
    expect(attachedToWall([sofa, shelf], ROOM, EAST)).toEqual(['shelf']);
  });

  it('ignores a piece further off the wall than the tolerance', () => {
    const adrift = part({ id: 'adrift', pos: [0, 0, -2 + 0.4 + 0.3], dimMM: [1000, 600, 800] });
    expect(attachedToWall([adrift], ROOM, NORTH)).toEqual([]);
  });

  it('counts a piece already overlapping the wall', () => {
    const through = part({ id: 'through', pos: [0, 0, -2 + 0.2], dimMM: [1000, 600, 800] });
    expect(attachedToWall([through], ROOM, NORTH)).toEqual(['through']);
  });

  it('does not claim a piece that is close to the wall\'s LINE but past its end', () => {
    // Wall 0 spans x ∈ [-2, 2]. This sits at x = 6, z = -2: zero distance from the
    // infinite line the wall lies on, nowhere near the wall.
    const far = part({ id: 'far', pos: [6, 0, -2 + WALL_GAP + 0.4], dimMM: [1000, 600, 800] });
    expect(attachedToWall([far], ROOM, NORTH)).toEqual([]);
  });

  it('assigns a wall-mounted piece to one wall only — the one apertures.ts would cut', () => {
    // A window near the NE corner belongs to whichever edge is nearest, and to
    // exactly one, or its hole and its glass would end up on different walls.
    const corner = part({ id: 'corner', shape: 'window', wallMounted: true, pos: [1.9, 1.2, -2], dimMM: [900, 100, 1200] });
    const north = attachedToWall([corner], ROOM, NORTH);
    const east = attachedToWall([corner], ROOM, EAST);
    expect(north.length + east.length).toBe(1);
  });
});

describe('carryAttached', () => {
  const ids = ['sofa', 'window'];
  const parts = [sofa, table, window0, shelf];

  it('moves carried pieces by the wall delta along the wall normal, and nothing else', () => {
    const after = offsetWall(ROOM, NORTH, 0.5); // push North out 500 mm
    const moves = carryAttached(ids, parts, ROOM, after, wallOutwardNormal(ROOM, NORTH), 0.5);
    expect(moves.map((m) => m.id).sort()).toEqual(['sofa', 'window']);
    const bySofa = moves.find((m) => m.id === 'sofa')!;
    // North's outward normal is -Z, so pushing it out moves the sofa to lower z.
    expect(bySofa.pos[2]).toBeCloseTo(sofa.pos[2] - 0.5, 10);
    expect(bySofa.pos[0]).toBeCloseTo(sofa.pos[0], 10);
    // Height is never touched by a horizontal wall move.
    expect(bySofa.pos[1]).toBe(sofa.pos[1]);
    const byWindow = moves.find((m) => m.id === 'window')!;
    expect(byWindow.pos[2]).toBeCloseTo(-2.5, 10);
    expect(byWindow.pos[1]).toBe(window0.pos[1]);
  });

  it('carries them inward too, keeping the gap to the wall', () => {
    const after = offsetWall(ROOM, NORTH, -0.5);
    const moves = carryAttached(ids, parts, ROOM, after, wallOutwardNormal(ROOM, NORTH), -0.5);
    const bySofa = moves.find((m) => m.id === 'sofa')!;
    expect(bySofa.pos[2]).toBeCloseTo(sofa.pos[2] + 0.5, 10);
    // Still against its wall after the move — the gap is what makes it "attached".
    expect(attachedToWall([{ ...sofa, pos: bySofa.pos }], after, NORTH)).toEqual(['sofa']);
  });

  it('refuses to carry a floor piece out of the room, but never blocks a wall-mounted one', () => {
    // An L-shape: pushing a wall can shorten a neighbouring edge, so a carried
    // piece can end up over the notch rather than over floor.
    const L = footprintForLayout('l', 6, 6);
    // Deliberately impossible: a huge delta so the carried position lands outside
    // whatever the polygon becomes.
    const after = offsetWall(L, 0, 0.4);
    const inside = part({ id: 'inside', pos: [0, 0, -3 + WALL_GAP + 0.4], dimMM: [1000, 600, 800] });
    const glass = part({ id: 'glass', shape: 'window', wallMounted: true, pos: [0, 1.2, -3], dimMM: [1000, 100, 1200] });
    const carried = carryAttached(
      ['inside', 'glass'],
      [inside, glass],
      L,
      after,
      wallOutwardNormal(L, 0),
      -20, // pull the wall 20 m in: no floor piece can follow that and stay inside
    );
    expect(carried.map((m) => m.id)).toEqual(['glass']);
  });

  it('is a no-op for an empty selection or a zero step', () => {
    expect(carryAttached([], parts, ROOM, ROOM, [0, -1], 0.5)).toEqual([]);
    expect(carryAttached(ids, parts, ROOM, ROOM, [0, -1], 0)).toEqual([]);
  });
});

describe('wallOutwardNormal', () => {
  it('points out of the room on every edge, and agrees with offsetWall', () => {
    for (const layout of ['rect', 'l', 'u'] as const) {
      const poly = footprintForLayout(layout, 5, 5);
      for (let i = 0; i < poly.length; i++) {
        const [nx, nz] = wallOutwardNormal(poly, i);
        expect(Math.hypot(nx, nz)).toBeCloseTo(1, 10);
        // offsetWall moves the edge's own vertices; that displacement IS the normal.
        const moved = offsetWall(poly, i, 0.25);
        expect(moved[i][0] - poly[i][0]).toBeCloseTo(nx * 0.25, 10);
        expect(moved[i][1] - poly[i][1]).toBeCloseTo(nz * 0.25, 10);
      }
    }
  });
});

// A moving wall takes a piece's company with it: the rest of its merged set, and
// whatever rests on it — the two relations a drag already carries.
//
// Reported on the preview: "the walls are not moving the models as they should,
// always. And when it does, it seems it doesn't move some elements that are
// grouped." Two defects, both here: the wall claimed only the half of a merged set
// that touched it, and it reached 120 mm off the plaster while the app's own
// starter rooms stand pieces 200–345 mm off it.

import { describe, expect, it } from 'vitest';
import { attachedToWall, carryAttached, carryForResize } from '@/lib/wall-move';
import { footprintForLayout, offsetWall, wallOutwardNormal } from '@/lib/footprint';
import { defaultScene, type ScenePart } from '@/lib/scene-spec';
import { WALL_GAP } from '@/lib/layout-rules';
import { ridesWall } from '@/lib/physics';

// 6 × 6, edge 0 the North wall at z = -3, edge 1 the East wall at x = +3,
// edge 2 the South wall at z = +3.
const ROOM = footprintForLayout('rect', 6, 6);
const NORTH = 0;

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

/** Against the North wall. */
const sofa = part({ id: 'sofa', category: 'sofa', shape: 'sofa', dimMM: [2000, 900, 800], pos: [0, 0, -3 + WALL_GAP + 0.45] });
/** A side table 1.5 m out into the room — nowhere near any wall. */
const side = part({ id: 'side', pos: [0, 0, 0], dimMM: [500, 500, 500] });

describe('a wall carries a merged set whole', () => {
  it('takes the group mate standing in the open along with the piece at the wall', () => {
    const parts = [
      { ...sofa, groupId: 'g' },
      { ...side, groupId: 'g' },
    ];
    expect(attachedToWall(parts, ROOM, NORTH, {})).toEqual(['sofa', 'side']);
    // Unmerged, the side table stays: the set is what brings it.
    expect(attachedToWall([sofa, side], ROOM, NORTH, {})).toEqual(['sofa']);
  });

  it('carries every member by the wall delta', () => {
    const parts = [
      { ...sofa, groupId: 'g' },
      { ...side, groupId: 'g' },
    ];
    const ids = attachedToWall(parts, ROOM, NORTH, {});
    const moves = carryAttached(ids, parts, ROOM, offsetWall(ROOM, NORTH, 0.5), wallOutwardNormal(ROOM, NORTH), 0.5, {});
    expect(moves).toEqual([
      { id: 'sofa', pos: [0, 0, sofa.pos[2] - 0.5] },
      { id: 'side', pos: [0, 0, -0.5] },
    ]);
  });

  it('keeps the WHOLE set where it is when one member cannot follow', () => {
    // An L whose North wall is pulled in 2.5 m: the sofa at that wall can follow, a
    // group mate standing over the notch-side edge cannot stay on the floor. Moving
    // the rest and leaving it would pull the set apart, which is what merging is for.
    const L = footprintForLayout('l', 6, 6);
    const after = offsetWall(L, NORTH, -2.5);
    const nearWall = part({ id: 'near', pos: [-1.5, 0, -3 + WALL_GAP + 0.3], groupId: 'g' });
    const alone = part({ id: 'alone', pos: [-1.5, 0, -3 + WALL_GAP + 0.3 + 0.8] });
    // In the L's east leg, which ends at z = 0.48: carried 2.5 m south, it stands in
    // the cut-away corner, outdoors.
    const edge = part({ id: 'edge', pos: [2, 0, -0.2], dimMM: [600, 600, 600], groupId: 'g' });
    const parts = [nearWall, edge, alone];
    const out = wallOutwardNormal(L, NORTH);
    const moved = carryAttached(['near', 'edge', 'alone'], parts, L, after, out, -2.5, {});
    expect(moved.map((m) => m.id)).toEqual(['alone']);
  });
});

describe('the containment rule, judged per set, keeps its two exemptions', () => {
  // Both predate sets and were guarded by nothing: breaking either left every wall
  // test green.
  it('still carries a piece that was already through the wall', () => {
    // A detection that landed 150 mm into the plaster. It was never inside, so it is
    // not held hostage to a test it was already failing.
    const through = part({ id: 'through', pos: [0, 0, -3 + 0.3], dimMM: [1000, 900, 800] });
    const moved = carryAttached(['through'], [through], ROOM, offsetWall(ROOM, NORTH, 0.5), wallOutwardNormal(ROOM, NORTH), 0.5, {});
    expect(moved.map((m) => m.id)).toEqual(['through']);
  });

  it('never holds back a piece that rides the wall, even one wholly indoors', () => {
    // A window set 10 mm proud of the plaster: its footprint is inside the room, so
    // only the rider exemption lets it go where its wall goes.
    const L = footprintForLayout('l', 6, 6);
    const glass = part({ id: 'glass', shape: 'window', wallMounted: true, pos: [2, 1.2, -3 + 0.06], dimMM: [1000, 100, 1200] });
    const moved = carryAttached(['glass'], [glass], L, offsetWall(L, NORTH, -20), wallOutwardNormal(L, NORTH), -20, {});
    expect(moved.map((m) => m.id)).toEqual(['glass']);
  });
});

describe('a wall carries what rests on the pieces it takes', () => {
  it('leaves a lamp on the table it rests on when the table cannot follow', () => {
    // Same L, same pull. The table straddles the line where the east leg ends
    // (x = 0.48), so carried south it stands half outdoors. The narrow lamp on its
    // west end would land indoors — alone it could go — and it stays on its table.
    const L = footprintForLayout('l', 6, 6);
    const after = offsetWall(L, NORTH, -2.5);
    const t = part({ id: 'table', pos: [1.0, 0, -0.2], dimMM: [1200, 600, 750] });
    const l = part({ id: 'lamp', category: 'lamp', shape: 'lamp-table', pos: [0.42, 0.75, -0.2], dimMM: [100, 100, 400] });
    const out = wallOutwardNormal(L, NORTH);
    expect(carryAttached(['table', 'lamp'], [t, l], L, after, out, -2.5, {}).map((m) => m.id)).toEqual(['lamp']);
    expect(carryAttached(['table', 'lamp'], [t, l], L, after, out, -2.5, { lamp: 'table' })).toEqual([]);
  });


  // A deep table against the North wall, and a lamp at its far edge — further off
  // the wall than the reach, so only resting on the table can bring it.
  const table = part({ id: 'table', pos: [0, 0, -3 + WALL_GAP + 0.7], dimMM: [1200, 1400, 750] });
  const lamp = part({ id: 'lamp', category: 'lamp', shape: 'lamp-table', pos: [0, 0.75, -3 + WALL_GAP + 1.3], dimMM: [200, 200, 400] });

  it('brings the lamp standing on the table', () => {
    expect(attachedToWall([table, lamp], ROOM, NORTH, {})).toEqual(['table']);
    expect(attachedToWall([table, lamp], ROOM, NORTH, { lamp: 'table' })).toEqual(['table', 'lamp']);
  });

  it('never carries a resting piece off a support that stays', () => {
    // A table out of reach, and a deep lamp half over its back edge, overhanging
    // toward the wall: the lamp's own face is within reach, and it rests on
    // something that is not going anywhere.
    const far = part({ id: 'table', pos: [0, 0, -3 + 0.7 + 0.7], dimMM: [1200, 1400, 750] });
    const overhang = { ...lamp, pos: [0, 0.75, -3 + 0.7 + 0.05] as [number, number, number], dimMM: [400, 400, 400] as [number, number, number] };
    expect(attachedToWall([far, overhang], ROOM, NORTH, {})).toEqual(['lamp']);
    expect(attachedToWall([far, overhang], ROOM, NORTH, { lamp: 'table' })).toEqual([]);
  });

  it('closes over both relations to a fixed point', () => {
    // sofa (at the wall) ─merged─ table ─holds─ lamp ─merged─ rug in the open.
    // One pass reaches the table and stops; the rug is the second hop.
    const t2 = part({ id: 'table', pos: [2, 0, 1], dimMM: [800, 800, 750], groupId: 'a' });
    const l2 = part({ id: 'lamp', category: 'lamp', shape: 'lamp-table', pos: [2, 0.75, 1], dimMM: [200, 200, 400], groupId: 'b' });
    const rug = part({ id: 'rug', shape: 'rug', pos: [-2, 0, 1.5], dimMM: [1600, 1000, 10], groupId: 'b' });
    const parts = [{ ...sofa, groupId: 'a' }, t2, l2, rug];
    expect(attachedToWall(parts, ROOM, NORTH, { lamp: 'table' })).toEqual(['sofa', 'table', 'lamp', 'rug']);
  });
});

describe('a merged set does not pull a piece off another wall', () => {
  const tv = part({ id: 'tv', category: 'tv', shape: 'tv', wallMounted: true, pos: [0, 1.4, 3 - 0.03], rot: Math.PI, dimMM: [1400, 60, 800], groupId: 'g' });

  it('leaves a TV on the opposite wall on its wall', () => {
    expect(ridesWall(tv.category, tv.shape)).toBe(true);
    expect(attachedToWall([{ ...sofa, groupId: 'g' }, tv], ROOM, NORTH, {})).toEqual(['sofa']);
  });

  it('brings a TV on a wall that meets this one at a corner — the move only slides it along its own wall', () => {
    const onEast = { ...tv, pos: [3 - 0.03, 1.4, -1] as [number, number, number], rot: -Math.PI / 2 };
    expect(attachedToWall([{ ...sofa, groupId: 'g' }, onEast], ROOM, NORTH, {})).toEqual(['sofa', 'tv']);
  });
});

describe('a resized room carries sets the same way', () => {
  it('moves a merged side table with the sofa when the room gets deeper', () => {
    const parts = [
      { ...sofa, groupId: 'g' },
      { ...side, groupId: 'g' },
    ];
    const deeper = footprintForLayout('rect', 6, 7);
    const moved = carryForResize(parts, ROOM, deeper, {});
    expect(moved.map((m) => m.id)).toEqual(['sofa', 'side']);
    for (const m of moved) expect(m.pos[2] - parts.find((p) => p.id === m.id)!.pos[2]).toBeCloseTo(-0.5, 9);
  });
});

describe("the starter rooms' own wall pieces go with their walls", () => {
  it('claims every floor piece the arrangement stood near a wall', () => {
    // Measured, then pinned: which floor pieces of each starter scene no wall
    // claims. Each is a piece a person can walk behind. Before, the plant (200 mm
    // off), the floor lamp (345), the armchair (300) and the T's sofa (300) were on
    // this list too, and every wall drag on a fresh room left them behind.
    const left: Record<string, string[]> = {};
    for (const layout of ['rect', 'l', 't', 'u'] as const) {
      const fp = footprintForLayout(layout, 5.6, 4.2);
      const parts = defaultScene(layout, 5.6, 4.2, { footprint: fp, height: 2.7 });
      const claimed = new Set<string>();
      for (let i = 0; i < fp.length; i++) for (const id of attachedToWall(parts, fp, i, {})) claimed.add(id);
      left[layout] = parts.filter((p) => !ridesWall(p.category, p.shape) && !claimed.has(p.id)).map((p) => p.id);
    }
    expect(left).toEqual(STARTER_LEFT);
  });
});

/** Each of these stands in the open — a coffee table or rug in the middle of the
 *  floor, the T's dining set under its pendant in the middle of the bar — and a
 *  person can walk all the way round it. */
const STARTER_LEFT: Record<string, string[]> = {
  rect: ['table-1', 'rug-1'],
  l: ['table-1'],
  t: ['table-2', 'chair-1', 'chair-2', 'chair-3', 'chair-4', 'lamp-2'],
  u: [],
};

import { describe, expect, it } from 'vitest';
import { analyzeRoom } from '@/lib/clearance';
import { costBreakdown, prepare, type LayoutContext } from '@/lib/layout-score';
import { collidesAt, type ScenePart } from '@/lib/scene-spec';
import { blocksJoin, blocksNest } from '@/lib/block-style';
import type { Footprint } from '@/lib/footprint';

// Building blocks may stand inside each other — a worktop over its drawer units — and
// the three places that judge an overlap must all say so, or a build the drag allows is
// one Room check accuses and Suggest pulls apart.

const RECT: Footprint = [
  [-3, -2],
  [3, -2],
  [3, 2],
  [-3, 2],
];
const ROOM = { footprint: RECT, height: 2.8 };

const part = (id: string, p: Pick<ScenePart, 'shape' | 'category' | 'dimMM'> & { x?: number; z?: number }): ScenePart => ({
  id, name: id, pos: [p.x ?? 0, 0, p.z ?? 0], rot: 0, locked: false, shape: p.shape, category: p.category, dimMM: p.dimMM,
});
const top = part('top', { shape: 'worktop', category: 'desk', dimMM: [1400, 700, 740] });
const pedestal = part('ped', { shape: 'drawer-unit', category: 'shelf', dimMM: [400, 500, 600], x: -0.45 });
const sofa = part('sofa', { shape: 'sofa', category: 'sofa', dimMM: [2000, 900, 800], x: 0.4 });

const clashes = (parts: ScenePart[]) => analyzeRoom(parts, ROOM).issues.filter((i) => i.rule === 'clash');
const costs = (parts: ScenePart[]) => {
  const ctx: LayoutContext = { parts, movable: parts.map(() => true), footprint: RECT };
  return costBreakdown(prepare(ctx), parts.map((p) => ({ x: p.pos[0], z: p.pos[2], yaw: p.rot })));
};
const overlapCost = (parts: ScenePart[]) => costs(parts).overlap;

describe('blocks join; everything else still collides', () => {
  it('answers only for block against block', () => {
    expect(blocksJoin(top, pedestal)).toBe(true);
    expect(blocksJoin(top, sofa)).toBe(false);
    expect(blocksJoin(sofa, top)).toBe(false);
  });

  it('lets a drawer unit be dragged under a worktop', () => {
    expect(collidesAt([top, pedestal], 'ped', pedestal.pos, 0, pedestal.dimMM)).toBe(false);
    expect(collidesAt([top, pedestal], 'top', top.pos, 0, top.dimMM)).toBe(false);
  });

  it('still refuses a sofa through a worktop, from either side', () => {
    expect(collidesAt([top, sofa], 'sofa', sofa.pos, 0, sofa.dimMM)).toBe(true);
    expect(collidesAt([top, sofa], 'top', top.pos, 0, top.dimMM)).toBe(true);
  });

  it('is not a clash in the room report, and costs the solver nothing', () => {
    expect(clashes([top, pedestal])).toEqual([]);
    expect(overlapCost([top, pedestal])).toBe(0);
  });

  it('still reports and prices a sofa inside a worktop', () => {
    expect(clashes([top, sofa])).toHaveLength(1);
    expect(overlapCost([top, sofa])).toBeGreaterThan(0);
  });
});

// The build this feature exists for, against the north wall (z = -2): a 1400 × 600 worktop
// carried by two 400 × 500 × 600 drawer units, backs aligned. The worktop overhangs the
// drawer fronts by 100 mm — and the drawers open UNDER it, so neither consumer may say
// otherwise. Found in review: both used to report "Can't open the cabinet" for each
// pedestal and pay Suggest to pull them out.
describe('a worktop on two drawer units', () => {
  const desk = part('desk', { shape: 'worktop', category: 'desk', dimMM: [1400, 600, 750], z: -1.7 });
  const pedL = part('pedL', { shape: 'drawer-unit', category: 'shelf', dimMM: [400, 500, 600], x: -0.45, z: -1.75 });
  const pedR = part('pedR', { shape: 'drawer-unit', category: 'shelf', dimMM: [400, 500, 600], x: 0.45, z: -1.75 });
  const build = [desk, pedL, pedR];

  it('has nothing for Room check to report', () => {
    expect(analyzeRoom(build, ROOM).issues.filter((i) => i.partIds.includes('pedL') || i.partIds.includes('pedR'))).toEqual([]);
  });

  it('costs the solver nothing for access or overlap', () => {
    const c = costs(build);
    expect(c.access).toBe(0);
    expect(c.overlap).toBe(0);
  });

  it('still blocks a drawer unit whose front another block stands in', () => {
    // A second drawer unit pushed against the first's front, both on the floor: that one
    // is not overhead, so the front is blocked and both consumers say so.
    const inFront = part('front', { shape: 'drawer-unit', category: 'shelf', dimMM: [400, 500, 600], x: -0.45, z: -1.2 });
    const zone = analyzeRoom([pedL, inFront], ROOM).issues.filter((i) => i.rule === 'zone' && i.partIds.includes('pedL'));
    expect(zone).toHaveLength(1);
    expect(costs([pedL, inFront]).access).toBeGreaterThan(0);
  });
});

// Joining is not nesting. A drawer unit dropped INTO a door cabinet, or two cabinets on
// one spot, is material in the same place — a crash like any other — while a unit butted
// into a cabinet's end by a few centimetres is how builds are put together.
describe('a block mostly inside another still collides', () => {
  const cabinet = part('cab', { shape: 'door-cabinet', category: 'shelf', dimMM: [800, 450, 850] });
  const inside = part('in', { shape: 'drawer-unit', category: 'shelf', dimMM: [400, 400, 600] });
  const butted = part('butt', { shape: 'drawer-unit', category: 'shelf', dimMM: [400, 450, 600], x: 0.58 });

  it('answers nested, not joined', () => {
    expect(blocksNest(cabinet, inside)).toBe(true);
    expect(blocksJoin(cabinet, inside)).toBe(false);
    expect(blocksJoin(cabinet, butted)).toBe(true);
  });

  it('is refused by the drag, reported by Room check and priced by Suggest', () => {
    expect(collidesAt([cabinet, inside], 'in', inside.pos, 0, inside.dimMM)).toBe(true);
    expect(clashes([cabinet, inside])).toHaveLength(1);
    expect(overlapCost([cabinet, inside])).toBeGreaterThan(0);
  });

  it('lets the butted unit through all three', () => {
    expect(collidesAt([cabinet, butted], 'butt', butted.pos, 0, butted.dimMM)).toBe(false);
    expect(clashes([cabinet, butted])).toEqual([]);
    expect(overlapCost([cabinet, butted])).toBe(0);
  });

  it('judges the drag at the candidate spot, not where the piece was', () => {
    // Starting butted, dragged into the cabinet.
    expect(collidesAt([cabinet, butted], 'butt', [0, 0, 0], 0, butted.dimMM)).toBe(true);
  });
});

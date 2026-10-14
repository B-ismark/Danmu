import { describe, expect, it } from 'vitest';
import { analyzeRoom } from '@/lib/clearance';
import { costBreakdown, prepare, type LayoutContext } from '@/lib/layout-score';
import { collidesAt, type ScenePart } from '@/lib/scene-spec';
import { blocksJoin } from '@/lib/block-style';
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

const part = (id: string, p: Pick<ScenePart, 'shape' | 'category' | 'dimMM'> & { x?: number }): ScenePart => ({
  id, name: id, pos: [p.x ?? 0, 0, 0], rot: 0, locked: false, shape: p.shape, category: p.category, dimMM: p.dimMM,
});
const top = part('top', { shape: 'worktop', category: 'desk', dimMM: [1400, 700, 740] });
const pedestal = part('ped', { shape: 'drawer-unit', category: 'shelf', dimMM: [400, 500, 600], x: -0.45 });
const sofa = part('sofa', { shape: 'sofa', category: 'sofa', dimMM: [2000, 900, 800], x: 0.4 });

const clashes = (parts: ScenePart[]) => analyzeRoom(parts, ROOM).issues.filter((i) => i.rule === 'clash');
const overlapCost = (parts: ScenePart[]) => {
  const ctx: LayoutContext = { parts, movable: parts.map(() => true), footprint: RECT };
  return costBreakdown(prepare(ctx), parts.map((p) => ({ x: p.pos[0], z: p.pos[2], yaw: p.rot }))).overlap;
};

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

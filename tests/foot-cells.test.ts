import { describe, it, expect } from 'vitest';
import { ELL_ARM_DEPTH, ELL_RETURN_WIDTH, footCellsLocal, footOutlineLocal } from '@/lib/foot-cells';
import {
  footArea,
  footFromPart,
  footInsidePoly,
  footIntersectionArea,
  footOverlap,
  outsideDeficit,
  outsideShare,
  pointInFoot,
  polygonWinding,
  type Poly,
} from '@/lib/geometry';
import { partInsideRoom } from '@/lib/footprint';
import { collidesAt, type ScenePart } from '@/lib/scene-spec';
import { resolvePlacement } from '@/lib/drag-resolve';
import { containedXZ } from '@/lib/layout-settle';
import { rasterizeCoverage, FREE_CELL } from '@/lib/clearance-field';
import { hitsAt } from '@/lib/plan-hit';

// The L-shaped desk fills two sides of its box and leaves the third corner open.
// Every gate used to read the box, so a desk wrapped round a room's inside corner —
// the corner sitting in its notch, nothing touching the wall — was refused as
// "sticking out of the room", and a chair tucked into the L was "in the way".

/** An L-shaped room; its inside corner is at (3, 4) and the missing quadrant is
 *  x > 3, z > 4. */
const ROOM: Poly = [
  [0, 0],
  [6, 0],
  [6, 4],
  [3, 4],
  [3, 6],
  [0, 6],
];
const DIM: [number, number, number] = [1600, 1400, 750];
// A quarter turn puts the desk's open corner at world +x, +z — towards the missing
// quadrant. At this centre both cells stand 30 mm off the two walls that meet at the
// inside corner, and the corner itself is in the notch.
const ROT = Math.PI / 2;
const AT: [number, number, number] = [2.942, 0, 4.098];

function part(p: Partial<ScenePart> & Pick<ScenePart, 'id' | 'dimMM' | 'pos'>): ScenePart {
  return { name: p.id, category: 'desk', shape: 'desk-l', rot: 0, locked: false, ...p } as ScenePart;
}
const desk = () => part({ id: 'desk', pos: AT, rot: ROT, dimMM: DIM });

describe('the L-shaped desk outline', () => {
  it('is two disjoint cells that reach all four sides of the box', () => {
    const cells = footCellsLocal('desk-l', 1.6, 1.4)!;
    expect(cells).toHaveLength(2);
    const minX = Math.min(...cells.map((c) => c.x0));
    const maxX = Math.max(...cells.map((c) => c.x1));
    const minZ = Math.min(...cells.map((c) => c.z0));
    const maxZ = Math.max(...cells.map((c) => c.z1));
    expect([minX, maxX, minZ, maxZ]).toEqual([-0.8, 0.8, -0.7, 0.7]);
    // Disjoint: they share an edge and no area.
    expect(cells[0].z1).toBeCloseTo(cells[1].z0, 12);
  });

  it('draws the area the cells cover', () => {
    const pts = footOutlineLocal('desk-l', 1.6, 1.4)!;
    let twice = 0;
    for (let i = 0; i < pts.length; i++) {
      const [x0, z0] = pts[i];
      const [x1, z1] = pts[(i + 1) % pts.length];
      twice += x0 * z1 - x1 * z0;
    }
    const cells = footCellsLocal('desk-l', 1.6, 1.4)!;
    const cellArea = cells.reduce((a, c) => a + (c.x1 - c.x0) * (c.z1 - c.z0), 0);
    expect(Math.abs(twice) / 2).toBeCloseTo(cellArea, 12);
    // Literal: 1.6 × 1.4 less the open corner, 0.928 × 0.672.
    expect(cellArea).toBeCloseTo(1.6 * 1.4 - (1.6 * (1 - ELL_RETURN_WIDTH)) * (1.4 * (1 - ELL_ARM_DEPTH)), 12);
    expect(cellArea).toBeCloseTo(1.616384, 6);
  });

  it('is the only shape with one, and a round piece never has cells', () => {
    expect(footCellsLocal('desk-standard', 1.6, 1.4)).toBeUndefined();
    expect(footOutlineLocal('desk-standard', 1.6, 1.4)).toBeUndefined();
    expect(footFromPart(AT, ROT, DIM, undefined, 'desk-standard').cells).toBeUndefined();
    expect(footFromPart(AT, ROT, DIM, true, 'desk-l').cells).toBeUndefined();
  });

  it('measures its area and its points from the cells', () => {
    const f = footFromPart([0, 0, 0], 0, DIM, undefined, 'desk-l');
    expect(footArea(f)).toBeCloseTo(1.616384, 6);
    // The open corner is front-left in the piece's own frame.
    expect(pointInFoot(-0.4, 0.4, f)).toBe(false);
    expect(pointInFoot(-0.4, -0.4, f)).toBe(true);
    expect(pointInFoot(0.6, 0.4, f)).toBe(true);
    // The box still says yes there — which is what every gate used to read.
    expect(pointInFoot(-0.4, 0.4, footFromPart([0, 0, 0], 0, DIM))).toBe(true);
  });
});

describe('a desk wrapped round an inside corner', () => {
  it('is in the room, where the box was not', () => {
    expect(partInsideRoom(AT, ROT, DIM, ROOM, undefined, 'desk-l')).toBe(true);
    expect(partInsideRoom(AT, ROT, DIM, ROOM)).toBe(false);
    const f = footFromPart(AT, ROT, DIM, undefined, 'desk-l');
    expect(footInsidePoly(f, ROOM)).toBe(true);
    expect(outsideDeficit(f, ROOM)).toBe(0);
    expect(outsideShare(f, ROOM, 5)).toBe(0);
  });

  it('still sticks out when a cell really does cross the wall', () => {
    // 100 mm further east: the arm, which runs up past the inside corner, now
    // crosses the wall x = 3 above z = 4 by 70 mm.
    const east: [number, number, number] = [AT[0] + 0.1, 0, AT[2]];
    expect(partInsideRoom(east, ROT, DIM, ROOM, undefined, 'desk-l')).toBe(false);
    expect(outsideDeficit(footFromPart(east, ROT, DIM, undefined, 'desk-l'), ROOM)).toBeCloseTo(0.07, 6);
  });

  it('is a legal drop', () => {
    const d = desk();
    const r = resolvePlacement({
      part: d,
      rawX: AT[0],
      rawZ: AT[2],
      rot: ROT,
      dim: DIM,
      parts: [d],
      footprint: ROOM,
      roomHeight: 2.5,
      snapMode: 'off',
    });
    expect(r.refusal).toBeUndefined();
    expect(r.valid).toBe(true);
    expect(r.pos[0]).toBeCloseTo(AT[0], 9);
    expect(r.pos[2]).toBeCloseTo(AT[2], 9);
  });

  it('is left where it stands by the settle', () => {
    const [x, z] = containedXZ({ rot: ROT, dimMM: DIM, shape: 'desk-l' }, AT[0], AT[2], ROOM, [1.5, 1.5], polygonWinding(ROOM));
    expect(x).toBeCloseTo(AT[0], 9);
    expect(z).toBeCloseTo(AT[2], 9);
    // …which the box would not have been: it reads the arm's far end as through the
    // wall and shoves the desk off the corner.
    const [bx, bz] = containedXZ({ rot: ROT, dimMM: DIM }, AT[0], AT[2], ROOM, [1.5, 1.5], polygonWinding(ROOM));
    expect(Math.hypot(bx - AT[0], bz - AT[2])).toBeGreaterThan(0.3);
  });
});

describe('the open corner is floor', () => {
  // At rot 0 the open corner is front-left: x ∈ [−0.8, 0.128], z ∈ [0.028, 0.7].
  const plain = part({ id: 'desk', pos: [3, 0, 3], dimMM: DIM });
  const chairDim: [number, number, number] = [500, 500, 900];

  it('takes a chair tucked into the L', () => {
    const chair = part({ id: 'chair', category: 'chair', shape: 'chair-office', pos: [2.6, 0, 3.4], dimMM: chairDim });
    expect(collidesAt([plain, chair], 'chair', chair.pos, 0, chairDim)).toBe(false);
    expect(footOverlap(footFromPart(plain.pos, 0, DIM, undefined, 'desk-l'), footFromPart(chair.pos, 0, chairDim))).toBe(false);
    expect(footIntersectionArea(footFromPart(plain.pos, 0, DIM, undefined, 'desk-l'), footFromPart(chair.pos, 0, chairDim))).toBe(0);
  });

  it('still refuses a chair on the desk itself', () => {
    const chair = part({ id: 'chair', category: 'chair', shape: 'chair-office', pos: [3.5, 0, 3.4], dimMM: chairDim });
    expect(collidesAt([plain, chair], 'chair', chair.pos, 0, chairDim)).toBe(true);
    // The return's share: x ∈ [3.25, 3.75] × z ∈ [3.15, 3.65] against x ≥ 3.128.
    expect(footIntersectionArea(footFromPart(plain.pos, 0, DIM, undefined, 'desk-l'), footFromPart(chair.pos, 0, chairDim))).toBeCloseTo(0.25, 9);
  });

  it('is not the desk to a click', () => {
    expect(hitsAt(2.6, 3.4, [plain])).toEqual([]);
    expect(hitsAt(2.6, 2.8, [plain])).toEqual(['desk']);
  });

  it('is walkable floor', () => {
    const r = rasterizeCoverage([footFromPart(plain.pos, 0, DIM, undefined, 'desk-l')], ROOM)!;
    const at = (x: number, z: number) => r.cover[Math.floor((z - r.minZ) / r.cell) * r.nx + Math.floor((x - r.minX) / r.cell)];
    expect(at(2.6, 3.4)).toBe(FREE_CELL);
    expect(at(2.6, 2.8)).toBe(0);
  });
});

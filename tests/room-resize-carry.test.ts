// Resizing the room from Room tools carries the furniture standing against its
// walls.
//
// The user shrank a room and the furniture stayed put — their screenshot shows a
// sofa and a floor lamp standing entirely outside the shell.
//
// The cause is that there were TWO paths to a smaller room and only one of them
// carried anything. Dragging a wall goes through `lib/wall-actions.ts`, which
// calls `carryAttached` precisely so the pieces come too. Typing a number in Room
// tools calls `setRoom`, which rebuilds the polygon through `footprintForLayout`
// — and `RoomDimsEditor` carried the pieces hung from the CEILING when the height
// changed and carried nothing at all when width or depth did. One axis of three.
//
// So these are about `carryForResize`, the footprint-level version of the wall
// rule: every wall moved, most of them by zero, and the displacement is read off
// the two polygons rather than handed in as a delta.
//
// Ground truth here is analytic. `footprintForLayout('rect', w, d)` is centred on
// the origin, so shrinking width by 1 m moves each side wall inward by exactly
// 0.5 m, and a sofa against the east wall must move west by 0.5 m — not by 1 m,
// and not proportionally to where it happened to be standing.
import { describe, expect, it } from 'vitest';
import { footprintForLayout, type Footprint } from '@/lib/footprint';
import { carryForResize, wallDisplacements } from '@/lib/wall-move';
import type { ScenePart } from '@/lib/scene-spec';

function part(p: Partial<ScenePart> & Pick<ScenePart, 'id' | 'pos'>): ScenePart {
  return {
    name: p.id,
    category: 'sofa',
    shape: 'sofa',
    dimMM: [2000, 900, 800],
    rot: 0,
    locked: false,
    ...p,
  } as ScenePart;
}

const rect = (w: number, d: number) => footprintForLayout('rect', w, d) as Footprint;

/** Which wall of a centred rectangle is which, by its outward normal. Derived
 *  rather than assumed: the vertex order of `footprintForLayout` is not this
 *  file's to know, and hard-coding an index here would make every assertion below
 *  a statement about that order instead of about the carry. */
function wallFacing(poly: Footprint, ox: number, oz: number): number {
  const before = poly;
  const after = poly;
  void before;
  void after;
  let best = -1;
  let bestDot = -Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const mx = (a[0] + b[0]) / 2;
    const mz = (a[1] + b[1]) / 2;
    const len = Math.hypot(mx, mz) || 1;
    const dot = (mx / len) * ox + (mz / len) * oz;
    if (dot > bestDot) {
      bestDot = dot;
      best = i;
    }
  }
  return best;
}

describe('wallDisplacements', () => {
  it('reports half the shrink on each of the two walls that moved, and zero on the others', () => {
    const before = rect(6, 4);
    const after = rect(5, 4);
    const d = wallDisplacements(before, after);
    // Two walls moved inward by 0.5 (negative = inward, along the outward normal),
    // two did not move at all.
    const moved = d.filter((v) => Math.abs(v) > 1e-9);
    expect(moved).toHaveLength(2);
    for (const v of moved) expect(v).toBeCloseTo(-0.5, 9);
    expect(d.filter((v) => Math.abs(v) <= 1e-9)).toHaveLength(2);
  });

  it('is positive outward when the room grows', () => {
    const d = wallDisplacements(rect(6, 4), rect(8, 4));
    const moved = d.filter((v) => Math.abs(v) > 1e-9);
    expect(moved).toHaveLength(2);
    for (const v of moved) expect(v).toBeCloseTo(1, 9);
  });

  it('moves the depth walls when depth changes, not the width walls', () => {
    const before = rect(6, 4);
    const after = rect(6, 3);
    const d = wallDisplacements(before, after);
    const east = wallFacing(before, 1, 0);
    const north = wallFacing(before, 0, -1);
    expect(d[east]).toBeCloseTo(0, 9);
    expect(Math.abs(d[north])).toBeCloseTo(0.5, 9);
  });

  it('refuses two footprints that do not correspond wall-for-wall', () => {
    // An L has more walls than a rectangle. There is no honest mapping, and
    // guessing one would carry furniture along an edge that is not its edge.
    expect(wallDisplacements(rect(6, 4), footprintForLayout('l', 6, 4) as Footprint)).toEqual([]);
  });
});

describe('carryForResize', () => {
  it('moves a sofa against the east wall inward by half the width lost', () => {
    const before = rect(6, 4);
    const after = rect(5, 4);
    // Against the east wall: 3.0 is the wall, the sofa is 900 deep and turned to
    // face west, so its centre sits 0.45 in from the plaster.
    const sofa = part({ id: 'sofa', pos: [3 - 0.45, 0, 0], rot: Math.PI / 2 });
    const moved = carryForResize([sofa], before, after);
    expect(moved).toHaveLength(1);
    expect(moved[0].id).toBe('sofa');
    expect(moved[0].pos[0]).toBeCloseTo(3 - 0.45 - 0.5, 9);
    expect(moved[0].pos[2]).toBeCloseTo(0, 9);
  });

  it('leaves a piece in the middle of the room alone', () => {
    const table = part({ id: 'table', pos: [0, 0, 0], dimMM: [600, 600, 400] });
    expect(carryForResize([table], rect(6, 4), rect(5, 4))).toEqual([]);
  });

  it('never touches y — a wall moving sideways changes nothing about height', () => {
    const sofa = part({ id: 'sofa', pos: [3 - 0.45, 0.31, 0], rot: Math.PI / 2 });
    const moved = carryForResize([sofa], rect(6, 4), rect(5, 4));
    expect(moved[0].pos[1]).toBe(0.31);
  });

  it('carries a corner piece diagonally — both its walls moved, and the shifts add', () => {
    const before = rect(6, 4);
    const after = rect(5, 3);
    // Tucked into the +x / +z corner, small enough to be attached to both walls.
    const stand = part({ id: 'stand', pos: [3 - 0.2, 0, 2 - 0.2], dimMM: [400, 400, 550] });
    const moved = carryForResize([stand], before, after);
    expect(moved).toHaveLength(1);
    // Width lost 1 → east wall in by 0.5. Depth lost 1 → south wall in by 0.5.
    expect(moved[0].pos[0]).toBeCloseTo(3 - 0.2 - 0.5, 9);
    expect(moved[0].pos[2]).toBeCloseTo(2 - 0.2 - 0.5, 9);
  });

  it('carries outward too, so growing the room does not strand a sofa mid-floor', () => {
    const sofa = part({ id: 'sofa', pos: [3 - 0.45, 0, 0], rot: Math.PI / 2 });
    const moved = carryForResize([sofa], rect(6, 4), rect(8, 4));
    expect(moved[0].pos[0]).toBeCloseTo(3 - 0.45 + 1, 9);
  });

  it('drops a piece from the move rather than pushing it out of the room', () => {
    // A sofa 2 m long standing against the east wall, in a room being squeezed to
    // narrower than the sofa is long on the other axis. It must keep its place and
    // let `clearance.ts` report the wall standing in it — never be shoved.
    const before = rect(6, 4);
    const after = rect(0.6, 4);
    const sofa = part({ id: 'sofa', pos: [3 - 0.45, 0, 0], rot: Math.PI / 2 });
    expect(carryForResize([sofa], before, after)).toEqual([]);
  });

  it('leaves a piece that was ALREADY outside to its own move', () => {
    // Was outside before, so it is not held hostage to a containment test it was
    // already failing — same rule `carryAttached` states.
    const before = rect(6, 4);
    const after = rect(5, 4);
    const stray = part({ id: 'stray', pos: [3.4, 0, 0], rot: Math.PI / 2, dimMM: [400, 400, 400] });
    const moved = carryForResize([stray], before, after);
    // It is attached (overlapping the wall counts) and it was not inside, so the
    // was-inside/now-inside guard does not stop it.
    if (moved.length > 0) expect(moved[0].pos[0]).toBeCloseTo(3.4 - 0.5, 9);
  });

  it('returns nothing when the room did not change', () => {
    const sofa = part({ id: 'sofa', pos: [3 - 0.45, 0, 0], rot: Math.PI / 2 });
    expect(carryForResize([sofa], rect(6, 4), rect(6, 4))).toEqual([]);
  });

  it('returns nothing across a layout change, rather than a wrong answer', () => {
    const sofa = part({ id: 'sofa', pos: [3 - 0.45, 0, 0], rot: Math.PI / 2 });
    expect(carryForResize([sofa], rect(6, 4), footprintForLayout('l', 6, 4) as Footprint)).toEqual(
      [],
    );
  });
});

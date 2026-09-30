// A piece may not be made wider than the space it has — the user's ruling on the
// curtain that could be set to 4 m in a 3 m room (2026-09-30). `lib/space-bound.ts`
// only measures; these hold the measurement to the two things it claims to be: the
// length of a wall piece's OWN wall, and the drag's own `roomIsWideEnough` solved for
// one side.

import { describe, expect, it } from 'vitest';
import { footprintForLayout, type Footprint } from '@/lib/footprint';
import { aabbExtents } from '@/lib/geometry';
import { describeSpaceRefusal, refuseForSpace, refuseNewForSpace, spaceLimits, type SpacePiece } from '@/lib/space-bound';

/** 6 m east–west, 5 m north–south, centred on the origin. */
const RECT = footprintForLayout('rect', 6, 5);

const curtain = (pos: [number, number, number], rot: number, w = 1600): SpacePiece => ({
  category: 'curtain',
  shape: 'curtain',
  pos,
  rot,
  dimMM: [w, 80, 2200],
});

const sofa = (rot: number, dim: [number, number, number] = [2200, 900, 850]): SpacePiece => ({
  category: 'sofa',
  shape: 'sofa',
  pos: [0, 0, 0],
  rot,
  dimMM: dim,
});

describe('a wall piece is bounded by its own wall', () => {
  it('the 6 m wall allows 6 m, the 5 m wall 5 m', () => {
    // North wall (z = −2.5) faces +z, heading 0. West wall (x = −3) faces +x, heading π/2.
    const [onNorth] = spaceLimits(curtain([0, 1.2, -2.45], 0), RECT);
    expect(onNorth).toEqual({ maxMM: expect.closeTo(6000, 6), why: 'wall' });
    const [onWest] = spaceLimits(curtain([-2.95, 1.2, 0], Math.PI / 2), RECT);
    expect(onWest).toEqual({ maxMM: expect.closeTo(5000, 6), why: 'wall' });
  });

  it('measures the wall it FACES FROM, not the return wall its edge is nearer', () => {
    // A painting on the west wall, 30 mm from the north corner. By nearest point the
    // north wall (6 m) is closer than its own (5 m) — 30 mm against 50 — so a
    // nearest-edge answer would let it be made a metre wider than its wall is.
    const p: SpacePiece = { category: 'painting', shape: 'painting', pos: [-2.95, 1.4, -2.47], rot: Math.PI / 2, dimMM: [600, 30, 400] };
    expect(spaceLimits(p, RECT)[0]).toEqual({ maxMM: expect.closeTo(5000, 6), why: 'wall' });
  });

  it('on a T, the stem wall is its own length and not the bounding box', () => {
    // Every wall of the T, a curtain placed on each at the wall's own heading: the
    // limit is that edge's length to the millimetre, which a bounding-box bound
    // cannot say for any of the inner walls.
    const T = footprintForLayout('t', 6, 5);
    for (let i = 0; i < T.length; i++) {
      const a = T[i];
      const b = T[(i + 1) % T.length];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]) * 1000;
      const [mx, mz] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const { yaw, nx, nz } = inward(T, i);
      const [lim] = spaceLimits(curtain([mx + nx * 0.05, 1.2, mz + nz * 0.05], yaw), T);
      expect(lim.why, `wall ${i}`).toBe('wall');
      expect(lim.maxMM, `wall ${i}`).toBeCloseTo(len, 6);
    }
  });
});

describe('everything else is bounded by the room, as the drag bounds it', () => {
  it('square to the room: the room’s own width and depth', () => {
    const [w, d] = spaceLimits(sofa(0), RECT);
    expect(w).toEqual({ maxMM: expect.closeTo(6000, 6), why: 'room' });
    expect(d).toEqual({ maxMM: expect.closeTo(5000, 6), why: 'room' });
    // Turned a quarter: the width now runs north–south.
    expect(spaceLimits(sofa(Math.PI / 2), RECT)[0].maxMM).toBeCloseTo(5000, 6);
  });

  it('at any angle, exactly the size `roomIsWideEnough` stops accepting', () => {
    // The drag's test is the rotated AABB against the room's bounds. At the limit the
    // extents touch the bounds; a millimetre past, they do not fit. Swept, not sampled.
    const b = { w: 6, d: 5 };
    const fits = (rot: number, dim: [number, number, number]) => {
      const { ex, ez } = aabbExtents(rot, dim);
      return 2 * ex <= b.w + 1e-9 && 2 * ez <= b.d + 1e-9;
    };
    let checked = 0;
    for (let deg = 0; deg < 180; deg += 7.5) {
      const rot = (deg * Math.PI) / 180;
      const [w, d] = spaceLimits(sofa(rot, [1000, 800, 850]), RECT);
      expect(fits(rot, [w.maxMM - 1, 800, 850]), `${deg}° width`).toBe(true);
      expect(fits(rot, [w.maxMM + 1, 800, 850]), `${deg}° width`).toBe(false);
      expect(fits(rot, [1000, d.maxMM - 1, 850]), `${deg}° depth`).toBe(true);
      expect(fits(rot, [1000, d.maxMM + 1, 850]), `${deg}° depth`).toBe(false);
      checked++;
    }
    expect(checked).toBe(24);
  });
});

describe('what may be refused', () => {
  const onWest = curtain([-2.95, 1.2, 0], Math.PI / 2, 4000);

  it('a width grown past the wall', () => {
    expect(refuseForSpace(onWest, [5200, 80, 2200], RECT)).toEqual({
      axis: 0,
      limit: { maxMM: expect.closeTo(5000, 6), why: 'wall' },
      askedMM: 5200,
    });
    // Up to the wall exactly is allowed.
    expect(refuseForSpace(onWest, [5000, 80, 2200], RECT)).toBeNull();
  });

  it('never a shrink, nor another axis of a piece that is already over', () => {
    // A room file from elsewhere, or a wall moved in under it: 5.5 m on a 5 m wall.
    const over = { ...onWest, dimMM: [5500, 80, 2200] as [number, number, number] };
    expect(refuseForSpace(over, [5300, 80, 2200], RECT), 'shrinking toward legal').toBeNull();
    expect(refuseForSpace(over, [5500, 80, 2400], RECT), 'its height').toBeNull();
    expect(refuseForSpace(over, [5600, 80, 2200], RECT)?.axis, 'but not growing it further').toBe(0);
  });

  it('height is never bounded here — `clearance.ts` reports a tall piece instead', () => {
    expect(refuseForSpace(sofa(0), [2200, 900, 9000], RECT)).toBeNull();
  });

  it('a new piece is refused on its size alone', () => {
    expect(refuseNewForSpace({ ...onWest, dimMM: [5200, 80, 2200] }, RECT)?.limit.why).toBe('wall');
    expect(refuseNewForSpace(sofa(0, [6500, 900, 850]), RECT)?.limit.why).toBe('room');
    expect(refuseNewForSpace(onWest, RECT)).toBeNull();
  });
});

describe('the sentence', () => {
  it('names the limit, rounded DOWN so the number it quotes is itself allowed', () => {
    const r = { axis: 0 as const, limit: { maxMM: 2957, why: 'wall' as const }, askedMM: 4000 };
    expect(describeSpaceRefusal('Curtain', r, 'm')).toBe(
      'Curtain can be at most 2.95 m wide here. That is the whole length of the wall it hangs on.',
    );
    const deep = { axis: 1 as const, limit: { maxMM: 4999.6, why: 'room' as const }, askedMM: 5200 };
    expect(describeSpaceRefusal('Rug', deep, 'cm')).toBe('Rug can be at most 499.9 cm deep here. That is as far as the room reaches that way.');
  });
});

function inward(poly: Footprint, i: number) {
  // Reads the winding, like `edgeProjection`, so this fixture cannot share a
  // centroid mistake with the subject.
  let area = 0;
  for (let k = 0; k < poly.length; k++) {
    const [x1, z1] = poly[k];
    const [x2, z2] = poly[(k + 1) % poly.length];
    area += x1 * z2 - x2 * z1;
  }
  const s = area > 0 ? 1 : -1;
  const a = poly[i];
  const b = poly[(i + 1) % poly.length];
  const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const nx = (-(b[1] - a[1]) * s) / l;
  const nz = ((b[0] - a[0]) * s) / l;
  return { nx, nz, yaw: Math.atan2(nx, nz) };
}

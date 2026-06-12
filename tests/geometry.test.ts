import { describe, it, expect } from 'vitest';
import {
  obbFromPart,
  obbCorners,
  obbOverlap,
  obbGap,
  nearestEdge,
  rayToBoundary,
  obbExtentAlong,
  obbInsidePoly,
  pointInObb,
  faceClearance,
  type OBB,
  type Poly,
} from '@/lib/geometry';

const box = (cx: number, cz: number, w: number, d: number, rot = 0): OBB => ({
  cx,
  cz,
  hw: w / 2,
  hd: d / 2,
  rot,
});

const RECT: Poly = [
  [-3, -2],
  [3, -2],
  [3, 2],
  [-3, 2],
];

describe('obbOverlap (SAT)', () => {
  it('detects plain axis-aligned overlap', () => {
    expect(obbOverlap(box(0, 0, 2, 1), box(0.5, 0, 2, 1))).toBe(true);
  });

  it('clears separated boxes', () => {
    expect(obbOverlap(box(0, 0, 2, 1), box(3, 0, 2, 1))).toBe(false);
  });

  it('does NOT flag long thin items diagonal to each other (the old circle test did)', () => {
    // Two 2.2m × 0.5m boxes side by side, 0.4m apart — circles of r≈1.13 would
    // "collide", real rectangles don't.
    expect(obbOverlap(box(0, 0, 2.2, 0.5), box(0, 0.9, 2.2, 0.5))).toBe(false);
  });

  it('catches rotated overlap the circle test could shrink past', () => {
    // 45°-rotated box poking into its neighbour.
    expect(obbOverlap(box(0, 0, 2, 0.4, Math.PI / 4), box(0.8, 0.8, 1, 1))).toBe(true);
  });

  it('treats flush contact as non-colliding with a negative pad', () => {
    expect(obbOverlap(box(0, 0, 1, 1), box(1, 0, 1, 1), -0.01)).toBe(false);
    expect(obbOverlap(box(0, 0, 1, 1), box(0.98, 0, 1, 1), -0.01)).toBe(true);
  });
});

describe('obbGap', () => {
  it('is zero when overlapping', () => {
    expect(obbGap(box(0, 0, 2, 2), box(0.5, 0, 2, 2))).toBe(0);
  });

  it('measures the face-to-face gap of parallel boxes', () => {
    const g = obbGap(box(0, 0, 1, 1), box(2, 0, 1, 1));
    expect(g).toBeCloseTo(1, 5);
  });

  it('measures rotated gaps correctly', () => {
    // 45° box corner pointing at a flat face.
    const g = obbGap(box(0, 0, Math.SQRT2, Math.SQRT2, Math.PI / 4), box(3, 0, 1, 1));
    expect(g).toBeCloseTo(3 - 1 - 0.5, 4);
  });
});

describe('nearestEdge', () => {
  it('finds the closest wall with an inward normal', () => {
    const e = nearestEdge(RECT, 0, -1.5)!; // near the North wall (z = -2)
    expect(e.pz).toBeCloseTo(-2);
    expect(e.nz).toBeGreaterThan(0); // inward = +Z
    expect(e.yaw).toBeCloseTo(0); // facing into the room
  });

  it('snaps to inner edges of an L footprint, not the bounding box', () => {
    // L-room: SE quadrant removed. A point in the remaining wing near the
    // inner vertical edge should pick that edge.
    const L: Poly = [
      [-3, -2],
      [3, -2],
      [3, 0],
      [1, 0],
      [1, 2],
      [-3, 2],
    ];
    const e = nearestEdge(L, 1.2, 1.0)!;
    // Closest edge is x=1 (the inner wall), not the outer x=3.
    expect(e.px).toBeCloseTo(1);
    expect(e.nx).toBeLessThan(0); // inward = -X (into the remaining wing)
  });
});

describe('rayToBoundary / obbExtentAlong', () => {
  it('measures distance to the wall along an axis', () => {
    expect(rayToBoundary(0, 0, 1, 0, RECT)).toBeCloseTo(3);
    expect(rayToBoundary(1, 0, 1, 0, RECT)).toBeCloseTo(2);
    expect(rayToBoundary(0, 0, 0, -1, RECT)).toBeCloseTo(2);
  });

  it('projects rotated half-extents', () => {
    const b = box(0, 0, 2, 1, 0);
    expect(obbExtentAlong(b, 1, 0)).toBeCloseTo(1);
    expect(obbExtentAlong(b, 0, 1)).toBeCloseTo(0.5);
    const r = box(0, 0, 2, 1, Math.PI / 2);
    expect(obbExtentAlong(r, 1, 0)).toBeCloseTo(0.5);
  });
});

describe('obbInsidePoly', () => {
  it('accepts a box fully inside and rejects one crossing the boundary', () => {
    expect(obbInsidePoly(box(0, 0, 2, 1), RECT)).toBe(true);
    expect(obbInsidePoly(box(2.8, 0, 2, 1), RECT)).toBe(false);
  });

  it('rejects a box in the notch of an L room even though the bbox allows it', () => {
    const L: Poly = [
      [-3, -2],
      [3, -2],
      [3, 0],
      [1, 0],
      [1, 2],
      [-3, 2],
    ];
    expect(obbInsidePoly(box(2.5, 1.5, 0.8, 0.8), L)).toBe(false); // inside the cut-out
    expect(obbInsidePoly(box(-1, 1, 0.8, 0.8), L)).toBe(true);
  });
});

describe('pointInObb', () => {
  it('respects rotation', () => {
    const r = box(0, 0, 2, 0.5, Math.PI / 2); // long axis now along Z
    expect(pointInObb(0, 0.9, r)).toBe(true);
    expect(pointInObb(0.9, 0, r)).toBe(false);
  });
});

describe('faceClearance', () => {
  it('measures distance to the wall when nothing blocks', () => {
    // 1×1 box at origin facing +Z (front toward z=+2 wall): 2 - 0.5 = 1.5.
    const d = faceClearance(box(0, 0, 1, 1), '+z', [], RECT);
    expect(d).toBeCloseTo(1.5, 1);
  });

  it('stops at an obstacle before the wall', () => {
    const obstacle = box(0, 1.2, 1, 0.4);
    const d = faceClearance(box(0, 0, 1, 1), '+z', [obstacle], RECT);
    expect(d).toBeGreaterThan(0.4);
    expect(d).toBeLessThan(0.56);
  });
});

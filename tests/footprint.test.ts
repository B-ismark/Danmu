import { describe, it, expect } from 'vitest';
import {
  footprintForLayout,
  pointInFootprint,
  clampIntoFootprint,
  polygonCentroid,
  wallSegments,
} from '@/lib/footprint';

describe('footprintForLayout', () => {
  it('builds a centred rectangle for rect/open/custom', () => {
    const fp = footprintForLayout('rect', 6, 4);
    expect(fp).toEqual([
      [-3, -2],
      [3, -2],
      [3, 2],
      [-3, 2],
    ]);
    // open + custom fall through to the same box.
    expect(footprintForLayout('open', 6, 4)).toEqual(fp);
    expect(footprintForLayout('custom', 6, 4)).toEqual(fp);
  });

  it('produces a non-rectangular polygon for L/T/U', () => {
    for (const layout of ['l', 't', 'u'] as const) {
      const fp = footprintForLayout(layout, 6, 4);
      // More than 4 vertices = a notch/arm was cut.
      expect(fp.length).toBeGreaterThan(4);
    }
  });
});

describe('pointInFootprint', () => {
  const rect = footprintForLayout('rect', 6, 4);

  it('detects interior points', () => {
    expect(pointInFootprint(0, 0, rect)).toBe(true);
    expect(pointInFootprint(2.5, 1.5, rect)).toBe(true);
  });

  it('rejects exterior points', () => {
    expect(pointInFootprint(10, 0, rect)).toBe(false);
    expect(pointInFootprint(0, 10, rect)).toBe(false);
  });

  it('treats the L-shape void as outside', () => {
    const l = footprintForLayout('l', 6, 4);
    // The removed South-East quadrant should read as outside.
    const insideAnywhere = pointInFootprint(2.8, 1.9, l);
    expect(insideAnywhere).toBe(false);
  });
});

describe('clampIntoFootprint', () => {
  const rect = footprintForLayout('rect', 6, 4);

  it('leaves interior points untouched', () => {
    expect(clampIntoFootprint(1, 1, rect)).toEqual([1, 1]);
  });

  it('pulls an exterior point back inside', () => {
    const [x, z] = clampIntoFootprint(100, 100, rect);
    expect(pointInFootprint(x, z, rect)).toBe(true);
  });
});

describe('polygonCentroid', () => {
  it('returns the origin for a centred rectangle', () => {
    const [x, z] = polygonCentroid(footprintForLayout('rect', 6, 4));
    expect(x).toBeCloseTo(0);
    expect(z).toBeCloseTo(0);
  });
});

describe('wallSegments', () => {
  it('emits one segment per rectangle edge with positive length', () => {
    const segs = wallSegments(footprintForLayout('rect', 6, 4));
    expect(segs).toHaveLength(4);
    for (const s of segs) expect(s.len).toBeGreaterThan(0);
  });
});

// The capture screen's plan lights the wall each photo is measured against. These
// pin that it is the outline's wall, in plan coordinates, and nothing where the
// lens has no wall ahead.
import { describe, expect, it } from 'vitest';
import { framedWall } from '@/lib/capture-plan';
import { footprintForLayout } from '@/lib/footprint';
import { SLOT_ORDER } from '@/lib/capture-slots';

const sorted = (seg: [[number, number], [number, number]] | null) =>
  seg && [...seg].sort((a, b) => a[0] - b[0] || a[1] - b[1]);

describe('framedWall', () => {
  it('a 6 × 4 rectangle: each slot lights its own whole side', () => {
    const fp = footprintForLayout('rect', 6, 4);
    expect(sorted(framedWall('n', fp))).toEqual([[-3, -2], [3, -2]]);
    expect(sorted(framedWall('s', fp))).toEqual([[-3, 2], [3, 2]]);
    expect(sorted(framedWall('e', fp))).toEqual([[3, -2], [3, 2]]);
    expect(sorted(framedWall('w', fp))).toEqual([[-3, -2], [-3, 2]]);
  });

  it('an off-centre room: each wall’s own ends, not a mirror of them', () => {
    // A centred rectangle is symmetric about the lens, so a map that flipped a
    // wall's ends would pass the case above. This one is not.
    const fp: [number, number][] = [[-2, -1], [4, -1], [4, 3], [-2, 3]];
    expect(sorted(framedWall('n', fp))).toEqual([[-2, -1], [4, -1]]);
    expect(sorted(framedWall('s', fp))).toEqual([[-2, 3], [4, 3]]);
    expect(sorted(framedWall('e', fp))).toEqual([[4, -1], [4, 3]]);
    expect(sorted(framedWall('w', fp))).toEqual([[-2, -1], [-2, 3]]);
  });

  it('a slanted wall is drawn from its own corners, not at one distance', () => {
    // The north wall runs from (-3,-1) to (3,-3): 1 m away at one end, 3 m at the
    // other, crossing the view column at 2 m. Both ends at 2 m would float it off.
    const fp: [number, number][] = [[-3, -1], [3, -3], [3, 2], [-3, 2]];
    expect(sorted(framedWall('n', fp))).toEqual([[-3, -1], [3, -3]]);
    // A slanted east wall too, so the e map is held on an oblique edge.
    const fe: [number, number][] = [[-3, -2], [2, -2], [4, 2], [-3, 2]];
    expect(sorted(framedWall('e', fe))).toEqual([[2, -2], [4, 2]]);
  });

  it('every lit wall lies on the outline, and is as long as the wall the screen names', () => {
    for (const layout of ['rect', 'l', 't', 'u', 'open'] as const) {
      const fp = footprintForLayout(layout, 6, 5);
      for (const slot of SLOT_ORDER) {
        const seg = framedWall(slot, fp);
        if (!seg) continue;
        // Both ends on some edge of the polygon.
        for (const [x, z] of seg) {
          const onEdge = fp.some(([ax, az], i) => {
            const [bx, bz] = fp[(i + 1) % fp.length];
            const cross = (bx - ax) * (z - az) - (bz - az) * (x - ax);
            const within = Math.min(ax, bx) - 1e-9 <= x && x <= Math.max(ax, bx) + 1e-9 && Math.min(az, bz) - 1e-9 <= z && z <= Math.max(az, bz) + 1e-9;
            return Math.abs(cross) < 1e-9 && within;
          });
          expect(onEdge, `${layout}/${slot} end ${x},${z}`).toBe(true);
        }
      }
    }
  });

  it('the u’s north view lights nothing: the lens stands on the notch', () => {
    expect(framedWall('n', footprintForLayout('u', 6, 5))).toBeNull();
  });

  it('a t’s stem wall is the short one, not the box side', () => {
    const fp = footprintForLayout('t', 5.5, 4.7);
    const seg = framedWall('s', fp)!;
    const len = Math.hypot(seg[1][0] - seg[0][0], seg[1][1] - seg[0][1]);
    expect(len).toBeLessThan(5.5 / 2);
  });
});

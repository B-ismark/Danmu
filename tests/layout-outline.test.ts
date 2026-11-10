import { describe, expect, it } from 'vitest';
import { footprintForLayout } from '@/lib/footprint';
import { planFor } from '@/lib/layout-outline';
import { ROOM_PRESETS } from '@/lib/room-presets';

// Parse "M x y L x y ... Z" back into points.
const points = (path: string) =>
  [...path.matchAll(/[ML]([\d.-]+) ([\d.-]+)/g)].map((m) => [Number(m[1]), Number(m[2])] as const);

const fit = {
  w: Math.max(...ROOM_PRESETS.map((p) => p.width)),
  d: Math.max(...ROOM_PRESETS.map((p) => p.depth)),
};

describe('layout picker outlines are derived from the footprint', () => {
  for (const p of ROOM_PRESETS) {
    it(`${p.id}: one outline vertex per footprint vertex, in the footprint's proportions`, () => {
      const poly = footprintForLayout(p.id, p.width, p.depth);
      const pts = points(planFor(p.id, p.width, p.depth).path);
      expect(pts).toHaveLength(poly.length);
      // The drawing is a uniform scale of the metre polygon: the scale is read off the
      // bounding spans, then every vertex must land where that scale puts it.
      const span = (a: number[]) => Math.max(...a) - Math.min(...a);
      const s = span(pts.map((q) => q[0])) / span(poly.map((q) => q[0]));
      pts.forEach(([x, y], i) => {
        expect(x - pts[0][0]).toBeCloseTo((poly[i][0] - poly[0][0]) * s, 0);
        expect(y - pts[0][1]).toBeCloseTo((poly[i][1] - poly[0][1]) * s, 0);
      });
    });
  }

  it('every preset gets a distinct thumbnail on the shared scale, Open Plan included', () => {
    const paths = ROOM_PRESETS.map((p) => planFor(p.id, p.width, p.depth, fit).path);
    expect(new Set(paths).size).toBe(ROOM_PRESETS.length);
  });

  it('Open Plan (a rectangle by footprint) draws larger than Rectangle at one scale', () => {
    const wOf = (id: 'rect' | 'open') => {
      const p = ROOM_PRESETS.find((x) => x.id === id)!;
      return planFor(id, p.width, p.depth, fit).box.w;
    };
    expect(wOf('open')).toBeGreaterThan(wOf('rect') * 1.2);
  });
});

import { describe, it, expect } from 'vitest';
import {
  footprintForLayout,
  pointInFootprint,
  clampIntoFootprint,
  polygonCentroid,
  polygonSignedArea,
  wallOutwardNormal,
  wallSegments,
  footprintBounds,
  offsetWall,
} from '@/lib/footprint';

const LAYOUTS = ['rect', 'l', 't', 'u', 'open'] as const;

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

describe('footprintBounds', () => {
  it('measures a centred rectangle', () => {
    const b = footprintBounds(footprintForLayout('rect', 6, 4));
    expect(b.width).toBeCloseTo(6);
    expect(b.depth).toBeCloseTo(4);
    expect(b.cx).toBeCloseTo(0);
    expect(b.cz).toBeCloseTo(0);
    expect(b.minX).toBeCloseTo(-3);
    expect(b.maxZ).toBeCloseTo(2);
  });
});

describe('offsetWall', () => {
  const rect = footprintForLayout('rect', 6, 4); // [[-3,-2],[3,-2],[3,2],[-3,2]]

  it('moves only the selected edge outward, leaving the opposite wall fixed', () => {
    // Edge 0 is the north edge (z = -2); pushing out grows depth on that side only.
    const next = offsetWall(rect, 0, 1);
    const b = footprintBounds(next);
    expect(b.depth).toBeCloseTo(5); // 4 + 1
    expect(b.minZ).toBeCloseTo(-3); // moved edge
    expect(b.maxZ).toBeCloseTo(2); // opposite edge unchanged
    expect(b.width).toBeCloseTo(6); // width untouched
    // The two far vertices (south edge) are exactly where they started.
    expect(next[2]).toEqual([3, 2]);
    expect(next[3]).toEqual([-3, 2]);
  });

  it('pulling a wall inward shrinks that side only', () => {
    const next = offsetWall(rect, 0, -1); // north edge inward
    const b = footprintBounds(next);
    expect(b.depth).toBeCloseTo(3);
    expect(b.minZ).toBeCloseTo(-1);
    expect(b.maxZ).toBeCloseTo(2);
  });

  it('returns the polygon unchanged for an out-of-range index', () => {
    expect(offsetWall(rect, 9, 1)).toEqual(rect);
  });
});

describe('wallOutwardNormal points out of the ROOM, not away from a point', () => {
  // The old implementation flipped the edge perpendicular by testing it against
  // `polygonCentroid`, which averages the VERTICES. That is exact for a convex
  // room and wrong for the ones this app ships: on a T the average lands in the
  // notch beside the stem, on a U between the arms — outside the floor — and every
  // wall whose midpoint sits on the far side of it comes back reversed.
  //
  // Every test that existed for this used a RECTANGLE, where the vertex average IS
  // the true centroid and all four normals are right. That is the whole reason it
  // went unnoticed: the assertions were real, and the fixture could not express the
  // defect. The sweep below is the fixture that can.
  const EPS = 0.01;

  it.each(LAYOUTS)('steps OUT of the polygon on every wall of a %s room', (id) => {
    const poly = footprintForLayout(id, 6, 5);
    const wrong: string[] = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const mx = (a[0] + b[0]) / 2;
      const mz = (a[1] + b[1]) / 2;
      const [nx, nz] = wallOutwardNormal(poly, i);
      // Both directions, because "outside" alone passes for a normal that is
      // tangent to the wall and leaves the room by the side door.
      const out = pointInFootprint(mx + nx * EPS, mz + nz * EPS, poly);
      const inside = pointInFootprint(mx - nx * EPS, mz - nz * EPS, poly);
      if (out || !inside) wrong.push(`edge ${i} (out=${out} in=${inside})`);
      expect(Math.hypot(nx, nz)).toBeCloseTo(1, 9);
    }
    expect(wrong, `${id}: ${wrong.join(', ')}`).toEqual([]);
  });

  it('counts the walls it swept, so a shape that stops being non-convex is loud', () => {
    // Without this the sweep above passes over a rectangle four times and reports
    // nothing. The T and the U are the only presets that can hold the defect.
    expect(footprintForLayout('t', 6, 5)).toHaveLength(8);
    expect(footprintForLayout('u', 6, 5)).toHaveLength(8);
    expect(footprintForLayout('l', 6, 5)).toHaveLength(6);
  });

  it('is a property of the shape, not of the vertex order', () => {
    // Reversing the winding flips the signed area, and the outward normal must NOT
    // move: which side is outdoors is geometry. This is what pins the sign to the
    // area rather than to a hard-coded perpendicular.
    const u = footprintForLayout('u', 6, 5);
    const reversed = [...u].reverse();
    expect(Math.sign(polygonSignedArea(u))).toBe(-Math.sign(polygonSignedArea(reversed)));
    for (let i = 0; i < u.length; i++) {
      const b = u[(i + 1) % u.length];
      // The same wall, addressed in the reversed polygon: a→b becomes b→a, which is
      // the edge starting at the index of `b` counted from the other end.
      const j = reversed.findIndex((p) => p[0] === b[0] && p[1] === b[1]);
      const [nx, nz] = wallOutwardNormal(u, i);
      const [rx, rz] = wallOutwardNormal(reversed, j);
      expect(rx).toBeCloseTo(nx, 9);
      expect(rz).toBeCloseTo(nz, 9);
    }
  });

  it('keeps the rectangle answers the wall-move tests are written against', () => {
    // `tests/wall-move.test.ts` names edge 0 North and edge 1 East and asserts a
    // pushed-out North wall moves its sofa to LOWER z. Pinned here so a change to
    // the winding convention fails in the file that owns it.
    const r = footprintForLayout('rect', 4, 4);
    expect(wallOutwardNormal(r, 0)).toEqual([0, -1]);
    expect(wallOutwardNormal(r, 1)).toEqual([1, 0]);
    expect(wallOutwardNormal(r, 2)).toEqual([0, 1]);
    expect(wallOutwardNormal(r, 3)).toEqual([-1, 0]);
  });

  it('returns a zero vector rather than guessing at a degenerate input', () => {
    const r = footprintForLayout('rect', 4, 4);
    expect(wallOutwardNormal(r, -1)).toEqual([0, 0]);
    expect(wallOutwardNormal(r, 4)).toEqual([0, 0]);
    expect(wallOutwardNormal([[0, 0], [1, 0]], 0)).toEqual([0, 0]);
  });

  it('and `offsetWall` therefore makes a T and a U BIGGER on every wall', () => {
    // The consequence, stated where it is felt: `delta > 0` is documented as "push
    // out / bigger room", and on the five reversed walls it shrank the room instead
    // while `lib/wall-move.ts` carried the furniture inward with it.
    for (const id of ['t', 'u'] as const) {
      const poly = footprintForLayout(id, 6, 5);
      const before = Math.abs(polygonSignedArea(poly));
      for (let i = 0; i < poly.length; i++) {
        const after = Math.abs(polygonSignedArea(offsetWall(poly, i, 0.25)));
        expect(after, `${id} wall ${i} shrank the room`).toBeGreaterThan(before);
      }
    }
  });
});

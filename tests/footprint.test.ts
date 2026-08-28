import { describe, it, expect } from 'vitest';
import {
  footprintForLayout,
  pointInFootprint,
  clampIntoFootprint,
  distanceToFootprintEdge,
  ON_WALL_M,
  interiorPoint,
  polygonCentroid,
  polygonSignedArea,
  wallOutwardNormal,
  wallSegments,
  footprintBounds,
  offsetWall,
  type Footprint,
  type LayoutId,
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

  // ── …on every room shape, not just the rectangle ──────────────────────────
  //
  // The test above is satisfied by a rectangle and a rectangle cannot show the bug:
  // the two centroids coincide there. On a U at 7.5 x 5.6 the CORNER average — what
  // this walked toward — is 0.70 m into the gap between the legs, outside the room.
  // Every step of the walk was then outside too, and the function's last line handed
  // that same outside point back. Callers read the result as "inside now"; there is
  // no second return value telling them otherwise, which is what made it silent.
  //
  // The eight compass directions matter for the same reason the repo's asymmetry rule
  // does: a U is only wrong from the side its notch faces, and one probe from the
  // north-west would have found nothing.
  const SHAPES: LayoutId[] = ['rect', 'l', 't', 'u', 'open'];
  const FAR = [
    [100, 100],
    [-100, 100],
    [100, -100],
    [-100, -100],
    [0, 100],
    [0, -100],
    [100, 0],
    [-100, 0],
  ];

  it('lands inside the room from every direction, on every preset', () => {
    const escaped: string[] = [];
    for (const id of SHAPES) {
      const poly = footprintForLayout(id, 7.5, 5.6);
      for (const [fx, fz] of FAR) {
        const [x, z] = clampIntoFootprint(fx, fz, poly);
        if (!pointInFootprint(x, z, poly)) {
          escaped.push(`${id} from (${fx}, ${fz}) -> (${x.toFixed(2)}, ${z.toFixed(2)})`);
        }
      }
    }
    expect(escaped, escaped.join('\n')).toEqual([]);
  });
});

describe('interiorPoint', () => {
  it('is inside the room on every preset', () => {
    const outside: string[] = [];
    for (const id of ['rect', 'l', 't', 'u', 'open'] as LayoutId[]) {
      const poly = footprintForLayout(id, 7.5, 5.6);
      const pt = interiorPoint(poly);
      if (!pt || !pointInFootprint(pt[0], pt[1], poly)) {
        outside.push(`${id} -> ${pt ? `(${pt[0].toFixed(2)}, ${pt[1].toFixed(2)})` : 'null'}`);
      }
    }
    expect(outside, outside.join('\n')).toEqual([]);
  });

  it('and the corner average is not — which is why this function exists', () => {
    // The measurement the fix is for, stated so that deleting `interiorPoint` and
    // going back to `polygonCentroid` cannot look like a simplification.
    const u = footprintForLayout('u', 7.5, 5.6);
    const [cx, cz] = polygonCentroid(u);
    expect(pointInFootprint(cx, cz, u), 'the U is the shape that shows this').toBe(false);
  });

  it('survives a room with no interior at all', () => {
    // A polygon collapsed onto a line. Neither the scan nor the edge probe finds
    // anything — every probe off a zero-area edge lands off the line — and the
    // contract is to say so rather than return a plausible-looking point.
    expect(interiorPoint([[0, 0], [1, 0], [2, 0]])).toBeNull();
    // …and the clamp then leaves its input alone rather than moving it somewhere it
    // cannot justify.
    expect(clampIntoFootprint(5, 5, [[0, 0], [1, 0], [2, 0]])).toEqual([5, 5]);
  });

  it('finds the floor of a room whose legs are thinner than the grid', () => {
    // A U 8 x 6 whose legs and base are 40 mm. This is a room the app CALLS LEGAL:
    // `moveWall` accepts any wall drag whose bounding box stays inside `ROOM_SIDE_M`,
    // and nothing anywhere floors the width of a leg — so a user who drags the notch
    // walls out gets exactly this.
    //
    // Every one of the three answers matters here and the fixture is built so that the
    // first two fail. The area centroid is at roughly (0, 1.19), which is in the notch
    // and outside. The grid samples at `minX + 0.05 + 0.1k`, so its nearest columns to
    // the legs are ±3.95 and the legs start at ±3.96; its nearest row to the base is
    // 2.95 and the base starts at 2.96. Every sample misses, by 10 mm, on purpose —
    // which is what the clamp used to do about it: nothing at all, silently, on all
    // four of its call sites.
    const thinU: Footprint = [
      [-4, -3],
      [-3.96, -3],
      [-3.96, 2.96],
      [3.96, 2.96],
      [3.96, -3],
      [4, -3],
      [4, 3],
      [-4, 3],
    ];
    const b = footprintBounds(thinU);
    expect(b.width, 'the fixture has to be a room the app would accept').toBeCloseTo(8, 6);
    expect(b.depth).toBeCloseTo(6, 6);
    const pt = interiorPoint(thinU);
    expect(pt, 'a room with floor in it must not come back null').not.toBeNull();
    expect(pointInFootprint(pt![0], pt![1], thinU), `${pt} must be inside the thin U`).toBe(true);
    expect(Object.isFrozen(pt), 'the edge-probe answer is shared too, so it is frozen too').toBe(true);
    // And the clamp built on it now moves a point rather than shrugging.
    const [cx, cz] = clampIntoFootprint(0, 0, thinU);
    expect(pointInFootprint(cx, cz, thinU), `(${cx}, ${cz}) must be inside`).toBe(true);
  });

  it('answers a given polygon once and hands back the same object', () => {
    // The memo, asserted by IDENTITY because that is the only thing about it a test
    // can see — there is no counter to read and a timing assertion is worthless on a
    // loaded machine. Two of the four `clampIntoFootprint` call sites are inside the
    // annealer's proposal generator, so without this the grid scan above is paid per
    // proposal: measured at 15.1 ms for a 50 x 50 room, against `DEFAULT_STEPS` of
    // 1600. The answer is frozen, which is what makes handing out one instance safe.
    const u = footprintForLayout('u', 7.5, 5.6);
    const first = interiorPoint(u);
    expect(interiorPoint(u)).toBe(first);
    expect(Object.isFrozen(first)).toBe(true);
    // Keyed on the polygon's identity, not its contents: an equal-but-distinct array
    // gets its own answer. Stated because it is the surprising half, and because it is
    // what makes the memo safe — a footprint is a value here, and nothing mutates one.
    const twin = footprintForLayout('u', 7.5, 5.6);
    expect(twin).toEqual(u);
    expect(interiorPoint(twin)).not.toBe(first);
    expect(interiorPoint(twin)).toEqual(first);
  });
});

// ─── On a wall, or in the void behind one ───────────────────────────────────
//
// `pointInFootprint` cannot answer this. It is a ray test, so a point exactly on an
// edge reads as OUTSIDE — indistinguishable from a point in an L, T or U's notch. The
// annealer's nudge in `lib/layout-solve.ts` needs to treat those two oppositely: keep
// the first, decline the second. `distanceToFootprintEdge` is what separates them, and
// `ON_WALL_M` is the band.
describe('distanceToFootprintEdge', () => {
  const RECT = footprintForLayout('rect', 6, 4);

  it('is zero on all four walls and on every corner', () => {
    // The case that matters: a bounding-box clamp puts a coordinate exactly here, and
    // it does it on whichever wall the nudge overshot.
    expect(distanceToFootprintEdge(3, 0, RECT)).toBeCloseTo(0, 12);
    expect(distanceToFootprintEdge(-3, 0, RECT)).toBeCloseTo(0, 12);
    expect(distanceToFootprintEdge(0, 2, RECT)).toBeCloseTo(0, 12);
    expect(distanceToFootprintEdge(0, -2, RECT)).toBeCloseTo(0, 12);
    for (const [x, z] of [
      [3, 2],
      [3, -2],
      [-3, 2],
      [-3, -2],
    ] as Array<[number, number]>) {
      expect(distanceToFootprintEdge(x, z, RECT), `corner ${x},${z}`).toBeCloseTo(0, 12);
    }
  });

  // ── And this is the asymmetry the solver was riding on ──────────────────────
  //
  // `pointInFootprint` is a ray-crossing test with a half-open convention, so a point
  // exactly on the boundary reads INSIDE on two of a rectangle's four walls and OUTSIDE
  // on the other two. Not a rounding artefact — these are exact coordinates.
  //
  // It is pinned here because a caller reading `!pointInFootprint` as "outside the room"
  // does not merely get it wrong, it gets it wrong on two walls out of four. The
  // annealer's nudge did exactly that through `clampIntoFootprint`, which walks an
  // "outside" point 15% toward `interiorPoint`: a piece could be proposed flush against
  // the west and south walls of every room in the app and never against the east or the
  // north. Invisible in every aggregate, because the rooms are symmetric and the tests
  // summed over seeds — the failure mode `CLAUDE.md` calls verifying in the asymmetric
  // case.
  //
  // Two mutations to keep in mind here rather than changing the convention: making the
  // test closed (`>=` on both ends) is a change to a function eleven modules read, and
  // making it open on all four sides breaks `interiorPoint`'s own edge probes. What the
  // solver needed was not a different convention but a different QUESTION, which is
  // what `distanceToFootprintEdge` is.
  it('pins the half-open convention `pointInFootprint` actually has', () => {
    expect(pointInFootprint(-3, 0, RECT), 'west wall reads inside').toBe(true);
    expect(pointInFootprint(0, -2, RECT), 'south wall reads inside').toBe(true);
    expect(pointInFootprint(3, 0, RECT), 'east wall reads outside').toBe(false);
    expect(pointInFootprint(0, 2, RECT), 'north wall reads outside').toBe(false);
    // One corner in four, and it is the one where both inside-reading walls meet.
    expect(pointInFootprint(-3, -2, RECT), 'south-west corner').toBe(true);
    for (const [x, z] of [
      [3, 2],
      [3, -2],
      [-3, 2],
    ] as Array<[number, number]>) {
      expect(pointInFootprint(x, z, RECT), `corner ${x},${z}`).toBe(false);
    }
  });

  it('measures the same distance either side of an edge', () => {
    // Unsigned, deliberately: the caller already knows which side it is on from
    // `pointInFootprint`, and what it needs from here is only "how far".
    expect(distanceToFootprintEdge(2.7, 0, RECT)).toBeCloseTo(0.3, 12);
    expect(distanceToFootprintEdge(3.3, 0, RECT)).toBeCloseTo(0.3, 12);
  });

  it('takes the nearest of the four walls, not the first', () => {
    // The poly's first edge is the SOUTH wall, and this point's nearest is the EAST
    // one — 0.2 against 3.0. A loop that returned on its first finite answer reports
    // 3.0 here, which is the mutation this fixture exists for. The first version used
    // (2.5, −1.8), whose nearest wall IS the first edge, so it agreed with the mutant
    // and could not fail: a check that cannot fail, in the assertion written to
    // prevent exactly that.
    expect(RECT[0]).toEqual([-3, -2]);
    expect(RECT[1]).toEqual([3, -2]);
    expect(distanceToFootprintEdge(2.8, 1.0, RECT)).toBeCloseTo(0.2, 12);
  });

  it('measures to a vertex, not to an edge’s infinite line', () => {
    // Off the end of the south wall AND off the end of the east wall: the answer is
    // the diagonal to the corner they share. Dropping the `t` clamp in the
    // implementation returns 1.0 — the perpendicular distance to a wall that does not
    // reach this far — which is the defect `nearestEdge` in `lib/geometry.ts` has its
    // own comment about.
    expect(distanceToFootprintEdge(4, -3, RECT)).toBeCloseTo(Math.SQRT2, 12);
  });

  it('reads a U’s notch as far from any wall while its base reads as near', () => {
    // The two cases the solver has to tell apart, in one assertion each. The notch of
    // a U 6 × 5 spans x ±0.66 from z = −2.5 to z = 0; a point in the middle of it is
    // outside the room and nowhere near a wall.
    const u = footprintForLayout('u', 6, 5);
    expect(pointInFootprint(0, -1.2, u)).toBe(false);
    expect(distanceToFootprintEdge(0, -1.2, u)).toBeGreaterThan(ON_WALL_M);
    // …while a point the bounding-box clamp pinned to the U's own south-east wall is
    // also `pointInFootprint` false, and inside the band.
    expect(pointInFootprint(3, -2, u)).toBe(false);
    expect(distanceToFootprintEdge(3, -2, u)).toBeLessThan(ON_WALL_M);
  });

  it('is a band no user can see', () => {
    // Not a free-floating epsilon: it has to stay below the app's own resolution, or
    // it becomes a tolerance on something a person can measure. Dimensions are whole
    // millimetres and `NAV_CELL` is 50 mm.
    expect(ON_WALL_M).toBeGreaterThan(0);
    expect(ON_WALL_M).toBeLessThan(0.001 * 10);
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

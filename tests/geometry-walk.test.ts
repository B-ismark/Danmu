// The instrument's own predicates, asserted directly.
//
// `tests/footprint-fidelity.test.tsx` and `tests/footprint-outcomes.test.tsx` publish rates
// computed out of `tests/helpers/geometry-walk.ts`, and every one of those rates is a
// statement about `hullsOverlap`, `worldHulls` and `unionArea` before it is a statement about
// the app. None of the three had an assertion of its own: `hullsOverlap` could `return false`
// on its first line and four of the six tests in those files stayed green, because a
// measurement that reports "no difference" reads exactly like a measurement of a codebase
// with no difference in it.
//
// The pad cases are the ones that earned this file. The first implementation applied `pad` as
// a shrink of each polygon toward its centroid, which is right for a square and wrong for
// anything long: pulling the corners of a 1000 x 110 soundbar inward moves them almost
// entirely along its LONG axis, so its 110 mm depth barely narrows and the piece reports
// collisions at separations production allows. It produced 62 of them and the row was read as
// a finding about the app.

import { describe, expect, it } from 'vitest';
import {
  convexHull,
  hullsOverlap,
  pointInHull,
  unionArea,
  worldHulls,
  type Prim,
} from './helpers/geometry-walk';

/** An axis-aligned rectangle as the four points `hullsOverlap` expects. */
const rect = (cx: number, cz: number, w: number, d: number): Array<[number, number]> => [
  [cx - w / 2, cz - d / 2],
  [cx + w / 2, cz - d / 2],
  [cx + w / 2, cz + d / 2],
  [cx - w / 2, cz + d / 2],
];

/** `collidesAt`'s own pad, the value both measurement files run at. */
const PAD = -0.01;

describe('hullsOverlap', () => {
  it('separates and overlaps the obvious pairs', () => {
    expect(hullsOverlap(rect(0, 0, 1, 1), rect(5, 0, 1, 1), 0), 'far apart').toBe(false);
    expect(hullsOverlap(rect(0, 0, 1, 1), rect(0.5, 0, 1, 1), 0), 'half overlapped').toBe(true);
    expect(hullsOverlap(rect(0, 0, 1, 1), rect(0, 0, 0.2, 0.2), 0), 'one inside the other').toBe(true);
  });

  it('a negative pad is what lets two pieces sit flush without colliding', () => {
    // Exactly touching: the right edge of one is the left edge of the other.
    const touching = [rect(0, 0, 1, 1), rect(1, 0, 1, 1)] as const;
    expect(hullsOverlap(touching[0], touching[1], PAD), 'flush pieces do not collide').toBe(false);
    // 5 mm of real overlap is still inside the 10 mm the pad forgives...
    expect(hullsOverlap(rect(0, 0, 1, 1), rect(0.995, 0, 1, 1), PAD), '5 mm overlap').toBe(false);
    // ...and 15 mm is not. Both ends, because a pad asserted from one side only is a
    // pad that could be any size at all in the other direction.
    expect(hullsOverlap(rect(0, 0, 1, 1), rect(0.985, 0, 1, 1), PAD), '15 mm overlap').toBe(true);
    // The same pair with no pad at all: the 5 mm overlap must come back.
    expect(hullsOverlap(rect(0, 0, 1, 1), rect(0.995, 0, 1, 1), 0), '5 mm overlap, unpadded').toBe(true);
  });

  it('applies the pad as an overlap DEPTH, not as a shrink toward the centroid', () => {
    // The soundbar. 1000 x 110, and the two overlap by 5 mm on the SHORT axis — inside
    // the 10 mm the pad forgives, so this must not collide.
    //
    // A radial shrink gets this wrong and only here: scaling the corners of a 1000 x 110
    // rectangle about its centre by enough to lose 10 mm of length loses about 1 mm of
    // depth, so the 5 mm overlap survives the shrink and the pair reports a collision.
    // The aspect ratio is the whole test, which is why the square above cannot replace it.
    expect(hullsOverlap(rect(0, 0, 1, 0.11), rect(0, 0.105, 1, 0.11), PAD), 'thin, 5 mm on the short axis').toBe(false);
    // The same 5 mm on the long axis, so the claim is about the pad and not about which
    // axis happens to be short.
    expect(hullsOverlap(rect(0, 0, 1, 0.11), rect(0.995, 0, 1, 0.11), PAD), 'thin, 5 mm on the long axis').toBe(false);
    // And the same pair genuinely overlapping, so the fixture is not simply always false.
    expect(hullsOverlap(rect(0, 0, 1, 0.11), rect(0, 0.05, 1, 0.11), PAD), 'thin, 60 mm on the short axis').toBe(true);
  });

  it('separates a rotated pair, where an axis-aligned test would not', () => {
    // Rule 9's asymmetric case. A diamond and a square whose AXIS-ALIGNED BOUNDS overlap
    // while the shapes themselves do not: the separating axis is one of the diamond's own
    // edge normals, so a test that only scanned `a`'s edges — or only `b`'s — answers
    // this one wrong. Both scans are why `hullsOverlap` calls `scan` twice.
    const diamond: Array<[number, number]> = [[0, -0.5], [0.5, 0], [0, 0.5], [-0.5, 0]];
    expect(hullsOverlap(diamond, rect(0.62, 0.62, 0.5, 0.5), 0), 'corner-to-corner, bounds overlap').toBe(false);
    // The SAME pair with the arguments swapped, which is the assertion that the second
    // scan exists. Here the separating axis belongs to the second polygon, so a version
    // that scanned only the first answers this one wrong while answering the line above
    // correctly — and it survived as a mutation until this line was written.
    expect(hullsOverlap(rect(0.62, 0.62, 0.5, 0.5), diamond, 0), 'the same pair, swapped').toBe(false);
    expect(hullsOverlap(diamond, rect(0.4, 0.4, 0.5, 0.5), 0), 'the same pair, closer').toBe(true);
  });

  it('refuses a polygon that is not one', () => {
    // `worldHulls` can return a degenerate hull for a primitive with no floor area — a
    // vertical plane is two points — and the outcomes file counts those rather than
    // letting them read as "does not collide". They must not throw or claim a hit.
    expect(hullsOverlap([[0, 0], [1, 0]], rect(0, 0, 1, 1), 0), 'a segment').toBe(false);
    expect(hullsOverlap([], rect(0, 0, 1, 1), 0), 'nothing').toBe(false);
  });
});

describe('worldHulls', () => {
  const flat = (pts: Array<[number, number]>): Prim => ({ kind: 'Box', pts, y: [0, 1], spun: false });

  it('rotates the way `Draggable` does, checked off-axis', () => {
    // `geometry.ts`'s convention: a part's front is local +Z, so world x picks up
    // `+z * sin` and world z picks up `-x * sin`. At 0 deg or 180 deg, and on a square,
    // the opposite sign is invisible — so the fixture is a quarter turn on a rectangle
    // that is longer than it is deep.
    const [got] = worldHulls([flat(rect(0, 0, 2, 0.4))], [3, 0, -1], Math.PI / 2);
    const xs = got.hull.map((p) => p[0]);
    const zs = got.hull.map((p) => p[1]);
    expect(Math.max(...xs) - Math.min(...xs), 'the 2 m side now lies along z').toBeCloseTo(0.4, 6);
    expect(Math.max(...zs) - Math.min(...zs), 'and the 0.4 m side along x').toBeCloseTo(2, 6);
    expect((Math.max(...xs) + Math.min(...xs)) / 2, 'centred on pos x').toBeCloseTo(3, 6);
    expect((Math.max(...zs) + Math.min(...zs)) / 2, 'centred on pos z').toBeCloseTo(-1, 6);

    // The sign itself, which the extents above cannot see: local +x must map to world
    // -z at a quarter turn. Swap the sign and every extent here still passes.
    const [corner] = worldHulls([flat([[1, 0], [1.01, 0], [1.01, 0.01], [1, 0.01]])], [0, 0, 0], Math.PI / 2);
    expect(corner.hull.every(([, z]) => z < 0), 'local +x lands at world -z').toBe(true);
  });

  it('gives a spun primitive the disc it sweeps, not the box it is drawn as', () => {
    // A blade drawn out at x = 0.7 occupies the whole 0.7 m circle once `Spin` turns it.
    const blade: Prim = { kind: 'Box', pts: rect(0.7, 0, 0.1, 0.05), y: [2, 2.1], spun: true };
    const [got] = worldHulls([blade], [0, 0, 0], 0);
    const r = Math.max(...got.hull.map(([x, z]) => Math.hypot(x, z)));
    expect(r, 'reaches the blade tip in every direction').toBeCloseTo(0.75, 2);
    expect(pointInHull(-0.6, 0, got.hull), 'including behind the hub').toBe(true);
    // Not spun, the same primitive stays where it is drawn.
    const [still] = worldHulls([{ ...blade, spun: false }], [0, 0, 0], 0);
    expect(pointInHull(-0.6, 0, still.hull), 'a still blade is only where it is drawn').toBe(false);
  });
});

describe('unionArea', () => {
  it('measures a known rectangle to within its own raster', () => {
    // Every area in the fidelity table is this function, so it needs one case whose
    // answer is arithmetic rather than another run of itself.
    const box = { x0: -1, x1: 1, z0: -1, z1: 1 };
    const a = unionArea([{ kind: 'Box', pts: rect(0, 0, 1, 0.5), y: [0, 1], spun: false }], box, 0.005);
    expect(a, '1.0 x 0.5').toBeCloseTo(0.5, 2);
    // Two overlapping primitives are a UNION, not a sum: this is what stops a shape built
    // from many boxes reporting several times its own floor area.
    const two = unionArea(
      [
        { kind: 'Box', pts: rect(0, 0, 1, 0.5), y: [0, 1], spun: false },
        { kind: 'Box', pts: rect(0.25, 0, 1, 0.5), y: [0, 1], spun: false },
      ],
      box,
      0.005,
    );
    expect(two, 'union of two 1.0 x 0.5 boxes 0.25 apart').toBeCloseTo(0.625, 2);
    expect(unionArea([], box, 0.005), 'nothing has no area').toBe(0);
  });
});

describe('convexHull', () => {
  it('drops interior points and keeps the corners', () => {
    const h = convexHull([[0, 0], [1, 0], [1, 1], [0, 1], [0.5, 0.5], [0.25, 0.75]]);
    expect(h).toHaveLength(4);
    expect(pointInHull(0.5, 0.5, h), 'the interior point is still inside').toBe(true);
    expect(pointInHull(1.5, 0.5, h), 'and a point outside is outside').toBe(false);
  });
});

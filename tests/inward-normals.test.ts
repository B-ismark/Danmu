// Which way is inward.
//
// Every wall answer in this app comes from one of three functions, and all three used
// to decide it by flipping the edge's perpendicular toward a POINT — the average of
// the polygon's corners. That is exact for a convex room and wrong for the shapes this
// app ships, because the point has to be able to SEE the edge:
//
//   · on the U preset the corner average lands in the notch, OUTSIDE the floor;
//   · on the T it is inside the room but on the far side of two of its walls' lines.
//
// `wallOutwardNormal` was fixed for this once already, by reading the polygon's
// winding. Its docblock records the count — "2 of the T's 8 walls and 3 of the U's 8" —
// and `lib/layout-score.ts` recorded that the same fix belonged in `edgeProjection`
// and had not been made. This file is that fix's test, and it covers all three
// functions at once because the defect was one decision copied three times.
//
// What each of the five wrong walls cost, in the callers:
//
//   · `snapToWall` (`lib/physics.ts`) put a wall-mounted piece on the far side of the
//     plaster, so a TV added anywhere near one of them spawned outside the house.
//     Reported by the user, in an L and a T.
//   · `contain` (`lib/layout-settle.ts`) pushed a piece hanging over such a wall
//     further OUT rather than in — a sofa dropped in a U's notch measured 57 % outside
//     the room both before and after the pass that exists to fix exactly that.
//   · `wallSegments` builds `RoomShell`'s wall meshes, so on those five the lit,
//     textured face pointed out of the room and the culled back faced in.
//
// ── Why the sweep, and why the negative control ──────────────────────────────────
//
// The sweep is every edge of every preset, not a chosen example, because choosing
// examples is exactly how this was missed the first three times: the L is CORRECT
// under the old test (its corner average sees all six of its walls) and a rectangle is
// correct by construction. A file that checked a rectangle and an L would have been
// green throughout.
//
// And the last test re-implements the OLD predicate and pins it at 5 of 30 wrong. That
// is the negative control: without it, every assertion here would also pass for a
// polygon set that happens to have no reflex corners, and there would be no evidence
// the sweep can go red at all.
import { describe, expect, it } from 'vitest';
import {
  footprintForLayout,
  pointInFootprint,
  polygonCentroid,
  wallOutwardNormal,
  wallSegments,
  type Footprint,
  type LayoutId,
} from '@/lib/footprint';
import { edgeProjection, nearestEdge, polygonSignedArea, polygonWinding, type Poly } from '@/lib/geometry';

/** The presets `app/onboarding/layout-pick` offers, at the sizes it offers them. */
const PRESETS: Array<{ id: LayoutId; w: number; d: number }> = [
  { id: 'rect', w: 6.0, d: 4.0 },
  { id: 'l', w: 6.0, d: 4.7 },
  { id: 't', w: 5.5, d: 4.7 },
  { id: 'u', w: 6.0, d: 5.0 },
  { id: 'open', w: 7.5, d: 5.6 },
];

/** A room whose walls have been dragged: off-centre on both axes, and non-convex, so
 *  it is not covered by any preset's proportions. `custom` is what `layoutId` becomes
 *  after a wall move. */
const DRAGGED: Footprint = [
  [-1, -1],
  [5, -1],
  [5, 2.4],
  [1.8, 2.4],
  [1.8, 5],
  [-1, 5],
];

/** Every polygon this file sweeps, each in both windings — a footprint has one
 *  winding, but nothing guarantees which, and `offsetWall` can produce either. */
function allPolys(): Array<{ label: string; poly: Footprint }> {
  const base: Array<{ label: string; poly: Footprint }> = [
    ...PRESETS.map((p) => ({ label: `${p.id} ${p.w}x${p.d}`, poly: footprintForLayout(p.id, p.w, p.d) })),
    { label: 'dragged custom', poly: DRAGGED },
  ];
  return [
    ...base,
    ...base.map(({ label, poly }) => ({ label: `${label} reversed`, poly: [...poly].reverse() as Footprint })),
  ];
}

const EPS = 0.02;

function edgeMid(poly: Footprint, i: number): [number, number] {
  const a = poly[i];
  const b = poly[(i + 1) % poly.length];
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

/** Step off the edge's midpoint along a direction and ask the room. The step is 20 mm,
 *  which is larger than any rounding in these coordinates and smaller than the
 *  thinnest feature any preset has (the U's arms are 1.32 m). */
function landsInside(poly: Footprint, i: number, nx: number, nz: number): boolean {
  const [mx, mz] = edgeMid(poly, i);
  return pointInFootprint(mx + nx * EPS, mz + nz * EPS, poly);
}

describe('the inward normal comes from the winding, on every wall of every room', () => {
  it('edgeProjection points into the room from every edge of every room, both windings', () => {
    let swept = 0;
    const wrong: string[] = [];
    for (const { label, poly } of allPolys()) {
      for (let i = 0; i < poly.length; i++) {
        const [mx, mz] = edgeMid(poly, i);
        const e = edgeProjection(poly as Poly, i, mx, mz);
        expect(e, `${label} edge ${i} must project`).not.toBeNull();
        swept++;
        if (!landsInside(poly, i, e!.nx, e!.nz)) wrong.push(`${label} edge ${i}`);
      }
    }
    // The count is asserted, not just the emptiness: `wrong` is empty for a sweep
    // that visited nothing, which is the failure mode this whole repo keeps finding.
    // 4 + 6 + 8 + 8 + 4 + 6 = 36, twice over for the two windings.
    expect(swept, 'the sweep must have visited every edge of every polygon').toBe(72);
    expect(wrong).toEqual([]);
  });

  it('nearestEdge agrees, and finds the wall a point just inside it belongs to', () => {
    // The function the nine callers actually use. Asked from a point 20 mm inside the
    // wall, it must return THAT wall and the same inward normal — a caller that gets a
    // different edge here snaps the piece to a wall it is nowhere near.
    let swept = 0;
    for (const { label, poly } of allPolys()) {
      const w = polygonWinding(poly as Poly);
      for (let i = 0; i < poly.length; i++) {
        const e = edgeProjection(poly as Poly, i, ...edgeMid(poly, i))!;
        const px = e.px + e.nx * EPS;
        const pz = e.pz + e.nz * EPS;
        // Only ask where the step genuinely lands in the room; a 20 mm step from the
        // midpoint of the U's 1.32 m-deep notch mouth does, but this keeps the
        // assertion about normals rather than about the fixture's proportions.
        if (!pointInFootprint(px, pz, poly)) continue;
        const near = nearestEdge(poly as Poly, px, pz, w);
        expect(near, `${label} edge ${i}`).not.toBeNull();
        expect(near!.index, `${label}: a point 20 mm inside edge ${i} belongs to it`).toBe(i);
        expect(near!.nx, `${label} edge ${i} nx`).toBeCloseTo(e.nx, 12);
        expect(near!.nz, `${label} edge ${i} nz`).toBeCloseTo(e.nz, 12);
        swept++;
      }
    }
    // Measured: the guard above never fires on this fixture set — all 72 steps land
    // inside — so this is `toBe`, not a `>` bar. It was `toBeGreaterThan(60)`, which
    // would have stayed green with eleven edges silently skipped, and a skipped edge
    // here is a wall whose normal nothing checked. If a future fixture genuinely
    // cannot take a 20 mm step somewhere, this goes red and says so rather than
    // quietly shrinking its own coverage. The literal is deliberate: deriving it from
    // `allPolys()` would make the assertion measure its own subject.
    expect(swept, 'every edge must be reachable from 20 mm inside it').toBe(72);
  });

  it('is the exact opposite of wallOutwardNormal, which was fixed the same way', () => {
    // Two functions, two files, one question. They disagreed on five walls and nothing
    // typechecked the agreement; this is that check.
    for (const { label, poly } of allPolys()) {
      for (let i = 0; i < poly.length; i++) {
        const e = edgeProjection(poly as Poly, i, ...edgeMid(poly, i))!;
        const [ox, oz] = wallOutwardNormal(poly, i);
        expect(e.nx, `${label} edge ${i}`).toBeCloseTo(-ox, 12);
        expect(e.nz, `${label} edge ${i}`).toBeCloseTo(-oz, 12);
      }
    }
  });

  it('wallSegments faces its +Z into the room, which is what RoomShell draws', () => {
    let swept = 0;
    const wrong: string[] = [];
    for (const { label, poly } of allPolys()) {
      const segs = wallSegments(poly);
      // Index correspondence holds only while no edge is degenerate, which is true of
      // every polygon here — asserted rather than assumed, because `wallSegments`
      // skips a zero-length edge and would silently shift every index after it.
      expect(segs.length, `${label}: no degenerate edges in this fixture`).toBe(poly.length);
      for (let i = 0; i < poly.length; i++) {
        // `yaw` is the heading of the inward normal, three.js convention: +Z rotated
        // by yaw is (sin yaw, cos yaw). Same convention as `frontVector`.
        if (!landsInside(poly, i, Math.sin(segs[i].yaw), Math.cos(segs[i].yaw))) wrong.push(`${label} edge ${i}`);
        swept++;
      }
    }
    expect(swept).toBe(72);
    expect(wrong).toEqual([]);
  });

  it('reads only the sign of the signed area, and gives one for a degenerate outline', () => {
    for (const { label, poly } of allPolys()) {
      const s = polygonSignedArea(poly as Poly);
      expect(Math.abs(s), `${label} must enclose area`).toBeGreaterThan(1);
      expect(polygonWinding(poly as Poly), label).toBe(s >= 0 ? 1 : -1);
    }
    // A polygon with no area has no inside to be wrong about, and the callers need a
    // sign rather than a throw: a footprint can go degenerate mid-drag.
    expect(polygonWinding([[0, 0], [1, 0], [2, 0]] as Poly)).toBe(1);
  });

  it('and the point-based test it replaced gets exactly 5 of the 30 preset walls wrong', () => {
    // The negative control, and the measurement.
    //
    // Without this, every assertion above would also pass for a polygon set with no
    // reflex corners and there would be no evidence the sweep can go red. With it, the
    // count is pinned: a change that reintroduces a centroid flip anywhere shows up
    // here as a number, and the five walls are named so the next reader can go and
    // look at them.
    //
    // One winding only — 30 edges, not 60 — because this is the count the two fixed
    // functions' docblocks quote, and quoting a different number in the test than in
    // the code is how those two come apart.
    const wrong: string[] = [];
    let swept = 0;
    for (const p of PRESETS) {
      const poly = footprintForLayout(p.id, p.w, p.d);
      const [cx, cz] = polygonCentroid(poly);
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i];
        const b = poly[(i + 1) % poly.length];
        const abx = b[0] - a[0];
        const abz = b[1] - a[1];
        const nl = Math.hypot(abx, abz);
        let nx = -abz / nl;
        let nz = abx / nl;
        const [mx, mz] = edgeMid(poly, i);
        // The old predicate, verbatim: flip the perpendicular toward the centroid.
        if ((cx - mx) * nx + (cz - mz) * nz < 0) {
          nx = -nx;
          nz = -nz;
        }
        swept++;
        if (!landsInside(poly, i, nx, nz)) wrong.push(`${p.id}#${i}`);
      }
    }
    expect(swept).toBe(30);
    expect(wrong).toEqual(['t#2', 't#6', 'u#1', 'u#2', 'u#3']);
    // …and the U's corner average is not merely on the wrong side of a wall, it is
    // outside the floor altogether, which is why no point could be substituted for it.
    const u = footprintForLayout('u', 6, 5);
    const [ux, uz] = polygonCentroid(u);
    expect(pointInFootprint(ux, uz, u), `${[ux, uz]} is in the U's notch`).toBe(false);
    // The L, by contrast, is entirely correct under the old test — which is why a file
    // that swept a rectangle and an L would have shipped green.
    expect(wrong.filter((k) => k.startsWith('l#'))).toEqual([]);
  });
});

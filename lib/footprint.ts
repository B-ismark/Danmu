// Room footprint as a polygon (XZ metres, room-centred). Lets the scene be
// non-rectangular (L / T / U / open) instead of a single width×depth box.
// +X = right (East), +Z = toward South — same axes as the scene.

import { polyAreaCentroid, polygonSignedArea, type Poly } from './geometry';

/** Re-exported rather than defined here. This file and `lib/geometry.ts` each had
 *  their own shoelace loop, and both were answering the same question — which way
 *  this outline winds, hence which side of a wall is indoors. `geometry.ts` cannot
 *  import this file (the dependency runs the other way), so the primitive lives
 *  there and the name stays here for the callers that already read it. */
export { polygonSignedArea };

export type LayoutId = 'rect' | 'l' | 't' | 'u' | 'open' | 'custom';
export type Footprint = [number, number][];

/** Build a centred polygon for a layout preset from overall width/depth. */
export function footprintForLayout(layout: LayoutId, w: number, d: number): Footprint {
  const hw = w / 2;
  const hd = d / 2;
  switch (layout) {
    case 'l': {
      // Remove the South-East quadrant.
      const lx = 0.42 * w;
      const lz = 0.42 * d;
      return [
        [-hw, -hd],
        [hw, -hd],
        [hw, hd - lz],
        [hw - lx, hd - lz],
        [hw - lx, hd],
        [-hw, hd],
      ];
    }
    case 't': {
      // North bar full width; stem runs South.
      const armD = 0.45 * d;
      const stem = 0.22 * w;
      return [
        [-hw, -hd],
        [hw, -hd],
        [hw, -hd + armD],
        [stem, -hd + armD],
        [stem, hd],
        [-stem, hd],
        [-stem, -hd + armD],
        [-hw, -hd + armD],
      ];
    }
    case 'u': {
      // Opening (notch) on the North edge.
      const notch = 0.22 * w;
      const depth = 0.5 * d;
      return [
        [-hw, -hd],
        [-notch, -hd],
        [-notch, -hd + depth],
        [notch, -hd + depth],
        [notch, -hd],
        [hw, -hd],
        [hw, hd],
        [-hw, hd],
      ];
    }
    case 'rect':
    case 'open':
    case 'custom':
    default:
      return [
        [-hw, -hd],
        [hw, -hd],
        [hw, hd],
        [-hw, hd],
      ];
  }
}

/** Axis-aligned bounds of a footprint polygon (XZ metres). The footprint is no
 *  longer guaranteed centred on the origin (walls can be dragged independently),
 *  so containment / coordinate-mapping must use these bounds rather than
 *  ±width/2. `cx`/`cz` is the bbox centre. */
export function footprintBounds(poly: Footprint): {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  width: number;
  depth: number;
  cx: number;
  cz: number;
} {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const [x, z] of poly) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  return { minX, maxX, minZ, maxZ, width: maxX - minX, depth: maxZ - minZ, cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2 };
}

/** Unit normal of edge `index`, pointing OUT of the room.
 *
 *  Exported because three things have to agree on it: `offsetWall` (which way the
 *  edge travels), the wall handles in the 3D and plan views (which way the
 *  pointer's travel is projected) and `lib/wall-move.ts` (which way the furniture
 *  standing on that wall travels with it). Sharing one function is the point —
 *  the same sign mistake that `lib/geometry.ts` warns about for part rotations
 *  applies here: a carried sofa with the normal flipped walks INTO the room as
 *  the wall moves out, and on the North/South walls of a rectangle that reads as
 *  "the wall moved and the sofa stayed", not as an inverted axis. */
export function wallOutwardNormal(poly: Footprint, index: number): [number, number] {
  const n = poly.length;
  if (n < 3 || index < 0 || index >= n) return [0, 0];
  const a = poly[index];
  const b = poly[(index + 1) % n];
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const l = Math.hypot(dx, dz) || 1;
  // Which side is "out" is a property of the polygon's WINDING, not of where its
  // middle happens to be. For positive signed area the outward normal of a→b is
  // (dz, −dx): take the unit square (0,0)→(1,0)→(1,1)→(0,1), area +1, and edge 0's
  // outward normal is (0, −1), which is what that expression gives.
  //
  // It used to flip the perpendicular by testing it against `polygonCentroid` —
  // and that is exact for a convex room and wrong for the ones this app ships. The
  // centroid there averages the VERTICES rather than the area, so on a T it lands
  // in the stem's notch and on a U between the arms, outside the floor entirely;
  // any edge whose midpoint sits on the far side of it from the interior gets its
  // normal reversed. Measured, not feared: 2 of the T's 8 walls and 3 of the U's 8.
  //
  // What that cost is a wall that moves the wrong way. `offsetWall` translates the
  // edge along this vector, so `delta > 0` — documented as "push out / bigger room"
  // — shrank the room on those five walls, and `lib/wall-move.ts` carried the
  // furniture inward with it. On a rectangle it is invisible, which is exactly
  // where every test for it was written.
  //
  // `polygonCentroid` is untouched: six other callers read it, one test pins its
  // value, and it is not this function's business any more. That also retires the
  // blocker `lib/scene-spec.ts` records against fixing it — "changing it means
  // changing the thing every wall's normal is derived from" is no longer true.
  //
  // `+ 0` normalises negative zero. An axis-aligned wall divides an exact 0 by the
  // length and the sign of `s` carries through, so East came back as `[1, -0]` —
  // arithmetically identical to `[1, 0]` and not identical to it under `Object.is`
  // or `toEqual`. Two rooms whose East walls face the same way should not differ by
  // the sign of a zero.
  const s = polygonSignedArea(poly) >= 0 ? 1 : -1;
  return [(s * dz) / l + 0, (-s * dx) / l + 0];
}

/** Move ONLY the selected wall: translate edge `index`'s two vertices along the
 *  edge's outward normal by `delta` metres (delta > 0 = push out / bigger room).
 *  Adjacent walls stretch to stay connected; the opposite wall does not move, so
 *  the room becomes off-centre — that's intentional.
 *
 *  Geometry only. Whatever is standing on the wall is carried by
 *  `lib/wall-move.ts`, through the one action in `lib/wall-actions.ts`. */
export function offsetWall(poly: Footprint, index: number, delta: number): Footprint {
  const n = poly.length;
  if (n < 3 || index < 0 || index >= n) return poly;
  const a = poly[index];
  const b = poly[(index + 1) % n];
  const [nx, nz] = wallOutwardNormal(poly, index);
  const next: Footprint = poly.map((p) => [p[0], p[1]]);
  next[index] = [a[0] + nx * delta, a[1] + nz * delta];
  next[(index + 1) % n] = [b[0] + nx * delta, b[1] + nz * delta];
  return next;
}

export function polygonCentroid(poly: Footprint): [number, number] {
  let x = 0;
  let z = 0;
  for (const p of poly) {
    x += p[0];
    z += p[1];
  }
  return [x / poly.length, z / poly.length];
}

/** Ray-cast point-in-polygon (XZ). */
export function pointInFootprint(x: number, z: number, poly: Footprint): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0];
    const zi = poly[i][1];
    const xj = poly[j][0];
    const zj = poly[j][1];
    const intersect = zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** A point that is genuinely inside the room, to aim at.
 *
 *  `polygonCentroid` averages the CORNERS, and on a U at 7.5 x 5.6 that lands
 *  **outside the room** — 0.70 m into the gap between the legs. Everything that used
 *  it as a destination was therefore walking toward a point in the void, which is how
 *  `clampIntoFootprint` came to return a position outside the footprint from a
 *  function whose name is a promise that it did not.
 *
 *  Three answers, cheapest first, and only a polygon that defeats one ever pays for
 *  the next.
 *
 *  1. `polyAreaCentroid` (the shoelace centroid, `lib/geometry.ts`) is inside on all
 *     five presets and is the right first guess. It is not a guarantee — no centroid
 *     is inside an arbitrary non-convex polygon, and a room the user has dragged into
 *     a horseshoe puts it back in the void — so it is CHECKED.
 *  2. A grid over the bounding box at `PROBE_STEP`, keeping the interior sample
 *     nearest the centroid.
 *  3. `edgeProbe`, below: step in from each edge's midpoint along its inward normal.
 *
 *  ── What the grid costs, stated rather than waved at ────────────────────────
 *
 *  It is O(area / PROBE_STEP²), which is quadratic in the room's side, and the
 *  sentence that used to sit here — "a few thousand point-in-polygon tests on a
 *  room-sized box" — was true of a 6 x 4 room and wrong by two orders of magnitude at
 *  the top of the legal range. Measured (danmu-62): 2,400 cells / 0.47 ms at 6 x 4,
 *  30,000 / 1.70 ms at 20 x 15, and **250,000 cells / 15.1 ms at 50 x 50**, which
 *  `ROOM_SIDE_M` permits. Two of the four `clampIntoFootprint` call sites are inside
 *  the annealer's proposal generator (`jiggle` and `pickPartner` in
 *  `lib/layout-solve.ts`), so an uncached scan is paid PER PROPOSAL against
 *  `DEFAULT_STEPS` of 1600 — seconds of pure scan on one solve. Hence the memo below.
 *  `tests/layout-solve.test.ts`'s 2000 ms ceiling cannot see any of it, because every
 *  preset has its area centroid inside and never reaches step 2 at all: the fixture
 *  cannot express the defect, which is the same shape as the bug this function fixes.
 *
 *  ── When it gives up ───────────────────────────────────────────────────────
 *
 *  Step 3 exists because step 2's resolution is a real hole and the app can reach it.
 *  `moveWall` accepts any wall drag whose BOUNDING BOX stays inside `ROOM_SIDE_M`;
 *  nothing anywhere floors the width of a leg. So a U whose legs the user has narrowed
 *  to 50 mm is a room this app calls legal and whose entire interior can fall between
 *  a 0.1 m grid's samples — and `clampIntoFootprint` would then silently do nothing on
 *  all four of its call sites. `edgeProbe` is O(vertices) and independent of the room's
 *  size, so it closes that without paying for it on the rooms that do not need it.
 *
 *  `null` now means a polygon with no interior at all — degenerate or self-crossing —
 *  rather than "no interior at this resolution". Callers must still handle it rather
 *  than treating a returned point as proof of anything, which was the original bug
 *  wearing new clothes. */
const PROBE_STEP = 0.1;

/** Answers keyed on the polygon's IDENTITY, which is what makes the memo safe.
 *
 *  A footprint is a value here: `footprintForLayout` and `offsetWall` both return a
 *  new array and nothing in `lib/`, `components/` or `app/` assigns into one or
 *  pushes onto one (grepped). So a given array's answer cannot go stale — and if that
 *  ever stops being true, the fix is to stop mutating footprints, not to drop the
 *  memo, because half this file already assumes it.
 *
 *  `LayoutModel` stores `ctx.footprint` once and reads it by reference for the whole
 *  solve, so this collapses the per-proposal scan above to one scan per solve. A
 *  `WeakMap` rather than a field on the model, because three of the four call sites
 *  are not the solver and would otherwise each need their own cache — the same
 *  argument `nearestEdge`'s optional centroid parameter loses.
 *
 *  The answer is frozen and handed out by reference, so the identity IS the test:
 *  `tests/footprint.test.ts` asserts two calls return the same object, which goes red
 *  the moment the memo is removed. Freezing is what makes sharing it safe. */
const INTERIOR_MEMO = new WeakMap<Footprint, readonly [number, number] | null>();

export function interiorPoint(poly: Footprint): readonly [number, number] | null {
  // `has`, not `get(...) !== undefined`, and the difference is not style. The two
  // behave identically except when the cached answer is `null` — and there the
  // truthy-ish version falls through, recomputes, and returns `null` again, so it
  // gives the SAME ANSWER while doing all the work over. No test can see that: the
  // return value is identical, and there is no counter to read. A guard whose mutant
  // no assertion can catch is the shape this file already warns about twice, so the
  // intent goes in the method name where it cannot be mutated into the wrong thing.
  //
  // The uncovered case is also the expensive one. `null` is the single input where
  // BOTH fallbacks run to exhaustion — the whole grid, then all three edge-probe
  // insets — so a memo that quietly stops covering it stops covering the 15.1 ms call
  // in the annealer this memo exists for. Found by danmu-62, by mutating a guard I had
  // just added rather than trusting it.
  if (INTERIOR_MEMO.has(poly)) return INTERIOR_MEMO.get(poly) ?? null;
  const found = findInteriorPoint(poly);
  // ONE freeze site, deliberately. It sat on each of the three answers below until a
  // mutation showed two of them were unreachable from any fixture — a frozen value
  // nothing can observe is the same dead decoration as an assertion never seen red.
  const answer = found && Object.freeze(found);
  INTERIOR_MEMO.set(poly, answer);
  return answer;
}

function findInteriorPoint(poly: Footprint): [number, number] | null {
  if (poly.length < 3) return null;
  const [ax, az] = polyAreaCentroid(poly as Poly);
  if (pointInFootprint(ax, az, poly)) return [ax, az];
  const b = footprintBounds(poly);
  let best: [number, number] | null = null;
  let bestD = Infinity;
  for (let x = b.minX + PROBE_STEP / 2; x < b.maxX; x += PROBE_STEP) {
    for (let z = b.minZ + PROBE_STEP / 2; z < b.maxZ; z += PROBE_STEP) {
      if (!pointInFootprint(x, z, poly)) continue;
      const d = (x - ax) * (x - ax) + (z - az) * (z - az);
      if (d < bestD) {
        bestD = d;
        best = [x, z];
      }
    }
  }
  if (best) return best;
  return edgeProbe(poly);
}

/** How far in from a wall to look, once the grid has found nothing. Three tries
 *  rather than one: the first that lands inside wins, and a leg thinner than the last
 *  of them is thinner than this app's own millimetre resolution. */
const EDGE_INSETS = [0.01, 0.001, 0.0001];

/** Step in from each edge's midpoint along its inward normal.
 *
 *  O(vertices) and independent of the room's size, which is the point: the grid above
 *  cannot see a leg narrower than its own step no matter how large the room, and this
 *  cannot miss one no matter how narrow, because it looks where the floor provably is
 *  — immediately inside a wall — rather than where a lattice happens to sample.
 *
 *  Inward is `-wallOutwardNormal`, so it reads the polygon's WINDING and not any
 *  interior point, which is what keeps it honest on a T or a U. On a degenerate
 *  polygon — collinear vertices, zero signed area — every probe lands off the line and
 *  outside, and `null` comes back, which is the answer that case deserves. */
function edgeProbe(poly: Footprint): [number, number] | null {
  const n = poly.length;
  for (const inset of EDGE_INSETS) {
    for (let i = 0; i < n; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % n];
      const [ox, oz] = wallOutwardNormal(poly, i);
      const px = (a[0] + b[0]) / 2 - ox * inset;
      const pz = (a[1] + b[1]) / 2 - oz * inset;
      if (pointInFootprint(px, pz, poly)) return [px, pz];
    }
  }
  return null;
}

/** Distance from a point to the nearest edge of the polygon, in metres — zero when the
 *  point lies on the boundary, whichever side of it the point is on.
 *
 *  It exists because "is this point in the room" and "is this point ON a wall" are
 *  different questions and `pointInFootprint` only answers the first. That one is a ray
 *  test, so a point exactly on an edge comes back OUTSIDE — and clamping a coordinate to
 *  the room's bounding box lands it exactly there on every overshoot. For a RECTANGLE,
 *  where the footprint and its bounding box are the same shape, that is most overshoots
 *  in the room. So a caller that reads `!pointInFootprint` as "outside the room" is
 *  wrong about the commonest room there is, and measurably so: see `ON_WALL_M`.
 *
 *  Clamped to each segment rather than to its infinite line, so a point beyond an edge's
 *  end measures to the vertex. Without that a point off the end of a short wall reads as
 *  being on it, which is the same defect `nearestEdge` in `lib/geometry.ts` carries a
 *  comment about. */
export function distanceToFootprintEdge(x: number, z: number, poly: Footprint): number {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const ex = b[0] - a[0];
    const ez = b[1] - a[1];
    const len2 = ex * ex + ez * ez;
    let t = len2 < 1e-12 ? 0 : ((x - a[0]) * ex + (z - a[1]) * ez) / len2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const dx = x - (a[0] + ex * t);
    const dz = z - (a[1] + ez * t);
    const d2 = dx * dx + dz * dz;
    if (d2 < best) best = d2;
  }
  return Math.sqrt(best);
}

/** How far off a wall still counts as being on it, in metres.
 *
 *  Below any resolution this app works at — dimensions are whole millimetres and the
 *  navigation grid is 50 mm — so it is not a tolerance on anything a user can see. What
 *  it separates is "pinned to a wall by a bounding-box clamp" from "sitting in an L, T or
 *  U's notch", which `pointInFootprint` reports identically.
 *
 *  Load-bearing, and mutation-checked rather than assumed: taking it to 0 — declining on
 *  `pointInFootprint` alone — turns `tests/suggest-tidiness.test.ts` red, because the
 *  annealer's nudge in `lib/layout-solve.ts` then refuses every proposal a rectangle's
 *  own wall clamp produced. */
export const ON_WALL_M = 0.005;

/** Pull (x,z) inside the footprint by stepping toward an interior point. Returns the
 *  point unchanged if already inside. Used to keep detected items out of the
 *  void of an L/U/T room.
 *
 *  ── What this does NOT do ──────────────────────────────────────────────────
 *
 *  It clamps a CENTRE, and says nothing about the extent of whatever is centred
 *  there: a point 5 cm inside the leg of a U satisfies it with a 2 m sofa mostly
 *  through the wall. Containment of the piece is `contain` in `lib/layout-settle.ts`,
 *  which pushes the footprint out of the wall by the deficit along the inward normal,
 *  and every placement path ends there for exactly this reason. Do not reach for this
 *  one to keep furniture in the room.
 *
 *  What it now does honestly is return a point inside the polygon or leave the input
 *  alone. It used to walk toward `polygonCentroid` and, when every step of that walk
 *  was also outside, `return [cx, cz]` — the corner average, which on a U is in the
 *  void. Callers read the result as "inside now" with no way to tell. */


export function clampIntoFootprint(x: number, z: number, poly: Footprint): [number, number] {
  if (pointInFootprint(x, z, poly)) return [x, z];
  const target = interiorPoint(poly);
  if (!target) return [x, z];
  const [cx, cz] = target;
  for (let t = 0.15; t < 1; t += 0.15) {
    const nx = x + (cx - x) * t;
    const nz = z + (cz - z) * t;
    if (pointInFootprint(nx, nz, poly)) return [nx, nz];
  }
  return [cx, cz];
}

/** Per-edge wall placement: midpoint, length, and Y-rotation so a plane's +Z
 *  face points INWARD (toward the centroid). Drives RoomShell's wall meshes. */
export function wallSegments(
  poly: Footprint,
): Array<{ x: number; z: number; len: number; yaw: number }> {
  const out: Array<{ x: number; z: number; len: number; yaw: number }> = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const mx = (a[0] + b[0]) / 2;
    const mz = (a[1] + b[1]) / 2;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1e-4) continue;
    // Inward is the negated OUTWARD normal, which reads the polygon's winding —
    // not its own perpendicular flipped toward `polygonCentroid`, which is what
    // this did and what `wallOutwardNormal` two hundred lines up was fixed for.
    // Same defect, same file, and this is the copy the user can see: these are the
    // wall meshes `RoomShell` builds, so the two of the T's eight walls and three
    // of the U's that came back reversed were drawn facing out of the room. Their
    // `+Z` side is the lit, textured one and their back is the culled one, so on
    // those five the room was lit from the wrong side of the plaster.
    const [ox, oz] = wallOutwardNormal(poly, i);
    // `+ 0` after the negation for the same reason `wallOutwardNormal` needs it on
    // the way out: an axis-aligned wall has an exact 0 in one component, and −0
    // there sends `atan2` to −π where +0 sends it to +π. Same direction, two
    // numbers, and two rooms whose east walls face the same way should not differ
    // by the sign of a zero.
    const nx = -ox + 0;
    const nz = -oz + 0;
    out.push({ x: mx, z: mz, len, yaw: Math.atan2(nx, nz) });
  }
  return out;
}

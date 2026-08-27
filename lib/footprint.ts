// Room footprint as a polygon (XZ metres, room-centred). Lets the scene be
// non-rectangular (L / T / U / open) instead of a single width×depth box.
// +X = right (East), +Z = toward South — same axes as the scene.

import { polyAreaCentroid, type Poly } from './geometry';

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

/** Twice-the-area-over-two of a simple polygon, signed by its winding. Positive
 *  means the vertices run in the direction `wallOutwardNormal` treats as
 *  counter-clockwise; only the SIGN is read, so the magnitude is incidental. */
export function polygonSignedArea(poly: Footprint): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
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
 *  `polyAreaCentroid` (the shoelace centroid, `lib/geometry.ts`) is inside on all five
 *  presets and is the right first guess. It is not a guarantee: no centroid is inside
 *  an arbitrary non-convex polygon, and a room the user has dragged into a horseshoe
 *  can put it back in the void. So it is CHECKED, and the fallback is a scan — the
 *  bounding box at `PROBE_STEP`, keeping the interior sample nearest the centroid.
 *  Bounded (a few thousand point-in-polygon tests on a room-sized box), deterministic,
 *  and only ever paid on a polygon the cheap answer failed.
 *
 *  Returns `null` only for a polygon with no interior at that resolution — degenerate,
 *  or a slot narrower than `PROBE_STEP`. Callers must handle it rather than treating a
 *  returned point as proof of anything, which was the original bug wearing new clothes. */
const PROBE_STEP = 0.1;

export function interiorPoint(poly: Footprint): [number, number] | null {
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
  return best;
}

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
  const [cx, cz] = polygonCentroid(poly);
  const out: Array<{ x: number; z: number; len: number; yaw: number }> = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const mx = (a[0] + b[0]) / 2;
    const mz = (a[1] + b[1]) / 2;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1e-4) continue;
    // Edge direction; perpendicular candidate.
    let nx = -(b[1] - a[1]);
    let nz = b[0] - a[0];
    const nl = Math.hypot(nx, nz) || 1;
    nx /= nl;
    nz /= nl;
    // Flip to point toward the centroid (inward).
    if ((cx - mx) * nx + (cz - mz) * nz < 0) {
      nx = -nx;
      nz = -nz;
    }
    out.push({ x: mx, z: mz, len, yaw: Math.atan2(nx, nz) });
  }
  return out;
}

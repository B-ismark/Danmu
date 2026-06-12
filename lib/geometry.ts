// Deterministic 2D geometry for placement — oriented rectangles (furniture
// footprints, XZ metres) against each other and against the room's footprint
// polygon. No AI, no approximation hacks: exact separating-axis tests and
// point/segment math. Everything works in the scene's XZ plane.

export type Vec2 = [number, number];

/** Oriented rectangle: centre, half-extents, rotation (radians, scene yaw). */
export type OBB = { cx: number; cz: number; hw: number; hd: number; rot: number };

/** Build an OBB from a part's scene transform + dims ([W, D, H] mm). */
export function obbFromPart(
  pos: [number, number, number],
  rot: number,
  dimMM: [number, number, number],
): OBB {
  return { cx: pos[0], cz: pos[2], hw: dimMM[0] / 2000, hd: dimMM[1] / 2000, rot };
}

/** The 4 world-space corners of an OBB, counter-clockwise. */
export function obbCorners(b: OBB): Vec2[] {
  const c = Math.cos(b.rot);
  const s = Math.sin(b.rot);
  const out: Vec2[] = [];
  for (const [lx, lz] of [
    [-b.hw, -b.hd],
    [b.hw, -b.hd],
    [b.hw, b.hd],
    [-b.hw, b.hd],
  ] as Vec2[]) {
    out.push([b.cx + lx * c - lz * s, b.cz + lx * s + lz * c]);
  }
  return out;
}

/** Exact rotated-rectangle overlap via the separating-axis theorem.
 *  `pad` (metres) inflates both boxes — pass a small negative value to allow
 *  flush contact without flagging it as a collision. */
export function obbOverlap(a: OBB, b: OBB, pad = 0): boolean {
  const ca = obbCorners(inflate(a, pad / 2));
  const cb = obbCorners(inflate(b, pad / 2));
  return !hasSeparatingAxis(ca, cb) && !hasSeparatingAxis(cb, ca);
}

function inflate(b: OBB, by: number): OBB {
  return { ...b, hw: Math.max(0.001, b.hw + by), hd: Math.max(0.001, b.hd + by) };
}

/** True if any edge normal of `a` separates the two corner sets. */
function hasSeparatingAxis(a: Vec2[], b: Vec2[]): boolean {
  for (let i = 0; i < 4; i++) {
    const ax = a[(i + 1) % 4][0] - a[i][0];
    const az = a[(i + 1) % 4][1] - a[i][1];
    // Edge normal.
    const nx = -az;
    const nz = ax;
    let minA = Infinity, maxA = -Infinity, minB = Infinity, maxB = -Infinity;
    for (const [x, z] of a) {
      const p = x * nx + z * nz;
      if (p < minA) minA = p;
      if (p > maxA) maxA = p;
    }
    for (const [x, z] of b) {
      const p = x * nx + z * nz;
      if (p < minB) minB = p;
      if (p > maxB) maxB = p;
    }
    if (maxA < minB || maxB < minA) return true;
  }
  return false;
}

/** Smallest distance between two OBBs' boundaries (0 when overlapping).
 *  Exact for convex quads: min over point-to-segment distances both ways. */
export function obbGap(a: OBB, b: OBB): number {
  if (obbOverlap(a, b)) return 0;
  const ca = obbCorners(a);
  const cb = obbCorners(b);
  let best = Infinity;
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      best = Math.min(
        best,
        distPointToSegment(ca[i], cb[j], cb[(j + 1) % 4]),
        distPointToSegment(cb[i], ca[j], ca[(j + 1) % 4]),
      );
    }
  }
  return best;
}

export function distPointToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const abx = b[0] - a[0];
  const abz = b[1] - a[1];
  const len2 = abx * abx + abz * abz;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * abx + (p[1] - a[1]) * abz) / len2));
  return Math.hypot(p[0] - (a[0] + abx * t), p[1] - (a[1] + abz * t));
}

// ─── Footprint-polygon queries ────────────────────────────────────────────

export type Poly = [number, number][];

/** Nearest polygon edge to a point: edge index, closest point on the edge,
 *  distance, the inward unit normal and the yaw that makes a part's front
 *  (+Z local) face into the room when placed against that edge. */
export function nearestEdge(
  poly: Poly,
  x: number,
  z: number,
): { index: number; px: number; pz: number; dist: number; nx: number; nz: number; yaw: number } | null {
  if (poly.length < 3) return null;
  const [cx, cz] = polyCentroid(poly);
  let best: { index: number; px: number; pz: number; dist: number; nx: number; nz: number; yaw: number } | null = null;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const abx = b[0] - a[0];
    const abz = b[1] - a[1];
    const len2 = abx * abx + abz * abz;
    if (len2 < 1e-8) continue;
    const t = Math.max(0, Math.min(1, ((x - a[0]) * abx + (z - a[1]) * abz) / len2));
    const px = a[0] + abx * t;
    const pz = a[1] + abz * t;
    const dist = Math.hypot(x - px, z - pz);
    if (best && dist >= best.dist) continue;
    // Inward normal: perpendicular flipped toward the centroid.
    let nx = -abz;
    let nz = abx;
    const nl = Math.hypot(nx, nz) || 1;
    nx /= nl;
    nz /= nl;
    if ((cx - px) * nx + (cz - pz) * nz < 0) {
      nx = -nx;
      nz = -nz;
    }
    best = { index: i, px, pz, dist, nx, nz, yaw: Math.atan2(nx, nz) };
  }
  return best;
}

export function polyCentroid(poly: Poly): Vec2 {
  let x = 0, z = 0;
  for (const p of poly) {
    x += p[0];
    z += p[1];
  }
  return [x / poly.length, z / poly.length];
}

/** Distance from (x,z) along unit direction (dx,dz) to the polygon boundary.
 *  Infinity when the ray never crosses an edge (point outside, aiming away). */
export function rayToBoundary(x: number, z: number, dx: number, dz: number, poly: Poly): number {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const ex = b[0] - a[0];
    const ez = b[1] - a[1];
    const denom = dx * ez - dz * ex;
    if (Math.abs(denom) < 1e-9) continue; // parallel
    const t = ((a[0] - x) * ez - (a[1] - z) * ex) / denom; // along ray
    const u = ((a[0] - x) * dz - (a[1] - z) * dx) / denom; // along edge
    if (t > 1e-6 && u >= -1e-6 && u <= 1 + 1e-6 && t < best) best = t;
  }
  return best;
}

/** Half-extent of an OBB projected onto a world direction (dx,dz must be unit). */
export function obbExtentAlong(b: OBB, dx: number, dz: number): number {
  const c = Math.cos(b.rot);
  const s = Math.sin(b.rot);
  // Local axes in world space.
  const ux = c, uz = s; // local X
  const vx = -s, vz = c; // local Z
  return Math.abs((ux * dx + uz * dz) * b.hw) + Math.abs((vx * dx + vz * dz) * b.hd);
}

/** True when the whole OBB sits inside the polygon (all 4 corners in, which is
 *  exact for convex polygons and the right call for our rectilinear rooms). */
export function obbInsidePoly(b: OBB, poly: Poly): boolean {
  return obbCorners(b).every(([x, z]) => pointInPoly(x, z, poly));
}

export function pointInPoly(x: number, z: number, poly: Poly): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], zi = poly[i][1];
    const xj = poly[j][0], zj = poly[j][1];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Clearance from one face of an OBB to the nearest obstacle or wall, measured
 *  along the face's outward normal. `face` is in LOCAL space: '+z' is the
 *  part's front. Used for "can this wardrobe door open" checks. */
export function faceClearance(
  self: OBB,
  face: '+x' | '-x' | '+z' | '-z',
  obstacles: OBB[],
  room: Poly,
  maxRange = 4,
): number {
  const c = Math.cos(self.rot);
  const s = Math.sin(self.rot);
  let dx: number, dz: number, half: number;
  switch (face) {
    case '+x': dx = c; dz = s; half = self.hw; break;
    case '-x': dx = -c; dz = -s; half = self.hw; break;
    case '+z': dx = -s; dz = c; half = self.hd; break;
    case '-z': dx = s; dz = -c; half = self.hd; break;
  }
  // Start just outside the face centre.
  const sx = self.cx + dx * (half + 0.001);
  const sz = self.cz + dz * (half + 0.001);
  let best = Math.min(maxRange, rayToBoundary(sx, sz, dx, dz, room));
  // March a thin probe box outward and find the first obstacle hit (sampled —
  // resolution 2cm is far below any clearance threshold we report on).
  for (const o of obstacles) {
    if (o === self) continue;
    // Cheap reject: too far to matter.
    const centreDist = Math.hypot(o.cx - sx, o.cz - sz);
    if (centreDist - Math.hypot(o.hw, o.hd) > best) continue;
    for (let t = 0.02; t < best; t += 0.02) {
      if (pointInObb(sx + dx * t, sz + dz * t, o)) {
        best = t;
        break;
      }
    }
  }
  return best;
}

export function pointInObb(x: number, z: number, b: OBB): boolean {
  const c = Math.cos(-b.rot);
  const s = Math.sin(-b.rot);
  const dx = x - b.cx;
  const dz = z - b.cz;
  const lx = dx * c - dz * s;
  const lz = dx * s + dz * c;
  return Math.abs(lx) <= b.hw && Math.abs(lz) <= b.hd;
}

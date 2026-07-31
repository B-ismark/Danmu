// Deterministic 2D geometry for placement — oriented rectangles (furniture
// footprints, XZ metres) against each other and against the room's footprint
// polygon. No AI, no approximation hacks: exact separating-axis tests and
// point/segment math. Everything works in the scene's XZ plane.

export type Vec2 = [number, number];

/** Oriented rectangle: centre, half-extents, rotation (radians, scene yaw). */
export type OBB = { cx: number; cz: number; hw: number; hd: number; rot: number };

// ─── One rotation convention, and it is three.js's ──────────────────────────
//
// `rot` is the value the renderer assigns to `group.rotation.y` (Draggable does
// exactly that), so the only correct reading of it is three.js's: makeRotationY
// maps local (x, z) to world (x·cos + z·sin, −x·sin + z·cos), which puts a part's
// FRONT — its local +Z — along `(sin rot, cos rot)`.
//
// Every function here used to rotate the other way, `(x·cos − z·sin, x·sin +
// z·cos)`, i.e. by −rot. That is invisible for a rectangle at 0° or 180°, because
// ±Z is its own mirror, and it makes no difference to the *area* a quarter-turned
// piece covers. It inverts every DIRECTIONAL answer on the side walls, and it was
// costing real findings: `wallSegments` / `nearestEdge` hand back yaw =
// atan2(nx, nz) so that a part placed there faces into the room, and
// `faceClearance(wardrobe, '+z')` then marched the opposite way — straight into
// the plaster. A wardrobe correctly snapped to the east or west wall measured
// 1.9 cm in front of its doors and the room report said "Doors can't open".
//
// So: one pair of helpers, used everywhere the maths is not in a per-cell loop,
// and `tests/geometry.test.ts` pins them against three.js's own matrix.

/** Part-local offset → world XZ offset. Matches `three.Matrix4.makeRotationY`. */
export function localToWorld(rot: number, lx: number, lz: number): Vec2 {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  return [lx * c + lz * s, -lx * s + lz * c];
}

/** World XZ offset → part-local. The exact inverse of `localToWorld`. */
export function worldToLocal(rot: number, dx: number, dz: number): Vec2 {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  return [dx * c - dz * s, dx * s + dz * c];
}

/** Unit vector a part's front (local +Z) points along in world XZ. */
export function frontVector(rot: number): Vec2 {
  return [Math.sin(rot), Math.cos(rot)];
}

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
    out.push([b.cx + lx * c + lz * s, b.cz - lx * s + lz * c]);
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

/** Area of the two OBBs' intersection, in m².
 *
 *  `obbOverlap` answers "do these touch at all", which is not enough to tell a
 *  3 cm clip from one piece standing inside another — and both of those need
 *  different words from the app. This gives the amount, so a caller can require
 *  a share of a footprint before it calls anything a collision.
 *
 *  Sutherland–Hodgman: clip a's rectangle against each of b's four edge
 *  half-planes, then take the shoelace area of what survives. Exact for two
 *  convex quads, and no sampling resolution to get wrong. */
export function obbIntersectionArea(a: OBB, b: OBB): number {
  // Disjoint bounding circles cannot share area, and finding that out costs two
  // square roots against eight corner allocations and a four-plane clip. The
  // layout solver asks this question for every pair in the room tens of thousands
  // of times, and most of those pairs are nowhere near each other.
  if (gapLowerBound(a, b) > 0) return 0;
  return polyIntersectionArea(obbCorners(a), obbCorners(b));
}

/** A lower bound on the gap between two footprints, from their bounding circles.
 *  Never greater than the true gap — so `> 0` proves they do not touch, and a
 *  caller that only cares about things within a threshold can reject the rest for
 *  a few flops instead of an exact test. */
export function gapLowerBound(a: OBB, b: OBB): number {
  return (
    Math.hypot(b.cx - a.cx, b.cz - a.cz) - Math.hypot(a.hw, a.hd) - Math.hypot(b.hw, b.hd)
  );
}

/** Area shared by two CONVEX polygons, both counter-clockwise. The general form
 *  of the above — a round footprint is a many-sided convex polygon, and the clip
 *  does not care how many sides it has. */
export function polyIntersectionArea(subject: Vec2[], clip: Vec2[]): number {
  let poly = subject;
  for (let i = 0; i < clip.length && poly.length > 0; i++) {
    const [ex, ez] = clip[i];
    const [fx, fz] = clip[(i + 1) % clip.length];
    // Corners are counter-clockwise, so "inside" is to the left of each edge.
    const side = (p: Vec2) => (fx - ex) * (p[1] - ez) - (fz - ez) * (p[0] - ex);
    const next: Vec2[] = [];
    for (let j = 0; j < poly.length; j++) {
      const cur = poly[j];
      const prev = poly[(j + poly.length - 1) % poly.length];
      const dCur = side(cur);
      const dPrev = side(prev);
      if (dCur >= 0) {
        // Entering: add the crossing point before the vertex itself.
        if (dPrev < 0) next.push(lerpAt(prev, cur, dPrev, dCur));
        next.push(cur);
      } else if (dPrev >= 0) {
        next.push(lerpAt(prev, cur, dPrev, dCur));
      }
    }
    poly = next;
  }
  if (poly.length < 3) return 0;
  let twice = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, z1] = poly[i];
    const [x2, z2] = poly[(i + 1) % poly.length];
    twice += x1 * z2 - x2 * z1;
  }
  return Math.abs(twice) / 2;
}

/** Where the segment prev→cur crosses the clip edge, from the two signed
 *  distances. */
function lerpAt(prev: Vec2, cur: Vec2, dPrev: number, dCur: number): Vec2 {
  const t = dPrev / (dPrev - dCur);
  return [prev[0] + (cur[0] - prev[0]) * t, prev[1] + (cur[1] - prev[1]) * t];
}

/** True if any edge normal of `a` separates the two corner sets. Convex only —
 *  which every footprint in this file is. */
function hasSeparatingAxis(a: Vec2[], b: Vec2[]): boolean {
  const n = a.length;
  for (let i = 0; i < n; i++) {
    const ax = a[(i + 1) % n][0] - a[i][0];
    const az = a[(i + 1) % n][1] - a[i][1];
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
  const ca = obbCorners(a);
  const cb = obbCorners(b);
  // Bounding circles apart means the rectangles cannot be, which skips the
  // separating-axis test and the two corner sets it used to build for itself.
  // `hasSeparatingAxis` is only asked when the two are genuinely close.
  if (gapLowerBound(a, b) <= 0 && !hasSeparatingAxis(ca, cb) && !hasSeparatingAxis(cb, ca)) return 0;
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
  /** The polygon's centroid, if the caller already has it. Only used to decide
   *  which way is inward, and recomputing it per call is a measurable cost in the
   *  layout solver, which asks this for every piece on every proposal. */
  centroid?: Vec2,
): { index: number; px: number; pz: number; dist: number; nx: number; nz: number; yaw: number } | null {
  if (poly.length < 3) return null;
  const [cx, cz] = centroid ?? polyCentroid(poly);
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

/** Area enclosed by a polygon, m². Shoelace, so it does not care which way the
 *  outline winds. */
export function polygonArea(poly: Poly): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, z1] = poly[i];
    const [x2, z2] = poly[(i + 1) % poly.length];
    a += x1 * z2 - x2 * z1;
  }
  return Math.abs(a) / 2;
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
  // Local axes in world space — `localToWorld` of (1,0) and (0,1).
  const ux = c, uz = -s; // local X
  const vx = s, vz = c; // local Z
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

/** Distance from (x,z) along unit direction (dx,dz) to the first entry into `b`,
 *  or Infinity if the ray never enters it. Analytic slab test in the OBB's own
 *  frame — exact, and constant-time. */
export function rayToObb(x: number, z: number, dx: number, dz: number, b: OBB): number {
  // World → OBB local, i.e. `worldToLocal`, inlined for both the origin and the
  // direction rather than allocating two pairs per ray.
  const c = Math.cos(b.rot);
  const s = Math.sin(b.rot);
  const px = x - b.cx;
  const pz = z - b.cz;
  const ox = px * c - pz * s;
  const oz = px * s + pz * c;
  const rx = dx * c - dz * s;
  const rz = dx * s + dz * c;

  let tMin = -Infinity;
  let tMax = Infinity;
  // X slab, then Z slab.
  for (const [o, r, half] of [
    [ox, rx, b.hw],
    [oz, rz, b.hd],
  ] as const) {
    if (Math.abs(r) < 1e-9) {
      // Parallel to this slab: a miss unless the origin is already inside it.
      if (Math.abs(o) > half) return Infinity;
      continue;
    }
    const t1 = (-half - o) / r;
    const t2 = (half - o) / r;
    tMin = Math.max(tMin, Math.min(t1, t2));
    tMax = Math.min(tMax, Math.max(t1, t2));
    if (tMin > tMax) return Infinity;
  }
  if (tMax < 0) return Infinity;
  return Math.max(0, tMin);
}

/** How many probes are cast across the width of a face. Must be odd and ≥ 3, so
 *  one lands on the centre and the outermost pair sit just inside the corners. */
const FACE_PROBES = 5;
const PROBE_SPAN = FACE_PROBES - 1;

/** Clearance from one face of an OBB to the nearest obstacle or wall, measured
 *  along the face's outward normal. `face` is in LOCAL space: '+z' is the
 *  part's front. Used for "can this wardrobe door open" checks.
 *
 *  Probes ACROSS THE WHOLE FACE, not just its centre. A single centre ray missed
 *  anything sitting off to one side — a chair tucked against the left third of a
 *  2 m wardrobe front, or a bookshelf at the head end of a bed — and reported the
 *  face fully clear. This module is the one the product describes as
 *  "reproducible math you can plan a real room around", so a silent false
 *  negative here is the worst kind of wrong.
 *
 *  Each probe is an exact ray/OBB intersection rather than a sampled march, so
 *  the answer no longer depends on a step size either. */
export function faceClearance(
  self: OBB,
  face: '+x' | '-x' | '+z' | '-z',
  obstacles: OBB[],
  room: Poly,
  maxRange = 4,
): number {
  const c = Math.cos(self.rot);
  const s = Math.sin(self.rot);
  // Outward normal of the face, the half-extent along it, and the in-face
  // tangent + half-width to spread the probes along.
  let dx: number, dz: number, half: number, tx: number, tz: number, halfAcross: number;
  switch (face) {
    case '+x': dx = c; dz = -s; half = self.hw; tx = s; tz = c; halfAcross = self.hd; break;
    case '-x': dx = -c; dz = s; half = self.hw; tx = s; tz = c; halfAcross = self.hd; break;
    case '+z': dx = s; dz = c; half = self.hd; tx = c; tz = -s; halfAcross = self.hw; break;
    case '-z': dx = -s; dz = -c; half = self.hd; tx = c; tz = -s; halfAcross = self.hw; break;
  }

  let best = maxRange;
  // Inset the outermost probes slightly so a neighbour flush against the SIDE of
  // this part isn't counted as blocking its front.
  const spread = Math.max(0, halfAcross - 0.02);
  for (let i = 0; i < FACE_PROBES; i++) {
    const u = (i / PROBE_SPAN) * 2 - 1; // -1 … +1 across the face
    const ax = self.cx + dx * (half + 0.001) + tx * u * spread;
    const az = self.cz + dz * (half + 0.001) + tz * u * spread;
    let hit = Math.min(best, rayToBoundary(ax, az, dx, dz, room));
    for (const o of obstacles) {
      if (o === self) continue;
      const t = rayToObb(ax, az, dx, dz, o);
      if (t < hit) hit = t;
    }
    if (hit < best) best = hit;
  }
  return best;
}

/** Distance from a point to the polygon's boundary, whichever side it is on.
 *
 *  `nearestEdge` answers this too, along with which edge and which way is inward,
 *  and allocates a record to say so. This is the version for the caller that only
 *  wants the number — combined with one `pointInPoly` it proves a footprint is
 *  wholly inside the room, which is nine point tests it then does not have to do. */
export function distToBoundary(poly: Poly, x: number, z: number): number {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const d = distPointToSegment([x, z], poly[i], poly[(i + 1) % poly.length]);
    if (d < best) best = d;
  }
  return best;
}

/** Share of a footprint that falls outside a polygon, 0..1.
 *
 *  Sampled on an n×n grid in the footprint's own frame rather than clipped
 *  exactly. Every caller uses it to know how much of something is unusable and
 *  which way is in, and one of them runs it tens of thousands of times inside an
 *  annealer, where an exact polygon clip costs far more than the answer is worth. */
export function outsideShare(f: OBB, poly: Poly, n = 3): number {
  // Wholly inside, proven in two tests rather than n²: the boundary is further
  // away than the footprint's own bounding circle reaches, and the centre is in.
  if (distToBoundary(poly, f.cx, f.cz) >= Math.hypot(f.hw, f.hd)) {
    return pointInPoly(f.cx, f.cz, poly) ? 0 : 1;
  }
  const c = Math.cos(f.rot);
  const s = Math.sin(f.rot);
  let out = 0;
  for (let i = 0; i < n; i++) {
    const lx = ((i + 0.5) / n - 0.5) * 2 * f.hw;
    for (let j = 0; j < n; j++) {
      const lz = ((j + 0.5) / n - 0.5) * 2 * f.hd;
      // `localToWorld`, inlined with the trig hoisted out of the sample loop.
      if (!pointInPoly(f.cx + lx * c + lz * s, f.cz - lx * s + lz * c, poly)) out++;
    }
  }
  return out / (n * n);
}

export function pointInObb(x: number, z: number, b: OBB): boolean {
  const c = Math.cos(b.rot);
  const s = Math.sin(b.rot);
  const dx = x - b.cx;
  const dz = z - b.cz;
  // `worldToLocal`, inlined — this one runs per raster cell.
  const lx = dx * c - dz * s;
  const lz = dx * s + dz * c;
  return Math.abs(lx) <= b.hw && Math.abs(lz) <= b.hd;
}

// ─── Round footprints ───────────────────────────────────────────────────────
//
// A round table, an ottoman, a pot plant and a round rug all had square
// footprints as far as the geometry was concerned. The bounding square of a
// circle is 4/π — 27% — bigger than the circle, and all of that surplus sits in
// the four corners, which is exactly where the chairs go. So a chair genuinely
// tucked under a round dining table read as a clash, and a round rug claimed a
// quarter more floor than it covers.
//
// `circle` means the ellipse INSCRIBED in the OBB. That is a true circle whenever
// W == D, which is how every round part in the catalog is authored — and an
// ellipse is what the renderer actually draws if someone scales one axis, so
// modelling the ellipse rather than "a circle of radius W/2" keeps the maths and
// the picture agreeing.

/** A plan footprint that may be round. Assignable anywhere an `OBB` is wanted,
 *  so the rectangle-only helpers above still take one — they then treat it as its
 *  bounding box, which is the conservative direction for the two that matter
 *  (`faceClearance` reports slightly LESS room in front of a wardrobe, never
 *  more). */
export type Foot = OBB & { circle?: boolean };

export function footFromPart(
  pos: [number, number, number],
  rot: number,
  dimMM: [number, number, number],
  circle?: boolean,
): Foot {
  return { ...obbFromPart(pos, rot, dimMM), circle };
}

/** Exact plan area, m². */
export function footArea(f: Foot): number {
  return f.circle ? Math.PI * f.hw * f.hd : 4 * f.hw * f.hd;
}

/** Sides used to approximate a round footprint as a convex polygon.
 *
 *  An inscribed N-gon holds `(N/2π)·sin(2π/N)` of the ellipse: 98.9% at 24 sides,
 *  99.4% at 32. Inscribed rather than circumscribed on purpose, so every answer
 *  derived from it errs slightly SMALL and a round piece is never reported as
 *  hitting something it does not touch — a false collision is the worse failure
 *  here, because it stops a move the user is entitled to make.
 *
 *  Only the pairwise helpers polygonise; the per-cell containment test below is
 *  the exact ellipse, so this never runs in a hot loop. */
const CIRCLE_SEGMENTS = 32;

/** The footprint as a counter-clockwise convex polygon. Exact for a rectangle. */
export function footCorners(f: Foot, segments = CIRCLE_SEGMENTS): Vec2[] {
  if (!f.circle) return obbCorners(f);
  const c = Math.cos(f.rot);
  const s = Math.sin(f.rot);
  const out: Vec2[] = [];
  for (let i = 0; i < segments; i++) {
    const t = (i / segments) * Math.PI * 2;
    const lx = Math.cos(t) * f.hw;
    const lz = Math.sin(t) * f.hd;
    out.push([f.cx + lx * c + lz * s, f.cz - lx * s + lz * c]);
  }
  return out;
}

/** Do these two footprints overlap? Falls through to the rectangle fast path
 *  when neither is round, so nothing about rectangles changes. */
export function footOverlap(a: Foot, b: Foot, pad = 0): boolean {
  if (!a.circle && !b.circle) return obbOverlap(a, b, pad);
  const ca = footCorners(inflate(a, pad / 2));
  const cb = footCorners(inflate(b, pad / 2));
  return !hasSeparatingAxis(ca, cb) && !hasSeparatingAxis(cb, ca);
}

/** Area the two footprints share, m². */
export function footIntersectionArea(a: Foot, b: Foot): number {
  if (!a.circle && !b.circle) return obbIntersectionArea(a, b);
  if (gapLowerBound(a, b) > 0) return 0;
  // Two true circles have a closed form — the classic two-circle lens — and every
  // round part in the catalog is authored with W == D, so this is the case that
  // actually occurs. It is both exact (against the 32-gon's 99.4%) and about two
  // orders of magnitude cheaper than clipping a 32-gon against a 32-gon, which the
  // layout solver was doing tens of thousands of times for every pair of pot plants
  // in the room.
  if (a.circle && b.circle && isRound(a) && isRound(b)) return lensArea(a, b);
  return polyIntersectionArea(footCorners(a), footCorners(b));
}

/** Is this "circle" a circle rather than an ellipse? A tenth of a millimetre of
 *  slack, so a part whose W and D were typed as the same number still qualifies
 *  after unit conversion. */
function isRound(f: Foot): boolean {
  return Math.abs(f.hw - f.hd) < 1e-4;
}

/** Area shared by two circles. */
function lensArea(a: Foot, b: Foot): number {
  const r1 = a.hw;
  const r2 = b.hw;
  const d = Math.hypot(b.cx - a.cx, b.cz - a.cz);
  if (d >= r1 + r2) return 0;
  // One inside the other: the smaller one, whole.
  if (d <= Math.abs(r1 - r2)) return Math.PI * Math.min(r1, r2) ** 2;
  const c1 = (d * d + r1 * r1 - r2 * r2) / (2 * d * r1);
  const c2 = (d * d + r2 * r2 - r1 * r1) / (2 * d * r2);
  const a1 = Math.acos(Math.max(-1, Math.min(1, c1)));
  const a2 = Math.acos(Math.max(-1, Math.min(1, c2)));
  return r1 * r1 * (a1 - Math.sin(2 * a1) / 2) + r2 * r2 * (a2 - Math.sin(2 * a2) / 2);
}

/** Is this point inside the footprint? Exact for the ellipse — no polygon
 *  approximation, because this one runs per raster cell and the closed form is
 *  cheaper than the 24-gon anyway. */
export function pointInFoot(x: number, z: number, f: Foot): boolean {
  if (!f.circle) return pointInObb(x, z, f);
  const c = Math.cos(f.rot);
  const s = Math.sin(f.rot);
  const dx = x - f.cx;
  const dz = z - f.cz;
  const lx = (dx * c - dz * s) / f.hw;
  const lz = (dx * s + dz * c) / f.hd;
  return lx * lx + lz * lz <= 1;
}

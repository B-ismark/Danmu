// Where in the room there is actually room.
//
// A footprint is a polygon; furniture is arranged in rectangles. Every hand-authored
// arrangement in this codebase used to be written against the polygon's BOUNDING
// BOX — `±width/2`, `±depth/2` — and a bounding box is not a room. In an L-shape
// the box includes the quadrant the L cuts away, so the starter scene's whole
// reading nook (armchair, side table) and its floor lamp were placed in the void,
// standing outside the room in mid-air. The U-shape put the bed and both
// nightstands in its north notch, and the T put the sofa, coffee table and rug off
// the side of its stem. That is what this module exists to stop.
//
// A *bay* is a maximal axis-aligned rectangle that genuinely fits inside the
// footprint. `roomBays` returns them largest first, so a rectangle has one bay (the
// whole room), an L has two (the long leg and its wing), a T has two (the bar and
// the stem), and a room whose walls the user has dragged into some shape nobody
// anticipated has whatever it has. Nothing here knows about furniture; it answers
// the geometric question, and `defaultScene` decides what goes in each answer.
//
// Rectilinear rooms are exact: the candidate rectangles are built on the grid of
// the polygon's own vertex coordinates, which for axis-aligned walls is a lossless
// decomposition of the floor. A footprint with a diagonal wall gets a conservative
// answer — a candidate is only accepted once `rectInsidePoly` has proved it, so a
// bay never overhangs a wall it merely straddles on the grid.

import type { Footprint } from './footprint';
import { distToBoundary, pointInPoly, type Poly } from './geometry';

/** An axis-aligned rectangle of real floor. */
export type Bay = {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  /** X span, metres. */
  width: number;
  /** Z span, metres. */
  depth: number;
  area: number;
  cx: number;
  cz: number;
};

/** One side of a bay, described the way a piece of furniture wants to hear it:
 *  which way is into the room, how much wall there is, how deep the bay runs from
 *  here, and whether this side is a real wall at all (a bay's edge through the
 *  middle of an open-plan floor is not). */
export type BaySide = {
  /** Inward unit normal. */
  nx: number;
  nz: number;
  /** The yaw that makes a part's front (local +Z) face into the bay from this side
   *  — the same convention `nearestEdge` and `Draggable` use. */
  yaw: number;
  /** Midpoint of the side. */
  mx: number;
  mz: number;
  /** Along the side, metres. */
  length: number;
  /** Perpendicular to it — how far the bay reaches from this side. */
  depth: number;
  /** Does this side lie on the room's own boundary? */
  onWall: boolean;
};

/** Numerical slack. Bay edges are grid lines taken FROM the polygon, so a corner
 *  test lands exactly on the boundary; every containment proof runs on a rectangle
 *  inset by this much rather than on the knife edge. */
const EPS = 1e-4;

/** How close a side has to run to the boundary along its whole length before it
 *  counts as a wall. Generous enough for floating-point drift, tight enough that a
 *  bay edge crossing open floor never passes. */
const WALL_TOL = 0.02;

function makeBay(minX: number, maxX: number, minZ: number, maxZ: number): Bay {
  const width = maxX - minX;
  const depth = maxZ - minZ;
  return {
    minX,
    maxX,
    minZ,
    maxZ,
    width,
    depth,
    area: width * depth,
    cx: (minX + maxX) / 2,
    cz: (minZ + maxZ) / 2,
  };
}

/**
 * The room's rectangles of usable floor, largest first.
 *
 * Greedy: take the largest rectangle, strike it out, take the largest of what is
 * left. Greedy is the right shape of answer here — the point is to find the room's
 * one obvious main space and then its leftover wing, which is how a person reads an
 * L-shaped room too.
 */
export function roomBays(
  poly: Footprint,
  opts: { max?: number; minSide?: number; minArea?: number } = {},
): Bay[] {
  const max = opts.max ?? 3;
  const minSide = opts.minSide ?? 0.8;
  const minArea = opts.minArea ?? 1.0;

  const xs = axis(poly.map((p) => p[0]));
  const zs = axis(poly.map((p) => p[1]));
  if (xs.length < 2 || zs.length < 2) return [];

  // Cell (i,j) spans xs[i]…xs[i+1] × zs[j]…zs[j+1]. For axis-aligned walls a cell
  // is wholly inside or wholly outside, so its centre decides it.
  const open: boolean[][] = [];
  for (let i = 0; i < xs.length - 1; i++) {
    open.push([]);
    for (let j = 0; j < zs.length - 1; j++) {
      open[i].push(pointInPoly((xs[i] + xs[i + 1]) / 2, (zs[j] + zs[j + 1]) / 2, poly as Poly));
    }
  }

  const out: Bay[] = [];
  for (let k = 0; k < max; k++) {
    const best = largestRect(open, xs, zs, poly as Poly);
    // Greedy means each bay is no bigger than the last, so the first one too small
    // to hold anything ends the search.
    if (!best || best.area < minArea || Math.min(best.width, best.depth) < minSide) break;
    out.push(best);
    for (let i = 0; i < open.length; i++) {
      for (let j = 0; j < open[i].length; j++) {
        if (xs[i] >= best.minX - EPS && xs[i + 1] <= best.maxX + EPS && zs[j] >= best.minZ - EPS && zs[j + 1] <= best.maxZ + EPS) {
          open[i][j] = false;
        }
      }
    }
  }
  return out;
}

/** Cut a bay in half across its longer axis. What an open-plan room needs: one
 *  rectangle, two things to put in it. */
export function splitBay(b: Bay): [Bay, Bay] {
  if (b.width >= b.depth) {
    return [makeBay(b.minX, b.cx, b.minZ, b.maxZ), makeBay(b.cx, b.maxX, b.minZ, b.maxZ)];
  }
  return [makeBay(b.minX, b.maxX, b.minZ, b.cz), makeBay(b.minX, b.maxX, b.cz, b.maxZ)];
}

/** Shrink a bay by `inset` on every side. Nothing should be placed flush with a
 *  bay's edge when that edge is a wall. */
export function insetBay(b: Bay, inset: number): Bay {
  const ix = Math.min(inset, b.width / 2 - EPS);
  const iz = Math.min(inset, b.depth / 2 - EPS);
  return makeBay(b.minX + ix, b.maxX - ix, b.minZ + iz, b.maxZ - iz);
}

/** The bay's four sides, in N, E, S, W order. */
export function baySides(b: Bay, poly: Footprint): BaySide[] {
  const raw = [
    { mx: b.cx, mz: b.minZ, nx: 0, nz: 1, length: b.width, depth: b.depth },
    { mx: b.maxX, mz: b.cz, nx: -1, nz: 0, length: b.depth, depth: b.width },
    { mx: b.cx, mz: b.maxZ, nx: 0, nz: -1, length: b.width, depth: b.depth },
    { mx: b.minX, mz: b.cz, nx: 1, nz: 0, length: b.depth, depth: b.width },
  ];
  return raw.map((s) => ({
    ...s,
    yaw: Math.atan2(s.nx, s.nz),
    onWall: sideOnWall(s.mx, s.mz, s.nx, s.nz, s.length, poly as Poly),
  }));
}

/** The side to put a room's back against: a real wall, as much of it as possible,
 *  and enough depth in front of it to arrange something. Returns null when the bay
 *  touches no wall at all, which only happens to a bay someone has split out of
 *  the middle of an open plan. */
export function backWall(sides: BaySide[], wantDepth = 3.2): BaySide | null {
  let best: BaySide | null = null;
  let bestScore = -Infinity;
  for (const s of sides) {
    if (!s.onWall) continue;
    // Depth first — a television needs the room to back away from it — then wall.
    const score = Math.min(s.depth, wantDepth) * 2 + s.length;
    if (score > bestScore) {
      bestScore = score;
      best = s;
    }
  }
  return best;
}

// ─── Internals ──────────────────────────────────────────────────────────────

/** Sorted unique coordinates, with near-duplicates collapsed. Two walls dragged to
 *  within a micron of each other are one grid line, not a sliver cell. */
function axis(values: number[]): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const out: number[] = [];
  for (const v of sorted) {
    if (out.length === 0 || v - out[out.length - 1] > 1e-6) out.push(v);
  }
  return out;
}

/** Largest all-open rectangle on the grid, proved against the polygon.
 *
 *  Every band of rows (j1…j2) crossed with every maximal run of open columns in
 *  that band. The grid is the polygon's own vertices, so it is tiny — five or six
 *  lines each way for the presets — and the exhaustive form is both the clearest to
 *  read and faster than the histogram version at this size. */
function largestRect(open: boolean[][], xs: number[], zs: number[], poly: Poly): Bay | null {
  const nx = open.length;
  const nz = open[0]?.length ?? 0;
  let best: Bay | null = null;

  for (let j1 = 0; j1 < nz; j1++) {
    for (let j2 = j1; j2 < nz; j2++) {
      // Columns open across the whole band.
      let runStart = -1;
      for (let i = 0; i <= nx; i++) {
        let ok = i < nx;
        for (let j = j1; ok && j <= j2; j++) ok = open[i][j];
        if (ok) {
          if (runStart < 0) runStart = i;
          continue;
        }
        if (runStart >= 0) {
          const cand = makeBay(xs[runStart], xs[i], zs[j1], zs[j2 + 1]);
          if ((!best || cand.area > best.area) && rectInsidePoly(cand, poly)) best = cand;
          runStart = -1;
        }
      }
    }
  }
  return best;
}

/** Is this rectangle wholly inside the polygon? Exact for any simple polygon: the
 *  four (inset) corners are in, and no wall crosses the rectangle's own edges — so
 *  a rectangle spanning an L's notch, whose corners are all in the two legs, is
 *  correctly refused. */
function rectInsidePoly(b: Bay, poly: Poly): boolean {
  const r = insetBay(b, EPS);
  const corners: Array<[number, number]> = [
    [r.minX, r.minZ],
    [r.maxX, r.minZ],
    [r.maxX, r.maxZ],
    [r.minX, r.maxZ],
  ];
  for (const [x, z] of corners) if (!pointInPoly(x, z, poly)) return false;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const c = poly[(i + 1) % poly.length];
    for (let k = 0; k < 4; k++) {
      if (segmentsCross(a, c, corners[k], corners[(k + 1) % 4])) return false;
    }
  }
  return true;
}

/** Do two segments properly cross? Orientation signs, strict on both — segments
 *  that merely share an endpoint or run along each other do not count, which is
 *  what a rectangle flush against a wall does. */
function segmentsCross(
  p1: [number, number],
  p2: [number, number],
  p3: [number, number],
  p4: [number, number],
): boolean {
  const d = (a: [number, number], b: [number, number], c: [number, number]) =>
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const d1 = d(p1, p2, p3);
  const d2 = d(p1, p2, p4);
  const d3 = d(p3, p4, p1);
  const d4 = d(p3, p4, p2);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** Does the whole side lie on the polygon's boundary? Sampled along it rather than
 *  at its midpoint: half a bay edge can sit on a wall while the other half crosses
 *  open floor, and a sofa placed against the open half is a sofa in the middle of
 *  the room facing nothing. */
function sideOnWall(mx: number, mz: number, nx: number, nz: number, length: number, poly: Poly): boolean {
  // Along the side is perpendicular to its normal.
  const tx = -nz;
  const tz = nx;
  const probes = 5;
  for (let i = 0; i < probes; i++) {
    const u = ((i / (probes - 1)) * 2 - 1) * (length / 2) * 0.92;
    if (distToBoundary(poly, mx + tx * u, mz + tz * u) > WALL_TOL) return false;
  }
  return true;
}

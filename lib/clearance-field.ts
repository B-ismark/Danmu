// Clearance as a FIELD rather than a list of pairwise rules.
//
// `lib/clearance.ts` answered "is this room comfortable" by comparing pieces of
// furniture two at a time. That works for a gap between a sofa and a wardrobe and
// is blind to everything else: a walkway pinched between a sofa and a WALL is
// invisible to a part-vs-part loop, and so is a chair you cannot actually get to
// because the route to it is blocked by two other things that are individually
// fine.
//
// One raster answers all of it. Mark the floor, compute the distance from every
// free cell to the nearest obstacle, and the room's circulation falls out:
//
//   · the value at a cell  → how much room a person has standing there
//   · cells above 300 mm   → where a person can actually walk
//   · connected components → which of those places join up
//   · the largest value    → whether a wheelchair can turn round
//   · the free-cell count  → crowding, which used to need its own pass
//
// The distance transform is Felzenszwalb & Huttenlocher's exact squared EDT: two
// 1D lower-envelope passes, O(cells), no approximation and no iteration count to
// get wrong. It is extended here to carry the index of the winning source, so a
// cell knows not just how far the nearest obstacle is but WHICH obstacle it is —
// without that, a finding could say "something is 30 cm away" and not which two
// pieces to select when the user clicks it.
//
// **The field is quantised and says so.** A cell centre is up to half a cell from
// where the true nearest point is, so every reading carries ±`cell`/2 of error.
// Callers must not compare it against a threshold naively: `clearance.ts` raises a
// finding only when the whole uncertainty band sits on the wrong side of the
// rule, which is the same "no false warnings" bar the rest of the room report is
// held to.

import { obbExtentAlong, pointInPoly, type Foot, type Poly } from './geometry';

/** Raster resolution, metres. 5 cm gives ±25 mm on every reading, which is finer
 *  than any of the rules this feeds and cheap enough to run on every edit. */
export const FIELD_CELL = 0.05;

/** Half the 600 mm walkway rule — the radius of the disc a person occupies.
 *  A cell at or above this has room for someone to stand and pass. */
export const WALK_RADIUS = 0.3;

/** Wheelchair turning circle. ADA 1524 mm, AS1428.1 and ISO 21542 1500 mm; the
 *  smallest of those is the one to hold ourselves to. */
export const TURNING_DIAMETER = 1.5;

/** `cover` values for cells that hold no furniture. */
export const FREE_CELL = -1;
/** …and for cells outside the footprint, which are wall as far as a person
 *  walking is concerned. Negative so `owner >= 0` reads as "a real part". */
export const WALL_OWNER = -2;

/** Above this the raster is coarsened rather than allocating hundreds of MB.
 *  MAX_ROOM (40 m) at 5 cm is 643k cells, so this only triggers for a custom
 *  footprint far outside anything the app can currently build. */
const MAX_CELLS = 4_000_000;

const INF = 1e20;

export type CoverageRaster = {
  cell: number;
  /** World position of cell (0,0)'s CENTRE is `minX + cell/2`, `minZ + cell/2`. */
  minX: number;
  minZ: number;
  nx: number;
  nz: number;
  /** Part index, FREE_CELL, or WALL_OWNER. */
  cover: Int32Array;
  /** Cells inside the footprint (free or covered). */
  insideCount: number;
  /** Cells inside the footprint and not covered by anything. */
  freeCount: number;
};

export type ClearanceField = CoverageRaster & {
  /** Metres from this cell's centre to the nearest obstacle surface or wall.
   *  0 for cells that are themselves covered or outside. Carries ±cell/2. */
  clearance: Float32Array;
  /** For a free cell, the `cover` value of its nearest obstacle — a part index,
   *  or WALL_OWNER when the wall is the closest thing. Meaningless elsewhere. */
  nearest: Int32Array;
  /** Walkable-region id, or -1 where clearance < WALK_RADIUS. */
  component: Int32Array;
  componentCount: number;
};

/** Rasterise the footprint and the parts standing on it.
 *
 *  Part-major, like `freeFloorFraction` — each part is scanned over its own
 *  bounding box with the trig hoisted out of the loop, so the cost is the sum of
 *  the part areas rather than room-area × part-count.
 *
 *  The grid is padded by one cell on every side, and that ring matters: a
 *  rectangular room fills its own bounding box exactly, so without the pad there
 *  would be no cell outside the polygon anywhere and the EDT would have nothing
 *  to measure the walls from — every cell would report infinite clearance in a
 *  room made entirely of walls. The ring sits half a cell beyond the wall, which
 *  is exactly where the wall is relative to the first interior cell centre.
 *
 *  Interior cell centres land on the same lattice as the unpadded scan, so this
 *  produces the same coverage numbers `freeFloorFraction` always did. */
export function rasterizeCoverage(parts: Foot[], poly: Poly, cell = FIELD_CELL): CoverageRaster | null {
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
  if (!Number.isFinite(minX) || maxX <= minX || maxZ <= minZ) return null;

  let c = cell;
  let nx = Math.max(1, Math.ceil((maxX - minX) / c)) + 2;
  let nz = Math.max(1, Math.ceil((maxZ - minZ) / c)) + 2;
  while (nx * nz > MAX_CELLS) {
    c *= 2;
    nx = Math.max(1, Math.ceil((maxX - minX) / c)) + 2;
    nz = Math.max(1, Math.ceil((maxZ - minZ) / c)) + 2;
  }
  // Origin moves out by one cell so index 1 lands where index 0 used to.
  const ox = minX - c;
  const oz = minZ - c;

  const cover = new Int32Array(nx * nz).fill(WALL_OWNER);
  let insideCount = 0;
  for (let j = 0; j < nz; j++) {
    const z = oz + (j + 0.5) * c;
    const row = j * nx;
    for (let i = 0; i < nx; i++) {
      const x = ox + (i + 0.5) * c;
      if (!pointInPoly(x, z, poly)) continue;
      cover[row + i] = FREE_CELL;
      insideCount++;
    }
  }

  let covered = 0;
  for (let p = 0; p < parts.length; p++) {
    const b = parts[p];
    const cs = Math.cos(-b.rot);
    const sn = Math.sin(-b.rot);
    // A round footprint is the inscribed ellipse, tested in closed form below —
    // the bound is still the bounding box, which is a superset, so it only costs
    // a few extra cells at the corners.
    const round = b.circle === true;
    const ihw = 1 / b.hw;
    const ihd = 1 / b.hd;
    const ex = obbExtentAlong(b, 1, 0);
    const ez = obbExtentAlong(b, 0, 1);
    const i0 = Math.max(0, Math.floor((b.cx - ex - ox) / c - 0.5));
    const i1 = Math.min(nx - 1, Math.ceil((b.cx + ex - ox) / c - 0.5));
    const j0 = Math.max(0, Math.floor((b.cz - ez - oz) / c - 0.5));
    const j1 = Math.min(nz - 1, Math.ceil((b.cz + ez - oz) / c - 0.5));
    for (let j = j0; j <= j1; j++) {
      const dz = oz + (j + 0.5) * c - b.cz;
      const row = j * nx;
      for (let i = i0; i <= i1; i++) {
        const at = row + i;
        // Only claim floor the room actually has, and only claim it once — the
        // first part to reach a cell owns it, so overlapping pieces (a chair
        // under a desk) are counted a single time.
        if (cover[at] !== FREE_CELL) continue;
        const dx = ox + (i + 0.5) * c - b.cx;
        const lx = dx * cs - dz * sn;
        const lz = dx * sn + dz * cs;
        if (round) {
          if (lx * lx * ihw * ihw + lz * lz * ihd * ihd > 1) continue;
        } else {
          if (Math.abs(lx) > b.hw || Math.abs(lz) > b.hd) continue;
        }
        cover[at] = p;
        covered++;
      }
    }
  }

  return { cell: c, minX: ox, minZ: oz, nx, nz, cover, insideCount, freeCount: insideCount - covered };
}

/** Build the full field: coverage, exact distance-to-nearest-obstacle, which
 *  obstacle that is, and the walkable connected components. */
export function buildClearanceField(parts: Foot[], poly: Poly, cell = FIELD_CELL): ClearanceField | null {
  const r = rasterizeCoverage(parts, poly, cell);
  if (!r) return null;
  const { nx, nz, cover } = r;
  const n = nx * nz;

  // Seeds are everything a person cannot stand in: furniture and the world
  // outside the footprint.
  const f = new Float64Array(n);
  const srcA = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const seed = cover[i] !== FREE_CELL;
    f[i] = seed ? 0 : INF;
    srcA[i] = seed ? i : -1;
  }

  const dist2 = new Float64Array(n);
  const srcB = new Int32Array(n);
  const maxDim = Math.max(nx, nz);
  const colF = new Float64Array(maxDim);
  const colD = new Float64Array(maxDim);
  const colSrcIn = new Int32Array(maxDim);
  const colSrcOut = new Int32Array(maxDim);
  const v = new Int32Array(maxDim);
  const zs = new Float64Array(maxDim + 1);

  // Pass 1 — down each column.
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      colF[j] = f[j * nx + i];
      colSrcIn[j] = srcA[j * nx + i];
    }
    edt1d(colF, nz, colD, colSrcIn, colSrcOut, v, zs);
    for (let j = 0; j < nz; j++) {
      dist2[j * nx + i] = colD[j];
      srcB[j * nx + i] = colSrcOut[j];
    }
  }
  // Pass 2 — across each row, over pass 1's result.
  for (let j = 0; j < nz; j++) {
    const row = j * nx;
    for (let i = 0; i < nx; i++) {
      colF[i] = dist2[row + i];
      colSrcIn[i] = srcB[row + i];
    }
    edt1d(colF, nx, colD, colSrcIn, colSrcOut, v, zs);
    for (let i = 0; i < nx; i++) {
      dist2[row + i] = colD[i];
      srcB[row + i] = colSrcOut[i];
    }
  }

  const c = r.cell;
  const half = c / 2;
  const clearance = new Float32Array(n);
  const nearest = new Int32Array(n).fill(WALL_OWNER);
  for (let i = 0; i < n; i++) {
    if (cover[i] !== FREE_CELL) continue;
    const s = srcB[i];
    if (s < 0) continue; // no seed anywhere — cannot happen with the pad ring
    // The seed is a cell CENTRE; the surface it stands for is half a cell nearer.
    clearance[i] = Math.max(0, Math.sqrt(dist2[i]) * c - half);
    nearest[i] = cover[s];
  }

  const { component, componentCount } = walkableComponents(clearance, cover, nx, nz);
  return { ...r, clearance, nearest, component, componentCount };
}

/** Felzenszwalb–Huttenlocher 1D squared distance transform, carrying the winning
 *  source index through so the 2D result can name the nearest obstacle.
 *
 *  `srcIn` and `srcOut` must be different arrays: the scan reads `srcIn[v[k]]` at
 *  positions it has already written past. */
function edt1d(
  f: Float64Array,
  n: number,
  d: Float64Array,
  srcIn: Int32Array,
  srcOut: Int32Array,
  v: Int32Array,
  zs: Float64Array,
): void {
  let k = 0;
  v[0] = 0;
  zs[0] = -INF;
  zs[1] = INF;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= zs[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    zs[k] = s;
    zs[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (zs[k + 1] < q) k++;
    const dv = q - v[k];
    d[q] = dv * dv + f[v[k]];
    srcOut[q] = srcIn[v[k]];
  }
}

/** Flood-fill the cells with room to stand in. 4-connected: a person does not
 *  squeeze through a diagonal pinhole between two corners. */
function walkableComponents(
  clearance: Float32Array,
  cover: Int32Array,
  nx: number,
  nz: number,
): { component: Int32Array; componentCount: number } {
  const n = nx * nz;
  const component = new Int32Array(n).fill(-1);
  const stack = new Int32Array(n);
  const walkable = (at: number) => cover[at] === FREE_CELL && clearance[at] >= WALK_RADIUS;
  let count = 0;
  for (let start = 0; start < n; start++) {
    if (component[start] !== -1 || !walkable(start)) continue;
    const id = count++;
    component[start] = id;
    let top = 0;
    stack[top++] = start;
    while (top > 0) {
      const at = stack[--top];
      const i = at % nx;
      const j = (at - i) / nx;
      const left = i > 0 ? at - 1 : -1;
      const right = i < nx - 1 ? at + 1 : -1;
      const up = j > 0 ? at - nx : -1;
      const down = j < nz - 1 ? at + nx : -1;
      for (const nb of [left, right, up, down]) {
        if (nb < 0 || component[nb] !== -1 || !walkable(nb)) continue;
        component[nb] = id;
        stack[top++] = nb;
      }
    }
  }
  return { component, componentCount: count };
}

// ─── Queries ────────────────────────────────────────────────────────────────

/** Cell index for a world point, or -1 when it falls outside the raster. */
export function cellAt(f: CoverageRaster, x: number, z: number): number {
  const i = Math.floor((x - f.minX) / f.cell);
  const j = Math.floor((z - f.minZ) / f.cell);
  if (i < 0 || j < 0 || i >= f.nx || j >= f.nz) return -1;
  return j * f.nx + i;
}

/** World centre of a cell. */
export function cellCentre(f: CoverageRaster, at: number): [number, number] {
  const i = at % f.nx;
  const j = (at - i) / f.nx;
  return [f.minX + (i + 0.5) * f.cell, f.minZ + (j + 0.5) * f.cell];
}

/** Share of the footprint not covered by furniture, 0..1. */
export function freeShareOf(r: CoverageRaster): number {
  if (r.insideCount === 0) return 1;
  return Math.max(0, Math.min(1, r.freeCount / r.insideCount));
}

/** The narrowest gap between each pair of things, in metres.
 *
 *  A cell whose nearest obstacle differs from a neighbour's sits on the medial
 *  axis between those two obstacles. Walking the pair of cells that straddle the
 *  axis reconstructs the gap: one measures to A, the other to B, and they are one
 *  cell apart, so `clearance[a] + cell + clearance[b]` spans it. Exact when the
 *  axis is square to the raster, within one cell otherwise — and unlike `obbGap`
 *  it also works when one side is the WALL, which has no OBB to pass.
 *
 *  The obvious `2 × min(clearance)` is wrong and the tests caught it: the medial
 *  axis almost never falls exactly on a cell centre, so doubling the nearer of
 *  the two readings loses up to a full cell every time — a systematic
 *  UNDER-estimate, which on a "is this too tight" rule is the direction that
 *  invents warnings.
 *
 *  Key is `a:b` with a < b, using WALL_OWNER for the wall. Compare the result
 *  against a threshold using `gapTolerance`, never bare. */
export function pairGaps(f: ClearanceField): Map<string, number> {
  const out = new Map<string, number>();
  const { nx, nz, cover, nearest, clearance } = f;
  for (let j = 0; j < nz; j++) {
    const row = j * nx;
    for (let i = 0; i < nx; i++) {
      const at = row + i;
      if (cover[at] !== FREE_CELL) continue;
      const own = nearest[at];
      // Right and down only — every adjacency is then visited exactly once.
      for (const nb of [i < nx - 1 ? at + 1 : -1, j < nz - 1 ? at + nx : -1]) {
        if (nb < 0 || cover[nb] !== FREE_CELL) continue;
        const other = nearest[nb];
        if (other === own) continue;
        const gap = clearance[at] + f.cell + clearance[nb];
        const key = own < other ? `${own}:${other}` : `${other}:${own}`;
        const prev = out.get(key);
        if (prev === undefined || gap < prev) out.set(key, gap);
      }
    }
  }
  return out;
}

/** How far a `pairGaps` reading can be from the truth, in metres.
 *
 *  One cell for the two clearance readings that make it up — a covered cell's
 *  centre is somewhere inside the surface's cell rather than exactly half a cell
 *  in, so each reading is right on average and off by up to half a cell either
 *  way. Half a cell again for orientation: the two straddling cells are one cell
 *  apart along a raster axis, but the gap they are reconstructing may run
 *  diagonally, and adding the full cell then overshoots.
 *
 *  Measured over random rotated pairs at 1.44 cells worst case, so 1.5 is the
 *  bound with nothing to spare — see `tests/clearance-field.test.ts`, which pins
 *  it. A rule must not raise a finding unless the whole ± band clears the
 *  threshold, or the raster starts inventing warnings. */
export function gapTolerance(f: { cell: number }): number {
  return f.cell * 1.5;
}

/** Largest disc that fits anywhere a person can stand, and where it sits.
 *  `2 × r` is the turning circle the room offers. */
export function largestFreeCircle(
  f: ClearanceField,
  components?: Set<number>,
): { x: number; z: number; r: number } | null {
  let best = -1;
  let at = -1;
  for (let i = 0; i < f.clearance.length; i++) {
    if (f.cover[i] !== FREE_CELL) continue;
    if (components && !components.has(f.component[i])) continue;
    if (f.clearance[i] > best) {
      best = f.clearance[i];
      at = i;
    }
  }
  if (at < 0) return null;
  const [x, z] = cellCentre(f, at);
  return { x, z, r: best };
}

/** Which walkable regions touch this point — used to ask what a door opens onto.
 *  Searches outward from the point because a door stands ON the wall, where by
 *  definition nobody can stand. */
export function componentsNear(f: ClearanceField, x: number, z: number, radius: number): Set<number> {
  const out = new Set<number>();
  const r = Math.ceil(radius / f.cell);
  const ci = Math.floor((x - f.minX) / f.cell);
  const cj = Math.floor((z - f.minZ) / f.cell);
  for (let j = Math.max(0, cj - r); j <= Math.min(f.nz - 1, cj + r); j++) {
    for (let i = Math.max(0, ci - r); i <= Math.min(f.nx - 1, ci + r); i++) {
      const id = f.component[j * f.nx + i];
      if (id >= 0) out.add(id);
    }
  }
  return out;
}

/** Which walkable regions reach the space immediately around a part. Generous on
 *  purpose: this feeds a "you cannot get to this" finding, and the cost of a
 *  false one is that the room report cries wolf. */
export function componentsAround(f: ClearanceField, b: Foot, margin = 0.75): Set<number> {
  const ex = obbExtentAlong(b, 1, 0) + margin;
  const ez = obbExtentAlong(b, 0, 1) + margin;
  const out = new Set<number>();
  const i0 = Math.max(0, Math.floor((b.cx - ex - f.minX) / f.cell));
  const i1 = Math.min(f.nx - 1, Math.ceil((b.cx + ex - f.minX) / f.cell));
  const j0 = Math.max(0, Math.floor((b.cz - ez - f.minZ) / f.cell));
  const j1 = Math.min(f.nz - 1, Math.ceil((b.cz + ez - f.minZ) / f.cell));
  for (let j = j0; j <= j1; j++) {
    const row = j * f.nx;
    for (let i = i0; i <= i1; i++) {
      const id = f.component[row + i];
      if (id >= 0) out.add(id);
    }
  }
  return out;
}

export type FieldRun = { x: number; z: number; w: number; h: number; state: number };

/** The field as horizontal runs of like-classified cells, in world metres.
 *
 *  For drawing. A 6 × 4 m room is ~10 000 cells but only a few hundred runs, so a
 *  plan overlay can be plain SVG rects that read `var(--accent-2-tint)` like
 *  everything else on the page — no canvas, and therefore no third copy of the
 *  palette in `scene-palette.ts` for a layer that cannot see the tokens.
 *
 *  `classify` returns a small state number, or anything negative to draw nothing.
 *  Bails to an empty array past `max` runs rather than emitting tens of thousands
 *  of nodes into the document. */
export function fieldRuns(f: ClearanceField, classify: (at: number) => number, max = 8000): FieldRun[] {
  const out: FieldRun[] = [];
  for (let j = 0; j < f.nz; j++) {
    const row = j * f.nx;
    let runStart = -1;
    let runState = -1;
    for (let i = 0; i <= f.nx; i++) {
      const state = i < f.nx ? classify(row + i) : -1;
      if (state === runState) continue;
      if (runState >= 0 && runStart >= 0) {
        out.push({
          x: f.minX + runStart * f.cell,
          z: f.minZ + j * f.cell,
          w: (i - runStart) * f.cell,
          h: f.cell,
          state: runState,
        });
        if (out.length > max) return [];
      }
      runState = state;
      runStart = state >= 0 ? i : -1;
    }
  }
  return out;
}

/** Floor area of each walkable region, m². Index is the component id. */
export function componentAreas(f: ClearanceField): number[] {
  const areas = new Array<number>(f.componentCount).fill(0);
  const cellArea = f.cell * f.cell;
  for (let i = 0; i < f.component.length; i++) {
    const id = f.component[i];
    if (id >= 0) areas[id] += cellArea;
  }
  return areas;
}

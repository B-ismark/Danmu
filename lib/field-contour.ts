// The outline of a region of the clearance field, as smooth closed loops.
//
// The plan used to draw circulation as one SVG rect per horizontal run of 5 cm
// cells, which is honest and reads as a staircase: every diagonal edge of walkable
// floor arrived as a saw blade, and the overlay looked like a debugging view laid
// over a drawing. A person walking past a chair does not walk in 5 cm steps.
//
// This draws the SAME cells — the classification is the caller's and is not
// restated here — as their boundary instead: marching squares over the cell
// centres (so a 45° stair becomes a straight 45° line), Douglas–Peucker to drop
// the stair-steps left on shallower slopes, then every corner rounded by a fixed
// radius. Fixed, not proportional: rounding by a share of each edge (Chaikin on the
// simplified loop) rounds a 4 m wall's corner by a metre and a chair's by a
// centimetre, which is the wrong way round for a drawing.
//
// What it costs in accuracy, so nobody has to re-derive it: a straight edge lands
// exactly on the cell boundary; a convex corner loses at most the rounding radius's
// worth of area; simplification moves no point more than `SIMPLIFY_CELLS` cell.
// The cells themselves — and therefore every finding Room check reports — are
// untouched; this is a drawing of the field, never an input to it.

/** What a contour needs to know about the grid. `CoverageRaster` satisfies it. */
export type ContourGrid = { cell: number; minX: number; minZ: number; nx: number; nz: number };

export type Loop = Array<[number, number]>;

/** How far, in cells, simplification may move a point. A shallow stair is half a
 *  cell either side of its true line, but Douglas–Peucker draws its chords through
 *  stair CORNERS, so the worst point sits a whole cell off a chord: one cell (5 cm)
 *  is what flattens a stair, and walkable floor is never thinner than a dozen. */
export const SIMPLIFY_CELLS = 1;

/** Closed loops, in world metres, around every cell `inside` accepts.
 *
 *  Loops do not cross, so drawing them with `fill-rule="evenodd"` gives the region
 *  with its holes. Two cells that touch only at a corner are kept apart (the
 *  saddle cases), which matches how the field's own components are counted. */
export function fieldContours(g: ContourGrid, inside: (at: number) => boolean): Loop[] {
  const { nx, nz } = g;
  const W = nx + 2;
  const on = (i: number, j: number) => i >= 0 && j >= 0 && i < nx && j < nz && inside(j * nx + i);
  // Edge ids: horizontal edge between centres (i,j)–(i+1,j), vertical (i,j)–(i,j+1).
  const H = (i: number, j: number) => ((j + 1) * W + (i + 1)) * 2;
  const V = (i: number, j: number) => ((j + 1) * W + (i + 1)) * 2 + 1;
  const links = new Map<number, number[]>();
  const link = (a: number, b: number) => {
    (links.get(a) ?? links.set(a, []).get(a)!).push(b);
    (links.get(b) ?? links.set(b, []).get(b)!).push(a);
  };
  for (let j = -1; j < nz; j++) {
    for (let i = -1; i < nx; i++) {
      const a = on(i, j), b = on(i + 1, j), c = on(i + 1, j + 1), d = on(i, j + 1);
      const k = (a ? 1 : 0) | (b ? 2 : 0) | (c ? 4 : 0) | (d ? 8 : 0);
      if (k === 0 || k === 15) continue;
      const top = H(i, j), right = V(i + 1, j), bottom = H(i, j + 1), left = V(i, j);
      if (k === 5) { link(top, left); link(right, bottom); continue; }
      if (k === 10) { link(top, right); link(left, bottom); continue; }
      const cut: number[] = [];
      if (a !== b) cut.push(top);
      if (b !== c) cut.push(right);
      if (d !== c) cut.push(bottom);
      if (a !== d) cut.push(left);
      link(cut[0], cut[1]);
    }
  }
  const at = (id: number): [number, number] => {
    const vertical = id & 1;
    const flat = id >> 1;
    const i = (flat % W) - 1;
    const j = Math.floor(flat / W) - 1;
    return vertical
      ? [g.minX + (i + 0.5) * g.cell, g.minZ + (j + 1) * g.cell]
      : [g.minX + (i + 1) * g.cell, g.minZ + (j + 0.5) * g.cell];
  };
  const loops: Loop[] = [];
  const seen = new Set<number>();
  for (const startId of links.keys()) {
    if (seen.has(startId)) continue;
    const loop: Loop = [];
    let prev = -1;
    let cur = startId;
    while (!seen.has(cur)) {
      seen.add(cur);
      loop.push(at(cur));
      const [n0, n1] = links.get(cur)!;
      const next = n0 !== prev ? n0 : n1;
      prev = cur;
      cur = next;
    }
    if (loop.length >= 3) loops.push(loop);
  }
  return loops;
}

const distToSegment = (p: [number, number], a: [number, number], b: [number, number]) => {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const len2 = dx * dx + dz * dz;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / len2)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz);
};

function simplifyOpen(pts: Loop, eps: number): Loop {
  if (pts.length <= 2) return pts.slice();
  let worst = 0;
  let at = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = distToSegment(pts[i], pts[0], pts[pts.length - 1]);
    if (d > worst) { worst = d; at = i; }
  }
  if (worst <= eps) return [pts[0], pts[pts.length - 1]];
  const left = simplifyOpen(pts.slice(0, at + 1), eps);
  return [...left.slice(0, -1), ...simplifyOpen(pts.slice(at), eps)];
}

/** Douglas–Peucker on a closed loop: split at the point farthest from the first,
 *  simplify both halves. Never returns fewer than three points. */
export function simplifyLoop(loop: Loop, eps: number): Loop {
  if (loop.length <= 3) return loop.slice();
  let far = 0;
  let best = -1;
  for (let i = 1; i < loop.length; i++) {
    const d = Math.hypot(loop[i][0] - loop[0][0], loop[i][1] - loop[0][1]);
    if (d > best) { best = d; far = i; }
  }
  const a = simplifyOpen(loop.slice(0, far + 1), eps);
  const b = simplifyOpen([...loop.slice(far), loop[0]], eps);
  const out = [...a.slice(0, -1), ...b.slice(0, -1)];
  return out.length >= 3 ? out : loop.slice();
}

/** One SVG path for a set of loops, every corner rounded by `radius` metres (less
 *  where an edge is too short to carry it), through `map` from world metres to the
 *  drawing's own units. Draw with `fill-rule="evenodd"`. */
export function roundedPath(loops: Loop[], radius: number, map: (x: number, z: number) => [number, number]): string {
  const f = (p: [number, number]) => {
    const [x, y] = map(p[0], p[1]);
    return `${+x.toFixed(2)} ${+y.toFixed(2)}`;
  };
  const toward = (a: [number, number], b: [number, number], d: number): [number, number] => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const t = len > 0 ? d / len : 0;
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  };
  const parts: string[] = [];
  for (const loop of loops) {
    const n = loop.length;
    if (n < 3) continue;
    const half = (i: number) => Math.hypot(loop[(i + 1) % n][0] - loop[i][0], loop[(i + 1) % n][1] - loop[i][1]) / 2;
    let d = '';
    for (let i = 0; i < n; i++) {
      const p = loop[i];
      const prev = loop[(i - 1 + n) % n];
      const next = loop[(i + 1) % n];
      const r = Math.min(radius, half((i - 1 + n) % n), half(i));
      const inP = toward(p, prev, r);
      const outP = toward(p, next, r);
      d += `${i ? 'L' : 'M'}${f(inP)} Q${f(p)} ${f(outP)} `;
    }
    parts.push(d + 'Z');
  }
  return parts.join(' ');
}

/** Signed area of a loop, m² (positive or negative by winding). */
export function loopArea(loop: Loop): number {
  let s = 0;
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i];
    const b = loop[(i + 1) % loop.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}

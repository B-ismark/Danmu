// Walks a shape's RENDERED geometry and reports its true horizontal footprint.
//
// Why this exists: `lib/geometry.ts` gives every piece ONE box (or one ellipse),
// and `docs/research/suggest-and-collision.md` § 4.1 says a compound footprint is
// unmeasured. It cannot be measured without a ground truth for what each shape
// actually occupies, and that truth lives in TSX renderers — which is exactly the
// place CLAUDE.md rule 2 says arithmetic hides, because no test can reach it.
//
// It reaches it by CALLING the component functions rather than rendering them: a
// React element is a plain object, so `type(props)` plus a walk of `props.children`
// gives the whole tree with no renderer, no jsdom and no WebGL. Components that use
// hooks cannot be called that way; they are declared below with a reason rather than
// skipped silently, and anything unrecognised is COUNTED and reported, never dropped.
// A run whose `unhandled` is non-empty is measuring less than the shape draws.

import { Euler, Matrix4, Vector3 } from 'three';
import { isValidElement, type ReactNode } from 'react';

/** A primitive's footprint: its projection onto the floor, as a convex point set. */
export type Prim = {
  /** what drew it, for attribution in a report */
  kind: string;
  /** XZ points whose convex hull is the floor projection */
  pts: Array<[number, number]>;
  /** vertical extent, so a canopy can be told from a leg */
  y: [number, number];
  /** drawn inside a `Spin`, so what it occupies is the disc it SWEEPS about the
   *  part's Y axis, not where the blade happens to sit at rest. Measured at rest, a
   *  ceiling fan reads as 22% of its own box and the box looks wildly too generous;
   *  swept, it is the inscribed circle the box is drawn around. */
  spun: boolean;
};

export type WalkReport = {
  prims: Prim[];
  /** components descended into without calling, and why */
  descended: Record<string, number>;
  /** components deliberately not walked, and why */
  declared: Record<string, number>;
  /** anything the walk did not recognise — MUST be empty for a run to mean anything */
  unhandled: Record<string, number>;
  /** primitives whose floor projection has no area — a plane standing vertically.
   *  They cannot overlap anything, so a shape drawn ENTIRELY from them silently
   *  stops colliding; counted here so that shows up as a number rather than a zero. */
  degenerate: number;
  /** components that threw when called */
  threw: Record<string, string>;
};

/** Wrappers that animate their children without displacing them at rest.
 *  Descend into `children`; do not call, because they use `useFrame`. */
const ANIMATION_WRAPPERS = new Set(['Sway', 'Spin']);

/** Renders no geometry — lights only. Declared rather than skipped by accident. */
const NO_GEOMETRY = new Set(['PartLight']);

const _e = new Euler();
const _v = new Vector3();

function xform(
  base: Matrix4,
  position?: number[],
  rotation?: number[],
  scale?: number | number[],
): Matrix4 {
  const p = position ?? [0, 0, 0];
  const r = rotation ?? [0, 0, 0];
  const s = typeof scale === 'number' ? [scale, scale, scale] : (scale ?? [1, 1, 1]);
  const m = new Matrix4();
  _e.set(r[0] ?? 0, r[1] ?? 0, r[2] ?? 0, 'XYZ');
  m.makeRotationFromEuler(_e);
  m.scale(_v.set(s[0] ?? 1, s[1] ?? 1, s[2] ?? 1));
  m.setPosition(p[0] ?? 0, p[1] ?? 0, p[2] ?? 0);
  return base.clone().multiply(m);
}

function push(out: Prim[], kind: string, local: Array<[number, number, number]>, m: Matrix4, spun: boolean) {
  const pts: Array<[number, number]> = [];
  let lo = Infinity;
  let hi = -Infinity;
  for (const [x, y, z] of local) {
    _v.set(x, y, z).applyMatrix4(m);
    pts.push([_v.x, _v.z]);
    lo = Math.min(lo, _v.y);
    hi = Math.max(hi, _v.y);
  }
  out.push({ kind, pts, y: [lo, hi], spun });
}

const boxCorners = (w: number, h: number, d: number): Array<[number, number, number]> => {
  const c: Array<[number, number, number]> = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1])
    c.push([(sx * w) / 2, (sy * h) / 2, (sz * d) / 2]);
  return c;
};

/** A round primitive as two rings. 64 segments — the projection error is under
 *  0.13% of the radius, a tenth of a millimetre at furniture scale. */
const RING_SEG = 64;
const rings = (rTop: number, rBot: number, h: number): Array<[number, number, number]> => {
  const c: Array<[number, number, number]> = [];
  for (let i = 0; i < RING_SEG; i++) {
    const a = (i / RING_SEG) * Math.PI * 2;
    c.push([Math.cos(a) * rTop, h / 2, Math.sin(a) * rTop]);
    c.push([Math.cos(a) * rBot, -h / 2, Math.sin(a) * rBot]);
  }
  return c;
};

/** A sphere as a lat/long shell — a single ring cannot express a tilt. */
const shell = (r: number): Array<[number, number, number]> => {
  const c: Array<[number, number, number]> = [];
  for (let j = 0; j <= 8; j++) {
    const phi = (j / 8) * Math.PI;
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      c.push([r * Math.sin(phi) * Math.cos(a), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(a)]);
    }
  }
  return c;
};

/** Geometry elements, by R3F host name, to local points. The vocabulary is derived
 *  (`grep -o '<[a-z]*Geometry'`), not recalled; anything outside it lands in
 *  `unhandled` rather than contributing nothing in silence. */
function geometryPoints(type: string, args: unknown[]): Array<[number, number, number]> | null {
  const n = (i: number, d = 0) => (typeof args[i] === 'number' ? (args[i] as number) : d);
  switch (type) {
    case 'boxGeometry':
      return boxCorners(n(0, 1), n(1, 1), n(2, 1));
    case 'cylinderGeometry':
      return rings(n(0, 1), n(1, 1), n(2, 1));
    case 'coneGeometry':
      return rings(0, n(0, 1), n(1, 1));
    case 'sphereGeometry':
      return shell(n(0, 1));
    case 'circleGeometry':
      // A disc in the XY plane, so its own rotation is what puts it on the floor.
      return rings(n(0, 1), n(0, 1), 0).map(([x, y, z]) => [x, z, y] as [number, number, number]);
    case 'planeGeometry':
      return boxCorners(n(0, 1), n(1, 1), 0);
    case 'torusGeometry': {
      // A torus lies in the XY plane with its axis on Z — NOT on Y like a cylinder.
      // Written with the cylinder's orientation first, it put a washing machine's door
      // ring 220 mm through the back of the machine and the row read as a real finding
      // about the app. The tell was that the number did not move with the size.
      //
      // Outer envelope only: the hole is real, but treating the annulus as a disc is
      // the CONSERVATIVE direction, and it is said here rather than assumed.
      const rr = n(0, 1) + n(1, 0);
      const tube = n(1, 0);
      const c: Array<[number, number, number]> = [];
      for (let i = 0; i < RING_SEG; i++) {
        const a = (i / RING_SEG) * Math.PI * 2;
        c.push([Math.cos(a) * rr, Math.sin(a) * rr, tube]);
        c.push([Math.cos(a) * rr, Math.sin(a) * rr, -tube]);
      }
      return c;
    }
    default:
      return null;
  }
}

type AnyProps = Record<string, unknown>;

const REACT_FRAGMENT = Symbol.for('react.fragment');

export function walk(node: ReactNode): WalkReport {
  const rep: WalkReport = { prims: [], descended: {}, declared: {}, unhandled: {}, threw: {}, degenerate: 0 };
  const bump = (m: Record<string, number>, k: string) => {
    m[k] = (m[k] ?? 0) + 1;
  };

  const visit = (n: ReactNode, m: Matrix4, spun = false): void => {
    if (n == null || typeof n === 'boolean' || typeof n === 'string' || typeof n === 'number') return;
    if (Array.isArray(n)) {
      for (const c of n) visit(c, m, spun);
      return;
    }
    if (!isValidElement(n)) return;

    const props = (n.props ?? {}) as AnyProps;
    const t = n.type as unknown;

    if (t === REACT_FRAGMENT) {
      visit(props.children as ReactNode, m, spun);
      return;
    }

    // ── host elements ────────────────────────────────────────────────────────
    if (typeof t === 'string') {
      if (t === 'group' || t === 'mesh' || t === 'instancedMesh' || t === 'primitive') {
        const child = xform(m, props.position as number[], props.rotation as number[], props.scale as number | number[]);
        visit(props.children as ReactNode, child, spun);
        return;
      }
      if (t.endsWith('Geometry')) {
        const pts = geometryPoints(t, (props.args as unknown[]) ?? []);
        if (pts) push(rep.prims, t, pts, m, spun);
        else bump(rep.unhandled, t);
        return;
      }
      if (t.endsWith('Material')) return; // carries no geometry
      bump(rep.unhandled, t);
      return;
    }

    // ── components ───────────────────────────────────────────────────────────
    const name =
      (t as { displayName?: string })?.displayName ?? (t as { name?: string })?.name ?? '<anonymous>';

    if (NO_GEOMETRY.has(name)) {
      bump(rep.declared, name);
      return;
    }

    if (ANIMATION_WRAPPERS.has(name)) {
      bump(rep.descended, name);
      visit(props.children as ReactNode, m, spun || name === 'Spin');
      return;
    }

    if (name === 'Box') {
      const child = xform(m, props.position as number[], props.rotation as number[]);
      const s = props.size as number[];
      push(rep.prims, 'Box', boxCorners(s[0], s[1], s[2]), child, spun);
      visit(props.children as ReactNode, child, spun); // Box renders children in the same group
      return;
    }

    if (name === 'BoxInstances' || name === 'PlaneInstances') {
      // MISSING and EMPTY are different answers and only one of them is legitimate.
      // `?? []` alone made them one: rename the `items` prop and all four callers
      // (`BookshelfGeo`'s spines, `ShoeRackGeo`'s slats, `CurtainGeo`'s folds,
      // `RadiatorGeo`'s fins) contribute no primitives at all, every area in this
      // instrument shrinks, and nothing anywhere says so. An absent prop is reported
      // like any other thing the walk could not handle; a present, empty array is a
      // renderer that legitimately drew none at this size.
      if (!Array.isArray(props.items)) {
        bump(rep.unhandled, `${name}.items`);
        return;
      }
      const items = props.items as Array<{ pos: number[]; size: number[]; rot?: number[] }>;
      for (const it of items) {
        const child = xform(m, it.pos, it.rot);
        const [w, h, d] = it.size;
        push(rep.prims, name, name === 'BoxInstances' ? boxCorners(w, h, d) : boxCorners(w, h, 0), child, spun);
      }
      return;
    }

    if (typeof t !== 'function') {
      bump(rep.unhandled, name);
      return;
    }

    // Anything else: call it. A hook inside throws, and that is REPORTED.
    try {
      const out = (t as (p: AnyProps) => ReactNode)(props);
      visit(out, m, spun);
    } catch (err) {
      rep.threw[name] = err instanceof Error ? err.message : String(err);
    }
  };

  visit(node, new Matrix4());
  for (const p of rep.prims) if (convexHull(p.pts).length < 3) rep.degenerate++;
  return rep;
}

/** The walk's answer as a floor rectangle: the axis-aligned bounds of everything
 *  drawn, in the part's own local frame, metres. */
export function horizontalBounds(prims: Prim[], keep?: (p: Prim) => boolean) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const p of prims) {
    if (keep && !keep(p)) continue;
    for (const [x, z] of p.pts) {
      x0 = Math.min(x0, x); x1 = Math.max(x1, x);
      z0 = Math.min(z0, z); z1 = Math.max(z1, z);
    }
  }
  return { x0, x1, z0, z1 };
}

/** Monotone-chain hull. Every primitive this file emits projects to a CONVEX set
 *  (box, cylinder, cone, sphere, disc, plane), so the hull is the exact projection
 *  rather than an approximation of it — the one exception, `torusGeometry`, is
 *  emitted as its outer disc and says so at the point it is built. */
export function convexHull(pts: Array<[number, number]>): Array<[number, number]> {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o: number[], a: number[], b: number[]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (src: Array<[number, number]>) => {
    const h: Array<[number, number]> = [];
    for (const q of src) {
      while (h.length >= 2 && cross(h[h.length - 2], h[h.length - 1], q) <= 0) h.pop();
      h.push(q);
    }
    h.pop();
    return h;
  };
  return [...half(p), ...half([...p].reverse())];
}

function inHull(x: number, z: number, h: Array<[number, number]>): boolean {
  if (h.length < 3) return false;
  for (let i = 0; i < h.length; i++) {
    const a = h[i];
    const b = h[(i + 1) % h.length];
    if ((b[0] - a[0]) * (z - a[1]) - (b[1] - a[1]) * (x - a[0]) < -1e-12) return false;
  }
  return true;
}

/** Floor area the geometry actually covers, by rasterising the union of the
 *  primitives' hulls. Sampling, so the STEP is part of the answer and every caller
 *  that quotes an area must quote it too. */
export function unionArea(
  prims: Prim[],
  box: { x0: number; x1: number; z0: number; z1: number },
  step: number,
): number {
  const hulls = prims.map((p) => convexHull(p.pts)).filter((h) => h.length >= 3);
  let cells = 0;
  let total = 0;
  for (let x = box.x0 + step / 2; x < box.x1; x += step) {
    for (let z = box.z0 + step / 2; z < box.z1; z += step) {
      total++;
      if (hulls.some((h) => inHull(x, z, h))) cells++;
    }
  }
  return total === 0 ? 0 : cells * step * step;
}

/** True when two convex polygons overlap, `pad` inflating BOTH (negative shrinks).
 *  Separating-axis, the same test `lib/geometry.ts` runs over a piece's one box —
 *  so a caller can swap the footprint and change nothing else. */
export function hullsOverlap(a: Array<[number, number]>, b: Array<[number, number]>, pad = 0): boolean {
  if (a.length < 3 || b.length < 3) return false;
  // The pad is applied as the DEPTH the overlap must reach on every separating axis,
  // not as a shrink of each polygon toward its centroid. `lib/geometry.ts` pads by
  // `inflate`, which moves each EDGE — on the polygon's own axes that costs exactly
  // `pad/2` per side, so the two together cost `pad`.
  //
  // Written as a radial shrink first, and it is wrong in a way that only shows on a
  // long thin piece: pulling the corners of a 1000 x 110 soundbar toward its centre
  // moves them almost entirely along the LONG axis, so the 110 mm depth barely
  // narrows. It reported 62 collisions the production test did not, and the row read
  // as a finding about the app until the cross-check below refused it.
  let minOverlap = Infinity;
  const scan = (poly: Array<[number, number]>) => {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i];
      const q = poly[(i + 1) % poly.length];
      let nx = -(q[1] - p[1]);
      let nz = q[0] - p[0];
      const len = Math.hypot(nx, nz);
      if (len < 1e-12) continue;
      nx /= len;
      nz /= len;
      let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
      for (const [x, z] of a) { const d = x * nx + z * nz; a0 = Math.min(a0, d); a1 = Math.max(a1, d); }
      for (const [x, z] of b) { const d = x * nx + z * nz; b0 = Math.min(b0, d); b1 = Math.max(b1, d); }
      minOverlap = Math.min(minOverlap, Math.min(a1, b1) - Math.max(a0, b0));
      if (minOverlap <= -pad) return true; // separated by more than the pad allows
    }
    return false;
  };
  if (scan(a) || scan(b)) return false;
  return minOverlap > -pad;
}

/** Is the point inside this convex polygon? */
export function pointInHull(x: number, z: number, h: Array<[number, number]>): boolean {
  return inHull(x, z, h);
}

/** A part's drawn primitives placed in the ROOM: local XZ rotated by `rot` about the
 *  part origin and translated to `pos`, matching what `Draggable` assigns to
 *  `rotation.y`. Returns one convex hull per primitive, with its world y-range. */
export function worldHulls(
  prims: Prim[],
  pos: [number, number, number],
  rot: number,
): Array<{ hull: Array<[number, number]>; y: [number, number] }> {
  const c = Math.cos(rot), s = Math.sin(rot);
  const out: Array<{ hull: Array<[number, number]>; y: [number, number] }> = [];
  for (const p of prims) {
    if (p.spun) {
      // `Spin` turns the group about Y, so this primitive occupies the DISC it sweeps
      // about the part's own axis — a 32-gon, inscribed the way `footFromPart`
      // polygonises a round piece so a round thing is never reported hitting what it
      // does not touch.
      const r = Math.max(...p.pts.map(([x, z]) => Math.hypot(x, z)));
      const disc: Array<[number, number]> = [];
      for (let i = 0; i < 32; i++) {
        const a = (i / 32) * Math.PI * 2;
        disc.push([pos[0] + Math.cos(a) * r, pos[2] + Math.sin(a) * r]);
      }
      out.push({ hull: disc, y: [pos[1] + p.y[0], pos[1] + p.y[1]] });
      continue;
    }
    const hull = convexHull(p.pts.map(([x, z]) => [pos[0] + x * c + z * s, pos[2] - x * s + z * c] as [number, number]));
    if (hull.length >= 3) out.push({ hull, y: [pos[1] + p.y[0], pos[1] + p.y[1]] });
  }
  return out;
}

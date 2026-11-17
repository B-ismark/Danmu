// Procedural surface textures — computed in code, zero binary assets, no network.
// Fits the offline / browser-only architecture.
//
// ── What each material carries, and why ───────────────────────────────────────
//
// Every surface gets three maps, all GREYSCALE:
//
//   · `normalMap`    — microrelief: grain pores, weave, board bevels, plaster stipple.
//   · `map`          — TONE. A near-white multiply over the material's `color`.
//   · `roughnessMap` — where the sheen breaks up, multiplied into `roughness`.
//
// The tone map is the part that was missing, and its absence is why the first kit
// did not work. It shipped normal maps only, to keep the user's recolour intact,
// and measured on a lit 1 m swatch at the studio's own viewing scale (≈300 px/m)
// they changed the picture by **0.6 grey levels in 255 on wood and fabric, 0.3 on
// the floor** — under soft image-based light a bump only reads where a light
// rakes across it, and almost nothing in a room does. Real wood reads as wood
// because latewood is darker than earlywood; a floor reads as boards because no two
// boards are the same shade. That is albedo, and there is no relief strong enough
// to stand in for it.
//
// The recolour survives because the tone map is GREY and multiplies: every texel is
// the user's colour at 100% down to (for the darkest grain line) about 60%, with
// the hue untouched. The maps are authored in linear (`NoColorSpace`) so "0.9"
// means 90% of the chosen colour, not 90% of an sRGB-decoded one.
//
// ── Scale is metres ───────────────────────────────────────────────────────────
//
// Each set has a `tileM`: how many metres one repeat of the texture covers, and the
// texture's `repeat` is `1 / tileM`. That only means something on geometry whose UVs
// are in metres — the floor and walls are (`ShapeGeometry` takes UVs from the shape's
// own coordinates), `Box` rewrites its UVs to be (`lib/surface-uv.ts`), and cloth is
// laid out by arc length (`lib/soft-goods.ts`). Without that a drawer front and a
// wardrobe door each showed the same number of grain lines, so the bigger the piece
// the coarser its wood.
//
// ── Shape of the module ───────────────────────────────────────────────────────
//
// The fields are pure functions of a seed (`*Fields`, plain `Float32Array`s, no DOM,
// no three) so a test can hold them to their promises; the three-facing half wraps
// them in `DataTexture`s, memoised so each set is generated and uploaded once and
// shared by every material that uses it. Deterministic, so a room looks the same on
// every open — a floor whose boards reshuffle on reload is not a floor.

import { DataTexture, LinearMipmapLinearFilter, NoColorSpace, RepeatWrapping, RGBAFormat, UnsignedByteType, type Texture } from 'three';

// ─── Pure fields ─────────────────────────────────────────────────────────────

/** A square scalar field, row-major, row 0 at v = 0. Values nominally 0..1. */
export type Field = { readonly size: number; readonly data: Float32Array };

/** Height (relief), tone (albedo multiplier) and roughness multiplier for one surface. */
export type SurfaceFields = {
  readonly height: Field;
  readonly tone: Field;
  readonly rough: Field;
  /** Metres covered by one repeat. */
  readonly tileM: number;
  /** Relief strength handed to `normalBytes`, in height units per texel. */
  readonly bump: number;
};

/** mulberry32 — small, fast, deterministic. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A periodic lattice of random values, `pu` × `pv` cells. Periodic so the texture tiles. */
type Lattice = { pu: number; pv: number; v: Float32Array };
function lattice(pu: number, pv: number, seed: number): Lattice {
  const r = rng(seed);
  const v = new Float32Array(pu * pv);
  for (let i = 0; i < v.length; i++) v[i] = r();
  return { pu, pv, v };
}

const fade = (t: number) => t * t * (3 - 2 * t);

/** Value noise at tile coordinates (u, v) ∈ [0, 1), wrapping at the tile edge. */
function noise(L: Lattice, u: number, v: number): number {
  const x = u * L.pu;
  const y = v * L.pv;
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = fade(x - xi);
  const fy = fade(y - yi);
  const x0 = ((xi % L.pu) + L.pu) % L.pu;
  const y0 = ((yi % L.pv) + L.pv) % L.pv;
  const x1 = (x0 + 1) % L.pu;
  const y1 = (y0 + 1) % L.pv;
  const a = L.v[y0 * L.pu + x0];
  const b = L.v[y0 * L.pu + x1];
  const c = L.v[y1 * L.pu + x0];
  const d = L.v[y1 * L.pu + x1];
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/** Fractal noise: `octaves` lattices, each twice as fine and half as strong. 0..1. */
function fbm(pu: number, pv: number, octaves: number, seed: number): (u: number, v: number) => number {
  const ls: Lattice[] = [];
  for (let o = 0; o < octaves; o++) ls.push(lattice(pu << o, pv << o, seed + o * 7919));
  let norm = 0;
  for (let o = 0; o < octaves; o++) norm += 1 / (1 << o);
  return (u, v) => {
    let s = 0;
    for (let o = 0; o < octaves; o++) s += noise(ls[o], u, v) / (1 << o);
    return s / norm;
  };
}

const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);
const smoothstep = (a: number, b: number, t: number) => fade(clamp01((t - a) / (b - a)));
const frac = (t: number) => t - Math.floor(t);

function fields(size: number, at: (u: number, v: number, i: number) => [number, number, number]) {
  const height = new Float32Array(size * size);
  const tone = new Float32Array(size * size);
  const rough = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    const v = (y + 0.5) / size;
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size;
      const i = y * size + x;
      const [h, t, r] = at(u, v, i);
      height[i] = h;
      tone[i] = t;
      rough[i] = r;
    }
  }
  return { height: { size, data: height }, tone: { size, data: tone }, rough: { size, data: rough } };
}

/** Flat-sawn wood: grain running along V, so a door's grain is vertical and (with
 *  `lib/surface-uv.ts`'s top-face mapping) a tabletop's runs along its width. Rings
 *  sharpen into dark latewood lines, wander with a slow warp, and carry long pore
 *  streaks. `rings` is the line count across one tile. */
function grain(seed: number, rings: number) {
  const warp = fbm(3, 2, 3, seed);
  const wobble = fbm(8, 3, 2, seed + 11);
  const streak = fbm(96, 4, 2, seed + 23);
  const pore = fbm(256, 24, 1, seed + 37);
  const broad = fbm(2, 2, 2, seed + 41);
  return (u: number, v: number) => {
    const ring = frac(u * rings + (warp(u, v) - 0.5) * 5 + (wobble(u, v) - 0.5) * 0.8);
    // Earlywood ramps darker into a short latewood band, then snaps back light.
    const late = smoothstep(0.62, 0.93, ring) * (1 - smoothstep(0.93, 1, ring));
    const s = streak(u, v);
    const p = smoothstep(0.62, 0.8, pore(u, v));
    return { late, s, p, broad: broad(u, v) };
  };
}

export function woodFields(size = 512, seed = 1): SurfaceFields {
  const g = grain(seed, 18);
  const f = fields(size, (u, v) => {
    const { late, s, p, broad } = g(u, v);
    const tone = 1 - 0.24 * late - 0.08 * s - 0.08 * p - 0.05 * broad;
    const height = 0.6 - 0.25 * late + 0.2 * s - 0.45 * p;
    const rough = 0.92 - 0.1 * late + 0.08 * p;
    return [height, tone, rough];
  });
  return { ...f, tileM: 0.5, bump: 5 };
}

/** Upholstery: a plain weave of slubbed threads with a heathered, uneven dye. The
 *  heather is the part that reads at room distance — a single thread is under a
 *  pixel at 3 m, but the mottle across a seat cushion is not. */
export function fabricFields(size = 256, seed = 2): SurfaceFields {
  const T = 24; // threads per tile, each way — ~7.5 mm, a textured weave rather than a sateen
  const slubU = fbm(T, 6, 2, seed);
  const slubV = fbm(6, T, 2, seed + 5);
  const heather = fbm(8, 8, 3, seed + 9);
  const fuzz = fbm(128, 128, 1, seed + 13);
  const dye = lattice(T, 1, seed + 17);
  const dyeW = lattice(1, T, seed + 19);
  const f = fields(size, (u, v) => {
    const tu = u * T;
    const tv = v * T;
    const i = Math.floor(tu);
    const j = Math.floor(tv);
    const fu = tu - i;
    const fv = tv - j;
    const warpUp = (i + j) % 2 === 0;
    const warp = Math.sin(Math.PI * fu) * (0.75 + 0.5 * (slubV(u, v) - 0.5));
    const weft = Math.sin(Math.PI * fv) * (0.75 + 0.5 * (slubU(u, v) - 0.5));
    // The thread on top at this crossing, arched over the one beneath.
    const h = warpUp ? warp * (0.55 + 0.45 * Math.sin(Math.PI * fv)) : weft * (0.55 + 0.45 * Math.sin(Math.PI * fu));
    const threadDye = warpUp ? dye.v[i % T] : dyeW.v[j % T];
    const tone = 1 - 0.16 * (heather(u, v) - 0.3) - 0.14 * threadDye - 0.16 * (1 - h) - 0.05 * fuzz(u, v);
    return [0.25 + 0.6 * h + 0.15 * fuzz(u, v), Math.min(1, tone), 0.94 + 0.06 * fuzz(u, v)];
  });
  return { ...f, tileM: 0.18, bump: 2.6 };
}

/** Floorboards: 200 mm boards running along U, staggered end joints, each board its
 *  own shade and its own grain, with an eased-edge groove between them. Tile 2.4 m
 *  so a board's length (1.2 or 2.4 m) does not repeat every pace. */
export function floorFields(size = 512, seed = 3): SurfaceFields {
  const ROWS = 12;
  const r = rng(seed);
  // Per row: one or two end joints, at offsets mod 1 so the tile still wraps.
  const joints: number[][] = [];
  for (let j = 0; j < ROWS; j++) {
    const a = r();
    joints.push(r() < 0.5 ? [a] : [a, frac(a + 0.5)].sort((x, y) => x - y));
  }
  const g = grain(seed + 100, 26);
  const shadeOf = (row: number, board: number) => {
    const h = rng(seed * 977 + row * 131 + board * 17 + 1);
    h();
    return h();
  };
  const px = 1 / size;
  const f = fields(size, (u, v) => {
    const rowF = v * ROWS;
    const row = Math.floor(rowF);
    const inRow = rowF - row; // 0..1 across the board's width
    const js = joints[row];
    let board = 0;
    for (const jt of js) if (u >= jt) board++;
    if (board === js.length) board = 0; // the wrap: past the last joint is the first board
    // Distance to the nearest joint and to the nearest long edge, in texels.
    let dj = Infinity;
    for (const jt of js) {
      const d = Math.abs(u - jt);
      dj = Math.min(dj, d, 1 - d);
    }
    const dEdge = Math.min(inRow, 1 - inRow) / ROWS;
    const d = Math.min(dj, dEdge) / px;
    const groove = 1 - smoothstep(0.3, 1.4, d); // a ~5 mm eased edge at 4.7 mm per texel
    const shade = shadeOf(row, board);
    // Each board's grain sampled from its own patch, so grain does not run on across a seam.
    const gv = g(frac(inRow * 0.16 + shade * 3.7), frac(u + shade * 0.61));
    const tone = (0.9 + 0.1 * shade) * (1 - 0.13 * gv.late - 0.05 * gv.s - 0.05 * gv.p) * (1 - 0.3 * groove);
    const height = (0.62 - 0.1 * gv.late + 0.08 * gv.s - 0.2 * gv.p) * (1 - 0.8 * groove);
    const rough = 0.82 + 0.1 * shade - 0.06 * gv.late + 0.08 * gv.p + 0.1 * groove;
    return [height, tone, Math.min(1, rough)];
  });
  return { ...f, tileM: 2.4, bump: 3 };
}

/** Painted plaster: a roller's orange-peel stipple over a faint, broad unevenness in
 *  the coat. Kept quiet on purpose — a wall is the backdrop, and the eye should find
 *  it a surface rather than a pattern. */
export function plasterFields(size = 512, seed = 4): SurfaceFields {
  const mottle = fbm(3, 3, 4, seed);
  const peel = fbm(96, 96, 2, seed + 3);
  const trowel = fbm(12, 12, 2, seed + 7);
  const f = fields(size, (u, v) => {
    const p = peel(u, v);
    const tone = 1 - 0.09 * mottle(u, v) - 0.035 * p;
    const height = 0.55 * p + 0.45 * trowel(u, v);
    return [height, tone, 0.9 + 0.1 * p];
  });
  return { ...f, tileM: 1, bump: 1.6 };
}

/** Brushed metal: long fine scratches along U, and a sheen that breaks up along them. */
export function metalFields(size = 256, seed = 5): SurfaceFields {
  const fine = fbm(3, 160, 2, seed);
  const coarse = fbm(2, 40, 2, seed + 3);
  const f = fields(size, (u, v) => {
    const s = 0.6 * fine(u, v) + 0.4 * coarse(u, v);
    return [s, 1 - 0.1 * s, 0.75 + 0.35 * s];
  });
  return { ...f, tileM: 0.25, bump: 2.5 };
}

// ─── Fields → texel bytes ────────────────────────────────────────────────────

/** Tangent-space normal map from a height field (central differences, wrapping), in
 *  three's OpenGL convention: +G is +V, which is row index here. */
export function normalBytes(h: Field, bump: number): Uint8Array {
  const s = h.size;
  const d = h.data;
  const out = new Uint8Array(s * s * 4);
  const at = (x: number, y: number) => d[((y + s) % s) * s + ((x + s) % s)];
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const nx = -(at(x + 1, y) - at(x - 1, y)) * 0.5 * bump;
      const ny = -(at(x, y + 1) - at(x, y - 1)) * 0.5 * bump;
      const len = Math.hypot(nx, ny, 1);
      const i = (y * s + x) * 4;
      out[i] = Math.round((nx / len * 0.5 + 0.5) * 255);
      out[i + 1] = Math.round((ny / len * 0.5 + 0.5) * 255);
      out[i + 2] = Math.round((1 / len * 0.5 + 0.5) * 255);
      out[i + 3] = 255;
    }
  }
  return out;
}

/** A greyscale field as RGBA bytes, clamped to 0..1. */
export function grayBytes(f: Field): Uint8Array {
  const out = new Uint8Array(f.data.length * 4);
  for (let i = 0; i < f.data.length; i++) {
    const b = Math.round(clamp01(f.data[i]) * 255);
    out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = b;
    out[i * 4 + 3] = 255;
  }
  return out;
}

// ─── three ───────────────────────────────────────────────────────────────────

/** The three maps a material spreads, plus nothing else — so a preset can spread it. */
export type SurfaceMaps = { map: Texture; normalMap: Texture; roughnessMap: Texture };

function texture(bytes: Uint8Array, size: number, tileM: number): Texture {
  const t = new DataTexture(bytes, size, size, RGBAFormat, UnsignedByteType);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.colorSpace = NoColorSpace;
  t.generateMipmaps = true;
  t.minFilter = LinearMipmapLinearFilter;
  // Floors and walls are seen at a grazing angle more than anything else in the
  // room; without this their texture smears to a flat colour a metre from the lens.
  // three clamps it to what the device supports.
  t.anisotropy = 8;
  t.repeat.set(1 / tileM, 1 / tileM);
  t.needsUpdate = true;
  return t;
}

function maps(f: SurfaceFields): SurfaceMaps {
  return {
    map: texture(grayBytes(f.tone), f.tone.size, f.tileM),
    normalMap: texture(normalBytes(f.height, f.bump), f.height.size, f.tileM),
    roughnessMap: texture(grayBytes(f.rough), f.rough.size, f.tileM),
  };
}

function memo(make: () => SurfaceFields): () => SurfaceMaps {
  let m: SurfaceMaps | null = null;
  return () => (m ??= maps(make()));
}

export const woodMaps = memo(() => woodFields());
export const fabricMaps = memo(() => fabricFields());
export const floorMaps = memo(() => floorFields());
export const plasterMaps = memo(() => plasterFields());
export const metalMaps = memo(() => metalFields());

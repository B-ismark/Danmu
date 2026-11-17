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

import type { FloorKind, Grout } from './floor-finish';
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

/** Floorboards running along U, staggered end joints, each board its own shade and
 *  its own grain, with an eased-edge groove between them. The tile is a whole number
 *  of boards close to 2.4 m, so a board's length (half or all of the tile) does not
 *  repeat every pace; at 200 mm that is exactly twelve. */
export function plankFields(boardMM = 200, size = 512, seed = 3): SurfaceFields {
  const ROWS = Math.max(4, Math.round(2400 / boardMM));
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
  return { ...f, tileM: (ROWS * boardMM) / 1000, bump: 3 };
}

/** The floor the app always had: 200 mm planks. */
export function floorFields(size = 512, seed = 3): SurfaceFields {
  return plankFields(200, size, seed);
}

/** Which herringbone block a point is on. Pattern space is in block widths, blocks
 *  `n` long: a horizontal block at offset o covers [ox, ox+n) × [oy, oy+1) and its
 *  vertical partner [ox, ox+1) × [oy+1, oy+n+1), and the pair repeats along
 *  t1 = (1, 1) and t2 = (n, −n) — the staircase and the next staircase over. That
 *  covers the plane exactly once (checked in `tests/floor-finish.test.ts`), and the
 *  candidate ranges below are the only (A, B) whose blocks can reach the point. */
export function herringboneBlock(px: number, py: number, n: number) {
  const a = (px + py) / 2;
  const b = (px - py) / (2 * n);
  const a0 = Math.floor(a);
  const b0 = Math.floor(b);
  for (let B = b0 - 1; B <= b0 + 1; B++) {
    for (let A = a0 - Math.ceil((n + 2) / 2) - 1; A <= a0 + 1; A++) {
      const ox = A + B * n;
      const oy = A - B * n;
      const dx = px - ox;
      const dy = py - oy;
      if (dx >= 0 && dx < n && dy >= 0 && dy < 1) return { A, B, vertical: false, along: dx, across: dy };
      if (dx >= 0 && dx < 1 && dy >= 1 && dy < n + 1) return { A, B, vertical: true, along: dy - 1, across: dx };
    }
  }
  return null;
}

/** Herringbone parquet: blocks five times as long as wide, the zigzag running along
 *  V. The pattern is turned 45° so both of its repeats land on the texture's axes,
 *  which is what lets a square tile wrap: one tile is `m` staircases across and
 *  `m·n` blocks up. Each block takes its own shade and its grain runs along it. */
export function herringboneFields(blockMM = 90, size = 512, seed = 6): SurfaceFields {
  const n = 5;
  const repeatM = (n * Math.SQRT2 * blockMM) / 1000;
  const m = Math.max(2, Math.round(1.2 / repeatM));
  const P = m * n * Math.SQRT2; // tile side, in block widths
  const texelsPerBlock = size / P;
  const g = grain(seed + 100, 26);
  const f = fields(size, (u, v) => {
    const X = u * P;
    const Y = v * P;
    const blk = herringboneBlock((X + Y) / Math.SQRT2, (Y - X) / Math.SQRT2, n)!;
    const key = ((((blk.A % (m * n)) + m * n) % (m * n)) * 31 + (((blk.B % m) + m) % m)) * 2 + (blk.vertical ? 1 : 0);
    const h = rng(seed * 977 + key * 13 + 1);
    h();
    const shade = h();
    const d = Math.min(blk.across, 1 - blk.across, blk.along, n - blk.along) * texelsPerBlock;
    const groove = 1 - smoothstep(0.3, 1.4, d);
    const gv = g(frac(blk.across * 0.08 + shade * 3.7), frac((blk.along / n) * 0.3 + shade * 0.61));
    const tone = (0.88 + 0.12 * shade) * (1 - 0.13 * gv.late - 0.05 * gv.s - 0.05 * gv.p) * (1 - 0.3 * groove);
    const height = (0.62 - 0.1 * gv.late + 0.08 * gv.s - 0.2 * gv.p) * (1 - 0.8 * groove);
    const rough = 0.82 + 0.1 * shade - 0.06 * gv.late + 0.08 * gv.p + 0.1 * groove;
    return [height, tone, Math.min(1, rough)];
  });
  return { ...f, tileM: (P * blockMM) / 1000, bump: 3 };
}

/** A square grid of `perTile` cells across one texture tile: which cell a point is
 *  in, where in it (0..1), and how far it is from the nearest joint, as a fraction
 *  of the cell. */
function cellOf(u: number, v: number, perTile: number) {
  const x = u * perTile;
  const y = v * perTile;
  const i = Math.floor(x);
  const j = Math.floor(y);
  const fx = x - i;
  const fy = y - j;
  return { i, j, fx, fy, edge: Math.min(fx, 1 - fx, fy, 1 - fy) };
}

/** How many tiles to draw per texture: enough that the per-tile variation does not
 *  visibly repeat, at least two, about `targetM` across. */
function tilesPerRepeat(tileMM: number, targetM: number): number {
  return Math.max(2, Math.round((targetM * 1000) / tileMM));
}

/** Tile and stone draw at 1024 texels where everything else draws at 512: a joint is
 *  2–3 mm and a 1.2–1.8 m repeat at 512 is 2.3–3.5 mm a texel, so the grid that IS
 *  the look of a tiled floor came out as a faint smear on exactly the large formats
 *  people choose for it (a contrasting joint on 900 mm tile measured 0.76 of its tile's
 *  tone, against 0.5 asked for). Four times the texels, generated once and cached.
 *
 *  Grout tone multiplier. Matching grout is a shade under its tile, as real matched
 *  grout is; contrasting grout is dark — never pale, because this multiplies. */
const GROUT_TONE = { match: 0.86, dark: 0.5 } as const;

/** Glazed ceramic tile: flat glaze with a faint wave, a softened edge where the glaze
 *  rolls into the joint, each tile a touch off its neighbours (a kiln batch is never
 *  one colour), and a recessed, rougher grout line. Grout is 2 mm on a mosaic and
 *  3 mm otherwise. The glaze is glossy and the grout matte: the roughness map is the
 *  difference, against a material roughness set at the grout's. */
export function tileFields(tileMM = 300, grout: 'match' | 'dark' = 'match', size = 1024, seed = 7): SurfaceFields {
  const N = tilesPerRepeat(tileMM, 1.2);
  const tileM = (N * tileMM) / 1000;
  const groutMM = tileMM <= 100 ? 2 : 3;
  const mmPerTexel = (tileM * 1000) / size;
  const wave = fbm(N, N, 2, seed);
  const speck = fbm(128, 128, 1, seed + 5);
  const f = fields(size, (u, v) => {
    const c = cellOf(u, v, N);
    const edgeMM = c.edge * tileMM;
    const h = rng(seed * 977 + (c.i % N) * 131 + (c.j % N) * 17 + 1);
    h();
    const shade = h();
    // Joint: half the grout either side of the line, eased over one texel.
    const inGrout = 1 - smoothstep(groutMM / 2 - mmPerTexel * 0.5, groutMM / 2 + mmPerTexel * 0.5, edgeMM);
    // The glaze rolls off over the last ~4 mm.
    const roll = 1 - smoothstep(groutMM / 2, groutMM / 2 + 4, edgeMM);
    const glazeTone = (0.95 + 0.05 * shade) * (1 - 0.03 * speck(u, v));
    const tone = glazeTone * (1 - inGrout) + GROUT_TONE[grout] * inGrout;
    const height = (0.75 + 0.1 * wave(u, v)) * (1 - 0.35 * roll) * (1 - inGrout) + 0.15 * inGrout;
    const rough = 0.32 + 0.06 * speck(u, v) + 0.68 * inGrout;
    return [height, Math.min(1, tone), Math.min(1, rough)];
  });
  return { ...f, tileM, bump: 4 };
}

/** Honed stone slabs: each slab cut from a different part of the block, so its veins
 *  do not run on across a joint; a slow cloud under the veins; tight 3 mm joints. */
export function stoneFields(slabMM = 600, grout: 'match' | 'dark' = 'match', size = 1024, seed = 8): SurfaceFields {
  const N = tilesPerRepeat(slabMM, 1.6);
  const tileM = (N * slabMM) / 1000;
  const groutMM = 3;
  const mmPerTexel = (tileM * 1000) / size;
  const warp = fbm(3, 3, 3, seed);
  const warp2 = fbm(5, 5, 2, seed + 13);
  const cloud = fbm(4, 4, 3, seed + 3);
  const mask = fbm(2, 2, 2, seed + 17);
  const grainy = fbm(160, 160, 1, seed + 9);
  const f = fields(size, (u, v) => {
    const c = cellOf(u, v, N);
    const edgeMM = c.edge * slabMM;
    const h = rng(seed * 977 + (c.i % N) * 131 + (c.j % N) * 17 + 1);
    h();
    const ou = h();
    const ov = h();
    const shade = h();
    // Sample this slab's own patch of the block. A patch is a third of the field, so
    // slabs differ; the field is periodic, so any patch is seamless inside the slab.
    const su = frac(ou + c.fx / 3);
    const sv = frac(ov + c.fy / 3);
    // Marble veins: a few long, thin lines flowing one way across the slab, coming and
    // going under a slow mask, with a finer, fainter family crossing them. Integer
    // frequencies, so the field stays periodic and any patch of it is seamless.
    const main = Math.abs(Math.sin(2 * Math.PI * (su + sv + 1.4 * warp(su, sv))));
    const fineV = Math.abs(Math.sin(2 * Math.PI * (3 * su - 2 * sv + 2 * warp2(su, sv))));
    const m = smoothstep(0.35, 0.65, mask(su, sv));
    const veinLine = (1 - smoothstep(0, 0.045, main)) * (0.35 + 0.65 * m) + 0.4 * (1 - smoothstep(0, 0.025, fineV)) * m;
    const inGrout = 1 - smoothstep(groutMM / 2 - mmPerTexel * 0.5, groutMM / 2 + mmPerTexel * 0.5, edgeMM);
    const slabTone = (0.94 + 0.06 * shade) * (1 - 0.2 * Math.min(1, veinLine) - 0.08 * cloud(su, sv) - 0.02 * grainy(u, v));
    const tone = slabTone * (1 - inGrout) + GROUT_TONE[grout] * inGrout;
    const height = (0.7 + 0.05 * grainy(u, v) - 0.05 * veinLine) * (1 - inGrout) + 0.2 * inGrout;
    const rough = 0.5 + 0.08 * grainy(u, v) + 0.06 * veinLine + 0.5 * inGrout;
    return [height, Math.min(1, tone), Math.min(1, rough)];
  });
  return { ...f, tileM, bump: 3 };
}

/** Polished concrete / microcement: a slow cloud from the pour, faint trowel sweeps,
 *  and pinholes. No joints at all, which is the look. */
export function concreteFields(size = 512, seed = 9): SurfaceFields {
  const cloud = fbm(3, 3, 5, seed);
  const sweep = fbm(6, 20, 2, seed + 3);
  const fine = fbm(128, 128, 2, seed + 5);
  const pin = fbm(256, 256, 1, seed + 7);
  const f = fields(size, (u, v) => {
    const p = smoothstep(0.86, 0.95, pin(u, v));
    const tone = 1 - 0.14 * cloud(u, v) - 0.04 * sweep(u, v) - 0.03 * fine(u, v) - 0.15 * p;
    const height = 0.6 + 0.15 * sweep(u, v) + 0.1 * fine(u, v) - 0.4 * p;
    const rough = 0.7 + 0.15 * cloud(u, v) + 0.15 * p;
    return [height, tone, Math.min(1, rough)];
  });
  return { ...f, tileM: 2, bump: 2 };
}

/** Loop-pile carpet: tight loops (about 3 mm) clumped into tufts, with a heathered
 *  yarn. Relief does most of the work — carpet is the one floor read by its pile. */
export function carpetFields(size = 512, seed = 10): SurfaceFields {
  const loops = fbm(128, 128, 1, seed);
  const tufts = fbm(32, 32, 2, seed + 3);
  const heather = fbm(8, 8, 3, seed + 5);
  const f = fields(size, (u, v) => {
    const l = loops(u, v);
    const t = tufts(u, v);
    const pile = 0.6 * l + 0.4 * t;
    // Heathered yarn and a broader shading of the pile, so a carpet reads as fibre
    // from across the room where the loops themselves are smaller than a pixel.
    const tone = 1 - 0.14 * (1 - pile) - 0.1 * heather(u, v) - 0.05 * t;
    return [pile, tone, 0.95 + 0.05 * l];
  });
  return { ...f, tileM: 0.4, bump: 3 };
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
export const plasterMaps = memo(() => plasterFields());
export const metalMaps = memo(() => metalFields());

/** The fields for a floor finish. Colour is not among the inputs: it is the
 *  material's `color`, multiplied by these, so a recolour regenerates nothing. */
export function floorFinishFields(kind: FloorKind, sizeMM: number | null, grout: Grout): SurfaceFields {
  switch (kind) {
    case 'planks': return plankFields(sizeMM ?? 200);
    case 'herringbone': return herringboneFields(sizeMM ?? 90);
    case 'tile': return tileFields(sizeMM ?? 300, grout);
    case 'stone': return stoneFields(sizeMM ?? 600, grout);
    case 'concrete': return concreteFields();
    case 'carpet': return carpetFields();
  }
}

/** Floor maps, kept for the last few finishes so switching back and forth while
 *  choosing is instant. A floor is one material per room, so a handful is plenty;
 *  the oldest is disposed (its GPU copy freed) when a new one pushes it out. */
const FLOOR_CACHE_SIZE = 4;
const floorCache = new Map<string, SurfaceMaps>();
export function floorFinishMaps(kind: FloorKind, sizeMM: number | null, grout: Grout): SurfaceMaps {
  const key = `${kind}:${sizeMM ?? ''}:${grout}`;
  const hit = floorCache.get(key);
  if (hit) {
    floorCache.delete(key);
    floorCache.set(key, hit);
    return hit;
  }
  const made = maps(floorFinishFields(kind, sizeMM, grout));
  floorCache.set(key, made);
  while (floorCache.size > FLOOR_CACHE_SIZE) {
    const [oldest, m] = floorCache.entries().next().value as [string, SurfaceMaps];
    floorCache.delete(oldest);
    m.map.dispose();
    m.normalMap.dispose();
    m.roughnessMap.dispose();
  }
  return made;
}

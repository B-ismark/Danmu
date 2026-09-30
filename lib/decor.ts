// Set-dressing on a surface: what each prop IS, and where on the surface it may go.
//
// Two reports led here. Props on one surface overlapped each other and the pieces
// standing there too: a bedside lamp went through the plant beside it. And the
// arrangement could not have known better, because nothing knew how big a prop was.
// Its size was drawn by the renderer (`components/three/Dressing.tsx`) from a seeded
// random stream while the positions came from `autoSurfaceDecor` with no size at all.
// That is CLAUDE.md rule 2's corollary about a renderer with its own idea of a size,
// met again one layer down. So the size is drawn HERE (`decorSpec`) and the renderer
// draws whatever it is handed, which lets the layout (`arrangeDecor`) keep the
// props apart.
//
// **Pieces do not stand on props.** A lamp on a stack of books is a real thing, and
// it is not done here on purpose. The books would become structure: the lamp's height
// would hang off a prop that one press of "Clear" removes, and a rider's height is
// derived from its SUPPORT (`lib/rider-height.ts`), which a prop is not. So every prop
// steps aside, books included. A prop that finds no room is left off and reported
// (`DecorLayout.unplaced`), never squeezed in or shrunk.

import { footCells, footFromPart, footOverlap, worldToLocal, type Foot } from './geometry';
import { footCellsLocal } from './foot-cells';
import { verticalExtent } from './physics';
import { supportsDecor, type DecorItem, type ScenePart } from './scene-spec';

// ─── The seeded stream ────────────────────────────────────────────────────────
// Moved here from the renderer unchanged, so a prop already on someone's table draws
// exactly as it did.

function xmur3(str: string) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}
function mulberry32(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const seeded = (s: string) => mulberry32(xmur3(s)());

// ─── What a prop is ───────────────────────────────────────────────────────────

/** Metres. `tone` is a unit random in [0, 1) the renderer maps onto its palette, so
 *  the palette's length stays where the colours are (`lib/scene-palette.ts`). */
export type BookSpec = { w: number; d: number; h: number; dx: number; yaw: number; tone: number };
export type DecorSpec =
  | { kind: 'books'; books: BookSpec[] }
  | { kind: 'vase'; r: number; h: number; stems: boolean; tone: number }
  | { kind: 'plant'; w: number; h: number; tone: number }
  | { kind: 'bowl'; r: number; tone: number }
  | { kind: 'candle'; r: number; h: number; tone: number };

/** A tabletop plant's spread and height, metres. Small enough for a nightstand, and
 *  tall for its spread, so `plantForm` draws the leafy blend rather than a flat bush. */
export const DECOR_PLANT_W: readonly [number, number] = [0.16, 0.22];
export const DECOR_PLANT_H: readonly [number, number] = [0.24, 0.34];
export const CANDLE_R = 0.025;

/** The prop an item draws, from its id. Pure and seeded: the same item is the same
 *  prop in every tab, on every load, and in the layout that keeps it clear. */
export function decorSpec(item: DecorItem): DecorSpec {
  const rand = seeded(item.id);
  switch (item.kind) {
    case 'books': {
      const n = 2 + Math.floor(rand() * 2);
      const books: BookSpec[] = [];
      for (let i = 0; i < n; i++) {
        const w = 0.16 + rand() * 0.06;
        const d = 0.11 + rand() * 0.05;
        const h = 0.03 + rand() * 0.02;
        const dx = (rand() - 0.5) * 0.02;
        const yaw = rand() * 0.5;
        books.push({ w, d, h, dx, yaw, tone: rand() });
      }
      return { kind: 'books', books };
    }
    case 'vase': {
      const r = 0.04 + rand() * 0.025;
      const h = 0.14 + rand() * 0.12;
      const stems = rand() > 0.4;
      return { kind: 'vase', r, h, stems, tone: rand() };
    }
    case 'plant': {
      const w = DECOR_PLANT_W[0] + rand() * (DECOR_PLANT_W[1] - DECOR_PLANT_W[0]);
      const h = DECOR_PLANT_H[0] + rand() * (DECOR_PLANT_H[1] - DECOR_PLANT_H[0]);
      return { kind: 'plant', w, h, tone: rand() };
    }
    case 'bowl': {
      const r = 0.07 + rand() * 0.03;
      return { kind: 'bowl', r, tone: rand() };
    }
    case 'candle': {
      const h = 0.08 + rand() * 0.08;
      return { kind: 'candle', r: CANDLE_R, h, tone: rand() };
    }
  }
}

/** The radius of the smallest circle about the prop's centre that holds all of it, in
 *  plan. A circle because every prop but the books is one, and the books turn up to
 *  half a radian: their circle is the honest bound, not a box that turns with them. */
export function decorRadius(spec: DecorSpec): number {
  switch (spec.kind) {
    case 'books':
      return Math.max(...spec.books.map((b) => Math.abs(b.dx) + Math.hypot(b.w / 2, b.d / 2)));
    case 'vase':
    case 'bowl':
    case 'candle':
      return spec.r;
    case 'plant':
      return spec.w / 2;
  }
}

// ─── Where a prop may go ──────────────────────────────────────────────────────

/** Clear air between two props, or a prop and a piece. */
export const DECOR_GAP = 0.01;
/** How far above a surface a piece still counts as being in the props' way. The
 *  tallest prop is a vase with stems, ~0.34 m; a TV hung lower than this over a
 *  console would put a vase through its screen. */
export const DECOR_BAND = 0.35;
/** The search lattice, metres. A prop that has to move lands within half of this of
 *  the nearest free spot. */
export const DECOR_STEP = 0.02;

/** Something a prop must keep clear of, in the SURFACE's own frame. */
export type DecorBlocker = { cx: number; cz: number; hw: number; hd: number; rot: number };

export type DecorLayout = {
  /** The props that found room, at the spot they found. */
  placed: DecorItem[];
  /** The ids of the props that did not, in order. Said, never silently dropped. */
  unplaced: string[];
};

function clearOfBox(x: number, z: number, r: number, b: DecorBlocker): boolean {
  const [lx, lz] = worldToLocal(b.rot, x - b.cx, z - b.cz);
  const ox = Math.max(0, Math.abs(lx) - b.hw);
  const oz = Math.max(0, Math.abs(lz) - b.hd);
  return Math.hypot(ox, oz) >= r + DECOR_GAP;
}

/** The surface's own holes, as blockers: the L-shaped desk's open corner is not a
 *  tabletop, and a prop placed there stood on air. */
function surfaceHoles(part: Pick<ScenePart, 'shape'>, w: number, d: number): DecorBlocker[] {
  const cells = footCellsLocal(part.shape, w, d);
  if (!cells) return [];
  // The box less its cells. For the L that is one rectangle: the corner neither cell
  // reaches. Found from the cells rather than restated, so it moves when they do.
  const xs = [...new Set([-w / 2, w / 2, ...cells.flatMap((c) => [c.x0, c.x1])])].sort((a, b) => a - b);
  const zs = [...new Set([-d / 2, d / 2, ...cells.flatMap((c) => [c.z0, c.z1])])].sort((a, b) => a - b);
  const out: DecorBlocker[] = [];
  for (let i = 0; i + 1 < xs.length; i++) {
    for (let j = 0; j + 1 < zs.length; j++) {
      const mx = (xs[i] + xs[i + 1]) / 2;
      const mz = (zs[j] + zs[j + 1]) / 2;
      if (cells.some((c) => mx > c.x0 && mx < c.x1 && mz > c.z0 && mz < c.z1)) continue;
      out.push({ cx: mx, cz: mz, hw: (xs[i + 1] - xs[i]) / 2, hd: (zs[j + 1] - zs[j]) / 2, rot: 0 });
    }
  }
  return out;
}

/** Where each prop goes on a `w × d` surface (metres, the surface's own frame).
 *
 *  In order, each prop keeps its own spot if that spot is clear of the surface's edge,
 *  of every prop placed before it and of every blocker. Otherwise it takes the nearest
 *  clear spot on the lattice, and if there is none it is left off. Earlier props win,
 *  so adding one never moves the ones already there.
 *
 *  Its own spot is first CLAMPED onto the surface, which is a fix in its own right: the
 *  spots `autoSurfaceDecor` hands out reach a third of the width from the centre, and a
 *  stack of books 290 mm across on a 450 mm nightstand hung over its edge. */
export function arrangeDecor(
  items: DecorItem[],
  surface: Pick<ScenePart, 'shape'>,
  w: number,
  d: number,
  blockers: DecorBlocker[],
): DecorLayout {
  const walls = [...surfaceHoles(surface, w, d), ...blockers];
  const taken: Array<{ x: number; z: number; r: number }> = [];
  const placed: DecorItem[] = [];
  const unplaced: string[] = [];

  for (const it of items) {
    const r = decorRadius(decorSpec(it));
    // A prop wider than the surface sits centred on that axis and overhangs it: the
    // prop keeps its size, which is the rule for everything here.
    const bx = Math.max(0, w / 2 - r);
    const bz = Math.max(0, d / 2 - r);
    const free = (x: number, z: number) =>
      taken.every((q) => Math.hypot(x - q.x, z - q.z) >= r + q.r + DECOR_GAP) &&
      walls.every((b) => clearOfBox(x, z, r, b));

    const sx = Math.max(-bx, Math.min(bx, it.x));
    const sz = Math.max(-bz, Math.min(bz, it.z));
    let at: [number, number] | null = free(sx, sz) ? [sx, sz] : null;

    if (!at) {
      // Rings of the lattice outward from the spot. A hit on ring k can be beaten by
      // one as far out as ring ⌈k·√2⌉ (Chebyshev rings, Euclidean distance), so the
      // search runs that far before choosing.
      const reach = Math.ceil(Math.max(bx + Math.abs(sx), bz + Math.abs(sz)) / DECOR_STEP) + 1;
      let best = Infinity;
      let stopAt = reach;
      const visit = (i: number, j: number, k: number) => {
        const x = sx + i * DECOR_STEP;
        const z = sz + j * DECOR_STEP;
        if (Math.abs(x) > bx + 1e-9 || Math.abs(z) > bz + 1e-9) return;
        const dist = Math.hypot(x - sx, z - sz);
        if (dist >= best || !free(x, z)) return;
        best = dist;
        at = [x, z];
        stopAt = Math.min(stopAt, Math.ceil(k * Math.SQRT2));
      };
      for (let k = 1; k <= Math.min(reach, stopAt); k++) {
        // The ring's perimeter only: its top and bottom rows, then the sides between.
        for (let i = -k; i <= k; i++) {
          visit(i, -k, k);
          visit(i, k, k);
        }
        for (let j = -k + 1; j <= k - 1; j++) {
          visit(-k, j, k);
          visit(k, j, k);
        }
      }
    }

    if (!at) {
      unplaced.push(it.id);
      continue;
    }
    taken.push({ x: at[0], z: at[1], r });
    placed.push(at[0] === it.x && at[1] === it.z ? it : { ...it, x: at[0], z: at[1] });
  }
  return { placed, unplaced };
}

/** For every surface that carries props, the pieces in their way, in that surface's
 *  frame: anything whose height overlaps the band just above the top and whose
 *  footprint overlaps the surface's. `scene` is the room as it stands — resolved
 *  transforms, riders at their settled height. */
export function decorBlockersBySurface(scene: ScenePart[]): Record<string, DecorBlocker[]> {
  const out: Record<string, DecorBlocker[]> = {};
  for (const s of scene) {
    if (!supportsDecor(s.category, s.shape)) continue;
    const top = verticalExtent(s.category, s.shape, s.dimMM, s.pos[1])[1];
    const sFoot = footFromPart(s.pos, s.rot, s.dimMM, s.circle, s.shape);
    const list: DecorBlocker[] = [];
    for (const p of scene) {
      if (p.id === s.id) continue;
      const [bottom, pTop] = verticalExtent(p.category, p.shape, p.dimMM, p.pos[1]);
      if (pTop <= top + 1e-6 || bottom >= top + DECOR_BAND) continue;
      const pFoot: Foot = footFromPart(p.pos, p.rot, p.dimMM, p.circle, p.shape);
      for (const cell of footCells(pFoot)) {
        // Only what actually stands over the surface. A bed that merely touches a
        // nightstand is beside it, and must not nudge every prop off that edge; the
        // 10 mm of slack is `collidesAt`'s, for the same reason.
        if (!footCells(sFoot).some((sc) => footOverlap(sc, cell, -0.01))) continue;
        const [lx, lz] = worldToLocal(s.rot, cell.cx - s.pos[0], cell.cz - s.pos[2]);
        list.push({ cx: lx, cz: lz, hw: cell.hw, hd: cell.hd, rot: cell.rot - s.rot });
      }
    }
    if (list.length > 0) out[s.id] = list;
  }
  return out;
}

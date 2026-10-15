// The seven building blocks, as lists of named parts in the piece's own frame, metres —
// the renderer (`components/three/DynamicPart.tsx`) colours what these return and decides
// nothing. Same split as `lib/hard-goods.ts`, for the same reason: a proportion written
// inside a TSX renderer is one no test can reach (the `fanBlade` scar, CLAUDE.md rule 2).
//
// **Authored at exactly `dimMM`.** Floor pieces: `y` runs 0 -> h, `x` is the width and `z`
// the depth, centred, the front on `+z`. Nothing leaves its box. Every block but the seat
// pad holds a real dimension — a 25 mm slab, a 20 mm aluminium edge, a drawer front, a
// board, a slat — so each is PARAMETRIC (`PARAMETRIC_SHAPES`): it is handed the size
// actually stored and drawn at scale 1, never stretched, and an absolute is written as
// `min(absolute, proportion)` so a small piece keeps its look instead of being eaten by
// its own trim. The seat pad is a pure proportion of its box and is group-scaled like the
// ottoman it is filed with.
//
// **Modules come off `MODULE_RANGE`**, not `Math.round(span / nominal)`: how many drawers a
// pedestal has, doors a cabinet, cubbies a shelf and slats a panel are all `moduleCount`,
// which keeps each module inside the range its real counterpart has at every legal size.
//
// **Options are `blockStyle`** (`lib/block-style.ts`), passed in already RESOLVED — the
// renderer calls `blockStyleFor` once and hands the answer here, so this module has no
// opinion about defaults.
//
// Two faces of one piece that point the same way are never drawn on one plane (the seam
// `tests/coplanar-faces.test.tsx` sweeps): where two parts' fronts face the same way they
// are at different depths, or they meet only along an edge.

import { moduleCount, moduleRangeFor, type ModuleRange } from './scene-spec';
import { slab, type HardPart } from './hard-goods';
import { worktopSlabM, type BlockBand, type BlockEnds } from './block-style';
import type { SoftItem } from './soft-goods';

type V3 = [number, number, number];
const m = (dimMM: readonly number[]): V3 => [dimMM[0] / 1000, dimMM[1] / 1000, dimMM[2] / 1000];

/** A module range that is there by construction: all four tiling blocks have a row, and a
 *  shape reaching this lookup without one draws as a single module rather than spreading
 *  `undefined` into NaN. */
const ONE: ModuleRange = { min: 1e-6, nominal: Infinity, max: Infinity };
const DRAWER = moduleRangeFor('drawer-unit') ?? ONE;
const CELL = moduleRangeFor('open-shelf') ?? ONE;
const DOOR = moduleRangeFor('door-cabinet') ?? ONE;
const SLAT = moduleRangeFor('slat-panel') ?? ONE;

/** One pane of translucent glass, a box in the piece's frame. `frosted` is a milky band you
 *  cannot see through; `clear` is plain glass. Drawn by the renderer, which owns the
 *  material, and casting no shadow: a screen's band is not a wall. */
export type BlockGlass = {
  kind: 'frosted' | 'clear';
  x0: number; x1: number;
  y0: number; y1: number;
  z0: number; z1: number;
};

// ─── Worktop ────────────────────────────────────────────────────────────────

/** A worktop's slab, in metres: 25 mm, however tall the piece, and never more than a
 *  fifth of a short one. Exported because it is an absolute, and the cap table in
 *  `tests/parametric-caps.test.ts` reads every absolute through a helper like this. */
export function worktopTop(heightMM: number): number {
  return worktopSlabM(heightMM);
}

/** A worktop: a slab at the top of its height, and under it four slim square legs inset
 *  from the corners, two full-depth end panels, or nothing at all.
 *
 *  `none` is the slab ALONE, floating at `h` — the point of it is to lie on drawer units or
 *  screens that carry it, and the piece's box still reaches the floor so it stands where a
 *  desk would. Floor piece. */
export function worktopForm(dimMM: readonly number[], ends: BlockEnds): HardPart[] {
  const [w, d, h] = m(dimMM);
  const t = worktopTop(dimMM[2]);
  const yTop = h - t;
  const out: HardPart[] = [slab('top', 'body', -w / 2, w / 2, yTop, h, -d / 2, d / 2)];
  if (ends === 'legs') {
    const leg = Math.min(0.04, w * 0.1, d * 0.1);
    const inset = Math.min(0.05, w * 0.1, d * 0.1);
    const lx = w / 2 - inset - leg / 2;
    const lz = d / 2 - inset - leg / 2;
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
      out.push(slab(`leg-${sx}${sz}`, 'trim', sx * lx - leg / 2, sx * lx + leg / 2, 0, yTop, sz * lz - leg / 2, sz * lz + leg / 2));
    }
  } else if (ends === 'panel') {
    const p = Math.min(0.025, w * 0.05);
    const setback = Math.min(0.02, w * 0.04);
    const zi = Math.min(0.01, d * 0.03);
    out.push(
      slab('panel-l', 'body', -w / 2 + setback, -w / 2 + setback + p, 0, yTop, -d / 2 + zi, d / 2 - zi),
      slab('panel-r', 'body', w / 2 - setback - p, w / 2 - setback, 0, yTop, -d / 2 + zi, d / 2 - zi),
    );
  }
  return out;
}

// ─── Screen ─────────────────────────────────────────────────────────────────

/** A screen's aluminium edge, in metres: a real 20 mm extrusion, never more than a tenth of
 *  a small screen's width. */
export function screenFrame(widthMM: number): number {
  return Math.min(0.02, (widthMM / 1000) * 0.1);
}

/** A screen's top band, in metres: 300 mm, or 30% of a low screen. `0` for no band. */
export function screenBand(heightMM: number, band: BlockBand): number {
  return band === 'none' ? 0 : Math.min(0.3, (heightMM / 1000) * 0.3);
}

/** A floor-standing office partition: an aluminium frame (two posts to the floor, a rail
 *  under the board and one across the top), a fabric board between them, and above it —
 *  unless `band` is `none` — a rail and a band of frosted or clear glass. The board is
 *  the piece's own colour; the aluminium and the glass are not.
 *
 *  The board and the glass are thinner than the frame, set in its middle, so neither shares
 *  a face with it. The glass is handed back apart (`glass`) because it is the one part that
 *  must be translucent and cast nothing. Floor piece. */
export function screenForm(dimMM: readonly number[], band: BlockBand): { parts: HardPart[]; glass: BlockGlass[] } {
  const [w, d, h] = m(dimMM);
  const fr = Math.min(screenFrame(dimMM[0]), h * 0.1);
  const lift = Math.min(0.04, h * 0.05);
  const bandH = screenBand(dimMM[2], band);
  const yTop = h - fr; // underside of the top rail
  const yBandLo = yTop - bandH; // underside of the glass
  const yPanelTop = bandH > 0 ? yBandLo - fr : yTop; // under the mid rail, if there is one
  const yPanelLo = lift + fr;
  const x0 = -w / 2 + fr;
  const x1 = w / 2 - fr;
  const parts: HardPart[] = [
    slab('post-l', 'steel', -w / 2, x0, 0, h, -d / 2, d / 2),
    slab('post-r', 'steel', x1, w / 2, 0, h, -d / 2, d / 2),
    slab('rail-low', 'steel', x0, x1, lift, yPanelLo, -d / 2, d / 2),
    slab('rail-top', 'steel', x0, x1, yTop, h, -d / 2, d / 2),
    slab('board', 'body', x0, x1, yPanelLo, yPanelTop, -d * 0.35, d * 0.35),
  ];
  const glass: BlockGlass[] = [];
  if (bandH > 0) {
    parts.push(slab('rail-mid', 'steel', x0, x1, yBandLo - fr, yBandLo, -d / 2, d / 2));
    glass.push({ kind: band === 'glass' ? 'clear' : 'frosted', x0, x1, y0: yBandLo, y1: yTop, z0: -d * 0.15, z1: d * 0.15 });
  }
  return { parts, glass };
}

// ─── Casework: drawer unit and door cabinet ─────────────────────────────────

/** A casework's joinery, metres: the top's overhang past the carcass and its thickness, a
 *  front's thickness, the reveal round each front and the room reserved in front of the
 *  fronts for a handle to stand in. All real sizes; each is capped by a share of the axis it
 *  lives on so a small unit keeps its proportions. */
export const CASE = { overhang: 0.012, top: 0.022, front: 0.018, reveal: 0.003, handle: 0.02, recess: 0.05 } as const;

type Case = {
  parts: HardPart[];
  /** The fronts' rectangle: the carcass width between its sides, from the plinth's top to
   *  the underside of the top. */
  x0: number; x1: number; y0: number; y1: number;
  /** The fronts' outer face, and the face a handle is seated on. */
  zFront: number;
  front: number;
};

/** The carcass both casework blocks share: a body between a top and a (recessed) plinth,
 *  with the face the fronts go on left bare. The handle's projection is reserved INSIDE the
 *  declared depth, so the fronts stand `handle` behind the front of the box and a pull
 *  reaches it rather than passing it.
 *
 *  `plinthH` of 0 means the body stands on the floor. */
function casework(w: number, d: number, h: number, plinthH: number): Case {
  const o = Math.min(CASE.overhang, w * 0.03, d * 0.03);
  const t = Math.min(CASE.top, h * 0.05);
  const ft = Math.min(CASE.front, d * 0.05);
  const hp = Math.min(CASE.handle, d * 0.05);
  const zFront = d / 2 - hp;
  const parts: HardPart[] = [
    slab('top', 'body', -w / 2, w / 2, h - t, h, -d / 2, d / 2),
    slab('carcass', 'body', -w / 2 + o, w / 2 - o, plinthH, h - t, -d / 2 + o, zFront - ft),
  ];
  if (plinthH > 0) {
    const recess = Math.min(CASE.recess, d * 0.1);
    const inset = o + 0.004;
    parts.push(slab('plinth', 'dark', -w / 2 + inset, w / 2 - inset, 0, plinthH, -d / 2 + o, zFront - recess));
  }
  return { parts, x0: -w / 2 + o, x1: w / 2 - o, y0: plinthH, y1: h - t, zFront, front: ft };
}

/** How many drawers a pedestal of this height has: its height tiled by a 130-270 mm front,
 *  nominal 200, so the Library's 600 mm draws three. */
export function drawerCount(heightMM: number): number {
  return moduleCount(heightMM / 1000, DRAWER);
}

/** A drawer unit's plinth, metres: 50 mm, never more than 8% of a short unit. */
export function drawerPlinth(heightMM: number): number {
  return Math.min(0.05, (heightMM / 1000) * 0.08);
}

/** A pedestal of drawers: a carcass on a recessed plinth under a top, a stack of fronts
 *  with a slim steel pull across each, and — when `lock` — a small brass lock barrel at the
 *  top of the highest front. Floor piece. */
export function drawerUnitForm(dimMM: readonly number[], lock: boolean): HardPart[] {
  const [w, d, h] = m(dimMM);
  const c = casework(w, d, h, drawerPlinth(dimMM[2]));
  const n = drawerCount(dimMM[2]);
  const pitch = (c.y1 - c.y0) / n;
  const rv = CASE.reveal;
  const out = [...c.parts];
  const hp = d / 2 - c.zFront;
  for (let i = 0; i < n; i++) {
    const y0 = c.y0 + i * pitch + rv;
    const y1 = c.y0 + (i + 1) * pitch - rv;
    const ym = (y0 + y1) / 2;
    out.push(slab(`front-${i}`, 'panel', c.x0 + rv, c.x1 - rv, y0, y1, c.zFront - c.front, c.zFront));
    const pw = Math.min(0.12, (c.x1 - c.x0) * 0.4);
    out.push(slab(`pull-${i}`, 'steel', -pw / 2, pw / 2, ym - 0.004, ym + 0.004, c.zFront, d / 2 - 0.001));
    if (lock && i === n - 1) {
      const r = Math.min(0.008, pitch * 0.05);
      const t = hp * 0.5;
      out.push({
        kind: 'disc', key: 'lock', tone: 'brass', r, t,
        pos: [0, y1 - Math.min(0.025, pitch * 0.2), c.zFront - 0.001 + t / 2],
      });
    }
  }
  return out;
}

/** How many doors a cabinet of this width has: its width tiled by a 300-600 mm door,
 *  nominal 420, so the Library's 800 mm draws a pair. */
export function doorCount(widthMM: number): number {
  return moduleCount(widthMM / 1000, DOOR);
}

/** A door cabinet's toe-kick, metres: 80 mm, never more than 15% of a low cabinet. */
export function cabinetPlinth(heightMM: number): number {
  return Math.min(0.08, (heightMM / 1000) * 0.15);
}

/** A closed cabinet: a carcass under a top, `doorCount` doors across its face with a slim
 *  vertical steel pull each — on the edge where a pair meet — and, when `plinth`, a
 *  toe-kick set back under it. Without one the body stands on the floor. Floor piece. */
export function doorCabinetForm(dimMM: readonly number[], plinth: boolean): HardPart[] {
  const [w, d, h] = m(dimMM);
  const c = casework(w, d, h, plinth ? cabinetPlinth(dimMM[2]) : 0);
  const n = doorCount(dimMM[0]);
  const cell = (c.x1 - c.x0) / n;
  const rv = CASE.reveal;
  const out = [...c.parts];
  const doorH = c.y1 - c.y0 - 2 * rv;
  const barH = Math.min(0.15, doorH * 0.3);
  const top = c.y1 - rv - Math.min(0.08, doorH * 0.1);
  for (let i = 0; i < n; i++) {
    const x0 = c.x0 + i * cell + rv;
    const x1 = c.x0 + (i + 1) * cell - rv;
    out.push(slab(`door-${i}`, 'panel', x0, x1, c.y0 + rv, c.y1 - rv, c.zFront - c.front, c.zFront));
    // Even doors open from their right edge, odd from their left, so a pair meet at their
    // pulls; an odd count's last door opens from its right.
    const hx = i % 2 === 0 ? x1 - 0.03 : x0 + 0.03;
    out.push(slab(`pull-${i}`, 'steel', hx - 0.006, hx + 0.006, top - barH, top, c.zFront, d / 2 - 0.001));
  }
  return out;
}

// ─── Open shelf ─────────────────────────────────────────────────────────────

/** A shelf board's thickness, metres: 18 mm, capped by a share of every axis it lives on. */
export function shelfBoard(dimMM: readonly number[]): number {
  const [w, d, h] = m(dimMM);
  return Math.min(0.018, w * 0.05, h * 0.05, d * 0.1);
}

/** The cubby grid: columns across the width and rows up the height, each a cell of 220-450
 *  mm (nominal 380), so the Library's 800 x 800 is two by two. */
export function shelfGrid(dimMM: readonly number[]): { cols: number; rows: number } {
  return { cols: moduleCount(dimMM[0] / 1000, CELL), rows: moduleCount(dimMM[2] / 1000, CELL) };
}

/** A cubby shelf: two sides, `rows + 1` boards (the bottom and the top among them) and
 *  `cols - 1` uprights between each pair of boards, and — when `back` — a thin panel set in
 *  the rear. The uprights stand BETWEEN the boards rather than through them, so no two faces
 *  share a plane. Floor piece. */
export function openShelfForm(dimMM: readonly number[], back: boolean): HardPart[] {
  const [w, d, h] = m(dimMM);
  const bt = shelfBoard(dimMM);
  const { cols, rows } = shelfGrid(dimMM);
  const x0 = -w / 2 + bt;
  const x1 = w / 2 - bt;
  const stride = (h - bt) / rows;
  const out: HardPart[] = [
    slab('side-l', 'body', -w / 2, x0, 0, h, -d / 2, d / 2),
    slab('side-r', 'body', x1, w / 2, 0, h, -d / 2, d / 2),
  ];
  for (let r = 0; r <= rows; r++) {
    out.push(slab(`board-${r}`, 'body', x0, x1, r * stride, r * stride + bt, -d / 2, d / 2));
  }
  const cell = (x1 - x0) / cols;
  for (let r = 0; r < rows; r++) {
    for (let c = 1; c < cols; c++) {
      const xc = x0 + c * cell;
      out.push(slab(`upright-${r}-${c}`, 'body', xc - bt / 2, xc + bt / 2, r * stride + bt, (r + 1) * stride, -d / 2, d / 2));
    }
  }
  if (back) {
    const bk = Math.min(0.006, d * 0.05);
    out.push(slab('back', 'trim', x0, x1, bt, h - bt, -d / 2 + 0.002, -d / 2 + 0.002 + bk));
  }
  return out;
}

// ─── Slat panel ─────────────────────────────────────────────────────────────

/** How many slats a panel of this width has: its width tiled by a 45-90 mm pitch (slat and
 *  gap), nominal 65, so the Library's 1.2 m draws eighteen. */
export function slatCount(widthMM: number): number {
  return moduleCount(widthMM / 1000, SLAT);
}

/** A slat panel's rails and backing, metres: a 40 mm rail top and bottom (capped by a share
 *  of a short panel) and a 12 mm backing board (capped by a share of a shallow one). */
export function slatRail(heightMM: number): number {
  return Math.min(0.04, (heightMM / 1000) * 0.05);
}
export function slatBacking(depthMM: number): number {
  return Math.min(0.012, (depthMM / 1000) * 0.3);
}

/** A panel of vertical slats between a rail at the foot and one at the head, a slat taking
 *  60% of each pitch. See-through unless `backing`, which adds a board behind them. It
 *  stands on the floor and can stand against a wall like a headboard. Floor piece. */
export function slatPanelForm(dimMM: readonly number[], backing: boolean): HardPart[] {
  const [w, d, h] = m(dimMM);
  const rail = slatRail(dimMM[2]);
  const n = slatCount(dimMM[0]);
  const pitch = w / n;
  const sw = pitch * 0.6;
  const bk = backing ? slatBacking(dimMM[1]) : 0;
  const out: HardPart[] = [
    slab('rail-low', 'trim', -w / 2, w / 2, 0, rail, -d / 2, d / 2),
    slab('rail-top', 'trim', -w / 2, w / 2, h - rail, h, -d / 2, d / 2),
  ];
  if (backing) out.push(slab('backing', 'trim', -w / 2, w / 2, rail, h - rail, -d / 2, -d / 2 + bk));
  for (let i = 0; i < n; i++) {
    const xc = -w / 2 + (i + 0.5) * pitch;
    out.push(slab(`slat-${i}`, 'body', xc - sw / 2, xc + sw / 2, rail, h - rail, -d / 2 + bk, d / 2));
  }
  return out;
}

// ─── Seat pad ───────────────────────────────────────────────────────────────

/** A seat pad: one box cushion, the whole outline from the floor to `h`. A pure proportion
 *  of its box, so — like the ottoman — it is drawn at its authored size and group-scaled.
 *  Floor piece; meant to be laid on a bench or the top of a cabinet, where `seeksSurface`
 *  (it is filed under `ottoman`) carries it when it is added over one. */
export function seatPadForm(dimMM: readonly number[]): { top: SoftItem } {
  const [w, d, h] = m(dimMM);
  return { top: { pos: [0, h / 2, 0], size: [w, h, d] } };
}

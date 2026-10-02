// The soft things in a room, drawn as cloth rather than as boxes: pillows and cushions,
// a duvet, the clothes on a rail, the shoes on a rack, a curtain.
//
// They were boxes, and boxes read as furniture: a bed's pillow was a slab with rounded
// corners, a duvet was a board lying on the mattress, a shirt was two planks on a stick and
// a shoe was three bricks. What makes cloth read as cloth is its edge — a pillow swelling to
// a seam, a duvet rolling over the side of a mattress and hanging, a garment narrowing at
// the shoulders — so that is what is modelled here, and nothing is simulated.
//
// **Pure, in metres, and no mesh leaves the box it is placed by.** A unit mesh (a cushion,
// a garment, a shoe) lies inside [-0.5, 0.5] on every axis, so an instance scaled to `size`
// occupies `size` and no more: the box `lib/geometry.ts` collides, the plan draws and
// `tests/footprint-fidelity.test.tsx` measures is the box the cloth was drawn inside. The
// cushions FILL theirs on every axis; a garment and a shoe's upper fill theirs top to bottom
// — a garment hangs from its hook and an upper stands on its sole — and are narrower than
// it, because trousers are not as wide as a coat's shoulders. A mesh
// built per piece (a duvet, a curtain) is authored at the piece's own `dimMM`, CLAUDE.md
// rule 2's first corollary, because a renderer that draws a fixed size draws the wrong size
// at scale 1. The arithmetic is here rather than in `components/three/DynamicPart.tsx` for
// the reason `fanBlade` gives: a number inside a TSX renderer is a number no test can reach.
//
// Colours are not here. A mesh carries a `tone` index at most; the palette is
// `lib/scene-palette.ts`'s, as for the books and the shoes before.

type V3 = [number, number, number];

/** A mesh as flat arrays, the form three's BufferGeometry takes and a test can sweep. */
export type SoftMeshData = { readonly positions: readonly number[]; readonly index: readonly number[] };

class Builder {
  readonly positions: number[] = [];
  readonly index: number[] = [];

  /** A sheet over two sample axes: `at(a, b)` for every pair, two triangles per cell. With
   *  `a` running toward +x and `b` toward +z, the unflipped winding faces +y. */
  grid(as: readonly number[], bs: readonly number[], at: (a: number, b: number) => V3, flip = false): void {
    const base = this.positions.length / 3;
    for (const b of bs) for (const a of as) this.positions.push(...at(a, b));
    const row = as.length;
    for (let j = 0; j < bs.length - 1; j++) {
      for (let i = 0; i < row - 1; i++) {
        const p = base + j * row + i;
        const q = p + 1;
        const r = p + row;
        const s = r + 1;
        if (flip) this.index.push(p, q, r, q, s, r);
        else this.index.push(p, r, q, q, r, s);
      }
    }
  }

  done(): SoftMeshData {
    return { positions: this.positions, index: this.index };
  }
}

/** `n + 1` samples from `lo` to `hi`, evenly. */
function even(lo: number, hi: number, n: number): number[] {
  return Array.from({ length: n + 1 }, (_, i) => lo + ((hi - lo) * i) / n);
}

/** Samples from `lo` to `hi` at about `step` apart, at least one segment. */
function stepped(lo: number, hi: number, step: number): number[] {
  return even(lo, hi, Math.max(1, Math.ceil((hi - lo) / step)));
}

/** Breakpoints joined into one ascending axis, each run at its own step, no repeats. */
function axis(runs: ReadonlyArray<[number, number, number]>): number[] {
  const out: number[] = [];
  for (const [lo, hi, step] of runs) {
    if (hi <= lo) continue;
    for (const v of stepped(lo, hi, step)) if (out.length === 0 || v > out[out.length - 1] + 1e-12) out.push(v);
  }
  return out;
}

const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const smooth = (t: number) => {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
};

/** Piecewise-smooth through `[t, value]` keys (ascending `t`), flat beyond the ends. */
function keyed(keys: ReadonlyArray<readonly [number, number]>, t: number): number {
  if (t <= keys[0][0]) return keys[0][1];
  for (let k = 1; k < keys.length; k++) {
    const [t1, v1] = keys[k];
    if (t <= t1) {
      const [t0, v0] = keys[k - 1];
      return v0 + (v1 - v0) * smooth((t - t0) / (t1 - t0));
    }
  }
  return keys[keys.length - 1][1];
}

/** A small stable hash of a string to [0, 1), for a tone or a phase that must not change
 *  across a reload. Not `seededRand`'s sequence: one draw per salt, so adding a draw for
 *  one prop never shifts another's. */
export function softHash(id: string, salt: string): number {
  let h = 2166136261;
  const s = `${id}:${salt}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

// ─── Cushions ────────────────────────────────────────────────────────────────
//
// One unit cushion per style, thickness on +Y, width on X, depth on Z. Two sheets, top and
// bottom, meet at a seam round the middle; the thickness at a point is
// `((1 − |u|^p)(1 − |v|^p))^q`, so a low `p` and a high `q` give a pillow's dome and a high
// `p` with a low `q` a box cushion's flat top and rounded edge. `pinch` draws the middle of
// each side in toward the centre, which is what makes a pillow's corners point.
//
// The grid is spaced by `sin`, so the samples crowd toward the seam, where the surface
// turns fastest; the centre is flat and needs few.

export type CushionStyle = 'pillow' | 'scatter' | 'box';

export const CUSHION_FORM: Readonly<Record<CushionStyle, { p: number; q: number; pinch: number }>> = {
  /** A bed pillow: full in the middle, soft edge, corners a little proud. */
  pillow: { p: 2.2, q: 0.55, pinch: 0.06 },
  /** A scatter cushion: fuller still and more pinched, so its corners point. */
  scatter: { p: 2.4, q: 0.5, pinch: 0.11 },
  /** A sofa's seat or back cushion: a flat face, a rounded boxed edge. */
  box: { p: 8, q: 0.22, pinch: 0.015 },
};

const CUSHION_SEG = 18;

function buildCushion(style: CushionStyle): SoftMeshData {
  const { p, q, pinch } = CUSHION_FORM[style];
  const s = even(-1, 1, CUSHION_SEG).map((t) => Math.sin((Math.PI / 2) * t));
  const b = new Builder();
  for (const sign of [1, -1] as const) {
    b.grid(
      s,
      s,
      (u, v) => {
        const f = Math.pow(Math.max(0, (1 - Math.abs(u) ** p) * (1 - Math.abs(v) ** p)), q);
        return [0.5 * u * (1 - pinch * (1 - v * v)), sign * 0.5 * f, 0.5 * v * (1 - pinch * (1 - u * u))];
      },
      sign < 0,
    );
  }
  return b.done();
}

/** The unit cushions, built once. */
export const CUSHION_MESH: Readonly<Record<CushionStyle, SoftMeshData>> = {
  pillow: buildCushion('pillow'),
  scatter: buildCushion('scatter'),
  box: buildCushion('box'),
};

/** One instance of a unit mesh: its centre, the box it fills, and its turn. */
export type SoftItem = { pos: V3; size: V3; rot?: V3; tone?: number };

/** Where a unit mesh actually reaches once scaled to `size` and turned by `rot` (three's
 *  XYZ Euler, as `useInstanceTransforms` composes it), relative to its centre.
 *
 *  A turned cushion does not reach the corners of its turned box: its edges are a seam with
 *  no thickness, so the lowest point of a cushion leaning back is its bottom seam, not the
 *  box's front-bottom corner. Placed by the box, every leaning cushion hovered above the seat
 *  it sat on — by 8 mm on a long sofa, by most of 30 mm for a pillow tipped against a headboard. So a
 *  cushion is placed by its own surface. */
export function meshExtent(mesh: SoftMeshData, size: V3, rot: V3 = [0, 0, 0]): { lo: V3; hi: V3 } {
  const lo: V3 = [Infinity, Infinity, Infinity];
  const hi: V3 = [-Infinity, -Infinity, -Infinity];
  eachPoint(mesh, size, rot, (v) => {
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], v[k]);
      hi[k] = Math.max(hi[k], v[k]);
    }
  });
  return { lo, hi };
}

/** Every vertex of a unit mesh scaled to `size` and turned by `rot`, relative to its centre. */
function eachPoint(mesh: SoftMeshData, size: V3, rot: V3, at: (v: V3) => void): void {
  const [cx, sx] = [Math.cos(rot[0]), Math.sin(rot[0])];
  const [cy, sy] = [Math.cos(rot[1]), Math.sin(rot[1])];
  const [cz, sz] = [Math.cos(rot[2]), Math.sin(rot[2])];
  const p = mesh.positions;
  for (let i = 0; i < p.length; i += 3) {
    // Scale, then Rz, Ry, Rx — the order an XYZ Euler's matrix Rx·Ry·Rz applies them in.
    let x = p[i] * size[0];
    let y = p[i + 1] * size[1];
    let z = p[i + 2] * size[2];
    [x, y] = [x * cz - y * sz, x * sz + y * cz];
    [x, z] = [x * cy + z * sy, -x * sy + z * cy];
    [y, z] = [y * cx - z * sx, y * sx + z * cx];
    at([x, y, z]);
  }
}

/** How far `item` must move along +Z for its back to rest on the front of `onto`, settled
 *  in by `sink`: the two cloths compared height by height, across the middle of the width
 *  they share, so the leaning one touches the other where they actually meet — its lower
 *  back on a pillow's front shoulder — rather than where their boxes say they might.
 *  `null` when the two share no height, which is a cushion with nothing behind it. */
export function restGap(mesh: SoftMeshData, item: SoftItem, ontoMesh: SoftMeshData, onto: SoftItem, sink: number): number | null {
  const x0 = Math.max(item.pos[0] - item.size[0] * 0.3, onto.pos[0] - onto.size[0] * 0.3);
  const x1 = Math.min(item.pos[0] + item.size[0] * 0.3, onto.pos[0] + onto.size[0] * 0.3);
  if (x1 <= x0) return null;
  const bin = 0.004;
  const back = new Map<number, number>();
  const front = new Map<number, number>();
  const collect = (m: SoftMeshData, it: SoftItem, into: Map<number, number>, pick: (a: number, b: number) => number) =>
    eachPoint(m, it.size, it.rot ?? [0, 0, 0], (v) => {
      const x = v[0] + it.pos[0];
      if (x < x0 || x > x1) return;
      const k = Math.floor((v[1] + it.pos[1]) / bin);
      const z = v[2] + it.pos[2];
      const was = into.get(k);
      into.set(k, was === undefined ? z : pick(was, z));
    });
  collect(mesh, item, back, Math.min);
  collect(ontoMesh, onto, front, Math.max);
  let need = -Infinity;
  for (const [k, z] of back) {
    const f = front.get(k);
    if (f !== undefined) need = Math.max(need, f - sink - z);
  }
  return need === -Infinity ? null : need;
}

/** A turn about X that stands a unit cushion up (its thickness, unit +Y, toward +Z) and
 *  leans its top back by `lean` radians. */
export function standUp(lean: number): V3 {
  return [Math.PI / 2 - lean, 0, 0];
}

/** How tall a scatter cushion of side 1 and thickness `share` stands when leaned back by
 *  `lean`: its CLOTH's height, measured off the mesh, not its turned box's. A cushion's
 *  height is linear in its size, so dividing the room above its seat by this sizes it to
 *  reach that limit exactly. The box's height (`share·sin + cos`) is the obvious cap and
 *  overstates the cloth by its rounded corners, so a cushion capped by it stopped short of
 *  the line it was sized to, by an amount no test of the cloth could see. */
export function standingHeight(share: number, lean: number): number {
  const { lo, hi } = meshExtent(CUSHION_MESH.scatter, [1, share, 1], standUp(lean));
  return hi[1] - lo[1];
}

/** How far a cushion settles into what it rests on and against, metres. Cloth gives; a
 *  cushion balanced on the very top of another reads as a prop placed on a shelf. */
export const CUSHION_SINK = 0.012;

/** A scatter cushion stood up and leaning back against a face at `backZ`, sitting on a
 *  surface at `seatY` — against a sofa's back, in front of a bed's pillows. Its own bottom
 *  seam is on the seat and its own back on the face, each settled in by `CUSHION_SINK`. */
export function leaningCushion(x: number, w: number, thick: number, tall: number, lean: number, seatY: number, backZ: number): SoftItem {
  const size: V3 = [w, thick, tall];
  const rot = standUp(lean);
  const { lo } = meshExtent(CUSHION_MESH.scatter, size, rot);
  return { pos: [x, seatY - lo[1] - CUSHION_SINK, backZ - lo[2] - CUSHION_SINK], size, rot };
}

// ─── Sofa ────────────────────────────────────────────────────────────────────

/** How far a sofa's back cushions lean back, and its scatter cushions. */
export const SOFA_BACK_LEAN = 0.08;
export const THROW_LEAN = 0.3;

/** A sofa's frame and its cushions, at its own `dimMM`.
 *
 *  The frame numbers are the ones `SofaGeo` always drew by, moved here so the scatter
 *  cushions can be placed against them where a test can check it. A sofa gets a scatter
 *  cushion in each end seat when its back is tall enough to lean one on, each sized to the seat and the back it leans on and in a tone taken from the piece's
 *  id, so a sofa keeps its cushions across a reload. */
export function sofaForm(part: { id: string; dimMM: readonly number[] }) {
  const w = part.dimMM[0] / 1000;
  const d = part.dimMM[1] / 1000;
  const h = part.dimMM[2] / 1000;
  const arm = Math.min(0.18, w * 0.12);
  const legH = 0.1;
  const seatTop = Math.min(0.46, Math.max(0.34, h * 0.5));
  const innerW = Math.max(0.4, w - arm * 2);
  const backTh = Math.min(0.2, d * 0.2);
  const seatH = 0.2;
  const seatY = seatTop + 0.06;
  const seatD = d * 0.72;
  const backH = (h - seatTop) * 0.82;
  const backT = 0.16;
  const backY = seatTop + (h - seatTop) * 0.45;
  const backZ = -d * 0.3;
  const cushionTop = seatY + seatH / 2;
  // The back cushion's front face, where its centre plane is, plus half its thickness.
  const backFront = backZ + backT / 2;
  const s = Math.min(0.45, (h - cushionTop + CUSHION_SINK) / standingHeight(0.3, THROW_LEAN), innerW * 0.38);
  const thick = s * 0.3;
  const throws: SoftItem[] = [];
  // Two, one in each end seat, or none. There is no one-cushion sofa: `s` is at most
  // 0.38 of the seat, so two of them and the 0.2 m between fit any seat wider than
  // 0.83 m, and the narrowest sofa the band allows has 0.91.
  if (s >= 0.2) {
    for (const side of [-1, 1]) {
      const x = side * (innerW / 2 - s / 2 - 0.04);
      throws.push({ ...leaningCushion(x, s, thick, s, THROW_LEAN, cushionTop, backFront), tone: Math.floor(softHash(part.id, `throw${side}`) * 64) });
    }
  }
  return { w, d, h, arm, legH, seatTop, innerW, backTh, seatH, seatY, seatD, backH, backT, backY, backZ, throws };
}

// ─── Bed ─────────────────────────────────────────────────────────────────────

/** How far in from the frame's side and ends the mattress stands, metres a side. Not a
 *  share of the width: at 2% a single bed's mattress side rose inside the frame's 30 mm
 *  rounded edge, and the line where one met the other ran along a curve. */
export const MATTRESS_INSET = 0.04;
/** The headboard's thickness, metres. It stands on the bed's head line, half each side. */
export const HEADBOARD_T = 0.05;

/** A bed's layers at its own `dimMM`, in the bed's frame (head at −Z): the mattress, the
 *  pillows, a scatter cushion per sleeper, the duvet and the sheet turned back over it.
 *
 *  `pillows` is the `bedPillows` answer the caller already has — one pillow, or two from
 *  1.3 m — passed in rather than imported, so the count has one home and that home is
 *  `lib/layout-rules.ts`, which the nightstands read as well.
 *
 *  The pillows lie on the mattress with their backs to the headboard. They used to be
 *  tipped 10° to look propped, and a rigid tilt rests on ONE edge: a 500 mm pillow touched
 *  the mattress along its front seam and stood 90 mm clear of it at the headboard, an air
 *  wedge under every pillow that read, from the side, as linen floating over the bed. A
 *  real pillow is soft and settles flat, so these do, sunk `CUSHION_SINK / 2` in; a scatter
 *  cushion stands in front of each on the turned-back sheet, sized so it stays below
 *  `SCATTER_TOP` of the bed's height — the headboard is drawn to 1.4 h, and a cushion
 *  showing over it reads as a bed with no headboard. */
export const SCATTER_TOP = 1.3;

/** A bed pillow's loft, metres, at the smallest and largest bed: 0.27 of the bed's height
 *  between them, 162 mm on the Library's 600. */
export const PILLOW_LOFT = { min: 0.08, max: 0.18 } as const;

export function bedForm(part: { id: string; dimMM: readonly number[] }, pillows: { w: number; xs: readonly number[] }) {
  return bedMemo(part.id, part.dimMM[0], part.dimMM[1], part.dimMM[2], pillows.w, pillows.xs.join(','));
}

const bedMemo = memoLast(
  (id: string, wMM: number, dMM: number, hMM: number, pw: number, xsKey: string) => {
    const w = wMM / 1000;
    const d = dMM / 1000;
    const h = hMM / 1000;
    const xs = xsKey.split(',').map(Number);
    const frameTop = h * 0.4;
    const mattress = { size: [w - 2 * MATTRESS_INSET, h * 0.35, d - 2 * MATTRESS_INSET] as V3, y: h * 0.5 };
    const top = mattress.y + mattress.size[1] / 2;
    // A pillow's loft is a pillow's, not a share of the bed: 0.15 h was 75 mm on the
    // Library bed, 22 mm above the sheet turned back in front of it, so the scatter
    // cushions had nothing to lean on.
    const pt = Math.min(PILLOW_LOFT.max, Math.max(PILLOW_LOFT.min, h * 0.27));
    const pd = d * 0.25;
    // Its back seam against the headboard's face, its underside on the mattress.
    const reach = meshExtent(CUSHION_MESH.pillow, [pw, pt, pd]);
    const pz = -d / 2 + HEADBOARD_T / 2 - reach.lo[2] - CUSHION_SINK;
    const pillowY = top - reach.lo[1] - CUSHION_SINK / 2;
    const pillowItems: SoftItem[] = xs.map((x) => ({ pos: [x, pillowY, pz], size: [pw, pt, pd] }));
    const pillowFront = pz + reach.hi[2];
    const duvet = duvetMesh(w, d, h, pillowFront - 0.02, frameTop);
    const foldTop = duvet.fold.pos[1] + duvet.fold.size[1] / 2;
    const ct0 = 0.28;
    const cs = Math.min(0.42, pw * 0.62, (SCATTER_TOP * h - foldTop + CUSHION_SINK) / standingHeight(ct0, THROW_LEAN));
    const ct = cs * ct0;
    const scatter: SoftItem[] =
      cs >= 0.2
        ? xs.map((x, i) => {
            // Stood on the sheet, then moved back until it rests on its pillow's front.
            const c = leaningCushion(x, cs, ct, cs, THROW_LEAN, foldTop, pillowFront);
            const gap = restGap(CUSHION_MESH.scatter, c, CUSHION_MESH.pillow, pillowItems[i], CUSHION_SINK) ?? 0;
            return { ...c, pos: [c.pos[0], c.pos[1], c.pos[2] + gap] as V3, tone: Math.floor(softHash(id, `scatter${i}`) * 64) };
          })
        : [];
    return { w, d, h, frameTop, mattress, top, pillows: pillowItems, scatter, duvet: duvet.mesh, fold: duvet.fold };
  },
  (...a) => a.join('|'),
);

/** The duvet, as a cloth laid over the mattress from just short of the pillows to the
 *  foot and falling over both sides and the foot to a level hem.
 *
 *  Built as a tablecloth is: flat coordinates over the cloth, wrapped round a rounded
 *  edge onto the top face of the mattress. A point's distance beyond the top rectangle
 *  is how far down the drape it lies, so at the two foot corners the cloth falls as a
 *  cone and the hem stays level; past the hem it turns in by `DUVET_LIP`, so the edge
 *  shows a thickness rather than a sheet of paper. A quilted puff on the top and soft
 *  folds in the fall. Inside the bed's outline on both floor axes (the drop stands a
 *  centimetre inside the frame's side), and above the frame, which it would otherwise
 *  hang through. */
export const DUVET_LIP = 0.02;
/** How far the duvet's fall stands out from the mattress's side, metres. */
export const DUVET_LOFT = 0.022;
const DUVET_FOLD_AMP = 0.008;

function duvetMesh(w: number, d: number, h: number, headZ: number, frameTop: number): { mesh: SoftMeshData; fold: SoftItem } {
  const mw = w / 2 - MATTRESS_INSET;
  const mattressTop = h * 0.675;
  const t = Math.min(0.035, h * 0.06);
  const yTop = mattressTop + t;
  const side = mw + DUVET_LOFT;
  const foot = d / 2 - MATTRESS_INSET + DUVET_LOFT;
  const R = Math.min(0.05, t * 1.2 + 0.01);
  const ax = side - R;
  const bz = foot - R;
  const hem = frameTop + 0.012;
  const arc = (R * Math.PI) / 2;
  const fall = Math.max(0, yTop - R - hem);
  const L = arc + fall;
  const L2 = L + DUVET_LIP;
  // Quilting cells close to 300 mm, a whole number across the top.
  const cellA = (2 * ax) / Math.max(1, Math.round((2 * ax) / 0.3));
  const cellB = (bz - headZ) / Math.max(1, Math.round((bz - headZ) / 0.3));
  const as = axis([
    [-ax - L2, -ax, 0.012],
    [-ax, ax, 0.035],
    [ax, ax + L2, 0.012],
  ]);
  const bs = axis([
    [headZ, bz, 0.035],
    [bz, bz + L2, 0.012],
  ]);
  const b = new Builder();
  b.grid(as, bs, (a, z) => {
    const dx = Math.max(Math.abs(a) - ax, 0);
    const dz = Math.max(z - bz, 0);
    const dist = Math.hypot(dx, dz);
    const ex = Math.sign(a) * Math.min(Math.abs(a), ax);
    const ez = Math.min(z, bz);
    if (dist === 0) {
      // On top: the quilting puffs, highest mid-cell, and a gentle crown across the bed.
      const qa = Math.sin((Math.PI * (a + ax)) / cellA) ** 2;
      const qb = Math.sin((Math.PI * (z - headZ)) / cellB) ** 2;
      const crown = 0.006 * (1 - (a / ax) ** 2);
      return [a, yTop + 0.007 * qa * qb + crown, z];
    }
    const nx = (Math.sign(a) * dx) / dist;
    const nz = dz / dist;
    const s = Math.min(dist, L2);
    let out: number;
    let down: number;
    if (s <= arc) {
      out = R * Math.sin(s / R);
      down = R * (1 - Math.cos(s / R));
    } else if (s <= L) {
      out = R;
      down = R + (s - arc);
    } else {
      out = R - (s - L);
      down = R + fall;
    }
    // Soft folds in the fall, deepest at the hem, running along the edge they hang from.
    const k = fall > 0 ? clamp01((Math.min(s, L) - arc) / fall) : 0;
    const along = nz * a + Math.abs(nx) * z;
    const fold = DUVET_FOLD_AMP * k * Math.sin((2 * Math.PI * along) / 0.23 + 0.7) * (0.6 + 0.4 * Math.sin((2 * Math.PI * along) / 0.71 + 2.1));
    return [ex + nx * (out + fold), yTop - down, ez + nz * (out + fold)];
  });
  // The sheet turned back over the duvet at the head: a soft band the width of the top.
  const foldD = Math.min(0.24, (bz - headZ) * 0.3);
  const fold: SoftItem = { pos: [0, yTop + 0.012, headZ + foldD / 2], size: [2 * side, 0.03, foldD] };
  return { mesh: b.done(), fold };
}

// ─── Garments ────────────────────────────────────────────────────────────────
//
// One unit garment per kind, hung from its top: thickness on X, the drop on Y (shoulders at
// +0.5, hem at −0.5) and the width on Z, so a garment on a rail is placed by the
// `[thick, length, width]` box `clothesRail` already gives it. The outline is a half-width
// along the drop — a shirt's sloping shoulders and sleeves, a dress's bodice and flared
// hem — and the thickness is a lens across the width with folds running down it. Closed at
// the shoulders, where it folds over its hanger, open at the hem, as clothes are.

export const GARMENT_KINDS = ['shirt', 'trousers', 'dress', 'coat'] as const;
export type GarmentKind = (typeof GARMENT_KINDS)[number];

/** Which garment a rail's seeded `tone` hangs, for a long or a short one. The colour
 *  reads `tone % palette`; the kind reads the tone's high bits, so the two vary
 *  independently and the rail's draw sequence is untouched. */
export function garmentKind(long: boolean, tone: number): GarmentKind {
  const k = Math.floor(tone / 8);
  if (long) return k % 2 === 1 ? 'coat' : 'dress';
  return k % 3 === 2 ? 'trousers' : 'shirt';
}

/** Half-width (of a unit width) along the drop `t`, 0 at the shoulders, 1 at the hem. */
const GARMENT_OUTLINE: Readonly<Record<GarmentKind, ReadonlyArray<readonly [number, number]>>> = {
  shirt: [[0, 0.12], [0.12, 0.5], [0.48, 0.5], [0.6, 0.4], [1, 0.38]],
  trousers: [[0, 0.22], [0.05, 0.3], [1, 0.25]],
  dress: [[0, 0.17], [0.1, 0.3], [0.32, 0.25], [1, 0.5]],
  coat: [[0, 0.14], [0.1, 0.5], [0.62, 0.5], [0.7, 0.46], [1, 0.47]],
};
/** How many folds run down each kind, and how deep they are as a share of its thickness. */
const GARMENT_FOLDS: Readonly<Record<GarmentKind, { n: number; amp: number }>> = {
  shirt: { n: 3, amp: 0.16 },
  trousers: { n: 2, amp: 0.12 },
  dress: { n: 5, amp: 0.2 },
  coat: { n: 3, amp: 0.12 },
};

export function garmentHalfWidth(kind: GarmentKind, t: number): number {
  return keyed(GARMENT_OUTLINE[kind], t);
}

function buildGarment(kind: GarmentKind): SoftMeshData {
  const { n, amp } = GARMENT_FOLDS[kind];
  const across = even(-1, 1, 16);
  const down = even(0, 1, 26);
  const b = new Builder();
  for (const sign of [1, -1] as const) {
    b.grid(
      across,
      down,
      (s, t) => {
        // Thickness grows from nothing at the fold over the hanger, so the top is closed.
        const lens = 0.5 * (1 - amp) * Math.sqrt(Math.max(0, 1 - s * s)) * Math.sqrt(smooth(t / 0.14));
        const fold = 0.5 * amp * (0.35 + 0.65 * t) * Math.sin(Math.PI * n * (s + 1) * 0.5 + 0.4 * n);
        return [sign * lens + fold, 0.5 - t, s * garmentHalfWidth(kind, t)];
      },
      sign < 0,
    );
  }
  return b.done();
}

export const GARMENT_MESH: Readonly<Record<GarmentKind, SoftMeshData>> = {
  shirt: buildGarment('shirt'),
  trousers: buildGarment('trousers'),
  dress: buildGarment('dress'),
  coat: buildGarment('coat'),
};

// ─── Shoes ───────────────────────────────────────────────────────────────────
//
// A unit shoe in two parts, each filling its own box: a sole, the foot's outline extruded,
// and an upper standing on it, heel at −Z and toe at +Z, height on +Y. The upper is a run
// of arched cross-sections along the foot, each as wide as the outline there and as tall as
// the kind's profile, with the foot opening pressed down into the top; a lining mesh, drawn
// dark, sits at the floor of that opening so it reads as a way in rather than a dent.

export const SHOE_KINDS = ['loafer', 'trainer', 'boot'] as const;
export type ShoeKind = (typeof SHOE_KINDS)[number];

/** The foot's half-width at `u` along it (0 heel, 1 toe), as a share of the box's: round
 *  at both ends, widest across the ball. */
export function footHalfWidth(u: number): number {
  const c = Math.abs(2 * clamp01(u) - 1);
  const ends = Math.pow(Math.max(0, 1 - c ** 3), 1 / 3);
  const ball = keyed([[0, 0.8], [0.3, 0.84], [0.66, 1], [1, 0.8]], u);
  return 0.5 * ends * ball;
}

type ShoeShape = {
  /** height of the upper's crown along the foot, as a share of the box */
  top: ReadonlyArray<readonly [number, number]>;
  /** the foot opening: its centre and half-length along the foot, and the height of its floor */
  open: { at: number; half: number; floor: number };
};

const SHOE_SHAPE: Readonly<Record<ShoeKind, ShoeShape>> = {
  loafer: { top: [[0, 0.82], [0.3, 0.84], [0.55, 1], [0.8, 0.78], [1, 0.52]], open: { at: 0.27, half: 0.24, floor: 0.2 } },
  trainer: { top: [[0, 0.9], [0.12, 1], [0.3, 0.86], [0.45, 0.96], [0.7, 0.62], [0.9, 0.5], [1, 0.42]], open: { at: 0.24, half: 0.17, floor: 0.24 } },
  boot: { top: [[0, 1], [0.38, 1], [0.6, 0.36], [0.85, 0.3], [1, 0.22]], open: { at: 0.2, half: 0.17, floor: 0.7 } },
};

/** The shape a cross-section rises in: steep sides, a rounded crown. */
const ARCH = 0.35;

function shoeOpening(kind: ShoeKind, u: number): number {
  const { at, half } = SHOE_SHAPE[kind].open;
  const r = (u - at) / half;
  return Math.sqrt(Math.max(0, 1 - r * r));
}

const UPPER_US = even(0, 1, 28).map((t) => 0.5 - 0.5 * Math.cos(Math.PI * t));
const UPPER_THETAS = even(0, Math.PI, 16);

/** How high the upper stands over its sole at one sample, as a share of the crown table. */
function upperRise(kind: ShoeKind, th: number, u: number): number {
  const shape = SHOE_SHAPE[kind];
  const crown = keyed(shape.top, u);
  const rise = Math.pow(Math.sin(th), ARCH);
  const dip = Math.max(0, crown - shape.open.floor) * shoeOpening(kind, u) * Math.sin(th) ** 4;
  return crown * rise - dip;
}

/** The highest sample of each upper. Dividing by it is what makes an upper fill its box's
 *  height EXACTLY: the crown table peaks at 1 only where the collar does not dip into it,
 *  and the trainer's tallest undipped crown is its 0.96 toe cap — drawn as it was, a
 *  trainer stood 4% short of the height `shoeRow` sizes it to. */
const UPPER_PEAK: Readonly<Record<ShoeKind, number>> = Object.fromEntries(
  SHOE_KINDS.map((k) => [k, Math.max(...UPPER_US.flatMap((u) => UPPER_THETAS.map((th) => upperRise(k, th, u))))]),
) as Record<ShoeKind, number>;

function buildUpper(kind: ShoeKind): SoftMeshData {
  const b = new Builder();
  b.grid(UPPER_THETAS, UPPER_US, (th, u) => [footHalfWidth(u) * Math.cos(th), -0.5 + upperRise(kind, th, u) / UPPER_PEAK[kind], u - 0.5]);
  return b.done();
}

function buildLining(kind: ShoeKind): SoftMeshData {
  const { at, half, floor } = SHOE_SHAPE[kind].open;
  const b = new Builder();
  const rs = even(0, 1, 4);
  const as = even(0, 2 * Math.PI, 18);
  // On the collar's floor, scaled with the upper it lines.
  const y = -0.5 + (floor + 0.01) / UPPER_PEAK[kind];
  b.grid(as, rs, (a, r) => {
    const u = at + half * 0.92 * r * Math.sin(a);
    const x = footHalfWidth(u) * 0.55 * r * Math.cos(a);
    return [x, y, u - 0.5];
  });
  return b.done();
}

function buildSole(): SoftMeshData {
  const us = even(0, 1, 28).map((t) => 0.5 - 0.5 * Math.cos(Math.PI * t));
  const b = new Builder();
  // Side wall: round the outline, bottom to top.
  const ring = [...us.map((u) => [footHalfWidth(u), u] as const), ...[...us].reverse().map((u) => [-footHalfWidth(u), u] as const)];
  b.grid(
    ring.map((_, i) => i),
    [-0.5, 0.5],
    (i, y) => {
      const [x, u] = ring[i];
      return [x, y, u - 0.5];
    },
  );
  // Top and bottom: across the outline at each station.
  for (const y of [0.5, -0.5]) {
    b.grid(
      [-1, 1],
      us,
      (s, u) => [s * footHalfWidth(u), y, u - 0.5],
      y < 0,
    );
  }
  return b.done();
}

export const SHOE_UPPER_MESH: Readonly<Record<ShoeKind, SoftMeshData>> = {
  loafer: buildUpper('loafer'),
  trainer: buildUpper('trainer'),
  boot: buildUpper('boot'),
};
export const SHOE_LINING_MESH: Readonly<Record<ShoeKind, SoftMeshData>> = {
  loafer: buildLining('loafer'),
  trainer: buildLining('trainer'),
  boot: buildLining('boot'),
};
export const SHOE_SOLE_MESH: SoftMeshData = buildSole();

// ─── Curtain ─────────────────────────────────────────────────────────────────

/** A curtain as one cloth hanging in waves from the rod, at its own `dimMM`: one wave per
 *  two pleats of `moduleCount`, gathered tighter at the header and deepening toward the
 *  hem, each wave a little different so the folds do not read as corrugated sheet. Inside
 *  the curtain's depth on both sides of its centre plane. */
export const curtainCloth = memoLast(buildCurtain, (dimMM: readonly number[], pleats: number) => `${dimMM.join('x')}|${pleats}`);

function buildCurtain(dimMM: readonly number[], pleats: number): SoftMeshData {
  const w = dimMM[0] / 1000;
  const d = dimMM[1] / 1000;
  const h = dimMM[2] / 1000;
  const n = Math.max(1, pleats);
  const strip = w / n;
  const amp = Math.max(0, Math.min(d / 2 - 0.002, strip * 0.45));
  const xs = even(-w / 2, w / 2, n * 4);
  const ys = even(-h / 2, h / 2 - 0.04, 16);
  const b = new Builder();
  b.grid(xs, ys, (x, y) => {
    const xi = (x + w / 2) / strip;
    const wave = Math.floor(xi / 2);
    const vary = 0.82 + 0.18 * Math.sin(wave * 2.39 + 0.5);
    const yn = (y + h / 2) / h;
    const deep = 0.72 + 0.28 * (1 - yn);
    // Rows run up the cloth, so `y` takes the place `z` has in a floor sheet: the
    // unflipped winding faces −z, toward the wall; drawn double-sided either way.
    return [x, y, amp * vary * deep * Math.sin(Math.PI * xi)];
  });
  return b.done();
}

// ─── Memo ────────────────────────────────────────────────────────────────────

/** A small most-recent cache for the per-piece meshes. A resize drag asks for a new size
 *  every frame; the cache keeps the last few rather than every size the drag passed. */
export function memoLast<A extends unknown[], R>(fn: (...a: A) => R, key: (...a: A) => string, keep = 24): (...a: A) => R {
  const cache = new Map<string, R>();
  return (...a: A) => {
    const k = key(...a);
    const hit = cache.get(k);
    if (hit !== undefined) {
      cache.delete(k);
      cache.set(k, hit);
      return hit;
    }
    const v = fn(...a);
    cache.set(k, v);
    if (cache.size > keep) cache.delete(cache.keys().next().value as string);
    return v;
  };
}

// Two surfaces of one piece drawn on the same plane, facing the same way.
//
// The depth buffer cannot order two surfaces at the same depth, so it picks one per pixel
// by rounding — and the rounding changes along the face, with the camera, every frame. On
// screen that is a sawtooth or a dashed seam at the edge where the two meet, and it reads
// as a shadow problem: the user's report on 2026-10-01 was "the shadow issue is across the
// platform", with a bed and a wardrobe in the pictures. Switching the key light's shadow
// off, a 4k shadow map and three times the normal bias all left those seams exactly where
// they were, because they were never shadows. The bed's duvet ended on the plane of the
// mattress's own front face; the wardrobe was five full-size slabs whose ends shared every
// outer face of the carcass, and its doors shared the plane of its sides' front edges.
//
// Nothing could see it below the browser: every gate reads WHERE a piece is and how much
// floor it takes, and a z-fight is two correct boxes in correct places. So this walks the
// same call tree `footprint-fidelity` does (`tests/helpers/geometry-walk.ts` — calling the
// components rather than rendering them) and asks the question directly, of every shape at
// every size the app can draw it.
//
// What counts: two axis-aligned boxes (or a box and a flat plane) whose faces on one
// side lie within `EPS` of each other and overlap in the other two axes by more than
// `EPS` both ways. FACING THE SAME WAY is the
// whole of it. Two boxes that ABUT (one's max face on the other's min face) draw faces
// pointing at each other; each is the other's back, culled or buried, and nothing fights.
// Boxes the walk cannot express as an axis-aligned box in the part's frame (a tilted
// slat, a swung door) are skipped and COUNTED, so a shape that escapes the sweep shows up
// as a number rather than a pass. The room's own skirting is not a piece and is not
// walked here; `tests/room-shell.test.ts` holds that half.

import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/store', () => ({
  useStudio: (sel: (s: unknown) => unknown) =>
    sel({ dims: {}, openState: new Proxy({}, { get: () => 0 }), hidden: {}, quality: 'high' }),
}));
// Same reason as `footprint-fidelity`: the presets' `normalMap` getters reach `document`.
vi.mock('@/components/three/materials', () => ({
  SURFACE: new Proxy({}, { get: () => ({}) }),
  PHYSICAL_SURFACES: ['fabric'],
}));

import { PartGeometry } from '@/components/three/DynamicPart';
import { SHAPES, PART_LIBRARY, type Shape, type ScenePart, type Category } from '@/lib/scene-spec';
import { dimRangeFor } from '@/lib/dimension-ranges';
import { walk, type Prim } from './helpers/geometry-walk';

/** Metres. A tenth of a millimetre: well under any offset a renderer means on purpose,
 *  and far above float noise in the transform stack. */
const EPS = 1e-4;

/** Boxes the sweep reaches on the two reported pieces at their library size. */
const PRINT = { wardrobe: 16, bed: 10 };

const categoryOf = (shape: Shape): Category =>
  PART_LIBRARY.find((l) => l.shape === shape)?.category ?? 'other';

const partAt = (shape: Shape, dimMM: [number, number, number]): ScenePart =>
  ({
    id: `probe-${shape}`,
    name: shape,
    shape,
    category: categoryOf(shape),
    dimMM,
    pos: [0, 0, 0],
    rot: 0,
    color: '#b07a52',
  }) as unknown as ScenePart;

type Aabb = { lo: [number, number, number]; hi: [number, number, number]; kind: string; i: number };

/** A box primitive as an axis-aligned box, or null when its corners say it is turned. */
function aabbOf(p: Prim, i: number): Aabb | null {
  if (!['Box', 'boxGeometry', 'planeGeometry', 'BoxInstances', 'PlaneInstances'].includes(p.kind)) return null;
  if (p.spun) return null;
  const distinct = (vs: number[]) => {
    const out: number[] = [];
    for (const v of vs) if (!out.some((o) => Math.abs(o - v) < 1e-7)) out.push(v);
    return out;
  };
  const xs = distinct(p.pts.map((q) => q[0]));
  const zs = distinct(p.pts.map((q) => q[1]));
  // Eight corners of an axis-aligned box take at most two values per axis. A box turned
  // about Y takes four on both; one tilted about X takes four on Z. `y` is a range only,
  // so a tilt that keeps X and Z to two values each (none in the catalogue) would pass —
  // said rather than assumed.
  if (xs.length > 2 || zs.length > 2) return null;
  // ...and they take EVERY pairing of those values. A flat plane turned about Y also
  // touches only two X and two Z values, at two opposite corners of the box they span —
  // which read as a box the first time this ran, and filed every fold of the curtain as
  // coplanar with its neighbour.
  const pairs = distinct(p.pts.map((q) => q[0] * 1e4 + q[1]));
  if (pairs.length !== xs.length * zs.length) return null;
  return {
    lo: [Math.min(...xs), p.y[0], Math.min(...zs)],
    hi: [Math.max(...xs), p.y[1], Math.max(...zs)],
    kind: p.kind,
    i,
  };
}

type Fight = { axis: 'x' | 'y' | 'z'; side: 'lo' | 'hi'; at: number; a: number; b: number; area: number };

const AXES = ['x', 'y', 'z'] as const;

function fights(prims: Prim[]): { found: Fight[]; checked: number; skipped: number } {
  const boxes: Aabb[] = [];
  let skipped = 0;
  prims.forEach((p, i) => {
    const b = aabbOf(p, i);
    if (b) boxes.push(b);
    else skipped++;
  });
  const found: Fight[] = [];
  for (let m = 0; m < boxes.length; m++) {
    for (let n = m + 1; n < boxes.length; n++) {
      const A = boxes[m];
      const B = boxes[n];
      for (let a = 0; a < 3; a++) {
        const [u, v] = [0, 1, 2].filter((k) => k !== a);
        const ou = Math.min(A.hi[u], B.hi[u]) - Math.max(A.lo[u], B.lo[u]);
        const ov = Math.min(A.hi[v], B.hi[v]) - Math.max(A.lo[v], B.lo[v]);
        if (ou <= EPS || ov <= EPS) continue;
        for (const side of ['lo', 'hi'] as const) {
          if (Math.abs(A[side][a] - B[side][a]) >= EPS) continue;
          // Resting on the floor: the floor hides both, from every camera the app has.
          if (a === 1 && side === 'lo' && A.lo[1] < EPS) continue;
          // Hidden: a third box covers the shared patch and fills the space the two faces
          // look into — straddling the plane (the patch is buried inside it: two aprons
          // crossing inside a leg) or standing on it from the outward side (the patch is
          // pressed against it: those aprons' tops under the tabletop they carry). Either
          // way no camera reaches the patch, so nothing on screen fights.
          const at = A[side][a];
          const patchLo = [0, 0, 0];
          const patchHi = [0, 0, 0];
          patchLo[a] = patchHi[a] = at;
          patchLo[u] = Math.max(A.lo[u], B.lo[u]);
          patchHi[u] = Math.min(A.hi[u], B.hi[u]);
          patchLo[v] = Math.max(A.lo[v], B.lo[v]);
          patchHi[v] = Math.min(A.hi[v], B.hi[v]);
          const hidden = boxes.some(
            (C) =>
              C !== A && C !== B &&
              [0, 1, 2].every((k) =>
                k === a
                  ? side === 'hi'
                    ? C.lo[k] <= at + EPS && C.hi[k] > at + EPS
                    : C.hi[k] >= at - EPS && C.lo[k] < at - EPS
                  : C.lo[k] <= patchLo[k] + EPS && C.hi[k] >= patchHi[k] - EPS,
              ),
          );
          if (hidden) continue;
          found.push({ axis: AXES[a], side, at, a: A.i, b: B.i, area: ou * ov });
        }
      }
    }
  }
  return { found, checked: boxes.length, skipped };
}

function sizesFor(shape: Shape): Array<[string, [number, number, number]]> {
  const r = dimRangeFor(categoryOf(shape), shape);
  const lib = PART_LIBRARY.find((l) => l.shape === shape)?.dimMM as [number, number, number] | undefined;
  const mid = [0, 1, 2].map((k) => Math.round((r.min[k] + r.max[k]) / 2)) as [number, number, number];
  return [
    ['min', r.min as [number, number, number]],
    ['lib', lib ?? mid],
    ['max', r.max as [number, number, number]],
  ];
}

describe('no piece draws two of its own surfaces on one plane', () => {
  const rows = SHAPES.flatMap((shape) =>
    sizesFor(shape).map(([size, dim]) => {
      const rep = walk(PartGeometry({ part: partAt(shape, dim), locked: false }));
      return { shape, size, ...fights(rep.prims), prims: rep.prims.length };
    }),
  );

  it('sweeps the whole catalogue at three sizes', () => {
    // Pinned as a literal: a floor (`> 0`) passes when half the catalogue stops walking.
    expect(rows.length).toBe(SHAPES.length * 3);
    expect(rows.every((r) => r.prims > 0)).toBe(true);
  });

  it('reaches the boxes of the pieces it was written against', () => {
    // The two pieces in the report, by name and as literals. A sweep that skipped them —
    // a renamed primitive, a walk that stopped descending, an `aabbOf` that started
    // calling every box turned — would report zero fights about pieces it never looked
    // at, which is the green this file exists to stop meaning nothing.
    const at = (shape: Shape) => rows.find((r) => r.shape === shape && r.size === 'lib')!;
    expect(at('wardrobe').checked).toBe(PRINT.wardrobe);
    expect(at('bed-double').checked).toBe(PRINT.bed);
    const checked = rows.reduce((n, r) => n + r.checked, 0);
    const skipped = rows.reduce((n, r) => n + r.skipped, 0);
    console.log(`coplanar sweep: ${checked} axis-aligned boxes checked, ${skipped} primitives not boxes (round, turned, swung)`);
  });

  it('reports, per shape, every same-facing coplanar pair', () => {
    const bad = rows.filter((r) => r.found.length > 0);
    for (const r of bad) {
      console.log(
        `${r.shape}/${r.size}: ${r.found.length} fight(s), e.g. ` +
          r.found
            .slice(0, 40)
            .map((f) => `${f.side}-${f.axis}@${(f.at * 1000).toFixed(1)}mm #${f.a}/#${f.b} ${(f.area * 1e6).toFixed(0)}mm²`)
            .join('; '),
      );
    }
    expect(bad.map((r) => `${r.shape}/${r.size}`)).toEqual([]);
  });
});

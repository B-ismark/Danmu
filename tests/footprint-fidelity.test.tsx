// Row 12 / 4a — the ground truth for "does one box per piece change an answer?"
//
// `docs/research/suggest-and-collision.md` § 4.1 records the limitation ("There is no
// per-shape hull anywhere") and the build scope says 4a is not worth doing "if the
// compound footprints do not change any reported outcome. Unmeasured, and the
// measurement is cheap next to the build." Nothing could measure it, because the only
// statement of what a shape occupies is its renderer, and CLAUDE.md rule 2 names a TSX
// renderer as precisely where arithmetic hides from every gate.
//
// `tests/helpers/geometry-walk.ts` reaches it by CALLING the components rather than
// rendering them. This file turns that into a table.
//
// Denominator is FIXED: every shape in `SHAPES`, at three sizes each. A shape that fits
// inside its own box is an outcome, not a row to skip. Both directions are reported per
// row, because they are different defects: `fill` is how much of the declared box the
// geometry does NOT occupy (the box is too generous — false positives), `outside` is how
// much geometry escapes the declared box (the box is too small — false NEGATIVES, which
// the research document does not consider possible).

import { describe, expect, it, vi } from 'vitest';

// `openState` is a MEASUREMENT PARAMETER, not scenery. At 0 every door and drawer in the
// catalogue is shut, and a shut wardrobe is the only wardrobe the table below describes —
// which would be a silent caveat on every row for the two shapes that can open. The mock
// reads a mutable value so one test can ask the other question, and the table states which
// answer it is publishing.
let openAmount = 0;
vi.mock('@/lib/store', () => ({
  useStudio: (sel: (s: unknown) => unknown) =>
    sel({ dims: {}, openState: new Proxy({}, { get: () => openAmount }), hidden: {}, quality: 'high' }),
}));

// `SURFACE.fabric` and `SURFACE.wood` expose `normalMap` as a GETTER that builds a
// canvas-backed texture, so spreading one into a material element reaches `document`.
// Three renderers spread it (`FloorLampGeo`, `TableLampGeo`, `MirrorGeo`) and threw
// `document is not defined` — the walk reported that rather than counting them as
// shapes that drew nothing, which is the failure this instrument exists to avoid.
// A material carries no geometry, so replacing the presets cannot move a footprint.
vi.mock('@/components/three/materials', () => ({
  SURFACE: new Proxy({}, { get: () => ({}) }),
  PHYSICAL_SURFACES: ['fabric'],
}));

import { PartGeometry } from '@/components/three/DynamicPart';
import { SHAPES, PART_LIBRARY, type Shape, type ScenePart, type Category } from '@/lib/scene-spec';
import { isParametric } from '@/lib/scene-spec';
import { dimRangeFor } from '@/lib/dimension-ranges';
import { walk, horizontalBounds, unionArea } from './helpers/geometry-walk';

/** Rasterisation step for every area in this file, metres. Quoted with the numbers
 *  it produces, because a sampled area without its step is not a measurement. */
const STEP = 0.005;

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

type Row = {
  shape: Shape;
  size: 'min' | 'lib' | 'max';
  dim: [number, number, number];
  /** furthest the drawn geometry reaches beyond the declared half-width, mm */
  overX: number;
  /** same on the depth axis, mm */
  overZ: number;
  /** drawn floor area INSIDE the declared box ÷ the declared box's area */
  fill: number;
  /** drawn floor area OUTSIDE the declared box ÷ the declared box's area */
  outside: number;
  /** the y-range of whatever escapes, so a canopy can be told from a leg */
  overY: [number, number] | null;
  prims: number;
  /** true = the renderer is handed the RESIZED dim, so all three rows are sizes the
   *  app really draws. false = the piece is authored at `dimMM` and wears a resize as
   *  a uniform group scale, so the ratios are size-invariant and only the AUTHORED dim
   *  is a real configuration. */
  param: boolean;
};

function measure(shape: Shape, size: Row['size'], dim: [number, number, number]): Row {
  const rep = walk(PartGeometry({ part: partAt(shape, dim), locked: false }));
  if (Object.keys(rep.unhandled).length || Object.keys(rep.threw).length) {
    throw new Error(`${shape}/${size}: walk incomplete ${JSON.stringify({ ...rep.unhandled, ...rep.threw })}`);
  }
  const hw = dim[0] / 2000;
  const hd = dim[1] / 2000;
  const b = horizontalBounds(rep.prims);
  const overX = Math.max(0, b.x1 - hw, -b.x0 - hw) * 1000;
  const overZ = Math.max(0, b.z1 - hd, -b.z0 - hd) * 1000;

  const declared = { x0: -hw, x1: hw, z0: -hd, z1: hd };
  const inside = unionArea(rep.prims, declared, STEP);
  const whole = unionArea(rep.prims, {
    x0: Math.min(b.x0, -hw), x1: Math.max(b.x1, hw),
    z0: Math.min(b.z0, -hd), z1: Math.max(b.z1, hd),
  }, STEP);
  const boxArea = hw * 2 * hd * 2;

  // Which primitives are the ones escaping, and how high they sit.
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of rep.prims) {
    const out = p.pts.some(([x, z]) => Math.abs(x) > hw + 1e-9 || Math.abs(z) > hd + 1e-9);
    if (out) { lo = Math.min(lo, p.y[0]); hi = Math.max(hi, p.y[1]); }
  }

  return {
    shape, size, dim, overX, overZ,
    fill: inside / boxArea,
    outside: (whole - inside) / boxArea,
    overY: lo === Infinity ? null : [lo, hi],
    prims: rep.prims.length,
    param: isParametric(shape),
  };
}

function rowsFor(shape: Shape): Row[] {
  const r = dimRangeFor(categoryOf(shape), shape);
  const lib = PART_LIBRARY.find((l) => l.shape === shape)?.dimMM;
  const mid: [number, number, number] = [
    Math.round((r.min[0] + r.max[0]) / 2),
    Math.round((r.min[1] + r.max[1]) / 2),
    Math.round((r.min[2] + r.max[2]) / 2),
  ];
  return [
    measure(shape, 'min', r.min as [number, number, number]),
    // `closet`, `cylinder` and `plane` are not in PART_LIBRARY; the range midpoint
    // stands in, and the row is the same row either way — no shape is dropped.
    measure(shape, 'lib', (lib ?? mid) as [number, number, number]),
    measure(shape, 'max', r.max as [number, number, number]),
  ];
}

describe('what a shape actually occupies, against the one box every consumer reads', () => {
  const rows: Row[] = SHAPES.flatMap(rowsFor);

  it('the walk reproduces a shape whose footprint IS its box', () => {
    // The control. `BoxGeo` draws one `Box` at `dimMM`, so a correct walk returns the
    // declared extents exactly — which is a statement about the transform maths, not a
    // restatement of the claim under test. Any error in the matrix stack shows here
    // before it can be read as a finding about a real shape.
    const box = rows.filter((r) => r.shape === 'box');
    expect(box).toHaveLength(3);
    for (const r of box) {
      expect(r.overX, `box/${r.size} overX`).toBeCloseTo(0, 6);
      expect(r.overZ, `box/${r.size} overZ`).toBeCloseTo(0, 6);
      expect(r.fill, `box/${r.size} fill`).toBeGreaterThan(0.99);
    }
  });

  it('every shape actually draws something, so the table is not 138 rows of nothing', () => {
    // Without this the file's only assertions were the `box` control and a row count, and
    // EVERY OTHER RENDERER COULD RETURN null with all of it green: `prims` would be 0,
    // `fill` 0, `overX` 0, and a shape drawing nothing reads exactly like a shape that
    // fits its box perfectly. Both columns of `§ 4.6` would go to zero and the
    // conclusion would flip to "the box is always right" with no test to say otherwise.
    for (const r of rows) {
      expect(r.prims, `${r.shape}/${r.size} draws no primitives at all`).toBeGreaterThan(0);
    }
    // `mirror-oval` is the one shape that draws only vertical planes, so it has no floor
    // area by construction — and it is pinned from BOTH sides. Asserting only that the
    // others are non-zero would let a second shape join it silently, and asserting only
    // that this one is zero would survive it starting to draw a floor.
    const flat = new Set(rows.filter((r) => r.fill === 0).map((r) => r.shape));
    expect([...flat], 'shapes with no floor area at all').toEqual(['mirror-oval']);
    for (const r of rows) {
      if (r.shape === 'mirror-oval') expect(r.fill, `${r.shape}/${r.size}`).toBe(0);
      else expect(r.fill, `${r.shape}/${r.size} covers none of its own box`).toBeGreaterThan(0);
    }
  });

  it('says how far an OPEN door and drawer reach, and which way they go', () => {
    // Two shapes read `openState`: `WardrobeGeo` swings its doors `open * 1.15` rad about
    // each bay's outer edge, and `NightstandGeo` slides its drawer faces forward along +z.
    // Every row above is measured shut, so for these two the table was one of two answers
    // and did not say which — a number correct about its subject and silent about its own
    // conditions, which is the failure this repo keeps finding.
    //
    // It is a RAMP rather than an on/off switch, because the direction and the magnitude
    // are two claims and a single open/shut pair can establish only the first.
    const AMOUNTS = [0, 0.25, 0.5, 0.75, 1];
    const lines: string[] = [];
    let anyMoved = 0;
    let inward = 0;
    for (const shape of ['wardrobe', 'nightstand'] as Shape[]) {
      const dim = PART_LIBRARY.find((l) => l.shape === shape)!.dimMM as [number, number, number];
      const reach = AMOUNTS.map((a) => {
        openAmount = a;
        const r = measure(shape, 'lib', dim);
        return Math.max(r.overX, r.overZ);
      });
      openAmount = 0;
      const moved = Math.max(...reach) - Math.min(...reach);
      anyMoved = Math.max(anyMoved, moved);
      // Monotone DOWN across the whole ramp: opening the piece makes its drawn footprint
      // smaller at every step. A door or a drawer cannot do that by moving outward.
      const shrinks = reach.every((v, i) => i === 0 || v <= reach[i - 1] + 1e-9) && moved > 1;
      if (shrinks) inward++;
      lines.push(
        `  ${shape.padEnd(12)} ${reach.map((v) => v.toFixed(0).padStart(6)).join('')}` +
          `${shrinks ? '   <<< reaches LESS far open than shut' : ''}`,
      );
    }
    console.log(
      '\nOPEN vs SHUT — furthest the geometry reaches outside `dimMM`, mm, at open =' +
        ` ${AMOUNTS.join(' / ')}\n` +
        lines.join('\n') +
        '\n  `wardrobe` swinging INWARD is a finding, not a measurement artefact: at any' +
        '\n  open > 0 its bounds are exactly the declared box, so the doors are inside the' +
        '\n  carcass. See the note in this test and § 4.6.',
    );
    // Both halves of the fixture must reach the open state, or one of these rows is two
    // identical numbers reading as "opening it changes nothing".
    expect(anyMoved, 'the open state must actually move geometry').toBeGreaterThan(1);
    // The finding, pinned so that fixing the renderer fails this test rather than passing
    // it silently. `WardrobeGeo` rotates each door group by `[0, dir * swing, 0]`, and a
    // rotation about +Y carries local +x toward -z — so a door extending along +x from a
    // hinge on the front face swings INTO the wardrobe. Flipping the sign sends the far
    // edge to z = 0.824 at the library size, 524 mm proud of the face, and the ramp
    // becomes monotone upward. That is a one-line change to a renderer, it wants an eye
    // rather than a test, and it is deliberately not made here: this PR touches no
    // production code. Update this expectation in the same commit as the fix.
    expect(inward, 'shapes whose footprint shrinks as they open').toBe(1);
  });

  it('prints the table', () => {
    const f = (n: number, w: number, d = 0) => n.toFixed(d).padStart(w);
    console.log(
      `\nFOOTPRINT vs dimMM — every shape, three sizes, ${STEP * 1000} mm raster` +
        `\n  over{X,Z} mm : furthest the drawn geometry reaches OUTSIDE the declared box` +
        `\n  fill         : drawn floor area inside the box ÷ box area  (low = box too generous)` +
        `\n  outside      : drawn floor area outside the box ÷ box area (>0 = box too SMALL)\n`,
    );
    console.log('shape                size  par    W     D   overX  overZ   fill  outside  prims  escapes at y');
    for (const r of rows) {
      const flag = r.overX > 1 || r.overZ > 1 ? ' <<<' : '';
      console.log(
        `${r.shape.padEnd(20)} ${r.size.padEnd(4)} ${r.param ? ' P ' : ' . '} ${f(r.dim[0], 5)} ${f(r.dim[1], 5)} ` +
          `${f(r.overX, 6, 1)} ${f(r.overZ, 6, 1)} ${f(r.fill, 6, 2)} ${f(r.outside, 7, 2)} ` +
          `${f(r.prims, 6)}  ${r.overY ? `${r.overY[0].toFixed(2)}…${r.overY[1].toFixed(2)}` : '—'}${flag}`,
      );
    }

    const denom = rows.length;
    const escaping = rows.filter((r) => r.overX > 1 || r.overZ > 1);
    const shapesEscaping = new Set(escaping.map((r) => r.shape));
    console.log(
      `\nrows ${denom} = ${SHAPES.length} shapes x 3 sizes` +
        `\n  geometry outside the declared box (>1 mm) : ${escaping.length} rows, ${shapesEscaping.size} shapes` +
        `\n  [${[...shapesEscaping].join(', ')}]`,
    );
    expect(denom).toBe(SHAPES.length * 3);
  });
});

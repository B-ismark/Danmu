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
import { walk, horizontalBounds, occupiedPts, unionArea } from './helpers/geometry-walk';

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
  /** what the renderer DRAWS, mm, on [x, z, y] — to be read against `dim` */
  span: [number, number, number];
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
  //
  // `occupiedPts`, not `p.pts` — this was the FOURTH reader of the rest pose and it was
  // missed on the first pass of the same fix, which found the other three. It changes no
  // number today (the fan sweeps to exactly `hw`, so it escapes by nothing either way),
  // and that is the reason to change it rather than a reason not to: a reader that agrees
  // by coincidence is the one that diverges silently later.
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of rep.prims) {
    const out = occupiedPts(p).some(([x, z]) => Math.abs(x) > hw + 1e-9 || Math.abs(z) > hd + 1e-9);
    if (out) { lo = Math.min(lo, p.y[0]); hi = Math.max(hi, p.y[1]); }
  }

  // What the renderer actually DRAWS, on all three axes, against what the piece declares.
  // `overX` / `overZ` only answer "does it escape"; a piece can sit entirely inside its box
  // and still be the wrong size, which is the half nothing here measured. A plant declaring
  // 400 mm and drawing 920 is a defect; so is one declaring 1200 and drawing 920.
  let ylo = Infinity;
  let yhi = -Infinity;
  for (const p of rep.prims) {
    ylo = Math.min(ylo, p.y[0]);
    yhi = Math.max(yhi, p.y[1]);
  }
  const span: [number, number, number] = [
    (b.x1 - b.x0) * 1000,
    (b.z1 - b.z0) * 1000,
    ylo === Infinity ? 0 : (yhi - ylo) * 1000,
  ];

  return {
    shape, size, dim, overX, overZ, span,
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

  it('measures a spinning shape as the disc it sweeps, not as its rest pose', () => {
    // **The assertion `occupiedPts` owes, and the reason it is here rather than in the
    // ratio table.** Making `horizontalBounds` sweep moves the fan row, which the table
    // catches. Making `unionArea` sweep moves only `fill`, which nothing above pins
    // harder than `> 0` — so half the fix was landing unasserted, which is the exact
    // shape of defect this file exists to find.
    //
    // A ceiling fan is three blades. At rest they cover 22% of the declared box and the
    // box looks wildly too generous; swept, they cover the INSCRIBED DISC of it, which
    // is pi/4 = 0.785 and is precisely the circle `PlanView` draws for a `ROUND_SHAPES`
    // member. So this number is the two tabs agreeing, not a curiosity: the geometry
    // occupies what the plan claims it occupies.
    //
    // Banded rather than exact because `unionArea` rasterises at `STEP`; the disc is
    // sampled, not integrated.
    const fan = rowsFor('fan').find((q) => q.size === 'lib')!;
    expect(fan.fill, `a swept fan covers its inscribed disc`).toBeGreaterThan(0.75);
    expect(fan.fill, `...and no more than the box it is inscribed in`).toBeLessThan(0.81);

    // The negative control, and it is what separates "swept" from "big": the SAME
    // primitives read at rest cover far less. Without this, returning the whole box
    // from `occupiedPts` would pass the two bounds above.
    const rep = walk(PartGeometry({ part: partAt('fan', [1000, 1000, 200]), locked: false }));
    expect(rep.prims.filter((q) => q.spun), `the fixture must reach the spun branch`).toHaveLength(3);
    const rest = unionArea(
      rep.prims.map((q) => ({ ...q, spun: false })),
      { x0: -0.5, x1: 0.5, z0: -0.5, z1: 0.5 },
      STEP,
    );
    expect(rest, `the rest pose is what this used to measure`).toBeLessThan(0.3);
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
    const moves = new Map<Shape, number>();
    const ramps = new Map<Shape, number[]>();
    for (const shape of ['wardrobe', 'nightstand'] as Shape[]) {
      const dim = PART_LIBRARY.find((l) => l.shape === shape)!.dimMM as [number, number, number];
      const reach = AMOUNTS.map((a) => {
        openAmount = a;
        const r = measure(shape, 'lib', dim);
        return Math.max(r.overX, r.overZ);
      });
      openAmount = 0;
      const moved = Math.max(...reach) - Math.min(...reach);
      moves.set(shape, moved);
      ramps.set(shape, reach);
      // Monotone DOWN across the whole ramp: opening the piece makes its drawn footprint
      // smaller at every step. A door or a drawer cannot do that by moving outward. Read
      // by the printed table below rather than by an assertion — the per-shape monotone
      // loop is what fails on it, and it names the shape and the step.
      const shrinks = reach.every((v, i) => i === 0 || v <= reach[i - 1] + 1e-9) && moved > 1;
      lines.push(
        `  ${shape.padEnd(12)} ${reach.map((v) => v.toFixed(0).padStart(6)).join('')}` +
          `${shrinks ? '   <<< reaches LESS far open than shut' : ''}`,
      );
    }
    console.log(
      '\nOPEN vs SHUT — furthest the geometry reaches outside `dimMM`, mm, at open =' +
        ` ${AMOUNTS.join(' / ')}\n` +
        lines.join('\n'),
    );
    // PER SHAPE, not a maximum over them. Written as one `Math.max` across both rows it
    // was decoration for the nightstand: zeroing its drawer slide outright left the
    // wardrobe's own 12 mm of movement satisfying the assertion, and the mutation
    // survived. Half a table pinned is the same defect as none of it.
    for (const shape of moves.keys()) {
      expect(moves.get(shape), `${shape} does not move at all as it opens`).toBeGreaterThan(1);
    }
    // This read `.toBe(1)` and pinned a DEFECT: `WardrobeGeo` rotated each door group by
    // `[0, dir * swing, 0]`, and a rotation about +Y carries local +x toward -z, so a door
    // extending along +x from a hinge on the front face swung into the carcass. The ramp
    // read 12 / 0 / 0 / 0 / 0 — at any open above zero the wardrobe's bounds were exactly
    // its declared box, which an outward-swinging door cannot produce. It is
    // `-dir * swing` now and the ramp is 12 / 164 / 314 / 437 / 524.
    //
    // An `expect(inward).toBe(0)` used to stand here, with a paragraph arguing it was
    // kept rather than deleted. The argument was wrong: `inward` counts shapes whose
    // footprint shrinks at some step, and the per-shape monotone loop below asserts
    // `ramp[i] > ramp[i - 1]` at EVERY step of EVERY shape, which no shrinking shape can
    // satisfy. It was entailed, so it could never fail alone — and it reported a bare
    // count where the loop names the shape and the step that broke.
    //
    // WHAT THIS RAMP STILL CANNOT SEE, measured rather than assumed. Mutating the door
    // rotation from `-dir * swing` to `-swing` — dropping the per-bay hinge factor, so
    // the odd-numbered bays swing INTO the carcass while the even ones swing out —
    // leaves this file at 4 passed with the wardrobe ramp byte-identical at
    // 12 / 164 / 314 / 437 / 524. Both controls die as they should: restoring the old
    // `dir * swing` and hinging on the back face are each red on the first step. The
    // blind spot is structural — `overX` / `overZ` reduce the whole part to
    // `Math.max(r.overX, r.overZ)`, one unsigned scalar over all bays and both axes, so
    // a bay reaching the wrong way is hidden by any other bay reaching further the right
    // way.
    //
    // Deliberately NOT patched here. Every candidate assertion that would catch it has to
    // know where the bays are, which means importing a second source of truth about bay
    // tiling into a test whose whole subject is that the geometry and `dimMM` agree — and
    // the three swept sizes give 1, 4 and 5 bays, so the fixture cannot even hold one
    // answer. A per-bay footprint is the real fix and it belongs with the compound-
    // footprint work, not with a sign flip.
    for (const [shape, ramp] of ramps) {
      for (let i = 1; i < ramp.length; i++) {
        expect(
          ramp[i],
          `${shape} reaches less far at open ${AMOUNTS[i]} than at ${AMOUNTS[i - 1]}`,
        ).toBeGreaterThan(ramp[i - 1]);
      }
    }
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

  // A BUDGET FOR EVERY SHAPE, not a threshold with a list of things excused from it.
  //
  // The table above has printed "32 shapes draw outside their box" on every green run for
  // as long as it has existed, and nothing failed, so the number was read as scenery. It
  // is not: `footFromPart` gives ONE box per piece, and the plan, `plan-hit` picking,
  // `footOverlap`, `outsideShare`, every clearance answer and the solver's own cost all
  // read that box. A piece drawing outside it has the 3D tab and every other consumer
  // disagreeing about how much floor it occupies.
  //
  // MEASURED AT THE `lib` ROW ONLY, and that is a real distinction rather than a
  // convenience. For a shape outside `PARAMETRIC_SHAPES` the renderer is authored once and
  // a resize arrives as a uniform group scale applied by `Draggable`, so `min` and `max`
  // here are not configurations the app ever draws — only the authored dim is. Asserting
  // over all three would pin two rows per shape that mean nothing and would have to be
  // widened to accommodate them, which is how a gate stops being one.
  //
  // Every shape gets an answer: `OVERHANG_MM` if it is named, `DEFAULT_OVERHANG_MM`
  // otherwise. `Object.keys` of the exception table is asserted too, so deleting a row to
  // make a red go away fails a different assertion instead of silently relaxing the gate.
  const DEFAULT_OVERHANG_MM = 60;
  const OVERHANG_MM: Partial<Record<Shape, number>> = {
    // `plant: 260` stood here for one commit and is GONE rather than kept at 0. It excused
    // the worst instance of the defect this file exists to find — `PlantGeo` drew
    // 880 x 700 x 1940 against a declared 400 x 400 x 1600 — and the moment the renderer was
    // made to read `dimMM`, the entry became a licence nothing needed. An exception that no
    // longer excuses anything is the most dangerous row in a table like this: it reads as a
    // known limitation and quietly permits a 260 mm regression forever.
    //
    // Physical rather than a slip, and the distinction is why it is 70 and not 260. The
    // lid is hinged at the back edge (`-d / 2 + 0.01`) and tilted -0.34 rad, so an OPEN
    // screen leans behind the base — which is what a real laptop does. `dimMM`'s depth
    // describes the base, so the lid's sweep is outside it by 68.1 mm at the library size
    // and the ratio grows with the piece (44.7 / 68.1 / 94.8 across min / lib / max).
    // Closing it would mean either standing the screen up or restating the depth; both
    // are worse than recording 70 mm of leaning screen. Found BY this gate on its first
    // run, not before it — it sat under the eyeball threshold used to draft the table.
    laptop: 70,
  };

  // WHAT THE PIECE DRAWS AGAINST WHAT IT DECLARES, which is a different question from
  // `overX`/`overZ` above. Those only ask whether geometry ESCAPES the box; a piece can sit
  // entirely inside its box and still be the wrong size, and nothing measured that until
  // now. The plan draws `dimMM` through `footFromPart`, the 3D tab draws the geometry, so a
  // ratio away from 1 is the two tabs showing one piece at two sizes.
  //
  // Default band is 0.90–1.10. Everything outside it is NAMED with its measured ratio and
  // held to ±0.03, so each is a pin rather than an excuse — and the key set is asserted, so
  // adding a row cannot be the cheap way to green a red.
  // A pinned shape is held to its recorded ratio to within this, which is THREE TIMES
  // TIGHTER than the 0.90-1.10 band an unpinned shape gets. The pin is the strict case,
  // not the excuse: it holds a known mismatch still rather than merely recording it.
  //
  // Asserted from ABOVE below, because a tolerance is free at the top and this one was.
  // Widening it 0.03 -> 0.5 was mutated and killed NOTHING: all seven tests stayed green
  // at sixteen times the slack. Measured spread is far smaller again — setting it to 0
  // reports every one of the eleven pinned rows, and each matches its pin to the two
  // decimals this table prints, so no real deviation reaches 0.005. 0.03 is already six
  // times the noise; 0.5 is a hundred times, and nothing said so.
  const RATIO_TOL = 0.03;
  const DRAWN_RATIO: Partial<Record<Shape, [number, number, number]>> = {
    // Real protrusions above the declared box, all on ONE axis and all defensible: a bed's
    // headboard rises past the mattress height `dimMM` describes, a monitor and a laptop
    // lean back past their base, a door and a mirror carry a handle and a frame.
    'bed-single': [1.0, 1.01, 1.4],
    'bed-double': [1.0, 1.01, 1.4],
    monitor: [1.0, 1.5, 0.98],
    laptop: [1.0, 1.4, 1.04],
    door: [1.0, 1.5, 1.0],
    mirror: [1.05, 1.5, 1.02],
    'mirror-oval': [1.1, 0.83, 1.05],
    window: [1.1, 2.0, 1.11],
    'water-dispenser': [1.0, 1.14, 1.02],
    // A rug is 5 mm of declared thickness and 21 mm of drawn pile plus its border. The ratio
    // is 4.2 and the absolute error is 16 mm, which is the case for reading BOTH columns.
    rug: [1.0, 1.0, 4.2],
    // **`fan` was pinned here at [0.82, 0.95, 1.0] and it was never a size defect.** Three
    // blades at 0/120/240 have an asymmetric REST bbox — x runs -319.3 to +500.0, giving
    // 819.3 — and `measure` was reading the rest pose for a shape that spins. The helper
    // declared a `spun` flag for exactly this and only `worldHulls` read it; it is
    // `occupiedPts` now, so all three readers sweep and the fan measures 1.00/1.00/1.00.
    // The blade also had a real 6.4 mm overhang hiding under the same reading (the swept
    // point is a CORNER, `hypot(tip, chord/2)`), fixed in `fanBlade` by sizing the
    // centre-line so the corner lands on the radius.
    //
    // The lesson is the row, not the fan: **a measurement disagreeing with a declared
    // number is exactly as likely to be the instrument as the subject**, and this table
    // had already caught six renderers by then, which is what made the seventh reading
    // look like a seventh finding.
    //
    // `fan-standing` WAS here at [1.0, 0.68, 1.0] and is deliberately gone rather than
    // re-pinned. Nothing about it spins (`spun` 0 of 4 primitives), so unlike the ceiling
    // fan the 0.68 was the subject and not the instrument: it is genuinely 450 wide and
    // 306 deep, and it declared 450 x 450. § 39 was that declared number, and the user
    // ruled on it — 450 x 310, the base rather than the cage. At 306/310 the row sits
    // inside the ordinary 0.90-1.10 band, so the excuse is RETIRED rather than adjusted.
    // That is the outcome to want from one of these: the list below gets shorter.
    // A plane has no height by definition; `dimMM[2]` is what a resize would scale.
    plane: [1.0, 1.0, 0.0],
  };

  it('draws every shape at the size it declares', () => {
    const rows = SHAPES.map((s) => rowsFor(s).find((q) => q.size === 'lib')!);
    const f = (n: number, w: number, d = 0) => n.toFixed(d).padStart(w);
    console.log('\nDECLARED vs DRAWN at the catalogue size, mm — ratio drawn/declared');
    console.log('shape                  decW  decD  decH | drwW  drwD  drwH |   rW    rD    rH');
    const off: string[] = [];
    for (const r of rows) {
      const ratio: [number, number, number] = [
        r.span[0] / r.dim[0], r.span[1] / r.dim[1], r.span[2] / r.dim[2],
      ];
      const pin = DRAWN_RATIO[r.shape];
      const bad = pin
        ? ratio.some((v, i) => Math.abs(v - pin[i]) > RATIO_TOL)
        : ratio.some((v) => v < 0.9 || v > 1.1);
      if (bad) off.push(`${r.shape} ${ratio.map((v) => v.toFixed(2)).join('/')}${pin ? ` vs pinned ${pin.join('/')}` : ''}`);
      console.log(
        `${r.shape.padEnd(20)} ${f(r.dim[0], 5)} ${f(r.dim[1], 5)} ${f(r.dim[2], 5)} |` +
          ` ${f(r.span[0], 5)} ${f(r.span[1], 5)} ${f(r.span[2], 5)} |` +
          ` ${f(ratio[0], 5, 2)} ${f(ratio[1], 5, 2)} ${f(ratio[2], 5, 2)}${pin ? '  pinned' : ''}${bad ? '  <<<' : ''}`,
      );
    }
    expect(rows.length, 'every shape, not whatever the sweep found').toBe(SHAPES.length);
    expect(off, 'shapes drawing at a size other than the one they declare').toEqual([]);

    // The tolerance itself, pinned from above. Every assertion in this file measures a
    // ratio against RATIO_TOL, so RATIO_TOL is the one number here that no assertion can
    // reach - widening it makes every pinned row pass more easily and reddens nothing.
    // That is the whole failure mode of a one-sided pin, and it was live: 0.5 survived.
    expect(RATIO_TOL, 'a tolerance is free at the top, so it needs its own ceiling').toBeLessThanOrEqual(0.03);
    expect(Object.keys(DRAWN_RATIO).sort(), 'shapes excused from the 0.90–1.10 band').toEqual([
      'bed-double', 'bed-single', 'door', 'laptop', 'mirror',
      'mirror-oval', 'monitor', 'plane', 'rug', 'water-dispenser', 'window',
    ]);
  });

  it('keeps every shape inside the one box every consumer reads', () => {
    const over: string[] = [];
    for (const shape of SHAPES) {
      const r = rowsFor(shape).find((q) => q.size === 'lib')!;
      const budget = OVERHANG_MM[shape] ?? DEFAULT_OVERHANG_MM;
      const worst = Math.max(r.overX, r.overZ);
      if (worst > budget) over.push(`${shape} ${worst.toFixed(1)} mm > ${budget}`);
    }
    // The whole list, not the first one: a per-shape loop of `expect` stops at the earliest
    // failure and hides how many others moved with it.
    expect(over, 'shapes drawing further outside `dimMM` than their budget allows').toEqual([]);

    // The exception table is itself pinned. Without this, the cheapest way to green a red
    // is to add a row here, and nothing would say so.
    expect(Object.keys(OVERHANG_MM).sort(), 'shapes excused from the default budget').toEqual(['laptop']);
  });
});

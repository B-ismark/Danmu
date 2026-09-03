// Every number the room report SAYS, in the unit the user chose.
//
// § B.12 converted fifteen sentences in `lib/clearance.ts` off a hard-coded
// `Math.round(x * 100)` + literal `cm` and onto one `len()` helper. That is a
// fifteen-site mechanical edit, and a fifteen-site mechanical edit has exactly one
// characteristic failure: a slip at ONE site in a file where the other fourteen are
// right. The review found the branch shipped with two, and no gate that could see
// either — in two separate ways worth keeping apart:
//
//  1. **Two sentences never said `cm` in the first place.** The TV findings said
//     `${nd.toFixed(1)} m`, because a viewing distance is naturally metres. The sweep
//     was verified by grepping the OLD spelling — `} cm` — which found nothing left, so
//     the grep that confirmed the sweep was structurally blind to the only sites still
//     wrong. Hence this file is organised by RULE and not by spelling: the question is
//     "which findings state a length", and the answer is every `detail:` in that
//     function, whatever it used to say.
//
//  2. **Six of the thirteen converted sites were asserted nowhere.** Multiplying their
//     arguments by 1000 — door swing, entry route, walkway gap, walkway minimum, window
//     sill, reach, cut-off — passed the entire suite. Only `tall`, `zone`,
//     `clash-mounted` and `turning` had any assertion on their numbers; three other
//     tests touch `.detail` but only as the failure MESSAGE on a `toEqual([])`, which
//     reads as coverage and is not. *"Sofa sits inside the 90000 cm swing of Door"*
//     would have shipped green.
//
// ── Where the expected numbers come from ────────────────────────────────────────
//
// From `lib/layout-rules.ts` and from the fixture's own dimensions — never from
// `lib/clearance.ts`, and never hand-typed. The mutation being guarded lives in the
// sentence, so deriving the expectation from the RULE keeps the two sides independent:
// `clearance.ts` could multiply by anything and this file would still know what the
// answer should have been. A hand-typed `0.9 m` would go stale the day `WALK_COMFORT`
// moves; a re-derivation from `clearance.ts` would measure its own subject and could
// not fail at all.
//
// The MEASURED numbers — a walkway's actual gap, a TV's actual seat distance, the
// cut-off area — have no rule to read, so they are cross-checked between units instead:
// the same physical quantity, rendered in five units, must convert back to one value.
// A ×1000 at a measured site lands three decades outside that.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { analyzeRoom, type ClearanceIssue } from '@/lib/clearance';
import { accessZones, routeWidth, WALK_MIN } from '@/lib/layout-rules';
import { TURNING_DIAMETER } from '@/lib/clearance-field';
import { formatArea, formatLength } from '@/lib/units';
import type { ScenePart } from '@/lib/scene-spec';
import type { Footprint } from '@/lib/footprint';
import type { DimUnit } from '@/lib/store';

const UNITS: DimUnit[] = ['mm', 'cm', 'm', 'in', 'ft'];

/** Millimetres per unit, spelled out here rather than imported, because this is the
 *  side of the check that must not share arithmetic with the thing under test. */
const MM: Record<DimUnit, number> = { mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8 };

const RECT: Footprint = [
  [-3, -2],
  [3, -2],
  [3, 2],
  [-3, 2],
];
/** A second, smaller room. `routeWidth` scales with floor area, so a rule constant that
 *  is genuinely read from the room reads DIFFERENTLY here — which is how the entry
 *  sentence is shown to quote the room and not a literal that happens to match. */
const SMALL: Footprint = [
  [-2, -1.5],
  [2, -1.5],
  [2, 1.5],
  [-2, 1.5],
];
let n = 0;
function part(p: Partial<ScenePart> & Pick<ScenePart, 'category' | 'shape' | 'dimMM' | 'pos'>): ScenePart {
  return { id: `${p.shape}-${++n}`, name: p.shape, rot: 0, locked: false, ...p } as ScenePart;
}

/** The door, on the south wall, TURNED TO FACE THE ROOM.
 *
 *  `rot: Math.PI` is load-bearing and cost an hour to find. A door's swing and its route
 *  in are both authored in the door's own frame off local +Z, so a door at `rot: 0` on
 *  the `z = +2` wall swings and admits you OUTWARDS — every obstruction test then
 *  measures a rectangle in the garden and finds nothing in it. The fixture produced no
 *  `door` and no `entry` finding at any obstacle position, which reads exactly like the
 *  rules not firing rather than like the door being back to front. */
const door = (z = 1.97) =>
  part({
    category: 'door',
    shape: 'door',
    dimMM: [900, 50, 2100],
    pos: [0, 1.05, z],
    name: 'Door',
    wallMounted: true,
    rot: Math.PI,
  });

/** The swing depth, from the rule that authors it — not from the sentence that quotes it. */
function swingDepth(): number {
  const zone = accessZones(door(), 0, 1.97, Math.PI)[0];
  expect(zone, 'a door no longer has a swing zone').toBeTruthy();
  return zone.rule.depth;
}

function issuesOf(parts: ScenePart[], dimUnit: DimUnit, footprint: Footprint = RECT, accessibility = false) {
  return analyzeRoom(parts, { footprint, height: 2.6 }, { dimUnit, accessibility }).issues;
}

function one(parts: ScenePart[], rule: string, dimUnit: DimUnit, footprint: Footprint = RECT): ClearanceIssue {
  const hit = issuesOf(parts, dimUnit, footprint).filter((i) => i.rule === rule);
  expect(hit.length, `fixture no longer provokes exactly one '${rule}' finding (got ${hit.length})`).toBe(1);
  return hit[0];
}

/** The numeric tokens in a sentence, in order.
 *
 *  Deliberately NOT anchored on the unit. `([\d.]+) cm` once matched the `6` inside
 *  `105.6 cm` and reported a correct band as inverted — the regex found a number that
 *  was not the number, and the test then failed for the reason it existed to catch,
 *  which is the most expensive kind of false red there is. */
function numbers(detail: string): number[] {
  return (detail.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
}

// ─────────────────────────────────────────────────────────────────────────────────
// 1. The findings that quote a RULE CONSTANT
// ─────────────────────────────────────────────────────────────────────────────────

describe('a finding states its rule’s constant in the unit the user set', () => {
  const swingBlocked = () => [
    door(),
    part({ category: 'wardrobe', shape: 'wardrobe', dimMM: [1200, 600, 2100], pos: [0, 0, 0.9], name: 'Wardrobe' }),
  ];

  const walkTight = () => [
    door(),
    part({ category: 'bed', shape: 'bed-double', dimMM: [1600, 2000, 500], pos: [0, 0, -0.6], name: 'Bed' }),
    part({ category: 'wardrobe', shape: 'wardrobe', dimMM: [2000, 600, 2100], pos: [-2.0, 0, 1.0], name: 'Wardrobe' }),
  ];

  const marooned = () => [
    door(),
    part({ category: 'wardrobe', shape: 'wardrobe', dimMM: [1500, 600, 2100], pos: [-1.1, 0, -1.3], name: 'W1', rot: Math.PI / 2 }),
    part({ category: 'wardrobe', shape: 'wardrobe', dimMM: [1500, 600, 2100], pos: [-1.1, 0, 0], name: 'W2', rot: Math.PI / 2 }),
    part({ category: 'wardrobe', shape: 'wardrobe', dimMM: [1500, 600, 2100], pos: [-1.1, 0, 1.3], name: 'W3', rot: Math.PI / 2 }),
    part({ category: 'chair', shape: 'chair-dining', dimMM: [450, 450, 900], pos: [-2.4, 0, 0], name: 'Chair' }),
  ];

  for (const unit of UNITS) {
    it(`the door swing depth, in ${unit}`, () => {
      expect(one(swingBlocked(), 'door', unit).detail).toContain(formatLength(swingDepth() * 1000, unit));
    });

    it(`the route in from the door, in ${unit}`, () => {
      expect(one(swingBlocked(), 'entry', unit).detail).toContain(formatLength(routeWidth(RECT) * 1000, unit));
    });

    it(`the comfortable-passage minimum, in ${unit}`, () => {
      expect(one(walkTight(), 'walk', unit).detail).toContain(formatLength(WALK_MIN * 1000, unit));
    });

    it(`the width every route in falls under, in ${unit}`, () => {
      expect(one(marooned(), 'reach', unit).detail).toContain(formatLength(WALK_MIN * 1000, unit));
    });

    it(`the cut-off route width, in ${unit}`, () => {
      expect(one(marooned(), 'cut-off', unit).detail).toContain(formatLength(WALK_MIN * 1000, unit));
    });
  }

  it('the entry route is read from the ROOM, not from a literal that happens to match', () => {
    // `routeWidth` scales with floor area: 24 m² saturates at WALK_COMFORT, 12 m² does
    // not. If the sentence quoted a constant, both rooms would say the same thing.
    const big = routeWidth(RECT);
    const small = routeWidth(SMALL);
    expect(small, 'the two rooms must not share a route width, or this test is vacuous').not.toBeCloseTo(big, 3);

    const inSmall = [
      door(1.47),
      part({ category: 'wardrobe', shape: 'wardrobe', dimMM: [1200, 600, 2100], pos: [0, 0, 0.5], name: 'Wardrobe' }),
    ];
    const hit = issuesOf(inSmall, 'm', SMALL).filter((i) => i.rule === 'entry');
    expect(hit.length, 'the small-room fixture no longer provokes an entry finding').toBe(1);
    expect(hit[0].detail).toContain(formatLength(small * 1000, 'm'));
    expect(hit[0].detail).not.toContain(formatLength(big * 1000, 'm'));
  });

  it('the swing and the walkway are different constants and do not swap', () => {
    // Both rules would survive a swap if they happened to quote the same number, so
    // this pins that they do not — the assertions above are only as sharp as this.
    expect(swingDepth()).not.toBeCloseTo(WALK_MIN, 3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// 2. The findings that quote a MEASURED value
// ─────────────────────────────────────────────────────────────────────────────────

describe('a measured number renders the same physical quantity at every unit', () => {
  /** Read the first number out of a rule's sentence at each unit and convert it back to
   *  millimetres. Five readings of one quantity: they agree, or a site did not convert.  */
  function backToMM(parts: () => ScenePart[], rule: string, which = 0): Array<{ unit: DimUnit; mm: number }> {
    return UNITS.map((unit) => {
      const nums = numbers(one(parts(), rule, unit).detail);
      expect(nums.length, `${rule} @ ${unit} states no number`).toBeGreaterThan(which);
      return { unit, mm: nums[which] * MM[unit] };
    });
  }

  it('the walkway’s actual gap', () => {
    const parts = () => [
      door(),
      part({ category: 'bed', shape: 'bed-double', dimMM: [1600, 2000, 500], pos: [0, 0, -0.6], name: 'Bed' }),
      part({ category: 'wardrobe', shape: 'wardrobe', dimMM: [2000, 600, 2100], pos: [-2.0, 0, 1.0], name: 'Wardrobe' }),
    ];
    const seen = backToMM(parts, 'walk');
    for (const s of seen) {
      // The gap is ~390 mm by construction; a site that skipped the conversion lands
      // at 0.39 mm or 390000 mm, and nothing about this window reaches either.
      expect(s.mm, `${s.unit} renders a gap of ${s.mm} mm`).toBeGreaterThan(200);
      expect(s.mm, `${s.unit} renders a gap of ${s.mm} mm`).toBeLessThan(600);
    }
  });

  it('the window sill, which is derived per window rather than fixed', () => {
    // `accessZones` gives a mounted window `pos[1] - height/2` as its sill, floored at
    // 0.3 m — so 1.4 m centre on a 1200 mm pane is a 0.8 m sill, computed here from the
    // fixture's own numbers and nowhere near `clearance.ts`.
    const centreY = 1.4;
    const paneMM = 1200;
    const expected = centreY - paneMM / 2000;
    const parts = () => [
      door(),
      part({
        category: 'other',
        shape: 'window',
        dimMM: [1400, 80, paneMM],
        pos: [-1.2, centreY, -1.94],
        name: 'Window',
        wallMounted: true,
      }),
      part({ category: 'wardrobe', shape: 'wardrobe', dimMM: [1200, 600, 2000], pos: [-1.2, 0, -1.6], name: 'Wardrobe' }),
    ];
    for (const unit of UNITS) {
      expect(one(parts(), 'window', unit).detail, `sill @ ${unit}`).toContain(
        formatLength(expected * 1000, unit),
      );
    }
  });

  it('the cut-off floor AREA, in the area unit that belongs beside the length', () => {
    const parts = () => [
      door(),
      part({ category: 'wardrobe', shape: 'wardrobe', dimMM: [1500, 600, 2100], pos: [-1.1, 0, -1.3], name: 'W1', rot: Math.PI / 2 }),
      part({ category: 'wardrobe', shape: 'wardrobe', dimMM: [1500, 600, 2100], pos: [-1.1, 0, 0], name: 'W2', rot: Math.PI / 2 }),
      part({ category: 'wardrobe', shape: 'wardrobe', dimMM: [1500, 600, 2100], pos: [-1.1, 0, 1.3], name: 'W3', rot: Math.PI / 2 }),
    ];
    // The negative control comes first: without it every loop below passes over an
    // empty result, which is the exact shape this file exists to refuse.
    expect(issuesOf(parts(), 'm').filter((i) => i.rule === 'cut-off'), 'no cut-off finding at all').toHaveLength(1);

    for (const unit of UNITS) {
      const detail = one(parts(), 'cut-off', unit).detail;
      const imperial = unit === 'ft' || unit === 'in';
      expect(detail, `${unit}: ${detail}`).toContain(imperial ? 'ft²' : 'm²');
      expect(detail).not.toContain(imperial ? ' m²' : ' ft²');
      // Squaring the length unit mechanically is the thing `formatArea` exists to
      // refuse: nobody quotes a floor in square inches or square millimetres.
      for (const bad of ['in²', 'mm²', 'cm²']) expect(detail).not.toContain(bad);
    }

    const asM = numbers(one(parts(), 'cut-off', 'm').detail)[0];
    const asFt = numbers(one(parts(), 'cut-off', 'ft').detail)[0];
    expect(asFt).toBeCloseTo(asM * 10.7639, 0);
  });

  it('the TV’s two distances, with the screen still in inches', () => {
    const wMM = 1230;
    const hMM = 720;
    const parts = () => [
      part({ category: 'tv', shape: 'tv', dimMM: [wMM, 70, hMM], pos: [0, 1.0, -1.9], name: 'TV', wallMounted: true }),
      part({ category: 'sofa', shape: 'sofa', dimMM: [1800, 900, 880], pos: [0, 0, -1.0], name: 'Sofa' }),
    ];
    // Comfortable viewing is 1.2 × the diagonal — derived from the fixture, so the
    // expectation owes `clearance.ts` nothing.
    const comfortableMM = Math.hypot(wMM, hMM) * 1.2;

    for (const unit of UNITS) {
      const detail = one(parts(), 'tv', unit).detail;
      expect(detail, `tv @ ${unit}: ${detail}`).toContain(formatLength(comfortableMM, unit));
      // The ″ does NOT convert. A screen diagonal is the product's name worldwide —
      // "a 55-inch TV" — not a room measurement the user picked a unit for, and this is
      // the one number in the report that stays put.
      expect(detail).toContain('″');
    }
    // …and the seat distance, which is measured, agrees across units.
    const seen = backToMM(parts, 'tv');
    for (const s of seen) {
      expect(s.mm, `${s.unit} renders a seat distance of ${s.mm} mm`).toBeGreaterThan(400);
      expect(s.mm, `${s.unit} renders a seat distance of ${s.mm} mm`).toBeLessThan(2000);
    }
  });

  it('the OTHER TV finding — sitting too far — states three numbers of its own', () => {
    // Two branches, `warn` for too close and `info` for too far, and they are separate
    // sentences with separate `len()` calls. A fixture for one covers neither the other's
    // seat distance nor its ideal range: mutating `sits ${len(nd)} away` to
    // `len(nd * 1000)` survived the whole suite with only the too-close fixture present.
    // Two branches of one rule are two sites, and "the rule is covered" is not the same
    // claim as "the sentence is covered".
    const wMM = 700;
    const hMM = 400;
    const parts = () => [
      part({ category: 'tv', shape: 'tv', dimMM: [wMM, 70, hMM], pos: [-2.9, 1.0, 0], name: 'TV', wallMounted: true, rot: Math.PI / 2 }),
      part({ category: 'sofa', shape: 'sofa', dimMM: [1800, 900, 880], pos: [2.4, 0, 0], name: 'Sofa', rot: -Math.PI / 2 }),
    ];
    const diagMM = Math.hypot(wMM, hMM);
    for (const unit of UNITS) {
      const detail = one(parts(), 'tv', unit).detail;
      expect(detail, `far-TV @ ${unit}: ${detail}`).toContain('ideal range');
      expect(detail, `the low end of the ideal range @ ${unit}`).toContain(formatLength(diagMM * 1.2, unit));
      expect(detail, `the high end of the ideal range @ ${unit}`).toContain(formatLength(diagMM * 2.5, unit));
    }
    const seen = backToMM(parts, 'tv');
    for (const s of seen) {
      // ~5.3 m apart by construction.
      expect(s.mm, `${s.unit} renders a seat distance of ${s.mm} mm`).toBeGreaterThan(3000);
      expect(s.mm, `${s.unit} renders a seat distance of ${s.mm} mm`).toBeLessThan(8000);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// 3. The turning circle, which is stated in TWO places and used to disagree
// ─────────────────────────────────────────────────────────────────────────────────

describe('the Step-free control and the finding it produces speak one unit', () => {
  it('the finding quotes TURNING_DIAMETER at every unit', () => {
    // A 2.0 × 1.6 m room cannot take a 1500 mm circle anywhere, which is the only way
    // to provoke this rule reliably — a 6 × 4 room has turning space almost however it
    // is furnished, and the crowded-room fixture that looks like it should fire does not.
    const tight: Footprint = [
      [-1, -0.8],
      [1, -0.8],
      [1, 0.8],
      [-1, 0.8],
    ];
    const parts = [part({ category: 'bed', shape: 'bed-single', dimMM: [900, 1900, 600], pos: [-0.5, 0, 0], name: 'Bed' })];
    let seen = 0;
    for (const unit of UNITS) {
      const hit = issuesOf(parts, unit, tight, true).filter((i) => i.rule === 'turning');
      if (hit.length === 0) continue;
      seen++;
      expect(hit[0].detail).toContain(formatLength(TURNING_DIAMETER * 1000, unit));
    }
    // The loop `continue`s past a unit with no finding, so without this it would pass
    // over five empty results.
    expect(seen, 'the accessibility fixture no longer provokes a turning finding').toBe(UNITS.length);
  });

  it('the control’s own label is no longer a hand-typed centimetre string', () => {
    const src = readFileSync(join(process.cwd(), 'components/studio/RoomTools.tsx'), 'utf8');
    // The regression this replaces was a module-scope `const TURN_CM = …` rendered as
    // `{TURN_CM} cm` — so a user on feet read "Step-free · 150 cm" three rows above
    // "A wheelchair needs 4.92 ft to turn on the spot". A module-scope const cannot see
    // the store, so its very existence was the defect; the gate is on the SHAPE, not on
    // the number, because the number was already derived and was never the problem.
    expect(src, 'TURN_CM is back, and it cannot see dimUnit').not.toMatch(/TURN_CM/);
    expect(src).toMatch(/const turnLabel = \(unit: DimUnit\)/);
    expect(src).toMatch(/const dimUnit = useSettings\(\(s\) => s\.dimUnit\)/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// 4. formatArea's own contract
// ─────────────────────────────────────────────────────────────────────────────────

describe('formatArea collapses five length units onto the two area units anyone quotes', () => {
  it('metric lengths read m², imperial lengths read ft²', () => {
    expect(formatArea(1.5, 'm')).toBe('1.5 m²');
    expect(formatArea(1.5, 'cm')).toBe('1.5 m²');
    expect(formatArea(1.5, 'mm')).toBe('1.5 m²');
    expect(formatArea(1, 'ft')).toBe('10.8 ft²');
    expect(formatArea(1, 'in')).toBe('10.8 ft²');
  });

  it('trims like a sentence rather than padding like a field', () => {
    expect(formatArea(2, 'm')).toBe('2 m²');
    expect(formatArea(2, 'ft')).toBe('21.5 ft²');
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// 5. formatLength's two edges — the ones no caller reaches yet
// ─────────────────────────────────────────────────────────────────────────────────

describe('formatLength states its limits honestly', () => {
  it('never prints a minus sign on a zero', () => {
    // `(-0.4).toFixed(0)` is `"-0"`, and a minus on a zero reads as a direction the
    // number does not have.
    expect(formatLength(-0.4, 'mm')).toBe('0 mm');
    // A real negative still carries its sign — the strip is on the RENDERING being
    // zero, not on the input being small, which is the difference between fixing `-0`
    // and quietly dropping every minus sign in the module.
    expect(formatLength(-1500, 'm')).toBe('-1.5 m');
    expect(formatLength(-4, 'm')).toBe('-0.004 m');
    // And `down` on a negative is floor, i.e. away from zero, which is why the docblock
    // says findings are non-negative rather than claiming this direction is meaningful.
    expect(formatLength(-0.2, 'in', 'down')).toBe('-0.1 in');
  });

  it('the guarantee is "at or above one millimetre, at nearest" and no wider', () => {
    // Documented in the docblock, pinned here so the docblock cannot quietly become
    // absolute: sub-millimetre at `mm` is under the resolution everything is stored at,
    // and a directional round costs a decimal place the derived cap does not fund.
    expect(formatLength(0.4, 'mm')).toBe('0 mm');
    expect(formatLength(0.2, 'in', 'down')).toBe('0 in');
    // …while at or above one millimetre it always says something true.
    expect(formatLength(1, 'm')).toBe('0.001 m');
    expect(formatLength(1, 'ft')).toBe('0.003 ft');
    expect(formatLength(4, 'm')).toBe('0.004 m');
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// 6. The caller sweep — the shape that fails SILENTLY
// ─────────────────────────────────────────────────────────────────────────────────

describe('every caller that shows a finding to a person passes dimUnit', () => {
  // `AnalyzeOptions.dimUnit` is optional and defaults to `'cm'`, deliberately:
  // `lib/fit-check.ts` and `lib/layout-shuffle.ts` read `rule` and the issue key and
  // must not start depending on a Settings value, or a solver comparison would change
  // with a preference.
  //
  // The cost of that default is that a FOURTH display caller which omits it compiles,
  // lints, passes every test, and prints centimetres to a user who set feet. Making the
  // field required would touch ~60 test call sites to fix a defect none of them has, so
  // a source sweep is the proportionate answer — and it is the instrument the
  // `analyzeRoom` docblock names, rather than a claim about which component renders a
  // `detail`. That claim was already false: `Inspector.tsx` renders `worst.detail` too,
  // correctly, off the same memoised report. **The invariant is one ANALYSIS per unit,
  // not one renderer.**

  function sources(dir: string): string[] {
    const out: string[] = [];
    for (const e of readdirSync(join(process.cwd(), dir))) {
      const rel = `${dir}/${e}`;
      if (statSync(join(process.cwd(), rel)).isDirectory()) out.push(...sources(rel));
      else if (/\.tsx?$/.test(e)) out.push(rel);
    }
    return out;
  }

  const files = [...sources('components'), ...sources('app')];

  it('finds the UI tree at all', () => {
    // Without this the sweep below passes over an empty list — the classic shape of a
    // check that cannot fail, and the reason `sources()` walks rather than globbing.
    expect(files.length).toBeGreaterThan(40);
  });

  it('every analyzeRoom( in components/ or app/ passes a dimUnit', () => {
    const callers = files.filter((f) => /\banalyzeRoom\s*\(/.test(readFileSync(join(process.cwd(), f), 'utf8')));
    expect(callers.length, 'no UI file calls analyzeRoom — the sweep would be vacuous').toBeGreaterThan(0);
    for (const f of callers) {
      const src = readFileSync(join(process.cwd(), f), 'utf8');
      for (const call of src.match(/\banalyzeRoom\s*\([^;]*/g) ?? []) {
        expect(call, `${f} calls analyzeRoom without dimUnit`).toContain('dimUnit');
      }
    }
  });
});

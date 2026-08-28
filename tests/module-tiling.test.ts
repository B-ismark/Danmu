// How many modules a parametric shape tiles into, swept over every legal size.
//
// Five shapes derived their module count inline in `components/three/DynamicPart.tsx`
// as `Math.round(span / nominal)`. That expression minimises the error in the COUNT
// and says nothing about the module, which is the thing with a real-world size — so a
// wardrobe at 890 mm drew ONE 890 mm door while 900 mm drew two of 450, and dragging
// the width handle through that band made the doors grow to an impossible width and
// then snap to a different count.
//
// The arithmetic lives in `lib/scene-spec.ts` now, for the reason `fanBlade` does: a
// proportion written inside a TSX renderer is a proportion no test can reach, and
// `FanGeo` swept 40% wider than its own `dimMM` for months on exactly that.
//
// **The sweep is the assertion.** Choosing examples is how this arithmetic missed the
// 700–890 mm band in the first place, and every one of the five nominals would look
// fine against the single preset its shape ships with.

import { describe, expect, it } from 'vitest';
import {
  MODULE_RANGE,
  moduleCount,
  moduleRangeFor,
  isParametric,
  PART_LIBRARY,
  type Category,
  type ModuleRange,
  type Shape,
} from '@/lib/scene-spec';
import { dimRangeFor } from '@/lib/dimension-ranges';

/** Which axis each shape tiles along, and the category its size range is filed
 *  under. Neither is guessable: a bookshelf stacks shelves up its HEIGHT and a shoe
 *  rack stacks tiers, and `dimRangeFor` consults `BY_CATEGORY` first for a shape in
 *  `GENERIC_SHAPES`, so handing it the wrong category could quietly return a
 *  different range than the renderer is bounded by. */
const TILED: Record<string, { axis: 0 | 2; category: Category; span?: (v: number) => number }> = {
  wardrobe: { axis: 0, category: 'wardrobe' },
  closet: { axis: 0, category: 'wardrobe' },
  // A sofa tiles across the width BETWEEN its arms, not across the piece. Without
  // this the sweep exercises a span the renderer never passes.
  sofa: { axis: 0, category: 'sofa', span: (w) => Math.max(0.4, w - 2 * Math.min(0.18, w * 0.12)) },
  curtain: { axis: 0, category: 'curtain' },
  bookshelf: { axis: 2, category: 'shelf' },
  'shoe-rack': { axis: 2, category: 'shelf' },
};

const SHAPES = Object.keys(MODULE_RANGE) as Shape[];

/** The shape's own legal span on the axis it tiles, in mm, read from the one table
 *  that owns sizes. Not typed here: a hand-copied bound is the "displayed
 *  measurement that is not derived" this repo keeps finding, and it would rot the
 *  moment a range moved. */
function spanRange(shape: Shape): { lo: number; hi: number } {
  const t = TILED[shape];
  const r = dimRangeFor(t.category, shape);
  return { lo: r.min[t.axis], hi: r.max[t.axis] };
}

/** The span the shape's renderer actually hands `moduleCount`, from a dim in mm. */
function renderedSpan(shape: Shape, mm: number): number {
  const t = TILED[shape];
  return t.span ? t.span(mm / 1000) : mm / 1000;
}

describe('the module ranges themselves', () => {
  it('covers every shape that tiles, and only shapes that tile', () => {
    for (const shape of SHAPES) {
      expect(isParametric(shape), `${shape} has a MODULE_RANGE but is not parametric`).toBe(true);
      expect(TILED[shape], `${shape} has no axis/category in TILED`).toBeDefined();
    }
  });

  it('states the numbers as a decision, not a derivation', () => {
    // Every other assertion in this file checks a module against its OWN declared
    // range, so widening the declaration moves the goalposts with it: pushing the
    // wardrobe max to 1.2 m draws a 1.2 m door and the sweep still passes. Found by
    // mutating exactly that. These four numbers are a judgement about what a door and
    // a seat cushion plausibly are, and changing one should cost an edit here.
    //
    // The wardrobe nominal is 0.6 because that is the classic single-door width and
    // it is what keeps the 2400 mm preset at the four bays it draws today. The min of
    // 0.4 is not a taste: it is the largest value that keeps `max >= 2 * min` true at
    // a 0.8 max, and without that an 890 mm wardrobe has no legal tiling at all.
    expect(moduleRangeFor('wardrobe')).toEqual({ min: 0.4, nominal: 0.6, max: 0.8 });
    expect(moduleRangeFor('closet')).toEqual({ min: 0.4, nominal: 0.6, max: 0.8 });
    // The sofa nominal sits high in its own range on purpose — 900 mm is a
    // two-seater's cushion, and it is what stops the 2200 mm preset being silently
    // promoted to a three-seater. 0.47 is again the largest min that keeps the
    // doubling rule true at a 0.95 max; 0.5 broke it, and this file caught that.
    expect(moduleRangeFor('sofa')).toEqual({ min: 0.47, nominal: 0.9, max: 0.95 });
    // The other three were left out of this list when it was first written, and a peer
    // review caught what that cost: with only wardrobe, closet and sofa pinned, pushing
    // the bookshelf max to 1.2 m, the shoe-rack max to 0.6 m or the curtain max to 0.3 m
    // all passed this file at full green — a 1.2 m shelf gap, a 600 mm shoe tier and a
    // 300 mm pleat, each shipping behind a sweep that was measuring them against the
    // number being mutated. Half a table pinned is the same defect as none of it,
    // because the unpinned half is where the sweep is still self-checking.
    //
    // 350 mm is a shelf that takes a paperback upright with a finger of clearance; the
    // 0.45 max is about a large-format art book, past which a shelf reads as a cupboard.
    expect(moduleRangeFor('bookshelf')).toEqual({ min: 0.22, nominal: 0.35, max: 0.45 });
    // 200 mm is a shoe on an angled tier. Below 130 mm nothing fits on it at all.
    expect(moduleRangeFor('shoe-rack')).toEqual({ min: 0.13, nominal: 0.2, max: 0.26 });
    // A 110 mm pleat is what a gathered curtain does at roughly double fullness.
    expect(moduleRangeFor('curtain')).toEqual({ min: 0.07, nominal: 0.11, max: 0.14 });
  });

  it('has an upper count bound that the invariant above makes inert — deliberately', () => {
    // `hi = floor(span / min)` is the "module is not too SMALL" half of the pair, and
    // no shipped range can make it bind. Mutating it away therefore kills nothing, and
    // this is that measurement written down rather than left for the next person to
    // rediscover as a surprise — confirmed by a peer replacing the whole return with
    // `Math.max(lo, target)`, guard intact, for a full green.
    //
    // **The reason first written here was wrong**, which matters more than the fact:
    // it said binding needs `nominal < min`, "which the invariant forbids". It does
    // not. Binding needs only `nominal / min < 4/3`, a condition the doubling rule
    // says nothing about — `{ min: 0.05, nominal: 0.06, max: 0.1 }` obeys every
    // assertion in this file and makes `hi` clamp an unbounded 2 down to 1 at a 90 mm
    // span. So the inertness is a property of the six shipped ratios (lowest 1.5,
    // against a 1.333 threshold) and NOT of the invariant, and it is held that way by
    // an explicit `nominal / min >= 4/3` beside the doubling rule rather than by this
    // paragraph. A wrong reason is worse than no reason: it invites the next reader to
    // add a row the argument does not actually cover.
    //
    // When `hi` does bind it is CORRECT to: `hi >= ceil(span/max)` gives a module at
    // or under the max, and `hi = floor(span/min)` gives one at or over the min, so it
    // can never produce an illegal module. It is unreachable, not wrong.
    //
    // It stays for the reason `boundsToUnit` takes a pair: neither end alone can tell
    // whether rounding has left an interval, and a range added later that breaks the
    // doubling rule needs both ends present for `hi < lo` to detect it. So it is a
    // guard on a future edit, not on todays inputs — and here is a range that proves
    // it still works when the invariant is broken on purpose.
    // `nominal` at 0.55 rather than 0.45, and that is the whole point: with 0.45 the
    // nearest-nominal answer and the inverted-clamp answer are both 2, so the guard
    // was unobservable and mutating it away killed nothing. Found by mutating it.
    const hostile: ModuleRange = { min: 0.4, nominal: 0.55, max: 0.6 };
    // 0.7 m: one module is over the max, two are under the min, so `hi < lo`.
    //   guarded            -> target                       = 1
    //   min(hi, max(lo,t)) -> min(1, max(2,1)) = min(1,2)  = 1
    //   max(lo, min(hi,t)) -> max(2, min(1,1)) = max(2,1)  = 2   <- the inverted clamp
    // One 700 mm module is 100 mm over the max; two of 350 are 50 mm under the min.
    // Nearest-nominal is the documented fallback, and it is the one that degrades to
    // exactly what shipped before this change rather than to a new wrong answer.
    expect(moduleCount(0.7, hostile)).toBe(1);
    // And it is still monotonic across the gap, which an inverted clamp is not.
    let prev = 0;
    for (let mm = 400; mm <= 2000; mm += 1) {
      const n = moduleCount(mm / 1000, hostile);
      expect(n, `${mm}mm dropped the count`).toBeGreaterThanOrEqual(prev);
      prev = n;
    }
  });

  it('keeps every range satisfiable, and keeps the hi bound inert', () => {
    // With min 450 and max 750, an 890 mm wardrobe has NO legal answer — one bay is
    // over the max and two are under the min — and `moduleCount` then falls back to
    // the old rounding in a band nobody has looked at. This is the constraint that
    // makes the range satisfiable everywhere, and it is asserted rather than left to
    // the comment that explains it.
    for (const shape of SHAPES) {
      const r = moduleRangeFor(shape)!;
      expect(r.max, `${shape}: max must be >= 2 * min or spans exist with no answer`).toBeGreaterThanOrEqual(2 * r.min);
      expect(r.min, `${shape}: min must be below nominal`).toBeLessThan(r.nominal);
      expect(r.nominal, `${shape}: nominal must be at or below max`).toBeLessThanOrEqual(r.max);
      // The threshold that actually governs whether `hi` can bind — see the `hi` test
      // above, which used to attribute its own inertness to the doubling rule and was
      // wrong about it. `hi = floor(span / min)` binds only when `target` exceeds it,
      // which needs `round(span / nominal)` to round UP while `floor(span / min)` has
      // not yet gained a step: that requires nominal / min < (n + 1) / (n + 0.5) for
      // the count n, whose largest value is 4/3 at n = 1. Asserting the ratio here is
      // what keeps that test's claim true for rows added later; without it a new row
      // at, say, min 0.05 / nominal 0.06 / max 0.1 obeys every rule above, makes `hi`
      // bind at a 90 mm span, and turns the comment silently false.
      expect(
        r.nominal / r.min,
        `${shape}: nominal/min must be >= 4/3 or the hi bound stops being inert`,
      ).toBeGreaterThanOrEqual(4 / 3);
    }
  });
});

describe('every module lands inside its own range, across every legal size', () => {
  it.each(SHAPES)('%s', (shape) => {
    const r = moduleRangeFor(shape)!;
    const { lo, hi } = spanRange(shape);
    expect(hi, `${shape}: no legal span to sweep`).toBeGreaterThan(lo);

    const bad: string[] = [];
    // 1 mm steps. A coarser sweep is exactly how the 890 mm case survives: it is a
    // band about 190 mm wide inside a range 3400 mm long.
    for (let mm = lo; mm <= hi; mm += 1) {
      const span = renderedSpan(shape, mm);
      const n = moduleCount(span, r);
      if (!Number.isInteger(n) || n < 1) {
        bad.push(`${mm}mm -> n=${n}`);
        continue;
      }
      const each = span / n;
      if (each < r.min - 1e-9 || each > r.max + 1e-9) {
        bad.push(`${mm}mm -> ${n} x ${(each * 1000).toFixed(1)}mm (want ${r.min * 1000}-${r.max * 1000})`);
      }
    }
    expect(
      bad.slice(0, 8),
      `${bad.length} of ${hi - lo + 1} spans tile outside the module range:\n${bad.slice(0, 8).join('\n')}`,
    ).toEqual([]);
  });
});

describe('the count never goes DOWN as the piece grows', () => {
  // `Math.round(span / nominal)` is not monotonic — it flips at every half-step — and
  // non-monotonic is what "autoscaling" looks like from the outside: drag the handle
  // wider and a bay disappears.
  it.each(SHAPES)('%s', (shape) => {
    const r = moduleRangeFor(shape)!;
    const { lo, hi } = spanRange(shape);
    const drops: string[] = [];
    let prev = moduleCount(renderedSpan(shape, lo), r);
    for (let mm = lo + 1; mm <= hi; mm += 1) {
      const n = moduleCount(renderedSpan(shape, mm), r);
      if (n < prev) drops.push(`${mm}mm: ${prev} -> ${n}`);
      prev = n;
    }
    expect(drops.slice(0, 8), `the count dropped as the piece got wider:\n${drops.slice(0, 8).join('\n')}`).toEqual([]);
  });
});

describe('moduleCount at the edges', () => {
  const r: ModuleRange = { min: 0.4, nominal: 0.6, max: 0.8 };

  it('is one module for a span below one minimum', () => {
    expect(moduleCount(0.3, r)).toBe(1);
    expect(moduleCount(0.05, r)).toBe(1);
  });

  it('is one bay at a wardrobe minimum width, which is the reported case', () => {
    // "Wardrobe shouldn't be autoscaling after user scales it to a size that should
    // be reasonable width for one column wardrobe."
    const bay = moduleRangeFor('wardrobe')!;
    const min = spanRange('wardrobe').lo / 1000;
    expect(moduleCount(min, bay)).toBe(1);
    expect(min, 'a one-bay wardrobe at its own minimum must not exceed a door width').toBeLessThanOrEqual(bay.max);
  });

  it('splits the band that used to draw one impossible door', () => {
    // The measured failure: round(0.89 / 0.6) is 1, so 890 mm drew a single 890 mm
    // door while 900 mm drew two of 450.
    const bay = moduleRangeFor('wardrobe')!;
    for (const mm of [700, 750, 800, 850, 890, 900]) {
      const n = moduleCount(mm / 1000, bay);
      const door = mm / n;
      expect(door, `${mm}mm -> ${n} x ${door.toFixed(0)}mm`).toBeLessThanOrEqual(bay.max * 1000 + 1e-6);
      expect(door, `${mm}mm -> ${n} x ${door.toFixed(0)}mm`).toBeGreaterThanOrEqual(bay.min * 1000 - 1e-6);
    }
  });

  it('refuses a nonsense span rather than returning NaN', () => {
    // A renderer reads `part.dimMM`, which is clamped — but `SofaGeo` derives its
    // span by subtracting two arms from it, and a subtraction is where a zero comes
    // from. `Array.from({ length: NaN })` is empty, so the failure would be a sofa
    // with no cushions and nothing in the console.
    expect(moduleCount(0, r)).toBe(1);
    expect(moduleCount(-1, r)).toBe(1);
    expect(moduleCount(Number.NaN, r)).toBe(1);
    expect(moduleCount(Number.POSITIVE_INFINITY, r)).toBe(1);
  });
});

describe('every shipped preset keeps the count it draws today', () => {
  // The defect is in the bands BETWEEN the presets. A change that also redrew the
  // pieces the catalog ships would make it impossible to tell a fix from a restyle,
  // so these are pinned by name — and if one of them has to move, moving it should
  // cost a deliberate edit here.
  const EXPECTED: Record<string, number> = {
    Wardrobe: 4,
    Bookshelf: 5,
    'Shoe rack': 5,
    Curtain: 15,
  };

  it.each(Object.keys(EXPECTED))('%s', (label) => {
    const item = PART_LIBRARY.find((i) => i.label === label);
    expect(item, `${label} is no longer in PART_LIBRARY`).toBeDefined();
    const r = moduleRangeFor(item!.shape);
    expect(r, `${label} (${item!.shape}) has no module range`).toBeTruthy();
    expect(moduleCount(item!.dimMM[TILED[item!.shape].axis] / 1000, r!)).toBe(EXPECTED[label]);
  });

  it('pins every preset that tiles, so a new one cannot arrive unpinned', () => {
    // EXPECTED is a hand-kept list, which makes it the one thing in this file that
    // cannot notice a shape being added. A new parametric preset would get no pin and
    // no failure — it would simply not be covered, quietly, which is the same shape
    // as the tautology above: green because nothing asked.
    //
    // So the list is checked for COMPLETENESS against the catalog rather than
    // trusted. Coverage is complete today; this is what keeps it that way.
    const tiling = PART_LIBRARY.filter((i) => moduleRangeFor(i.shape));
    // The sofa is pinned by the `it` below rather than by EXPECTED, because its
    // count is only reproducible through the arm subtraction its renderer does.
    const pinned = new Set([...Object.keys(EXPECTED), 'Sofa']);
    expect(tiling.length, 'no catalog preset tiles at all — the fixture has drifted').toBeGreaterThan(0);
    for (const item of tiling) {
      expect(
        pinned.has(item.label),
        `${item.label} (${item.shape}) tiles but no assertion pins its module count`,
      ).toBe(true);
    }
    // And the other direction: a name in EXPECTED that has left the catalog would
    // otherwise fail with 'is no longer in PART_LIBRARY' from the sweep above, which
    // is a clearer message than a missing row, so it is only asserted loosely here.
    expect(pinned.size).toBeGreaterThanOrEqual(tiling.length);
  });

  it('Sofa — measured on its INNER width, after the arms', () => {
    // `SofaGeo` tiles cushions across `w - 2 * arm`, not across the piece, so the
    // preset's count is only reproducible through the same subtraction. Written out
    // here rather than imported because the renderer is TSX and this is a node
    // suite; if the arm formula changes, this assertion is meant to notice.
    const sofa = PART_LIBRARY.find((i) => i.label === 'Sofa')!;
    const w = sofa.dimMM[0] / 1000;
    const arm = Math.min(0.18, w * 0.12);
    const innerW = Math.max(0.4, w - arm * 2);
    expect(moduleCount(innerW, moduleRangeFor('sofa')!)).toBe(2);
  });
});

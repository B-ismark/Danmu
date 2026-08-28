// The shape of the cost function, as distinct from what it scores.
//
// Two things live here. The first is a **measurement of a defect that is still
// present**, printed on every green run; the second is the set of shape properties
// any repair has to keep.
//
// The defect: `bandCost` is `e²`, so a relation being out of the gap it wants is
// nearly free in the near field — and the near field is where every visible mistake
// lives. Swept over all ten specs the library can form, against `isWorthOffering`'s
// own `MIN_GAIN_ABS` of one cost unit, a piece 300 mm outside its band costs less
// than the floor in **every one of the ten**. A nightstand 450 mm off a bed scores
// 0.90: the solver finds the fix, the gate prices it as noise, and Shuffle declines
// to offer it. That is most of "Shuffle does nothing" and "the bedside table is
// never where it should be".
//
// It is asserted as it stands rather than left as prose, because a defect nobody
// measured is one the next person re-derives. When it is fixed, `UNDERPRICED_AT_300`
// goes to 0 and this file goes red — which is the point. See `bandCost`'s own doc
// comment for the two repairs already measured and reverted, and for the one
// promising direction, which is in `isWorthOffering` rather than here.
//
// The sweep is over the whole library rather than a handful of examples, because
// choosing examples is how the first reading of this missed four of the ten.

import { describe, it, expect } from 'vitest';
import { bandCost, DEFAULT_WEIGHTS } from '@/lib/layout-score';
import { MIN_GAIN_ABS } from '@/lib/layout-solve';
import { relationFor, WALK_MIN } from '@/lib/layout-rules';
import { PART_LIBRARY, type LibraryItem, type ScenePart } from '@/lib/scene-spec';

/** How far out of band counts as a mistake a person can see, metres.
 *
 *  Half the minimum walkway, derived rather than chosen: `WALK_MIN` is the narrowest
 *  gap this app will call passable, so half of it is the smallest error that is about
 *  the room rather than about tolerance. A hand-picked 0.3 here would be a number with
 *  no reason behind it, and it would not move if the walkway did. */
const VISIBLE_MISS = WALK_MIN / 2;

/** How many of the library's relation specs are priced below the floor Shuffle will
 *  offer over, at a miss a person can see. **This is the defect, not the target.** */
const UNDERPRICED_AT_300 = 10;

let n = 0;
const asPart = (it: LibraryItem): ScenePart =>
  ({
    id: `x${++n}`,
    name: it.label,
    category: it.category,
    shape: it.shape,
    dimMM: it.dimMM,
    pos: [0, 0, 0],
    rot: 0,
    locked: false,
  }) as ScenePart;

type Spec = { min: number; max: number; weight: number; pair: string };

/** Every relation spec the library can actually form, and the band and weight it
 *  resolves to. Derived by pairing the catalog against itself: a spec added to
 *  `RELATIONS` joins this sweep with no edit here, and one that no library pair can
 *  form is correctly absent rather than silently asserted about. */
function specsFromLibrary(): Map<string, Spec> {
  const out = new Map<string, Spec>();
  for (const a of PART_LIBRARY) {
    for (const b of PART_LIBRARY) {
      if (a === b) continue;
      const rel = relationFor(asPart(a), asPart(b));
      if (!rel) continue;
      if (!out.has(rel.specId)) {
        out.set(rel.specId, { min: rel.min, max: rel.max, weight: rel.weight, pair: `${a.label} → ${b.label}` });
      }
    }
  }
  return out;
}

/** What the solver actually charges for this pair being `e` metres out of its band,
 *  facing correctly — `weights.relation × spec weight × bandCost`, which is the
 *  arithmetic in `costBreakdown`. Not a restatement of `bandCost`: the point is the
 *  number that reaches `isWorthOffering`, and two of the three factors are elsewhere. */
function chargeFor(s: Spec, e: number): number {
  return DEFAULT_WEIGHTS.relation * s.weight * bandCost(s.max + e, s.min, s.max);
}

describe('what a relation costs just outside its band', () => {
  const specs = specsFromLibrary();

  it('found the library’s relations at all', () => {
    // Without this the sweep below passes over an empty map. It has happened in this
    // repo often enough to be a habit: a loop over "whatever it found" asserts nothing.
    expect(specs.size).toBeGreaterThanOrEqual(10);
  });

  it(`is under the floor Shuffle offers over, for ${UNDERPRICED_AT_300} of them, at a visible miss`, () => {
    const under = [...specs.entries()]
      .filter(([, s]) => chargeFor(s, VISIBLE_MISS) < MIN_GAIN_ABS)
      .map(([id, s]) => `${id} (${s.pair}) charges ${chargeFor(s, VISIBLE_MISS).toFixed(2)}`);
    // Named rather than only counted, so a red says WHICH spec changed price.
    expect(under.length, under.join('\n')).toBe(UNDERPRICED_AT_300);
  });

  it('reports the table', () => {
    const E = [0.1, 0.2, 0.3, 0.4, 0.6, 1.0];
    const rows = [...specs.entries()]
      .sort((a, b) => b[1].weight - a[1].weight)
      .map(([id, s]) =>
        [
          id.padEnd(20),
          `${s.min.toFixed(2)}-${s.max.toFixed(2)}`.padEnd(12),
          `w=${s.weight}`.padEnd(7),
          ...E.map((e) => `${chargeFor(s, e) < MIN_GAIN_ABS ? '*' : ' '}${chargeFor(s, e).toFixed(2)}`.padStart(8)),
        ].join(' '),
      );
    console.log(
      `\nrelation weight ${DEFAULT_WEIGHTS.relation} · MIN_GAIN_ABS ${MIN_GAIN_ABS} · visible miss ${VISIBLE_MISS} m · * = below the floor\n\n` +
        `${'spec'.padEnd(20)} ${'band'.padEnd(12)} ${'w'.padEnd(7)} ${E.map((e) => `+${e.toFixed(1)}m`.padStart(8)).join(' ')}\n` +
        `${rows.join('\n')}\n`,
    );
  });
});

describe('bandCost keeps the shape the annealer needs', () => {
  // A band is [0.4, 0.9] here only so both edges are away from zero and from each
  // other; every assertion is about the shape, not these numbers. These hold for `e²`
  // and for every repair considered so far EXCEPT a fixed entry cost, which the
  // continuity assertion is there to forbid.
  const MIN = 0.4;
  const MAX = 0.9;
  const at = (d: number) => bandCost(d, MIN, MAX);

  it('is zero everywhere inside the band, edges included', () => {
    for (const d of [MIN, 0.5, 0.65, 0.8, MAX]) expect(at(d)).toBe(0);
  });

  it('is continuous at both edges — no entry cost on crossing', () => {
    // The cheapest-looking repair is a fixed penalty added on leaving the band. It
    // would price a 1 mm miss the same as a 200 mm one, which destroys the ordering in
    // the exact band that needs fixing, and gives the annealer a cliff where it needs a
    // slope. This assertion is what forbids it.
    expect(at(MAX + 1e-6)).toBeLessThan(1e-4);
    expect(at(MIN - 1e-6)).toBeLessThan(1e-4);
  });

  it('grows strictly with the miss, on both sides', () => {
    let prevHigh = 0;
    let prevLow = 0;
    for (const e of [0.05, 0.1, 0.2, 0.4, 0.8, 1.6, 3.2]) {
      const high = at(MAX + e);
      const low = at(MIN - e);
      expect(high).toBeGreaterThan(prevHigh);
      expect(low).toBeGreaterThan(prevLow);
      prevHigh = high;
      prevLow = low;
    }
  });

  it('treats a miss below the band the same as the same miss above it', () => {
    for (const e of [0.05, 0.3, 1.0]) expect(at(MIN - e)).toBeCloseTo(at(MAX + e), 12);
  });
});

import { describe, expect, it } from 'vitest';
import type { Placement } from '@/lib/layout-score';
import { layoutSimilarity, orderOffers } from '@/lib/layout-offer';

const P = (x: number, z: number, yaw = 0): Placement => ({ x, z, yaw });

/** The two thresholds the wiring will pass, named here so the intent is legible.
 *
 *  They are NOT imported, because neither is exported yet: `similar()`'s 0.25 is a
 *  bare literal inside a private function in `lib/layout-solve.ts`, and
 *  `TURN_EPSILON` is a module-private const. That is the open dependency — see
 *  `docs/what-is-still-open.md` § 2. Nothing in this file asserts agreement with the
 *  solver, and it could not: an assertion built from a copied literal is
 *  self-consistent at any value. What this file DOES pin is that `layoutSimilarity`
 *  honours whatever it is handed, which is why every threshold below is exercised at
 *  two values — a version that ignored the arguments and used its own constants
 *  passed the whole of the first suite. */
const SPOT = 0.25;
const TURN = 0.05;
const T = { spotM: SPOT, yawRad: TURN };

/** An N-piece arrangement in a row, and a variant with the named pieces moved far
 *  enough to count as moved at any sane `spotM`. Fixtures with one or two pieces are
 *  the degenerate case for anything that ranks by similarity: the share is only ever
 *  0 or 1, which is exactly where a term that scales with piece count looks fine. */
const row = (n: number) => Array.from({ length: n }, (_, i) => P(i, 0));
const movedAt = (base: readonly Placement[], idx: readonly number[]) =>
  base.map((p, i) => (idx.includes(i) ? P(p.x + 5, p.z + 5, p.yaw) : { ...p }));

describe('layoutSimilarity — how much of one arrangement is the other', () => {
  it('is 1 for the same arrangement and 0 when every piece moved', () => {
    const a = row(3);
    expect(layoutSimilarity(a, a.map((p) => ({ ...p })), T)).toBe(1);
    expect(layoutSimilarity(a, movedAt(a, [0, 1, 2]), T)).toBe(0);
  });

  it('grades — half the pieces moved is 0.5, not "different"', () => {
    const a = row(4);
    expect(layoutSimilarity(a, movedAt(a, [2, 3]), T)).toBe(0.5);
  });

  // Both axes, separately, and the diagonal. Every case that moves x and z together
  // is one where `hypot(dx, dx)` and `hypot(dx, dz)` agree, so a dropped term hides.
  it('counts a piece at exactly the tolerance as the same spot, and one past it as moved', () => {
    const a = [P(0, 0)];
    expect(layoutSimilarity(a, [P(SPOT, 0)], T)).toBe(1);
    expect(layoutSimilarity(a, [P(SPOT + 1e-9, 0)], T)).toBe(0);
    expect(layoutSimilarity(a, [P(0, SPOT)], T)).toBe(1);
    expect(layoutSimilarity(a, [P(0, SPOT + 1e-9)], T)).toBe(0);
    // 0.2 each way is 0.283 apart: inside the tolerance on both axes, outside it in
    // fact, and reachable by neither single-axis case.
    expect(layoutSimilarity(a, [P(0.2, 0.2)], T)).toBe(0);
  });

  // `spotM` is an ARGUMENT and this is the only thing that proves it. Hard-coding
  // `> 0.25` in place of `opts.spotM` passed a whole suite that only ever passed 0.25.
  it('uses the distance it is handed, not one of its own', () => {
    const a = [P(0, 0)];
    const b = [P(0.3, 0)];
    expect(layoutSimilarity(a, b, { spotM: 0.25, yawRad: TURN })).toBe(0);
    expect(layoutSimilarity(a, b, { spotM: 0.5, yawRad: TURN })).toBe(1);
  });

  // …and the same for the turn, which a first version ignored outright while every
  // test stayed green, because every fixture was built from the constant it defaulted
  // to. A threshold checked only against fixtures derived from itself is measuring
  // its own subject.
  it('uses the turn tolerance it is handed, not one of its own', () => {
    const a = [P(0, 0, 0)];
    const b = [P(0, 0, 0.1)];
    expect(layoutSimilarity(a, b, { spotM: SPOT, yawRad: 0.05 })).toBe(0);
    expect(layoutSimilarity(a, b, { spotM: SPOT, yawRad: 0.2 })).toBe(1);
  });

  // §A.2's actual complaint: nothing prices whether several pieces of the same kind
  // face differently. A turn in place must register, or there is no variety to offer.
  it('a piece turned a quarter is a different arrangement, standing in the same spot', () => {
    expect(layoutSimilarity([P(0, 0, 0)], [P(0, 0, Math.PI / 2)], T)).toBe(0);
    expect(layoutSimilarity([P(0, 0, 0)], [P(0, 0, TURN / 2)], T)).toBe(1);
  });

  // The asymmetric case a subtraction gets wrong: 179 deg and -179 deg are two
  // degrees apart and `Math.abs(a - b)` calls them 358. BOTH ways round, because
  // `angleDelta`'s two wrap corrections are mirror images and a seam test that
  // crosses one way leaves a sign error in the other half green.
  it('measures the turn the short way round, across the +/-pi seam, both ways', () => {
    const hi = [P(0, 0, Math.PI - 0.01)];
    const lo = [P(0, 0, -Math.PI + 0.01)];
    expect(Math.abs(hi[0].yaw - lo[0].yaw)).toBeGreaterThan(TURN);
    expect(layoutSimilarity(hi, lo, T)).toBe(1);
    expect(layoutSimilarity(lo, hi, T)).toBe(1);
  });

  // A reachable path, not defensive padding: `PlanView`'s Shift+arrow turn is
  // `turnTo(part, part.rot + dir * spin)` (`:1250`) at a `spin` of pi/12 in fine snap
  // and pi/4 otherwise (`drag-resolve.ts` `snapSteps`), `setRotation` stores the
  // number verbatim (`store.ts:268`), and `solveLayout` reads yaw straight off
  // `part.rot` (`:248`). Nothing on that path normalises, so eight to twenty-four
  // presses of Shift+Right — depending on snap mode — puts a piece past 2pi.
  it('sees a yaw that has wound past a full turn as the heading it is', () => {
    expect(layoutSimilarity([P(0, 0, 4 * Math.PI + 0.01)], [P(0, 0, 0.01)], T)).toBe(1);
    expect(layoutSimilarity([P(0, 0, 0.01)], [P(0, 0, 4 * Math.PI + 0.01)], T)).toBe(1);
  });

  // The dilution trap: a locked piece agrees with itself in every pair, so counting
  // locked pieces drags every similarity toward 1 in proportion to how much of the
  // room is fixed. Both the numerator AND the denominator matter — the movable
  // pieces here disagree on one of two, so `agreed / a.length` gives 0.25 and
  // `agreed / considered` gives 0.5, and only a fixture where some movable piece
  // AGREES can tell them apart.
  it('divides by the pieces it considered, not by the size of the room', () => {
    const a = row(4);
    const b = [P(9, 9), P(1, 0), P(9, 9), P(9, 9)];
    expect(layoutSimilarity(a, b, { ...T, movable: [true, true, false, false] })).toBe(0.5);
    expect(layoutSimilarity(a, b, T)).toBe(0.25);
  });

  it('calls a room with nothing movable identical rather than different', () => {
    expect(layoutSimilarity(row(2), movedAt(row(2), [0, 1]), { ...T, movable: [false, false] })).toBe(1);
  });

  // All three refusals exist because each otherwise returns a plausible number for
  // two unrelated arrangements — a silent claim that they are the same.
  it('refuses two arrangements of different lengths', () => {
    expect(() => layoutSimilarity([P(0, 0)], row(2), T)).toThrow(/1 placements against 2/);
  });

  it('refuses a movable list that does not cover the arrangement', () => {
    // `movable: []` used to return 1.0 here: every index past the end reads
    // `undefined`, `!undefined` skips the piece, and nothing is left to consider.
    expect(() => layoutSimilarity(row(4), movedAt(row(4), [0, 1, 2, 3]), { ...T, movable: [] })).toThrow(
      /movable has 0 of 4/,
    );
    expect(() => layoutSimilarity(row(4), row(4), { ...T, movable: [true, true, true] })).toThrow(
      /movable has 3 of 4/,
    );
  });

  it('refuses a placement it cannot measure, rather than counting it as agreement', () => {
    // `NaN > spotM` is false, so a non-finite coordinate fell through to *agreed*.
    expect(() => layoutSimilarity([P(0, 0)], [P(Number.NaN, 0)], T)).toThrow(/placement 0 is not finite/);
    expect(() => layoutSimilarity([P(0, 0)], [P(0, Number.POSITIVE_INFINITY)], T)).toThrow(/not finite/);
    expect(() => layoutSimilarity([P(0, 0, 0)], [P(0, 0, Number.NaN)], T)).toThrow(/not finite/);
  });
});

describe('orderOffers — good, and not like the ones already picked', () => {
  type C = { id: string; cost: number; at: Placement[] };
  const sim = (x: C, y: C) => layoutSimilarity(x.at, y.at, T);
  const opts = (diversityPenalty: number, k?: number) => ({
    diversityPenalty,
    k,
    cost: (c: C) => c.cost,
    similarity: sim,
  });
  const ids = (r: C[]) => r.map((c) => c.id).join('');

  // An EIGHT-piece room, deliberately. A first version of this suite made the same
  // ordering claim on a two-piece fixture, where similarity is only ever exactly 0
  // or 1 — the one shape in which a term that scales with piece count cannot show
  // itself. The same costs in a real room reversed the answer and the suite was green.
  const BASE = row(8);
  const A: C = { id: 'A', cost: 8.2, at: BASE };
  const B: C = { id: 'B', cost: 8.21, at: movedAt(BASE, [0]) }; //   7/8 like A
  const C_: C = { id: 'C', cost: 8.55, at: movedAt(BASE, [0, 1, 2, 3]) }; // 4/8 like A
  const SET = [A, B, C_];

  it('is exactly cost order at a penalty of zero', () => {
    expect(ids(orderOffers(SET, opts(0)))).toBe('ABC');
  });

  // The whole point of the file: 0.35 of extra cost buys 3/8 more of the room being
  // different, and one cost unit is what `isWorthOffering` calls a material gain.
  it('offers the different arrangement ahead of the near-duplicate once diversity is priced', () => {
    expect(ids(orderOffers(SET, opts(1)))).toBe('ACB');
  });

  // The failure of the normalised [0,1] form, kept as an assertion because it is the
  // reason this function is shaped the way it is. D costs 14.0 and is never offered;
  // under normalisation it still decided the second suggestion, purely by widening
  // the spread the other three were divided by.
  it('is not moved by a candidate it never offers', () => {
    const D: C = { id: 'D', cost: 14, at: movedAt(BASE, [0, 1, 2, 3, 4, 5, 6, 7]) };
    expect(ids(orderOffers([...SET, D], opts(1, 2)))).toBe('AC');
    expect(ids(orderOffers(SET, opts(1, 2)))).toBe('AC');
  });

  // …and the second failure of that form: with a spread of 2e-12 the normalisation
  // blew a rounding error up to the full relevance range and ordered by it.
  // `isWorthOffering` refuses exactly this reasoning next door, in cost units.
  it('treats a rounding error as a rounding error', () => {
    const eps = [
      { id: 'A', cost: 10, at: BASE },
      { id: 'B', cost: 10 + 1e-12, at: BASE.map((p) => ({ ...p })) },
      { id: 'C', cost: 10 + 2e-12, at: movedAt(BASE, [0, 1, 2, 3, 4, 5, 6, 7]) },
    ];
    expect(ids(orderOffers(eps, opts(1)))).toBe('ACB');
  });

  // "Closest already picked" is the maximum over the WHOLE selection, not the most
  // recent one: a third pick that repeats the first is just as much a repeat.
  // C and D cost the same, so only that choice decides between them.
  it('measures against everything already offered, not just the last one', () => {
    const all = [
      { id: 'A', cost: 1, at: BASE },
      { id: 'B', cost: 1.1, at: movedAt(BASE, [0, 1, 2, 3, 4, 5, 6, 7]) }, // 0 like A
      { id: 'C', cost: 3, at: movedAt(BASE, [0]) }, //             7/8 like A, 1/8 like B
      { id: 'D', cost: 3, at: movedAt(BASE, [0, 1, 2, 3, 4]) }, // 3/8 like A, 5/8 like B
    ];
    // Against B alone, C looks the fresher of the two (1/8 vs 5/8) and is picked
    // third. Against both, C is 7/8 of the arrangement A already showed.
    expect(ids(orderOffers(all, opts(1)))).toBe('ABDC');
  });

  it('takes k and stops, and tolerates being asked for more than it has', () => {
    expect(ids(orderOffers(SET, opts(1, 2)))).toBe('AC');
    expect(orderOffers(SET, opts(1, 0))).toEqual([]);
    expect(ids(orderOffers(SET, opts(1, 99)))).toBe('ACB');
  });

  it('handles the degenerate inputs without a special case at the call site', () => {
    expect(orderOffers([], opts(1))).toEqual([]);
    expect(ids(orderOffers([A], opts(1)))).toBe('A');
  });

  // Deterministic in full: this app is deterministic per seed, and an order that
  // moved with the engine's sort stability would be a defect nobody could reproduce.
  it('breaks a tied score by position when the costs are tied too', () => {
    const tied = [
      { id: 'A', cost: 9, at: BASE },
      { id: 'B', cost: 5, at: movedAt(BASE, [0, 1, 2, 3, 4, 5, 6, 7]) },
      { id: 'C', cost: 5, at: movedAt(BASE, [1, 2, 3, 4, 5, 6, 7]) },
    ];
    expect(ids(orderOffers(tied, opts(0)))).toBe('BCA');
  });

  // …and by COST when the scores tie and the costs do not, which the case above
  // structurally cannot show: at a penalty of 0 the score IS the cost, so "equal
  // score" implies "equal cost" and the cost clause can never discriminate.
  // Inverting the clause left that test green.
  //
  // Here the penalty is 1 and both candidates score 3.5 after A is picked — X as
  // 3.0 + half the room repeated, Y as 3.5 + nothing repeated. X is the cheaper and
  // must win.
  it('breaks a tied score by cost, ahead of position', () => {
    const scoreTie = [
      { id: 'A', cost: 1, at: BASE },
      { id: 'Y', cost: 3.5, at: movedAt(BASE, [0, 1, 2, 3, 4, 5, 6, 7]) }, // sim 0 → 3.5
      { id: 'X', cost: 3, at: movedAt(BASE, [0, 1, 2, 3]) }, //               sim ½ → 3.5
    ];
    expect(sim(scoreTie[1], scoreTie[0])).toBe(0);
    expect(sim(scoreTie[2], scoreTie[0])).toBe(0.5);
    // Y is the earlier of the two, so position alone would pick it.
    expect(ids(orderOffers(scoreTie, opts(1)))).toBe('AXY');
  });

  // The callback is called as `(candidate, alreadyOffered)`, and nothing about that
  // order is visible while the metric is symmetric — `layoutSimilarity` is, so
  // swapping the two arguments changed no result in the whole suite. A caller is not
  // required to hand in a symmetric metric, so the order is pinned with one that
  // deliberately is not.
  it('asks how like the offered set a candidate is, not the reverse', () => {
    const oneWay = [
      { id: 'A', cost: 1, at: BASE },
      { id: 'B', cost: 2.5, at: BASE },
      { id: 'C', cost: 2, at: BASE },
    ];
    expect(
      ids(
        orderOffers(oneWay, {
          diversityPenalty: 1,
          cost: (c: C) => c.cost,
          similarity: (cand, offered) => (cand.id === 'C' && offered.id === 'A' ? 1 : 0),
        }),
      ),
    ).toBe('ABC');
  });

  it('refuses a cost it cannot rank, rather than sorting it somewhere', () => {
    expect(() => orderOffers([A, { ...B, cost: Number.NaN }], opts(1))).toThrow(/cost of item 1 is NaN/);
    expect(() => orderOffers([A, { ...B, cost: Number.POSITIVE_INFINITY }], opts(1))).toThrow(
      /cost of item 1 is Infinity/,
    );
  });

  it('refuses a penalty that is negative, infinite, or not a number', () => {
    // Negative inverts the term and seeks duplicates out; infinite makes every score
    // Infinity, so nothing ever beats the running best and the loop returns holes.
    expect(() => orderOffers(SET, opts(-1))).toThrow(/must be finite and >= 0, got -1/);
    expect(() => orderOffers(SET, opts(Number.POSITIVE_INFINITY))).toThrow(/must be finite and >= 0/);
    expect(() => orderOffers(SET, opts(Number.NaN))).toThrow(/must be finite and >= 0/);
  });
});

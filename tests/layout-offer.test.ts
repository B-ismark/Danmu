import { describe, expect, it } from 'vitest';
import type { Placement } from '@/lib/layout-score';
import { SAME_YAW_RAD, layoutSimilarity, mmrOrder } from '@/lib/layout-offer';

const P = (x: number, z: number, yaw = 0): Placement => ({ x, z, yaw });

/** The dedupe threshold the solver's own `similar()` uses. Written here rather than
 *  imported because it is not exported yet; the point of `spotM` being a required
 *  argument is that this file supplies it explicitly and no module carries a second
 *  copy silently. */
const SPOT = 0.25;

describe('layoutSimilarity — how much of one arrangement is the other', () => {
  it('is 1 for the same arrangement and 0 when every piece moved', () => {
    const a = [P(0, 0), P(1, 1), P(2, 2)];
    expect(layoutSimilarity(a, a.map((p) => ({ ...p })), { spotM: SPOT })).toBe(1);
    const b = [P(5, 5), P(6, 6), P(7, 7)];
    expect(layoutSimilarity(a, b, { spotM: SPOT })).toBe(0);
  });

  it('grades — half the pieces moved is 0.5, not "different"', () => {
    const a = [P(0, 0), P(1, 1), P(2, 2), P(3, 3)];
    const b = [P(0, 0), P(1, 1), P(9, 9), P(9, 9)];
    expect(layoutSimilarity(a, b, { spotM: SPOT })).toBe(0.5);
  });

  it('counts a piece at exactly the tolerance as the same spot, and one past it as moved', () => {
    const a = [P(0, 0)];
    expect(layoutSimilarity(a, [P(SPOT, 0)], { spotM: SPOT })).toBe(1);
    expect(layoutSimilarity(a, [P(SPOT + 1e-9, 0)], { spotM: SPOT })).toBe(0);
  });

  // § A.2's actual complaint: nothing prices whether several pieces of the same kind
  // face differently. If a turn does not register here, MMR cannot offer it as variety.
  it('a piece turned a quarter is a different arrangement, standing in the same spot', () => {
    const a = [P(0, 0, 0)];
    expect(layoutSimilarity(a, [P(0, 0, Math.PI / 2)], { spotM: SPOT })).toBe(0);
    expect(layoutSimilarity(a, [P(0, 0, SAME_YAW_RAD / 2)], { spotM: SPOT })).toBe(1);
  });

  // The asymmetric case, and the one a subtraction gets wrong: 179 deg and -179 deg
  // are two degrees apart, and `Math.abs(a - b)` calls them 358.
  //
  // BOTH directions, and that is not padding. `yawDelta`'s two corrections are mirror
  // images, and the first version of this test only crossed the seam one way: deleting
  // the `d <= -pi` branch left the whole file green. A sign error in the untested half
  // is invisible until someone turns a piece the other way round.
  it('measures the turn the short way round, across the +/-pi seam, both ways', () => {
    const hi = [P(0, 0, Math.PI - 0.01)];
    const lo = [P(0, 0, -Math.PI + 0.01)];
    expect(Math.abs(hi[0].yaw - lo[0].yaw)).toBeGreaterThan(SAME_YAW_RAD);
    expect(layoutSimilarity(hi, lo, { spotM: SPOT })).toBe(1);
    expect(layoutSimilarity(lo, hi, { spotM: SPOT })).toBe(1);
  });

  // Not defensive padding either, and the path is derivable rather than imagined.
  // `PlanView`'s Shift+arrow turn is `turnTo(part, part.rot + dir * spin)` at a `spin`
  // of pi/12 (`:1250`), `useStudio.setRotation` stores the number it is handed and
  // normalises nothing (`store.ts:268`), and `solveLayout` reads a placement's yaw
  // straight off `part.rot` (`:249`). So **twenty-four presses of Shift+Right** puts a
  // piece past 2pi with nothing in between to fold it back.
  //
  // `yawDelta`'s two corrections run once rather than in a loop, so they bring a delta
  // back from (-2pi, 2pi) and no further; without the modulo that piece reads as a full
  // turn away from itself, and the arrangement reads as different from itself.
  it('sees a yaw that has wound past a full turn as the heading it is', () => {
    const wound = [P(0, 0, 4 * Math.PI + 0.01)];
    const plain = [P(0, 0, 0.01)];
    expect(layoutSimilarity(wound, plain, { spotM: SPOT })).toBe(1);
    expect(layoutSimilarity(plain, wound, { spotM: SPOT })).toBe(1);
  });

  // The dilution trap. A locked piece agrees with itself in every pair, so counting
  // locked pieces drags every similarity toward 1 in proportion to how much of the
  // room is fixed — and MMR over a set that is 87% alike by construction is inert in
  // a way that reads as a tuning problem rather than a bug.
  it('ignores pieces that could not have moved', () => {
    const a = [P(0, 0), P(1, 0), P(2, 0), P(3, 0), P(4, 0), P(5, 0), P(6, 0), P(7, 0)];
    const b = a.map((p, i) => (i === 7 ? P(9, 9) : { ...p }));
    const movable = a.map((_, i) => i === 7);
    expect(layoutSimilarity(a, b, { spotM: SPOT })).toBe(7 / 8);
    expect(layoutSimilarity(a, b, { spotM: SPOT, movable })).toBe(0);
  });

  it('calls a room with nothing movable identical rather than different', () => {
    const a = [P(0, 0), P(1, 1)];
    const b = [P(9, 9), P(8, 8)];
    expect(layoutSimilarity(a, b, { spotM: SPOT, movable: [false, false] })).toBe(1);
  });

  // Two candidates for one room always have one length, so a mismatch is a caller
  // bug — and comparing the common prefix would report two arrangements of different
  // rooms as highly similar.
  it('refuses two arrangements of different lengths', () => {
    expect(() => layoutSimilarity([P(0, 0)], [P(0, 0), P(1, 1)], { spotM: SPOT })).toThrow(
      /1 placements against 2/,
    );
  });
});

describe('mmrOrder — good, and not like the ones already picked', () => {
  // One cheap candidate, a near-duplicate of it that is very slightly worse, and a
  // clearly worse candidate that shares nothing with either. Cost order offers the
  // duplicate second, which is the convergence complaint in three rows.
  type C = { id: string; cost: number; at: Placement[] };
  const A: C = { id: 'A', cost: 10.0, at: [P(0, 0), P(0, 0)] };
  const B: C = { id: 'B', cost: 10.1, at: [P(0, 0), P(0, 0)] };
  const C_: C = { id: 'C', cost: 12.0, at: [P(5, 5), P(5, 5)] };
  const SET = [A, B, C_];
  const opts = (lambda: number, k?: number) => ({
    lambda,
    k,
    cost: (c: C) => c.cost,
    similarity: (x: C, y: C) => layoutSimilarity(x.at, y.at, { spotM: SPOT }),
  });
  const ids = (r: C[]) => r.map((c) => c.id).join('');

  it('is exactly cost order at lambda 1', () => {
    expect(ids(mmrOrder(SET, opts(1)))).toBe('ABC');
  });

  // The whole point of the file. Same input, same solver, different offer.
  it('offers the different arrangement ahead of the near-duplicate below lambda 1', () => {
    expect(ids(mmrOrder(SET, opts(0.5)))).toBe('ACB');
  });

  it('still opens with the cheapest at lambda 0, then ignores cost', () => {
    expect(ids(mmrOrder(SET, opts(0)))).toBe('ACB');
  });

  it('takes k and stops', () => {
    expect(ids(mmrOrder(SET, opts(0.5, 2)))).toBe('AC');
    expect(mmrOrder(SET, opts(0.5, 0))).toEqual([]);
  });

  it('handles the degenerate inputs without a special case at the call site', () => {
    expect(mmrOrder([], opts(0.5))).toEqual([]);
    expect(ids(mmrOrder([A], opts(0.5)))).toBe('A');
  });

  // With no spread the relevance half is a constant, so the ordering is diversity and
  // the tie-break — which is what "these are all as good as each other" should mean.
  it('orders an all-equal-cost set by difference, opening at the first', () => {
    const flat = [
      { id: 'A', cost: 7, at: [P(0, 0)] },
      { id: 'B', cost: 7, at: [P(0, 0)] },
      { id: 'C', cost: 7, at: [P(5, 5)] },
    ];
    expect(ids(mmrOrder(flat, opts(0.7)))).toBe('ACB');
  });

  // Deterministic in full: this app is deterministic per seed, and a suggestion order
  // that moved with the engine's sort stability would be a defect nobody could
  // reproduce. Equal scores break to the lower cost, then to the earlier index.
  it('breaks a tied score by cost, then by position', () => {
    const tied = [
      { id: 'A', cost: 9, at: [P(0, 0)] },
      { id: 'B', cost: 5, at: [P(1, 1)] },
      { id: 'C', cost: 5, at: [P(2, 2)] },
    ];
    // Nothing is similar to anything, so round two is a pure tie between A and C at
    // lambda 0 — and C is the cheaper.
    expect(ids(mmrOrder(tied, opts(0)))).toBe('BCA');
  });

  it('refuses a cost it cannot rank, rather than sorting it somewhere', () => {
    const bad = [A, { ...B, cost: Number.NaN }];
    expect(() => mmrOrder(bad, opts(0.5))).toThrow(/cost of item 1 is NaN/);
    const inf = [A, { ...B, cost: Number.POSITIVE_INFINITY }];
    expect(() => mmrOrder(inf, opts(0.5))).toThrow(/cost of item 1 is Infinity/);
  });

  it('refuses a lambda outside [0, 1]', () => {
    expect(() => mmrOrder(SET, opts(1.5))).toThrow(/lambda must be in \[0, 1\]/);
    expect(() => mmrOrder(SET, opts(Number.NaN))).toThrow(/lambda must be in \[0, 1\]/);
  });
});

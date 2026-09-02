import { describe, expect, it } from 'vitest';
import {
  bestCandidate,
  HARD_TERMS,
  impossibility,
  IMPOSSIBLE_TERMS,
  lockedForSolve,
  solveLayout,
  type Candidate,
} from '@/lib/layout-solve';
import { DEFAULT_WEIGHTS, type CostBreakdown, type ScoreWeights } from '@/lib/layout-score';
import { defaultScene } from '@/lib/scene-spec';
import { footprintForLayout } from '@/lib/footprint';

// § 31 — "nothing physically impossible should be encouraged".
//
// The user's ruling splits the hard terms by KIND: a piece through a wall or inside
// another piece describes a room that CANNOT EXIST, while a blocked door, an
// unreachable corner and a wardrobe that will not open are rooms that exist and are
// bad. The first kind is vetoed; the second keeps its price.
//
// What is pinned here is the split itself, the ranker, and the invariant the solver
// now carries — never hand back an arrangement more impossible than the one you were
// given. The last of those is the one that had a defect behind it, so it is asserted
// over a sweep rather than over one lucky seed.
//
// A `//` header rather than a docblock — see `tests/layout-pick.test.ts` for why.

const ZERO: CostBreakdown = {
  overlap: 0, outside: 0, door: 0, navigation: 0, access: 0, walkway: 0,
  window: 0, wall: 0, middle: 0, alignment: 0, relation: 0, balance: 0,
  inertia: 0, total: 0,
};

/** A candidate that exists only to be ranked. `placements` is never read by the
 *  ranker, so an empty one is honest rather than a stub. */
const cand = (total: number, b: Partial<CostBreakdown> = {}): Candidate => ({
  placements: [],
  cost: total,
  navCost: 0,
  total,
  breakdown: { ...ZERO, ...b, total },
});

describe('IMPOSSIBLE_TERMS — the split is by kind, not by severity', () => {
  it('names the two terms that describe a room that cannot exist', () => {
    expect([...IMPOSSIBLE_TERMS].sort()).toEqual(['outside', 'overlap']);
  });

  it('leaves every recoverable hard term priced rather than vetoed', () => {
    // The user's words: a blocked door "can be prompted and fix with the fix
    // feature". Anything in this list is a room the report names and Try a fix acts
    // on, so putting it behind the veto would refuse arrangements the app is meant to
    // offer and then repair.
    for (const term of ['door', 'access', 'navigation'] as Array<keyof ScoreWeights>) {
      expect(IMPOSSIBLE_TERMS, term + ' is recoverable and must stay a price').not.toContain(term);
    }
  });

  it('is a subset of HARD_TERMS, so the veto can never outrank the sum it lives in', () => {
    for (const term of IMPOSSIBLE_TERMS) expect(HARD_TERMS).toContain(term);
    expect(IMPOSSIBLE_TERMS.length).toBeLessThan(HARD_TERMS.length);
  });

  it('sums exactly those terms and no others', () => {
    const b: CostBreakdown = {
      ...ZERO, overlap: 3, outside: 5, door: 800, access: 90, navigation: 70, wall: 11, total: 979,
    };
    expect(impossibility(b)).toBe(8);
  });
});

describe('bestCandidate — least impossible first, then cheapest', () => {
  it('is the plain argmin on total when nothing is impossible', () => {
    expect(bestCandidate([cand(50), cand(20), cand(90)])).toBe(1);
  });

  it('ties to the earliest, which is what the default has always done', () => {
    expect(bestCandidate([cand(20), cand(20)])).toBe(0);
  });

  it('prefers a legal arrangement to a cheaper illegal one', () => {
    // The whole ruling in one assertion: 20 units dearer, and it is the answer,
    // because the other one has a piece inside a wall.
    expect(bestCandidate([cand(10, { outside: 30 }), cand(30)])).toBe(1);
  });

  it('does not care WHICH impossibility, only how much', () => {
    // `overlap` and `outside` are summed rather than kept apart — both are already on
    // the vetoed side, so there is nothing to protect from being bought.
    expect(bestCandidate([cand(10, { overlap: 8 }), cand(90, { outside: 3 })])).toBe(1);
  });

  it('still prices a blocked door rather than vetoing it', () => {
    // The direction the ruling does NOT reverse. A door block is expensive and
    // buyable; it must not become a veto of its own, or the solver would rather leave
    // a room scrambled than offer one it can walk around.
    expect(bestCandidate([cand(900, { door: 900 }), cand(950)])).toBe(0);
  });

  it('takes the cheaper of two equally impossible candidates', () => {
    expect(bestCandidate([cand(90, { outside: 30 }), cand(40, { outside: 30 })])).toBe(1);
  });

  it('forgives a last-bit difference in impossibility rather than ranking on it', () => {
    // Both are sums of areas. Without the slack, 1e-9 of float noise would outrank a
    // 50-unit real difference in taste.
    expect(bestCandidate([cand(90, { outside: 1 }), cand(40, { outside: 1 + 1e-9 })])).toBe(1);
  });
});

describe('solveLayout never hands back a room more impossible than the one it was given', () => {
  // The defect § 31 actually had. Before this veto, 18 of these 160 solves answered
  // with MORE `overlap + outside` than they were handed — every one of them starting
  // from a legal seeded room, and the L preset's worst reaching `outside` 371.6 from
  // 0 while its total improved 811 -> 400. The old accept compared totals only, so it
  // welcomed the trade.
  //
  // Asserted over a sweep because a single seed cannot see it: the presets that fail
  // are the L and the U, and only at some seeds.
  const PRESETS = ['rect', 'l', 't', 'u', 'open'] as const;
  const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];

  const scramble = (parts: ReturnType<typeof defaultScene>) =>
    parts.map((p, i) => ({
      ...p,
      pos: [-1 + (i % 3) * 0.4, p.pos[1], -1 + Math.floor(i / 3) * 0.4] as [number, number, number],
    }));

  for (const mode of [undefined, 'shuffle'] as const) {
    it('holds across every preset and seed - ' + (mode ?? 'suggest'), () => {
      let solves = 0;
      let moved = 0;
      for (const id of PRESETS) {
        for (const scrambled of [true, false]) {
          for (const seed of SEEDS) {
            const base = defaultScene(id, 6, 4);
            const parts = scrambled ? scramble(base) : base;
            const r = solveLayout(parts, footprintForLayout(id, 6, 4), lockedForSolve(parts, {}, null), {
              seed,
              mode,
            });
            solves++;
            if (r.moved.length > 0) moved++;
            expect(
              impossibility(r.breakdownAfter),
              id + (scrambled ? '/scrambled' : '/seeded') + ' seed ' + seed,
            ).toBeLessThanOrEqual(impossibility(r.breakdownBefore) + 1e-6);
          }
        }
      }
      expect(solves, 'the sweep ran').toBe(80);
      // ...and the veto did not achieve this by refusing everything. Without this line
      // a solver that always reverted would pass the assertion above.
      expect(moved, 'answers that still move something').toBeGreaterThan(50);
    }, 600_000);
  }

  it('leaves a legal room legal when it declines to answer', () => {
    // The revert path: `breakdownAfter` is restored to `breakdownBefore`, so a caller
    // reading `after` sees the room it already has rather than the illegal one the
    // search proposed.
    const parts = defaultScene('l', 6, 4);
    const r = solveLayout(parts, footprintForLayout('l', 6, 4), lockedForSolve(parts, {}, null), { seed: 7 });
    expect(impossibility(r.breakdownBefore)).toBe(0);
    expect(impossibility(r.breakdownAfter)).toBe(0);
    if (r.moved.length === 0) expect(r.after).toBeCloseTo(r.before, 10);
  });
});

describe('Candidate.breakdown', () => {
  it('is the same number `total` is a summary of', () => {
    // Two fields that ought to agree, pinned because "by construction" is how such a
    // pair stops agreeing. `total` is `cost + navCost`, and the breakdown prices the
    // same layout at the same weights with the same grid.
    const parts = defaultScene('u', 6, 4);
    let seen: readonly Candidate[] = [];
    solveLayout(parts, footprintForLayout('u', 6, 4), lockedForSolve(parts, {}, null), {
      seed: 3,
      pick: (c) => ((seen = c), 0),
    });
    expect(seen.length).toBeGreaterThan(0);
    for (const c of seen) {
      expect(c.breakdown.total).toBeCloseTo(c.total, 6);
      expect(c.breakdown.navigation).toBeCloseTo(c.navCost, 10);
    }
  });

  it('is priced at the solve weights, so a caller reading it reads the same currency', () => {
    const parts = defaultScene('rect', 6, 4);
    let seen: readonly Candidate[] = [];
    solveLayout(parts, footprintForLayout('rect', 6, 4), lockedForSolve(parts, {}, null), {
      seed: 2,
      pick: (c) => ((seen = c), 0),
    });
    expect(seen.length).toBeGreaterThan(0);
    for (const c of seen) {
      // A weighted term, not a raw share: `outside` tops out at `weights.outside` per
      // piece, so a bare 0..1 reading here would mean the breakdown was unweighted.
      expect(c.breakdown.outside).toBeLessThanOrEqual(DEFAULT_WEIGHTS.outside * parts.length);
    }
  });
});

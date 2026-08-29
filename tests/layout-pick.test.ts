import { describe, expect, it } from 'vitest';
import { lockedForSolve, solveLayout, type Candidate } from '@/lib/layout-solve';
import { prepare, navigabilityCost, NAV_CELL, DEFAULT_WEIGHTS } from '@/lib/layout-score';
import { defaultScene } from '@/lib/scene-spec';
import { footprintForLayout } from '@/lib/footprint';

// `SolveOptions.pick` — the seam the offer stage acts through.
//
// Variety is a property of the SET of suggestions and no single solve can see that
// set, so the choice of which finalist becomes the suggestion has to be the caller's.
// These pin what a caller is entitled to assume, each of which is silent if it
// breaks: that omitting `pick` changes nothing, that supplying one is actually
// obeyed, that an unusable answer is survivable, and that ranking the pool does not
// quietly rewrite it.
//
// A `//` header rather than a docblock, deliberately: a `/** */` here would sit
// immediately above the next one and orphan itself, which is the defect
// `tests/docblock-adjacency.test.ts` gates. File headers in this repo take the `//`
// form for that reason — see `lib/layout-score.ts`.

/** A room that actually needs rearranging — everything pushed into one corner.
 *
 *  NOT the seeded scene, and the difference decides whether these tests can see
 *  anything at all. A `defaultScene` is already at a local optimum the solver cannot
 *  improve: on **five of the six presets** it moves nothing at any seed, so the pool
 *  holds ONE candidate and every "does the picker change the answer" assertion passes
 *  vacuously. Scrambled, every preset gives a pool of four at every seed.
 *  `tests/layout-offer-pool.test.ts` prints both tables. */
const scramble = (parts: ReturnType<typeof defaultScene>) =>
  parts.map((p, i) => ({
    ...p,
    pos: [-1 + (i % 3) * 0.4, p.pos[1], -1 + Math.floor(i / 3) * 0.4] as [number, number, number],
  }));

const room = () => ({
  parts: scramble(defaultScene('rect', 6, 4)),
  footprint: footprintForLayout('rect', 6, 4),
});
const solve = (opts: Parameters<typeof solveLayout>[3] = {}) => {
  const { parts, footprint } = room();
  return solveLayout(parts, footprint, lockedForSolve(parts, {}, null), { seed: 3, ...opts });
};

describe('SolveOptions.pick', () => {
  it('hands the picker every finalist, priced the way the winner is chosen', () => {
    let seen: readonly Candidate[] = [];
    const r = solve({ pick: (c) => ((seen = c), 0) });
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.length).toBe(r.finalists.length);
    for (const c of seen) {
      // `total` is what the default compares, and it is NOT `cost` — the navigability
      // term is the whole reason the finalist pass exists. A ranker handed `cost`
      // alone would be ranking on a different question from the one it is replacing.
      expect(c.total).toBeCloseTo(c.cost + c.navCost, 10);
      expect(c.navCost).toBeGreaterThanOrEqual(0);
    }
  });

  it('without a picker, chooses the lowest total — the behaviour it has always had', () => {
    let seen: readonly Candidate[] = [];
    // Observe the pool without influencing the choice: return the argmin ourselves and
    // assert the un-picked solve agrees with it.
    const argmin = (c: readonly Candidate[]) =>
      c.reduce((bi, x, i) => (x.total < c[bi].total ? i : bi), 0);
    const spied = solve({ pick: (c) => ((seen = c), argmin(c)) });
    const plain = solve();
    expect(plain.placements).toEqual(spied.placements);
    expect(plain.after).toBeCloseTo(spied.after, 10);
    expect(seen.length).toBeGreaterThan(0);
  });

  it('is obeyed — a different index gives a different suggestion', () => {
    const { finalists } = solve();
    // Only meaningful when the search actually found alternatives. If it did not, say
    // so rather than passing vacuously over a pool of one.
    expect(finalists.length, 'seed 3 should leave more than one finalist').toBeGreaterThan(1);
    const argmin = finalists.reduce(
      (bi, x, i) => (x.cost < finalists[bi].cost ? i : bi),
      0,
    );
    const other = finalists.findIndex((_, i) => i !== argmin);
    const a = solve({ pick: () => argmin });
    const b = solve({ pick: () => other });
    expect(b.placements).not.toEqual(a.placements);
  });

  it('ignores an index it cannot use rather than throwing', () => {
    // A ranker is a preference. A room with no suggestion in it is a worse failure
    // than an unheeded one, so an out-of-range answer falls back to the argmin.
    const plain = solve();
    for (const bad of [99, -1, Number.NaN]) {
      expect(solve({ pick: () => bad }).placements, `pick -> ${bad}`).toEqual(plain.placements);
    }
  });

  // ── `navCost` is half of `total`, and a rectangle cannot show it ─────────────
  //
  // In the scrambled rectangle above every candidate scores navigability 0, so
  // `total === cost` however the arithmetic is written: replacing `cost + navCost`
  // with `cost`, and dropping the `weights.navigation` multiplier, BOTH left the
  // whole file green. The scrambled U is the fixture that has the term, and it is
  // here for that reason and not for coverage — the two assertions below both refuse
  // to pass if every candidate's navigability came back zero, so the fixture cannot
  // quietly stop exercising what it is for.
  describe('in a room where navigability actually costs something', () => {
    const uSolve = (seed: number, opts: Parameters<typeof solveLayout>[3] = {}) => {
      const parts = scramble(defaultScene('u', 6, 5));
      const fp = footprintForLayout('u', 6, 5);
      return solveLayout(parts, fp, lockedForSolve(parts, {}, null), { seed, ...opts });
    };
    // Memoised: each call is a full solve, and two of the tests below sweep the same
    // six seeds. Safe to share — the solve is deterministic per seed, and the pool it
    // hands back is provably not rewritten (see the aliasing test above).
    const pools = new Map<number, readonly Candidate[]>();
    const poolAt = (seed: number) => {
      const hit = pools.get(seed);
      if (hit) return hit;
      let seen: readonly Candidate[] = [];
      uSolve(seed, { pick: (c) => ((seen = c), 0) });
      pools.set(seed, seen);
      return seen;
    };
    const SEEDS = [1, 2, 3, 4, 5, 6];

    it('prices the finalists on cost PLUS weighted navigability', () => {
      let nonZero = 0;
      for (const seed of SEEDS) {
        for (const c of poolAt(seed)) {
          expect(c.total).toBeCloseTo(c.cost + c.navCost, 6);
          if (c.navCost > 0) nonZero++;
        }
      }
      // Without this the arithmetic above is an identity: 0 + 0 = 0.
      expect(nonZero, 'no candidate had a navigability cost, so `total` proves nothing').toBeGreaterThan(4);
    }, 900_000);

    // …and it is the WEIGHTED term. Multiplying every candidate's navigability by the
    // same constant leaves the arithmetic above true and the ordering mostly intact,
    // so dropping `weights.navigation` survived the assertions either side of this
    // one. Recomputed here from the exported parts rather than compared against a
    // literal: the claim is that `navCost` is on the same scale as every other term
    // the solver sums, and a hard-coded 120 would restate the weight instead of
    // checking it.
    it('and the navigability it prices is on the scoreboard scale', () => {
      const parts = scramble(defaultScene('u', 6, 5));
      const footprint = footprintForLayout('u', 6, 5);
      const model = prepare({
        parts,
        movable: parts.map((p) => !p.locked && !p.wallMounted),
        footprint,
      });
      let checked = 0;
      for (const seed of SEEDS) {
        for (const c of poolAt(seed)) {
          const raw = navigabilityCost(model, c.placements, NAV_CELL);
          expect(c.navCost).toBeCloseTo(DEFAULT_WEIGHTS.navigation * raw, 6);
          if (raw > 0) checked++;
        }
      }
      expect(checked, 'every raw navigability was zero, so the weight is unexercised').toBeGreaterThan(4);
    }, 900_000);

    // The navigability pass exists because the pool's own sort — by `cost` — gets the
    // answer wrong. If the two orders never disagreed there would be nothing to pass.
    it('chooses on total, which is not the order the pool arrives in', () => {
      const disagrees = SEEDS.filter((seed) => {
        const pool = poolAt(seed);
        const byTotal = pool.reduce((bi, x, i) => (x.total < pool[bi].total ? i : bi), 0);
        return byTotal !== 0;
      });
      expect(disagrees.length, 'cheapest-by-cost was always cheapest-by-total').toBeGreaterThan(0);

      // …and on such a seed the default and the out-of-range fallback both land on the
      // argmin over TOTAL, not on the pool's first entry.
      const seed = disagrees[0];
      const pool = poolAt(seed);
      const byTotal = pool.reduce((bi, x, i) => (x.total < pool[bi].total ? i : bi), 0);
      const wanted = uSolve(seed, { pick: () => byTotal }).placements;
      const first = uSolve(seed, { pick: () => 0 }).placements;
      expect(wanted).not.toEqual(first);
      expect(uSolve(seed).placements).toEqual(wanted);
      expect(uSolve(seed, { pick: () => 99 }).placements).toEqual(wanted);
    }, 900_000);
  });

  // The aliasing this seam would otherwise have introduced. `remember` snapshots into
  // the pool, the pool is handed back as `finalists`, and the winner used to be one of
  // those snapshots BY REFERENCE — so `normaliseYaw` ran over a pool entry in place and
  // a caller ranking `finalists` was ranking an array the solve had edited underneath
  // it. Silent, and it only shows on a solve where a non-default finalist wins.
  it('does not rewrite the finalists it hands back', () => {
    const { parts, footprint } = room();
    let before: Array<Array<{ x: number; z: number; yaw: number }>> = [];
    const r = solveLayout(parts, footprint, lockedForSolve(parts, {}, null), {
      seed: 3,
      // Deep-copied inside the picker, which sees the pool before any of the four
      // post-passes touch it.
      pick: (c) => {
        before = c.map((x) => x.placements.map((p) => ({ ...p })));
        return c.length - 1;
      },
    });
    expect(before.length).toBe(r.finalists.length);
    r.finalists.forEach((f, i) => {
      expect(f.placements, `finalist ${i} was mutated by the solve`).toEqual(before[i]);
    });
  });
});

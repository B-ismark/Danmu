import { describe, expect, it } from 'vitest';
import { lockedForSolve, solveLayout, LAYOUT_SIMILAR_M, TURN_EPSILON } from '@/lib/layout-solve';
import { layoutSimilarity } from '@/lib/layout-offer';
import { defaultScene } from '@/lib/scene-spec';
import { footprintForLayout, type LayoutId } from '@/lib/footprint';

/**
 * Is there anything for the offer stage to rank?
 *
 * Layer 3a assumes a solve leaves *several good arrangements* to choose between. That
 * is an assumption about the annealer, not about the ranker, and it was never measured
 * — so this file measures it and prints the tables on every run.
 *
 * ── The answer depends entirely on which room you ask about ───────────────────
 *
 * On the **seeded** scene the solver moves nothing, and that is correct: a
 * `defaultScene` is already at a local optimum. Five of the six presets move zero
 * pieces at every seed and hand back a pool of ONE. On a **scrambled** room — the
 * case a person actually presses Suggest for — every preset gives a pool of four at
 * every seed and the winners are 0.46–0.67 alike, with almost no identical pairs.
 *
 * Both tables are kept because the first one nearly became the finding on its own.
 * Read alone it says "the pool holds one candidate, so MMR has nothing to rank" — a
 * conclusion about the whole layer, drawn from the one fixture that cannot express
 * the thing being measured. One more measurement reversed it.
 *
 * **And the first version of this file measured the wrong rooms**, which is why the
 * numbers above are not the ones the reversal was first written up with.
 * `defaultScene`'s first argument is a `LayoutId`, not a room type; it was being
 * passed `'living'`, which is not one, so every non-rect row seeded RECT furniture
 * into an L, T or U footprint. Vitest never noticed — it transpiles without
 * typechecking — so the file ran green and printed a plausible table for half an
 * hour. `pnpm test` and `pnpm typecheck` are different gates and a test file can pass
 * one while failing the other.
 *
 * These are measurements, not specifications. They print rather than pin, except for
 * the three claims underneath that the design depends on.
 */
const LAYOUTS: Array<[LayoutId, number, number]> = [
  ['rect', 6, 4],
  ['rect', 7.5, 5.6],
  ['l', 6, 5],
  ['t', 6, 5],
  ['u', 6, 5],
  ['open', 6, 4],
];

const T = { spotM: LAYOUT_SIMILAR_M, yawRad: TURN_EPSILON };
const SEEDS = 8;

/** Everything pushed into one corner, the same shape of scramble the solve and
 *  bed-rung suites use, so a number can be carried between them. */
const scramble = (parts: ReturnType<typeof defaultScene>) =>
  parts.map((p, i) => ({
    ...p,
    pos: [-1 + (i % 3) * 0.4, p.pos[1], -1 + Math.floor(i / 3) * 0.4] as [number, number, number],
  }));

function sweep(prep: (p: ReturnType<typeof defaultScene>) => ReturnType<typeof defaultScene>) {
  return LAYOUTS.map(([id, w, d]) => {
    const pools: number[] = [];
    const moves: number[] = [];
    const wins: Array<ReturnType<typeof solveLayout>['placements']> = [];
    for (let seed = 1; seed <= SEEDS; seed++) {
      const parts = prep(defaultScene(id, w, d));
      const r = solveLayout(parts, footprintForLayout(id, w, d), lockedForSolve(parts, {}, null), {
        seed,
      });
      pools.push(r.finalists.length);
      moves.push(r.moved.length);
      wins.push(r.placements);
    }
    const sims: number[] = [];
    for (let i = 0; i < wins.length; i++) {
      for (let j = i + 1; j < wins.length; j++) sims.push(layoutSimilarity(wins[i], wins[j], T));
    }
    return {
      label: `${id} ${w}x${d}`,
      pools,
      moves,
      meanSim: sims.reduce((a, b) => a + b, 0) / sims.length,
      identical: sims.filter((s) => s === 1).length,
      pairs: sims.length,
    };
  });
}

const table = (title: string, rows: ReturnType<typeof sweep>) =>
  `\n${title}, seeds 1..${SEEDS}\n` +
  `${'preset'.padEnd(14)}${'finalists'.padEnd(12)}${'moved'.padEnd(20)}mean sim   identical\n` +
  rows
    .map(
      (r) =>
        r.label.padEnd(14) +
        r.pools.join('').padEnd(12) +
        r.moves.join(',').padEnd(20) +
        r.meanSim.toFixed(3).padStart(8) +
        `   ${r.identical}/${r.pairs}`,
    )
    .join('\n') +
  '\n';

describe('is there anything for the offer stage to rank', () => {
  const seeded = sweep((p) => p);
  const scrambled = sweep(scramble);

  it('prints both tables', () => {
    console.log(table('SEEDED scene — already good, so nothing is moved', seeded));
    console.log(table('SCRAMBLED room — the case Suggest is actually for', scrambled));
    expect(seeded.length).toBe(LAYOUTS.length);
    expect(scrambled.length).toBe(LAYOUTS.length);
  }, 900_000);

  // The premise of layer 3a. If this ever goes red, ranking finalists has stopped
  // being worth doing and the design needs revisiting rather than the number widening.
  it('leaves several candidates on every preset once the room needs help', () => {
    for (const r of scrambled) {
      expect(Math.min(...r.pools), `${r.label} left a pool of ${Math.min(...r.pools)}`).toBeGreaterThan(1);
    }
  }, 900_000);

  // …and they are genuinely different arrangements rather than four rounding errors
  // apart, which is what makes diversifying them mean anything.
  it('and those candidates differ from each other', () => {
    for (const r of scrambled) {
      expect(r.meanSim, `${r.label} winners are ${r.meanSim.toFixed(3)} alike across seeds`).toBeLessThan(0.9);
    }
  }, 900_000);

  // The counterweight, kept because it is the reading that nearly became a finding:
  // on its own seeded scene the solver moves nothing, and that is correct behaviour
  // rather than a defect in the pool. It is also a fact about the SEEDER worth
  // knowing on its own — the starter arrangements are at local optima the annealer
  // cannot beat, which is why "Suggest" on a fresh room says so and stops.
  //
  // Counted rather than named, so a preset changing which side it falls on is a red
  // here instead of a silent shift: `t` is the one that does move, on 2 of 8 seeds.
  it('moves nothing on the arrangements it ships with', () => {
    const still = seeded.filter((r) => Math.max(...r.moves) === 0);
    expect(still.length, `only ${still.length} of ${seeded.length} presets were left alone`).toBe(
      LAYOUTS.length - 1,
    );
    for (const r of still) expect(Math.max(...r.pools), `${r.label}`).toBe(1);
  }, 900_000);
});

import { describe, it, expect } from 'vitest';
import {
  lockedForSolve,
  makeRng,
  movableFor,
  randomizeStart,
  solveLayout,
  NEGLIGIBLE_COST,
  LAYOUT_SIMILAR_M,
  TURN_EPSILON,
  bestCandidate,
  type Candidate,
  type SolveResult,
} from '@/lib/layout-solve';
import { DEFAULT_WEIGHTS } from '@/lib/layout-score';
import { layoutSimilarity } from '@/lib/layout-offer';
import {
  isCleanShuffle,
  newRoomFindings,
  shuffleRoom,
  DIVERSITY_PENALTY,
  REPEAT_SIMILARITY,
  shuffleRefusal,
} from '@/lib/layout-shuffle';
import { defaultScene } from '@/lib/scene-spec';
import { footprintForLayout, pointInFootprint, roomContainment, type LayoutId } from '@/lib/footprint';
import { roleOf } from '@/lib/layout-rules';

/** Every cost term at zero, derived from the weight table so a new term cannot leave
 *  this fixture one key short of the type it claims to be. */
const ZERO_BREAKDOWN = {
  ...(Object.fromEntries(Object.keys(DEFAULT_WEIGHTS).map((k) => [k, 0])) as Record<string, number>),
  total: 0,
} as unknown as SolveResult['breakdownAfter'];

// Shuffle — a different arrangement, as distinct from a repair.
//
// The fixtures are `defaultScene` presets rather than a hand-built room, and that is
// the point of the first test: a seeded scene is a local optimum, so `mode: 'arrange'`
// moves NOTHING in it — measured, and printed on every run by
// `tests/layout-offer-pool.test.ts`. That is correct for a repair tool and it is
// exactly the complaint this feature answers.
//
// A hand-built "already tidy" room was tried here first and is the wrong fixture:
// whether a room is at a local optimum is a property of the cost function, not
// something the author can assert by arranging the furniture sensibly. The first
// version guessed, `arrange` moved three pieces, and the bar had to be loosened to
// `<= 1` — at which point it no longer measured the claim at all.

/** Every preset `layout-offer-pool` reports as untouched at every seed. `t` is
 *  excluded there and here: it alone moves pieces on the seeded scene, so it is not
 *  an "already good" room and cannot carry that claim. It IS included in the
 *  fault-freedom sweep below, where it is the hardest case and the whole reason the
 *  candidate filter exists. */
const SETTLED: Array<[LayoutId, number, number]> = [
  ['rect', 6, 4],
  ['l', 6, 5],
  ['u', 6, 5],
  ['open', 6, 4],
];
const ALL: Array<[LayoutId, number, number]> = [...SETTLED, ['t', 6, 5]];

/** The ceiling the presets are seeded against, so the room-report gate inside
 *  `shuffleRoom` measures the same room `defaultScene` built. */
const CEILING = 2.4;

const room = (id: LayoutId, w: number, d: number) => {
  const parts = defaultScene(id, w, d);
  const footprint = footprintForLayout(id, w, d);
  const locked = lockedForSolve(parts, {}, null);
  return {
    parts,
    footprint,
    room: { footprint, height: CEILING },
    locked,
    movable: movableFor(parts, locked),
  };
};

/** Every preset in `ALL` pressed three times, computed once and shared.
 *
 *  Two tests read the same fifteen presses (five presets × three) — "never offers a
 *  room Room check would
 *  report" and "never offers a rug through the plaster" — and each press is a full
 *  search, seconds apiece on `t`. The sweep is deterministic per (room, attempt), so
 *  sharing it changes nothing but the wall clock. */
let sweepCache: ReturnType<typeof runSweep> | null = null;
function runSweep() {
  const out = [];
  for (const [id, w, d] of ALL) {
    const { parts, room: rm, locked } = room(id, w, d);
    for (const attempt of [1, 2, 3]) {
      out.push({ id, attempt, parts, rm, outcome: shuffleRoom(parts, rm, locked, { attempt }) });
    }
  }
  return out;
}
const presetSweep = () => (sweepCache ??= runSweep());

/** How many ideas `presetSweep` offers in the presets that carry a rug. */
const RUG_IDEAS_CHECKED = 45;

// ── Three tests below USED to carry an explicit 30 s timeout ────────────
//
// Measured on an idle machine at 3429 ms, 2129 ms and 3548 ms — 1.4–2.3× inside
// vitest's then-default 5000 ms, which is not headroom, it is a coin toss. Under a
// full-suite run they went red and in isolation they went green, which is the
// most expensive shape of failure there is: it reads as a regression in whatever
// was changed that day, and the debugging happens somewhere else entirely.
//
// § A.4 then found that same default doing the same thing to three `layout-solve`
// tests, and `vitest.config.ts` now sets 30 s globally with the measurement beside
// it. That made this constant byte-identical to the global and deleting it changes
// nothing — which is the shape this repo calls an unpinned constant: it could not go
// red, and its comment still claimed a deliberate three-way 30/60/300 distinction
// that had collapsed to two. The 60 s and 300 s budgets on the sweeps below are real
// and stay, because those iterate presets × attempts and these do not.

describe('randomizeStart', () => {
  it('leaves locked and wall-mounted pieces exactly where they are', () => {
    const { parts, footprint } = room('rect', 6, 4);
    const free = parts.findIndex((p) => !p.wallMounted && !p.locked);
    expect(free, 'the preset must contain something movable to pin').toBeGreaterThanOrEqual(0);
    const locked = lockedForSolve(parts, { [parts[free].id]: true }, null);
    const movable = movableFor(parts, locked);

    const start = randomizeStart(parts, footprint, movable, makeRng(7));
    let heldStill = 0;
    for (let i = 0; i < parts.length; i++) {
      if (movable[i]) continue;
      heldStill++;
      expect(start[i], parts[i].id).toEqual({ x: parts[i].pos[0], z: parts[i].pos[2], yaw: parts[i].rot });
    }
    // A floor under the sweep: with nothing immovable in the room the loop above
    // asserts over an empty set and passes against a generator that moved
    // everything. The pin guarantees one; the preset's fixtures carry the rest.
    expect(heldStill, 'the pin and the wall-mounted fixtures').toBeGreaterThan(1);
  });

  it('scatters movable pieces inside the footprint, not merely inside its bounding box', () => {
    // On an L, T or U the bounding box includes floor the room does not have, which
    // is the failure this samples for — a generator using `±width/2` puts pieces in
    // the notch and every one of them reads as inside the box.
    for (const [id, w, d] of ALL) {
      const { parts, footprint, movable } = room(id, w, d);
      const rng = makeRng(3);
      let checked = 0;
      for (let trial = 0; trial < 20; trial++) {
        const start = randomizeStart(parts, footprint, movable, rng);
        for (let i = 0; i < parts.length; i++) {
          if (!movable[i]) continue;
          checked++;
          expect(pointInFootprint(start[i].x, start[i].z, footprint), `${id}: ${parts[i].id}`).toBe(true);
        }
      }
      expect(checked, `${id} must have movable pieces to place`).toBeGreaterThan(0);
    }
  });

  it('is deterministic per seed, and not merely constant', () => {
    const { parts, footprint, movable } = room('rect', 6, 4);
    const a = randomizeStart(parts, footprint, movable, makeRng(11));
    expect(randomizeStart(parts, footprint, movable, makeRng(11))).toEqual(a);
    // Without this half, the assertion above holds against a generator that
    // scatters nothing at all.
    expect(randomizeStart(parts, footprint, movable, makeRng(12))).not.toEqual(a);
  });
});

/** As many scatters as `shuffleRoom` itself is allowed — see `MAX_CANDIDATES`. A
 *  single seed is not a fair test of a solver that may decline; the production
 *  pipeline never asks one. */
const SHUFFLE_SEEDS = [42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53];

describe("solveLayout mode: 'shuffle'", () => {
  it('moves a room that mode "arrange" leaves completely untouched', () => {
    for (const [id, w, d] of SETTLED) {
      const { parts, footprint, locked, movable } = room(id, w, d);
      // The premise, asserted rather than assumed: this room is already settled, so
      // the repair path has nothing to offer in it.
      const arranged = solveLayout(parts, footprint, locked, { seed: 1, mode: 'arrange' });
      expect(arranged.moved, `${id} must be an already-good room`).toEqual([]);

      // Over a sweep of scatters rather than one, because since § 31 a shuffle solve
      // DECLINES rather than hand back an arrangement more impossible than the room
      // it was given, and a scatter the search cannot rescue would be.
      //
      // **The numbers this comment carried no longer reproduce**: "moved 4, clean 4"
      // on `rect` 6 x 4 over ten seeds, and 25 of 40 presses offering over five
      // presets x eight presses. On the code just before the search was fixed (see
      // "prices every finalist as its own placements" below) the same sweep, seeds 42–51,
      // read moved 1, clean 0 and 38 of 40, because that search accepted no steps.
      // Once it ran: **moved 10, clean 9**, and **40 of 40** presses offer. Seed 42 on
      // `rect`, the decliner this sweep was written for, now moves.
      //
      // So the honest form of the property is still the pipeline's own — twelve tries,
      // as `MAX_CANDIDATES` allows — rather than a single seed that must not be
      // unlucky, because declining is still what a solve should do when it cannot
      // rescue its scatter.
      // Stops at the first mover rather than scoring all twelve. One solve is seconds
      // and four presets x twelve was over this test's own budget under a full-suite
      // run — which is the honest reason, not a flake.
      let tried = 0;
      let moved = 0;
      for (const seed of SHUFFLE_SEEDS) {
        tried++;
        const start = randomizeStart(parts, footprint, movable, makeRng(seed));
        moved = solveLayout(parts, footprint, locked, { seed, mode: 'shuffle', start }).moved.length;
        if (moved > 0) break;
      }
      expect(moved, `${id} shuffled — no scatter in ${tried} produced a move`).toBeGreaterThan(0);
    }
  });

  it('never moves a locked or wall-mounted piece', () => {
    const { parts, footprint } = room('rect', 6, 4);
    const free = parts.findIndex((p) => !p.wallMounted && !p.locked);
    const locked = lockedForSolve(parts, { [parts[free].id]: true }, null);
    const movable = movableFor(parts, locked);

    let everMoved = 0;
    for (const seed of [1, 2, 3, 4, 5]) {
      const start = randomizeStart(parts, footprint, movable, makeRng(seed));
      const result = solveLayout(parts, footprint, locked, { seed, mode: 'shuffle', start });
      if (result.moved.length > 0) everMoved++;
      for (const i of result.moved) {
        expect(movable[i], `${parts[i].id} moved but is locked or wall-mounted`).toBe(true);
      }
      // The pinned piece specifically — a door that never moves proves less than a
      // sofa the solver would otherwise love to move staying put.
      expect(result.moved).not.toContain(free);
    }
    // The floor, and it has to be over the SET rather than per seed: since § 31 a
    // shuffle solve declines rather than hand back an arrangement more impossible
    // than the room it was given, so an individual seed legitimately moves nothing.
    // Without this line every assertion above passes vacuously on five empty lists.
    expect(everMoved, 'no seed moved anything — the assertions above proved nothing').toBeGreaterThan(0);
  });

  // The search ran for weeks without accepting a step. `cost` started at `before`, the
  // price of the tidy room, while `current` was the scatter, so every proposal looked
  // hundreds of units uphill and was refused; the pool kept one finalist, the scatter,
  // under the tidy room's price. Nothing here could see it — a legal scatter still
  // passed every gate — so the two tests below assert what the bug broke rather than
  // what it produced. Both read one sweep of forty solves, taken once.
  let sweep: Array<{ id: LayoutId; seed: number; rated: readonly Candidate[] }> | undefined;
  const shuffleSweep = () =>
    (sweep ??= ALL.flatMap(([id, w, d]) => {
      const { parts, footprint, locked, movable } = room(id, w, d);
      return [1, 2, 3, 4, 5, 6, 7, 8].map((seed) => {
        const start = randomizeStart(parts, footprint, movable, makeRng(seed));
        let rated: readonly Candidate[] = [];
        // `pick` is only a window onto the finalists: it answers what the default
        // picker would, so the solve is the one the Ideas panel runs.
        solveLayout(parts, footprint, locked, {
          seed,
          mode: 'shuffle',
          start,
          pick: (r) => {
            rated = r;
            return bestCandidate(r);
          },
        });
        return { id, seed, rated };
      });
    }));

  it('prices every finalist as its own placements', { timeout: 120_000 }, () => {
    // `breakdown` is the solver's own full pricing of the finalist — its model, its
    // weights — so this compares the solver with itself rather than with a copy of its
    // weight table. `cost` leaves navigation out; the rest of the sum must agree. False
    // on 40 of 40 before the fix: 2.44 against a real 2,161 on `rect` seed 1.
    let checked = 0;
    for (const { id, seed, rated } of shuffleSweep()) {
      for (const c of rated) {
        checked++;
        expect(c.cost, `${id} seed ${seed}: a finalist carries another layout's price`).toBeCloseTo(
          c.breakdown.total - c.breakdown.navigation,
          6,
        );
      }
    }
    // A loop over whatever `pick` saw passes over an empty list, so the count is the
    // assertion's own floor: forty solves, two of which (`l` seed 7, `open` seed 8)
    // keep three. It was 159 — `t` seed 4 the one short — until the search priced a
    // rug through the plaster, which moves any trajectory whose scatter put one there.
    expect(checked, 'the finalists this sweep compared').toBe(158);
  });

  it('keeps a pool of finalists, because the search moves', { timeout: 120_000 }, () => {
    // A search that accepts no step finds no new best, so its pool is the scatter
    // alone: `11111111` on every preset before the fix. Four is `FINALISTS`, the most a
    // pool keeps; `l` seed 7 and `open` seed 8 fill three (`t` seed 4 did, before the
    // search priced a rug), so a full pool is not a property to lean on.
    const pools = ALL.map(([id]) => [
      id,
      shuffleSweep()
        .filter((r) => r.id === id)
        .map((r) => r.rated.length)
        .join(''),
    ]);
    expect(pools).toEqual([
      ['rect', '44444444'],
      ['l', '44444434'],
      ['u', '44444444'],
      ['open', '44444443'],
      ['t', '44444444'],
    ]);
  });

  it('an `arrange` handed a start is priced from that start too', () => {
    // No caller does this today — only `shuffle` passes `start` — and that is why it is
    // pinned: the day one does, a guard keyed on the MODE would hand it the origin's
    // price and a search that accepts nothing, the defect above in another mode.
    const { parts, footprint, locked, movable } = room('rect', 6, 4);
    const start = randomizeStart(parts, footprint, movable, makeRng(1));
    let rated: readonly Candidate[] = [];
    solveLayout(parts, footprint, locked, {
      seed: 1,
      mode: 'arrange',
      start,
      pick: (r) => {
        rated = r;
        return bestCandidate(r);
      },
    });
    // Three, and the number is the search's trajectory rather than a property of it —
    // it was four until the search priced a rug. The defect this guards reads ONE.
    expect(rated.length, 'one finalist is the start alone: nothing was accepted').toBe(3);
  });

  it('is deterministic: same room, same seed, same suggestion', () => {
    const { parts, footprint, locked, movable } = room('rect', 6, 4);
    const start = randomizeStart(parts, footprint, movable, makeRng(5));
    const a = solveLayout(parts, footprint, locked, { seed: 5, mode: 'shuffle', start });
    const b = solveLayout(parts, footprint, locked, { seed: 5, mode: 'shuffle', start });
    expect(a.placements).toEqual(b.placements);
  });
});

describe('shuffleRoom — the offer, not the search', () => {
  it('a hard term is judged NEGLIGIBLE, not zero — and the bound is pinned at both ends', () => {
    // **Why this is not a loosening, and why it is a pair.** `isCleanShuffle` compared
    // five WEIGHTED cost terms with `=== 0`. `outside` is the one that is continuous —
    // its containment arm is `deficit / radius`, a ratio of two floats — so a piece the
    // settle pass put back inside the polygon can land a fraction of a picometre past
    // the boundary and score for it. Measured through `shuffleRoom`'s own loop over 90
    // attempts: of 826 rejected candidates, **5 had no fault except an `outside` in the
    // 1e-14 range**. Each was an arrangement clean by any tolerance a person would name,
    // and a candidate discarded for a picometre is one the user is not offered.
    //
    // A guard written against the wrong constant refuses every legal value, so the
    // accepting half and the REFUSING half are asserted together. Without the second,
    // `() => true` passes.
    const at = (outside: number, overlap = 0): SolveResult =>
      ({
        moved: ['a'],
        breakdownAfter: { ...ZERO_BREAKDOWN, outside, overlap },
      } as unknown as SolveResult);

    expect(isCleanShuffle(at(0)), 'an exactly-clean candidate').toBe(true);
    expect(
      isCleanShuffle(at(4.681111291435601e-13)),
      'the largest sub-epsilon outside any measured shuffle produced',
    ).toBe(true);
    expect(isCleanShuffle(at(NEGLIGIBLE_COST)), 'exactly at the bound is negligible').toBe(true);
    // The refusing half, one ulp-ish above the bound and then at a real signal.
    expect(isCleanShuffle(at(NEGLIGIBLE_COST * 1.0001)), 'just past the bound is a fault').toBe(false);
    expect(isCleanShuffle(at(0.0113)), 'the smallest real signal any hard term reached').toBe(false);
    expect(isCleanShuffle(at(0, 0.0113)), 'a real fault on a term that is never noisy').toBe(false);
    // A candidate that moved nothing is still refused, tolerance or not.
    expect(isCleanShuffle({ moved: [], breakdownAfter: ZERO_BREAKDOWN } as unknown as SolveResult)).toBe(false);

    // **Both ends of the constant.** Asserted from below only, it would be free to
    // shrink back to something the measured noise clears; from above only, free to grow
    // until it swallows a real fault. The two numbers are the measured ones.
    expect(NEGLIGIBLE_COST, 'must clear the worst float residue any sweep produced').toBeGreaterThan(
      4.681111291435601e-13,
    );
    expect(NEGLIGIBLE_COST, 'must stay far below the smallest real signal measured').toBeLessThan(0.0113);
  });
  it('the candidates a shuffle ranks are already unlike each other — which is what keeps the diversity term small', { timeout: 300_000 }, () => {
    // `orderOffers` scores `cost + penalty x (closest already picked)`, and the clean set
    // is mostly mutually dissimilar, so the penalty mostly multiplies zero. On the search
    // that accepted no steps it multiplied zero everywhere that mattered — 26 of 26
    // end-to-end pairs byte-identical, which is why § A.2's test once could not be
    // written. On the one that runs it reorders two presses in 66 (the test above), and
    // this is the bound on how far it can reach.
    //
    // The clean set is rebuilt the way `shuffleRoom` builds it — same seed derivation,
    // same two gates, both exported — because `clean` is a local. The reconstruction is
    // asserted to reach a real set rather than assumed to: a sweep over "whatever it
    // found" passes over an empty list, and 0 pairs would satisfy every bound below.
    const sims: number[] = [];
    let candidates = 0;
    for (const [id, w, d] of [['rect', 6, 4], ['l', 6, 4], ['open', 6, 4]] as const) {
      const { parts, footprint, locked, movable } = room(id, w, d);
      const clean: ReturnType<typeof solveLayout>[] = [];
      for (let sSeed = 0; sSeed < 12 && clean.length < 4; sSeed++) {
        const start = randomizeStart(parts, footprint, movable, makeRng(sSeed));
        const r = solveLayout(parts, footprint, locked, { seed: sSeed, mode: 'shuffle', start });
        if (!isCleanShuffle(r)) continue;
        if (newRoomFindings(parts, { footprint, height: 2.5 }, r).length > 0) continue;
        clean.push(r);
      }
      candidates += clean.length;
      for (let i = 0; i < clean.length; i++)
        for (let j = i + 1; j < clean.length; j++)
          sims.push(
            layoutSimilarity(clean[i].placements, clean[j].placements, {
              spotM: LAYOUT_SIMILAR_M,
              yawRad: TURN_EPSILON,
              movable,
            }),
          );
    }

    expect(candidates, 'the reconstruction must reach real candidates, or every bound below is vacuous').toBeGreaterThan(4);
    expect(sims.length, 'and enough PAIRS to compare — one candidate per room yields none').toBeGreaterThan(2);
    const worst = Math.max(...sims);
    console.log(`  clean candidates=${candidates} pairs=${sims.length} zero=${sims.filter((v) => v === 0).length} worst=${worst.toFixed(3)}`);

    // The agreement itself. Not `worst === 0` — 15 of 177 pairs were non-zero over six
    // presets x five presses, 0.100 to 0.400 — but that no pair comes near the bar at
    // which a repeat would be skipped, and that what the penalty can add stays small
    // against the cost it is added to.
    expect(
      worst,
      'a candidate pair reached REPEAT_SIMILARITY: the search is producing near-duplicates and the diversity term now has work to do — see DIVERSITY_PENALTY',
    ).toBeLessThan(REPEAT_SIMILARITY);
    expect(
      DIVERSITY_PENALTY * worst,
      'the diversity term can now outweigh a real cost difference between candidates',
    ).toBeLessThan(2);
  });
  it('the diversity term reorders a press — the test § A.2 asked for', { timeout: 120_000 }, () => {
    // Fails at `diversityPenalty: 0`, which is the whole ask. It could not be written
    // while the search accepted no steps (every pair came back byte-identical); on the
    // search that runs, two presses of 66 swept (six presets x attempts 2–12, each with
    // the previous press's first idea as history) come back in a different order —
    // `rect` 6 x 4 press 7 and this one. Same four ideas, same first one — `picked = []`
    // cannot move `ranked[0]` — and the term trades the second for a less similar dearer
    // one. The history is built the way the gallery builds it, press after press, so
    // the fixture is one real sequence rather than a history chosen to provoke it.
    //
    // **Which press it is, is the search's trajectory, not a property of the term.** It
    // was press 4 of this room until the search priced a rug (§ H.6.1), after which none
    // of presses 2–5 on any preset reordered and the sweep had to widen to find one. So
    // if this goes red after a change to the COST, re-run that sweep before concluding
    // the term broke: the press may simply have moved.
    const { parts, room: r, locked } = room('rect', 7.5, 5.6);
    const ids = parts.map((p) => p.id);
    let prev = shuffleRoom(parts, r, locked, { attempt: 1 });
    for (let attempt = 2; attempt <= 5; attempt++)
      prev = shuffleRoom(parts, r, locked, { attempt, history: [{ ids, placements: prev!.ideas[0].placements }] });
    const history = [{ ids, placements: prev!.ideas[0].placements }];
    const order = (penalty?: number) =>
      shuffleRoom(parts, r, locked, { attempt: 6, history, diversityPenalty: penalty })!.ideas.map((i) =>
        i.after.toFixed(1),
      );
    const withTerm = order();
    const without = order(0);
    console.log(`  rect 7.5x5.6 attempt 6: penalty ${DIVERSITY_PENALTY} [${withTerm}] · penalty 0 [${without}]`);
    expect(without, 'the premise: without the term the press ranks on cost alone').toEqual(
      [...without].sort((a, b) => Number(a) - Number(b)),
    );
    expect(withTerm, 'the term changed nothing here: see DIVERSITY_PENALTY').not.toEqual(without);
    expect([...withTerm].sort(), 'it reorders; it never adds or drops an idea').toEqual([...without].sort());
    expect(withTerm[0], 'and it cannot move the first pick').toBe(without[0]);
  });
  it('the refusal counts the findings it does not name, rather than naming them all', () => {
    // The wire test (`tests/shuffle-refusal-wired.test.tsx`) drives both branches
    // through the panel; it cannot reach this one, because it would need a fixture
    // seeding two hard findings and that is a property of the seeder rather than of
    // this sentence. The count is DERIVED — a hand-typed number beside a list one line
    // away is the defect this repo keeps finding — so the assertion is that it moves
    // with the list, not that it equals 1.
    const issue = (title: string) => ({ title }) as unknown as Parameters<typeof shuffleRefusal>[0][number];
    expect(shuffleRefusal([issue('Bed hard to get into')]).message).not.toContain(' more,');
    expect(
      shuffleRefusal([issue('Bed hard to get into'), issue('Door blocked')]).message,
    ).toContain('and 1 more,');
    expect(
      shuffleRefusal([issue('A'), issue('B'), issue('C'), issue('D')]).message,
    ).toContain('and 3 more,');
    // The empty list is the OTHER sentence, and it must not fall through to this one:
    // forcing that branch open crashes on `blockers[0]`, so the guard is load-bearing.
    expect(shuffleRefusal([]).title).toBe('No ideas this time');
  });

  it('a single solve is NOT reliably clean, which is why the pipeline exists', { timeout: 60_000 }, () => {
    // The negative control for the test below, and the finding the filter answers.
    // Without it, "shuffleRoom returns a clean room" reads as a property of
    // `solveLayout` that the filter is not needed for. Measured at 4/20 clean on this
    // preset and these seeds (1/20 before the search accepted any steps); asserted
    // loosely because the exact count moves with any re-price of the cost function,
    // while the fact that raw solves fault does not.
    const { parts, footprint, locked, movable } = room('t', 6, 5);
    let faulted = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const start = randomizeStart(parts, footprint, movable, makeRng(seed));
      const r = solveLayout(parts, footprint, locked, { seed, mode: 'shuffle', start });
      if (!isCleanShuffle(r)) faulted++;
    }
    expect(faulted, 'raw shuffle solves on the T fault often — see lib/layout-shuffle.ts').toBeGreaterThan(0);
  });

  it('never offers a room that ROOM CHECK would report', { timeout: 300_000 }, () => {
    // ── Asserted through `analyzeRoom`, deliberately, and this is the point ────
    //
    // The first version of this test swept `HARD_TERMS` — which is the exact list
    // `isCleanShuffle` filters on, so it could not fail: the filter guarantees it.
    // It even called itself "the hard faults Room check reports" while never asking
    // Room check. That is this repo's "measures its own subject", and it hid a real
    // defect: the solver exempts a `sharesFloor` pair from `overlap` outright while
    // `clearance.ts` allows it only up to `TUCKED_CLASH_SHARE`, so a dining chair
    // buried inside the dining table costs the search nothing and the report calls
    // it a clash. Measured before the room-report gate existed: 8 of 40 offers.
    //
    // `newRoomFindings` compares against the room BEFORE the shuffle, because a
    // preset that already has a finding is not this button's to answer for; what a
    // shuffle may not do is INTRODUCE one.
    let offers = 0;
    for (const { id, attempt, parts, rm, outcome } of presetSweep()) {
      if (!outcome) continue; // refusing is allowed; offering something broken is not
      offers++;
      // Every idea offered, not only the first: the gallery shows all of them.
      expect(outcome.ideas.length, `${id} attempt ${attempt} offered nothing`).toBeGreaterThan(0);
      for (const idea of outcome.ideas) {
        const found = newRoomFindings(parts, rm, idea);
        expect(
          found.map((f) => `${f.rule}:${f.partIds.join(',')}`),
          `${id} attempt ${attempt} introduced a finding`,
        ).toEqual([]);
        expect(idea.moved.length, `${id} attempt ${attempt}`).toBeGreaterThan(0);
      }
    }
    // The floor. Without it a build where `shuffleRoom` always returned null would
    // pass this sweep having asserted nothing at all — which is exactly how the
    // `before`-from-origin regression got as far as it did.
    expect(offers, 'the sweep must actually have offers to check').toBeGreaterThanOrEqual(
      ALL.length * 2,
    );
  });

  it('never offers a rug through the plaster — the one containment Room check forgives', { timeout: 300_000 }, () => {
    // The test above cannot see this, by design: `clearance.ts` § 7b calls a rug
    // outside only when its CENTRE is off the plan, because overhang is what a rug is
    // for when somebody put it there. An Idea is a place nobody chose, so the search
    // holds a rug to the walls (`containedBySearch`), and this asks whether it did.
    //
    // The witness is `roomContainment(...).box` — the drag's strict test, 10 mm of
    // slack — and NOT `outsideDeficit`, which is the cost term's own instrument: an
    // idea is only offered once `isCleanShuffle` has seen `outside` at zero, so
    // asking the term's instrument again would be a check that cannot fail.
    //
    // Before the search priced a rug, this sweep found it through a wall in 9 of the
    // ideas below: rect 6x4 twice (143, 456 mm), l twice (423, 788 mm) and open five
    // times (27–383 mm), every one with its centre on the floor.
    let rugIdeas = 0;
    const through: string[] = [];
    for (const { id, attempt, parts, rm, outcome } of presetSweep()) {
      const rugs = parts.map((p, i) => (roleOf(p) === 'rug' ? i : -1)).filter((i) => i >= 0);
      if (!outcome || rugs.length === 0) continue;
      for (const [k, idea] of outcome.ideas.entries()) {
        rugIdeas++;
        for (const i of rugs) {
          const at = idea.placements[i];
          const p = parts[i];
          const c = roomContainment([at.x, p.pos[1], at.z], at.yaw, p.dimMM, rm.footprint, p.circle);
          if (!c.box) through.push(`${id} attempt ${attempt} idea ${k + 1}: ${p.name}`);
        }
      }
    }
    expect(through).toEqual([]);
    // Exact, not a floor: the presets that carry a rug are rect, l, open and t, and
    // this is how many ideas their twelve presses offered when it was written.
    expect(rugIdeas).toBe(RUG_IDEAS_CHECKED);
  });

  it('still offers ideas around a pinned rug that hangs over the skirting', () => {
    // The limit of the test above. Room check forgives a rug its overhang, so a user
    // can pin one 300 mm through the east wall and see no finding at all. When the
    // search charged that overhang, `isCleanShuffle` (which asks for `outside` at an
    // absolute zero) refused every candidate, and with no finding to name
    // `shuffleRefusal` could only say something was in the way: 3 of 3 presses came
    // back null. The rug is forgiven the overhang it already had.
    const { parts: base, room: rm } = room('rect', 6, 4);
    const ri = base.findIndex((p) => roleOf(p) === 'rug');
    expect(ri, 'the seeded 6 x 4 has a rug').toBeGreaterThanOrEqual(0);
    expect(base[ri].rot, 'square to the walls, so its half-width is dimMM[0] / 2').toBe(0);
    const parts = base.map((p, i) =>
      i === ri ? { ...p, pos: [3.3 - p.dimMM[0] / 2000, p.pos[1], p.pos[2]] as [number, number, number] } : p,
    );
    const rug = parts[ri];
    expect(roomContainment(rug.pos, rug.rot, rug.dimMM, rm.footprint).box, 'the fixture is through the wall').toBe(false);
    const locked = lockedForSolve(parts, { [rug.id]: true }, null);
    for (const attempt of [1, 2, 3]) {
      // Non-null is the whole claim: `shuffleRoom` returns null when no candidate is
      // clean, and a clean candidate is an idea.
      expect(shuffleRoom(parts, rm, locked, { attempt }), `press ${attempt}`).not.toBeNull();
    }
  }, 60_000);

  it('moves a rug the user left over the skirting only to somewhere inside the walls', () => {
    // Review round 2's repro. The same rug, 300 mm through the east wall, NOT pinned.
    // The search forgave it that overhang as one number — how far, not over which
    // wall — wherever its centre stayed on the plan, so press 2's fourth idea laid it
    // 58 mm through the NORTH wall, which the user had never put it near. Forgiven
    // only on its own spot, an idea either leaves it exactly there or lays it inside
    // the room. Every one of these twelve does the second; the count is measured,
    // and pinned so a search change that starts leaving it put is a decision.
    const { parts: base, room: rm } = room('rect', 6, 4);
    const ri = base.findIndex((p) => roleOf(p) === 'rug');
    const parts = base.map((p, i) =>
      i === ri ? { ...p, pos: [3.3 - p.dimMM[0] / 2000, p.pos[1], p.pos[2]] as [number, number, number] } : p,
    );
    const rug = parts[ri];
    const locked = lockedForSolve(parts, {}, null);
    expect(locked[ri], 'nothing pins it').toBe(false);
    let laidInside = 0;
    for (const attempt of [1, 2, 3]) {
      const outcome = shuffleRoom(parts, rm, locked, { attempt });
      expect(outcome, `press ${attempt}`).not.toBeNull();
      expect(outcome!.ideas.length, `press ${attempt}: four, as before`).toBe(4);
      for (const [k, idea] of outcome!.ideas.entries()) {
        const at = idea.placements[ri];
        const left = at.x === rug.pos[0] && at.z === rug.pos[2] && at.yaw === rug.rot;
        const inside = roomContainment([at.x, rug.pos[1], at.z], at.yaw, rug.dimMM, rm.footprint).box;
        expect(left || inside, `press ${attempt} idea ${k + 1}: where it was left, or inside the walls`).toBe(true);
        if (inside) laidInside++;
      }
    }
    expect(laidInside, 'ideas that laid the rug inside the walls').toBe(12);
  }, 60_000);

  it('still offers ideas when the rug is bigger than the room', () => {
    // The largest rug the catalogue allows (5 x 4 m, `dimension-ranges.ts`) in a
    // 4.8 x 3.8 room: 100 mm over every wall, centred, NOT pinned — carpet nobody
    // trimmed to the plan, and a room and rug the Inspector can both reach. Every spot
    // but the one it is on hangs it further through a wall, and the anneal ends near
    // that spot rather than on it. Shuffle has no prune to hand it back, so that
    // residue tripped the impossibility veto, every candidate was reverted to the room
    // as it stood, and 3 of 3 presses came back null. (Before the search held rugs
    // they offered 4 ideas each, and all twelve had moved the rug through the walls.)
    // The rug goes home (`overhangsOffItsSpot`); the rest of the room is rearranged.
    const { parts: base, room: rm } = room('rect', 4.8, 3.8);
    const ri = base.findIndex((p) => roleOf(p) === 'rug');
    expect(ri, 'the seeded 4.8 x 3.8 has a rug').toBeGreaterThanOrEqual(0);
    const parts = base.map((p, i) =>
      i === ri
        ? { ...p, dimMM: [5000, 4000, p.dimMM[2]] as [number, number, number], pos: [0, p.pos[1], 0] as [number, number, number], rot: 0 }
        : p,
    );
    const locked = lockedForSolve(parts, {}, null);
    expect(locked[ri], 'the rug is free to move — nothing pins it').toBe(false);
    for (const attempt of [1, 2, 3]) {
      // Non-null already says there are ideas and that each moves something
      // (`isCleanShuffle` refuses one that moves nothing); what is left to say is
      // which piece did not.
      const outcome = shuffleRoom(parts, rm, locked, { attempt });
      expect(outcome, `press ${attempt}`).not.toBeNull();
      for (const idea of outcome!.ideas) {
        expect(idea.moved, `press ${attempt}: the rug stays where it was left`).not.toContain(ri);
      }
    }
  }, 60_000);

  it('still offers ideas around a rug laid wall to wall', () => {
    // A 5 x 4 m rug in a 5 x 4 room, flush on all four walls. Room check calls it
    // inside, and every spot but this one hangs it through a wall. The anneal ends a
    // centimetre or so from here, shuffle has no prune to hand the spot back, and
    // without the homing 3 of 3 presses came back null — the same as the rug bigger
    // than the room above, from the other side of the report's slack.
    const { parts: base, room: rm } = room('rect', 5, 4);
    const ri = base.findIndex((p) => roleOf(p) === 'rug');
    expect(ri, 'the seeded 5 x 4 has a rug').toBeGreaterThanOrEqual(0);
    const parts = base.map((p, i) =>
      i === ri
        ? { ...p, dimMM: [5000, 4000, p.dimMM[2]] as [number, number, number], pos: [0, p.pos[1], 0] as [number, number, number], rot: 0 }
        : p,
    );
    const rug = parts[ri];
    expect(roomContainment(rug.pos, rug.rot, rug.dimMM, rm.footprint).box, 'flush is inside').toBe(true);
    const locked = lockedForSolve(parts, {}, null);
    for (const attempt of [1, 2, 3]) {
      const outcome = shuffleRoom(parts, rm, locked, { attempt });
      expect(outcome, `press ${attempt}`).not.toBeNull();
      for (const idea of outcome!.ideas) {
        expect(idea.moved, `press ${attempt}: the rug goes home`).not.toContain(ri);
      }
    }
  }, 60_000);

  it('returns null rather than offering a faulted room when nothing can move', () => {
    const { parts, room: rm } = room('rect', 6, 4);
    // Everything pinned: there is no arrangement to find, and the honest answer is
    // "no" rather than the room it was handed.
    const allPinned = Object.fromEntries(parts.map((p) => [p.id, true]));
    const locked = lockedForSolve(parts, allPinned, null);
    expect(shuffleRoom(parts, rm, locked, { attempt: 1 })).toBeNull();
  });

  it('avoids repeating an arrangement it has just offered', () => {
    const { parts, room: rm, locked } = room('rect', 6, 4);
    const first = shuffleRoom(parts, rm, locked, { attempt: 1 });
    expect(first).not.toBeNull();
    // Asserted, not guarded: the whole body used to sit inside `if (clean > 1)`,
    // so a build that found a single candidate passed having checked nothing.
    // There must be something to choose between for the claim to mean anything.
    expect(first!.clean, 'needs more than one candidate to prefer between').toBeGreaterThan(1);
    const offered = { ids: parts.map((p) => p.id), placements: first!.ideas[0].placements };
    const second = shuffleRoom(parts, rm, locked, { attempt: 1, history: [offered] });
    expect(second).not.toBeNull();
    expect(second!.ideas.length).toBeGreaterThan(0);
    for (const idea of second!.ideas) expect(idea.placements).not.toEqual(first!.ideas[0].placements);
  });

  it('is deterministic per (room, attempt), and a new attempt is a new question', () => {
    const { parts, room: rm, locked } = room('rect', 6, 4);
    const a = shuffleRoom(parts, rm, locked, { attempt: 1 });
    const b = shuffleRoom(parts, rm, locked, { attempt: 1 });
    expect(a!.ideas.map((i) => i.placements)).toEqual(b!.ideas.map((i) => i.placements));
    const c = shuffleRoom(parts, rm, locked, { attempt: 2 });
    expect(c!.ideas[0].placements).not.toEqual(a!.ideas[0].placements);
  });
});

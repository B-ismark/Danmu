import { describe, expect, it } from 'vitest';
import {
  bestCandidate,
  declineFor,
  HARD_TERMS,
  impossibility,
  IMPOSSIBLE_TERMS,
  lockedForSolve,
  makeRng,
  openRoutes,
  solveLayout,
  type Candidate,
} from '@/lib/layout-solve';
import {
  costBreakdown,
  navigabilityCost,
  prepare,
  DEFAULT_WEIGHTS,
  NAV_CELL,
  type CostBreakdown,
  type LayoutContext,
  type Placement,
} from '@/lib/layout-score';
import { defaultScene, type ScenePart } from '@/lib/scene-spec';
import { footprintBounds, footprintForLayout, type Footprint } from '@/lib/footprint';

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
    // feature". Anything on this side is a room the report names and Try a fix acts
    // on, so putting it behind the veto would refuse arrangements the app is meant to
    // offer and then repair.
    //
    // DERIVED from `HARD_TERMS`, not typed out. A hand-written
    // `['door', 'access', 'navigation']` was a third copy of the same partition, and
    // it made this test blind in the one direction that matters: a NEW hard term is
    // absent from every list, so it silently becomes recoverable and `Fix` writes it
    // to the store. That is CLAUDE.md rule 3's shape exactly — absence inherits a
    // default, and absence is never the defect.
    const recoverable = HARD_TERMS.filter((t) => !IMPOSSIBLE_TERMS.includes(t));
    expect(recoverable, 'a hard term is either impossible or priced, and door is priced')
      .toContain('door');
    for (const term of recoverable) {
      expect(IMPOSSIBLE_TERMS, term + ' is recoverable and must stay a price').not.toContain(term);
    }
  });

  it('partitions HARD_TERMS — every hard term is on exactly one side', () => {
    // The assertion a new hard term goes red on. `isCleanShuffle` and `snapYaws` both
    // read `HARD_TERMS` and pick a new entry up for free; the § 31 veto reads
    // `IMPOSSIBLE_TERMS` and cannot. This is the line that makes someone decide.
    const recoverable = HARD_TERMS.filter((t) => !IMPOSSIBLE_TERMS.includes(t));
    expect([...IMPOSSIBLE_TERMS, ...recoverable].sort()).toEqual([...HARD_TERMS].sort());
    for (const term of IMPOSSIBLE_TERMS) expect(HARD_TERMS).toContain(term);
    // Non-empty in both directions: an emptied `IMPOSSIBLE_TERMS` makes the `for` above
    // run zero times and the subset claim vacuously true.
    expect(IMPOSSIBLE_TERMS.length, 'an empty veto is no veto').toBeGreaterThan(0);
    expect(recoverable.length, 'a veto over every hard term is not a veto either').toBeGreaterThan(0);
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

  it('anchors the tie band to the running MINIMUM, not to the incumbent', () => {
    // `bestImp = Math.min(imp, bestImp)` rather than `bestImp = imp`, and every other
    // test here uses two candidates, where the two are identical. It takes three to
    // tell them apart, and the difference is an epsilon ratchet: anchored to the
    // incumbent, each near-tie drags the band up by its own slack, so a pool walks
    // from legal to illegal one 1e-6 at a time.
    //
    // Candidate 1 wins the tie arm at imp 1e-7 while `bestImp` stays 0. Candidate 2 at
    // 1.05e-6 is then measured against 0 and rejected — with `bestImp = imp` it would
    // be measured against 1e-7, pass, and win on its far cheaper total.
    const pool = [
      cand(100, { outside: 0 }),
      cand(50, { outside: 1e-7 }),
      cand(1, { outside: 1.05e-6 }),
    ];
    expect(bestCandidate(pool)).toBe(1);
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

  it('leaves a legal room legal when it declines for impossibility', () => {
    // The revert path, on a seed that actually takes it FOR THIS REASON. It used to
    // read `l` seed 7, which declines for `no-gain` — and on that arm every assertion
    // below is true by definition, so the test survived deleting the revert itself.
    // The seeded U at 6 x 4 declines `impossible` at seeds 1, 2, 5 and 7.
    const parts = defaultScene('u', 6, 4);
    const r = solveLayout(parts, footprintForLayout('u', 6, 4), lockedForSolve(parts, {}, null), { seed: 1 });
    expect(r.declined, 'the fixture must still take the impossibility arm').toBe('impossible');
    expect(r.moved, 'a declined solve moves nothing').toEqual([]);
    // The room the caller is handed back is the legal one it came in with, NOT the
    // illegal arrangement the search proposed.
    expect(impossibility(r.breakdownBefore)).toBe(0);
    expect(impossibility(r.breakdownAfter)).toBe(0);
    expect(r.after).toBeCloseTo(r.before, 10);
    // …and the placements really are the originals, which is the part `breakdownAfter`
    // alone cannot show: it is restored by assignment, so it would read clean even if
    // the winner had not been put back.
    for (let i = 0; i < parts.length; i++) {
      expect(r.placements[i].x, parts[i].id + ' x').toBeCloseTo(parts[i].pos[0], 9);
      expect(r.placements[i].z, parts[i].id + ' z').toBeCloseTo(parts[i].pos[2], 9);
    }
  }, 300_000);
});

describe('SolveResult.declined — a refusal that can say which refusal it is', () => {
  // `moved.length === 0` is three different facts about a room wearing one shape, and
  // the UI said the friendliest of the three about all of them: *"This is already a
  // good arrangement"*. After § 31 that sentence also covered "every layout I found
  // put a piece through a wall", which is not a softening of the truth but its
  // opposite — the room may be a mess, and the app was calling it good.
  //
  // Only the solver can tell them apart, so it reports rather than letting the caller
  // infer. `RoomTools` branches on this for both `Fix` and `Try a fix`.
  const PRESETS = ['rect', 'l', 't', 'u', 'open'] as const;
  const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];

  const scramble = (parts: ReturnType<typeof defaultScene>) =>
    parts.map((p, i) => ({
      ...p,
      pos: [-1 + (i % 3) * 0.4, p.pos[1], -1 + Math.floor(i / 3) * 0.4] as [number, number, number],
    }));

  it('is null exactly when the answer is not the layout it was given', () => {
    let declines = 0;
    let impossible = 0;
    for (const id of PRESETS) {
      for (const scrambled of [true, false]) {
        for (const seed of SEEDS) {
          const base = defaultScene(id, 6, 4);
          const parts = scrambled ? scramble(base) : base;
          const r = solveLayout(parts, footprintForLayout(id, 6, 4), lockedForSolve(parts, {}, null), { seed });
          // The invariant that makes the field trustworthy: a declined solve moved
          // nothing, and a solve that moved something did not decline. Without this
          // the field could drift into decoration and no other test would notice.
          if (r.declined) {
            declines++;
            if (r.declined === 'impossible') impossible++;
            expect(r.moved, id + ' seed ' + seed + ' declined but moved something').toEqual([]);
            expect(r.after, 'a declined solve reports the cost it was given').toBeCloseTo(r.before, 10);
          } else if (r.moved.length > 0) {
            expect(r.after, 'an applied solve is not dearer than what it replaced').toBeLessThan(r.before + 1e-9);
          }
        }
      }
    }
    // Both arms have to occur, or the loop above proves nothing about either.
    expect(declines, 'no solve declined — the assertions above never ran').toBeGreaterThan(0);
    expect(impossible, 'no solve declined for IMPOSSIBILITY, which is the arm § 31 added')
      .toBeGreaterThan(0);
  }, 600_000);

  it('reports impossibility in preference to no-gain when an answer is both', () => {
    // Asserted on `declineFor` rather than through a solve, because it CANNOT be seen
    // through one: both arms revert identically, so every declined solve ends with
    // `after === before` whichever reason fired. A test over real solves that filters
    // on `declined === 'impossible'` and then asserts `after ≈ before` is restating
    // its own filter.
    //
    // More impossible AND dearer — both arms qualify, and the answer must be the one
    // that says something.
    expect(declineFor(0, 5, 1, 9999, false)).toBe('impossible');
    // Each arm on its own, so the test above is not the only thing holding either.
    expect(declineFor(0, 5, 9999, 1, false), 'impossible but cheaper').toBe('impossible');
    expect(declineFor(0, 0, 1, 9999, false), 'legal but dearer').toBe('no-gain');
    expect(declineFor(0, 0, 9999, 1, false), 'legal and cheaper is not a refusal').toBeNull();
    // Equal cost is not an improvement. The real accept reads `>=`.
    expect(declineFor(0, 0, 42, 42, false), 'no cheaper is no gain').toBe('no-gain');
    // Shuffle exempts the taste arm and only the taste arm.
    expect(declineFor(0, 0, 1, 9999, true), 'a shuffle may be dearer').toBeNull();
    expect(declineFor(0, 5, 9999, 1, true), 'a shuffle may not be illegal').toBe('impossible');
    // The slack, in the same weighted units `anyWorse` uses.
    expect(declineFor(1, 1 + 1e-9, 9999, 1, false), 'float noise is not impossibility').toBeNull();
    // …and a repair of an already-illegal room is not refused for the illegality it
    // was handed. This is the relative ceiling, at the accept rather than in openRoutes.
    expect(declineFor(500, 500, 9999, 1, false), 'no worse than it was given').toBeNull();
  });

  it('and the impossibility arm is reached by real solves, not only by unit inputs', () => {
    // The other half: `declineFor` above proves the ordering, this proves the arm is
    // live. Over the same 80 suggest solves, 4 take it — all on the seeded U at 6 x 4,
    // seeds 1, 2, 5 and 7. If this stops firing, sweep for the case again rather than
    // deleting the test.
    const parts = defaultScene('u', 6, 4);
    const poly = footprintForLayout('u', 6, 4);
    const seen = SEEDS.map(
      (seed) => solveLayout(parts, poly, lockedForSolve(parts, {}, null), { seed }).declined,
    );
    expect(seen.filter((d) => d === 'impossible').length).toBeGreaterThan(0);
  }, 600_000);
});

describe('openRoutes measures legality against what it was HANDED, not against zero', () => {
  // The repair pass may not CREATE impossibility — that is the gate on `best` above.
  // What it must still be able to do is repair a room that is already illegal for a
  // reason it cannot fix, and those are the same line of code read in two directions.
  //
  // The case is ordinary rather than exotic: a piece the user has LOCKED, standing
  // through a wall. Nothing the repair may move can bring the room's impossibility to
  // zero, so a ceiling of zero would refuse every candidate it ever visits — `best`
  // stays as the layout it was handed and the pass silently does nothing.
  //
  // Measured on the fixture below, which is the whole reason it exists: with the
  // relative ceiling the stranded floor goes from 7.5 m2 to none; with an absolute
  // one the pass returns its input untouched and 7.5 m2 of the room stays cut off
  // from the door. In both cases the locked sofa stays exactly where it is.
  const POLY: Footprint = [
    [-2, -3],
    [2, -3],
    [2, 3],
    [-2, 3],
  ];

  /** A 4 x 6 room with the only door in the south wall, a wardrobe sealing it across
   *  the middle, and a LOCKED sofa 375 mm through the north wall.
   *
   *  `pos[1]` is 0 on both movable pieces and that is load-bearing: `isObstacle`
   *  requires `pos[1] < 0.05`, and a floor-standing piece's `pos[1]` is its BASE
   *  rather than its centre. Written at the centre instead, every hard term reads
   *  zero and this whole fixture passes while measuring nothing. */
  const room = () => {
    const parts: ScenePart[] = [
      {
        id: 'door', name: 'door', category: 'door', shape: 'door',
        dimMM: [900, 50, 2100], pos: [0, 1.05, -3], rot: 0, locked: false, wallMounted: true,
      } as ScenePart,
      {
        id: 'seal', name: 'wardrobe', category: 'wardrobe', shape: 'wardrobe',
        dimMM: [4000, 600, 2000], pos: [0, 0, 0], rot: 0, locked: false,
      } as ScenePart,
      {
        id: 'stuck', name: 'sofa', category: 'sofa', shape: 'sofa',
        dimMM: [2200, 950, 880], pos: [0, 0, 2.9], rot: 0, locked: true,
      } as ScenePart,
    ];
    // The sofa is not movable, so no repair can take it out of the wall.
    const ctx: LayoutContext = { parts, movable: [false, true, false], footprint: POLY };
    const at: Placement[] = parts.map((q) => ({ x: q.pos[0], z: q.pos[2], yaw: q.rot }));
    return { parts, model: prepare(ctx), at };
  };

  it('opens the route it can open, and leaves the illegal piece alone', () => {
    const { model, at } = room();
    const before = costBreakdown(model, at, DEFAULT_WEIGHTS, NAV_CELL);

    // The premises, asserted rather than assumed — all three have silently stopped
    // holding once already while this fixture was being written.
    expect(model.doors.length, 'the room has a door to be cut off FROM').toBe(1);
    expect(model.obstacle, 'the wardrobe and the sofa must both be obstacles')
      .toEqual([false, true, true]);
    expect(navigabilityCost(model, at, NAV_CELL), 'floor is cut off from the door')
      .toBeGreaterThan(0);
    expect(impossibility(before), 'and the room is ALREADY illegal').toBeGreaterThan(0);

    const after = costBreakdown(
      model,
      openRoutes(model, at, DEFAULT_WEIGHTS, footprintBounds(POLY), makeRng(3)),
      DEFAULT_WEIGHTS,
      NAV_CELL,
    );
    expect(after.navigation, 'the route was opened').toBeLessThan(before.navigation);
    // …and it did not buy that by making the room any more impossible than it found
    // it. Equal, not merely no-greater: the locked sofa is exactly where it was.
    expect(impossibility(after)).toBeCloseTo(impossibility(before), 9);
  }, 300_000);
});

describe('Candidate.breakdown', () => {
  it('is the same number `total` is a summary of', () => {
    // Two fields that ought to agree, pinned because "by construction" is how such a
    // pair stops agreeing. `total` is `cost + navCost`, and the breakdown prices the
    // same layout at the same weights with the same grid.
    const parts = defaultScene('u', 6, 4);
    const poly = footprintForLayout('u', 6, 4);
    // The solver's own model, rebuilt here so the re-derivation below is genuinely
    // independent of anything the candidate carries.
    const model = prepare({ parts, movable: parts.map(() => true), footprint: poly });
    let seen: readonly Candidate[] = [];
    solveLayout(parts, poly, lockedForSolve(parts, {}, null), {
      seed: 3,
      pick: (c) => ((seen = c), 0),
    });
    expect(seen.length).toBeGreaterThan(0);
    for (const c of seen) {
      expect(c.breakdown.total).toBeCloseTo(c.total, 6);
      // Against a FRESH `navigabilityCost`, not against `breakdown.navigation`.
      // `navCost` is assigned from that field, so comparing the two was `x ≈ x` and
      // would have stayed green through `costBreakdown` pricing navigation unweighted
      // or on the wrong grid — both fields move together.
      expect(c.navCost).toBeCloseTo(
        DEFAULT_WEIGHTS.navigation * navigabilityCost(model, c.placements, NAV_CELL),
        9,
      );
    }
  });

  it('is priced at the solve WEIGHTS rather than as a raw share', () => {
    // The old version of this asserted `outside <= weights.outside * parts.length` on
    // `rect` seed 2, which produces one finalist whose `outside` is 0 — a bound of
    // 12000 over a zero. Worse, an upper bound is the wrong direction entirely: an
    // UNWEIGHTED reading (at most `parts.length`) also satisfies it, so the assertion
    // could not detect the thing its comment named.
    //
    // A bound in either direction is the wrong instrument, because the weighted and
    // unweighted readings of a small overhang are both small numbers — the finalists
    // here carry `outside` 2.0796, which is 0.00208 of a share times 1000. What
    // separates them is the RATIO, so the same layout is priced twice at two weight
    // settings and the answer has to move by exactly the weight.
    //
    // The seeded U at 6 x 4 seed 3 keeps four finalists, three carrying a non-zero
    // `outside`.
    const parts = defaultScene('u', 6, 4);
    const poly = footprintForLayout('u', 6, 4);
    const model = prepare({ parts, movable: parts.map(() => true), footprint: poly });
    let seen: readonly Candidate[] = [];
    solveLayout(parts, poly, lockedForSolve(parts, {}, null), {
      seed: 3,
      pick: (c) => ((seen = c), 0),
    });
    expect(seen.length, 'this fixture must keep more than one finalist').toBeGreaterThan(1);
    const dirty = seen.filter((c) => c.breakdown.outside > 0);
    expect(dirty.length, 'and at least one of them must be outside the room').toBeGreaterThan(0);
    for (const c of dirty) {
      const raw = costBreakdown(
        model,
        c.placements,
        { ...DEFAULT_WEIGHTS, outside: 1 },
        NAV_CELL,
      ).outside;
      expect(raw, 'the unweighted reading must not itself be zero').toBeGreaterThan(0);
      expect(c.breakdown.outside / raw, 'the candidate carries the WEIGHTED term')
        .toBeCloseTo(DEFAULT_WEIGHTS.outside, 6);
    }
  }, 300_000);
});

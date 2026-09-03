import { describe, it, expect } from 'vitest';
import {
  lockedForSolve,
  makeRng,
  movableFor,
  randomizeStart,
  solveLayout,
} from '@/lib/layout-solve';
import { isCleanShuffle, newRoomFindings, shuffleRoom } from '@/lib/layout-shuffle';
import { defaultScene } from '@/lib/scene-spec';
import { footprintForLayout, pointInFootprint, type LayoutId } from '@/lib/footprint';

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

// ── The three tests below carry an explicit timeout ─────────────────────
//
// Measured on an idle machine at 3429 ms, 2129 ms and 3548 ms — 1.4–2.3× inside
// vitest's default 5000 ms, which is not headroom, it is a coin toss. Under a
// full-suite run they went red and in isolation they went green, which is the
// most expensive shape of failure there is: it reads as a regression in whatever
// was changed that day, and the debugging happens somewhere else entirely.
//
// Each one runs `shuffleRoom`, which is a loop of whole solves — the work is real
// and the number is not going to come down. 30 s is ~8.5× the worst of the three,
// so it survives contention while still failing on a genuine order-of-magnitude
// regression. It is NOT the 60 s / 300 s of the two sweeps below, deliberately:
// those iterate presets × attempts and this one does not, and a timeout that
// cannot distinguish the two sizes of test tells nobody anything.
const SOLVE_TIMEOUT = { timeout: 30_000 };

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
  it('moves a room that mode "arrange" leaves completely untouched', SOLVE_TIMEOUT, () => {
    for (const [id, w, d] of SETTLED) {
      const { parts, footprint, locked, movable } = room(id, w, d);
      // The premise, asserted rather than assumed: this room is already settled, so
      // the repair path has nothing to offer in it.
      const arranged = solveLayout(parts, footprint, locked, { seed: 1, mode: 'arrange' });
      expect(arranged.moved, `${id} must be an already-good room`).toEqual([]);

      // Over a sweep of scatters rather than one, because since § 31 a shuffle solve
      // DECLINES rather than hand back an arrangement more impossible than the room
      // it was given, and roughly half of them would be.
      //
      // That is not a loss, and the numbers are why. On `rect` 6 x 4, ten seeds,
      // before the veto: **moved 10, clean 4**. The six that moved and were not clean
      // carried 520 to 1390 weighted units of `overlap + outside` — furniture well
      // inside the walls — and `isCleanShuffle` discarded every one. After the veto:
      // **moved 4, clean 4**, the same four. The search stopped producing answers
      // that were only ever going to be thrown away, and the button is unchanged:
      // over five presets x eight presses, `shuffleRoom` offers on 25 of 40 either
      // way.
      //
      // So the honest form of the property is the pipeline's own — twelve tries, as
      // `MAX_CANDIDATES` allows — rather than a single seed that must not be
      // unlucky. Seed 42 on `rect` is one of the decliners, which is how this was
      // found.
      const movers = SHUFFLE_SEEDS.filter((seed) => {
        const start = randomizeStart(parts, footprint, movable, makeRng(seed));
        return solveLayout(parts, footprint, locked, { seed, mode: 'shuffle', start }).moved.length > 0;
      });
      expect(
        movers.length,
        `${id} shuffled — no scatter in ${SHUFFLE_SEEDS.length} produced a move`,
      ).toBeGreaterThan(0);
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

  it('is deterministic: same room, same seed, same suggestion', () => {
    const { parts, footprint, locked, movable } = room('rect', 6, 4);
    const start = randomizeStart(parts, footprint, movable, makeRng(5));
    const a = solveLayout(parts, footprint, locked, { seed: 5, mode: 'shuffle', start });
    const b = solveLayout(parts, footprint, locked, { seed: 5, mode: 'shuffle', start });
    expect(a.placements).toEqual(b.placements);
  });
});

describe('shuffleRoom — the offer, not the search', () => {
  it('a single solve is NOT reliably clean, which is why the pipeline exists', { timeout: 60_000 }, () => {
    // The negative control for the test below, and the finding the filter answers.
    // Without it, "shuffleRoom returns a clean room" reads as a property of
    // `solveLayout` that the filter is not needed for. Measured at 6/20 on this
    // preset; asserted loosely because the exact count moves with any re-price of
    // the cost function, while the fact that raw solves fault does not.
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
    for (const [id, w, d] of ALL) {
      const { parts, room: rm, locked } = room(id, w, d);
      for (const attempt of [1, 2, 3]) {
        const outcome = shuffleRoom(parts, rm, locked, { attempt });
        if (!outcome) continue; // refusing is allowed; offering something broken is not
        offers++;
        const found = newRoomFindings(parts, rm, outcome.result);
        expect(
          found.map((f) => `${f.rule}:${f.partIds.join(',')}`),
          `${id} attempt ${attempt} introduced a finding`,
        ).toEqual([]);
        expect(outcome.result.moved.length, `${id} attempt ${attempt}`).toBeGreaterThan(0);
      }
    }
    // The floor. Without it a build where `shuffleRoom` always returned null would
    // pass this sweep having asserted nothing at all — which is exactly how the
    // `before`-from-origin regression got as far as it did.
    expect(offers, 'the sweep must actually have offers to check').toBeGreaterThanOrEqual(
      ALL.length * 2,
    );
  });

  it('returns null rather than offering a faulted room when nothing can move', () => {
    const { parts, room: rm } = room('rect', 6, 4);
    // Everything pinned: there is no arrangement to find, and the honest answer is
    // "no" rather than the room it was handed.
    const allPinned = Object.fromEntries(parts.map((p) => [p.id, true]));
    const locked = lockedForSolve(parts, allPinned, null);
    expect(shuffleRoom(parts, rm, locked, { attempt: 1 })).toBeNull();
  });

  it('avoids repeating an arrangement it has just offered', SOLVE_TIMEOUT, () => {
    const { parts, room: rm, locked } = room('rect', 6, 4);
    const first = shuffleRoom(parts, rm, locked, { attempt: 1 });
    expect(first).not.toBeNull();
    // Asserted, not guarded: the whole body used to sit inside `if (clean > 1)`,
    // so a build that found a single candidate passed having checked nothing.
    // There must be something to choose between for the claim to mean anything.
    expect(first!.clean, 'needs more than one candidate to prefer between').toBeGreaterThan(1);
    const second = shuffleRoom(parts, rm, locked, { attempt: 1, history: [first!.offer] });
    expect(second).not.toBeNull();
    expect(second!.result.placements).not.toEqual(first!.result.placements);
  });

  it('is deterministic per (room, attempt), and a new attempt is a new question', SOLVE_TIMEOUT, () => {
    const { parts, room: rm, locked } = room('rect', 6, 4);
    const a = shuffleRoom(parts, rm, locked, { attempt: 1 });
    const b = shuffleRoom(parts, rm, locked, { attempt: 1 });
    expect(a!.result.placements).toEqual(b!.result.placements);
    const c = shuffleRoom(parts, rm, locked, { attempt: 2 });
    expect(c!.result.placements).not.toEqual(a!.result.placements);
  });
});

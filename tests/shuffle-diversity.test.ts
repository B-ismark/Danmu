import { describe, expect, it } from 'vitest';
import { lockedForSolve, movableFor, LAYOUT_SIMILAR_M, TURN_EPSILON } from '@/lib/layout-solve';
import { layoutSimilarity } from '@/lib/layout-offer';
import { DIVERSITY_PENALTY, shuffleRoom } from '@/lib/layout-shuffle';
import { defaultScene } from '@/lib/scene-spec';
import { footprintForLayout, type LayoutId } from '@/lib/footprint';

// § A.2 — variety in Shuffle. The measurement was done long ago (penalty 4, working
// range 2–8, in cost units rather than a normalised lambda) and **nothing pinned it**:
// `docs/what-is-still-open.md` has said for weeks that "a test that fails at
// `diversityPenalty: 0` is still owed". This is that test.
//
// ── Where the term can and cannot be observed, because it is not where you would look
//
// `orderOffers` picks greedily and prices each candidate `cost + penalty × (closest
// already picked)`. **The first pick has `picked = []`, so the diversity term cannot
// move `ranked[0]` at any penalty.** A test that pressed Shuffle once and looked at the
// answer would therefore be green at every value including zero — it would be measuring
// the solver, not the ranker.
//
// The term is live in exactly one place: the ORDER of the candidates behind the winner.
// `shuffleRoom` walks `ranked` and takes the first entry that is not too much like
// something in `history`, so the moment a press is a REPEAT press the diversity order
// decides what the user sees. That is what this file drives — press, remember, press
// again — and it is also the feature as the user meets it, since nobody presses Shuffle
// once.
//
// ── The fixture, and why it is a seeded preset rather than a scrambled room
//
// `tests/layout-offer-pool.test.ts` measures the pool this ranking gets to work with
// and prints both tables on every run. The claim it establishes is that there IS
// something to rank; this file asserts what the ranking then does with it. Every row
// below checks `clean > 1` before believing its own numbers, because a pool of one
// makes every penalty agree and would turn the whole file green for the wrong reason.

const CEILING = 2.5;

const room = (id: LayoutId, w: number, d: number) => {
  const parts = defaultScene(id, w, d);
  const footprint = footprintForLayout(id, w, d);
  const locked = lockedForSolve(parts, {}, null);
  return { parts, room: { footprint, height: CEILING }, locked, movable: movableFor(parts, locked) };
};

const ROOMS: Array<[LayoutId, number, number]> = [
  ['rect', 6, 4],
  ['rect', 7, 5],
  ['l', 6, 5],
  ['t', 6, 5],
  ['u', 6, 5],
];
const ATTEMPTS = [1, 2, 3];

type Row = {
  label: string;
  clean: number;
  simAtZero: number;
  simAtDefault: number;
  differs: boolean;
};

/** Press, remember what came back, press again — at one diversity penalty. Returns
 *  how much the SECOND offer resembles the first, which is the number the term moves. */
function repeatPress(id: LayoutId, w: number, d: number, attempt: number, penalty: number) {
  const { parts, room: rm, locked, movable } = room(id, w, d);
  const first = shuffleRoom(parts, rm, locked, { attempt });
  if (!first) return null;
  const second = shuffleRoom(parts, rm, locked, {
    attempt,
    history: [first.offer],
    diversityPenalty: penalty,
  });
  if (!second) return null;
  return {
    clean: first.clean,
    similarity: layoutSimilarity(second.result.placements, first.result.placements, {
      spotM: LAYOUT_SIMILAR_M,
      yawRad: TURN_EPSILON,
      movable,
    }),
    placements: second.result.placements,
  };
}

const rows: Row[] = [];
for (const [id, w, d] of ROOMS) {
  for (const attempt of ATTEMPTS) {
    const zero = repeatPress(id, w, d, attempt, 0);
    const dflt = repeatPress(id, w, d, attempt, DIVERSITY_PENALTY);
    if (!zero || !dflt) continue;
    rows.push({
      label: `${id} ${w}x${d} attempt ${attempt}`,
      clean: zero.clean,
      simAtZero: zero.similarity,
      simAtDefault: dflt.similarity,
      differs: JSON.stringify(zero.placements) !== JSON.stringify(dflt.placements),
    });
  }
}

// Printed on a PASSING run — that is what `--disableConsoleIntercept` is for. A term
// whose effect is only ever asserted as an inequality drifts silently; the table is how
// a change in its size shows up without reading a diff.
console.log('\n  the second press, at diversityPenalty 0 vs %d', DIVERSITY_PENALTY);
console.log('  %s', 'room                     clean   sim@0   sim@d   different offer');
for (const r of rows) {
  console.log(
    '  %s %s   %s   %s   %s',
    r.label.padEnd(22),
    String(r.clean).padStart(3),
    r.simAtZero.toFixed(2).padStart(5),
    r.simAtDefault.toFixed(2).padStart(5),
    r.differs ? 'yes' : 'no',
  );
}

describe('§ A.2 · the diversity penalty is load-bearing on a repeat press', () => {
  it('has a pool worth ranking, in every row it is about to draw a conclusion from', () => {
    // The floor, and it is asserted rather than filtered. `repeatPress` returns null
    // when a room offers nothing, and a `continue` on that would let this file shrink
    // to zero rows and pass having measured nothing — the failure `layout-shuffle`'s
    // own sweep records having survived once already.
    expect(rows.length, 'no room produced two presses to compare').toBe(ROOMS.length * ATTEMPTS.length);
    for (const r of rows) {
      expect(r.clean, `${r.label} has nothing to choose between`).toBeGreaterThan(1);
    }
  });

  it('changes which arrangement the second press offers', () => {
    // The claim § A.2 owes. Not "the offers differ from each other" — that is the
    // history filter and it is pinned in `layout-shuffle.test.ts` — but "the offer
    // depends on the penalty", which is the only thing that can go red at zero.
    const changed = rows.filter((r) => r.differs);
    expect(
      changed.length,
      `penalty ${DIVERSITY_PENALTY} chose the same arrangement as penalty 0 in every one of ` +
        `${rows.length} rows, so nothing in this app reads the term`,
    ).toBeGreaterThan(0);
  });

  it('and moves the second press AWAY from the first, not merely elsewhere', () => {
    // The direction, which "different" alone cannot carry: a penalty that reordered
    // candidates arbitrarily would satisfy the test above. What MMR promises is that
    // the runner-up is less like the winner, so the mean similarity must FALL.
    //
    // Compared as means over the whole table rather than row by row, deliberately.
    // Greedy MMR trades cost against distance, so an individual row may keep its
    // cheapest candidate and be unchanged; the claim is about the aggregate, and a
    // per-row bar would be a stricter promise than the algorithm makes.
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const atZero = mean(rows.map((r) => r.simAtZero));
    const atDefault = mean(rows.map((r) => r.simAtDefault));
    expect(
      atDefault,
      `mean similarity to the first offer: ${atZero.toFixed(3)} at penalty 0, ` +
        `${atDefault.toFixed(3)} at ${DIVERSITY_PENALTY}`,
    ).toBeLessThan(atZero);
  });

  it('is a value someone chose, pinned at both ends', () => {
    // A constant asserted only from below is free at the top. The measured working
    // range is 2–8 in cost units; the bounds are that range and not this number, so
    // re-tuning inside it is allowed and leaving the range is a decision.
    expect(DIVERSITY_PENALTY).toBeGreaterThanOrEqual(2);
    expect(DIVERSITY_PENALTY).toBeLessThanOrEqual(8);
  });
});

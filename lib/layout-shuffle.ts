/**
 * Shuffle — "give me a different arrangement", as distinct from "fix what is wrong".
 *
 * `solveLayout` in `mode: 'arrange'` is anchored to the room it is handed: moving a
 * piece costs `inertia`, and `isWorthOffering` refuses an answer that is not a
 * material improvement. Both are right for a repair, and together they are why the
 * one button this app used to have could not answer "show me another way to lay this
 * out" — on a room with nothing wrong it correctly did nothing at all. Shuffle is the
 * other half: `mode: 'shuffle'` drops the inertia term and starts from
 * `randomizeStart` rather than from today's placement, so an already-good room is not
 * a fixed point.
 *
 * ── Why this is a pipeline and not one solve ──────────────────────────────────
 *
 * A single shuffle solve is NOT reliably a room you would want to be shown, and that
 * is measured rather than assumed. Twenty seeds per preset, counting solves that end
 * with every one of `HARD_TERMS` at zero:
 *
 *   rect 6x4  20/20 · rect 7.5x5.6  20/20 · l 6x5  13/20 · t 6x5  6/20
 *   u 6x5  16/20 · open 6x4  12/20
 *
 * The failures are mostly `navigation` — a piece parked so that part of the floor has
 * no route from the door — and on the L they reach 481.8. The rectangles are perfect
 * and every non-rectangular preset is not, which is the tell: a scatter start has to
 * rebuild a whole room inside a step budget (`DEFAULT_STEPS`) that was measured for a
 * search starting from a room that was already nearly right.
 *
 * **More steps is not the fix, and that is the useful half of the measurement.**
 * Clean seeds against budget, same twenty seeds:
 *
 *   steps      1600    4000    8000   16000
 *   rect      20/20   19/20   20/20   20/20
 *   l         13/20   16/20   17/20   18/20
 *   t          6/20    6/20    8/20    5/20
 *   u         16/20   19/20   17/20   18/20
 *   open      12/20   13/20   13/20   14/20
 *
 * Ten times the budget buys the L five seeds and the T nothing — it goes DOWN, which
 * is the annealer being chaotic under any change rather than a regression. Paying ten
 * times over for that would be the wrong trade even if the user had not asked for
 * this to stay quick enough to press repeatedly.
 *
 * What does work is asking more than once and **throwing the faulty answers away**.
 * Attempts yielding at least one clean candidate, 25 attempts per preset:
 *
 *   candidates   n=4     n=6     n=8    n=12
 *   t 6x5      21/25   24/25   24/25   25/25
 *   open 6x4   24/25   24/25   24/25   25/25
 *   others     25/25   25/25   25/25   25/25
 *
 * Hence `MAX_CANDIDATES`. The solves are independent, so this is the same search run
 * from more places rather than a longer one — which is exactly what a chaotic
 * objective responds to.
 */
import {
  HARD_TERMS,
  lockedForSolve,
  makeRng,
  movableFor,
  randomizeStart,
  solveLayout,
  LAYOUT_SIMILAR_M,
  TURN_EPSILON,
  type SolveResult,
} from './layout-solve';
import { layoutSimilarity, orderOffers } from './layout-offer';
import type { Placement } from './layout-score';
import type { ScenePart } from './scene-spec';
import type { Footprint } from './footprint';

/** How many independent solves one press may run. The measured n=12 above, where
 *  every preset reached 25/25. It is a CEILING and not a count — see `MIN_CLEAN`. */
export const MAX_CANDIDATES = 12;
/** …and how many clean ones are enough to stop early. The ranking below needs
 *  something to choose between, so stopping at the first clean answer would make the
 *  diversity term inert; four is the same pool size `solveLayout`'s own `FINALISTS`
 *  keeps, and on the easy presets it is reached in the first four solves. */
export const MIN_CLEAN = 4;
/** In cost units: the extra cost a completely-duplicate arrangement is worth paying
 *  to avoid. Not chosen here — it is the median measured across five presets and
 *  fifteen rearranged rooms in § A.2 of `docs/what-is-still-open.md`, whose working
 *  range is 2–8. Below 0.25 the term never fires at all; above ~8 cost stops
 *  mattering. */
export const DIVERSITY_PENALTY = 4;
/** Above this, two arrangements are the same idea shown twice.
 *
 *  Deliberately NOT `LAYOUT_SIMILAR_M`, which is a distance in metres between two
 *  pieces; this is a share of the room in `[0, 1]`, a different quantity answering a
 *  different question. It is the bar for "have I already shown you this", where the
 *  solver's constant is the bar for "did the pool already hold this". */
export const REPEAT_SIMILARITY = 0.85;
/** How many recent offers to avoid repeating. Small on purpose: a long memory
 *  eventually rules out every arrangement a small room actually has, and the fallback
 *  when everything is ruled out is to show a repeat anyway. */
export const HISTORY_DEPTH = 3;

export type ShuffleOptions = {
  /** Which press this is. Drives the seeds, so the same room and the same attempt
   *  give the same set of ideas — pressing again asks a genuinely different
   *  question rather than re-rolling the same one. */
  attempt: number;
  /** Arrangements already offered this session, newest last. Anything too much like
   *  one of these is passed over while a different candidate is available. */
  history?: readonly Placement[][];
  maxCandidates?: number;
  minClean?: number;
  diversityPenalty?: number;
};

export type ShuffleOutcome = {
  result: SolveResult;
  /** How many solves were run and how many survived the fault filter. Reported
   *  rather than discarded because "we tried twelve and none was usable" and "the
   *  first four were all fine" are different facts about a room, and only one of
   *  them is worth telling the user about. */
  tried: number;
  clean: number;
};

/** Is this an arrangement worth putting in front of someone?
 *
 *  `HARD_TERMS` is the solver's own list — overlap, outside, door, access,
 *  navigation — read term by term rather than as a total, because a total lets a
 *  tidy room average away a piece standing inside another one. A candidate that
 *  moved nothing is refused too: it is the original room, which is not an answer to
 *  "show me another way".
 *
 *  Exported because it is the whole of what "usable" means here, and a caller
 *  re-deriving it is how the offer stage and the test drift apart. */
export function isCleanShuffle(result: SolveResult): boolean {
  if (result.moved.length === 0) return false;
  return HARD_TERMS.every((term) => result.breakdownAfter[term] === 0);
}

/**
 * Run the shuffle pipeline and return the arrangement to offer, or `null`.
 *
 * `null` means *no usable arrangement was found* — every candidate either changed
 * nothing or came back with a hard fault. The caller must say so and leave the room
 * alone; applying a faulted arrangement because the user pressed a button would be
 * the app knowingly handing them a room with a piece blocking the door. Measured, it
 * is rare: 25/25 attempts found one on every preset at `MAX_CANDIDATES`.
 *
 * Deterministic per `(room, attempt)`, like everything else in the solver — a
 * suggestion that differs between two runs of the same room is a slot machine.
 */
export function shuffleRoom(
  parts: ScenePart[],
  footprint: Footprint,
  locked: boolean[],
  opts: ShuffleOptions,
): ShuffleOutcome | null {
  const maxCandidates = opts.maxCandidates ?? MAX_CANDIDATES;
  const minClean = opts.minClean ?? MIN_CLEAN;
  const movable = movableFor(parts, locked);
  // An early-out, NOT the thing that makes a fully-locked room return null — the
  // fault filter below already does that, since every solve in such a room comes
  // back having moved nothing and `isCleanShuffle` refuses it. Deleting this line
  // passes every test in `tests/layout-shuffle.test.ts`, which is exactly why it is
  // labelled rather than left to look load-bearing. What it buys is the twelve
  // solves — each of which prepares a model and pays a distance transform — that a
  // room with nothing movable would otherwise run to reach a foregone answer.
  if (!movable.some(Boolean)) return null;

  const clean: SolveResult[] = [];
  let tried = 0;
  for (let s = 0; s < maxCandidates && clean.length < minClean; s++) {
    tried++;
    // One seed drives both the scatter and the search that follows it, so an
    // attempt is reproducible end to end.
    const seed = opts.attempt * 1000 + s;
    const start = randomizeStart(parts, footprint, movable, makeRng(seed));
    const result = solveLayout(parts, footprint, locked, { seed, mode: 'shuffle', start });
    if (isCleanShuffle(result)) clean.push(result);
  }
  if (clean.length === 0) return null;

  // Rank for variety as well as cost. `orderOffers` prices "not like the ones
  // already picked" in COST UNITS — see `lib/layout-offer.ts` for why a normalised
  // lambda is wrong for this input.
  const ranked = orderOffers(clean, {
    cost: (r) => r.after,
    similarity: (a, b) =>
      layoutSimilarity(a.placements, b.placements, {
        spotM: LAYOUT_SIMILAR_M,
        yawRad: TURN_EPSILON,
        movable,
      }),
    diversityPenalty: opts.diversityPenalty ?? DIVERSITY_PENALTY,
  });

  // …then walk that order and pass over anything the user has just been shown.
  // Falls back to the top-ranked candidate rather than refusing: a repeat is still a
  // valid room and still different from the one on screen, and "no" to someone who
  // pressed the button is the worse answer.
  const history = opts.history ?? [];
  const fresh = ranked.find(
    (cand) =>
      !history.some(
        (prev) =>
          layoutSimilarity(cand.placements, prev, {
            spotM: LAYOUT_SIMILAR_M,
            yawRad: TURN_EPSILON,
            movable,
          }) > REPEAT_SIMILARITY,
      ),
  );
  return { result: fresh ?? ranked[0], tried, clean: clean.length };
}

/** The three reasons a piece may not move, for a whole-room shuffle. A thin re-export
 *  of the solver's own composer so a caller does not have to know that a shuffle
 *  confines nothing. */
export function lockedForShuffle(parts: ScenePart[], pinned: Record<string, boolean>): boolean[] {
  return lockedForSolve(parts, pinned, null);
}

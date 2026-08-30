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
 * Attempts yielding at least one candidate the SOLVER calls clean, 25 per preset:
 *
 *   candidates   n=4     n=6     n=8    n=12
 *   t 6x5      21/25   24/25   24/25   25/25
 *   open 6x4   24/25   24/25   24/25   25/25
 *   others     25/25   25/25   25/25   25/25
 *
 * Hence `MAX_CANDIDATES`. The solves are independent, so this is the same search run
 * from more places rather than a longer one — which is exactly what a chaotic
 * objective responds to.
 *
 * ── …and the solver's verdict is not the last word ────────────────────────────
 *
 * `newRoomFindings` is a second gate, because the cost function and the room report
 * disagree about a chair buried in a table (its own doc has the detail). With both
 * gates, over six presets × twelve attempts: **0 of 72 offers introduce a finding**,
 * against 8 of 40 before the gate existed. That is the number that matters and it is
 * the one the feature is for.
 *
 * **The cost is refusals, and it is not evenly spread.** Offers per twelve attempts
 * at `MAX_CANDIDATES = 12`, measured on `main` after the threshold fix below:
 * rect 6×4 12/12, l 12/12, u 12/12, open 10/12, rect 7.5×5.6 9/12, **t 8/12**.
 *
 * Raising the cap buys the rest at a price not worth paying — the whole search is
 * synchronous on the main thread. Measured BEFORE the threshold fix, when refusals
 * were commoner, so read it for the shape of the trade rather than for its rows:
 *
 *   cap        t 6x5 offers / worst ms     open 6x4 offers / worst ms
 *   12              5/12  ·  2.9 s               8/12  ·  2.1 s
 *   20              7/12  ·  4.7 s              10/12  ·  3.1 s
 *   30             10/12  ·  6.6 s              12/12  ·  5.2 s
 *
 * So 12 stays: a refusal is honest and survivable, a six-second freeze is not.
 *
 * **The upstream repair LANDED, and it is why those first numbers moved** (#68, on
 * `main`). `lib/layout-score.ts` no longer exempts a `sharesFloor` pair from
 * `overlap` outright — it charges the excess above `TUCKED_CLASH_SHARE`, normalised
 * — so the search largely stops *generating* the arrangements this gate discards
 * rather than making them and having them thrown away. Same six presets × twelve
 * attempts: **58/72 offers before it, 63/72 after**, `t` 5/12 → 8/12 and `open`
 * 8/12 → 10/12, with the finding count still 0. The gate stays: it is what makes
 * that zero a guarantee rather than a measurement, and the two modules can still differ on
 * things beyond this one bar.
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
import { analyzeRoom, type ClearanceIssue } from './clearance';
import type { Placement } from './layout-score';
import type { ScenePart } from './scene-spec';
import type { Footprint } from './footprint';

/** The room a shuffle happens in, in the shape `analyzeRoom` already asks for, so
 *  the two cannot be handed different rooms. */
export type ShuffleRoom = { footprint: Footprint; height: number };

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

/**
 * One arrangement this room has already been offered.
 *
 * **It carries the part ids, and that is not bookkeeping.** A `Placement[]` is
 * index-aligned to one particular `parts` array and says so nowhere, while the
 * history that holds it outlives any number of edits to the room: the studio's
 * Shuffle button keeps it in a `useRef` on a component that adding or deleting
 * furniture does not remount. So the two drift, in two different ways and only one
 * of them is loud.
 *
 * · **Different length** — `layoutSimilarity` throws (`lib/layout-offer.ts`,
 *   deliberately, rather than returning a plausible number). Shuffle, delete a
 *   chair, Shuffle again: `layoutSimilarity: 11 placements against 12`, out of a
 *   click handler, no toast and no arrangement.
 * · **Same length, different order** — nothing throws, and the repeat filter
 *   compares each piece against a *different* piece's old placement. The answer is
 *   meaningless and looks exactly like a working filter.
 *
 * `sameRoom` below is what stops both, and it is checked rather than assumed
 * because the silent half cannot be noticed any other way.
 */
export type ShuffleOffer = {
  /** `parts.map(p => p.id)` as it stood when this arrangement was offered. */
  ids: readonly string[];
  placements: Placement[];
};

/** Do these two id lists describe the same furniture in the same order — i.e. is a
 *  `Placement[]` recorded against one of them index-aligned to the other? */
function sameRoom(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

export type ShuffleOptions = {
  /** Which press this is. Drives the seeds, so the same room and the same attempt
   *  give the same set of ideas — pressing again asks a genuinely different
   *  question rather than re-rolling the same one. */
  attempt: number;
  /** Arrangements already offered this session, newest last. Anything too much like
   *  one of these is passed over while a different candidate is available. Entries
   *  recorded against a different set of furniture are ignored rather than compared
   *  — see `ShuffleOffer`. */
  history?: readonly ShuffleOffer[];
  maxCandidates?: number;
  minClean?: number;
  diversityPenalty?: number;
};

export type ShuffleOutcome = {
  result: SolveResult;
  /** What to put in the history, already carrying the ids it is aligned to, so the
   *  caller cannot record a bare `Placement[]` and reintroduce the drift above. */
  offer: ShuffleOffer;
  /** How many solves were run and how many survived the fault filter. Reported
   *  rather than discarded because "we tried twelve and none was usable" and "the
   *  first four were all fine" are different facts about a room, and only one of
   *  them is worth telling the user about. */
  tried: number;
  clean: number;
};

/** Is this an arrangement the SOLVER thinks is sound?
 *
 *  `HARD_TERMS` is the solver's own list — overlap, outside, door, access,
 *  navigation — read term by term rather than as a total, because a total lets a
 *  tidy room average away a piece standing inside another one. A candidate that
 *  moved nothing is refused too: it is the original room, which is not an answer to
 *  "show me another way".
 *
 *  **This is necessary and not sufficient**, which is the whole reason
 *  `newRoomFindings` exists beside it. Asserting only this in a test is asserting
 *  the filter against its own definition — see the note on `roomChecks` below. */
export function isCleanShuffle(result: SolveResult): boolean {
  if (result.moved.length === 0) return false;
  return HARD_TERMS.every((term) => result.breakdownAfter[term] === 0);
}

/** Apply a solved arrangement to the parts, so the room can be asked about it.
 *  Heights are carried through untouched — the solver moves and turns only. */
export function applyPlacements(parts: ScenePart[], result: SolveResult): ScenePart[] {
  const moved = new Set(result.moved);
  return parts.map((p, i) =>
    moved.has(i)
      ? {
          ...p,
          pos: [result.placements[i].x, p.pos[1], result.placements[i].z] as [number, number, number],
          rot: result.placements[i].yaw,
        }
      : p,
  );
}

/**
 * The findings this arrangement would ADD to the room, as Room check reports them.
 *
 * ── Why the solver's own verdict is not enough ────────────────────────────────
 *
 * `isCleanShuffle` asks the cost function; this asks `analyzeRoom`, and the two do
 * not agree about a chair pushed under a table. `lib/layout-score.ts` exempts a
 * `sharesFloor` pair from `overlap` **entirely** — a blanket `continue` — while
 * `lib/clearance.ts` gives the same pair a *tolerance* of `TUCKED_CLASH_SHARE`
 * (0.85). So the solver pays nothing for burying a dining chair completely inside
 * the dining table, and the report calls it a clash. `clearance.ts` states that the
 * two "cannot disagree about whether a tucked-in chair is a collision"; they share
 * the predicate and not the threshold, so that sentence is not true today.
 *
 * Measured before this gate existed: **8 of 40 offers** (five presets × eight
 * attempts) introduced a clash the room report flags and the solver could not see —
 * all of them on `t` and `open`. Anchored modes mostly hide it because inertia keeps
 * the room roughly where it was; shuffle removes the anchor, so it surfaces.
 *
 * Aligning the two thresholds is the real repair and it is deliberately NOT done
 * here: `overlap` is priced into every solve this app runs, the repo's own notes
 * record that any re-price reshuffles which seeds end badly, and it would change
 * `Fix` — behaviour nobody asked to change — on the way past. So this gate is scoped
 * to the new feature: a shuffle may not INTRODUCE a finding, while a finding the
 * room already had is not this button's to answer for.
 *
 * Compared by rule and by the pieces named, not by count: a room that swaps one
 * clash for a different one has not stayed still.
 */
export function newRoomFindings(
  parts: ScenePart[],
  room: ShuffleRoom,
  result: SolveResult,
): ClearanceIssue[] {
  const key = (f: ClearanceIssue) => `${f.rule}:${[...f.partIds].sort().join(',')}`;
  const serious = (f: ClearanceIssue) => f.severity === 'error' || f.rule === 'clash';
  const had = new Set(analyzeRoom(parts, room).issues.filter(serious).map(key));
  return analyzeRoom(applyPlacements(parts, result), room)
    .issues.filter(serious)
    .filter((f) => !had.has(key(f)));
}

/**
 * Run the shuffle pipeline and return the arrangement to offer, or `null`.
 *
 * `null` means *no usable arrangement was found* — every candidate either changed
 * nothing, came back with a hard fault, or would have introduced a finding the room
 * report shows. The caller must say so and leave the room alone; applying a faulted
 * arrangement because the user pressed a button would be the app knowingly handing
 * them a room with a piece blocking the door.
 *
 * **It is not rare on a complex footprint** — 4 of 12 attempts on the `t` preset, 2
 * of 12 on `open`, none at all on `rect`, `l` or `u`. The header has the table and
 * the reason. So the caller's message for `null` is a real piece of UI rather than
 * an edge case, and it must not read as an error: nothing went wrong, the search
 * looked and did not find one it was willing to show.
 *
 * Deterministic per `(room, attempt)`, like everything else in the solver — a
 * suggestion that differs between two runs of the same room is a slot machine.
 */
export function shuffleRoom(
  parts: ScenePart[],
  room: ShuffleRoom,
  locked: boolean[],
  opts: ShuffleOptions,
): ShuffleOutcome | null {
  const maxCandidates = opts.maxCandidates ?? MAX_CANDIDATES;
  const minClean = opts.minClean ?? MIN_CLEAN;
  const { footprint } = room;
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
    // Both gates, and in this order: the solver's verdict is far cheaper than a
    // clearance field, so the room report is only asked about candidates that have
    // already passed the cheap check.
    if (!isCleanShuffle(result)) continue;
    if (newRoomFindings(parts, room, result).length > 0) continue;
    clean.push(result);
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
  //
  // Only history recorded against THIS furniture is comparable. An entry from before
  // a piece was added or deleted is not stale-but-usable, it is index-aligned to a
  // different room: comparing it either throws or silently measures one piece
  // against another's old position. Dropping it means a room that has just been
  // edited briefly forgets what it was shown, which is the harmless direction.
  const ids = parts.map((p) => p.id);
  const history = (opts.history ?? []).filter((prev) => sameRoom(prev.ids, ids));
  const fresh = ranked.find(
    (cand) =>
      !history.some(
        (prev) =>
          layoutSimilarity(cand.placements, prev.placements, {
            spotM: LAYOUT_SIMILAR_M,
            yawRad: TURN_EPSILON,
            movable,
          }) > REPEAT_SIMILARITY,
      ),
  );
  const result = fresh ?? ranked[0];
  return { result, offer: { ids, placements: result.placements }, tried, clean: clean.length };
}

/** The three reasons a piece may not move, for a whole-room shuffle. A thin re-export
 *  of the solver's own composer so a caller does not have to know that a shuffle
 *  confines nothing. */
export function lockedForShuffle(parts: ScenePart[], pinned: Record<string, boolean>): boolean[] {
  return lockedForSolve(parts, pinned, null);
}

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
 * 8/12 → 10/12, with the finding count still 0.
 *
 * **That sentence used to end "the gate stays: it is what makes that zero a
 * guarantee rather than a measurement", and it was claiming more than anything
 * checked.** Deleting the gate left every test in `tests/layout-shuffle.test.ts`
 * green. Measured since: **816 candidates over thirteen room configurations — five
 * presets and four dining rooms built to provoke it — and it rejected none of them**,
 * because #68 is what closed the gap it was written for. Both modules read
 * `TUCKED_CLASH_SHARE` now, and `isCleanShuffle` demands `overlap === 0` exactly, so
 * nothing reaching this gate can hold a pair past that bar.
 *
 * The gate STAYS, and for the honest reason rather than the flattering one: these
 * two modules have already drifted apart once, and it costs two `analyzeRoom` calls
 * on candidates that have passed the cheap filter — a small price for the one
 * failure it exists to catch. What it is not is *covered*, and
 * `tests/shuffle-gate.test.ts` now pins the agreement it depends on instead: that
 * file goes red the moment either threshold moves, which is the moment this gate
 * starts having work to do again.
 */
import {
  HARD_TERMS,
  lockedForSolve,
  makeRng,
  movableFor,
  NEGLIGIBLE_COST,
  randomizeStart,
  solveLayout,
  LAYOUT_SIMILAR_M,
  TURN_EPSILON,
  type SolveResult,
} from './layout-solve';
import { layoutSimilarity, orderOffers } from './layout-offer';
import { RULE_HANDLING } from './layout-score';
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
 *  mattering.
 *
 *  **Measured 2026-09-06: on this app's data this term cannot change an outcome, and
 *  that is recorded here rather than acted on.**
 *
 *  `orderOffers` scores `cost + DIVERSITY_PENALTY x (closest already picked)`. Two
 *  facts make the second half zero almost always. The first pick has `picked = []`,
 *  so nothing can move `ranked[0]` — and `ranked[0]` is what a caller with no history
 *  is handed. And the candidates that reach the ranking are already unlike each other:
 *  instrumented inside this very loop, **40 shuffle calls produced 66 candidate pairs,
 *  of which 61 scored similarity exactly 0**; the five non-zero ones were 0.111, 0.125,
 *  0.200 and 0.400, and **none reached `REPEAT_SIMILARITY`**. So the penalty multiplies
 *  zero in 92% of pairs and contributes at most 1.6 cost units in the rest, against
 *  candidate costs measured between 10 and 75.
 *
 *  End to end: `shuffleRoom` run twice on the same attempt with the previous offer as
 *  history, once at `diversityPenalty: 0` and once at 4, returned **byte-identical
 *  placements in all 26 pairs** over four presets and two sizes.
 *
 *  **So the honest gate is on the AGREEMENT, not on the term** — the same shape as the
 *  note above about `newRoomFindings` rejecting none of 816 candidates.
 *  `tests/layout-shuffle.test.ts` asserts that the clean set stays mutually dissimilar,
 *  which is what makes this inert; the day the search starts producing near-duplicates
 *  that test goes red and this term has work to do. Writing a test that fails at
 *  `diversityPenalty: 0` was the outstanding ask (§ A.2). It cannot be written at this
 *  level against real rooms, and the reason is the measurement above rather than an
 *  absence of effort. The unit behaviour IS pinned, in `tests/layout-offer.test.ts`,
 *  where the fixture supplies the similar candidates this search does not.
 */
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
 *  the filter against its own definition — see the note on `roomChecks` below.
 *
 *  **It asks NEGLIGIBLE, not zero, and that is a fix rather than a loosening.** It
 *  read `=== 0` on five WEIGHTED cost terms, and `outside` is continuous — see
 *  `NEGLIGIBLE_COST`, which carries the measurement. Measured through this very
 *  loop: of 826 candidates it rejected over 90 attempts, **5 had no fault except an
 *  `outside` in the 1e-14 range**, and each of those was an arrangement clean by any
 *  tolerance a person would name. A candidate discarded for a picometre is one the
 *  user is not offered, and when it is the last one standing the whole Shuffle
 *  refuses. */
export function isCleanShuffle(result: SolveResult): boolean {
  if (result.moved.length === 0) return false;
  return HARD_TERMS.every((term) => (result.breakdownAfter[term] as number) <= NEGLIGIBLE_COST);
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
 * `isCleanShuffle` asks the cost function; this asks `analyzeRoom`, and the two ask
 * different questions about a chair pushed under a table. They share the predicate
 * — `sharesFloor` — and they do not share the bar. `lib/layout-score.ts` charges a
 * tucked pair for the share of the overlap **above** `TUCKED_CLASH_SHARE` (0.85),
 * normalised onto the same 0…1 scale as any other overlap; `lib/clearance.ts` draws
 * its own line at `CLASH_SHARE` (0.5) and reports anything past it. So a chair
 * buried 0.6 of the way into its table is silent to the solver and a clash in the
 * report, and the two only coincide at the extremes.
 *
 * **This paragraph used to say something stronger and it is no longer true.** Before
 * #68 landed, `layout-score.ts` exempted a `sharesFloor` pair from `overlap`
 * entirely — a blanket `continue` — so the solver paid *nothing* for burying a
 * dining chair completely inside a dining table, and this file said so. #68 replaced
 * the exemption with the tolerance above, and `clearance.ts` has since retired the
 * "cannot disagree" sentence quoted here. Both halves of the old wording are gone;
 * what survives is a narrower and still-real gap between 0.5 and 0.85, which is what
 * this gate is scoped to.
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
  // The `clash` half of this is REDUNDANT today and is kept deliberately. There is
  // exactly one place in `lib/clearance.ts` that emits `rule: 'clash'` and it emits
  // it at `severity: 'error'`, so the first test already selects every clash.
  // Deleting the disjunct is a mutation `tests/shuffle-gate.test.ts` does NOT kill,
  // and that is said here rather than covered up with an assertion that would only
  // be restating the redundancy. It stays because a clash is the finding this gate
  // was built for, and a later decision to report a mild clash as a warning would
  // otherwise silently take it out of scope.
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

/** The findings a room ALREADY has that no offer can be clean while they stand.
 *
 *  **This exists because the two gates in `shuffleRoom` disagree in kind, and only
 *  one of them says so.** `newRoomFindings` is relative — its docblock above says
 *  "the findings this arrangement would ADD" — because a preset that already has a
 *  finding is not this button's to answer for. `isCleanShuffle` is absolute:
 *  `breakdownBefore` appears nowhere in this file. So in a room whose geometry
 *  cannot reach zero on a hard term, EVERY candidate fails the second gate and
 *  `shuffleRoom` returns `null` on every press, forever, in exactly the room a user
 *  is most likely to press it in (§ 4c).
 *
 *  The user ruled on 2026-09-06: **keep the gate, name the cause.** So this does not
 *  change what Shuffle will offer — it gives the refusal something true to say.
 *
 *  Which findings count is DERIVED, never listed: a rule blocks a shuffle exactly
 *  when `RULE_HANDLING` says its cost term is one `isCleanShuffle` reads. A
 *  hand-kept list here would be a second source of truth for "what is a hard fault",
 *  and this repo has paid for that one twice. A rule with no cost term — `tall`,
 *  `crowding`, `turning` — cannot block a gate that reads cost terms, so it is
 *  correctly absent. */
export function shuffleBlockers(issues: readonly ClearanceIssue[]): ClearanceIssue[] {
  return issues.filter((i) => {
    const term = RULE_HANDLING[i.rule]?.costTerm;
    return term != null && (HARD_TERMS as readonly string[]).includes(term);
  });
}

/** What the panel SAYS when a shuffle finds nothing, given what the room already has.
 *
 *  Pure, exported and tested for the reason `impossibleClause` is: the sentence and
 *  the call site are two things, and #121 measured the gap — all four call sites of
 *  that clause could be reverted to a disjunction with the whole suite green,
 *  because nothing joined the string to the screen. A refusal computed and not said
 *  is a refusal that does not exist.
 *
 *  The blocked sentence names the first finding rather than all of them, and says
 *  the count separately. Both are DERIVED — a hand-typed number beside the thing it
 *  describes can disagree with it, and here it would be a number about a list one
 *  line away.
 *
 *  **The finding is QUOTED, not spliced, and that is a fix rather than a style.** The
 *  first version read `already has ${title.toLowerCase()}`, which assumes a finding
 *  title is a noun phrase. **Counted across both files that author one — 11 in
 *  `clearance.ts`, 13 zone titles in `layout-rules.ts` — only 9 of the 24 are.** The
 *  other 15 are clauses with their own subject and verb ("The way in is blocked",
 *  "You can't walk to everything", "Wardrobe doors can't open"), verb phrases
 *  ("Can't reach the front of it"), or neither ("Taller than the room"). Spliced, those
 *  produced *"this one already has you can't walk to everything"*. The nine that did
 *  survive share one accident — they begin "No room…", "Tight…" or "Two pieces…" — so
 *  the template was right about a minority and wrong about the rest.
 *
 *  Quoting takes the title as the report's own words, reads correctly for every shape,
 *  and keeps the casing lowercasing was destroying.
 *
 *  **The transferable half:** a splice is safe when its source is a CLOSED vocabulary
 *  of nouns and unsafe when its source is authored prose. The eight other
 *  `toLowerCase()` splices in this app all draw from the first kind — `DECOR_LABEL`,
 *  `categoryLabel`, `slotLabel`, `unitName`, the axis names — and `ClearanceIssue.title`
 *  is the only authored-prose source in the app, which is why it was the one that broke.
 *  Cross-checked: no other site splices a finding title into a sentence.
 *
 *  **Found by DERIVING the string from real rooms rather than reading the template**,
 *  with the template in front of me both times. A hand-typed example in the first pass
 *  used a title that happened to be one of the nine, so it read correctly AND every
 *  character count taken off it was wrong.
 *
 *  Length matters: the four refusal bodies in this panel run 93 to 169 characters and
 *  the wrap at the top of that range is unverified in any browser
 *  (`docs/visual-check.md`), so this stays away from the top. Derived across the five
 *  offered sizes and nine reachable ones: clean is 116 at every size, blocked runs
 *  116-155 before this fix and is re-derived in that doc after it. */
export function shuffleRefusal(blockers: readonly ClearanceIssue[]): { title: string; message: string } {
  if (blockers.length === 0)
    return {
      title: 'No new arrangement this time',
      message:
        'Every layout it tried left something in the way, so your room is unchanged. Press Shuffle again for a different try.',
    };
  const more = blockers.length - 1;
  return {
    title: 'Shuffle cannot arrange around this',
    message:
      `Room check reports “${blockers[0].title}”` +
      (more > 0 ? ` and ${more} more` : '') +
      ', and Shuffle only offers rooms with nothing in the way. Try Fix first.',
  };
}
/** The three reasons a piece may not move, for a whole-room shuffle. A thin re-export
 *  of the solver's own composer so a caller does not have to know that a shuffle
 *  confines nothing. */
export function lockedForShuffle(parts: ScenePart[], pinned: Record<string, boolean>): boolean[] {
  return lockedForSolve(parts, pinned, null);
}

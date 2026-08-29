/**
 * The offer stage — what gets SHOWN, as distinct from what gets searched.
 *
 * `lib/layout-solve.ts` answers "what is the best arrangement of this room". This
 * file answers the two questions that come after it and that no single arrangement
 * can answer about itself:
 *
 *   · **Which of several good arrangements should we show next**, given the ones
 *     already shown. That is variety, and variety is a property of the SET of
 *     suggestions — see `mmrOrder`.
 *   · **Is this worth showing at all**, which `isWorthOffering` currently answers
 *     with a single scalar gain.
 *
 * Both live here rather than in the solver because both are confined to the offer
 * stage: nothing in this file can change which arrangements the annealer finds, so
 * nothing in it can destabilise the search. That property is the whole reason
 * `docs/research/suggest-and-collision.md` scopes layer 3 separately from layer 2,
 * and it is worth keeping — a cost term added here would quietly give it up.
 *
 * Nothing here is stateful and nothing here reads the store. A caller that wants
 * "different from what I have already offered" passes that history in.
 */
import type { Placement } from './layout-score';

/** How far two headings may differ and still be **the same turn**.
 *
 *  Its own constant with its own reason, rather than a borrowed one. The solver only
 *  ever *proposes* quarter turns and half turns (`propose`) and only ever *snaps* to
 *  quarter turns (`snapYaws`), so 15° is comfortably under the smallest turn any
 *  suggestion can deliberately contain — no real turn can be mistaken for none — and
 *  comfortably over the drift left by a piece that was squared in one candidate and
 *  left a degree or two off in another. Offering those two as "variety" is exactly
 *  the complaint this file exists to answer.
 *
 *  Deliberately NOT `SNAP_TOL`. That number answers "how far off square is close
 *  enough to be worth squaring", which is a different question that happens to live
 *  in the same units; borrowing a constant for its magnitude rather than its meaning
 *  is how two things start moving together that were never related. */
export const SAME_YAW_RAD = (15 * Math.PI) / 180;

/** How much of one arrangement is the same arrangement as another, in `[0, 1]`.
 *
 *  A **share of pieces that stand in the same place, turned the same way** — 1 when
 *  every piece considered agrees, 0 when none do. Graded rather than the solver's
 *  boolean `similar()`, because MMR needs to rank "mostly the same" below "half the
 *  room is different" and a predicate cannot say that.
 *
 *  ── `spotM` has no default, on purpose ────────────────────────────────────────
 *
 *  It is the same question `similar()` asks when it decides whether a candidate is
 *  already in the finalist pool, and the two answers have to agree: a pair the pool
 *  considered identical must score 1.0 here, or the solver and the offer stage
 *  disagree about what a different arrangement IS and this file will present as
 *  variety something the pool already merged. Defaulting it would put a second copy
 *  of that threshold in a second file and let them drift in the direction nobody
 *  notices. So the caller supplies it, from the one place it is defined.
 *
 *  ── `movable` is not optional in spirit ───────────────────────────────────────
 *
 *  Pass it. A locked piece agrees with itself in every pair — it cannot do anything
 *  else — so counting locked pieces drags every similarity toward 1 in proportion to
 *  how much of the room is locked, and a room with three movable pieces among twenty
 *  fixtures reports every pair as ~87% alike. MMR over that is inert, and inert in a
 *  way that looks like a tuning problem rather than a bug. It is optional only
 *  because a caller with nothing locked has nothing to pass.
 *
 *  Throws on a length mismatch rather than comparing the common prefix: two
 *  candidates for one room always have one length, so a mismatch is a caller bug,
 *  and silently comparing five pieces against six would report a high similarity for
 *  two arrangements of different rooms. */
export function layoutSimilarity(
  a: readonly Placement[],
  b: readonly Placement[],
  opts: { spotM: number; yawRad?: number; movable?: readonly boolean[] },
): number {
  if (a.length !== b.length) {
    throw new Error(`layoutSimilarity: ${a.length} placements against ${b.length}`);
  }
  const yawRad = opts.yawRad ?? SAME_YAW_RAD;
  let considered = 0;
  let agreed = 0;
  for (let i = 0; i < a.length; i++) {
    if (opts.movable && !opts.movable[i]) continue;
    considered++;
    if (Math.hypot(a[i].x - b[i].x, a[i].z - b[i].z) > opts.spotM) continue;
    if (Math.abs(yawDelta(a[i].yaw, b[i].yaw)) > yawRad) continue;
    agreed++;
  }
  // No movable piece is not "completely different"; it is a room with nothing to
  // distinguish, and 1 is the reading that stops MMR preferring a coin flip. The
  // solver returns before it ever gets here in that case (`allIdx.length === 0`).
  return considered === 0 ? 1 : agreed / considered;
}

/** Signed smallest angle between two headings, in `(-π, π]`.
 *
 *  Local rather than imported from `layout-score`'s `angleDelta` for one reason
 *  only: this file is meant to have no dependency on the scorer's internals, so
 *  the offer stage can be reasoned about — and tested — without a `LayoutModel`.
 *  It is four lines of modular arithmetic with no room for the two to disagree.
 *
 *  **All three lines are load-bearing and each needs its own test**, which is not
 *  obvious and was not true when this was first written. The two corrections are
 *  mirror images and one seam test only ever exercises one of them — a sign error in
 *  the other is invisible until someone turns a piece the other way. And the modulo
 *  is not redundant with them: the corrections run once rather than in a loop, so
 *  they bring a delta back from `(-2π, 2π)` and no further. That is not a
 *  hypothetical range. `useStudio.setRotation` stores whatever it is handed and
 *  normalises nothing, and `solveLayout` reads `origin[i].yaw` straight off
 *  `part.rot`, so a piece a user has turned the same way often enough arrives here
 *  past 2π and, without the modulo, reads as a quarter-turn from itself. */
function yawDelta(a: number, b: number): number {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

export type MmrOptions<T> = {
  /** Lower is better — this is a cost, not a score, because that is what the solver
   *  produces and converting it at each call site is how the conversion gets done
   *  two different ways. Normalisation happens once, here. */
  cost: (item: T) => number;
  /** In `[0, 1]`; 1 means "these are the same arrangement". */
  similarity: (a: T, b: T) => number;
  /** How much the ordering cares about being GOOD versus being DIFFERENT.
   *  1 is pure cost order — the current behaviour, and the one that converges.
   *  0 picks the cheapest first and then the most different thing remaining,
   *  ignoring cost entirely. */
  lambda: number;
  /** Stop after this many. Defaults to everything: the ordering is the product, and
   *  a caller that wants three takes three. */
  k?: number;
};

/**
 * Maximal Marginal Relevance over costed candidates.
 *
 * Merrell et al. do not price variety inside the cost function — they sample many
 * layouts, sort by cost, and diversify the returned SET. This is that step. A term
 * inside the density would make each individual layout pay for a property no
 * individual layout has, which is why § A.2 of the research note was never blocked
 * on the cost function.
 *
 * Each pick maximises `λ·relevance − (1 − λ)·(closest already picked)`. Relevance is
 * cost normalised into `[0, 1]` across the whole input — **the input, not the
 * remainder**, so the numbers do not shift underneath the loop as items are taken;
 * an item's relevance is a property of the candidate set it arrived in, and
 * renormalising per round would make the last pick's relevance 1 by construction
 * whatever its cost.
 *
 * Deterministic in full. Ties break by lower cost and then by earlier index, never
 * on `Array.prototype.sort` stability or on insertion order, because this app is
 * deterministic per seed and a suggestion order that changed with the engine would
 * be a defect nobody could reproduce.
 *
 * Throws on a non-finite cost. A `NaN` compares false against everything and would
 * sort silently into an arbitrary position, which is the failure that looks like a
 * tuning problem; `Infinity` collapses the normalisation for every other candidate.
 */
export function mmrOrder<T>(items: readonly T[], opts: MmrOptions<T>): T[] {
  const { lambda, k } = opts;
  if (!(lambda >= 0 && lambda <= 1)) {
    throw new Error(`mmrOrder: lambda must be in [0, 1], got ${lambda}`);
  }

  const costs = items.map((it, i) => {
    const c = opts.cost(it);
    if (!Number.isFinite(c)) throw new Error(`mmrOrder: cost of item ${i} is ${c}`);
    return c;
  });
  // A loop rather than `Math.min(...costs)`: this signature is generic and the
  // spread form passes one argument per candidate, which is a stack overflow on a
  // large input and a silent `Infinity`/`-Infinity` on an empty one. There is no
  // early return for the empty and single cases either — both fall through this
  // function correctly, and a branch whose deletion changes no observable behaviour
  // is one more thing a later reader has to prove redundant before touching it.
  let best = Infinity;
  let worst = -Infinity;
  for (const c of costs) {
    if (c < best) best = c;
    if (c > worst) worst = c;
  }
  const spread = worst - best;
  // Every candidate equally good is not every candidate worthless. With no spread
  // the relevance half of the score is a constant, so the ordering is decided by
  // diversity and by the tie-break — which is what "these are all as good as each
  // other, show me different ones" ought to mean.
  //
  // **The `1` is unobservable and is not a decision.** A constant relevance shifts
  // every candidate's score by the same amount at every λ, so `0` orders the set
  // identically and no test can tell the two apart — verified by mutation, which is
  // how this note got here rather than a test that would have to lie. It is written
  // as `1` because "all equally good" reads better than "all equally bad"; if a
  // future caller ever exposes the score itself, that stops being true and this
  // becomes a real choice needing a real test.
  const relevance = costs.map((c) => (spread > 0 ? (worst - c) / spread : 1));

  const want = Math.min(k ?? items.length, items.length);
  const picked: number[] = [];
  const taken = new Array<boolean>(items.length).fill(false);

  while (picked.length < want) {
    let bestIdx = -1;
    let bestScore = -Infinity;
    for (let i = 0; i < items.length; i++) {
      if (taken[i]) continue;
      // Max similarity to anything already picked. Empty selection → 0, so the first
      // pick is decided by relevance alone at every λ, including λ = 0.
      let closest = 0;
      for (const p of picked) {
        const s = opts.similarity(items[i], items[p]);
        if (s > closest) closest = s;
      }
      const score = lambda * relevance[i] - (1 - lambda) * closest;
      if (bestIdx < 0 || score > bestScore || (score === bestScore && costs[i] < costs[bestIdx])) {
        bestIdx = i;
        bestScore = score;
      }
    }
    picked.push(bestIdx);
    taken[bestIdx] = true;
  }

  return picked.map((i) => items[i]);
}

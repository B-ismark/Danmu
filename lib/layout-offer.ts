/**
 * The offer stage — what gets SHOWN, as distinct from what gets searched.
 *
 * `lib/layout-solve.ts` answers "what is the best arrangement of this room".
 * `orderOffers` answers the one that comes after it and that no single arrangement
 * can answer about itself: **which of several good arrangements should we show
 * next, given the ones already shown.** Variety is a property of the SET of
 * suggestions, so it is decided here rather than priced inside the cost function —
 * a term in the density would make each individual layout pay for a property no
 * individual layout has, which is why § A.2 of
 * `docs/research/suggest-and-collision.md` was never blocked on the cost function.
 *
 * This lives outside the solver because nothing in it can change which
 * arrangements the annealer finds, so nothing in it can destabilise the search.
 * That property is why the research note scopes layer 3 separately from layer 2,
 * and it is worth keeping: a cost term added here would quietly give it up.
 *
 * `isWorthOffering` — the other offer-stage decision — is NOT here. It is
 * `lib/layout-solve.ts:154` and stays there; the relation-aware floor that § C asks
 * for will compose with it rather than fork it.
 *
 * Nothing here is stateful and nothing here reads the store. A caller that wants
 * "different from what I have already offered" passes that history in.
 *
 * ── No thresholds are defined in this file, and that is the design ─────────────
 *
 * `spotM`, `yawRad` and `diversityPenalty` are all required arguments with no
 * defaults. Every one of them is a question the SOLVER already has an answer to,
 * and a default here would be a second copy of that answer in a second file, free
 * to drift in the direction nobody notices. The first version of this file defined
 * its own 15° "same turn" tolerance with a paragraph of reasoning; the reasoning
 * was false (the annealer's free turn is uniform on ±17.19°, `layout-solve.ts:1219`,
 * so most real turns fell inside it), and the number happened to be bit-identical to
 * `Math.PI / 12` — the app's own rotation step — so whether one press of the turn key
 * counted as a turn was decided by float rounding, asymmetrically in sign, on 41.6%
 * of headings. A constant invented here to sit beside constants that already exist
 * is how that happens.
 */
import { angleDelta, type Placement } from './layout-score';

/**
 * How much of one arrangement is the same arrangement as another, in `[0, 1]`.
 *
 * A **share of pieces that stand in the same place, turned the same way** — 1 when
 * every piece considered agrees, 0 when none do. Graded rather than the solver's
 * boolean `similar()`, because ranking "mostly the same" below "half the room is
 * different" is the whole job and a predicate cannot say that.
 *
 * ── `spotM` and `yawRad` are required, and they are not the same question ─────
 *
 * `spotM` is the solver's dedup distance (`similar()`, 0.25 m) when the caller is
 * ranking one solve's finalists, because two candidates the pool merged must score
 * 1.0 here or the two disagree about what a different arrangement IS. `yawRad` has
 * no counterpart in `similar()` at all — see the warning below — so the caller's
 * honest source for it is `TURN_EPSILON` (`layout-solve.ts:142`, ~3°), which is
 * already this app's answer to "below this, a turn is not worth showing as a
 * change" and is what `displaced()` reads to decide what the "moved 5 pieces" toast
 * counts. Using anything else makes the toast and the offer stage disagree silently.
 *
 * ── WARNING: the solver's dedup ignores yaw entirely ──────────────────────────
 *
 * `similar()` compares x/z and never reads `.yaw`, while `propose` turns a piece
 * **in place** (`layout-solve.ts:1215`, position untouched). So `remember()` merges
 * a turn-only variant into the candidate it turned from and keeps the cheaper one:
 * **a rotation-only alternative cannot reach the finalist pool at any seed.** The
 * yaw half of this function is therefore live for candidates from separate solves
 * and dead for candidates from one pool. That is a real limit on what MMR over the
 * pool can offer, it is not fixable here, and it is recorded rather than worked
 * around because the failure it produces looks like "the diversity code does
 * nothing" rather than like a missing term in someone else's predicate.
 *
 * ── `movable` ─────────────────────────────────────────────────────────────────
 *
 * Pass it whenever anything is locked. A locked piece agrees with itself in every
 * pair — it cannot do otherwise — so counting locked pieces drags every similarity
 * toward 1 in proportion to how much of the room is fixed, and a room with three
 * movable pieces among twenty fixtures reports every pair as ~87% alike. Ranking
 * over that is inert in a way that reads as a tuning problem rather than a bug. The
 * solver's own answer is `!locked[i] && !p.wallMounted` (`layout-solve.ts:247`).
 *
 * Throws rather than coping, in all three cases — mismatched lengths, a short
 * `movable`, a non-finite coordinate. Each of them otherwise returns a plausible
 * number for two unrelated arrangements: a short `movable` treats every index past
 * its end as locked, so `movable: []` reported **1.0** for arrangements agreeing on
 * nothing, and a `NaN` coordinate fails `NaN > spotM` and fell through to *agreed*.
 * Both are the failure this file exists to avoid — a silent claim that two
 * arrangements are the same.
 */
export function layoutSimilarity(
  a: readonly Placement[],
  b: readonly Placement[],
  opts: { spotM: number; yawRad: number; movable?: readonly boolean[] },
): number {
  if (a.length !== b.length) {
    throw new Error(`layoutSimilarity: ${a.length} placements against ${b.length}`);
  }
  if (opts.movable && opts.movable.length !== a.length) {
    throw new Error(`layoutSimilarity: movable has ${opts.movable.length} of ${a.length}`);
  }
  let considered = 0;
  let agreed = 0;
  for (let i = 0; i < a.length; i++) {
    if (opts.movable && !opts.movable[i]) continue;
    considered++;
    const dx = a[i].x - b[i].x;
    const dz = a[i].z - b[i].z;
    const dyaw = angleDelta(a[i].yaw, b[i].yaw);
    if (!Number.isFinite(dx) || !Number.isFinite(dz) || !Number.isFinite(dyaw)) {
      throw new Error(`layoutSimilarity: placement ${i} is not finite`);
    }
    if (Math.hypot(dx, dz) > opts.spotM) continue;
    if (Math.abs(dyaw) > opts.yawRad) continue;
    agreed++;
  }
  // No movable piece is not "completely different"; it is a room with nothing to
  // distinguish, and 1 is the reading that stops the ranking preferring a coin
  // flip. `solveLayout` returns before it ever gets here (`allIdx.length === 0`).
  return considered === 0 ? 1 : agreed / considered;
}

export type OfferOptions<T> = {
  /** Lower is better — a cost, because that is what the solver produces.
   *  Converting it at each call site is how the conversion gets done two ways. */
  cost: (item: T) => number;
  /** In `[0, 1]`; 1 means "these are the same arrangement". */
  similarity: (a: T, b: T) => number;
  /** **In cost units**: the extra cost a completely-duplicate arrangement is worth
   *  paying to avoid. 0 is pure cost order — the current behaviour, and the one
   *  that converges. See the note on why this is not a `[0, 1]` lambda. */
  diversityPenalty: number;
  /** Stop after this many. Defaults to everything: the ordering is the product,
   *  and a caller that wants three takes three. */
  k?: number;
};

/**
 * Maximal Marginal Relevance over costed candidates — good, and not like the ones
 * already picked.
 *
 * Merrell et al. do not price variety inside the cost function; they sample many
 * layouts, sort by cost, and diversify the returned SET. This is that step. Each
 * pick minimises `cost + diversityPenalty × (closest already picked)`.
 *
 * ── Why the trade is in cost units and not a [0, 1] lambda ────────────────────
 *
 * Textbook MMR maximises `λ·rel − (1−λ)·sim`, with relevance normalised across the
 * candidate set. **That form was written here first and it is wrong for this input**,
 * because it compares a *fraction of the set's cost spread* against a *share of the
 * room* — two quantities with no common unit — so λ has no stable meaning. Three
 * measured consequences, all of which this form does not have:
 *
 *   · **A candidate that is never shown decides the one that is.** With finalists at
 *     8.20 / 8.21 / 8.55 and `k = 2` the normalised form offers the first two for
 *     every λ from 0.3 to 0.86; adding a fourth finalist at 14.0 — never offered —
 *     changes the second suggestion, purely by widening the spread.
 *   · **A rounding error gets full relevance.** With costs `[10, 10+ε, 10+2ε]` the
 *     spread is ε, so the normalisation blows it up to the full `[0, 1]` range and
 *     orders by it. `isWorthOffering` next door refuses exactly this reasoning, in
 *     cost units, with a written note about rounding errors.
 *   · **λ's meaning moved with the piece count.** Similarity is a share of the room,
 *     so "differs in one piece" is `(N−1)/N` — the diversity term varies by at most
 *     `1/N` between candidates while relevance always spans the full range. At λ 0.5
 *     the same three costs gave the diverse candidate second in a 2-piece room and
 *     pure cost order in an 8-piece one. The file was inert in the rooms it was for,
 *     and its own tests passed because their fixtures were 2 pieces, where
 *     similarity is only ever exactly 0 or 1.
 *
 * A penalty in cost units has none of those: it is absolute, so an unshown outlier
 * cannot move it, an ε difference stays ε, and "one of eight pieces different"
 * simply earns one eighth of the penalty. It is also the only form a caller can
 * reason about — "I will accept this much extra cost for a completely different
 * arrangement" is a sentence about the room; "λ = 0.7" is not.
 *
 * Deterministic in full. Ties break by lower cost and then by earlier index, never
 * on `Array.prototype.sort` stability, because this app is deterministic per seed
 * and a suggestion order that changed with the engine would be a defect nobody
 * could reproduce.
 *
 * Throws on a non-finite cost or a negative penalty. A `NaN` compares false against
 * everything and would sort silently into an arbitrary position; a negative penalty
 * inverts the term and seeks out duplicates.
 */
export function orderOffers<T>(items: readonly T[], opts: OfferOptions<T>): T[] {
  const { diversityPenalty: penalty, k } = opts;
  // Finite as well as non-negative, and the finite half is load-bearing rather than
  // tidy: with an infinite penalty every score is `Infinity`, no candidate ever
  // beats the running best, and the loop pushes `-1` and returns `undefined`s.
  if (!Number.isFinite(penalty) || penalty < 0) {
    throw new Error(`orderOffers: diversityPenalty must be finite and >= 0, got ${penalty}`);
  }

  const costs = items.map((it, i) => {
    const c = opts.cost(it);
    if (!Number.isFinite(c)) throw new Error(`orderOffers: cost of item ${i} is ${c}`);
    return c;
  });

  const want = Math.min(k ?? items.length, items.length);
  const picked: number[] = [];
  const taken = new Array<boolean>(items.length).fill(false);

  while (picked.length < want) {
    let bestIdx = -1;
    let bestScore = Infinity;
    for (let i = 0; i < items.length; i++) {
      if (taken[i]) continue;
      // The closest thing already picked — the MAXIMUM over the whole selection,
      // not the most recent one. A third pick that duplicates the first is just as
      // much a repeat as one that duplicates the second.
      let closest = 0;
      for (const p of picked) {
        const s = opts.similarity(items[i], items[p]);
        if (s > closest) closest = s;
      }
      const score = costs[i] + penalty * closest;
      if (score < bestScore || (score === bestScore && costs[i] < costs[bestIdx])) {
        bestIdx = i;
        bestScore = score;
      }
    }
    picked.push(bestIdx);
    taken[bestIdx] = true;
  }

  return picked.map((i) => items[i]);
}

// Rearranging the room, as search rather than as rules.
//
// `lib/layout-score.ts` turns "is this a good arrangement" into a number. This
// walks downhill on that number by simulated annealing: propose a small change,
// keep it if it helps, and keep it ANYWAY with a probability that falls as the
// search cools. The middle part is what makes it work — a room where every piece
// is already locally sensible is a local minimum, and getting out of one means
// accepting a worse arrangement for a while.
//
// Four properties this has to have, none of them optional:
//
//   · **Deterministic.** Same room, same seed, same answer. The PRNG is seeded and
//     carried explicitly; nothing calls `Math.random`, which would make the
//     suggestion unrepeatable and the tests a lottery.
//   · **It only moves and turns.** `dimMM` is read and never written. A suggestion
//     that resized the furniture would be the one thing this codebase refuses to
//     do, and a type that cannot express it beats a comment asking nicely.
//   · **It respects locks.** A locked piece is left exactly where it is and still
//     scored, because it is still in the way.
//   · **It leaves alone what was already right.** The score carries an inertia
//     term against the incoming layout, so a piece only moves if moving it buys
//     something. Without that the answer is a different local minimum every time
//     and reads as a shuffle, which is exactly what it was accused of being.
//
// ── The proposals are the interesting part ──────────────────────────────────
//
// A uniformly random jump inside the room's bounding box is rejected almost every
// time in a furnished room, so a budget spent that way mostly buys nothing. The
// moves here are the ones a person makes: put its back against a wall, line it up
// with its neighbour, turn it to face the television, park it next to the thing it
// belongs to, swap two pieces of similar size. Structure-aware proposals are the
// difference between annealing that converges in a few thousand steps and
// annealing that wanders — Merrell et al. make the same point about their sampler.
//
// Hierarchical, following Infinigen Indoors: the large pieces settle first and the
// small ones arrange around them. A sofa and a side table optimised together
// spends its budget shuffling the side table.

import type { ScenePart } from './scene-spec';
import type { Footprint } from './footprint';
import { footprintBounds } from './footprint';
import { snapToWall } from './physics';
import { distanceToFootprintEdge, ON_WALL_M, pointInFootprint } from './footprint';
import { localToWorld, nearestEdge } from './geometry';
import {
  angleDelta,
  bandCost,
  costBreakdown,
  navigabilityCost,
  NAV_CELL,
  prepare,
  relationParents,
  scoreLayout,
  DEFAULT_WEIGHTS,
  REFIT_INERTIA,
  type CostBreakdown,
  type LayoutContext,
  type LayoutModel,
  type Placement,
  type ScoreWeights,
} from './layout-score';
import { relationFor, roleOf } from './layout-rules';

export type SolveOptions = {
  /** Same seed, same suggestion. */
  seed?: number;
  /** Proposals for a pass over every movable piece. Each pass gets this budget
   *  PRO RATA to how many pieces it is allowed to move, so the first pass — which
   *  only settles the big furniture — is not charged for the pieces it is ignoring.
   *
   *  The default is where the quality curve flattens. Measured on a 20-piece room,
   *  mean final cost against wall clock: 300 → 151 in 117 ms, 600 → 125 in 141 ms,
   *  1200 → 90 in 263 ms, 4000 → 81 in 1166 ms. Past this point it is paying four
   *  times over for a tenth of the quality, and the whole thing runs on the main
   *  thread while a person waits for a button. */
  steps?: number;
  weights?: ScoreWeights;
  /** `'arrange'` looks for the best arrangement it can find. `'refit'` looks for
   *  the SMALLEST set of moves that clears what is currently wrong — what you want
   *  after the room or a piece has been resized, where the layout was fine until
   *  one number changed and reinventing it would throw away the user's work. */
  mode?: 'arrange' | 'refit';
  /** Ids of pieces the USER placed by hand. Those cost more to move than ones the
   *  app guessed at — see `LayoutContext.placed`. */
  placed?: Set<string>;
};

/** Why one piece ended up somewhere else.
 *
 *  A suggestion the user can read is one they keep; the same move unexplained is the
 *  one they undo. `term` is the cost term that paid for the move — found by scoring
 *  the answer against the answer with only this piece put back, which is exactly
 *  what the prune below already computes, so it is free. */
export type MoveReason = {
  index: number;
  /** The term that gained most by moving this piece. */
  term: keyof ScoreWeights;
  /** How much the whole layout gained by it. */
  gain: number;
  /** Metres, and radians. */
  distance: number;
  turn: number;
};

export type SolveResult = {
  placements: Placement[];
  /** Cost before and after, so a caller can say what it achieved — and so a
   *  suggestion that achieved nothing can be recognised and not offered. */
  before: number;
  after: number;
  /** …and the same, per term, so the UI can say what it fixed rather than only
   *  how many things it touched. */
  breakdownBefore: CostBreakdown;
  breakdownAfter: CostBreakdown;
  /** Indices whose placement actually changed. */
  moved: number[];
  /** …and what each of those moves bought, index-aligned with `moved`. */
  moves: MoveReason[];
};

const DEFAULT_STEPS = 1600;
/** How much a piece's move may cost, over putting it back, and still be kept.
 *
 *  The annealer accepts uphill moves on purpose — that is what gets it out of a local
 *  minimum — but it never goes back and asks whether each one was worth it, and the
 *  arrangement it hands over is whatever its best snapshot happened to hold. So every
 *  moved piece is offered its old place back, and keeps the new one only if the room
 *  is genuinely better for it.
 *
 *  Measured over the five presets at three seeds: this reverted 40–63 % of the moves
 *  and left the total cost EQUAL OR LOWER in eight of the twelve runs. Those moves
 *  were not trade-offs the search made; they were noise it never cleaned up, and
 *  every one of them is a piece the user watches jump for no reason. */
const KEEP_EPS = 0.5;
/** How far off square a yaw may be and still be read as meant to be square, radians.
 *  Beyond this the angle is a choice — a chair turned toward a sofa — and snapping it
 *  would be overruling the search rather than tidying after it. */
const SNAP_TOL = 0.21; // 12°
/** Below this a turn is not worth showing as a change. The position epsilon had no
 *  sibling, so 0.02 rad — 1.1°, invisible — counted as a moved piece and inflated
 *  every "moved N pieces" the UI reported. */
const TURN_EPSILON = 0.05; // ~3°

/** What a suggestion has to be worth before it is worth offering.
 *
 *  Not `after < before`. A solve that trims 3.1 to 2.4 by sliding a sofa 10 cm and a
 *  rug 10 cm has found a real improvement and is still not an answer to "give me an
 *  idea" — it is a room rearranged under the banner of a rounding error, which is
 *  what a shuffle looks like from the outside. Either a whole cost unit and a
 *  fifteenth of the room's total, or it is already a good arrangement. */
export const MIN_GAIN_ABS = 1.0;
export const MIN_GAIN_SHARE = 0.07;

export function isWorthOffering(before: number, after: number): boolean {
  return before - after >= Math.max(MIN_GAIN_ABS, MIN_GAIN_SHARE * before);
}
/** Pieces bigger than this settle in the first pass, everything else in the
 *  second. Square metres of footprint — a sofa or a bed is well over, a side
 *  table or a lamp well under. */
const LARGE_AREA = 0.9;
/** Below this the move is not worth showing as a change. */
const MOVE_EPSILON = 0.02;
/** How many finalists get the expensive navigability check. Small: each one costs
 *  a distance transform over the room. */
const FINALISTS = 4;
/** Steps in the pass that opens a route, and the whole reason it exists.
 *
 *  Ranking finalists on navigation only helps when the pool holds a candidate that is
 *  better. When the arrangement is already a local minimum on every other term the
 *  annealer never leaves it, the pool holds ONE candidate, and ranking one candidate
 *  is a no-op. Measured on a 6 × 4 room with seven chairs strung across it: scored
 *  total 0.4 — a near-perfect room — with 5.2 m² of floor that has no route to the
 *  door, and nothing moved at six seeds out of six.
 *
 *  So when the room is cut, the search runs again with navigation actually in the
 *  objective. Only then: a room that is not cut pays one coarse field (~325 µs) to
 *  find that out, and nothing more. */
const REPAIR_STEPS = 260;

/** …and the grid its inner loop reads, which is coarser than `NAV_CELL` because it is
 *  paid per proposal: 325 us against 1 190. Quantisation errs toward calling a
 *  marginal gap impassable, which is the safe direction for a pass whose job is to
 *  open one — and the answer is re-checked on the fine grid before it is kept. */
const REPAIR_CELL = 0.1;

/** Seeded PRNG (mulberry32). Explicit because a layout suggestion that differs
 *  between two runs of the same room is not a suggestion, it is a slot machine. */
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The `locked` array for a solve, built from the three separate reasons a piece
 *  may not move. Exported and pure because it used to be one expression inside a
 *  `.map()` in `RoomTools`, where no test could reach it — and it is the whole of
 *  whether the user's Lock button works. A lock that composes wrongly with a
 *  confined fix fails silently: the piece just moves, and the button reads as
 *  decorative.
 *
 *  The three are genuinely different questions:
 *
 *  · `pinned` — the user pressed **Lock** on that row. Their answer, and it wins.
 *  · `part.locked` — **"came out of your photo"**, not a lock, whatever the field
 *    is called; see `ScenePart.locked`, whose own comment says the name is wrong.
 *    Honoured here because it always has been, and changing it changes what
 *    Suggest does to every detected room — a product decision, not a tidy-up. Left
 *    as it stands on purpose, and named here because a reader who trusts the
 *    identifier will misread the line.
 *  · `confined` — a **Try a fix** solve names the few pieces it may touch, so
 *    everything else is locked for the duration. Null for a whole-room Suggest.
 */
export function lockedForSolve(
  parts: ScenePart[],
  pinned: Record<string, boolean>,
  confined: Set<string> | null,
): boolean[] {
  return parts.map((p) => !!pinned[p.id] || p.locked || (confined ? !confined.has(p.id) : false));
}

/**
 * Suggest an arrangement.
 *
 * `locked` is index-aligned with `parts`. Wall-mounted pieces are never moved
 * either: their position is a property of the wall they are on, and sliding a
 * window along it is not a layout decision. Doors and windows are still SCORED —
 * that is the whole point — they are just not moved.
 */
export function solveLayout(
  parts: ScenePart[],
  footprint: Footprint,
  locked: boolean[],
  opts: SolveOptions = {},
): SolveResult {
  const refit = opts.mode === 'refit';
  const weights: ScoreWeights = {
    ...(opts.weights ?? DEFAULT_WEIGHTS),
    ...(refit && !opts.weights ? { inertia: REFIT_INERTIA } : null),
  };
  const steps = opts.steps ?? DEFAULT_STEPS;
  const rng = makeRng(opts.seed ?? 1);

  const movable = parts.map((p, i) => !locked[i] && !p.wallMounted);
  const origin: Placement[] = parts.map((p) => ({ x: p.pos[0], z: p.pos[2], yaw: p.rot }));
  const ctx: LayoutContext = {
    parts,
    movable,
    footprint,
    origin,
    placed: opts.placed ? parts.map((p) => opts.placed!.has(p.id)) : undefined,
  };
  const model = prepare(ctx);

  const current: Placement[] = origin.map((p) => ({ ...p }));
  // Navigation is priced in from the very first number, so `before` and `after` are
  // comparable and a suggestion that opens a sealed-off half of the room is
  // recognised as the large improvement it is.
  const breakdownBefore = costBreakdown(model, current, weights, NAV_CELL);
  const before = breakdownBefore.total;

  const b = footprintBounds(footprint);
  const span = Math.max(b.width, b.depth);

  // Pass 1 settles the big pieces, pass 2 everything movable — including the big
  // ones again, so the second pass can still nudge a sofa the side tables have
  // boxed in rather than treating the first pass as final.
  const bigIdx: number[] = [];
  const allIdx: number[] = [];
  for (let i = 0; i < parts.length; i++) {
    if (!movable[i]) continue;
    allIdx.push(i);
    if ((parts[i].dimMM[0] / 1000) * (parts[i].dimMM[1] / 1000) >= LARGE_AREA) bigIdx.push(i);
  }
  if (allIdx.length === 0) {
    return { placements: current, before, after: before, breakdownBefore, breakdownAfter: breakdownBefore, moved: [], moves: [] };
  }

  // ── Groups the user already has, moved as groups ──────────────────────────
  //
  // Part III of §3.10.3, and the one case the flat search genuinely cannot do.
  // Measured: an open plan whose living and dining groups are each intact but standing
  // in the other's half costs 23.2 against the 13.4 of the same furniture the right way
  // round, and the flat annealer moved **0–1 pieces of eleven** at every seed and never
  // found it. It is a textbook local minimum: taking any single piece out of a coherent
  // group makes the room worse, so no single-piece move is downhill and the whole
  // group has to move at once or not at all.
  //
  // Built from the arrangement the user HAS rather than from the relation table, and
  // only from edges that are currently satisfied — see `intactGroups`. A group is a
  // thing this room already contains, not a thing it ought to.
  const groups = intactGroups(model, origin, movable);
  // Scratch for undoing a rejected multi-piece proposal. Preallocated: the loop below
  // runs sixteen thousand times and a pair of arrays per step is a pair of arrays per
  // step.
  const touchedIdx = new Int32Array(parts.length);
  const touchedPrev: Placement[] = new Array(parts.length);

  let best = current.map((p) => ({ ...p }));
  let bestCost = before;
  let cost = before;
  // The finalists that get the expensive navigability pass. Kept as we go rather
  // than re-running the search: the annealer visits plenty of good, genuinely
  // different arrangements on its way down and throwing them away means paying to
  // find them again.
  const pool: Array<{ placements: Placement[]; cost: number }> = [];

  // Scratch for undoing a rejected multi-piece proposal, shared by both loops below.
  let touchedN = 0;
  const stash = (k: number) => {
    touchedIdx[touchedN] = k;
    touchedPrev[touchedN] = current[k];
    touchedN++;
  };
  const undo = () => {
    for (let t = 0; t < touchedN; t++) current[touchedIdx[t]] = touchedPrev[t];
  };

  // ── Pass 0: move the groups, and only the groups ──────────────────────────
  //
  // Its OWN budget, ahead of the piece-level passes, and that is the whole design
  // rather than a detail. Mixing group proposals into the passes below was tried
  // first and measured worse: over twenty seeds it improved the best case sharply
  // (the T's 7.4 → 1.2, the open plan's 17.5 → 4.4) and left the mean where it was or
  // raised it, while a room the user had simply scrambled went from a mean of 3.8 to
  // 5.4 — because every proposal spent hopping between basins is one the single-piece
  // moves did not get for settling, and settling is what most rooms actually need.
  //
  // Separated, the two do different jobs with different money: this pass asks "is
  // there a better arrangement of the same groups", and whatever it finds is where the
  // passes below start from. It costs `GROUP_STEPS` evaluations — a few milliseconds
  // against a solve of a few hundred — and is skipped entirely when the room has no
  // intact group, which is exactly the scrambled case.
  // …and never in `refit`, whose entire job is to change as little as possible after a
  // resize. Hopping between basins is the definition of reinventing the arrangement, so
  // the pass would be spending three hundred evaluations proposing the one thing this
  // mode exists to refuse.
  if (groups.length > 0 && !refit) {
    for (let step = 0; step < GROUP_STEPS; step++) {
      const t = step / GROUP_STEPS;
      const temp = Math.max(1e-4, 8 * Math.pow(0.02, t));
      const reach = span * 0.5 * (1 - t) + 0.05;
      touchedN = 0;
      proposeGroup(current, groups, reach, rng, stash);
      const trial = scoreLayout(model, current, weights);
      const delta = trial - cost;
      if (delta <= 0 || rng() < Math.exp(-delta / temp)) {
        cost = trial;
        if (cost < bestCost) {
          bestCost = cost;
          best = current.map((p) => ({ ...p }));
          remember(pool, best, cost);
        }
      } else {
        undo();
      }
    }
    for (let i = 0; i < current.length; i++) current[i] = { ...best[i] };
    cost = bestCost;
  }

  // ── Pass 1: the piece the room is arranged around, on its own ─────────────
  //
  // `RoomProfile.anchor` — a bed in a bedroom, a sofa in a living room — and until
  // now it was computed by `roomProfile` and read by nothing, while its own doc
  // comment claimed *"settling it first is what makes a hierarchical solve behave"*.
  // A field asserting a behaviour the code does not have is worse than an absent one,
  // because the next reader believes it.
  //
  // It is read now. What it buys, re-measured at `4be144c` — twelve seeds per preset
  // on a scrambled room, every preset at 6 × 5, this pool emptied versus shipped:
  //
  //   preset   n      worst  without → with       median  without → with
  //   rect    11              16.17 →  12.60               8.77 →  6.83
  //   l       14              33.68 →  35.38              17.68 → 17.87
  //   t       18             490.10 → 277.78              84.22 → 39.43
  //   u       12              36.24 →  38.53              12.08 → 10.46
  //   open    17              36.60 → 253.31              11.49 → 15.22
  //
  // So it rescues the T, helps the rectangle, is a wash on the L and the U, and makes
  // `open` five times worse in the tail. That is NOT what this comment used to claim —
  // `rect 9.7 → 8.7 · l 1081 → 136 · t 310 → 67 · u 155 → 6.9 · open 37 → 22`, and
  // "the disasters stop happening". Those numbers named no room size, so this is not
  // the same experiment re-run and the difference is not evidence of a regression; it
  // is evidence that a measurement whose fixture was never written down can only be
  // replaced, never checked. The fixture is written down here and in
  // `tests/layout-solve.test.ts`, which asserts the one column of it that holds
  // robustly: the count of seeds ending with no hard term at all, 12 of 12 with this
  // pool and 9 of 12 without.
  //
  // One limit on the ablation, stated because it cuts both ways: skipping a pass also
  // shifts the RNG stream every later pass draws from, so "without" is a different
  // trajectory rather than this one minus a pass. `passSteps` is per pool and never
  // reads `anchorIdx`, so the other two passes do get identical budgets.
  //
  // Whether `open` wants this pass skipped is open — see section G of
  // `docs/what-is-still-open.md`. It is not being tuned here, because a change that
  // helps one preset's tail and hurts another's is a decision about which rooms this
  // app is for, not an optimisation.
  //
  // Costs one pool of one, and `passSteps` is pro rata, so it is the 120-step floor.
  const anchorIdx =
    model.profile.anchor !== null && movable[model.profile.anchor] ? [model.profile.anchor] : [];

  for (const pool_ of [anchorIdx, bigIdx.length >= 2 ? bigIdx : [], allIdx]) {
    if (pool_.length === 0) continue;
    // Pro rata: a pass that may only move five of seventeen pieces needs five
    // seventeenths of the proposals, and charging it the full budget was a third of
    // the solve spent re-annealing furniture that was already settled.
    const passSteps = Math.max(120, Math.round((steps * pool_.length) / allIdx.length));
    for (let step = 0; step < passSteps; step++) {
      const t = step / passSteps;
      // Geometric cooling, and the move sizes shrink with it: early steps relocate
      // a sofa across the room, late ones adjust it by a centimetre.
      const temp = Math.max(1e-4, 8 * Math.pow(0.02, t));
      const reach = span * 0.5 * (1 - t) + 0.05;

      // Every proposal records what it touched, so one undo path serves both a single
      // piece and a two-piece swap — and the group pass above uses the same one.
      touchedN = 0;
      const i = pool_[Math.floor(rng() * pool_.length) % pool_.length];
      const prev = current[i];
      // A swap moves two pieces at once, so it has to be undone as two.
      const swapWith = rng() < 0.06 ? pickSwap(model, pool_, i, rng) : -1;
      stash(i);
      if (swapWith >= 0) {
        const other = current[swapWith];
        stash(swapWith);
        current[i] = { ...other, yaw: normaliseYaw(other.yaw) };
        current[swapWith] = { ...prev, yaw: normaliseYaw(prev.yaw) };
      } else {
        current[i] = propose(model, current, i, reach, rng, b);
      }
      const trial = scoreLayout(model, current, weights);
      const delta = trial - cost;
      if (delta <= 0 || rng() < Math.exp(-delta / temp)) {
        cost = trial;
        if (cost < bestCost) {
          bestCost = cost;
          best = current.map((p) => ({ ...p }));
          remember(pool, best, cost);
        }
      } else {
        undo();
      }
    }
    // Each pass restarts from the best seen, so a pass that wandered uphill at
    // the end does not hand its wreckage to the next one.
    for (let i = 0; i < current.length; i++) current[i] = { ...best[i] };
    cost = bestCost;
  }

  // ── Finalists: the question the annealer's terms cannot ask ────────────────
  remember(pool, best, bestCost);
  let winner = best;
  let winnerCost = bestCost + weights.navigation * navigabilityCost(model, best, NAV_CELL);
  for (const cand of pool) {
    if (cand.placements === best) continue;
    const total = cand.cost + weights.navigation * navigabilityCost(model, cand.placements, NAV_CELL);
    if (total < winnerCost) {
      winnerCost = total;
      winner = cand.placements;
    }
  }

  for (const p of winner) p.yaw = normaliseYaw(p.yaw);

  // ── Tidy, then justify ────────────────────────────────────────────────────
  //
  // Both of these run on the answer rather than inside the search, and both cost a
  // handful of evaluations against the anneal's sixteen hundred. Order matters:
  // snapping first means the prune is deciding about the yaw the user would actually
  // see, not about one three degrees off it.
  // Scoped to what the search touched — a piece it never proposed a move for has no
  // residue to tidy, and its angle is the user's own. See `untouched`.
  winner = snapYaws(model, winner, weights, true, origin);
  winner = pruneMoves(model, origin, winner, weights);
  // …then the repair, because it is the only pass whose objective the prune cannot
  // see: a move that opens a route would be reverted by a prune scoring without
  // navigation.
  winner = openRoutes(model, winner, weights, b, rng);
  // …and the tidy again, because the repair is a search like any other and hands
  // back the same few-degree residue the first tidy exists to remove. It used to be
  // the last word, so on any room that WAS cut — the only rooms it runs on — the
  // yaws the user saw were the untidied ones. A second pass costs a handful of
  // breakdowns and is a no-op when `openRoutes` changed nothing.
  //
  // ── …but only over what this solve moved ──────────────────────────────────
  //
  // Scoped, because running a tidy after the prune inverts which pass has the last
  // word on a piece the user angled themselves. `SNAP_TOL` is 12° and
  // `TURN_EPSILON` is 2.9°, and that gap is a real band of user intent: a piece
  // tilted 8° by a rotate drag is inside the tidy's reach and outside "unchanged".
  // The prune's whole job is to hand such a piece back untouched — with zero
  // displacement it sorts first in `candidates` and is the cheapest revert it can
  // buy — and an unscoped tidy then squared it again. Measured on the 7.5 × 5.6
  // rect preset with every seeded piece at 8°: `moved` reported 7 pieces where 2
  // had moved, and 5 were standing exactly where the user left them with their
  // angle normalised, each handed a sentence by `explain` about a piece that did
  // not move. That is the complaint this commit set out to kill, pointing the
  // other way.
  //
  // The scope costs the pass nothing it was for: `openRoutes` only moves pieces in
  // its own pool, so every piece carrying its residue is displaced from `origin`
  // by construction. A piece the prune restored is the user's again.
  winner = snapYaws(model, winner, weights, true, origin);

  let breakdownAfter = costBreakdown(model, winner, weights, NAV_CELL);
  // …and never hand back something worse than what we were given. The prune spends a
  // small slack budget to buy back pointless moves, and on a layout that was already
  // near-optimal that slack can eat the entire gain — at which point the honest
  // answer is that there was nothing worth moving. An invariant rather than a
  // safeguard: every caller downstream assumes `after <= before`.
  if (breakdownAfter.total >= before) {
    winner = origin.map((p) => ({ ...p }));
    breakdownAfter = breakdownBefore;
  }
  const moved: number[] = [];
  for (let i = 0; i < winner.length; i++) {
    if (displaced(origin[i], winner[i])) moved.push(i);
  }
  return {
    placements: winner,
    before,
    after: breakdownAfter.total,
    breakdownBefore,
    breakdownAfter,
    moved,
    // A cell only when the layout we were handed actually had floor cut off from the
    // door. If it did not, no move can be credited to opening a route, and the
    // distance transforms would be paid for an answer that is known in advance.
    moves: explain(model, origin, winner, weights, moved, breakdownBefore.navigation > 0 ? NAV_CELL : null),
  };
}

/** Did this piece end up somewhere a person would call different? */
function displaced(from: Placement, to: Placement): boolean {
  return (
    Math.hypot(to.x - from.x, to.z - from.z) > MOVE_EPSILON ||
    Math.abs(angleDelta(to.yaw, from.yaw)) > TURN_EPSILON
  );
}

/** Open a route to any part of the room that has been sealed off.
 *
 *  A short second anneal whose objective INCLUDES navigation, run only when the room
 *  is actually cut. That condition is the whole design: navigation costs a raster and
 *  a distance transform, which at the report's own 0.05 m grid is 10–22× a single
 *  evaluation and could never sit in the main search — but a few hundred proposals at
 *  `NAV_CELL` is affordable, and a room that is not cut never pays for even one.
 *
 *  Restricted to the pieces that are part of the problem: an obstacle whose own
 *  footprint touches the stranded region, or borders it. Moving a wardrobe on the
 *  other side of the room cannot open a route past a chair, and letting the search
 *  try is how a repair turns back into a shuffle.
 *
 *  Exported for the same reason `isWorthOffering` is: it carries a contract of its
 *  own — *the answer is never worse on the fine grid than the layout it was given* —
 *  and that contract is invisible from `solveLayout`'s result. The pass runs between
 *  a prune and a tidy, so its input is internal state; a test that can only see the
 *  finished layout cannot tell a repair that regressed from one that did nothing,
 *  and the version of this test that tried was green against a build with the
 *  re-check deleted. */
export function openRoutes(
  m: LayoutModel,
  placements: Placement[],
  weights: ScoreWeights,
  b: { minX: number; maxX: number; minZ: number; maxZ: number },
  rng: () => number,
): Placement[] {
  if (m.doors.length === 0 || weights.navigation <= 0) return placements;
  // Triggered on the FINE grid — the one the room report reads — so this never runs on
  // a room the report is happy with. The loop below then optimises the coarse proxy,
  // and its answer is accepted only if the fine grid agrees it is an improvement.
  const stranded = navigabilityCost(m, placements, NAV_CELL);
  if (stranded <= 0) return placements;

  // Everything movable that could plausibly be in the way. The obstacle test is what
  // keeps a rug or a wall-mounted piece out of it; `movable` keeps the user's locks.
  const pool: number[] = [];
  for (let i = 0; i < placements.length; i++) {
    if (m.ctx.movable[i] && m.obstacle[i]) pool.push(i);
  }
  if (pool.length === 0) return placements;

  const cost = (p: Placement[]) => costBreakdown(m, p, weights, REPAIR_CELL).total;
  const current = placements.map((p) => ({ ...p }));
  let best = current.map((p) => ({ ...p }));
  let bestCost = cost(current);
  let now = bestCost;
  const span = Math.max(b.maxX - b.minX, b.maxZ - b.minZ);

  for (let step = 0; step < REPAIR_STEPS; step++) {
    const t = step / REPAIR_STEPS;
    const temp = Math.max(1e-4, 20 * Math.pow(0.02, t));
    const reach = span * 0.4 * (1 - t) + 0.05;
    const i = pool[Math.floor(rng() * pool.length) % pool.length];
    const prev = current[i];
    current[i] = propose(m, current, i, reach, rng, b);
    const trial = cost(current);
    if (trial - now <= 0 || rng() < Math.exp(-(trial - now) / temp)) {
      now = trial;
      if (now < bestCost) {
        bestCost = now;
        best = current.map((p) => ({ ...p }));
      }
    } else {
      current[i] = prev;
    }
  }
  for (const p of best) p.yaw = normaliseYaw(p.yaw);
  // The fine-grid re-check this function's own doc comment promised — and did not
  // do. The loop above optimises a COARSE proxy (`REPAIR_CELL`, 0.1 m against
  // `NAV_CELL`'s 0.05) precisely because it is paid per proposal, and a proxy that
  // quantises toward "impassable" can hand back an arrangement the real grid scores
  // worse than the one it started from. Nothing downstream would have noticed: the
  // only guard after this is `after >= before`, which compares against the layout
  // the USER had, not against the good answer this pass was given. So a repair could
  // quietly spend the search's work and return something worse, and the doc said it
  // couldn't.
  const fine = (p: Placement[]) => costBreakdown(m, p, weights, NAV_CELL).total;
  return fine(best) < fine(placements) ? best : placements;
}

/** Square up anything that is nearly square.
 *
 *  The annealer's free-turn proposal exists so a chair can angle toward a sofa, and
 *  it also leaves pieces a few degrees off true that nobody meant to angle — the
 *  alignment term is far too cheap to pull them back on its own. Measured yaws coming
 *  out of a solve on dining chairs: 8°, 15°, 98°. The first two are noise and this
 *  removes them; the third is a placement fault and belongs to the cost function,
 *  which now has a facing term that says so.
 *
 *  Snapped to the nearest wall's own heading rather than to the world axes, so it is
 *  right in a room whose walls the user has dragged off square.
 *
 *  ── Why the score does not get a vote ──────────────────────────────────────
 *
 *  This used to keep the snap only `if (trial <= cost)`, and that gate undid the
 *  pass it was guarding. `SNAP_TOL` has already made the judgement — *inside this
 *  band the angle is not a choice* — so re-asking a cost function that prices taste
 *  is asking the wrong question, and it loses on a coin flip: measured per degree,
 *  wall-facing costs `alignment × FACING_GAIN / 180` = **0.089**, while the relation
 *  term's own facing gradient on the same piece is **0.10**. Within 12 % of each
 *  other, so whichever way a sofa's partner happened to land decided whether the
 *  sofa came back square. Over twelve seeds of an eighteen-piece room, **6 of 51
 *  moved pieces** were handed back at 1°, 3°, 4°, 7° and 8° off — angles no one
 *  chose, that no one can see the reason for, and that read as the solver being
 *  arbitrary. It is exactly the complaint "things get rotated at odd angles".
 *
 *  Geometry still gets a veto, and only geometry: turning a 2.2 m sofa 4° sweeps its
 *  corners through ~80 mm, which can genuinely push it into a neighbour or through a
 *  wall. So the snap is refused when it makes one of THESE worse, and taste is not
 *  consulted at all. A tidy may be vetoed by a fact; it may not be outbid by a
 *  preference.
 *
 *  The list is every term that implements a rule the ROOM REPORT can raise a finding
 *  about — and that is the principle, not a measurement. It was picked by
 *  measurement first, which produced `['overlap', 'outside', 'door']`, and that set
 *  splits one family down the middle: `door` IS an access rule. It comes out of
 *  `lib/layout-rules.ts` like every other clearance number, it has a `RULE_HANDLING`
 *  row, and it raises a finding with a **Try a fix** button. There is no principle
 *  that admits "you may not close a doorway" while permitting "you may leave no room
 *  to open the wardrobe": both are facts about whether the room works, not
 *  preferences about how it looks.
 *
 *  The sharper reason is the invariant `tests/layout-conformance.test.ts` exists to
 *  hold. If the tidy can create an `access` violation, the solver manufactures a
 *  complaint about its own output — Suggest squares a piece, and Room check then
 *  reports the clearance it just broke, with a fix button pointing back at the
 *  solver. That is the scar CLAUDE.md records as "Suggest came to park a bed across
 *  a doorway and have Room check report it", and it is why the two consumers are
 *  held to each other at all. A veto set chosen by measurement drifts away from the
 *  checker; one chosen to match it cannot.
 *
 *  `walkway` and `window` stay out, and that is the same rule rather than an
 *  exception to it: neither is a fact about a single piece being usable. A walkway
 *  is a gap between two pieces that the tidy is not choosing, and a window rule is a
 *  sightline scored by height. Measured, including them cost two extra crooked
 *  pieces over twelve seeds (9 of 95 against 7) and bought nothing.
 *
 *  `navigation` IS in it, and leaving it out was a real hole rather than a judgement
 *  call: traced through the finish passes on a scrambled U, the tidy took navigation
 *  from 342.0 to 343.8 — squaring a piece closed the gap its tilt had been leaving
 *  open, and cut a part of the room off from the door. `DEFAULT_WEIGHTS`' own
 *  comment puts a square metre of unreachable floor in the same tier as a blocked
 *  door, "because it is the same failure: part of the room is not part of the
 *  room". It is the one term here that needs a grid, so `hardCost` pays for a
 *  distance transform per candidate — a few dozen per solve, against the annealer's
 *  sixteen hundred evaluations, and only for pieces already inside `SNAP_TOL`. */
export const HARD_TERMS: Array<keyof ScoreWeights> = ['overlap', 'outside', 'door', 'access', 'navigation'];

/** The hard terms, kept APART rather than added up.
 *
 *  A sum was the first version and it quietly gave away the thing the veto is for:
 *  four terms in one number means any of them buys any other. With DEFAULT_WEIGHTS,
 *  reclaiming 0.05 m² of stranded floor is worth 6 units, which pays for 60 cm² of a
 *  piece pushed through a wall — so a tidy could re-seal a route `openRoutes` had
 *  just opened and still show a net gain. The comment above promised "refused when
 *  it makes one of THESE worse"; a sum cannot express "one of". */
function hardCosts(m: LayoutModel, p: Placement[], weights: ScoreWeights, navCell: number | null): number[] {
  const b: CostBreakdown = costBreakdown(m, p, weights, navCell);
  return HARD_TERMS.map((k) => b[k]);
}

/** Did any single hard term get worse? The tolerance is per term, because each is a
 *  sum of areas or distances and an unchanged arrangement can differ in the last
 *  bit — a bare `>` would drop a tidy for a rounding error. */
function anyWorse(before: number[], after: number[]): boolean {
  for (let i = 0; i < before.length; i++) if (after[i] > before[i] + 1e-6) return true;
  return false;
}

/** Is this piece exactly where it started — position and angle both?
 *
 *  Deliberately not `displaced`, whose thresholds are about what a person would
 *  call a change. This asks the narrower question the tidy needs: *did the solver
 *  touch this at all*. A piece the search never proposed a move for, or one the
 *  prune restored (it assigns `{ ...origin[i] }`, so the numbers are identical),
 *  carries no residue for the tidy to remove — its angle is the user's. Using
 *  `displaced` here instead would leave a hole exactly the width of the gap
 *  between the two thresholds: a piece the annealer nudged 1° and 5 mm reads as
 *  "not displaced" and would keep the residue this pass exists to remove. */
function untouched(from: Placement, to: Placement): boolean {
  return Math.hypot(to.x - from.x, to.z - from.z) < 1e-9 && Math.abs(angleDelta(to.yaw, from.yaw)) < 1e-9;
}

/** Exported for the same reason `openRoutes` is: the contract that matters here —
 *  *no hard term is ever worse coming out than going in* — is invisible from
 *  `solveLayout`, which reports one total for a layout three passes downstream. A
 *  mutation battery on the commit that added the veto found `HARD_TERMS` minus
 *  `navigation`, and `guardRoutes: false`, both fully green across 227 tests. */
export function snapYaws(
  m: LayoutModel,
  placements: Placement[],
  weights: ScoreWeights,
  guardRoutes: boolean,
  onlyMovedFrom: Placement[] | null,
): Placement[] {
  const navCell = guardRoutes ? NAV_CELL : null;
  const out = placements.map((p) => ({ ...p }));
  let hard = hardCosts(m, out, weights, navCell);
  const q = Math.PI / 2;
  for (let i = 0; i < out.length; i++) {
    if (!m.ctx.movable[i]) continue;
    // …and only pieces this solve has actually touched. See `untouched`.
    if (onlyMovedFrom && untouched(onlyMovedFrom[i], out[i])) continue;
    // The polygon's winding, cached — see the same call in `layout-score`.
    const edge = nearestEdge(m.poly, out[i].x, out[i].z, m.winding);
    if (!edge) continue;
    const base = edge.yaw;
    const snapped = normaliseYaw(base + Math.round(angleDelta(out[i].yaw, base) / q) * q);
    const off = Math.abs(angleDelta(snapped, out[i].yaw));
    if (off < 1e-4 || off > SNAP_TOL) continue;
    const keep = out[i];
    out[i] = { ...keep, yaw: snapped };
    const trial = hardCosts(m, out, weights, navCell);
    if (!anyWorse(hard, trial)) {
      hard = trial;
      continue;
    }
    // Squaring it where it stands costs a hard term, so turning alone cannot tidy it —
    // and leaving it is the one outcome this pass exists to prevent. So square it and
    // shove it a little, which is what a person does: turn it straight, then push it
    // back until it fits.
    //
    // Measured over six presets x 40 seeds = 240 solves, counting every moved piece
    // handed back between 0.06 deg and `SNAP_TOL` of square. Two sweeps, because
    // `propose` changed underneath the first one — `c9fe1a4` declines an out-of-room
    // nudge instead of collapsing it onto a single interior point:
    //
    //                        before   now
    //     no shove              197     —
    //     axes only              48    63
    //     axes + diagonals       30    40
    //
    // So the crooked piece was never rare — 197 of them, and the suite was green,
    // because the one room the twelve-seed sweep above uses is a plain 7.5 x 5.6 rect
    // where it does not happen. **The remainder is real**, mostly the U and the T,
    // where neither the square yaw nor anything within the piece's own reach is legal.
    //
    // The two columns are NOT the same experiment and must not be read as a regression:
    // the "before" sweep's room sizes were never recorded. What they agree on is the
    // ratio — the diagonals clear about a third of what the axes leave, 48 → 30 and
    // 63 → 40. `tests/suggest-tidiness.test.ts` owns this table, the fixture it was
    // measured on, and the four coordinates that come free only on a diagonal; keep the
    // numbers in one place and let this be the pointer to them.
    //
    // Putting the piece back where it came from instead was tried first and does NOT
    // work: by the time the tidy runs, something else has moved into the space it came
    // from, so the revert is refused for `overlap` in its turn. It cleared neither of
    // the two cases it was written for, so there is no fallback layer here — an
    // untested branch that never fires would be worse than the crooked sofa.
    out[i] = keep;

    // How far it may be shoved: the distance squaring it would move its own furthest
    // corner, `off × radius`. Derived rather than chosen, and self-limiting in the
    // direction that matters — a barely-crooked piece earns a barely-nudge, and the
    // shift is never more visible than the tilt it buys out. For the 2.2 m sofa at
    // 2.69° that is 56 mm, against the 103 mm the tilt itself moves its corner.
    const reach = off * m.radius[i];
    let fixed = false;
    for (const scale of [1 / 3, 2 / 3, 1]) {
      for (const [ux, uz] of NUDGE_DIRS) {
        out[i] = { ...keep, yaw: snapped, x: keep.x + ux * reach * scale, z: keep.z + uz * reach * scale };
        const shoved = hardCosts(m, out, weights, navCell);
        if (!anyWorse(hard, shoved)) {
          hard = shoved;
          fixed = true;
          break;
        }
      }
      if (fixed) break;
    }
    // Nothing legal within its own reach. Better crooked than through a wall: every
    // candidate here was refused by the same hard veto the plain snap was.
    if (!fixed) out[i] = keep;
  }
  return out;
}

/** The eight directions a stuck piece is offered, axes before diagonals so a shove
 *  along one wall is preferred to one that leaves it out of line with two. Unit
 *  length, scaled by the caller. */
const NUDGE_DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [Math.SQRT1_2, Math.SQRT1_2],
  [-Math.SQRT1_2, Math.SQRT1_2],
  [Math.SQRT1_2, -Math.SQRT1_2],
  [-Math.SQRT1_2, -Math.SQRT1_2],
];

/** Offer every moved piece its old place back, and let the room decide.
 *
 *  Cheapest first — the pieces that barely moved are the likeliest to be noise, and
 *  reverting them frees the ones that did move to be judged against a tidier room.
 *  Repeated, because putting A back can make B's move pointless too.
 *
 *  This is what turns "moved 8 pieces" for four sub-15 cm nudges into a suggestion
 *  someone can look at. See `KEEP_EPS` for the measurements. */
function pruneMoves(
  m: LayoutModel,
  origin: Placement[],
  placements: Placement[],
  weights: ScoreWeights,
): Placement[] {
  const out = placements.map((p) => ({ ...p }));
  let cost = scoreLayout(m, out, weights);
  // A budget for the WHOLE prune, not a per-revert allowance. Spending `KEEP_EPS` on
  // each of five reverts would let the answer drift two and a half cost units above
  // what the search found, one invisible step at a time — which is the same failure
  // this pass exists to undo, wearing the other hat.
  let slack = KEEP_EPS;
  for (let pass = 0; pass < 3; pass++) {
    const candidates = out
      .map((p, i) => ({ i, d: Math.hypot(p.x - origin[i].x, p.z - origin[i].z) }))
      .filter((c) => m.ctx.movable[c.i] && displaced(origin[c.i], out[c.i]))
      .sort((a, b) => a.d - b.d);
    if (candidates.length === 0) break;
    let reverted = false;
    for (const { i } of candidates) {
      const keep = out[i];
      out[i] = { ...origin[i] };
      const trial = scoreLayout(m, out, weights);
      const spend = Math.max(0, trial - cost);
      if (spend <= slack) {
        slack -= spend;
        cost = trial;
        reverted = true;
      } else {
        out[i] = keep;
      }
    }
    if (!reverted) break;
  }
  return out;
}

/** What each surviving move bought, as the term that gained most by it.
 *
 *  Measured the only honest way: score the answer, then score it again with this one
 *  piece put back, and read off which term got worse. */
function explain(
  m: LayoutModel,
  origin: Placement[],
  placements: Placement[],
  weights: ScoreWeights,
  moved: number[],
  /** The grid the navigation term is scored on here, or null to leave it at zero.
   *
   *  It was always null, because `costBreakdown` defaults it off for the annealer's
   *  sake — so `c.navigation` was zero in both readings, its gain was zero for every
   *  move, and `'navigation'` could never be the term credited even after it was
   *  added to `TERMS`. The one pass that exists solely to open a route could not say
   *  that is what it did; its moves were credited to whichever taste term happened
   *  to shift. The caller passes a cell only when the layout it started from was
   *  actually cut — in a room with a route to everywhere, no move can be a
   *  route-opening one, so nobody pays for the distance transforms. */
  navCell: number | null,
): MoveReason[] {
  if (moved.length === 0) return [];
  const scratch = placements.map((p) => ({ ...p }));
  const here = costBreakdown(m, scratch, weights, navCell);
  const out: MoveReason[] = [];
  for (const i of moved) {
    const keep = scratch[i];
    scratch[i] = { ...origin[i] };
    const back = costBreakdown(m, scratch, weights, navCell);
    scratch[i] = keep;
    let term: keyof ScoreWeights = 'inertia';
    let best = -Infinity;
    for (const k of TERMS) {
      const gain = back[k] - here[k];
      if (gain > best) {
        best = gain;
        term = k;
      }
    }
    out.push({
      index: i,
      term,
      gain: back.total - here.total,
      distance: Math.hypot(placements[i].x - origin[i].x, placements[i].z - origin[i].z),
      turn: Math.abs(angleDelta(placements[i].yaw, origin[i].yaw)),
    });
  }
  return out;
}

/** The cost terms a move can be credited to. `inertia` is excluded on purpose: it
 *  measures the move itself, so it is always the term that got WORSE, and letting it
 *  win would have every explanation read "because it moved".
 *
 *  The ORDER is meaningful (it breaks ties in `explain`), so this stays a written
 *  list rather than `Object.keys` — but a written list beside a type is the pair
 *  CLAUDE.md warns about, and it has already drifted once in the direction nobody
 *  notices: `navigation` was missing, so the single most valuable thing a
 *  suggestion can do was always attributed to some other term and the sentence the
 *  user read named the wrong reason. `_NoUncreditedTerm` below closes that at
 *  COMPILE time — add a weight and `pnpm typecheck` names it. */
const TERMS = [
  'overlap',
  'outside',
  'door',
  // The term `openRoutes` exists to buy, and it was missing from this list — so the
  // single most valuable thing a suggestion can do (reconnect a stranded half of the
  // room) was always attributed to something else, and the sentence the user reads
  // named the wrong reason.
  'navigation',
  'access',
  'walkway',
  'window',
  'wall',
  'middle',
  'alignment',
  'relation',
  'balance',
] as const satisfies readonly (keyof ScoreWeights)[];

/** Every weight except `inertia` has to appear in `TERMS`.
 *
 *  `Exclude` leaves `never` when the list is complete, and `never` is the only
 *  thing that satisfies the constraint — so a new weight makes this line the error,
 *  by name, rather than making one sentence in the panel quietly wrong. */
type AssertNever<T extends never> = T;
type _NoUncreditedTerm = AssertNever<
  Exclude<Exclude<keyof ScoreWeights, 'inertia'>, (typeof TERMS)[number]>
>;

/** Keep the best few genuinely different candidates. "Different" is by the set of
 *  pieces that moved rather than by cost, so the finalists are alternative
 *  arrangements and not four rounding errors apart on the same one. */
function remember(pool: Array<{ placements: Placement[]; cost: number }>, placements: Placement[], cost: number): void {
  const snapshot = placements.map((p) => ({ ...p }));
  for (const c of pool) {
    if (similar(c.placements, snapshot)) {
      if (cost < c.cost) {
        c.cost = cost;
        c.placements = snapshot;
      }
      return;
    }
  }
  pool.push({ placements: snapshot, cost });
  pool.sort((a, z) => a.cost - z.cost);
  if (pool.length > FINALISTS) pool.length = FINALISTS;
}

function similar(a: Placement[], b: Placement[]): boolean {
  for (let i = 0; i < a.length; i++) {
    if (Math.hypot(a[i].x - b[i].x, a[i].z - b[i].z) > 0.25) return false;
  }
  return true;
}

/** Proposals the group pass gets, on top of the piece passes' `steps`.
 *
 *  Its own budget rather than a share of theirs, because the two do different jobs:
 *  a group move is basin-hopping — its whole value is crossing the ridge between two
 *  arrangements — and a piece move is settling, which is what most rooms need most of.
 *  Mixed into the same budget the first starves the second; see the pass itself.
 *
 *  Measured over **forty seeds**, on an open plan whose living and dining groups have
 *  been put in each other's halves, with the pass off and on:
 *
 *  | | off | on |
 *  |---|---|---|
 *  | T, median | 30.6 | **9.3** |
 *  | T, mean | 47.0 | 31.1 |
 *  | T, best | 8.9 | 0.6 |
 *  | open plan, mean | 19.3 | 16.9 |
 *  | solve | 218 / 87 ms | 233 / 105 ms |
 *
 *  Read the **median**. The T's mean is dominated by a handful of seeds that end with
 *  hard violations either way — its worst is 379.9 with the pass off — and choosing a
 *  budget on a statistic that noisy is fitting noise, which is how a weight ends up
 *  with no reason behind it. The median is stable at every budget from 120 up, and 300
 *  is about a fifth of the piece budget for a search space of a few groups × three move
 *  shapes.
 *
 *  The pass restarts `current` from `best`, so it cannot hand the piece passes a worse
 *  arrangement than it was given. What it does change is the RNG stream they then draw
 *  from, which is why an already-solved room measures ±10 % either way and neither
 *  direction means anything. */
const GROUP_STEPS = 300;

/** How near a relation has to be to its band before the pair count as one group.
 *
 *  A threshold and not merely "the relation exists" is the whole point: in a room
 *  someone has scrambled, nothing is grouped and the flat search does the work — which
 *  is measurably the right answer there, 363.7 → 6.8 across six seeds. Group moves are
 *  for carrying what is ALREADY right to where it belongs.
 *
 *  Authored in **metres out of band** and converted by the one function that owns that
 *  conversion, because the threshold is compared against `bandCost` output and so its
 *  meaning is a function of `bandCost`'s shape. It was the literal `0.25` with a comment
 *  reading *"squared metres of miss, so this is roughly half a metre out of band"* — true
 *  while the miss was `e²`, and silently false the moment it became `e + e²`, where 0.25
 *  is 207 mm. Nothing would have failed: half a metre of grouping tolerance would just
 *  have become a fifth, group moves would have stopped firing on rooms that are nearly
 *  right, and the only symptom is a search that got quietly worse. A constant whose unit
 *  is another function's return value has to be derived from that function. */
const GROUP_INTACT_M = 0.5;
const GROUP_INTACT = bandCost(GROUP_INTACT_M, 0, 0);

/** The groups this room actually contains: connected components of the satisfied
 *  relation edges, movable members only.
 *
 *  Movable-only matters and is not a technicality. A sofa `faces` its wall-mounted
 *  screen, so the screen would otherwise join the living group — and then a group move
 *  would try to drag a television off its wall, or (worse) be rejected for a reason
 *  that has nothing to do with the furniture. Leaving the screen out is also correct
 *  in substance: a fixed screen is exactly what should make a seating group reluctant
 *  to move, and it does that through the relation cost, from outside. */
function intactGroups(m: LayoutModel, placements: Placement[], movable: boolean[]): number[][] {
  const n = placements.length;
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = (x: number): number => {
    let r = x;
    while (parent[r] !== r) r = parent[r];
    while (parent[x] !== r) {
      const up = parent[x];
      parent[x] = r;
      x = up;
    }
    return r;
  };

  for (const e of relationParents(m, placements)) {
    if (e.cost > GROUP_INTACT) continue;
    if (!movable[e.child] || !movable[e.parent]) continue;
    const a = find(e.child);
    const bRoot = find(e.parent);
    if (a !== bRoot) parent[a] = bRoot;
  }

  const byRoot = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    if (!movable[i]) continue;
    const r = find(i);
    const g = byRoot.get(r);
    if (g) g.push(i);
    else byRoot.set(r, [i]);
  }
  // A group of one is just a piece, and the single-piece proposals already own it.
  return [...byRoot.values()].filter((g) => g.length >= 2);
}

/** Move a whole group at once, recording what it touched through `stash`.
 *
 *  Three shapes, and the first is the one part III exists for:
 *
 *   · **swap** two groups by their centroids — the move that gets a living group and a
 *     dining set out of each other's halves, and the one no sequence of single-piece
 *     moves can reach downhill;
 *   · **slide** a group bodily, which is how a group backs onto a different wall;
 *   · **turn** a group about its own centroid by a quarter or half turn, which is how
 *     a group that is in the right place but the wrong way round is put right.
 *
 *  Every one is RIGID: members keep their positions and headings relative to each
 *  other, so a group that was arranged stays arranged. That is the difference between
 *  this and the flat search finding its way back piece by piece — which it will not do,
 *  because the way back is uphill. */
function proposeGroup(
  current: Placement[],
  groups: number[][],
  reach: number,
  rng: () => number,
  stash: (k: number) => void,
): void {
  const pick = (n: number) => Math.floor(rng() * n) % n;
  const centre = (g: number[]): [number, number] => {
    let x = 0;
    let z = 0;
    for (const k of g) {
      x += current[k].x;
      z += current[k].z;
    }
    return [x / g.length, z / g.length];
  };
  /** Rigid transform about a pivot: `localToWorld` is the sanctioned rotation here,
   *  so the sign convention is three.js's and matches every other heading in the app. */
  const carry = (g: number[], pivot: [number, number], turn: number, dx: number, dz: number) => {
    for (const k of g) {
      stash(k);
      const p = current[k];
      const [ox, oz] = localToWorld(turn, p.x - pivot[0], p.z - pivot[1]);
      current[k] = {
        x: pivot[0] + ox + dx,
        z: pivot[1] + oz + dz,
        yaw: normaliseYaw(p.yaw + turn),
      };
    }
  };

  const a = groups[pick(groups.length)];
  const roll = rng();

  if (groups.length >= 2 && roll < 0.4) {
    let other = groups[pick(groups.length)];
    if (other === a) other = groups[(groups.indexOf(a) + 1) % groups.length];
    const ca = centre(a);
    const cb = centre(other);
    // Each group keeps its own heading and simply changes ends. Turning them as well
    // is a separate proposal; conflating the two makes a move that is nearly always
    // rejected for one of two unrelated reasons.
    carry(a, ca, 0, cb[0] - ca[0], cb[1] - ca[1]);
    carry(other, cb, 0, ca[0] - cb[0], ca[1] - cb[1]);
    return;
  }

  const c = centre(a);
  if (roll < 0.7) {
    carry(a, c, 0, (rng() * 2 - 1) * reach, (rng() * 2 - 1) * reach);
  } else {
    const turn = [Math.PI / 2, -Math.PI / 2, Math.PI][pick(3)];
    carry(a, c, turn, 0, 0);
  }
}

/** One candidate move. Turns are quarter-turn snapped most of the time, because a
 *  room of furniture at 7° is not what anyone means by a better arrangement, and
 *  letting the annealer discover that through the alignment cost alone wastes most
 *  of its budget. */
function propose(
  m: LayoutModel,
  current: Placement[],
  i: number,
  reach: number,
  rng: () => number,
  b: { minX: number; maxX: number; minZ: number; maxZ: number },
): Placement {
  const p = current[i];
  const part = m.ctx.parts[i];
  const roll = rng();

  // Back to the wall, front to the room — the single most common thing a person
  // does with a wardrobe, a bed or a sofa, and one the annealer would otherwise
  // have to discover a centimetre at a time.
  if (roll < 0.12) {
    const target = pickWall(m, current, i, rng);
    const snap = snapToWall([target[0], part.pos[1], target[1]], part.dimMM, m.ctx.footprint);
    return { x: snap.x, z: snap.z, yaw: normaliseYaw(snap.rot ?? p.yaw) };
  }

  // Park it next to whatever it belongs to. This is the relation table used as a
  // MOVE and not only as a cost: a nightstand can find the side of the bed in one
  // proposal instead of a few hundred.
  if (roll < 0.22) {
    const beside = pickPartner(m, current, i, rng);
    if (beside) return beside;
  }

  // Turn to face something worth facing.
  if (roll < 0.3 && m.profile.focals.length > 0) {
    const f = m.profile.focals[Math.floor(rng() * m.profile.focals.length) % m.profile.focals.length];
    if (f !== i) {
      return { ...p, yaw: normaliseYaw(Math.atan2(current[f].x - p.x, current[f].z - p.z)) };
    }
  }

  if (roll < 0.45) {
    // A quarter turn, REPLACING the current yaw rather than adding to it. The
    // adding version accumulated: a few thousand steps of "+n quarter turns" left
    // parts stored at 596 radians, which is geometrically the same angle and junk
    // in every readout that shows it.
    const q = Math.PI / 2;
    return { ...p, yaw: normaliseYaw(Math.round(p.yaw / q) * q + Math.floor(rng() * 4) * q) };
  }
  if (roll < 0.5) {
    // A small free turn, so a chair can end up angled toward a sofa.
    return { ...p, yaw: normaliseYaw(p.yaw + (rng() - 0.5) * 0.6) };
  }
  // Line up with a neighbour: share an edge or a centreline. Alignment is a term
  // in the score, and a move that satisfies it exactly costs one proposal instead
  // of a slow drift.
  if (roll < 0.6) {
    const j = pickNeighbour(m, current, i, rng);
    if (j >= 0) {
      return rng() < 0.5
        ? { ...p, x: current[j].x, yaw: normaliseYaw(current[j].yaw) }
        : { ...p, z: current[j].z, yaw: normaliseYaw(current[j].yaw) };
    }
  }
  // The last resort: nudge it. The bounding-box clamp is what keeps the nudge on the
  // floor, and a nudge that ends up in an L, T or U's NOTCH is DECLINED rather than
  // relocated. One that ends up pinned to a wall is kept exactly where it is. Those are
  // different outcomes and `pointInFootprint` alone cannot separate them — it is a ray
  // test, so a point exactly ON an edge reads as outside, and clamping to the bounding
  // box puts a point exactly there on every overshoot. `distanceToFootprintEdge` is what
  // tells the two apart.
  //
  // This used to call `clampIntoFootprint`, whose one destination is `interiorPoint`. On
  // a U the interior scan puts that in the base, so every nudge that fell in the notch —
  // a different offset each time, from a different piece — came back as the SAME spot,
  // and an annealer handed one location over and over takes it. Measured at U 6 × 5: six
  // movable pieces converging on one bay, and one solve seed in twelve leaving ~0.67 m²
  // of floor unreachable from the door. Declining costs nothing — a returned `p` is a
  // no-op the annealer evaluates and keeps, so the step is simply spent elsewhere.
  //
  // Why this surfaced only recently, which is the opposite of intuition. Before
  // `c4eee4d`, `clampIntoFootprint` walked toward `polygonCentroid` — the VERTEX
  // average, which on a U is in the void between the arms — and returned that point when
  // the walk never got inside. So the proposal came back OUTSIDE the room, `outside`
  // priced it at 1000 a unit, and the annealer discarded it. **The broken clamp was
  // acting as a filter**, and fixing it — correctly; the function now honours its name —
  // turned every discarded proposal into an attractive one. That is why a
  // clamp-correctness fix made arrangements worse, and why reverting `lib/footprint.ts`
  // alone took `tests/bed-rung-safety.test.ts` from 2 failed to 2 passed.
  //
  // Keeping the wall-pinned point is the second half of this and it is not cosmetic. The
  // old code walked such a point 15% of the way toward `interiorPoint` — on a 5 × 4 rect
  // that is 375 mm in from the east wall — so a nudge that overshot could not propose a
  // piece flush against the wall at all, which is exactly where a wardrobe wants to be.
  // It also means this change is NOT confined to the non-convex rooms it was written
  // for: a rectangle's footprint IS its bounding box, so every overshoot in every room
  // shape went through that walk. Anything that perturbs an RNG-driven layout perturbs
  // seed-specific fixtures with it, and re-deriving those is part of the change rather
  // than a surprise from it — see `DIAGONAL_ONLY` in `tests/suggest-tidiness.test.ts`,
  // which says so in its own prose and was re-searched here.
  //
  // Three alternatives, each refuted by measurement over the whole suite. The baseline
  // they were measured against was `5fd2dd2`, 3 failures.
  //
  //  1. Nearest-interior projection inside `clampIntoFootprint` — the minimum move that
  //     puts the point inside, so a piece stays in its own arm. Local, but not diverse:
  //     the shipped rung went from 80.70 total danger to 102.60 and the bed ladder lost
  //     monotonicity (Double 79.80 below Single 102.60).
  //  2. Declining on `!pointInFootprint` with the bounding box inset 1 mm. 2 failures —
  //     an inset perturbs every wall-pinned proposal without answering the question that
  //     matters, which is which side of the wall the point is on.
  //  3. Accepting the clamp unless it travelled further than `reach`. 6 failures:
  //     `reach` is largest while the anneal is hot, so the teleport is accepted exactly
  //     when it does the most damage.
  const jx = clamp(p.x + (rng() - 0.5) * 2 * reach, b.minX, b.maxX);
  const jz = clamp(p.z + (rng() - 0.5) * 2 * reach, b.minZ, b.maxZ);
  if (
    !pointInFootprint(jx, jz, m.ctx.footprint) &&
    distanceToFootprintEdge(jx, jz, m.ctx.footprint) > ON_WALL_M
  ) {
    return p;
  }
  return { ...p, x: jx, z: jz };
}

/** A point on some wall to snap toward — usually the nearest one, sometimes
 *  another, so the search can try the other side of the room. */
function pickWall(m: LayoutModel, current: Placement[], i: number, rng: () => number): [number, number] {
  const poly = m.ctx.footprint;
  if (rng() < 0.5) return [current[i].x, current[i].z];
  const e = Math.floor(rng() * poly.length) % poly.length;
  const a = poly[e];
  const c = poly[(e + 1) % poly.length];
  const t = 0.15 + rng() * 0.7;
  const mid: [number, number] = [a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t];
  // `m.winding` is what this computes when the argument is omitted, and this runs on
  // every wall proposal — see the field's own note.
  const near = nearestEdge(poly, mid[0], mid[1], m.winding);
  // Step in off the wall so `snapToWall` picks THAT edge rather than one the point
  // happens to sit on the outside of.
  return near ? [mid[0] + near.nx * 0.05, mid[1] + near.nz * 0.05] : mid;
}

/** Put `i` where its relation with something in the room wants it. */
function pickPartner(m: LayoutModel, current: Placement[], i: number, rng: () => number): Placement | null {
  const parts = m.ctx.parts;
  const options: number[] = [];
  for (let j = 0; j < parts.length; j++) {
    if (j !== i && relationFor(parts[i], parts[j])) options.push(j);
  }
  if (options.length === 0) return null;
  const j = options[Math.floor(rng() * options.length) % options.length];
  const rel = relationFor(parts[i], parts[j])!;
  const anchor = current[j];
  const gap = rel.min + rng() * Math.max(0.01, rel.max - rel.min);
  const selfHW = parts[i].dimMM[0] / 2000;
  const selfHD = parts[i].dimMM[1] / 2000;
  const anchorHW = parts[j].dimMM[0] / 2000;
  const anchorHD = parts[j].dimMM[1] / 2000;
  const c = Math.cos(anchor.yaw);
  const s = Math.sin(anchor.yaw);

  if (rel.kind === 'beside') {
    // Along the anchor's own side, at the head end — which is where a nightstand
    // goes and where a reading lamp goes.
    const side = rng() < 0.5 ? 1 : -1;
    const out = anchorHW + gap + selfHW;
    const along = -anchorHD * (0.35 + rng() * 0.5);
    return {
      x: anchor.x + side * out * c + along * s,
      z: anchor.z - side * out * s + along * c,
      yaw: normaliseYaw(anchor.yaw),
    };
  }
  if (rel.kind === 'in-front') {
    const out = anchorHD + gap + selfHD;
    const across = (rng() - 0.5) * anchorHW;
    return {
      x: anchor.x + out * s + across * c,
      z: anchor.z + out * c - across * s,
      // Facing back at it, which is what a chair at a table means.
      yaw: normaliseYaw(anchor.yaw + Math.PI),
    };
  }
  // 'faces' / 'near' — a centre distance and a heading, so put it on a ring.
  const d = rel.min + rng() * Math.max(0.01, rel.max - rel.min);
  const a = rng() * Math.PI * 2;
  const x = anchor.x + Math.sin(a) * d;
  const z = anchor.z + Math.cos(a) * d;
  // Same rule as `propose`'s nudge, and for the same reason. No bounding-box clamp feeds
  // this one — the point comes off a ring around the anchor — so the wall tolerance
  // should never be what decides anything here; it is applied anyway so the two proposal
  // paths cannot drift apart on what "outside the room" means.
  if (
    !pointInFootprint(x, z, m.ctx.footprint) &&
    distanceToFootprintEdge(x, z, m.ctx.footprint) > ON_WALL_M
  ) {
    return current[i];
  }
  return { x, z, yaw: normaliseYaw(Math.atan2(anchor.x - x, anchor.z - z)) };
}

/** The nearest movable neighbour, for an alignment move. */
function pickNeighbour(m: LayoutModel, current: Placement[], i: number, rng: () => number): number {
  let best = -1;
  let bestD = Infinity;
  for (let j = 0; j < current.length; j++) {
    if (j === i || m.ctx.parts[j].wallMounted) continue;
    const d = Math.hypot(current[j].x - current[i].x, current[j].z - current[i].z);
    if (d < bestD) {
      bestD = d;
      best = j;
    }
  }
  // Occasionally align with something further away, so a row of three can form.
  if (best >= 0 && rng() < 0.25) {
    const alt = Math.floor(rng() * current.length) % current.length;
    if (alt !== i && !m.ctx.parts[alt].wallMounted) return alt;
  }
  return best;
}

/** A piece worth swapping with: similar footprint area and the same broad role, so
 *  the swap is plausible rather than a bed changing places with a lamp. Swapping is
 *  how two pieces exchange corners in one move — annealing has to pass through the
 *  arrangement where they are both in the same place otherwise, and that costs
 *  1000. */
function pickSwap(m: LayoutModel, pool: number[], i: number, rng: () => number): number {
  const parts = m.ctx.parts;
  const area = (k: number) => (parts[k].dimMM[0] / 1000) * (parts[k].dimMM[1] / 1000);
  const mine = area(i);
  const options = pool.filter((j) => {
    if (j === i) return false;
    const a = area(j);
    return a > mine * 0.4 && a < mine * 2.5 && roleOf(parts[j]) !== roleOf(parts[i]);
  });
  if (options.length === 0) return -1;
  return options[Math.floor(rng() * options.length) % options.length];
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Fold a yaw into (−π, π]. Every proposal runs through this, so nothing the
 *  solver hands back can accumulate turns. */
function normaliseYaw(yaw: number): number {
  return angleDelta(yaw, 0);
}

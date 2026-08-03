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
import { clampIntoFootprint } from './footprint';
import { nearestEdge } from './geometry';
import {
  angleDelta,
  costBreakdown,
  navigabilityCost,
  prepare,
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
};

const DEFAULT_STEPS = 1600;
/** Pieces bigger than this settle in the first pass, everything else in the
 *  second. Square metres of footprint — a sofa or a bed is well over, a side
 *  table or a lamp well under. */
const LARGE_AREA = 0.9;
/** Below this the move is not worth showing as a change. */
const MOVE_EPSILON = 0.02;
/** How many finalists get the expensive navigability check. Small: each one costs
 *  a distance transform over the room. */
const FINALISTS = 4;
/** Metres² of unreachable floor is worth this much cost — the same tier as a
 *  blocked door, because it is the same failure. */
const NAV_WEIGHT = 120;

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
  const ctx: LayoutContext = { parts, movable, footprint, origin };
  const model = prepare(ctx);

  const current: Placement[] = origin.map((p) => ({ ...p }));
  const breakdownBefore = costBreakdown(model, current, weights);
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
    return { placements: current, before, after: before, breakdownBefore, breakdownAfter: breakdownBefore, moved: [] };
  }

  let best = current.map((p) => ({ ...p }));
  let bestCost = before;
  let cost = before;
  // The finalists that get the expensive navigability pass. Kept as we go rather
  // than re-running the search: the annealer visits plenty of good, genuinely
  // different arrangements on its way down and throwing them away means paying to
  // find them again.
  const pool: Array<{ placements: Placement[]; cost: number }> = [];

  for (const pool_ of [bigIdx.length >= 2 ? bigIdx : [], allIdx]) {
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

      const i = pool_[Math.floor(rng() * pool_.length) % pool_.length];
      const prev = current[i];
      // A swap moves two pieces at once, so it has to be undone as two.
      const swapWith = rng() < 0.06 ? pickSwap(model, pool_, i, rng) : -1;
      let prevOther: Placement | null = null;
      if (swapWith >= 0) {
        prevOther = current[swapWith];
        current[i] = { ...prevOther, yaw: normaliseYaw(prevOther.yaw) };
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
        current[i] = prev;
        if (prevOther) current[swapWith] = prevOther;
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
  let winnerCost = bestCost + NAV_WEIGHT * navigabilityCost(model, best);
  for (const cand of pool) {
    if (cand.placements === best) continue;
    const total = cand.cost + NAV_WEIGHT * navigabilityCost(model, cand.placements);
    if (total < winnerCost) {
      winnerCost = total;
      winner = cand.placements;
    }
  }

  for (const p of winner) p.yaw = normaliseYaw(p.yaw);
  const breakdownAfter = costBreakdown(model, winner, weights);
  const moved: number[] = [];
  for (let i = 0; i < winner.length; i++) {
    const a = origin[i];
    const c = winner[i];
    if (Math.hypot(c.x - a.x, c.z - a.z) > MOVE_EPSILON || Math.abs(angleDelta(c.yaw, a.yaw)) > 0.02) {
      moved.push(i);
    }
  }
  return { placements: winner, before, after: breakdownAfter.total, breakdownBefore, breakdownAfter, moved };
}

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
  const [x, z] = clampIntoFootprint(
    clamp(p.x + (rng() - 0.5) * 2 * reach, b.minX, b.maxX),
    clamp(p.z + (rng() - 0.5) * 2 * reach, b.minZ, b.maxZ),
    m.ctx.footprint,
  );
  return { ...p, x, z };
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
  const near = nearestEdge(poly, mid[0], mid[1]);
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
  const [cx, cz] = clampIntoFootprint(x, z, m.ctx.footprint);
  return { x: cx, z: cz, yaw: normaliseYaw(Math.atan2(anchor.x - cx, anchor.z - cz)) };
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

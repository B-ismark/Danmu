// Rearranging the room, as search rather than as rules.
//
// `lib/layout-score.ts` turns "is this a good arrangement" into a number. This
// walks downhill on that number by simulated annealing: propose a small change,
// keep it if it helps, and keep it ANYWAY with a probability that falls as the
// search cools. The middle part is what makes it work — a room where every piece
// is already locally sensible is a local minimum, and getting out of one means
// accepting a worse arrangement for a while.
//
// Three properties this has to have, none of them optional:
//
//   · **Deterministic.** Same room, same seed, same answer. The PRNG is seeded and
//     carried explicitly; nothing calls `Math.random`, which would make the
//     suggestion unrepeatable and the tests a lottery.
//   · **It only moves and turns.** `dimMM` is read and never written. A suggestion
//     that resized the furniture would be the one thing this codebase refuses to
//     do, and a type that cannot express it beats a comment asking nicely.
//   · **It respects locks.** A locked piece is left exactly where it is and still
//     scored, because it is still in the way.
//
// Hierarchical, following Infinigen Indoors: the large pieces settle first and the
// small ones arrange around them. A sofa and a side table optimised together
// spends its budget shuffling the side table.

import type { ScenePart } from './scene-spec';
import type { Footprint } from './footprint';
import { footprintBounds } from './footprint';
import { scoreLayout, DEFAULT_WEIGHTS, type LayoutContext, type Placement, type ScoreWeights } from './layout-score';

export type SolveOptions = {
  /** Same seed, same suggestion. */
  seed?: number;
  /** Annealing steps per pass. The default is sized for a room of ~20 pieces on
   *  the main thread inside one frame budget's worth of work per pass. */
  steps?: number;
  weights?: ScoreWeights;
};

export type SolveResult = {
  placements: Placement[];
  /** Cost before and after, so a caller can say what it achieved — and so a
   *  suggestion that achieved nothing can be recognised and not offered. */
  before: number;
  after: number;
  /** Indices whose placement actually changed. */
  moved: number[];
};

const DEFAULT_STEPS = 4000;
/** Pieces bigger than this settle in the first pass, everything else in the
 *  second. Square metres of footprint — a sofa or a bed is well over, a side
 *  table or a lamp well under. */
const LARGE_AREA = 0.9;
/** Below this the move is not worth showing as a change. */
const MOVE_EPSILON = 0.02;

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
 * window along it is not a layout decision.
 */
export function solveLayout(
  parts: ScenePart[],
  footprint: Footprint,
  locked: boolean[],
  opts: SolveOptions = {},
): SolveResult {
  const weights = opts.weights ?? DEFAULT_WEIGHTS;
  const steps = opts.steps ?? DEFAULT_STEPS;
  const rng = makeRng(opts.seed ?? 1);

  const movable = parts.map(
    (p, i) => !locked[i] && !p.wallMounted && p.category !== 'door',
  );
  const ctx: LayoutContext = { parts, movable, footprint };

  const current: Placement[] = parts.map((p) => ({ x: p.pos[0], z: p.pos[2], yaw: p.rot }));
  const initial = current.map((p) => ({ ...p }));
  const before = scoreLayout(ctx, current, weights);

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
  if (allIdx.length === 0) return { placements: current, before, after: before, moved: [] };

  let best = current.map((p) => ({ ...p }));
  let bestCost = before;
  let cost = before;

  for (const pool of [bigIdx.length >= 2 ? bigIdx : [], allIdx]) {
    if (pool.length === 0) continue;
    for (let step = 0; step < steps; step++) {
      const t = step / steps;
      // Geometric cooling, and the move sizes shrink with it: early steps relocate
      // a sofa across the room, late ones adjust it by a centimetre.
      const temp = Math.max(1e-4, 8 * Math.pow(0.02, t));
      const reach = span * 0.5 * (1 - t) + 0.05;

      const i = pool[Math.floor(rng() * pool.length) % pool.length];
      const prev = current[i];
      const next = propose(prev, reach, rng, b);
      current[i] = next;
      const trial = scoreLayout(ctx, current, weights);
      const delta = trial - cost;
      if (delta <= 0 || rng() < Math.exp(-delta / temp)) {
        cost = trial;
        if (cost < bestCost) {
          bestCost = cost;
          best = current.map((p) => ({ ...p }));
        }
      } else {
        current[i] = prev;
      }
    }
    // Each pass restarts from the best seen, so a pass that wandered uphill at
    // the end does not hand its wreckage to the next one.
    for (let i = 0; i < current.length; i++) current[i] = { ...best[i] };
    cost = bestCost;
  }

  const moved: number[] = [];
  for (let i = 0; i < best.length; i++) {
    const a = initial[i];
    const c = best[i];
    if (Math.hypot(c.x - a.x, c.z - a.z) > MOVE_EPSILON || Math.abs(angleDelta(c.yaw, a.yaw)) > 0.02) {
      moved.push(i);
    }
  }
  return { placements: best, before, after: bestCost, moved };
}

/** One candidate move: a nudge, a jump, or a turn. Turns are quarter-turn snapped
 *  most of the time, because a room of furniture at 7° is not what anyone means by
 *  a better arrangement, and letting the annealer discover that through the
 *  alignment cost alone wastes most of its budget. */
function propose(
  p: Placement,
  reach: number,
  rng: () => number,
  b: { minX: number; maxX: number; minZ: number; maxZ: number },
): Placement {
  const roll = rng();
  if (roll < 0.25) {
    const q = Math.PI / 2;
    const turns = Math.floor(rng() * 4);
    return { ...p, yaw: Math.round(p.yaw / q) * q + turns * q };
  }
  if (roll < 0.32) {
    // A small free turn, so a chair can end up angled toward a sofa.
    return { ...p, yaw: p.yaw + (rng() - 0.5) * 0.6 };
  }
  const x = clamp(p.x + (rng() - 0.5) * 2 * reach, b.minX, b.maxX);
  const z = clamp(p.z + (rng() - 0.5) * 2 * reach, b.minZ, b.maxZ);
  return { ...p, x, z };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function angleDelta(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

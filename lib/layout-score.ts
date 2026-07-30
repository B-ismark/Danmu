// What makes an arrangement good, written as arithmetic.
//
// `lib/clearance.ts` already knows what makes an arrangement *wrong*, and states
// it as a list of complaints. A solver cannot use complaints: it needs a number
// that gets smaller as the room gets better, including while it is still bad, so
// that a move which reduces a problem without fixing it is recognised as progress.
// This is those same rules restated as COSTS, plus the terms a checker has no
// reason to hold — alignment, balance, whether the seating faces anything.
//
// After Merrell et al., *Interactive Furniture Layout Using Interior Design
// Guidelines* (SIGGRAPH 2011), as pure optimisation. There is no model here and
// nothing is downloaded: the guidelines are the ones this codebase already
// encodes, and the weights are chosen so a hard violation always dominates a
// stylistic one.
//
// **It never reads or writes `dimMM`.** The solver moves and turns furniture; it
// does not resize it. That is what keeps this inside the trust boundary — a
// suggestion cannot change a measurement.

import type { ScenePart, Category } from './scene-spec';
import type { Footprint } from './footprint';
import { wallAffinity } from './physics';
import {
  footArea,
  footFromPart,
  footIntersectionArea,
  nearestEdge,
  obbGap,
  polyCentroid,
  type Foot,
  type Poly,
} from './geometry';

/** A part reduced to what the solver moves. Deliberately not a `ScenePart`: the
 *  dimensions are inputs, and a type that cannot express changing them is worth
 *  more than a comment saying not to. */
export type Placement = { x: number; z: number; yaw: number };

export type ScoreWeights = {
  overlap: number;
  outside: number;
  walkway: number;
  wall: number;
  middle: number;
  alignment: number;
  conversation: number;
  balance: number;
  front: number;
};

/** Weights are a hierarchy, not a mix. Two pieces in the same place is a fact
 *  about the room; a sofa at 7° to the wall is a matter of taste. Three orders of
 *  magnitude between them means no amount of taste can buy a collision. */
export const DEFAULT_WEIGHTS: ScoreWeights = {
  overlap: 1000,
  outside: 1000,
  walkway: 40,
  front: 30,
  wall: 12,
  middle: 6,
  alignment: 4,
  conversation: 6,
  balance: 2,
};

const MIN_WALKWAY = 0.6;
const MIN_FRONT = 0.6;

/** Bulky pieces whose gaps are the walkways people use — the same set
 *  `lib/clearance.ts` reports on, because a solver optimising a different rule
 *  from the one the room report checks would produce layouts that score well and
 *  then get complained about. */
const WALKWAY_CATEGORIES = new Set<Category>(['sofa', 'bed', 'wardrobe', 'shelf', 'fridge', 'desk']);
const FRONT_CATEGORIES = new Set<Category>(['wardrobe', 'fridge', 'shelf']);
/** Seating that wants to face something, and the things worth facing. */
const SEATING = new Set<Category>(['sofa', 'chair', 'ottoman']);
const FOCAL = new Set<Category>(['tv', 'table']);

/** Comfortable conversation / viewing range, metres. Outside it the grouping
 *  reads as two separate arrangements that happen to share a room. */
const TALK_MIN = 1.0;
const TALK_MAX = 3.2;

export type LayoutContext = {
  parts: ScenePart[];
  /** Index-aligned with `parts`; entries the solver may not move are still
   *  scored, because a locked piece is still in the way. */
  movable: boolean[];
  footprint: Footprint;
};

/** Total cost of an arrangement. Lower is better; zero is unreachable and not
 *  meant to be — the terms disagree with each other on purpose, which is what
 *  makes the minimum a compromise rather than a rule being followed. */
export function scoreLayout(
  ctx: LayoutContext,
  placements: Placement[],
  weights: ScoreWeights = DEFAULT_WEIGHTS,
): number {
  const poly = ctx.footprint as Poly;
  const feet: Foot[] = ctx.parts.map((p, i) =>
    footFromPart([placements[i].x, p.pos[1], placements[i].z], placements[i].yaw, p.dimMM, p.circle),
  );
  const blockers = ctx.parts.map(
    (p) => !p.wallMounted && p.category !== 'rug' && p.dimMM[2] > 250,
  );

  let cost = 0;

  // ── Hard: two pieces in the same place, or a piece outside the room ───────
  for (let i = 0; i < feet.length; i++) {
    if (!blockers[i]) continue;
    for (let j = i + 1; j < feet.length; j++) {
      if (!blockers[j]) continue;
      if (tucksUnder(ctx.parts[i], ctx.parts[j])) continue;
      const shared = footIntersectionArea(feet[i], feet[j]);
      if (shared > 0) cost += weights.overlap * (shared / Math.min(footArea(feet[i]), footArea(feet[j])));
    }
    cost += weights.outside * outsideShare(feet[i], poly);
  }

  // ── Circulation: gaps that are neither flush nor passable ─────────────────
  for (let i = 0; i < feet.length; i++) {
    if (!blockers[i] || !WALKWAY_CATEGORIES.has(ctx.parts[i].category)) continue;
    for (let j = i + 1; j < feet.length; j++) {
      if (!blockers[j] || !WALKWAY_CATEGORIES.has(ctx.parts[j].category)) continue;
      const gap = obbGap(feet[i], feet[j]);
      // A pinch is a gap someone would try to walk through and could not. Flush is
      // deliberate composition, and the cost has to go back to zero there or the
      // solver will pull everything apart to avoid a penalty it cannot escape.
      if (gap > 0.12 && gap < MIN_WALKWAY) cost += weights.walkway * (MIN_WALKWAY - gap);
    }
  }

  const [cx, cz] = polyCentroid(poly);
  let mass = 0;
  let mx = 0;
  let mz = 0;

  for (let i = 0; i < feet.length; i++) {
    const p = ctx.parts[i];
    if (p.wallMounted) continue;
    const f = feet[i];
    const edge = nearestEdge(poly, f.cx, f.cz);
    const affinity = wallAffinity(p.category);

    // ── Where a piece wants to be ──────────────────────────────────────────
    if (edge) {
      // Distance from the piece's BACK to the wall, not from its centre: a deep
      // wardrobe and a shallow shelf are both against the wall at very different
      // centre distances, and using the centre asks the wardrobe to bury itself.
      const back = edge.dist - halfDepthToward(f, edge.nx, edge.nz);
      if (affinity === 'must-wall' || affinity === 'prefers-wall') {
        cost += weights.wall * Math.max(0, back);
        // …and facing INTO the room, which is the other half of being against a
        // wall. A wardrobe with its doors in the plaster is flush and useless.
        cost += weights.alignment * angleCost(placements[i].yaw, edge.yaw);
      } else if (affinity === 'prefers-middle') {
        cost += weights.middle * Math.max(0, 1.2 - edge.dist);
      }
      // Everything rectilinear reads better square to SOMETHING. Quarter turns
      // only, so a chair turned to face a sofa is not fined for it.
      if (affinity === 'free') cost += weights.alignment * 0.4 * quarterTurnCost(placements[i].yaw, edge.yaw);
    }

    // ── Room to open the doors ─────────────────────────────────────────────
    if (FRONT_CATEGORIES.has(p.category)) {
      const others = feet.filter((_, j) => j !== i && blockers[j]);
      const clear = frontClearance(f, others, poly);
      if (clear < MIN_FRONT) cost += weights.front * (MIN_FRONT - clear);
    }

    const a = footArea(f);
    mass += a;
    mx += f.cx * a;
    mz += f.cz * a;
  }

  // ── Seating that faces something ─────────────────────────────────────────
  const focals = ctx.parts
    .map((p, i) => ({ p, f: feet[i] }))
    .filter(({ p }) => FOCAL.has(p.category));
  if (focals.length > 0) {
    for (let i = 0; i < feet.length; i++) {
      const p = ctx.parts[i];
      if (!SEATING.has(p.category) || p.wallMounted) continue;
      let best = Infinity;
      for (const t of focals) {
        const d = Math.hypot(t.f.cx - feet[i].cx, t.f.cz - feet[i].cz);
        // Distance band first, then whether the seat is turned toward it.
        const range = d < TALK_MIN ? TALK_MIN - d : d > TALK_MAX ? d - TALK_MAX : 0;
        const facing = angleCost(placements[i].yaw, Math.atan2(t.f.cx - feet[i].cx, t.f.cz - feet[i].cz));
        best = Math.min(best, range + facing);
      }
      if (best < Infinity) cost += weights.conversation * best;
    }
  }

  // ── Balance: the room's weight near its middle ───────────────────────────
  if (mass > 0) {
    cost += weights.balance * Math.hypot(mx / mass - cx, mz / mass - cz);
  }
  return cost;
}

/** Seating pushed under a work surface shares that footprint on purpose — the
 *  same exemption `lib/clearance.ts` makes, for the same reason. */
const TUCKS_UNDER = new Set<Category>(['chair', 'ottoman']);
const TUCKED_INTO = new Set<Category>(['table', 'desk']);
function tucksUnder(a: ScenePart, b: ScenePart): boolean {
  return (
    (TUCKS_UNDER.has(a.category) && TUCKED_INTO.has(b.category)) ||
    (TUCKS_UNDER.has(b.category) && TUCKED_INTO.has(a.category))
  );
}

/** Share of a footprint that falls outside the room, 0..1. Sampled on a coarse
 *  grid rather than clipped exactly: this runs tens of thousands of times inside
 *  the annealer, and the solver only needs to know which way is out. */
function outsideShare(f: Foot, poly: Poly): number {
  const N = 3;
  const c = Math.cos(f.rot);
  const s = Math.sin(f.rot);
  let out = 0;
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const lx = ((i + 0.5) / N - 0.5) * 2 * f.hw;
      const lz = ((j + 0.5) / N - 0.5) * 2 * f.hd;
      const x = f.cx + lx * c - lz * s;
      const z = f.cz + lx * s + lz * c;
      if (!pointInPolyLocal(x, z, poly)) out++;
    }
  }
  return out / (N * N);
}

function pointInPolyLocal(x: number, z: number, poly: Poly): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0];
    const zi = poly[i][1];
    const xj = poly[j][0];
    const zj = poly[j][1];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** How far the footprint reaches along a direction — the half-extent that has to
 *  be subtracted to turn a centre distance into a back-of-the-piece distance. */
function halfDepthToward(f: Foot, nx: number, nz: number): number {
  const c = Math.cos(f.rot);
  const s = Math.sin(f.rot);
  return Math.abs((c * nx + s * nz) * f.hw) + Math.abs((-s * nx + c * nz) * f.hd);
}

/** Smallest turn between two headings, normalised to 0..1 over a half turn. */
function angleCost(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return Math.abs(d) / Math.PI;
}

/** …and the same, but satisfied by any quarter turn. */
function quarterTurnCost(a: number, b: number): number {
  const q = Math.PI / 2;
  let d = (a - b) % q;
  if (d < 0) d += q;
  return Math.min(d, q - d) / (q / 2);
}

/** Clearance in front of a piece, measured along its own +Z. Cheap on purpose:
 *  three probes and a bounded march, because this is inside the annealer's loop
 *  and `faceClearance`'s exact ray/OBB pass is far more than the solver needs to
 *  know which direction is better. */
function frontClearance(self: Foot, others: Foot[], poly: Poly): number {
  const c = Math.cos(self.rot);
  const s = Math.sin(self.rot);
  const fx = -s;
  const fz = c;
  let best = 2;
  for (const u of [-0.7, 0, 0.7]) {
    const ax = self.cx + fx * self.hd + c * u * self.hw;
    const az = self.cz + fz * self.hd + s * u * self.hw;
    for (let t = 0.1; t <= 2; t += 0.1) {
      const x = ax + fx * t;
      const z = az + fz * t;
      if (!pointInPolyLocal(x, z, poly)) {
        best = Math.min(best, t);
        break;
      }
      let hit = false;
      for (const o of others) {
        if (o === self) continue;
        const dx = x - o.cx;
        const dz = z - o.cz;
        const oc = Math.cos(-o.rot);
        const os = Math.sin(-o.rot);
        if (Math.abs(dx * oc - dz * os) <= o.hw && Math.abs(dx * os + dz * oc) <= o.hd) {
          hit = true;
          break;
        }
      }
      if (hit) {
        best = Math.min(best, t);
        break;
      }
    }
  }
  return best;
}

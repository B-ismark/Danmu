// The last thing that runs before a scene is handed to the studio: nothing outside
// the room, nothing inside anything else.
//
// This is deliberately NOT the arrangement solver. `lib/layout-solve.ts` searches
// for a *good* layout and costs tens of thousands of evaluations; this repairs two
// specific facts about a layout and is a few hundred microseconds, because it runs
// on every room open — including from the store's synchronous initial state, where
// an annealer has no business being.
//
// Two failures, both of which shipped:
//
//   · **Outside the room.** Every seeded arrangement was authored against the
//     footprint's bounding box, so an L / T / U room placed furniture in the
//     quadrant its own walls cut away. Clamping the CENTRE was not enough either —
//     `buildSceneFromRoom` already did that, and a 2.2 m sofa whose centre is
//     150 mm inside the wall is still half in the garden.
//   · **Inside each other.** The detect → scene path does no part-vs-part
//     resolution at all, so two detections of the same sofa, or a wardrobe and a
//     bed the AI both put against the north wall, arrive interpenetrating.
//
// What it will NOT do: resize anything (that would be the one lie this codebase
// exists to avoid — a piece that does not fit keeps its size and `lib/clearance.ts`
// reports it), move a wall-mounted piece off its wall, or move a rug out from under
// the furniture it belongs under. And when a room is simply too full for a piece to
// go anywhere, it leaves that piece where it is rather than inventing a spot: the
// room report is the honest answer there, not a shuffle.

import type { Footprint } from './footprint';
import { polygonCentroid } from './footprint';
import {
  footArea,
  footFromPart,
  footInsidePoly,
  footIntersectionArea,
  footOverlap,
  nearestEdge,
  obbExtentAlong,
  outsideShare,
  pointInPoly,
  type Foot,
  type Poly,
} from './geometry';
import { isObstacle, roleOf, sharesFloor } from './layout-rules';
import type { ScenePart } from './scene-spec';

/** Breathing room kept off a wall, metres. Matches `snapToWall`'s inset so a piece
 *  this pushes off a wall and a piece the user snapped to one sit at the same
 *  distance from it. */
const WALL_GAP = 0.02;

/** Share of the smaller footprint two pieces may share before this pass treats them
 *  as touching and pushes them apart.
 *
 *  Deliberately NOT the bar `lib/clearance.ts` reports a collision at: that one is
 *  `CLASH_SHARE = 0.5` (and `TUCKED_CLASH_SHARE = 0.85` where two pieces legitimately
 *  share floor). This is a settle pass, so it wants the tight epsilon — the same
 *  order as that file's `SWING_CLASH_SHARE`, which exists so a millimetre of
 *  floating-point contact is not a finding.
 *
 *  Being stricter than the report is the safe direction: a scene this leaves alone
 *  is a scene the report is quiet about. It is not reversible, though — a piece the
 *  report would call "meeting untidily" at 30% shared footprint gets moved here, so
 *  do not read this number as what the room report considers a clash. Named for what
 *  it is to keep the two from being confused again; pairs that share floor by design
 *  are exempted by `sharesFloor` before this is consulted, not by the threshold. */
const TOUCH_SHARE = 0.02;

/** How far a piece may be pushed to get out of another's way. Beyond this the room
 *  has no space for it, and further searching is just moving the problem. */
const MAX_PUSH = 2.0;
const PUSH_STEP = 0.05;

/** Passes over the clashing pairs. Moving A off B can put A on C, so this iterates
 *  — but it is a repair, not a solver, and three passes either converge or prove the
 *  room is too full. */
const PASSES = 3;

export type SettleOptions = {
  /** Keep these part ids exactly where they are (the user's locked pieces, and
   *  anything a caller has already decided about). */
  frozen?: Set<string>;
};

/**
 * Pull every part inside the footprint and out of every other part.
 *
 * Returns a new array in the same order, with new `pos` tuples — the caller's parts
 * are not mutated. Only X and Z are ever touched: Y is gravity's answer and belongs
 * to the settle pass in `scene-spec`.
 */
export function settleParts(parts: ScenePart[], footprint: Footprint, opts: SettleOptions = {}): ScenePart[] {
  const poly = footprint as Poly;
  if (poly.length < 3) return parts;
  const frozen = opts.frozen ?? new Set<string>();
  const out = parts.map((p) => ({ ...p, pos: [...p.pos] as [number, number, number] }));
  const centre = polygonCentroid(footprint);

  const movable = out.map((p) => !p.wallMounted && !frozen.has(p.id));

  // ── Inside the room ───────────────────────────────────────────────────────
  for (let i = 0; i < out.length; i++) {
    if (!movable[i]) continue;
    contain(out[i], poly, centre);
  }

  // ── Out of each other ─────────────────────────────────────────────────────
  //
  // Biggest first, and the bigger of a clashing pair never moves: a room is read
  // from its large pieces outward, and a solve that lets a nightstand shove a bed
  // across the floor reads as damage. Same reason `layout-solve` settles the large
  // furniture in its first pass.
  const order = out
    .map((p, i) => ({ i, area: footArea(footOf(p)) }))
    .sort((a, b) => b.area - a.area || a.i - b.i)
    .map((e) => e.i);

  for (let pass = 0; pass < PASSES; pass++) {
    let touched = false;
    for (let a = 0; a < order.length; a++) {
      const anchor = order[a];
      if (!isObstacle(out[anchor])) continue;
      for (let b = a + 1; b < order.length; b++) {
        const mover = order[b];
        if (!movable[mover] || !isObstacle(out[mover])) continue;
        if (sharesFloor(roleOf(out[anchor]), roleOf(out[mover]))) continue;
        if (!clashes(out[anchor], out[mover])) continue;
        if (pushClear(out, mover, poly, centre)) touched = true;
      }
    }
    if (!touched) break;
  }

  return out;
}

/** Two pieces sharing more than a rounding error of floor. */
function clashes(a: ScenePart, b: ScenePart): boolean {
  const fa = footOf(a);
  const fb = footOf(b);
  if (!footOverlap(fa, fb, -0.01)) return false;
  const shared = footIntersectionArea(fa, fb);
  const smaller = Math.min(footArea(fa), footArea(fb));
  return smaller > 0 && shared / smaller > TOUCH_SHARE;
}

function footOf(p: ScenePart): Foot {
  return footFromPart(p.pos, p.rot, p.dimMM, p.circle);
}

function footAtXZ(p: ScenePart, x: number, z: number): Foot {
  return footFromPart([x, p.pos[1], z], p.rot, p.dimMM, p.circle);
}

/** Push a part until its whole footprint is inside the room.
 *
 *  Along the inward normal of the wall it is hanging over, by exactly the deficit —
 *  its own half-extent in that direction, minus how far in it already is. Repeated,
 *  because clearing the south wall in a corner leaves the east one, and each push
 *  changes which wall is nearest. Falls back to walking toward the centroid, and if
 *  even that cannot seat it (a piece longer than the room is wide), keeps the least
 *  bad position found and lets the room report say so. */
function contain(p: ScenePart, poly: Poly, centre: [number, number]): void {
  let x = p.pos[0];
  let z = p.pos[2];
  let bestOut = escape(p, x, z, poly);
  if (bestOut <= 0) return;
  let bestX = x;
  let bestZ = z;

  for (let k = 0; k < 6 && bestOut > 0; k++) {
    const e = nearestEdge(poly, x, z, centre);
    if (!e) break;
    const need = obbExtentAlong(footAtXZ(p, x, z), e.nx, e.nz) + WALL_GAP;
    // Inside the room: the deficit is what is missing. Outside it: the whole way
    // back in, plus the same deficit.
    const push = pointInPoly(x, z, poly) ? need - e.dist : need + e.dist;
    if (push <= 1e-4) break;
    x += e.nx * push;
    z += e.nz * push;
    const out = escape(p, x, z, poly);
    if (out < bestOut) {
      bestOut = out;
      bestX = x;
      bestZ = z;
    }
  }

  // Still hanging out — a corner, or a concave wall the normal pointed the wrong way
  // along. Walk in toward the middle, which any shape of room agrees is inward.
  for (let t = 0.1; t <= 1.0001 && bestOut > 0; t += 0.1) {
    const nx = p.pos[0] + (centre[0] - p.pos[0]) * t;
    const nz = p.pos[2] + (centre[1] - p.pos[2]) * t;
    const out = escape(p, nx, nz, poly);
    if (out < bestOut) {
      bestOut = out;
      bestX = nx;
      bestZ = nz;
    }
  }

  p.pos[0] = bestX;
  p.pos[2] = bestZ;
}

/** How badly a part placed here escapes the room: 0 only when the whole footprint
 *  is inside, corner-exact.
 *
 *  The sampled share alone was the acceptance test, and it stops at zero while a
 *  corner is still 20 mm through the wall — its outermost samples sit 10% in from
 *  the edges. So the exact test decides WHETHER a position is acceptable and the
 *  share only ranks the unacceptable ones, which is what a piece too big for the
 *  room needs: something to be least-bad about. */
function escape(p: ScenePart, x: number, z: number, poly: Poly): number {
  const f = footAtXZ(p, x, z);
  if (footInsidePoly(f, poly)) return 0;
  return Math.max(outsideShare(f, poly, 5), 1e-4);
}

/** Slide one part off everything it is inside, and keep it in the room.
 *
 *  Four directions — away from the room's middle, toward it, and both ways along
 *  the perpendicular — walked out in 50 mm steps, and the nearest position that is
 *  clear of every obstacle AND inside the footprint wins. The candidate set is what
 *  makes the answer stable: pushing along the line between two centres alone sends a
 *  sofa clipped by a bed's corner diagonally into the middle of the floor, where a
 *  200 mm slide along the wall was available. */
function pushClear(parts: ScenePart[], index: number, poly: Poly, centre: [number, number]): boolean {
  const p = parts[index];
  // Outward from the room's middle, so a piece that clashes near a wall is pushed
  // along it rather than into it.
  let ox = p.pos[0] - centre[0];
  let oz = p.pos[2] - centre[1];
  const len = Math.hypot(ox, oz);
  if (len < 1e-6) {
    ox = Math.sin(p.rot);
    oz = Math.cos(p.rot);
  } else {
    ox /= len;
    oz /= len;
  }
  const dirs: Array<[number, number]> = [
    [ox, oz],
    [-ox, -oz],
    [-oz, ox],
    [oz, -ox],
  ];

  for (let step = PUSH_STEP; step <= MAX_PUSH + 1e-9; step += PUSH_STEP) {
    for (const [dx, dz] of dirs) {
      const x = p.pos[0] + dx * step;
      const z = p.pos[2] + dz * step;
      if (escape(p, x, z, poly) > 0) continue;
      if (!clearOfAll(parts, index, x, z)) continue;
      p.pos[0] = x;
      p.pos[2] = z;
      return true;
    }
  }
  // Nowhere to go. Leaving it put is the honest outcome — `lib/clearance.ts` reports
  // the clash, and a piece teleported into the one free corner of a full room is a
  // worse answer than one that stayed where it was put.
  return false;
}

function clearOfAll(parts: ScenePart[], index: number, x: number, z: number): boolean {
  const p = parts[index];
  const me = footAtXZ(p, x, z);
  const myRole = roleOf(p);
  const myArea = footArea(me);
  for (let j = 0; j < parts.length; j++) {
    if (j === index) continue;
    const o = parts[j];
    if (!isObstacle(o)) continue;
    if (sharesFloor(myRole, roleOf(o))) continue;
    const fo = footOf(o);
    if (!footOverlap(me, fo, -0.01)) continue;
    const smaller = Math.min(myArea, footArea(fo));
    if (smaller > 0 && footIntersectionArea(me, fo) / smaller > TOUCH_SHARE) return false;
  }
  return true;
}

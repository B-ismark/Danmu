// How wide a piece may be made in THIS room.
//
// The user's ruling (2026-09-30), on the curtain that could be set to 4 m in a 3 m room
// and was then un-draggable everywhere: **"Don't allow if it's wider than the available
// space."** A wall piece's space is the wall it hangs on; anything else's is the room.
//
// Rule 2 is why this refuses rather than clamps. Typing 4 m and getting 2.95 m is a
// size silently resized to fit, which is the one thing that rule forbids; typing 4 m
// and being told "at most 2.95 m, that is the wall it hangs on" is a refusal that names
// its reason and its way out. So this module only MEASURES — the space, and whether a
// size exceeds it — and every caller refuses and says the sentence below.
//
// **The room bound is the same test the drag already makes**, on purpose. A floor
// piece's limit is `resolvePlacement`'s `roomIsWideEnough` (`lib/drag-resolve.ts`)
// solved for one axis: the piece's rotated extent against the room's bounds. That is a
// NECESSARY condition only — in an L the bounds are the outer walls, so a piece can
// pass here and still stick out of the arm it stands in — and it is used for exactly
// that reason: this answers "could this size stand anywhere in this room at all",
// which is a question about the room's reach, and the drag and Room check still judge
// where it actually stands. A stricter bound here would refuse sizes the drag accepts,
// which is two answers to one question.
//
// A wall piece's limit is the length of ITS wall — the one `snapToWall` keeps it on,
// found by heading rather than by nearest point, so a painting near a corner is
// measured against the wall it faces from and not the return wall its edge is close
// to. `snapToWall` centres a piece wider than its wall and lets both ends hang past the
// corners (it must not shrink it), and the drag then refuses it everywhere with "it is
// wider than that wall". That refusal was correct and arrived too late: the size had
// already been accepted. This moves it to the moment the size is chosen.
//
// Height is deliberately NOT bounded. A piece taller than the ceiling keeps its real
// height and `lib/clearance.ts` reports it (`tall`) — that is rule 2's own example.

import { footprintBounds, type Footprint } from './footprint';
import { edgeProjection, nearestEdge } from './geometry';
import { ridesWall } from './physics';
import { formatDimDown } from './units';
import type { DimUnit } from './store';
import type { Category, Shape } from './scene-spec';

/** What the piece is and where it stands — the fields the bound reads. */
export type SpacePiece = {
  category: Category;
  shape: Shape;
  pos: [number, number, number];
  rot: number;
  dimMM: [number, number, number];
};

/** The most one plan axis may be, and what sets it. */
export type SpaceLimit = {
  /** mm. `Infinity` when nothing in the room bounds this axis. */
  maxMM: number;
  /** `wall`: the length of the wall the piece hangs on. `room`: as far as the room
   *  reaches in that direction, at the piece's current angle. */
  why: 'wall' | 'room';
};

/** A size that asks for more than the room has, on one axis. */
export type SpaceRefusal = { axis: 0 | 1; limit: SpaceLimit; askedMM: number };

/** Headings within this of each other are the same wall (radians, ~1°). */
const SAME_HEADING = 0.02;

/** Float slack on a comparison in millimetres. Below anything a person types. */
const SLACK_MM = 0.5;

/** The wall a wall piece hangs on: the nearest edge whose inward heading is the
 *  piece's own, falling back to the nearest edge outright. Null for a degenerate
 *  footprint. Its length in mm. */
function wallLengthMM(piece: SpacePiece, footprint: Footprint): number | null {
  const [x, , z] = piece.pos;
  let best: { dist: number; index: number } | null = null;
  for (let i = 0; i < footprint.length; i++) {
    const hit = edgeProjection(footprint, i, x, z);
    if (!hit) continue;
    const d = Math.atan2(Math.sin(hit.yaw - piece.rot), Math.cos(hit.yaw - piece.rot));
    if (Math.abs(d) > SAME_HEADING) continue;
    if (!best || hit.dist < best.dist) best = { dist: hit.dist, index: i };
  }
  const index = best?.index ?? nearestEdge(footprint, x, z)?.index;
  if (index === undefined) return null;
  const a = footprint[index];
  const b = footprint[(index + 1) % footprint.length];
  return Math.hypot(b[0] - a[0], b[1] - a[1]) * 1000;
}

/** The largest value one plan axis can take with the other held, such that the
 *  piece's rotated extent still fits the room's bounds — `aabbExtents` against
 *  `footprintBounds`, the drag's `roomIsWideEnough`, solved for one side. */
function roomAxisMM(axis: 0 | 1, other: number, rot: number, footprint: Footprint): number {
  const b = footprintBounds(footprint);
  const bw = b.width * 1000;
  const bd = b.depth * 1000;
  const c = Math.abs(Math.cos(rot));
  const s = Math.abs(Math.sin(rot));
  // Width W with depth D:  W·c + D·s ≤ bw  and  W·s + D·c ≤ bd.
  // Depth D with width W:  W·c + D·s ≤ bw  and  W·s + D·c ≤ bd, solved for D.
  const [kx, kz, ox, oz] = axis === 0 ? [c, s, other * s, other * c] : [s, c, other * c, other * s];
  let max = Infinity;
  if (kx > 1e-9) max = Math.min(max, (bw - ox) / kx);
  if (kz > 1e-9) max = Math.min(max, (bd - oz) / kz);
  return Math.max(0, max);
}

/** How wide (axis 0) and how deep (axis 1) this piece may be here, given the size
 *  it is being asked to take. Each axis is bounded with the OTHER at `dimMM`'s value,
 *  because a turned piece's two sides share the room. */
export function spaceLimits(piece: SpacePiece, footprint: Footprint, dimMM = piece.dimMM): [SpaceLimit, SpaceLimit] {
  if (footprint.length < 3) return [{ maxMM: Infinity, why: 'room' }, { maxMM: Infinity, why: 'room' }];
  const width: SpaceLimit = { maxMM: roomAxisMM(0, dimMM[1], piece.rot, footprint), why: 'room' };
  const depth: SpaceLimit = { maxMM: roomAxisMM(1, dimMM[0], piece.rot, footprint), why: 'room' };
  if (ridesWall(piece.category, piece.shape)) {
    const wall = wallLengthMM(piece, footprint);
    if (wall !== null && wall <= width.maxMM) return [{ maxMM: wall, why: 'wall' }, depth];
  }
  return [width, depth];
}

/** Would `next` make the piece wider (or deeper) than the room has space for?
 *
 *  Only an axis that GROWS can be refused. A piece already over its space — a room
 *  file from elsewhere, a wall dragged in under a curtain — can still be edited on its
 *  other axes and shrunk on this one; refusing every edit to it would leave the user
 *  no way to fix the very thing being reported. */
export function refuseForSpace(
  piece: SpacePiece,
  next: [number, number, number],
  footprint: Footprint,
): SpaceRefusal | null {
  const limits = spaceLimits(piece, footprint, next);
  for (const axis of [0, 1] as const) {
    if (next[axis] <= piece.dimMM[axis] + SLACK_MM) continue;
    if (next[axis] > limits[axis].maxMM + SLACK_MM) return { axis, limit: limits[axis], askedMM: next[axis] };
  }
  return null;
}

/** Would a NEW piece, placed at `piece.pos`/`piece.rot`, already be wider than its
 *  space? For the add path, where there is no previous size to grow from. */
export function refuseNewForSpace(piece: SpacePiece, footprint: Footprint): SpaceRefusal | null {
  const limits = spaceLimits(piece, footprint);
  for (const axis of [0, 1] as const) {
    if (piece.dimMM[axis] > limits[axis].maxMM + SLACK_MM) {
      return { axis, limit: limits[axis], askedMM: piece.dimMM[axis] };
    }
  }
  return null;
}

/** The sentence a refusal says, in the user's own unit. The number is DERIVED from
 *  the limit and rounded DOWN, so "at most 2.95 m" is never a size that would itself
 *  be refused. */
export function describeSpaceRefusal(name: string, r: SpaceRefusal, unit: DimUnit): string {
  const side = r.axis === 0 ? 'wide' : 'deep';
  const most = `${formatDimDown(r.limit.maxMM, unit)} ${unit}`;
  const why =
    r.limit.why === 'wall' ? 'That is the whole length of the wall it hangs on.' : 'That is as far as the room reaches that way.';
  return `${name} can be at most ${most} ${side} here. ${why}`;
}

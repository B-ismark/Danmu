// Item-to-item magnetic snapping (Sims-style). While dragging, the moving
// part's axis-aligned extents are compared against every neighbour's: when an
// edge comes within SNAP_DIST of a neighbour's edge — or the centres nearly
// align — the position locks to flush/aligned and the match is reported so the
// UI can draw an alignment guide.
//
// Extents are the axis-aligned bounds of the rotated footprint, so 0/90°
// rotations (the overwhelmingly common case) snap exactly; odd angles snap via
// their bounding box, which still reads naturally.

import { aabbExtents } from './geometry';
import type { ScenePart } from './scene-spec';

/** How close an edge/centre must be (metres) before it magnetises. */
const SNAP_DIST = 0.1;
/** Neighbour must overlap (or nearly overlap) on the cross axis for an edge
 *  snap to make sense — snapping to something far across the room feels
 *  haunted. */
const CROSS_SLACK = 0.6;

export type SnapLine = {
  axis: 'x' | 'z';
  /** world coordinate of the alignment line on that axis */
  at: number;
  /** extent of the line along the other axis (for drawing) */
  span: [number, number];
  kind: 'edge' | 'center';
};

export type SnapResult = { x: number; z: number; lines: SnapLine[] };

// `aabbExtents` used to live here, and it is in `lib/geometry.ts` now: it is a
// rotation primitive, not a fact about magnetism, and three other files needed it.
// Two of them had written it out again — `lib/drag-resolve.ts` inline, and the add
// path in `lib/scene-spec.ts` not at all, which is how a bed came to be clamped by
// its width and then turned 90°.

/** A line the moving piece could be put on: where its centre would go, and the
 *  guide that says why. `into` is set on an edge-to-edge line whose neighbour is in
 *  the way of the moving piece, and is the direction that crosses into it. */
type Line = { target: number; line: SnapLine; into?: 1 | -1 };

/** One line a neighbour offers, before it is put on an axis. */
type Cand = { target: number; at: number; kind: SnapLine['kind']; into?: 1 | -1 };

/** Below this, two positions are the same place: float noise, not a step. */
const SAME_M = 1e-9;

/**
 * Every line a piece of this size at (x, z) could be pulled onto, per axis, in a
 * fixed order — for each neighbour, centre first and then the four edge pairings.
 * The two magnets below choose from the same lines; they differ only in which one
 * they take.
 */
function linesNear(
  x: number,
  z: number,
  rot: number,
  dimMM: [number, number, number],
  parts: ScenePart[],
  movingId: string,
  /** Whether a neighbour is in the way at all. Absent, none is: the drag magnet only
   *  pulls, and the collision test says what is in the way. */
  obstacle?: (o: ScenePart) => boolean,
): { xs: Line[]; zs: Line[] } {
  const { ex, ez } = aabbExtents(rot, dimMM);
  const xs: Line[] = [];
  const zs: Line[] = [];

  for (const o of parts) {
    if (o.id === movingId) continue;
    // Skipped as a snap TARGET. The reason used to read "wall snap owns those", which
    // is false for the ceiling family — `drag-resolve.ts` sends only `ridesWall` pieces
    // to `snapToWall`, so nothing owns a pendant. It is skipped because it is overhead:
    // aligning a sofa's edge to a fan 2.4 m above it is not a placement anyone wants.
    if (o.wallMounted) continue;
    const oe = aabbExtents(o.rot, o.dimMM);
    const ox = o.pos[0];
    const oz = o.pos[2];

    // Cross-axis proximity gates (expanded by slack so near-misses still snap).
    const overlapZ = Math.abs(z - oz) < ez + oe.ez + CROSS_SLACK;
    const overlapX = Math.abs(x - ox) < ex + oe.ex + CROSS_SLACK;

    // Whether the two really face each other across an edge-to-edge line, rather
    // than passing beside each other inside the slack.
    const inWay = obstacle?.(o) ?? false;
    const facesX = inWay && Math.abs(z - oz) < ez + oe.ez - SAME_M;
    const facesZ = inWay && Math.abs(x - ox) < ex + oe.ex - SAME_M;

    // Span of the guide line along the other axis — covers both parts.
    const spanZ: [number, number] = [Math.min(z - ez, oz - oe.ez), Math.max(z + ez, oz + oe.ez)];
    const spanX: [number, number] = [Math.min(x - ex, ox - oe.ex), Math.max(x + ex, ox + oe.ex)];

    if (overlapZ) {
      // X axis: centre alignment first (wins ties against coincident edge
      // candidates on equal-size parts), then edge-to-edge (flush).
      // `into` is the direction that crosses from that line into the neighbour: only the
      // two edge-to-edge pairings have one. Standing with my left edge on their right,
      // moving left goes into them.
      const xCands: Cand[] = [
        { target: ox, at: ox, kind: 'center' },
        { target: ox + oe.ex + ex, at: ox + oe.ex, kind: 'edge', into: -1 }, // my left edge on their right
        { target: ox - oe.ex - ex, at: ox - oe.ex, kind: 'edge', into: 1 }, // my right edge on their left
        { target: ox + oe.ex - ex, at: ox + oe.ex, kind: 'edge' }, // right edges flush
        { target: ox - oe.ex + ex, at: ox - oe.ex, kind: 'edge' }, // left edges flush
      ];
      for (const c of xCands) {
        xs.push({ target: c.target, line: { axis: 'x', at: c.at, span: spanZ, kind: c.kind }, into: facesX ? c.into : undefined });
      }
    }
    if (overlapX) {
      const zCands: Cand[] = [
        { target: oz, at: oz, kind: 'center' },
        { target: oz + oe.ez + ez, at: oz + oe.ez, kind: 'edge', into: -1 },
        { target: oz - oe.ez - ez, at: oz - oe.ez, kind: 'edge', into: 1 },
        { target: oz + oe.ez - ez, at: oz + oe.ez, kind: 'edge' },
        { target: oz - oe.ez + ez, at: oz - oe.ez, kind: 'edge' },
      ];
      for (const c of zCands) {
        zs.push({ target: c.target, line: { axis: 'z', at: c.at, span: spanX, kind: c.kind }, into: facesZ ? c.into : undefined });
      }
    }
  }
  return { xs, zs };
}

/** The line nearest `v`, inside `reach` of it. Strict, and the first of equals wins. */
function nearest(lines: Line[], v: number, reach: number): Line | null {
  let best: Line | null = null;
  let bestDist = Infinity;
  for (const l of lines) {
    const dist = Math.abs(v - l.target);
    if (dist < reach && dist < bestDist) {
      best = l;
      bestDist = dist;
    }
  }
  return best;
}

/**
 * Snap (x, z) against every other part. Returns the adjusted position plus the
 * alignment lines that fired (at most one per axis — the nearest).
 */
export function snapToNeighbors(
  x: number,
  z: number,
  rot: number,
  dimMM: [number, number, number],
  parts: ScenePart[],
  movingId: string,
  snapDist: number = SNAP_DIST,
): SnapResult {
  const { xs, zs } = linesNear(x, z, rot, dimMM, parts, movingId);
  const bestX = nearest(xs, x, snapDist);
  const bestZ = nearest(zs, z, snapDist);
  const lines: SnapLine[] = [];
  if (bestX) lines.push(bestX.line);
  if (bestZ) lines.push(bestZ.line);
  return { x: bestX ? bestX.target : x, z: bestZ ? bestZ.target : z, lines };
}

/**
 * The first line a step from `from` to `to` reaches on one axis, if it reaches one:
 * strictly past `from`, and no further than `to`.
 *
 * A neighbour's edge that the step crosses INTO it is the exception to "strictly":
 * standing on it counts, and the step ends where it starts. Without that, a piece flush
 * against a neighbour and pressed toward it took the step into it, and a Fine step is
 * exactly `collidesAt`'s 10 mm touching allowance, so whether the press was refused or
 * kept 10 mm in was decided by float noise.
 */
function firstAhead(lines: Line[], from: number, to: number): { target: number; line: SnapLine } | null {
  const travel = to - from;
  if (Math.abs(travel) <= SAME_M) return null;
  const dir = Math.sign(travel);
  const reach = Math.abs(travel) + SAME_M;
  let best: Line | null = null;
  let bestAhead = Infinity;
  for (const l of lines) {
    const ahead = (l.target - from) * dir;
    if (ahead > (l.into === dir ? -SAME_M : SAME_M) && ahead <= reach && ahead < bestAhead) {
      best = l;
      bestAhead = ahead;
    }
  }
  return best;
}

/**
 * The magnet for an arrow key. A press asks to go one step from `from` to (x, z),
 * and lands on the FIRST line it reaches on the way — a neighbour's edge or centre —
 * or at the end of the step if it reaches none.
 *
 * Not `snapToNeighbors` with a shorter reach, because the press has a direction and
 * that magnet does not. It pulls toward the nearest line on either side, 100 mm out,
 * which is farther than either step: a piece standing on a line was pulled back onto
 * it on every press, and a piece approaching one jumped the rest of the gap in one
 * press. Lines behind the piece, and the line it is standing on, are not ahead of it,
 * so a press can always leave one; a line inside the step is met rather than stepped
 * over, so a press can always land flush. And an axis the press does not move along
 * is not snapped at all — a press to the right does not also slide the piece
 * sideways onto a line.
 *
 * The grid is not a line here. A piece is off the grid whenever it stands flush with a
 * neighbour, since nothing puts a neighbour's edge on a mark, and the next mark is then
 * anywhere from a step to a hair away: measured over 2,000 random layouts, about half
 * the presses that stopped on one moved under 5 mm and some 0.1 mm, which reads as a
 * key that did nothing. Off the grid stays off it, as arrow keys do in drawing tools.
 *
 * `obstacle` says which neighbours are in the way, and a press toward one it is
 * touching does not move.
 */
export function snapAhead(
  from: readonly [number, number],
  x: number,
  z: number,
  rot: number,
  dimMM: [number, number, number],
  parts: ScenePart[],
  movingId: string,
  obstacle: (o: ScenePart) => boolean,
): SnapResult {
  const { xs, zs } = linesNear(x, z, rot, dimMM, parts, movingId, obstacle);
  const ax = firstAhead(xs, from[0], x);
  const az = firstAhead(zs, from[1], z);
  const lines: SnapLine[] = [];
  if (ax) lines.push(ax.line);
  if (az) lines.push(az.line);
  return { x: ax ? ax.target : x, z: az ? az.target : z, lines };
}

/** How far a guide runs past each end of the span it measures, in metres.
 *
 *  Not decoration: a line that stops exactly on the two edges it connects reads
 *  as part of the furniture rather than as a statement about it. */
export const GUIDE_OVERHANG_M = 0.15;

/**
 * The two world (x, z) ends of the line to draw for a snap.
 *
 * Here rather than in the renderer, beside the code that decided the snap. Both
 * tabs drew it once; the 3D view stopped (its drag reads as the translucent base
 * under the piece, not as lines — see `DragTag`) and the plan kept it. The mapping is easy to get wrong in
 * a way that looks plausible: for an `x`-axis line the constant is x and the span
 * runs along z, and reading it the other way round produces a guide at right
 * angles to the edge it is claiming to align, which is only obviously wrong if
 * you happen to be dragging along the other axis at the time.
 *
 * Same reason `lib/drag-resolve.ts` exists: this is one rule with two consumers.
 */
export function snapGuideEnds(
  line: SnapLine,
  overhang = GUIDE_OVERHANG_M,
): { from: [number, number]; to: [number, number] } {
  const lo = Math.min(line.span[0], line.span[1]) - overhang;
  const hi = Math.max(line.span[0], line.span[1]) + overhang;
  return line.axis === 'x'
    ? { from: [line.at, lo], to: [line.at, hi] }
    : { from: [lo, line.at], to: [hi, line.at] };
}

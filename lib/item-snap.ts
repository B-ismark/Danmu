// Item-to-item magnetic snapping (Sims-style). While dragging, the moving
// part's axis-aligned extents are compared against every neighbour's: when an
// edge comes within SNAP_DIST of a neighbour's edge — or the centres nearly
// align — the position locks to flush/aligned and the match is reported so the
// UI can draw an alignment guide.
//
// Extents are the axis-aligned bounds of the rotated footprint, so 0/90°
// rotations (the overwhelmingly common case) snap exactly; odd angles snap via
// their bounding box, which still reads naturally.

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

/** Half-extents of a part's rotated footprint along world X/Z. */
export function aabbExtents(rot: number, dimMM: [number, number, number]): { ex: number; ez: number } {
  const hw = dimMM[0] / 2000;
  const hd = dimMM[1] / 2000;
  const c = Math.abs(Math.cos(rot));
  const s = Math.abs(Math.sin(rot));
  return { ex: hw * c + hd * s, ez: hw * s + hd * c };
}

type Candidate = { target: number; dist: number; line: SnapLine };

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
  const { ex, ez } = aabbExtents(rot, dimMM);

  let bestX: Candidate | null = null;
  let bestZ: Candidate | null = null;

  for (const o of parts) {
    if (o.id === movingId) continue;
    if (o.wallMounted) continue; // wall snap owns those
    const oe = aabbExtents(o.rot, o.dimMM);
    const ox = o.pos[0];
    const oz = o.pos[2];

    // Cross-axis proximity gates (expanded by slack so near-misses still snap).
    const overlapZ = Math.abs(z - oz) < ez + oe.ez + CROSS_SLACK;
    const overlapX = Math.abs(x - ox) < ex + oe.ex + CROSS_SLACK;

    // Span of the guide line along the other axis — covers both parts.
    const spanZ: [number, number] = [Math.min(z - ez, oz - oe.ez), Math.max(z + ez, oz + oe.ez)];
    const spanX: [number, number] = [Math.min(x - ex, ox - oe.ex), Math.max(x + ex, ox + oe.ex)];

    if (overlapZ) {
      // X axis: centre alignment first (wins ties against coincident edge
      // candidates on equal-size parts), then edge-to-edge (flush).
      const xCands: Array<{ target: number; at: number; kind: SnapLine['kind'] }> = [
        { target: ox, at: ox, kind: 'center' },
        { target: ox + oe.ex + ex, at: ox + oe.ex, kind: 'edge' }, // my left edge on their right
        { target: ox - oe.ex - ex, at: ox - oe.ex, kind: 'edge' }, // my right edge on their left
        { target: ox + oe.ex - ex, at: ox + oe.ex, kind: 'edge' }, // right edges flush
        { target: ox - oe.ex + ex, at: ox - oe.ex, kind: 'edge' }, // left edges flush
      ];
      for (const c of xCands) {
        const dist = Math.abs(x - c.target);
        if (dist < snapDist && (!bestX || dist < bestX.dist)) {
          bestX = { target: c.target, dist, line: { axis: 'x', at: c.at, span: spanZ, kind: c.kind } };
        }
      }
    }
    if (overlapX) {
      const zCands: Array<{ target: number; at: number; kind: SnapLine['kind'] }> = [
        { target: oz, at: oz, kind: 'center' },
        { target: oz + oe.ez + ez, at: oz + oe.ez, kind: 'edge' },
        { target: oz - oe.ez - ez, at: oz - oe.ez, kind: 'edge' },
        { target: oz + oe.ez - ez, at: oz + oe.ez, kind: 'edge' },
        { target: oz - oe.ez + ez, at: oz - oe.ez, kind: 'edge' },
      ];
      for (const c of zCands) {
        const dist = Math.abs(z - c.target);
        if (dist < snapDist && (!bestZ || dist < bestZ.dist)) {
          bestZ = { target: c.target, dist, line: { axis: 'z', at: c.at, span: spanX, kind: c.kind } };
        }
      }
    }
  }

  const lines: SnapLine[] = [];
  if (bestX) lines.push(bestX.line);
  if (bestZ) lines.push(bestZ.line);
  return { x: bestX ? bestX.target : x, z: bestZ ? bestZ.target : z, lines };
}

/** How far a guide runs past each end of the span it measures, in metres.
 *
 *  Not decoration: a line that stops exactly on the two edges it connects reads
 *  as part of the furniture rather than as a statement about it. */
export const GUIDE_OVERHANG_M = 0.15;

/**
 * The two world (x, z) ends of the line to draw for a snap.
 *
 * Here rather than in either renderer because BOTH draw it — `MeasureGuides.tsx`
 * in 3D and `PlanView.tsx` in the plan — and the mapping is easy to get wrong in
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

// What a wall takes with it when it moves.
//
// Dragging a wall used to rewrite the footprint and nothing else, so the wall slid
// out from under everything standing on it: a sofa that was against the North wall
// ended up marooned a metre into the room, and — worse — a window kept its glass
// where it was while its HOLE jumped to whichever wall was now nearest, because
// `lib/apertures.ts` re-derives that per frame from `nearestEdge`. Anything mounted
// IN a wall has to move with it or the room is simply wrong.
//
// Pure: no store, no three, no React. The whole reason it lives here rather than
// inside the store action is that the interesting half is geometry with signs in
// it — which normal, which side, which edge — and that is testable in the node
// environment (`tests/wall-move.test.ts`).
//
// Two rules the rest of this file exists to keep:
//
//   · **Only the dragged wall's own pieces, only along its own normal.**
//     `offsetWall` TRANSLATES edge `index` and STRETCHES the two edges either side
//     of it. A piece against a stretched neighbour has not moved — its wall got
//     longer, it did not travel — so carrying it would drag half the room.
//   · **Never make containment worse.** A carried piece is dropped from the move
//     if the move would push it out of the room it was inside; it keeps its place
//     and `lib/clearance.ts` reports the wall now standing in it. Nothing is
//     resized to fit and nothing is silently shoved (CLAUDE.md rule 2) — and the
//     test is `footInsidePoly`, not `outsideShare`, whose probes sit 10% in from
//     the edges and forgive a piece 20 mm through the plaster (rule 3).

import { footFromPart, footInsidePoly, nearestEdge, obbExtentAlong, obbFromPart } from './geometry';
import { wallOutwardNormal, type Footprint } from './footprint';
import { WALL_ATTACH_TOL } from './layout-rules';
import { ridesWall } from './physics';
import type { ScenePart } from './scene-spec';

/** A carried piece's new position. `y` is never touched: moving a wall sideways
 *  changes nothing about how high anything sits. */
export type CarriedPos = { id: string; pos: [number, number, number] };

/**
 * Ids of the parts that belong to wall `index` and should travel with it.
 *
 * `parts` must be at their EFFECTIVE transforms (studio overrides merged in) —
 * attachment is decided from where a piece actually is, not where it was seeded.
 *
 * Two different tests, because there are two different kinds of attachment:
 *
 *   · **Mounted in the wall** (`wallMounted`: window, door, TV, mirror, curtain
 *     rod). Decided with `nearestEdge`, which is precisely the rule
 *     `lib/apertures.ts` uses to choose the wall a window cuts through. If these
 *     two tests could disagree, a carried window would leave its own hole behind.
 *   · **Standing against the wall** (floor furniture). Decided by the gap from the
 *     piece's near face to the wall plane, plus the requirement that it actually
 *     sits along THIS wall's span — in an L-shaped room a sofa in the far wing can
 *     be zero distance from this wall's infinite LINE while having nothing
 *     whatsoever to do with this wall.
 *
 * Locked pieces are carried like any other. A locked window is still a hole in a
 * wall; leaving it behind would put it in the void outside the room, which is not
 * a more faithful record of the photo than moving it.
 */
export function attachedToWall(
  parts: ScenePart[],
  poly: Footprint,
  index: number,
  tol = WALL_ATTACH_TOL,
): string[] {
  const n = poly.length;
  if (n < 3 || index < 0 || index >= n) return [];
  const a = poly[index];
  const b = poly[(index + 1) % n];
  const ex = b[0] - a[0];
  const ez = b[1] - a[1];
  const len = Math.hypot(ex, ez);
  if (len < 1e-6) return [];
  // Along the wall, and out of the room. Same normal `offsetWall` will use.
  const tx = ex / len;
  const tz = ez / len;
  const [ox, oz] = wallOutwardNormal(poly, index);
  const mx = (a[0] + b[0]) / 2;
  const mz = (a[1] + b[1]) / 2;

  const out: string[] = [];
  for (const p of parts) {
    const dx = p.pos[0] - mx;
    const dz = p.pos[2] - mz;
    // `ridesWall`, not `wallMounted`. This branch means "the piece IS part of this
    // wall", and it hands the question to `nearestEdge`, which always names some wall
    // — so a ceiling pendant 1.355 m clear of every wall in the room was claimed by
    // whichever edge happened to be nearest and carried 0.5 m sideways, off the table
    // it hangs over. A ceiling piece belongs to the room, not to an edge of it.
    if (ridesWall(p.category, p.shape)) {
      if (nearestEdge(poly, p.pos[0], p.pos[2])?.index === index) out.push(p.id);
      continue;
    }
    const obb = obbFromPart(p.pos, p.rot, p.dimMM);
    // Signed distance of the centre outward from the wall plane is negative inside
    // the room, so negate it to get "how far in", then take off the piece's own
    // half-extent in that direction to land on its near face. A negative gap means
    // the piece already overlaps the wall, which counts as attached.
    const gap = -(dx * ox + dz * oz) - obbExtentAlong(obb, ox, oz);
    if (gap > tol) continue;
    // Overlapping the wall's span, allowing for the piece's own width along it —
    // a bed with one corner past the end of a short wall is still on that wall.
    const along = Math.abs(dx * tx + dz * tz);
    if (along > len / 2 + obbExtentAlong(obb, tx, tz)) continue;
    out.push(p.id);
  }
  return out;
}

/**
 * New positions for the carried parts after wall `index` moved by `delta` along
 * `outward`.
 *
 * `ids` is resolved ONCE per gesture by `attachedToWall` and then reused for every
 * frame of the drag. That is not an optimisation: re-deciding attachment each
 * frame means a piece hovering at the tolerance boundary detaches mid-drag, stops
 * following, and never rejoins — the wall visibly abandons it halfway.
 *
 * `before` / `after` are the footprint either side of the move, because the
 * containment rule is comparative: a piece that was inside must stay inside, and a
 * piece that was already outside (a detection that landed through a wall) is not
 * held hostage to a test it was failing before anyone touched the wall.
 */
export function carryAttached(
  ids: string[],
  parts: ScenePart[],
  before: Footprint,
  after: Footprint,
  outward: [number, number],
  delta: number,
): CarriedPos[] {
  if (ids.length === 0 || delta === 0) return [];
  const wanted = new Set(ids);
  const [ox, oz] = outward;
  const out: CarriedPos[] = [];
  for (const p of parts) {
    if (!wanted.has(p.id)) continue;
    const pos: [number, number, number] = [p.pos[0] + ox * delta, p.pos[1], p.pos[2] + oz * delta];
    // A piece that rides the wall IS part of it: it goes where the wall goes, and its
    // footprint sits ON the boundary, where a containment test is a coin flip. That
    // exemption is for wall riders only — gating it on `wallMounted` skipped the
    // was-inside/now-inside check for the ceiling family too, so a pendant could be
    // carried straight out of the room with nothing testing whether it still fitted.
    if (!ridesWall(p.category, p.shape)) {
      const wasInside = footInsidePoly(footFromPart(p.pos, p.rot, p.dimMM, p.circle), before);
      const nowInside = footInsidePoly(footFromPart(pos, p.rot, p.dimMM, p.circle), after);
      if (wasInside && !nowInside) continue;
    }
    out.push({ id: p.id, pos });
  }
  return out;
}

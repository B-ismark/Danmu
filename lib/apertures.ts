// Where a window or a door actually cuts through a wall.
//
// A wall was one `planeGeometry` per footprint edge, and a window was a framed
// panel floating in front of it. That reads acceptably head-on and falls apart
// the moment anything depends on the opening being an opening: no light comes
// through it, nothing outside is visible through it, and a door reaching the
// floor still had skirting running across its threshold.
//
// This module turns wall-mounted `window` / `door` parts into rectangles in each
// wall's OWN 2D frame, which is all `THREE.Shape` needs to punch a hole
// (`Shape.holes` + Earcut — no CSG library involved). It is pure, so the maths
// that decides where the hole goes is testable without a renderer, which the
// wall-local coordinate conversion badly wants: getting the tangent direction
// backwards mirrors every opening about the middle of its wall, and that is a
// bug you can stare straight at without seeing.

import type { ScenePart } from './scene-spec';
import type { Footprint } from './footprint';
import { nearestEdge } from './geometry';

/** Shapes that are holes in a wall rather than objects hung on one. Private — the
 *  question callers actually ask is `isAperture`, below. */
const APERTURE_SHAPES: ReadonlySet<string> = new Set(['window', 'door']);

/** Is this part a hole in a wall rather than something hung on one?
 *
 *  A predicate rather than an exported list, because it has two consumers now and
 *  they must not be able to disagree. `wallApertures` uses it to cut the wall — and
 *  since the walls became shadow casters (`components/three/RoomShell.tsx`) that
 *  hole is the ONLY way the sun gets into the room. So the Style panel warns when a
 *  sun mood has nothing to shine through, and it has to be asking exactly the
 *  question the geometry answers: a warning derived from its own copy of the rule
 *  would eventually tell someone there is no window in a room that has one.
 *
 *  `wallMounted` is part of the test, not decoration. A door lying on the floor
 *  after a drag is not an opening, and the wall it is nearest has no hole in it. */
export function isAperture(p: { wallMounted?: boolean; shape: string }): boolean {
  return p.wallMounted === true && APERTURE_SHAPES.has(p.shape);
}

/** Keep an opening at least this far inside the wall outline, in metres.
 *
 *  Earcut is asked to triangulate an outline with a hole in it, and a hole whose
 *  edge is coincident with the outline is the degenerate case — a default door is
 *  exactly that, since it stands on the floor and the wall starts at the floor.
 *  The opening is clamped rather than the door: the part keeps its real size and
 *  renders at it, and what shrinks by 2 cm is the hole behind it. */
const MARGIN = 0.02;

/** An opening in one wall, in that wall's local frame: x across its length from
 *  the middle, y up from mid-height, matching how the wall mesh is built. */
export type Aperture = {
  partId: string;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  /** Height of the opening's bottom edge above the floor — the skirting needs it. */
  floorY: number;
};

/** Group the room's windows and doors by the wall they belong to.
 *
 *  A wall's local X axis is `(cos yaw, 0, -sin yaw)`: `wallSegments` gives `yaw`
 *  as the rotation that turns a plane's +Z to face into the room, and rotating
 *  local (1,0,0) by that yaw about Y lands there. Local Y is world Y less half
 *  the room height, because the wall mesh is centred at mid-height. */
export function wallApertures(
  parts: ScenePart[],
  footprint: Footprint,
  walls: Array<{ x: number; z: number; len: number; yaw: number }>,
  roomHeight: number,
): Map<number, Aperture[]> {
  const out = new Map<number, Aperture[]>();
  for (const p of parts) {
    if (!isAperture(p)) continue;
    const near = nearestEdge(footprint, p.pos[0], p.pos[2]);
    if (!near) continue;
    const wl = walls[near.index];
    if (!wl) continue;

    const c = Math.cos(wl.yaw);
    const s = Math.sin(wl.yaw);
    const u = (p.pos[0] - wl.x) * c - (p.pos[2] - wl.z) * s;
    // Wall-mounted parts are centre-anchored (see scene-spec's placement).
    const v = p.pos[1] - roomHeight / 2;
    const w = p.dimMM[0] / 1000;
    const h = p.dimMM[2] / 1000;

    const x0 = Math.max(-wl.len / 2 + MARGIN, u - w / 2);
    const x1 = Math.min(wl.len / 2 - MARGIN, u + w / 2);
    const y0 = Math.max(-roomHeight / 2 + MARGIN, v - h / 2);
    const y1 = Math.min(roomHeight / 2 - MARGIN, v + h / 2);
    // An opening smaller than this is not an opening — and a zero-area hole is a
    // triangulation failure rather than a subtle visual difference.
    if (x1 - x0 < 0.05 || y1 - y0 < 0.05) continue;

    const list = out.get(near.index);
    const a: Aperture = { partId: p.id, x0, x1, y0, y1, floorY: y0 + roomHeight / 2 };
    if (list) list.push(a);
    else out.set(near.index, [a]);
  }
  return out;
}

/** The stretches of one wall that still get skirting, as `[x0, x1]` pairs in the
 *  wall's local frame.
 *
 *  Skirting is not cut with a hole like the wall is: a door opening spans the
 *  whole 100 mm strip, so the "hole" would touch the outline top AND bottom and
 *  leave Earcut two degenerate slivers. Splitting the strip into the runs between
 *  openings is both simpler and exactly right. Only openings that reach down into
 *  the skirting interrupt it — a window at sill height does not. */
export function skirtingRuns(
  len: number,
  apertures: Aperture[],
  skirtingHeight: number,
): Array<[number, number]> {
  const cuts = apertures
    .filter((a) => a.floorY < skirtingHeight)
    .map((a) => [a.x0, a.x1] as [number, number])
    .sort((p, q) => p[0] - q[0]);
  const runs: Array<[number, number]> = [];
  let at = -len / 2;
  for (const [c0, c1] of cuts) {
    if (c0 > at) runs.push([at, c0]);
    at = Math.max(at, c1);
  }
  if (at < len / 2) runs.push([at, len / 2]);
  // Below a centimetre it is a rendering artefact, not a piece of skirting.
  return runs.filter(([a, b]) => b - a > 0.01);
}

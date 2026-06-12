// Gravity rules — what y a part anchors to when placed.
// All parts are positioned at their FLOOR ANCHOR (y=0 → base touches floor).
// Wall-mounted parts are positioned at their MESH CENTER (since their geometry
// is drawn around y=0 inside the group).

import type { Category, Shape } from './scene-spec';
import type { Footprint } from './footprint';
import { nearestEdge } from './geometry';

export type Anchor = 'floor' | 'ceiling' | 'wall-high' | 'wall-mid' | 'wall-low';

const ANCHOR_BY_CATEGORY: Partial<Record<Category, Anchor>> = {
  // ceiling
  fan: 'ceiling',
  // wall-high (near ceiling top)
  curtain: 'ceiling',
  // wall-mid (mounted at viewing height)
  tv: 'wall-mid',
  mirror: 'wall-mid',
  painting: 'wall-mid',
  ac: 'wall-high',
  // NOTE: a monitor is NOT wall-mounted — a desktop monitor rests on a desk.
  // Anchoring it wall-mid made added monitors float at 1.4 m ("hovering in the
  // sky") and snap back up on every drag. It's floor-anchored + tabletop-prone
  // (see isTabletopProne), so the settle pass / gizmo drop it onto the surface
  // below it. Wall-mounting a monitor is the exception, not the default.
  // floor by default for everything else
};

const ANCHOR_BY_SHAPE: Partial<Record<Shape, Anchor>> = {
  fan: 'ceiling',
  'lamp-pendant': 'ceiling',
  curtain: 'ceiling',
  tv: 'wall-mid',
  mirror: 'wall-mid',
  'mirror-oval': 'wall-mid',
  painting: 'wall-mid',
  'ac-unit': 'wall-high',
  window: 'wall-mid',
};

export function anchorFor(category: Category, shape: Shape): Anchor {
  return ANCHOR_BY_SHAPE[shape] ?? ANCHOR_BY_CATEGORY[category] ?? 'floor';
}

/** Required Y for a part given the room height. dimMM[2] is the part's height in mm. */
export function groundY(
  category: Category,
  shape: Shape,
  dimMM: [number, number, number],
  roomHeight: number,
): number {
  const anchor = anchorFor(category, shape);
  const h = dimMM[2] / 1000;
  switch (anchor) {
    case 'floor':
      return 0;
    case 'ceiling':
      // mesh-center model (fan, pendant) hung just below ceiling
      return Math.max(roomHeight - 0.15, h);
    case 'wall-high':
      // AC unit, curtain rod — top edge near ceiling
      return Math.min(roomHeight - h / 2 - 0.05, roomHeight - 0.1);
    case 'wall-mid':
      // TV, mirror, painting, monitor — eye level
      return Math.min(1.4, roomHeight - h / 2 - 0.1);
    case 'wall-low':
      return 0.4;
  }
}

/** True when a part can rest on the floor. False for wall-mounted / ceiling-mounted items. */
export function isFloorStanding(category: Category, shape: Shape): boolean {
  return anchorFor(category, shape) === 'floor';
}

// ─── Wall affinity ────────────────────────────────────────────────────────
// Some items only make sense against / near walls (doors, fridge, wardrobe,
// bookshelf, bed). Others want to be in the middle of the room (rugs, coffee
// tables, dining tables). The detection AI usually gets this wrong with
// "free" placement — these rules nudge each part to a sensible position.

export type WallAffinity =
  | 'must-wall'
  | 'prefers-wall'
  | 'prefers-middle'
  | 'free';

const WALL_AFFINITY_BY_CATEGORY: Partial<Record<Category, WallAffinity>> = {
  door: 'must-wall',
  curtain: 'must-wall',
  tv: 'must-wall',
  monitor: 'must-wall',
  mirror: 'must-wall',
  painting: 'must-wall',
  ac: 'must-wall',
  fridge: 'prefers-wall',
  wardrobe: 'prefers-wall',
  shelf: 'prefers-wall',
  bed: 'prefers-wall',
  nightstand: 'prefers-wall',
  desk: 'prefers-wall',
  sofa: 'prefers-wall',
  // mid-room defaults
  rug: 'prefers-middle',
  table: 'prefers-middle',
  plant: 'free',
  lamp: 'free',
  ottoman: 'free',
  chair: 'free',
};

export function wallAffinity(category: Category): WallAffinity {
  return WALL_AFFINITY_BY_CATEGORY[category] ?? 'free';
}

/** Snap an x/z position to the nearest wall (footprint edge) with the part's
 *  back flush against it and its front facing into the room. Edge-exact, so it
 *  works for L / T / U / custom rooms, not just the bounding rectangle.
 *  Returns adjusted [x, z] in metres + the facing yaw. */
export function snapToWall(
  pos: [number, number, number],
  dimMM: [number, number, number],
  footprint: Footprint,
): { x: number; z: number; rot?: number } {
  const edge = nearestEdge(footprint, pos[0], pos[2]);
  if (!edge) return { x: pos[0], z: pos[2] };
  const inset = dimMM[1] / 2000 + 0.02; // part depth/2 + wall gap
  return {
    x: edge.px + edge.nx * inset,
    z: edge.pz + edge.nz * inset,
    rot: edge.yaw,
  };
}

/** Categories / shapes that PREFER to rest on a piece of furniture if one exists
 *  under their XZ footprint (monitor on desk, laptop on desk, lamp on table,
 *  small painting can be wall-mid OR shelf-resting, etc). Used by the
 *  post-detection settle pass to recover from the AI putting them at wall-mid
 *  Y when there's clearly a table underneath. */
const TABLETOP_PRONE_CATEGORIES = new Set<Category>([
  'monitor',
  'lamp',
  'plant',
  'ottoman',
  'other',
]);

/** Highest world-Y where a part at (x,z) with given XZ footprint would land on
 *  another part's top surface. Wall-mounted + rugs are ignored as supports.
 *  Returns null if nothing is under the footprint. */
export function findSupportUnder(
  parts: Array<{
    id: string;
    pos: [number, number, number];
    dimMM: [number, number, number];
    category: Category;
    wallMounted?: boolean;
  }>,
  selfId: string,
  x: number,
  z: number,
  selfDim: [number, number, number],
): number | null {
  let best: number | null = null;
  for (const o of parts) {
    if (o.id === selfId) continue;
    if (o.wallMounted) continue;
    if (o.category === 'rug') continue;
    const ow = o.dimMM[0] / 1000;
    const od = o.dimMM[1] / 1000;
    const oh = o.dimMM[2] / 1000;
    const dx = x - o.pos[0];
    const dz = z - o.pos[2];
    // The mover's CENTRE must actually sit over the support's footprint —
    // a bounding-circle test let a part grab a *neighbour's* top (mid-air)
    // instead of dropping to the floor. Small margin only.
    if (Math.abs(dx) < ow / 2 + 0.05 && Math.abs(dz) < od / 2 + 0.05) {
      const top = o.pos[1] + oh;
      if (best === null || top > best) best = top;
    }
  }
  return best;
}

/** True if the category is likely to sit ON another piece of furniture rather
 *  than against a wall or on the floor. */
export function isTabletopProne(category: Category): boolean {
  return TABLETOP_PRONE_CATEGORIES.has(category);
}

/** Centroid pull — for prefers-middle items push slightly toward room center. */
export function pullToward(
  pos: [number, number, number],
  target: [number, number],
  strength: number,
): [number, number] {
  return [
    pos[0] + (target[0] - pos[0]) * strength,
    pos[2] + (target[1] - pos[2]) * strength,
  ];
}

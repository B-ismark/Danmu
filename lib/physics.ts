// Gravity rules — what y a part anchors to when placed.
// All parts are positioned at their FLOOR ANCHOR (y=0 → base touches floor).
// Wall-mounted parts are positioned at their MESH CENTER (since their geometry
// is drawn around y=0 inside the group).

import type { Category, Shape } from './scene-spec';
import type { Footprint } from './footprint';
import { edgeProjection, nearestEdge, footArea, footFromPart, footIntersectionArea, obbExtentAlong } from './geometry';
import { WALL_GAP } from './layout-rules';

export type Anchor = 'floor' | 'ceiling' | 'wall-high' | 'wall-mid' | 'wall-low' | 'wall-floor';

const ANCHOR_BY_CATEGORY: Partial<Record<Category, Anchor>> = {
  // ceiling
  fan: 'ceiling',
  // wall-high (near ceiling top). NOT 'ceiling': that branch hangs a small thing
  // just under the slab, which for a 2.6 m curtain put its CENTRE at 2.55 m and
  // most of the cloth through the ceiling. `scene-spec`'s dressing pass worked
  // around it by computing its own Y; the detection path did not, and got the
  // through-the-ceiling curtain.
  curtain: 'wall-high',
  // wall-mid (mounted at viewing height)
  tv: 'wall-mid',
  mirror: 'wall-mid',
  painting: 'wall-mid',
  ac: 'wall-high',
  // A door reaches the floor but is still a hole in a wall, so it is centred like
  // the rest of the wall-mounted family — see the 'wall-floor' note below.
  door: 'wall-floor',
  // NOTE: a monitor is NOT wall-mounted — a desktop monitor rests on a desk.
  // Anchoring it wall-mid made added monitors float at 1.4 m ("hovering in the
  // sky") and snap back up on every drag. It's floor-anchored + tabletop-prone
  // (see isTabletopProne), so the settle pass / gizmo drop it onto the surface
  // below it. Wall-mounting a monitor is the exception, not the default.
  // floor by default for everything else
};

const ANCHOR_BY_SHAPE: Partial<Record<Shape, Anchor>> = {
  door: 'wall-floor',
  fan: 'ceiling',
  'lamp-pendant': 'ceiling',
  curtain: 'wall-high',
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
    case 'wall-floor':
      // A door: centred like every other wall-mounted part, but standing ON the
      // floor rather than hung at a height. It has to be centred, because the
      // thing that reads its `pos[1]` is `wallApertures`, which cuts the hole in
      // the wall from the part's mesh centre — and it has to reach the floor,
      // because the alternative is a doorway with a step in it.
      //
      // Getting this wrong is not subtle and it shipped anyway, three different
      // ways at once: `room-openings.ts` seeded the centre (h/2) while `DoorGeo`
      // drew from the origin UPWARDS, so a seeded door floated a metre up the
      // wall above its own hole; `groundY` said 0 here, so a DETECTED door got a
      // hole half its height; and 'floor' made `isWallMountedPart` false, so a
      // door added from the catalog cut no hole at all. One convention, one bug
      // class gone.
      return h / 2;
  }
}

/** Clearance kept between a piece and the surfaces it is held between, so a
 *  clamped piece never renders coplanar with the plaster or the ceiling.
 *
 *  One number, and the count matters because the first version of this comment got
 *  it wrong. Four places clamp the same quantity the same way:
 *  `lib/drag-resolve.ts`'s vertical containment, the Inspector's typed mount
 *  height, `heightForNewCeiling` below, and `buildSceneFromRoom`'s settle pass in
 *  `lib/scene-spec.ts` — which was already spelling it `CEILING_PAD = 0.02` while
 *  this comment claimed a fourth copy "was about to" happen. A constant introduced
 *  to end a duplication, asserting it had, next to the duplicate: that is the
 *  shape of it, and the only reader who would ever have found out is whoever
 *  changed the number and wondered why detected fans hung differently from dragged
 *  ones.
 *
 *  `placeNewPart` deliberately does NOT use it — a door's canonical height IS h/2,
 *  and padding stood every door 2 cm off its own threshold. */
export const MOUNT_PAD = 0.02;

/** Where a piece's Y goes when the room's ceiling moves.
 *
 *  A ceiling height is not just a number on the room — `groundY` above derives
 *  half the scene's heights from it — and `setRoom` wrote a new one while
 *  re-grounding nothing. So a ceiling fan hung at the ceiling of a 1.75 m room
 *  stayed at 1.60 m when the room grew to 2.80 m, and was reported as "the fan is
 *  not attached to the ceiling". It is the same fan at the same height; the ceiling
 *  is what moved.
 *
 *  Which pieces follow is read off the anchor's own name rather than a list:
 *    • `ceiling` and `wall-high` are measured DOWN from the ceiling — a fan, a
 *      pendant, a curtain rod, an AC unit — so they travel with it and keep
 *      whatever offset below it they had.
 *    • `wall-mid` and `wall-low` are eye level and skirting level, measured UP from
 *      the floor, so raising a ceiling leaves a picture exactly where it hangs.
 *    • `floor` and `wall-floor` stand ON the floor and do not move at all. A piece
 *      that no longer fits under the new ceiling keeps its real size and its real
 *      place and `lib/clearance.ts` reports it — never silently shuffled or shrunk
 *      to suit the room.
 *  Everything centred is then clamped inside the new room, because following a
 *  ceiling downwards must not push a piece through the floor. A piece TALLER than
 *  the room lands at `h / 2 + MOUNT_PAD` and pokes through, which is the same
 *  answer the drag path gives and the same one the room report is written to
 *  explain. */
export function heightForNewCeiling(
  category: Category,
  shape: Shape,
  dimMM: [number, number, number],
  y: number,
  oldHeight: number,
  newHeight: number,
): number {
  const anchor = anchorFor(category, shape);
  if (anchor === 'floor' || anchor === 'wall-floor') return y;
  const h = dimMM[2] / 1000;
  const followsCeiling = anchor === 'ceiling' || anchor === 'wall-high';
  const next = followsCeiling ? y + (newHeight - oldHeight) : y;
  return Math.max(h / 2 + MOUNT_PAD, Math.min(newHeight - h / 2 - MOUNT_PAD, next));
}

/** True when a part can rest on the floor. False for wall-mounted / ceiling-mounted items. */
export function isFloorStanding(category: Category, shape: Shape): boolean {
  return anchorFor(category, shape) === 'floor';
}

/** How far a curtain hangs in FRONT of the window's front face.
 *
 *  Curtains sat at the window's exact x/z, so the cloth, the rod and the window's
 *  mullions were coplanar and z-fought — which reads as a rendering fault rather
 *  than as a curtain. It has to clear the window's frame and sill (both stand
 *  proud of the glass) and the pleats' own depth (they are rotated planes, so
 *  they have some). A real curtain rod does stand about a hand's width off the
 *  wall, so this is the honest figure, not a fudge to dodge the z-fight. */
export const CURTAIN_STANDOFF = 0.09;

/** Extra clearance in front of the wall for a part that hangs over ANOTHER wall
 *  part rather than against the plaster. Only a curtain does. Lives here so the
 *  seeded pair, the detection placement and every drag / snap answer with one
 *  number — the three of them disagreeing is what put the cloth inside the glass. */
export function wallStandoff(shape: Shape): number {
  return shape === 'curtain' ? CURTAIN_STANDOFF : 0;
}

/** True when a part belongs flat against a wall — the wall-* anchors, and only
 *  those. `isWallMountedPart` is the wider question ("is its geometry centred on
 *  the origin"), and answers yes for a ceiling fan and a pendant, which do NOT
 *  want to be slid onto the nearest wall. */
export function ridesWall(category: Category, shape: Shape): boolean {
  return anchorFor(category, shape).startsWith('wall-');
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
  /** Extra distance in front of the wall — see `wallStandoff`. */
  standoff = 0,
  /** Keep THIS footprint edge instead of taking the nearest — see
   *  `Convoy.leadEdge`. A piece free to choose its own wall flips to another the
   *  moment the pointer is nearer one, which is right on its own and wrong the
   *  instant anything is following it: the flip moves the piece a wall's width in
   *  one frame, and that jump becomes the delta the whole set translates by. A
   *  stale or degenerate index falls back to the nearest wall rather than
   *  refusing, because a footprint can change under a held index (a wall drag) and
   *  the nearest wall is never a wrong answer, only a less constrained one. */
  edgeIndex?: number | null,
  /** The rotation the caller is going to APPLY, when that is not the `rot`
   *  returned below.
   *
   *  The clamp needs the piece's extent ALONG the wall, and `dimMM[0] / 2` is that
   *  only because the returned `rot` turns the piece's local X to run along it. Two
   *  callers in `lib/scene-spec.ts` take the snapped x/z and keep the MODEL's yaw
   *  instead, so for them the premise is false: the piece was clamped by its width
   *  while lying at an arbitrary angle, held (width − depth) / 2 too far from the
   *  corner. Never outside the room — a wrong number rather than a wrong room, and
   *  therefore silent. A TV the detector reported edge-on to its wall was kept
   *  540 mm off the corner it belonged in.
   *
   *  An options object rather than a sixth positional: the tail is already
   *  `(standoff, edgeIndex)` and a place-counted sixth argument is the one that gets
   *  miscounted by whoever adds a seventh.
   *
   *  Given the yaw that will really apply, the extent is the piece's own OBB
   *  projected onto the wall direction — exact at any angle, and equal to
   *  `dimMM[0] / 2` at the wall's own heading, which the four-wall tests check
   *  rather than assume so that a convention error in the projection is a red. */
  opts: { alongRot?: number } = {},
): { x: number; z: number; rot?: number } {
  const edge =
    (edgeIndex == null ? null : edgeProjection(footprint, edgeIndex, pos[0], pos[2])) ??
    nearestEdge(footprint, pos[0], pos[2]);
  if (!edge) return { x: pos[0], z: pos[2] };
  // Part depth/2, plus the shared wall gap — the same figure the seeded arrangements
  // and the settle pass use, so all three put a back against a wall in one place.
  const inset = dimMM[1] / 2000 + WALL_GAP + standoff;
  // …and ALONG the wall, its own half-width, which nothing used to do.
  //
  // `edgeProjection` clamps its parameter to [0, 1], so the point it returns is the
  // closest point ON THE SEGMENT — and this function then put the piece's CENTRE
  // there. Aim past the end of a wall and the centre lands exactly on the corner
  // with half the piece through the return wall; reported as "sometimes the TV
  // sticks to the farthest edge of the wall it's on, sometimes there's a bit of a
  // gap between the TV and the other wall", which is one behaviour seen from two
  // corners. A 1.2 m TV aimed at the end of a 6 m wall came back with its centre on
  // the corner and 600 mm of it in the next room.
  //
  // The piece's local X runs along the wall, because the `rot` returned below turns
  // its front (+Z) to face the room — so `dimMM[0]` is the extent to keep inside
  // the segment, and `dimMM[1]` is the one the inset above already spent.
  //
  // Wider than the wall it is on: centre it. Clamping both ends against each other
  // would let the min beat the max and pin it to whichever end the arithmetic
  // reached last, and shrinking it is the thing rule 2 forbids — it keeps its real
  // size, and `lib/clearance.ts` is what says it does not fit.
  const a = footprint[edge.index];
  const b = footprint[(edge.index + 1) % footprint.length];
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  let px = edge.px;
  let pz = edge.pz;
  if (len > 1e-9) {
    const ux = (b[0] - a[0]) / len;
    const uz = (b[1] - a[1]) / len;
    const halfW = obbExtentAlong(
      { cx: 0, cz: 0, hw: dimMM[0] / 2000, hd: dimMM[1] / 2000, rot: opts.alongRot ?? edge.yaw },
      ux,
      uz,
    );
    // Distance from `a` along the wall. Taken from the projected point rather than
    // from `pos`, so a pointer out in the room is measured the same way as one
    // beyond the corner.
    const along = (edge.px - a[0]) * ux + (edge.pz - a[1]) * uz;
    const s = 2 * halfW >= len ? len / 2 : Math.max(halfW, Math.min(len - halfW, along));
    px = a[0] + ux * s;
    pz = a[1] + uz * s;
  }
  return {
    x: px + edge.nx * inset,
    z: pz + edge.nz * inset,
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

/** Share of the mover's own footprint that must rest on a surface before that
 *  surface counts as holding it up.
 *
 *  A rectangle is centrally symmetric, so any half-plane that excludes its centre
 *  covers less than half of it: requiring more than 50% inside the support
 *  therefore also guarantees the centre is inside, which is the physical test
 *  (centre of mass over the support) stated as an area. */
export const MIN_SUPPORT_SHARE = 0.5;

/** How far a part's Y may sit off a surface's top and still count as resting on
 *  it — generous enough for floating-point settle noise, tight enough that a part
 *  moved elsewhere and merely passing back over the old footprint at floor height
 *  doesn't re-qualify.
 *
 *  The vertical half of the same predicate `MIN_SUPPORT_SHARE` is the horizontal
 *  half of, which is why it lives beside it rather than in the one module that
 *  currently reads it (`lib/rigid-parent.ts`, where it was private). Anything
 *  asking "is this piece resting on that one" — the rigid-parent edge test, and
 *  any report of a piece left hanging in the air — has to agree on the answer, and
 *  a second literal is how two callers come to disagree about the same piece:
 *  under this tolerance a gap is settle noise and the piece IS supported, so a
 *  report using a threshold of its own could call something airborne while the
 *  drag code is still carrying it as a rigid child. */
export const SUPPORT_Y_EPS = 0.05;

/** Highest world-Y where a part at (x,z) with given XZ footprint would land on
 *  another part's top surface. Wall-mounted + rugs are ignored as supports.
 *  Returns null if nothing holds it up.
 *
 *  Tests how much of the mover ACTUALLY sits on the surface, not just where its
 *  centre point is. The centre test (plus a 5 cm margin) called a laptop 90%
 *  overhanging a desk "on the desk", and a part perched on the very lip of a
 *  nightstand floated at the nightstand's height with nothing under it.
 *
 *  `rot` on either side is optional and defaults to 0 — at 0/90° the rotated
 *  rectangle and its bounding box are the same, which is the overwhelmingly
 *  common case, so callers that have not got a rotation to hand lose nothing. */
export function findSupportUnder(
  parts: Array<{
    id: string;
    pos: [number, number, number];
    dimMM: [number, number, number];
    category: Category;
    rot?: number;
    wallMounted?: boolean;
    circle?: boolean;
  }>,
  selfId: string,
  x: number,
  z: number,
  selfDim: [number, number, number],
  selfRot = 0,
  selfCircle?: boolean,
): number | null {
  return findSupportDetailed(parts, selfId, x, z, selfDim, selfRot, selfCircle)?.y ?? null;
}

/** Same test as `findSupportUnder`, but also names which part won — the signal
 *  a rigid-parenting relationship is established from (see `lib/rigid-parent.ts`). */
export function findSupportDetailed(
  parts: Array<{
    id: string;
    pos: [number, number, number];
    dimMM: [number, number, number];
    category: Category;
    rot?: number;
    wallMounted?: boolean;
    circle?: boolean;
  }>,
  selfId: string,
  x: number,
  z: number,
  selfDim: [number, number, number],
  selfRot = 0,
  selfCircle?: boolean,
): { id: string; y: number } | null {
  const mover = footFromPart([x, 0, z], selfRot, selfDim, selfCircle);
  const moverArea = footArea(mover);
  // A footprint with no area has nothing to rest ON — no share of it can meet
  // the bar, and dividing by it would produce Infinity or NaN.
  if (!(moverArea > 0)) return null;

  let best: { id: string; y: number } | null = null;
  for (const o of parts) {
    if (o.id === selfId) continue;
    if (o.wallMounted) continue;
    if (o.category === 'rug') continue;
    const top = o.pos[1] + o.dimMM[2] / 1000;
    // Nothing lower than the best candidate can win — skip the area maths.
    if (best !== null && top <= best.y) continue;
    const shared = footIntersectionArea(mover, footFromPart(o.pos, o.rot ?? 0, o.dimMM, o.circle));
    if (shared / moverArea < MIN_SUPPORT_SHARE) continue;
    best = { id: o.id, y: top };
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

// Where a dragged piece actually ends up. One implementation, both surfaces.
//
// This used to live inside `components/three/Draggable.tsx`, which meant the 3D
// view resolved a drag through containment → wall snap → magnetic item snap →
// gravity/support → vertical clamp → exact OBB collision, while the 2D plan did
// `clamp into the bounding box` + `collidesAt` and nothing else. The same gesture
// on the same sofa therefore behaved differently depending on which tab you were
// looking at: in the plan the snap setting did nothing to a mouse drag, edges
// never went flush, and dragging a vase off the table it stood on left it
// floating at table height — invisible from directly above, which is the one view
// where you cannot see it.
//
// It is the same class of bug this codebase has already paid for twice, in
// `layout-rules` and in the clearance numbers: two consumers of one rule, each
// carrying its own copy. So a new snap, a new clearance, a new gravity rule goes
// HERE, and both surfaces get it.
//
// Deliberately pure and camera-free. The 3D view knows a live mount height off
// the object3D it is animating and the plan knows it off the stored transform, so
// that one value is passed in rather than reached for.

import { canCollideWith, collidesAt, type ScenePart } from './scene-spec';
import { partInsideRoom, pointInFootprint, footprintBounds } from './footprint';
import { aabbExtents, edgeProjection, footFromPart, footIsBox, frontVector, nearestEdge, TOUCH_M, yawOf, type Poly } from './geometry';
import { tuckedAt, tuckProfile } from './layout-rules';
import { SAME_TURN, snapAhead, snapToNeighbors, turnBetween, type SnapLine } from './item-snap';
import { findSupportDetailed, followsPointerUp, groundY, isFloorStanding, MOUNT_PAD, ridesWall, snapToWall, wallStandoff } from './physics';

export type SnapMode = 'off' | 'fine' | 'coarse';

/** Translation and rotation steps per snap mode. 'fine' is 10 mm / 15° — nudging
 *  distances; 'coarse' is 50 mm / 45°, which also lands cleanly on 90 / 135 / 180.
 *  Exported because the keyboard nudge, the gizmo and the plan's arrow keys must
 *  all step by the same amounts as the drag snaps to. */
export function snapSteps(mode: SnapMode): { translate: number | null; rotate: number | null } {
  if (mode === 'off') return { translate: null, rotate: null };
  if (mode === 'fine') return { translate: 0.01, rotate: Math.PI / 12 };
  return { translate: 0.05, rotate: Math.PI / 4 };
}

/** How much nearer the pointer must be to another wall before a wall piece leaves
 *  the one it is on — see the rider branch of `resolvePlacement`. About a hand's
 *  width: enough that pushing a piece past the end of its wall rests it in the
 *  corner, small enough that a pointer moved down the side wall takes it there. */
export const WALL_SWITCH_M = 0.3;

export type ResolveInput = {
  /** The piece being moved, at its authored identity — category, shape, circle. */
  part: ScenePart;
  /** Where the pointer is asking it to go, UNROUNDED. Quantising to the snap grid
   *  is this function's first step, so a caller must not pre-round: rounding in two
   *  places is how two surfaces drift apart over where the grid is. */
  rawX: number;
  rawZ: number;
  rot: number;
  dim: [number, number, number];
  /**
   * Every other piece, at its EFFECTIVE transform, with this piece's own rigid
   * descendants filtered out — a part must not resolve its gravity against a
   * child this same move is about to carry out from under it.
   *
   * `travellingWorld` (lib/drag-convoy.ts) is the only thing that builds this list,
   * and it is named here because the sentence above is not self-enforcing: both
   * surfaces once stopped honouring it and neither the compiler nor a test could
   * tell, since `findSupportDetailed` has no below-test and `collidesAt` returns
   * `false` for a mover it cannot find. A nightstand resolved onto the plant it was
   * carrying and became undraggable.
   */
  parts: ScenePart[];
  footprint: Poly;
  roomHeight: number;
  snapMode: SnapMode;
  /**
   * The mount height to preserve for a wall- or ceiling-mounted piece. The 3D view
   * reads it off the live object it is animating; the plan reads it off the stored
   * transform. Absent or non-positive falls back to the canonical height for the
   * shape, which is what a freshly added piece wants.
   */
  currentY?: number;
  /**
   * Where the pointer is asking a piece that follows it UP the wall to go, in
   * metres, UNROUNDED — the 3D drag across the wall's own plane (`lib/wall-drag.ts`).
   * Wins over `currentY` for those pieces and is ignored for every other one, so a
   * caller cannot lift a sofa or a door by passing it. Snapped here, on the piece's
   * bottom edge, for the same reason `rawX` is: one grid, one place.
   */
  rawY?: number;
  /**
   * The footprint edge a wall-riding piece must KEEP, rather than sliding onto
   * whichever wall is nearest. Set only while company is following it — see
   * `Convoy.leadEdge`, which is where the decision is made and where the reason
   * is written down.
   */
  wallEdge?: number | null;
  /**
   * Where a wall rider stands NOW and the angle it stands at, when the caller knows
   * and is resolving it at ANOTHER angle — a turn, from any surface. Its wall is
   * then the one its BACK is against, rather than the one nearest the clamp taken at
   * the new angle, which in a corner lies on the diagonal (see the rider branch).
   * The back and not the centre: a 400 × 200 mm curtain's centre is 0.20 m from the
   * return wall and 0.21 m from its own. A drag leaves it unset — there the angle is
   * the piece's live one — and so must not read `part.pos` instead, which in the 3D
   * tab is the AUTHORED position, not where the piece has been moved to.
   */
  standsAt?: { at: readonly [number, number, number]; rot: number };
  /**
   * Company this piece already overlapped when the gesture began, and whose overlap
   * the gesture therefore did not cause — a chair tucked under the table it is
   * travelling with. Not an obstacle for this resolve. Built by `planConvoy` and
   * nowhere else; see `ConvoyMember.inherited` for when it may be trusted.
   */
  inherited?: ReadonlySet<string>;
  /**
   * Set for an arrow key: where the piece stands, (x, z), before the press. The press
   * is one step from here to (`rawX`, `rawZ`), so the target is not put on the grid;
   * with the snap on, it stops on the first neighbour edge or centre it reaches
   * instead, never on one behind it, and does not move at all into a neighbour it
   * already touches and would collide with. See `snapAhead`, where the reasons are
   * written down. With the snap off it is exactly the step.
   */
  nudgeFrom?: readonly [number, number];
  /**
   * The pieces travelling with this one (`Convoy.travelling`). `parts` holds them
   * where they are going, so they keep their place relative to this piece and none
   * of their lines is one it can reach. Only an arrow key reads it: a press stopped
   * on one, and since the set moves together the next press stopped the same
   * distance short of it again — every press of a set whose pieces were a few
   * millimetres off lining up came up short.
   */
  company?: ReadonlySet<string>;
};

export type Resolved = {
  pos: [number, number, number];
  rot: number;
  /** In the room and clear of everything. False is not a refusal — the caller
   *  decides whether to slide, hold, or say so out loud. */
  valid: boolean;
  /** Alignment guides the magnetic snap produced, for whichever surface can draw
   *  them. */
  snapLines?: SnapLine[];
  /** What the piece came to rest ON, if anything. */
  supportId?: string;
  /** Why `valid` is false, for the surfaces that say it out loud. Undefined when
   *  `valid`.
   *
   *  This exists because deleting the wall-rider exemption (§ H.16) gave
   *  `valid: false` a **second cause** and both surfaces were hard-coding the
   *  sentence for the only one it used to have. Before that change a rider could
   *  fail only by colliding, so "something is in the way" was true by
   *  construction; after it, a 2.4 m curtain on a 2.1 m wall is refused in an
   *  empty room and told that something is in the way. A finding the caller drops
   *  is a finding that does not exist, and a finding the caller MISREPORTS is
   *  worse — it sends the user looking for an obstruction that is not there.
   *
   *  `'room'` beats `'blocked'` when both hold, because it is the one the user
   *  cannot solve by moving something else. */
  refusal?: Refusal;
};

/** Why a placement was refused. `'wall'` is the wall-rider case of `'room'` and is
 *  separate because the remedy differs: a rider is snapped flush to a wall, so its
 *  containment failure is always along-wall overhang — it is wider than that wall,
 *  and no amount of nudging fixes it. */
export type Refusal = 'wall' | 'room' | 'blocked';

/** The trailing clause a surface says when a move is refused. One derivation, three
 *  readers — the 3D drag, the plan drag and the plan's keyboard turn — because two
 *  of them were already carrying identical hand-written copies of the same sentence
 *  and that is the drift CLAUDE.md § 3 forbids. */
export function refusalCause(r: Pick<Resolved, 'refusal'>): string {
  if (r.refusal === 'wall') return 'it is wider than that wall.';
  if (r.refusal === 'room') return 'it would stick out of the room.';
  return 'something is in the way.';
}

/** The middle of a wall rider's back face, on the floor plane: the point that is
 *  against its wall whichever wall that is. Its centre is not — a curtain 200 mm
 *  deep flush in a corner has its centre nearer the return wall than its own, so
 *  "which wall is this on" asked of the centre names the wrong one. */
export function backOf(at: readonly [number, number, number], rot: number, dim: [number, number, number]): [number, number] {
  const [fx, fz] = frontVector(rot);
  const half = dim[1] / 2000;
  return [at[0] - fx * half, at[2] - fz * half];
}

/**
 * Which neighbours an arrow key stops at rather than steps into: the ones the collision
 * test's own pair rule says it could run into, at the height it stands now — and only
 * where both footprints are their boxes. The lines a press stops on are drawn from the
 * boxes, so where a box is not the outline they are alignments and not contacts: a
 * sofa at 45°, a round table and an L-desk reach their box at a corner or not at all,
 * and stopping there told a crate with clear floor ahead that it could go no further.
 *
 * Nor is a seat going under the surface it tucks under, front first: the collision test
 * forgives that pair (§ 17), so a drag slides the chair in and a press stopped it at the
 * table's edge. Asked as `collidesAt` asks it, `tuckedAt`, with the piece a touching
 * allowance past the step — `from` to `to` — where a back that leads has gone in.
 */
function pressObstacle(
  part: ScenePart,
  rot: number,
  dim: [number, number, number],
  y: number,
  from: readonly [number, number],
  to: readonly [number, number],
): (o: ScenePart) => boolean {
  if (!footIsBox(rot, dim, part.circle, part.shape)) return () => false;
  const inTheWay = canCollideWith(part, dim, y);
  const len = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const k = len > 0 ? (len + TOUCH_M) / len : 0;
  const past = footFromPart([from[0] + (to[0] - from[0]) * k, y, from[1] + (to[1] - from[1]) * k], rot, dim, part.circle, part.shape);
  const mine = tuckProfile({ ...part, dimMM: dim });
  return (o) =>
    footIsBox(o.rot, o.dimMM, o.circle, o.shape) &&
    inTheWay(o) &&
    !tuckedAt(mine, past, tuckProfile(o), footFromPart(o.pos, o.rot, o.dimMM, o.circle, o.shape));
}

/**
 * The deterministic placement pipeline. Order matters and each step feeds the
 * next: grid snap → containment → wall snap OR magnetic item snap →
 * gravity/support → vertical clamp → legality.
 */
export function resolvePlacement(input: ResolveInput): Resolved {
  const { part, rawX, rawZ, rot, dim, parts, footprint, roomHeight, snapMode } = input;

  // Snap the RAW target onto the grid, before anything else touches it. First
  // because everything downstream is a correction — a clamp, a wall, a neighbour —
  // and a correction must not then be re-rounded off the very thing it corrected
  // to.
  //
  // This step used to live in `Draggable`'s pointer-move handler and did NOT come
  // along when the pipeline moved out of the component, so the 2D plan's mouse drag
  // ignored the snap setting outright while the 3D tab's honoured it: exactly the
  // "two consumers, one rule" split this module exists to close, reopened by the
  // move that closed it. It lives here now, and both surfaces read it from one
  // place.
  //
  // The magnetic item snap below may pull a piece straight back off the grid, and
  // should: flush against a real neighbour beats aligned to an arbitrary lattice.
  //
  // A key press is not rounded here. It is a step from where the piece stands, so an
  // off-grid piece keeps its offset (`snapAhead` says why), and the shorter step a
  // selection settles on when a member runs out of room (`settleLead`) is not a whole
  // step: rounded, it put the piece straight back where it started.
  const grid = snapSteps(snapMode).translate;
  const nudgeFrom = input.nudgeFrom;
  const gx = grid && !nudgeFrom ? Math.round(rawX / grid) * grid : rawX;
  const gz = grid && !nudgeFrom ? Math.round(rawZ / grid) * grid : rawZ;

  // Containment clamp — keep the whole rotated footprint inside the room's
  // bounding box. Footprints can be off-centre after independent wall moves, so
  // this reads the bounds rather than assuming ±width/2.
  // `aabbExtents`, not four lines of the same arithmetic: this file had its own copy
  // and `placeNewPart` had none at all, which is how a bed came to be clamped by its
  // half-WIDTH and then turned 90 degrees to face its wall. See lib/geometry.ts.
  const { ex: extX, ez: extZ } = aabbExtents(rot, dim);
  const bnd = footprintBounds(footprint);
  let x = Math.max(bnd.minX + extX, Math.min(bnd.maxX - extX, gx));
  let z = Math.max(bnd.minZ + extZ, Math.min(bnd.maxZ - extZ, gz));
  // Did the clamp MOVE it, rather than merely agree with it? That is the whole
  // question for a rug — see the legality test below. Taken here, before the wall
  // and neighbour snaps overwrite x/z with answers of their own.
  const shovedIntoRoom = x !== gx || z !== gz;
  let outRot = rot;
  let snapLines: SnapLine[] | undefined;

  // Wall-mounted items (TV, mirror, painting, AC, curtain) ride the NEAREST wall —
  // edge-exact against the footprint polygon, so they slide along an L/T/U's inner
  // walls too, always facing into the room.
  //
  // `ridesWall`, NOT `isWallMountedPart`. The two differ by exactly the ceiling
  // family — a fan, a pendant — and `isWallMountedPart` is the wider question
  // ("is this piece's geometry centred on its origin?"), which is the right one for
  // deciding how to GROUND a piece and the wrong one for deciding to slide it onto
  // the plaster. `physics.ts` has said so in `ridesWall`'s own doc comment since
  // the day it was written, and this file asked the other question anyway: a ceiling
  // fan dragged anywhere in the room was pushed to the nearest wall and, back when
  // the legality test below carried a blanket wall-rider exemption, excused the
  // containment check on the way. Reported as "it only sticks to the edges" and
  // "it spawned outside the room". Only the first half is still reachable: that
  // exemption is gone, so a mis-classified piece now gets the wrong SNAP but not a
  // free pass through the wall.
  const ridesAWall = ridesWall(part.category, part.shape);
  if (ridesAWall) {
    // From the RAW point, not the clamped one. The clamp above is measured at the
    // piece's CURRENT angle, which for a rider is the old wall's, and it decides
    // which wall is nearest before the wall is chosen: a 5 m curtain on a 6 m wall
    // is held to x ∈ [−0.5, 0.5], so a pointer on the 4 m side wall at x = −3 was
    // pulled back to −0.5, from where the side wall is never the nearest — and a
    // step toward the camera then put it on the near wall, which the dollhouse cuts
    // away. Reported 2026-09-30 as a curtain that disappeared. `snapToWall` slides
    // the piece along whichever wall it picks on its own, so the old-angle clamp
    // bought nothing here but the wrong wall.
    //
    // Held to the room's BOX, not the box inset by the piece, so a pointer off the
    // edge of the room still asks from the room's edge. Measured over the
    // containment sweep (`tests/wall-rider-containment.test.ts`) against the old
    // clamp, with the switching margin below, it accepts 96 placements that were
    // refused and refuses 44 that were accepted: net curtain +40, window +19,
    // painting −3, TV −4. Every one of the 44 is a piece wider than the wall now
    // chosen — 42 with the pointer OUTSIDE an L, T or U, where the wall nearest the
    // hand is a stub, and two with it inside and nearer a wall shorter than the
    // curtain. They are refused as "wider than that wall", which is true of the wall
    // the hand is at; the old clamp dragged the pointer back until a longer wall
    // happened to be nearer.
    //
    // **…but only once the hand is CLEARLY at the other wall** (`WALL_SWITCH_M`).
    // Nearest-wall-wins from the pointer alone flips a piece round the corner the
    // moment it is pushed past the end of its own wall: a 1.2 m TV at the north
    // wall's west end, pushed on, has its pointer 0.05 m from the north wall and
    // 0 m from the west one, and turned the corner where the old clamp had it rest
    // in the corner (found in review, 2026-09-30). So the old answer stands unless
    // the pointer is nearer another wall by a margin; the curtain's case — the
    // pointer well down the side wall — clears it by metres.
    //
    // On a TURN "the old answer" is the wall the piece stands on (`standsAt`), not the
    // wall nearest the clamped point. The clamp is taken at the REQUESTED angle, and a
    // turn requests another wall's angle: a 500 mm painting flush in a corner, turned,
    // was clamped onto the corner's diagonal, where both walls are equally near, the
    // tie picked the other wall, and the margin then held it there — a turn that moved
    // the painting round the corner (found in review, 2026-10-01).
    const ax = Math.max(bnd.minX, Math.min(bnd.maxX, gx));
    const az = Math.max(bnd.minZ, Math.min(bnd.maxZ, gz));
    const from = input.standsAt;
    const back = from ? backOf(from.at, from.rot, dim) : null;
    const stay = back ? nearestEdge(footprint, back[0], back[1]) : nearestEdge(footprint, x, z);
    const follow = nearestEdge(footprint, ax, az);
    const stayDist = stay ? edgeProjection(footprint, stay.index, ax, az)?.dist : undefined;
    const switches =
      !stay || !follow || stayDist === undefined || follow.index === stay.index || follow.dist + WALL_SWITCH_M < stayDist;
    const [sx, sz] = switches ? [ax, az] : [x, z];
    // Staying means staying on THAT wall, so a turn names it: from the clamped point,
    // `snapToWall`'s own nearest-wall choice can be the same tie again. A drag keeps
    // letting the snap choose, which is the answer `stay` was derived from anyway.
    const edge = input.wallEdge ?? (back && !switches ? stay!.index : input.wallEdge);
    const snapped = snapToWall([sx, 0, sz], dim, footprint, wallStandoff(part.shape), edge);
    x = snapped.x;
    z = snapped.z;
    if (snapped.rot !== undefined) outRot = snapped.rot;
  } else if (snapMode !== 'off') {
    // Magnetic item-to-item snapping — edges flush, centres aligned, against the
    // neighbouring furniture.
    // A key press stops at a neighbour it would collide with — see `pressObstacle`. Its
    // company is not among them, so neither is anything in `inherited`, which is
    // company too.
    const company = input.company;
    const snapped = nudgeFrom
      ? snapAhead(
          nudgeFrom, x, z, outRot, dim,
          company ? parts.filter((o) => !company.has(o.id)) : parts,
          part.id,
          pressObstacle(part, outRot, dim, input.currentY ?? part.pos[1], nudgeFrom, [x, z]),
        )
      : snapToNeighbors(x, z, outRot, dim, parts, part.id);
    x = Math.max(bnd.minX + extX, Math.min(bnd.maxX - extX, snapped.x));
    z = Math.max(bnd.minZ + extZ, Math.min(bnd.maxZ - extZ, snapped.z));
    if (snapped.lines.length > 0) snapLines = snapped.lines;
  }

  // Gravity:
  //   floor-standing items MUST sit on a surface — the top of another part where
  //     their footprints overlap, otherwise the floor.
  //   wall / ceiling-mounted items keep their mount height.
  const centered = !isFloorStanding(part.category, part.shape);
  const partH = dim[2] / 1000;
  let y: number;
  let supportId: string | undefined;
  if (part.category === 'rug') {
    y = 0;
  } else if (!centered) {
    const support = findSupportDetailed(parts, part, x, z, dim, outRot, part.circle);
    y = support?.y ?? 0;
    supportId = support?.id;
  } else if (input.rawY !== undefined && Number.isFinite(input.rawY) && followsPointerUp(part.category, part.shape)) {
    // The bottom edge goes on the grid, not the centre: "the print hangs 1.20 m
    // off the floor" is the number the Inspector shows and the one a person
    // measures, and a centre on the grid puts the edge on it only for even heights.
    const bottom = input.rawY - partH / 2;
    y = (grid ? Math.round(bottom / grid) * grid : bottom) + partH / 2;
  } else {
    const curY = input.currentY ?? NaN;
    y = Number.isFinite(curY) && curY > 0.01 ? curY : groundY(part.category, part.shape, dim, roomHeight);
  }

  // Vertical containment — the whole piece between floor and ceiling.
  if (centered) {
    y = Math.max(partH / 2 + MOUNT_PAD, Math.min(roomHeight - partH / 2 - MOUNT_PAD, y));
  } else if (y + partH > roomHeight - MOUNT_PAD) {
    y = Math.max(0, roomHeight - MOUNT_PAD - partH);
  }

  // Legality: inside the actual polygon (which catches the notch an L/T/U has and
  // a bounding box does not) and clear of everything.
  //
  // **A wall rider used to skip the polygon test entirely, and that was the hole.**
  // The reason given was that the snap above had "just placed it exactly on an edge,
  // so the exemption is EARNED by that snap" — and `snapToWall` says in its own
  // comment that it does no such thing when the piece is wider than the wall it
  // landed on: it CENTRES it and lets both ends hang past the corners, on purpose,
  // because shrinking it is what rule 2 forbids. (`snapToWall`'s own comment adds
  // "and `lib/clearance.ts` is what says it does not fit" — that part is **not**
  // true and was propagated from there rather than checked. `clearance.ts` emits
  // door · entry · clash · walk · zone · window · tv · tall · crowding · reach ·
  // cut-off · turning, and not one of them was "outside the room": `tall` is a
  // height check and `freeFloorShare` DISCARDS the outside portion rather than
  // reporting it, so a sofa half out of the room read as a room with MORE free floor
  // than it has. `outside` exists now — § H.16b — and it shares this function's
  // containment predicate through `roomContainment`, so the drag and the report
  // cannot come apart over one piece.) On a rectangle those
  // ends hang over the neighbouring wall's floor
  // and nobody notices. On an L, a T or a U they hang into the missing quadrant —
  // outside the room — and the drag committed `valid` with no red and nothing said.
  //
  // The exemption is deleted rather than repaired, because it turned out to be pure
  // hole — and that is an A/B measured in one run rather than an inference from the
  // escape count. `tests/wall-rider-containment.test.ts` sweeps every pair in
  // `PART_LIBRARY` at min/mid/max size, five layout ids, three angles and 35 targets
  // — 66,150 placements — and scores each one both ways. With the exemption the
  // catalogue accepts 55,528; without it, 54,958. The **570** that go are exactly
  // the 570 that were leaving the room (311 curtain, 196 window, 45 painting,
  // 18 TV — "wider than the wall it landed on", not a property of curtains), and
  // nothing else moves by one. Both columns are pinned, so the second half of that
  // sentence is a gate and not a memory.
  // (Those are the figures at the deletion. Choosing a rider's wall from the pointer
  // rather than from the old-angle clamp — above — shifted the pins since, and the
  // live withdrawal is 516; the test carries both and the shift between them.)
  //
  // Five of the nine riders in the catalogue — `door`, `ac/ac-unit`, both mirrors
  // and `tv/soundbar`, the pieces that sit in or on the plaster and are the reason
  // such an exemption gets written — pass the polygon test on their own merits at
  // every size in every layout, all 1,575 samples each. `ROOM_FIT_SLACK_MM` is what
  // lets a snapped corner sitting exactly on the clamp boundary through, and it was
  // already doing that job for everything else. It is **5 mm per face**, not 10: it
  // subtracts 10 from a dimension in MILLIMETRES and `obbFromPart` then halves it.
  //
  // The first version of that sweep was keyed by CATEGORY and reported 374. It could
  // not see `other/window` — 196 of the 570, the second largest — because riding a
  // wall is a property of the SHAPE first (`anchorFor` reads `ANCHOR_BY_SHAPE`
  // before `ANCHOR_BY_CATEGORY`), and it measured `ac` as a *box*. The catalogue
  // enumerates itself now.
  //
  // A ceiling fan never had the exemption and still does not: it gets no snap, so
  // its blades have to be inside the room like anything else.
  //
  // Does the room have room for it AT ALL, at this angle? The containment clamp
  // above pins an over-wide piece to `minX + extX` — a silent shove of however much
  // it overhangs — and for everything else that shove is caught, because the piece
  // then fails the polygon test and the caller refuses the drop. A rug was exempt
  // from that test outright, so a 2 m rug in a 1.5 m room jumped 250 mm on first
  // touch and COMMITTED: rule 2's "say so, never silently resize it to fit", broken
  // for position, in the one category that had opted out of the check that noticed.
  //
  // The exemption is real and stays — a rug belongs under the furniture and up to
  // the skirting, and holding it to an OBB test would refuse the placements it
  // exists for. A rug lying across the missing corner of an L is the case it was
  // written for, and a test pins it. So OVERHANG is allowed on purpose.
  //
  // What a rug may never be is silently MOVED, and that is what this now asks. The
  // first answer to it was `fits` — is the room's bounding box at least as big as
  // the piece — which is a bounding-box answer to a polygon question, and CLAUDE.md
  // names that trap by name. In an L whose box is 6 m across but whose arm is 1.6 m,
  // a 3 m rug dropped in the arm passed `fits`, was shoved 700 mm by the clamp, and
  // committed valid with 1.4 m of it through the plaster. The bbox check stays as a
  // necessary condition — a piece wider than the room can only ever be clamped — but
  // the load is carried by `shovedIntoRoom`, which is rule 2 stated directly: the
  // pointer chose this spot, and a spot the pointer did not choose is not a drop,
  // it is a resize-to-fit with the size left alone.
  const roomIsWideEnough =
    bnd.maxX - bnd.minX >= 2 * extX - 1e-9 && bnd.maxZ - bnd.minZ >= 2 * extZ - 1e-9;
  //
  // …and `pointInFootprint` is the third condition, because the two above are both
  // about the CLAMP and the clamp is a bounding-box instrument. In anything but a
  // rectangle there is floorless bounding box to walk into: in a T, a rug dragged
  // into the missing south-east quadrant is never clamped (nothing there to clamp
  // against), so nothing was shoved, the room is wide enough, and it committed
  // `valid` standing entirely off the floor. The overhang exemption is about the
  // rug's EDGES — under the furniture, up to the skirting, across an L's missing
  // corner — and it was reading as an exemption from being in the room at all.
  // Its centre is held to the same test every other piece's is; both pinned tests
  // for the exemption place the rug's centre over real floor, which is what makes
  // this the narrow version of the fix rather than a retraction of the exemption.
  //
  // The second branch is `partInsideRoom` in `lib/footprint.ts` now, shared with the
  // room report — a gesture and a report that disagree about one piece is the
  // two-sources-of-truth defect, and it reads as whichever half you are looking at
  // being broken. The DISJUNCTION stays here: a rug that is fully inside passes
  // through the second branch, so folding the rug case into the shared predicate
  // would silently refuse a shoved rug that ended up entirely in the room.
  const inRoom =
    (part.category === 'rug' &&
      roomIsWideEnough &&
      !shovedIntoRoom &&
      pointInFootprint(x, z, footprint)) ||
    partInsideRoom([x, y, z], outRot, dim, footprint, part.circle, part.shape);
  const collides = collidesAt(parts, part.id, [x, y, z], outRot, dim, input.inherited);
  // `inRoom` first: see `Resolved.refusal` for why the order is the whole point.
  const refusal: Refusal | undefined = !inRoom
    ? ridesAWall
      ? 'wall'
      : 'room'
    : collides
      ? 'blocked'
      : undefined;

  return {
    pos: [x, y, z],
    rot: outRot,
    valid: inRoom && !collides,
    snapLines,
    supportId,
    refusal,
  };
}

/**
 * A turn, resolved: the piece stays where it stands and only its angle changes —
 * but its FOOTPRINT does not stand still, because `extX`/`extZ` above are
 * functions of rotation as well as size. Turning a long piece that sits against a
 * wall drives its corners through the plaster, so a turn needs the containment
 * clamp exactly as much as a drag does.
 *
 * Three decisions live here rather than in each caller, because four gestures turn
 * a piece — the plan's rotate handle, its two keyboard paths, and the 3D gizmo —
 * and hand-rolling them is how they drifted apart in the first place:
 *
 * · `snapMode: 'off'`. A turn asks to be kept in the room, not to be re-gridded or
 *   re-magnetised where it stands. The ANGLE is quantised by the caller, which is
 *   the only part of the snap a turn wants.
 * · `wallEdge: null`. A wall rider is re-aimed by the wall it lands on, in both
 *   tabs or in neither.
 * · The caller takes the CLAMP and not the legality. Refusing an invalid frame
 *   would make a piece in a tight spot unturnable; `valid` comes back so the caller
 *   can say so out loud instead. The one exception is a turn that swings a piece
 *   into trouble it was clear of — see `turnSwingsInto`, which every caller asks.
 *
 * That last one is why this returns a whole `Resolved` and not a position. The
 * clamped position is produced whether or not the frame is legal, and the one
 * caller that hand-rolled its own refusal path threw it away: 3D `commit()` fell
 * back to the PRE-GESTURE position raw and wrote the new angle beside it — a
 * combination nothing had ever run through containment. Turning the lead of a
 * merged set into its own siblings made the resolve invalid, so that was the path
 * every such turn took, and the bed was committed with its corner through the wall.
 */
export type TurnInput = {
  part: ScenePart;
  /** Where it stands now. Its `y` is the mount height to preserve. */
  at: [number, number, number];
  /** The new angle, already quantised to the caller's step. */
  rot: number;
  dim: [number, number, number];
  parts: ScenePart[];
  footprint: Poly;
  roomHeight: number;
};

export function turnInPlace(input: TurnInput): Resolved {
  return resolvePlacement({
    part: input.part,
    rawX: input.at[0],
    rawZ: input.at[2],
    rot: input.rot,
    dim: input.dim,
    parts: input.parts,
    footprint: input.footprint,
    roomHeight: input.roomHeight,
    snapMode: 'off',
    currentY: input.at[1],
    wallEdge: null,
    // `part.rot` is the angle it faces now — the contract `turnSwingsInto`'s
    // `fromRot` already leans on at every caller.
    standsAt: { at: input.at, rot: input.part.rot },
  });
}

/**
 * The heading the 3D ring has turned a piece to, given the heading the gesture began
 * at: written in the start's own winding, and EXACTLY the start for a press that
 * turned nothing.
 *
 * The ring writes a quaternion, and a quaternion has no winding — `yawOf` reads it
 * back inside [−π, π] with noise in the last bits. Written raw, a press on a piece the
 * wheel had wound to 3.49 rad stored −2.79, and a press on almost any piece stored a
 * number a few ULPs off the one it had. Same piece, different number, and every exact
 * comparison downstream reads that as a turn: `forgetOverrides` records an undo step,
 * `cascadeTransform` writes overrides on the rigid children. So the ring's TURN is
 * read rather than its heading, and a turn within `SAME_TURN` is no turn.
 */
export function ringHeading(q: { x: number; y: number; z: number; w: number }, start: number): number {
  const yaw = yawOf(q);
  if (turnBetween(yaw, start) <= SAME_TURN) return start;
  return start + Math.atan2(Math.sin(yaw - start), Math.cos(yaw - start));
}

/**
 * Does this turn swing the piece INTO trouble it is clear of where it stands? Then
 * the turn is HELD — the piece keeps the angle it has — rather than taken.
 *
 * The rule above ("the caller takes the clamp and not the legality") was written for
 * a piece in a tight spot, which refusing would make unturnable, and that reason
 * still holds: a piece that is already refused at its own angle is answered `false`
 * here, so it turns as before and is reported. What it never covered is the other
 * case, and the user found it on 2026-09-30: a chair tucked under a desk front first,
 * turned on the ring, swung its back up through the desktop and stayed there, red.
 * A drag has always stopped at the last spot that fitted; a turn now stops at the
 * last angle that fitted, for the same reason.
 *
 * `fromRot` is the angle it faces NOW — the effective one, not the authored `rot`.
 *
 * "Clear where it stands" means clear WITHOUT being moved. The resolve clamps into
 * the room first, so a piece poking through a wall — a wall dragged in on it, a
 * detected room — comes back `valid` at a spot it is not at, and the first version
 * held its turn on that answer: the one piece this rule promises can still turn was
 * the one it could not (found in review). So a resolve that moved the piece more than
 * `STANDS_TOL_M` along the floor counts as not clear, and the turn is taken.
 */
export function turnSwingsInto(input: TurnInput, turned: Resolved, fromRot: number): boolean {
  if (turned.valid) return false;
  const here = turnInPlace({ ...input, rot: fromRot });
  if (!here.valid) return false;
  return Math.hypot(here.pos[0] - input.at[0], here.pos[2] - input.at[2]) <= STANDS_TOL_M;
}

/** How far the resolve may move a piece and still call it where it stands: a
 *  millimetre, for the float round trip through the clamp and the wall snap. */
const STANDS_TOL_M = 0.001;

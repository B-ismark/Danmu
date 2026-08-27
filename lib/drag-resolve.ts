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

import { collidesAt, type ScenePart } from './scene-spec';
import { pointInFootprint, footprintBounds } from './footprint';
import { obbFromPart, obbInsidePoly, type Poly } from './geometry';
import { snapToNeighbors, type SnapLine } from './item-snap';
import { findSupportDetailed, groundY, isFloorStanding, MOUNT_PAD, ridesWall, snapToWall, wallStandoff } from './physics';

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
   * The footprint edge a wall-riding piece must KEEP, rather than sliding onto
   * whichever wall is nearest. Set only while company is following it — see
   * `Convoy.leadEdge`, which is where the decision is made and where the reason
   * is written down.
   */
  wallEdge?: number | null;
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
};

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
  const grid = snapSteps(snapMode).translate;
  const gx = grid ? Math.round(rawX / grid) * grid : rawX;
  const gz = grid ? Math.round(rawZ / grid) * grid : rawZ;

  // Containment clamp — keep the whole rotated footprint inside the room's
  // bounding box. Footprints can be off-centre after independent wall moves, so
  // this reads the bounds rather than assuming ±width/2.
  const halfW = dim[0] / 2000;
  const halfD = dim[1] / 2000;
  const c = Math.abs(Math.cos(rot));
  const sn = Math.abs(Math.sin(rot));
  const extX = halfW * c + halfD * sn;
  const extZ = halfW * sn + halfD * c;
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
  // fan dragged anywhere in the room was pushed to the nearest wall and — see the
  // legality test below — excused the containment check on the way. Reported as
  // "it only sticks to the edges" and "it spawned outside the room".
  const ridesAWall = ridesWall(part.category, part.shape);
  if (ridesAWall) {
    const snapped = snapToWall([x, 0, z], dim, footprint, wallStandoff(part.shape), input.wallEdge);
    x = snapped.x;
    z = snapped.z;
    if (snapped.rot !== undefined) outRot = snapped.rot;
  } else if (snapMode !== 'off') {
    // Magnetic item-to-item snapping — edges flush, centres aligned, against the
    // neighbouring furniture.
    const snapped = snapToNeighbors(x, z, outRot, dim, parts, part.id);
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
    const support = findSupportDetailed(parts, part.id, x, z, dim, outRot, part.circle);
    y = support?.y ?? 0;
    supportId = support?.id;
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
  // A wall rider skips the polygon test because the snap above just placed it
  // exactly on an edge — the exemption is EARNED by that snap, which is why it has
  // to be the same predicate. A ceiling fan gets no snap, so it gets no exemption:
  // its blades have to be inside the room like anything else.
  const slightlyShrunk = obbFromPart([x, y, z], outRot, [dim[0] - 10, dim[1] - 10, dim[2]]);
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
  const inRoom =
    ridesAWall ||
    (part.category === 'rug' && roomIsWideEnough && !shovedIntoRoom) ||
    (obbInsidePoly(slightlyShrunk, footprint) && pointInFootprint(x, z, footprint));
  const collides = collidesAt(parts, part.id, [x, y, z], outRot, dim);

  return { pos: [x, y, z], rot: outRot, valid: inRoom && !collides, snapLines, supportId };
}

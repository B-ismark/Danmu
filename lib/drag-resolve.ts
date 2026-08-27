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
import { findSupportDetailed, groundY, isFloorStanding, ridesWall, snapToWall, wallStandoff } from './physics';

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
    y = Math.max(partH / 2 + 0.02, Math.min(roomHeight - partH / 2 - 0.02, y));
  } else if (y + partH > roomHeight - 0.02) {
    y = Math.max(0, roomHeight - 0.02 - partH);
  }

  // Legality: inside the actual polygon (which catches the notch an L/T/U has and
  // a bounding box does not) and clear of everything.
  //
  // A wall rider skips the polygon test because the snap above just placed it
  // exactly on an edge — the exemption is EARNED by that snap, which is why it has
  // to be the same predicate. A ceiling fan gets no snap, so it gets no exemption:
  // its blades have to be inside the room like anything else.
  const slightlyShrunk = obbFromPart([x, y, z], outRot, [dim[0] - 10, dim[1] - 10, dim[2]]);
  const inRoom =
    ridesAWall ||
    part.category === 'rug' ||
    (obbInsidePoly(slightlyShrunk, footprint) && pointInFootprint(x, z, footprint));
  const collides = collidesAt(parts, part.id, [x, y, z], outRot, dim);

  return { pos: [x, y, z], rot: outRot, valid: inRoom && !collides, snapLines, supportId };
}

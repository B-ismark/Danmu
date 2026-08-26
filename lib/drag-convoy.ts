// Everything that travels when you drag one piece.
//
// A drag moves more than the thing under the pointer, and the company arrives in
// three flavours — each of which lived somewhere different, or nowhere at all:
//
//   · **rigid children** — what is physically RESTING on the piece. Carried by
//     `cascadeTransform` (lib/rigid-parent.ts) about the dragged piece's own
//     pivot, so a lamp on a turning desk both moves and turns.
//   · **merged-group siblings** — pieces fused with the Inspector's "Merge".
//   · **the rest of the multi-selection** — pieces shift-clicked or marquee'd
//     together.
//
// The last two are ONE rule: translate rigidly by the delta the dragged piece
// actually accepted. They were not one rule. Merged groups were implemented
// twice — once in `components/three/Draggable.tsx`'s `commit()`, once in
// `components/studio/PlanView.tsx`'s `moveTo` — and the multi-selection was
// implemented in neither: shift-clicking four chairs and dragging one moved that
// one chair, in both tabs. It read as intermittent rather than broken, because a
// MERGED set does move as one and looks identical on screen to a selected one, so
// the bug report it produced was "sometimes only one moves".
//
// Same shape of scar as `lib/drag-resolve.ts` and `lib/layout-rules.ts`: one
// rule, two consumers, each carrying its own copy. This is the copy now, and both
// surfaces read it.
//
// Deliberately pure — no store, no camera, no tab. It takes a snapshot of the
// world and returns transforms.

import { isWallMountedPart, type ScenePart } from './scene-spec';
import { resolvePlacement } from './drag-resolve';
import { cascadeTransform, snapshotDescendants, type DescendantOffset } from './rigid-parent';
import { nearestEdge, type Poly } from './geometry';

/** How far a convoy member may be corrected sideways by its own resolve and still
 *  count as having gone where the set sent it. Metres — a micron, i.e. only
 *  floating-point noise. Anything bigger is a containment clamp or a wall snap,
 *  which means the set would arrive deformed. */
const RIGID_EPS = 1e-6;

export type ConvoyMember = {
  part: ScenePart;
  /** Its transform when the gesture began.
   *
   *  Every frame's answer is derived from THIS, never from the last frame's. The
   *  per-frame version read each sibling's current position out of a render memo,
   *  so two pointermoves between two renders silently dropped a delta while the
   *  dragged piece — tracking a ref — kept it, and a fast drag pulled the set
   *  apart. Deriving from the start cannot drift and cannot go stale. */
  startPos: [number, number, number];
  /** What is resting on IT, snapshotted at the same moment, with anything already
   *  travelling under its own name removed. */
  descendants: DescendantOffset[];
  /** The footprint edge it rides, for a wall-mounted member, or null. Pinned for
   *  the same reason as `leadEdge`: a member handed a delta with a wall-normal
   *  component in it is nearer some other wall than its own, so an unpinned member
   *  slides round the corner and arrives facing a different direction from the set
   *  it left with. */
  edge: number | null;
};

export type Convoy = {
  /** The dragged piece's own rigid children — cascaded about its RESOLVED
   *  rotation, which is why they are not members. */
  own: DescendantOffset[];
  members: ConvoyMember[];
  /**
   * The footprint edge the DRAGGED piece must stay on, or null to let it choose.
   *
   * Non-null only when the piece rides a wall AND something is following it, and
   * that conjunction is the whole rule. A wall rider's position is not the
   * pointer's answer but the wall's, and `nearestEdge` changes its mind
   * discontinuously: drag a TV off the north wall of a 6 × 4 m room towards the
   * middle and it appears on the east wall 1.6 m away, turned 90°, from a pointer
   * move of 0.4 m. Alone that is the feature — it is how you move a picture to
   * another wall. With a chair in the selection it is a 1.6 m teleport for the
   * chair, whose reported reason was worse than the bug: the set refused, and
   * named the CHAIR as the piece that would not fit.
   *
   * So the pin is not a correction applied afterwards — the flip is simply not
   * offered while a set is following, and the TV slides along the wall it started
   * on and stops at its end (`edgeProjection` clamps to the segment). Dragging it
   * on its own is untouched.
   */
  leadEdge: number | null;
  /** Every id this gesture moves, the dragged piece included.
   *
   *  The set every resolve in the gesture must subtract from the world: a piece
   *  must not weigh its gravity, its magnetism or its collisions against company
   *  that is moving with it. Filtering only the dragged piece's own children — all
   *  either surface used to do — is why dragging two chairs selected side by side
   *  refused instantly. Each chair was the other's obstacle, sitting at the very
   *  position it was about to leave.
   *
   *  Subtract it with `worldFor`, never by hand: the piece being resolved has to
   *  stay in its own world. */
  travelling: Set<string>;
};

/**
 * The world one travelling piece resolves against: everything that is NOT
 * travelling, plus that piece itself.
 *
 * The "plus itself" is not a nicety. `collidesAt` looks the mover up in the list
 * it is handed and returns **false** when it is not there, so a world with the
 * mover filtered out reports every position as clear — collision detection off,
 * for the dragged piece and every member, with nothing to see and no error. The
 * other consumers (`snapToNeighbors`, `findSupportDetailed`) skip the mover by id
 * themselves, so its presence costs nothing.
 *
 * `self` supplies only identity — category, shape, circle. Its position and
 * rotation are passed to the resolve separately and this copy's are ignored.
 */
export function worldFor(convoy: Convoy, self: ScenePart, parts: ScenePart[]): ScenePart[] {
  const out: ScenePart[] = [];
  for (const p of parts) if (!convoy.travelling.has(p.id)) out.push(p);
  out.push(self);
  return out;
}

/** `rot` is present only when the gesture actually turned that piece: a rigid
 *  child cascaded about a turning parent, or a wall-mounted member the wall
 *  re-aimed. Writing an unchanged rotation is not free — `setTransformsFor`
 *  CREATES an override in `useStudio.rotations`, and per lib/transforms.ts an
 *  override pins that value against a re-detect and persists into IndexedDB and
 *  the scene file. The first version made it mandatory and so stamped one on
 *  every member of every dragged set; the plan's own dragged-piece path had been
 *  guarding it all along (`if (r.rot !== part.rot) setRotation(...)`). */
export type ConvoyMove = { id: string; pos: [number, number, number]; rot?: number };

export type ConvoyResult = {
  /** Returned whether or not the step is legal, so a caller can hold the set at
   *  the last legal delta without recomputing. Apply them only when `valid`. */
  moves: ConvoyMove[];
  /** False when some member cannot go where the set is asking it to. The set then
   *  refuses AS A UNIT rather than deforming to fit or pushing a piece through the
   *  plaster — rule 2's "say so, never silently resize it to fit", for position.
   *
   *  The dragged piece's own legality is the caller's business; this is the
   *  company's. */
  valid: boolean;
  /** The first member that could not go, for the message the caller says out loud.
   *  Naming the piece matters here in a way it does not for a single drag: the
   *  thing that refused is not the thing under the hand. */
  blocked?: ScenePart;
};

/**
 * Who travels with `draggedId`, resolved ONCE at pointer-down.
 *
 * Re-resolving per frame is what lets a piece near a tolerance detach mid-gesture
 * — the same trap `wallAttachments` documents for walls, and the reason both drag
 * paths already cache their descendants.
 */
export function planConvoy(input: {
  draggedId: string;
  /** The world at its EFFECTIVE transforms (see lib/transforms.ts). */
  parts: ScenePart[];
  selection: readonly string[];
  parentIds: Record<string, string>;
  /** Needed only to name the wall each wall-riding piece starts on — see
   *  `Convoy.leadEdge`. Resolved here, at pointer-down, because a wall read per
   *  frame is a wall that can change mid-gesture, which is the thing being fixed. */
  footprint: Poly;
}): Convoy {
  const { draggedId, parts, selection, parentIds, footprint } = input;
  const byId = new Map(parts.map((p) => [p.id, p]));
  if (!byId.has(draggedId)) {
    return { own: [], members: [], travelling: new Set([draggedId]), leadEdge: null };
  }

  const own = snapshotDescendants(draggedId, parts, parentIds);
  const travelling = new Set<string>([draggedId, ...own.map((d) => d.id)]);

  // The selection travels only when the piece under the pointer is IN it. Dragging
  // something outside the selection is not a request to move the selection, and
  // both surfaces reduce the selection to that piece when it happens.
  const wanted = new Set<string>([draggedId]);
  if (selection.includes(draggedId)) {
    for (const id of selection) if (byId.has(id)) wanted.add(id);
  }

  // Group closure, after the selection: if anything travelling belongs to a merged
  // set, all of that set comes. Selecting a chair plus ONE half of a merged
  // sideboard pair and dragging must not leave the other half behind — leaving
  // half behind is the thing "merged" exists to make impossible.
  const groups = new Set<string>();
  for (const id of wanted) {
    const g = byId.get(id)?.groupId;
    if (g) groups.add(g);
  }
  if (groups.size > 0) {
    for (const p of parts) if (p.groupId && groups.has(p.groupId)) wanted.add(p.id);
  }

  /** The wall a piece is against now, by footprint edge index.
   *
   *  Gated on the SAME predicate as the wall branch in `resolvePlacement`, not on
   *  the narrower `ridesWall`: a pin that is absent where the snap is present
   *  leaves the flip in place for exactly the pieces nobody remembered to check. */
  const wallEdgeOf = (p: ScenePart): number | null =>
    isWallMountedPart(p.category, p.shape)
      ? (nearestEdge(footprint, p.pos[0], p.pos[2])?.index ?? null)
      : null;

  const members: ConvoyMember[] = [];
  for (const p of parts) {
    // `travelling` already holds the dragged piece and its rigid children. A child
    // is carried by the rotation-correct cascade, which must win over this
    // translate-only path for a piece that is both a selection member and
    // something resting on the piece being dragged.
    if (!wanted.has(p.id) || travelling.has(p.id)) continue;
    travelling.add(p.id);
    members.push({
      part: p,
      startPos: [p.pos[0], p.pos[1], p.pos[2]],
      descendants: [],
      edge: wallEdgeOf(p),
    });
  }

  // Members' own children, after membership is closed so that a child which is
  // itself a member is carried once (as a member) rather than twice.
  for (const m of members) {
    const desc = snapshotDescendants(m.part.id, parts, parentIds).filter((d) => !travelling.has(d.id));
    m.descendants = desc;
    for (const d of desc) travelling.add(d.id);
  }

  // Only worth pinning if something is actually following: a lone wall rider
  // should still be able to move a picture from one wall to another.
  const lead = byId.get(draggedId)!;
  const leadEdge = members.length > 0 ? wallEdgeOf(lead) : null;

  return { own, members, travelling, leadEdge };
}

/**
 * Where every travelling piece lands, given the transform the dragged piece
 * actually accepted.
 *
 * The set TRANSLATES; it never turns. A set rotating about some pivot is a
 * different gesture and nobody asked for it here, and the dragged piece's own
 * rotation can change under it (a wall-mounted piece snapping to a new wall,
 * a wheel-rotate mid-drag) — shearing the set on a move would be the surprise.
 */
export function resolveConvoy(input: {
  convoy: Convoy;
  draggedId: string;
  /** The dragged piece's accepted transform, straight out of `resolvePlacement`. */
  pos: [number, number, number];
  rot: number;
  /** Where the dragged piece was when the gesture began. */
  startPos: [number, number, number];
  /** The WHOLE world, at its effective transforms. Each member's own world is
   *  built here rather than by the caller — `worldFor` has a trap in it (see
   *  there) and one place is enough to get it right. */
  parts: ScenePart[];
  footprint: Poly;
  roomHeight: number;
}): ConvoyResult {
  const { convoy, draggedId, pos, rot, startPos, parts, footprint, roomHeight } = input;
  const moves: ConvoyMove[] = [];

  // The dragged piece's own children first, about its resolved pivot — the only
  // company that rotates with it.
  if (convoy.own.length > 0) moves.push(...cascadeTransform(draggedId, pos, rot, convoy.own));

  // Nothing is coming, so there is no delta to take and no world to build. Every
  // ordinary single-piece drag lands here at input rate, and the `staying` copy
  // below is O(parts) — it was being paid for a loop that runs zero times.
  if (convoy.members.length === 0) return { moves, valid: true };

  const dx = pos[0] - startPos[0];
  const dz = pos[2] - startPos[2];
  // A rotate or a scale moves nothing sideways, so the company has nothing to do
  // — which is what the merged-group code meant by "only on a move". Checked
  // exactly (not against a tolerance): a drag the grid snapped back to zero
  // genuinely did not move.
  if (dx === 0 && dz === 0) return { moves, valid: true };

  let valid = true;
  let blocked: ScenePart | undefined;

  // What is NOT travelling is the same world for every member, so it is built once
  // and the member is written into one trailing slot (`worldFor`'s "plus itself",
  // without re-copying the room per piece).
  const staying: ScenePart[] = [];
  for (const p of parts) if (!convoy.travelling.has(p.id)) staying.push(p);
  const selfSlot = staying.length;

  for (const m of convoy.members) {
    const tx = m.startPos[0] + dx;
    const tz = m.startPos[2] + dz;
    staying[selfSlot] = m.part;
    const r = resolvePlacement({
      part: m.part,
      rawX: tx,
      rawZ: tz,
      rot: m.part.rot,
      dim: m.part.dimMM,
      parts: staying,
      footprint,
      roomHeight,
      // 'off' so the set keeps its shape: a member allowed its own magnetism would
      // slide out of formation towards a neighbour, and the grid would re-round a
      // delta the dragged piece has already committed to.
      snapMode: 'off',
      currentY: m.startPos[1],
      // Its own wall, held for the length of the gesture — see `ConvoyMember.edge`.
      wallEdge: m.edge,
    });
    // Vertically the member is NOT carried — the resolve's gravity answer wins, so
    // a piece translated off the table it stood on lands on the floor instead of
    // hanging at table height. That floating vase is a scar this repo already has,
    // from the plan's old two-step drag.
    //
    // Which also means a member CAN ride up onto something it arrives over, and the
    // set is then not flat. Deliberate: one dragged chair already climbs a table it
    // is pulled across, refusing instead would make a set nearly immovable in a
    // furnished room, and "the set stays level" is a promise no gesture here made.
    // A wall rider cannot accept the wall-normal half of the delta — its wall
    // discards it — so it legitimately arrives short and must not count as
    // deformed. What bounds that exemption is `ConvoyMember.edge`: the correction
    // can only be along one known wall now, not a jump to some other one.
    const wallRider = isWallMountedPart(m.part.category, m.part.shape);
    const rigid =
      wallRider || (Math.abs(r.pos[0] - tx) < RIGID_EPS && Math.abs(r.pos[2] - tz) < RIGID_EPS);
    if (!r.valid || !rigid) {
      valid = false;
      if (!blocked) blocked = m.part;
    }
    // Only a wall-mounted member can come back turned (`snapMode: 'off'` leaves
    // `outRot` alone for everything else), so for the rest this omits the field
    // rather than writing back the value it already had. See `ConvoyMove`.
    moves.push(
      r.rot === m.part.rot
        ? { id: m.part.id, pos: r.pos }
        : { id: m.part.id, pos: r.pos, rot: r.rot },
    );
    if (m.descendants.length > 0) {
      moves.push(...cascadeTransform(m.part.id, r.pos, r.rot, m.descendants));
    }
  }

  return { moves, valid, blocked };
}

/**
 * Where everything was when the gesture began.
 *
 * Escape mid-drag must put back what the gesture MOVED, not what it was aimed at.
 * It used to restore only the piece under the pointer, which left a lamp that had
 * ridden along on a desk hanging in mid-air and every member of a merged set
 * scattered. `cascadeTransform` is pure, so replaying it from the start transform
 * reproduces the children exactly — there is nothing extra to snapshot.
 */
export function convoyRestore(
  convoy: Convoy,
  draggedId: string,
  startPos: [number, number, number],
  startRot: number,
): ConvoyMove[] {
  const moves: ConvoyMove[] = [{ id: draggedId, pos: startPos, rot: startRot }];
  moves.push(...cascadeTransform(draggedId, startPos, startRot, convoy.own));
  for (const m of convoy.members) {
    // Same asymmetry as `resolveConvoy`, for the same reason: restoring a rotation
    // that never moved would leave behind exactly the override the resolve was
    // careful not to create. Only a wall rider can have been turned by the
    // gesture, so only a wall rider needs one put back.
    moves.push(
      isWallMountedPart(m.part.category, m.part.shape)
        ? { id: m.part.id, pos: m.startPos, rot: m.part.rot }
        : { id: m.part.id, pos: m.startPos },
    );
    moves.push(...cascadeTransform(m.part.id, m.startPos, m.part.rot, m.descendants));
  }
  return moves;
}

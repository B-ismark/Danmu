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

import type { ScenePart } from './scene-spec';
import { ridesWall } from './physics';
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
   *  Every frame's answer is derived from THIS, never from the last frame's, and
   *  the reason owes nothing to how React schedules a render — an earlier version
   *  of this comment blamed "two pointermoves between two renders", which is a
   *  claim about the renderer that nothing here can check and that turned out to be
   *  the wrong layer entirely.
   *
   *  The real reason is in this file. A member's own `resolvePlacement` is not the
   *  identity: it clamps to the footprint, re-asks gravity, and re-aims a wall
   *  rider along its edge — and two of those corrections are ACCEPTED rather than
   *  refused (a wall rider is exempt from the rigidity test by design, and the
   *  vertical answer always wins). Step from the last frame and each accepted
   *  correction becomes the next frame's base, so the set walks away from the delta
   *  the pointer is asking for and cannot walk back. Deriving from the start is
   *  idempotent: the same pointer position gives the same answer whatever happened
   *  in between. */
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
   *  Build the world with `travellingWorld`, never by hand: the piece being
   *  resolved has to stay in its own world. */
  travelling: Set<string>;
};

/**
 * The world ANY travelling piece resolves against: everything that is not
 * travelling where it stands, and everything that IS travelling **at the position
 * it is going to**, i.e. shifted by the delta the gesture has taken so far.
 *
 * Shifting rather than deleting is the whole point, and it took two goes to get
 * right. The first version deleted the convoy and re-added only the mover, which
 * wrote furniture onto the floor: gravity is `findSupportDetailed` over this list,
 * so a support that was also travelling was simply invisible — select a desk and
 * the lamp standing on it, drag either one, and the lamp resolved with nothing
 * under it, landed at y = 0, reported `valid` (because `collidesAt` could not see
 * the desk either), had its rigid parent link cleared, and was persisted. The fix
 * was applied to the members' world and NOT to the dragged piece's, so dragging
 * the desk was correct and dragging the lamp still grounded it. One function now,
 * called from all three places, because that asymmetry is not visible from either
 * side of it.
 *
 * Two properties this must keep, and they pull in opposite directions.
 *
 * **The mover has to be in its own world**: `collidesAt` looks it up in the list it
 * is handed and returns `false` when it is absent, so filtering it out turns
 * collision detection off silently. Its own shifted copy serves — `collidesAt` and
 * `findSupportDetailed` both find it by id and then skip it as an obstacle.
 *
 * **But the mover's own rigid children must be OMITTED**, which is what `carried`
 * is for and why it has no default. This restores in one place the contract
 * `ResolveInput.parts` has always stated — "with this piece's own rigid
 * descendants filtered out, a part must not resolve its gravity against a child
 * this same move is about to carry out from under it" — and which both surfaces
 * quietly stopped honouring when the world moved in here. It was believed to be
 * free: the earlier version of this comment claimed a piece cannot collide with
 * its own children "because `findSupportDetailed` only considers pieces below".
 * It does not. It has no below-test at all — it takes the highest `top` whose
 * footprint covers `MIN_SUPPORT_SHARE` of the mover, above or below. So a
 * nightstand with a tall plant on it, shifted to where it is going and therefore
 * still directly overhead, resolved onto its own plant at y = 2.15, which is
 * through the ceiling: the piece became undraggable in both tabs, and the only
 * symptom was a red highlight that never went green.
 *
 * Pass `Convoy.own` for the dragged piece, `ConvoyMember.descendants` for a
 * member, and `[]` for a shared list nobody is about to resolve from.
 *
 * `dx` / `dz` are the delta of the gesture, in metres. Pass the ATTEMPTED delta
 * when resolving the dragged piece (the accepted one is not known until it
 * resolves) and the ACCEPTED one when resolving members.
 */
/** Which gesture is in flight, for `resolveConvoy`'s `gesture`.
 *
 *  Pure and exported because it lived in `Draggable` where nothing could test it,
 *  and it shipped a hole in exactly the place the component made invisible.
 *
 *  `rotatedWithoutPointer` is a ref the wheel and the two-finger twist set: both
 *  change a piece's angle while the pointer stands still, and the containment
 *  clamp is a function of that angle, so the resolved position moves although no
 *  translation was asked for. Read as a translation, that correction is copied to
 *  the whole selection.
 *
 *  But **while the gizmo is active it owns the entire answer**, and the ref must
 *  not be consulted at all. The gizmo is the one thing here that can be dragged
 *  without `Draggable`'s own pointer-move handler running — that handler returns
 *  early for the whole gizmo gesture — so the single line that clears the ref is
 *  unreachable for its duration. Asking the ref anyway meant a wheel-rotate
 *  followed by a gizmo TRANSLATE reported `'turn'` and carried nobody: select two
 *  chairs, drag one, wheel-notch it, release, then pull the translate arrow, and
 *  the second chair stays behind. Silent, and indistinguishable from the
 *  "sometimes only one moves" report the convoy work exists to end. Found by
 *  danmu-cb in review. */
export function gestureFor(
  gizmoActive: boolean,
  gizmoMode: 'translate' | 'rotate' | 'scale',
  rotatedWithoutPointer: boolean,
): 'move' | 'turn' {
  if (gizmoActive) return gizmoMode === 'translate' ? 'move' : 'turn';
  return rotatedWithoutPointer ? 'turn' : 'move';
}

export function travellingWorld(
  convoy: Convoy,
  parts: ScenePart[],
  dx: number,
  dz: number,
  carried: readonly DescendantOffset[],
): ScenePart[] {
  const riding = carried.length > 0 ? new Set(carried.map((d) => d.id)) : null;
  const out: ScenePart[] = [];
  for (const p of parts) {
    if (riding?.has(p.id)) continue;
    if (!convoy.travelling.has(p.id)) out.push(p);
    else out.push({ ...p, pos: [p.pos[0] + dx, p.pos[1], p.pos[2] + dz] });
  }
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
   *  thing that refused is not the thing under the hand.
   *
   *  ONE piece, because a sentence naming four is a sentence nobody finishes. What
   *  gets OUTLINED is `blockedIds`. */
  blocked?: ScenePart;
  /** Every member that could not go, in the order they were asked.
   *
   *  `blocked` used to be the whole answer, so a set stopped by three pieces
   *  outlined one and the user moved it, tried again, and was stopped by the next
   *  — the refusal looked like it was moving around the room. Empty when the step
   *  is legal. */
  blockedIds: string[];
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

  // The selection travels only when the piece under the pointer is IN it. Dragging
  // something outside the selection is not a request to move the selection, and
  // both surfaces reduce the selection to that piece when it happens.
  const wanted = new Set<string>([draggedId]);
  if (selection.includes(draggedId)) {
    for (const id of selection) if (byId.has(id)) wanted.add(id);
  }

  // There is deliberately NO closure over `groupId` here. It used to sit at this
  // point — anything travelling pulled in the rest of its merged set — and the
  // reasoning was that leaving half a merged pair behind is the thing "merged"
  // exists to prevent. What that missed is that a merged set is already selected
  // whole by a click (`selectionForPick` in lib/scene-spec.ts), so the closure
  // changed the answer in exactly one case: a selection holding SOME of a group.
  // There it overrode the selection, and the user's verdict is that the selection
  // wins — dragging one member of a group moves that member, which is what
  // rotating one member has always done. Two gestures, one meaning.
  //
  // Where "merged" now lives is `selectionForPick`. That is a strictly better
  // place for it: a click still takes the whole set, so the ordinary gesture is
  // unchanged, and the only thing that lost power is a code path nobody could
  // reach until the layer tree made a single member selectable.
  //
  // …with one hole in that reasoning, found by danmu-39 and closed just below. "A
  // merged set is already selected whole by a click" is true of the SELECTION path
  // and says nothing about the RIGID one. Drag a desk with a merged pair standing
  // on it and only the half physically resting there is a descendant: the pair came
  // apart, from a gesture that never touched the selection at all. Closing the
  // group over rigidly-carried pieces does not override anybody's selection — a
  // rigid child is not a selection — so it restores "merged means merged" without
  // taking back the verdict above.
  // …and that closure covered the DRAGGED piece's rigid children only, which left
  // the identical defect one layer out. Found by danmu-62 reviewing this commit's
  // parent. A member's rigid children are carried too, and they were never offered
  // to the group closure: merged P and Q resting on different supports, P on desk D
  // and Q on the floor beside it, multi-select chair C and desk D, drag C. D is a
  // member, `snapshotDescendants(D)` returns `[P]` alone because Q fails
  // `isPhysicallySupported` against D, and Q was never reached. The pair came apart
  // from a gesture that touched neither half of it. Dragging D directly worked,
  // because then P is in `own` — so the same feature behaved differently depending
  // on which piece of the selection was under the hand, which is exactly what this
  // file's header says must never be two code paths.
  //
  // Closing over a member's rigid children as well makes this a FIXED POINT rather
  // than a pass: a group sibling pulled in becomes a member, that member has rigid
  // children of its own, and those children can belong to a third group. One pass
  // would close the first hop and leave the second, which is the same bug with a
  // longer fixture. So membership and descendants are rebuilt from scratch on each
  // round and the round repeats while `wanted` is still growing.
  //
  // It terminates because `wanted` only ever grows and is bounded by `parts`, and
  // the loop exits the first round that adds nothing. Rebuilding rather than
  // patching in place is deliberate: `travelling` gates which descendants each
  // member keeps, so a member added late changes what an earlier member is entitled
  // to carry, and incrementally amending the previous round's answer is how the
  // ORDER-DEPENDENT bug below came about the first time.

  /** The wall a piece is against now, by footprint edge index.
   *
   *  Gated on the SAME predicate as the wall branch in `resolvePlacement`: a pin
   *  that is absent where the snap is present leaves the flip in place for exactly
   *  the pieces nobody remembered to check, and a pin present where the snap is not
   *  is a claim about a piece that nothing reads and nobody can trust. */
  const wallEdgeOf = (p: ScenePart): number | null =>
    ridesWall(p.category, p.shape)
      ? (nearestEdge(footprint, p.pos[0], p.pos[2])?.index ?? null)
      : null;

  /** Pull the rest of every merged set that `ids` touches into `wanted`. Returns
   *  whether anything was added, which is the loop's termination test.
   *
   *  Skipping anything already in `travelling` is not an optimisation, it is the
   *  rule three lines down in this file: a piece that is both rigidly carried and
   *  nominally a member must be carried ONCE, by the rotation-correct cascade. A
   *  set is closed over its own members too, so without this guard the very piece
   *  that pulled its group in — the desk's own P — is promoted to a member on the
   *  next round, and `travelling.has(p.id)` then strips it from the desk's
   *  descendants. The pair stayed together and P stopped turning with the desk:
   *  a fixture written for the first defect caught it only because it asserted the
   *  descendants and not just the travelling set. */
  const closeGroupsOver = (ids: readonly string[]): boolean => {
    let grew = false;
    for (const id of ids) {
      const g = byId.get(id)?.groupId;
      if (!g) continue;
      for (const p of parts) {
        if (p.groupId === g && !wanted.has(p.id) && !travelling.has(p.id)) {
          wanted.add(p.id);
          grew = true;
        }
      }
    }
    return grew;
  };

  let members: ConvoyMember[] = [];
  let travelling = new Set<string>();
  for (;;) {
    travelling = new Set<string>([draggedId, ...own.map((d) => d.id)]);
    members = [];
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
    //
    // Dropping a descendant means dropping the SUBTREE under it, and that is the
    // whole subtlety. The filter used to test `travelling.has(d.id)` alone, which
    // strips a middle link while keeping the grandchild hanging off it —
    // `cascadeTransform` then cannot find the grandchild's parent among the
    // transforms it is computing and drops it with `if (!parent) continue`, silently,
    // having already put the grandchild in `travelling` so `travellingWorld` shifts a
    // phantom of it to a position it never reaches. Worse, it was ORDER-DEPENDENT:
    // with a table before its shelf in `parts` the book on the shelf moved, with the
    // shelf first it did not, which is precisely why no fixture caught it. Found by
    // danmu-39 in review.
    //
    // `kept` is seeded with the member itself and grows in BFS order (guaranteed by
    // `snapshotDescendants`), so "is my own parent coming with me" is always already
    // answered. Either processing order now carries the grandchild exactly once, by
    // whichever member actually holds its parent.
    for (const m of members) {
      const kept = new Set<string>([m.part.id]);
      const desc: DescendantOffset[] = [];
      for (const d of snapshotDescendants(m.part.id, parts, parentIds)) {
        if (travelling.has(d.id) || !kept.has(d.parentId)) continue;
        kept.add(d.id);
        desc.push(d);
      }
      m.descendants = desc;
      for (const d of desc) travelling.add(d.id);
    }

    const carried = [...own.map((d) => d.id)];
    for (const m of members) for (const d of m.descendants) carried.push(d.id);
    if (!closeGroupsOver(carried)) break;
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
   *  built here rather than by the caller — `travellingWorld` has two traps in it
   *  (see there) and one place is enough to get them right. */
  parts: ScenePart[];
  footprint: Poly;
  roomHeight: number;
  /**
   * What the user is actually doing — because the delta cannot be trusted to say.
   *
   * The company copies the translation the gesture asked for. Inferring that from
   * `pos - startPos` looked equivalent and is not: the containment clamp in
   * `resolvePlacement` bounds a piece by `extX`/`extZ`, which are functions of
   * ROTATION as well as size, so turning a 2 m sofa that stands against a wall
   * pushes it off that wall — a real, correct positional delta produced by a
   * gesture that translated nothing. The set then copied it: a chair selected
   * alongside a sofa turned to 45° was measured travelling 575 mm across the room,
   * reported valid, and persisted. Found by danmu-39 in review.
   *
   * So the caller says which gesture this is and the inference is gone. `'turn'`
   * covers rotate and scale alike — neither is a request to move anything sideways.
   */
  gesture: 'move' | 'turn';
  /**
   * Does this id already carry a position override in `useStudio.positions`?
   *
   * Read only on the zero-delta path, where the answer decides between "put the
   * company back" and "write nothing" — see there. No default: both surfaces write
   * their members LIVE, frame by frame, so both have to answer, and a caller that
   * has not thought about it should be told by the compiler rather than by a room
   * full of pinned furniture.
   */
  memberHasPosOverride: (id: string) => boolean;
}): ConvoyResult {
  const { convoy, draggedId, pos, rot, startPos, parts, footprint, roomHeight, gesture, memberHasPosOverride } = input;
  const moves: ConvoyMove[] = [];
  const blockedIds: string[] = [];

  // The dragged piece's own children first, about its resolved pivot — the only
  // company that rotates with it.
  if (convoy.own.length > 0) moves.push(...cascadeTransform(draggedId, pos, rot, convoy.own));

  // Nothing is coming, so there is no delta to take and no world to build. Every
  // ordinary single-piece drag lands here at input rate, and the shifted-world copy
  // below is O(parts) — it was being paid for a loop that runs zero times.
  if (convoy.members.length === 0) return { moves, valid: true, blockedIds };

  // A turn moves nobody sideways, and it is deliberately NOT folded into the
  // zero-delta path below. That path RESTORES every member to its start position,
  // which is the right answer for a drag that travelled and came home and the wrong
  // one for a rotation applied to a set that is still out: the wheel turns the piece
  // under the hand, and the company would jump back to where the gesture began. A
  // turn leaves every member exactly where the last move frame put it — the dragged
  // piece's own rigid children have already pivoted with it, above, which is the
  // only company a rotation has.
  if (gesture === 'turn') return { moves, valid: true, blockedIds };

  const dx = pos[0] - startPos[0];
  const dz = pos[2] - startPos[2];
  // A rotate or a scale moves nothing sideways, so the company has nothing to do
  // — which is what the merged-group code meant by "only on a move". Checked
  // exactly (not against a tolerance): a drag the grid snapped back to zero
  // genuinely did not move.
  //
  // "Nothing to do" is still an ANSWER, though, and it has to be said. Returning
  // early with an empty company was a silent hole: both surfaces write the members
  // live, frame by frame, so a drag out and back to the exact start — reachable,
  // and likelier with the grid snap on — left them at the last non-zero delta with
  // nothing emitted to bring them home, and `commit()` persisted the set out of
  // formation for the next drag to start from. `Draggable.commit()` leans on this
  // in writing, too: its invalid-drop fallback slides to the pre-drag position
  // "which makes the delta zero and the company's answer 'stay'". That answer has
  // to exist for the sentence to be true.
  //
  // No world is built for it — a member that has not moved cannot have collided
  // with anything, so this stays the cheap path it was meant to be.
  //
  // Gated on `memberHasPosOverride`, and that gate is not caution: a move is a
  // WRITE, and per `ConvoyMove` writing a value a piece already has still CREATES
  // an override in `useStudio.positions`, which pins it against a re-detect and
  // persists. A gesture that never left zero — a wheel-rotate, a scale, a press
  // that did not travel — has written nothing, so there is nothing to put back, and
  // an unconditional stay would stamp a pin on every selected piece for the crime
  // of being selected while something turned. A gesture that DID move has already
  // written every member, so the override is there and putting it back is free.
  // Same question `convoyRestore` asks, for the same reason.
  if (dx === 0 && dz === 0) {
    for (const m of convoy.members) {
      if (!memberHasPosOverride(m.part.id)) continue;
      moves.push({ id: m.part.id, pos: m.startPos });
      if (m.descendants.length > 0) {
        // Same gate as the member itself, one layer down. The member's override is
        // not its children's: a side table that has been dragged before carries one,
        // the lamp standing on it may never have been touched, and writing the lamp's
        // unchanged position here would stamp it with a pin — against a re-detect,
        // and persisted — for the crime of standing on something that was selected.
        moves.push(
          ...cascadeTransform(m.part.id, m.startPos, m.part.rot, m.descendants).filter((mv) =>
            memberHasPosOverride(mv.id),
          ),
        );
      }
    }
    return { moves, valid: true, blockedIds };
  }

  let valid = true;
  let blocked: ScenePart | undefined;

  // The world a member resolves against: everything that is NOT travelling at the
  // position it is standing in, plus everything that IS travelling **at the
  // position it is going to**.
  //
  // That second half was missing, and it wrote furniture onto the floor. A member's
  // gravity is `findSupportDetailed` over this list, so a support that is also
  // travelling was simply invisible: select a desk and the lamp standing on it,
  // drag the desk 10 mm, and the lamp resolved with nothing under it and was
  // written to y = 0 — reported `valid`, because `collidesAt` could not see the
  // desk either, and then persisted. Ctrl+A and drag anything did it to every
  // tabletop item in the room at once. Found by danmu-5e in review; reproduced
  // before fixing.
  //
  // Shifting rather than simply including them is the whole point, and it is right
  // for BOTH consumers of this list. Gravity wants the support where it will be, so
  // the lamp keeps the desk under it. Collision wants the sibling where it will be
  // too — which is what the original subtraction was really reaching for: two chairs
  // side by side refused instantly because each sat in the world at the position it
  // was about to LEAVE. At its destination it is no longer in the way, and a genuine
  // overlap is still caught, so this is strictly better than removing it.
  //
  // The "plus itself" that the subtract-and-re-add-the-mover version this replaced
  // needed is satisfied by the piece's own shifted copy, since
  // `collidesAt` and `findSupportDetailed` both look the mover up by id and then
  // skip it — a same-id entry serves as the mover and is excluded as an obstacle.
  // Hence no trailing self slot any more; the whole list is built once per frame
  // rather than rewritten per member.
  // Built once for the members that carry nothing, which is nearly all of them.
  // A member with children of its own needs its own copy, because what has to come
  // out of the list is ITS descendants and no one else's — see `travellingWorld`.
  // Rebuilding unconditionally would be O(parts x members) on a Ctrl+A drag.
  const shared = travellingWorld(convoy, parts, dx, dz, []);

  for (const m of convoy.members) {
    const world =
      m.descendants.length === 0 ? shared : travellingWorld(convoy, parts, dx, dz, m.descendants);
    const tx = m.startPos[0] + dx;
    const tz = m.startPos[2] + dz;
    const r = resolvePlacement({
      part: m.part,
      rawX: tx,
      rawZ: tz,
      rot: m.part.rot,
      dim: m.part.dimMM,
      parts: world,
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
    //
    // `ridesWall`, so a CEILING piece does not get the exemption. A fan translates
    // freely across its ceiling, which means "it arrived where the set sent it" is a
    // question with a real answer for it — and under the wider predicate it was
    // excused from being asked.
    const wallRider = ridesWall(m.part.category, m.part.shape);
    const rigid =
      wallRider || (Math.abs(r.pos[0] - tx) < RIGID_EPS && Math.abs(r.pos[2] - tz) < RIGID_EPS);
    if (!r.valid || !rigid) {
      valid = false;
      if (!blocked) blocked = m.part;
      blockedIds.push(m.part.id);
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

  return { moves, valid, blocked, blockedIds };
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
  /**
   * Does this id already carry a position override in `useStudio.positions`?
   *
   * Restoring one that exists is free — a write of the same value to a key that is
   * already there. Creating one is not: per `ConvoyMove` it pins the piece against
   * a re-detect and persists. So it is asked of EVERY piece the gesture carried,
   * the one under the hand included, and asked as one question rather than two
   * because the dragged piece is not a special case here — it is the member whose
   * pivot the others turn about, nothing more.
   *
   * The dragged piece used to be exempt and wrote `pos` unconditionally. In 3D
   * nothing writes the dragged piece's position until `commit()`, so Escape
   * mid-drag was the one path in the app that invented a position override out of a
   * CANCELLED gesture.
   *
   * Default `true` restores everything, the safe direction for a caller that has
   * not been taught to ask: a needless pin, not a piece left behind.
   */
  hasPosOverride: (id: string) => boolean = () => true,
  /** The same question for `useStudio.rotations`.
   *
   *  This replaced a boolean the 3D tab could not compute. It passed
   *  `ref.current?.rotation.y !== startRot` from four lines BELOW
   *  `g.rotation.y = startRot`, where `g` IS `ref.current` — so it compared the
   *  value with itself, and was false on every gesture including a real rotate. The
   *  plan passed `mode === 'rotate'`, honest but incomplete: `moveTo` re-aims a
   *  wall rider on a TRANSLATE. Asking the store is a question both surfaces can
   *  answer correctly, and it is a safe superset — an override that predates the
   *  gesture holds the start value, so putting it back is a no-op write rather than
   *  a wrong one. */
  hasRotOverride: (id: string) => boolean = () => true,
): ConvoyMove[] {
  const moves: ConvoyMove[] = [];
  // Skipped outright when neither axis is overridden: the gesture wrote nothing
  // about this piece, so there is nothing to undo and any move at all is a pin.
  // (`pos` is required on `ConvoyMove`, so a piece with only a ROTATION override
  // still gets its position written back — the store's codec takes the two
  // together. One needless pin in one narrow case, against one on every cancelled
  // drag before this.)
  if (hasPosOverride(draggedId) || hasRotOverride(draggedId)) {
    moves.push(
      hasRotOverride(draggedId)
        ? { id: draggedId, pos: startPos, rot: startRot }
        : { id: draggedId, pos: startPos },
    );
  }
  moves.push(...cascadeTransform(draggedId, startPos, startRot, convoy.own, hasRotOverride));
  for (const m of convoy.members) {
    // Same asymmetry as `resolveConvoy`, for the same reason: restoring a rotation
    // that never moved would leave behind exactly the override the resolve was
    // careful not to create. Only a wall rider can have been turned by the
    // gesture, so only a wall rider needs one put back.
    // A wall rider is the only member the gesture can have turned — and only one
    // that already has an override can have been turned by it, because the resolve
    // writes `rot` for nothing else. `m.part.rot` is the START rotation, so writing
    // it back to a piece with no override stamps the same needless pin one piece
    // over from the dragged one.
    const turned = ridesWall(m.part.category, m.part.shape) && hasRotOverride(m.part.id);
    if (turned || hasPosOverride(m.part.id)) {
      moves.push(
        turned ? { id: m.part.id, pos: m.startPos, rot: m.part.rot } : { id: m.part.id, pos: m.startPos },
      );
    }
    moves.push(...cascadeTransform(m.part.id, m.startPos, m.part.rot, m.descendants, hasRotOverride));
  }
  return moves;
}

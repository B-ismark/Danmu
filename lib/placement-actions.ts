// "To the nearest wall" and "On the floor": the two placements a drag cannot make.
//
// They were a row of two buttons in the Inspector, and the user said — for the third
// time, and this time in so many words — that the row is mostly not needed. Most of the
// time it isn't: a drag already lands a piece on the floor or on a table. What a drag
// cannot do is the reason the operations survive at all:
//
//   · **Wall** moves the piece to the NEAREST wall and turns it to face the room.
//     `drag-resolve`'s wall snap is gated on `ridesWall` (TV, mirror, painting…), so a
//     sofa is never slid onto plaster and never rotated by a drag.
//   · **Floor** puts the piece on the floor WITHOUT moving it sideways — "under the desk"
//     is a placement only this expresses; dragging it clear drops it somewhere else.
//
// So the operations moved to the piece's right-click menu, beside "Turn a quarter", and
// out of the panel's permanent space. They read the room at call time rather than from
// a component's render, which is what lets the menu — or anything else — call them.

import { useStudio } from './store';
import { useScene } from './scene-store';
import { currentRiderRelation, currentRoomScene } from './room-scene';
import { cascadeTransform, snapshotDescendants } from './rigid-parent';
import { moveToWall, wallSentence } from './to-wall';

/** Put the piece on the floor where it stands, and take along what stands on it.
 *
 *  It writes only the riders that already have a stored position. Floor moves a piece
 *  only upright, and the height pass brings down a rider with no position of its own;
 *  writing that one too would restate the height pass as an override a re-scan will not
 *  move. A rider WITH a stored position is the one it can miss: it follows an inferred
 *  link only while the support's top differs from its authored top, so a nightstand
 *  floored back to where the room put it left a lamp carried up with it standing at desk
 *  height (§ H.6.7). */
export function putOnFloor(id: string): void {
  const parts = currentRoomScene();
  const part = parts.find((p) => p.id === id);
  if (!part) return;
  const st = useStudio.getState();
  const to: [number, number, number] = [part.pos[0], 0, part.pos[2]];
  st.setPosition(id, to);
  const riders = snapshotDescendants(id, parts, currentRiderRelation());
  if (riders.length > 0) {
    const moves = cascadeTransform(id, to, part.rot, riders);
    const stored = useStudio.getState().positions;
    const write = moves.filter((m) => stored[m.id] !== undefined);
    if (write.length > 0) useStudio.getState().setTransformsFor(write);
  }
  useStudio.getState().clearParent(id);
}

/** Move the piece to the nearest wall, facing the room. A gesture like a drag, so it
 *  takes what a drag takes — the rest of the selection, a merged set, what stands on the
 *  piece — and is checked the way a drag is (`lib/to-wall.ts`). Returns whether anything
 *  moved and the sentence to show when something could not follow or the move was
 *  refused — the caller shows it, and a toast is also spoken; `text` is `null` when the move did what it says. */
export function moveToNearestWall(id: string): { moved: boolean; text: string | null } {
  const parts = currentRoomScene();
  const part = parts.find((p) => p.id === id);
  if (!part) return { moved: false, text: null };
  const room = useScene.getState().room;
  const move = moveToWall({
    id,
    parts,
    selection: useStudio.getState().selection,
    restsOn: currentRiderRelation(),
    footprint: room.footprint,
    roomHeight: room.height,
    memberHasPosOverride: (pid) => useStudio.getState().positions[pid] !== undefined,
  });
  if (move.kind === 'moved') {
    useStudio.getState().setTransformsFor(move.moves);
    useStudio.getState().landAll(move.landings);
  }
  const text = wallSentence(part.name, move);
  return { moved: move.kind === 'moved', text };
}

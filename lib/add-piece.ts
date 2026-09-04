// Adding a piece to the room — ONE path, three triggers.
//
// The Library click, the 2D plan's drop and the 3D room's drop were three copies of
// the same seven steps: read the room, read the parts, place, mint an id, add, select,
// say so. CLAUDE.md's rule about two code paths that produce the same observable
// result applies exactly — and it had already been paid twice by the time this was
// written:
//
//  · **§ H.3 finding 5.** All three passed `useScene.getState().parts`, the AUTHORED
//    array, while a drag writes only the override map in `useStudio`. So every one of
//    them placed against the room as it was BUILT rather than as it stands: a lamp
//    resting at desk height over floor the desk had been dragged off, and falling
//    through the desk that was really there. Three call sites is three places to
//    forget `currentRoomScene()`; here it is not an argument at all.
//
//  · **§ H.3 finding 6.** The 2D drop announced `"<label> added."` and the 3D drop
//    announced nothing, so for a screen-reader user a successful 3D drop and the
//    silent `intersectPlane` early return were indistinguishable. That is not a
//    decision anybody made about the 3D tab; it is the second copy missing a line the
//    first copy has. Announcing is the default here, and the one caller that must not
//    is the one that says something better.
//
// The only thing that genuinely differs between the three is whether the user AIMED.
// A drop has a point and being placed where you aimed is a promise; a click has none,
// so `openSpotForNewPart` finds one. That is the whole of the branch below, and it is
// why `aim` is the parameter rather than three separate entry points.

import { v4 as uuid } from 'uuid';
import { announce } from './announce';
import { currentRoomScene } from './room-scene';
import { useScene } from './scene-store';
import { useStudio } from './store';
import { openSpotForNewPart, placeNewPart, type Category, type Shape } from './scene-spec';

/** What every trigger has: what the piece is, and what to call it. The Library's own
 *  row shape, minus the grouping the picker uses to lay itself out. */
export type NewPiece = {
  label: string;
  category: Category;
  shape: Shape;
  dimMM: [number, number, number];
};

export type AddPieceOptions = {
  /** Suppress the per-piece announcement. For a caller adding SEVERAL at once, which
   *  says "3 pieces added." itself — seven separate announcements for one gesture is
   *  worse than none, and it is the only reason this option exists. */
  silent?: boolean;
};

/** Place `item` and put it in the room. Returns the new part's id.
 *
 *  `aim` is a world x/z. Omit it for a Library click, where there is no aimed point
 *  and `openSpotForNewPart` looks for a clear one; pass the drop point for either
 *  tab's drag-and-drop. Passing `undefined` is not a fallback for "I could not work
 *  out the point" — it means the user did not aim, and it reaches `placeNewPart`'s
 *  own no-aim behaviour unchanged when the search also declines to name a spot.
 *
 *  **Parts come from `currentRoomScene()` and are not a parameter.** A caller cannot
 *  hand this the authored array by mistake, which is the entire point of the
 *  extraction — see the header. */
export function addPieceToRoom(item: NewPiece, aim?: [number, number], opts?: AddPieceOptions): string {
  const { room, addPart } = useScene.getState();
  const parts = currentRoomScene();

  const spot = aim ?? openSpotForNewPart(item.category, item.shape, item.dimMM, room, parts);
  const { pos, rot, wallMounted } = placeNewPart(item.category, item.shape, item.dimMM, room, parts, spot);

  const id = `${item.category}-${uuid().slice(0, 6)}`;
  addPart({
    id,
    category: item.category,
    name: item.label,
    shape: item.shape,
    pos,
    rot,
    dimMM: item.dimMM,
    locked: false,
    wallMounted,
  });
  useStudio.getState().setSelected(id);
  if (!opts?.silent) announce(`${item.label} added.`);
  return id;
}

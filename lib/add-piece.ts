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
// why `aim` is the parameter rather than three separate entry points. The promise has
// one exception, and it is the one a drag already enforces: the aim is not kept when
// something is standing there, and the piece takes the nearest clear spot instead.

import { v4 as uuid } from 'uuid';
import { announce } from './announce';
import { checkFit } from './fit-check';
import { groundY, isFloorStanding, isTabletopProne, ridesWall } from './physics';
import { currentRoomScene } from './room-scene';
import { useScene } from './scene-store';
import { useSettings, useStudio } from './store';
import { describeSpaceRefusal, refuseNewForSpace } from './space-bound';
import { formatDim } from './units';
import { placeArrival } from './duplicate-place';
import { isRoundPart, openSpotForNewPart, placeNewPart, type Category, type ScenePart, type Shape } from './scene-spec';

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
  /** The size is the user's OWN — typed into the Library ("sofa 228x95x83cm") rather
   *  than a preset's. What used to be the Room panel's "Will it fit" tab, folded into
   *  the one place pieces are added (the user's call, 2026-09-30: the tab read as a
   *  gimmick beside a Library that already understood a size).
   *
   *  For a piece that stands on the floor it changes WHERE the piece goes: `checkFit`
   *  seats it with everything already in the room held still, so it lands where it
   *  really fits, and a size with nowhere to go is refused with the reason rather than
   *  dropped on top of the sofa. Wall, ceiling and tabletop pieces are placed the
   *  ordinary way — `checkFit` is a floor question — and still meet the space bound. */
  ownSize?: boolean;
};

/** What happened. A refusal is a sentence for a person, already in their unit: the
 *  caller shows it, because a refusal nobody sees is the silent kind rule 2 forbids.
 *  `note` is set when the piece went in but something about the spot is worth saying
 *  (an own-size piece that only just fits). */
export type AddOutcome = { id: string; note?: string } | { refused: string };

/** Place `item` and put it in the room.
 *
 *  `aim` is a world x/z. Omit it for a Library click, where there is no aimed point
 *  and `openSpotForNewPart` looks for a clear one; pass the drop point for either
 *  tab's drag-and-drop. Passing `undefined` is not a fallback for "I could not work
 *  out the point" — it means the user did not aim, and it reaches `placeNewPart`'s
 *  own no-aim behaviour unchanged when the search also declines to name a spot.
 *
 *  **Parts come from `currentRoomScene()` and are not a parameter.** A caller cannot
 *  hand this the authored array by mistake, which is the entire point of the
 *  extraction — see the header.
 *
 *  **Refused when it is wider than the space it would have** (`lib/space-bound.ts`):
 *  a curtain longer than every wall, a sofa wider than the room. The user's ruling —
 *  "don't allow if it's wider than the available space" — and it is the same bound
 *  the Inspector's size fields hold, so a piece cannot be added at a size those fields
 *  would refuse. A wall piece with no aim that does not fit the wall it was given is
 *  offered the room's LONGEST wall before it is refused, because the unaimed spot is
 *  the app's choice and a curtain turned away from a 2 m wall while a 5 m wall stood
 *  empty would be the app refusing its own mistake. An aimed one is not moved: being
 *  placed where you aimed is a promise, and a drop somewhere else is not that drop.
 *
 *  **…except off another piece.** An aimed floor or ceiling piece whose spot is taken
 *  goes to the nearest clear one (`placeArrival`), because a drop must not make an
 *  overlap that no drag would allow. When nothing near is clear it keeps the aim and
 *  `note` says so. */
export function addPieceToRoom(item: NewPiece, aim?: [number, number], opts?: AddPieceOptions): AddOutcome {
  const { room, addPart } = useScene.getState();
  const parts = currentRoomScene();
  const unit = useSettings.getState().dimUnit;
  const len = (mm: number) => `${formatDim(mm, unit)} ${unit}`;

  let pose: { pos: [number, number, number]; rot: number; wallMounted: boolean; supportId: string | null };
  let note: string | undefined;

  const fitsTheFloorQuestion =
    opts?.ownSize && !aim && isFloorStanding(item.category, item.shape) && item.category !== 'rug' && !isTabletopProne(item.category);
  if (fitsTheFloorQuestion) {
    const fit = checkFit({ category: item.category, shape: item.shape, dimMM: item.dimMM, name: item.label }, parts, room);
    if (fit.status === 'too-tall') {
      return {
        refused: `${item.label} is ${len(item.dimMM[2])} tall, and the ceiling here is ${len(room.height * 1000)}. It would not stand up in this room.`,
      };
    }
    if (fit.status === 'no-room' || !fit.placement) {
      // `largestBay` is the ROOM's biggest rectangle of floor, with nothing in it — not
      // the clear floor left between the furniture. The retired panel called it "clear",
      // which read as "there is 3 × 3 m free" beside a bed filling the room. So it is
      // used for the one thing it can honestly say: whether this piece would go in the
      // room empty, which is what tells "move things" apart from "a smaller piece".
      const bay = fit.largestBay;
      const [w, d] = [item.dimMM[0] / 1000, item.dimMM[1] / 1000];
      const inEmptyRoom = bay !== null && ((w <= bay.width && d <= bay.depth) || (w <= bay.depth && d <= bay.width));
      return {
        refused:
          `There is nowhere clear for a ${formatDim(item.dimMM[0], unit)} × ${len(item.dimMM[1])} ${item.label.toLowerCase()} with what is already here.` +
          (inEmptyRoom
            ? ' It would fit this room empty, so it is the other pieces in the way. Fix or Ideas may make room by moving them.'
            : bay
              ? ` The largest rectangle of floor this room has is ${formatDim(bay.width * 1000, unit)} × ${len(bay.depth * 1000)}.`
              : ''),
      };
    }
    if (fit.status === 'tight' && fit.issues[0]) note = `It goes in, but it is tight: ${fit.issues[0].title}`;
    const { x, z, yaw } = fit.placement;
    pose = { pos: [x, groundY(item.category, item.shape, item.dimMM, room.height), z], rot: yaw, wallMounted: false, supportId: null };
  } else {
    const spot = aim ?? openSpotForNewPart(item.category, item.shape, item.dimMM, room, parts);
    pose = placeNewPart(item.category, item.shape, item.dimMM, room, parts, spot);
    let refused = refuseNewForSpace({ ...item, pos: pose.pos, rot: pose.rot }, room.footprint);
    if (refused && !aim && ridesWall(item.category, item.shape)) {
      const longest = longestWallAim(room.footprint);
      if (longest) {
        const again = placeNewPart(item.category, item.shape, item.dimMM, room, parts, longest);
        const still = refuseNewForSpace({ ...item, pos: again.pos, rot: again.rot }, room.footprint);
        if (!still) {
          pose = again;
          refused = null;
        } else refused = still;
      }
    }
    if (refused) return { refused: describeSpaceRefusal(item.label, refused, unit) };
    // An aimed drop goes where it was aimed — unless something is already standing
    // there. Two ceiling fans, one dropped in each tab at the same point, used to share
    // one hub, a state no drag would let you leave (`collidesAt` refuses it) and so one
    // the drop should not be able to make. The aim is asked the question Duplicate and
    // "Change the model" ask of an arrival: kept when it is clear, otherwise the nearest
    // clear spot — beside it along its own width first. Not for a piece that came to
    // rest ON something (a lamp dropped on a desk is meant to be on the desk) nor a
    // wall piece, which its wall snap has already placed.
    if (aim && !pose.supportId && !ridesWall(item.category, item.shape)) {
      const arriving: ScenePart = {
        id: '__drop__',
        name: item.label,
        category: item.category,
        shape: item.shape,
        dimMM: item.dimMM,
        pos: pose.pos,
        rot: pose.rot,
        locked: false,
        circle: isRoundPart(item.shape),
        wallMounted: pose.wallMounted,
      };
      const arrival = placeArrival(arriving, parts, room.footprint, room.height);
      if (!arrival.clear) note = 'Nothing near where it was dropped is clear, so it is touching what is there.';
      else if (!arrival.here) {
        pose = { ...pose, pos: [arrival.spot.pos[0], pose.pos[1], arrival.spot.pos[2]], rot: arrival.spot.rot };
        // Said, not silent: the piece is not where the hand let go of it.
        note = 'That spot was taken, so it went to the nearest clear one.';
      }
    }
  }
  const { pos, rot, wallMounted, supportId } = pose;
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
  // RECORD THE EDGE, and this is the half a review found missing rather than the
  // placement itself. `pos[1]` here came off `currentRoomScene()` — resolved parts
  // PLUS the rider-height correction — and it is written into the AUTHORED layer,
  // while `ridingParents` infers who rides what from the AUTHORED array within
  // `SUPPORT_Y_EPS` (50 mm). The two disagree the moment anything overrides the
  // support: resize a desk to 900 mm, drop a lamp, resize back to 750, and the lamp
  // is stored at 0.90 against an authored top of 0.75, rides nothing, and hangs
  // 150 mm in the air — invisible from directly above, and permanent, because
  // `normalizeStoredParts` does not settle and `settleHeights`' only production
  // caller is the detection builder. That is § 12's own failure shape arriving
  // through the door § 12 warned about.
  //
  // `Draggable.commit` has always recorded it for a DRAGGED piece. Not doing it here
  // is also what made a dropped lamp sit out of its desk's convoy while a dragged one
  // travelled with it: two ways to put a lamp on a desk, two behaviours.
  if (supportId) useStudio.getState().setParent(id, supportId);
  useStudio.getState().setSelected(id);
  if (!opts?.silent) announce(note ? `${item.label} added. ${note}` : `${item.label} added.`);
  return note ? { id, note } : { id };
}

/** The midpoint of the room's longest wall, as an aim — the one spot a wall piece
 *  with no aim is offered after the one it was given turns out too short. */
function longestWallAim(footprint: ReadonlyArray<readonly [number, number]>): [number, number] | null {
  let best: { len: number; at: [number, number] } | null = null;
  for (let i = 0; i < footprint.length; i++) {
    const a = footprint[i];
    const b = footprint[(i + 1) % footprint.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (!best || len > best.len) best = { len, at: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] };
  }
  return best?.at ?? null;
}

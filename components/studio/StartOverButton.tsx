'use client';

// "Start over", wherever the rail offers it: under the empty panel's prompt when
// nothing is selected, and as the footer's second row when something is.
//
// One component for both because it is one decision — whether there is anything to
// start over FROM — and two copies of that question are how two surfaces come to
// disagree about it. It is a labelled, full-width button rather than the old 32px
// square: it has a row of its own in both places now, so the words fit, and a verb
// that throws away an afternoon's arranging deserves to say so rather than lean on
// a glyph.
//
// What the start IS lives in `lib/room-start.ts`; this asks whether there is
// anything to undo. Its read of the override maps has no fallback, which is the case
// `lib/transforms.ts` allows: "has anything been overridden", not "what is this
// piece's transform".

import { useMemo } from 'react';
import { useStudio } from '@/lib/store';
import { useScene } from '@/lib/scene-store';
import { hasPieceEdits, sameParts, sameWalls, startingParts } from '@/lib/room-start';
import { Icon } from '@/components/ui/Icon';
import { useConfirm } from '@/components/ui/Confirm';
import { toast } from '@/components/ui/StorageToast';

// The start, remembered for the room it was built for. Both callers ask, and the
// empty panel MOUNTS on every deselect, so a per-component memo rebuilt the start —
// 15–50 ms in an L, T or U — on each click into empty floor. One entry is enough:
// the inputs change only when another room loads.
let startMemo: { source: unknown; room: unknown; parts: ReturnType<typeof startingParts> } | null = null;
function openedStartOf(source: Parameters<typeof startingParts>[0], room: Parameters<typeof startingParts>[1]) {
  if (startMemo?.source !== source || startMemo.room !== room) startMemo = { source, room, parts: startingParts(source, room) };
  return startMemo.parts;
}

/** Whether the room differs from how it first opened. Asked as BOOLEANS so a
 *  caller re-renders when the answer flips and not on every drag frame. */
export function useCanStartOver(): boolean {
  // The override maps first: any entry is an edit, and a room that has one never
  // builds its start.
  const pieceEdits = useStudio((s) => hasPieceEdits(s));
  const startSource = useScene((s) => s.startSource);
  const startRoom = useScene((s) => s.startRoom);
  // The walls are part of the start: a wall dragged, or the ceiling changed, is
  // something to start over from — and a wall drag carries the furniture with it, so
  // it is never only the walls.
  const wallsMoved = useScene((s) => !sameWalls(s.room, s.startRoom));
  // The start, built once per room load (and not at all while anything else already
  // answers the question) — never per wall-drag frame, which is what keying it on
  // today's `room` did: 15–50 ms a step in an L, T or U.
  const openedStart = useMemo(
    () => (pieceEdits || wallsMoved ? null : openedStartOf(startSource, startRoom)),
    [pieceEdits, wallsMoved, startSource, startRoom],
  );
  const sceneEdited = useScene((s) => openedStart !== null && !sameParts(s.parts, openedStart));
  return pieceEdits || wallsMoved || sceneEdited;
}

export function StartOverButton() {
  const confirm = useConfirm();
  return (
    <button
      type="button"
      className="ds-btn ds-btn--sm rail-wide"
      aria-label="Start over: put the room back the way it first opened"
      onClick={async () => {
        const ok = await confirm({
          title: 'Start over?',
          body: 'The room goes back to how it first opened: its walls, and every piece where it started. Pieces you added are removed. Wall colours and lighting stay.',
          confirmLabel: 'Start over',
          danger: true,
          // The bin said "delete"; this puts things back.
          icon: 'rotate-ccw',
        });
        if (ok) startOver();
      }}
    >
      <Icon name="rotate-ccw" size={12} />
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>Start over</span>
    </button>
  );
}

/** Put the room back the way it first opened — the walls, the ceiling and every
 *  piece — with an Undo that brings back exactly what was there. Pieces, the move /
 *  turn / size overrides, what rides on what, what is hidden, the locks and the
 *  selection — a selected piece the start does not have would leave the Inspector
 *  open on nothing. The wall paint, the site and the lighting stay, which the
 *  confirm says.
 *
 *  It USED to keep the walls and re-lay the start inside today's, which read fine on
 *  paper and wrong on the first press: drag a wall, the drag carries the furniture,
 *  the button lights, and pressing it handed back a different ARRANGEMENT — a
 *  starter laid out for walls the room never opened with. Nobody asked for a new
 *  layout; they asked for the room back.
 *
 *  Locks stay on the pieces the start still has and go with the ones it does not
 *  (Ctrl+Z brings them back with the pieces; locks are in history, `lib/history.ts`):
 *  a lock is a promise about a piece, not an edit to it.
 *
 *  Undo writes only into the room it came from. The toast outlives the room — it is
 *  mounted at the app root — so pressing it after opening another room wrote this
 *  room's pieces into that one, and `RoomSync` saved them there. */
export function startOver() {
  const scene = useScene.getState();
  const studio = useStudio.getState();
  const start = startingParts(scene.startSource, scene.startRoom);
  const roomId = scene.loadedRoomId;
  const before = {
    parts: scene.parts,
    positions: studio.positions,
    rotations: studio.rotations,
    dims: studio.dims,
    parentIds: studio.parentIds,
    hidden: studio.hidden,
    pinned: studio.pinned,
    selection: studio.selection,
    selectedPartId: studio.selectedPartId,
    room: scene.room,
  };
  const kept = new Set(start.map((p) => p.id));
  // The shape comes back; the paint and the site are today's. The typical-size mark
  // travels WITH the shape: walls going back to a typical size are typical again,
  // while a room whose walls never moved keeps today's answer — "these sizes are
  // right" said over the very walls being kept is still true.
  const { width, depth, height, layoutId, footprint } = scene.startRoom;
  const { roughSize: _today, ...rest } = scene.room;
  const typical = sameWalls(scene.room, scene.startRoom) ? scene.room.roughSize : scene.startRoom.roughSize;
  const room = { ...rest, width, depth, height, layoutId, footprint, ...(typical ? { roughSize: true as const } : {}) };
  useScene.setState({ parts: start, room, ready: true });
  studio.resetTransforms();
  studio.setHiddenMap({});
  studio.setPinnedMap(Object.fromEntries(Object.entries(studio.pinned).filter(([id]) => kept.has(id))));
  studio.setSelected(null);
  toast({
    title: 'The room is back to how it started',
    ttl: 6000,
    action: {
      label: 'Undo',
      onClick: () => {
        if (useScene.getState().loadedRoomId !== roomId) return;
        useScene.setState({ parts: before.parts, room: before.room });
        useStudio.setState({
          positions: before.positions,
          rotations: before.rotations,
          dims: before.dims,
          parentIds: before.parentIds,
          hidden: before.hidden,
          pinned: before.pinned,
          selection: before.selection,
          selectedPartId: before.selectedPartId,
          selectedWall: null,
        });
      },
    },
  });
}

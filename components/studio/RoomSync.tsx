'use client';

// Single component handling all studio↔IDB plumbing for the active room.
// Loads room meta + scene + transforms on mount. Subscribes to changes,
// debounce-writes back to IDB.

import { useCallback, useEffect, useRef } from 'react';
import { useParams } from 'next/navigation';
import { markRoughSize, roomStore, saveTime, type PendingWrite, type RoomData, type Transforms } from '@/lib/storage';
import { useScene } from '@/lib/scene-store';
import { useStudio } from '@/lib/store';
import { livingParents } from '@/lib/rigid-parent';
import { seedHistory } from '@/lib/history';
import type { ScenePart } from '@/lib/scene-spec';
import { normalizeStoredParts } from '@/lib/scene-spec';
import { toast } from '@/components/ui/StorageToast';
import { onPageLeave } from '@/lib/page-leave';
import { clearLeaveNote, leaveNoteOf, pendingOf, readLeaveNote, writeLeaveNote } from '@/lib/leave-note';

const DEBOUNCE_MS = 300;

/** The room shell as `useScene` holds it — derived from the store rather than
 *  re-declared, so a field added there cannot be silently dropped from the write
 *  below. */
type SceneRoom = ReturnType<typeof useScene.getState>['room'];

/** The stored room with the live shell written over it — what both of the room's writes
 *  store, the debounced one and the one on the way out of the page. The rough-size mark
 *  comes from the live room, never the stored one — see `markRoughSize`: the stored record
 *  trails the studio by a save, and keeping its mark would put back one just cleared. */
function withShell(stored: RoomData, room: SceneRoom): RoomData {
  return markRoughSize(
    {
      ...stored,
      width: room.width,
      depth: room.depth,
      height: room.height,
      wallColors: room.wallColors,
      footprint: room.footprint,
      site: room.site,
    },
    room.roughSize === true,
  );
}

function transformsOf(s: ReturnType<typeof useStudio.getState>): Transforms {
  return {
    positions: s.positions,
    rotations: s.rotations,
    dims: s.dims,
    parentIds: s.parentIds,
    hidden: s.hidden,
    pinned: s.pinned,
  };
}

export function RoomSync() {
  const { roomId } = useParams<{ roomId: string }>();
  const loadFromRoom = useScene((s) => s.loadFromRoom);
  const setParts = useScene((s) => s.setParts);
  const loadTransforms = useStudio((s) => s.loadTransforms);
  const setHiddenMap = useStudio((s) => s.setHiddenMap);
  const setPinnedMap = useStudio((s) => s.setPinnedMap);
  const setParentIds = useStudio((s) => s.setParentIds);
  const transformTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sceneTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const roomTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ready = useRef(false);
  /** The room shell and the part list as they were when the room last changed, held
   *  so the debounced write and the unmount flush use the same values rather than
   *  re-reading a store that may already hold another room. */
  const pendingRoom = useRef<{ room: SceneRoom; parts: ScenePart[] } | null>(null);
  /** Whether ANY event in the current debounce window reshaped the footprint. A local
   *  in the subscriber loses this the moment a second room change replaces the
   *  timer. */
  const reshapedSince = useRef(false);

  /** Whatever the three saves below still have waiting, written as ONE transaction
   *  (`roomStore.savePending`), whichever of them comes due first — its timer, the room
   *  unmounting, or the page going away. Each timer is forgotten as its part is taken, so
   *  the next caller finds nothing to write.
   *
   *  One save rather than three, on every path and not only on the way out, because the
   *  three change together: a wall move is a new outline and the furniture it carried,
   *  and saved apart, a reload between the room's write and the positions' came back with
   *  one and not the other. Nothing between them can land now, whichever timer fires.
   *
   *  `roomId` is the caller's, never read off the render, because an effect's cleanup runs
   *  for the room it was set up for. `leaving` is the page going away, where a save with a
   *  room edit in it also leaves a note (`lib/leave-note.ts`), because that save has to read
   *  the room before it can write it and a reload does not wait for the read. */
  const saveWaiting = useCallback((roomId: string, leaving = false) => {
    const w: PendingWrite = {};
    let shell: SceneRoom | undefined;
    if (transformTimer.current) {
      clearTimeout(transformTimer.current);
      transformTimer.current = null;
      w.transforms = transformsOf(useStudio.getState());
    }
    if (sceneTimer.current) {
      clearTimeout(sceneTimer.current);
      sceneTimer.current = null;
      w.parts = useScene.getState().parts;
    }
    if (roomTimer.current) {
      clearTimeout(roomTimer.current);
      roomTimer.current = null;
      const p = pendingRoom.current;
      pendingRoom.current = null;
      const wasReshaped = reshapedSince.current;
      reshapedSince.current = false;
      // ── A reshaped room has to pin the scene, if it was SEEDED ───────────────
      //
      // A wall move writes the outline here and the transform overrides for whatever
      // rode the wall, and until the pin nothing wrote a scene snapshot at all — the
      // scene subscriber below fires on `state.parts`, and a wall move does not touch
      // `parts`. So the next open ran `buildSceneFromRoom`, which for a room with no
      // detections re-seeds through `defaultScene` **against the new polygon**, and the
      // saved overrides landed on whatever came back, by id.
      //
      // Measured in `tests/custom-footprint-seed.test.ts`: over 300 wall moves of
      // the picker's own five presets, the re-seed loses ids, gains ids, and keeps
      // ids whose piece is now a different size — the worst single move loses **9 of
      // 16 pieces** — and, of the ids that survive byte-identical, it TURNS 867 and
      // RELOCATES 2336 by more than 50 mm. A rectangle churns only two cells and still
      // relocates 282 pieces, which is what says the damage is not about notches. At a
      // typed 3.5 x 6 a `lamp-1` comes back a ceiling pendant 2.58 m up, one arrow press
      // on an edge that does not change the room's size. Watched in a browser too: 8 of
      // 8 T edges wrote no scene key, and four handed back a room that disagreed with
      // the one on screen before leaving, in both directions.
      //
      // **Reshaped, not merely changed.** Repainting a wall cannot alter what the
      // seeder builds, and pinning on a colour change would take a re-scan away from
      // a detected room for no reason. Object identity is the test because
      // `moveWall` writes a fresh polygon array — and so does `setRoom` on any
      // width/depth change, which is deliberate rather than incidental: typing a new
      // width in the Room rail re-seeds exactly the same way a dragged wall does, so
      // it wants exactly the same pin. A height-only edit preserves the reference and
      // correctly writes nothing. `tests/wall-move-pins-scene.test.tsx` covers all
      // three.
      //
      // **It is STICKY across the debounce window, and that is not tidiness.** The
      // flag lived in the subscriber's own closure, and `roomTimer` is shared: nudge
      // a wall and click a colour swatch 200 ms later and the second event cleared
      // the first's timer and installed one carrying `reshaped === false`. The wall
      // move's own outline still landed, so the room came back the new shape with the
      // furniture re-seeded — the exact loss this write exists to prevent, reachable
      // by two ordinary gestures in one third of a second.
      //
      // **Only a room the picker built, and the SECOND half of that test is the one
      // that is easy to get wrong.** A detected room does not re-seed:
      // `buildSceneFromRoom` builds from the detections and the footprint only clamps
      // pieces back inside, so its ids are already stable and it needs no pin —
      // leaving it unpinned is what keeps `CLAUDE.md`'s re-scan path working. But
      // `detectedObjects` answers what HAS been scanned, never what is about to be:
      // a room with four photographs and no detections is precisely the room a first
      // scan is coming to, and `RoomSync`'s own load prefers a saved scene over
      // `buildSceneFromRoom` forever, with nothing but `destroyRoom` ever clearing
      // the key. Pinning one would have made *Detect furniture* — a shipped button on
      // the rooms page, and *Re-scan* inside the studio — silently do nothing, for good.
      // So captures are asked about too, and the pin is for a picker room: no photos,
      // no detections, the only room `defaultScene` re-seeds from scratch. Those two
      // questions are asked of the STORED room, inside the save's one transaction.
      //
      // That a saved scene disables every future re-scan is WIDER than this change
      // and predates it — any added or deleted piece does the same — and it is filed
      // in `docs/what-is-still-open.md` § G.1 rather than fixed here, because
      // clearing the key on a scan would discard a user's deletions and that is a
      // product call.
      //
      // `p.parts` is the list as it was when the room changed. Had the parts changed
      // since, the scene's own timer is waiting too, its newer list rides this save as
      // `w.parts`, and `savePending` stores that one over the pin; so whichever is
      // stored is the room's latest. (This once read the live store after two awaits,
      // and could file the next room's furniture under this one; nothing here awaits
      // now.)
      if (p) {
        shell = p.room;
        w.room = { edit: (stored) => withShell(stored, p.room), pin: wasReshaped ? p.parts : undefined };
      }
    }
    if (!w.transforms && w.parts === undefined && !w.room) return;
    // The whole save, as data, so a reload that ends it before its read comes back can be
    // finished by the next open. Cleared once it lands on a page still alive to see it. The
    // save and its note share one time, which is what each part the save writes is stamped
    // with, and what tells the next open whether it landed (`lib/leave-note.ts`).
    const at = saveTime();
    w.at = at;
    const noted =
      leaving && shell !== undefined &&
      writeLeaveNote(roomId, leaveNoteOf(at, shell, { transforms: w.transforms, parts: w.parts, pin: w.room?.pin }));
    roomStore.savePending(roomId, w).then(() => {
      if (noted) clearLeaveNote(roomId, at);
    }).catch((e) => {
      // None of it landed. What is on screen is still whole, and the next save of each
      // kind writes it whole again — the positions, the scene and the shell are each
      // written entire — except the pin, which only the reshape knew to ask for. Asked
      // for again, or the next save stores the new outline with no scene, and the room
      // re-seeds its furniture against it on the next open. `savePending` has already
      // said so if the storage is full.
      if (w.room?.pin !== undefined) reshapedSince.current = true;
      console.error('[room] could not be saved', e);
    });
  }, []);

  // Initial load: room meta → scene; cached scene parts override; transforms last.
  useEffect(() => {
    if (!roomId) return;
    ready.current = false;
    // Even for the room the store already holds: it may have changed in another tab.
    useScene.getState().setHydrated(null);
    let live = true;
    (async () => {
      // The last change made before a reload, if the reload ended its save (`lib/leave-note.ts`):
      // finished first, so the room read below is the room as it was left. Each part is
      // written only if nothing has written it since. One try: if it fails, the room opens as
      // stored and the note goes, because a change seen missing here and worked past is not
      // one to put back at some later open. `savePending` has said so if the storage is full.
      // It goes only once that room is on screen, though: when the read below fails too, the
      // user has seen no room at all, and the note is the one copy of their change.
      const note = readLeaveNote(roomId);
      let unfinished: number | undefined;
      if (note) {
        try {
          await roomStore.savePending(roomId, pendingOf(note, (stored, shell) => withShell(stored, shell as SceneRoom)));
          clearLeaveNote(roomId, note.at);
        } catch (err) {
          console.error('[room] could not finish the last change before the reload', err);
          unfinished = note.at;
        }
      }
      let loaded: [Awaited<ReturnType<typeof roomStore.loadRoom>>, ScenePart[] | undefined, Awaited<ReturnType<typeof roomStore.loadTransforms>>];
      try {
        loaded = await Promise.all([
          roomStore.loadRoom(roomId),
          roomStore.loadSceneParts<ScenePart[]>(roomId),
          roomStore.loadTransforms(roomId),
        ]);
      } catch (err) {
        // Storage unreadable: a private window, blocked site data, a broken record.
        // The veil must still lift (an opaque "Opening your room…" forever is worse
        // than any room), and `ready` stays FALSE, so nothing below writes: the
        // starter room on screen must never be saved over the room that could not
        // be read.
        console.error('[room] could not read the room', err);
        if (!live) return;
        loadFromRoom(undefined);
        useScene.getState().setHydrated(roomId);
        toast({
          tone: 'danger',
          title: 'This room could not be opened',
          message: 'This browser would not let Danmu read it. A starter room is showing, and nothing you do here will be saved over yours.',
        });
        return;
      }
      if (!live) return;
      if (unfinished !== undefined) clearLeaveNote(roomId, unfinished);
      const [room, savedScene, t] = loaded;
      loadFromRoom(room);
      // If user previously edited / deleted parts, prefer that snapshot over rebuild from detections.
      // An empty array is a room the user emptied on purpose, NOT a missing
      // snapshot — `loadSceneParts` returns undefined for that. Treating [] as
      // "nothing saved" rebuilt the starter scene, so deleting every piece and
      // reloading brought all the furniture back.
      // Re-derived, not trusted. See `normalizeStoredParts` — this snapshot can be
      // older than the derivation that replaced the stored flag.
      if (savedScene) setParts(normalizeStoredParts(savedScene));
      // Every override is reset, whether or not this room saved any: the store outlives
      // the navigation, and `t` is undefined for a room that has never been edited at
      // all. Ids are `${category}-${counter}` and collide across rooms by construction,
      // so an inherited entry does not even miss — it lands on a different sofa, in a
      // room the user never touched. The positions, turns, sizes and hidden pieces were
      // reset only when this room had saved transforms of its own, so opening a room
      // never edited showed the last room's moves and sizes on its pieces, and its first
      // save stored them there. A size typed just before leaving made it certain: it is
      // committed on the way out (`RoomDimsEditor`, `Inspector`), into this same store.
      loadTransforms(t ?? {});
      setHiddenMap(t?.hidden ?? {});
      // The locks, for the same reason: a room with no saved `pinned` of its own would
      // otherwise inherit the PREVIOUS room's, and silently exempt a different sofa from
      // Suggest.
      setPinnedMap(t?.pinned ?? {});
      // And the rigid-parent edges. `snapshotDescendants` re-validates every edge
      // physically before trusting it, so a leaked entry can't cause a wrong
      // cascade — but there's no reason to leave it live when a clean reset
      // costs nothing.
      //
      // Pruned to the pieces that actually exist, and pruned HERE rather than
      // where parts are deleted: `removeParts` hands the user an Undo that
      // re-inserts them, and a delete-time prune would bring them back
      // unparented — where a surviving edge simply re-validates at the position
      // they returned to. So the map is allowed to go stale for a session and is
      // swept on the next load, which is what stops it growing forever in IDB.
      setParentIds(livingParents(t?.parentIds, useScene.getState().parts));
      ready.current = true;
      // The room on screen is this one now, so the canvas veil can lift.
      useScene.getState().setHydrated(roomId);
      // Record the loaded room as the state undo returns *to*. Without a
      // baseline, `undo()` has nothing before the current entry and the first
      // edit of every session is unreachable forever — worst case, that edit is
      // a delete. This has to happen here rather than where history subscribes:
      // subscription starts before the room loads, so the baseline would be the
      // default starter scene and the first undo would wipe the real room.
      seedHistory();
    })();
    return () => {
      live = false;
      // Leaving this room, so the next one to open (or this one, revisited) starts
      // behind the veil from its first paint rather than one frame after it.
      useScene.getState().setHydrated(null);
    };
  }, [roomId, loadFromRoom, setParts, loadTransforms, setHiddenMap, setPinnedMap, setParentIds]);

  // Persist transform changes — through `saveWaiting`, when the timer fires and on
  // unmount (leaving the room inside the app). Leaving the PAGE is the way-out save's, below.
  useEffect(() => {
    if (!roomId) return;
    const flush = () => saveWaiting(roomId);
    const unsub = useStudio.subscribe((state, prev) => {
      if (!ready.current) return;
      if (
        state.positions === prev.positions &&
        state.rotations === prev.rotations &&
        state.dims === prev.dims &&
        state.parentIds === prev.parentIds &&
        state.hidden === prev.hidden &&
        state.pinned === prev.pinned
      )
        return;
      if (transformTimer.current) clearTimeout(transformTimer.current);
      transformTimer.current = setTimeout(flush, DEBOUNCE_MS);
    });
    return () => {
      unsub();
      flush();
    };
  }, [roomId, saveWaiting]);

  // Persist room-shell changes — wall paint + wall moves (width/depth). Merges
  // into the existing meta so detections / name / layout survive.
  useEffect(() => {
    if (!roomId) return;
    const flush = () => saveWaiting(roomId);
    const unsub = useScene.subscribe((state, prev) => {
      if (!ready.current) return;
      if (state.room === prev.room) return;
      if (roomTimer.current) clearTimeout(roomTimer.current);
      if (state.room.footprint !== prev.room.footprint) reshapedSince.current = true;
      pendingRoom.current = { room: state.room, parts: state.parts };
      roomTimer.current = setTimeout(flush, DEBOUNCE_MS);
    });
    return () => {
      unsub();
      // Flush, like the transform and scene effects either side of this one. It
      // cleared the timer and wrote nothing, so a wall dragged within the debounce
      // window of leaving the room lost BOTH the outline and the pin — the outline
      // half predates the pin and was silent data loss on its own.
      flush();
    };
  }, [roomId, saveWaiting]);

  // Persist scene-part edits (label, shape, dim, deletes, additions)
  useEffect(() => {
    if (!roomId) return;
    // Same as transforms: leaving within the debounce window otherwise dropped the
    // last add or delete.
    const flush = () => saveWaiting(roomId);
    const unsub = useScene.subscribe((state, prev) => {
      if (!ready.current) return;
      if (state.parts === prev.parts) return;
      if (sceneTimer.current) clearTimeout(sceneTimer.current);
      sceneTimer.current = setTimeout(flush, DEBOUNCE_MS);
    });
    return () => {
      unsub();
      flush();
    };
  }, [roomId, saveWaiting]);

  // Leaving the PAGE — a reload, a closed tab, a phone backgrounding the browser — which
  // unmounts nothing (`lib/page-leave.ts`), so whatever is waiting goes now, as the one
  // save it always is. As separate saves, the leave kept whichever one the closing page
  // let finish, and a typed width came back on 4 of 5 closed tabs without the outline and
  // the scene that went with it (§ 47). `saveWaiting` forgets what it takes, so the second
  // of `visibilitychange` and `pagehide` finds nothing to write.
  useEffect(() => {
    if (!roomId) return;
    return onPageLeave('persist', () => saveWaiting(roomId, true));
  }, [roomId, saveWaiting]);

  return null;
}

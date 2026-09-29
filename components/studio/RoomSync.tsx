'use client';

// Single component handling all studio↔IDB plumbing for the active room.
// Loads room meta + scene + transforms on mount. Subscribes to changes,
// debounce-writes back to IDB.

import { useCallback, useEffect, useRef } from 'react';
import { useParams } from 'next/navigation';
import { markRoughSize, roomStore, type PendingWrite, type RoomData, type Transforms } from '@/lib/storage';
import { useScene } from '@/lib/scene-store';
import { useStudio } from '@/lib/store';
import { livingParents } from '@/lib/rigid-parent';
import { seedHistory } from '@/lib/history';
import type { ScenePart } from '@/lib/scene-spec';
import { normalizeStoredParts } from '@/lib/scene-spec';
import { toast } from '@/components/ui/StorageToast';
import { onPageLeave } from '@/lib/page-leave';

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
   *  for the room it was set up for. */
  const saveWaiting = useCallback((roomId: string) => {
    const w: PendingWrite = {};
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
      // `/workspace`, and *Re-scan* inside the studio — silently do nothing, for good.
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
      // `p.parts` — the list as it was when the room changed — never
      // `useScene.getState()`. This write is keyed to THIS room, and the live store may
      // already hold another room's parts; it would file room B's furniture under room A.
      if (p) w.room = { edit: (stored) => withShell(stored, p.room), pin: wasReshaped ? p.parts : undefined };
    }
    if (w.transforms || w.parts !== undefined || w.room) void roomStore.savePending(roomId, w);
  }, []);

  // Initial load: room meta → scene; cached scene parts override; transforms last.
  useEffect(() => {
    if (!roomId) return;
    ready.current = false;
    // Even for the room the store already holds: it may have changed in another tab.
    useScene.getState().setHydrated(null);
    let live = true;
    (async () => {
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
      if (t) {
        loadTransforms(t);
        if (t.hidden) setHiddenMap(t.hidden);
      }
      // Unconditional, for the reason `parentIds` below is and `hidden` above is
      // not: the store outlives the navigation, so a room with no saved `pinned`
      // of its own — every room saved before this shipped, and every room where
      // nothing has been locked — would otherwise inherit the PREVIOUS room's
      // locks. Ids are `${category}-${counter}` and collide across rooms by
      // construction, so the inherited entry does not even miss: it silently
      // exempts a different sofa from Suggest, in a room the user never locked
      // anything in. Outside the `if (t)` as well as inside it, because `t` is
      // undefined for a room that has never been edited at all.
      setPinnedMap(t?.pinned ?? {});
      // Unconditional, unlike `hidden` above: part ids are deterministic
      // (`${category}-${counter}`), so a room with no saved transforms of its
      // own would otherwise inherit whatever `parentIds` the PREVIOUS room
      // left live in the store. `snapshotDescendants` re-validates every edge
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
    return onPageLeave('persist', () => saveWaiting(roomId));
  }, [roomId, saveWaiting]);

  return null;
}

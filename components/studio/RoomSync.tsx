'use client';

// Single component handling all studio↔IDB plumbing for the active room.
// Loads room meta + scene + transforms on mount. Subscribes to changes,
// debounce-writes back to IDB.

import { useEffect, useRef } from 'react';
import { useParams } from 'next/navigation';
import { roomStore } from '@/lib/storage';
import { useScene } from '@/lib/scene-store';
import { useStudio } from '@/lib/store';
import { livingParents } from '@/lib/rigid-parent';
import { seedHistory } from '@/lib/history';
import type { ScenePart } from '@/lib/scene-spec';
import { normalizeStoredParts } from '@/lib/scene-spec';

const DEBOUNCE_MS = 300;

/** The room shell as `useScene` holds it — derived from the store rather than
 *  re-declared, so a field added there cannot be silently dropped from the write
 *  below. */
type SceneRoom = ReturnType<typeof useScene.getState>['room'];

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

  // Initial load: room meta → scene; cached scene parts override; transforms last.
  useEffect(() => {
    if (!roomId) return;
    ready.current = false;
    (async () => {
      const [room, savedScene, t] = await Promise.all([
        roomStore.loadRoom(roomId),
        roomStore.loadSceneParts<ScenePart[]>(roomId),
        roomStore.loadTransforms(roomId),
      ]);
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
      // Record the loaded room as the state undo returns *to*. Without a
      // baseline, `undo()` has nothing before the current entry and the first
      // edit of every session is unreachable forever — worst case, that edit is
      // a delete. This has to happen here rather than where history subscribes:
      // subscription starts before the room loads, so the baseline would be the
      // default starter scene and the first undo would wipe the real room.
      seedHistory();
    })();
  }, [roomId, loadFromRoom, setParts, loadTransforms, setHiddenMap, setPinnedMap, setParentIds]);

  // Persist transform changes
  useEffect(() => {
    if (!roomId) return;
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
      transformTimer.current = setTimeout(() => {
        roomStore.saveTransforms(roomId, {
          positions: state.positions,
          rotations: state.rotations,
          dims: state.dims,
          parentIds: state.parentIds,
          hidden: state.hidden,
          pinned: state.pinned,
        });
      }, DEBOUNCE_MS);
    });
    return () => {
      unsub();
      if (transformTimer.current) {
        // Flush immediately on unmount so navigating away before the debounce
        // settles doesn't lose the last rotation/position/dim change.
        clearTimeout(transformTimer.current);
        const s = useStudio.getState();
        roomStore.saveTransforms(roomId, {
          positions: s.positions,
          rotations: s.rotations,
          dims: s.dims,
          parentIds: s.parentIds,
          hidden: s.hidden,
          pinned: s.pinned,
        });
      }
    };
  }, [roomId]);

  // Persist room-shell changes — wall paint + wall moves (width/depth). Merges
  // into the existing meta so detections / name / layout survive.
  useEffect(() => {
    if (!roomId) return;
    const write = async () => {
      const p = pendingRoom.current;
      if (!p) return;
      // Taken and cleared BEFORE the first await. Both are read again on unmount,
      // and a flush that left them set would write the same room twice.
      pendingRoom.current = null;
      const wasReshaped = reshapedSince.current;
      reshapedSince.current = false;

      const existing = await roomStore.loadRoom(roomId);
      if (!existing) return;
      await roomStore.saveRoom({
        ...existing,
        width: p.room.width,
        depth: p.room.depth,
        height: p.room.height,
        wallColors: p.room.wallColors,
        footprint: p.room.footprint,
        site: p.room.site,
      });
      // ── A reshaped room has to pin the scene, if it was SEEDED ───────────────
      //
      // This effect writes the outline and `moveWallCarrying` writes the transform
      // overrides for whatever rode the wall, and until now nothing wrote a scene
      // snapshot at all — `RoomSync`'s scene subscriber below fires on
      // `state.parts`, and a wall move does not touch `parts`. So the next open ran
      // `buildSceneFromRoom`, which for a room with no detections re-seeds through
      // `defaultScene` **against the new polygon**, and the saved overrides landed
      // on whatever came back, by id.
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
      // no detections, the only room `defaultScene` re-seeds from scratch.
      //
      // That a saved scene disables every future re-scan is WIDER than this change
      // and predates it — any added or deleted piece does the same — and it is filed
      // in `docs/what-is-still-open.md` § G.1 rather than fixed here, because
      // clearing the key on a scan would discard a user's deletions and that is a
      // product call.
      if (wasReshaped && !existing.detectedObjects?.length && !(await roomStore.hasCaptures(roomId))) {
        // `p.parts` — the list as it was when the room changed — never
        // `useScene.getState()`. Two awaits have passed; the user may have navigated
        // to another room, whose parts the live store would now hold, and this write
        // is keyed to THIS room. It would file room B's furniture under room A.
        await roomStore.saveSceneParts(roomId, p.parts);
      }
    };

    const unsub = useScene.subscribe((state, prev) => {
      if (!ready.current) return;
      if (state.room === prev.room) return;
      if (roomTimer.current) clearTimeout(roomTimer.current);
      if (state.room.footprint !== prev.room.footprint) reshapedSince.current = true;
      pendingRoom.current = { room: state.room, parts: state.parts };
      roomTimer.current = setTimeout(() => void write(), DEBOUNCE_MS);
    });
    return () => {
      unsub();
      // Flush, like the transform and scene effects either side of this one. It
      // cleared the timer and wrote nothing, so a wall dragged within the debounce
      // window of leaving the room lost BOTH the outline and the pin — the outline
      // half predates the pin and was silent data loss on its own.
      if (roomTimer.current) {
        clearTimeout(roomTimer.current);
        void write();
      }
    };
  }, [roomId]);

  // Persist scene-part edits (label, shape, dim, deletes, additions)
  useEffect(() => {
    if (!roomId) return;
    const unsub = useScene.subscribe((state, prev) => {
      if (!ready.current) return;
      if (state.parts === prev.parts) return;
      if (sceneTimer.current) clearTimeout(sceneTimer.current);
      sceneTimer.current = setTimeout(() => {
        roomStore.saveSceneParts(roomId, state.parts);
      }, DEBOUNCE_MS);
    });
    return () => {
      unsub();
      if (sceneTimer.current) {
        // Flush on unmount, same as transforms: leaving the room within the
        // debounce window otherwise dropped the last add/delete.
        clearTimeout(sceneTimer.current);
        roomStore.saveSceneParts(roomId, useScene.getState().parts);
      }
    };
  }, [roomId]);

  return null;
}

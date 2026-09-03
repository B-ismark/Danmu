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
    const unsub = useScene.subscribe((state, prev) => {
      if (!ready.current) return;
      if (state.room === prev.room) return;
      if (roomTimer.current) clearTimeout(roomTimer.current);
      const r = state.room;
      // A wall MOVE is not a wall repaint, and only one of them changes what the
      // seeder would build. See below.
      const reshaped = state.room.footprint !== prev.room.footprint;
      roomTimer.current = setTimeout(async () => {
        const existing = await roomStore.loadRoom(roomId);
        if (!existing) return;
        await roomStore.saveRoom({
          ...existing,
          width: r.width,
          depth: r.depth,
          height: r.height,
          wallColors: r.wallColors,
          footprint: r.footprint,
          site: r.site,
        });
        // ── A wall move has to pin the scene, for a room that was SEEDED ──────
        //
        // This effect writes the outline and `moveWallCarrying` writes the transform
        // overrides for whatever rode the wall, and until now nothing wrote a scene
        // snapshot at all — `RoomSync`'s scene subscriber below fires on
        // `state.parts`, and a wall move does not touch `parts`. So the next open
        // ran `buildSceneFromRoom`, which for a room with no detections re-seeds
        // through `defaultScene` **against the new polygon**, and the saved
        // overrides landed on whatever came back, by id.
        //
        // Measured in `tests/custom-footprint-seed.test.ts`: over 300 wall moves of
        // the picker's own five presets, the re-seed loses ids, gains ids, and keeps
        // ids whose piece is now a different size. The worst single move loses **9 of
        // 16 pieces**. Watched happening in a browser too — 8 of 8 T edges wrote no
        // scene key, and four of them handed back a room that disagreed with the one
        // on screen before leaving, in both directions.
        //
        // **Only for a room with no detections, and that is the whole scope.** A
        // detected room does not re-seed: `buildSceneFromRoom` builds from the
        // detections and the footprint only clamps pieces back inside, so its part
        // ids are already stable across a wall move and it needs no pin. Leaving it
        // unpinned is what keeps `CLAUDE.md`'s re-scan path working — a detected room
        // the user has only MOVED things in still rebuilds `parts` from a new scan
        // while the moves re-apply by id.
        //
        // `reshaped` rather than any room change: repainting a wall cannot change
        // what the seeder builds, and pinning the scene on a colour change would take
        // a re-scan away from a detected room for no reason. It compares object
        // identity because `moveWall` writes a fresh polygon array every time and
        // nothing else in the store replaces that reference.
        if (reshaped && !existing.detectedObjects?.length) {
          await roomStore.saveSceneParts(roomId, useScene.getState().parts);
        }
      }, DEBOUNCE_MS);
    });
    return () => {
      unsub();
      if (roomTimer.current) clearTimeout(roomTimer.current);
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

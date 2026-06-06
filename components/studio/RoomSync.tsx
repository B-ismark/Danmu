'use client';

// Single component handling all studio↔IDB plumbing for the active room.
// Loads room meta + scene + transforms on mount. Subscribes to changes,
// debounce-writes back to IDB.

import { useEffect, useRef } from 'react';
import { useParams } from 'next/navigation';
import { roomStore } from '@/lib/storage';
import { useScene } from '@/lib/scene-store';
import { useStudio } from '@/lib/store';
import type { ScenePart } from '@/lib/scene-spec';

const DEBOUNCE_MS = 300;

export function RoomSync() {
  const { roomId } = useParams<{ roomId: string }>();
  const loadFromRoom = useScene((s) => s.loadFromRoom);
  const setParts = useScene((s) => s.setParts);
  const loadTransforms = useStudio((s) => s.loadTransforms);
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
      if (savedScene && savedScene.length > 0) setParts(savedScene);
      if (t) loadTransforms(t);
      ready.current = true;
    })();
  }, [roomId, loadFromRoom, setParts, loadTransforms]);

  // Persist transform changes
  useEffect(() => {
    if (!roomId) return;
    const unsub = useStudio.subscribe((state, prev) => {
      if (!ready.current) return;
      if (
        state.positions === prev.positions &&
        state.rotations === prev.rotations &&
        state.dims === prev.dims
      )
        return;
      if (transformTimer.current) clearTimeout(transformTimer.current);
      transformTimer.current = setTimeout(() => {
        roomStore.saveTransforms(roomId, {
          positions: state.positions,
          rotations: state.rotations,
          dims: state.dims,
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
      roomTimer.current = setTimeout(async () => {
        const existing = await roomStore.loadRoom(roomId);
        if (!existing) return;
        await roomStore.saveRoom({
          ...existing,
          width: r.width,
          depth: r.depth,
          height: r.height,
          wallColors: r.wallColors,
        });
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
      if (sceneTimer.current) clearTimeout(sceneTimer.current);
    };
  }, [roomId]);

  return null;
}

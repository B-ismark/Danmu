'use client';

import { create } from 'zustand';
import { defaultScene, buildSceneFromRoom, type ScenePart } from './scene-spec';
import { ROOM as ROOM_DEFAULT } from './parts-catalog';
import { footprintForLayout, type Footprint, type LayoutId } from './footprint';
import type { RoomData } from './storage';

type RoomShape = {
  width: number;
  depth: number;
  height: number;
  /** layout preset + derived polygon footprint (non-rectangular rooms). */
  layoutId: LayoutId;
  footprint: Footprint;
};

type SceneState = {
  parts: ScenePart[];
  /** room shell — dimensions + polygon footprint */
  room: RoomShape;
  ready: boolean;
  setParts: (p: ScenePart[]) => void;
  setRoom: (r: { width: number; depth: number; height: number }) => void;
  loadFromRoom: (room: RoomData | undefined) => void;
  /** scene mutations — user can edit, delete, add parts after detection. */
  updatePart: (id: string, patch: Partial<ScenePart>) => void;
  deletePart: (id: string) => void;
  addPart: (p: ScenePart) => void;
  /** merge: assign a shared groupId to the given parts (move together). */
  groupParts: (ids: string[]) => void;
  /** unmerge: clear groupId on the given parts. */
  ungroupParts: (ids: string[]) => void;
};

const DEFAULT_ROOM: RoomShape = {
  width: ROOM_DEFAULT.width,
  depth: ROOM_DEFAULT.depth,
  height: ROOM_DEFAULT.height,
  layoutId: 'rect',
  footprint: footprintForLayout('rect', ROOM_DEFAULT.width, ROOM_DEFAULT.depth),
};

export const useScene = create<SceneState>((set) => ({
  parts: defaultScene(),
  room: DEFAULT_ROOM,
  ready: false,
  setParts: (parts) => set({ parts, ready: true }),
  // Dimension edits re-derive the footprint from the current layout preset.
  setRoom: (r) =>
    set((s) => ({
      room: { ...s.room, ...r, footprint: footprintForLayout(s.room.layoutId, r.width, r.depth) },
    })),
  loadFromRoom: (room) => {
    if (!room) return set({ parts: defaultScene(), room: DEFAULT_ROOM, ready: true });
    const layoutId = (room.layoutId ?? 'rect') as LayoutId;
    set({
      parts: buildSceneFromRoom(room),
      room: {
        width: room.width,
        depth: room.depth,
        height: room.height,
        layoutId,
        footprint: footprintForLayout(layoutId, room.width, room.depth),
      },
      ready: true,
    });
  },
  updatePart: (id, patch) =>
    set((s) => ({ parts: s.parts.map((p) => (p.id === id ? { ...p, ...patch } : p)) })),
  deletePart: (id) => set((s) => ({ parts: s.parts.filter((p) => p.id !== id) })),
  addPart: (p) => set((s) => ({ parts: [...s.parts, p] })),
  groupParts: (ids) =>
    set((s) => {
      const gid = `g-${Date.now().toString(36)}`;
      const idset = new Set(ids);
      return { parts: s.parts.map((p) => (idset.has(p.id) ? { ...p, groupId: gid } : p)) };
    }),
  ungroupParts: (ids) =>
    set((s) => {
      const idset = new Set(ids);
      return { parts: s.parts.map((p) => (idset.has(p.id) ? { ...p, groupId: undefined } : p)) };
    }),
}));

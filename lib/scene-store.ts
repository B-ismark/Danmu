'use client';

import { create } from 'zustand';
import { defaultScene, buildSceneFromRoom, type ScenePart } from './scene-spec';
import { ROOM as ROOM_DEFAULT } from './parts-catalog';
import { footprintForLayout, wallSegments, type Footprint, type LayoutId } from './footprint';
import type { RoomData } from './storage';

type RoomShape = {
  width: number;
  depth: number;
  height: number;
  /** layout preset + derived polygon footprint (non-rectangular rooms). */
  layoutId: LayoutId;
  footprint: Footprint;
  /** per-wall paint colour, keyed by footprint-edge index. Missing = default
   *  shell colour (rendered in RoomShell). */
  wallColors: Record<number, string>;
};

/** Room resize clamps (metres) — match the dims editor's sane range. */
const MIN_ROOM = 1.0;
const MAX_ROOM = 40;

type SceneState = {
  parts: ScenePart[];
  /** room shell — dimensions + polygon footprint */
  room: RoomShape;
  ready: boolean;
  setParts: (p: ScenePart[]) => void;
  setRoom: (r: { width: number; depth: number; height: number }) => void;
  loadFromRoom: (room: RoomData | undefined) => void;
  /** paint one wall (by footprint-edge index). */
  setWallColor: (index: number, color: string) => void;
  /** paint every wall the same colour in one go. */
  setAllWallColors: (color: string) => void;
  /** clear a wall's paint (back to default), or all walls when no index given. */
  resetWallColor: (index?: number) => void;
  /** drag-move a wall: push it out (delta > 0) or in (delta < 0) by `delta`
   *  metres along its outward normal. Resolves to a width or depth change about
   *  the room centre and re-derives the footprint, so every centred-origin
   *  assumption downstream stays valid. */
  moveWall: (index: number, delta: number) => void;
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
  wallColors: {},
};

const clampRoom = (v: number) => Math.max(MIN_ROOM, Math.min(MAX_ROOM, v));

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
        wallColors: room.wallColors ?? {},
      },
      ready: true,
    });
  },
  setWallColor: (index, color) =>
    set((s) => ({ room: { ...s.room, wallColors: { ...s.room.wallColors, [index]: color } } })),
  setAllWallColors: (color) =>
    set((s) => {
      const next: Record<number, string> = {};
      for (let i = 0; i < s.room.footprint.length; i++) next[i] = color;
      return { room: { ...s.room, wallColors: next } };
    }),
  resetWallColor: (index) =>
    set((s) => {
      if (index === undefined) return { room: { ...s.room, wallColors: {} } };
      const next = { ...s.room.wallColors };
      delete next[index];
      return { room: { ...s.room, wallColors: next } };
    }),
  moveWall: (index, delta) =>
    set((s) => {
      const segs = wallSegments(s.room.footprint);
      const seg = segs[index];
      if (!seg) return {};
      // Wall normal (XZ) is encoded in the segment yaw — yaw = atan2(nx, nz), so
      // nx = sin(yaw), nz = cos(yaw). A wall whose normal is more X-aligned is an
      // east/west wall (its out-push changes WIDTH); more Z-aligned → north/south
      // wall (changes DEPTH). The room stays centred about the origin.
      const nx = Math.sin(seg.yaw);
      const nz = Math.cos(seg.yaw);
      const axisIsWidth = Math.abs(nx) >= Math.abs(nz);
      const width = axisIsWidth ? clampRoom(s.room.width + delta) : s.room.width;
      const depth = axisIsWidth ? s.room.depth : clampRoom(s.room.depth + delta);
      return {
        room: {
          ...s.room,
          width,
          depth,
          footprint: footprintForLayout(s.room.layoutId, width, depth),
        },
      };
    }),
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

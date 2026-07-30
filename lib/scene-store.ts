'use client';

import { create } from 'zustand';
import { defaultScene, buildSceneFromRoom, type ScenePart } from './scene-spec';
import { ROOM as ROOM_DEFAULT } from './parts-catalog';
import { footprintForLayout, offsetWall, footprintBounds, type Footprint, type LayoutId } from './footprint';
import type { RoomData, Site } from './storage';

export type RoomShape = {
  width: number;
  depth: number;
  height: number;
  /** layout preset + derived polygon footprint (non-rectangular rooms). */
  layoutId: LayoutId;
  footprint: Footprint;
  /** per-wall paint colour, keyed by footprint-edge index. Missing = default
   *  shell colour (rendered in RoomShell). */
  wallColors: Record<number, string>;
  /** Where the room is and which way it faces, for the sun path. Absent until the
   *  user says — a latitude cannot be guessed, and guessing one would make the
   *  daylight study quietly wrong rather than obviously unset. */
  site?: Site;
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
  /** where the room is on earth + which way it faces (sun path). */
  setSite: (site: Site) => void;
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

export const useScene = create<SceneState>((set) => ({
  parts: defaultScene(),
  room: DEFAULT_ROOM,
  ready: false,
  setParts: (parts) => set({ parts, ready: true }),
  // Dimension edits re-derive the footprint from the current layout preset when
  // width/depth change (a W/D edit intentionally resets any custom wall moves to
  // the preset shape). A height-only edit keeps the current (possibly custom)
  // footprint so it isn't wiped.
  setRoom: (r) =>
    set((s) => {
      const wdChanged = r.width !== s.room.width || r.depth !== s.room.depth;
      return {
        room: {
          ...s.room,
          ...r,
          footprint: wdChanged ? footprintForLayout(s.room.layoutId, r.width, r.depth) : s.room.footprint,
        },
      };
    }),
  loadFromRoom: (room) => {
    if (!room) return set({ parts: defaultScene(), room: DEFAULT_ROOM, ready: true });
    const layoutId = (room.layoutId ?? 'rect') as LayoutId;
    // A saved custom footprint (from independent wall moves) is the source of
    // truth; otherwise derive the preset shape from the layout + dims.
    const footprint =
      room.footprint && room.footprint.length >= 3
        ? (room.footprint as Footprint)
        : footprintForLayout(layoutId, room.width, room.depth);
    set({
      parts: buildSceneFromRoom(room),
      room: {
        width: room.width,
        depth: room.depth,
        height: room.height,
        layoutId,
        footprint,
        wallColors: room.wallColors ?? {},
        site: room.site,
      },
      ready: true,
    });
  },
  setSite: (site) => set((s) => ({ room: { ...s.room, site } })),
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
      // Move ONLY this wall — its edge translates along its outward normal,
      // adjacent walls stretch, the opposite wall stays put. The room becomes
      // off-centre; width/depth are re-derived from the new bounding box and
      // every downstream consumer reads footprint bounds (not ±width/2).
      const poly = offsetWall(s.room.footprint, index, delta);
      const b = footprintBounds(poly);
      if (b.width < MIN_ROOM || b.depth < MIN_ROOM || b.width > MAX_ROOM || b.depth > MAX_ROOM) return {};
      return {
        room: { ...s.room, footprint: poly, width: b.width, depth: b.depth, layoutId: 'custom' },
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

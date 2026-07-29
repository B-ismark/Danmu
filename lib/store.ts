'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

// Studio view + interaction state. Mostly session-scoped: only the handful of
// fields in STUDIO_PREFS below survive a reload (see the persist config at the
// bottom of this store). Everything else — selection, transforms, camera, open
// drawers — is either per-room (saved by RoomSync) or genuinely ephemeral.
type ViewPreset = 'free' | 'front' | 'top' | 'iso';
/** Scene lighting mood — drives lights, environment + background in Room. */
export type Lighting = 'day' | 'evening' | 'cool';
/** Render quality — 'high' enables soft cast shadows, ambient occlusion and
 *  per-part procedural material maps. */
export type Quality = 'low' | 'high';

type StudioState = {
  selectedPartId: string | null;
  /** multi-select set (includes the primary). Drives highlight; the gizmo still
   *  attaches to selectedPartId only. */
  selection: string[];
  /** index of the currently selected wall (footprint edge), or null. Mutually
   *  exclusive with part selection — selecting a wall clears the part selection
   *  and vice versa, so the Inspector shows one or the other. */
  selectedWall: number | null;
  hoveredPartId: string | null;
  viewPreset: ViewPreset;
  /** map of cabinet door/drawer id -> open progress 0..1 */
  openState: Record<string, number>;
  /** id of part currently being dragged; disables OrbitControls + raycast cursor */
  draggingId: string | null;
  /** runtime overrides for part scene position [x, y, z]. Default positions come from each component. */
  positions: Record<string, [number, number, number]>;
  /** runtime Y-rotation overrides in radians. */
  rotations: Record<string, number>;
  /** runtime dimension overrides — [W, D, H] mm. Drives mesh scale + spec PDF. */
  dims: Record<string, [number, number, number]>;
  /** active gizmo mode (Maya-style) */
  transformMode: 'translate' | 'rotate' | 'scale';
  /** floor grid visibility (Paralives-style toggle) */
  showGrid: boolean;
  /** scene lighting mood */
  lighting: Lighting;
  /** render quality (soft shadows + AO + material maps on 'high') */
  quality: Quality;
  /** auto set-dressing — decorative props on furniture surfaces */
  dressed: boolean;
  /** Snap granularity for the gizmo. 'off' = free move, 'fine' = 10mm / 15°,
   *  'coarse' = 50mm / 45° (see SNAP in components/three/Draggable.tsx, which
   *  owns the real increments). Default is fine — coarse is too chunky for
   *  placing a monitor on a desk. */
  snapMode: 'off' | 'fine' | 'coarse';

  setSelected: (id: string | null) => void;
  /** set the whole selection at once (group click). primary becomes selectedPartId. */
  setSelection: (ids: string[], primary: string | null) => void;
  /** select a wall by footprint-edge index (or null to clear). Clears any part
   *  selection so the two never show at once. */
  setSelectedWall: (i: number | null) => void;
  /** shift-click: add/remove one id from the selection. */
  toggleInSelection: (id: string) => void;
  setHovered: (id: string | null) => void;
  setView: (v: ViewPreset) => void;
  toggleOpen: (id: string) => void;
  /** monotonically-incrementing token used to nudge CameraRig to frame the selected part. */
  frameSelectedToken: number;
  /** hidden parts (visibility toggle) — keyed by partId */
  hidden: Record<string, boolean>;

  setDragging: (id: string | null) => void;
  setPosition: (id: string, pos: [number, number, number]) => void;
  setRotation: (id: string, rot: number) => void;
  setDim: (id: string, dim: [number, number, number]) => void;
  setTransformMode: (m: 'translate' | 'rotate' | 'scale') => void;
  setSnapMode: (m: 'off' | 'fine' | 'coarse') => void;
  toggleGrid: () => void;
  setLighting: (l: Lighting) => void;
  setQuality: (q: Quality) => void;
  toggleDressed: () => void;
  frameSelected: () => void;
  toggleHidden: (id: string) => void;
  /** restore the whole hidden map from persistence (per-room, via RoomSync) */
  setHiddenMap: (h: Record<string, boolean>) => void;
  loadTransforms: (data: {
    positions?: Record<string, [number, number, number]>;
    rotations?: Record<string, number>;
    dims?: Record<string, [number, number, number]>;
  }) => void;
  /** Drop transform overrides — used by Reset-to-detected. Targets a specific id, or all. */
  resetTransforms: (id?: string) => void;
};

/** The only studio fields that survive a reload. These are *preferences* — the
 *  user set them once and expects them to stick, and the top bar's "saved"
 *  affordance implies the whole studio is remembered. Selection, camera, open
 *  drawers and transforms stay out: the first two are ephemeral by nature and
 *  the last is per-room, owned by RoomSync. */
const STUDIO_PREFS = ['lighting', 'quality', 'dressed', 'snapMode', 'showGrid'] as const;

export const useStudio = create<StudioState>()(
  persist(
    (set) => ({
  selectedPartId: null,
  selection: [],
  selectedWall: null,
  hoveredPartId: null,
  viewPreset: 'iso',
  openState: {},
  draggingId: null,
  positions: {},
  rotations: {},
  dims: {},
  transformMode: 'translate',
  snapMode: 'fine',
  showGrid: true,
  lighting: 'day',
  quality: 'high',
  dressed: true,
  frameSelectedToken: 0,
  hidden: {},

  setSelected: (id) => set({ selectedPartId: id, selection: id ? [id] : [], selectedWall: null }),
  setSelection: (ids, primary) => set({ selection: ids, selectedPartId: primary, selectedWall: null }),
  setSelectedWall: (i) => set({ selectedWall: i, selectedPartId: null, selection: [] }),
  toggleInSelection: (id) =>
    set((s) => {
      const has = s.selection.includes(id);
      const selection = has ? s.selection.filter((x) => x !== id) : [...s.selection, id];
      const selectedPartId = has ? (s.selectedPartId === id ? (selection[selection.length - 1] ?? null) : s.selectedPartId) : id;
      return { selection, selectedPartId };
    }),
  setHovered: (id) => set({ hoveredPartId: id }),
  setView: (v) => set({ viewPreset: v }),
  toggleOpen: (id) =>
    set((s) => ({ openState: { ...s.openState, [id]: s.openState[id] ? 0 : 1 } })),
  setDragging: (id) => set({ draggingId: id }),
  setPosition: (id, pos) => set((s) => ({ positions: { ...s.positions, [id]: pos } })),
  setRotation: (id, rot) => set((s) => ({ rotations: { ...s.rotations, [id]: rot } })),
  setDim: (id, dim) => set((s) => ({ dims: { ...s.dims, [id]: dim } })),
  setTransformMode: (m) => set({ transformMode: m }),
  setSnapMode: (m) => set({ snapMode: m }),
  toggleGrid: () => set((s) => ({ showGrid: !s.showGrid })),
  setLighting: (l) => set({ lighting: l }),
  setQuality: (q) => set({ quality: q }),
  toggleDressed: () => set((s) => ({ dressed: !s.dressed })),
  loadTransforms: (data) =>
    set({ positions: data.positions ?? {}, rotations: data.rotations ?? {}, dims: data.dims ?? {} }),
  resetTransforms: (id) =>
    set((s) => {
      if (!id) return { positions: {}, rotations: {}, dims: {} };
      const p = { ...s.positions };
      const r = { ...s.rotations };
      const d = { ...s.dims };
      delete p[id];
      delete r[id];
      delete d[id];
      return { positions: p, rotations: r, dims: d };
    }),
  frameSelected: () => set((s) => ({ frameSelectedToken: s.frameSelectedToken + 1 })),
  toggleHidden: (id) => set((s) => ({ hidden: { ...s.hidden, [id]: !s.hidden[id] } })),
  setHiddenMap: (hidden) => set({ hidden }),
    }),
    {
      name: 'danmu-studio-prefs',
      storage: createJSONStorage(() => localStorage),
      partialize: (s) =>
        Object.fromEntries(STUDIO_PREFS.map((key) => [key, s[key]])) as Partial<StudioState>,
    },
  ),
);

// Settings. Persisted to localStorage. API key kept here only on this device.
export type DimUnit = 'mm' | 'cm' | 'm' | 'in' | 'ft';

/** Why there is no `units: 'metric' | 'imperial'` here: there used to be, wired
 *  to a Settings control, and nothing ever read it — switching it changed
 *  nothing on screen while `dimUnit` (below) silently drove every dimension.
 *  One display unit, one owner. */
type SettingsState = {
  apiKey: string;
  /** Display unit for dimensions (W / D / H). All persistence stays in mm. */
  dimUnit: DimUnit;
  /** Last validation result for the current apiKey. null = not yet tested. */
  keyValid: boolean | null;
  /** Last reason if validation failed — a KeyFailure code, not an exception
   *  string (see lib/validate-key.ts). */
  keyValidReason: string | null;
  setApiKey: (k: string) => void;
  setDimUnit: (u: DimUnit) => void;
  setKeyValid: (v: boolean | null, reason?: string | null) => void;
};

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      apiKey: '',
      dimUnit: 'm',
      keyValid: null,
      keyValidReason: null,
      // Setting a new key invalidates the cached test result.
      setApiKey: (k) => set({ apiKey: k, keyValid: null, keyValidReason: null }),
      setDimUnit: (u) => set({ dimUnit: u }),
      setKeyValid: (v, reason) => set({ keyValid: v, keyValidReason: reason ?? null }),
    }),
    {
      name: 'danmu-settings',
      storage: createJSONStorage(() => localStorage),
      // never persist apiKey to anywhere except device localStorage — it already is
    },
  ),
);

// Active room id (single-room v0.1).
type RoomState = { roomId: string | null; setRoomId: (id: string | null) => void };
export const useRoom = create<RoomState>()(
  persist(
    (set) => ({ roomId: null, setRoomId: (id) => set({ roomId: id }) }),
    { name: 'danmu-room', storage: createJSONStorage(() => localStorage) },
  ),
);

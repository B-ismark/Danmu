'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { Currency } from './parts-catalog';

// Studio view + interaction state. Session-scoped, not persisted.
type ViewPreset = 'free' | 'front' | 'top' | 'iso';
type RenderMode = 'construction' | 'finish';
type StudioTab = 'plan' | 'photo' | 'iso' | 'model';
/** Scene lighting mood — drives lights, environment + background in Room. */
export type Lighting = 'day' | 'evening' | 'cool';
/** Render quality — 'high' enables soft cast shadows + floor reflection. */
export type Quality = 'low' | 'high';

type StudioState = {
  selectedPartId: string | null;
  /** multi-select set (includes the primary). Drives highlight; the gizmo still
   *  attaches to selectedPartId only. */
  selection: string[];
  hoveredPartId: string | null;
  viewPreset: ViewPreset;
  renderMode: RenderMode;
  infoMode: boolean;
  studioTab: StudioTab;
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
  /** render quality (soft shadows + floor reflection on 'high') */
  quality: Quality;
  /** auto set-dressing — decorative props on furniture surfaces */
  dressed: boolean;
  /** Snap granularity for the gizmo. 'off' = free move, 'fine' = 1cm / 2.5°,
   *  'coarse' = 5cm / 7.5°. Default is fine — coarse was the old behaviour
   *  but is too chunky for placing a monitor on a desk. */
  snapMode: 'off' | 'fine' | 'coarse';

  setSelected: (id: string | null) => void;
  /** set the whole selection at once (group click). primary becomes selectedPartId. */
  setSelection: (ids: string[], primary: string | null) => void;
  /** shift-click: add/remove one id from the selection. */
  toggleInSelection: (id: string) => void;
  setHovered: (id: string | null) => void;
  setView: (v: ViewPreset) => void;
  setMode: (m: RenderMode) => void;
  toggleInfo: () => void;
  setTab: (t: StudioTab) => void;
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
  loadTransforms: (data: {
    positions?: Record<string, [number, number, number]>;
    rotations?: Record<string, number>;
    dims?: Record<string, [number, number, number]>;
  }) => void;
  /** Drop transform overrides — used by Reset-to-detected. Targets a specific id, or all. */
  resetTransforms: (id?: string) => void;
};

export const useStudio = create<StudioState>((set) => ({
  selectedPartId: null,
  selection: [],
  hoveredPartId: null,
  viewPreset: 'iso',
  renderMode: 'construction',
  infoMode: true,
  studioTab: 'model',
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

  setSelected: (id) => set({ selectedPartId: id, selection: id ? [id] : [] }),
  setSelection: (ids, primary) => set({ selection: ids, selectedPartId: primary }),
  toggleInSelection: (id) =>
    set((s) => {
      const has = s.selection.includes(id);
      const selection = has ? s.selection.filter((x) => x !== id) : [...s.selection, id];
      const selectedPartId = has ? (s.selectedPartId === id ? (selection[selection.length - 1] ?? null) : s.selectedPartId) : id;
      return { selection, selectedPartId };
    }),
  setHovered: (id) => set({ hoveredPartId: id }),
  setView: (v) => set({ viewPreset: v }),
  setMode: (m) => set({ renderMode: m }),
  toggleInfo: () => set((s) => ({ infoMode: !s.infoMode })),
  setTab: (t) => set({ studioTab: t }),
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
}));

// Compose: style + budget + render model. Drives prompt + render.
type StyleId = 'warm-min' | 'afro-mod' | 'coastal' | 'studio' | 'heritage';
/** Render path. 'free' = Gemini Nano Banana (billed per image despite the name).
 *  'eco' = Imagen 4 standard. 'ultra' = Imagen 4 ultra. 'hf' = Hugging Face FLUX
 *  (BYO HF token; img2img Kontext when a base image exists, else text-to-image
 *  schnell — cheapest, ~$0.10/mo free credit). 'exp' = Gemini 2.0 Flash Exp —
 *  experimental native image generation, may be free while in preview.
 *  All bill per image except detection. */
export type RenderModel = 'free' | 'eco' | 'ultra' | 'hf' | 'exp';

type ComposeState = {
  styleId: StyleId;
  /** 0..100 budget bias */
  budget: number;
  renderModel: RenderModel;
  variants: number;
  /** user-edited prompt override. null = use generated; string = use as-is. */
  customPrompt: string | null;

  setStyle: (s: StyleId) => void;
  setBudget: (b: number) => void;
  setRenderModel: (m: RenderModel) => void;
  setVariants: (n: number) => void;
  setCustomPrompt: (p: string | null) => void;
};

export const useCompose = create<ComposeState>((set) => ({
  styleId: 'warm-min',
  budget: 42,
  renderModel: 'free',
  variants: 1,
  customPrompt: null,
  setStyle: (s) => set({ styleId: s, customPrompt: null }),
  setBudget: (b) => set({ budget: b, customPrompt: null }),
  setRenderModel: (m) => set({ renderModel: m }),
  setVariants: (n) => set({ variants: n }),
  setCustomPrompt: (p) => set({ customPrompt: p }),
}));

// Settings. Persisted to localStorage. API key kept here only on this device.
export type DimUnit = 'mm' | 'cm' | 'm' | 'in' | 'ft';

type SettingsState = {
  apiKey: string;
  currency: Currency;
  units: 'metric' | 'imperial';
  /** Display unit for dimensions (W / D / H). All persistence stays in mm. */
  dimUnit: DimUnit;
  /** Hard guard: require explicit confirmation before any paid Imagen render. */
  confirmPaidRenders: boolean;
  /** Last validation result for the current apiKey. null = not yet tested. */
  keyValid: boolean | null;
  /** Last reason if validation failed. */
  keyValidReason: string | null;
  /** Image-to-3D provider preference + BYO keys. Independent from Gemini key. */
  mesh3dProvider: 'meshy' | 'tripo' | 'off';
  meshyKey: string;
  tripoKey: string;
  /** Hugging Face access token (Inference Providers permission) for the HF FLUX
   *  render path. Independent from the Gemini key. Stored on-device only. */
  hfToken: string;
  setApiKey: (k: string) => void;
  setCurrency: (c: Currency) => void;
  setUnits: (u: 'metric' | 'imperial') => void;
  setDimUnit: (u: DimUnit) => void;
  setConfirmPaidRenders: (v: boolean) => void;
  setKeyValid: (v: boolean | null, reason?: string | null) => void;
  setMesh3dProvider: (p: 'meshy' | 'tripo' | 'off') => void;
  setMeshyKey: (k: string) => void;
  setTripoKey: (k: string) => void;
  setHfToken: (k: string) => void;
};

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      apiKey: '',
      currency: 'GHS',
      units: 'metric',
      dimUnit: 'm',
      confirmPaidRenders: true,
      keyValid: null,
      keyValidReason: null,
      mesh3dProvider: 'off',
      meshyKey: '',
      tripoKey: '',
      hfToken: '',
      // Setting a new key invalidates the cached test result.
      setApiKey: (k) => set({ apiKey: k, keyValid: null, keyValidReason: null }),
      setCurrency: (c) => set({ currency: c }),
      setUnits: (u) => set({ units: u }),
      setDimUnit: (u) => set({ dimUnit: u }),
      setConfirmPaidRenders: (v) => set({ confirmPaidRenders: v }),
      setKeyValid: (v, reason) => set({ keyValid: v, keyValidReason: reason ?? null }),
      setMesh3dProvider: (p) => set({ mesh3dProvider: p }),
      setMeshyKey: (k) => set({ meshyKey: k }),
      setTripoKey: (k) => set({ tripoKey: k }),
      setHfToken: (k) => set({ hfToken: k }),
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

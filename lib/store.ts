'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { daysInYear, localClock } from './solar';

// Studio view + interaction state. Mostly session-scoped: only the handful of
// fields in STUDIO_PREFS below survive a reload (see the persist config at the
// bottom of this store). Everything else — selection, transforms, camera, open
// drawers — is either per-room (saved by RoomSync) or genuinely ephemeral.
type ViewPreset = 'free' | 'front' | 'top' | 'iso';
/** Scene lighting mood — drives lights, environment + background in Room. */
export type Lighting = 'day' | 'evening' | 'cool' | 'sun';
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
  /** Space is held down. It is the camera modifier: while it is true the left
   *  button pans instead of orbiting, and no press may pick a piece up. Pure
   *  input state — never persisted, never part of a history snapshot. */
  panKeyHeld: boolean;
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
  /** Rail collapse. A view preference, so it persists next to showGrid — the
   *  canvas is the product, and 260 + 320px is 45% of a 1280px laptop. */
  railLeftOpen: boolean;
  railRightOpen: boolean;
  /** scene lighting mood */
  lighting: Lighting;
  /** render quality (soft shadows + AO + material maps on 'high') */
  quality: Quality;
  /** Which moment the 'sun' mood is showing: minutes past local midnight, and the
   *  day of the year. A time of day rather than a slider labelled "brightness" —
   *  the whole value of a real sun path is being able to ask about 4 pm in
   *  December, and the answer only means something if the question is a date. */
  sunMinutes: number;
  sunDayOfYear: number;
  /** Whether the two fields above are pinned to the device's own clock, ticking
   *  with it minute by minute (the ticker lives in `Room`, the only always-mounted
   *  consumer). Off by default: the moment someone wants to see is usually not the
   *  moment they opened the app, and a room asked about at 1 am is correctly black.
   *
   *  Scrubbing either slider clears it — the clock and the sliders cannot both own
   *  the value, and moving one is an unambiguous request to stop following the
   *  other. */
  sunLive: boolean;
  /** auto set-dressing — decorative props on furniture surfaces */
  dressed: boolean;
  /** Snap granularity for the gizmo. 'off' = free move, 'fine' = 10mm / 15°,
   *  'coarse' = 50mm / 45° (see SNAP in components/three/Draggable.tsx, which
   *  owns the real increments). Default is fine — coarse is too chunky for
   *  placing a monitor on a desk. */
  snapMode: 'off' | 'fine' | 'coarse';
  /** Whether the furniture catalog panel is open. It lives here rather than in a
   *  page because there is exactly ONE catalog and two triggers open it — the rail's
   *  "Add furniture" and the canvas toggle. When it was a modal in the rail AND a
   *  strip on the canvas, they were two component trees over two different item
   *  lists, and only one of them could drag a piece onto the floor. Not persisted:
   *  an open panel is a thing you are doing, not a preference. */
  catalogOpen: boolean;

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
  setPanKeyHeld: (held: boolean) => void;
  setPosition: (id: string, pos: [number, number, number]) => void;
  /** Move several parts in ONE store update. A wall drag re-positions everything
   *  standing on that wall on every animation frame; N separate `setPosition`
   *  calls meant N notifications per frame, each re-running every selector
   *  subscribed to this store. */
  setPositionsFor: (moves: Array<{ id: string; pos: [number, number, number] }>) => void;
  setRotation: (id: string, rot: number) => void;
  setDim: (id: string, dim: [number, number, number]) => void;
  setTransformMode: (m: 'translate' | 'rotate' | 'scale') => void;
  setSnapMode: (m: 'off' | 'fine' | 'coarse') => void;
  setCatalogOpen: (open: boolean) => void;
  toggleGrid: () => void;
  toggleRail: (side: 'left' | 'right') => void;
  setLighting: (l: Lighting) => void;
  setQuality: (q: Quality) => void;
  setSunMinutes: (m: number) => void;
  setSunDayOfYear: (d: number) => void;
  setSunLive: (on: boolean) => void;
  /** Snap the shown moment to the device clock. The one setter that leaves
   *  `sunLive` alone, which is what lets the ticker call it every minute without
   *  unpinning itself. */
  syncSunToNow: (now?: number) => void;
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
const STUDIO_PREFS = [
  'lighting',
  'quality',
  'dressed',
  'snapMode',
  'showGrid',
  'railLeftOpen',
  'railRightOpen',
  'sunMinutes',
  'sunDayOfYear',
  'sunLive',
] as const;

const clampMinutes = (m: number) => Math.min(1439, Math.max(0, Math.round(m)));

/** Day-of-year is clamped against the CURRENT year's length, not a flat 365, so
 *  31 December is reachable in a leap year. `localInstant` clamps the same way, so
 *  a 366 persisted in 2028 and read back in 2029 lands on 31 December rather than
 *  rolling into January. */
const clampDayOfYear = (d: number) =>
  Math.min(daysInYear(new Date().getFullYear()), Math.max(1, Math.round(d)));

/** The device clock, as the two fields the sun mood stores. */
function sunMomentNow(now?: number): { sunMinutes: number; sunDayOfYear: number } {
  const { dayOfYear, minutes } = localClock(now);
  return { sunMinutes: clampMinutes(minutes), sunDayOfYear: clampDayOfYear(dayOfYear) };
}

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
  panKeyHeld: false,
  positions: {},
  rotations: {},
  dims: {},
  transformMode: 'translate',
  snapMode: 'fine',
  showGrid: true,
  railLeftOpen: true,
  railRightOpen: true,
  lighting: 'day',
  quality: 'high',
  // 3 pm on the March equinox: the sun is up at every inhabited latitude and
  // clearly to one side, so the first thing anyone sees when they pick the sun
  // mood is a room with a direction to its light.
  sunMinutes: 15 * 60,
  sunDayOfYear: 80,
  sunLive: false,
  dressed: true,
  catalogOpen: false,
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
  // Key repeat fires keydown ~30×/second while Space is held. Bail on a no-op so
  // the whole scene does not re-render for every one of them.
  setPanKeyHeld: (held) => set((s) => (s.panKeyHeld === held ? s : { panKeyHeld: held })),
  setPosition: (id, pos) => set((s) => ({ positions: { ...s.positions, [id]: pos } })),
  setPositionsFor: (moves) =>
    set((s) => {
      // No-op returns {} rather than a fresh `positions` object: an identical-but-
      // new reference would look like an edit to history's subscription and push a
      // snapshot for a frame in which nothing moved.
      if (moves.length === 0) return {};
      const positions = { ...s.positions };
      for (const m of moves) positions[m.id] = m.pos;
      return { positions };
    }),
  setRotation: (id, rot) => set((s) => ({ rotations: { ...s.rotations, [id]: rot } })),
  setDim: (id, dim) => set((s) => ({ dims: { ...s.dims, [id]: dim } })),
  setTransformMode: (m) => set({ transformMode: m }),
  setCatalogOpen: (open) => set({ catalogOpen: open }),
  setSnapMode: (m) => set({ snapMode: m }),
  toggleGrid: () => set((s) => ({ showGrid: !s.showGrid })),
  toggleRail: (side) =>
    set((s) => (side === 'left' ? { railLeftOpen: !s.railLeftOpen } : { railRightOpen: !s.railRightOpen })),
  setLighting: (l) => set({ lighting: l }),
  setQuality: (q) => set({ quality: q }),
  setSunMinutes: (m) => set({ sunMinutes: clampMinutes(m), sunLive: false }),
  setSunDayOfYear: (d) => set({ sunDayOfYear: clampDayOfYear(d), sunLive: false }),
  setSunLive: (on) =>
    // Turning it on has to move the moment too, or the pin is announced while the
    // room stays lit by whatever hour was last scrubbed to.
    set(on ? { sunLive: true, ...sunMomentNow() } : { sunLive: false }),
  syncSunToNow: (now) => set(sunMomentNow(now)),
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

/** Whether some OTHER part/handle currently owns the active drag/gizmo gesture
 *  — the shared gate behind every pointer handler in Pickable/Draggable that
 *  must not let the cursor's screen position steal hover, selection or a new
 *  drag out from under whatever `draggingId` already names. `id` may be a real
 *  part id or a sentinel like `'__wall__'` (see WallHandles/PlanView); either
 *  way, ownership by anything other than `id` blocks. */
export function gestureOwnedByOther(id: string): boolean {
  const draggingId = useStudio.getState().draggingId;
  return draggingId !== null && draggingId !== id;
}

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
  /** How high off the floor the user holds the phone, in metres.
   *
   *  Remembered here rather than per room because it is a property of the person,
   *  not the room — the same shooter is the same height in the next one. The
   *  geometry engine assumed a flat 1.5 m, and distance scales linearly with this
   *  (∂d/∂h = d/h), so an unasked question was a ±17% error on every measurement
   *  taken from a photo. It is still written onto each capture's pose as the
   *  photo is saved, so a stored photo records what was believed when it was
   *  taken. */
  camHeightM: number;
  /** Whether the user has actually answered, as opposed to inheriting 1.5.
   *
   *  The difference matters downstream and cannot be recovered from the number
   *  itself: a photo whose height is merely the default should let the wall-floor
   *  line SOLVE for the height (see `buildCals` on the detect screen), while a
   *  height the user stated should not be overruled by a luminance heuristic that
   *  can lock onto a rug edge. Without this flag every photo carried a height and
   *  the solve was unreachable. */
  camHeightSet: boolean;
  /** Report step-free access in the room check — 1500 mm turning space, reachable
   *  routes. Off by default and remembered: whether a room has to meet this is a
   *  fact about the person using it, not about the room, so it belongs with the
   *  other per-device preferences rather than being asked again per room. */
  stepFree: boolean;
  setApiKey: (k: string) => void;
  setDimUnit: (u: DimUnit) => void;
  setKeyValid: (v: boolean | null, reason?: string | null) => void;
  setCamHeight: (m: number) => void;
  setStepFree: (on: boolean) => void;
};

/** Bounds on the remembered camera height. Outside these it is a typo, and a
 *  typo here silently rescales an entire room. */
export const CAM_HEIGHT_MIN = 0.8;
export const CAM_HEIGHT_MAX = 2.2;

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      apiKey: '',
      dimUnit: 'm',
      keyValid: null,
      keyValidReason: null,
      camHeightM: 1.5,
      camHeightSet: false,
      stepFree: false,
      // Setting a new key invalidates the cached test result.
      setApiKey: (k) => set({ apiKey: k, keyValid: null, keyValidReason: null }),
      setDimUnit: (u) => set({ dimUnit: u }),
      setKeyValid: (v, reason) => set({ keyValid: v, keyValidReason: reason ?? null }),
      setCamHeight: (m) =>
        set({
          camHeightM: Math.min(CAM_HEIGHT_MAX, Math.max(CAM_HEIGHT_MIN, m)),
          camHeightSet: true,
        }),
      setStepFree: (on) => set({ stepFree: on }),
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

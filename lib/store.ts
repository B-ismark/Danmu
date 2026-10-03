'use client';

import type { DetectorPack } from './model-verify';
import { useSyncExternalStore } from 'react';
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { DEFAULT_HOUR, hourNow, legacyLighting, wrapHour } from './lighting-moods';
import { landedLinks, landedLinksAll, type Landing } from './rigid-parent';

// Studio view + interaction state. Mostly session-scoped: only the handful of
// fields in STUDIO_PREFS below survive a reload (see the persist config at the
// bottom of this store). Everything else — selection, transforms, camera, open
// drawers — is either per-room (saved by RoomSync) or genuinely ephemeral.
type ViewPreset = 'free' | 'front' | 'top' | 'iso';
/** The two kinds of light — each drives lights, environment + background in Room.
 *
 *  An `as const` array with the union derived from it, for the reason
 *  `SHAPES`/`LAYOUT_IDS` are: a persisted value has to be checked against the
 *  vocabulary at runtime (see `merge` at the bottom of this store), and a union
 *  beside a hand-kept list drifts in the direction nobody notices.
 *
 *  `daylight` follows the clock (`hour`, below): sky, sun and moon are all derived
 *  from it in `lib/lighting-moods.ts`. `overcast` is the flat studio look and is
 *  hour-blind. There used to be five fixed moods here — three sun angles and two
 *  studio looks — and before THAT a single 'sun' mood driven by a latitude, a
 *  longitude, a date and a clock. The five became stops on one clock
 *  (`TIME_STOPS`), and `legacyLighting` is what maps a browser still holding one
 *  of their ids onto it. */
export const LIGHTINGS = ['daylight', 'overcast'] as const;
export type Lighting = (typeof LIGHTINGS)[number];
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
  /** rigid-parenting: childId -> parentId, established/broken automatically at
   *  drag-commit time (see `components/three/Draggable.tsx`'s `commit()`) when
   *  a floor-standing part lands on / off another. An edge here is a HINT, not
   *  a guarantee — `lib/rigid-parent.ts`'s `snapshotDescendants` re-validates
   *  each one physically against live positions before trusting it, so a
   *  relationship left stale by a programmatic mover (a solver layout, a saved
   *  Layout A/B, a wall carrying furniture) is inert rather than wrong. */
  parentIds: Record<string, string>;
  /** active gizmo mode (Maya-style) */
  transformMode: 'translate' | 'rotate' | 'scale';
  /** floor grid visibility (Paralives-style toggle) */
  showGrid: boolean;
  /** Rail collapse. A view preference, so it persists next to showGrid — the
   *  canvas is the product, and 260 + 320px is 45% of a 1280px laptop. */
  railLeftOpen: boolean;
  railRightOpen: boolean;
  /** Rail width in px, as the user last dragged it — `null` while they never
   *  have, which is not the same as "the token's current value" and is why this
   *  is nullable rather than seeded. A remembered width is a *preference*, and
   *  the shell still renders it inside the token's `clamp()`, so a 520px rail
   *  dragged on a monitor stays a ceiling rather than a promise on a laptop. */
  railLeftW: number | null;
  railRightW: number | null;
  /** scene lighting kind */
  lighting: Lighting;
  /** The time of day the daylight is drawn at, in hours [0, 24). Ignored while
   *  `lighting` is `overcast`. It opens at the person's own clock (`hourNow`) —
   *  here, and again on every room open (`RoomSync`) — and is NOT a remembered
   *  preference: a room opened in the evening is lit for the evening, whatever hour
   *  it was scrubbed to yesterday. In history beside the lighting kind all the same
   *  — a theme sets both in one gesture, so undoing the theme has to put both back. */
  hour: number;
  /** render quality (soft shadows + AO + material maps on 'high') */
  quality: Quality;
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
  /** The piece whose "Change the model" picker is open, or null. Here rather than in
   *  the Inspector for the same reason as `catalogOpen`: two triggers (the Inspector's
   *  button and the right-click menu) open one dialog, and the Inspector is not
   *  mounted in every shell. Not persisted. */
  swapPartId: string | null;

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
  /** Parts the user locked against **Fix** and **Shuffle** — keyed by partId.
   *
   *  What it blocks is *being moved by the solver*, and only that: a locked piece
   *  still drags, turns, resizes, recolours and deletes by hand. That is the
   *  narrow thing the user asked for — "lock down the models they don't want
   *  randomise to touch their position" — and it is why the field is not a
   *  general edit lock. `Draggable` and `PlanView` deliberately do not read it.
   *
   *  Named `pinned` rather than `locked` because `ScenePart.locked` already owns
   *  that identifier for "came out of your photo". The *label* is still "Lock",
   *  because the user-facing name for that flag is "From photo" — so the word is
   *  free on screen even though the identifier is not. A padlock used to sit in
   *  `PartTree` meaning the photo flag and was removed for saying the wrong
   *  thing; this is the same glyph returning with the meaning it always implied. */
  pinned: Record<string, boolean>;

  setDragging: (id: string | null) => void;
  setPanKeyHeld: (held: boolean) => void;
  setPosition: (id: string, pos: [number, number, number]) => void;
  /** Move several parts in ONE store update. A wall drag re-positions everything
   *  standing on that wall on every animation frame, and a multi-piece drag does
   *  the same for the whole convoy; N separate `setPosition` calls meant N
   *  notifications per frame, each re-running every selector subscribed to this
   *  store.
   *
   *  `rot` is optional because half the callers have nothing to say about it — a
   *  wall carries what is mounted on it without turning it. It is here rather than
   *  in a second `setRotationsFor` because a rigid cascade produces a position AND
   *  a rotation for the same piece in the same frame, and applying them as two
   *  updates renders one frame with the piece moved but not yet turned. */
  setTransformsFor: (moves: Array<{ id: string; pos: [number, number, number]; rot?: number }>) => void;
  setRotation: (id: string, rot: number) => void;
  setDim: (id: string, dim: [number, number, number]) => void;
  /** Establish (or overwrite) a rigid-parenting relationship. */
  setParent: (childId: string, parentId: string) => void;
  clearParent: (childId: string) => void;
  /** A drop: link the piece to what it landed on, or unlink it when it landed on
   *  nothing. See `landedLinks`. */
  landOn: (childId: string, supportId: string | undefined) => void;
  /** One gesture's landings — the piece under the hand and the rest of its set — in
   *  ONE update. See `landedLinksAll`, which is also why it is not a loop of `landOn`. */
  landAll: (landings: Landing[]) => void;
  /** restore the whole parentIds map from persistence (per-room, via RoomSync) */
  setParentIds: (map: Record<string, string>) => void;
  setTransformMode: (m: 'translate' | 'rotate' | 'scale') => void;
  setSnapMode: (m: 'off' | 'fine' | 'coarse') => void;
  setCatalogOpen: (open: boolean) => void;
  setSwapPartId: (id: string | null) => void;
  toggleGrid: () => void;
  toggleRail: (side: 'left' | 'right') => void;
  /** Commit a dragged rail width. `null` restores the token default. */
  setRailWidth: (side: 'left' | 'right', px: number | null) => void;
  setLighting: (l: Lighting) => void;
  /** Wrapped into [0, 24), so a drag past midnight is a time and not an error. */
  setHour: (h: number) => void;
  setQuality: (q: Quality) => void;
  toggleDressed: () => void;
  frameSelected: () => void;
  toggleHidden: (id: string) => void;
  /** restore the whole hidden map from persistence (per-room, via RoomSync) */
  setHiddenMap: (h: Record<string, boolean>) => void;
  togglePinned: (id: string) => void;
  /** restore the whole pinned map from persistence (per-room, via RoomSync) */
  setPinnedMap: (p: Record<string, boolean>) => void;
  loadTransforms: (data: {
    positions?: Record<string, [number, number, number]>;
    rotations?: Record<string, number>;
    dims?: Record<string, [number, number, number]>;
  }) => void;
  /** Drop transform overrides — used by Reset-to-detected. Targets a specific id, or all. */
  resetTransforms: (id?: string) => void;
  /** Drop these position and rotation overrides, and nothing else, in one update —
   *  what a gesture ending hands over from `overridesBroughtHome`. `before` is the
   *  maps as the gesture began: a map left with exactly those contents is handed back
   *  AS that map, because history compares by reference and a copy of the room it
   *  already holds reads as an undo step that changes nothing. */
  forgetOverrides: (
    ids: { positions: string[]; rotations: string[] },
    before: Pick<StudioState, 'positions' | 'rotations'>,
  ) => void;
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
  'railLeftW',
  'railRightW',
] as const;

/** Bump when a stored preference must be rewritten once. v1: `dressed` became
 *  off by default, and every existing record carried the old default `true`. */
export const STUDIO_PREFS_VERSION = 1;

/** `map` without `ids`, for `forgetOverrides`. When what is left matches `before` entry
 *  for entry, `before` itself: the live writes replaced every entry they touched with a
 *  copy, so a map back to its old contents is still a new object. */
function withoutOverrides<T>(
  map: Record<string, T>,
  ids: string[],
  before: Record<string, T>,
  same: (a: T, b: T) => boolean,
): Record<string, T> {
  const gone = ids.filter((id) => id in map);
  let out = map;
  if (gone.length > 0) {
    out = { ...map };
    for (const id of gone) delete out[id];
  }
  const keys = Object.keys(out);
  const asBefore = keys.length === Object.keys(before).length && keys.every((k) => k in before && same(out[k], before[k]));
  return asBefore ? before : out;
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
  parentIds: {},
  transformMode: 'translate',
  snapMode: 'fine',
  showGrid: true,
  railLeftOpen: true,
  railRightOpen: true,
  railLeftW: null,
  railRightW: null,
  lighting: 'daylight',
  // The browser's clock; a server has no idea what time it is where the room is.
  hour: typeof window === 'undefined' ? DEFAULT_HOUR : hourNow(),
  quality: 'high',
  // Off until asked for: auto set-dressing (books on shelves, a vase on a table)
  // adds pieces nobody placed. Bumping `STUDIO_PREFS_VERSION` migrates the `true`
  // an older build wrote as the default, which the user never chose.
  dressed: false,
  catalogOpen: false,
  swapPartId: null,
  frameSelectedToken: 0,
  pinned: {},
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
  setTransformsFor: (moves) =>
    set((s) => {
      // No-op returns {} rather than a fresh `positions` object: an identical-but-
      // new reference would look like an edit to history's subscription and push a
      // snapshot for a frame in which nothing moved. Same reason `rotations` is
      // only cloned once some move actually carries one.
      if (moves.length === 0) return {};
      const positions = { ...s.positions };
      let rotations: Record<string, number> | null = null;
      for (const m of moves) {
        positions[m.id] = m.pos;
        if (m.rot !== undefined) {
          if (!rotations) rotations = { ...s.rotations };
          rotations[m.id] = m.rot;
        }
      }
      return rotations ? { positions, rotations } : { positions };
    }),
  setRotation: (id, rot) => set((s) => ({ rotations: { ...s.rotations, [id]: rot } })),
  setDim: (id, dim) => set((s) => ({ dims: { ...s.dims, [id]: dim } })),
  setParent: (childId, parentId) => set((s) => ({ parentIds: { ...s.parentIds, [childId]: parentId } })),
  clearParent: (childId) =>
    set((s) => {
      if (!(childId in s.parentIds)) return {};
      const p = { ...s.parentIds };
      delete p[childId];
      return { parentIds: p };
    }),
  landOn: (childId, supportId) =>
    set((s) => {
      const parentIds = landedLinks(s.parentIds, childId, supportId);
      return parentIds === s.parentIds ? s : { parentIds };
    }),
  landAll: (landings) =>
    set((s) => {
      const parentIds = landedLinksAll(s.parentIds, landings);
      return parentIds === s.parentIds ? s : { parentIds };
    }),
  setParentIds: (parentIds) => set({ parentIds }),
  setTransformMode: (m) => set({ transformMode: m }),
  setCatalogOpen: (open) => set({ catalogOpen: open }),
  setSwapPartId: (id) => set({ swapPartId: id }),
  setSnapMode: (m) => set({ snapMode: m }),
  toggleGrid: () => set((s) => ({ showGrid: !s.showGrid })),
  // Opens and closes. It does NOT touch the width, and that is a decision rather
  // than an omission.
  //
  // A pass through here made opening a rail clear its stored width, on the grounds
  // that restoring a dragged width on every reopen is a "fills the screen" surprise.
  // That surprise is already bounded one layer down: `DockedShell` renders a stored
  // width as `clamp(var(--rail-*-min), Npx, var(--rail-max))` and `--rail-max` is
  // `40vw`, so a 520px rail dragged on a monitor is a ceiling and not a promise on a
  // laptop — its own comment says so, and `tests/reflow.test.ts` pins the clamp. What
  // the clear did instead was throw away a preference `STUDIO_PREFS` persists
  // deliberately, with no undo: drag the right rail to 480px to read long piece
  // names, catch the chevron (24px, about 5px from a 10px sash), press it again to
  // put the panel back, and the 480 is gone from storage too.
  //
  // It also made the sash's `removeProperty` + `setRailWidth(null)` pair a
  // guaranteed null-over-null rather than an occasional one, which is what turned a
  // rare grid collapse into a reachable one. That half is fixed in `DockedShell`
  // whichever way this goes; this is the half about the user's own width.
  toggleRail: (side) =>
    set((s) => (side === 'left' ? { railLeftOpen: !s.railLeftOpen } : { railRightOpen: !s.railRightOpen })),
  setRailWidth: (side, px) => {
    // Only finiteness and a floor of zero are enforced here. The real bounds are
    // the rail token's own `clamp()`, which is where the design values live and
    // the only place that knows what a viewport can spare — a second opinion in
    // JS would be a second answer to the same question.
    const w = px == null || !Number.isFinite(px) ? null : Math.max(0, Math.round(px));
    set(side === 'left' ? { railLeftW: w } : { railRightW: w });
  },
  setLighting: (l) => set({ lighting: l }),
  setHour: (h) => set({ hour: Number.isFinite(h) ? wrapHour(h) : DEFAULT_HOUR }),
  setQuality: (q) => set({ quality: q }),
  toggleDressed: () => set((s) => ({ dressed: !s.dressed })),
  loadTransforms: (data) =>
    set({ positions: data.positions ?? {}, rotations: data.rotations ?? {}, dims: data.dims ?? {} }),
  resetTransforms: (id) =>
    set((s) => {
      if (!id) return { positions: {}, rotations: {}, dims: {}, parentIds: {} };
      const p = { ...s.positions };
      const r = { ...s.rotations };
      const d = { ...s.dims };
      const pr = { ...s.parentIds };
      delete p[id];
      delete r[id];
      delete d[id];
      delete pr[id];
      return { positions: p, rotations: r, dims: d, parentIds: pr };
    }),
  forgetOverrides: (ids, before) =>
    set((s) => {
      const positions = withoutOverrides(s.positions, ids.positions, before.positions, (a, b) =>
        a.every((v, i) => v === b[i]),
      );
      const rotations = withoutOverrides(s.rotations, ids.rotations, before.rotations, (a, b) => a === b);
      // Nothing changed: the state itself, so no subscriber hears an update that is not
      // one and `persist` does not rewrite the prefs. A plain click ends here.
      return positions === s.positions && rotations === s.rotations ? s : { positions, rotations };
    }),
  frameSelected: () => set((s) => ({ frameSelectedToken: s.frameSelectedToken + 1 })),
  toggleHidden: (id) => set((s) => ({ hidden: { ...s.hidden, [id]: !s.hidden[id] } })),
  setHiddenMap: (hidden) => set({ hidden }),
  togglePinned: (id) => set((s) => ({ pinned: { ...s.pinned, [id]: !s.pinned[id] } })),
  setPinnedMap: (pinned) => set({ pinned }),
    }),
    {
      name: 'danmu-studio-prefs',
      version: STUDIO_PREFS_VERSION,
      // Runs only for a record written at an older version (an unversioned one is 0).
      // Other prefs are kept; only the stale default is reset, once.
      migrate: (persisted, version) => {
        const p = (persisted ?? {}) as Partial<StudioState>;
        return (version < 1 ? { ...p, dressed: false } : p) as StudioState;
      },
      storage: createJSONStorage(() => localStorage),
      partialize: (s) =>
        Object.fromEntries(STUDIO_PREFS.map((key) => [key, s[key]])) as Partial<StudioState>,
      // localStorage holds whatever vocabulary the app had when it was last
      // written, and `Room` derives its whole light from this value — so it is
      // checked rather than trusted, the same boundary an imported scene file
      // crosses. A retired mood id is mapped onto the clock by `legacyLighting`
      // (the old Sunrise is a morning hour, the old Cool is overcast), and anything
      // it does not know falls back to the default rather than being guessed at.
      merge: (persisted, current) => {
        // An `hour` written before the light opened at the clock is dropped here, not
        // honoured: it is yesterday's scrub. A retired mood's hour still wins until
        // the next write stores it as plain daylight: it was a deliberate pick.
        const { hour: _stale, ...p } = (persisted ?? {}) as Partial<StudioState> & { lighting?: unknown; hour?: unknown };
        const legacy = legacyLighting(p.lighting);
        return {
          ...current,
          ...p,
          lighting: legacy?.lighting ?? current.lighting,
          hour: legacy?.hour ?? current.hour,
        };
      },
    },
  ),
);

/** The `draggingId` sentinels: gestures that are not a piece. Nothing is a part
 *  with either id. Named once, because a copy of the string that drifts turns a
 *  sun scrub back into "a piece is being carried" wherever the copy lives. */
export const WALL_DRAG_ID = '__wall__';
export const SUN_DRAG_ID = '__sun__';

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
   *  line SOLVE for the height (see `calForPhoto` in lib/photo-geometry.ts), while a
   *  height the user stated should not be overruled by a luminance heuristic that
   *  can lock onto a rug edge. Without this flag every photo carried a height and
   *  the solve was unreachable. */
  camHeightSet: boolean;
  /** Report step-free access in the room check — 1500 mm turning space, reachable
   *  routes. Off by default and remembered: whether a room has to meet this is a
   *  fact about the person using it, not about the room, so it belongs with the
   *  other per-device preferences rather than being asked again per room. */
  stepFree: boolean;
  /** Interface sounds — pick-up, set-down, snap, the sun's hour ticks
   *  (`lib/sound.ts`). A property of the person and their surroundings, not of the
   *  room, so it lives here. On by default: they are quiet enough to sit under
   *  anything else playing, and the switch is in the View panel. */
  sound: boolean;
  /** Which furniture finder to keep on this device (`lib/local-detect.ts`): `full` is both
   *  models, ~65 MB, and finds the most; `basic` is the smaller one alone, ~14 MB. A
   *  property of the device and its data plan, so it lives here. */
  detectorPack: DetectorPack;
  setApiKey: (k: string) => void;
  setDimUnit: (u: DimUnit) => void;
  setKeyValid: (v: boolean | null, reason?: string | null) => void;
  setCamHeight: (m: number) => void;
  setStepFree: (on: boolean) => void;
  setSound: (on: boolean) => void;
  setDetectorPack: (p: DetectorPack) => void;
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
      sound: true,
      detectorPack: 'full',
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
      setSound: (on) => set({ sound: on }),
      setDetectorPack: (p) => set({ detectorPack: p }),
    }),
    {
      name: 'danmu-settings',
      storage: createJSONStorage(() => localStorage),
      // never persist apiKey to anywhere except device localStorage — it already is
    },
  ),
);

/** The unit as the server rendered it until the page has hydrated, then the one
 *  the user chose. `useSettings` rehydrates from localStorage synchronously when
 *  the store is created, so a plain selector reads "ft" on the first client render
 *  against the server's "m", and every number on a prerendered page is a hydration
 *  mismatch. `getInitialState` is the store's own default, not a second copy of it.
 *  Shared by the shape picker and Settings, the two prerendered pages that print a
 *  size. */
export function useDimUnit(): DimUnit {
  return useSyncExternalStore(
    useSettings.subscribe,
    () => useSettings.getState().dimUnit,
    () => useSettings.getInitialState().dimUnit,
  );
}

// Active room id (single-room v0.1).
type RoomState = { roomId: string | null; setRoomId: (id: string | null) => void };
export const useRoom = create<RoomState>()(
  persist(
    (set) => ({ roomId: null, setRoomId: (id) => set({ roomId: id }) }),
    { name: 'danmu-room', storage: createJSONStorage(() => localStorage) },
  ),
);

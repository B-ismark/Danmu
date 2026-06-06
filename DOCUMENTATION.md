# Danmu — Platform Documentation

> Last updated: 2026-06-06 · reflects the codebase on `main`.

Danmu is a **local-first interior decoration simulation**. You capture or pick a
room, Danmu rebuilds it as a 1:1 3D space, and you redecorate freely — place,
move, recolour, restyle, relight, and arrange furniture. An **optional**,
non-blocking AI step can turn the 3D layout into a photo-real preview.

The 3D studio *is* the product. The AI photo preview is a bonus on top, not a
dependency.

---

## 1. What the platform does

| Capability | Summary |
|---|---|
| **Room setup** | Pick a footprint preset (Rectangle / L / T / U / Open Plan) or capture your real room with 6 guided photos. |
| **3D reconstruction** | Builds a scaled 3D room shell (walls, floor, dimensions) and pre-populates it with contextually sensible starter furniture. |
| **Decoration studio** | Select, drag, rotate, scale, recolour, set surface finish, lock, group, and dress every piece. Procedural furniture rebuilds to real dimensions. |
| **2D plan view** | Top-down floor plan synced with the 3D scene. |
| **Optional AI preview** | Compose a style → render a photo-real image of the same layout → compare before/after → share. Silent fallback if it fails. |
| **Persistence** | Everything saved locally (IndexedDB for rooms, localStorage for settings). No backend, no account. |

---

## 2. Design philosophy

- **Local-first, no backend.** Room data lives in IndexedDB; settings + API keys
  in localStorage. Nothing leaves the browser except the optional direct call to
  the AI provider (BYO key).
- **AI is optional and silent.** Image *generation* historically was the flaky,
  expensive part (hangs, timeouts). So render is a non-blocking preview — if it
  fails, the 3D sim still stands. No AI model names, costs, or quota language in
  the user-facing UI. "Realize" is called **"Preview"** everywhere.
- **Warm & playful visual direction.** Cream paper, terracotta + sage accents,
  Nunito / Fraunces type, rounded surfaces. Theme tokens live in
  [`app/globals.css`](app/globals.css). No hard-coded design values.
- **Single source of truth for furniture.** Geometry, catalog, and behaviour
  flags come from [`lib/scene-spec.ts`](lib/scene-spec.ts).

---

## 3. User journey

```
/                         entry router → welcome (no key) or workspace
└─ /onboarding
   ├─ /welcome            intro + optional BYO key
   ├─ /layout-pick        pick footprint preset (sets width/depth + starter scene)
   ├─ /capture            6-photo guided capture (getUserMedia)
   └─ /detect             AI furniture detection on captured photos
/workspace                rooms list — create / resume / delete
/room/[id]
   ├─ /model              ★ 3D decoration studio (default landing)
   ├─ /plan               2D top-down floor plan
   ├─ /compose            style / finish / count picker for the AI preview
   ├─ /render             runs the preview render with progress + safety timeouts
   ├─ /compare            before/after slider + variants
   └─ /share              share link + WhatsApp
/settings                 API keys, currency, units, telemetry, danger zone
```

Two ways in:
1. **Capture flow** — footprint → photograph room → AI detects furniture → studio.
2. **Quick start** — pick a footprint, skip capture, land straight in the studio
   with a contextual starter scene.

---

## 4. Current features

### 4.1 Room reconstruction & starter scenes
- Footprint presets carry their own dimensions and a **contextual starter scene**
  ([`defaultScene`](lib/scene-spec.ts)): Rectangle = living room, L = living +
  reading nook, T = living + dining, U = bedroom, Open Plan = living + dining
  loft. Starters scale parametrically to room width/depth.
- `buildSceneFromRoom` falls back to the layout's starter when a room has no saved
  parts yet.

### 4.1b Wall painting & resizing ([`RoomShell`](components/three/RoomShell.tsx), [`WallHandles`](components/three/WallHandles.tsx))
- **Click a wall** (3D or 2D plan) to select it — shows an accent frame and a
  dedicated Wall panel in the Inspector. Wall vs part selection are mutually
  exclusive (`useStudio.selectedWall`).
- **Paint**: pick a swatch / hex for that wall, or **Apply to all walls** in one
  tap. Stored per footprint-edge index in `useScene.room.wallColors`, persisted on
  `RoomData.wallColors`.
- **Move/resize**: drag the accent handle on the selected wall (3D) or drag the
  wall edge (plan) to push it in/out. **Only the selected wall moves** — its edge
  translates along its outward normal (`footprint.offsetWall`), adjacent walls
  stretch, the opposite wall stays put, so the room becomes off-centre. The
  footprint polygon is now the source of truth; `width`/`depth` are re-derived
  from its bounding box and **all** containment / coordinate mapping reads
  `footprintBounds` rather than ±width/2 (Draggable clamp + wall-snap, PlanView
  world↔px, Room drop-clamp + ContactShadows centre, RoomShell grid). Custom
  footprints persist on `RoomData.footprint` and reload as-is. Editing W/D in the
  Room-shell editor resets to the preset shape; a height-only edit keeps the
  custom footprint. Inspector also has ±10 cm nudge buttons. Persisted via
  `RoomSync`.

### 4.2 Selection & transforms ([`Pickable`](components/three/Pickable.tsx), [`Draggable`](components/three/Draggable.tsx))
- Click to select; drag to move; gizmo to rotate / scale.
- **Wall-mounted parts** (TV, mirror, painting, AC, curtain) snap flush to the
  nearest wall on commit.
- **New parts snap to the floor by default**; only small tabletop-prone items
  (lamp, monitor, plant…) seek a supporting surface. No more floating furniture.
- **Double-click to open** drawers / doors (nightstand drawers slide, wardrobe
  doors swing per bay).

### 4.3 Multi-select & grouping ([`SelectionBar`](components/studio/SelectionBar.tsx))
- Shift-click adds to selection. `selection: string[]` in the studio store.
- "Merge N" assigns a shared `groupId`; clicking any grouped part selects the
  whole group. Group **move-as-one** on translate (rotate/scale-as-one is
  roadmap). "Ungroup" clears it.

### 4.4 Recolour & finish ([`Inspector`](components/studio/Inspector.tsx), [`Draggable`](components/three/Draggable.tsx) `FinishApplier`)
- One merged **Colour** section: 24-swatch palette + hex picker.
- Separate **Finish** (surface sheen): Auto / Matte / Satin / Polished / Metal.
  `FinishApplier` traverses the part's meshes and overrides
  roughness/metalness/envMapIntensity (caches originals for "Auto" restore,
  skips emissive materials). Real per-part material physics.

### 4.5 Procedural & parametric furniture ([`DynamicPart`](components/three/DynamicPart.tsx), [`scene-spec`](lib/scene-spec.ts))
- Furniture is procedural geometry, not imported models — zero asset weight.
- **Parametric shapes** (sofa, curtain, wardrobe, closet, bookshelf, shoe-rack)
  rebuild from effective dimensions instead of stretching: sofa tiles seat
  modules from width, bookshelf derives shelves from height + fills with books,
  wardrobe derives door bays from width, shoe-rack stacks slatted tiers. The
  scale gizmo live-stretches; commit converts scale → dimension and the geometry
  redraws cleanly.
- Laptop and monitor geos have real depth (housing, bezel, hinge, stand,
  keyboard well).

### 4.6 Set-dressing & decor collections ([`Dressing`](components/three/Dressing.tsx))
- Surface-capable parts (table, desk, nightstand, shelf, wardrobe, ottoman) carry
  decorative props: book stacks, vase, potted plant, bowl, candle.
- Auto-suggested via a **seeded** generator (stable per part id) — or fully
  user-managed as a per-part **collection**: add per kind, remove per item,
  Clear, or reset to "Suggested" in the Inspector.
- Decor renders as a **sibling** of the part (reads transform from the store) so
  props keep true size on group-scaled parts, and opt out of raycasting so they
  never block selecting the furniture beneath.

### 4.7 Lighting, realism & motion
- **Lighting moods**: Day / Evening / Cool ([`ViewOptions`](components/studio/ViewOptions.tsx) → Room `LIGHTING` map).
- **Quality toggle** (High / Fast): gates procedural normal/roughness maps
  ([`lib/textures.ts`](lib/textures.ts), zero assets) and real soft cast shadows.
- **Idle micro-motion** ([`Motion`](components/three/Motion.tsx)): ceiling fan
  spins, plant canopy sways, pendant lamp swings — subtle, always-on.

### 4.8 Catalog & drag-in ([`CatalogPanel`](components/studio/CatalogPanel.tsx))
- Floating left-edge furniture strip. Drag a piece onto the canvas — the drop
  point is raycast onto the floor plane. Click-to-add-at-centre is the fallback.

### 4.9 One-tap themes ([`lib/themes.ts`](lib/themes.ts))
- Recolours all unlocked parts to a coherent palette and sets a matching lighting
  mood in a single tap, from the part tree.

### 4.10 2D plan view ([`PlanView`](components/studio/PlanView.tsx))
- Top-down scaled floor plan kept in sync with the 3D scene.

### 4.11 Optional AI photo preview
- **Compose** ([`compose/page.tsx`](app/room/[roomId]/compose/page.tsx)): plain
  style / finish / count picker — no prompt textarea, no cost, no model picker.
- **Render** ([`render/page.tsx`](app/room/[roomId]/render/page.tsx)): captures a
  flat-shaded 3D blockout and asks the model to reproduce the exact layout as a
  photograph. Defaults silently to the Hugging Face FLUX path
  ([`lib/hf.ts`](lib/hf.ts)); Imagen ([`lib/imagen.ts`](lib/imagen.ts)) is the
  alternate. Hard guard timeouts (45s HF / 55s others) plus a wall-clock +
  `visibilitychange`/`focus` safety net so background-tab timer throttling can't
  hang the spinner.
- **Compare** ([`compare/page.tsx`](app/room/[roomId]/compare/page.tsx)):
  before/after slider and variants.

### 4.12 Sharing & persistence
- **Share** ([`share/page.tsx`](app/room/[roomId]/share/page.tsx)): share link +
  WhatsApp.
- Rooms persist in IndexedDB ([`lib/storage.ts`](lib/storage.ts)); settings +
  keys in localStorage. Auto-save on edit (TopBar shows a saved indicator).

### 4.13 Settings ([`settings/page.tsx`](app/settings/page.tsx))
- API key entry (plain English), currency, units, telemetry, danger zone.

---

## 5. Architecture

### Stack (actual)
- **Next.js 14.2** (App Router) + **React 18.3** + **TypeScript 5.6**
- **Tailwind 3.4** — design tokens in [`app/globals.css`](app/globals.css)
- **Three.js 0.169** + **@react-three/fiber 8** + **drei** + **postprocessing**
- **Zustand 5** (client state) + **TanStack Query 5** (async)
- **idb-keyval** (rooms) · **localStorage** (settings/keys)
- AI (optional): **@google/genai** (Imagen 4 + Gemini 2.5 Flash) and
  **@huggingface/inference** (FLUX) — direct browser → provider, BYO key
- **lucide-react** icons (wrapped by [`Icon`](components/ui/Icon.tsx) with a
  `Circle` fallback so no button renders empty)

### State stores ([`lib/store.ts`](lib/store.ts))
- `useStudio` — selection, positions/rotations/dims, lighting, quality, dressed,
  open state, locks.
- `useScene` / [`scene-store.ts`](lib/scene-store.ts) — scene parts, group/ungroup.
- `useCompose`, `useSettings`, `useRoom` — compose options, settings/keys, active room.

### Key library files
| File | Role |
|---|---|
| [`lib/scene-spec.ts`](lib/scene-spec.ts) | **Single source of truth** — Shape union, catalog, geometry params, `isParametric`, `supportsDecor`, `autoSurfaceDecor`, `placeNewPart` / support logic, `defaultScene` starters, DnD MIME. |
| [`lib/scene-store.ts`](lib/scene-store.ts) | Scene parts CRUD + grouping. |
| [`lib/textures.ts`](lib/textures.ts) | Procedural normal/roughness maps (offline, zero assets). |
| [`lib/themes.ts`](lib/themes.ts) | One-tap restyle palettes. |
| [`lib/storage.ts`](lib/storage.ts) | IndexedDB room persistence. |
| [`lib/detection.ts`](lib/detection.ts) | Gemini multimodal furniture detection. |
| [`lib/hf.ts`](lib/hf.ts) / [`lib/imagen.ts`](lib/imagen.ts) | Render providers (BYO key). |
| [`lib/capture.ts`](lib/capture.ts) | `getUserMedia` + canvas snapshot. |

### Data flow (decoration loop)
`scene-spec` defines a part → `scene-store` holds the instance → `Room` renders
each part via `DynamicPart` (geometry) + `Dressing` (decor sibling) → `Pickable`
selects, `Draggable` transforms and commits back to `useStudio` → auto-save to
IndexedDB.

---

## 6. Known limitations

- AI image generation has no ControlNet depth lock — layout preservation relies on
  the blockout reference + prompt, not pixel-exact geometry.
- WebXR / true measurement calibration deferred; 6-photo capture only.
- Group transforms are **move-only** (no rotate/scale-as-one yet).
- BYO key lives in browser memory — Settings warns users to scope/referrer-restrict it.

---

## 7. Roadmap / future plans

**Done (recent)**
- ✅ Studio is reachable without an AI key. Entry router ([`app/page.tsx`](app/page.tsx))
  routes on whether the user has rooms, not on key presence; onboarding/welcome
  leads with "Start decorating" and the key is an optional, collapsed extra. The
  AI preview surfaces an inline "add a key" nudge in Compose instead of gating.
- ✅ Removed the dead carpenter-era dep `@react-pdf/renderer` (+ its
  `transpilePackages` entry) and the stale `PROJECT_OVERVIEW.md`. This doc is the
  single source of truth.
- ✅ Added a Vitest smoke suite (`pnpm test`) over the pure core logic
  (`lib/footprint`, `lib/prompt`, `lib/units`).

**Near term**
- **Group rotate / scale-as-one** to finish multi-select (translate already done).

**Visual fidelity**
- **Photographic CC0 maps** (Poly Haven / ambientCG) bundled in `/public` for
  richer wood/fabric/metal surfaces — currently held deliberately; procedural
  maps cover the offline baseline.
- More parametric shapes and richer decor kinds.

**Product**
- Multi-room projects / a true rooms dashboard.
- Export (image / layout / shareable scene file).
- Undo/redo polish across all edit types ([`UndoRedo`](components/studio/UndoRedo.tsx) exists).

**AI preview**
- Tighter layout preservation (client-side composite / depth conditioning when the
  provider supports it).
- Faster, more reliable render path with better progress feedback.

> **Explicitly NOT planned:** reintroducing the carpenter spec / cutlist / build-cost
> feature. That was removed in the pivot to a decoration simulation.

---

## 8. Build & run

```bash
pnpm install
pnpm dev          # http://localhost:3000
pnpm typecheck    # tsc --noEmit
pnpm test         # vitest run — smoke suite over pure core logic
pnpm build        # next build
```

- Windows / PowerShell dev environment. The room route directory is literally
  `[roomId]` (brackets) — use `-LiteralPath` with PowerShell file cmdlets.
- **No secrets in the repo.** AI keys are entered at runtime and stored in the
  browser only; `.env*` and `.claude` are git-ignored.

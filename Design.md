# Danmu — Design & Architecture

> Last updated: 2026-07-25 · reflects the codebase on `main`.
> Canonical design doc. Supersedes the older `DOCUMENTATION.md`.

Danmu is a **local-first interior decoration simulation**. You pick a footprint
(or capture a real room with photos), Danmu rebuilds it as a scaled 1:1 3D space,
and you redecorate freely — place, move, recolour, restyle, relight, and arrange
furniture. Everything runs in the browser. There is **no backend and no account**.

The 3D studio *is* the product. AI is optional and used **only to detect
furniture from photos** — never to generate images. Dimensions and placement are
owned by a deterministic geometry engine, not by a model.

---

## 1. Product principles

1. **Local-first, no backend.** Room data lives in IndexedDB; settings + the
   optional API key live in localStorage. Nothing leaves the browser except one
   optional, direct call to the Gemini API (BYO key) during photo detection.
2. **AI is optional and detection-only.** There is **no image generation** in the
   product — the old "realize / render / compose / compare / share" photoreal
   pipeline was deleted permanently. Do **not** reintroduce AI rendering, model
   names, costs, or quota language into the user-facing UI. If detection is
   unavailable, the studio still works — pick a footprint and decorate.
3. **Dimensions are trustworthy because they are code, not AI.** Sizes are always
   clamped by `lib/dimension-ranges.ts` (`clampDims`); the AI's size guess is a
   *hint* only. A deterministic geometry engine owns placement, real-world sizing,
   overlap, and clearance. This is the core value: you can plan a real room around
   the result.
4. **Single source of truth for furniture.** Shapes, catalog, geometry params and
   behaviour flags come from `lib/scene-spec.ts` (+ `lib/parts-catalog.ts`). The
   3D scene, 2D plan, inspector tree, catalog and decor all read from it.
5. **No hard-coded design values.** Colours / spacing / type flow through tokens
   in `app/globals.css`; Tailwind reads them.
6. **Warm & playful visual direction.** Cream paper, terracotta (`--accent`) +
   sage (`--accent-2`) accents, Nunito (sans) / Fraunces (display) type, generous
   rounding. Matches the soft procedural 3D models.

---

## 2. User journey

```
/                         entry router → onboarding (no rooms) or workspace
└─ /onboarding
   ├─ /welcome            intro + "Start decorating"; optional BYO key (collapsed)
   ├─ /layout-pick        pick footprint preset → sets width/depth + starter scene
   ├─ /capture            4-wall guided capture (getUserMedia)
   └─ /detect             furniture detection on captured photos
/workspace                rooms list — create / resume / delete
/room/[roomId]
   ├─ /model              ★ 3D decoration studio (default landing)
   └─ /plan               2D top-down floor plan
/settings                 API key, display unit, danger zone
```

Two ways in:

1. **Quick start** — pick a footprint, skip capture, land straight in the studio
   with a contextual starter scene. Zero credentials.
2. **Capture flow** — footprint → photograph room → detect furniture → studio.

There are **only two studio tabs**: `3D Model` and `2D Plan` (`StudioTabs.tsx`).

Capture is **four wall photos**, not six — `CAPTURE_SLOTS` in `lib/capture.ts` is
the four walls in clockwise order; floor and ceiling were dropped. The slots are
labelled relationally ("Wall 1 · start anywhere", "Wall 2 · turn right") while
keeping `n`/`e`/`s`/`w` as the internal ids the geometry and storage depend on —
compass bearings asked the user a question they cannot answer in their own
living room, and the engine only needs four *consecutive* walls.

---

## 3. Detection (the only AI, optional)

> Detection is the app's **only** egress. The optional Gemini path sends the
> wall photos to Google; the local ONNX path does not. The UI must say which
> one is happening at the moment it happens — a privacy promise displayed
> during an upload is the one bug class this section exists to prevent.

Furniture detection runs through a fallback chain, best-effort:

1. **Local detector** — `lib/local-detect.ts`, via `onnxruntime-web`. No key, no
   quota, no network after the first model download. The models (~64 MB total)
   are **not bundled** and are git-ignored; `resolveBase()` HEAD-probes two
   sources in order:
   `public/models/` (produced by `python scripts/export-detector.py`, needs
   `pip install ultralytics`) then the Hugging Face mirror
   [`DearthAI/danmu-detector`](https://huggingface.co/DearthAI/danmu-detector),
   so a fresh clone works without a Python + torch toolchain. Both are static
   GETs of a public file — no user data leaves the device.

   Each photo is run **five times** — whole frame plus 2×2 tiles at 15% overlap
   — and merged with a single NMS in normalized whole-image space. Letterboxing
   a 2000px wall photo to 640 shrinks mid-sized objects below what nano
   resolves; tiling recovers them for zero extra download.

   **Two models run as an ensemble** — `yolov8n-oiv7` (14 MB, 601 fixed Open
   Images classes) and `yolov8s-worldv2-danmu` (50 MB, open-vocabulary with
   Danmu's 44 furniture prompts frozen into the graph by `set_classes()` at
   export). They fail on disjoint classes: OIV7 owns monitors and windows, the
   world model owns fridges / ceiling fans / wardrobes / lamps / curtains. Both
   feed one pool of candidates in normalized space, resolved by a single NMS.

   `resolveFile()` resolves each file's source **independently** — a clone that
   ran the pre-ensemble export script has only the OIV7 model locally, and picks
   the world model up from the mirror rather than silently losing half its
   recall. Only when neither source has it does detection fall back to the OIV7
   model alone.

   **Measured on a real 4-photo room** (19 catalogued objects), so don't
   re-litigate this without new numbers:

   | config | size | whole frame | 2×2 tiled |
   |---|---|---|---|
   | yolov8n-oiv7 | 14 MB | 4/19 | 7/19 |
   | yolov8s-oiv7 | 46 MB | 4/19 | 7/19 |
   | yolov8m-oiv7 | 105 MB | 6/19 | 7/19 |
   | yolov8x-oiv7 | 275 MB | 7/19 | 7/19 |
   | yolov8s-worldv2 | 50 MB | 7/19 | 10/19 |
   | **oiv7-n + worldv2-s (shipped)** | **64 MB** | — | **13/19** |

   Two findings worth keeping:

   - **Scaling OIV7 does nothing.** Every variant converges on 7/19; `x` is 19×
     the bytes of `n` for identical recall. Input resolution binds, not model
     capacity — hence tiling.
   - **The remaining gap was vocabulary, not capacity.** Curtain / ceiling fan /
     fridge / wardrobe class heads peak at 0.002–0.03 on this imagery against
     0.38–0.44 for classes that fire, at *every* OIV7 size. An open-vocabulary
     model prompted with those words in plain language finds them.

   Confidence stays at 0.35: dropping to 0.20 buys one object and adds a
   spurious `sofa(0.29)`. Still missed at 13/19 — doors, wall art, and the
   curtain in one photo. The local pass is a head start, not a replacement for
   Gemini.

   **Licence boundary:** the weights are AGPL-3.0 (Ultralytics) and Danmu is
   MIT. AGPL is copyleft, so the two cannot be mixed — the weights therefore
   live in their own AGPL-licensed HF repo and are fetched at runtime, never
   committed or redistributed from here. GitHub Release hosting was tried and
   rejected: release assets redirect to a storage host with no
   `access-control-allow-origin`, so browsers block them (curl does not, which
   makes this easy to mis-verify).
2. **Gemini fallback** — `lib/detection.ts`: one multimodal `@google/genai` call
   over all wall photos at once (so it can reason about object continuity across
   walls). BYO key; quota tracked in `lib/quota.ts`. Key validated by
   `lib/validate-key.ts`.
3. **Manual boxes** — `PhotoEditor.tsx`: lock / delete / add-box by hand when no
   detector is available.

Detection returns labels + boxes only. The **geometry engine derives real sizes
and positions** — see §4.

> Note: `@huggingface/inference` and `clsx` were removed in the cleanup — both
> were dead leftovers from the deleted render pipeline.

---

## 4. The geometry engine (deterministic, no AI)

This is what makes Danmu trustworthy. All pure math, all covered by tests.

| File | Role |
|---|---|
| `lib/geometry.ts` | Oriented rectangles (OBB) in the XZ plane; separating-axis overlap, gaps, face clearance, point-in-poly, nearest-edge. |
| `lib/photo-geometry.ts` | Pinhole camera at room centre (`CAM_HEIGHT` 1.5 m) + entered room dims → floor homography gives real position + W/H from any bbox. Floor-line calibration (`findFloorLine`); landscape shots fall back to a 66° FOV default. |
| `lib/physics.ts` | Gravity/anchor rules — where a part sits (floor / ceiling / wall-mid / …), wall affinity + snap, support-under lookup for tabletop-prone items. |
| `lib/clearance.ts` | Ergonomics checker over exact geometry: ≥600 mm walkways, ≥600 mm in front of hinged storage, 500 mm bedside strip, TV viewing distance. Reproducible findings, no AI. |
| `lib/dimension-ranges.ts` | `clampDims` — per-item sizing tiers (fixed / standard / flexible). **All sizes pass through this.** |
| `lib/footprint.ts` | Footprint polygon math (preset shapes, containment, `offsetWall` for wall moves). The polygon — not `width`/`depth` — is the source of truth for room shape. |

On the detect page, `geoRefine` runs the geometry engine over **every** detection
and manual box: geometry overrides AI dims/position; the AI contributes only
label / category / a depth hint.

---

## 5. The decoration studio

### Selection & transforms — `Pickable.tsx`, `Draggable.tsx`
- Click to select, drag to move, gizmo to rotate / scale (Maya-style modes;
  snap `off` / `fine` 1 cm·2.5° / `coarse` 5 cm·7.5°).
- Wall-mounted parts (TV, mirror, painting, AC, curtain) snap flush to the
  nearest wall on commit. New parts snap to the floor; small tabletop-prone items
  seek a supporting surface.
- **Double-click to open** drawers / doors (nightstand drawers slide, wardrobe
  doors swing per bay).

### Walls — `RoomShell.tsx`, `WallHandles.tsx`
- Click a wall (3D or 2D plan) to select it — mutually exclusive with part
  selection (`useStudio.selectedWall`). Shows a Wall panel in the Inspector.
- **Paint**: per-wall swatch / hex, or **Apply to all walls**. Stored per
  footprint-edge index in `room.wallColors`.
- **Move / resize**: drag the selected wall's handle (3D) or edge (plan). Only
  the selected wall moves — its edge translates along its outward normal
  (`footprint.offsetWall`), adjacent walls stretch, opposite wall stays. The
  footprint polygon becomes the source of truth; `width`/`depth` are re-derived
  from its bounds. Custom footprints persist on `RoomData.footprint`.

### Multi-select & grouping — `SelectionBar.tsx`
- Shift-click adds to `selection: string[]`. "Merge N" assigns a shared
  `groupId`; clicking any grouped part selects the whole group; group **move-as-
  one** on translate (rotate/scale-as-one is roadmap). "Ungroup" clears it.

### Recolour & finish — `Inspector.tsx`, `Draggable.tsx` `FinishApplier`
- One merged **Colour** section (24-swatch palette + hex). Separate **Finish**
  (Auto / Matte / Satin / Polished / Metal) — `FinishApplier` traverses the
  part's meshes and overrides roughness / metalness / envMapIntensity (caches
  originals for "Auto" restore, skips emissive materials). Real per-part physics.

### Procedural & parametric furniture — `DynamicPart.tsx`, `scene-spec.ts`
- Furniture is **procedural geometry, not imported models** — zero asset weight.
- **Parametric shapes** (sofa, curtain, wardrobe, closet, bookshelf, shoe-rack)
  rebuild from effective dimensions instead of stretching: sofa tiles seat
  modules from width, bookshelf derives shelves from height, wardrobe derives
  door bays from width, etc. The scale gizmo live-stretches; commit converts
  scale → dimension and the geometry redraws cleanly.
- **Local model library** — `LibraryPicker.tsx` + `lib/mesh-cache.ts` +
  `lib/shape-search.ts` (token + synonym + text-size parser). A part can point at
  a cached GLB via `meshHash` (CC0 library is a work in progress).

### Set-dressing & decor — `Dressing.tsx`
- Surface-capable parts carry props (books, vase, plant, bowl, candle),
  auto-suggested via a **seeded** generator (stable per part id) or user-managed
  as a per-part `decor` collection. Decor renders as a **sibling** of the part
  (reads transform from the store) so props keep true size on group-scaled parts,
  and opt out of raycasting so they never block selecting the furniture beneath.

### Lighting, realism & motion
- **Lighting moods** Day / Evening / Cool (`ViewOptions.tsx` → Room `LIGHTING`).
- **Quality** High / Fast — gates procedural normal/roughness maps
  (`lib/textures.ts`, zero assets) + soft cast shadows + ambient occlusion
  (N8AO/SMAA mount on `high` only). There is no floor reflection.
- **Idle micro-motion** (`Motion.tsx`): fan spins, plant sways, pendant swings.

### Other studio tools
- **Catalog drag-in** (`CatalogPanel.tsx`) — drag a piece onto the canvas; drop
  point raycasts onto the floor. Click-to-add-at-centre is the fallback.
- **One-tap themes** (`lib/themes.ts`) — recolour all unlocked parts + set a
  matching lighting mood.
- **2D plan** (`PlanView.tsx`) synced with the 3D scene; export via
  `lib/plan-export.ts`.
- **Snapshot** (`lib/snapshot.ts`) — PNG of the 3D view (replaces the deleted
  photoreal render).
- **Undo/redo** (`lib/history.ts`, `UndoRedo.tsx`) — snapshots cover parts, room
  and transforms.
- **Item-to-item snapping** (`lib/item-snap.ts`).

---

## 6. Architecture

### Stack
- **Next.js 14.2** (App Router) + **React 18.3** + **TypeScript 5.6**
- **Three.js 0.169** + **@react-three/fiber 8** + **drei** + **postprocessing** — declarative 3D
- **Zustand 5** (client state). No data-fetching library — a local-first app
  makes no queries, so TanStack Query was removed.
- **idb-keyval** (rooms) · **localStorage** (settings + key)
- **onnxruntime-web** (local detector) · **@google/genai** (optional Gemini detection)
- **lucide-react** icons, wrapped by `components/ui/Icon.tsx` with a `Circle`
  fallback so no button renders empty
- Loaded at runtime, not bundled: the ONNX model file; `onnxruntime-web` is
  loaded via CDN with `webpackIgnore` (bundling ort breaks the Next build), so
  it is a **devDependency** — installed for its types only. Its version is
  pinned exactly and mirrored by `ORT_VERSION` in `lib/local-detect.ts`; move
  both together or the compiled types drift from the executed wasm.

### State stores
| Store | File | Holds |
|---|---|---|
| `useStudio` | `lib/store.ts` | selection, wall selection, positions/rotations/dims, lighting, quality, dressed, snap, open state, hidden, grid, view preset. **Only the view *preferences* persist** (`lighting`, `quality`, `dressed`, `snapMode`, `showGrid` → `danmu-studio-prefs`, via `partialize`). Selection / camera / open drawers are ephemeral; transforms and `hidden` are per-room and owned by `RoomSync`. |
| `useSettings` | `lib/store.ts` | apiKey, dimUnit (the one display unit — a dead `units` metric/imperial flag was removed), key-valid cache. Persisted to localStorage (`danmu-settings`). |
| `useRoom` | `lib/store.ts` | active room id. Persisted (`danmu-room`). |
| `useScene` | `lib/scene-store.ts` | scene parts CRUD + group/ungroup + room. |
| `useQuota` | `lib/quota.ts` | Gemini detection quota (flash-only). |

> There is no `useCompose` — it was deleted with the render pipeline.

### Key library files (beyond §4)
| File | Role |
|---|---|
| `lib/scene-spec.ts` | **Single source of truth** — `Shape` union, `ScenePart`, `defaultScene` starters, parametric/decor/support flags, DnD MIME. |
| `lib/parts-catalog.ts` | Room defaults + catalog data. |
| `lib/scene-store.ts` | Scene parts CRUD + grouping. |
| `lib/storage.ts` | IndexedDB room persistence (`RoomData`, `wallColors`, `footprint`, per-room `hidden`). Deleting a room is a **soft delete** — keys move under `trash:{ts}:` and `restoreRoom` undoes it; `purgeTrash` expires them after 30 days and `destroyRoom` is the irreversible path. A `room:{id}:touched` key carries the real `updatedAt`. |
| `lib/scene-palette.ts` | Scene-side semantic colours (`SCENE`, `categoryColor`) — the one home for values the 3D layer and the panels that edit it must agree on, since Three.js materials cannot read a CSS custom property. Kept in sync with `globals.css` by hand, guarded by a test. |
| `lib/room-scene.ts` | Build a scene from a room / detections. |
| `lib/textures.ts` | Procedural normal/roughness maps (offline, zero assets). |
| `lib/themes.ts` | One-tap restyle palettes. |
| `lib/product-presets.ts` | Real-product size presets. |
| `lib/capture.ts` / `lib/image-quality.ts` / `lib/mask.ts` / `lib/color-sample.ts` | Photo capture + quality + masking + colour sampling. |
| `lib/units.ts` | Unit conversion (persistence always mm). |

### Data flow (decoration loop)
`scene-spec` defines a part → `scene-store` holds the instance → `Room` renders
each part via `DynamicPart` (geometry) + `Dressing` (decor sibling) → `Pickable`
selects, `Draggable` transforms/commits back to `useStudio` → `RoomSync`
auto-saves to IndexedDB.

---

## 7. Known limitations
- Group transforms are **move-only** (no rotate/scale-as-one yet).
- WebXR / true measurement calibration deferred; 4-wall capture only.
- The CC0 GLB library (`LibraryPicker` / `mesh-cache`) is a work in progress —
  most furniture is still procedural.
- BYO key lives in browser memory — Settings warns users to scope / referrer-
  restrict it.

---

## 8. Roadmap
- **Group rotate / scale-as-one** to finish multi-select (translate done).
- Bundle a curated **CC0 GLB library** for higher-fidelity pieces.
- More parametric shapes + richer decor kinds.
- Multi-room projects / rooms dashboard.
- Export polish (image / layout / shareable scene file).

> **Explicitly NOT planned:** reintroducing AI image generation (render / compose
> / compare / share) or the carpenter spec / cutlist / build-cost feature. Both
> were removed in the pivot to a local-first decoration simulation.

---

## 9. Build & run

```bash
pnpm install
pnpm dev          # http://localhost:3000
pnpm typecheck    # tsc --noEmit
pnpm test         # vitest run — pure-logic suite (geometry, physics, clearance, footprint, units, …)
pnpm build        # next build
```

- **Windows / PowerShell** dev environment. The room route dir is literally
  `[roomId]` (brackets) — PowerShell treats brackets as wildcards, so use
  `-LiteralPath` with file cmdlets on those paths.
- **No secrets in the repo.** The AI key is entered at runtime and stored in the
  browser only; `.env*` and `.claude` are git-ignored.
- Licence: **MIT**. (The optional local YOLOv8 weights you export are AGPL-3.0 —
  fine for this open-source project; they are not committed.)

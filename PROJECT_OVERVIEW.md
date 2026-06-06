# Danmu — Project Overview

> Living reference for the Danmu codebase. Update whenever flow, UI, data model, or stack changes meaningfully. Designed so a fresh AI agent (or new human) can pick up work without re-reading the whole repo.
>
> **Last updated:** 2026-06-05 (rev 6)
> **Update rule:** any change to (a) routes, (b) data model in `lib/storage.ts` / `lib/scene-spec.ts`, (c) AI prompts in `lib/detection.ts` / `lib/prompt.ts` / `lib/imagen.ts`, (d) Zustand stores, (e) major UI flow steps, or (f) `package.json` deps → bump this doc in the same commit. Touch the **Last updated** date and add a one-line entry under **Changelog** at the bottom.

---

## 1. What Danmu is

CAD-aesthetic, BYO-key, browser-only interior redesign tool. User photographs a room (4 walls), AI detects furniture, user picks what to keep vs. redesign, AI generates a photorealistic redesign that preserves locked items.

**Core value prop:** reimagine a real room — not a stock photo — by directly manipulating the detected objects and letting Gemini/Imagen regenerate the rest while keeping the user's existing fixtures pixel-faithful.

**Target user state:** standing in a room, phone in hand, wants "what would this look like if I moved the wardrobe and changed the style to Afro-Modern" in under 2 minutes.

### Status (v0.1)
- 4-wall capture, multimodal detection, lock/ghost mask render, before/after slider, carpenter PDF export — all wired.
- **Major gap:** no on-photo direct manipulation. User can lock/unlock objects but cannot drag them in the photo to a new position before render. 3D scene drag exists but does not feed render mask. See §10 for the planned object-move flow.

---

## 2. Stack

| Layer | Choice | Notes |
|---|---|---|
| Framework | **Next.js 14.2** (App Router) | despite README claiming 15; `package.json` is source of truth |
| UI | **React 18.3** + **TypeScript 5.6** | `'use client'` everywhere — there is no server logic |
| Styling | **Tailwind v3.4** + custom tokens in `app/globals.css` | README mentions v4 but deps are v3 |
| 3D | **three 0.169** + **@react-three/fiber 8.17** + **@react-three/drei 9.114** + **@react-three/postprocessing 2.16** + **postprocessing 6.36** + **three-stdlib** | declarative scene; postprocessing = N8AO ambient occlusion |
| State | **Zustand 5** (session + persisted) | see `lib/store.ts`, `lib/scene-store.ts`, `lib/quota.ts`, `lib/history.ts` |
| Async | **@tanstack/react-query 5** | mostly for detection/render |
| Storage | **idb-keyval 6** for room data; `localStorage` for settings + API key | see `lib/storage.ts` |
| AI SDK | **@google/genai 2.8** (Gemini/Imagen) + **@huggingface/inference** (HF FLUX render path) — direct browser → provider | no backend |
| PDF | **@react-pdf/renderer 4** | carpenter spec sheet |
| Misc | `geist` (font), `clsx`, `uuid` | |
| Pkg mgr | **pnpm 9.12** | |

**Architecture rule:** no backend. All AI calls go browser → Google with a user-supplied API key. Key lives only in `localStorage` on user's device. README warns to scope the key with HTTP-referrer + API restriction in Google Cloud Console.

### Run
```bash
pnpm install
pnpm dev          # http://localhost:3000
pnpm typecheck    # tsc --noEmit
pnpm lint         # next lint
pnpm build
```

---

## 3. Routes (App Router)

| Path | File | Purpose |
|---|---|---|
| `/` | `app/page.tsx` | entry router — has key → `/workspace`, else `/onboarding/welcome` |
| `/onboarding/welcome` | `app/onboarding/welcome/page.tsx` | paste API key, intro |
| `/onboarding/layout-pick` | `app/onboarding/layout-pick/page.tsx` | pick footprint preset (rect / l / t / open / custom) |
| `/onboarding/capture` | `app/onboarding/capture/page.tsx` | 4-slot wall capture (N/E/S/W) — upload or `getUserMedia` |
| `/onboarding/detect` | `app/onboarding/detect/page.tsx` | run Gemini detection, lock/unlock objects |
| `/workspace` | `app/workspace/page.tsx` | empty state / room list / resume |
| `/room/[roomId]/model` | 3D viewer (default tab) — Three.js scene from detections |
| `/room/[roomId]/plan` | 2D top-down plan (drag in plan view) |
| `/room/[roomId]/photo` | original capture viewer |
| `/room/[roomId]/compose` | style + budget + render-model picker |
| `/room/[roomId]/render` | runs Imagen / Gemini render, saves variants |
| `/room/[roomId]/compare` | before/after slider over saved variants |
| `/room/[roomId]/spec` | carpenter PDF preview + download |
| `/room/[roomId]/share` | share link + WhatsApp |
| `/settings` | API key, currency, units, telemetry, danger zone |

Onboarding routes live under `app/onboarding/layout.tsx`. Room routes share `app/room/[roomId]/layout.tsx` (TopBar, SecondaryNav, RoomSync).

---

## 4. End-to-end flow

```
welcome  → layout-pick → capture (4 walls) → detect (Gemini multimodal)
                                              ↓
                                  room/[id]/model (3D scene built from detections)
                                              ↓ (user adjusts in 3D / 2D plan / locks items)
                                  room/[id]/compose (style, budget, model)
                                              ↓
                                  room/[id]/render (Imagen / Gemini Flash Image)
                                              ↓
                                  room/[id]/compare → spec → share
```

### Detection → scene
1. `app/onboarding/detect/page.tsx` calls `detectAcrossImages(apiKey, [{slot, blob}, …])` (`lib/detection.ts:123`).
2. Single Gemini 2.5 Flash call receives all 4 wall photos + a long prompt (`lib/detection.ts:33-91`) describing room coordinate system and per-slot camera pose.
3. Model returns `Detection[]`: `{label, conf, box, category, slot, alsoSeenIn?, dimMM?, position?, yaw?, shape?}`.
4. `dedupe()` drops near-identical detections (same category + bbox center within 12%, or same label string).
5. Saved to `RoomData.detectedObjects` in IndexedDB (`lib/storage.ts:51-62`).
6. `buildSceneFromRoom()` (`lib/scene-spec.ts:209`) maps each detection to a `ScenePart` — picks a primitive shape from the catalog, places it in 3D using AI position when sane else `placementForSlot()` heuristic, snaps to walls / pulls toward middle via `lib/physics.ts` (`wallAffinity`, `snapToWall`, `pullToward`, `groundY`).

### Render
1. `app/room/[roomId]/compose/page.tsx` builds prompt via `composePrompt({styleId, budget, lockedNames, ghostNames})` (`lib/prompt.ts:34`).
2. Mask built by `buildPreserveMask(locks, w, h, feather=12)` (`lib/mask.ts:12`) — white rectangles where locked objects sit, soft feather, black elsewhere.
3. Base capture downscaled to ≤768px long edge via `downscaleBlob()` (`lib/mask.ts:65`) before sending.
4. `renderRoom(apiKey, req)` (`lib/imagen.ts:198`) tries paid Imagen if requested, auto-falls back to free Gemini 2.5 Flash Image on `PAID_PLAN_REQUIRED`.
5. Free path: `generateContent` with `[prompt-text, base-image, mask-image]` parts and a preservation clause (`lib/imagen.ts:116-124`). Throttle 1.5s between variants, retry 429 with 6s/12s backoff (max 2 retries).
6. Paid path: `generateImages` with `numberOfImages` and `aspectRatio`. No mask param exposed in current SDK call — relies entirely on prompt for preservation.
7. Result variants saved as `RenderVariant` blobs in IDB (`lib/storage.ts:32-41`).

### Compare / Spec / Share
- Compare slider overlays latest render on top of one capture (usually S wall) — `app/room/[roomId]/compare/page.tsx`.
- Spec PDF (`components/spec/SpecDocument.tsx` via `@react-pdf/renderer`) lists all parts with dimensions, materials, cost overrides.
- Share creates a link; WhatsApp is one-click.

---

## 5. Data model

### `RoomData` (IDB key `room:{id}:meta`) — `lib/storage.ts:43-63`
```ts
{
  id, createdAt, name,
  layoutId: 'rect' | 'l' | 't' | 'open' | 'custom',
  width, depth, height,        // metres
  detectedObjects?: Array<{
    id, label, conf, locked, box: [x,y,w,h],
    category?, dimMM?, position?, yaw?, shape?
  }>
}
```

### `Capture` (IDB key `room:{id}:cap:{slot}`)
```ts
{ slot: 'n'|'e'|'s'|'w', blob: Blob, takenAt, pose? }
```

### `RenderVariant` (IDB key `room:{id}:render:{id}`)
```ts
{ id, blob, prompt, seed, createdAt, costAmount, costCurrency, pinned? }
```

### `Transforms` (IDB key `room:{id}:transforms`)
```ts
{ positions: Record<id,[x,y,z]>, rotations: Record<id,number>, dims: Record<id,[W,D,H]> }
```
These are 3D-scene overrides. **Note:** they do not currently feed the render mask; they only redraw the 3D / plan views. See §10.

### `ScenePart` (in-memory + IDB key `room:{id}:scene`) — `lib/scene-spec.ts:30-51`
```ts
{
  id, category, name, shape, pos, rot, dimMM,
  locked, circle?, wallMounted?,
  fromDetection?: { slot, bbox, conf },
  costOverride?, material?
}
```

---

## 6. State management

### Zustand stores (`lib/store.ts`)
- **`useStudio`** — session-only. Selected/hovered/dragging part, view preset, transform overrides (`positions`, `rotations`, `dims`), gizmo mode, hidden toggles, `frameSelectedToken`.
- **`useCompose`** — session-only. `styleId`, `budget` (0..100), `renderModel` ('free' | 'eco' | 'ultra'), `variants`, `customPrompt`.
- **`useSettings`** — persisted to `localStorage` as `danmu-settings`. `apiKey`, `currency`, `units`, `dimUnit`, `confirmPaidRenders`, `keyValid`, `keyValidReason`. Setting a new key invalidates the cached test result.
- **`useRoom`** — persisted as `danmu-room`. Just `roomId`.

### Other stores
- **`useScene`** (`lib/scene-store.ts`) — derived `ScenePart[]` for the active room.
- **`useHistory`** (`lib/history.ts`) — undo/redo for transform changes only.
- **`useQuota`** (`lib/quota.ts`) — tracks per-model call counts (flash, flash-lite, flash-image) for the QuotaPill.

### IDB persistence (`lib/storage.ts` `roomStore`)
`saveRoom`, `loadRoom`, `renameRoom`, `saveCapture`, `loadCaptures`, `saveRender`, `pinRender`, `listRenders`, `firstPinnedRender`, `saveTransforms`, `loadTransforms`, `saveSceneParts`, `loadSceneParts`, `listRooms`, `clearRoom`. `QuotaExceededError` dispatches `danmu:storage-full` window event for `StorageToast`.

---

## 7. AI integration details

### Models in use
| Model ID | Path | Purpose | Cost (USD/variant) |
|---|---|---|---|
| `gemini-2.5-flash` | `lib/detection.ts:119` | multi-image furniture detection (JSON output) | free tier |
| `gemini-2.5-flash-image-preview` (Nano Banana) | `lib/imagen.ts:163` | free render path | 0 |
| `imagen-4.0-generate-001` | paid render | 0.04 |
| `imagen-4.0-ultra-generate-001` | paid render (ultra) | 0.06 |
| `imagen-3.0-generate-002` | legacy paid | 0.04 |
| `gemini-2.5-flash-lite` | regenerate / improve-batch (separate quota pool) | free tier |

### Detection prompt (`lib/detection.ts:33-91`)
Hardcoded coordinate system: room is 5.6m × 4.2m × 2.8m, origin at floor center, +X right (East), +Z toward South. Per-slot camera pose described explicitly. Model is told to depth-estimate from bbox bottom-y and bbox size, return one entry per physical object with `slot` = best view and `alsoSeenIn` for partials. Output capped at 25 items, JSON only, with a fixed shape catalog.

### Render prompt (`lib/imagen.ts:116-124`)
Free path appends to user prompt:
```
REFERENCE IMAGES PROVIDED:
1. Original room photo
2. Preservation mask — WHITE pixels … MUST appear pixel-faithful … BLACK pixels are free for redesign.
Render the room described in the prompt, keeping every WHITE-masked region of the original photo intact in position, geometry, and approximate visual identity. Reframe and re-stylize the rest.
```

### Composed user prompt (`lib/prompt.ts:34-47`)
`interior living room, wide-angle, professional architectural photography, <style tokens>, <budget tokens>, polished terrazzo floor, P.O.P. ceiling…, preserve <lockedNames>, place <ghostNames>, contact shadows, photorealistic, 8K`

### Error model
- `DetectError`: `NO_KEY | INVALID_KEY | DAILY_QUOTA | RATE_LIMIT | UNKNOWN` (`lib/detection.ts:93-117`).
- `ImagenError`: `NO_KEY | INVALID_KEY | SAFETY | RATE_LIMIT | DAILY_QUOTA | PAID_PLAN_REQUIRED | UNKNOWN` (`lib/imagen.ts:49-81`).
- Auto-fallback paid → free only on `PAID_PLAN_REQUIRED`. Daily-quota errors are NOT retried (no point — burns cache and confuses user).

### Free-tier limits
- Gemini Flash: ~10 RPM. We throttle 1.5s between variants. Daily quota ~1500 RPD per key.
- Gemini Flash Image: ~10 RPM. Same throttle.
- Flash-lite shares its own daily quota with regenerate / improve-batch — README warns not to auto-fallback `flash` → `flash-lite` for detection (would double-burn).

---

## 8. Components

### `components/three/`
- `Room.tsx` — Canvas host + OrbitControls + lighting.
- `RoomShell.tsx` — walls, floor, ceiling primitives.
- `Box.tsx`, `Closet.tsx`, `Furniture.tsx` — primitive renderers.
- `DynamicPart.tsx` — renders one ScenePart with the right shape, supports drag + gizmo.
- `Pickable.tsx`, `Draggable.tsx` — raycast wrappers.
- `Highlight.tsx` — hover / selection visual feedback (bounding box + footprint). Mounted inside the `Draggable` group so it inherits live transform. Selection box renders with `depthTest:false` (visible through occluders); hover box is depth-tested. Reads `useStudio.hoveredPartId` / `selectedPartId`.
- `CameraRig.tsx` — view preset transitions, frame-selected.

### `components/studio/`
- Layout: `TopBar`, `SecondaryNav`, `StudioTabs`, `RoomSwitcher`, `RoomSync`, `RoomDimsEditor`.
- View controls: `ModeToggle` (construction/finish), `ViewPresetChips` (free/front/top/iso), `TransformToolbar` (translate/rotate/scale), `KeyboardShortcuts`, `UndoRedo`.
- Scene UI: `PartTree` (list + lock toggle), `Inspector` (dims, material, cost), `AddPartButton`, `HoverCard`, `PlanView` (2D top-down drag), `PlanThumb`.
- Render UI: `RealizeFab`, `RegenerateModal` (per-object shape refine via Gemini), `RenderHistory`, `ReDetectButton`, `QuotaPill`.
- Banners: `DemoBanner`, `NarrowViewportBanner`.

### `components/spec/`
- `SpecDocument.tsx` — `@react-pdf/renderer` document for carpenter spec.

### `components/ui/`
- `Icon.tsx`, primitives (`DanmuMark`, `CornerRegs`, `Dot`, `IOSFrame`, `Toggle`, `StepHeader`), `LoadingOverlay`, `StorageToast`, `Confirm`.

---

## 9. `lib/` reference

| File | Role |
|---|---|
| `parts-catalog.ts` | **single source of truth for parts.** Catalog of shapes, default dims, room dims (`ROOM`), currency types. 3D, 2D, inspector, spec PDF all read from here. |
| `scene-spec.ts` | `ScenePart` type, default scene, detection→scene builder, collision check (`collidesAt`). |
| `scene-store.ts` | active scene parts in Zustand. |
| `detection.ts` | Gemini multimodal detection across 4 walls. |
| `imagen.ts` | render orchestration (paid + free), error classification, mask compositor (`compositePreserve`). |
| `mask.ts` | preserve-mask builder, blob downscale, image dim helpers. |
| `prompt.ts` | style/budget tokens, `composePrompt`, `estimateRenderCost`. |
| `pricing.ts` | currency conversion. |
| `quota.ts` | per-model call counter. |
| `history.ts` | undo/redo stack. |
| `physics.ts` | `groundY`, `wallAffinity`, `snapToWall`, `pullToward`, `isFloorStanding`. |
| `storage.ts` | IDB room store + types. |
| `store.ts` | Zustand: studio, compose, settings, room. |
| `capture.ts` | `getUserMedia` + canvas snapshot helpers. |
| `image-quality.ts` | post-capture quality scoring. |
| `regenerate.ts` | per-object shape refine via Gemini Flash-Lite. |
| `improve-batch.ts` | batch refinements. |
| `room-scene.ts` | scene-derived helpers. |
| `units.ts` | mm ↔ display unit conversion. |

---

## 10. Known gaps & roadmap

The product promise is "**move artefacts on the photo, AI regenerates only the rest**". Current build does not deliver that — it offers lock/unlock + a separate 3D scene drag that doesn't feed render. Concrete gaps:

### Blocking (core promise)
1. **No on-photo direct-manipulation editor.** Detection bboxes are shown as a text list on `/onboarding/detect`, not as draggable overlays on the capture. Need a `PhotoEditor` component (canvas overlay on capture, draggable bboxes, output `{partId, srcBox, dstBox, action: move|remove|swap}`).
2. **Mask is single-channel binary.** `lib/mask.ts:12` only encodes white=preserve / black=regen. Cannot express "fill old position + place at new position". Need three-region mask: untouched / src-inpaint / dst-place. Either RGB-coded or two-pass render.
3. **No object-reference injection.** `lib/imagen.ts:155-161` only sends base + mask. To preserve identity when an object moves, send a cropped object PNG as a 3rd `inlineData` part with a clause like "place this exact object at coords (x,y,w,h)". Nano-banana handles multi-image identity well — currently unused.
4. **No background inpaint pass.** When an object is removed/moved, the source region needs floor/wall regeneration. `app/room/[roomId]/render/page.tsx` does single full-image regen — no targeted inpaint step.
5. **Camera pose not pinned.** No prompt clause locking camera intrinsics. Realism breaks when model reframes. Fix in `lib/imagen.ts:117-123`: add "preserve original camera angle, focal length, vanishing points exactly".
6. **3D transforms don't reach the render.** `useStudio.positions/rotations/dims` are only used by Three.js views and the spec PDF. Render uses `detectedObjects` bboxes verbatim. Either (a) drop 3D-edit-feeds-render entirely and use the photo editor, or (b) project 3D transforms back to image-space dst boxes.

### Quality / DX
7. **Render downscales to 768px** (`lib/mask.ts:65-80`) — destroys small-object fidelity. Bump to ≥1024 for paid path; consider sending full-res crops alongside downscaled context.
8. **No catalog / swap flow.** User can't say "replace this sofa with a mid-century one". Add object library → drag onto detected slot → render with reference image.
9. **No cheap preview.** Free render is 10–30s + quota burn. Add client-side compositor that pastes object thumbnails at new positions for instant 2D mockup before committing a render call.
10. **No collision/overlap check after edit.** If user moves wardrobe in front of window, no warning. `collidesAt()` exists in `lib/scene-spec.ts:339` for 3D scene but not for photo-space edits.
11. **No per-object render history.** `useHistory` covers transform changes only. No "undo move on photo" or "compare before-move vs after-move render".
12. **Compose step asks style+budget but not edit-intent.** Should explicitly capture "keep / move / remove / replace" per detected object instead of free-text only.
13. **Preservation prompt is soft.** Add explicit "DO NOT alter, restyle, recolor, or reposition any locked object" with a strong consequences clause.

### Minimum-viable add (1 week)
1. New `components/studio/PhotoEditor.tsx`: capture + draggable detection bboxes, outputs displacement map.
2. Extend `Detection` type with `dstBox?: [x,y,w,h]` (`lib/detection.ts:12`) and persist in `RoomData.detectedObjects`.
3. New mask builder in `lib/mask.ts`: white = untouched-locked, black = src+dst regions of moved objects, optional second mask for "object-goes-here".
4. Render call sends: base + mask + cropped object refs (one `inlineData` per moved object) + prompt enumerating moves with coords.
5. Lift the 768px downscale ceiling for paid path.

---

## 11. How to extend safely

- **New furniture shape:** add to `Shape` union (`lib/scene-spec.ts:8`), `CATALOG_SHAPES` set (`lib/scene-spec.ts:124`), the detection prompt's catalog list (`lib/detection.ts:74-83`), `CATEGORY_DEFAULTS` (`lib/scene-spec.ts:96`), and add a renderer in `components/three/`. Update this doc.
- **New style or budget tier:** edit `STYLES` / `BUDGET_TIERS` in `lib/prompt.ts:7-21`. No store changes needed — `useCompose.styleId` is a string union, widen it.
- **New render model:** add to `ImagenModel` union and `COST_PER_VARIANT_USD` in `lib/imagen.ts:11-42`, then route in `renderRoom()`. Update `RenderModel` in `lib/store.ts:110` and the Compose UI.
- **New IDB field on `RoomData`:** add to `lib/storage.ts:43-63`. There is no migration system — write defensive readers (optional fields, fallbacks) since user data persists across deploys.
- **New onboarding step:** add a route under `app/onboarding/`, link from the previous step, update §3 + §4 here.

---

## 12. Operational notes

- **API key handling.** Lives in `localStorage` as `danmu-settings.apiKey`. Never sent anywhere except Google. README warns user to scope it (HTTP-referrer + API restriction). `useSettings.setApiKey()` wipes the cached `keyValid` result.
- **No telemetry by default.** Settings has a toggle but nothing is wired to send.
- **Storage pressure.** Captures + renders are PNG/JPEG blobs in IDB. `QuotaExceededError` fires `danmu:storage-full` event; `StorageToast` listens. Manual `clearRoom(id)` from `/settings` Danger zone.
- **Single-room v0.1.** `useRoom.roomId` holds the active one; `RoomSwitcher` exists but multi-room is roadmap.
- **No tests.** `pnpm typecheck` + `pnpm lint` are the only gates.

---

## 13. For an AI agent picking this up

Before you change anything:
1. Read this doc top to bottom.
2. Run `pnpm install && pnpm typecheck` to confirm a clean baseline.
3. Open `lib/scene-spec.ts`, `lib/detection.ts`, `lib/imagen.ts`, `lib/store.ts`, `lib/storage.ts` — these are the spine.
4. If the user describes a bug or wishes a feature, locate the relevant file via §3 / §9 first; do not search blindly.
5. If your change touches anything in §11's bullet list, **update this doc in the same commit** — the user will rely on this file staying current.
6. Honour the architecture rules: (a) all parts data flows from `parts-catalog.ts`, (b) no hard-coded design values — use Tailwind tokens, (c) no backend, (d) BYO key only.
7. The biggest in-flight initiative is the on-photo direct-manipulation editor (§10 items 1–6). If the user is steering you here, scope to the "Minimum-viable add" first.

---

## Changelog

- **2026-06-06** — Hugging Face FLUX render path (cheaper alternative) + camera-swing fix. (1) **Free/cheap render option:** added `'hf'` render model — browser-direct to the HF Inference-Providers router (CORS-verified `Access-Control-Allow-Origin: *`; legacy `api-inference` is dead). New `@huggingface/inference` dep + `lib/hf.ts#renderHF`: **img2img (FLUX.1-Kontext-dev) when a base image exists** (preserves the arrangement, ~$0.03/img), else **text-to-image (FLUX.1-schnell)** (~$0.003/img). HF's ~$0.10/mo free Inference-Providers credit makes the first renders free. BYO `hfToken` in `useSettings` + a Settings field (free HF account, "Inference Providers" permission). Wired into `render/page.tsx` (branches to `renderHF` for `rm==='hf'`), compose model picker, `estimateRenderCost`, `RealizeFab`, PaidConfirmModal (still gates since cost>0 after credit). `RenderResult.modelUsed` widened to `string`. *(Pollinations was rejected: free but text-to-image only, and can't ingest our local blockout without a public URL → no layout fidelity.)* (2) **Camera swing on select:** the frame-on-select effect had `selectedId` as a dep with a guard that only checked `frameToken!==0`, so after the first F-press every selection swung the camera to the new part. Now frames only when the token actually changes (explicit F), reading selection via `getState()`.
- **2026-06-05** — honest render pricing (Nano Banana is NOT free). The app mislabelled `gemini-2.5-flash-image` ("free") everywhere, but its image OUTPUT is billed by Google (~$0.039/img, output-image tokens) — the free *tier* allows **0** image requests (that's the `limit:0` we saw), so any successful render bills. Priced `free` at **0.039** in both `prompt.ts` + `imagen.ts` `COST_PER_VARIANT_USD`, which (a) makes `estimateRenderCost` show the real ~$0.04/img instead of "FREE" and (b) flips `cost.isPaid` true so the **existing paid-render confirm gate now fires for Nano Banana too** (compose `realize()` + `RealizeFab`). Relabelled the model picker ("Gemini Nano Banana · Paid · billed per image"), the EST-COST captions, the loader text, the PaidConfirmModal (model-aware name + "image generation is never free, only detection/text is"), the FAB subtitle/confirm, and the render header/error copy. Only detection/text (`gemini-2.5-flash`) remains genuinely free.
- **2026-06-05** — render reflects the actual arrangement + active view (was stale). Root cause of "wardrobe rotation resets after realize" + "render shows models/positions not in my scene": `SceneCapture` (the 3D snapshot that becomes the render's base image) only re-captured on `useScene.parts`/`room` changes — it ignored the transform overrides (`useStudio.positions`/`rotations`/`dims`) AND camera movement (camera moves don't trigger React renders). So the render used a stale blockout with the detected layout/angle. Rewrote `SceneCapture` to a `useFrame` settle-debounce: any arrangement OR camera change marks dirty, and ~600ms after the last change it takes exactly one snapshot **from the current camera + current transforms** — so the realized image now matches the exact view + layout the user is looking at. Editor helpers (selection `Highlight` — tagged `userData.helper` — + the TransformControls gizmo) are hidden during the snapshot so they don't bake into the render. Prompt hardened to a **closed set**: the furniture schedule is declared the "COMPLETE and EXCLUSIVE inventory — render these and NOTHING else", the blockout intro says reproduce the same items/count/placement/orientation and "add nothing, move nothing" — kills hallucinated furniture/decor.
- **2026-06-05** — photoreal render tuning (less "3D software", more "real photo"). The leading prompt tokens ("wide-angle, professional architectural photography… 8K") were pushing the model toward clean CGI/archviz output. `composePrompt` now leads with **camera language** ("A real photograph… shot on a full-frame DSLR with a 35mm lens at eye level"), appends a `PHOTO_LOOK` block (natural daylight + GI, true-to-life material microtexture, real imperfections, shallow DoF + vignette + film grain, AD-magazine colour grade) and an inline `ANTI_CG_NEGATIVE` clause ("NOT a 3D render/CGI/Blender/Unreal, no plastic surfaces, no over-smooth geometry…"). The blockout intro in `render/page.tsx` now stresses the output must look like a real photo of the finished room, NOT a render of the placeholder primitives. Paid Imagen also gets a real `negativePrompt` (free Gemini-image has no negative field, so it rides inline). *(Free Nano-Banana is inherently weaker than paid Imagen at photoreal; this narrows the gap.)*
- **2026-06-05** — render dimension fidelity + compare slider + delete renders. (1) **Render ignored 3D-model dimensions/scale** — the prompt only said "room proportions", so the model free-interpreted scale (3 m sofa → loveseat). `render/page.tsx` now builds a **dimension manifest** from the loaded room size + a metric furniture schedule (each part `W×D×H`m, read fresh from the scene store) and appends it with a "respect these exactly; don't enlarge/shrink/add/remove/rearrange; no fisheye" clause to every prompt (blockout + photo). (2) **Before/after slider non-functional** — when a room was rendered from the 3D blockout (no real photos) there was no "before" image, so the slider revealed nothing. Compare now falls back to the **3D scene snapshot** as the before (label "Before · 3D model"), shows an explicit placeholder if neither exists, and reuses one object-URL per variant (was re-minting + leaking on every React render). (3) **Delete renders** — new `roomStore.deleteRender(roomId, id)`; compare's variant strip gains a trash button per variant (confirm modal via `useConfirm`), revoking the URL + fixing `activeIdx`, falling back to the empty state when the last one is removed.
- **2026-06-05** — shadow-trail real fix + tabletop placement. (1) **Shadow/gizmo trails** (the prior `preserveDrawingBuffer`/`frameloop` changes only half-helped): the real cause was the **transparent canvas + EffectComposer (N8AO)** blending each frame over the last, so moving objects smeared. Added an opaque scene background (`<color attach="background" #FBF8F2>`) so the render pass clears the colour buffer every frame — definitive fix. (The page grid behind the canvas was ~invisible at 0.03 alpha, so no visible loss.) (2) **Can't place laptop/monitor/etc. on a table or bed** (always snapped to floor): `Draggable.commit`'s `topmostSupport` + `collidesAt` read each other part's **base** `pos`/`dimMM`, ignoring live `useStudio.positions`/`dims` overrides — so support detection was blind to where furniture had actually been moved. Now builds an effective-position snapshot (`positions[id] ?? pos`, `dims[id] ?? dimMM`) and feeds it to both, so a tabletop-prone item dropped over a surface rests on it.
- **2026-06-05** — door floor-clip + identity sweep + platform de-mono. (1) **Door clipped through floor** even via snap-to-floor/surface: `DoorGeo` authored its panel centered at `y=0`, but a door is floor-anchored (`anchorFor`→'floor', `groundY`→0) so the group origin sits ON the floor — half the panel sank below. Re-anchored the panel bottom-to-floor (`position=[0, h/2, 0]`), handle at ~1 m. (2) **"Door named tall mirror"** — `Inspector.swapModel` updated `{category, shape, dimMM, wallMounted}` but **not `name`**, so a swapped-in part kept its old label, creating a wrong/conflicting identity. Now sets `name: item.label`. (Stale pre-existing parts: re-swap or rename to fix.) (3) **HoverCard double identity** — dropped the category eyebrow (it duplicated, and could conflict with, the name); the card now shows a single identity (`part.name || part.category`) + the lock/new-build badge. (4) **Platform-wide de-mono/sentence-case sweep** — removed leftover CAD `font-mono`+uppercase+letter-spacing from TEXT labels across all onboarding/room/workspace/settings pages and ~20 studio/ui components, converting eyebrows→`.ds-label`/`.ds-kicker` and sentence-casing literals; `.mono` retained strictly for numerals/codes/keyboard-keys. `StudioTabs`→rounded sans pill w/ icons. *(Deliberately left mono: LoadingOverlay HUD/tips loader aesthetic.)*
- **2026-06-05** — UI bug sweep: banner / shapes / shadow trails / glyph icons. (1) **DemoBanner** capped to `min(560px, 100vw-32px)` + content wraps inside the pill so the dismiss × no longer clips off a narrow studio pane; squared to `--r-2`, added a camera icon, merged the CTA inline. (2) **laptop rendered as a monitor** — `buildSceneFromRoom` trusted the detector's generic `shape:'monitor'` over the label. Now **label-based `refineShape` wins** whenever it resolves a *specific* variant (≠ the category's default shape); raw AI shape is only the fallback for generic labels. Fixes laptop→laptop, oval-mirror, office-chair, etc. (3) **Shadow/gizmo trails** — root cause was `preserveDrawingBuffer:true` + the EffectComposer's non-clearing final pass keeping stale pixels. Dropped the flag; `SceneCapture` now copies the freshly-rendered WebGL canvas into a 2D canvas *synchronously* (same tick) before `toBlob`, so the blockout snapshot still works with the buffer un-preserved. (4) **Missing/tofu glyph icons → real `Icon`s:** added `swap`/`snap-wall`/`snap-floor`/`snap-surface` to the icon set; replaced `⊣ ⤓ ▼ ⇄ ↺` in `Inspector`, `∅ + ↶` in `PhotoEditor`, and `✦` in `workspace`. (5) **Consistency:** `StudioTabs` de-mono'd → rounded sans pill with icons + sentence case ("2D Plan" / "3D Model"). *(Remaining holdouts: SecondaryNav eyebrow, detect-page chrome — minor.)*
- **2026-06-05** — detect free-tier `limit: 0` (image gen needs billing). Confirmed via a live 429 body: `gemini-2.5-flash-image` returns `RESOURCE_EXHAUSTED` with **`limit: 0`** on all three free-tier quotas (input-tokens/min, requests/min, requests/day) — image generation simply isn't in the free tier for a no-billing key; the `retryDelay` is bogus. New `IMAGE_QUOTA_ZERO` `ImagenError` code: `classifyError` detects `/limit:\s*0/` and `callFreeWithRetry` skips its (futile) retry; `render/page.tsx` `ErrorView` shows a "needs billing (~$0.04/img); text stays free" message instead of a misleading per-minute countdown. (SDK bump in the prior entry was still essential — it's what made the request actually reach Google to *return* this 429 instead of hanging.)
- **2026-06-05** — hard AbortSignal + render diagnostics. A timer-race only rejects our promise; the SDK's underlying fetch kept running, so a stalled call still held the loader open past every timeout. Now `callFreeWithRetry` creates an `AbortController` (auto-aborts at **90s**) and passes `config.abortSignal` (supported by `@google/genai` 2.x) — the request is truly cancelled at the transport level. `classifyError` maps abort → a clear "stalled 90s, model never responded" message. Added `console.info` breadcrumbs ([render] prep load → prep done → generateContent start → done) so a hang's location (data-prep vs API call) is visible in DevTools.
- **2026-06-05** — **bumped `@google/genai` 0.3.1 → 2.8.0** (the real render hang). 0.3.1 (early-2025) routed `generateContent` to a stale API surface that never returned for the new `gemini-2.5-flash-image` model — the call hung indefinitely (past every client-side timeout, since the request never resolved at the transport level). 2.x targets the current endpoint. API shape was compatible (no code changes needed for `generateContent`/`generateImages`/response parsing). Also **re-added `config.imageConfig.aspectRatio`** (`req.aspectRatio ?? '4:3'`) — 2.x supports it (0.3.1 didn't), so output is correctly framed. `tsc` clean.
- **2026-06-05** — whole-render watchdog + Cancel escape hatch. The imagen.ts 120s timeout only wraps the Gemini call; a stall anywhere else (or a stale-HMR bundle where that timeout isn't live) left the loader spinning. `render/page.tsx`: the entire `mutationFn` now races a **150s guard** so any hang surfaces as an error. `LoadingOverlay` gains an optional `onCancel` — when set, "DO NOT CLOSE" becomes a **CANCEL** button; the render page wires it to reset the mutation + return to compose, so the user is never trapped in an endless render.
- **2026-06-05** — offline detection (no false wait on disconnect). New `OFFLINE` `ImagenError` code + `withConnectivity()` wrapper in `imagen.ts`: pre-checks `navigator.onLine` (fail-fast before firing) and races the in-flight `generateContent` against the browser `offline` event so a **mid-render disconnect rejects immediately** instead of waiting out the 120s timeout. `classifyError` also maps `Failed to fetch`/network errors → `OFFLINE` when the browser is offline. `render/page.tsx` `ErrorView` gains an `OFFLINE` entry ("No internet connection… no quota was spent"). Retry logic ignores OFFLINE (no wasteful 429-style retry).
- **2026-06-05** — render timeout + honest loader. Two issues behind "stuck at 67% forever": (1) **no timeout** — a hung `generateContent` spun the loader indefinitely; added `withTimeout(…, 120s)` around the paced call in `imagen.ts` so a non-responding request rejects with a readable `UNKNOWN` error instead of hanging. (2) **fake progress lied** — the phase ticker hard-capped at idx 3 (67%/"step 4/6"), so every render *looked* frozen there; now advances to the real long step (idx 4 "Generate" → 83%) and holds, and the overlay shows a live **elapsed-seconds clock** (+ a "taking longer than usual" note past 45s). `render/page.tsx`.
- **2026-06-05** — error boundaries added (fixes "missing required error components"). The app had **no** `error.tsx` / `global-error.tsx` / `not-found.tsx`, so any runtime crash (or a `.next` cache corrupted by deleting it mid-run) surfaced Next's cryptic "missing required error components, refreshing…" overlay. Added all three: `app/error.tsx` (route-segment boundary, logs + Try-again/Go-home, design-token styled), `app/global-error.tsx` (root boundary with its own html/body), `app/not-found.tsx` (404). Also cleared the stale `.next`.
- **2026-06-05** — **free render actually returns an image now + pipeline audit.** Real bug: the free `generateContent` call omitted `config.responseModalities`, so `gemini-2.5-flash-image` could reply text-only → "Gemini returned no image". Added `config: { responseModalities: ['IMAGE'] }` ([Google Nano Banana docs](https://ai.google.dev/gemini-api/docs/image-generation)). (SDK is `@google/genai` **0.3.1** — no `imageConfig`, so aspect ratio is model-default; noted for a future SDK bump.) Also: **StrictMode double-fire guard** — the render mutation fired twice on dev mount (2 billable calls); now ref-guarded. Pipeline trace verified end to end: compose model selector (default `free`) → realize → render reads model fresh from store → `renderRoom` (free→`renderFree` w/ pacing+responseModalities; paid→`renderImagen` with PAID→free auto-fallback) → variants saved → compare. (`useCompose` is **not persisted**, so `renderModel` resets to `free` each load — a stale PAID screen means an un-restarted dev bundle.)
- **2026-06-05** — one-click free Nano Banana fallback on render errors. `render/page.tsx` `ErrorView` gains an `onUseFree` action (shown only when the current model is *paid*): a prominent green **"Render free with Gemini Nano Banana"** button that calls `setRenderModel('free')` + re-runs the mutation; Retry demotes to secondary ("Retry paid"). Fixed a latent **stale-closure bug**: the mutation read `renderModel` from the render-time closure, so a mid-flight model switch wouldn't apply — now reads `useCompose.getState().renderModel` fresh at call time. Compose-page free-tier copy corrected (5/min·100/day → ~10/min·500/day). (Compose already offered Nano Banana as the default model + in the paid-confirm modal; this closes the error-recovery path.)
- **2026-06-05** — **render path fix: dead model + client-side pacing.** Root cause of "no render ever succeeded": the free path called **`gemini-2.5-flash-image-preview`, which Google discontinued 2026-01-15** — every call hit the retired endpoint's gutted quota (surfaced as a bogus per-minute 429). Migrated the model ID → **`gemini-2.5-flash-image`** (stable) across `imagen.ts` (`ImagenModel` union, `COST_PER_VARIANT_USD`, `renderFree`, `renderRoom` fallback, `generateContent`) + `render/page.tsx`. `quota.ts`: `flash-image` daily limit 100 → **500** + comment refresh. **Client-side pacing:** new module-level `paced()` serial queue in `imagen.ts` wraps every `generateContent` call — holds ≥6.5s between calls (≈10 RPM cap) across variants, retries, and back-to-back renders in the tab, so bursts self-throttle instead of 429ing.
- **2026-06-05** — rate-limit retry honors Google's `retryDelay` + accurate copy. The free Gemini Flash Image path auto-retried 429s with a blind 6s/12s backoff — but a per-minute cap can't clear in <60s, so both retries also 429'd and just burned more quota, then the error screen offered an *instant* Retry that re-tripped it. `imagen.ts`: `parseRetryDelaySec()` reads Google's `retryDelay` from the 429 body; `callFreeWithRetry` now only auto-retries when the wait is ≤20s (short burst), otherwise surfaces immediately; `ImagenError` gains `retryAfterSec`. `render/page.tsx` `ErrorView`: RATE_LIMIT copy corrected (was "5/min" → ~10 RPM + 500/day) and the **Retry button is gated by a live countdown** (`Retry in Ns`, from `retryAfterSec` or a 60s window) so an instant click can't re-exhaust.
- **2026-06-05** — render from 3D blockout when no photos. New "no captures → reimagine the 3D scene as a real room" path. `Room.tsx` gains `preserveDrawingBuffer` + a debounced `SceneCapture` that screenshots the live canvas to IDB (`roomStore.saveSceneSnap`/`loadSceneSnap`, key `room:{id}:scenesnap`). `render/page.tsx`: when there are no captures, loads the scene snapshot as the base image (`isBlockout`) and prepends a prompt clause telling the model it's a flat-shaded blockout to reimagine photorealistically (keep camera/layout/positions/colours). **`imagen.ts` fix:** the free path attached the base image only when a mask was *also* present — now base attaches whenever present (mask optional), so the blockout image is actually sent. Also de-mono'd the render error kicker.
- **2026-06-05** — shadow-trail fix + holdout mop. **Trail fix:** `Room.tsx` `frameloop` `demand` → **`always`** — with the EffectComposer (N8AO) in the pipeline, on-demand frames weren't clearing the framebuffer, so moving objects left a shadow/gizmo trail; continuous render clears each frame (perf still held by `AdaptiveDpr` + `PerformanceMonitor`). **Holdouts:** `RealizeFab` → pill button + sentence-case sub + `.ds-chip` tweak link (was mono); modal kickers in `AddPartButton` / `Inspector` (swap) / `RegenerateModal` de-mono'd to `.ds-kicker` ("Add a model" / "Swap model" / "AI refine").
- **2026-06-05** — sweep cont'd + de-cliché. Removed the **left accent-bar selection indicator** on `.list-row.is-selected` (the generic-AI "active item" tell) — selection is now a clean tinted fill; the leading status dot is round + scales when selected. Dropped the decorative **✨** from `DemoBanner` (sparkle-on-everything = AI-UI cliché; kept only on actual AI-render actions). Continued the class sweep: `TransformToolbar` mode group → `.toolbar`; detect-page labels/captions de-mono'd + sentence-cased ("Detected", "Drag a box to move…"). *(Remaining inline holdouts: TopBar, RealizeFab tooltip, modals — minor.)*
- **2026-06-05** — studio CSS migration (inline → token-driven classes). Added semantic classes to `app/globals.css` (`.rail`/`--left`/`--right`, `.section`/`.section-head`/`.section-title`/`.section-meta`, `.field`, `.list`/`.list-row`/`.is-selected`/`.row-action`, `.tag`, `.popover`, `.toolbar`) so future restyles happen in one place. Migrated the two studio rails: model-page asides → `.rail`; `PartTree` search → `.field`, list → `.list`, rows → `.list-row.is-selected` (CSS `:hover` for background), category chips → `.tag`; `Inspector` `Section` → `.section`/`.section-title`; sentence-cased + de-mono'd the section labels (Dimensions/Colour/Placement/Cost/Room shell). *(Follow-up: TopBar, TransformToolbar, ViewPresetChips, detect page still inline — same patterns apply.)*
- **2026-06-05** — UI aesthetic shift: CAD → warm rounded casual. Design-system revamp in `app/globals.css` + `app/layout.tsx` so the chrome matches the soft 3D models. Body font Geist → **Nunito** (rounded humanist); **Fraunces** serif now the default for `h1/h2/h3/.display`; Geist Mono reserved for numerals. Palette warmed (soft brown-black ink, cream paper, clay `--accent` + sage `--accent-2`). Radii bumped (`--r-1/2/3` 6/10/16 + `--r-card` 20) and soft layered shadows (`--shadow-soft/-lift`). `.ds-label`/`.ds-kicker` dropped mono+uppercase → friendly sans; `.ds-btn` rounder with hover-lift + shadow; `.ds-chip`/`.ds-input` sans + rounded; new `.ds-card`; blueprint `ds-grid-bg` softened. Cascades across onboarding / workspace / studio chrome. *(Note: studio panels with inline `borderRadius:2`/inline mono still read sharper — a per-screen art-direction pass is the follow-up.)*
- **2026-06-05** — more detail + new appliances. **6 new appliance shapes** (`soundbar`, `radiator`, `air-purifier`, `washing-machine`, `microwave`, `water-dispenser`) — added to the `Shape` union + `CATALOG_SHAPES` + `PART_LIBRARY` (Appliances/Tech groups) + the regenerate & detection prompt catalogs, with detailed renderers in `DynamicPart.tsx` (washing-machine door ring + glass, microwave window/handle, water-dispenser taps + inverted bottle, radiator fins, air-purifier slats + lit top, soundbar grille). **Pushed existing:** TV now has a recessed glowing screen; fridge gained brushed-steel handles, a freezer split line + feet. All under existing categories (`fridge`/`tv`) — no new `Category` churn.
- **2026-06-05** — model geometry revamp (de-flatten). `components/three/Box.tsx` now renders a **`RoundedBox`** (beveled corners that catch light/AO) and **outlines are OFF by default** (`edgeOpacity` 0) — the hard ink edges were the main "flat CAD" tell; accent calls can still opt in. This lifts every box-built model at once (sofa, wardrobe, bed, desk, tables, fridge, ottoman, nightstand, bookshelf…). Material default roughness 0.8 + `envMapIntensity`. Targeted revamps in `DynamicPart.tsx`: **rug** = thin soft slab with a woven inset border (was a zero-thickness plane); **plant** = tapered pot + soil + a clustered multi-blob canopy (was one lollipop sphere); **sofa** = added plush back cushions; **bed** = added a draped duvet. New `shade()` hex helper for tonal variation. *(Aesthetic note: this drops the default hard edge lines in favour of rounded + AO realism — a step further from the old CAD look, per "models too flat".)*
- **2026-06-05** — proper fixes: footprint-aware detection, scale snap, colour-all-models, curtain revamp. (1) **Detection is no longer hardcoded to 5.6×4.2** — `PROMPT` → `buildPrompt(room)` interpolating the real W/D/H + wall coords; for L/T/U it now passes the **footprint polygon vertices** and instructs the model to keep every object inside it. `detectAcrossImages(apiKey, images, room?)`; the detect page passes the loaded room. (`clampIntoFootprint` stays as a safety net.) (2) **Scale snapping** — TransformControls has no `scaleSnap`, so `Draggable.commit` snaps the resulting dims to the increment (10mm fine / 50mm coarse) when in scale mode and writes the snapped scale back. (3) **Colour works on all colourable models** — threaded `part.color` through curtain, floor/table/pendant lamps (shade), plant (pot), painting (canvas), door, AC (was: only the big furniture; the curtain etc. ignored colour). (4) **Curtain revamp** — replaced the two flat billboard planes with accordion **pleats** (alternating-rotation strips that catch light) + a proper horizontal rod with finials, fabric PBR; no longer flat.
- **2026-06-05** — support-snap fix + footprint in scene build. (1) **"Snaps to middle not bottom"** — `findSupportUnder` (`lib/physics.ts`) + `topmostSupport` (`Draggable.tsx`) used a loose bounding-*circle* overlap, so a part beside a neighbour grabbed the neighbour's top (mid-air) instead of dropping to the floor. Now the mover's **centre must sit over the support's footprint** (AABB + 5cm margin). (2) **Footprint in `buildSceneFromRoom`** — detection still reasons about a rectangle, so items could spawn in an L/U/T void; new `clampIntoFootprint` (steps toward centroid) pulls each detected item's XZ back inside the room polygon at build time.
- **2026-06-05** — preset room shapes + snap points + deprecations. **Room shapes:** new `lib/footprint.ts` (polygon footprint per layout — `footprintForLayout` for rect/l/t/u/open, `pointInFootprint`, `wallSegments` with inward-normal yaw). `scene-store` room now carries `{layoutId, footprint}` (derived on load + on dim edits). `RoomShell.tsx` renders the floor as a `ShapeGeometry` polygon + one inward-facing culled wall per edge (replaces the hardcoded 4). Containment: `Draggable.commit` + `PlanView` reject moves whose centre leaves the footprint; PlanView draws the polygon outline. `layout-pick` gains a U-Shape preset; `RoomData.layoutId` adds `'u'`. *(Note: detection placement still assumes a rectangle — items detected into an L/U notch may need a nudge; drag-guard + snap tools handle it.)* **Snap points:** snap increments are now **10mm / 15°** (fine) and **50mm / 45°** (coarse, also lands on 90/135/180°) — was 1cm/2.5° + 5cm/7.5°; the toolbar button now reads the actual values (`Snap 50mm · 45°`) instead of a vague "Fine". **Deprecations/declutter:** Inspector — **Swap model** is now the primary action, **Regenerate** demoted to a small "AI refine" (tooltip notes it uses quota); removed the duplicate dim-unit selector from `RoomDimsEditor` (kept the Inspector one); dropped the part ID from the header subtitle; trimmed the dims caption.
- **2026-06-05** — color-bug fix + Inspector cleanup. (1) **Colour didn't apply** — `DynamicPart.body()` checked `locked` before `color`, and most detections auto-lock (conf≥0.85), so the blue tint always won. Reordered: explicit `part.color` (photo-sampled or user-picked) now wins; locked-blue only when no colour. (2) `Inspector.tsx` — removed the **MATERIAL · FINISH** section (not needed on the modelling screen; `ScenePart.material` data untouched) and its now-dead `MaterialEditor`/`categoryMaterial`. (3) **Snap surfaced** — Snap to Wall / Surface / Floor are now a visible **PLACEMENT** button row (were buried in the ⋯ menu); ⋯ menu + `MoreItem` removed, Regenerate/Swap/Reset are plain buttons.
- **2026-06-05** — aesthetic = tuned hybrid + Phase E swap. **Aesthetic:** reconciled the realism layer with the CAD line-art base — `Box.tsx` edges lighter/warmer (`#3a352e` @ 0.4) + flatter material (roughness 0.9, metalness 0); `materials.ts` `SURFACE` presets matte-leaning (metals brushed not mirror); mirror softened (`metalness 0.5, roughness 0.24`); `Room.tsx` N8AO intensity 2.2→1.1, Environment lightformers + exposure dialled down. **Phase E (hybrid swap):** extracted `LibraryPicker` to its own component (shared by Add + Swap); `Inspector.tsx` gains **⇄ Swap model…** (in the ⋯ menu + a prominent banner when `shape==='box'`) that replaces a part with a `PART_LIBRARY` model in place — keeps position + colour, re-grounds Y for the new dims/mount type, clears stale transform overrides.
- **2026-06-05** — nav/snap/2D fixes. (1) `CameraRig.tsx` — WASD now also pans (alias of arrows) but only when no part is selected, so W/S/R stay gizmo-mode shortcuts while editing. (2) `Inspector.tsx` — added **⊣ Snap to wall** (uses `physics.snapToWall`, all parts) alongside the renamed **▼ Snap to floor** + ⤓ Snap to surface; ⋯ menu always available now. (3) `PlanView.tsx` — 2D translate clamp is now footprint-aware (rotation-projected half-extents) matching the 3D `Draggable`, so objects no longer cross the wall outline in plan view (removed the fixed `INSET`).
- **2026-06-05** — color pipeline + recolor + AO + build-mode nav (plan: realism/color/customization/navigation). **A — Photo colour:** `Detection`/`detectedObjects`/`ScenePart` gain `color?` (hex); new `lib/color-sample.ts` samples the dominant colour from each detection's photo region (median, highlight/shadow-rejecting) with a Gemini-hex fallback (prompt now requests `color`). Detect page fills colour after detection; `buildSceneFromRoom` → `ScenePart.color`; `DynamicPart.tsx` `body()` helper threads it into body surfaces (locked-blue still overrides). **B — Recolor:** `ColorEditor` in `Inspector.tsx` (native picker + swatch row + reset-to-default), persists via existing `updatePart`→RoomSync `saveSceneParts`. **C — Rendering:** added `@react-three/postprocessing` + `postprocessing`; `Room.tsx` now runs `<EffectComposer>` `<N8AO halfRes>` + `<SMAA>` for ambient occlusion, gated by `<PerformanceMonitor>` (drops DPR ceiling) + `<AdaptiveDpr>`. *(RoundedBox / bundled textures deferred to keep the CAD edge aesthetic + avoid binary assets.)* **D — Navigation:** `CameraRig.tsx` enables pan (right-drag) + `KeyboardNav` (arrow-key floor pan, Q/E orbit — WASD left to the gizmo shortcuts); `showGrid`+`toggleGrid` in the studio store with a GRID chip in `ViewPresetChips`; help pill updated. **Queued:** Phase E hybrid swap; optional RoundedBox/textures/reflector-floor.
- **2026-06-05** — laptop/oval shapes, clipping fixes, local-model library. (1) New shapes `laptop` (open clamshell, surface-resting) + `mirror-oval` (elliptical, wall-hung) — added to `Shape` union, `CATALOG_SHAPES`, `refineShape` (monitor→laptop on laptop/notebook/macbook; mirror→mirror-oval on oval/round/arch), the `regenerate.ts` + `detection.ts` shape catalogs, and `DynamicPart.tsx` renderers. Fixes "asked for oval, got rectangle" and "laptop became a monitor". (2) **Mirror-through-floor** root cause: wall-mounting was decided by category alone, so a "mirror" returned as category:other fell to floor-anchored + centred geometry → half below floor. Replaced `categoryWallMounted` with shape-aware `isWallMountedPart(cat, shape)` = `anchorFor(...) !== 'floor'`; `placeNewPart` now clamps the centre so a wall item's edges never cross floor/ceiling. (3) **General wall clipping** (exposed by the thin dollhouse walls): `Draggable.commit` now clamps the part's full *rotation-aware footprint* inside the walls (replaces the fixed 0.4 m inset) and clamps centred parts vertically; uses `isFloorStanding`-derived `centered` instead of the stale `wallMounted` flag. (4) **Add-model UX:** `AddPartButton` modal now has two tabs — **Local models** (new `LibraryPicker` over `PART_LIBRARY`, ~30 common items grouped Seating/Tables/Storage/Bedroom/Lighting/Decor/Tech/Appliances, instant add, no API) and **Describe (AI)** (the existing Gemini prompt path). Both spawn through a shared gravity-aware `spawn()`.
- **2026-06-05** — placement bugs + dollhouse walls + shading pass. (1) `lib/physics.ts` — monitor is no longer `wall-mid` anchored (desktop monitors rest on desks); it's floor-anchored + tabletop-prone so settle/gizmo drop it onto the surface below instead of floating at 1.4 m. (2) `lib/scene-spec.ts` — new `placeNewPart()` + `categoryWallMounted()`; `components/studio/AddPartButton.tsx` now spawns added parts with gravity applied (wall-mounted → mounting height, else rest on surface/floor) instead of `pos:[0,0,0]` — fixes mirrors spawning half-buried in the floor. (3) `components/three/RoomShell.tsx` — rebuilt as a 4-wall dollhouse: each wall is a single-sided plane with its normal pointing into the room, so the wall nearest the camera back-face-culls automatically while the others stay (no per-frame work). Floor/walls now `meshStandardMaterial`; added skirting. (4) `components/three/Room.tsx` — ACES filmic tone mapping, hemisphere + key + fill lighting (replaces flat ambient + 2 directionals), and `<ContactShadows>` for soft grounding. (5) `components/three/Box.tsx` — `meshLambertMaterial` → `meshStandardMaterial` (roughness 0.78) + cast/receive shadow. (6) **Realism path = improve primitives (no GLB bundling / no cloud gen).** New `components/three/materials.ts` (`SURFACE` PBR presets: wood / metal / fabric / glass / foliage / screen…). `DynamicPart.tsx` — all 33 `meshLambertMaterial` → `meshStandardMaterial`; mirror is now a true reflective surface (`metalness 1`), screens emit, metal poles/bases use `SURFACE.metal`. `Room.tsx` — added an **offline `<Environment>`** built from inline `<Lightformer>`s (no CDN/HDR fetch, baked `frames={1}`) so metals have something to reflect and standard materials get specular gloss. **Open:** a `laptop` shape (currently routes to `monitor`); optional next shading = N8AO (needs `@react-three/postprocessing`).
- **2026-06-05** — model-page declutter, round 2. (1) `TopBar.tsx` — `↳ AUTO-SAVING` text → a 6px status dot (green flash + `SAVED` on write) with tooltip. (2) `QuotaPill.tsx` — button label `QUOTA · N LEFT` → just `● N` (tooltip + click-through breakdown unchanged). (3) `TransformToolbar.tsx` — the 3 snap chips (Free/Fine/Coarse) collapse into one `SnapCycleButton` that cycles off→fine→coarse and shows the active label + dot. (4) `Inspector.tsx` — Snap-to-surface / Ground / Reset-transforms moved into a `⋯` overflow menu next to Regenerate (new `MoreItem` helper); Regenerate + Delete stay visible. (5) `PartTree.tsx` — removed the SCENE TOTAL / NEW / LOCKED / TOTAL cost block from the modelling view (cost belongs on Spec / Realize); footer now renders only when there are edits, showing just "Reset all to detected". Dropped the now-unused `estimateCost` import + cost computations.
- **2026-06-05** — model-page declutter (redundant info removed). (1) `Inspector.tsx` — dropped the `W×D×H MM` badge; `DimensionEditor` below already shows the same values editably with a unit selector. (2) `app/room/[roomId]/model/page.tsx` `HintPill` — the always-on shortcut bar (which duplicated the `TransformToolbar` buttons + left-rail text) is now a compact `?` pill that expands the shortcut card on hover; when a part is selected it shows just the active-mode dot. (3) `PartTree.tsx` — removed the "Click row to select / W·S·R…" instruction paragraph (covered by toolbar + help pill). (4) `RoomDimsEditor.tsx` — "ROOM SHELL" is now collapsed by default (top bar already shows room dims) with a live `W × D × H` summary in the header; expands to the editable grid on click.
- **2026-06-05** — 3D interaction feedback. New `components/three/Highlight.tsx`: hover = soft depth-tested bounding box (blue), selection = bright accent box (orange) drawn through occluders (`depthTest:false`) + footprint loop on the resting surface for floor-standing parts. Wired into `components/three/Draggable.tsx` (reads `hoveredPartId`/`selectedPartId`, sized from base `dimMM` so the group's gizmo scale tracks it). Closes the gap where pointer state was tracked in the store but never rendered on the mesh — previously hover only changed the cursor and selection only showed the gizmo.
- **2026-05-10** — initial doc. Captures v0.1 state, identifies 13 gaps for the on-photo move-objects flow, includes 1-week MVP scope.
- **2026-05-10 (rev 5)** — ceiling clamp + finer snap.
  - **Ceiling clamp** added in both the settle pass (`lib/scene-spec.ts`) and the runtime commit (`components/three/Draggable.tsx`). No part top can exceed `room.height - 2cm`. Floor-standing parts ride down so `pos.y + h ≤ cap`; wall/ceiling-centered parts ride down so `pos.y + h/2 ≤ cap`.
  - **Snap granularity** is now user-selectable. New `useStudio.snapMode = 'off' | 'fine' | 'coarse'` (default `fine`). `fine` = 1cm translation / 2.5° rotation. `coarse` = old 5cm / 7.5°. `off` = no snap. Wired through `components/three/Draggable.tsx` for both `translationSnap` and `rotationSnap`.
  - **TransformToolbar** gained a 3-position snap toggle next to the Move/Scale/Rotate buttons. Persists across selection changes.

- **2026-05-10 (rev 4)** — gravity settle pass + ground UI.
  - **`lib/physics.ts`** — new `findSupportUnder(parts, selfId, x, z, dim) → number | null` returns the highest supporting top under an XZ footprint (rugs + wall-mounted excluded). New `isTabletopProne(category)` set: `monitor`, `lamp`, `plant`, `ottoman`, `other`.
  - **`lib/scene-spec.ts` settle pass** — after `buildSceneFromRoom`'s placement loop, second pass: (a) for tabletop-prone parts with a >0.3m support beneath, snap Y to that surface top (monitor/laptop on desk, lamp on table); (b) for any floor-standing part with Y > 0.05 and no support under it, drop to floor — recovers from bad AI Y estimates. Runs every time the scene rebuilds, so existing saved rooms self-heal on next load.
  - **`components/studio/Inspector.tsx`** — added two buttons (visible on non-wall-mounted parts): **⤓ Snap to surface** (drops onto highest support / floor) and **▼ Ground** (force Y=0). Both write through `useStudio.setPosition` so the change survives session.

- **2026-05-10 (rev 3)** — bug-fix sweep.
  - **TS clean:** fixed 4 pre-existing TS errors. `components/three/CameraRig.tsx` — `Vector3.set(...readonly tuple)` was rejected by TS; switched to explicit indexed args. `components/three/Draggable.tsx` — `useRef<Group>(null)` made `.current` read-only; changed to `useRef<Group | null>(null)`. `topmostSupport()`'s `parts` param was typed via `ReturnType<typeof useScene>` which resolved to `unknown`; typed as `ScenePart[]` directly.
  - **Render mask gating:** mask + object refs are now only built when at least one detection is `locked | dstBox | removed`. Previously any detections in a slot triggered an all-black mask (wiped preservation intent).
  - **Race fix:** render page used to build the prompt from local state then fire `mutation.mutate()` on mount — the `moved/removed` names loaded async could arrive after the call. Now the final prompt is rebuilt **inside `mutationFn`** against the freshly-loaded RoomData; component-level prompt state removed.
  - **Compose prompt:** moved/removed names now feed through `composePrompt({…, movedNames, removedNames})` on the compose page (live preview reflects what render will send).
  - **PhotoEditor pointer capture:** moved from `e.target` → root ref, so a child's `pointer-events:none` mid-drag doesn't drop subsequent pointermove events. Added drift threshold (>1.2% of image) — a tap-no-drag no longer commits a no-op `dstBox` and stays available for the click→lock toggle.
  - **CachedMesh anchoring:** floor-standing parts now anchor mesh bbox-min.y to local Y=0 (sits on floor); wall-mounted parts stay centered on local origin. Previously the off-by-half-height shift left meshes floating or buried.
  - **Tripo provider:** switched upload from `/v2/openapi/upload/sts` (returns STS creds, not a token) to `/v2/openapi/upload`. Polling tolerates both `model`, `model_url`, and `pbr_model` fields on the success response.
  - **Auto-persist meshHash:** Make-3D now writes the full `detectedObjects` array back to IDB on success instead of waiting for the Continue button. A refresh on detect page no longer orphans the GLB.
  - **Types:** `Detection` and `RoomData.detectedObjects[*]` now carry `dstBox`, `removed`, `meshHash`. `ScenePart.meshHash` added so 3D scene can swap in cached GLBs.
  - **Mask pipeline:** new `lib/mask.ts → buildEditMask()` produces a 3-region grayscale mask (white = preserve, mid-gray = placement hint, black = inpaint). Replaces single-channel `buildPreserveMask` in render flow. `downscaleBlob` default bumped 768 → 1280.
  - **New helpers:** `cropFromBbox()`, `perceptualHash()` (dHash for mesh-cache key).
  - **Render pipeline:** `lib/imagen.ts` now accepts `objectRefs[]`, attaches one inlineData per moved/locked object, emits enumerated `RELOCATE`/`REMOVE`/`KEEP UNCHANGED` clauses with explicit `(x=…%, y=…%, w=…%, h=…%)` boxes, plus a hardened **CAMERA LOCK** clause. `app/room/[roomId]/render/page.tsx` anchors the render on the slot with the most edits (not always S) and builds object crops from that slot.
  - **PhotoEditor:** new `components/studio/PhotoEditor.tsx`. Drag a bbox → produces `dstBox`. Buttons per item: lock (click body), remove (`∅`), make-3D (`3D`), delete (`x`). Replaces the in-file `DetectionCanvas` in `app/onboarding/detect/page.tsx`.
  - **Cloud image-to-3D (path A):**
    - `lib/mesh-cache.ts` — IDB store keyed by perceptual hash. Records contain GLB blob + provider + provenance.
    - `lib/image-to-3d.ts` — adapter for Meshy and Tripo. Async create-task → poll → download GLB → return Blob. Maps HTTP errors to a typed `Mesh3dError`.
    - `lib/store.ts useSettings` — added `mesh3dProvider`, `meshyKey`, `tripoKey` (persisted to `localStorage`).
    - `app/settings/page.tsx` — new "3D MESHES" section: provider selector + per-provider key fields.
    - `components/three/CachedMesh.tsx` + `components/three/DynamicPart.tsx` — when `part.meshHash` is present, scene loads the GLB via `three-stdlib` GLTFLoader and auto-scales to the part's longest dimension.
  - **Prompt composer:** `composePrompt` now also takes `movedNames`, `removedNames` and includes "relocate …" / "remove …" tokens. Compose page still only feeds locked/ghost — fold in moved/removed later if surfacing in the LIVE PROMPT PREVIEW.
  - **Detect page:** persists `dstBox`, `removed`, `meshHash` into `RoomData.detectedObjects`. Make-3D button calls `generateMesh()` → `meshCache.put()` → updates the detection's `meshHash`. Cache-hit on perceptual hash skips the network call entirely. Surface 3D errors as a dismissable banner.
  - **Not done yet (intentionally deferred):** (1) background-only inpaint two-pass (current single-pass mask is "good enough" baseline); (2) catalog / swap-object flow; (3) cheap client-side 2D-mockup preview before render; (4) collision warnings after edit; (5) feeding the 3D scene (with cached meshes) as a synthetic-view reference image into nano-banana for the final render (Phase 4 of the 3D plan — large win, separate workstream).

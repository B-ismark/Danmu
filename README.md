# Danmu

Interior decoration simulation. Snap your room, rebuild it in 3D, then redecorate freely —
move, recolour, restyle, and relight every piece. Optional photo-real preview. Local-first.

## Stack

- **Next.js 15** (App Router) + **React 19** + **TypeScript**
- **Tailwind v4** (CSS-first via `@theme inline`) — tokens live in [`app/globals.css`](app/globals.css)
- **Three.js** + **@react-three/fiber** + **@react-three/drei** — declarative 3D
- **Zustand** for client state, **TanStack Query** for async
- **idb-keyval** for room data, **localStorage** for settings + API key
- **@google/genai** (Imagen 4 + Gemini 2.5 Flash) — direct browser → Google
- **@react-pdf/renderer** for the carpenter's spec

## Run

```bash
pnpm install
pnpm dev
```

Open <http://localhost:3000>. Paste a Google AI Studio key on first run.

## Routes

| Path | Purpose |
|---|---|
| `/` | Entry router (key check → onboarding or workspace) |
| `/onboarding/welcome` | BYO key + intro |
| `/onboarding/layout-pick` | Pick footprint preset |
| `/onboarding/capture` | 6-photo guided capture (`getUserMedia`) |
| `/onboarding/review` | Capture review |
| `/onboarding/detect` | Gemini detection + lock stack |
| `/workspace` | Empty / resume |
| `/room/[id]/model` | **3D viewer (default)** |
| `/room/[id]/plan` | 2D plan view |
| `/room/[id]/photo` | Captured photo |
| `/room/[id]/compose` | Style / budget / fidelity |
| `/room/[id]/render` | Imagen call + progress |
| `/room/[id]/compare` | Before/after slider + variants |
| `/room/[id]/spec` | Carpenter PDF preview + download |
| `/room/[id]/share` | Share link + WhatsApp |
| `/settings` | Key, currency, units, telemetry, danger |

## Architecture rules

- **Single source of truth for parts:** [`lib/parts-catalog.ts`](lib/parts-catalog.ts).
  3D scene, 2D plan, inspector tree, hover cards, and spec PDF all read from this list.
- **No hard-coded design values.** All colors / spacing / type sizes go through `tokens.css`. Tailwind reads them via `@theme inline`.
- **BYO key.** No backend. Browser → Google directly via `@google/genai`. Add HTTP-referrer + API-restriction in Google Cloud Console.

## Known limitations (v0.1)

- Imagen public API has no ControlNet depth — preservation uses prompt locks + future client-side composite.
- WebXR calibration deferred. 6-photo capture only.
- Single-room workspace. Multi-room screen / rooms list = roadmap.
- API key is exposed in browser memory (BYO trade-off). Settings warns user to scope the key.

## Layout

```
app/
  (root) page.tsx — entry router
  onboarding/ welcome, layout-pick, capture, review, detect
  room/[roomId]/ model, plan, photo, compose, render, compare, spec, share
  settings, workspace
components/
  three/ Box, RoomShell, Closet, Furniture, CameraRig, Pickable, Room
  studio/ TopBar, StudioTabs, ModeToggle, ViewPresetChips, HoverCard, PartTree, Inspector, PlanView
  spec/ SpecDocument
  ui/ Icon, primitives (DanmuMark, CornerRegs, Dot, IOSFrame, Toggle, StepHeader)
lib/
  parts-catalog.ts — single source of truth
  imagen.ts — BYO key wrapper, error mapping, mask compositor
  detection.ts — Gemini multimodal furniture detection
  prompt.ts — style/budget composer + cost estimator
  storage.ts — IDB room data
  store.ts — Zustand stores (studio, compose, settings, room)
  capture.ts — getUserMedia + canvas snapshot
```

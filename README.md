# Danmu

Local-first **interior decoration simulation**. Pick or capture a room, rebuild it
in 3D, then redecorate freely — move, recolour, restyle, relight, and arrange every
piece. Optional, non-blocking AI photo preview on top.

📖 **Full platform documentation → [DOCUMENTATION.md](DOCUMENTATION.md)** (what it
does, every current feature, architecture, and roadmap).

## Stack

- **Next.js 14.2** (App Router) + **React 18.3** + **TypeScript 5.6**
- **Tailwind 3.4** — design tokens in [`app/globals.css`](app/globals.css)
- **Three.js** + **@react-three/fiber** + **drei** + **postprocessing** — declarative 3D
- **Zustand** (client state) + **TanStack Query** (async)
- **idb-keyval** for rooms, **localStorage** for settings + API key
- Optional AI (BYO key, browser → provider direct): **@google/genai** (Imagen 4 +
  Gemini 2.5 Flash) and **@huggingface/inference** (FLUX)

## Run

```bash
pnpm install
pnpm dev          # http://localhost:3000
pnpm typecheck    # tsc --noEmit
pnpm build        # next build
```

An AI key is optional — only the photo-preview step uses it. Paste one in Settings
(or onboarding) when you want it.

## Routes

| Path | Purpose |
|---|---|
| `/` | Entry router (key check → onboarding or workspace) |
| `/onboarding/welcome` | Intro + optional BYO key |
| `/onboarding/layout-pick` | Pick footprint preset (sets dims + starter scene) |
| `/onboarding/capture` | 6-photo guided capture (`getUserMedia`) |
| `/onboarding/detect` | Gemini furniture detection |
| `/workspace` | Rooms list — create / resume / delete |
| `/room/[id]/model` | **3D decoration studio (default)** |
| `/room/[id]/plan` | 2D floor plan |
| `/room/[id]/compose` | Style / finish / count picker for the preview |
| `/room/[id]/render` | AI preview render + progress |
| `/room/[id]/compare` | Before/after slider + variants |
| `/room/[id]/share` | Share link + WhatsApp |
| `/settings` | Key, currency, units, telemetry, danger zone |

## Architecture rules

- **Single source of truth for furniture:** [`lib/scene-spec.ts`](lib/scene-spec.ts).
  3D scene, 2D plan, inspector tree, catalog, and decor all read from it.
- **No hard-coded design values.** Colours / spacing / type go through tokens in
  `app/globals.css`; Tailwind reads them.
- **BYO key, no backend.** Browser → provider directly. Scope the key with an
  HTTP-referrer + API restriction. AI is an optional preview, not a dependency.

See [DOCUMENTATION.md](DOCUMENTATION.md) for the full feature list, data flow, and roadmap.

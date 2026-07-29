# Danmu

Local-first **interior decoration simulation**. Pick or capture a room, rebuild it
in 3D, then redecorate freely — move, recolour, restyle, relight, and arrange every
piece. Runs entirely in the browser: no backend, no account. Optional AI is used
**only to detect furniture from photos** — never to generate images.

📖 **Full design & architecture → [Design.md](Design.md)** (product principles,
every current feature, architecture, geometry engine, and roadmap).
🤖 **Agents:** see [CLAUDE.md](CLAUDE.md) for working rules.

## Stack

- **Next.js 15.5** (App Router) + **React 19.2** + **TypeScript 5.9**
- **Tailwind 3.4** — design tokens in [`app/globals.css`](app/globals.css)
- **Three.js** + **@react-three/fiber 9** + **drei 10** + **postprocessing 3** — declarative 3D
  (the React 19 line; see [Design.md](Design.md) — fiber 8 + drei 9 cannot run
  under Next 15's App Router)
- **Zustand** (client state)
- **idb-keyval** for rooms, **localStorage** for settings + API key
- **onnxruntime-web** — local, in-browser furniture detection (no key). Two
  YOLOv8 models run as an ensemble: a fixed 601-class Open Images detector plus
  an open-vocabulary one prompted with Danmu's own furniture words, because they
  miss different things. CDN-loaded at runtime, so onnxruntime-web is a
  devDependency (types only). The ~64 MB of weights are not in the repo: they
  are fetched on demand from
  [DearthAI/danmu-detector](https://huggingface.co/DearthAI/danmu-detector), or
  built locally with `python scripts/export-detector.py`. Those weights are
  AGPL-3.0 (Ultralytics) and hosted separately for that reason — Danmu itself
  stays MIT.
- Optional cloud detection (BYO key, browser → provider direct): **@google/genai**
  (Gemini). Detection-only — there is no image generation.

## Run

```bash
pnpm install
pnpm dev          # http://localhost:3000
pnpm typecheck    # tsc --noEmit
pnpm test         # vitest run
pnpm build        # next build
```

An AI key is optional — only cloud photo detection uses it, and the local ONNX
detector (or manual boxes) works without one. The 3D studio is fully reachable
without any key: pick a footprint and start decorating.

## Routes

| Path | Purpose |
|---|---|
| `/` | Entry router (rooms? → workspace, else onboarding) |
| `/onboarding/welcome` | Intro + "Start decorating"; optional BYO key |
| `/onboarding/layout-pick` | Pick footprint preset (sets dims + starter scene) |
| `/onboarding/capture` | 4-wall guided capture (`getUserMedia`) |
| `/onboarding/detect` | Furniture detection (local ONNX → Gemini → manual) |
| `/workspace` | Rooms list — create / resume / delete |
| `/room/[id]/model` | **3D decoration studio (default)** |
| `/room/[id]/plan` | 2D floor plan |
| `/settings` | Key, display unit, danger zone |

## Architecture rules

- **Single source of truth for furniture:** [`lib/scene-spec.ts`](lib/scene-spec.ts).
  3D scene, 2D plan, inspector tree, catalog, and decor all read from it.
- **No hard-coded design values.** Colours / spacing / type go through tokens in
  `app/globals.css`; Tailwind reads them.
- **Dimensions come from code, not AI.** All sizes pass through `clampDims`
  ([`lib/dimension-ranges.ts`](lib/dimension-ranges.ts)); a deterministic geometry
  engine owns sizing, placement, overlap and clearance. AI is a hint only.
- **BYO key, no backend.** Browser → provider directly (optional Gemini
  detection). Scope the key with an HTTP-referrer + API restriction. AI is
  detection-only, never a dependency.

See [Design.md](Design.md) for the full feature list, data flow, and roadmap.

# CLAUDE.md

Guidance for Claude Code / AI agents working in this repo. Read this first, then
[`Design.md`](Design.md) for the full product + architecture reference.

## What this is

**Danmu** — a local-first, browser-only **interior decoration simulation**. Pick
a footprint (or capture a room by photo), it rebuilds a scaled 3D room, and you
redecorate: place / move / recolour / restyle / relight / arrange furniture. No
backend, no account. The 3D studio *is* the product.

## Non-negotiable rules

1. **No AI image generation. Ever.** The old photoreal pipeline (realize / render
   / compose / compare / share, `hf.ts`, `imagen.ts`, `prompt.ts`, `useCompose`,
   image-to-3D) was **deleted permanently**. Do not reintroduce it or any AI
   render / model-name / cost / quota language in the user-facing UI. AI here is
   **detection-only and optional**.
2. **Dimensions come from code, not AI.** Every size passes through `clampDims`
   (`lib/dimension-ranges.ts`). The geometry engine (`lib/geometry.ts`,
   `lib/photo-geometry.ts`, `lib/physics.ts`, `lib/clearance.ts`,
   `lib/footprint.ts`) owns sizing, placement, overlap and clearance. AI gives a
   *hint* only. Preserve this trust boundary in any change.
3. **Single source of truth for furniture** is `lib/scene-spec.ts` (+
   `lib/parts-catalog.ts`). 3D scene, 2D plan, inspector, catalog and decor all
   read from it. Add a shape / behaviour flag there, not ad-hoc in a component.
4. **No hard-coded design values.** Colours / spacing / type / radii go through
   CSS tokens in `app/globals.css` (`--paper`, `--ink`, `--accent` terracotta,
   `--accent-2` sage, `--r-*`, `--font-sans` Nunito / `--font-display`
   Fraunces). Match the warm, rounded, playful direction.
5. **Local-first.** Rooms → IndexedDB (`lib/storage.ts`); settings + key →
   localStorage. The only network call is the optional direct Gemini detection
   (BYO key). Don't add a backend or send data anywhere else.
6. **Do not reintroduce the carpenter spec** (cutlist / build-cost / pricing).
   Removed in the pivot.

## Commands

```bash
pnpm install
pnpm dev          # http://localhost:3000
pnpm typecheck    # tsc --noEmit — run after edits
pnpm test         # vitest run — pure-logic suite
pnpm build        # next build
pnpm lint         # next lint
```

Run `pnpm typecheck` after non-trivial edits. Add a Vitest test when you touch
pure logic in `lib/` (geometry / physics / clearance / footprint / dimension-
ranges / shape-search / item-snap / units all have tests in `tests/`).

## Layout

- `app/` — Next App Router. Routes: `/`, `/onboarding/{welcome,layout-pick,capture,detect}`,
  `/workspace`, `/room/[roomId]/{model,plan}`, `/settings`. Only two studio tabs
  (`3D Model`, `2D Plan`).
- `components/three/` — R3F scene (`Room`, `DynamicPart`, `Draggable`, `Pickable`,
  `RoomShell`, `WallHandles`, `Dressing`, `Motion`).
- `components/studio/` — 2D UI (`Inspector`, `PartTree`, `CatalogPanel`,
  `ViewOptions`, `PlanView`, `SelectionBar`, `LibraryPicker`, `TopBar`, …).
- `components/ui/` — primitives + `Icon` (lucide wrapper).
- `lib/` — state (`store.ts` = `useStudio`/`useSettings`/`useRoom`,
  `scene-store.ts` = `useScene`), geometry engine, detection, persistence.
- `tests/` — Vitest over pure `lib/` logic. `scripts/export-detector.py` exports
  the optional ONNX model into `public/models/` (git-ignored, not bundled).

## Environment gotchas (Windows / PowerShell)

- The room route dir is literally `[roomId]` with brackets. PowerShell treats
  brackets as wildcards — use `-LiteralPath` with `Remove-Item` / `Test-Path` on
  those paths. A Bash tool (POSIX sh) is also available.
- `onnxruntime-web` must stay CDN-loaded with `webpackIgnore` — bundling it
  breaks the Next build.
- `normalScale` must be a `THREE.Vector2` (not an array) in this R3F version.

## Docs

- `Design.md` — canonical design + architecture (keep it current when you change
  architecture, routes, stores, or the AI/geometry boundary).
- `README.md` — quickstart + stack.
- `DOCUMENTATION.md` — legacy; redirects to `Design.md`.

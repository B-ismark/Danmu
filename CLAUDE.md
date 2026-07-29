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
   **Corollaries, each of which has been violated at least once:** a shape's
   geometry must be authored at `part.dimMM` (`Draggable` scales by
   `storedDim / part.dimMM`, so a renderer with a hard-coded size renders the
   wrong size at scale 1); a displayed measurement must be *derived*, never a
   hand-typed string next to the thing it describes; and when something does not
   fit, **say so — never silently resize it to fit**. A piece taller than the
   ceiling keeps its real height and `lib/clearance.ts` reports it.
3. **Single source of truth for furniture** is `lib/scene-spec.ts` (+
   `lib/parts-catalog.ts`). 3D scene, 2D plan, inspector, catalog and decor all
   read from it. Add a shape / behaviour flag there, not ad-hoc in a component.
4. **No hard-coded design values.** Colours / spacing / type / radii go through
   CSS tokens in `app/globals.css` (`--paper`, `--ink`, `--accent` terracotta,
   `--accent-2` sage, `--r-*`, `--font-sans` Nunito / `--font-display`
   Fraunces). Match the warm, rounded, playful direction. **Fill tokens and text
   tokens are not interchangeable:** `--accent` / `--danger` / `--warn` /
   `--success` are fills, and their `-ink` / `-text` variants are the ones that
   clear 4.5:1 as type (`--accent-text` also works on `--accent-tint`). Anything
   interactive gets `--edge` as its boundary, not a `--hairline*` (those are
   decorative dividers — `.ds-btn`, `.ds-chip`, `.popover` and `.toolbar` all
   carry `--edge`; `.ds-card` and the real dividers keep `--hairline`). Text on a
   filled surface uses `--on-accent` / `--on-ink`, never `#fff`. z-index comes
   from the `--z-*` scale only, including `--z-sticky-local` for a sticky header
   inside its own scroll box. Tailwind is present for Preflight only — no utility
   classes are used and its theme is intentionally empty, so `globals.css` is the
   sole token source. **Any layer that cannot read a custom property** — the 3D
   scene, the floor-plan canvas export — reads `lib/scene-palette.ts`
   (`SCENE`, `PLAN`, `defaultBodyColor(category, shape)`), which is hand-synced to
   these tokens and guarded by a test. Never put a literal hex in a renderer for
   a surface the user can recolour.
5. **Local-first.** Rooms → IndexedDB (`lib/storage.ts`); settings + key →
   localStorage. The only user-data egress is the optional direct Gemini
   detection (BYO key). Don't add a backend or send data anywhere else. Photos
   are normalised on ingest (`normalizePhoto`, ≤1600 px) before they are stored
   or sent — nothing full-resolution reaches IndexedDB or a request. Every
   third-party host is allow-listed with a reason in `next.config.mjs`'s CSP;
   adding a fetch target means adding it there too.
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
pnpm vendor:ort   # copy onnxruntime-web → public/ort/ (loads same-origin, not CDN)
pnpm hash:models  # print SHA-256 digests of public/models/ for MODEL_DIGESTS
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
- `onnxruntime-web` must stay **runtime-loaded** with `webpackIgnore` — bundling
  it breaks the Next build. It is served from `public/ort/` after
  `pnpm vendor:ort` (same-origin, so the CSP can be tight); the jsDelivr CDN is
  only the fallback when that has not been run.
- Persisted data is read defensively and `RoomData.version` exists for the first
  non-additive change. When you add a field to a saved record, add it to BOTH
  directions of its codec — `toRecord`/`fromRecord` on the detect screen exist
  because a hand-written read and a hand-written write drifted and silently
  dropped the geometry pass.
- `normalScale` must be a `THREE.Vector2` (not an array) in this R3F version.

## Docs

- `Design.md` — canonical design + architecture (keep it current when you change
  architecture, routes, stores, or the AI/geometry boundary).
- `README.md` — quickstart + stack.
- `DOCUMENTATION.md` — legacy; redirects to `Design.md`.

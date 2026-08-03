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
   The companion for *what a piece needs from the room* — how much clear floor, on
   which side, what it belongs next to — is `lib/layout-rules.ts`, read by both the
   room report (`clearance.ts`) and the arrangement solver (`layout-score.ts`).
   Those two carrying their own copies is exactly how "Suggest" came to park a bed
   across a doorway and have Room check report it: **add a clearance number there,
   never in a consumer.** Zones are authored in the piece's own frame and derived
   from its `dimMM`, which is what makes them recalibrate on a resize for free.
   Every finding names its rule as a **value** (`ClearanceIssue.rule: RuleKind`), not
   as a prefix of its `id` — the id is for React keys, and anything that branches on
   the kind of finding reads `rule`. What the solver can do about each kind lives in
   `RULE_HANDLING` (`lib/layout-score.ts`), which is production knowledge and not a
   test fixture: the room report reads it to decide which findings get a **Try a fix**
   button, so a wrong row is a wrong button. It answers two questions that differ —
   `costTerm` (which weight implements the rule) and `movable` (could rearranging
   clear it), and `reach` has no weight yet is movable, because `solveLayout` scores it
   over the finalists via `navigabilityCost`.
   `tests/layout-conformance.test.ts` holds the two consumers to each other: a
   layout the checker flags must cost the solver more **on the term implementing that
   same rule**, and every rule `clearance.ts` emits must have a `RULE_HANDLING` row.
   **A new finding fails that test until you decide what it is** — a cost term, or a
   written reason a cost cannot express it (`tall` is a size, `crowding` is the whole
   room, `turning` nothing costs at all). Adding
   a check with no cost is allowed; adding one silently is not.
   **Arrange against the room, never against its bounding box.** A footprint is a
   polygon; `±width/2` describes a box the room may not be. Every starter
   arrangement was written that way and so furnished the quadrant an L / T / U cuts
   away — five of the L-shape's nine pieces stood outside the house.
   `lib/room-bays.ts` gives you the rectangles of floor that exist and which of
   their sides are real walls; place in a wall's own frame, and end on
   `lib/layout-settle.ts` (both scene paths do). Gate a placement with
   `footInsidePoly`, **not** `outsideShare` — the latter samples, and its samples sit
   10% in from the edges, so it forgives a piece 20 mm through the plaster.
   **A scene file is an AI hint with a filename.** `lib/scene-file.ts` is the only
   thing here that parses bytes someone else produced, so the same boundary holds:
   imported sizes go through `clampDims`, and shape / category / decor / finish /
   layout are checked against the runtime vocabularies rather than trusted. Those
   vocabularies are `as const` arrays with the unions **derived** from them
   (`SHAPES`, `CATEGORIES`, `DECOR_KINDS`, `FINISHES`, `LAYOUT_IDS`) — never a union
   beside a hand-kept `Set`, which drifts in the one direction nobody notices: a
   validator quietly refusing a shape the app grew last week. Parsing is lossy on
   purpose and **never silent** — whatever is dropped comes back in `dropped` and is
   shown. And a room's own side is bounded by `ROOM_SIDE_M`, not by a fresh literal.
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
   scene, the floor-plan canvas export, **and the web manifest** — reads
   `lib/scene-palette.ts` (`SCENE`, `PLAN`, `defaultBodyColor(category, shape)`) or,
   for the manifest, exports its two colours from `app/manifest.ts`; all of it is
   hand-synced to these tokens and guarded by `tests/color-tokens.test.ts`, which
   **reads `globals.css`** rather than asserting a literal against a literal. Never
   put a literal hex in a renderer for a surface the user can recolour. The manifest
   and `viewport.themeColor` in `app/layout.tsx` are two files answering "what
   colour is this app", so a test pins them to each other too.
5. **Local-first.** Rooms → IndexedDB (`lib/storage.ts`); settings + key →
   localStorage. The only user-data egress is the optional direct Gemini
   detection (BYO key). Don't add a backend or send data anywhere else. A room
   leaves as a **file the user saves and hands over themselves**
   (`lib/scene-file.ts`) — that is the sharing story, and it needs no server.
   **It carries no photographs**, deliberately: a file exists to be sent to
   someone, and the captures are pictures of the inside of their home, so
   `Capture` blobs, `detectedObjects` and `fromDetection` all stay behind. Don't
   add them "for fidelity" — the geometry is already in the parts. Photos
   are normalised on ingest (`normalizePhoto`, ≤1600 px) before they are stored
   or sent — nothing full-resolution reaches IndexedDB or a request. Every
   third-party host is allow-listed with a reason in `next.config.mjs`'s CSP;
   adding a fetch target means adding it there too. The same file's
   `Permissions-Policy` allows only the features the app actually uses —
   `camera=(self)` for capture, `geolocation=(self)` for the sun mood's latitude,
   and `accelerometer`/`gyroscope`/`magnetometer=(self)` for its compass — and
   denies the rest; `()` there overrides the user's own grant, so a feature and
   its header entry move together. None of them send anything: a device
   permission is not egress, and a reading is coarsened before it is stored
   (`lib/geolocate.ts` ~11 km, `lib/compass.ts` 5° — precision the sun cannot use
   is precision not worth holding). Neither is ever requested on mount, only on a
   press.
   **Offline is part of local-first, and it is now real:** `public/sw.js` caches the
   app so it can be *opened* offline, not merely survive losing the network
   mid-session (it always did that — nothing in the studio fetches). Three things
   about it are deliberate and load-bearing:
   · **Cross-origin is never intercepted or cached.** The origin check is the first
     thing `fetch` does. A cache is storage, and storing a response to a call made
     with the user's own Gemini key — over their own room photos — is not the
     worker's business. `tests/service-worker.test.ts` asserts this per allow-listed
     host, and asserts *declining to handle*, not merely "doesn't cache".
   · **The first visit must be online.** There is no build-time precache manifest,
     because Next's chunk names are content-hashed and a hand-written file in
     `public/` cannot know them; generating one means writing into `public/` after
     the build, which the hosts this app targets snapshot earlier — it would work
     locally and ship empty. Assets are cached on first use instead. Stated in the
     file, and the limit to fix first if offline needs to work from a cold install.
   · **No `skipWaiting()`.** A new deployment's chunks do not match the old
     document, so taking over a live tab would serve a half-updated app to someone
     mid-arrangement. The new worker waits for the next load.
   `sw.js` is the one piece of first-party source under `public/` — it has to sit at
   the origin root to claim a `/` scope — so `eslint.config.mjs` un-ignores exactly
   that file and gives it worker globals. "Cannot be bundled" is no reason to be the
   only unlinted file we ship. It is also served `no-cache`
   (`next.config.mjs`): a worker that can pin its own replacement is one you cannot
   ship a fix to.
6. **Do not reintroduce the carpenter spec** (cutlist / build-cost / pricing).
   Removed in the pivot.

## Commands

```bash
pnpm install
pnpm dev          # http://localhost:3000
pnpm typecheck    # tsc --noEmit — run after edits
pnpm test         # vitest run — pure-logic suite (+ jsdom files, see below)
pnpm build        # next build
pnpm lint         # eslint . --max-warnings 0 — flat config in eslint.config.mjs
pnpm audit        # dependency advisories — see `pnpm.overrides` in package.json
pnpm vendor:ort   # copy onnxruntime-web → public/ort/ (loads same-origin, not CDN)
pnpm hash:models  # SHA-256 digests of public/models/ for MODEL_DIGESTS
pnpm hash:models --verify   # …and confirm the mirror serves those same bytes (~62 MB)
```

`pnpm` is invoked through Corepack here (`corepack pnpm …`) if it is not on
`PATH`; `packageManager` in `package.json` pins the version — and CI reads the
same field rather than naming a pnpm version of its own.

**CI runs the first four on every push to `main` and every pull request**
(`.github/workflows/ci.yml`, one job, no secrets — nothing here has a backend to
deploy to). Each gate is guarded by `!cancelled()` so one red gate does not hide
the other three, and `pnpm audit` runs `continue-on-error` on purpose: an
advisory published upstream overnight is not a defect in whichever pull request
happens to run next. The build step also **greps its own output**, because
`next build` can skip its ESLint pass and still exit 0 — see the lint notes
below, and `tests/toolchain.test.ts`, which pins the same two invariants where
they fail faster.

Run `pnpm typecheck` after non-trivial edits. Add a Vitest test when you touch
pure logic in `lib/` (geometry / physics / clearance / footprint / dimension-
ranges / shape-search / item-snap / units / dates / scene-file / transforms /
fit-check all have tests
in
`tests/`).

The suite runs in the **node** environment by default. Files that need a browser
opt in individually with `// @vitest-environment jsdom` — `storage*.test.ts`
(IndexedDB via `fake-indexeddb`) and `history.test.ts` (zustand `persist` wants
localStorage). Don't switch the whole suite over. Two properties there can only be
observed by instrumenting the store, so `storage-ordering.test.ts` mocks
`idb-keyval` to record the call sequence: IndexedDB returns keys in **sort** order,
not insertion order, so an assertion over `keys()` proves nothing about write
order.

Support code a test needs but the app does not goes in `tests/helpers/` — vitest's
`include` is `tests/**/*.test.ts`, so a helper there is never collected as a suite.
`tests/helpers/color.ts` (OKLab / WCAG contrast, read by `color-tokens.test.ts`) is
the one that exists. Keep that boundary honest in both directions: a module only
tests import does not belong in `lib/`, where it reads as shipped code.

## Layout

- `app/` — Next App Router. Routes: `/`, `/onboarding/{welcome,layout-pick,capture,detect}`,
  `/workspace`, `/room/[roomId]/{model,plan}`, `/settings`. Only two studio tabs
  (`3D Model`, `2D Plan`).
- `components/three/` — R3F scene (`Room`, `DynamicPart`, `Draggable`, `Pickable`,
  `RoomShell`, `WallHandles`, `Dressing`, `Motion`).
- `components/studio/` — 2D UI (`Inspector`, `PartTree`, `CatalogPanel`,
  `ViewOptions`, `PlanView`, `SelectionBar`, `LibraryPicker`, `TopBar`, …).
- `components/ui/` — primitives + `Icon` (lucide wrapper).
- Offline: `public/sw.js` (the worker — raw, unbundled, root-scoped),
  `app/manifest.ts` (served at `/manifest.webmanifest`; makes it installable) and
  `components/ServiceWorkerRegistrar.tsx` (registers it, **production only** — a
  worker registered by `next dev` caches recompiled chunks and then serves you
  yesterday's component, and it outlives the dev server on that port).
- `lib/` — state (`store.ts` = `useStudio`/`useSettings`/`useRoom`,
  `scene-store.ts` = `useScene`), geometry engine, detection, persistence.
  `geometry.ts` has **one rotation convention and it is three.js's** — a part's
  front (local +Z) is `(sin rot, cos rot)`, because `rot` is what `Draggable`
  assigns to `rotation.y`. Use `localToWorld` / `worldToLocal` / `frontVector`
  rather than writing the matrix out; getting the sign wrong is invisible at
  0°/180° and inverts every "which side does this face" answer on the side walls.
  **A part's transform lives in two layers and that is deliberate** — the authored
  one on `ScenePart`, the user's edit in `useStudio.positions/rotations/dims`, which
  wins. Do not collapse them: a drag writes only the override map, so a detected room
  the user has only *moved* things in has overrides and no scene snapshot, and that is
  exactly what lets a re-scan rebuild `parts` while the moves re-apply by id. But
  **never write `positions[p.id] ?? p.pos` yourself.** `lib/transforms.ts`
  (`resolvePart` / `resolveParts`, pure) and `lib/room-scene.ts` (`useRoomScene`,
  `useRoomPart`, `usePartTransform`, `currentRoomScene`) are the only places that
  fallback exists, and `tests/room-scene.test.ts` sweeps the tree and fails on a
  hand-written one. Reading a raw override *without* a fallback is still fine when the
  question is genuinely "has this been overridden" — `Draggable` divides a stored dim
  by the **authored** `dimMM` for a scale factor, which no resolved value can give.
- `tests/` — Vitest over pure `lib/` logic. `scripts/export-detector.py` exports
  the optional ONNX model into `public/models/` (git-ignored, not bundled).

## Environment gotchas (Windows / PowerShell)

- The room route dir is literally `[roomId]` with brackets. PowerShell treats
  brackets as wildcards — use `-LiteralPath` with `Remove-Item` / `Test-Path` on
  those paths. A Bash tool (POSIX sh) is also available.
- **Never round-trip a source file through Windows PowerShell 5.1's
  `Get-Content` → `Set-Content`.** `Get-Content` decodes UTF-8 as the system ANSI
  codepage, so every em dash, `·`, `×`, `≈` and curly quote in this codebase comes
  back as mojibake and a BOM is prepended — silently, with `pnpm typecheck` still
  passing. `-Encoding utf8` on the *write* does not save you; the damage is on the
  read. Edit files with the editing tools, or do bulk transforms in Node, which is
  UTF-8 by default. (Repairing it means re-encoding each character to its CP1252
  byte and decoding as UTF-8 — `latin1` will not do, since the mojibake contains
  characters from CP1252's 0x80–0x9F range.)
- **Linting is the ESLint CLI, not `next lint`** (removed in Next 16). Rules still
  come from `eslint-config-next`, bridged into `eslint.config.mjs` by `FlatCompat`
  from `@eslint/eslintrc` — which is a declared devDependency, not a borrowed
  transitive of ESLint's. The ignore list moved out of `.eslintignore` (deprecated in
  ESLint 9, and **silently ignored** under flat config, which is the dangerous part:
  it does not error, it just starts linting `public/` and `.next/`). `eslint .` covers
  `tests/` and `scripts/` as well, which `next lint`'s default dirs did not.
  **`--max-warnings 0`: a warning fails the command.** `next lint` let warnings pass,
  which is how a lint result stops being read — the repo is at zero and stays there.
  So a new `@next/next/*` or `jsx-a11y/*` warning is a red build, not a line of
  output nobody looks at. Fix it or disable the rule on the line with a reason; do not
  raise the ceiling. And **do not add a stale directive:** ESLint 9 reports an
  `eslint-disable` that suppressed nothing, so at `--max-warnings 0` a comment left
  behind after the code stopped violating the rule is itself a red build.
  Two properties of `eslint.config.mjs` are load-bearing for `next build`, which runs
  its **own** lint pass over the same config, and both fail in the direction that looks
  like success:
  - **ESLint must stay `>= 9`.** Next only strips the eslintrc-era options
    (`useEslintrc`, `extensions`, …) when the installed ESLint is 9+. On 8.57 it finds
    the flat config, loads `FlatESLint`, hands it eslintrc options, prints
    `⨯ ESLint: Invalid Options` — and **exits 0 having linted nothing.** Verified by
    planting a `react/jsx-key` error: the build passed on 8.57 and fails on 9.
  - **The config must not ignore itself.** Next detects its plugin by calling
    `calculateConfigForFile('eslint.config.mjs')` and looking for `@next/next` in the
    result, so a `*.config.mjs` ignore entry (what `.eslintignore` used to carry) makes
    the build warn the plugin is missing while every Next rule is in fact firing. The
    root config files are linted instead, which is why `postcss.config.mjs` and
    `eslint.config.mjs` name their default export.

  Both are pinned by `tests/toolchain.test.ts` — which asserts the *declared* range
  admits nothing below 9, not just the installed version, and makes Next's own
  `calculateConfigForFile('eslint.config.mjs')` call itself — and backstopped in CI by
  grepping the build's output. Neither guard is decoration: each of the five
  assertions was checked by mutation, including an actual downgrade to 8.57.
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
- `PRODUCT.md` — who this is for, what counts as success, the durable constraints.
- `docs/history/` — **point-in-time studies, not live docs.** The 2026-07 platform
  audit (`AUDIT.md` + `audit/`), the engine research (`Research.md`) and the
  remediation plan (`Plan.md`). Every phase in them is shipped or explicitly
  declined; read them for *why* a design is the way it is, never as a description
  of the current codebase. When they disagree with `Design.md`, `Design.md` wins.

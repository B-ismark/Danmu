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
   The last remnant of it was `lib/mesh-cache.ts` + `CachedMesh.tsx` — an IndexedDB
   store of GLB blobs whose providers were literally named `meshy` and `tripo`.
   Nothing had written to it since the pipeline went, so `ScenePart.meshHash` could
   never be set and the component could never render; it is deleted too. **Dead
   plumbing wearing a deleted feature's names reads as this rule being broken**, and
   the next person to find it cannot tell the difference from code. Every piece is
   procedural; there is no mesh download path to restore.
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
   **Which wall a photo is, is code's answer now too** (`lib/capture-slots.ts`),
   and it belongs to this rule because a wrong slot is a wrong room:
   `wallDistance` reads n/s at `depth/2` and e/w at `width/2`, so a photo of the
   long wall filed under a short one is measured from the wrong distance and every
   size taken off it is wrong. So it is a **ladder that names its rung** — EXIF
   compass bearing, EXIF shutter time, arrival order, the user — rather than a
   guess in an answer's clothes. **Rung one almost never fires, and that is
   measured, not feared:** run against four real photographs of a real bedroom off a
   Pixel 6 Pro, not one carried `GPSImgDirection` — nor any focal length, so the
   geometry's assumed-66° fallback is the normal path too. What carried all four was
   `DateTimeOriginal`, the rung the plan did not have. `tests/exif-in-the-wild.test.ts`
   holds that shape. Do not delete the bearing rung — a phone that writes it is the
   difference between naming the walls and guessing at them — and do not build
   anything on the assumption it is there.
   A bearing pointing at a wall that is already
   taken is *reported*, not honoured. The ids are a cyclic order, not compass
   directions, and that is what makes it safe: nothing outside that file cares
   where north is (the room's own bearing lives in `Site.bearingDeg`), so any
   error common to every bearing — declination, true-vs-magnetic — cancels out of
   the differences. **Do not re-propose vanishing points for the no-bearing case.**
   Every shot frames one wall straight-on from the middle of a box, so the
   wall-parallel VP sits at infinity and the view-axis VP at the principal point in
   *every* photo: an identical pair carrying no world-axis label. `wallSpan` is
   the honest version of that idea — the length a wall ought to be, on screen, for
   the user to check.
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

   **One drag, one resolve.** Where a dragged piece ends up is
   `lib/drag-resolve.ts` — **grid snap** → containment → wall snap → magnetic item
   snap → gravity/support → vertical clamp → OBB collision — and **both** the 3D
   `Draggable` and the 2D `PlanView` call it. It used to live inside the 3D
   component, so the plan carried a two-step imitation of it and the same drag
   behaved differently per tab: snap did nothing to a mouse drag, a merged group
   did not move as one, rigid-parented children stayed behind, and a vase dragged
   off its table hung in the air at table height — which you cannot see from
   directly above. Same shape of scar as `layout-rules.ts`. `snapSteps` there is
   also the only home for the 10 mm / 15° / 50 mm / 45° increments, and the grid
   step **is inside the resolve**, first, so callers hand it the pointer position
   unrounded. That step is the extraction's own scar: it had been sitting in the 3D
   pointer-move handler rather than in the pipeline, so it did not travel, and the
   move that was supposed to end "snap works in one tab only" shipped with snap
   working in one tab only. **Extracting a pipeline means extracting all of it** —
   go looking for the steps that live in the caller, because those are exactly the
   ones a diff of the extracted function cannot show you were missing. The companion
   for *what is under the pointer* is `lib/plan-hit.ts` (footprint geometry, so a
   round piece is tested against the ellipse it draws, not its box) and
   `lib/pick-through.ts` (a raycast's hits mapped back to pieces, everything that
   is not furniture dropped). Both surfaces cycle Alt-click through the same
   function; `planPaintOrder` is what stops "topmost" meaning "added last".
   **A canvas-level pointer handler must not test what the press landed on.**
   `PlanView`'s did — `if (e.target !== svgRef.current) return` — and the room floor
   is a *filled* `<path>`, so every press inside the walls returned there: marquee,
   one-finger touch pan, pinch, middle-drag and Space-drag pan all worked only in
   the grey margin outside the room, while the help card cheerfully advertised the
   marquee. It was redundant as well as wrong, because pieces and walls claim their
   own presses with `stopPropagation` and the canvas handler never sees them.
   Whatever does reach it is floor or decoration, and for both of those acting is
   the forgiving direction — the strict one fails as a dead canvas with nothing in
   the console and no failing test.
   **A gesture is measured in the space it happens in.** Alt-click's "is this the
   same press again" compared world metres against a 60 mm tolerance, which makes
   the tolerance a function of the camera: pulled back, 60 mm of floor is one pixel
   and the cycle restarted on a twitch. It is client pixels now (`SAME_SPOT_PX`),
   while *which pieces are candidates* stays a world-space question — two spaces,
   named separately in the signature so they cannot be swapped by accident.
   **And restore what a gesture moved, not what it was aimed at:** `Esc` mid-drag
   put back the dragged piece and left the lamp riding on it in mid-air, plus every
   merged sibling scattered. `cascadeTransform` is pure, so replaying it from the
   start transform is the whole fix — and a merged group's per-frame delta must come
   off that same start transform, never off a render memo, or a drag faster than
   React renders quietly pulls the group apart.
   **The two lists beside the canvas are named for what they hold:** the rail's
   **Catalog** is what is in this room, the panel's **Library** is what you can
   add. They are not interchangeable words, and one screen may not hold two of
   either.

   **A per-object workaround for a missing piece of the ROOM is the wrong layer,
   and it announces itself by needing a new exception every time.** The sun used to
   pour through the ceiling and through the plaster, because walls only received
   shadow and there was no ceiling at all; the fix was a per-piece gate asking
   whether the sun was on the room side of the wall a piece rode. It worked, and it
   had already grown an exemption for doors and windows and another for the studio
   moods, and it could not touch the second half of the same bug — the sun's patch
   landing on the whole floor. The room is a closed shell now
   (`components/three/RoomShell.tsx`): walls cast, there is a shadow-only ceiling,
   and light gets in through `lib/apertures.ts`'s holes, so the gate is deleted and
   a TV casts nothing because *its wall is in shadow*, which is not a rule about
   TVs. The tell to look for is a predicate that keeps needing another shape added
   to it. Two facts worth keeping: **casting is camera-independent**, so the
   dollhouse trick is untouched by a wall that casts (culling is the colour pass;
   the shadow pass renders from the light) — the claim that it would black out the
   room was wrong and went unchecked for months; and a shadow-only mesh must stay
   `visible`, because three skips an invisible object in the shadow pass too, so it
   is the material that opts out of drawing.

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
   **A control that does not fit must reflow, not spill or vanish** — the UI half
   of rule 2's "never silently resize it to fit", and violated at least as often.
   Widths here are ceilings, not promises: `min(Npx, calc(100vw - 32px))` for a
   floating card, `clamp()` for the rails, `minWidth: 0` on the one flex item that
   should ellipsise, `wrap` on a `Segmented` whose labels want more than the panel
   has. **Both failure modes are silent, and they are different ones.** A
   container that clips (`.toolbar`, `.rail`, a scroll box — all `overflow:
   hidden`) eats what crosses its edge with no scrollbar and no clue: that is what
   cut ~56px off the left of the "Look" panel, a 300px card opened inside a 260px
   rail. An element with no `overflow` of its own does the opposite and prints
   over its neighbours: `flex: 1 1 0` plus `minWidth: 0` sizes the *box*, so four
   lighting moods in 272px gave "Evening" 68px for 82px of word and it ran into
   "Day" and "Cool". Neither errors, neither fails a test, and the second one
   looks like a font bug. Two corollaries with scars: **a rail section's body is
   inline, never a popover** (`RailSection` is already the disclosure — if
   something genuinely must float out of a rail it goes `position: fixed` and
   *measured*, like `RoomTools` and `ui/Select.tsx`); and **one bar,
   `.chrome-bar`, which wraps at every width** rather than below a breakpoint,
   because nobody can name in a media query how wide a row holding a user-typed
   room name gets.
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
   or sent — nothing full-resolution reaches IndexedDB or a request. What `exif.ts`
   reads out of a photo before that strip is on a **budget, not a shopping list**:
   GPS coordinates are refused outright, and the shutter time — added so a dropped
   set can be put back into the order it was shot in — is read, used, and dropped.
   `readCaptureFacts` returns the persisted `pose` and the transient facts
   separately for exactly that reason; a field that is not needed after the
   decision does not go into storage, where it reads as something the app keeps.
   Every
   third-party host is allow-listed with a reason in `next.config.mjs`'s CSP;
   adding a fetch target means adding it there too. The same file's
   `Permissions-Policy` allows only the features the app actually uses — which is
   now exactly one, `camera=(self)` for capture — and denies the rest; `()` there
   overrides the user's own grant, so a feature and its header entry move
   together. **In both directions, and the removing one is the direction that gets
   forgotten:** four entries sat at `(self)` for the sun mood — `geolocation` for
   its latitude, and `accelerometer`/`gyroscope`/`magnetometer` for the phone
   compass that read the room's bearing. Collapsing that mood to fixed presets
   (see §Lighting in `Design.md`) deleted every caller, and leaving the four at
   `(self)` would have broken nothing, failed no test and shown no warning — it
   would simply have left the app permanently asking for two sensors and a
   location it can no longer use. A permission with no consumer reads as
   something the app keeps about you, which is the same rule the EXIF budget
   above answers to. `lib/geolocate.ts` is gone entirely; `lib/compass.ts` is
   `lib/bearings.ts` now, because the compass read went and what is left is the
   circular-mean maths `lib/capture-slots.ts` needs for photo bearings — **a
   module still named for the half that was deleted is the scar rule 1
   describes.** The surviving coarsening principle is unchanged and still worth
   quoting at anything new: precision the sun cannot use is precision not worth
   holding — and its corollary, which is what actually retired the sun apparatus,
   *accuracy the user cannot verify is accuracy not worth holding*. A permission
   is never requested on mount, only on a press.
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
   Removed in the pivot. **This covers a furniture CSV**, which is the corollary
   that has already been violated twice: a parts list minus the prices is what the
   carpenter spec *was*, so a spreadsheet writer — however careful its formula-
   injection escaping — is careful work aimed at the wrong target. Neither success
   case in `PRODUCT.md` is served by one: nobody relaxes over a CSV, and nobody
   aligns a partner with one. The Room panel's on-screen list and its plain-text
   **Copy** are the sanctioned form of "here is what is in the room", because
   pasting it into a message is what showing someone a plan actually looks like.

## Commands

```bash
pnpm install
pnpm dev          # http://localhost:3000
pnpm typecheck    # tsc --noEmit — run after edits
pnpm test         # vitest run --disableConsoleIntercept — pure-logic suite
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
fit-check / capture-slots / detect-prompt / exif all have tests
in
`tests/`).

**A dead-code sweep that does not read `tests/` is not a sweep.** Two kinds of
false positive here, and each nearly cost something real. A class or token reached
through a template string (`` `rail-sash rail-sash--${side}` ``, or a name a test
builds per side in a loop) matches no literal grep. And a token can have **no
`var()` reader at all and still be load-bearing**: `--rail-left-tight` /
`--rail-right-tight` are applied to nothing on purpose — they are the width a
future tightening is allowed to reach, and their consumer is
`tests/reflow.test.ts`, which holds each below its shipping floor. Deleting them
was caught by that test, which is the good outcome; the bad one is deleting the
test as well to make the sweep look right.

The `--disableConsoleIntercept` on `pnpm test` is load-bearing, not tidy-up.
vitest 4's default reporter **discards `console.log` from a passing run** — at module
scope, in a `describe` body and inside an `it` alike — and
`tests/detect-pipeline.test.ts` exists to *report* a measurement: ten pieces of
furniture, their position and width error against analytic ground truth, printed on
every green run so a drifting baseline is visible without reading a diff. Without the
flag that table printed to nobody while the gate stayed green, which is the failure
shape this repo keeps finding: not a broken check, an invisible one.
`tests/toolchain.test.ts` pins the flag and pins the harness's own call to
`console.log`, because losing either is silent.

The suite runs in the **node** environment by default (+ jsdom files, see below). Files that need a browser
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
  `ViewOptions`, `PlanView`, `SelectionHeader`, `LibraryPicker`, `TopBar`, …).
  Layout lives in three shells — `StudioShell` (both room tabs),
  `ui/DocShell` (workspace / settings / layout-pick) and `CanvasChrome`
  (the studio's three canvas slots). A new control joins an existing slot or
  a rail section; it does not start a fourth canvas corner.
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

# UI & code quality findings — Danmu

> **Status: all fixed** (2026-07-29), and two further bugs were found while
> fixing — see *Found while fixing* at the bottom. The diagnosis below is kept as
> the record.
>
> | Finding | Resolution |
> |---|---|
> | `categoryColor` key-space mismatch | Replaced by `defaultBodyColor(category, shape)` — shape-keyed with a category fallback, exhaustive `Record`s over both unions, so a missing colour is a build error. Every renderer and the Inspector swatch read it. 12 tests. |
> | Plan export had its own palette | Reads `PLAN` from `lib/scene-palette.ts`; a test asserts the retired CAD blue can never come back. |
> | Interactive boundaries at 1.14:1 | `.ds-btn`, `.ds-chip`, `.popover`, `.toolbar` use `--edge`; `.ds-card` and the dividers keep `--hairline`, with the reasoning recorded in the CSS. |
> | T-Shape preview drew a cross | Both the preview path and the area label are derived from `footprintForLayout`. |
> | `faceClearance` centre-ray only | 5 probes across the face, each an exact ray/OBB intersection. Test: a chair against the left third of a wardrobe front is now caught. |
> | Overlapping furniture produced no issue | New `error`-severity "Two pieces in the same place" rule, with tests that a flush composition and a desk/laptop stack stay quiet. |
> | Floor coverage double-counted | Union over a 5 cm raster (`freeFloorFraction`), rotation- and boundary-correct. |
> | Detection rows keyed by index | Keyed by `uid`, minted on entry to state. |
> | Shape catalog drift | One exported `CATALOG_SHAPES_ORDERED`; the detection prompt interpolates it. `'window'` is in it (so a detected window renders as a window); `'closet'` is documented as a legacy alias rather than deleted, because persisted rooms may hold it. |
> | No shared date formatter | `lib/dates.ts`, used by the workspace and the layouts panel. 6 tests. |
> | CSV had no BOM / used LF | `lib/csv.ts`. |
> | Plan legend text overran | Measured; the sheet widens to fit and anything still over is ellipsised. |
> | Raw z-index / shadowed variable | `--z-sticky-local` token; `bounds` instead of shadowing `room`. |
> | Test coverage gaps | 139 tests across 15 files, up from 87 across 10. New: `csv`, `dates`, `detection-dedupe`, `scene-build`, `local-detect-nms`, plus 6 regression tests added to `clearance`. |
>
> **Still uncovered, and why:** `lib/history.ts` (undo/redo) and `lib/storage.ts`
> (trash round-trip) need a jsdom + `fake-indexeddb` harness. Both are new
> devDependencies, and `pnpm` is not on `PATH` in this environment — installing
> them with `npm` into a pnpm workspace would rewrite the module layout. Left for
> whoever can run the install; the fixes to both files are otherwise complete.

**Toolchain baseline:** `tsc --noEmit` clean · `vitest run` 87/87 passing across
10 files · `next lint` clean · `next build` clean. Zero `any` in the codebase,
zero `console.*` outside the two error boundaries, zero
`dangerouslySetInnerHTML`.

---

## [MEDIUM] `categoryColor()` is keyed on material groups, but every caller passes a `Category`

**Files:** `lib/scene-palette.ts:40-57`; callers at
`components/studio/Inspector.tsx:152`, `components/three/DynamicPart.tsx:142`,
`:1165`, `:1172`, `:1184`

**Issue:** The lookup table is keyed by *material group*:

```ts
const CATEGORY_COLORS: Record<string, string> = {
  seating, table, storage, bed, soft, lighting, appliance, screen, decor, plant, rug, wall
};
export function categoryColor(category: string): string {
  return CATEGORY_COLORS[category] ?? '#C9A98E';
}
```

Every caller passes `part.category`, whose type is the `Category` union:
`sofa | tv | chair | table | lamp | plant | shelf | rug | bed | desk | monitor |
fan | fridge | wardrobe | curtain | mirror | painting | nightstand | ottoman |
ac | door | other`.

The two key spaces intersect on **four** members — `table`, `bed`, `plant`,
`rug`. The other eighteen categories fall through to the `'#C9A98E'` default.
`seating`, `soft`, `screen`, `appliance`, `decor`, `lighting` and `storage` are
never passed by anything.

The parameter is typed `string`, so TypeScript cannot flag it. And
`tests/scene-palette.test.ts:29` asserts `categoryColor('seating')` — a group
name, not a `Category` — so the test codifies the wrong key space and can never
catch the mismatch.

**Failure the user sees:** the Inspector's colour swatch, labelled *"Default for
this piece"*, shows the same generic tan for a sofa, a wardrobe, a TV, a fridge
and a monitor — and it does not match what is on screen, because `DynamicPart`
passes its own per-shape literal for those shapes (`body(part, '#5D3820', …)` for
a desk top, `'#3A3A3A'` for an office chair cushion, `'#0d0d0f'` for a TV panel).
So the panel that exists to tell you what colour a piece is displays a colour the
piece is not.

**Suggested fix:** Add an explicit `Category → group` map and type the parameter
as `Category` so the compiler enforces exhaustiveness. Then have `DynamicPart`'s
per-shape defaults come from the same table rather than from literals, which is
what `scene-palette.ts`'s own header says it exists to prevent. Update the test to
assert over the real `Category` union.

---

## [MEDIUM] The exported floor plan is drawn from its own hard-coded palette, including the retired CAD blue

**File:** `lib/plan-export.ts` — lines 40, 47, 51, 65, 67, 80, 81, 87, 106, 123,
130, 136, 142, 143, 167, 185

**Issue:** `CLAUDE.md` rule 4 names `lib/scene-palette.ts` as the single source
for layers that cannot read a CSS custom property, and `scene-palette.ts:26-28`
records that `#3A78C2 / #6E94C8 / #7AA4D2` — "an institutional blue that belonged
to no part of the brand" — were deliberately removed. `plan-export.ts` imports
nothing from it and draws with sixteen inline hex values, one of which is
`#3E8FD8`: the same cold blue, used for wall-mounted item ticks and for the
legend numbers.

The exported PNG is the one printable artifact the product makes — a handout
someone carries to a furniture shop — and it is off-brand while every on-screen
surface is not.

**Evidence:**
```ts
ctx.strokeStyle = '#3E8FD8';   // wall-mounted ticks
ctx.fillStyle = '#3E8FD8';     // legend numbers
ctx.fillStyle = p.color ? `${p.color}55` : 'rgba(62,143,216,0.25)';
```

**Suggested fix:** Extend `SCENE` in `lib/scene-palette.ts` with the handful of
paper/ink/accent values the export needs and consume them here — the same
hand-synced-with-a-test arrangement the 3D layer already uses.

---

## [MEDIUM] Interactive boundaries use `--hairline` (≈1.14:1), which the project's own rule forbids

**File:** `app/globals.css:171` (`.ds-btn`), `:231` (`.ds-chip`), `:263`
(`.ds-card`), `:367` (`.popover`), `:372` (`.toolbar`)

**Issue:** `CLAUDE.md` rule 4 is explicit: *"Anything interactive gets `--edge` as
its boundary, not a `--hairline*` (those are decorative dividers)."* The file
itself labels `--hairline` "decorative divider" and `--edge` "boundary of anything
interactive (WCAG 1.4.11)" with its 3.10:1 measurement. Yet `.ds-btn` — the base
class on essentially every button in the app — borders with `--hairline`
(`rgba(42,37,32,0.12)`, ≈1.14:1 on `--paper`). WCAG 1.4.11 wants ≥3:1 for the
visual boundary of a control.

The tell that this is a mistake rather than a decision: several call sites
override it inline, one at a time — `app/room/[roomId]/plan/page.tsx:144`
(`borderColor: 'var(--edge)'`), the HelpDock chip, the Comfort-zones chip, the
Settings key wrapper (which comments *"--edge, not a 1.48:1 hairline: this is the
boundary of the most consequential input on the screen"*). The default is being
patched per-instance.

`.ds-btn` does carry `--shadow-soft`, which gives some edge definition, but a
shadow at 0.04/0.06 alpha is not a 3:1 boundary and disappears against
`--paper-2` / `--paper-3` surfaces.

**Suggested fix:** Switch `.ds-btn`, `.ds-chip` (when interactive), `.popover` and
`.toolbar` to `--edge` and delete the per-site overrides. Keep `--hairline` for
`.ds-card` and for the actual dividers (`.section`, `.list-row` separators,
`chrome-bar`). Re-check the primary/accent variants, which set their own border to
match their fill and are already fine.

---

## [MEDIUM] The T-Shape footprint preview draws a cross, not the T that gets built

**File:** `app/onboarding/layout-pick/page.tsx:14` vs `lib/footprint.ts:26-39`

**Issue:** The picker's SVG path for T-Shape is
`M60 20 L180 20 L180 80 L220 80 L220 140 L180 140 L180 170 L60 170 L60 140 L20 140 L20 80 L60 80 Z`
— a **plus/cross**: a narrowed top bar with arms projecting left and right at
mid-height. `footprintForLayout('t', …)` builds a genuine T: a full-width north
bar with a single stem running south.

So the shape the user recognises and picks is not the shape the room is built
from. The other four presets match acceptably (L removes the same south-east
quadrant, ~45%/50% preview vs 42%/42% actual; U's notch is 40%/53% vs 44%/50%).

**Suggested fix:** Derive the preview path from `footprintForLayout()` instead of
hand-drawing it — the polygon is already in scene metres and the preview viewBox
is a fixed 240×180, so it is one mapping function. The large `Footprint preview`
panel to the right of the picker uses the *same* hand-drawn `layout.path`, so
fixing it once fixes both.

---

## [MEDIUM] `faceClearance` probes a single centre ray, so obstacles at the edge of a face are invisible

**File:** `lib/geometry.ts:198-233`

**Issue:** The function starts at the **centre** of the chosen face and marches
one point outward. The comment says otherwise:

```ts
// March a thin probe box outward and find the first obstacle hit (sampled —
// resolution 2cm is far below any clearance threshold we report on).
for (const o of obstacles) {
  for (let t = 0.02; t < best; t += 0.02) {
    if (pointInObb(sx + dx * t, sz + dz * t, o)) { best = t; break; }
```

`sx`/`sz` is a single point; the box is not swept across the face width. So a
2 m-wide wardrobe with a chair tucked against the left third of its front reports
full clearance, and a bed with a bookshelf against the head end of one side
reports that side clear.

This is the trust feature — the module header calls it *"reproducible math over
the scene, which is what makes it trustworthy enough to plan a real room
around"* — so a silent false negative is worse here than in most places. The
existing tests only place obstacles centred on the face
(`tests/clearance.test.ts:58-64`, `:66-72`), so the gap is untested rather than
known-accepted.

**Suggested fix:** Probe at three or five offsets across the face (±half-extent,
±half, centre) and take the minimum; or replace the march with an analytic
slab intersection of the swept rectangle against each OBB, which is exact and
also removes the 200-iteration loop noted in `findings-performance.md`.

---

## [MEDIUM] Overlapping furniture produces no clearance issue at all

**File:** `lib/clearance.ts:95`, with `lib/geometry.ts:75-90` (`obbGap`)

**Issue:** `obbGap` returns `0` for interpenetrating boxes, and the walkway check
skips anything at or below 12 cm as *"Touching (deliberate composition)"*. Those
are the same number, so flush contact and two pieces occupying the same cubic
metre are indistinguishable to the report.

`buildSceneFromRoom` performs no overlap resolution — it snaps by wall affinity,
grounds by anchor, pulls mid-room items toward the centre and clamps into the
footprint, but never checks part-vs-part (`collidesAt` exists and is only used by
the drag path). So a detected scene can ship with a sofa inside a bed and the
Room-check panel says *"Everything fits — doors open, walkways are comfortable,
and seating distances look right."*

**Evidence:**
```ts
if (gap > 0.12 && gap < MIN_WALKWAY) { /* warn */ }
```

**Suggested fix:** Add an explicit overlap pass — `obbOverlap(a, b)` is already
exported and already used by `collidesAt` — emitting a `severity: 'error'` issue
distinct from the walkway warning. Then the `gap > 0.12` guard genuinely means
"deliberately touching".

---

## [MEDIUM] "Furniture covers X% of the floor" double-counts overlaps and ignores rotation

**File:** `lib/clearance.ts:186-197`

**Issue:** `used` is the sum of axis-aligned `W × D` per solid part, compared
against the true polygon area:

```ts
const used = solid.reduce((acc, p) => acc + (p.dimMM[0]/1000) * (p.dimMM[1]/1000), 0);
const freeFloorShare = roomArea > 0 ? Math.max(0, 1 - used / roomArea) : 1;
```

Three problems: a chair pushed under a desk counts its full area twice (both are
floor-standing with `pos[1] < 0.05`); a rotated part contributes its unrotated
footprint; and a part hanging partly outside the footprint after a wall drag
counts fully. `Math.max(0, …)` then clamps the result, so a busy room reports
"100% covered" and the warning copy asserts a specific percentage.

**Suggested fix:** Rasterise the footprint on a coarse grid (5 cm cells is ample
for a percentage) and mark cells covered by any part's OBB — union, not sum, and
rotation- and boundary-correct for free. Or accumulate the union area of the OBBs
analytically if the grid feels crude.

---

## [MEDIUM] Detection rows are keyed by array index while the array is spliced

**File:** `app/onboarding/detect/page.tsx:831-844` (`key={i}`), with
`deleteDetection` at `:395-406`

**Issue:** `detections.map((d, i) => <DetectionRow key={i} … />)` over an array
that `deleteDetection` splices, with the `confirmed` index set remapped
afterwards. React matches on the index, so removing row 2 makes the old row 3
reuse row 2's DOM node and component state.

Concretely: `DetectionRow` holds `EditableText`, which has its own `editing` and
`draft` state. Delete a row while another is mid-rename and the draft text jumps
to a different piece of furniture. The `linked` highlight (which drives the box
outline on the photo) and focus position land on the wrong item for the same
reason.

**Suggested fix:** Give each detection a stable id at creation. That is the same
underlying fix as the id finding in `findings-data.md` — one stable identifier
would resolve both.

---

## [LOW] The shape catalog has drifted across four hand-maintained lists

**Files:** `lib/scene-spec.ts:20-37` (`Shape`), `:178-180`
(`PARAMETRIC_SHAPES`), `:308-318` (`CATALOG_SHAPES`), `:229-276`
(`PART_LIBRARY`), `lib/detection.ts:102-112` (prompt catalog),
`lib/local-detect.ts:188-193` (`NAME_TO_SHAPE`),
`lib/dimension-ranges.ts:23-72` (`BY_SHAPE`)

Three concrete divergences:

1. **`'window'` is dropped in translation.** It exists in `Shape`, in
   `PART_LIBRARY` (line 260), in `BY_SHAPE` (line 52), in `ANCHOR_BY_SHAPE`, and
   `local-detect.ts:189` maps a locally-detected window onto it — but
   `CATALOG_SHAPES` omits it, so the gate at `scene-spec.ts:444`
   (`aiShape && CATALOG_SHAPES.has(aiShape)`) rejects the hint. A window found by
   the on-device detector falls back to `category: 'other'` → shape `'box'` and
   renders as a plain cube, even though the window geometry exists.
2. **`'closet'` is unreachable.** Present in `Shape`, `PARAMETRIC_SHAPES` and
   `BY_SHAPE`; absent from `PART_LIBRARY`, `CATALOG_SHAPES`,
   `CATEGORY_DEFAULTS`, `refineShape` and the prompt. Dead.
3. **`'shoe-rack'` is in `CATALOG_SHAPES` but not in the detection prompt's
   catalog**, so the Gemini path can never produce a shape the gate would accept.

**Suggested fix:** Derive `CATALOG_SHAPES` and the prompt's catalog list from one
exported array (the prompt already interpolates strings, so a `.join(', ')` is
enough), and let TypeScript's exhaustiveness checking cover the rest.

---

## [LOW] No shared date formatter

**Files:** `app/workspace/page.tsx:28-50`, `components/studio/RoomTools.tsx:542`

**Issue:** Dimensions are consistently routed through `lib/units.ts`
(`formatDim`, `precisionFor`, `stepFor`) — dates are not. The workspace
hand-rolls `startOfToday`, `bucketOf` and `editedLabel` with
`toLocaleTimeString` / `toLocaleDateString` and a year-conditional option object;
the saved-layouts panel uses a bare `new Date(v.createdAt).toLocaleString()`. Two
timestamp presentations, no shared owner.

**Suggested fix:** A `lib/dates.ts` alongside `lib/units.ts` with the relative
label and the absolute label, consumed by both.

---

## [LOW] CSV export has no BOM and no charset

**File:** `components/studio/RoomTools.tsx:356`

`new Blob([lines.join('\n')], { type: 'text/csv' })` — Excel on Windows reads a
BOM-less file as the system ANSI codepage, so a room named *"Chambre à coucher"*
or any non-ASCII furniture name mojibakes. `'\n'` line endings are also
non-canonical for CSV.

**Suggested fix:** Prepend `﻿`, use `\r\n`, and set
`type: 'text/csv;charset=utf-8'`.

---

## [LOW] Exported plan legend text is unbounded

**File:** `lib/plan-export.ts:139-151`

Canvas width `W` is derived from the plan footprint plus margins. Legend rows draw
`${p.name} — 2200 × 950 × 880 mm (W×D×H)` at `MARGIN + 24` with no measurement or
truncation, so a long furniture name (up to 80 chars via `EditableText`) runs off
the right edge of a narrow plan. `legendH` also assumes exactly one line per part.

**Suggested fix:** `ctx.measureText` and either widen `W` to fit the longest
legend row or ellipsise at the available width.

---

## [LOW] Two small deviations from stated conventions

1. **Raw z-index values** — `components/studio/CatalogPanel.tsx:104`,
   `components/studio/LibraryPicker.tsx:52`,
   `components/studio/RoomTools.tsx:224` use `zIndex: 1`. All three are local
   stacking inside a positioned parent, so nothing is broken, but `CLAUDE.md`
   rule 4 says z-index comes from the `--z-*` scale only, and a raw `1` is how the
   next ad-hoc value gets added.
2. **Shadowed parameter** — `lib/scene-spec.ts:488` declares
   `const room = { width: rw, depth: rd }` inside the loop of a function whose
   parameter is also `room: RoomData`. Correct today (`rw`/`rd` were already
   destructured), but it makes the outer record unreachable for the rest of the
   block.

---

## [LOW] Test coverage stops at the pure-geometry layer

**Files:** `tests/` (10 files, 87 tests)

Covered: `geometry`, `physics-snap`, `clearance`, `footprint`,
`dimension-ranges`, `item-snap`, `shape-search`, `units`, `photo-geometry`,
`scene-palette`. That is the right instinct and it is well done.

Uncovered, and it is where four of this audit's higher-severity findings live:

| Module | Untested logic | Related finding |
|---|---|---|
| `lib/detection.ts` | `dedupe()` | data #3 |
| `lib/scene-spec.ts` | `buildSceneFromRoom()` — the whole detect→scene translation | data #2, ui #6 |
| `lib/storage.ts` | trash / restore / purge round-trip | data #8, #9 |
| `lib/history.ts` | undo / redo / `applySnapshot` | data #5, #6 |
| `lib/local-detect.ts` | `nms()`, `containedIn()`, `tilesFor()` | — |
| detect page | `finish()` ↔ cache-read round-trip | data #1 |

All six are pure functions or trivially mockable. `scene-palette.test.ts` also
needs the correction described in the first finding — as written it asserts the
wrong key space.

---

## Found while fixing

Two defects the scan did not catch, surfaced by doing the work.

### [HIGH] The TV rendered at a fixed 1.45 × 0.82 m regardless of its dimensions

**File:** `components/three/DynamicPart.tsx` — `TVGeo`

`TVGeo` took no `part` at all and hard-coded `w = 1.45`, `h = 0.82`. `Draggable`
scales a part's group by `storedDim / part.dimMM`, so geometry must be authored at
`part.dimMM` — meaning a TV whose base dims are anything other than 1450 × 820
rendered at the wrong size at scale 1, while the Inspector, the plan view, the
furniture list and the CSV all reported the real number. Detection clamps TVs into
700–2000 mm wide, so any detected TV that was not exactly the catalog default was
wrong on screen.

This is the same class of defect as the footprint area labels, in the one place it
matters most: a dimension the user can read next to a shape that ignores it.

**Fixed:** derives `w`/`h`/`d` from `part.dimMM` like every other shape. A
corollary was added to rule 2 in `CLAUDE.md`.

### [MEDIUM] Five shapes ignored the user's colour entirely

**Files:** `TVGeo`, `MonitorGeo`, `FanGeo`, `MirrorGeo`, `LaptopGeo` in
`components/three/DynamicPart.tsx`

Each drew its body from a literal instead of consulting `part.color`, so the
Inspector's colour picker — and the whole-room theme presets — silently did
nothing to a TV, a monitor, a ceiling fan, a mirror frame or a laptop. `LaptopGeo`
also declared `const body = '#3a3d42'`, shadowing the `body()` helper that would
have handled it.

**Fixed:** all five now take their body colour from `body()` / `tint()`, which
resolves `part.color` → locked tint → `defaultBodyColor`. Screen glass, chrome and
motor housings stay literal, which is correct — they are not the recolourable
surface.

### [MEDIUM] Nothing reported a piece taller than the room

Surfaced by a test written for the ceiling clamp. The settle pass correctly
refuses to sink a too-tall part below the floor, and correctly refuses to shrink
it — silently resizing furniture to fit is precisely the dimension lie this
codebase exists to avoid. But the result was a wardrobe standing through the
ceiling with nothing said about it anywhere.

**Fixed:** `lib/clearance.ts` gained an `error`-severity "Taller than the room"
rule that names both measurements and states that Danmu keeps the real size.

## Found while REVIEWING the fixes

### [HIGH] The new "same place" rule called a tucked-in chair a collision

**File:** `lib/clearance.ts`, rule 2 — a defect introduced by this fix pass, not
by the original code.

The overlap rule above was written as `obbOverlap(a, b, -0.02)`: *any* shared
floor is a clash. Chairs pushed under a dining table share the table's footprint
on purpose, and a chair back rises above the table top, so the rule's vertical
guard cannot separate them either. A table with four chairs round it — the most
ordinary arrangement in the product — produced four `error`-severity findings
telling the user "one of them has to move". A rule that fires on correct work is
worse than the silence it replaced, because it teaches people to stop reading the
panel.

Caught by writing the test that should have been written with the rule. It fired
on the first run:

```
× analyzeRoom > does not call a tucked-in chair a clash
  → expected { id: 'clash-table-19-chair-20', … } to be undefined
```

**Fixed:** the rule now measures the overlap instead of merely detecting it.
`obbIntersectionArea` in `lib/geometry.ts` (exact Sutherland–Hodgman clip +
shoelace, 6 tests) gives the shared area; a pair is a clash only when it covers
more than half the smaller piece's footprint. Pairs that legitimately share floor
— seating under a table or desk — get a raised bar of 85% rather than a blanket
exemption, so a chair standing *in* the table is still reported while a chair
tucked *under* it is not. Four tests cover the boundary: tucked-in, buried,
merely clipping, genuinely interpenetrating.

### [MEDIUM] `ready` traded a reflow on some screens for a flash on all of them

**File:** `lib/use-media-query.ts`

`useMediaQueryState` answered in a `useEffect`, which runs *after* paint. The
studio pages hold their layout back until `ready`, so every load — desktop
included — painted "Setting up your studio…" for a frame before the real shell.
That is a worse trade than the layout shift it was added to prevent.

**Fixed:** an isomorphic layout effect. The answer now lands before the browser
paints, so the placeholder is never seen on a normal load, while SSR still
renders it and hydration still matches. Reading `matchMedia` during render was
rejected: the server has no viewport, so the first client render must agree with
the server's or hydration mismatches the whole subtree.

### [MEDIUM] `upgrade-insecure-requests` would have broken phone testing

**File:** `next.config.mjs`

The new CSP sent `upgrade-insecure-requests` unconditionally. `localhost` is
exempt from upgrading, but `next dev` bound to a LAN address is not — and
shooting the capture screen from a real phone over `http://192.168.x.x:3000` is
the one thing this app genuinely needs a second device for.

**Fixed:** production only. Every other header still goes out in dev.

### [LOW] Colour sampling went from too serial to too parallel

**File:** `app/onboarding/detect/page.tsx`

Sampling every detection's colour at once fixed the serialised decodes, but each
call decodes the whole photo — so 25 detections held 25 decoded bitmaps at once,
roughly 150 MB on exactly the phones this screen is aimed at.

**Fixed:** batches of four. Most of the speed-up, bounded peak memory.

## Verified sound (not findings)

Checked explicitly against the audit checklist, and genuinely good:

- **Design tokens** — no invented classes. Every `className` resolves to something
  defined in `globals.css`; contrast ratios are measured and recorded per token,
  with fill-vs-text variants separated (`--accent` vs `--accent-text`,
  `--danger` vs `--danger-text`) exactly as the rule requires.
- **Empty states everywhere** — `PartTree:244`, `CatalogPanel:89`,
  `Inspector:46-50`, `RoomTools:379`, workspace `EmptyState` + a distinct
  no-search-match state, `PlanThumb:115`, the detect rail, and the capture page's
  "no room open" gate. Every list and every table view has one.
- **Error states surfaced, not swallowed** — the detect screen's `Notice`
  taxonomy distinguishes calm/warn/error and gives each a recovery; camera
  failures map `DOMException.name` to authored copy for six cases plus a
  fallback; storage refusal on room create is caught and explained; clipboard
  refusal falls back to the CSV. (The one genuine silent failure is the JSON parse
  in `detection.ts` — see `findings-data.md`.)
- **Loading states** — `Room` has a real `loading` fallback rather than `null`;
  `LoadingOverlay` for detection with a cancel; `booted` (never re-raised) on the
  workspace; "Creating your room…" / "Opening your room…" / "Testing…" button
  states; a 15 s UI deadline on key validation because the SDK takes no abort
  signal.
- **Accessibility** — `IconButton` makes `label` required and it becomes both
  `aria-label` and `title`; `.icon-btn::after` lifts hit areas to 44 px without
  changing visual size; `:focus-visible` rings on every promoted control; roving
  tabindex on the footprint radiogroup; `htmlFor` on the Settings key field;
  live regions on the two long-running flows; every drag path has a keyboard
  alternative (arrow-key box placement on detect, a Move menu on capture);
  `prefers-reduced-motion` keeps state-carrying transitions and drops travel
  rather than nuking everything to 0.01 ms; `Icon` falls back to a dot so a
  button is never empty.
- **Responsive** — `.chrome-bar` wraps instead of overflowing; `.auto-grid` uses
  `minmax(min(340px, 100%), 1fr)` so no track can exceed the viewport;
  `.row-grid` and `.split--stack` collapse under 720 px; `100dvh` rather than
  `vh` on the studio and capture shells; the studio's touch gate asks about
  pointer type rather than width, so browser zoom no longer trips it.
- **Type safety** — zero `any`, no non-null assertions at system boundaries
  beyond `canvas.getContext('2d')!` (checked for null where it matters in
  `local-detect` and `color-sample`), defensive optional reads on every
  persisted record.

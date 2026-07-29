# Platform Audit — 2026-07-29

Danmu @ `main`. Audited, then **fixed**: 49 code findings — the original 40, 3 more
found while fixing, 4 more found while reviewing the fixes, 2 more found while
closing the leftovers — plus the 40 dependency advisories the first pass recorded
as un-run. Nothing left open.

The four from the review pass matter more than their count suggests: one of them
was a **regression this fix pass introduced**, and it was the loudest kind — a new
clearance rule that reported an error on a table with chairs round it. It is
written up with the rest, in
[findings-ui-code.md](audit/findings-ui-code.md#found-while-reviewing-the-fixes),
because a fix pass that only records the bugs it found in other people's work is
not an honest one.

## Verification

| Check | Before | After |
|---|---|---|
| `tsc --noEmit` | clean | **clean** |
| `vitest run` | 87 tests / 10 files | **189 tests / 19 files** |
| `next lint` | clean | **clean** |
| `next build` | clean, 11 routes | **clean, 11 routes** |
| `pnpm audit` | not run | **1 advisory, an advisory-range artifact** (from 40) |
| Next.js | 14.2.35 | **15.5.22** |
| Shared First Load JS | 87.4 kB | 103 kB |
| Studio route | 152 kB | 164 kB |
| Detect route | 189 kB | 205 kB |

The bundle grew ~15 kB on the shared chunk. That is Next 15's runtime, not
application code, and it is the cost of the 22 Next advisories below.

New scripts, all run and confirmed working:

```
pnpm vendor:ort            → copied 6 files (40.2 MB) from onnxruntime-web@1.27.0 → public/ort/
pnpm hash:models           → SHA-256 digests for the three files in public/models/
pnpm hash:models --verify  → …and all three match what the mirror serves
```

## Summary

Code findings — 49, all fixed:

| Severity | Found | Fixed |
|---|---|---|
| Critical | 0 | — |
| High | 6 | 6 |
| Medium | 24 | 24 |
| Low | 17 | 17 |
| Info | 2 | 2 |

Dependency advisories — counted separately, because 40 advisories resolve to six
packages and one upgrade, and rolling them into the table above would inflate the
total by an order of magnitude for a single afternoon's work:

| Severity | Found | Fixed |
|---|---|---|
| Critical | 1 | 1 |
| High | 20 | 19 |
| Moderate | 17 | 17 |
| Low | 2 | 2 |

The one unfixed high is an advisory-range artifact, not an exposure — the
`brace-expansion` DoS advisory declares `<=5.0.7`, which in semver includes the
whole 1.x line, so `1.1.17` matches it even though 1.x was patched in `1.1.16` and
has no `5.0.8` to move to.

Nothing is left open. The three items that were open in the first pass have all
been closed, and the way two of them were closed is itself worth reading:

- **The dependency scan turned out to be runnable.** It was recorded as "not
  performed — `pnpm` is not on `PATH`". `pnpm` is reachable through **Corepack**,
  which ships with Node. Running it found **40 advisories** (1 critical, 20 high,
  17 moderate, 2 low) — so "no verdict claimed" had been covering a real gap, not
  an empty one. 39 are now fixed, including a Next 14 → 15 upgrade;
  [findings-security.md](audit/findings-security.md) has the full account,
  including which of the 22 Next advisories could never reach this app and why the
  last remaining one is a false positive rather than an exposure.
- **The weights digests are pinned, verified on both sides.** Left empty in the
  first pass on the grounds that a pin taken from the local copy alone would fail
  closed for every fresh clone. Both sides now hash identically, and
  `pnpm hash:models --verify` performs the check instead of a comment asking
  someone to remember it. Pinning also exposed a hole in the original fix: the
  class-name JSON bypassed the verifier entirely, so a digest for it would have
  been decoration.
- **`lib/storage.ts` and `lib/history.ts` are covered.** 41 new tests across four
  files. `storage-ordering.test.ts` mocks `idb-keyval` to record the call sequence,
  because the delete/restore ordering guarantee cannot be observed any other way —
  IndexedDB returns keys in sort order, and `room:a:meta` sorts before
  `room:a:transforms` whichever way round they were written. My first attempt
  asserted over `keys()` and would have passed against a deliberately broken
  implementation; both suites were then mutation-checked by reversing the code they
  guard and confirming they fail.

## The three found while fixing

Doing the work surfaced defects the scan missed. All three are in
[findings-ui-code.md](audit/findings-ui-code.md#found-while-fixing):

1. **[HIGH] The TV rendered at a fixed 1.45 × 0.82 m regardless of its
   dimensions.** `TVGeo` took no `part` and hard-coded its size. `Draggable`
   scales by `storedDim / part.dimMM`, so any TV that was not exactly the catalog
   default rendered at the wrong size while every readout reported the real
   number. On a product whose promise is real dimensions, in the one shape that
   ignored its own.
2. **[MEDIUM] Five shapes ignored `part.color` entirely** — TV, monitor, fan,
   mirror, laptop. The Inspector's colour picker and the theme presets silently did
   nothing to any of them.
3. **[MEDIUM] Nothing reported a piece taller than the room.** The settle pass
   rightly refuses both to sink it below the floor and to shrink it — but the
   result was a wardrobe standing through the ceiling with nothing said anywhere.

## The four found while reviewing the fixes

Reviewing the diff before merging caught four more, one of them a regression from
this pass. All four are in
[findings-ui-code.md](audit/findings-ui-code.md#found-while-reviewing-the-fixes):

1. **[HIGH] The new "same place" rule called a tucked-in chair a collision.**
   Written as "any shared floor is a clash", which is what a table with four
   chairs round it looks like. It now measures the overlap — exact rotated-rect
   intersection area — and requires half the smaller piece's footprint, with a
   raised 85% bar for pairs that legitimately share floor. A rule that fires on
   correct work is worse than the silence it replaced.
2. **[MEDIUM] `ready` traded a reflow on some screens for a flash on all of
   them.** The media-query answer arrived in a `useEffect`, after paint, so every
   studio load showed "Setting up your studio…" for a frame. Now an isomorphic
   layout effect.
3. **[MEDIUM] `upgrade-insecure-requests` would have broken phone testing.**
   `localhost` is exempt from upgrading; `next dev` on a LAN address is not, and
   that is exactly how the capture screen gets tested. Production only now.
4. **[LOW] Colour sampling went from too serial to too parallel.** 25 detections
   held 25 decoded photos at once. Batches of four.

## The two found while closing the open items

Both were holes in this pass's own earlier work, found by finishing it properly:

1. **[HIGH] The class-name JSON bypassed the weights verifier entirely.** The
   whole point of `MODEL_DIGESTS` is that nothing remote reaches the runtime
   unchecked — but `.names.json` was still fetched with a bare
   `fetch(...).json()`, so pinning a digest for it would have been decoration.
   This file decides what every detection is *called*, which the original finding
   said in as many words. `fetchNames` now verifies it, and a missing table is a
   hard failure rather than an unhandled rejection inside the loader.
2. **[MEDIUM] The first override set silently collapsed three majors into one.**
   `"brace-expansion@1": ">=1.1.16"` also matches `5.0.8`, so every
   `brace-expansion` in the tree — 1.x, 2.x and 5.x — was promoted onto 5.x.
   Nothing failed, which is what makes it worth writing down. Caret ranges now
   keep each consumer on the major it was written against.

## What changed, by theme

**The detect → persist → rebuild seam** (all three original Highs lived here).
One codec (`toRecord`/`fromRecord`) replaces two hand-written mappers that had
drifted and were dropping the geometry pass on every re-visit. Detections carry a
`uid` that becomes the ScenePart id, so transforms stay attached to the same
furniture across a re-detect — with a fallback to the old ordinal so existing
rooms keep theirs. Photos are downscaled on ingest, which was the actual cause of
detection failing on the app's default input path.

**Honest failure modes.** A malformed response no longer reports "your room is
empty"; an oversized payload no longer reports "trying again often works". Both
have their own outcome with an instruction that actually works. Overlapping
furniture and a too-tall piece are now reported instead of passing as
"Everything fits".

**One source per fact.** `defaultBodyColor(category, shape)` for every default
colour, `PLAN` for the export palette, `CATALOG_SHAPES_ORDERED` for the shape
catalog *and* the prompt, `footprintForLayout` for both the picker's drawing and
its area label, `lib/dates.ts` for timestamps, `lib/csv.ts` for CSV, one
`useMediaQuery`. Several of these were two or three hand-maintained copies that
had already diverged — which is how a picker offered a cross shape and built a T.

**Third-party bytes.** A CSP with every host named and justified; the ONNX
Runtime served same-origin with the CDN demoted to fallback; remote weights and
the class-name table both format- and digest-checked before the runtime sees them;
and 39 of 40 dependency advisories cleared, Next included.

**Coverage where it was missing.** 87 → 189 tests. The persistence layer and the
undo stack had none at all, which is exactly how a hand-written read and a
hand-written write drifted apart and silently dropped the geometry pass.

## Findings by dimension

| Dimension | Findings | File |
|---|---|---|
| Security | 2 High, 4 Medium, 2 Low, 1 Info + the 40 advisories | [audit/findings-security.md](audit/findings-security.md) |
| Data integrity | 2 High, 5 Medium, 4 Low | [audit/findings-data.md](audit/findings-data.md) |
| Performance | 1 High, 2 Medium, 5 Low | [audit/findings-performance.md](audit/findings-performance.md) |
| UI & code quality | 2 High, 12 Medium, 7 Low | [audit/findings-ui-code.md](audit/findings-ui-code.md) |
| Visual | not performed | [audit/findings-visual.md](audit/findings-visual.md) |

Each file opens with a resolution table and keeps its original diagnosis as the
record. Two corrections are noted in place: `findings-data.md` had the
delete/restore key ordering backwards in one line (the implementation follows the
correct reasoning stated in the same finding), and `findings-performance.md`
downgraded the clearance-probe cost once the memoisation in `RoomTools` was
confirmed.

## Visual audit — still not performed

No browser or screenshot tool in this environment (checked, not assumed — the only
screenshot-capable tool present renders Figma canvas nodes). The spec's light/dark
and per-role matrices have no subject here: one theme, no auth.

Three things are now worth photographing first, because the fixes touched them:
the studio at 768 px (the reflow is gated on `ready` now), the footprint picker
(previews and areas are derived), and the exported floor-plan PNG (new palette,
measured legend).

## Deferred / won't fix

Re-confirmed at each pass:

- **React stays on 18.** Next 15 accepts `^18.2`, so the upgrade did not require
  it. Moving to 19 would force `@react-three/fiber` to v9 and drei to v10 — the
  entire 3D stack — in an environment with no browser to verify the result in.
- **One `brace-expansion` advisory left standing** — an advisory-range artifact,
  dev-only, reachable only under `eslint@8 > minimatch@3`. Clearing it means an
  ESLint 9 flat-config migration for a glob-matcher DoS during linting.
- **`next lint` still used**, though Next 15 suggests migrating to the ESLint CLI.
  It works, and the codemod is a separate change with its own risk.

- **API key in plaintext `localStorage`** — accepted design decision; there is no
  server to hold it, and Settings states plainly where it goes. Less exposed now
  that a CSP bounds what can run in the origin.
- **`app/global-error.tsx` hard-codes hex tokens** — correct: it can render before
  the stylesheet loads.
- **`ColorPicker` uses raw `#fff` / `#000` / `#f00`** — a colour picker must draw
  literal colours.
- **`onnxruntime-web` stays runtime-loaded with `webpackIgnore`** — bundling it
  breaks the Next build. Now served same-origin, which was the actual ask.
- **Weights hosted off-repo** — deliberate: AGPL-3.0 weights under an MIT project.
- **No dark theme** — out of scope; the tokens commit to one warm light palette.
- **`--hairline` on `.ds-card`** — a card is a surface, not a control.
- **`obbGap` returning 0 for flush contact** — intentional and tested. What was
  missing was distinguishing it from interpenetration, and that is now its own
  rule.
- **`'closet'` shape kept** — dead in the catalog but reachable in persisted
  rooms, so it is documented as a legacy alias for `'wardrobe'` rather than
  deleted.
- **Generic primitives shifted colour slightly.** `box`/`cylinder`/`plane` now
  take their category's canonical colour instead of a flat tan, so a
  low-confidence detection labelled "bed" reads as a bed. A deliberate, visible
  change; every real shape kept its exact previous colour.

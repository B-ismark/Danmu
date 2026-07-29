# Platform Audit — 2026-07-29

Danmu @ `main`. Audited, then **fixed**: all 40 findings addressed, plus 3 more
found while fixing and 4 more found while reviewing the fixes. 47 total.

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
| `vitest run` | 87 tests / 10 files | **148 tests / 15 files** |
| `next lint` | clean | **clean** |
| `next build` | clean, 11 routes | **clean, 11 routes** |
| Shared First Load JS | 87.4 kB | 87.4 kB |
| Studio route | 152 kB | 154 kB |
| Detect route | 189 kB | 196 kB |

New scripts, both run and confirmed working:

```
pnpm vendor:ort    → copied 6 files (40.2 MB) from onnxruntime-web@1.27.0 → public/ort/
pnpm hash:models   → printed SHA-256 digests for the three files in public/models/
```

## Summary

| Severity | Found | Fixed | Partial | Not done |
|---|---|---|---|---|
| Critical | 0 | — | — | — |
| High | 5 | 5 | 0 | 0 |
| Medium | 23 | 23 | 0 | 0 |
| Low | 17 | 17 | 0 | 0 |
| Info | 2 | 0 | 1 | 1 |
| **Total** | **47** | **45** | **1** | **1** |

The two that are not straight fixes are both stated plainly rather than quietly
closed:

- **Partial — weights identity pinning.** Format validation (ONNX protobuf magic +
  size window) is in place and enforced on every remote fetch, and the SHA-256
  machinery is wired up. `MODEL_DIGESTS` is deliberately empty: pinning a digest I
  cannot verify against what the mirror actually serves would fail closed and
  silently disable the detector for every fresh clone. `pnpm hash:models` prints
  the local digests and documents the two-sided check. One command from done, by
  someone who can fetch the mirror copy.
- **Not done — dependency vulnerability scan.** `pnpm` is not on `PATH` in this
  environment, and `npm audit` against a `pnpm-lock.yaml` is unreliable. No
  verdict is claimed either way. Run `pnpm audit` locally.

One further gap is recorded honestly rather than papered over: `lib/history.ts`
and `lib/storage.ts` still have no unit tests, because they need jsdom +
`fake-indexeddb` — two new devDependencies I could not install without a working
package manager. The fixes to both files are complete; only their coverage is not.

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
Runtime served same-origin with the CDN demoted to fallback; remote weights
format-checked before the runtime sees them.

## Findings by dimension

| Dimension | Findings | File |
|---|---|---|
| Security | 4 Medium, 2 Low, 1 Info | [audit/findings-security.md](audit/findings-security.md) |
| Data integrity | 2 High, 5 Medium, 4 Low | [audit/findings-data.md](audit/findings-data.md) |
| Performance | 1 High, 2 Medium, 5 Low | [audit/findings-performance.md](audit/findings-performance.md) |
| UI & code quality | 1 High, 10 Medium, 6 Low | [audit/findings-ui-code.md](audit/findings-ui-code.md) |
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

Unchanged from the original audit, and re-confirmed while fixing:

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

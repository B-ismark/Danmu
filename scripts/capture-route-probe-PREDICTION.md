# Prediction · `scripts/capture-route-probe.mjs`

Written **before the first run**, and committed before the probe itself, because a
prediction read after the fact is not a prediction. Same discipline as
`scripts/rails-probe-PREDICTION.md`, and for the same reason: the run has to be able to
falsify me, and it cannot do that if I write the expectations down afterwards.

## What is being asked

`docs/visual-check.md`'s § 44b item says, in its own words, that **the whole
preset-plus-photos route has never been walked** — "it is one press from the layout
picker, and everything known about it here was read out of the source rather than
exercised." § 44b and § 44 are merged (`9390323`, `91f1f6a`), CI is green, and the suite
proves the arithmetic by round trip. None of that says the geometry reaches a person.

So: drive the real click path in a real browser, against the build **before** § 44b as
well as the build after it, and see whether the numbers a user is shown actually move.

| build | commit | |
|---|---|---|
| before | `0562489` | the verified parent of `9390323` — the last commit before § 44b |
| after | `cda8801` | current `main` |

## Where the numbers come from

Not from arithmetic of mine. The `wallFrame` figures below are read off the table
`tests/photo-geometry.test.ts` prints on every green run (`§ 44b · the framed wall, per
shipping preset`), captured to the scratchpad before this file was written. The `t` row's
fixture is **5.5 × 4.7**, which *is* layout-pick's T-Shape preset
(`app/onboarding/layout-pick/page.tsx:16`), so the suite's numbers are the app's numbers
without conversion.

The unit is metres at two decimals — `useSettings`' default `dimUnit: 'm'`,
`precisionFor('m') === 2` (`lib/units.ts:38-50`).

Both builds render the label at the same place with the same format
(`span={spanLabel(slot)}`, post-fix `capture/page.tsx:518`, pre-fix `:495`), so the
strings are directly comparable. The difference is only what feeds them:

- **before** — `wallSpan(slot, room)`, which is `room.width` for n/s and `room.depth` for
  e/w (`0562489:lib/photo-geometry.ts:118-120`). A bounding-box side.
- **after** — `wallFrame(slot, footprint)`'s two ends, `right − left`
  (`capture/page.tsx:402-411`). The wall the lens is actually looking at.

## S2 · The T-Shape's four wall-length labels

| wall | slot | before | after | discriminates |
|---|---|---|---|---|
| Wall 1 | n | `5.50 m` | `5.50 m` | no |
| Wall 2 | e | `4.70 m` | **`2.58 m`** | **yes** |
| Wall 3 | s | `5.50 m` | **`2.42 m`** | **yes** |
| Wall 4 | w | `4.70 m` | **`2.58 m`** | **yes** |

Three of four move. Wall 1 not moving is not a weak result — the T's north wall really is
the full 5.50 m, and a convention change that moved it would be wrong.

## S3 · The U-Shape, where the honest answer is silence

| wall | slot | before | after |
|---|---|---|---|
| Wall 1 | n | `6.00 m` | **no label at all** |
| Wall 2 | e | `5.00 m` | `5.00 m` |
| Wall 3 | s | `6.00 m` | `6.00 m` |
| Wall 4 | w | `5.00 m` | `5.00 m` |

`wallFrame('n')` returns null for every `u` room: the notch's inner face sits at exactly
`z = 0`, so the standardised camera position is **on that wall** and there is no wall ahead
of the lens. The table prints it as *"the lens has no wall ahead of it"* rather than a
number.

**This is the item's first "would NOT be a bug" case, and the prediction has to be that
the label is ABSENT — not empty, not zero.** Refusing is the honest answer about a
photograph pointed out of a doorway. On screen it is indistinguishable from the feature
having done nothing, which is exactly why a person was needed.

## S5 · The control, and it is the scenario that matters most

**A Rectangle room must read identically on both builds.** All four walls: `6.00 / 4.00 /
6.00 / 4.00`, before and after. A rectangle's bounding box and its polygon agree
bit-for-bit, so nothing may move here.

If the rectangle moves too, the change is not what I think it is and **every other row in
this file is void**. This is the no-op proof at the UI level, and it is the assertion that
can fail for the right reason.

## S4 · The measured millimetres — a ratio, deliberately not an absolute

The detect screen prints a size only on a `suspect` verdict (*"Measured W × H mm —
{category} range is A–B"*, `detect/page.tsx:1283-1298`); a correctly labelled piece prints
nothing at all. So the probe mis-labels the box on purpose, which makes `judgeLabel` re-run
the geometry and print what it actually measured.

The box is not drawn by hand. **"Place with the keyboard"** seeds the fixed
`KEY_BOX = [0.38, 0.44, 0.24, 0.3]` and **"Add this box"** commits it — and that constant,
along with all three button labels, is **identical on both builds** (`0562489`'s
`detect/page.tsx:128`). So the box is a constant and the decoded size is a pure function of
the footprint.

**Predicted: the T-Shape's east wall reads about `2.27×` larger on the pre-fix build**
— 2.750 m of assumed distance against the real 1.210, and a wall piece's size goes as
`k · d` with the same assumed 66° lens on both (no EXIF in the uploads, so neither build
learns a focal length).

**I am deliberately not predicting the absolute millimetres.** To do that I would have to
re-implement the placer, and this thread has already filed the trap that follows: a number
measured against a re-implementation of the code is careful measurement of the wrong
subject. The run prints the absolute values; the ratio is the claim.

Three things about S4 I do not know, recorded as uncertainties rather than smoothed over:

1. **Whether the pre-fix build measures the box at all, or refuses it.** Pre-fix
   `onFramedSurface` bounded against `wallSpan/2` and went inert when it could not tell.
   `KEY_BOX` is near the frame centre, so I expect both builds to accept — but a refusal on
   either side is a legitimate outcome and would make S4 a different finding rather than a
   failed prediction.
2. **Whether `clampDims` or the category band truncates the printed figure.**
   `verdict.measured` comes from `judgeLabel`'s own `geoRefine` and should be pre-clamp, but
   if it is clamped the ratio is a floor, not an equality.
3. **Which category makes a clean `suspect`.** The probe will have to pick one whose band
   the decoded size misses on *both* builds, or the two runs are not comparable — if only
   one build prints a number, that is a result about verdicts and not about size.

## S1 and S6 · The route existing at all

- **S1** — `/onboarding/welcome` → layout-pick → the T-Shape radio → the second CTA
  *"Photograph my real room first (optional)"* → `/onboarding/capture` with a real room.
  It is a `<button>` calling `createRoom('capture')`, not a link, so there is no href to
  check; the button's existence must be asserted before it is clicked.
- **S6** — with no API key and no `public/models/`, the detect screen must show *"No key
  needed / Let's do this by hand"* and arrive with the draw tool **already armed**
  (`setAdding(true)`), so the offline route is walkable at all.

Both are expected to pass on both builds. They are here because if S1 fails, every other
number in this file is unreachable and the § 44b work is correct and invisible — which is
the outcome this walk exists to rule out.

## What would falsify the whole exercise

- **The two builds agree everywhere.** Then the route does not reach this geometry, the
  visual-check item stays open, and the defect is written up instead of the fix.
- **The control (S5) moves.** Then the probe is measuring something other than the
  footprint and nothing here counts.
- **S1 fails.** Then the fix is unreachable, which is worse than wrong.

## Recorded honestly: what a green run does NOT establish

That the rebuilt room *looks like* the room you photographed. The uploads are synthetic,
EXIF-less images, so this walk proves the numbers change and reach the screen. Whether a
real photograph of a real T-shaped room comes back looking right is still a person's
question, and if that is all that survives, the visual-check item gets narrowed to it
rather than deleted.

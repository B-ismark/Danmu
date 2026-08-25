# Plan — detection label quality and dedupe ordering

**Point-in-time study, 2026-08-25.** Written against `5db238d`. Per `CLAUDE.md`,
`Design.md` wins wherever this later disagrees with it.

Scope: the photo → detection → 3D part path only. Prompted by a review of "model
identification from user photos" and a counter-review of it. This file keeps what
survived verification from both, the findings neither had, and the corrected
payoff numbers.

**Written to be executable by someone with no memory of the conversation that
produced it.** Every edit site is anchored by *quoted current code*, not by line
number — line numbers drift, and every one below was accurate only at `5db238d`.
Grep the quoted snippet. §9 lists the traps; §10 lists the decisions that are not
the implementing agent's to make.

---

## 0. Execution log

Appended as phases land, so the next agent knows where the line is. Everything
below this section is the plan as written; where execution corrected it, the
correction is folded in with a note.

| Phase | State | Notes |
|---|---|---|
| 1 — move `geoRefine` to `lib/` | **done** | `lib/detect-refine.ts`, verbatim. `CalMap` / `RoomDims` moved with it. `tests/detect-refine.test.ts` holds the five contracts, each mutation-verified |
| 2 — derived depth | **done** | `defaultDepthFor(category, shape)` in `lib/scene-spec.ts` beside `CATEGORY_DEFAULTS`. §4's rug claim was wrong — see the correction there |
| 3a — dedupe after `geoRefine` | **done** | `refineDetections()` in `lib/detect-refine.ts`; `dedupeDetections` + `SAME_OBJECT_M` moved there out of `lib/detection.ts`. Label equality **kept** |
| 3b — drop label equality | **deferred, and now measured** | Phase 8 priced it: the cost is a real piece of furniture per gallery pair, the gain is a duplicate that was one tap away anyway. Recommend NOT doing it |
| 3c — tiered merge distance | **done** | `mergeDistanceFor(category)` in `lib/detect-refine.ts`. Fixes the live over-merge bug 3a uncovered, independently of 3b |
| 4 — range-based label repair | **done** | `lib/label-repair.ts` + the review-screen surfacing. Decisions 1 and 2 answered: re-measure, and suggest-then-confirm |
| 5 — bearing auto-slot | not started | **Decided: ingest AND retire the four-slot grid.** The larger of the two options, and a product change — see §10.5 |
| 6 — confidence honesty | **done, two items declined** | `lib/detect-confidence.ts` + `source` in both codec directions. `distance` and image quality declined with reasons — see below |
| 7 — measure ceiling items | **done** | `placeCeilingObject`, width only. Two corrections to §3 below — the row it intersects, and what happens past the wall |
| 8 — pipeline harness | **done, except the detector metric** | `tests/detect-pipeline.test.ts`, analytic, in CI. The detector half needs photos that must not be committed — see below |
| 9 — dead-field removal | **done** | `alsoSeenIn` cut from the type and all three prompt clauses. `position.y` turned out **not** to be dead — see the correction below |

**Order from here: 5 only** — 6, 7, 8 and 9 are done. Phase 5 should wait for the
UX branch's pull request to land, since it rebuilds the same capture screen.

**Order as it was written: 9 → 7 → 8 → 5.** This departs from §6, deliberately. §6 put 5
before 8 so the harness could measure a SigLIP decision, but Phase 5 has since become
a capture-screen rebuild rather than an ingest tweak, which makes it both the most
invasive remaining phase and the one most likely to collide with UX work in the same
tree. The harness should exist before it, not after. 9 and 7 are small and go first
because they are cheap and independent.

Gates after Phase 6: 1045 tests, 58 files, typecheck / lint / build clean.

**Phase 6 had an open decision after all, and it was hiding inside "split the
threshold per source".** The plan said no decision was open. Reading the three
sources' confidences showed why one is:

- **local** — a class score off the ONNX head, emitted above 0.35 after NMS.
  Discriminative. Most true positives never reach 0.85.
- **cloud** — a number the language model wrote about its own answer. Self-reports
  from an LLM cluster high and narrow, so 0.85 is barely a bar.
- **manual** — a literal `1`, written by the code because the USER drew the box. Not
  a confidence at all; a sentinel for "not applicable".

One `0.85` compared against all three auto-confirmed nearly every cloud row and
nearly no local row, in a UI where "confirmed" means the user has vouched for it.

**The decision was what to do about it, and inventing a second digit was the wrong
answer.** Raising an uncalibrated self-report from 0.85 to 0.9 looks like calibration
and is a guess. So the numbers in `AUTO_CONFIRM` are deliberately not the interesting
part: local and cloud share 0.85, `manual` is `'always'`, and what changed is that
auto-confirm now requires **independent corroboration** — the geometry must have
measured the piece and agreed with its word. The camera is the one voice in the
pipeline that did not come from a model.

**That turned up a live bug in Phase 4's own wiring.** The auto-confirm test was
`status !== 'suspect'`, which let through every row the camera never looked at.
`lib/label-repair.ts` says in as many words that "a caller that treats `unmeasured`
as `ok` claims the geometry agreed with the AI", and the review screen was that
caller. An uncalibrated self-report plus no measurement is not two pieces of
evidence; it is one. Four mutations verified, including that one.

**Two of the four items in §5's Phase 6 list are declined, not forgotten.**

- **`GeoPlacement.distance` as a confidence discount.** A far detection is a less
  certain measurement, which is true and unquantified — turning it into a weight
  needs a calibration this branch does not have, and a made-up curve would be the
  same theatre as a made-up threshold. There IS a hard signal hiding next to it: a
  floor or ceiling backprojection that HIT the wall clamp is one whose geometry was
  overridden rather than measured. `distance` returns the clamped value, so a caller
  cannot tell. That wants a flag on `GeoPlacement`, and it is a real follow-up.
- **`lib/image-quality.ts` discounting a blurry photo's detections.** `Quality` is
  scored at capture time and shown there, but `Capture` does not persist it, so the
  detect screen has nothing to read. Either a persisted-schema change or a re-score
  in the browser — and the payoff is a threshold nudge, which is the part of this
  phase that just turned out to be worth the least.

**Phase 8 found a live bug on its first run, which is the best argument for it.**
`in=11 refined=9` for a room with ten things in it. The missing piece was one of two
bedside tables 0.55 m apart against a far wall: they image as 7%-wide boxes 9%
apart, with visible daylight between them, and the same-photo merge rule collapsed
them because its threshold was "centres within 12% OF THE IMAGE". That is the same
mistake as the flat 0.6 m cross-slot distance Phase 3c fixed — one absolute number
standing in for a question about proportion — and it survived 3c because 3c was
looking at the other rule. It is now intersection-over-union at 0.5, which is
scale-free by construction. Deliberately not intersection-over-minimum: that would
merge a shelf boxed inside its own bookcase, and keeping both is the safe way to be
wrong here.

**The baseline is exact, and that is the point.** With a perfect detector, eight of
the ten pieces come back at **0.0000 m** position error and **0 mm** width error;
all ten keep their label with no false accusation; eleven detections become ten
parts, merging exactly the one object that was photographed twice. Anything not in
the allowance table must be exact, so the day any of those numbers moves, something
changed. The two that are not exact are documented approximations: the fan at
0.114 m / −26 mm (`placeCeilingObject` reads one bbox row for a plate spanning a
range of distances), and up to 0.150 m of scene movement, which is `snapToWall` and
`settleParts` doing their job rather than error.

**Three things the harness cannot do, stated rather than skipped.**

- **It cannot test the projection.** Boxes are made by projecting through a camera
  model and then inverted by a camera model, so a wrong shared convention cancels
  out. `tests/photo-geometry.test.ts`'s hand-computed cases own that, and the two now
  share one forward model in `tests/helpers/project.ts` rather than keeping a copy
  each.
- **It cannot report a DETECTOR metric.** That needs the private photo set, which
  stays out of the repo because it is pictures of somebody's bedroom. The harness is
  shaped so that half can be added later — feed real boxes instead of projected ones
  and every metric still computes — but "Phase 4 moved 13/19" is not a number this
  branch can produce, and pretending otherwise would make the SigLIP gate in §7 look
  decidable when it is not.
- **The room is 7 × 6 m, larger than the bedroom this product is aimed at.** The
  FRAME is the binding constraint, not the furniture: floor is only visible past
  1.51 m and ceiling past 1.21 m, so a small room leaves no distance at which a piece
  is both inside the walls and inside the picture. Every fixture asserts `inFrame`,
  which caught two of my own bad fixtures before they became mystery position errors.

**Phase 3b now has its number, and it says don't.** Label equality is the only thing
separating two distinct same-category pieces closer together than their merge tier —
two paintings 0.30 m apart against a 0.35 m tier. Drop it and that pair becomes one
painting, every run. What it buys back is one object named differently in two photos
surviving as two rows, which is a duplicate the user deletes in one tap. Both cases
are now tests. The asymmetry is the same one the rest of `detect-refine.ts` argues
from: a missing piece of furniture leaves no trace, a duplicate leaves a button.

**One refactor came out of this rather than being planned.** `toRecord` / `fromRecord`
moved from `app/onboarding/detect/page.tsx` to `lib/detection-record.ts`. The harness
has to cross that boundary to be a pipeline test at all, and a harness with its own
copy of the codec would be a third implementation of the thing whose entire
documented failure mode is having two. It is now round-trip tested — nine tests over
a fully populated detection rather than a field list, so a field added to one
direction and not the other fails without anyone remembering to extend an
assertion.

**Phase 7, and two things §3 got wrong about it.** §10.7 already corrected the
signature (the ceiling plane needs `room.height`, so `RoomDims` gained it — as a
REQUIRED field, so a caller that forgets it fails to compile rather than silently
stopping measuring every fan). Writing it turned up two more, both found by
arithmetic rather than by reading:

1. **It intersects the MIDDLE bbox row, not the top edge.** The obvious design —
   mirror `placeFloorObject`, whose bottom edge is on the floor — is wrong here,
   because a floor object is a vertical thing at one distance while a ceiling fan
   is a horizontal PLATE seen obliquely. Its image spans a range of distances and
   the top of the bbox is its NEAREST rim, so intersecting there measures the near
   rim and then applies the disc's full angular width at that shorter distance. For
   a 1.2 m fan 2.0 m away that reads **881 mm — further from the truth than the
   1000 mm catalogue default it was supposed to improve on.** The centre row reads
   1145 mm. Pinned in `tests/photo-geometry.test.ts` as arithmetic, including the
   "worse than not measuring" comparison, and mutation-verified.

2. **An intersection past the far wall is REFUSED, not clamped** — the one place
   this deliberately departs from `placeFloorObject`. The floor is visible right up
   to the wall, so a foot landing slightly beyond it is measurement error and the
   clamp recovers it. A ceiling is different: **a level camera in a normal room does
   not see the ceiling at all.** At 66° hFOV on 4:3 the vertical half-angle is ~24°,
   so from 1.5 m the ceiling of a 2.8 m room first enters frame 2.9 m away, past the
   wall being photographed — the same fact `calibrateFromFloorLine` meets at the
   other edge of the image. So a high pixel in such a frame is WALL, and the first
   draft clamped it onto the ceiling plane and read a picture frame out as a 576 mm
   ceiling fan. That was caught by a test whose premise was wrong, not by review.

So Phase 7 pays off on an ultrawide (~106°, ceiling in frame from 1.3 m out), on a
camera tilted up, or in a tall room — not on the nominal four-slot rig. Worth having
anyway: the module header already notes that a wall shot in a small room is often
taken on the ultrawide, and Phase 5 is heading for arbitrary uploads where tilt is
normal. Where it cannot measure, it returns null and `geoRefine` hands the detection
back untouched, which is precisely the pre-Phase-7 behaviour.

**Phase 4's yield goes from three delivered to four.** The benchmark's ceiling-hook
row — 100 mm against a fan's 900 mm floor — was a real finding waiting on a
measurement, and now has one.

**The consumer needed the same restriction, and the type is what enforced it.**
`judgeLabel` tested both axes; a ceiling item's H is now a catalogue default or the
AI's own hint, so judging it would be judging the model's number against the model's
word — they agree by construction, which is the premise the whole module rests on.
`measuredAxes(category, shape)` returns width alone for a ceiling anchor, and
`LabelVerdict.measured.height` became **optional**, which immediately failed the
build at the one place that would have printed a catalogue default on screen
directly after the word "Measured".

**A test that had quietly lost its teeth.** Phase 1's "a ceiling anchor comes back
untouched" contract kept passing after `placeCeilingObject` shipped — but for a new
reason: its fixture box sits below the horizon, so the refusal was the lens's, not
the anchor's. Replaced by three tests that say which. The depth sweep's
`if (category === 'fan') continue` is also gone: a skip whose stated reason has
expired is a coverage hole that nothing reports.

**Correction to §3 and §10.9: `position.y` was not dead metadata. It was a gate,
and the gate was a bug.** The audit read `groundY` overwriting `pos[1]`
unconditionally and concluded the AI's `y` had no consumer. Reading
`buildSceneFromRoom` rather than the audit's summary of it found **two** uses, of
which only the first is dead:

1. `pos: [aiPos.x, aiPos.y, aiPos.z]` — dead, overwritten two lines later.
2. `typeof aiPos.y === 'number' && aiPos.y >= 0 && aiPos.y <= h` — **a validity
   test on the whole position.** Fail it and x and z are discarded too, and the
   part falls back to `placementForSlot`.

So cutting `y` from the prompt while that gate stood would have rejected every
position and silently returned the whole detected-room path to slot-snapping — the
exact shape of failure this plan exists to remove, introduced by the phase whose
brief was "delete fields with no reader". The reader was there; it was reading the
wrong axis.

The gate now tests x and z only. A fan the model put 3.2 m up in a 2.8 m room is a
fan with a wrong height, not a fan in the wrong corner, and its floor position was
being thrown away for it. `tests/scene-build.test.ts` pins it: same detection at
y = 0.45 and y = 99 must land in the same place, with a premise assertion that the
recorded position is honoured at all so the test cannot pass by both rows falling
back together. Mutation-verified — restoring the height check moves the part from
(1.4, 0.9) to (−0.64, −1.7), i.e. snapped to the N wall.

**What was done about `y`, and what was declined.** The prompt no longer asks the
model to compute mounting or standing heights — that was tokens spent on a number
`groundY` owns and overwrites. It is asked to send 0. The field stays required in
all three declarations (`Detection.position`, `GeoPlacement.position`, the
persisted `detectedObjects[].position`): making it optional in three places,
one of them a persisted schema, buys nothing once nothing reads it.

**Phase 4's real yield, measured against the benchmark rather than estimated.**
Ranges reject **four** of the six documented failures, not the two or three §3
guessed — the ceiling-hook row is caught on width arithmetic (100 mm against a
fan's 900 mm floor) even though `geoRefine` never measures it, so the finding is
real and only its *delivery* waits on Phase 7. The two it cannot reach are the two
§8 already named: a garment rail that genuinely is wardrobe-shaped, and a 400 mm
square that genuinely could be a framed print.

**The repair half is weaker than the rejection half, and the module says so.** For
1400 × 2300 both `curtain` and `wardrobe` fit, and the discriminator between them
is thinness — the one axis a single photo cannot see. So the honest output is a
shortlist the user picks from, not an answer. Rejection is the reliable win: the
bed that would have been placed across the room is stopped either way.

Three design calls worth knowing about, all taken inside Phase 4:

- **Measurability is established by identity**, not by a new field. `geoRefine`
  returns its input unchanged when it cannot measure, so `judgeLabel` re-runs it
  and compares references. That keeps trap #9 load-bearing — and tested — and
  avoids the persisted-schema change Phase 6 needs for provenance.
- **Verdicts are a parallel array, never a field on `Detection`.** A verdict is
  about the current measurement; persisting one lets a stale accusation outlive
  the row it was about.
- **Auto-confirm now skips suspect rows.** A 0.9 self-report beside a size no bed
  could have is one row saying two different things, and locking it filed the
  finding behind a padlock before anyone read it. Small enough to belong here
  rather than wait for Phase 6.

Gates green after each: `pnpm typecheck`, `pnpm test` (974 passing), `pnpm lint`,
`pnpm build`. `tests/layout-solve.test.ts`'s twenty-piece timing case fails under a
loaded CPU and passes run alone — known, unrelated, and the reason `CLAUDE.md` says
never to run typecheck and test at once.

**Two things execution added that the plan did not have.** Both are pure logic and
both are now the tested contract:

- `refineDetections(dets, cals, room | null)` — the ORDER as a testable function
  rather than as a line inside a React component. §2's finding is otherwise
  unpinnable: this repo has no component tests, so a call-site move inside
  `detect/page.tsx` would ship with nothing holding it in place.
- `dedupeDetections` and `SAME_OBJECT_M` moved out of `lib/detection.ts`. Once the
  merge runs for both paths it is no longer a cloud concern, and nothing about the
  on-device path should sit behind the module that imports the Gemini SDK.

**Method note, since it earned its keep three times.** Every new test here was
checked by mutating the code it covers and confirming it goes red. That caught one
test with no teeth: the yaw case was written claiming `??` in place of the
`typeof d.yaw === 'number'` guard would break it, and it would not — `0 ?? x` is
`0`, so the two are equivalent under the type. The mutation that the test actually
catches is `||`. A test whose comment names the wrong failure mode is a test nobody
can maintain.

---

## 1. Verified in the tree

| Claim | Evidence |
|---|---|
| Trust boundary is real and enforced | `lib/scene-spec.ts:1704-1731` — clamps AI dims, gates AI position to `±half+0.2`, then `groundY` overrides Y unconditionally |
| Local path has no cross-image dedupe | `dedupeDetections` called only at `lib/detection.ts:238`; `detectLocalAcrossImages` (`lib/local-detect.ts:578`) NMSes per image into a flat `out` |
| One confidence threshold for two instruments | `app/onboarding/detect/page.tsx:471` — `d.conf >= 0.85` for both YOLO objectness and Gemini self-report |
| Mesh cache is dead code with fossil names | `MeshProviderId = 'meshy' \| 'tripo' \| 'manual'` (`lib/mesh-cache.ts:13`); zero callers of `put`/`setBlob`; only `CachedMesh` reads |
| No detection eval harness | `scripts/` holds only `export-detector.py`, `hash-models.mjs`, `vendor-ort.mjs` |
| Local wins on any hit — no hybrid | `detect/page.tsx` — `if (dets && dets.length === 0) dets = null` is the only fallthrough |
| 13/19 categorised vs 17/19 localised | `Design.md:205-295`, re-verified 2026-07-30 |
| `alsoSeenIn` is dead metadata | Declared `detection.ts:28`, demanded by the prompt at `:86`, `:94`, `:112`, mentioned in a comment at `:252` — **consumed nowhere** |
| `GeoPlacement.distance` is dead | `photo-geometry.ts:206-217` computes and documents it "useful for confidence weighting" — no reader. Relevant to Phase 6 |
| `geoRefine` is untestable where it lives | It is a private function inside `app/onboarding/detect/page.tsx`, not in `lib/`. No test exists for it. **This blocks Phase 3** |
| `CATEGORY_DEFAULTS` is not exported | `lib/scene-spec.ts:1498` is a bare `const`. Phase 2 needs it or an accessor |
| The upload path already extracts pose | `capture/page.tsx:172` calls `readCapturePose(files[i], …)` inside `addFiles`; live capture calls it again at `:338`. So bearing reaches uploads, not just captures — Phase 5 needs no new call site |
| Confirmation is keyed by array index | `confirmed: Set<number>` over `detections`; delete re-maps by hand, add appends `detections.length`, the cache path rebuilds from `locked` by ordinal. See trap #10 |

### Rejected or downgraded

- **"Call `dedupeDetections` on the local path"** — a no-op. Its cross-slot rule
  requires identical labels (`detection.ts:282`) *and* non-null `position` on both
  (`:283`). Local detections have neither: no position at all, and the labels are
  the broken thing. Its per-image NMS already handles same-image duplicates.
- **"Slim the Gemini prompt — drop `dimMM` / `color` / `position`"** — would delete
  load-bearing channels. `geoRefine` returns the detection untouched when the slot
  has no calibration or on ceiling anchors, so AI `position` is the only fallback
  there; `d.dimMM?.[1]` is the sole depth source, because one straight-on wall photo
  cannot observe depth along the camera axis (`photo-geometry.ts:209` says so in the
  type); `color` is a documented fallback for failed pixel sampling. Only `y` is
  genuinely dead — `groundY` always wins. **The defensible version of this
  recommendation is narrower: delete fields with no reader** — `alsoSeenIn` and `y`,
  not `dimMM`.
- **"COOP/COEP for WASM threads, low effort"** — collides with a written decision
  (`next.config.mjs:103`): `require-corp` breaks the Hugging Face weights, which send
  no CORP header. The real lever is `Cross-Origin-Embedder-Policy: credentialless`,
  which grants `SharedArrayBuffer` while permitting no-cors cross-origin fetches.
  Chromium/Firefox only, not Safari. Browser-gated, not low effort. Parked — and
  changing that file means re-litigating a documented decision with numbers.
- **"Drop `yolov8n-oiv7`, Design.md already flags it"** — `Design.md:293-295` flags it
  as the lever *if inference ever feels too slow*, at a cost of 1/19 recall for −22%
  bytes. A conditional trade nobody has asked for, not waste.
- **"Synthetic benchmark regression-tests detection quality"** — it would not.
  Rendered catalog primitives are out-of-domain for a photo detector, so the score
  would mislead. As a **pipeline** regression (calibration → geoRefine → repair →
  dedupe → clamp → settle; boxes in, placements out) it is excellent and cheap.
- **"Retain `GPSImgDirection` through the strip, following the ICC precedent"** —
  moot, the work is already done and done better. `lib/exif.ts:50-51` already reads
  `GPSImgDirection` / `GPSImgDirectionRef`, and `:22` documents that lat/lon are
  deliberately never read. `lib/capture.ts:91` already assigns `pose.bearingDeg`, on
  the **original** file before `normalizePhoto` (`capture.ts:78-80`). No byte surgery,
  no retention exception, no privacy-boundary change to argue. Only a consumer is
  missing — see Phase 5.

---

## 2. The finding that outranks all of them

**`dedupeDetections` runs on coordinates the engine then throws away.**

`detectAcrossImages` dedupes internally at its own tail; `geoRefine` replaces those
positions afterwards on the detect page. So the cross-slot merge measures 3D distance
using **Gemini's** positions — the exact numbers `geoRefine` exists to replace.

A merge decides *what exists*. Deciding it on AI geometry is the spirit of rule 2
violated one layer above where rule 2 is enforced.

---

## 3. The algorithmic lever: read `clampDims` backwards

`dimsWithinRange(category, shape, dim)` already exists and is exported
(`lib/dimension-ranges.ts:137`). Its only callers today are two tests. Nothing on
the detect path calls it.

It is the mislabel discriminator, already written:

- Forward, today: *AI says bed → clamp the size into bed's range.* Size is the suspect.
- Backward: *geometry measured 1400 × 2300 → bed's range cannot hold that → the
  **word** is the suspect.*

There is a window for it. `geoRefine` writes projectively measured W/H into
`detections` state; `clampDims` does not run until scene build (`scene-spec.ts:1707`).
The raw measurement therefore sits unclamped for the whole time the user is on the
review screen. **Clamping destroys the evidence — the check must run before it.**

On the local path this is unusually clean: `local-detect.ts:677-688` emits
label/conf/box/category/shape and **no `dimMM`**, so `geoRefine`'s W and H are pure
pinhole measurements no AI touched. Geometry judging AI's vocabulary with numbers AI
never supplied.

`lib/fit-check.ts` already set the precedent — it computes `outOfRange` via
`dimRangeFor` and **reports without clamping** (`fit-check.ts:141-142`), with the
reasoning in its header. Same move, new consumer.

It **repairs** as well as rejects: ask which categories' ranges *do* contain the
measurement, then let `anchorFor` plus the slot's wall plane break the tie — a thin
full-height object on the wall plane is a curtain, not a wardrobe. No new prior table
to author; every input already exists.

### Scored against the real benchmark

`Design.md`'s named failures against the actual ranges in `dimension-ranges.ts`:

| observed | AI word | claimed range W, H (mm) | measured ≈ | caught |
|---|---|---|---|---|
| floor curtain | `Bed` | 1700–2300, 300–1400 | 1400 × 2300 | **yes** — fails both axes |
| wall ledge | `Desk` | 800–2400, 600–900 | 1200 × 130 | **yes** — fails H |
| ceiling fan | `Lamp` | 120–800, 150–2000 | 1200 × 300 | **only if** its shape resolves to a floor/table lamp |
| ceiling hook | `Ceiling fan` | 900–1500, 150–450 | 100 × 100 | **no** — never measured |
| garment rail | `Wardrobe` | 600–4000, 1600–2600 | 1000 × 1700 | no — legitimately inside |
| cardboard box | `Picture frame` | 150–2400, 150–1800 | 400 × 400 | no — legitimately inside |

**Ceiling items are never measured.** `geoRefine` returns the detection unchanged for
`anchor === 'ceiling'` (curtain excepted), and `anchorFor` (`physics.ts:51`) puts
`fan` and `lamp-pendant` there. Those rows have no `dimMM` to test at all.

Realistic yield: **2–3 of 6 → 13/19 becomes ~15/19, zero bytes downloaded.** For
comparison the entire 14 MB `yolov8n-oiv7` model buys 1/19.

(An earlier estimate of 4/6 over-counted by ignoring the ceiling early-return. This
table is the corrected one.)

---

## 4. The depth blocker — fix before anything in §3

Current code (grep `?? 500`):

```ts
  const depth = d.dimMM?.[1] ?? 500;
```

The local path always takes the `500`. Compare per-category depth ranges from
`dimension-ranges.ts`: painting `15–60`, mirror `15–60`, tv `40–120`, curtain
`40–200`.

**Correction, found while implementing Phase 2: rug is not one of them.** An earlier
draft of this line listed rug's depth as `3–40`, which is its **H** axis — the pile
thickness. `rug: R('flexible', [600, 400, 3], [5000, 4000, 40])` gives it a D range
of 400–4000, so `500` was always legal for a rug. Four thin categories break, not
five. The lesson generalises past this one row: **a category is thin on whichever
axis you are reading, and `[W, D, H]` puts depth in the middle.** Anything that
picks a thin category off `min[2]` / `max[2]` is reading height.

A naive `dimsWithinRange` call therefore **fails every local thin-category detection
on depth alone**. The D axis is not merely blind — it manufactures false alarms.

1. Any range rule must test **W and H only** wherever D is synthetic.
2. Replace the literal with a *derived* depth. **Do not substitute a different magic
   number** — the present bug is thinnest-legal-after-clamping wearing the word
   "default" (the comment three lines above already says "Depth stays a category
   default"), and a fresh literal ships it again.

**The source to derive from**, in order of preference:

```ts
// scene-spec.ts:1498 — per-category typical dims, [W, D, H]. NOT exported today.
painting: { shape: 'painting', dim: [800, 30, 600], wallMounted: true },
curtain:  { shape: 'curtain',  dim: [1600, 80, 2200], wallMounted: true },
wardrobe: { shape: 'wardrobe', dim: [2000, 600, 2100] },
```

Take `CATEGORY_DEFAULTS[cat].dim[1]`, then clamp it with
`dimRangeFor(cat, shape)` so a shape-specific range still governs. Two existing
sources of truth, no third number invented. `CATEGORY_DEFAULTS` needs exporting, or
a small `defaultDepthFor(category, shape)` accessor beside it — prefer the accessor,
since exporting the whole table invites consumers to read `.dim` and skip `clampDims`.

---

## 5. Phases

Each is independently shippable. Pure `lib/` logic gets a Vitest test per
`CLAUDE.md`; the suite is **node** env by default — none of this needs jsdom.

### Phase 1 — move `geoRefine` into `lib/`  *(prerequisite, no behaviour change)*

`geoRefine` is a private function in `app/onboarding/detect/page.tsx`. Phases 2 and 3
both change it, Phase 3 adds a geometry branch to it, and none of that can be tested
where it currently lives.

- Move it verbatim to `lib/detect-refine.ts`, exported. It is already pure — it takes
  `(Detection, CalMap, RoomDims)` and returns a `Detection`, touching no React.
- `CalMap` and `RoomDims` move with it (or into it) so the page imports both.
- **Nothing else changes in this phase.** Ship it green, then build on it.
- **Test:** `tests/detect-refine.test.ts` pinning present behaviour *before* Phase 2
  touches it — floor anchor measured, wall anchor measured, ceiling anchor returned
  unchanged, no-cal returned unchanged, AI `yaw` preserved over the geometric one.
  Those five are the contract every later phase must not break.

### Phase 2 — derived depth

- Apply §4 inside the moved `geoRefine`.
- Add `defaultDepthFor(category, shape)` to `lib/dimension-ranges.ts` (it already owns
  `dimRangeFor`) or beside `CATEGORY_DEFAULTS`, whichever keeps the import graph
  acyclic — check, `scene-spec` already imports from `dimension-ranges`.
- Fix the stale comment in the same edit.
- **Test:** for each thin category (painting, mirror, rug, tv, curtain), a detection
  with no AI `dimMM` gets a depth inside that category's range. The literal `500`
  fails every one of these today — that is the assertion's proof of teeth.

### Phase 3 — dedupe after geoRefine

**This phase split in two on contact, and the halves carry different risk.**

- **3a — the reordering.** Decision-free, and the whole of §2. **Shipped.** The merge
  now runs after the measurement, for both paths, via `refineDetections`. Label
  equality was left exactly as it was, so no recall was traded to get it.
- **3b — dropping label equality.** Still open. It buys the cross-slot mislabel case
  (the same curtain returning as `Bed` from one wall and `Wardrobe` from another) at
  the cost of merging things that merely share a category, with no harness yet to
  measure which way the trade went. §10 decision 4, now with a fourth option below.

**A live bug found while shipping 3a, which changes what 3b is choosing between.**
`SAME_OBJECT_M = 0.6` is already too loose *with* label equality in force. Four
identical dining chairs at 0.55 m spacing, all labelled "dining chair", collapse to
**two** — verified against the current code, not reasoned about. So this is not a
hazard that dropping label equality would introduce; it is one that dropping label
equality would *widen*. And 3a made it likelier to fire, because the positions it now
compares are measured ones that genuinely agree, where before they were guesses that
mostly did not.

**Resolved as 3c, shipped, and independent of 3b.** Three named bands —
`tight` 0.35 m, `medium` 0.6 m, `loose` 0.9 m — with a per-category tier, behind
`mergeDistanceFor(category)`. `medium` is the flat value it replaces, and it is also
the fallback, so adding a category never silently loosens the rule.

The tier answers "how close can two DIFFERENT items of this category legitimately
sit", which tracks the item's footprint: chairs, nightstands, ottomans, lamps,
plants, monitors, paintings and mirrors are `tight` (a gallery wall hangs frames
0.4 m apart); sofas, beds, wardrobes, rugs and curtains are `loose` (nothing puts
two beds 0.9 m apart, and being large they are the items one wall photo clips, so
two views of one disagree the most).

A derived version was considered and declined — half the category's typical width
lands near these numbers, so the formula was available. Two reasons not to: three
named bands can be reasoned about at a glance where a formula's output cannot, and
the merge distance is not actually the same quantity as the furniture's size. It is
how far two MEASUREMENTS of one object may drift, which depends on the calibration
and on how much of the object a single wall photo clips.

Either way it errs toward under-merging, the direction this file already argues for:
a duplicate the user can delete beats a real piece that never appears.

Current call, at the tail of `detectAcrossImages` (grep `return dedupeDetections`):

```ts
  const valid = (parsed as Detection[]).filter((d) => d.box && d.box.length === 4 && d.slot);
  return dedupeDetections(valid);
```

Current consumer, on the detect page (grep `Geometry pass`):

```ts
        const refined = keyed(
          room ? dets.map((d) => geoRefine(d, calMap, { width: room.width, depth: room.depth })) : dets,
        );
```

- Move the dedupe call out of `detectAcrossImages` and onto the page **after** the
  `geoRefine` map, so it runs for both paths. `detectAcrossImages` returns `valid`.
- Re-key on refined `position` + `category`. **Drop the label-equality requirement** —
  it is what makes the rule useless for local, where the same curtain returns as
  `Bed` from one wall and `Wardrobe` from another.
- **Dropping label equality re-scopes `SAME_OBJECT_M = 0.6`.** It was calibrated
  against label-*matched* pairs. Same-category merging at 0.6 m will eat two side
  chairs at ~0.55 m centre-to-centre, which is a real arrangement. Either tier the
  distance by category (beds/sofas loose ~0.6; chairs/nightstands tight ~0.35–0.4) or
  additionally require cross-slot bbox-overlap support.
- **uid survivorship:** on merge keep the **higher-confidence** row's uid, not
  whichever came first in array order. `scene-spec.ts:1688` keys user transform
  overrides off uid, so picking wrong silently detaches a user's edits.
- Keep the "no position → keep both" guard: a duplicate the user deletes beats a real
  piece that never appears. Uncalibrated photos fall into this branch for free, since
  `geoRefine` returns `d` untouched without a cal.
- **There is no `locked` flag to union at this point, and that is worth knowing before
  someone looks for one.** Confirmation is not a field on `Detection`; it lives in the
  page's `confirmed: Set<number>`, **keyed by array index**, and `setConfirmed` runs
  *after* refine and dedupe. So a fresh run has nothing confirmed when the merge
  happens. It becomes a real hazard only if a later phase makes dedupe run over
  already-confirmed rows — the cache path reconstructs `confirmed` from `locked` by
  index — at which point the rule is `uid` from higher conf, `locked = a || b`.
- **No behaviour change when `room` is absent.** The page skips refinement entirely
  there (`room ? dets.map(...) : dets`), but "unrefined" is not "position-less": cloud
  detections still carry the AI's `position`, so the moved dedupe sees exactly what it
  sees today and merges identically. Local detections have no position either way and
  keep-both already applies. Worth one test pinning it, but do not expect a diff.
- Side benefit: halves the cardboard-box false positive, counted once per wall.

**Test obligations — read this before touching `tests/detection-dedupe.test.ts`.**
Its seven existing cases **all still pass with label equality removed**, so the suite
as it stands gives no protection here. Verified: its four-chairs fixture puts them at
x `-0.6` and `+0.6` (1.2 m apart) and its nightstands at `±1.25` (2.5 m apart) — both
comfortably beyond 0.6 m. A green suite after this edit means nothing on its own.
Add:

1. Four dining chairs at ~0.55 m spacing staying four.
2. Two detections, same category, differing labels, same place → one (the new
   capability; impossible before).
3. uid survivorship — merged row keeps the higher-`conf` uid.
4. Both kept when either position is absent.

### Phase 4 — range-based label repair

- New `lib/label-repair.ts`, pure. In: a measured detection + room. Out: unchanged, a
  re-categorised detection, or a flag.
- Reads `dimsWithinRange` / `dimRangeFor` (`dimension-ranges.ts`) and `anchorFor`
  (`physics.ts`). **Authors no new numbers.**
- W/H axes only where depth is synthetic (§4).
- Runs **after** `geoRefine`, **before** `clampDims`.
- **Re-entrancy:** changing the category changes `anchorFor`, which is what `geoRefine`
  branched on to choose `placeFloorObject` vs `placeWallObject`. A repaired detection
  needs its geometry recomputed — measure, re-word, re-measure. See §10 for the
  decision this forces.
- **Surface it, do not silently rewrite.** The review screen already exists for
  confirming detections; a silent re-label is the same class of mistake as a silent
  resize, and `CLAUDE.md` rule 2 forbids the latter by name.
- **Tests:** the six `Design.md` failures as fixtures (measured dims in, expected
  verdict out — including the two that must come back *unchanged*), plus a
  no-false-positive sweep over `PART_LIBRARY` where every catalog item's own dims
  survive its own label. That sweep mirrors `tests/catalog.test.ts:11` and is the one
  that stops this feature from becoming a nuisance.

### Phase 5 — bearing to auto-slot

**The plumbing is already complete; only the consumer is missing** — see §1's rejected
row. `exif.ts` reads the direction tags, `capture.ts` stores `pose.bearingDeg` from the
original file before the strip, `storage.ts:45-47` carries it with the comment *"Unused
today"*, and `snapBearing()` exists at `compass.ts:106`.

**Including on the upload path** — checked, because "capture only" is the obvious thing
to assume from `readCapturePose`'s docstring. `capture/page.tsx:172` calls it from
inside `addFiles`, on `files[i]`, i.e. the original picked file. Live capture calls it
again at `:338`. So a dragged-in photo already carries `bearingDeg` whenever its camera
wrote the tag; no call site needs adding.

- Assign the capture slot from bearing instead of asking for N/E/S/W clockwise. Works
  for uploads too, wherever the source camera wrote the tag.
- **Photos with no bearing** (anything through a messaging app, which strips EXIF
  upstream): vanishing-point families give *relative* orientation, and relative is
  enough — assign the set to slots consistently, then offer **one rotation control**
  that relabels all of them at once.
- VP cannot substitute for bearing outright: it yields an orientation *family*, and no
  pixel distinguishes north from south.
- This is what retires the 1-photo problem — arbitrary uploads become first-class
  instead of being force-fitted to a four-slot ritual. `capture/page.tsx:257` already
  allows continuing on `!anyCaptured`, so the gate is not the blocker; the prompt's
  "You will receive 4 photos" (`detection.ts:66`) and the fixed slot grid are.

### Phase 6 — confidence honesty

- Split the `0.85` auto-confirm threshold per source; YOLO objectness and a VLM's
  self-report do not calibrate the same way.
- Show provenance per row (local / cloud / manual). **This is a persisted-schema
  change, not a UI change** — it needs a `source` field on `Detection` *and* both
  directions of the `toRecord` / `fromRecord` codec on the detect screen. `CLAUDE.md`'s
  rule exists because a hand-written read and a hand-written write already drifted here
  once and silently dropped the geometry pass. Add the field to both or not at all.
- `GeoPlacement.distance` already exists and is documented for exactly this
  ("useful for confidence weighting") with no reader — a far detection is a less
  certain measurement.
- `lib/image-quality.ts` gates nothing on the detect path today — a photo flagged
  `blurry` should discount its detections rather than be weighted like a sharp one.

### Phase 7 — measure ceiling items

- `geoRefine` excludes ceiling anchors as "not on the wall plane". True, but the
  **ceiling plane is just as known**: room height is given and camera height is
  calibrated (`CAM_HEIGHT`, or solved by `heightFromFloorLine`), so angular size at a
  known distance yields W.
- Add `placeCeilingObject` beside `placeFloorObject` / `placeWallObject` in
  `lib/photo-geometry.ts`. Copy the `placeWallObject` signature exactly —
  `(box, slot, room, cal) => GeoPlacement | null` — so `geoRefine`'s branch stays a
  three-way switch on `anchor` and nothing downstream learns a new shape.
- Unlocks the two ceiling rows in §3 — the fan and the hook — which is where the
  remaining size-catchable error lives.
- **Test:** `tests/photo-geometry.test.ts`, same shape as the existing floor/wall cases.

### Phase 8 — pipeline regression harness

- Regression-test **calibration → geoRefine → repair → dedupe → clamp → settle** from
  known placements plus ground-truth boxes.
- **Do not put headless three.js in CI to get those boxes.** Software GL is slow and
  fragile, and the pixels are not what is under test. Compute the boxes **analytically**
  — project known placements through the same camera model — and the whole harness is
  pure node, no GPU. The pixel renderer becomes optional depth, never a CI dependency.
- **Limit of that shortcut, state it in the harness:** boxes generated by projecting
  through `photo-geometry` cannot test `photo-geometry`'s projection — that step is
  self-consistent by construction. The harness covers everything *downstream* of it.
  Projection itself stays covered by `tests/photo-geometry.test.ts`'s hand-computed
  cases, which is where it belongs.
- Explicitly *not* a detector score (§1). Name it for what it measures.
- **Also define the detector metric through it** on the private photo set, so "Phase 4
  did / didn't move 13/19" is a number rather than an anecdote. That is what makes the
  SigLIP gate in §7 decidable.
- The benchmark photos stay out of the repo — they are photographs of somebody's
  bedroom (`Design.md:272-274`).

### Phase 9 — dead-field removal

- Cut `alsoSeenIn` from the prompt, **or** consume it in the new dedupe as a weak
  prior. It has no reader today. Decide which; do not leave it demanded and ignored.
- Cut `y` from the prompt — `groundY` overrides it unconditionally.
- This is the whole of the defensible "prompt slimming". `dimMM`, `color` and
  `position` stay, for the reasons in §1.

---

## 6. Order

1. **Phase 1** — move `geoRefine` to `lib/` (no behaviour change, unblocks testing)
2. **Phase 2** — derived depth
3. **Phase 3** — dedupe after `geoRefine`
4. **Phase 4** — range-based label repair
5. **Phase 5** — bearing auto-slot
6. **Phase 8** — pipeline harness; defines the metric
7. **Phase 7** — ceiling measurement
8. **Phase 6**, **Phase 9** — any time; independent
9. SigLIP, only if Phase 8 shows Phase 4 fell short — **still undecidable on this
   branch**: that measurement needs the private photo set, which does not ship

1–2 can be one PR. 3 must be its own, for the test reason in Phase 3.

## 7. Deferred, with reasons

- **SigLIP / CLIP crop classifier (~40–90 MB).** The one case ranges genuinely cannot
  fix is garment-rail vs wardrobe: same size, same place, same mounting, different
  appearance. Gated on Phase 8's measurement.
- **Hybrid local-boxes + Gemini-labels-crops.** Real and attractive — local is weak
  exactly where Gemini is strong — but it changes the privacy tier of a keyed run and
  should not ride along with a quality fix.
- **`COEP: credentialless`** for WASM threading. Browser-gated; revisit if WASM latency
  becomes the complaint.
- **`MeshProviderId` cleanup.** Dead plumbing wearing names from the permanently
  deleted image-to-3D pipeline, which reads as a rule-1 violation to anyone who
  rediscovers it. Rename to `'library' | 'manual'` or delete the cache outright if the
  CC0 library is not landing. Cosmetic but cheap.
- **Depth Anything / MobileSAM.** For occluded colour sampling try the zero-byte
  approximation first: median over the box's lower-central region, rejecting pixels
  near the room's own `wallColors`.

## 8. What no algorithm buys

- **Recall.** The keyboard and the small wall painting get no box at all. No geometry
  rescues a box that does not exist.
- **Appearance discrimination.** Garment rail vs wardrobe, as above.
- **Naming the unknown.** Ranges verify a proposed word; they never propose one.

---

## 9. Traps

Each of these was found the hard way while writing this plan. All of them fail
*silently* — typecheck passes, suite goes green, product gets worse.

1. **Do not check ranges after `clampDims`.** Clamping is what erases the evidence the
   check needs. Order is: measure → repair → clamp.
2. **Do not test the depth axis** where depth is synthetic. Every local thin-category
   detection fails on D alone (§4). W and H only.
3. **Do not replace `?? 500` with another literal.** Derive it (§4).
4. **Do not trust a green `detection-dedupe.test.ts`** after dropping label equality.
   All seven existing cases pass either way; their fixtures are 1.2 m and 2.5 m apart.
   The regression it must catch is at 0.55 m and does not exist as a test yet.
5. **Do not keep the first uid on merge.** Keep the higher-confidence one, or user
   transforms silently detach from the piece they were made on.
6. **Do not silently re-label.** Surface the repair. Rule 2's "never silently resize"
   is the same principle one field over.
7. **Do not re-word a detection without recomputing its geometry.** The category
   determines `anchorFor`, which determined which projection measured it.
8. **Do not add a fourth confidence semantic.** If Phase 6 splits the threshold, the
   split belongs in one place both paths read, not per call site.
9. **`geoRefine` returning `d` unchanged is not a failure path** — it is the honest
   "no calibration for this slot" answer, and three phases depend on it staying that.
10. **Confirmation is keyed by array index, not by uid.** `confirmed: Set<number>`
    indexes into `detections`; delete re-maps it by hand, add appends
    `detections.length`, and the cache path rebuilds it from `locked` by ordinal. **Any
    phase that reorders, filters or merges `detections` after `setConfirmed` silently
    moves the user's confirmations onto other rows.** Phase 3's dedupe is safe only
    because it runs *before* `setConfirmed`. Phase 4 must not casually reorder.

## 10. Decisions that are not the implementing agent's to make

Flag these and stop; do not pick a default.

1. ~~**Phase 4 re-entrancy.**~~ **Decided: re-measure.** Every candidate is
   re-measured under its own anchor before being offered, and one that no longer
   fits its own band is dropped rather than shown. The case for it turned out to be
   sharper than expected: the same box that measures 480 × 360 as a hung painting
   measures 480 × 1680 as something standing on the floor, so a repair carrying the
   old numbers is measuring a curtain as though it stood on the floor.
2. ~~**Phase 4 surfacing.**~~ **Decided: suggest, user confirms.** A warn-toned line
   under the row name, with up to two chips for the words the size fits. The detect
   screen gained no new state — the verdicts are a `useMemo` over `detections`.
3. ~~**Phase 9 `alsoSeenIn`.**~~ **Decided: cut it.** Field and all three prompt
   clauses. The merge now runs on measured positions, which is a better signal than
   the model's own opinion about which walls it saw something in — and keeping it as
   a prior would put AI judgement back into the decision Phase 3a just moved onto
   measurements. Note the comment referencing it has already followed
   `dedupeDetections` into `lib/detect-refine.ts` and needs updating there too.
   `Detection.position.y` is listed in the same phase and is a **separate** question:
   `groundY` overrides it unconditionally, but cutting it from the prompt while the
   type still requires `y: number` would leave a field typed non-optional and
   arriving undefined. Decide that when the phase is done, not by assuming it rides
   along.
4. ~~**Phase 3 tiering vs overlap-support.**~~ **Decided: tiering.** Shipped as 3c
   above. Reprojection support — project one detection's position into the other
   slot's camera and require it to land inside that box — remains the principled
   alternative and needs no threshold at all, but it makes the merge
   calibration-aware. Worth revisiting only if the tiers turn out to be the thing
   Phase 8 measures as wrong.
5. ~~**Whether Phase 5 changes the capture UX or only the ingest.**~~ **Decided:
   both.** Bearing assigns the slot, and the four-slot grid goes — `capture/page.tsx`
   becomes "add photos" rather than four labelled bays. This is what makes an
   arbitrary upload first-class instead of force-fitting it to a ritual, and it is
   the phase that retires the one-photo problem. It is also a product change to
   onboarding, so it wants its own PR and a look at whatever `PlanUX` is doing to the
   same screens. Photos with no bearing still need the vanishing-point relative-slot
   path plus one rotation control that relabels the whole set at once.

7. ~~**Phase 7 measures width only.**~~ **Done.** The decision held; see §0 for the
   two things this section got wrong about how. Original reasoning kept below.

   **Phase 7 measures width only. Decided, and the reason is geometric, not lazy.**
   A ceiling fan seen from below projects as a disc: its bbox VERTICAL extent is the
   foreshortened diameter, not the thickness. Deriving H from it manufactures a
   1200 mm-tall fan, which `clampDims` then squashes to 450 — a fake measurement
   followed by a silent resize. W alone catches both ceiling rows in §3's table (fan
   1200 against a lamp's 800 ceiling; hook 100 against a fan's 900 floor), so nothing
   is lost. Two consequences for whoever writes it: `placeCeilingObject` **cannot**
   copy `placeWallObject`'s signature as §3 says, because the ceiling plane needs
   `room.height` and `RoomDims` carries only width and depth; and the Phase 1
   contract test asserting a ceiling anchor comes back untouched must be updated
   deliberately, not deleted.
6. ~~**Whether Phase 8 ever renders pixels at all.**~~ **Decided and shipped:
   analytic only, and no renderer appeared.** Original note below.

   **Whether Phase 8 ever renders pixels at all.** Analytic ground truth covers the
   pipeline and runs in CI; a real renderer would additionally exercise the detector
   and the colour sampler, at the cost of software GL in the build. Recommendation is
   analytic-only in CI, renderer as an opt-in local script — but "we never test on
   pixels" is a call worth making deliberately rather than by omission.

## 11. Repo state

**This section rots faster than any other — several agents work this tree. Re-check
`git status` against the phase you are starting rather than trusting the paragraph
below.**

By execution time the UX WIP had landed and the tree was clean at `6a899f8`, so the
collision the earlier draft of this section worried about never materialised. Phases
1, 2 and 3a then touched `lib/detect-refine.ts` (new), `tests/detect-refine.test.ts`
(new), `lib/scene-spec.ts`, `lib/detection.ts`, `tests/detection-dedupe.test.ts` and
`app/onboarding/detect/page.tsx`.

Work landed on `feat/detect-pipeline-order`, branched from `6a899f8`, as four
commits: the move, the derived depth, the reordering, and the tiered distance.

`geoRefine` no longer lives in `app/onboarding/detect/page.tsx`, so the coordination
point that draft flagged is closed: the page imports `geoRefine` and
`refineDetections` from `lib/detect-refine` and nothing else depends on the old
private function. `CLAUDE.md` and `Design.md` still move under other agents, so this
document's citations into them may drift — grep the quoted text, not the line number.

## 12. Verification

Per phase, in order — `CLAUDE.md`: never run typecheck and test concurrently, timing
assertions fail under CPU contention.

```bash
pnpm typecheck
pnpm test
pnpm lint          # --max-warnings 0; a warning is a red build
pnpm build         # its own ESLint pass; greps its own output in CI
```

Acceptance per phase:

- **1** — suite green, zero behaviour diff, five new contract tests passing.
- **2** — thin-category depth tests pass; they fail on `main`.
- **3** — four new dedupe tests pass plus the no-`room` pin; the seven existing ones
  still pass. Confirm at least one new test *fails* on `main` before the change —
  see trap #4, a green suite proves nothing here.
- **4** — six `Design.md` fixtures give the expected verdicts (including two
  unchanged); `PART_LIBRARY` sweep clean.
- **5** — a room *captured* with bearing needs no manual slotting; a set of
  **dragged-in files** whose EXIF carried `GPSImgDirection` also needs none (this is the
  flow the four-photo complaint was about); a set with no bearing still works via the
  relative-slot + rotation-control path.
- **7** — ceiling fixtures measure; `geoRefine`'s ceiling contract test from Phase 1
  is updated deliberately, not deleted.
- **8** — ~~harness runs in CI and reports a number.~~ **Done for the pipeline
  half.** It prints its table on success, not only on failure, because a number
  visible only when something breaks is not reported. The detector half is blocked
  on the private photo set and says so in the file. Analytic ground truth only; if
  a renderer ever appears it is an opt-in local script and never a CI dependency.
- **9** — ~~the field, the three prompt clauses and the stale comment in
  `lib/detect-refine.ts` all go together. `position.y` is a separate decision.~~
  Done, and `position.y` was a separate decision for a better reason than expected:
  it was load-bearing. See the correction in §0.

### Not covered by tests, and worth knowing

The review-screen wiring is not under test, because this repo has no component
tests and adding a jsdom React harness for one row is a bigger change than the row.
Three behaviours therefore rest on review alone: the suspect line renders only for
`status: 'suspect'`, accepting a chip replaces the row **in place** (trap #10 —
`confirmed` is index-keyed), and auto-confirm skips suspect rows. All three are
one-line conditions, and the logic underneath them is fully covered; but they are
the three places a refactor could break this quietly.

# Danmu — Remediation Plan

> Written 2026-07-30. Execution plan for the findings in [`Research.md`](Research.md).
> Ordered by dependency first, then by value ÷ effort. Every phase names the
> files it touches, the tests it needs, and the docs it must update.
>
> Sizes are relative, not hours: **XS** = one sitting · **S** = a day ·
> **M** = a few days · **L** = a week+ · **spike** = measure before committing.

---

## Dependency graph

```
Phase 0  free wins ─────────────────────────────────────┐
                                                        │
Phase 1  measurement truth (EXIF → FOV → height/pitch)  │
                                                        │
Phase 2  clearance field (EDT) ──┬── 2b circle footprints
                                 │
                                 └────────────► Phase 6  layout solver
                                                (cost fn IS the field)

Phase 3  real lights ────────────┐
                                 ├────────────► Phase 4b  sun path
Phase 4a wall openings ──────────┘             (needs holes + lights)

Phase 5  materials + stack bump ──────────────► Phase 5c  WebGPU / SSGI

Phase 7  spikes (metric depth · RF-DETR) — independent, parallel
```

Hard constraints: **4a before 4b** (no daylight without an aperture),
**2 before 6** (the solver scores against the field), **5b before 5c** (WebGPU
needs the three bump and the postprocessing replacement).

---

## Phase 0 — Free wins · **XS** · no behavioural risk

Three fixes with no design decisions in them. Do these first regardless of what
else gets picked up.

### 0.1 Fix the room-report raster

`lib/clearance.ts:308` — `freeFloorFraction` scans every cell of the room bbox
for every part, and `pointInObb` recomputes `cos`/`sin` per call.

- Rasterise **per part into its own bbox**, OR into a shared `Uint8Array` mask.
- Precompute `cos/sin` once per OBB; pass them in.
- Count `inside` cells once, from the polygon, not per part.

Cost goes from `room area × parts` to `Σ part area`.

**Tests:** `tests/clearance.test.ts` — parity assertion against the current
implementation over ~50 randomised scenes (same answer within 1e-9), plus the
existing coverage cases.

**Done.** Measured 11× (5 × 5 m, 12 parts) to 56× (40 × 40 m, 30 parts), results
identical to the last bit. The large-room case went from **1558 ms to 27.9 ms** —
that was a 1.5 s freeze on every committed edit.

### 0.2 Make "supported" mean supported

`lib/physics.ts:178` — `findSupportUnder` tests only whether the mover's *centre*
is inside the support's half-extents + 5 cm, so a laptop 90% off a desk is
"on the desk".

- Require `obbIntersectionArea(mover, support) ≥ 0.5 × mover footprint`
  **and** centre inside. `obbIntersectionArea` already exists in `geometry.ts`.
- Keep the existing rejection of rugs and wall-mounted parts as supports.

**Tests:** `tests/physics-snap.test.ts` — overhang cases at 40 / 60 / 90%.

### 0.3 Strip photo metadata on every path *(privacy)*

`lib/capture.ts:88` and `:100` return the input blob **unchanged** when it is
already a JPEG under 1600 px. Those blobs keep their EXIF — including
`GPSLatitude`/`GPSLongitude` — and are then sent to Gemini during detection.
`Design.md` promises wall photos as the egress; it does not promise the
coordinates of the user's home.

- New `lib/jpeg-strip.ts`: walk JPEG segments, drop `APP1` (0xFFE1), `APP2`,
  `APP13`, `COM`; keep `SOF`/`DQT`/`DHT`/`SOS` and everything after. Pixels stay
  bit-identical, so the passthrough optimisation survives.
- Call it on the passthrough branches of `normalizePhoto`. The canvas re-encode
  path already drops metadata as a side effect — make that explicit in the
  comment rather than relying on it.
- Must run **after** Phase 1's read step, not before. Sequence in
  `normalizePhoto`'s caller: read EXIF → keep the numbers → strip → store.

**Tests:** `tests/jpeg-strip.test.ts` — node environment, pure bytes. Fixture
buffer with a known APP1; assert the marker is gone, the SOS payload is
byte-identical, and the result still decodes as JPEG.

**Docs:** `Design.md` §5 (local-first / egress) — state that photos are stripped
before storage and before any request.

---

## Phase 1 — Measurement truth · **M** · highest value

> **Done except 1.6**, which was always scoped as its own PR. Shipped:
> `lib/exif.ts`, `lib/device-tilt.ts`, `CameraCal.height` / `.tiltRad` with
> ray-based placement, `heightFromFloorLine`, the `CapturePose` record, the
> calibration ladder in `buildCals`, and the camera-height field on the capture
> screen. 33 new tests.
>
> One finding changed the shape of the problem: the assumed FOV does **not**
> distort a floor-standing object's size — `k` cancels between distance and
> angular size — it distorts its *position*. It distorts *size* only for
> wall-mounted items, whose distance is pinned to the wall. Camera height is the
> term that scales floor-object size, and cancels for wall items. See
> `Research.md` §1.4 and `tests/photo-geometry.test.ts`.

Turns three stacked guesses into measured values.

### 1.1 `lib/exif.ts` — read the numbers *(new file, pure)*

Parse the APP1 segment directly. No dependency needed; ~150 lines.

| Tag | ID | Use |
|---|---|---|
| `FocalLengthIn35mmFilm` | 0xA405 | `hFOV = 2·atan(36 / 2f₃₅)` — primary |
| `FocalLength` + `Make`/`Model` | 0x920A | fallback via sensor-size table |
| `Orientation` | 0x0112 | image rotation (90° steps only) |
| `GPSImgDirection` | 0x0011 | north bearing → Phase 4b |
| `GPSLatitude` / `GPSLongitude` | 0x0002 / 0x0004 | solar position → Phase 4b |

Returns `null` for every field it cannot read. Never throws.

**Tests:** `tests/exif.test.ts`, node environment — fixture byte arrays for
big-endian and little-endian TIFF headers, a missing-APP1 case, and a truncated
segment. Pure buffers, so no jsdom.

### 1.2 Carry calibration on the capture record

Extend the photo record with:

```ts
cal?: {
  hfovDeg?: number;
  pitchDeg?: number;
  rollDeg?: number;
  camHeightM?: number;
  source: 'exif' | 'device' | 'vanishing-point' | 'user' | 'default';
}
```

**`CLAUDE.md` codec rule applies**: add it to *both* `toRecord` and `fromRecord`
on the detect screen. This is exactly the drift that rule exists to prevent.
Additive field, so `RoomData.version` does not need to move.

### 1.3 Flip the calibration equation — `lib/photo-geometry.ts`

`calibrateFromFloorLine` has one equation and two unknowns, so today it assumes
height to solve for FOV:

```
(vFloor − 0.5) · k / aspect = CAM_HEIGHT / d
```

With `k` known from EXIF, the same equation solves for **camera height** instead.

- Add `calFromFocal35(f35, aspect): CameraCal`.
- Add `heightFromFloorLine(vFloor, cal, d): number | null` — same sanity gating
  as the existing function (reject implausible results rather than returning a
  confident wrong number).
- **Keep `calibrateFromFloorLine`** for the no-EXIF path. Selection order:
  EXIF → vanishing points (1.6) → floor line → 66° default.
- Surface which one fired. The app already holds the line that a privacy or
  accuracy claim must be shown *at the moment it applies*; calibration source
  belongs on the detect screen next to the sizes it produced.

### 1.4 Pitch as a first-class input

`tanY` assumes the optical axis is horizontal. Reformulate placement as an
explicit ray, then intersect:

```
d_cam = normalize( (u−0.5)·k,  (0.5−v)·k/aspect,  1 )
d_world = R_pitch · R_roll · d_cam
floor:  t = CAM_HEIGHT / −d_world.y      (reject t ≤ 0)
wall :  t = wallDistance / d_world.z
```

This replaces the `tDown` shortcut in `placeFloorObject` and the flat-plane
assumption in `placeWallObject`, and makes pitch/roll optional inputs that
default to 0 — so the no-calibration path produces exactly today's numbers.

**Tests:** `tests/photo-geometry.test.ts` — synthetic ground truth. Place a known
box at a known position, project it analytically to a bbox, feed the bbox back,
assert recovery within 1%. Then repeat with 5° pitch to prove the correction
earns its keep (and that pitch = 0 is unchanged from today).

### 1.5 Live-capture pitch — `lib/capture.ts`, capture screen

`DeviceOrientationEvent.beta` at shutter time. iOS needs
`DeviceOrientationEvent.requestPermission()` behind a user gesture; treat denial
as "no pitch available" and fall through. `snapToBlob` output never has EXIF, so
this is the only calibration the live path can get.

### 1.6 Vanishing-point calibration *(optional within this phase — **M** on its own)*

Line-segment detection + RANSAC for two orthogonal vanishing points gives focal
length in closed form and pitch/roll independently:

```
f² = −(v₁ − p) · (v₂ − p)        # principal point p at image centre
```

Covers uploads with stripped EXIF and live captures without device orientation.
Deterministic, zero download. Split into its own PR — it is the largest single
piece of new maths in the plan.

### 1.7 Ask for the height *(**XS**, do it even if 1.6 slips)*

One optional field on the capture screen, default 1.5 m. Removes the largest
single error term for users whose photos carry nothing useful. `source: 'user'`
outranks `'default'` and loses to a measured value.

**Docs:** `Design.md` §4 — the geometry-engine table needs the calibration chain
and the honest statement that depth is still a category default.

---

## Phase 2 — Clearance field · **M** · replaces four rules with one

> **2a done.** `lib/clearance-field.ts` (+ 26 tests), rules 3 and 8 rewired onto
> it, reachability and turning space added, the plan overlay redrawn from the same
> raster, and `floorBlockers` / `entranceComponents` extracted so the report and
> the plan cannot disagree about what blocks a route.
>
> Three things the plan did not anticipate:
>
> · **A rectangular room has no cell outside its own bounding box**, so without a
>   one-cell pad ring the EDT has nothing to measure the walls from and every cell
>   in a room made entirely of walls reports infinite clearance.
> · **The obvious gap estimator is biased.** `2 × min(clearance)` over the medial
>   axis loses up to a full cell every time, because the axis almost never lands on
>   a cell centre — a systematic *under*-estimate, which on a "too tight?" rule is
>   the direction that invents warnings. Straddling the axis
>   (`clearance[a] + cell + clearance[b]`) is exact face-to-face and within 1.5
>   cells at any rotation, and `gapTolerance` now publishes that bound with a test
>   holding it.
> · **Wall gaps are measured but not reported.** The field knows them, but saying
>   "the sofa is 40 cm off the wall" every time would teach people to close the
>   panel. A wall pinch that matters is one that severs a route, so it surfaces as
>   reachability instead.

### 2a The field — `lib/clearance-field.ts` *(new, pure)*

Built on the raster Phase 0.1 already produces:

1. Rasterise the footprint at 5 cm; mark cells covered by solid parts.
2. **Exact squared EDT** — Felzenszwalb & Huttenlocher two-pass, O(n) per axis.
3. Walkable = `EDT ≥ 300 mm` (half the 600 mm walkway rule).
4. **Connected components** over the walkable set (union-find).

One field, four answers:

| Question | From the field |
|---|---|
| Tight walkway (**incl. against walls** — invisible today) | walkable cells with EDT in [300, 500) mm |
| Navigability — is every piece reachable from the door? | is the piece's front cell in the door's component? |
| Accessibility — wheelchair turning circle | `2 × max(EDT)` ≥ 1500 mm (ADA 1524 / AS1428.1 1500) |
| Crowding | free-cell fraction — the existing metric, now a by-product |

**Tests:** `tests/clearance-field.test.ts` — EDT verified against brute-force
nearest-obstacle on small grids; a hand-built room with a deliberately isolated
chair; a corridor exactly 600 mm wide asserting it passes and 590 mm asserting it
fails.

### 2a.2 Rewire `analyzeRoom`

Replace rule 3 (pairwise walkway) and rule 8 (crowding) with field queries; add
navigability and accessibility findings. **Keep rules 1, 2, 4, 5, 6, 7 as they
are** — door swing, clash, storage front, bedside, TV distance and over-height
are all specific enough that the field would say less, not more.

Watch: the `TUCKS_UNDER` / `TUCKED_CLASH_SHARE` exemption must survive. A chair
under a table must not become a navigability failure.

**Risk:** existing `tests/clearance.test.ts` expectations will move. Change them
deliberately, one at a time, with the reason in the commit — not in bulk.

### 2a.3 UI

- Accessibility findings behind a toggle in the room report (not everyone wants
  them; everyone who does, needs them).
- Optional clearance heatmap on the 2D plan (`PlanView.tsx`) — the field is
  already a raster, so this is close to free and it is what makes the feature
  legible.

### 2b Circle and polygon footprints · **M**

> **Done**, with two departures from the plan above.
>
> **`circle?: boolean` was kept, not replaced by `footprintShape`.** It already
> exists, it is already the single source of truth in `scene-spec.ts`, and it is
> already persisted inside saved layouts — renaming it buys nothing and costs a
> codec on both sides of a record, which is the exact drift `CLAUDE.md` warns
> about. What was missing was never the name; it was that no geometry read it.
>
> **`circle` now means the inscribed ELLIPSE, not a circle of radius W/2.** W and
> D are separately editable, and the renderer draws what that implies, so a
> stretched plant pot has to be measured as the shape on screen. `pointInFoot` is
> the exact closed form (it runs per raster cell); the pairwise helpers polygonise
> to an inscribed 32-gon, which holds 99.4% of the area — deliberately inscribed,
> so a round piece is never reported as hitting something it does not touch.
>
> **The gap function did not need it.** `obbGap` has no callers left in `lib/` —
> Phase 2a moved walkway measurement onto the field, which reads the exact ellipse
> through the raster. So there is no ellipse-to-polygon distance code, which would
> have been the only part of this with no closed form.
>
> One correction to the plan's stated payoff: the phantom corners were **not**
> fighting tucked-in chairs in the room report. The clash rule's
> `TUCKED_CLASH_SHARE` already lets a chair reach 85% of its own footprint into a
> table, and a corner overlap is ~20%. Where the bounding square actually bit the
> user is `collidesAt` — the placement gate behind the 3D drag, the plan drag and
> the keyboard nudge, which had no test at all and now does. The 27%
> over-estimate on coverage was real and is fixed.

`scene-spec.ts` gains `footprintShape?: 'rect' | 'circle'` (rule 3: flags live
there; `circle?: boolean` already exists for the plan and should be folded into
this). `geometry.ts` gains circle-vs-OBB overlap / gap / ray — all closed-form.

Removes the 27% over-estimate on round tables, ottomans and round rugs, and stops
their phantom corners from fighting chairs that really do tuck in.

**Tests:** `tests/geometry.test.ts` — circle/OBB cases against analytic answers.

---

## Phase 3 — Real lights · **S–M** · makes "relight" true

> **Done.** `lib/light-units.ts` (+ 11 tests), `PartLight` on `ScenePart` with
> per-shape defaults and `lightFor` / `isLightFixture` (+ 5 tests),
> `components/three/PartLight.tsx` with the shadow budget, an Inspector section
> that edits lumens and colour temperature, and the Evening rebalance.
>
> One thing the plan did not anticipate: **`SURFACE.fabric` was not reaching the
> sofa.** Upholstered bodies are built from `Box`, which took a bare `roughness`
> number and no surface preset, so sheen alone would have changed only lamp shades
> and curtains. `Box` now takes a named `surface`, and picks
> `meshPhysicalMaterial` itself when the preset needs it — see 5a.

### 3.1 Declare light on the part — `lib/scene-spec.ts`

```ts
light?: { lumens: number; kelvin: number; coneDeg?: number }
```

Defaults per shape (`lamp-floor`, `lamp-table`, `lamp-pendant`, and later
`window`). Single source of truth, per rule 3.

### 3.2 `lib/light-units.ts` *(new, pure)*

```
isotropic point:  cd = lm / (4π)                       # 800 lm → 63.7 cd
spot (cone 2θ):   cd = lm / (2π(1 − cos θ))
colour:           CCT (K) → Planckian locus → CIE xy → sRGB
```

three has been physically-correct since r155 (`useLegacyLights` removed by
r169): point/spot intensity is in **candela**, `decay = 2`. So these conversions
are the real interface, not a fudge factor.

**Tests:** `tests/light-units.test.ts` — known conversions; 6500 K lands near
white, 2700 K clearly warm, monotonic hue shift across the range.

### 3.3 Emit — `components/three/DynamicPart.tsx`

Lamp shapes render an actual `pointLight` / `spotLight` alongside the existing
emissive shell. Keep the emissive material: it is what makes the fixture *look*
on, and `Draggable`'s `FinishApplier` already protects emissive materials from
finish overrides (`Draggable.tsx:110`).

**Shadow budget — the one real risk.** A shadow-casting `pointLight` is a cube
map: six renders per light per bake. A `spotLight` is one.

- Pendants and directional fixtures → `spotLight`, may cast.
- Table and floor lamps → `pointLight`, **never** cast.
- Hard cap: 2 shadow-casting lights, chosen by lumens; the rest are shadowless.
- Whole feature gated to `quality === 'high'`, matching how AO and cast shadows
  already gate.

`frameloop="demand"` is unaffected — lights are declarative, so R3F invalidates
on change like everything else.

### 3.4 Rebalance the moods — `components/three/Room.tsx`

`LIGHTING.evening` must drop its hemisphere and key contribution enough that
lamps *matter*. Today evening is a dark filter; after this it should be a dark
room that lamps light. Day and cool stay close to current values.

**Docs:** `Design.md` §5 "Lighting, realism & motion" — currently says moods and
quality gates; needs the light model and the shadow budget.

---

## Phase 4 — Openings, then the sun

> **Both done.** `lib/apertures.ts` (+ 13 tests) turns wall-mounted `window` /
> `door` parts into rectangles in each wall's own 2D frame; `RoomShell` builds each
> wall as a `Shape` with a hole per opening. `lib/solar.ts` (+ 14 tests) is the
> NOAA position, and a fourth lighting mood drives the key light from it.
>
> Four things the plan did not anticipate:
>
> · **Skirting cannot be cut with a hole.** A door opening spans the whole 100 mm
>   strip, so the hole touches the outline top *and* bottom and leaves Earcut two
>   degenerate slivers. `skirtingRuns` splits the strip into the stretches between
>   openings instead, which is both simpler and exactly right.
> · **A door's opening is a degenerate hole too.** It stands on the floor and the
>   wall starts at the floor, so the edges are coincident. The OPENING is clamped
>   2 cm inside the outline — the door part keeps its real 2100 mm, and what shrinks
>   is the hole behind it.
> · **The shadow frustum had to become direction-aware.** `THROW_PER_M` was a
>   constant derived from the studio key's fixed position; a sun near the horizon
>   throws shadows an order of magnitude longer. It is now computed from the light
>   direction and capped, and the shadow camera's `far` follows the fitted distance
>   instead of a hard-coded 30.
> · **Latitude belongs to the room, the moment belongs to the device.** A flat and
>   a holiday cottage do not share a latitude, so `Site` went on `RoomData`
>   (additive — `RoomSync` writes it, `loadFromRoom` reads it). The date and time
>   being *asked about* are a question, not a property of the furniture, so they sit
>   in studio prefs.
>
> One thing the plan got wrong: it proposed prefilling latitude, longitude and
> bearing **from EXIF**. `lib/exif.ts` deliberately does not read GPS — the reason
> is recorded in Design.md §3 and has not changed — so these are typed in, with the
> default visible on screen rather than hidden.

### 4a Windows and doors as real apertures · **M**

Walls are already `planeGeometry` per footprint edge (`RoomShell.tsx:151`).
`THREE.Shape` supports `.holes` and `ShapeGeometry` triangulates them via
Earcut — **no CSG library needed**.

- Map each wall-mounted `window` / `door` part to its footprint edge —
  `nearestEdge` in `geometry.ts` already does this.
- Build each wall as a `Shape` with a hole per aperture, in wall-local
  coordinates.
- Preserve what the current wall does: inward-facing single-sided plane so the
  near wall back-face culls, click-to-select, per-edge paint from
  `room.wallColors`, and the skirting.

**Risk:** touches wall selection and painting, which are load-bearing UI. Land it
behind the existing wall-selection tests plus new geometry tests, and verify the
back-face culling behaviour survives — that trick is what makes the dollhouse
view work at all.

### 4b Sun path · **M** · the differentiating feature

`lib/solar.ts` *(new, pure)* — NOAA solar position: declination, equation of
time, hour angle → altitude and azimuth. ~150 lines, accurate to ~0.01°, no
model, no network. Pure astronomy sits on the correct side of the trust boundary.

Inputs: latitude/longitude, date, time, and the room's north bearing. **EXIF can
prefill all three** from Phase 1.1 (`GPSLatitude`, `GPSLongitude`,
`GPSImgDirection`) — behind explicit consent, and never transmitted.

Key light direction derives from the sun when the daylight mood is active.
Sunbeams through the Phase 4a apertures then come free from the existing shadow
map. Daylight metrics (Daylight Factor, Useful Daylight Illuminance) can be
reported in the `ClearanceIssue` shape the room report already uses.

**Tests:** `tests/solar.test.ts` — altitude/azimuth against published almanac
values for a few known dates, locations and times, including a solstice and an
equinox.

---

## Phase 5 — Materials and stack

### 5a Sheen on fabric · **S** · best realism per line changed

> **Done**, but not where the plan expected. The preset needed a route to the
> upholstery first: `Box` gained a `surface` prop taken by NAME, so a call site
> cannot pair a physical-only preset with `meshStandardMaterial` — three drops
> unknown properties silently, and the surface would have gone on looking exactly
> as flat as before with nothing to show it had failed. `PHYSICAL_SURFACES` in
> `materials.ts` is the list that decides the element. Sofa and armchair bodies
> now carry it; `FinishApplier` still round-trips because `MeshPhysicalMaterial`
> extends `MeshStandardMaterial`, and sheen survives every finish.

`components/three/materials.ts` — promote `SURFACE.fabric` to
`meshPhysicalMaterial` with `sheen` / `sheenRoughness` / `sheenColor`.
Upholstery is the most-looked-at surface in the app and currently reads as matte
plastic. `clearcoat` for lacquered casework follows; `transmission` for glass
tabletops is expensive (it renders a backbuffer) — gate it to `high` or skip.

Check `Draggable`'s `FinishApplier` still round-trips: it caches originals for
the "Auto" restore, and it must learn about the new properties or it will fail to
restore them.

### 5b three r169 → r18x · **M**

WebGL path unchanged; picks up the r184 fix for per-frame allocation (240k–500k
objects/sec at 1000 meshes / 60 fps). `@react-three/postprocessing` keeps working.

`tests/react-3d-peers.test.ts` currently guards react↔fiber; extend it to cover
three↔drei↔fiber so this pairing cannot drift either.

### 5c `BatchedMesh`, then WebGPU · **L**

Danmu already instances *within* a part (book spines, curtain pleats, radiator
fins — `Box.tsx`). The remaining cost is *across* parts: a 30-piece room is
several hundred draw calls of near-identical rounded boxes. `BatchedMesh`
(r166+) collapses those.

Only then evaluate `WebGPURenderer` + TSL, which unlocks `ssgi()` and native
`ao()` — but requires replacing the `N8AO` + `SMAA` stack. Keep WebGL as
fallback; the quality toggle already models tiers, so a third is natural.

### 5d OKLCH tokens · **M** · independent

Move `app/globals.css` to OKLCH; generate `lib/themes.ts` harmonies by rotating
hue at constant L and C so no theme can produce an unreadable room. Then derive
`lib/scene-palette.ts`'s `defaultBodyColor` (constant L per material family, hue
per category) instead of hand-listing 22 categories and guarding with a test.

---

## Phase 6 — Layout suggestions · **M–L** · needs Phase 2

Merrell et al. (SIGGRAPH 2011) as pure optimisation — no model, no download.

- `lib/layout-score.ts` — the clearance rules restated as **costs** rather than
  checks, plus alignment, balance and conversation-grouping terms.
- `lib/layout-solve.ts` — seeded simulated annealing over `(x, z, yaw)` of
  **unlocked** parts only. Deterministic per seed, matching the pattern
  `Dressing.tsx` already uses for decor.
- Hierarchical, per Infinigen Indoors: large furniture settles before small.
- **Never touches `dimMM`.** The solver moves and turns; it does not resize.
  That is what keeps it inside the trust boundary.
- UI: suggest → preview → accept/reject, through the existing history stack.

Measure before threading a worker; ~30 parts may well be fast enough inline.

---

## Phase 7 — Spikes · parallel, measure before committing

### 7a Metric depth for the missing axis

Front-to-back depth is the one quantity no metadata and no single wall photo can
provide. A small metric-depth ONNX model (ViT-S class, ~100 MB) would close it,
delivered exactly as the detector already is: HEAD-probe local → HF mirror,
digest-pinned in `MODEL_DIGESTS`, WebGPU execution provider, AGPL/licence fence
respected.

Measure first: size, latency on the existing 4-photo test room, and accuracy
against tape-measured ground truth. Output enters as a **hint** through
`clampDims` — same boundary as detection, no exceptions.

### 7b RF-DETR benchmark

Re-run the existing 19-object benchmark against RF-DETR. Apache-2.0 is the prize,
not the mAP: it could be **bundled**, which deletes the whole AGPL fence
(separate HF repo, runtime fetch, no redistribution) documented in `Design.md`
§9. Compare on the same table so the numbers stay honest.

Also worth measuring on the current stack: fp16 weights and ORT **io-binding** on
the WebGPU path, which usually cut the 10-passes-per-photo cost without touching
recall.

---

## Suggested sequencing

| Sprint | Contents | Outcome |
|---|---|---|
| 1 | Phase 0 (all three) | Faster, more honest, one privacy hole closed |
| 2 | Phase 1.1–1.5, 1.7 | Sizes become measured instead of assumed |
| 3 | Phase 3 + Phase 5a | The room lights and the sofa looks like cloth |
| 4 | Phase 2a | Circulation, reachability, accessibility |
| 5 | Phase 4a → 4b | Apertures, then the sun |
| 6 | Phase 5b, 2b, 1.6 | Stack currency, round footprints, VP calibration |
| 7 | Phase 6 · spikes 7a/7b in parallel | Suggestions; decide on depth and detector |

---

## Cross-cutting rules for every phase

1. **`pnpm typecheck` after non-trivial edits**; add Vitest coverage for any new
   pure logic in `lib/`.
2. **New pure modules go in the node environment.** Only opt into jsdom
   per-file, as `storage*.test.ts` and `history.test.ts` do.
3. **Any saved field goes in both directions of its codec.** The
   `toRecord`/`fromRecord` pair exists because a hand-written read and a
   hand-written write drifted and silently dropped a geometry pass.
4. **No literal hex in a renderer** for anything the user can recolour — it goes
   through `lib/scene-palette.ts`, which is hand-synced to the tokens and guarded
   by a test.
5. **No dimension is ever set by a model.** Every new size source in this plan —
   EXIF, vanishing points, depth model — is a hint that passes through
   `clampDims`.
6. **When something does not fit, say so.** Never silently resize.
7. **Update `Design.md`** in the same PR that changes architecture, routes,
   stores, or the AI/geometry boundary.

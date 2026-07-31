# Danmu — Design & Architecture

> Last updated: 2026-07-31 · reflects the codebase on `main`.
> Canonical design doc. Supersedes the older `DOCUMENTATION.md`.

Danmu is a **local-first interior decoration simulation**. You pick a footprint
(or capture a real room with photos), Danmu rebuilds it as a scaled 1:1 3D space,
and you redecorate freely — place, move, recolour, restyle, relight, and arrange
furniture. Everything runs in the browser. There is **no backend and no account**.

The 3D studio *is* the product. AI is optional and used **only to detect
furniture from photos** — never to generate images. Dimensions and placement are
owned by a deterministic geometry engine, not by a model.

---

## 1. Product principles

1. **Local-first, no backend.** Room data lives in IndexedDB; settings + the
   optional API key live in localStorage. Nothing leaves the browser except one
   optional, direct call to the Gemini API (BYO key) during photo detection.
2. **AI is optional and detection-only.** There is **no image generation** in the
   product — the old "realize / render / compose / compare / share" photoreal
   pipeline was deleted permanently. Do **not** reintroduce AI rendering, model
   names, costs, or quota language into the user-facing UI. If detection is
   unavailable, the studio still works — pick a footprint and decorate.
3. **Dimensions are trustworthy because they are code, not AI.** Sizes are always
   clamped by `lib/dimension-ranges.ts` (`clampDims`); the AI's size guess is a
   *hint* only. A deterministic geometry engine owns placement, real-world sizing,
   overlap, and clearance. This is the core value: you can plan a real room around
   the result.
4. **Single source of truth for furniture.** Shapes, catalog, geometry params and
   behaviour flags come from `lib/scene-spec.ts` (+ `lib/parts-catalog.ts`). The
   3D scene, 2D plan, inspector tree, catalog and decor all read from it.
5. **No hard-coded design values.** Colours / spacing / type flow through tokens
   in `app/globals.css`; Tailwind reads them.
6. **Warm & playful visual direction.** Cream paper, terracotta (`--accent`) +
   sage (`--accent-2`) accents, Nunito (sans) / Fraunces (display) type, generous
   rounding. Matches the soft procedural 3D models.

---

## 2. User journey

```
/                         entry router → onboarding (no rooms) or workspace
└─ /onboarding
   ├─ /welcome            intro + "Start decorating"; optional BYO key (collapsed)
   ├─ /layout-pick        pick footprint preset → sets width/depth + starter scene
   ├─ /capture            4-wall guided capture (getUserMedia)
   └─ /detect             furniture detection on captured photos
/workspace                rooms list — create / resume / delete
/room/[roomId]
   ├─ /model              ★ 3D decoration studio (default landing)
   └─ /plan               2D top-down floor plan
/settings                 API key, display unit, danger zone
```

Two ways in:

1. **Quick start** — pick a footprint, skip capture, land straight in the studio
   with a contextual starter scene. Zero credentials.
2. **Capture flow** — footprint → photograph room → detect furniture → studio.

There are **only two studio tabs**: `3D Model` and `2D Plan` (`StudioTabs.tsx`).

Capture is **four wall photos**, not six — `CAPTURE_SLOTS` in `lib/capture.ts` is
the four walls in clockwise order; floor and ceiling were dropped. The slots are
labelled relationally ("Wall 1 · start anywhere", "Wall 2 · turn right") while
keeping `n`/`e`/`s`/`w` as the internal ids the geometry and storage depend on —
compass bearings asked the user a question they cannot answer in their own
living room, and the engine only needs four *consecutive* walls.

---

## 3. Detection (the only AI, optional)

> Detection is the app's **only** egress. The optional Gemini path sends the
> wall photos to Google; the local ONNX path does not. The UI must say which
> one is happening at the moment it happens — a privacy promise displayed
> during an upload is the one bug class this section exists to prevent.
>
> What leaves is **pixels only**. `normalizePhoto` strips EXIF / XMP / IPTC
> before a photo is stored or sent (`lib/jpeg-strip.ts`), because a phone writes
> `GPSLatitude` / `GPSLongitude` into a photo taken at home and the promise above
> is about the room, not the address. The re-encode path drops metadata as a side
> effect; the passthrough path — a JPEG already under the size cap, kept
> unchanged so it does not lose quality for nothing — is the one that needed the
> explicit strip, and is where the coordinates used to survive.

Furniture detection runs through a fallback chain, best-effort:

1. **Local detector** — `lib/local-detect.ts`, via `onnxruntime-web`. No key, no
   quota, no network after the first model download. The models (~64 MB total)
   are **not bundled** and are git-ignored; `resolveBase()` HEAD-probes two
   sources in order:
   `public/models/` (produced by `python scripts/export-detector.py`, needs
   `pip install ultralytics`) then the Hugging Face mirror
   [`DearthAI/danmu-detector`](https://huggingface.co/DearthAI/danmu-detector),
   so a fresh clone works without a Python + torch toolchain. Both are static
   GETs of a public file — no user data leaves the device.

   Each photo is run **five times** — whole frame plus 2×2 tiles at 15% overlap
   — and merged with a single NMS in normalized whole-image space. Letterboxing
   a 2000px wall photo to 640 shrinks mid-sized objects below what nano
   resolves; tiling recovers them for zero extra download.

   **Two models run as an ensemble** — `yolov8n-oiv7` (14 MB, 601 fixed Open
   Images classes) and `yolov8s-worldv2-danmu` (50 MB, open-vocabulary with
   Danmu's 44 furniture prompts frozen into the graph by `set_classes()` at
   export). They fail on disjoint classes: OIV7 owns monitors and windows, the
   world model owns fridges / ceiling fans / wardrobes / lamps / curtains. Both
   feed one pool of candidates in normalized space, resolved by a single NMS.

   `resolveFile()` resolves each file's source **independently** — a clone that
   ran the pre-ensemble export script has only the OIV7 model locally, and picks
   the world model up from the mirror rather than silently losing half its
   recall. Only when neither source has it does detection fall back to the OIV7
   model alone.

   **Measured on a real 4-photo room** (19 catalogued objects), so don't
   re-litigate this without new numbers:

   | config | size | whole frame | 2×2 tiled |
   |---|---|---|---|
   | yolov8n-oiv7 | 14 MB | 4/19 | 7/19 |
   | yolov8s-oiv7 | 46 MB | 4/19 | 7/19 |
   | yolov8m-oiv7 | 105 MB | 6/19 | 7/19 |
   | yolov8x-oiv7 | 275 MB | 7/19 | 7/19 |
   | yolov8s-worldv2 | 50 MB | 7/19 | 10/19 |
   | **oiv7-n + worldv2-s (shipped)** | **64 MB** | — | **13/19** |
   | rfdetr-base (Apache-2.0, COCO-80) | 108 MB | — | 6/19 |

   Two findings worth keeping:

   - **Scaling OIV7 does nothing.** Every variant converges on 7/19; `x` is 19×
     the bytes of `n` for identical recall. Input resolution binds, not model
     capacity — hence tiling.
   - **The remaining gap was vocabulary, not capacity.** Curtain / ceiling fan /
     fridge / wardrobe class heads peak at 0.002–0.03 on this imagery against
     0.38–0.44 for classes that fire, at *every* OIV7 size. An open-vocabulary
     model prompted with those words in plain language finds them.
   - **RF-DETR is a better detector and a worse fit, and the reason is the same
     one.** Measured 2026-07-30 on the same room and the same 5-crop tiling
     (`onnx-community/rfdetr_base-ONNX`, 560², ImageNet normalisation, sigmoid +
     no NMS). On the classes it *has* it beats the shipped ensemble outright —
     refrigerator 94% against 86%, bed 94%, monitor 92%, laptop 92%, and it is
     the only configuration ever measured here that finds the **keyboard**. But
     COCO-80 has no word for door, window, curtain, wardrobe, ceiling fan, lamp,
     desk, shelf, shoe rack or clothes rail, which is thirteen of this room's
     nineteen objects. It scores **6/19**, and the six are exactly COCO's
     household nouns. Its other detections are real objects Danmu has no use for
     — handbag, backpack, suitcase, book, tie, mouse.

     So **the licence prize is not reachable by substitution.** Apache-2.0 would
     delete the AGPL fence only if RF-DETR replaced *both* current models, and
     the model it cannot replace is `worldv2`, which is where the open-vocabulary
     half of 13/19 comes from. Swapping it for the OIV7 model instead is
     defensible on the merits — better precision, Apache-2.0, and OIV7 already
     earns just one object for double the passes — but the fence stays up as long
     as `worldv2` ships, so that trade buys accuracy, not licence freedom.

   Confidence stays at 0.35: dropping to 0.20 buys one object and adds a
   spurious `sofa(0.29)`. Still missed at 13/19 — doors, wall art, and the
   curtain in one photo. The local pass is a head start, not a replacement for
   Gemini.

   **Verified in a real browser**, not only against a reference implementation:
   Chromium reproduces 13/19 exactly, every box in range. Cost is dominated by
   inference count (5 crops × 2 models = 10 passes/photo):

   **Re-verified 2026-07-30** on the same room, driving the shipped path (capture
   screen → the detect screen's own auto-run) in headless Chromium with no API
   key, so this is the local ensemble alone. 32 raw detections across the four
   walls, and scored two ways:

   - **13/19 correctly categorised** — the table's figure, unchanged.
   - **17/19 localised**: a box lands on the object but carries the wrong label.
     Only the keyboard and the small wall painting get no box at all.

   The gap between those two numbers is the honest description of what this model
   does badly, and it is worth writing down because "missed" and "mislabelled"
   need different fixes. A curtain came back as `Bed (40%)`, the ceiling fan as
   `Lamp (40%)`, the two garment rails as `Wardrobe (72 / 75 / 38%)`, and the
   wooden ledge behind the bed as `Desk (37%)`. Every one of those is a real
   object found in the right place and filed under the wrong word — a vocabulary
   failure, exactly like the recall gap that motivated the open-vocabulary second
   model in the first place. There were also two clean false positives: the
   `Multipurpose Hanger` cardboard box read as a `Picture frame` on both walls it
   appears in, and a bare ceiling hook as a `Ceiling fan (47%)`.

   The benchmark photos are **not in this repo** and should not be added — they
   are photographs of somebody's bedroom, and this repo is public. Point the
   harness at them wherever they live.

   | environment | per photo |
   |---|---|
   | Chrome + WebGPU | ~4.8 s |
   | headless, WASM single-thread | ~12–25 s |

   WASM runs single-threaded because threading needs `SharedArrayBuffer`, which
   needs cross-origin isolation (COOP/COEP) we do not send — and enabling it
   would break the cross-origin ort and model fetches. WebGPU is the fast path;
   WASM is the floor.

   If that cost ever needs cutting, the measured curve is:

   | config | passes | recall |
   |---|---|---|
   | both whole-frame | 2 | 9/19 |
   | world tiled only | 5 | 12/19 |
   | both tiled (current) | 10 | 13/19 |

   The OIV7 model earns exactly one object for double the passes and +14 MB.
   Dropping it is the obvious lever if detection ever feels too slow.

   **Licence boundary:** the weights are AGPL-3.0 (Ultralytics) and Danmu is
   MIT. AGPL is copyleft, so the two cannot be mixed — the weights therefore
   live in their own AGPL-licensed HF repo and are fetched at runtime, never
   committed or redistributed from here. GitHub Release hosting was tried and
   rejected: release assets redirect to a storage host with no
   `access-control-allow-origin`, so browsers block them (curl does not, which
   makes this easy to mis-verify).
2. **Gemini fallback** — `lib/detection.ts`: one multimodal `@google/genai` call
   over all wall photos at once (so it can reason about object continuity across
   walls). BYO key; quota tracked in `lib/quota.ts`. Key validated by
   `lib/validate-key.ts`.
3. **Manual boxes** — `PhotoEditor.tsx`: lock / delete / add-box by hand when no
   detector is available.

Detection returns labels + boxes only. The **geometry engine derives real sizes
and positions** — see §4.

> Note: `@huggingface/inference` and `clsx` were removed in the cleanup — both
> were dead leftovers from the deleted render pipeline.

---

## 4. The geometry engine (deterministic, no AI)

This is what makes Danmu trustworthy. All pure math, all covered by tests.

| File | Role |
|---|---|
| `lib/geometry.ts` | Oriented rectangles (OBB) in the XZ plane; separating-axis overlap, gaps, face clearance, point-in-poly, nearest-edge. Also `Foot` — a footprint that may be **round**, meaning the ellipse inscribed in the OBB (a true circle when W = D, which is how round parts are authored, and the ellipse the renderer draws if an axis is scaled). A circle's bounding square is 27% bigger than the circle and all of it is in the corners, which is where the chairs go; `collidesAt` used to refuse a chair tucked diagonally under a round table for corners the table does not have. Containment is the exact closed form; two true circles use the closed-form lens area, and anything else round uses an inscribed 32-gon (99.4% of the area — inscribed on purpose, so a round piece is never reported as hitting what it does not touch). **One rotation convention, and it is three.js's:** `rot` is what the renderer assigns to `rotation.y`, so a part's front (local +Z) is `(sin rot, cos rot)`. Rotating the other way is invisible at 0°/180° and inverts every directional answer on the side walls — it was reporting "doors can't open" on wardrobes correctly snapped to the east and west walls. `localToWorld` / `worldToLocal` / `frontVector` are the shared helpers, pinned against three's own `Euler` by a test. |
| `lib/photo-geometry.ts` | Pinhole camera at room centre + entered room dims → ray/plane intersection gives real position + W/H from any bbox. `CameraCal` carries the lens (`k`), and optionally the camera's `height` and `tiltRad`; absent values fall back to 1.5 m and level, which is what it always assumed. Tilt matters: 5° of ordinary handheld droop mis-reads distance by ~20%. |
| `lib/exif.ts` | Reads the camera fields a photo carries about itself — 35 mm-equivalent focal length (→ `hfovFromFocal35`), orientation, compass bearing. Pure byte parsing; browsers expose no EXIF API. **Does not read GPS coordinates**, deliberately: nothing needs them, and moving them from the file into IndexedDB would relocate the exposure rather than remove it. |
| `lib/device-tilt.ts` | Lens tilt at the shutter from `deviceorientation`, for the live-camera path only (EXIF has no tilt field). Reports a tilt only for an upright, unrolled phone — a wrong tilt is worse than none, since "none" is the level camera the engine already assumed. |
| `lib/physics.ts` | Gravity/anchor rules — where a part sits (floor / ceiling / wall-mid / …), wall affinity + snap, support-under lookup for tabletop-prone items. |
| `lib/layout-rules.ts` | **What each piece needs from the room, as geometry** — and the one table both the checker and the solver read. Roles (what a piece is *for*, which the catalog's shapes cannot say: `coffee-table` is used for both a 900 mm side table and an 1800 mm dining table, so height decides), access zones per functional side, functional relations between pairs, the room's own profile, and the route width the room is big enough to be asked for. Every number is derived from the piece it is about — a zone's depth is what the *activity* needs, its width comes from `dimMM`, and it lives in the piece's local frame — so resizing anything recalibrates by construction. |
| `lib/clearance.ts` | Ergonomics checker over exact geometry: walkways, functional zones (storage fronts, bed sides, a table's seats, a desk's chair), door swings **and the route in from them**, windows kept unblocked, clashes, reachability, over-height. Every threshold comes from `layout-rules`; nothing is written twice — including `belongTogether`, which keeps the walkway rule off a pair the relation table put together: 450 mm between a sofa and its own coffee table is the figure the table asks for, and reporting it made the panel cry wolf about every correct living room (the solver's circulation term skips the same pairs). Reproducible findings, no AI. |
| `lib/apertures.ts` | Turns wall-mounted `window` / `door` parts into rectangles in each wall's own 2D frame, which is all `THREE.Shape` needs to punch a hole (`Shape.holes` + Earcut — no CSG library). Pure, because the wall-local conversion is the part that goes wrong invisibly: get the tangent backwards and every opening mirrors about the middle of its wall. |
| `lib/layout-score.ts` / `lib/layout-solve.ts` | `layout-rules` restated as **costs** rather than checks — collisions, doors and their approach, functional zones, windows, walkways, wall affinity, relations, alignment, balance — plus **inertia**, which charges for movement so a piece only moves if moving it buys something, and **navigability** over the clearance field for the handful of finalists. Then seeded simulated annealing over `(x, z, yaw)` of the unlocked pieces, with proposals that know the room's structure (snap to a wall, park beside the thing you belong to, face the screen, swap two pieces). Deterministic per seed; `mode: 'refit'` turns the inertia up to repair a layout after a resize rather than reinvent it. **Never writes `dimMM`** — it moves and turns, and the type it works in has no field a size could travel in. |
| `lib/solar.ts` | NOAA / Meeus solar position — declination, equation of time, hour angle → altitude and azimuth, ~0.01°. No model, no network, no data file: pure astronomy, which is the one thing in this app a model could not do better. |
| `lib/clearance-field.ts` | Circulation as a **field** rather than a list of pairs — see below. One 5 cm raster of the floor plus an exact Euclidean distance transform answers walkway width, reachability, turning space and crowding at once, and it also carries WHICH obstacle is nearest so a finding can name the pieces to select. |
| `lib/dimension-ranges.ts` | `clampDims` — per-item sizing tiers (fixed / standard / flexible). **All sizes pass through this.** |
| `lib/footprint.ts` | Footprint polygon math (preset shapes, containment, `offsetWall` / `wallOutwardNormal` for wall moves). The polygon — not `width`/`depth` — is the source of truth for room shape. |
| `lib/wall-move.ts` + `lib/wall-actions.ts` | Moving a wall takes its furniture with it. The first is pure (who is attached, where they land); the second is the single action every wall-mover calls, spanning both stores. |
| `lib/room-bays.ts` | **Where in the room there is actually room.** The footprint's maximal axis-aligned rectangles of real floor, largest first, plus each bay's sides (which of them are real walls, how deep the bay runs from each) and `splitBay` for putting two groups in one rectangle. Exact for rectilinear rooms — the candidate grid is the polygon's own vertex coordinates — and conservative for anything with a diagonal wall, since a candidate is only returned once it has been proved inside. This exists because arranging furniture against the polygon's *bounding box* furnished the quadrant an L / T / U cuts away: the starter scene put five of the L-shape's nine pieces outside the house. |
| `lib/layout-settle.ts` | The guarantee both scene paths end on: nothing outside the room, nothing inside anything else. Containment pushes a piece in by its own half-extent along the wall it overhangs (clamping the *centre* leaves a 2.2 m sofa half in the garden), then clashing pairs are separated smaller-piece-first using the room report's own clash bar, `sharesFloor` and rug exemptions. Cheap and deterministic on purpose — it runs on every room open, where the annealer has no business. It never resizes, never moves a wall-mounted piece, and when a room is genuinely too full it leaves the piece where it was for `clearance.ts` to report. |

On the detect page, `geoRefine` runs the geometry engine over **every** detection
and manual box: geometry overrides AI dims/position; the AI contributes only
label / category / a depth hint.

### Circulation is a field, not a list of pairs

Comparing furniture two at a time answers "is there a gap between these" and
nothing else. It cannot see a walkway pinched between a sofa and a **wall**,
because a wall is not a part; and it cannot see that every individual gap passes
while the room is still severed in two, because being able to walk somewhere is a
property of the whole floor.

`lib/clearance-field.ts` rasterises the footprint at 5 cm, marks the cells
furniture stands on, and runs Felzenszwalb & Huttenlocher's exact squared
Euclidean distance transform over the rest — O(cells), two 1D lower-envelope
passes, no iteration count to tune. It is extended to carry the **index of the
winning source**, so each free cell knows not only how far away the nearest
obstacle is but which one it is. One raster then answers four questions:

| Question | Read from the field |
|---|---|
| Walkway width, including against a wall | the two cells straddling the medial axis between two owners |
| Can you reach this piece from the door? | is any walkable cell around it in the door's connected component |
| Wheelchair turning space | 2 × the largest value anywhere reachable (1500 mm) |
| Crowding | free-cell share — the old metric, now a by-product |

**Every reading is quantised, and the rules are written knowing it.** A cell
centre is up to half a cell from the surface it measures, so `gapTolerance`
publishes the error bound (1.5 cells, pinned by a test over random rotations) and
a finding is raised only when the *whole* ± band sits on the wrong side of the
threshold. Under-reporting a gap would invent warnings, which is the one failure
mode this panel cannot afford.

Two deliberate silences: gaps against a wall are measured but **not** reported as
tight walkways, because "the sofa is 40 cm off the wall" is usually a description
of the room rather than a fault — a wall gap that matters is one that pinches the
only route, and that surfaces as reachability instead. And reachability says
nothing at all when the room has no door, since which side someone arrives from
is then unknowable.

The 2D plan draws the same raster (`fieldRuns` collapses it to a few hundred
horizontal runs, so it stays SVG that reads the design tokens rather than a canvas
needing its own palette). It used to approximate the walkway rule by inflating
each bulky piece by half of 600 mm, with the threshold and category list copied
out of `clearance.ts` and a comment asking that they be kept in step.

### The calibration ladder

`buildCals` (detect page) resolves one `CameraCal` per photo. The wall-floor line
ties focal length, camera height and tilt together in **one** equation, so it can
solve for exactly one unknown — which one depends on what the photo already told
us:

| What the photo carries | Floor line solves for | Notes |
|---|---|---|
| EXIF focal length | **camera height** | The lens is known, so the 1.5 m guess (±17% on everything) becomes a measurement. |
| its own perspective | **camera height** | `lib/vanishing-point.ts` reads the lens out of the geometry — see below. |
| nothing | **focal length** | The original path, assuming 1.5 m. Still correct, no longer the only one. |
| neither, or no floor line | — | A typical phone lens (66°), and the room is measured as it always was. |

**The middle rung is for photos that arrive with nothing.** A room is a box: three
families of parallel lines, mutually perpendicular. With the principal point at
the image centre, two vanishing points in perpendicular directions give the focal
length in closed form (`k² = −1/(X₁X₂ + Y₁Y₂)` in the tangent space this module
already uses), and the vertical one gives the tilt. `lib/vanishing-point.ts` finds
the segments with a cut-down LSD — gradient, grow regions of like-oriented pixels,
take each region's principal axis — then chooses the orthogonal PAIR by how well
the whole frame it implies explains the whole image.

That last part is load-bearing and was learned the hard way. Picking the strongest
vanishing point, then the strongest of what remains, is unstable: a hypothesis
straddling two families scores well, consumes segments from both, and a pixel and
a half of noise flipped a synthetic room from 75° to 21°. Scoring the pair by its
own support is no better, because straddling is exactly what earns support.
Scoring by frame coverage — two directions fix the third by cross product, and a
real box has segments along all three — is stable across 0 to 5 px of noise.

**Coverage is also the gate.** At four resolutions every correct answer explained
100% of the segments and the single wrong one explained 47%, so a frame that
leaves half the straight lines in a photograph unaccounted for is refused. The
other bound is resolution: 1600 px recovers 78.0° against a truth of 78°, 1200 px
gives 77.8°, and 800 px is correctly refused because the edge fragments are too
short for their angles to mean anything. `normalizePhoto` caps the long edge at
1600, so real input lands where this was measured.

Tilt is never solved for from the floor line — one equation cannot give two
unknowns. It comes from `lib/device-tilt.ts` at capture time, or from the
vanishing points, or not at all; a measured device tilt outranks an inferred one. Camera height is asked
for on the capture screen (`useSettings.camHeightM`, remembered per person since
it is a property of the shooter, not the room) and written onto each photo's
`CapturePose` as it is saved.

Which term the assumed values hurt is not uniform, and it is worth knowing before
tuning any of this: for a **floor-standing** piece the lens cancels out of the size
(distance scales as 1/k, angular size as k) and only its *position* moves; for a
**wall-mounted** piece the distance is pinned to the wall, so the lens error lands
directly on the measured size — and conversely the camera height cancels out of
its W and H. See `tests/photo-geometry.test.ts`, which pins both.

---

## 5. The decoration studio

### Selection & transforms — `Pickable.tsx`, `Draggable.tsx`
- Click to select, drag to move, gizmo to rotate / scale (Maya-style modes;
  snap `off` / `fine` 1 cm·2.5° / `coarse` 5 cm·7.5°).
- Wall-mounted parts (TV, mirror, painting, AC, curtain) snap flush to the
  nearest wall on commit. New parts snap to the floor; small tabletop-prone items
  seek a supporting surface.
- **Double-click to open** drawers / doors (nightstand drawers slide, wardrobe
  doors swing per bay).

### Walls — `RoomShell.tsx`, `WallHandles.tsx`
- Click a wall (3D or 2D plan) to select it — mutually exclusive with part
  selection (`useStudio.selectedWall`). Shows a Wall panel in the Inspector.
- **Paint**: per-wall swatch / hex, or **Apply to all walls**. Stored per
  footprint-edge index in `room.wallColors`.
- **Move / resize**: drag the selected wall's handle (3D) or edge (plan). Only
  the selected wall moves — its edge translates along its outward normal
  (`footprint.offsetWall`), adjacent walls stretch, opposite wall stays. The
  footprint polygon becomes the source of truth; `width`/`depth` are re-derived
  from its bounds. Custom footprints persist on `RoomData.footprint`.
- **What the wall carries**: anything mounted **in** it (window, door, TV, mirror)
  or standing **against** it travels with it, by the same delta along the same
  normal. `lib/wall-move.ts` decides who is attached (`WALL_ATTACH_TOL` in
  `layout-rules.ts`) and where they land; `lib/wall-actions.ts` is the **only**
  entry point — all four movers (3D handle, plan handle, plan arrow keys,
  Inspector nudge) go through `moveWallCarrying`, and the positions it writes are
  `useStudio` overrides, because those are the layer that wins. Attachment is
  resolved **once per gesture**, never per frame. Pieces on the *adjacent* walls
  do not move: those edges stretch, they do not travel. A carried piece that
  would end up outside the room is left where it is and reported by
  `clearance.ts` — never resized, never shoved.

### Multi-select & grouping — `SelectionBar.tsx`
- Shift-click adds to `selection: string[]`. "Merge N" assigns a shared
  `groupId`; clicking any grouped part selects the whole group; group **move-as-
  one** on translate (rotate/scale-as-one is roadmap). "Ungroup" clears it.

### Recolour & finish — `Inspector.tsx`, `Draggable.tsx` `FinishApplier`
- One merged **Colour** section (24-swatch palette + hex). Separate **Finish**
  (Auto / Matte / Satin / Polished / Metal) — `FinishApplier` traverses the
  part's meshes and overrides roughness / metalness / envMapIntensity (caches
  originals for "Auto" restore, skips emissive materials). Real per-part physics.

### Procedural & parametric furniture — `DynamicPart.tsx`, `scene-spec.ts`
- Furniture is **procedural geometry, not imported models** — zero asset weight.
- **Parametric shapes** (sofa, curtain, wardrobe, closet, bookshelf, shoe-rack)
  rebuild from effective dimensions instead of stretching: sofa tiles seat
  modules from width, bookshelf derives shelves from height, wardrobe derives
  door bays from width, etc. The scale gizmo live-stretches; commit converts
  scale → dimension and the geometry redraws cleanly.
- **Local model library** — `LibraryPicker.tsx` + `lib/mesh-cache.ts` +
  `lib/shape-search.ts` (token + synonym + text-size parser). A part can point at
  a cached GLB via `meshHash` (CC0 library is a work in progress).

### Set-dressing & decor — `Dressing.tsx`
- Surface-capable parts carry props (books, vase, plant, bowl, candle),
  auto-suggested via a **seeded** generator (stable per part id) or user-managed
  as a per-part `decor` collection. Decor renders as a **sibling** of the part
  (reads transform from the store) so props keep true size on group-scaled parts,
  and opt out of raycasting so they never block selecting the furniture beneath.

### Lighting, realism & motion
- **Fixtures emit real light** (`components/three/PartLight.tsx`, `lib/light-units.ts`).
  A lamp carries `light?: { lumens, kelvin, coneDeg? }` on its `ScenePart`
  (defaults per shape in `scene-spec.ts`), and the Inspector edits it in those
  units. Intensity reaches three as **candela** — point and spot lights have been
  photometric since r155 — so a 400 lm bedside lamp is genuinely half an 800 lm
  floor lamp. Colour comes from the Planckian locus, so 2700 K is a warm bulb
  rather than an orange tint.
  Before this every "light" was an emissive material: the shade glowed and the
  room did not change, so Evening dimmed a room while the lamp standing in it
  contributed nothing.
  **Cost is bounded deliberately.** A shadow-casting point light is a cube map —
  six scene renders per bake — so only shaded downward fixtures (spot lights, one
  map) may cast, only on `high`, and only the two brightest in the room.
  `LIGHT_SCALE` re-bases candela into the scene's artistic exposure; the ratios
  between fixtures survive it, which is the part that matters.
- **Lighting moods** Day / Evening / Cool (`ViewOptions.tsx` → Room `LIGHTING`)
  set the **ambient** conditions only. Evening is deliberately low now — its job
  is to leave room for the fixtures rather than to be an orange filter over a
  fully-lit room, so a room with no lamps in it reads as genuinely dim there.
  Each mood carries an **`envMul`** that scales the `<Environment>` lightformers
  with it. Dimming the three lights and leaving the environment at full strength
  is not enough: every material has `envMapIntensity: 0.5`, so the environment
  supplies most of the light in the scene, and a nominally dark Evening still
  rendered as a fully-lit amber room. Both halves move together or neither does.
- **Sunlight is a fourth mood, and it is a measurement rather than a look.**
  Day / Evening / Cool are studio lighting; `Sun` asks `lib/solar.ts` where the sun
  actually is for this room's latitude, on a chosen date, at a chosen time, and
  points the key light there. Its colour comes off the same Planckian locus the
  lamps use (warm at the horizon, neutral overhead) and its strength falls with
  `sin(altitude)` — the first-order air-mass term, which is what makes a 7 am room
  read as 7 am. **When the sun is down there is no key light at all**, because that
  is the honest picture of 9 pm in December.
  Latitude, longitude and the room's compass bearing are stored **on the room**
  (`RoomData.site`): a flat and a holiday cottage do not share a latitude. The date
  and time being asked about are device prefs — a question, not a property of the
  furniture. Nothing is read from a photo; `lib/exif.ts` does not read GPS.
  **`Use my location` fills latitude and longitude from the device** on a press —
  never on mount, because an unprompted permission dialog is the fastest route to
  being denied one permanently. `lib/geolocate.ts` **coarsens the fix to one decimal
  place (~11 km) before it is stored**: across that distance the sun's altitude
  moves 0.1° and solar noon 24 seconds, both under the width of the sun's own disc,
  so the room keeps enough to be lit correctly and not enough to say which building
  it is in. High accuracy is never requested for the same reason. The fix goes to
  `RoomData.site` in IndexedDB and nowhere else — this is not egress, and the
  browser's location service is the only party that holds the precise position.
  The bearing is deliberately left alone: a fix says where the room is, not which
  way it points.
  **`Compass` reads the bearing off the phone's magnetometer** (`lib/compass.ts`),
  which is the last of the three facts nobody knows about their own living room.
  The gesture is defined so that no conversion is needed, and that is the point: a
  compass heading is clockwise from true north and describes the device's **top
  edge**, while `site.bearingDeg` is the true bearing of the plan's **up** direction
  (scene `-Z`) — so *aim the phone's top edge at the wall drawn at the top of the
  plan* makes the heading the bearing. A sign error here is invisible at 0° and 180°
  and inverts every side wall, the same trap `lib/geometry.ts` documents for
  rotations. Two APIs are needed: iOS's `webkitCompassHeading` behind
  `DeviceOrientationEvent.requestPermission()` (which must be reached synchronously
  from the tap), and `deviceorientationabsolute`'s `alpha` elsewhere — measured
  *counter*-clockwise from north, hence `360 - alpha`. A `deviceorientation` event
  **without** `absolute` is refused rather than used: it is relative to wherever the
  phone was when listening began, and would produce a confident wrong bearing.
  The reading is a ~1.4 s window averaged as unit vectors, not a single event —
  arithmetic on bearings averages 359° and 1° to 180°, the exact opposite answer —
  and the resultant length doubles as an agreement measure: below 0.6 the read is
  refused, above ~15° of circular spread the value is applied but reported as shaky,
  because a bearing taken next to a radiator looks identical to a good one on the
  dial. Snapped to 5°, which is the dial's step and about as far as a phone
  magnetometer should be believed.
  Both buttons needed `Permissions-Policy` changes in `next.config.mjs`:
  `geolocation=(self)`, and `accelerometer` / `gyroscope` / `magnetometer=(self)`
  (Chrome gates the orientation events on all three). `()` there overrides the
  user's own grant, so a feature and its header entry move together.
  **`Now` pins that moment to the device clock** (`sunLive`), and a ticker in `Room`
  advances it on the minute so the room stays lit by the light that is outside the
  window; scrubbing the day or picking a month unpins it, because the clock and the
  panel cannot both own the value. Off by default — the moment you want to look at is
  rarely the moment you opened the app, and a room asked about at 1 am is correctly
  black. Both directions of the local-clock ↔ UTC-instant conversion live together
  in `lib/solar.ts` (`localInstant` / `localClock`, and `daysInYear` so 31 December
  is reachable in a leap year), because they had already drifted apart: the panel's
  date label was formatted against a fixed non-leap year while the scene built its
  instant from the real one, so through a leap year the label read a day later than
  the light it described.
  **The controls are `SunControls.tsx`, and they show the answer rather than the
  parameters.** The day is drawn — sun altitude across 24 hours, night shaded,
  sunrise/sunset/solar-noon marked — from the same `sunPosition` the scene is lit
  by, sampled every 10 minutes and bisected to the minute at the horizon crossings,
  so the picture and the presets (`Sunrise` / `Noon` / `Golden` / `Sunset`, which
  are *this* place's real times) can never disagree with the light. A native
  `<input type="range">` lies over the graph with a transparent track (`.sun-scrub`),
  which is what keeps arrow keys, Home/End and a spoken value for free. The date is
  twelve month buttons rather than a 365-step slider — a sun path moves little
  within a month — and the compass bearing is a dial with the room square in the
  middle and the sun drawn where it actually is, because "which way does the room
  face" is a picture, not a number between 0 and 359. The dial is a real
  `role="slider"` with arrow keys, since pointing is otherwise a mouse-only gesture.
  The key light's shadow frustum is fitted per direction, not per room: a sun near
  the horizon throws shadows an order of magnitude longer than a studio light, so
  the throw-per-metre term is derived from the light vector and capped, and the
  shadow camera's `far` follows the fitted distance.
- **Windows and doors are holes in the wall**, not panels in front of it
  (`lib/apertures.ts` → `RoomShell`). Each wall is a `THREE.Shape` with one hole per
  opening; `ShapeGeometry` faces +Z exactly as the `planeGeometry` it replaced, so
  the near-wall back-face culling that makes the dollhouse view work is untouched.
  Skirting is not cut with a hole — a doorway spans the whole 100 mm strip, so the
  hole would touch the outline top and bottom and leave two degenerate slivers; it
  is split into the runs between openings instead. Openings are clamped 2 cm inside
  the wall outline, because a door standing on the floor of a wall that starts at
  the floor is the degenerate case for the triangulator. The **part** keeps its real
  size; the hole behind it is what shrinks.
- **Quality** High / Fast — gates procedural normal/roughness maps
  (`lib/textures.ts`, zero assets) + soft cast shadows + ambient occlusion
  (N8AO/SMAA mount on `high` only). There is no floor reflection.
- **Ground shadows** (`GroundShadows` in `Room.tsx`) are a drei `ContactShadows`
  bake, not a per-frame render — the scene is drawn into a depth target and
  blurred, which is far too expensive to repeat at 60fps for a room that is
  usually still. The pass therefore re-opens on a **window**: any committed
  change (parts, transforms, `hidden`, `dressed`, room shape) sets
  `frames={Infinity}` for ~300ms and `invalidate()`s each frame, because
  `frameloop="demand"` would otherwise leave the window open on a canvas that
  never paints. A single `frames={1}` bake is not enough: it is spent on the
  first frame after the re-render, which is not reliably the frame where the
  edit is on screen, and a deleted piece kept its shadow on an empty floor until
  some unrelated re-render happened to reopen the pass.
- **Idle micro-motion** (`Motion.tsx`): fan spins, plant sways, pendant swings.

### Studio chrome — where a control lives
The 3D canvas carries **three clusters and one transient bar**, and a new control
joins one of them rather than starting a fourth. It reached seven at one point —
transform modes, snap, a Catalog chip, a View popover, a Suggest button, three
room-report buttons, a camera-preset row, a grid chip and a help chip — over a
single view of a single room.

| Where | What | Why together |
|---|---|---|
| **Top left** | `TransformToolbar` (Move/Scale/Rotate + snap) · `CatalogToggle`, with the one `CatalogPanel` hanging under it | Everything that puts a piece in the room or changes one |
| **Bottom right** | `RoomTools` dock: `ViewPresetChips` · `ViewOptions` — divider — `Suggest` · `Room` | Left of the divider is looking at the room, right of it is changing and checking it |
| **Bottom left** | The `?` button (`HelpToggle` / `HelpDock`), on `--z-canvas-hint` | The one place the studio explains itself, and no panel may paint over it |
| **Bottom centre** | `SelectionBar` | Not a cluster: it exists only while something is selected |

Two consolidations are load-bearing and should not be undone casually:

- **Room check / List / Layouts are one button with three tabs.** They were three
  buttons opening three cards that could never be open at once — a tab strip spread
  along the canvas edge, costing three slots and making the second and third
  readings invisible until you knew they existed.
- **`ViewOptions` owns every display setting.** The floor grid was a chip in the
  corner (a display toggle sitting apart from the other display toggle) and
  "Re-scan room" was a second copy of the top bar's Rescan, which is about what is
  *in* the room rather than how it looks. Lighting, Display, Quality — in that
  order, and nothing else.

The 2D plan tab mirrors the same idea at smaller scale: help chip above the zoom
toolbar, bottom-left; scale/comfort chips top-left; export top-right.

### Other studio tools
- **Adding furniture is ONE surface** (`CatalogPanel.tsx`) — a docked, non-blocking
  strip with the two ways in as tabs: **Catalog** (searchable, grouped, drag onto
  the 3D floor or click to drop at centre) and **Describe it** (local token search
  through `lib/shape-search.ts`; explicit sizes in the words are parsed and passed
  through `clampDims`). Two triggers open it and both live in `useStudio`
  (`catalogOpen`): `AddFurnitureButton` in the rail's Furniture section and
  `CatalogToggle` in the canvas toolbar.
  It was two surfaces until they were merged: a 520px modal from the rail over
  `PART_LIBRARY` + product presets, and a canvas strip over `PART_LIBRARY` alone.
  Same feature, two component trees, **two different item lists** — and only the
  strip could drag onto the floor while only the modal could take a described
  piece. The strip won because a modal covers the room you are placing furniture
  into, which is also the drop target. `LibraryPicker.tsx` now owns the one list
  (plus `PickerTabs` / `DescribeField`, shared with the Inspector's swap flow) and
  takes `columns` / `draggable`, so the dock and the swap modal cannot drift apart
  again. `draggable` is **off on the 2D plan**, which has no drop handler — a drag
  that cannot land is worse than no drag.
- **One-tap themes** (`lib/themes.ts`) — recolour all unlocked parts + set a
  matching lighting mood.
- **2D plan** (`PlanView.tsx`) synced with the 3D scene; export via
  `lib/plan-export.ts`.
- **Snapshot** (`lib/snapshot.ts`) — PNG of the 3D view (replaces the deleted
  photoreal render).
- **Undo/redo** (`lib/history.ts`, `UndoRedo.tsx`) — snapshots cover parts, room
  and transforms.
- **Item-to-item snapping** (`lib/item-snap.ts`).

### Removing a piece — `removeParts` in `KeyboardShortcuts.tsx`
One path for every surface: the row trash, the Inspector button, the Delete key
and the 2D plan all call it.

- **No confirmation dialog.** Removing a chair is cheap and history covers scene
  structure, so the reversal is offered *after* the fact as an **Undo action in
  the toast** rather than as permission asked beforehand. A dialog on a
  reversible action only teaches people to dismiss dialogs, which is what makes
  the irreversible ones dangerous.
- Undo restores through the **store**, not `applySnapshot`. History snapshots are
  debounced 250ms, so an immediate Undo click would otherwise pop the state
  *before* the delete. Parts return at their original list index.
- Selection is **pruned**, not cleared — deleting one row of a multi-select keeps
  the rest; the list passes an explicit next row to focus.
- The toast speaks it; `announce()` does not. The toast host is itself a polite
  live region, so doing both said the removal twice.

**Confirmation is reserved for what undo cannot reach:** deleting a saved layout
(stored with the room, outside edit history), the bulk "put every piece back"
transform reset, and deleting a room (which is itself a soft delete with its own
undo — see `lib/storage.ts`).

---

## 6. Architecture

### Stack
- **Next.js 15.5** (App Router) + **React 19.2** + **TypeScript 5.9**. React 19 is
  not a preference here, it is forced: whatever `react` resolves to in
  `node_modules`, Next 15's App Router aliases the client bundle to its own
  vendored React 19, whose internals key is
  `__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE`. The React 18
  key that `react-reconciler@0.27` (and so @react-three/fiber v8) reads is simply
  absent, so the 3D route threw `Cannot read properties of undefined (reading
  'ReactCurrentOwner')` on mount. The peer range Next advertises (`^18.2 || ^19`)
  describes the Pages Router, not this one — trust the runtime, not the range.
- **Three.js 0.169** + **@react-three/fiber 9** + **drei 10** + **postprocessing 3** — declarative 3D.
  This is the line that runs on React 19; fiber 8 + drei 9 cannot. Note fiber 9
  peers `react@>=19 <19.3` — an upper bound, so React is not a free-floating
  caret here; `tests/react-3d-peers.test.ts` fails if one drifts from the other.
  R3F 9 also
  dropped the per-element `*Props` type aliases, so element prop types come off
  the `ThreeElements` map (`components/three/Box.tsx`).
- **Zustand 5** (client state). No data-fetching library — a local-first app
  makes no queries, so TanStack Query was removed.
- **idb-keyval** (rooms) · **localStorage** (settings + key)
- **onnxruntime-web** (local detector) · **@google/genai** (optional Gemini detection)
- **lucide-react** icons, wrapped by `components/ui/Icon.tsx` with a `Circle`
  fallback so no button renders empty
- **No native form controls.** Anything the OS draws its own way is replaced by a
  design-system component, because a platform widget in the middle of a warm,
  rounded, Nunito panel reads as a different product: `ui/Select.tsx` for
  `<select>`, `ui/NumberField.tsx` for the number spinner, `ui/ColorPicker.tsx`
  for `<input type="color">`, `ui/Confirm.tsx` for `window.confirm()`, and
  tokenised scrollbars in `globals.css`. `<input type="file">` stays, kept
  `sr-only` behind a styled trigger.
- Loaded at runtime, not bundled: the ONNX model file; `onnxruntime-web` is
  loaded via CDN with `webpackIgnore` (bundling ort breaks the Next build), so
  it is a **devDependency** — installed for its types only. Its version is
  pinned exactly and mirrored by `ORT_VERSION` in `lib/local-detect.ts`; move
  both together or the compiled types drift from the executed wasm.

### State stores
| Store | File | Holds |
|---|---|---|
| `useStudio` | `lib/store.ts` | selection, wall selection, positions/rotations/dims, lighting, quality, dressed, snap, open state, hidden, grid, view preset. **Only the view *preferences* persist** (`lighting`, `quality`, `dressed`, `snapMode`, `showGrid` → `danmu-studio-prefs`, via `partialize`). Selection / camera / open drawers are ephemeral; transforms and `hidden` are per-room and owned by `RoomSync`. |
| `useSettings` | `lib/store.ts` | apiKey, dimUnit (the one display unit — a dead `units` metric/imperial flag was removed), key-valid cache. Persisted to localStorage (`danmu-settings`). |
| `useRoom` | `lib/store.ts` | active room id. Persisted (`danmu-room`). |
| `useScene` | `lib/scene-store.ts` | scene parts CRUD + group/ungroup + room. |
| `useQuota` | `lib/quota.ts` | Gemini detection quota (flash-only). |

> There is no `useCompose` — it was deleted with the render pipeline.

### Key library files (beyond §4)
| File | Role |
|---|---|
| `lib/scene-spec.ts` | **Single source of truth** — `Shape` union, `ScenePart`, `defaultScene` starters, parametric/decor/support flags, DnD MIME. `defaultScene` is authored against `lib/room-bays.ts`, in each wall's own frame (`u` along it, `v` out from it) rather than in room coordinates: a rectangle reads as it always did, an L furnishes its leg and its wing, and a footprint whose walls the user has dragged is furnished as it now is. Every seeded piece is **gated on fitting** — whole footprint inside the room, clear of what is already there — so a room too small for a sofa gets fewer pieces, never a smaller sofa. What a shallow room gets instead is **different furniture**: `SCREENS` picks the largest real panel (65″ / 55″ / 43″, all three in the catalog) whose own 1.2 × diagonal minimum fits the distance the wall can offer, a bed falls back from double to single, and a dining table with no room for 900 mm of pull-back on both sides goes against the wall and seats three. The living group also takes the bay with the **viewing depth** rather than the most floor, and leaves a route behind the sofa where the bay opens onto another group — circulation over screen size, the same order `layout-score`'s weights give it. Gaps come from `layout-rules`' bands, sizes through `clampDims`, heights through `groundY`; all five presets seed with an empty room report. |
| `lib/parts-catalog.ts` | Room defaults + catalog data. |
| `lib/scene-store.ts` | Scene parts CRUD + grouping. |
| `lib/storage.ts` | IndexedDB room persistence (`RoomData`, `wallColors`, `footprint`, per-room `hidden`, `version`). Deleting a room is a **soft delete** — keys move under `trash:{ts}:` and `restoreRoom` undoes it; `purgeTrash` expires them after 30 days and `destroyRoom` is the irreversible path. A `room:{id}:touched` key carries the real `updatedAt`. **`meta` is retired first on delete and written last on restore**: there is no transaction across keys, and `listRooms` decides visibility from `meta`, so ordering it this way makes the visible state flip exactly once instead of leaving a room that appears in the workspace and opens empty. `restoreRoom` refuses when a live room already holds the id. Each detection carries a `uid`, which becomes its ScenePart id so a user's transforms survive a re-detect; records written before that fall back to the positional `${category}-${n}`. |
| `lib/scene-palette.ts` | Scene-side semantic colours — the one home for values the 3D layer, the canvas exports and the panels that edit them must agree on, since neither Three.js materials nor a 2D canvas can read a CSS custom property. Exports `SCENE` (selection / hover / locked / shell), `PLAN` (the floor-plan PNG's palette) and `defaultBodyColor(category, shape)`. Kept in sync with `globals.css` by hand, guarded by a test. **`defaultBodyColor` takes BOTH arguments**: within one category the shapes do not match (a dining chair is walnut, an office chair charcoal), and the renderer and the Inspector's "Default for this piece" swatch must return the same value. The predecessor took a single loosely-typed `category` and was keyed on material-group names, so 18 of 22 categories fell through to one tan default. |
| `lib/room-scene.ts` | Build a scene from a room / detections. |
| `lib/textures.ts` | Procedural normal/roughness maps (offline, zero assets). |
| `lib/light-units.ts` | Lumens → candela (isotropic and in-cone), and kelvin → sRGB via the Planckian locus. Pure and tested — the interface between how a lamp is described and how three renders it. |
| `lib/themes.ts` | One-tap restyle palettes. |
| `lib/product-presets.ts` | Real-product size presets. |
| `lib/capture.ts` / `lib/image-quality.ts` / `lib/mask.ts` / `lib/color-sample.ts` | Photo capture + quality + masking + colour sampling. `capture.ts` also owns **photo normalisation**: every photo entering the app is re-encoded to ≤1600 px on its long edge (`normalizePhoto`) and screened against a raster allowlist (`isAcceptedPhoto` — `image/*` also matches SVG, which has no pixels to measure). Nothing downstream wants more resolution, and four untouched 12 MP uploads exceeded the detection endpoint's inline-request ceiling. It also **strips metadata** on the passthrough path via `lib/jpeg-strip.ts` — see §3. |
| `lib/jpeg-strip.ts` | Removes EXIF (APP1), IPTC (APP13) and comment segments from a JPEG by byte surgery, so the image data is copied verbatim and the passthrough optimisation survives. Keeps JFIF density and the **ICC colour profile** — neither identifies anyone, and dropping the profile would shift the colours this app exists to get right. Returns the input untouched for anything it cannot parse: a photo that kept its metadata is a smaller problem than a photo we corrupted. **Read anything you need out of EXIF before calling it** — the focal length a future calibration pass wants lives in the segment this deletes. |
| `lib/units.ts` | Unit conversion (persistence always mm). |
| `lib/dates.ts` | Timestamp formatting — the counterpart to `units.ts`. Relative `editedLabel`, absolute `savedLabel`, and the workspace's recency buckets. |
| `lib/csv.ts` | CSV writing that a spreadsheet opens correctly and does not execute: formula-injection escaping, quoting, CRLF, UTF-8 BOM. |
| `lib/use-media-query.ts` | The one `matchMedia` hook. `useMediaQueryState` also returns `ready`, for callers that pick a whole layout and must not paint the wrong one first. |

### UI primitives worth knowing (`components/ui/`)
| File | Notes |
|---|---|
| `Select.tsx` | Combobox trigger + listbox. The list is **portalled to `<body>`** and positioned fixed — the units picker lives inside the Inspector's scroll container, where an absolute popup gets clipped — and flips above the trigger when the room below is tight. Focus stays on the trigger (`aria-activedescendant`); Up/Down change the value while closed, plus type-ahead, Home/End, Esc (stopped, or it would also clear the studio selection). An outside scroll closes it, but a scroll *inside* the list does not: opening on a value far down the list scrolls it into view. `short` renders an abbreviation on the closed trigger when the full label will not fit. |
| `NumberField.tsx` | Measurement input with our own two-chevron stepper (the native spinner is suppressed app-wide). Hold-to-repeat reads the clock and pays at most 3 steps per tick — a plain interval drifts badly when every step re-renders an inspector and a 3D scene, and pure clock catch-up turns one starved tick into a huge leap. It calls `onChange` through a ref, since callers rebuild that closure each render over their own local state. Chevrons are `aria-hidden` + `tabIndex -1`: the input is already a spinbutton and Up/Down step it. |
| `StorageToast.tsx` | One live region for the whole app, plus the imperative `toast()`. Lifted clear of the studio's bottom-right control cluster on `/room/` routes — the card takes pointer events, so at the default offset it swallowed their clicks. |
| `Confirm.tsx` · `ColorPicker.tsx` | Promise-based confirm modal; HSV picker. Both exist to keep an OS widget out of the UI. |

### Data flow (decoration loop)
`scene-spec` defines a part → `scene-store` holds the instance → `Room` renders
each part via `DynamicPart` (geometry) + `Dressing` (decor sibling) → `Pickable`
selects, `Draggable` transforms/commits back to `useStudio` → `RoomSync`
auto-saves to IndexedDB.

`RoomSync` treats a **saved empty scene as real**: `loadSceneParts` returns
`undefined` when there is no snapshot, so `[]` means the user emptied the room on
purpose. Guarding the load on `length > 0` instead rebuilt the starter scene, and
deleting every piece then reloading brought all the furniture back. Scene parts
also flush on unmount, the way transforms do, so leaving a room inside the 300ms
debounce does not drop the last edit.

---

## 7. Known limitations
- Group transforms are **move-only** (no rotate/scale-as-one yet).
- WebXR / true measurement calibration deferred; 4-wall capture only.
- The CC0 GLB library (`LibraryPicker` / `mesh-cache`) is a work in progress —
  most furniture is still procedural.
- BYO key lives in browser memory — Settings warns users to scope / referrer-
  restrict it.

---

## 8. Roadmap
- **Group rotate / scale-as-one** to finish multi-select (translate done).
- Bundle a curated **CC0 GLB library** for higher-fidelity pieces.
- More parametric shapes + richer decor kinds.
- Multi-room projects / rooms dashboard.
- Export polish (image / layout / shareable scene file).

> **Explicitly NOT planned:** reintroducing AI image generation (render / compose
> / compare / share) or the carpenter spec / cutlist / build-cost feature. Both
> were removed in the pivot to a local-first decoration simulation.

---

## 9. Build & run

```bash
pnpm install
pnpm dev          # http://localhost:3000
pnpm typecheck    # tsc --noEmit
pnpm test         # vitest run — pure logic, plus the jsdom files (storage*, history)
pnpm build        # next build
pnpm audit        # dependency advisories; transitive fixes live in pnpm.overrides
pnpm vendor:ort   # copy onnxruntime-web into public/ort/ so it loads same-origin
pnpm hash:models  # print SHA-256 digests of public/models/ for MODEL_DIGESTS
pnpm hash:models --verify   # …and check the mirror serves the same bytes (~62 MB)
```

### Third-party bytes, and the headers that bound them

The optional local detector is the only part of the app that executes or parses
anything fetched from outside. Two controls exist because of it:

- **`pnpm vendor:ort`** copies the ONNX Runtime out of `node_modules` into
  `public/ort/` (git-ignored). A dynamic `import()` cannot carry a
  subresource-integrity hash, so while this resolved to a CDN nothing verified
  what came back — and whatever came back runs with access to the origin holding
  the user's API key and every room. `lib/local-detect.ts` probes the local copy
  first and keeps the CDN as a fallback, so a fresh clone still works.
- **Weights** are format-checked on every remote fetch (ONNX protobuf magic plus a
  size window) and digest-checked against `MODEL_DIGESTS` in
  `lib/local-detect.ts`. All three files are pinned, and each digest was verified
  on both sides — the local export and the bytes the mirror actually serves —
  because a pin taken from the local copy alone would fail closed and silently
  disable the detector for every fresh clone. `pnpm hash:models --verify` does
  both sides and is the command to re-run when re-pinning. The class-name JSON is
  covered too: it is not code, but it decides what every detection is *called*,
  and it used to arrive through a bare `fetch().json()`.
  A mismatch is meant to refuse: the detector reports unavailable and the Gemini /
  manual-box paths carry on.

`next.config.mjs` carries the CSP and the rest of the security headers. Every host
in it is listed with the reason it is allowed; if a feature stops needing a host,
delete it there.

- **Windows / PowerShell** dev environment. The room route dir is literally
  `[roomId]` (brackets) — PowerShell treats brackets as wildcards, so use
  `-LiteralPath` with file cmdlets on those paths.
- **No secrets in the repo.** The AI key is entered at runtime and stored in the
  browser only; `.env*` and `.claude` are git-ignored.
- Licence: **MIT**. (The optional local YOLOv8 weights you export are AGPL-3.0 —
  fine for this open-source project; they are not committed.)

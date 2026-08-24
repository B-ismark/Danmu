# Danmu — Design & Architecture

> Last updated: 2026-08-23 · reflects the codebase on `main`.
> Canonical design doc. Point-in-time studies that fed it — the platform audit,
> the engine research, the remediation plan — are kept under `docs/history/`.

### If you are picking this codebase up cold, read two files

**[`CLAUDE.md`](CLAUDE.md) first, then this one.** They do different jobs and
neither substitutes for the other: CLAUDE.md holds the **non-negotiable rules and
the trust boundaries** — no AI image generation, dimensions owned by code and not
by a model, one source of truth per concern, tokens over literals, local-first —
plus the environment hazards that have each cost someone a debugging session
(PowerShell's UTF-8 round-trip, the `[roomId]` brackets, the runtime-loaded ONNX
runtime, the node/jsdom test split). This document explains **what the system is
and why each part is shaped the way it is**. Breaking a CLAUDE.md rule is a defect
even when the code compiles and the tests pass.

The rest are supporting, and two of them are **point-in-time snapshots, not
current state** — do not read them as a description of `main` today:

| File | What it is | Current? |
|---|---|---|
| [`CLAUDE.md`](CLAUDE.md) | Rules, non-negotiables, commands, env gotchas | **Yes — read first** |
| **Design.md** (this file) | Product + architecture, feature by feature | **Yes — canonical** |
| [`README.md`](README.md) | Quickstart, stack, route table | Yes |
| [`PRODUCT.md`](PRODUCT.md) | Who it is for, what counts as success | Yes |
| [`docs/history/Research.md`](docs/history/Research.md) | How the geometry maths works, where it is weakest, what the literature offers | Snapshot, 2026-07-30 |
| [`docs/history/Plan.md`](docs/history/Plan.md) | Remediation plan for Research.md's findings, with per-phase status | Snapshot, 2026-07-30 |
| [`docs/history/AUDIT.md`](docs/history/AUDIT.md) | A closed audit — 49 code findings, all fixed | Historical, 2026-07-29 |

The four live docs are at the root; everything under **`docs/history/`** is a
point-in-time study that fed them and **loses to this file on any disagreement**.
They were moved there because they had started competing: 2,100 lines describing a
past state, sitting alongside the four that describe the present. `DOCUMENTATION.md`
was a twelve-line tombstone pointing here, and is gone.

For *why the maths is the way it is* rather than *what it does*,
`docs/history/Research.md` is the companion to §4 — every proposal in it was already
filtered against CLAUDE.md's non-negotiables, so it is the right place to look before
redesigning part of the engine.

`AUDIT.md` is a summary; its five detail files live beside it in
**[`docs/history/audit/`](docs/history/audit/)**
(`findings-{security,data,performance,ui-code,visual}.md`).

### Directories that are not source, and are not in git

A fresh clone has none of these; they appear as you run things. Do not read a
missing one as breakage, and do not commit one.

| Path | What it is | Ignored by |
|---|---|---|
| `public/ort/` | ONNX Runtime copied out of `node_modules` by `pnpm vendor:ort`, so the browser loads it same-origin. Build artifact of a pinned dependency | `public/ort` |
| `public/models/` | The three detector files — two `.onnx` graphs plus the class-name JSON. Exported by `scripts/export-detector.py` or fetched from the HF mirror | `public/models/*.onnx`, `*.names.json` |
| `weights/` | Fallout from that export, **not an input to the app**: `ultralytics` downloads the CLIP `ViT-B-32.pt` text encoder that YOLO-World needs, and it lands here. ~354 MB, safe to delete once the `.onnx` files exist | `*.pt` |
| `.venv-export` | Throwaway Python env for the same export (torch + ultralytics) | `.venv-export` |
| `.impeccable/` | Machine-local cache for the design-review hook — config, critique transcripts, live-annotation sessions. Tooling, unrelated to the app | `.impeccable` |

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
   in `app/globals.css`, which is their sole source. Tailwind is present for
   Preflight only — its theme is empty and no utility class is used anywhere, so
   every `className` resolves to a hand-written class in `globals.css`.
   **Three families were added late, because they had been escaping the rule.**
   *Content measure* (`--measure-page`, `--measure-page-prose`, `--measure-text`,
   `--measure-text-sm`, `--measure-hero`, `--measure-card`) replaced ten distinct
   literals retyped across seventeen sites — no two pages agreed on how wide
   content should get, and nothing said what a number was *for*. *Rail width*
   (`--rail-left`, `--rail-right`) replaced the same two numbers inline in both
   studio tabs, and both are now `clamp(floor, vw, ceiling)` rather than fixed:
   at 260 + 320 flat the two rails cost 580px of chrome on every screen, so a
   1024px viewport — the widest that still gets three columns — left the 3D room
   444px, less than either rail. The vw term hands the squeeze to the panels,
   which are lists and labelled rows and can take it; the floors are where the
   widest control inside each rail stops fitting (the inspector holds a 220px
   colour picker plus its padding), and below a floor it is the stacked layout's
   job, not a thinner rail's. Reach for the token that describes the **content**,
   not the one whose pixel count matches what was there. Two things are
   deliberately not measures and keep their own numbers: `PlanView`'s `<svg>` cap
   (a drawing viewport) and the room-name input (a control).
   The third family is a *rule* rather than a value: `.ds-btn--primary` is the one
   committing action on a page and `.ds-btn--accent` the one that advances an
   onboarding flow — **one of each per screen state**, everything else plain. The
   variants existed with no rule about when, so five files used one, five the
   other, and two pages used both at once. `globals.css` states it where they are
   defined.
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
| `lib/clearance.ts` | Ergonomics checker over exact geometry: walkways, functional zones (storage fronts, bed sides, a table's seats, a desk's chair), door swings **and the route in from them**, windows kept unblocked, clashes, reachability, over-height. Every threshold comes from `layout-rules`; nothing is written twice — including `belongTogether`, which keeps the walkway rule off a pair the relation table put together: 450 mm between a sofa and its own coffee table is the figure the table asks for, and reporting it made the panel cry wolf about every correct living room (the solver's circulation term skips the same pairs). Reproducible findings, no AI. Each finding carries a `rule: RuleKind` — the kind of thing that is wrong, as a value rather than as a prefix of its `id`, which is what lets the report ask `RULE_HANDLING` whether the solver could clear it. |
| `lib/apertures.ts` | Turns wall-mounted `window` / `door` parts into rectangles in each wall's own 2D frame, which is all `THREE.Shape` needs to punch a hole (`Shape.holes` + Earcut — no CSG library). Pure, because the wall-local conversion is the part that goes wrong invisibly: get the tangent backwards and every opening mirrors about the middle of its wall. |
| `lib/layout-score.ts` / `lib/layout-solve.ts` | `layout-rules` restated as **costs** rather than checks — collisions, doors and their approach, functional zones, windows, walkways, wall affinity, relations, alignment, balance — plus **inertia**, which charges for movement so a piece only moves if moving it buys something, and **navigability** over the clearance field for the handful of finalists. Then seeded simulated annealing over `(x, z, yaw)` of the unlocked pieces, with proposals that know the room's structure (snap to a wall, park beside the thing you belong to, face the screen, swap two pieces). Deterministic per seed; `mode: 'refit'` turns the inertia up to repair a layout after a resize rather than reinvent it. **Never writes `dimMM`** — it moves and turns, and the type it works in has no field a size could travel in. Restating a table is safe only while the restatements agree, so `tests/layout-conformance.test.ts` pins them to each other — see below. Three properties are worth naming because each one was a bug: a relation is discharged by its **best** anchor and not by all of them (a rug's `['sofa','bed','dining-table']` means *a rug goes under a group*, and read pairwise it charged the rug for every group it was not under — 38.3 of a seeded T's total, and the reason the rug ended up parked between the two); wall affinity is keyed on **role**, since `Category` cannot tell a coffee table from a dining table and gave both `prefers-middle`; and facing the wrong way costs `FACING_GAIN ×` what being a few degrees off square does, because `angleCost` tops out at 1 and a completely backwards sofa was therefore cheaper than moving it 2.7 m. |
| `lib/layout-solve.ts`, after the anneal | Three passes that turn a search result into a **suggestion**. *Snap* squares any yaw within 12° of its wall's own heading, keeping the change only if the room agrees — the free-turn proposal exists so a chair can angle toward a sofa, and it also leaves pieces at 8° that nobody meant to angle. *Prune* offers every moved piece its old place back, cheapest first, spending a bounded slack budget: measured over the five presets at three seeds this reverted **40–63 %** of the moves and left the total cost equal or lower in eight of twelve runs, because the annealer accepts uphill moves and never revisits them. *Explain* names, per piece, the cost term that paid for its move, which is what lets the toast say *"the floor lamp moved beside what it belongs with"* instead of *"moved 8 pieces"*. `isWorthOffering` is then the bar for showing a suggestion at all — a material gain, not merely a smaller number. |
| `lib/solar.ts` | NOAA / Meeus solar position — declination, equation of time, hour angle → altitude and azimuth, ~0.01°. No model, no network, no data file: pure astronomy, which is the one thing in this app a model could not do better. |
| `lib/clearance-field.ts` | Circulation as a **field** rather than a list of pairs — see below. One 5 cm raster of the floor plus an exact Euclidean distance transform answers walkway width, reachability, turning space and crowding at once, and it also carries WHICH obstacle is nearest so a finding can name the pieces to select. |
| `lib/dimension-ranges.ts` | `clampDims` — per-item sizing tiers (fixed / standard / flexible). **All sizes pass through this**, including every size read out of a scene file (§6a). Also `ROOM_SIDE_M`, the one bound on a room's own side: the dims editor wrote `1` and `50` in a predicate and twice more into the sentences it shows, while `scene-store`'s wall-drag clamp independently held 40 — so a size you could type was a size a drag refused to reach. |
| `lib/footprint.ts` | Footprint polygon math (preset shapes, containment, `offsetWall` / `wallOutwardNormal` for wall moves). The polygon — not `width`/`depth` — is the source of truth for room shape. |
| `lib/wall-move.ts` + `lib/wall-actions.ts` | Moving a wall takes its furniture with it. The first is pure (who is attached, where they land); the second is the single action every wall-mover calls, spanning both stores. |
| `lib/room-openings.ts` | **Where a room is entered, and where its light comes from.** Two rules over the footprint's own edges, and no per-preset constants: the door goes on the shortest **outer** wall that can hold one, set against a corner so the wall keeps one long usable run; the window faces the door, and a room over 18 m² gets a second on the *shorter* side wall, because the longest wall is the room's best furniture wall and glazing it costs the room its focal wall. Until this existed no preset had either, and the consequences were not cosmetic: `roomProfile.apertures` was empty, so `navigabilityCost` returned 0 by its own no-door guard and the solver's reachability pass was inert on every new room; `entranceComponents` returned null, so the report's `reach`, `cut-off`, `door` and `entry` rules never fired; the `desk ← window` relation was unreachable; and — the reason anyone noticed — **with no door, no wall had a reason to be the back wall**, so the seeder chose by arithmetic and the result read as arbitrary. |
| `lib/room-bays.ts` | **Where in the room there is actually room.** The footprint's maximal axis-aligned rectangles of real floor, largest first, plus each bay's sides (which of them are real walls, how deep the bay runs from each) and `splitBay` for putting two groups in one rectangle. Exact for rectilinear rooms — the candidate grid is the polygon's own vertex coordinates — and conservative for anything with a diagonal wall, since a candidate is only returned once it has been proved inside. This exists because arranging furniture against the polygon's *bounding box* furnished the quadrant an L / T / U cuts away: the starter scene put five of the L-shape's nine pieces outside the house. |
| `lib/layout-settle.ts` | The guarantee both scene paths end on: nothing outside the room, nothing inside anything else. Containment pushes a piece in by its own half-extent along the wall it overhangs (clamping the *centre* leaves a 2.2 m sofa half in the garden), then clashing pairs are separated smaller-piece-first using the room report's own clash bar, `sharesFloor` and rug exemptions. Cheap and deterministic on purpose — it runs on every room open, where the annealer has no business. It never resizes, never moves a wall-mounted piece, and when a room is genuinely too full it leaves the piece where it was for `clearance.ts` to report. |

On the detect page, `geoRefine` runs the geometry engine over **every** detection
and manual box: geometry overrides AI dims/position; the AI contributes only
label / category / a depth hint.

### The checker and the solver are held to each other

`clearance.ts` and `layout-score.ts` both restate `layout-rules.ts` — one as findings
a user reads, one as costs an annealer descends. The docs and the code have said for
a while that they must agree; nothing checked it, and the disagreement had already
shipped once ("Suggest" parked a bed across a doorway and Room check reported the
doorway as blocked). Neither module was wrong on its own terms, which is why no test
of either one could have caught it.

`tests/layout-conformance.test.ts` tests the relation instead. For each rule it holds
a pair of layouts over the same pieces, differing only in placement, and asserts five
things: the checker flags the rule in one, is quiet in the other, the solver's cost
**for the term implementing that same rule** is strictly higher in the flagged one,
that same term is **exactly zero** on the layout the checker is happy with, and the
total prefers the clean one. The per-term half is the point — comparing totals would
pass on a layout that is merely worse for unrelated reasons and would not prove the
two modules agree about *which* rule broke.

The zero half is the direction the first version left out, and it cost 40 units. It
held the solver to the checker — no arrangement the solver finishes with may still be
one the report calls broken — but never the checker to the solver, so the solver was
free to police rules the report does not have. It did: it charged *every* obstacle
pair for a walkway against a route that widens to 900 mm in a large room, while the
report only ever counts **bulky** pairs at a fixed 600 mm. Three dining chairs 400 mm
apart around their own table therefore cost the solver `walkway 40.4` on a room
`analyzeRoom` reported nothing about — so pressing Suggest flung the dining set across
the floor and the toast said it had *"widened the walkways"*. Both halves of the rule
now live in `layout-rules` (`formsRoute`, and `WALK_MIN` as the single bar), and the
fixture that exercises it carries a laid table whose chairs are identical in both
layouts, so the case fails if that sharing is ever undone.

The second half is a drift guard. Every issue family `clearance.ts` can emit is read
out of its source and must appear in one classification table as either priced (with
the cost term) or deliberately unpriced (with the reason). Three are legitimately
unpriced and stay that way: `tall` is a fact about a piece's size and the solver has
no field a dimension could travel in; `crowding` is a property of the whole room that
no rearrangement fixes; `reach` / `cut-off` / `turning` are connectivity, priced by
`navigabilityCost` over the finalists rather than per proposal. **Adding a check with
no cost is allowed. Adding one silently is not** — a new finding fails the test until
someone classifies it.

One note for anyone extending it: the table is the *only* place a rule's cost term is
named. An earlier draft let each fixture carry its own copy too, and pointing the door
rule at a taste weight left every assertion green — the same duplication-that-drifts
the file exists to police, reproduced inside it.

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
- **The three mouse buttons are spoken for, and each means one thing**
  (`CameraRig.tsx`, `SceneContextMenu.tsx`). Left selects and drags. **Space +
  left-drag pans** — the gesture every 3D tool shares — which freed the right
  button, and **right-click now opens a menu**: the piece under the cursor gets
  the actions that were otherwise a trip to the Inspector or an undiscovered
  single-key shortcut, empty floor gets the whole-scene ones. The menu **does not
  raycast** — both the 3D room and the 2D plan already keep `hoveredPartId`
  current and pass it in, which is why one component serves both surfaces without
  knowing anything about either. A right-drag on a 3D view with no menu behind it
  reads as broken, so do not hand the button back to the camera.
- **What is drawn while you point** — `Highlight.tsx` renders hover (soft,
  depth-tested) and selection (accent, `depthTest` **off**, so a selection is
  never lost behind a wall) plus a footprint outline on the resting surface;
  `MeasureGuides.tsx` draws live dimension lines from the dragged footprint to
  the nearest wall on all four sides, in the user's display unit. Both size
  themselves from the part's **base `dimMM`** and let the group's runtime scale
  multiply them, exactly as the geometry is scaled.
  Both read `lib/drag-live.ts`, **not** `useStudio`: a per-frame drag position in
  the main store re-renders the entire part tree, so the high-frequency channel is
  deliberately separate and only these few light consumers subscribe. `<Line>`
  keys its geometry on the `points` identity, so those arrays are memoised — an
  inline literal rebuilt and re-uploaded nine LineGeometries every drag tick.

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

### Multi-select & grouping — `SelectionHeader.tsx`
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

**Three slots, defined once in `components/studio/CanvasChrome.tsx`, used by both
tabs.** The studio reached seven floating clusters, was consolidated to four, and
four was still three more than either tool this was measured against — Drafted and
Spline both leave bottom-left, bottom-centre and bottom-right empty (Spline's lone
exception is its axis gizmo). Danmu used all of them, on both tabs, with each tab
choosing differently.

| Slot | Holds | 3D tab | 2D tab |
|---|---|---|---|
| `CanvasTools` top-centre | What you do TO the room | `TransformToolbar` · `CatalogToggle` | Comfort-zones toggle |
| `CanvasView` top-right | How you look at it, plus undo/redo | `UndoRedo` | `UndoRedo` · zoom / rotate / fit |
| `CanvasAide` bottom-right | At most ONE thing | `ViewGizmo` | `ComfortLegend`, only while shading is on |

Bottom-left and bottom-centre are **deliberately empty**. If you are reaching for
a fourth slot, the answer is a rail.

Three things left the canvas to make that true:

- **Help** → the top bar (`StudioHelp.tsx`). A 30px button pressed about once per
  user was holding a corner permanently, with its own `--z-canvas-hint` rung so no
  panel could bury it. The **coach marks moved with it** and now anchor under the
  `?` they are teaching you to find — they still fire on the first drag and the
  first wall-selection, which is the only reason those power features are
  discoverable. Both tabs' shortcut content lives in that one file, because the two
  used to describe the same app differently.
- **The selection bar** → the Inspector's header (`SelectionHeader.tsx`). It was a
  second surface answering the question the Inspector exists to answer. It now
  appears only for a **set or a group** — one selected piece is the Inspector's
  normal state and needs no banner.
- **The room dock** → the left rail. See below.

**The 2D tab's chrome was owned by `PlanView`** — 1,072 lines of drawing code that
also held a help card, a zoom toolbar and a legend — while the 3D tab's lived in
its page. That split in ownership is *why* the tabs drifted: nobody comparing them
was looking at both. `PlanView` now exposes a `PlanViewHandle`
(`zoomIn`/`zoomOut`/`rotateLeft`/`rotateRight`/`fit`) and reports `{ zoom, rot,
hasCutOff }` upward; the chrome is `PlanChrome.tsx`, rendered by the page. The
drawing still owns its transform, because wheel, pinch and drag all write it.

### The left rail — state first, then sections

`PartTree` is now a **sectioned scroll column with a pinned footer**, which is
Drafted's rail finished rather than a new idea: each section states what it holds
and closes when you are not using it.

- **The room's health is a permanent chip at the top**, not a panel behind a
  button. `analyzeRoom` already recomputed on every scene change; the only thing
  wrong with it was that you had to find a dock in the corner of the canvas and
  open a tab before it would tell you. Sage *"Room checks out"* or a
  severity-coloured count. Its panel (Check / List / Layouts) is **fixed and
  measured off the chip**, not absolutely positioned — a 260px rail with its own
  scroll box clips an absolute card, the same reason and the same fix as
  `ui/Select.tsx`'s portalled listbox. It opens to the *right* of the rail so the
  room a finding flies to stays visible.
- **Sections**: Room (dimensions + Re-scan) · Style (themes) · View
  (`ViewOptions`) · Pieces (search + the listbox, and it takes the leftover
  height). `RailSection.tsx` owns the header — a real `<button>` controlling a
  region, with the count in `.section-meta`. Open/closed is **local, not
  persisted**: which drawer you left open is not a preference worth carrying
  between rooms, and `partialize` should stay about how the room *looks*.
  **A rail section's body is inline, never a popover.** `ViewOptions` shipped for
  a while as a "Look" button opening a 300px absolute card inside a 260px rail:
  it was cut off down the left by `PartTree`'s own scroll box, and it was a
  disclosure inside a disclosure. If something in a rail genuinely must float,
  it goes `position: fixed` and measured, like the room report and
  `ui/Select.tsx` — but the first question is whether the section header is
  already the affordance.
- **`+ Add furniture` is pinned to the bottom edge** and never scrolls away. It
  used to sit mid-column inside the Furniture section.
- **Re-scan moved here** from the top bar: it changes what is *in* the room, not
  how the app is framed.

**Both rails collapse** (`railLeftOpen` / `railRightOpen`, persisted next to
`showGrid`). Two fixed rails spend 45% of a 1280px laptop on chrome in an app whose
product is the 3D view. A collapsed rail keeps its `<aside>` and its toggle — the
control that reopens it is always where the rail was — and a **stacked** layout
never collapses, because there the rails are content below the room rather than
chrome beside it.

### The studio top bar — three controls, no primary

`Rooms / <name>` as a breadcrumb, the tab switcher, then `?` · room switcher ·
**Export**. It was undo/redo, a room switcher, Rescan, Save file and Snapshot — with
Snapshot styled as the primary action, which downloading a PNG is not. Undo/redo went
to `CanvasView`, Rescan to the rail, and every "take this away with you" action
collapsed into one `ExportMenu.tsx`: the 3D snapshot (3D tab only — it captures that
view), the floor-plan PNG, and the room itself as a `.danmu.json`. Those were three
actions in three places at three visual weights, which is how you end up not knowing
the other two exist. The scene file is last in the menu and labelled as the one you
can open again, since that is what separates it from the two pictures.

There is deliberately **no furniture CSV**. It existed, and was retired: a spreadsheet
writer with formula-injection escaping is careful work aimed at the wrong target, and
non-negotiable 6 forbids reinstating the carpenter spec — a parts list minus the
prices is what that was. The Room panel's on-screen list and its plain-text **Copy**
are what serve "communicate a plan", and they stay.

### Other studio tools
- **"Will it fit?"** (`lib/fit-check.ts`, the `Will it fit` tab in `RoomTools.tsx`).
  The gap between "I like this layout" and `PRODUCT.md`'s *confidence to commit* is one
  question: does the sofa on the shop page go in THIS room, with what is already in it?
  Type its W × D × H, say what kind of thing it is, and the geometry engine answers —
  no backend, no scraping, no model.
  It computes almost nothing itself: it asks `solveLayout` to seat the piece with every
  existing piece **locked**, ends on `layout-settle` the way both scene paths do, then
  asks `analyzeRoom` what it thinks and keeps the findings naming the candidate. Two
  properties come free from composing it that way — the spot it suggests is one the room
  report agrees with (which §4's conformance test pins), and a "no" is a no by the same
  rules the rest of the app judges a room by. Locking is the premise, not an
  optimisation: the user is asking whether the piece fits their room, not whether their
  room could be rearranged around it, and **Suggest** is already the other question.
  Four answers: **fits**, **tight** (it goes in, something is tighter than the
  guidelines like), **no room** (and then it says the largest clear rectangle of floor
  the room does have), and **too tall**, which is judged on its own because no
  arrangement of the floor can help with a ceiling.
  Two checks it makes itself rather than reading off the report, both because the two
  have opposite error budgets — a panel must avoid crying wolf, a fit answer must avoid
  a false yes. **Containment**, because the report has no finding for a piece that is
  outside the room (`outside` is a cost with no checker counterpart); without it, a sofa
  parked through the wall of a too-small room came back "fits". And **overlap**, because
  the report's clash rule is a generous share of the smaller footprint so an ordinary
  dining set is not called a collision; without it, a sofa 31% inside a bed came back
  "a bit tight". The overlap gate defers to `sharesFloor`, whose polarity reads
  backwards at a glance: TRUE means the pair MAY share the square metre (a chair tucked
  under its table), so those are the ones to skip.
  **Nothing is clamped on the way in.** `clampDims` gates sizes the app STORES, and it
  belongs on **Put it there** — the path that adds the piece — not on the path answering
  a question about a real product. A user who types the 2700 mm wardrobe off a spec
  sheet and is told about a 2600 mm one has been lied to. The check reports
  `outOfRange` instead, and placing says the size was brought into range.
  Two things worth knowing about the search. The starting POINT matters more than the
  RNG seed, because the inertia term charges for movement so every run from one origin
  explores the same neighbourhood. Starts are spread over `room-bays`' rectangles of
  real floor. Seeded only at the largest bay's centre, a dining chair in a room whose
  table sits in that centre started inside its own anchor and every seed agreed on
  burying it there — "no room" for a chair in a room with a table in it.
  And the cost is bounded deliberately, because this runs on a button press. Eight
  attempts at 400 anneal steps (`solveLayout`'s own 1600 is tuned for rearranging a
  whole room; here one piece moves and the rest are locked), with a room report on the
  four cheapest placements. Measured on a ten-piece room: 42 ms for an obvious yes and
  ~330 ms for one it has to work at, against 1.3 s for the first version — which was
  fourteen full-length solves with a report on every one, i.e. a frozen tab.
  **Cost sorts the candidates; the report decides between them.** Those rankings are
  not interchangeable, and swapping them cost a regression worth recording: for a pair
  `sharesFloor` exempts — a dining chair and its table — the solver's cheapest answer
  is the chair at the table's dead centre, since the relation distance is zero and the
  overlap it exempts costs nothing, while the report calls that same placement a clash.
  Ranking on cost alone therefore answered "no room" for a chair in a room with a table
  in it, all over again.
- **The room report offers, it does not just report** (`RoomTools.tsx` `CheckPanel`).
  An earlier pass fixed how the panel *sounds* — findings badged FIX / TIGHT / NOTE
  in tracked caps became "Worth fixing" / "A bit tight" / "Just so you know", which
  is the same information said the way the rest of the product talks. What it could
  *do* was still nothing: it named a problem, offered to select the pieces, and
  stopped. The only way to act was the whole-room **Suggest** in the toolbar, which
  is a bigger move than most findings deserve — it rearranges nine pieces to answer a
  question about two.
  So each finding the solver can act on carries **Try a fix**, which runs the same
  solver confined to the pieces that finding names by locking everything else. That
  confinement is the honest part: someone asking about one tight walkway has not
  asked to have their room rearranged. When the confined solve finds nothing it says
  so and names the wider move, rather than being a button that quietly does nothing.
  **Which findings get one is not decided in the component.** `RULE_HANDLING` in
  `lib/layout-score.ts` answers it, because that is already the table saying which
  cost term implements each rule, and it distinguishes two questions that have
  different answers: `reach` has no `scoreLayout` weight (it needs the clearance
  field) yet is still fixable, because `solveLayout` scores it over the finalists
  through `navigabilityCost`. Three findings deliberately get no button — a piece
  taller than the room is a *size* and the solver cannot resize, a crowded room needs
  a piece removed rather than moved, and nothing costs turning space at all.
- **Adding pieces is ONE surface** (`CatalogPanel.tsx`) — a docked, non-blocking
  strip with the two ways in as tabs: **Catalog** (searchable, grouped, drag onto
  the 3D floor or click to drop at centre) and **Describe it** (local token search
  through `lib/shape-search.ts`; explicit sizes in the words are parsed and passed
  through `clampDims`). Two triggers open it and both live in `useStudio`
  (`catalogOpen`): `AddPiecesButton` in the rail's Pieces section and
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
- **Changing which model a piece uses is ONE surface** (`RegenerateModal.tsx`),
  reusing the same `PickerTabs` / `DescribeField` pair as the Add flow. It was two
  buttons — "Swap model" and "AI refine" — which were the same feature twice, and
  the second advertised an AI that does not exist here: matching is local token
  search (`lib/shape-search.ts`), instant and offline. The modal hands the swap
  back to the caller, because re-grounding the piece for its new dimensions and
  mount type is physics the Inspector owns.
- **One-tap themes** (`lib/themes.ts`) — recolour all unlocked parts + set a
  matching lighting mood.
- **2D plan** (`PlanView.tsx`) synced with the 3D scene; export via
  `lib/plan-export.ts`.
- **Snapshot** (`lib/snapshot.ts`) — PNG of the 3D view (replaces the deleted
  photoreal render).
- **The scene file** (`lib/scene-file.ts`, `components/studio/SceneFile.tsx`) —
  `Save file` in the top bar writes the whole room as readable JSON
  (`front-room.danmu.json`); `Open a file` on `/workspace` lands one as a **new**
  room. See §6a — it is the app's only import path, and therefore its only
  untrusted input.
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
- **Three.js 0.184** + **@react-three/fiber 9** + **drei 10** + **postprocessing 3** — declarative 3D.
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
- Loaded at runtime, not bundled: the ONNX weights, and `onnxruntime-web`
  itself via a `webpackIgnore` dynamic `import()` (bundling ort breaks the Next
  build), so ort is a **devDependency** — installed for its types only. It
  resolves **`public/ort/` first** (`pnpm vendor:ort`, same-origin, which is what
  lets the CSP stay tight) and keeps the jsDelivr CDN as the fallback for a fresh
  clone — see §9. Its version is pinned exactly and mirrored by `ORT_VERSION` in
  `lib/local-detect.ts`; move both together or the compiled types drift from the
  executed wasm.

### State stores
| Store | File | Holds |
|---|---|---|
| `useStudio` | `lib/store.ts` | selection, wall selection, positions/rotations/dims, lighting, quality, dressed, snap, open state, hidden, grid, view preset. **Only the view *preferences* persist** (`lighting`, `quality`, `dressed`, `snapMode`, `showGrid` → `danmu-studio-prefs`, via `partialize`). Selection / camera / open drawers are ephemeral; transforms and `hidden` are per-room and owned by `RoomSync`. **Never read the transform maps directly** — see "Two layers, one fallback" below. |
| `useSettings` | `lib/store.ts` | apiKey, dimUnit (the one display unit — a dead `units` metric/imperial flag was removed), key-valid cache. Persisted to localStorage (`danmu-settings`). |
| `useRoom` | `lib/store.ts` | active room id. Persisted (`danmu-room`). |
| `useScene` | `lib/scene-store.ts` | scene parts CRUD + group/ungroup + room. |
| `useQuota` | `lib/quota.ts` | Gemini detection quota (flash-only). |

> There is no `useCompose` — it was deleted with the render pipeline.

### Key library files (beyond §4)
| File | Role |
|---|---|
| `lib/scene-spec.ts` | **Single source of truth** — `Shape` union, `ScenePart`, `PART_LIBRARY` (the one catalog — the old "Real sizes" preset sheet was dissolved into it: duplicates deleted, beds and fridges kept as proper entries in their own groups), `defaultScene` starters, parametric/decor/support flags, DnD MIME. `defaultScene` is authored against `lib/room-bays.ts`, in each wall's own frame (`u` along it, `v` out from it) rather than in room coordinates: a rectangle reads as it always did, an L furnishes its leg and its wing, and a footprint whose walls the user has dragged is furnished as it now is. Every seeded piece is **gated on fitting** — whole footprint inside the room, clear of what is already there — so a room too small for a sofa gets fewer pieces, never a smaller sofa. What a shallow room gets instead is **different furniture**: `SCREENS` picks the largest real panel (65″ / 55″ / 43″, all three in the catalog) whose own 1.2 × diagonal minimum fits the distance the wall can offer, a bed falls back from double to single, and a dining table with no room for 900 mm of pull-back on both sides goes against the wall and seats three. The living group also takes the bay with the **viewing depth** rather than the most floor, and leaves a route behind the sofa where the bay opens onto another group — circulation over screen size, the same order `layout-score`'s weights give it. Gaps come from `layout-rules`' bands, sizes through `clampDims`, heights through `groundY`; all five presets seed with an empty room report. **The openings go in first** (`lib/room-openings.ts`) and everything else is arranged against them: the screen takes neither the door's wall nor a window's, the wardrobe takes a cross wall without a window, a door's swing and the route in from it are floor nothing may be seeded onto, and the living group is placed by searching **along** its wall rather than centring on it — because a seat centred across a 2.42 m alcove seals it, and a door on the *next* wall reaches round the corner far enough to refuse a sofa the app then simply did without. |
| `lib/parts-catalog.ts` | Room defaults + catalog data. |
| `lib/scene-store.ts` | Scene parts CRUD + grouping. |
| `lib/storage.ts` | IndexedDB room persistence (`RoomData`, `wallColors`, `footprint`, per-room `hidden`, `version`). Deleting a room is a **soft delete** — keys move under `trash:{ts}:` and `restoreRoom` undoes it; `purgeTrash` expires them after 30 days and `destroyRoom` is the irreversible path. A `room:{id}:touched` key carries the real `updatedAt`. **`meta` is retired first on delete and written last on restore**: there is no transaction across keys, and `listRooms` decides visibility from `meta`, so ordering it this way makes the visible state flip exactly once instead of leaving a room that appears in the workspace and opens empty. `restoreRoom` refuses when a live room already holds the id. Each detection carries a `uid`, which becomes its ScenePart id so a user's transforms survive a re-detect; records written before that fall back to the positional `${category}-${n}`. |
| `lib/scene-palette.ts` | Scene-side semantic colours — the one home for values the 3D layer, the canvas exports and the panels that edit them must agree on, since neither Three.js materials nor a 2D canvas can read a CSS custom property. Exports `SCENE` (selection / hover / locked / shell), `PLAN` (the floor-plan PNG's palette) and `defaultBodyColor(category, shape)`. Kept in sync with `globals.css` by hand, guarded by a test. **`defaultBodyColor` takes BOTH arguments**: within one category the shapes do not match (a dining chair is walnut, an office chair charcoal), and the renderer and the Inspector's "Default for this piece" swatch must return the same value. The predecessor took a single loosely-typed `category` and was keyed on material-group names, so 18 of 22 categories fell through to one tan default. |
| `lib/fit-check.ts` | **Will this actually fit?** `checkFit` seats one candidate with everything else locked and reports one of four answers with the room report's own reasons. Pure; see §5. |
| `lib/transforms.ts` | **Where a piece actually is.** `resolvePart` / `resolveParts` merge the authored transform on `ScenePart` with the user's `useStudio` override, and this is the ONLY place that fallback is written — see below. Pure, no React, so the scene file and the wall mover resolve exactly the way the renderer does. |
| `lib/room-scene.ts` | The React half of the above: `useRoomScene` (whole scene, memoised), `useRoomPart`, `usePartTransform` (one part, narrow subscription, for `Draggable` and `Dressing`), `useHasOverrides`, and `currentRoomScene()` for pointer handlers. The row here used to say "build a scene from a room / detections", which is `scene-spec`'s job, not this module's. |
| `lib/textures.ts` | Procedural normal/roughness maps (offline, zero assets). |
| `lib/light-units.ts` | Lumens → candela (isotropic and in-cone), and kelvin → sRGB via the Planckian locus. Pure and tested — the interface between how a lamp is described and how three renders it. |
| `lib/themes.ts` | One-tap restyle palettes. |
| `lib/capture.ts` / `lib/image-quality.ts` / `lib/color-sample.ts` | Photo capture + quality + colour sampling. `capture.ts` also owns **photo normalisation**: every photo entering the app is re-encoded to ≤1600 px on its long edge (`normalizePhoto`) and screened against a raster allowlist (`isAcceptedPhoto` — `image/*` also matches SVG, which has no pixels to measure). Nothing downstream wants more resolution, and four untouched 12 MP uploads exceeded the detection endpoint's inline-request ceiling. It also **strips metadata** on the passthrough path via `lib/jpeg-strip.ts` — see §3. |
| `lib/jpeg-strip.ts` | Removes EXIF (APP1), IPTC (APP13) and comment segments from a JPEG by byte surgery, so the image data is copied verbatim and the passthrough optimisation survives. Keeps JFIF density and the **ICC colour profile** — neither identifies anyone, and dropping the profile would shift the colours this app exists to get right. Returns the input untouched for anything it cannot parse: a photo that kept its metadata is a smaller problem than a photo we corrupted. **Read anything you need out of EXIF before calling it** — the focal length a future calibration pass wants lives in the segment this deletes. |
| `lib/color.ts` | Colour arithmetic: WCAG contrast, and OKLab as a space where "same colour" means something. `globals.css` states a ratio next to almost every token and `CLAUDE.md` turns those into a rule, but nothing checked any of it — a comment claiming a ratio is a comment. It also lets `scene-palette.ts`' hand-copied duplicates be compared perceptually rather than by string equality, which is brittle one way and blind the other. |
| `lib/drag-live.ts` | The high-frequency drag channel, deliberately **outside** `useStudio` — see §5. |
| `lib/mesh-cache.ts` | Local GLB cache behind `CachedMesh.tsx`, which renders `null` while loading and expects the caller to keep the primitive shape up as a placeholder. `three-stdlib`'s `GLTFLoader` is browser-only, so both must stay client components. |
| `lib/scene-file.ts` | The `.danmu.json` scene file — build, serialise, and defensively parse. The app's only import path and so its only untrusted input; see §6a. `buildSceneFile` bakes the studio's transform overrides so the file holds one truth per piece, and `parseSceneFile` never throws: it returns a reason, or a file plus the list of what it dropped. Its filename comes from `exports.ts`' `fileSlug`. |
| `lib/exports.ts` | **What to call a file the user is taking away** — `fileSlug`, and nothing else. The three downloads each named themselves: the scene file slugged the room's name with a length cap, the export menu slugged it without one, and the floor plan did not slug at all — it was `floor-plan.png` every time, so exporting three rooms left three files the browser silently numbered `(1)` and `(2)`. The cap earns its place too: a 300-character room name produces a filename the OS may refuse to write, which surfaces as a download that did nothing. Two things are deliberately NOT here — the furniture CSV (retired; see the top bar above) and the transform merge (that is `lib/transforms.ts`, enforced by `tests/room-scene.test.ts`). Tested in `tests/exports.test.ts`. |
| `lib/units.ts` | Unit conversion (persistence always mm). |
| `lib/dates.ts` | Timestamp formatting — the counterpart to `units.ts`. Relative `editedLabel`, absolute `savedLabel`, and the workspace's recency buckets. |
| `lib/use-media-query.ts` | The one `matchMedia` hook. `useMediaQueryState` also returns `ready`, for callers that pick a whole layout and must not paint the wrong one first. |

### Two shells, and what each route stands in

Nine routes used to carry **four unrelated page skeletons**. They shared the
tokens and the components and agreed on nothing structural, so a user crossing
routes re-learned where things live and a developer adding a screen had four
precedents to pick from. There are now two shells and two deliberate exceptions.

| Shell | Owns | Used by |
|---|---|---|
| `components/studio/StudioShell.tsx` | The `--rail-left 1fr --rail-right` grid, the stacked fallback below ~1024px, both rails, the `ready` paint gate | `/room/[id]/model` · `/room/[id]/plan` |
| `components/ui/DocShell.tsx` | The `.chrome-bar`, the mark (always a link), the breadcrumb, the content measure, and the `hero` wash | `/workspace` · `/settings` · `/onboarding/layout-pick` |

**`.chrome-bar` is the app's one bar**, in two sizes — the 56px default and the
studio top bar's `--tight` 48px. It **wraps at any width, not below a
breakpoint**: a breakpoint has to be right about the widest its contents can get,
and the studio bar holds a logo, a breadcrumb, a room name of unknown length, a
save hint, two tabs and three controls — about 900px of nowrap content, which is
why the hand-rolled `height: 48` version simply overflowed sideways under roughly
a 950px window. `min-height` rather than `height`, so a single row still centres
at exactly the old size. Two rules inside it: the group that must stay together
and trailing uses `.chrome-bar__end` (`margin-left: auto`, because a `flex: 1`
spacer stays behind on row one when the bar wraps), and exactly one item is given
`minWidth: 0` so it ellipsises rather than widening the bar — in the studio that
is the room name, never the breadcrumb, which is the way out.

`StudioShell` is pure de-duplication: both room tabs declared **byte-identical**
shell code, differing only in the loading sentence. Two copies of a layout is two
places for it to drift, and these tabs had already drifted everywhere else. What
stays with each page is what goes **on** its work surface — genuinely different
between a 3D room and a 2D drawing. A keyed `Fragment` wraps the caller's
`<main>` so it remains the direct grid item and React does not re-mount a WebGL
canvas every time the viewport crosses the stacking threshold.

`DocShell` replaced three hand-built top bars that agreed on the class and
nothing else: the mark was a plain graphic on the workspace and a labelled link
on settings, so the one affordance every other page trains you to click did
nothing there. It also retires `ds-label` as a page-identity device — a
breadcrumb says what the label said *and* where you came from, in the same width,
which is why Settings no longer needs a separate "Close" button. `back` is a slot
rather than built in, because `router.back()` is history and the breadcrumb is a
fixed destination; only the route knows which of the two it means.

**Two routes deliberately opt out, and should stay out.** `/onboarding/welcome`
is a hero — a breadcrumb on the first screen is a path from nowhere.
`/onboarding/{capture,detect}` are a viewfinder and a review queue; a document
shell has nothing to offer a live camera feed. Forcing either in would be the
same mistake as leaving three bars.

Those three were then **audited on their own terms**, and the opt-out held: no
literal colour, no literal `z-index`, no `#fff` in either of the big two;
`NOTICE_TONES` already splits fills from `-text` variants correctly; the
`toRecord`/`fromRecord` codec is symmetric (`locked` is restored at the load site
into the `confirmed` set, because it is per-index UI state rather than part of a
`Detection`); and every absolutely-positioned overlay in capture is an annotation
on a photo tile or the viewfinder, not chrome competing for a corner.

What the audit did find was the **same drift, from the same cause, as the two
studio tabs**: capture and detect each hand-built the identical bar lead — Back,
a divider, the mark — and had diverged to 34px vs 32px buttons, `0 8px` vs
`0 10px` padding, 12 vs 12.5px labels, and `aria-hidden` on only one of the two
dividers. That triple is now `FlowBarLead` in `ui/primitives.tsx`.

Its `markHref` is **optional on purpose**, and this is the one place in the app
where the mark is not a link. Capture passes an href because `persistBlob` writes
every shot to IndexedDB as it is taken, so leaving costs nothing. Detect passes
none: its entire review — confirmations, edits, hand-drawn boxes — lives in
component state until `finish()` writes it, and a logo is a low-intent click
target in a way an explicit Back button is not. Do not "fix" detect's to match.

### UI primitives worth knowing (`components/ui/`)
| File | Notes |
|---|---|
| `Select.tsx` | Combobox trigger + listbox. The list is **portalled to `<body>`** and positioned fixed — the units picker lives inside the Inspector's scroll container, where an absolute popup gets clipped — and flips above the trigger when the room below is tight. Focus stays on the trigger (`aria-activedescendant`); Up/Down change the value while closed, plus type-ahead, Home/End, Esc (stopped, or it would also clear the studio selection). An outside scroll closes it, but a scroll *inside* the list does not: opening on a value far down the list scrolls it into view. `short` renders an abbreviation on the closed trigger when the full label will not fit. |
| `NumberField.tsx` | Measurement input with our own two-chevron stepper (the native spinner is suppressed app-wide). Hold-to-repeat reads the clock and pays at most 3 steps per tick — a plain interval drifts badly when every step re-renders an inspector and a 3D scene, and pure clock catch-up turns one starved tick into a huge leap. It calls `onChange` through a ref, since callers rebuild that closure each render over their own local state. Chevrons are `aria-hidden` + `tabIndex -1`: the input is already a spinbutton and Up/Down step it. |
| `StorageToast.tsx` | One live region for the whole app, plus the imperative `toast()`. Lifted clear of the studio's bottom-right control cluster on `/room/` routes — the card takes pointer events, so at the default offset it swallowed their clicks. |
| `DocShell.tsx` | The document-route shell — see above. Takes `trail` (the breadcrumb), `actions`, `back`, `measure` (`page` \| `prose`) and `variant` (`plain` \| `hero`). |
| `Confirm.tsx` · `ColorPicker.tsx` | Promise-based confirm modal; HSV picker. Both exist to keep an OS widget out of the UI. |

### Two layers, one fallback

A part's transform lives in two places, and it is meant to:

| Layer | Holds |
|---|---|
| `useScene.parts` → `ScenePart.pos/rot/dimMM` | The **authored** scene — where `defaultScene` put a piece, or where the geometry engine resolved a detection to. |
| `useStudio.positions/rotations/dims` | The user's **edits**, keyed by part id. These win. |

**Do not collapse them.** The path that needs the separation is easy to miss: dragging
a piece writes *only* the override map, so a detected room whose furniture the user
has only moved carries overrides and **no scene snapshot at all**. Re-scanning then
rebuilds `parts` from the new detections while those moves re-apply by id — which is
what `storage.ts` means by "each detection carries a `uid` … so a user's transforms
survive a re-detect". Folding the maps into `ScenePart` takes that survival with them,
and any way to say "put this piece back where it was found".

What the separation must **not** be is open-coded. `positions[p.id] ?? p.pos` written
by hand is a silent bug the moment one of the three lines is forgotten: the piece
renders, the numbers look plausible, and it is simply in the wrong place.
`lib/room-scene.ts` had already declared itself the one place that merge happens —
and four files used it while **thirteen** wrote the fallback out again, because the
un-memoised version rebuilt the whole array on every render of every consumer and the
hot paths could not afford it.

So: the merge lives in `lib/transforms.ts` (pure) with memoised hooks over it in
`lib/room-scene.ts`, and `tests/room-scene.test.ts` sweeps `app/`, `components/` and
`lib/` for a hand-written fallback and fails on one. It found the thirteenth site
itself — a shadow-camera fit in `Room.tsx` that grep had missed — which is the
argument for the sweep over a comment.

Reading a raw override *without* the fallback is still legitimate and stays allowed,
because sometimes the question really is "has this been overridden": `Draggable` and
`DynamicPart` divide a stored dim by the **authored** `dimMM` to get a scale factor,
and the resolved value cannot express that (it would always be 1).

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

## 6a. The scene file — `lib/scene-file.ts`

A room lives in one browser's IndexedDB and nowhere else. That is the privacy
promise working correctly, and it is also why two of the four success cases in
`PRODUCT.md` had nothing to stand on: you could not show a layout to a partner or a
landlord, and you could not survive the browser evicting its storage. A file answers
both without a server.

`Save file` (studio top bar, both tabs) → `front-room.danmu.json`. `Open a file`
(`/workspace` chrome bar and its empty state) → a **new** room, never a replacement
for the one you have open, because `roomStore.importScene` mints its own id.

### What travels

The room — name, footprint polygon, wall paint, site — and every piece with its
size, position, rotation, colour, finish, decor and light. Transforms are **baked**:
in the running app a part's position lives in both `ScenePart.pos` and
`useStudio.positions`, reconciled by an unwritten "overrides win", and a file is the
one place that ambiguity can be resolved rather than propagated. What the user is
looking at is what gets written; `sceneFileToRoom` puts it back with empty override
maps.

### What deliberately does not

- **The photographs.** `Capture` blobs stay behind, and this is the decision in the
  format worth defending. A file exists to be sent to someone; the captures are
  pictures of the inside of the user's home. Everything else in a room describes
  furniture — the captures describe a place. Shipping them would mean the first time
  anyone shared a layout they would also, invisibly, share photos of their living
  room. (They are large, too, and the geometry has already been extracted.)
- **`detectedObjects`** and per-part **`fromDetection`** — the photo pipeline's
  intermediate representation, carrying boxes into images the file does not contain.
  The parts *are* their resolved output.
- **`meshHash`** — a key into the exporting browser's mesh cache, which the importing
  one has no entry for. Honouring it would render nothing where a sofa should be, so
  the piece falls back to its procedural `shape`.
- **`id` / `createdAt`** — they describe a record in somebody's IndexedDB, not a room.

### A file is untrusted input, and is treated exactly like an AI hint

This is the first thing in the app that parses bytes a stranger produced, so the
trust boundary of §4 applies with the same force: **a number from outside the
geometry engine is a hint.** Every imported size goes through `clampDims`; every
shape and category is checked against the runtime vocabularies (`SHAPES`,
`CATEGORIES`, `DECOR_KINDS`, `FINISHES` in `scene-spec.ts`, `LAYOUT_IDS` in
`storage.ts`); every colour must match `#rrggbb` before it reaches a Three.js
material or a style attribute; and file length, part count, polygon vertices, string
lengths and light units are all bounded, because "the user picked this file" is not a
promise about its contents. `1e400` is the case worth remembering: JSON has no
`Infinity` literal but that expression parses to one, and an infinite coordinate
turns every comparison false and every matrix `NaN` without throwing anywhere.

**Those vocabularies are `as const` arrays with the unions derived from them**, not
unions with a parallel `Set`. A validator that can fall behind the type it validates
would drift silently in the worst direction — quietly refusing a shape the app grew
last week.

The parse is **lossy on purpose and never silent**. An unknown shape drops the piece
rather than guessing at it; an unreadable colour drops the field and keeps the piece;
a broken footprint falls back to the layout preset. Every one of those is reported in
`dropped`, which the import toast shows and makes sticky. Refusing a whole file over
one bad field would make a version skew unrecoverable — and pretending nothing was
lost is the other failure.

A file whose `version` is *newer* than `SCENE_FILE_VERSION` is refused by naming the
skew ("saved by a newer version of Danmu"), because the fix is on this side and the
user cannot infer that from "invalid file". Older files are read: every change so far
is additive, the same contract `RoomData` lives under.

### Write order

`importScene` writes the furniture first and `meta` **last**, mirroring `restoreRoom`
for the same reason — there is no transaction across keys and `listRooms` decides a
room exists by its `meta`, so an interrupted import leaves orphaned payload keys
rather than a room that lists in the workspace and opens empty
(`tests/storage-ordering.test.ts`).

---

## 7. Known limitations
- Group transforms are **move-only** (no rotate/scale-as-one yet).
- A scene file carries no photos, so a captured room round-trips as furniture and
  dimensions only — re-detecting needs the original device. This is deliberate (§6a).
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
- Export polish — the scene file and both PNG exports have shipped; what is left is
  a nicer share affordance around them.

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
pnpm lint         # eslint . --max-warnings 0 — `next lint` is gone in Next 16
                  # flat config; ESLint must stay >= 9 or `next build` lints nothing
pnpm audit        # dependency advisories; transitive fixes live in pnpm.overrides
pnpm vendor:ort   # copy onnxruntime-web into public/ort/ so it loads same-origin
pnpm hash:models  # print SHA-256 digests of public/models/ for MODEL_DIGESTS
pnpm hash:models --verify   # …and check the mirror serves the same bytes (~62 MB)
```

`.github/workflows/ci.yml` runs the first four on every push to `main` and every
pull request. One job, `contents: read`, no secrets — a local-first app with no
backend has nothing to give a build. Node is 22 and pnpm comes from
`packageManager`, so CI does not carry a second copy of either version.

The build step reads its **output** as well as its exit code, because
`next build` runs an ESLint pass of its own that can fail while the build still
exits 0 — an ESLint below 9 gets handed eslintrc options and lints nothing, and a
config that ignores `*.config.mjs` hides itself from Next's plugin detection.
`tests/toolchain.test.ts` asserts both invariants directly, so they fail in
`pnpm test` before CI ever sees them.

Next's build cache (`.next/cache`) is carried between runs, keyed on the lockfile
plus the sources a build reads — not `**/*.ts`, which would hash `node_modules`
as well. On the runner that takes the compile step from 17.1 s to 4.0 s; locally,
from 110 s to 14 s.

### Offline

The app was always offline-*tolerant* — pull the network mid-session and the
geometry engine, the solver, the room report and IndexedDB keep working, because
none of them fetch. What failed was a **reload**: the browser had nowhere to get
the document from, so it showed its own error page for an app that needed no
network. `public/sw.js` closes that, and `app/manifest.ts` makes the result
installable.

| Request | Strategy | Why |
|---|---|---|
| Cross-origin | **not intercepted** | Gemini, the ORT CDN, the weights. A cache is storage; storing those is not the worker's business. |
| `/_next/static/*` | cache-first | Content-hashed, so a URL match is always the right bytes. |
| Navigations | network-first, then this exact URL, then `/` | A reload of `/room/<id>/model` must come back as that room, not the home page. |
| Other same-origin | network-first, cache fallback | The manifest, the icon, RSC payloads for client-side navigation. |

Verified in a real browser rather than reasoned about: after an offline reload of
the studio, the room panel renders **identically** to online — same clear-floor
percentage, same verdict — with no console errors. Non-GET and `Range` requests
are passed through untouched.

Two limits, both deliberate. **The first visit must be online**: there is no
build-time precache manifest, because a hand-written file in `public/` cannot know
Next's content-hashed chunk names, and generating one means writing into `public/`
after a build that the target hosts have already snapshotted — it would work
locally and ship empty. And **no `skipWaiting()`**: a new deployment's chunks do
not match the old document, so the new worker waits for the next load rather than
serving a half-updated app to someone mid-arrangement.

`tests/service-worker.test.ts` runs the worker in a small
`ServiceWorkerGlobalScope` (`tests/helpers/sw-harness.ts`) with a network that can
be told to fail, so the strategy is tested as behaviour. Every assertion was
mutation-checked — which is how a redundant `cache.match` in the navigation
fallback was found to be dead code and removed.

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

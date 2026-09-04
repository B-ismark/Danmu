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
   ├─ /capture            add up to 4 wall photos (upload or getUserMedia)
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
labelled relationally ("Wall 1", "Wall 2") while keeping `n`/`e`/`s`/`w` as the
internal ids the geometry and storage depend on — compass bearings asked the user
a question they cannot answer in their own living room, and the engine only needs
four *consecutive* walls.

**Which of the four a photo is, the app now works out** (`lib/capture-slots.ts`).
The screen is "add photos", not four labelled bays: drop or pick any number in
any order, and each one is filed by the strongest signal available — its own EXIF
compass bearing measured against an anchor derived from the photos already
placed, its EXIF shutter time, or the order it arrived in, which is still the
right answer for the live camera because the person is standing in the room
turning right as instructed. Every card says which rung answered, because a wrong
wall is a wrong room: `wallDistance` reads n/s at `depth/2` and e/w at `width/2`,
so a photo of the long wall filed under a short one is measured from the wrong
distance. A set can only ever be wrong by a whole number of quarter-turns, so one
"turn the set round" control fixes every case of it, and each card carries the
length its wall ought to be (`wallSpan`, derived from the room's own dims) as the
one check a person can make against their own picture. This is what makes an
arbitrary upload first-class instead of force-fitting it to a ritual — a single
photo is a supported way to use the screen, not a degraded one.

That works because the slot ids are a **cyclic order, not compass directions**.
Nothing outside `capture-slots`' own arithmetic cares where north is — the room's
own relationship to true north lives separately in `Site.bearingDeg`, which the
user sets on a dial for the sun — so any error common to every bearing, magnetic
declination included, cancels out of the differences. `bearingRef` is read by the
EXIF parser and deliberately **not** carried into the decision for that reason.

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

   The prompt itself is `lib/detect-prompt.ts` — extracted so it can be tested
   without the SDK, and **a function of the photos actually attached**. It used to
   open "You will receive 4 photos of a single room, one per wall (NORTH, EAST,
   SOUTH, WEST)" whatever was sent, and then describe all four cameras; since
   continuing with fewer has always been allowed, the ordinary one-wall run
   described three photographs that did not exist and invited the model to furnish
   them. It now counts them, names the walls nobody photographed as missing, lists
   only the cameras it has, and constrains the `slot` it will accept back to the
   ones it sent. The **coordinate system stays whole** — `position` is reported in
   room coordinates and those are defined by all four wall planes.
3. **Manual boxes** — `PhotoEditor.tsx`: lock / delete / add-box by hand when no
   detector is available.

Detection returns labels + boxes only. The **geometry engine derives real sizes and
positions**, and then checks the label against the size it measured — see §4's
pipeline, which also covers what each source's `conf` is actually worth.

> Note: `@huggingface/inference` and `clsx` were removed in the cleanup — both
> were dead leftovers from the deleted render pipeline.

---

## 4. The geometry engine (deterministic, no AI)

This is what makes Danmu trustworthy. All pure math, all covered by tests.

| File | Role |
|---|---|
| `lib/geometry.ts` | Oriented rectangles (OBB) in the XZ plane; separating-axis overlap, gaps, face clearance, point-in-poly, nearest-edge. Also `Foot` — a footprint that may be **round**, meaning the ellipse inscribed in the OBB (a true circle when W = D, which is how round parts are authored, and the ellipse the renderer draws if an axis is scaled). A circle's bounding square is 27% bigger than the circle and all of it is in the corners, which is where the chairs go; `collidesAt` used to refuse a chair tucked diagonally under a round table for corners the table does not have. Containment is the exact closed form; two true circles use the closed-form lens area, and anything else round uses an inscribed 32-gon (99.4% of the area — inscribed on purpose, so a round piece is never reported as hitting what it does not touch). **One rotation convention, and it is three.js's:** `rot` is what the renderer assigns to `rotation.y`, so a part's front (local +Z) is `(sin rot, cos rot)`. Rotating the other way is invisible at 0°/180° and inverts every directional answer on the side walls — it was reporting "doors can't open" on wardrobes correctly snapped to the east and west walls. `localToWorld` / `worldToLocal` / `frontVector` are the shared helpers, pinned against three's own `Euler` by a test. |
| `lib/photo-geometry.ts` | Pinhole camera at room centre + entered room dims → ray/plane intersection gives real position + W/H from any bbox. `CameraCal` carries the lens (`k`), and optionally the camera's `height` and `tiltRad`; absent values fall back to 1.5 m and level, which is what it always assumed. Tilt matters: 5° of ordinary handheld droop mis-reads distance by ~20%. Three placers, one per surface: `placeFloorObject` intersects the bbox's **bottom** edge with the floor (a vertical thing standing at one distance), `placeWallObject` uses the wall's known distance, and `placeCeilingObject` intersects the **middle** row with the ceiling plane and returns **no height at all** — a `GeoCeilingPlacement` is an `Omit`, so nothing downstream can read a measurement never taken. The middle row rather than an edge because a ceiling fan is a horizontal PLATE seen obliquely: its image spans a range of distances and the top of the bbox is its nearest rim, which reads a 1.2 m fan as 881 mm — further from the truth than the 1000 mm catalogue default it was meant to improve on. It also **refuses** an intersection past the far wall instead of clamping to it, unlike the floor: a level 66° camera in a normal room sees no ceiling at all (the vertical half-angle is ~24°, so from 1.5 m a 2.8 m ceiling first enters frame 2.9 m away, past the wall being photographed), so a high pixel there is wall, and clamping it read a picture frame out as an undersized ceiling fan — the width being computed at the clamped distance rather than the real one. Ceilings need an ultrawide, a camera tilted up, or a tall room. `wallDistance` and `wallSpan` are the two halves of one convention and live together for that reason — the wall you stand `depth/2` from is the one that runs the room's full `width`, and a version of either that agreed with itself but not the other would file every photo against the wrong axis while looking perfectly reasonable. |
| `lib/exif.ts` | Reads the camera fields a photo carries about itself — 35 mm-equivalent focal length (→ `hfovFromFocal35`), orientation, compass bearing, and the shutter time. Pure byte parsing; browsers expose no EXIF API. **Does not read GPS coordinates**, deliberately: nothing needs them, and moving them from the file into IndexedDB would relocate the exposure rather than remove it. The shutter time is the one field read and then dropped: it exists to put a dropped set of photos back into the order they were shot in (`capture-slots`' `time` rung) and is never persisted or sent, which is what keeps it a weaker exposure than the coordinates next to it. Parsed by hand as UTC rather than by `Date.parse` — the EXIF form is not ISO 8601, so what a built-in does with it is implementation-defined, and the no-clock forms (`0000:00:00 00:00:00`, all spaces) and dates `Date.UTC` would silently roll forward are refused rather than sorted first. |
| `lib/capture-slots.ts` | **Which wall a photo is**, as a ladder that reports which rung answered: `bearing` (its own compass tag against an anchor derived from the photos already placed), `time` (EXIF shutter order), `order` (arrival), `manual` (the user, who wins). Anchors are averaged as *directions* — 359° and 1° average arithmetically to 180°, the opposite side of the room — and an anchor whose own photos disagree by more than 30° is refused rather than believed, because a slot flips at 45°. Placement is incremental: an arriving photo never moves one already placed, so nothing shuffles under the user and no correction is downgraded to a suggestion. A bearing pointing at a wall that is already taken is **reported, not honoured** — two photos of one wall, or a magnetometer next to a fridge, look identical from here. **Vanishing points are not a rung**, though the plan proposed them: every shot frames one wall straight-on from the middle of a box, so the wall-parallel direction vanishes at infinity and the view axis at the principal point in *every* photo — an identical pair whichever wall is in front of the lens, with nothing in it labelled by world axis. The only signal that survives is that a long wall subtends a wider angle than a short one, which yields an axis and never a direction; `wallSpan` puts that on screen as a number instead. It also owns **moving a placed set around** — `rotateSet` / `swapSet` / `clearSlot` / `patchIfSame` / `describePlacement` — which lived in the capture screen as hand-written spreads until a read-through found three bugs in them, all the same shape: a fact about ONE photo written against a SLOT. A quality score, which is async, landed on whichever photo occupied that wall by the time it resolved (so rotating a set mid-scoring relabelled every score); a clash flag outlived the photo it named; and the live region said "0 photo added: ." when every wall was already full. **A clash flag's lifetime is stated there**: it survives a rotation, where both photos move together and the reference is only relabelled, and nothing else — a swap, a delete or a replace means the user is doing the assignment themselves, which is what the flag was asking for. |
| `lib/device-tilt.ts` | Lens tilt at the shutter from `deviceorientation`, for the live-camera path only (EXIF has no tilt field). Reports a tilt only for an upright, unrolled phone — a wrong tilt is worse than none, since "none" is the level camera the engine already assumed. |
| `lib/physics.ts` | Gravity/anchor rules — where a part sits (floor / ceiling / wall-mid / …), wall affinity + snap, support-under lookup for tabletop-prone items. Two anchors are worth naming because each was three files disagreeing. **`wall-floor`** is a door: centred on the group origin like the rest of the wall-mounted family, because `apertures.ts` cuts its hole from the mesh centre, but standing ON the floor, because the alternative is a doorway with a step in it. It shipped wrong three ways at once — `room-openings` seeded the centre while `DoorGeo` drew upward from the origin, so a seeded door hung a metre above its own hole; `groundY` said 0, so a *detected* door got a hole half its height; and `'floor'` made `isWallMountedPart` false, so a door from the catalog cut no hole at all. And a **curtain is `wall-high`, not `ceiling`**: that branch hangs a small thing just under the slab, which put a 2.6 m curtain's centre at 2.55 m and most of the cloth through the ceiling. **A wall clamp is measured across the yaw the CALLER will keep**: `snapToWall` holds a piece far enough from the corner for all of it to stay on the wall, and that distance is `dimMM[0] / 2` only because the `rot` it returns turns the piece's local X along the wall. The two callers in `buildSceneFromRoom` that keep the detector's own yaw (`keepsAiYaw`) break that premise, so a TV reported edge-on was held 500 mm further from the corner than it needed to be — inside the room, so a wrong number rather than a wrong room, and therefore silent. The extent is the piece's own OBB projected onto the wall direction (`obbExtentAlong`), exact at any angle and equal to `dimMM[0] / 2` at the wall's own heading, which the four-wall tests check rather than assume. `wallStandoff` is the companion — how far in FRONT of the wall a part hangs, which is non-zero only for a curtain, whose whole job is to be in front of a window; flush, the two are coplanar and z-fight, and the seeder, the detection placement and every drag each used to answer it separately. **A ceiling height is not just a number on the room**, because `groundY` derives half the scene's heights from it — so `heightForNewCeiling` owns where a piece goes when the ceiling MOVES, and the room-dimension editor reaches it through `regradeForNewCeiling` (`lib/transforms.ts`, which is where the two transform layers live). Which pieces follow is read off the anchor's own name: `ceiling` and `wall-high` are measured down from the slab and travel with it, keeping whatever offset below it they had; `wall-mid` / `wall-low` are eye level and skirting level, measured up from the floor, and do not move; `floor` and `wall-floor` never move at all, and a piece that no longer fits keeps its real size and place for `clearance.ts` to report rather than being shuffled to suit. `setRoom` wrote a new height and re-grounded nothing, which left a fan hung under a 1.75 m ceiling stranded at 1.60 m when the room was corrected to 2.80 m — reported as a fan that will not stay up, and reproduced at exactly those numbers. `MOUNT_PAD` is the single clearance those clamps keep — `drag-resolve.ts`'s vertical containment, the Inspector's typed mount height, `heightForNewCeiling`, and `buildSceneFromRoom`'s settle pass in `scene-spec.ts`, which was already spelling it `CEILING_PAD = 0.02` while the constant next door claimed a fourth copy "was about to" happen. Four identical numbers doing one job is invisible until someone changes one of them and a detected fan starts hanging a centimetre away from a dragged one; `tests/scene-build.test.ts` now holds the settle pass and the physics path against **each other** rather than against a literal, which is the only form of that assertion that can fail. |
| `lib/layout-rules.ts` | **What each piece needs from the room, as geometry** — and the one table both the checker and the solver read. Roles (what a piece is *for*, which the catalog's shapes cannot say: `coffee-table` is used for both a 900 mm side table and an 1800 mm dining table, so height decides), access zones per functional side, functional relations between pairs, the room's own profile, and the route width the room is big enough to be asked for. Every number is derived from the piece it is about — a zone's depth is what the *activity* needs, its width comes from `dimMM`, and it lives in the piece's local frame — so resizing anything recalibrates by construction. `wallDebt` is here for the same reason: what a piece standing off its wall costs is linear in the gap, but only up to `WALK_MIN` for a piece whose back is a finished surface (a sofa, a desk) — past that the gap has stopped being dead space and become a route, and the debt goes **flat**. Flatness is the property that matters, because a term that keeps rising is a gradient and a gradient is an instruction: the open plan's seeder leaves a walkway behind the sofa on purpose so the living and dining groups can pass each other, the wall term charged 12/m for it — 11.53 of that preset's entire 13.08 — and `Suggest` duly pulled the sofa 0.27–0.53 m back in at every seed, leaving a route too tight to walk down and too wide to read as flush. |
| `lib/clearance.ts` | Ergonomics checker over exact geometry: walkways, functional zones (storage fronts, bed sides, a table's seats, a desk's chair), door swings **and the route in from them**, windows kept unblocked, clashes, reachability, over-height. Every threshold comes from `layout-rules`; nothing is written twice — including `belongTogether`, which keeps the walkway rule off a pair the relation table put together: 450 mm between a sofa and its own coffee table is the figure the table asks for, and reporting it made the panel cry wolf about every correct living room (the solver's circulation term skips the same pairs). Reproducible findings, no AI. Each finding carries a `rule: RuleKind` — the kind of thing that is wrong, as a value rather than as a prefix of its `id`, which is what lets the report ask `RULE_HANDLING` whether the solver could clear it. **`outside` is the one rule whose predicate is shared with a gesture rather than with the solver**: `roomContainment` / `partInsideRoom` live in `lib/footprint.ts` and `lib/drag-resolve.ts` reads the strict half, because a drag that refuses a placement the room report calls fine reads as whichever of the two you happen to be looking at being broken. What is deliberately *not* shared is the drag's rug branch — its other two conditions ask what the pointer chose and whether the clamp moved the piece away from it, and neither means anything about a piece standing still, so for a static report a rug is outside only when its CENTRE is out. |
| `lib/apertures.ts` | Turns wall-mounted `window` / `door` parts into rectangles in each wall's own 2D frame, which is all `THREE.Shape` needs to punch a hole (`Shape.holes` + Earcut — no CSG library). Pure, because the wall-local conversion is the part that goes wrong invisibly: get the tangent backwards and every opening mirrors about the middle of its wall. |
| `lib/layout-score.ts` / `lib/layout-solve.ts` | `layout-rules` restated as **costs** rather than checks — collisions, doors and their approach, functional zones, windows, walkways, wall affinity, relations, alignment, balance — plus **inertia**, which charges for movement so a piece only moves if moving it buys something, and **navigability** over the clearance field for the handful of finalists. Then seeded simulated annealing over `(x, z, yaw)` of the unlocked pieces, with proposals that know the room's structure (snap to a wall, park beside the thing you belong to, face the screen, swap two pieces). Deterministic per seed; `mode: 'refit'` turns the inertia up to repair a layout after a resize rather than reinvent it, and `mode: 'shuffle'` removes the anchor entirely — inertia 0, the search starting from `randomizeStart`'s scatter rather than from today's placement, and the "never hand back something worse" invariant skipped, because a shuffle of an already-optimal room costs MORE by definition and that is the answer to what was asked. **That exemption is about COST and not about legality.** `IMPOSSIBLE_TERMS` — `overlap` and `outside`, the two hard terms that describe a room which cannot exist rather than one that is merely bad — is vetoed in every mode: no solve hands back an arrangement more impossible than the one it was given, `bestCandidate` ranks least-impossible before cheapest, and `openRoutes` may not open a route by pushing furniture through a wall. This is the user's ruling of 2026-09-02 (*"nothing physically impossible should be encouraged"*), and it is a veto rather than a weight because both terms are continuous from zero, so no finite ratio can order them — a 20 mm overhang used to be bought by the lightest touch of a door's swing. A blocked door, an unreachable corner and a wardrobe that will not open stay PRICED, because those are rooms the report names and **Try a fix** acts on. The descent is untouched: a cliff there would give the annealer nothing to walk down, so the veto lives only where an arrangement is CHOSEN. A refusal says which refusal it is (`SolveResult.declined`), because "nothing could improve this" and "everything I found was illegal" are different sentences and the UI used to speak only the first. See `docs/what-is-still-open.md` § 31 for the measurements. `lib/layout-shuffle.ts` is the pipeline over it — see its own row below. **Never writes `dimMM`** — it moves and turns, and the type it works in has no field a size could travel in. Restating a table is safe only while the restatements agree, so `tests/layout-conformance.test.ts` pins them to each other — see below. Three properties are worth naming because each one was a bug: a relation is discharged by its **best** anchor and not by all of them (a rug's `['sofa','bed','dining-table']` means *a rug goes under a group*, and read pairwise it charged the rug for every group it was not under — 38.3 of a seeded T's total, and the reason the rug ended up parked between the two); wall affinity is keyed on **role**, since `Category` cannot tell a coffee table from a dining table and gave both `prefers-middle`; the wall gap is measured **along that wall’s normal**, because `nearestEdge` clamps to the segment and hands back a DIAGONAL distance to an endpoint whenever a piece stands off the end of a wall, while `halfDepthToward` returns an AXIAL half-extent — the difference of the two is not a gap, and no `RuleKind` maps to `wall`, so this term has one consumer and no second opinion to contradict it (on the L, whose notch runs x 0.48→3.00 at z 0.38, a sofa centred at x = 0 with its back 24 mm off that plane was charged 0.215, 91% of the preset’s whole wall term, and the solver collected it by sliding the sofa 200 mm PAST a wall that does not reach that far); and facing the wrong way costs `FACING_GAIN ×` what being a few degrees off square does, because `angleCost` tops out at 1 and a completely backwards sofa was therefore cheaper than moving it 2.7 m.The best anchor is also an **argmin**, so it needs a tie-break that is not array order: a relation band costs zero everywhere inside it, so a lamp between two armchairs both within reach is a dead heat, and `parts` order changes whenever a piece is added or deleted. `beatsAnchor` settles it on cost, then the physically nearer anchor, then the anchor id — and `relationParents` exposes those `child → parent` edges, so anything that wants to know what a piece belongs to reads one answer rather than recomputing its own.The solver's **first pass** settles one piece alone — `RoomProfile.anchor`, the bed in a bedroom or the sofa in a living room — before the big-furniture and all-pieces passes run. It buys the tail rather than the median: twelve seeds on a scrambled room, worst run, without → with, `l` 1081 → 136 and `u` 155 → 6.9, because a catastrophic run is one where the biggest piece never found its wall and everything else spent the budget arranging itself around a bed in the middle of the floor. The anchor is picked by ROLE PRIORITY first (bed, then sofa, then dining table, then desk) and footprint area only within a rank, so a large sofa cannot outrank a single bed. Those edges are what the solver’s **group pass** moves: before the piece-level passes, a short anneal of its own proposes whole groups — swap two groups by their centroids, slide one bodily, turn one about its own centre — every one rigid, so a group that was arranged stays arranged. It exists for the one case single-piece moves provably cannot reach: two intact groups standing where the other belongs is a local minimum, because taking any one piece out of a coherent group makes the room worse, and the flat search duly moved 0–1 pieces of eleven at every seed. Groups are read from the ARRANGEMENT — only relation edges currently satisfied, movable members only — so a room nobody has arranged has none and the pass is skipped, which is measurably the right answer there. |
| `lib/layout-solve.ts`, after the anneal | Three passes that turn a search result into a **suggestion**. *Snap* squares any yaw within 12° of its wall's own heading, keeping the change only if the room agrees — the free-turn proposal exists so a chair can angle toward a sofa, and it also leaves pieces at 8° that nobody meant to angle. *Prune* offers every moved piece its old place back, cheapest first, spending a bounded slack budget: measured over the five presets at three seeds this reverted **40–63 %** of the moves and left the total cost equal or lower in eight of twelve runs, because the annealer accepts uphill moves and never revisits them. *Explain* names, per piece, the cost term that paid for its move, which is what lets the toast say *"the floor lamp moved beside what it belongs with"* instead of *"moved 8 pieces"*. `isWorthOffering` is then the bar for showing a suggestion at all — a material gain, not merely a smaller number. |
| `lib/layout-shuffle.ts` | **"Show me a different arrangement", as distinct from "fix what is wrong"** — the pipeline behind the rail's **Shuffle** button, next to **Fix**. `Fix` is `solveLayout`'s anchored `arrange`: it pays inertia to move anything and refuses an answer that is not a material gain, so on a room with nothing wrong it correctly does nothing — which is exactly why one button doing both read as a shuffle and behaved as a repair. This runs up to `MAX_CANDIDATES` **independent** solves in `mode: 'shuffle'`, each from its own `randomizeStart` scatter, then keeps only the ones that survive **two** gates and ranks the survivors with `lib/layout-offer.ts`'s `orderOffers` for cost *and* variety, skipping anything too like the last few offers (`ShuffleOffer` carries the part ids with the placements, because a bare `Placement[]` is index-aligned to one `parts` array and the history outlives every edit to the room — mismatched, `layoutSimilarity` throws, and matched-by-length-only it silently compares one piece against another's old position). One solve is not enough and that is measured, not assumed: clean solves run 20/20 on `rect` but **6/20** on `t`, mostly `navigation` — a scatter has to rebuild a whole room inside a budget tuned for a search that starts nearly right. More steps does not fix it (10x buys the `l` five seeds and the `t` *nothing*, 6/20 → 5/20 — the annealer is chaotic under any change); more **starting points** does. The second gate is `newRoomFindings`, and it exists because the solver and the room report disagree: `layout-score` exempts a `sharesFloor` pair from `overlap` outright while `clearance.ts` allows it only to `TUCKED_CLASH_SHARE` (0.85), so a dining chair buried in the dining table costs the search nothing and Room check calls it a clash — **8 of 40 offers** before the gate, 0 of 72 after. Aligning those two thresholds is the real repair and is deliberately left alone here: `overlap` is priced into every solve the app runs, including `Fix`. The cost of gating instead is refusals, unevenly — 12/12 offers on `rect`/`l`/`u`, 8/12 on `open`, **5/12 on `t`** — and raising the cap buys yield at up to a 6.6 s synchronous freeze, so it does not. Refusing is the safe direction and the button says so plainly rather than as an error. |
| `lib/solar.ts` | Sunlight as the two things a room can show you: `sunDirection` (a compass azimuth and an elevation → a unit vector in scene axes, null below the horizon) and `daylightKelvin` (warm at the horizon, neutral overhead, on the same Planckian locus as the lamps). It was a full NOAA / Meeus solar-position calculator accurate to ~0.01°, driven by a latitude, a longitude, a date and a clock; that went, and the file states why in its own header. **Correct is not the same as useful:** nobody arranging furniture can verify a hundredth of a degree, and the four fixed presets in `Room`'s `LIGHTING` table are the four pictures it existed to produce. |
| `lib/lighting-moods.ts` | `LIGHTING` — what each of the five moods looks like, and for the three sun angles where the light comes from. Read by the 3D scene, by the north dial that draws the sun on its rim, and by its own test. It was inside `Room.tsx` first, which was wrong the moment a second consumer appeared: a table in one renderer becomes a table each consumer copies (rule 3, the `layout-rules.ts` argument). The dial had drawn the sun for as long as the sun existed, and putting the angles behind an R3F import is what silently dropped the marker. Hex rather than tokens because none of it is reachable from CSS — the `lib/scene-palette.ts` reason, and the reason it belongs in `lib/` beside it. It also owns `moodSunDirection` (mood + room bearing → a unit vector toward the light, `null` for a studio look or a sun below the horizon) and `DEFAULT_BEARING_DEG`. Its second consumer is `NorthDial`, which draws the same angle on its rim; a derivation with two callers drifts in a way nothing catches, and the specific failure here is a bearing sign that disagreed between them — the light in the right place and the marker on the dial in the wrong one. `moodKeyDirection` is gone with the shadow gate that was its only caller. |
| `lib/part-rows.ts` | `groupRows` — the flat part list as the rows the layer tree draws. A group is nothing but a shared `groupId` (there is no node, no name, no ordering), so the nesting is **derived at read time** rather than stored, and three rules keep it honest: members cluster under their FIRST member so merging never reshuffles the rest of the list; a group of one is not a group, because deleting members leaves a lone part still carrying a `groupId` and a `Group · 1` header would describe something with no behaviour; and a search hides members but never the fact of the group, so a row still reports `3` against one visible member — “this piece is merged with two you cannot see” is exactly what you need before dragging it. Pure and generic over `{ id, groupId }`, so `tests/part-rows.test.ts` runs it without a scene, a store or React. |
| `lib/shadow-fit.ts` | `shadowFit` — how big the sun's ortho shadow camera has to be for one room, plus the `mapSize`, `near`, `far` and `normalBias` that follow from it. Four expressions inside `KeyLight` until the room became a closed shell; it is geometry with a handedness and a wrong answer is **silent**, because an ortho shadow camera does not complain about what falls outside it — it stops recording it, and a caster that is not in the map casts nothing. The old fit covered how far the tallest piece of furniture could throw a shadow across the floor (`tallest × throwPerMetre`, capped at 6). With the walls casting, every caster and every receiver is inside the room's own box, so that term is gone and the bound is the box: `max(halfDiag, halfDiag·sin(elev) + boxH·cos(elev))`. The height goes on ONE camera axis, not both — three builds the shadow camera's basis from `up × z`, so its x is always horizontal — and getting that wrong is a radius used as a per-axis bound: it asked for 10.5 m where a 12 × 9 m open plan needs 7.5, stepping the map to 2048² for a room that never needed it, and 5.0 m against 3.0 on a small bedroom, which is 2.8× the texel density on the floor someone is looking at. Both forms are azimuth-free, which is what stops the bearing dial reallocating the depth target on every degree of a drag. `tests/shadow-fit.test.ts` does not pin numbers: it projects the room box's corners the way `Object3D.lookAt` does and asserts containment, then asserts tightness against the worst azimuth so that `extent = Infinity` cannot pass. Eleven mutations, each killed by the assertion that owns it — one of which (`max(12, …)` on the light distance) survived, and the constant was **removed** rather than given a test, since the constraint its own comment stated was already satisfied without it. |
| `lib/bearings.ts` | Averaging bearings, which is not averaging numbers — `circularMeanDeg` (359° and 1° average to 0°, not 180°) and `circularSpreadDeg`. Was `lib/compass.ts`, most of which was a device-magnetometer read for the sun mood; the read went with the mood and the maths stayed, because `lib/capture-slots.ts` averages the EXIF bearings of a set of room photos to work out which wall each one is. Renamed with its contents: a module named for the deleted half is the scar rule 1 of CLAUDE.md describes. |
| `lib/clearance-field.ts` | Circulation as a **field** rather than a list of pairs — see below. One 5 cm raster of the floor plus an exact Euclidean distance transform answers walkway width, reachability, turning space and crowding at once, and it also carries WHICH obstacle is nearest so a finding can name the pieces to select. |
| `lib/dimension-ranges.ts` | `clampDims` — per-item sizing tiers (fixed / standard / flexible). **All sizes pass through this**, including every size read out of a scene file (§6a). Also `ROOM_SIDE_M`, the one bound on a room's own side: the dims editor wrote `1` and `50` in a predicate and twice more into the sentences it shows, while `scene-store`'s wall-drag clamp independently held 40 — so a size you could type was a size a drag refused to reach. And a **ceiling is not a side**: `ROOM_HEIGHT_M` is its own bound, reached through `roomAxisRange` / `roomAxisWithin` so that neither consumer decides for itself. Sharing `ROOM_SIDE_M` let a room be one metre tall in two places — the editor gated all three axes with it, and `scene-file.ts` bounded an imported `height` with it — and a 1.65 m ceiling is what stranded the fan above. The check is now per-axis for a second reason: judging all three refused a width edit on account of a ceiling typed before the rule existed, and named the side range while doing it. **A bound crosses into the control in the control's own unit** (`boundsToUnit`, `lib/units.ts` — the pair, since neither end can tell alone whether rounding has left an interval): these ranges are metres, `RoomDimsEditor`'s fields are in the user's `dimUnit`, and handing the stepper a raw metre bound meant a 5 m room read `500.0` cm against a max of `50` — one press of the up chevron clamped it to 50 cm and the commit then refused the room the arrows had just produced, in four of the five units. The conversion rounds *toward the interior*, because 1.8 m is 5.90551 ft and a field at the foot step's one decimal renders that `5.9` — two millimetres below its own floor. The sentence under the fields reads its numbers off the same call, so what the user is told and what the arrows obey cannot come apart. **And an out-of-range ceiling in a FILE is clamped and reported, not fatal** — see §6a. `applyRoomEdits` also takes an optional per-axis **furniture floor** (plain numbers; the rule itself is `lib/room-floor.ts`) and reports WHICH rule refused as a value, `RoomRejection`, rather than leaving the caller to work it out by comparing the number it just sent against the floor it just passed in. The furniture stop is checked first and only while it is the binding one: typing 0.1 into a room holding a 2.4 m sectional is refused either way, and *"Sectional needs 2.4 m"* is an answer the user can act on where *"outside 2.4–50 m"* restates the field's own arrows — but below the hard floor there is no piece to name, so the static range answers instead. `ROOM_SIDE_EPS` lives here too, beside the bound rather than beside either consumer, because a typed number reaches a bound by one conversion while a **dragged wall** reaches it by repeated addition and lands a rounding error short: thirty-two presses of the plan's 50 mm step held a wall at 2.45 under a message saying its sofa needs 2.40. Two readers must agree — `wall-actions.ts` decides what to say and `scene-store.moveWall` decides what to do — and one with a tolerance and one without is a wall that stops for a reason no message can name. |
| `lib/footprint.ts` | Footprint polygon math (preset shapes, containment, `offsetWall` / `wallOutwardNormal` for wall moves). The polygon — not `width`/`depth` — is the source of truth for room shape. **Which side of a wall is outdoors is a property of the polygon's WINDING** (`polygonSignedArea`), not of where its middle happens to be. It used to flip the edge perpendicular by testing it against `polygonCentroid`, which averages the vertices: exact for a convex room, and on a T that average sits in the notch beside the stem while on a U it sits between the arms — outside the floor — so every wall whose midpoint lay on the far side of it came back reversed. Measured: 2 of the T's 8 walls and 3 of the U's. `offsetWall` translates the edge along this vector, so `delta > 0` — documented as "push out / bigger room" — shrank the room on those five walls and `wall-move.ts` carried the furniture inward with it. Invisible on a rectangle, which is where every test for it had been written; `tests/footprint.test.ts` now sweeps every wall of every preset and asserts a step along the normal leaves the polygon and a step against it does not. |
| `lib/wall-move.ts` + `lib/wall-actions.ts` | Moving a wall takes its furniture with it. The first is pure (who is attached, where they land); the second is the single action every wall-mover calls, spanning both stores. It is also where a refused wall move **says so**: it judges the prospective polygon against `lib/room-floor.ts` before asking the store, because `moveWall` returns 0 for every reason without distinguishing them, and it announces once per gesture rather than once per frame. That refusal was silent on all four surfaces for as long as this file existed — `moveWallCarrying` returned the applied delta and not one of its four call sites read it — and the plan's arrow-key nudge was worse than silent, announcing *"moved in. Room is now 3.0 by 2.4"* on a press that had moved nothing. |
| `lib/room-floor.ts` | **How small the room may get, given what is standing in it.** `furnitureFloor(parts, axis)` is the largest world-space extent any single piece needs along that axis — rotated, through `footExtentAlong`, so a round table needs its diameter rather than its bounding box (248.5 mm apart on a 1200 mm piece). **Every part counts**, and the filter that looks like it belongs here does not: `floorBlockers` drops rugs, wall-hung items and anything under 250 mm tall because it answers "what gets in a walker's way", while a 3 m rug needs 3 m of floor exactly as a 3 m sofa does. A NECESSARY condition, not a sufficient one — on an L or a T a piece can still fail to fit the bay it stands in, and that remainder is `clearance.ts`'s to report. `roomFloor(stop, current)` then clamps to the room's **current** side, which is the half that is easy to omit and invisible afterwards: a room can already be narrower than something in it, and an unclamped floor sits above the current width, so `NumberField` clamps the value up and one chevron silently grows the room while a wall drag outward is refused for still being under the piece. Two consumers, which is why it is a value: `RoomDimsEditor` → `applyRoomEdits` (a plain number per axis, so `dimension-ranges.ts` never learns about `ScenePart`) and `lib/wall-actions.ts`. `floorRefusal` is the shared sentence, and its `fits` flag is the difference between a true one and a false one — when the room already does not hold the piece the floor is pinned to the current side, so a phrasing built around the bound would announce that a 4 m sectional "needs 3 m". |
| `lib/announce.ts` | The studio's one-sentence live region, as a **channel** rather than a component: `announce()` plus the `ANNOUNCE_EVENT` its listener reads. It was three lines inside `KeyboardShortcuts.tsx` next to the `StudioAnnouncer` that renders it, which was fine while every caller was a component. It stopped being fine when a rule in `lib/` had something to say — nothing in `lib/` imports from `@/components` — and the alternatives were inverting that direction or handing a reason back to four call sites to render four ways, which is the `layout-rules.ts` scar. Dispatch here, rendering still there. |
| `lib/room-openings.ts` | **Where a room is entered, and where its light comes from.** Two rules over the footprint's own edges, and no per-preset constants: the door goes on the shortest **outer** wall that can hold one, set against a corner so the wall keeps one long usable run; the window faces the door, and a room over 18 m² gets a second on the *shorter* side wall, because the longest wall is the room's best furniture wall and glazing it costs the room its focal wall. Until this existed no preset had either, and the consequences were not cosmetic: `roomProfile.apertures` was empty, so `navigabilityCost` returned 0 by its own no-door guard and the solver's reachability pass was inert on every new room; `entranceComponents` returned null, so the report's `reach`, `cut-off`, `door` and `entry` rules never fired; the `desk ← window` relation was unreachable; and — the reason anyone noticed — **with no door, no wall had a reason to be the back wall**, so the seeder chose by arithmetic and the result read as arbitrary. |
| `lib/room-bays.ts` | **Where in the room there is actually room.** The footprint's maximal axis-aligned rectangles of real floor, largest first, plus each bay's sides (which of them are real walls, how deep the bay runs from each) and `splitBay` for putting two groups in one rectangle. Exact for rectilinear rooms — the candidate grid is the polygon's own vertex coordinates — and conservative for anything with a diagonal wall, since a candidate is only returned once it has been proved inside. This exists because arranging furniture against the polygon's *bounding box* furnished the quadrant an L / T / U cuts away: the starter scene put five of the L-shape's nine pieces outside the house. |
| `lib/layout-settle.ts` | The guarantee both scene paths end on: nothing outside the room, nothing inside anything else. Containment pushes a piece in by its own half-extent along the wall it overhangs (clamping the *centre* leaves a 2.2 m sofa half in the garden), then clashing pairs are separated smaller-piece-first using the room report's own clash bar, `sharesFloor` and rug exemptions. Cheap and deterministic on purpose — it runs on every room open, where the annealer has no business. It never resizes, never moves a wall-mounted piece, and when a room is genuinely too full it leaves the piece where it was for `clearance.ts` to report. |

### The detection pipeline, in order

The order is the design. `lib/detect-refine.ts` owns it — pure, no React — and it
used to be two lines inside the detect page, where nothing could test the one
decision it makes.

1. **Measure** — `geoRefine` runs the geometry engine over every detection and every
   manual box, replacing the AI's guessed position and size with values computed
   from the calibrated camera. What comes back measured depends on the piece's own
   anchor: a floor or wall piece gets position, W and H; a **ceiling** piece gets
   **width only** (a fan seen from below projects as a disc, so its bbox holds a
   foreshortened diameter and no thickness); an uncalibrated slot gets nothing at
   all. Unmeasured means the function returns **its own input object**, so callers
   establish measurability by reference identity rather than by a flag nobody
   maintains.
2. **Judge the word** — `lib/label-repair.ts` reads `clampDims` backwards. Forward,
   everywhere else: the detector said "bed", so clamp the size into a bed's range —
   the size is the suspect. Backwards, here: the camera measured 1400 × 2300 and no
   bed is that shape, so the WORD is the suspect. It only ever judges axes the anchor
   actually observed, because judging the AI's own number against the AI's own word
   proves nothing — they agree by construction. **It rewrites nothing**: it reports,
   and the review screen offers the better words as chips the user presses. Every
   candidate is re-measured under its own anchor first, since the same box that
   measures 480 × 360 as a hung painting measures 480 × 1680 as something standing
   on the floor.
3. **Merge** — `dedupeDetections`, and it runs **after** the measurement, not before.
   Deciding what EXISTS in the room on the model's guessed coordinates is rule 2
   violated one layer above where rule 2 is enforced. Both of its thresholds are now
   relative rather than absolute, each after deleting real furniture: same-photo
   duplicates go by bounding-box **IoU** (a fixed 12% of the image ate two bedside
   tables 0.55 m apart, whose boxes did not touch), and cross-photo duplicates go by
   a **per-category** merge distance (a flat 0.6 m collapsed four dining chairs to
   two).
4. **Build** — `buildSceneFromRoom` clamps, snaps and settles. It reads only the two
   axes a photograph can locate: `groundY` owns Y outright, and the placement gate
   used to test Y as well, so a fan the model put 3.2 m up in a 2.8 m room lost its
   perfectly good floor position too.

The AI's remaining contribution is a label, a category, a shape and a depth hint —
and the label is no longer taken on trust either.

**Whose answer is this, and is it worth ticking?** `lib/detect-confidence.ts`.
`Detection.conf` carries three unrelated scales — a class score off the ONNX head, a
number a language model wrote about its own answer, and a literal `1` meaning the
user drew the box — so `source` says which, and the review screen shows it. Auto-
confirming a row requires **independent corroboration**: the geometry must have
measured it and agreed with its word. A model's opinion of itself is not evidence
about itself.

**`lib/detection-record.ts`** is the one pair of functions converting to and from the
persisted form. One pair because there were two, written by hand at opposite ends of
the detect page, and they had drifted: the write carried the geometry pass and the
read did not, so the next press of the always-enabled Finish button wrote
`undefined` over all of it.

**`tests/detect-pipeline.test.ts`** regression-tests the whole chain over one
synthetic room whose contents are known, from analytic ground truth — boxes are
projected through a test-side camera model, so there is no renderer in CI. With a
perfect detector, nine of its ten pieces come back at **0.0000 m** and **0 mm**, so
anything not in its allowance table is a defect rather than noise. It cannot test the
projection itself (both directions share a camera model, and
`tests/photo-geometry.test.ts`'s hand-computed cases own that), and it is not a
detector score — it assumes a perfect detector and asks what our code does with a
perfect answer.

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
someone classifies it, which is what happened to `outside` the moment it was added and
is the gate working rather than an obstacle to it.

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
- Click to select, drag to move, gizmo to rotate / scale. The gizmo modes are
  **W** move, **R** rotate, **S** scale, armed on the 3D tab only
  (`KeyboardShortcuts.tsx`); **Q** and **E** orbit the camera (`CameraRig.tsx`) and are
  not gizmo keys. Naming them here because "Maya-style modes" was all this said, and
  `Draggable.tsx`'s own header filled the gap with "W=move E=rotate R=scale", which is
  wrong and was believed.
- Snap: `off` / `fine` **1 cm · 15°** / `coarse` **5 cm · 45°** — `snapSteps` in
  `lib/drag-resolve.ts`, which is the only home for those four numbers. This line read
  "2.5°" and "7.5°" for both angles; nothing derives them and nothing checked.
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
  single-key shortcut, empty floor gets the whole-scene ones. The caller passes the
  piece in rather than the menu finding it, which is why one component serves both
  surfaces without knowing anything about either. This paragraph used to add "both
  surfaces already keep `hoveredPartId` current"; **they did not** — nothing in the
  2D plan ever wrote it, so a right-click there opened the *room's* menu on top of a
  piece, or offered the actions of whatever had last been hovered in 3D. The plan
  writes hover now (geometrically, through `lib/plan-hit`), which is also what gives
  it a hover outline and the shared `HoverCard` it never showed. A right-drag on a
  3D view with no menu behind it reads as broken, so do not hand the button back to
  the camera.
- **Alt-click chooses between pieces that overlap on screen** — the one question a
  click cannot answer, since only the frontmost handler runs. It selects the
  topmost, and opens a **third** kind of menu listing everything under the pointer
  (`pick` in `SceneContextMenu.tsx`); Alt-clicking the same spot again steps down
  through the stack instead of reopening the list, and Shift-Alt takes the chosen
  piece into the selection rather than replacing it. This is Blender's gesture,
  including the Shift-Alt half. Candidates come from `e.intersections` in 3D
  (mapped back to pieces by `lib/pick-through.ts`, which drops the shell, the wall
  planes, gizmo arcs, guides and light helpers) and from `lib/plan-hit.ts` in the
  plan. Both cycle through the SAME function, so the two views cannot disagree
  about what "next" means. Alt was free for this only because the plan's Alt-drag
  page-rotation was retired in the same pass — stepped rotation on `[` / `]` and
  the toolbar is what a measured drawing wants anyway.
- **The picker has a second door**, because nobody guesses a modifier: the
  right-click menu grows a **"Select what's here (n)"** row whenever the surface
  can say what else is under the cursor. It is also the only route on a touch
  screen, which has no modifier keys at all.
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

### Multi-select & grouping — `SelectionHeader.tsx`, `PartTree.tsx`
- Shift-click adds to `selection: string[]`. "Group N" assigns a shared
  `groupId`; clicking any grouped part selects the whole group. **Both a selection
  and a merged group move as one on translate** (rotate/scale-as-one is roadmap),
  through `lib/drag-convoy.ts` — see §"Who travels" below. "Ungroup" clears it.

  **The user-facing verb is "Group", the internal concept is still `merged`.** That
  is deliberate, not a half-finished rename. The screen already called the RESULT a
  `Group · N` and its undo `Ungroup`, while the button that made one said "Merge" —
  so the app taught three words for one thing and a user reported it. The strings
  changed (`SelectionHeader`, `SceneContextMenu`, the two `PartTree` row labels and
  its group-header name, `StudioHelp`); `groupId`, `groupParts` and the "merged set"
  vocabulary in `lib/drag-convoy.ts` did not, because those name a relationship the
  convoy code reasons about rather than a word shown to anyone. Renaming them would
  be a large diff through the one module this repo has the most scars in.
- **A merged set is drawn as one in the rail** (`lib/part-rows.ts` → `PartTree`).
  It was invisible there: three merged chairs looked exactly like three loose
  ones, and the only tell was watching them move together — which is what made
  the behaviour so hard to report in the first place. The members now sit under a
  `Group · N` header row that folds (Left/Right, or the chevron), with an indent
  and a ├/└ connector. The header is an `option` like every other row, because a
  listbox may own nothing else, and it is genuinely selectable: pressing it takes
  the whole group — the gesture the 3D canvas performs on any click, and the one
  the rail previously had no way to reach. `aria-expanded` rides the **chevron**
  and not the row, since ARIA 1.2 dropped it from `role="option"`; that is what
  `IconButton`'s `expanded` prop exists for.
- **Selecting one member is what the rail adds**, and it is close to the reason
  the rail exists at all: the canvas expands a click to the whole group before a
  drag ever starts, so the list is the only surface that can reach inside one.
  And the selection is what a drag then carries: `planConvoy` has **no** closure
  over `groupId`, so acting on a single member acts on that member. It used to
  close over the group here, which meant the rail could select one chair and the
  drag would quietly take all three — two gestures, two meanings. Where "merged"
  lives now is `selectionForPick`, so a *click* still takes the whole set and only
  the case the layer tree made reachable behaves differently.
- **A group action means the group in the ROOM, not the members a search is
  showing.** `row.ids` is the visible members — right for drawing the header and
  for a range, wrong for anything that acts on the set — and every group-wide
  action goes through one `groupMemberIds` now. It did not, and the asymmetry was
  written out correctly for *ungroup* one handler above and then not applied to the
  destructive twin: with a search leaving one chair visible, a button labelled
  "Remove these 3 pieces" and titled "Remove the whole group" deleted one and left
  the other two merged to each other. Ctrl-click's duplicate had the same gap, and
  pressing a filtered header selected a single piece and then rendered itself
  unselected, because `groupSelected` is measured against the room.
- **A group is atomic in a range.** Unioning the span's own `ids` was asymmetric
  and visibly so: with rows `sofa, [Group×3, c1, c2, c3, lamp`, sweeping sofa→c1
  took four pieces because the header dragged in the members past the end of the
  range, while sweeping lamp→c3 took two. Same gesture, same two rows swept,
  different arity. Touching a group at either end now takes all of it.
- Navigation, range selection and the roving tabindex all read **rows** rather
  than parts. A range unions each row's `ids`, which is what makes a folded group
  behave like the one row it looks like (its members are not rows, so nothing
  else would pick them up) while an unfolded one contributes nothing extra. The
  tab stop prefers a fully-selected group's header over any one member, measured
  against the room rather than the visible rows — otherwise a search showing one
  of three would leave the header reading unselected directly above a member
  reading selected.
- A **press keeps** a selection that already contains the piece, so the drag has
  something to carry; a **click** (a press that never moved) collapses it to that
  one piece. Both surfaces, both directions. The plan collapsed on the press and
  the 3D tab collapsed on the DOM click that ends every drag, which is why a
  multi-piece drag looked impossible in one tab and self-undoing in the other.

### Recolour & finish — `Inspector.tsx`, `Draggable.tsx` `FinishApplier`
- One merged **Colour** section (24-swatch palette + hex). Separate **Finish**
  (Auto / Matte / Satin / Polished / Metal) — `FinishApplier` traverses the
  part's meshes and overrides roughness / metalness / envMapIntensity (caches
  originals for "Auto" restore, skips emissive materials). Real per-part physics.

### Procedural & parametric furniture — `DynamicPart.tsx`, `scene-spec.ts`
- Furniture is **procedural geometry, not imported models** — zero asset weight.
- **A renderer's geometry is authored at `part.dimMM`, and `FanGeo` was not.** Its
  blade was `size: [r * 1.6]` at `position: [r * 0.6]` — a box of length 1.6r centred
  at 0.6r runs from −0.2r to **1.4r**, so the catalog's 1000 mm ceiling fan swept
  1.40 m and each blade crossed 100 mm out the far side of its own motor. `Draggable`
  scales by `storedDim / part.dimMM`, so a renderer with its own idea of the size
  renders the wrong size at scale 1. It did not even need the 3D tab to see: the plan
  draws a fan as a circle straight off `dimMM`, so the two tabs disagreed by 40% about
  the same piece. The span is `fanBlade` in `scene-spec.ts` now, where a test can
  reach it — `tip` is the fan's own radius across the whole clamp range, and the
  inner end is the hub, because a tip-only assertion passes for a blade of the right
  length in the wrong place.
- **Parametric shapes** (`isParametric` — fourteen of them, and the list is not
  restated here because every prose copy of it has gone stale at least once)
  rebuild from effective dimensions instead of stretching: sofa tiles seat
  modules from width, bookshelf derives shelves from height, wardrobe derives
  door bays from width, etc. The scale gizmo live-stretches; commit converts
  scale → dimension and the geometry redraws cleanly.
  **How MANY modules is `moduleCount` in `scene-spec.ts`, and it used to be five
  copies of `Math.round(span / nominal)` inline in the renderers.** That expression
  minimises the error in the *count* and says nothing about the *module*, which is
  the thing with a real-world size — so a wardrobe at 890 mm drew ONE 890 mm door
  while 900 mm drew two of 450, and dragging the width handle through that band made
  the doors grow to an impossible width and then snap to a different count. Reported
  as "the models aren't modular enough… wardrobe shouldn't be autoscaling", and it
  is the same defect as `FanGeo` above: arithmetic in a TSX renderer that no test can
  reach.
  The count comes off the module's own range now (`MODULE_RANGE`) — a door is
  400–800 mm, a seat cushion 470–950 — and it takes the **pair**, the same argument
  `boundsToUnit` is built on: one end cannot tell you whether an interval survived.
  Two properties are asserted rather than argued. `max >= 2 * min` for every row, or
  spans exist that no integer count can tile inside the range at all — with a
  450–750 door an 890 mm wardrobe has no legal answer. And the count is **monotonic**
  in the span: `Math.round` is not, and non-monotonic is exactly what "autoscaling"
  looks like from outside — drag wider and a bay disappears.
  The nominals are chosen so **every shipped preset keeps the count it already
  draws**. That is deliberate: the defect lives in the bands between the presets, and
  a change that also redrew the presets the catalog ships would make it
  impossible to tell a fix from a restyle. `tests/module-tiling.test.ts` pins both —
  the presets by name, and every legal size by a 1 mm sweep, because choosing
  examples is how the 700–890 mm band was missed and every nominal looks fine against
  the one preset its shape ships with.
  Worth knowing, because it looks like the obvious next thing and is not: the
  *other* numbers in these renderers are already right. A wardrobe's panels, dividers
  and handle inset are absolute metres (0.018, 0.014, 0.05), and the sofa's
  `Math.min(0.18, w * 0.12)` arm is a **cap** rather than an unclamped fraction, so a
  4 m sofa still gets a 180 mm arm. There is no de-fractioning left to do in these two.
- **Model picking is local text search** — `LibraryPicker.tsx` +
  `lib/shape-search.ts` (token + synonym + text-size parser). Every piece is
  procedural: it resolves to a `Shape` this app draws, never to a downloaded mesh.
  A `lib/mesh-cache.ts` used to sit here — an IndexedDB store of GLB blobs keyed by
  a crop hash, with providers named `meshy` and `tripo` — and it was deleted, not
  refactored. Nothing had written to it since the image-to-3D pipeline went (rule 1),
  so `meshHash` could never be set and `CachedMesh` could never render; what was
  left was a dead subsystem wearing the names of a permanently removed feature,
  which reads as a rule-1 violation to whoever finds it next.

### Adding a shape — the contract

Eleven places — five you add the shape to and six tables it otherwise inherits from
its category — and knowing which of them the compiler holds is the whole point. It
holds **one**. This list is the answer to "what rules does a new model have to
follow"; the executable half is `tests/shape-contract.test.ts`, whose clauses are
named for the rules below, so a failure says which one was broken. Not every rule
here has a clause yet, and where it does not this says so.

**What the compiler holds, and it is less than you would hope.** Add the id to `SHAPES`
(`lib/scene-spec.ts`) — an `as const` array with `Shape` derived from it, never a union
beside a hand-kept `Set`. Then `CATALOG_SHAPES_ORDERED` if a person may add it;
`PART_LIBRARY` for the row the picker draws; `BY_SHAPE` in `lib/scene-palette.ts`; and a
`case` in `ShapeDispatch`.

Exactly **one** of those five fails to build if you miss it: `scene-palette`'s `BY_SHAPE`
is the only exhaustive `Record<Shape, …>` in the tree. `CATALOG_SHAPES_ORDERED` is a
`readonly Shape[]` and `PART_LIBRARY` a `LibraryItem[]` — both non-exhaustive, so omitting
a shape from either compiles cleanly and simply means nobody can add the thing. And
missing the renderer case is quietest of all: it **builds**, drawing a plain box at the
right size, which reads as deliberately blocky furniture rather than as a missing arm.
Those four are the first clauses of the contract, and they exist because the compiler
does not cover them.

**The six `Partial<Record<Shape, …>>` tables, which is where shapes go wrong.** A partial
table is how a shape inherits behaviour from its category, and inheriting is silent — you
get an answer, just not yours.

| table | file | what a wrong inherited answer looks like |
|---|---|---|
| `BY_SHAPE` | `dimension-ranges.ts` | a 1250 mm chest freezer clamped to an upright fridge's 950 mm — a catalogue default the app itself refuses |
| `ANCHOR_BY_SHAPE` | `physics.ts` | **the scar below** |
| `ROLE_BY_SHAPE` | `layout-rules.ts` | role `other`: no access zone, nothing it belongs beside, and no `RULE_HANDLING` term that can move it |
| `LIGHT_BY_SHAPE` | `scene-spec.ts` | a fixture that looks lit and emits nothing |
| `LIGHT_ANCHORS` | `three/PartLight.tsx` | the bulb sits on the floor and lights the inside of its own shade |
| `MODULE_RANGE` | `scene-spec.ts` | a parametric piece tiles at the wrong module count |

The room-layout rules are **not** in that list and it matters: `ACCESS_BY_ROLE` and the
belongs-together relations are keyed on **`Role`**, not on `Shape`. A shape never joins
them directly — it reaches them through `ROLE_BY_SHAPE`, which is why that row is the one
to get right. Only the first four have a contract clause today; `LIGHT_BY_SHAPE`,
`LIGHT_ANCHORS` and `MODULE_RANGE` do not, and that is a gap rather than a decision.

**The scar.** `fan-standing` shipped with no `ANCHOR_BY_SHAPE` row, so it took its
category's — and `fan` means the *ceiling* one. A 1300 mm pedestal fan hung from the
slab at mesh-centre 2.65 m, spanning 2.00–3.30 m: half a metre through a 2.8 m
ceiling. Nothing said so. `isObstacle` gates on `pos[1] < 0.05`, so the room report
could not see it, the solver never priced it, and every catalogue-wide sweep in the
suite stayed green — because each one asks whether a shape is **present** in some
table, and this shape was present in all of them. Absence was never the defect. So
the contract asks about **behaviour at the catalogue's own default** instead: where
does it end up, can anything move it, can a person find it, can a photograph produce
it.

The fix for that one clause is worth stating too, because it caught a second thing.
Deleting the anchor row no longer overflows the ceiling — `groundY` now hangs a deep
fixture by its own half-height, so the fan comes to rest spanning 1.50–2.80 m,
entirely inside the room with its base floating at chest height. A fix masking the
defect its sibling clause was written for. Hence a second question, which is what
"hung from the ceiling" actually means: **you can walk under it.**

**Sizes.** Pick a tier — `fixed` for a manufactured item, `standard` for real
variety, `flexible` for made-to-measure — and give the shape its own band rather
than letting it borrow its category's. The band must be legal **in every unit the
user can switch to**, which is what `boundsToUnit` is for: a range narrower than one
step of a coarse unit collapses or inverts (a door's 35–60 mm rounds to min 0.2 ft /
max 0.1 ft, and every arrow press then lands on the wrong end).

**Geometry is authored at exactly `part.dimMM`.** `Draggable` scales by
`storedDim / part.dimMM`, so a renderer with its own idea of the size renders the
wrong size at scale 1 — see `fanBlade` above. The widest element **is** `dimMM[0]`:
the standing fan's guard is the full width with a narrower base, and the stool's
legs sit inside its radius at the floor. If a piece is round, the plan needs
`circle`, and that is derived from the shape by `isRoundPart` rather than stated on
the catalogue row — so a round shape is round however it entered the room. Add it to
`ROUND_SHAPES` and every path agrees; state it on a row and you have made a second
answer, which is the defect § 32 records.

**Colour** comes from `BY_SHAPE`, hand-synced to the CSS tokens and guarded by
`tests/color-tokens.test.ts`. Never a literal hex in a renderer for a surface the
user can recolour.

**Grouping is load-bearing for search, not just for the picker.** `hayTokens` scores
against label + group + category + shape, so the group a shape joins widens the
query space: two shapes joining `Appliances` moved a measured substring ceiling from
10 to 12 rows. Adding any shape also moves the wall-rider sweep's three counts,
which are pinned exactly — re-derive them, never widen them.

**Detection is a vocabulary problem, not a geometry one.** The detector never sees
these meshes; it emits a *label and a box*, and `refineShape` maps that to a shape.
A shape no label refines to is one a photograph can never produce, however good it
looks. `refineShape` had no `fan` case, so every fan a photo found became a ceiling
fan — including `electric fan`, which is what the exported vocabulary calls a
pedestal one.

**The on-device vocabulary is frozen and cannot be extended from TypeScript.**
`WORLD_PROMPTS` mirrors `WORLD_VOCAB` in `scripts/export-detector.py`, whose **key
order** `set_classes()` baked into the graph as class channels. Insert a prompt in
the middle and every label after it comes back shifted by one — no crash, just a
detector reporting a sofa as an armchair. Adding one means re-exporting the graph
and re-pinning `MODEL_DIGESTS`. The cloud path has no such limit: its prompt
interpolates `CATALOG_SHAPES_ORDERED`, so a new shape is nameable there at once.

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
- **Lighting moods** — five, as one row of icon-only buttons
  (`LightingPicker.tsx`, in the rail's **Style** section →
  `LIGHTING` in `lib/lighting-moods.ts`). Two are studio looks: Evening / Cool.
  Three are sun angles: Sunrise / Day / Sunset (see the next two entries).
  It was seven in a `Segmented` of icon+word pairs inside **View**, which was
  wrong twice over. Seven needed two rows of a 260px rail, and `sun`,
  `sun-medium` and `sun-dim` differ only in the length of their rays — three
  labels over one picture. And a *theme* sets a mood (`applyTheme` calls
  `setLighting`), so the two controls answered one question from two drawers and
  picking a theme silently moved a control the user could not see. Day absorbed
  Noon (two names for bright overhead light; the survivor is the sun, because a
  direction is the point of daylight) and Sunset absorbed Golden at 8°/272°,
  which is neither original — Golden's 14° read as afternoon, Sunset's 2° gave
  2657 K and room-length shadows. The two surviving ids are the two that were
  already persisted, so no stored preference was orphaned. Dropping the words
  does not drop the labels: each button keeps its `aria-label` (with the
  direction, which no glyph can carry) and its name returns on hover **and on
  focus** through `ui/Tooltip` — a native `title` never appears on keyboard
  focus, and for an icon-only control the tooltip *is* the label. Every mood's
  `hemi` / `fill` / `env` / `envMul` / `exposure` terms
  set the **ambient** conditions only. Evening is deliberately low now — its job
  is to leave room for the fixtures rather than to be an orange filter over a
  fully-lit room, so a room with no lamps in it reads as genuinely dim there.
  Each mood carries an **`envMul`** that scales the `<Environment>` lightformers
  with it. Dimming the three lights and leaving the environment at full strength
  is not enough: every material has `envMapIntensity: 0.5`, so the environment
  supplies most of the light in the scene, and a nominally dark Evening still
  rendered as a fully-lit amber room. Both halves move together or neither does.
- **The sun is three of those moods, and they are angles rather than a
  measurement.** `Sunrise` / `Day` / `Sunset` each carry one azimuth
  and one elevation in the same `LIGHTING` table (`lib/lighting-moods.ts` — a
  `lib/` module and not a renderer, because the north dial reads the same rows to
  draw the sun on its rim), and everything else about the
  key light is *derived* from those two numbers: its direction through
  `sunDirection` (which is where the axis convention lives — scene +X east, +Z
  south, so scene north is −Z), its colour through `daylightKelvin` on the same
  Planckian locus the lamps use, and its strength through `sin(elevation)`, the
  first-order air-mass term that makes Sunrise read as sunrise rather than as
  Day pointed sideways. **When an angle is below the horizon there is no key
  light at all** — `sunDirection` returns null rather than a downward vector,
  because a light shining up through the floor is worse than no light. No shipped
  preset is below it; the branch stays because the function decides, not the call
  site.
  The one per-room input is **`Site.bearingDeg`**, which rotates all four
  together — so *which wall* the light comes through is still the user's answer,
  and it is set on the dial in the rail's Room section (`NorthDial.tsx`). That is
  a `role="slider"` with arrow keys, because pointing is otherwise a mouse-only
  gesture, and it draws the room square in the middle with north on the rim:
  "which way does the room face" is a picture, not a number between 0 and 359.
  The key light's shadow frustum is fitted per direction, not per room, and the fit
  is `lib/shadow-fit.ts` rather than four expressions in the renderer. A low sun
  sees the room in **elevation** where a high one sees it in **plan**, so the bound
  is the room's own box and the height lands on one camera axis rather than both;
  the row in the table above has the arithmetic and what the old version cost.

- **The room is closed to the sun.** The walls `castShadow` as well as receive, and
  there is a ceiling — a shadow-only mesh, `colorWrite`/`depthWrite` off, not
  raycastable (`RoomShell.tsx`). So the sun reaches the inside of the room only
  through a window or a door, which is what `lib/apertures.ts` has been cutting all
  along: one polygon, so the light that comes through an opening comes through the
  same hole in the shadow map.
  Before it, the room was a floor and four screens open to the sky, and that had two
  symptoms which read as different bugs. The reported one: **a TV bolted to the
  north wall threw a shadow across the floor with the sun in the south**, because
  the light went through the plaster, hit the back of the TV, and the TV — which
  does cast — put a shadow inside a room the light had never entered. The unreported
  one: the sun's patch of light landed on the *whole* floor at once, because nothing
  above the furniture stopped it.
  There was a per-piece gate for the first (`lib/sun-shadow.ts`): a dot product
  asking whether the sun was on the room side of the wall a piece rode. It worked,
  and it was a workaround at the wrong layer — it patched one symptom of a missing
  ceiling one shape at a time, and had already needed a second fix for doors and
  windows and a third for the studio moods. It never touched the second symptom at
  all. It is deleted; `tests/room-shell.test.ts` holds the shell's four silent
  properties and greps the removed vocabulary so the gate cannot come back as dead
  plumbing.
  Three things about it are load-bearing. **Casting is camera-independent**, so the
  dollhouse is untouched: back-face culling happens in the colour pass against the
  view camera, while the shadow pass renders every caster from the light's point of
  view regardless of orbit — the old claim that a casting wall would "black out the
  room the moment the camera came round" was simply wrong. The ceiling must stay
  `visible`, because three skips an invisible object in the shadow pass too, which
  is why its *material* opts out of drawing instead. And it must not answer a
  raycast, or it would sit between the pointer and every piece of furniture in the
  room.
  Two consequences are stated rather than left to be found. `castShadow` is a
  property of the object, so a wall now casts into every light's map — a lamp
  standing against one throws the wall's shadow as well as its own; per-light
  masking is the real fix and is a change to how the scene is lit. And a sealed room
  is lit by sky, environment and lamps alone, so a **sun mood in a room with no
  opening does nothing** — which is the honest answer and is said out loud in the
  rail's Style section, under the Lighting row, through the same `isAperture`
  predicate that cuts the holes.

- **What the sun used to be, and why it is not that any more.** This was a single
  `Sun` mood that computed a real solar position: `lib/solar.ts` carried the full
  NOAA / Meeus algorithm — mean longitude, equation of centre, obliquity, equation
  of time, hour angle — accurate to ~0.01°, driven by a latitude, a longitude, a
  day of the year and a clock. `SunControls.tsx` was 759 lines and the studio's
  largest component: a "Where the room is" section with lat/lon fields and a
  `Use my location` button (`lib/geolocate.ts`, coarsening the fix to ~11 km), a
  `Compass` button reading the bearing off the phone's magnetometer
  (`lib/compass.ts`), a drawn solar-elevation arc with sunrise / noon / sunset
  marked, a twelve-month strip, a scrub slider and a `Now` pin with a ticker in
  `Room` following the device clock minute by minute.

  All of it worked. It was deleted anyway, for three reasons worth keeping:

  · **Accuracy the user cannot verify is accuracy not worth holding.** This repo
    already argues the same thing one level down, where it coarsens a geolocation
    fix because "precision the sun cannot use is precision not worth holding".
    Nobody arranging furniture inside a room can tell a correct 4 pm in December
    from a plausible one — and the four presets are the four pictures that
    apparatus existed to produce.
  · **The `Compass` button was measurably dead, not merely doubtful.** Its own
    help text read "On a phone: aim its top edge at the wall at the top of the
    plan and tap Compass", while `NarrowViewportBanner` matches
    `(hover: none) and (pointer: coarse)` and shows phone users a go-away modal.
    The one device that could answer it is the one device the studio refuses.
  · **It cost two device permissions and a stored coordinate pair.** `geolocation`
    and the `accelerometer`/`gyroscope`/`magnetometer` trio are back to `()` in
    `next.config.mjs`, and `Site` no longer has a `lat` or a `lon` — a coordinate
    for the inside of someone's home, held for a feature that is gone, reads as
    something the app keeps about you. See §3 and rule 5 in `CLAUDE.md`.

  **What survived, and where it went.** `lib/solar.ts` keeps `sunDirection` and
  `daylightKelvin` (68 lines, down from 229) — the axis convention and the colour
  ramp, neither of which was ever a guess. `lib/compass.ts` became
  **`lib/bearings.ts`**: the sensor read went and the circular-mean maths stayed,
  because `lib/capture-slots.ts` needs it to average the EXIF bearings of a set of
  room photos. Renaming was not tidying — a module named for the half that was
  deleted is exactly the scar rule 1 of `CLAUDE.md` describes, and the next reader
  cannot tell a deliberate trim from a half-finished deletion. `lib/geolocate.ts`
  is gone. The bearing dial moved out of the lighting mood that consumed it and
  into the Room section, where `lib/storage.ts` had always said it belonged: "a
  property of the room, not of the device".

  **What holds the shape.** `LIGHTINGS` in `lib/store.ts` is an `as const` array
  with the `Lighting` union derived from it, and its consumers are typed
  `Record<Lighting, …>` — so a mood missing from the scene table or from the chip
  set is a compile error rather than an `undefined` row that takes the scene down
  on first paint. `tests/lighting-moods.test.ts` covers what the compiler cannot
  see: a sun preset authored at or below the horizon (selectable,
  plausible-looking, and casting nothing, because `sunDirection` returns null
  there), four presets arriving from one direction, four presets at one height, a
  mood that is somehow both a studio look and a sun angle, and a leftover row for
  a mood that was renamed. It **imports** `LIGHTING` to do that. It could not
  while the table lived in `Room.tsx` — it parsed the component’s source with
  regexes, which tests a transcript of the data rather than the data, and *that*
  is the second reason the table moved to `lib/`. If a check in that file ever
  needs a regex again, the data is in the wrong place. The persist
  config carries a `merge` that checks the stored `lighting` against `LIGHTINGS`,
  because a browser holding the retired `'sun'` would otherwise index a row that
  no longer exists.
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
- **`+ Catalog` is pinned to the bottom edge** and never scrolls away. It
  used to sit mid-column inside the Furniture section. It says *catalog*, not
  *furniture*: the same panel holds doors, windows, curtains, appliances and
  lighting, so the narrower word named about half of what is in there.
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
  room could be rearranged around it, and **Fix** / **Shuffle** are already the other question.
  Four answers: **fits**, **tight** (it goes in, something is tighter than the
  guidelines like), **no room** (and then it says the largest clear rectangle of floor
  the room does have), and **too tall**, which is judged on its own because no
  arrangement of the floor can help with a ceiling.
  Two checks it makes itself rather than reading off the report, both because the two
  have opposite error budgets — a panel must avoid crying wolf, a fit answer must avoid
  a false yes. **Containment** — the report does now have findings for a piece that is
  outside (`outside` / `overhang`, § H.16b), but it asks them through `roomContainment`,
  which forgives `ROOM_FIT_SLACK_MM` — 5 mm a face — so a snapped corner on the boundary
  is not called a defect. This gate is the full `dimMM`; without one at all, a sofa
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
  was the chair at the table's dead centre, since the relation distance is zero and the
  overlap it exempted cost nothing, while the report called that same placement a clash.
  Ranking on cost alone therefore answered "no room" for a chair in a room with a table
  in it, all over again. **That exemption is a TOLERANCE now, not a blanket pass** —
  `TUCKED_CLASH_SHARE` moved to `lib/layout-rules.ts` beside `sharesFloor` itself and
  the overlap term charges the excess above it, so dead centre is no longer free and
  the report and the solver agree about where tucking ends (`lib/layout-settle.ts`
  is a third reader of `sharesFloor` and deliberately consults neither — its own
  bar is a 2% touch epsilon, not a clash test). The ranking here stays as it is: it
  was the right answer for a second reason (the report prices things a single cost term
  never will), and this was only ever one of the three places the missing bar surfaced —
  the others being Room check flagging a solved room, and a scattered search burying a
  chair in 4 of 120 raw solves (8 of 40 counted over the shuffle offer pipeline —
  two harnesses, both named at the overlap term in `lib/layout-score.ts`).
- **The room report offers, it does not just report** (`RoomTools.tsx` `CheckPanel`).
  An earlier pass fixed how the panel *sounds* — findings badged FIX / TIGHT / NOTE
  in tracked caps became "Worth fixing" / "A bit tight" / "Just so you know", which
  is the same information said the way the rest of the product talks. What it could
  *do* was still nothing: it named a problem, offered to select the pieces, and
  stopped. The only way to act was the whole-room **Fix** in the left rail, which
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
  strip holding the searchable, grouped library: drag a row onto the 3D floor, or
  click to drop it at centre. Two triggers open it and both live in `useStudio`
  (`catalogOpen`): `AddPiecesButton` in the right rail's footer and `CatalogToggle`
  in the canvas toolbar. The panel docks on the **right**, the same side as both of
  them — pressing a control on one side to have a list appear on the other is a trip
  across the product.
  **There is no "Describe it" tab, and its worth was kept rather than deleted.**
  A tab beside the library read as a way to reach models the library does not have,
  which non-negotiable 1 forbids and no procedural catalog can do — every piece is a
  `Shape` this app draws and there is no mesh download path. What was real under it
  was `lib/shape-search.ts`, and it is on the ordinary search box now: `rankLibrary`
  scores tokens and folds synonyms, so "couch" finds the sofas and "carpet" the
  rugs, with the old substring match kept underneath as a fallback because a
  half-typed "ward" scores nothing and is still a fine substring of Wardrobe; and
  `sizeFromQuery` reads sizes out of the same words, so "rug 160x200cm" arrives at
  that size, through `clampDims` as always. Each row shows the size IT
  would arrive at, which is not one number for the whole query — a 4 m sofa is legal
  and a 4 m mirror is not. `LibraryPicker` resolves that BEFORE handing the item to
  a host, so the click path, the drag payload, the Shift-marked set and the swap
  modal cannot disagree about what a query meant.
  **A bed was the one shape where a mattress size arrived wrong, and the parser was
  not the culprit.** `parseDims` reads "160x200" as first × second and
  `sizeFromQuery` sends them to `dimMM[0]` and `dimMM[1]`, which is width × depth and
  correct for every shape here — beds included. Five consumers say so: `Inspector`
  labels the three fields `['Width','Depth','Height']`, `BedGeo`'s headboard spans
  `dimMM[0]` with a double's two pillows side by side across it, the bedroom seed
  pushes the bed off the wall by half of `dimMM[1]`, and `dimension-ranges.ts`'s own
  header reads `[W, D, H]`.
  What disagreed were the two DATA tables. The catalog held Single `[1900,1000,600]`
  and Double `[2000,1600,600]` — read under the convention above, a double 2.0 m wide
  and 1.6 m long — and `dimension-ranges.ts` matched them, with `bed-double`'s floor
  at `[1800, 1350, 300]` where the 1350 is a UK double's WIDTH sitting in the depth
  slot. So "queen bed 160x200cm" produced a correct 1600 width that a transposed
  1800 floor then clamped up, and the reported `[1800, 2000, 600]` was a clamp doing
  its job on a table that was wrong.
  Both tables are un-transposed, the ladder is EU standard and every rung 2000 long —
  Single 900, Double 1400, **Queen 1600** (new; it is the size the bug report named),
  King 1800 — and `scene-spec.ts`'s detection default went with them.
  **The comment is the part worth keeping.** It read "a king is WIDER than a double,
  which is `dimMM[1]`'s job", and that sentence is why the transposition survived
  being looked at: the wrong belief was written down beside the numbers it produced,
  so every reader who checked the numbers against the comment found them consistent.
  A 2000×1600 "double" also renders as a plausible but OVERSIZED bed rather than a
  broken one, which is the other half of it — 1600×2000 and 2000×1600 are both
  plausible bed numbers. `tests/shape-search.test.ts` asserts the fixed behaviour on
  a **single** as well, because 900×2000 transposed is 2.0 m wide and 0.9 m long and
  that is not a bed at any glance: the asymmetric fixture is the one that cannot hide
  the defect.
  It was two surfaces until they were merged: a 520px modal from the rail over
  `PART_LIBRARY` + product presets, and a canvas strip over `PART_LIBRARY` alone.
  Same feature, two component trees, **two different item lists** — and only the
  strip could drag onto the floor while only the modal could take a described
  piece. The strip won because a modal covers the room you are placing furniture
  into, which is also the drop target. `LibraryPicker.tsx` now owns the one list and
  takes `columns` / `draggable` / `initialQuery`, so the dock and the swap modal
  cannot drift apart
  again. `draggable` is **off on the 2D plan**, which has no drop handler — a drag
  that cannot land is worse than no drag.
- **Changing which model a piece uses is ONE surface** (`RegenerateModal.tsx`),
  reusing the same `LibraryPicker` as the Add flow and seeding its search with the
  piece's own name through `initialQuery`, so opening it on something called "office
  chair" is already showing office chairs — which is what the deleted Describe-it
  tab did with the same string. It was two
  buttons — "Swap model" and "AI refine" — which were the same feature twice, and
  the second advertised an AI that does not exist here: matching is local token
  search (`lib/shape-search.ts`), instant and offline. The modal hands the swap
  back to the caller, because re-grounding the piece for its new dimensions and
  mount type is physics the Inspector owns.
- **One-tap themes** (`lib/themes.ts`) — recolour all unlocked parts + set a
  matching lighting mood. **Four, not five**, and the chip reports the colours
  rather than the mood. Both halves answer one report: "some of the lighting and the
  style override each other". The override was real and mutual — `activeTheme`
  tested `t.lighting === lighting` alongside the colours, so moving the light
  UNTICKED the theme while the room stayed every colour that theme had painted it,
  and the section header stopped naming it. Pressing a swatch moving the light is the
  feature (one tap, whole look) and is legible now that both controls sit in the same
  section; the reverse never was. The merge took `Coastal` and `Studio Loft` — two
  of the five offering the same `cool` mood — into `Cool Neutral`, keeping Coastal's
  sage accent and Studio Loft's charcoal case goods.
  **One claim about that merge was wrong and the measurement is in
  `tests/themes.test.ts`.** The reason given was that the two were near-duplicates
  on colour as well as on mood; mean `deltaEOk` over the tones each theme applies
  puts them at 0.304, the third most DISTINCT pair in the original five, while the
  closest pairs are `warm-min`/`coastal` at 0.073 and `heritage`/`afro-mod` at
  0.078. The metric is the wrong instrument rather than the set being wrong — it is
  dominated by lightness, so two pale palettes score as similar even when one is
  beige and the other sage, which is a difference anyone sees instantly because a
  whole-room hue shift is loud at a small per-colour distance. So the merge stands on
  the lighting overlap, which is the half of the report that was about overriding, and
  the test pins the thing that needs no threshold: no two themes may paint the same
  room. A tuned threshold is a record of today's palette wearing a gate's clothes.
  The mood criterion is **not** fully satisfied by the surviving set: `Warm Minimal`
  and `Afro-Modern` both set `day`, at 0.266 — closer than the merged pair — so the
  Lighting row still offers one mood twice. Left as-is because four swatches is the
  fit ceiling, and recorded because the rule the merge was made on would take that
  pair next.
- **2D plan** (`PlanView.tsx`) synced with the 3D scene; export via
  `lib/plan-export.ts`. It is a peer of the 3D view rather than a lesser copy of
  it: a drag resolves through the same pipeline (see **One resolve, two surfaces**
  below), a left-drag across empty floor is a **marquee**, Shift-click extends the
  selection, Alt-click disambiguates, `Esc` mid-drag puts the piece back, the
  library's rows can be **dropped** onto it at the pointer, and it measures the
  clearance to the nearest wall on each axis while you move something. Its
  controls (rotate handle, focus ring, wall grab bands, labels) are counter-scaled
  by `1 / zoom`, so they stay the size they were drawn at instead of becoming a
  4-unit dot at 0.4x and a 36-unit blob at 4x. Pieces are painted **largest
  footprint first** (`planPaintOrder`), so the rug ends up under the table and
  "what a click selects" stops depending on the order furniture was added in.
  `H` hides a piece from the plan exactly as it hides one from the 3D tree —
  before that it was a no-op here, on a key armed for both tabs. (It was `V`, the
  modelling-tool convention; the word on the menu item, the tree's tooltip and both
  help cards is "Hide", and a mnemonic that matches the label beats one borrowed
  from software this app is not.)
- **Snapshot** (`lib/snapshot.ts`) — PNG of the 3D view (replaces the deleted
  photoreal render).
- **The scene file** (`lib/scene-file.ts`, `components/studio/SceneFile.tsx`) —
  `Save file` in the top bar writes the whole room as readable JSON
  (`front-room.danmu.json`); `Open a file` on `/workspace` lands one as a **new**
  room. See §6a — it is the app's only import path, and therefore its only
  untrusted input.
- **Undo/redo** (`lib/history.ts`, `UndoRedo.tsx`) — snapshots cover parts, room
  and transforms. **The unit of an undo step is the gesture, not the debounce
  timer.** Mid-drag the store is deliberately half written: the 3D tab animates the
  piece under the hand as an object3D and writes its override only at the drop,
  while the convoy's members go through the store on every legal frame. A snapshot
  taken in that window records the company moved and the piece under the hand still
  at home — a room that never existed — and one Ctrl+Z afterwards restored it, which
  is what "drag a lamp and a side table, undo, and only the side table comes back"
  was. The 250 ms debounce cannot fix it, because a pause longer than the debounce
  IS the window; a single-piece drag was immune only because `setTransformsFor([])`
  returns `{}` and the subscription never fires. So `scheduleSnapshot` refuses while
  `draggingId` is set and the subscription snapshots on that flag clearing — both,
  because the two tabs order the release differently and each half covers one of
  them.
- **Item-to-item snapping** (`lib/item-snap.ts`), and its **alignment guides draw
  in both tabs**. `resolvePlacement` has always returned the lines that fired and
  `MeasureGuides.tsx` has always drawn them in 3D; the plan dropped them, so the tab
  whose whole premise is that the dimensions are real snapped pieces into line with
  nothing on screen to say what they had lined up with. `PlanView` keeps them on the
  drag ref — written from `moveTo`, which is the only thing that knows which of its
  three candidate moves was accepted — and draws them under the wall measurements.
  The two greens are `--snap-edge` / `--snap-center` for the plan (SVG in the
  document, so it reads tokens) and `SCENE.snapEdge` / `.snapCenter` for the scene
  (a Three.js material cannot), pinned to each other by `tests/color-tokens.test.ts`
  like every other pair in §"Two layers".

### One resolve, two surfaces — `lib/drag-resolve.ts`
Where a dragged piece ends up: grid snap → containment clamp → wall snap
(wall-mounted) or magnetic item snap → gravity/support → vertical clamp → exact
OBB collision. It
lived inside `Draggable.tsx` and was therefore 3D-only, so the plan ran its own
much shorter version — clamp into the bounding box, then `collidesAt`. The same
gesture on the same sofa behaved differently depending on which tab you were
looking at: the snap setting did nothing to a mouse drag in the plan, edges never
went flush, a merged group did not move as one, whatever was resting on a piece
stayed behind, and dragging a vase off its table left it **floating at table
height** — invisible from directly above, which is the one view where you cannot
see it.

Both surfaces call it now, and `snapSteps` is the single home for the 10 mm / 15°
and 50 mm / 45° increments the gizmo, the drag magnetism and both sets of arrow
keys share. The grid snap is the *first* step and lives inside the resolve, so a
caller passes the pointer position unrounded — it had been left behind in the 3D
component's pointer-move handler when the rest of the pipeline moved out, which
meant the extraction that existed to end "snap works in one tab only" shipped with
snap working in one tab only. It is quantised before the clamp on purpose: rounding
a clamped edge afterwards would push the piece back through the wall the clamp had
just pulled it out of.

**The legality test has no exemption for wall-mounted pieces any more, and that was
§ H.16.** It used to open `ridesAWall ||`, on the stated grounds that `snapToWall`
had "just placed it exactly on an edge, so the exemption is EARNED by that snap".
`snapToWall` says in its own comment that it does no such thing when the piece is
wider than the wall it landed on: it **centres it and lets both ends hang past the
corners**, deliberately, because shrinking it is what rule 2 forbids. (`snapToWall`
adds "and `clearance.ts` is what says it does not fit", and **that half was false** —
`clearance.ts` emitted door · entry · clash · walk · zone · window · tv · tall ·
crowding · reach · cut-off · turning, none of which was *outside the room*, and
`freeFloorShare` discards the outside portion rather than reporting it, so a sofa half
out of the room read as a room with MORE free floor than it has. The claim was repeated
into two more files before anyone checked it. `outside` exists now — § H.16b — and the
sentence is true for the first time, because the drag and the report **share** the
containment predicate (`roomContainment` in `lib/footprint.ts`) rather than one of them
having been taught to agree.) On a rectangle those ends hang over the next
wall's floor and nobody notices. On an L, a T or a U they hang into the missing
quadrant — outside the room — and the drag committed `valid` with no red and
nothing said. Reported as *"models are still going through walls in 2d plan mode"*,
and it was never the plan: both tabs end here.

It was **deleted rather than repaired**, because it measured as pure hole — an A/B
scored in one run rather than an inference from the escape count. Over every pair in
`PART_LIBRARY` at min/mid/max size, five layout ids, three angles and 35 targets —
66,150 placements — the catalogue accepts **55,528** with the exemption and **54,958**
without: removing it costs **exactly** the 570 that were leaving the room — 311
curtain, 196 window, 45 painting, 18 TV, i.e. *wider than the wall it landed on*
rather than a property of curtains — and not one placement besides. Five of the nine
riders in the catalogue (`door`, `ac/ac-unit`, both mirrors, `tv/soundbar`), the ones
that sit in or on the plaster and are the reason such an exemption gets written, pass
the polygon test on their own merits at all 1,575 samples each; the inset was already
doing that job for everything else — and it is **5 mm per face**, not the "10 mm" four
documents used to say, because it subtracts 10 from a dimension in millimetres and
`obbFromPart` then halves it. A predicate that needs a carve-out per shape is the tell
§3 names, and this one had grown its justification after the fact.

`tests/wall-rider-containment.test.ts` is the sweep, and two things about it are the
finding rather than the plumbing. It **enumerates `PART_LIBRARY`**, because the first
version enumerated `CATEGORIES` with a hand-written shape per category and therefore
could not see `other/window` — 196 of the 570, the second largest escaper — a
wall-riding SHAPE under a category that does not ride, since `anchorFor` reads
`ANCHOR_BY_SHAPE` before `ANCHOR_BY_CATEGORY`. That version reported the cost as 374,
and measured `ac` as a *box*. And its oracle is now a **second implementation** of the
corner maths rather than the repo's: the previous one reduced to `obbInsidePoly` by
function identity, so `valid ⇒ inside` was a theorem, and turning `pointInPoly` into
`return true` left the escape assertion green with zero escapes. It also carries its
positive half — riders are still accepted everywhere they fit — because
`valid = false` for everything would satisfy the negative half alone. What stays in the components is only what is genuinely theirs: the 3D
view reads a live mount height off the object3D it is animating, the plan reads
it off the stored transform, and each decides for itself what to say when a spot
is refused. **A new snap, clearance or gravity rule goes in the lib** — this is
the same "two consumers, one rule, two copies" failure that `layout-rules.ts`
exists to prevent, and `tests/drag-resolve.test.ts` pins the pipeline step by
step so a change that suits one surface fails there first.

### Who travels — `lib/drag-convoy.ts`
`drag-resolve` answers *where the dragged piece lands*; this answers *what comes
with it*. Three kinds of company, and they are not the same rule:

- **rigid children** — what is physically resting on the piece. Carried by
  `cascadeTransform` about the dragged piece's own pivot, so a lamp on a turning
  desk turns too.
- **merged-group siblings** and **the rest of the multi-selection** — one rule:
  translate rigidly by the delta the dragged piece *accepted*, each from where it
  stood at pointer-down.

They were three implementations. The merged-group loop was written out twice, in
`Draggable.commit()` and in `PlanView.moveTo`, and the multi-selection was
implemented in neither — shift-clicking four chairs and dragging one moved that one
chair, in both tabs. The report it produced was **"sometimes only one moves"**,
because a merged set does move as one and looks identical on screen to a selected
one. Two features that render the same must not be two code paths.

`planConvoy` resolves membership once at pointer-down — re-resolving per frame lets
a piece near a tolerance detach mid-gesture, the trap `wallAttachments` documents
for walls. The merged-group closure over the SELECTION was removed, and
`selectionForPick` holds that rule instead, so a click takes the whole merged set
while a drag carries exactly what is selected. Half a merged set is reachable, on
purpose, and only from the layer tree. It does still close the group over pieces the
**rigid** path picks up, and that is not the same rule wearing a hat: "a merged set
is already selected whole by a click" is a statement about the selection and says
nothing about a piece that came along because it was physically resting on the thing
being dragged. Without that closure, dragging a desk with one half of a merged pair
standing on it split the pair — from a gesture that never touched the selection at
all. A rigid child is not a selection, so closing the group over it overrides
nobody's. `resolveConvoy` then puts every member through `resolvePlacement`, which
buys two things and costs one:

- **Gravity is re-asked**, so a member translated off the table it stood on lands
  on the floor rather than hanging at table height — and can equally ride *up* onto
  something it arrives over, exactly as a single dragged piece does. Vertical
  rigidity is not a promise a drag here makes.
- **A member that cannot follow makes the whole step invalid**, and names itself.
  The set refuses as a unit instead of deforming or pushing a piece through the
  plaster (rule 2, for position), and the piece that refused is not the piece under
  the hand — so the spoken sentence names the member, and the red outline goes to
  the member AND to the piece being dragged. Only the member is the true answer,
  but it can be hidden by a filter or off the side of the pan, and a refusal with
  nothing visible reads as the drag being broken; the piece under the pointer is
  the one outline that is always on screen. **Both tabs do this**, and until
  recently that sentence was simply false: 3D named the member in the size tag over
  the dragged piece and stopped there — no spoken sentence (there was no
  `announce()` anywhere under `components/three/`) and no outline on the member, so
  the piece actually in trouble could be off-screen with nothing pointing at it.
  Both now ride the live channel: `blockedBy` is the one name for the sentence and
  the tag, `blockedIds` is every refuser for the drawing. They are separate fields
  because they answer different questions — a sentence naming four pieces is a
  sentence nobody finishes, while an outline that names one sends the user to fix
  them one at a time and makes the refusal look like it is wandering round the room.
  Each `Draggable` reads `blockedIds` through a per-part selector, so a frame that
  changes nothing re-renders nothing, which is the promise that keeps this channel
  out of `useStudio`.
- The cost is one resolve per member per frame, which is why the components hold
  the convoy in a ref and both write their result through one `setTransformsFor`.

**The caller declares the gesture; the delta is not asked.** `resolveConvoy` takes
`gesture: 'move' | 'turn'`, and a `'turn'` translates the company by exactly zero
however far the dragged piece ended up from where it started. It used to infer this
from `pos - startPos`, which looks equivalent and is not: the containment clamp
bounds a piece by `extX`/`extZ`, and those are functions of ROTATION as well as
size, so turning a 2 m sofa that stands against a wall pushes it off that wall — a
real, correct positional delta produced by a gesture that translated nothing. The
set copied it, and a chair selected alongside a sofa turned to 45° travelled 575 mm
across the room and was persisted. 3D reads the gesture off the gizmo (a raw pointer
drag is always a move); the plan's rotate never enters `resolveConvoy` at all — it
writes the angle and cascades the dragged piece's own rigid children, which it had
not been doing either, so turning a desk up here left the lamp on it behind.

Two traps in there, both silent. `collidesAt` looks the mover up in the list it is
handed and returns **false** when it is absent, so a world with the mover filtered
out reports every position as clear — collision detection off, nothing logged. That
is why every mover's world comes from `travellingWorld(convoy, parts, dx, dz, carried)`
and never a `.filter` at the call site — one function for the dragged piece and the
members both. It SHIFTS the travelling company to its destination instead of deleting
it, and a deleted travelling support is a piece resolved onto the floor and persisted
there. The fifth argument is the opposite operation and is not a contradiction of the
first: `carried` is the mover's OWN rigid children, which ride it, so they must not be
able to obstruct it or — the half that bit — be its floor. Callers pass `convoy.own`;
`resolveConvoy` passes `[]` for the world every member shares. Pass the ATTEMPTED delta when resolving the dragged piece and the ACCEPTED
one for members. And a member resolves with `snapMode: 'off'`: its own magnetism would
pull it out of formation, and the grid would re-round a delta the dragged piece has
already committed to. `convoyRestore` is the Escape path — it replays the pure
cascade from the start transforms rather than snapshotting a second copy of them.
`tests/drag-convoy.test.ts` holds all of it, including both traps as behaviour
(a collision that must still be seen, a snap that must not fire) rather than as
array shapes.

Two properties of a `ConvoyMove` that read as details and are not:

- **`rot` is optional, and absent is different from equal.** `setTransformsFor`
  writing a rotation *creates* an override in `useStudio.rotations`, and per
  `lib/transforms.ts` an override pins that value against a re-detect and persists
  into IndexedDB and the scene file. A member translates and does not turn, so the
  field is omitted unless the resolve really changed it — which for a member means
  a wall rider `snapToWall` re-aimed, since `snapMode: 'off'` leaves `outRot`
  alone for everything else. `convoyRestore` carries the same asymmetry, or Escape
  would leave behind exactly the override the resolve avoided.
- **`blocked` only counts if the caller says it.** It was computed in both tabs
  and spoken in one: the plan outlined the member and named it, while the 3D tab
  stopped the set dead with a red tint and no explanation. The name travels on
  `DragLiveInfo.blockedBy` now and appears in the size tag `MeasureGuides` already
  draws — set only when the dragged piece itself fits, because if the thing under
  the hand is the problem then `blocked` is the honest word and naming a member
  points at the wrong piece.

### The click a drag ends with — `lib/drag-click.ts`
A 3D drag that moved finishes as a DOM `click`, and `Pickable`'s click handler
means *select just this piece* — so the click ending a multi-piece drag collapsed
the selection the drag had just carried. Invisible for a single selection (already
selected) and for a merged group (whose plain click re-selects the whole group),
which is the other half of why the bug reported as "sometimes only one moves".

**The gate takes no part id, and that absence is the design.** Asking "is this
flag mine?" and clearing it either way let a click that raycast onto a different
piece consume the flag, get `false`, and select itself. It is reachable: the
dragged piece follows the pointer, but a rug dragged under a table ends up behind
it. `Pickable`'s `gestureOwnedByOther` guard cannot cover it either, because
`Draggable` releases the pointer capture and clears `draggingId` before the click
is dispatched. A drag is not a click on anything.

Module state rather than a store field: written and consumed inside one event-loop
turn, nothing renders from it, and a store write would re-run every selector
between the pointerup and the click. Outside the store it is also testable in
plain node — importing `lib/store.ts` pulls in zustand's `persist` and needs
localStorage. `tests/drag-click.test.ts` reads the flag's initial value **at
import**, because a `beforeEach` reset hides a module that started armed, and one
that did would swallow the first click of the session.

### The press the gizmo takes — `lib/gizmo-press.ts`
Reported as *"I selected bed to rotate but the rotate control overlaps the
nightstand and it ended up moving the nightstand."* The gizmo is not doing
anything wrong; the same press is simply **delivered twice**.

**R3F cannot see the gizmo.** It raycasts `internal.interaction` — the objects
that carry event handlers — and drei's `<TransformControls>` is a `<primitive>`
with none, so the ring, the arrows and the planes are transparent to picking. A
press aimed at a handle goes straight through to whatever furniture sits behind
it, and that piece starts a direct drag of its own.

`Draggable.onPointerDown` already has three guards that would refuse it —
`gizmoActive`, `_gestureOwner`, `gestureOwnedByOther` — and **every one of them
reads state the gizmo sets in its `mouseDown`, which has not happened yet.** Both
listen on the same element (drei passes R3F's `events.connected` as the controls'
`domElement`), R3F registered it at Canvas mount and the controls when the piece
was selected, so R3F's dispatch is always first. *Ordering, not logic, was what
was missing.*

So the claim is **undone rather than pre-empted**. Nothing the press set up has
moved anything yet, so `claimPressForGizmo()` in the gizmo's own `onMouseDown` —
microseconds later, same DOM dispatch — hands it back and the drag never starts.
Order-independent by construction: were the two ever to swap, `gestureOwnedByOther`
catches it instead.

**Asking the gizmo beats hit-testing for it.** The alternative was a capture-phase
listener re-running the gizmo's hover test at the press point. It would work, and
it is worse: it reads `axis`, `dragging`, `enabled` and `pointerHover`, all
declared `private` by three-stdlib — a cast today and a silent no-op the day one is
renamed. `onMouseDown` is drei's own prop, fires only when `pointerDown` found an
axis, and three-stdlib re-runs `pointerHover` at the press point first, which is
what makes it right for a **finger** too, where there is no previous hover to read.

The click gate is the same shape as `lib/drag-click.ts`'s and takes no part id for
the same reason. It is armed **even when the press held nothing** — a ring over
bare floor, or over the turned piece's own body, still ends in a click, and on the
piece itself that is not harmless: a plain click is `selectionForPick`, which
drills *into* a merged group.

**Where the two gates are NOT the same rule is lifetime, and that is where the
review found most of what was wrong.** `drag-click` arms on pointer-UP, so any
later press is necessarily a new gesture and may clear it unconditionally. This one
arms on pointer-DOWN, so a second pointer landing mid-rotate reaches `Draggable`
while the gate is doing its job — the clear is conditional on no gesture being in
flight. For the same reason the HOLD is given back the moment the press becomes a
gesture (the touch pick-up, and both places `started` is set): the claim is lossless
only because nothing has happened yet, and a hold left standing into a live drag is
a teardown waiting to run on a gesture someone is in the middle of. And the gate has
**three** consumers, because a ring sweeps over three kinds of thing — `Pickable`
for furniture, `RoomShell`'s wall, `Room`'s `onPointerMissed` for bare floor.
Furniture alone left it armed with nothing to take it whenever a rotate finished
over plaster or air, and an armed gate outlives its gesture.

**The 2D plan had the same defect by a different mechanism**, which is why the
handle now draws in a layer of its own after every piece. `planPaintOrder` sorts by
footprint area **descending**, so the smallest piece paints last and sits on top: a
nightstand's filled rect covered the bed's turn handle, and SVG hit-testing gives
the press to whatever is topmost. Inside the parts loop that control could never be
above the furniture, because it was drawn at its own piece's depth.

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
| `lib/scene-spec.ts` | **Single source of truth** — `Shape` union, `ScenePart`, `PART_LIBRARY` (the one catalog — the old "Real sizes" preset sheet was dissolved into it: duplicates deleted, beds and fridges kept as proper entries in their own groups), `defaultScene` starters, parametric/decor/support flags, DnD MIME. `defaultScene` is authored against `lib/room-bays.ts`, in each wall's own frame (`u` along it, `v` out from it) rather than in room coordinates: a rectangle reads as it always did, an L furnishes its leg and its wing, and a footprint whose walls the user has dragged is furnished as it now is. Every seeded piece is **gated on fitting** — whole footprint inside the room, clear of what is already there — so a room too small for a sofa gets fewer pieces, never a smaller sofa. What a shallow room gets instead is **different furniture**: `SCREENS` picks the largest real panel (65″ / 55″ / 43″, all three in the catalog) whose own 1.2 × diagonal minimum fits the distance the wall can offer, a bed comes off `BED_LADDER` — Queen 1600 / Double 1400 / Single 900, EU standards and every rung 2000 long, so **width is the only axis that separates them and a bed that will not work in a bay cannot be fixed by shortening it** — and a dining table with no room for 900 mm of pull-back on both sides goes against the wall and seats three — a real arrangement, not a fault (`layout-rules`’ `seats` rule is `atLeast: 3` of four sides), and one the plan search below now avoids needing wherever the room has a wall that seats four. The living group also takes the bay with the **viewing depth** rather than the most floor, and leaves a route behind the sofa where the bay opens onto another group — circulation over screen size, the same order `layout-score`'s weights give it. Gaps come from `layout-rules`' bands, sizes through `clampDims`, heights through `groundY`; all five presets seed with an empty room report. **The openings go in first** (`lib/room-openings.ts`) and everything else is arranged against them: the screen takes neither the door's wall nor a window's, the wardrobe takes a cross wall without a window, a door's swing and the route in from it are floor nothing may be seeded onto, and the living group is placed by searching **along** its wall rather than centring on it — because a seat centred across a 2.42 m alcove seals it, and a door on the *next* wall reaches round the corner far enough to refuse a sofa the app then simply did without. Then it is **dressed** — a picture over the sofa or bed, curtains at every window, a pendant over the dining table, a lamp on each nightstand — all wall- or ceiling-mounted, so `isObstacle` is false for every one and the dressing costs nothing in floor, routes or access zones. Finally the whole arrangement is **searched, not merely built**: the choices the seeder cannot make well in isolation (which wall a group backs onto, which bay the living group gets) become a `SeedPlan`, `enumeratePlans` returns at most thirty-two of them — one, and no search, for a room with a single usable viewing wall — each is built in full, and `costBreakdown` with the navigation term on picks the winner. A piece that could not be placed is charged what a piece nobody can reach is charged, so a tidy empty room cannot win. Plan zero is always the greedy plan, so the search can only return that room or a better one. A seeded seat is also **turned toward the group it belongs to**, not merely put at the right distance from it: `relationCost` charges a `faces` relation twice — once for the gap, once for the heading — and the seeder answered only the first, which was the entire relation cost of the L. Its armchair sat 2.355 m from the sofa inside a 1.2–2.6 m band, dead centre, and was charged 0.479 for sitting square to its own wall with the sofa 43° off its nose; `Suggest` could then only answer by shoving a chair that was already in the right place, up to 735 mm, at every seed. The turn is derived per candidate spot rather than chosen, so `seats` tests the footprint the chair will actually have, and `place` wraps the composed rotation to (−π, π] — a frame on the −π wall plus a turn away from the room had been producing −188°, the right rotation written wrong. The L's starter cost fell 10.8 → 4.4 and the other four presets did not move.  **Which rung is chosen before which wall, and not on cost.** The plan search scores whole candidate rooms, and `DEFAULT_WEIGHTS` has no opinion about bed size — measured at the U's 8 x 7.5, all three rungs place thirteen pieces with navigation 0.0 and totals of 4.31 / 4.29 / 4.28, so the bed was being decided by 0.7% of a total that says nothing about beds, and 8 x 6.5 gave a Queen where 8 x 7.5 gave a Single off the same ladder. So `SeedPlan.bedRung` is resolved in two stages: **the widest rung whose best plan places the bed and strands nothing** (`navigation === 0` is the definition of stranding nothing, not a tuned threshold), and failing that **the widest rung that places a bed at all**, with `clearance.ts` left to report the route. The second stage is rule 2 of `CLAUDE.md` where nobody had applied it: dropping the piece is the limit case of silently resizing it to fit, and the one form of it the user cannot see — a stranded route is a warning they can act on, a missing bed is absence. Before it, five U sizes seeded no bed at all, because `missing` charges an absent bed the same `STRANDED_PIECE` as an absent nightstand and a bedless 484.06 beat the best bed-bearing 496.95. It is **not** monotonic in room size and that is measured, not hoped: thirteen of eighty-one steps still give a bigger room a narrower bed, because whether a rung strands floor depends on all the other furniture and a deeper bay fits more of it. `tests/bed-ladder.test.ts` ratchets that count and prints the list.|
| `lib/parts-catalog.ts` | Room defaults + catalog data. |
| `lib/scene-store.ts` | Scene parts CRUD + grouping. |
| `lib/storage.ts` | IndexedDB room persistence (`RoomData`, `wallColors`, `footprint`, per-room `hidden`, `version`). Deleting a room is a **soft delete** — keys move under `trash:{ts}:` and `restoreRoom` undoes it; `purgeTrash` expires them after 30 days and `destroyRoom` is the irreversible path. A `room:{id}:touched` key carries the real `updatedAt`. **`meta` is retired first on delete and written last on restore**: there is no transaction across keys, and `listRooms` decides visibility from `meta`, so ordering it this way makes the visible state flip exactly once instead of leaving a room that appears in the workspace and opens empty. `restoreRoom` refuses when a live room already holds the id. Each detection carries a `uid`, which becomes its ScenePart id so a user's transforms survive a re-detect; records written before that fall back to the positional `${category}-${n}`. `reslotCaptures` moves the whole set of wall photos in one operation, for three reasons that each cost something: the WHOLE record travels (the pairwise swap it replaces re-wrote `{ slot, blob, takenAt }` and silently dropped `pose`, so reordering photos threw away the focal length, the tilt and the bearing — `pose` being optional is what let it typecheck); writes precede deletes (a vacated key that outlives its write is a duplicate the user can delete, a deleted key whose write never landed is a photograph that is gone); and a mapping that would land two photos on one wall is refused rather than absorbed. |
| `lib/scene-palette.ts` | Scene-side semantic colours — the one home for values the 3D layer, the canvas exports and the panels that edit them must agree on, since neither Three.js materials nor a 2D canvas can read a CSS custom property. Exports `SCENE` (selection / hover / locked / shell), `PLAN` (the floor-plan PNG's palette) and `defaultBodyColor(category, shape)`. Kept in sync with `globals.css` by hand, guarded by a test. **`defaultBodyColor` takes BOTH arguments**: within one category the shapes do not match (a dining chair is walnut, an office chair charcoal), and the renderer and the Inspector's "Default for this piece" swatch must return the same value. The predecessor took a single loosely-typed `category` and was keyed on material-group names, so 18 of 22 categories fell through to one tan default. It also carries **`DETAIL`** (the outline every `Box` draws, dark walnut legs, near-black hardware) and **`DECOR`** (the book / pot / vase / pillow sets `Dressing` scatters) — not recolourable, so deliberately out of `defaultBodyColor`, but each was a literal repeated across renderers, which is several values pretending to be one. There were literally two book palettes, six spines in `Dressing` and eight in `BookshelfGeo`, so the books on a shelf did not match the books beside it. A test now scans `components/three/*.tsx` and fails on any hex this module owns, shorthand included. |
| `lib/fit-check.ts` | **Will this actually fit?** `checkFit` seats one candidate with everything else locked and reports one of four answers with the room report's own reasons. Pure; see §5. |
| `lib/transforms.ts` | **Which of the two transform layers wins.** `resolvePart` / `resolveParts` merge the authored transform on `ScenePart` with the user's `useStudio` override, and this is the ONLY place that fallback is written — see below. Pure, no React, so the scene file and the wall mover resolve exactly the way the renderer does. It is no longer the whole answer to *where a piece actually is*: see `lib/rider-height.ts`. |
| `lib/rider-height.ts` | **Where a piece actually is**, which is the merge above plus one thing neither layer holds. A piece standing on a piece the user RESIZED has a stale Y in both — `setDim` settles nothing — so it is derived at read time and never written back (§ 12; a derived Y written into the override map becomes the rider's stored position, and the next read compares it against the AUTHORED support top and concludes the piece rides nothing). `resolveScene` is what any consumer rendering or exporting the room calls, and `tests/room-scene.test.ts` pins the three files still allowed to call the plain merge. The relation is REMEMBERED, not re-derived: `parentIds` unioned with `ridingParents` over the AUTHORED parts, honoured unconditionally when a drag recorded it and gated on the support's top having moved when it is merely inferred — plus `pos[1] <= 0` meaning *on the floor, riding nothing*, which is what makes the Inspector's **Floor** button stick. `riderYs` caches on reference identity because `Room.tsx` mounts a `Draggable` and a `Dressing` per part and both read it: uncached that was `2N + 8` whole-room derivations per store write, 14.3 ms per drag frame at 60 parts. Built and reverted twice before this; `docs/what-is-still-open.md` § 12 carries both defect tables. |
| `lib/room-scene.ts` | The React half of the above: `useRoomScene` (whole scene, memoised), `useRoomPart`, `usePartTransform` (one part, narrow subscription, for `Draggable` and `Dressing`), `useHasOverrides`, and `currentRoomScene()` for pointer handlers. The row here used to say "build a scene from a room / detections", which is `scene-spec`'s job, not this module's. |
| `lib/textures.ts` | Procedural normal/roughness maps (offline, zero assets). |
| `lib/light-units.ts` | Lumens → candela (isotropic and in-cone), and kelvin → sRGB via the Planckian locus. Pure and tested — the interface between how a lamp is described and how three renders it. |
| `lib/themes.ts` | One-tap restyle palettes — four, each a different room. |
| `lib/capture.ts` / `lib/image-quality.ts` / `lib/color-sample.ts` | Photo capture + quality + colour sampling. `capture.ts` also owns **photo normalisation**: every photo entering the app is re-encoded to ≤1600 px on its long edge (`normalizePhoto`) and screened against a raster allowlist (`isAcceptedPhoto` — `image/*` also matches SVG, which has no pixels to measure). Nothing downstream wants more resolution, and four untouched 12 MP uploads exceeded the detection endpoint's inline-request ceiling. It also **strips metadata** on the passthrough path via `lib/jpeg-strip.ts` — see §3. `readCaptureFacts` is the one EXIF read, returning two things with two lifetimes: the `pose` persisted onto the `Capture` for as long as the room exists, and the transient facts that decide which wall this is and are then dropped. It MUST run on the original file — the strip destroys exactly what it reads, which is the point of the strip. |
| `lib/jpeg-strip.ts` | Removes EXIF (APP1), IPTC (APP13) and comment segments from a JPEG by byte surgery, so the image data is copied verbatim and the passthrough optimisation survives. Keeps JFIF density and the **ICC colour profile** — neither identifies anyone, and dropping the profile would shift the colours this app exists to get right. Returns the input untouched for anything it cannot parse: a photo that kept its metadata is a smaller problem than a photo we corrupted. **Read anything you need out of EXIF before calling it** — the focal length a future calibration pass wants lives in the segment this deletes. |
| `lib/color.ts` | Colour arithmetic: WCAG contrast, and OKLab as a space where "same colour" means something. `globals.css` states a ratio next to almost every token and `CLAUDE.md` turns those into a rule, but nothing checked any of it — a comment claiming a ratio is a comment. It also lets `scene-palette.ts`' hand-copied duplicates be compared perceptually rather than by string equality, which is brittle one way and blind the other. |
| `lib/drag-live.ts` | The high-frequency drag channel, deliberately **outside** `useStudio` — see §5. |
| `lib/scene-file.ts` | The `.danmu.json` scene file — build, serialise, and defensively parse. The app's only import path and so its only untrusted input; see §6a. `buildSceneFile` bakes the studio's transform overrides so the file holds one truth per piece, and `parseSceneFile` never throws: it returns a reason, or a file plus the list of what it dropped. Its filename comes from `exports.ts`' `fileSlug`. |
| `lib/exports.ts` | **What to call a file the user is taking away** — `fileSlug` and `snapshotFileName`. The three downloads each named themselves: the scene file slugged the room's name with a length cap, the export menu slugged it without one, the floor plan did not slug at all — it was `floor-plan.png` every time — and the 3D view was the last holdout, a fixed `room-snapshot.png` that was the same for every room, so exporting three rooms left three files the browser silently numbered `(1)` and `(2)`. The cap earns its place too: a 300-character room name produces a filename the OS may refuse to write, which surfaces as a download that did nothing. Two things are deliberately NOT here — the furniture CSV (retired; see the top bar above) and the transform merge (that is `lib/transforms.ts`, enforced by `tests/room-scene.test.ts`). Tested in `tests/exports.test.ts`. |
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

The room grid's first tile is **New room**, in the first recency group, where a new
room would land anyway. Making a room is what this page is for and its only control
sat in the far corner of the bar — a diagonal across the whole viewport from where
the eye starts. Deliberately not a second `--primary`: the bar's `New Room` keeps
that claim, and this is the quiet empty slot beside the rooms that exist. It hides
while the filter is on, because a filtered grid is a set of search results and
"create" is not one of them.

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
a broken footprint falls back to the layout preset; **an out-of-range ceiling is
clamped into `ROOM_HEIGHT_M` and named**. Every one of those is reported in
`dropped`, which the import toast shows and makes sticky. Refusing a whole file over
one bad field would make a version skew unrecoverable — and pretending nothing was
lost is the other failure.

The ceiling is worth naming because it was the exception, and the exception cost a
room. It was fatal for the whole file, and this app had *written* rooms that the
1.8 m floor rejects: the dimension editor gated every axis with the side range until
`ROOM_HEIGHT_M` existed, and the ceiling-fan bug that prompted that range was
reported from a 1.65 m room. Saving such a room and opening it again answered "that
room file is missing its room" — a message naming the wrong problem, about a file
this app produced, with no way forward. A ceiling was also the one *dimension* in the
file treated as fatal rather than lossy, while every imported part size next to it
was already being clamped by `clampDims`. Width and depth stay fatal, and the
asymmetry is deliberate rather than left over: a width of 0 is not a room with odd
proportions, it is no floor to stand furniture on. `Infinity` stays fatal too — the
`1e400` case above — because clamping it would quietly turn a corrupt file into a
legal 12 m ceiling, which is the one place where lossy would be dishonest.

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
- **All** furniture is procedural, by design rather than by omission: a piece is a
  `Shape` this app draws. There is no mesh download path and no mesh cache.
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

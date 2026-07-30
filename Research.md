# Danmu — Engine Research & Improvement Study

> Written 2026-07-30 against `main`. Companion to [`Design.md`](Design.md), which
> describes what the system *is*. This document describes **how it works
> mechanically**, **where the maths is weakest**, and **what the current
> literature offers** that fits Danmu's constraints (local-first, browser-only,
> no AI image generation, dimensions owned by code).
>
> Every proposal here was filtered against the non-negotiables in
> [`CLAUDE.md`](CLAUDE.md). Anything that would put a model in charge of a
> dimension is marked as such and rejected or fenced.

---

## 0. Method

Read the engine (`lib/geometry.ts`, `physics.ts`, `clearance.ts`,
`photo-geometry.ts`, `footprint.ts`, `dimension-ranges.ts`, `textures.ts`,
`item-snap.ts`, `scene-spec.ts`) and the render layer
(`components/three/Room.tsx`, `RoomShell.tsx`, `Box.tsx`, `materials.ts`,
`DynamicPart.tsx`), then surveyed 2024–2026 literature across seven areas:
real-time global illumination, monocular/multi-view metric reconstruction,
indoor layout synthesis and its evaluation, open-vocabulary detection at the
edge, browser GPU pipelines, colour science, and accessibility/ergonomics
standards. Full bibliography in §7.

---

## 1. What the engine actually is

### 1.1 The world model: 2.5D, not 3D

Danmu's spatial reasoning is **two-dimensional plus a height scalar**. Every
placement decision reduces to an oriented bounding box in the XZ plane:

```ts
type OBB = { cx, cz, hw, hd, rot }        // lib/geometry.ts:9
type ScenePart = { pos: [x,y,z], rot: number, dimMM: [W,D,H], … }
```

- **One rotational degree of freedom.** `rot` is a scalar yaw. No pitch, no roll,
  no quaternion. A leaning mirror, a tilted wall TV, a chair knocked over — all
  unrepresentable.
- **Height is a scalar, not a shape.** `dimMM[2]` plus `pos[1]` gives a vertical
  interval `[y, y+h]`. The clash rule (`clearance.ts:139`) uses exactly this
  interval test. So an L-shaped desk and a chair tucked under a *cantilever* are
  indistinguishable from two boxes at the same height.
- **Footprints are always rectangles.** `circle?: boolean` exists on `ScenePart`
  but only the 2D plan reads it. A round dining table is treated by every
  geometric test as its circumscribed square — **27% ( 4/π ) more floor area
  than it occupies**, and its "corners" collide with chairs that in reality
  tuck in fine.

This is a *defensible* model — it's why the maths is exact and fast — but the
above three are the boundaries of what the app can currently say about a room.

### 1.2 The geometry kernel is genuinely good

`lib/geometry.ts` is the strongest part of the codebase. It's exact where most
apps sample:

| Operation | Method | Complexity |
|---|---|---|
| Overlap | Separating-axis theorem over 4+4 edge normals | O(1) |
| Overlap **amount** | Sutherland–Hodgman clip + shoelace | O(1), exact for convex quads |
| Gap | min over point-to-segment, both directions | O(1) |
| Ray → OBB | Analytic slab test in the OBB's frame | O(1), no step size |
| Face clearance | 5 probes across the face × exact ray/OBB | O(probes × obstacles) |
| Point in polygon | Crossing-number | O(V) |

No marching, no epsilon-tuned sampling, no "close enough". The `FACE_PROBES = 5`
spread (`geometry.ts:284`) and the `CLASH_SHARE` / `TUCKED_CLASH_SHARE`
thresholds (`clearance.ts:73–78`) are both examples of a real failure mode being
fixed with a principled rule rather than a magic number.

**One real performance defect.** `freeFloorFraction` (`clearance.ts:308`)
rasterises the footprint bbox at 5 cm and, for each cell, loops every part
calling `pointInObb` — which calls `Math.cos`/`Math.sin` *per cell per part*:

```
40 m × 40 m room  →  800 × 800 = 640 000 cells
× 30 parts        →  19.2 M point tests, ~38 M trig calls
```

Fix is mechanical and lossless: (a) precompute `cos/sin` once per OBB, (b) don't
iterate the room for each part — rasterise **each part into its own bbox** and OR
into a shared bitmask, which makes the cost `Σ(part area)` instead of
`room area × part count`.

**Fixed and measured** (results identical to the last bit): 7.9 → 0.7 ms on a
5 × 5 m room with 12 parts (11×), 121 → 2.5 ms on a 12 × 9 m open plan with 30
(48×), and **1558 → 27.9 ms** on a 40 × 40 m `MAX_ROOM` with 30 (56×). The last
number is the one that mattered — `analyzeRoom` runs on every committed edit, so
a large room paid a 1.5 second freeze per drag-release.

### 1.3 "Physics" is a rule table, not a simulation

`lib/physics.ts` is an anchor classifier — `ANCHOR_BY_SHAPE` → `ANCHOR_BY_CATEGORY`
→ `'floor'` — plus `snapToWall` and `findSupportUnder`. There is no dynamics, no
mass, no contact solver. That is the right call for a decoration tool. Two gaps
worth naming:

- **Support is a centre-point test.** `findSupportUnder` (`physics.ts:178`) asks
  whether the mover's *centre* is within the support's half-extents + 5 cm. A
  laptop 90% overhanging a desk edge is "supported". The physical predicate is
  **centre of mass inside the support polygon** — and with `obbIntersectionArea`
  already written, the stronger test (`shared ≥ 0.5 × mover footprint` **and**
  centre inside) is three lines.
- **Nothing resolves part-vs-part at build time**, by design — `clearance.ts`
  reports instead. Correct per the trust boundary. But the report is pairwise,
  which is the subject of §1.5.

### 1.4 The photo→metric pipeline, and its error budget

`lib/photo-geometry.ts` is a calibrated pinhole model:

```
d      = CAM_HEIGHT / tan_down            (floor homography, one plane)
width  = d · (tanX(u₂) − tanX(u₁))        (angular size × distance)
height = CAM_HEIGHT + d · tanY(v_top)
```

with `CAM_HEIGHT = 1.5 m` **fixed**, camera pose assumed **level and at the room
centre**, and hFOV either recovered from the wall–floor line
(`calibrateFromFloorLine`) or defaulted to **66°**.

This is clean maths on four assumptions that a real user in a real living room
violates. Sensitivity analysis — **corrected against the implementation** while
building the fix, because the naive reading of it is wrong in an interesting way:

| Assumption | Realistic deviation | What it actually costs |
|---|---|---|
| `CAM_HEIGHT = 1.5 m` | phone held 1.2–1.75 m | ∂d/∂h = d/h → **±17%** on floor-object size *and* position. Wall items are immune (see below). |
| camera tilt = 0 | ±5° is ordinary handheld | **+19% / −16%** on distance at 1.4 m ¹ |
| hFOV = 66° | ultrawide is ~106° | Floor items: **position only**, up to 2×. Wall items: **size**, up to 2×. ² |
| floor line found | rugs, clutter, low contrast | silently falls back to the 66° default |

¹ Tilting the lens **down** moves the scene *up* the frame, so a floor point sits
nearer the horizon and decodes as **further away**; tilting up does the reverse.
An earlier draft of this document had that direction backwards. Both are
pinned by tests now.

² The surprise, and it changes where the effort should go. For a floor-standing
object the distance is `t = H·aspect / ((v−0.5)·k)` and the width is `t·k·Δu` —
**k cancels exactly**. Getting the lens wrong moves floor furniture around the
room without resizing it, until the mis-scaled distance runs past the far wall and
the `wallDistance` clamp breaks the cancellation, at which point it also comes out
too small. A wall-mounted item has no such luck: its distance is pinned to the
wall rather than derived, so the angular error is never divided back out and lands
entirely on the measurement. Symmetrically, camera height cancels out of a wall
item's W and H (it shifts only its mount height).

So the error budget is really two budgets:

- **Floor furniture** (sofas, beds, tables — most of a room): size is set by
  camera height and tilt. Roughly **±20–25%** before `clampDims`.
- **Wall items** (TV, window, painting, mirror): size is set by the lens. A wall
  shot on an ultrawide and read as 66° yields a TV **half its real width**.

`clampDims` is doing a lot of quiet load-bearing work in both.

Also note: **depth (front-to-back) is not observed at all** — a single view of a
wall cannot see it, so it comes from the category default. That is the single
largest unmeasured quantity in the system.

`findFloorLine` (`photo-geometry.ts:197`) is a max-row-gradient heuristic with a
dominance gate (`bestE ≥ 2.2 × meanE`). Honest about failure, but it will
reliably lock onto a rug edge or a skirting shadow instead of the wall–floor
join.

### 1.5 Ergonomics: correct rules, wrong topology

`analyzeRoom` runs eight rules: door swing, clash, walkway pinch, storage front
clearance, bedside access, TV distance, over-height, crowding. Thresholds
(600 mm walkway, 600 mm storage front, 500 mm bedside, TV at 1.2–2.5× diagonal)
match standard interior guidance.

The structural weakness is that **circulation is modelled as pairwise gaps
between six bulky categories** (`WALKWAY_CATEGORIES`). That misses:

- gaps between furniture and **walls** (never tested),
- gaps involving anything not in the bulky set (a plant blocking a doorway),
- whether the free space is **connected** — you can have 600 mm everywhere
  pairwise and still have furniture that is unreachable,
- whether a **path exists from the door** to each seat / bed / wardrobe.

The literature's own evaluation rubric for generated scenes already names these
as separate axes: SceneEval's plausibility metrics are Collision, **Support**,
**Navigability**, **Accessibility**, Out-of-Bounds
([SceneEval, arXiv 2503.14756](https://arxiv.org/abs/2503.14756)). Danmu covers
collision and partially covers out-of-bounds. Navigability and accessibility are
the gap. §3.4 proposes a fix that is cheaper than the current crowding rule.

### 1.6 Lighting: the biggest realism gap, and it is a one-liner

The entire scene is lit by **four sources, none of which are in the room**
(`Room.tsx:161–177`):

1. `hemisphereLight` — sky/ground gradient,
2. one `directionalLight` key (shadow-casting on `high`, frustum fitted to the
   footprint — good work, `KeyLight` at `Room.tsx:262`),
3. one `directionalLight` fill,
4. a baked `<Environment>` from three `Lightformer` panels (`frames={1}`, so it
   costs nothing per frame).

Then ACES tone mapping, N8AO ambient occlusion, and a `ContactShadows` bake.

**A grep for `pointLight|spotLight|rectAreaLight` across `components/three/`
returns zero hits.** Lamps, pendants, TVs and monitors are `emissive` materials —
they *glow* but emit no light. Consequences:

- Turning on the Evening mood darkens the room; **the floor lamp standing in it
  contributes nothing**. That is the exact opposite of what an evening lighting
  study is for.
- There is **no bounce**. In an app whose core loop is *repainting walls*, a
  terracotta wall does not tint anything. Colour bleed is the single most
  legible cue that a repaint is real, and it is absent.
- **Windows are decals.** `window` is a `wall-mid` anchored panel
  (`physics.ts:39`), not an opening in the wall geometry. No daylight enters
  through it, and no daylight direction exists — the key light is at a fixed
  `KEY_OFFSET = [5, 8, 4]` relative to the room, unrelated to where the windows
  are.

Everything else in the render path (frustum-fitted shadow camera with derived
`normalBias`, on-demand frameloop, the `ContactShadows` re-bake window, bevel
floor for sub-5 cm parts, `InstancedMesh` for book spines and curtain pleats) is
well-engineered. The lighting *model* is the weak link, not the lighting *code*.

### 1.7 Materials and procedural modelling

`components/three/materials.ts` defines nine `meshStandardMaterial` presets;
`lib/textures.ts` generates wood/fabric/floor **normal and roughness** maps on a
canvas (never albedo — so recolour stays authoritative). `Box.tsx` is a rounded
primitive with a clamped bevel and instanced variants. `DynamicPart.tsx` is a
54 KB switch over 45 shapes.

Limits:
- `meshStandardMaterial` only: no **sheen** (velvet/linen upholstery reads as
  plastic), no **clearcoat** (lacquered casework), no **transmission** (glass
  tabletops are `roughness: 0.18` fakes — see `SURFACE.glass`).
- Geometry is authored imperatively per shape. Adding a shape means editing a
  54 KB file. Infinigen Indoors' answer to the same problem is a **procedural
  asset library plus a constraint DSL**
  ([CVPR 2024](https://arxiv.org/abs/2406.11824)); the relevant lesson is the
  *declarative* factoring, not the Blender dependency.

### 1.8 Stack currency

`three@0.169` (r169, Oct 2024) with `@react-three/fiber@9`, `drei@10`,
`@react-three/postprocessing@3`. Meanwhile:

- WebGPU reached production across Chrome/Firefox/Safari by late 2025, and
  three's `WebGPURenderer` was production-ready from **r171**
  ([migration notes](https://www.utsubo.com/blog/webgpu-threejs-migration-guide)).
- three now ships **SSGI as a first-class TSL post node** —
  `import { ssgi } from 'three/addons/tsl/display/SSGINode.js'`
  ([docs](https://threejs.org/docs/pages/SSGINode.html)) with documented
  quality presets (`sliceCount × stepCount × 2` samples/px; Low = 1×12 with
  temporal filtering).
- r184 (March 2026) removed per-frame allocations that generated
  240k–500k objects/second at 1000 meshes / 60 fps.

Danmu is roughly **15 releases behind** the point where the lighting upgrades in
§3.1 become available as library features rather than bespoke work. Note the
constraint recorded in `Design.md`: fiber 9 peers `react@>=19 <19.3`, and
`tests/react-3d-peers.test.ts` guards the pairing — a three bump is independent
of that, but `@react-three/postprocessing` (WebGL-only `postprocessing`) is what
blocks a WebGPU move, not three itself.

---

## 2. Ranked weaknesses

| # | Weakness | Where | Severity |
|---|---|---|---|
| 1 | No in-room light sources; no bounce; windows aren't openings | `Room.tsx`, `DynamicPart.tsx` | **High** — undermines "relight" as a listed product verb |
| 2 | Photo→size error ~25–30% from fixed camera height / assumed level / assumed FOV | `photo-geometry.ts` | **High** — undermines the dimension-trust promise |
| 3 | Depth axis never observed | `photo-geometry.ts` + category defaults | **High** |
| 4 | Circulation is pairwise, not connectivity; walls excluded | `clearance.ts` | **Medium-high** |
| 5 | `freeFloorFraction` is O(room × parts) with per-cell trig | `clearance.ts:308` | Medium (perf) |
| 6 | Round/L footprints treated as rectangles | `geometry.ts`, `scene-spec.ts` | Medium |
| 7 | Support = centre-point test | `physics.ts:178` | Medium |
| 8 | Yaw-only rotation | `ScenePart.rot` | Low-medium (model limit) |
| 9 | Standard material only (no sheen/clearcoat/transmission) | `materials.ts` | Low-medium |
| 10 | three r169; no WebGPU path | `package.json` | Low now, compounding |

---

## 3. What the literature offers

Each item: what it is, why it fits Danmu specifically, and what it costs.

### 3.1 Lighting — from "three lights outside the room" to a lighting simulator

This is the highest-value area because "relight" is already a promised verb and
the current answer is three mood presets.

**(a) Make lamps emit light.** three's lights have been physically-correct since
r155: point/spot intensity is in **candela**, with `decay = 2`. Conversion from
the number on the box:

```
candela = lumens / (4π)          # isotropic bulb
800 lm  (60 W-equivalent)  →  63.7 cd
```

Add a `light?: { lumens, kelvin, cone? }` field to `ScenePart` in
`lib/scene-spec.ts` (rule 3: behaviour flags live there), rendered as a
`pointLight` for pendants/tables, a `spotLight` for directional fixtures. Colour
from correlated colour temperature (2700 K incandescent → 6500 K daylight) via
the standard Planckian → sRGB approximation. Cap shadow-casting lights at 2 and
let the rest be shadowless fill; that keeps the frame cost bounded.

*Cost:* small. *Risk:* low. *Impact:* the Evening mood stops being a filter and
becomes a lighting decision.

**(b) Windows as real openings + a sun path.** Walls are already built from
`Shape` geometry in `RoomShell.tsx` — `THREE.Shape` supports `.holes`, so a
window/door part on a wall edge can punch an actual aperture with no CSG library.
Then add a **deterministic solar position model** (NOAA/SPA equations; ~0.01°
accuracy) driven by latitude/longitude + date + time + the room's north bearing,
and aim the key light along it.

That converts the studio into something no browser decoration tool does well:
*"where does the light land in this room at 3 pm in October, and does it hit the
TV?"* It is pure astronomy — no model, no network, no AI — and therefore sits on
the correct side of the trust boundary. Daylight metrics from the building
science literature (Daylight Factor, Useful Daylight Illuminance) can then be
reported in exactly the `ClearanceIssue` shape the room report already uses.

*Cost:* medium (solar model ~150 lines + tests; wall holes moderate). *Impact:*
a genuinely differentiating mechanic.

**(c) Indirect light / colour bleed.** Three tiers, pick by appetite:

1. **Irradiance probe grid (recommended first step).** Sample a coarse 3D grid
   (say 0.75 m) of SH9 irradiance probes once per *committed* change — the same
   window logic `GroundShadows` already uses — and feed them to materials as an
   ambient term. The room is a box, mostly static, and the app already has a
   "commit" event to hang the bake on. No new renderer.
2. **In-browser lightmap bake.** `xatlas.js` (WASM UV unwrap) plus three's
   `ProgressiveLightMap` accumulate a real GI lightmap over a few seconds of idle
   — well-trodden ground
   ([xatlas.js](https://github.com/repalash/xatlas.js/),
   [ProgressiveLightMap](https://threejs.org/docs/pages/ProgressiveLightMap.html),
   [@react-three/lightmap](https://unframework.com/portfolio/simple-global-illumination-lightmap-baker-for-threejs/)).
   Fits the "zero assets, everything computed locally" architecture perfectly.
   Conflicts with live recolour unless the bake is re-triggered on commit.
3. **SSGI on WebGPU.** three's `SSGINode` gives real-time bounce and colour
   bleeding with documented presets; the three.js Paris 2026 conference site runs
   it live. Requires the WebGPU migration in §3.6 and dropping
   `@react-three/postprocessing`.

**(d) Frontier: radiance cascades.** Worth tracking, not adopting yet.
[Holographic Radiance Cascades](https://arxiv.org/abs/2505.02041) (2025) hits
reference-quality **2D** GI at 1.85 ms / 512² on an RTX 3080 laptop, at constant
cost.
[Split Radiance Cascades](https://arxiv.org/abs/2607.20384) (Freeman & Sannikov,
July 2026) lifts it to 3D diffuse GI using world-space probes in a **sparse
hashmap** plus "ray splitting" to compute radiance intervals from hit distance.

There is a cheap, unusual application here: **the 2D floor plan view**. A 2D
radiance cascade over the plan raster would render a genuinely lit top-down
diagram — light pooling from windows and lamps across the floor — for a couple of
milliseconds, on the view Danmu already rasterises. That is a novel feature with
a published, constant-cost algorithm behind it.

### 3.2 Capture — closing the 25–30% error and the missing depth axis

**(a) Free accuracy, no new bytes: single-image Manhattan calibration.**
Instead of `findFloorLine`'s luminance heuristic, run a line-segment detector on
the wall photo and estimate orthogonal **vanishing points** by RANSAC. From two
orthogonal VPs and a principal point at the image centre, focal length follows
in closed form (`f² = −(v₁ − p)·(v₂ − p)`, Caprile & Torre / Hartley & Zisserman),
and the camera's **pitch and roll** fall out of the same solution.

This one change fixes three of the four error terms in §1.4 simultaneously — the
assumed 66° FOV, the assumed level pose, and the fragile floor-line detection —
using classical geometry with **zero model download** and full determinism. It is
the single highest value-per-byte improvement available to this codebase.

**(b) Also free: EXIF.** For uploaded photos, `FocalLengthIn35mmFilm` gives
`hFOV = 2·atan(36 / (2·f₃₅))` directly. For live capture,
`DeviceOrientationEvent.beta` records the pitch at shutter time. Both are
deterministic, local, and about an afternoon of work each. Store them on the
capture record (remembering the `toRecord`/`fromRecord` codec rule in
`CLAUDE.md`).

**(c) Ask for the camera height.** `CAM_HEIGHT = 1.5` is a fiction with a ±17%
consequence. One optional field on the capture screen ("about how high are you
holding the phone?") with 1.5 m as the default removes the largest single error
term. Cheapest fix in this entire document.

**(d) Learned metric depth — the way to recover the missing depth axis.**
[Depth Pro](https://arxiv.org/abs/2410.02073) (Apple, ICLR 2025) produces metric
depth *and* state-of-the-art focal length from a single image, no intrinsics
required, at 2.25 MP in 0.3 s on a GPU — but it is far too large to ship to a
browser. The practical route is a small metric-depth model (ViT-S class,
~100 MB ONNX) served the same way the detector already is: HEAD-probe local →
Hugging Face mirror, digest-pinned in `MODEL_DIGESTS`, WebGPU execution provider.
A metric depth map per wall photo would let `geoRefine` fit **real front-to-back
depth** — today's largest unmeasured quantity — and cross-check the homography
distance it already computes.

**(e) Multi-view feed-forward, for later.**
[MapAnything](https://arxiv.org/abs/2509.13414) (3DV 2026) regresses factored
metric geometry — per-view depth, ray maps, poses, and a single global metric
scale — from *n* images with optional intrinsics/pose priors; VGGT does the
same in one pass without the factoring. Danmu's four wall photos are precisely
this input, and such a model would derive the room's real shape without asking
the user for width and depth at all. Today it is a ~1 B-parameter desktop model,
so this is a watch item, not a plan. If adopted, its output must enter as a
*hint* through `clampDims` and a user confirmation step — same boundary as
detection.

**(f) Room layout networks.** ST-RoomNet and the non-cuboid layout line predict
wall/floor/ceiling boundaries directly from one RGB image. Useful eventually for
L-shaped and non-Manhattan rooms, but (a) is cheaper and covers the common case.

### 3.3 Layout intelligence — suggestions without a model

This is where Danmu can gain the most *perceived* intelligence with the least
architectural compromise, because the canonical method is **pure optimisation**.

**Merrell et al., "Interactive Furniture Layout Using Interior Design
Guidelines"** (SIGGRAPH 2011,
[PDF](http://graphics.berkeley.edu/papers/Merrell-IFL-2011-08/Merrell-IFL-2011-08.pdf))
encodes design manual rules — clearance, circulation, pairwise relationships,
alignment, balance, conversation grouping — as terms in a **density function**,
then samples it with a hardware-accelerated Monte Carlo sampler to generate
suggestions. Their user study showed measurably better arrangements from
untrained participants.

Danmu already has most of the terms implemented as *checks*. Turning
`clearance.ts`'s rules into **costs** and running simulated annealing over
(x, z, yaw) for unlocked parts gives a "Suggest arrangement" button that is:

- deterministic given a seed (matching `Dressing.tsx`'s existing seeded generator
  pattern),
- zero bytes downloaded, zero network,
- provably respectful of `clampDims`, because it never touches dimensions —
  only position and yaw,
- naturally incremental: lock what you like, re-suggest the rest.

[Infinigen Indoors](https://arxiv.org/abs/2406.11824) (CVPR 2024) is the modern
version of the same idea and worth copying structurally: a constraint DSL plus a
**hierarchical simulated-annealing solver** that places floor plan → large
furniture → small objects in sequence. That staging maps exactly onto Danmu's
existing footprint → parts → decor hierarchy.

The learned branch — [DiffuScene](https://openaccess.thecvf.com/content/CVPR2024/papers/Tang_DiffuScene_Denoising_Diffusion_Models_for_Generative_Indoor_Scene_Synthesis_CVPR_2024_paper.pdf)
(CVPR 2024) and PhyScene (CVPR 2024), which adds physics guidance for collision
and reachability during sampling — is not shippable here (model weights,
dataset licences, and a model deciding placement). But **PhyScene's guidance
functions are just differentiable penalty terms**, and they are the right
inspiration for the cost function above.

For evaluation, adopt [SceneEval](https://arxiv.org/abs/2503.14756)'s plausibility
taxonomy wholesale: Collision, Support, Navigability, Accessibility,
Out-of-Bounds. It is a ready-made rubric for both the room report *and* the
Vitest suite.

### 3.4 Ergonomics 2.0 — circulation as a distance field

Replace pairwise gap tests with a **clearance field**, computed on the raster
`freeFloorFraction` already builds:

1. Rasterise the footprint at 5 cm; mark cells covered by any solid part.
2. Compute the **Euclidean distance transform** of the free cells
   (Felzenszwalb–Huttenlocher, exact, O(n) two-pass).
3. Walkable = cells with EDT ≥ 300 mm (half of the 600 mm walkway rule).
4. **Connected-component label** the walkable set.

That one field answers, for free, everything the current rules answer separately
plus everything they miss:

- *Tight walkway* → any walkable cell whose EDT is between 300 and 500 mm,
  including gaps against **walls**, which are invisible today.
- *Navigability* → is every seat / bed / storage front reachable from the door's
  component? Isolated components are the "boxed in" failure the pairwise rule
  cannot see.
- *Accessibility mode* → the largest inscribed circle is `2 × max(EDT)`. A
  **1500 mm wheelchair turning circle** is code in the US
  ([ADA: 60″ / 1524 mm](https://www.access-board.gov/ada/guides/chapter-3-clear-floor-or-ground-space-and-turning-space/)),
  Canada, and Australia (AS1428.1), with a 915 mm minimum accessible-route
  width. Reporting "no 1500 mm turning circle in this room" is a real,
  citable, deterministic finding — and an underserved feature in consumer
  decoration tools.
- *Crowding* → free-cell fraction, already the existing metric, now a by-product.

Cost is **lower** than the current implementation once §1.2's rasterisation fix
lands, and it makes four existing rules fall out of one field.

**Companion feature — "Will it get in?"** The classic piano mover's problem:
search the 3-DoF configuration space (x, z, θ) at 5 cm / 5° for a collision-free
path from the door to a piece's final position. For a rectangle in a rectilinear
room this is a small BFS over a discretised C-space — milliseconds. Nobody in
this product category answers *"can this 2.4 m sofa actually get through your
hallway"*, and Danmu already holds every number needed.

### 3.5 Detection — a licence-friendly refresh

The current ensemble (yolov8n-oiv7 + yolov8s-worldv2, 64 MB, 13/19 recall,
~4.8 s/photo on WebGPU) is well-measured; don't re-litigate it without new
numbers. Two developments since:

- **[RF-DETR](https://blog.roboflow.com/best-object-detection-models/)** —
  first real-time model past 60 mAP on COCO, DINOv2 backbone with deformable
  cross-attention, **NMS-free**, and **Apache-2.0**. That last point matters
  more than the accuracy: the entire AGPL fence documented in `Design.md` §9 —
  separate HF repo, runtime fetch, no redistribution — exists because Ultralytics
  weights are copyleft and Danmu is MIT. An Apache-2.0 detector could be
  *bundled*, digest-pinned trivially, and would delete a whole class of
  compliance complexity.
- **[YOLOE](https://docs.ultralytics.com/models/yoloe)** — open-vocabulary via
  text, visual, or prompt-free internal vocabulary, in YOLO's real-time regime.
  Same AGPL fence, but likely better recall than worldv2 on the vocabulary items
  currently missed (doors, wall art, curtains).

Recommendation: re-run the existing 19-object benchmark against RF-DETR first,
because the licence win compounds. Also worth measuring: fp16 weights and ORT
**io-binding** on the WebGPU path, which typically cut the 10-passes-per-photo
cost substantially without touching recall.

### 3.6 Rendering pipeline

The WebGPU migration is now a *when*, not an *if*, but sequence it correctly:

1. Bump three toward r18x first (WebGL path unchanged) — picks up the r184
   allocation fixes and keeps `@react-three/postprocessing` working.
2. Add `BatchedMesh` (r166+) for the static per-part geometry. Danmu already
   instances *within* a part (book spines, curtain pleats, radiator fins); the
   remaining cost is across parts — a 30-piece room is several hundred draw
   calls of mostly-identical rounded boxes.
3. Only then evaluate `WebGPURenderer` + TSL, which unlocks `ssgi()`, native
   `ao()`, and compute shaders — but requires replacing the
   `@react-three/postprocessing` stack (`N8AO` + `SMAA`) with TSL nodes. Keep the
   WebGL path as fallback; the quality toggle already models "high / fast" so a
   third tier is a natural fit.

### 3.7 Colour and materials

- **Move the token system to OKLCH.** Perceptually-uniform lightness means a
  palette generated by fixed-L columns has *identical* contrast across hues —
  the Harmony/APCA approach
  ([Evil Martians](https://evilmartians.com/chronicles/oklch-in-css-why-quit-rgb-hsl)).
  For Danmu this pays twice: (a) `app/globals.css` tokens get provable contrast
  ratios, and (b) `lib/themes.ts` can *generate* harmonies by rotating hue at
  constant L and C, so no theme can produce an unreadable or muddy room. It also
  fixes the hand-sync problem in `lib/scene-palette.ts`: default body colours per
  category could be derived (constant L per material family, hue per category)
  rather than hand-listed and guarded by a test.
- **Upgrade fabric to `meshPhysicalMaterial` with `sheen`.** Upholstery is the
  most-seen surface in the app and currently reads as matte plastic. Sheen is the
  standard cloth term and is cheap. `clearcoat` for lacquered casework and
  `transmission` for glass tabletops are the follow-ups (transmission is
  expensive — gate it to `high`).

### 3.8 Storage and local-first

- **OPFS** (Origin Private File System) is a better home than IndexedDB for the
  CC0 GLB library in `lib/mesh-cache.ts` — synchronous access handles in a
  worker, far better large-binary throughput.
- **File System Access API** would give a real "save project to disk" without a
  backend, which is the natural export story for a local-first app.
- CRDT sync (Yjs/Automerge) for multi-device is *possible* without a server, but
  it implies a relay to be useful. Out of scope under the no-backend rule; noted
  only so it isn't rediscovered.

---

## 4. Proposals ranked by value ÷ effort

| # | Proposal | Effort | Impact | Fits constraints |
|---|---|---|---|---|
| 1 | Ask for camera height at capture; store EXIF focal length + device pitch | XS | Removes the two largest photo-size error terms | ✔ pure data |
| 2 | Rasterise-per-part in `freeFloorFraction`; hoist trig out of `pointInObb` | XS | 11–56× on the room report; kills a 1.5 s freeze on large rooms | ✔ |
| 3 | Real lights on lamps/pendants (candela from lumens, CCT colour) | S | Makes "relight" true | ✔ no AI |
| 4 | Clearance field: EDT + connected components → navigability, wall gaps, accessibility mode | M | Four rules become one field; adds a citable a11y feature | ✔ deterministic |
| 5 | Sheen on fabric; physical material tier | S | Biggest per-pixel realism gain for the money | ✔ |
| 6 | Vanishing-point calibration replacing `findFloorLine` + the 66° default | M | Fixes pitch, roll and FOV at zero download | ✔ classical geometry |
| 7 | "Suggest arrangement" — Merrell density function + annealing over (x, z, yaw) | M | Feels intelligent, downloads nothing, never touches dimensions | ✔ optimisation, not AI |
| 8 | Windows/doors as real wall openings (`Shape.holes`) | M | Prerequisite for daylight; fixes a modelling lie | ✔ |
| 9 | Solar position model → sun path / time-of-day study | M | Genuinely differentiating mechanic | ✔ astronomy |
| 10 | Irradiance probe grid baked on commit (colour bleed) | M | Repaints finally affect the room | ✔ |
| 11 | "Will it get in?" C-space path check from door to placement | M | Unique, and all the inputs already exist | ✔ |
| 12 | Circle / polygon footprints in `scene-spec` + `geometry` | M | Removes the 27% round-table over-estimate | ✔ |
| 13 | RF-DETR benchmark (Apache-2.0 → possible bundling, deletes the AGPL fence) | M | Compliance simplification + likely recall | ✔ |
| 14 | three r18x bump, then `BatchedMesh` | M | Headroom; prerequisite for WebGPU | ✔ |
| 15 | OKLCH tokens + generated theme harmonies | M | Provable contrast; derives `scene-palette` | ✔ |
| 16 | Small metric-depth ONNX model → recover the depth axis | L | Closes the last unmeasured dimension | ✔ hint-only, clamped |
| 17 | WebGPU + TSL `ssgi()` | L | Real-time bounce | ✔ |
| 18 | 2D radiance cascade lighting for the floor-plan view | L | Novel; constant cost; published algorithm | ✔ |

Items 1–5 are a coherent first sprint: two are near-trivial, three change what
the product can honestly claim.

---

## 5. Explicitly rejected

- **Anything generative-visual.** DiffuScene/PhyScene/Holodeck-class scene
  *generation*, text-to-3D, image relighting, neural rendering. `CLAUDE.md`
  rule 1 stands; the useful part of that literature is its **cost functions and
  evaluation metrics**, which are extractable without the models.
- **A model owning a dimension.** Every capture proposal above (metric depth,
  MapAnything, layout nets) enters as a hint through `clampDims` with user
  confirmation, or does not enter.
- **A backend.** Rules out CRDT sync as a product feature, hosted baking, and
  any server-side inference.
- **3D Gaussian splatting capture.** [WebSplatter](https://arxiv.org/pdf/2602.03207)
  shows WebGPU splat rendering is fast enough in-browser and SPZ/SOG compression
  is converging, but *training* a splat needs an offline pipeline Danmu does not
  and should not have. Re-evaluate if a feed-forward splat predictor becomes
  small enough to run locally.

---

## 6. Suggested verification work

The engine's pure-logic surface is ideal for property-based testing, which the
suite does not yet use. Candidate invariants (`fast-check` over random OBBs):

- `obbOverlap(a,b) ⟺ obbIntersectionArea(a,b) > ε`
- `obbGap(a,b) === obbGap(b,a)` and `obbOverlap ⟹ obbGap === 0`
- `freeFloorFraction ∈ [0,1]`, monotonically non-increasing as parts are added
- `faceClearance ≤ rayToBoundary` from the same origin, always
- EDT (if adopted) verified against brute-force nearest-obstacle on small grids
- `clampDims` idempotent: `clampDims(clampDims(x)) === clampDims(x)`

---

## 7. Bibliography

**Global illumination**
- [Split Radiance Cascades: Real-Time Global Illumination via Sparse Radiance Probes](https://arxiv.org/abs/2607.20384) — Freeman & Sannikov, arXiv 2607.20384 (2026)
- [Holographic Radiance Cascades for 2D Global Illumination](https://arxiv.org/abs/2505.02041) — arXiv 2505.02041 (2025)
- [Radiance Cascades for Real-Time 2D Global Illumination](https://ieeexplore.ieee.org/document/11307155/) — IEEE (2025)
- [three.js SSGINode documentation](https://threejs.org/docs/pages/SSGINode.html)
- [three.js ProgressiveLightMap](https://threejs.org/docs/pages/ProgressiveLightMap.html) · [xatlas.js](https://github.com/repalash/xatlas.js/) · [@react-three/lightmap](https://unframework.com/portfolio/simple-global-illumination-lightmap-baker-for-threejs/)
- [Spatiotemporally Consistent Indoor Lighting Estimation with Diffusion Priors](https://dl.acm.org/doi/10.1145/3721238.3730749) — SIGGRAPH 2025

**Metric geometry from photos**
- [Depth Pro: Sharp Monocular Metric Depth in Less Than a Second](https://arxiv.org/abs/2410.02073) — Apple, ICLR 2025
- [MapAnything: Universal Feed-Forward Metric 3D Reconstruction](https://arxiv.org/abs/2509.13414) — 3DV 2026
- [Survey on Monocular Metric Depth Estimation](https://arxiv.org/pdf/2501.11841) (2025)
- [ST-RoomNet: Room Layout Estimation from a Single Image](https://openaccess.thecvf.com/content/CVPR2023W/VOCVALC/papers/Ibrahem_ST-RoomNet_Learning_Room_Layout_Estimation_From_Single_Image_Through_Unsupervised_CVPRW_2023_paper.pdf) — CVPRW 2023
- [Learning to Reconstruct 3D Non-Cuboid Room Layout from a Single RGB Image](https://arxiv.org/pdf/2104.07986)

**Layout synthesis, constraints, evaluation**
- [Interactive Furniture Layout Using Interior Design Guidelines](http://graphics.berkeley.edu/papers/Merrell-IFL-2011-08/Merrell-IFL-2011-08.pdf) — Merrell, Schkufza, Li, Agrawala, Koltun, SIGGRAPH 2011 — *the single most directly applicable paper here*
- [Infinigen Indoors: Photorealistic Indoor Scenes using Procedural Generation](https://arxiv.org/abs/2406.11824) — CVPR 2024 (constraint DSL + hierarchical simulated annealing)
- [DiffuScene: Denoising Diffusion Models for Generative Indoor Scene Synthesis](https://openaccess.thecvf.com/content/CVPR2024/papers/Tang_DiffuScene_Denoising_Diffusion_Models_for_Generative_Indoor_Scene_Synthesis_CVPR_2024_paper.pdf) — CVPR 2024
- [SceneEval: Evaluating Semantic Coherence in Text-Conditioned 3D Indoor Scene Synthesis](https://arxiv.org/abs/2503.14756) — plausibility metrics: COL / SUP / NAV / ACC / OOB
- [Awesome-Indoor-Scene-Synthesis](https://github.com/YandanYang/Awesome-Indoor-Scene-Synthesis) — tracking list

**Motion planning**
- [Motion planning / piano mover's problem](https://en.wikipedia.org/wiki/Motion_planning) · [A "Piano Movers" Problem Reformulated](https://arxiv.org/pdf/1309.1588) · [Rigid Body Path Planning using Mixed-Integer Linear Programming](https://arxiv.org/pdf/2409.11520)

**Detection at the edge**
- [Best Object Detection Models 2026: RF-DETR, YOLOv12 & Beyond](https://blog.roboflow.com/best-object-detection-models/) — RF-DETR is Apache-2.0
- [YOLOE: Real-Time Seeing Anything](https://docs.ultralytics.com/models/yoloe) · [YOLOE tutorial](https://learnopencv.com/yoloe-tutorial-real-time-open-vocabulary-detection/)

**Browser GPU**
- [Migrate Three.js to WebGPU (2026) — checklist](https://www.utsubo.com/blog/webgpu-threejs-migration-guide)
- [100 Three.js Tips That Actually Improve Performance (2026)](https://www.utsubo.com/blog/threejs-best-practices-100-tips)
- [WebSplatter: Cross-Device Efficient Gaussian Splatting in Web Browsers via WebGPU](https://arxiv.org/pdf/2602.03207)
- [WebXR Depth Sensing Module (W3C WD)](https://www.w3.org/TR/webxr-depth-sensing-1/) · [WebXR vs ARCore](https://developers.google.com/ar/develop/webxr/arcore-comparison) — note: no RoomPlan-equivalent structured room API on Android

**Colour**
- [OKLCH in CSS: why we moved from RGB and HSL](https://evilmartians.com/chronicles/oklch-in-css-why-quit-rgb-hsl) · [Exploring the OKLCH ecosystem](https://evilmartians.com/chronicles/exploring-the-oklch-ecosystem-and-its-tools) · [Harmony palette (OKLCH + APCA)](https://github.com/evilmartians/harmony)

**Accessibility / ergonomics**
- [US Access Board — Clear Floor Space and Turning Space](https://www.access-board.gov/ada/guides/chapter-3-clear-floor-or-ground-space-and-turning-space/) (60″ / 1524 mm turning circle; 36″ / 915 mm route)
- [AS1428.1 design information](https://moddex.com/practical-design-information-about-disability-access-compliance-for-new-building-work-as1428-1/) (1500 mm circulation space)

# Danmu — Engine Research & Improvement Study

> Written 2026-07-30 against `main`. Companion to [`Design.md`](../../Design.md), which
> describes what the system *is*. This document describes **how it works
> mechanically**, **where the maths is weakest**, and **what the current
> literature offers** that fits Danmu's constraints (local-first, browser-only,
> no AI image generation, dimensions owned by code).
>
> Every proposal here was filtered against the non-negotiables in
> [`CLAUDE.md`](../../CLAUDE.md). Anything that would put a model in charge of a
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

### 3.9 Layout intelligence, second pass: why the first one read as random

> Added 2026-07-30, after the "Suggest" button shipped and was reported as *"it
> doesn't do any logic checks, it just randomly moves objects around"*. That
> report was correct, and this section is the diagnosis, the literature the fix is
> built on, and the numbers it uses. Implemented in
> [`lib/layout-rules.ts`](lib/layout-rules.ts).

#### 3.9.1 The three causes, each measured

1. **Doors were invisible to the cost function.** `layout-score`'s blocker mask was
   `!wallMounted && category !== 'rug' && height > 250 mm`, and a door *is*
   wall-mounted — so it contributed no term at all. Measured: a bed placed across a
   900 mm doorway, solved with 3000 steps, moved **0.4 mm**; total cost before 3.00,
   after 2.01, of which the doorway was **zero**. `analyzeRoom` then reported
   `error Door can't open fully` on the solver's own output. The two modules were
   optimising different rule sets while a comment in each claimed otherwise.

2. **Nothing charged for movement.** With no term penalising displacement, any local
   minimum was as good as any other, so each press returned a wholesale rearrangement
   for a fraction of a percent of cost. That is indistinguishable from a shuffle,
   because in the way that matters it *is* one.

3. **The rotation convention was mirrored.** `lib/geometry.ts` rotated local→world as
   `(x cos − z sin, x sin + z cos)`; three.js's `rotation.y` — which is what the
   scene actually renders, `Draggable` assigns `part.rot` straight to it — is
   `(x cos + z sin, −x sin + z cos)`. Identical at 0°/180°, mirrored everywhere else,
   and it inverts every *directional* answer. Measured: a wardrobe correctly snapped
   to the east or west wall reported **1.9 cm** of clearance in front of its doors
   and raised "Doors can't open"; the same wardrobe on the north or south wall
   reported 3.38 m. Two of four walls, on the most ordinary placement there is.
   `tests/geometry.test.ts` now pins the convention against three's own `Euler`.

   A fourth, cosmetic: `propose` *added* quarter turns to an already-snapped yaw
   instead of replacing it, so parts came back stored at ~597 radians.

#### 3.9.2 What the literature actually specifies

The two SIGGRAPH 2011 papers remain the right foundation, but the term
*definitions* are what was missing, and the clearest statement of them is the
patent rather than the paper —
[US 2013/0222393](https://patents.google.com/patent/US20130222393A1/en) writes
Merrell et al.'s density function out in text:

| Term | Definition as published | What it became here |
|---|---|---|
| Clearance `m_cv` | Σ area of overlap between furniture and other items' **accessible regions**, each built as the *Minkowski sum of the footprint with a line segment or a disk, sized per furniture type* | `AccessRule` — per-side zones in the piece's own frame |
| Circulation `m_ci` | number of connected components of `C_free = ⋂(g ⊕ P)`, `P` a person as a **disk of radius 18″ (457 mm)** | `navigabilityCost`, over the existing EDT field |
| Pairwise distance `m_pd` | `t(d, m, M, α)` — 1 inside `[m, M]`, `(d/m)^α` below, `(M/d)^α` above, α = 2 | `bandCost`, in metres rather than ratios |
| Conversation `m_cd` | same `t`, with **`m_c` = 4 ft, `M_c` = 8 ft** | the `armchair ← sofa` relation, 1.2–2.6 m |
| Conversation angle `m_ca` | `−Σ (cos φ_fg + 1)(cos φ_gf + 1)` | the `faces` kinds' angle term |
| Alignment `m_fa` / `m_wa` | `−Σ cos(4(θ_f − θ_g))` — parallel *or* square, one expression | `quarterTurnCost` = `(1 − cos 4Δθ)/2` |
| Balance `m_vb` | area-weighted centroid of furniture vs room centroid | unchanged |
| Emphasis `m_ef` | `−Σ cos φ_{g,p}` toward a focal point | `roomProfile.focals` + the `faces` relations |

Two more sources carry what Merrell's paper leaves implicit:

- **[Automatic Generation of Constrained Furniture Layouts](https://arxiv.org/pdf/1711.10939)**
  models clearance as **four numbers per object** — padding in-front-of, behind,
  to-the-left-of, to-the-right-of — and defines traversability as: erode free space
  by a **0.25 m circular kernel** to get the passable region `P`, erode again for
  the regions `A` that need access, then require every pair in `A` to be mutually
  reachable through `P`. That per-side shape is exactly `AccessRule.sides`, and it
  is what lets a double bed want *both* sides while a single wants *one*.
- **[Architect-Ant](https://arxiv.org/html/2606.10953)** (2026) publishes a rubric of
  numeric penalties, which is the closest thing in the literature to a citable table:
  **door swing 0.60 m depth**, **window blocker zone 0.40 m** for large furniture,
  **wall-touch tolerance 0.15 m**, **chair within 0.60 m of the table**, tiered
  overlap thresholds at 10 / 15 / 50 % of area, and containment as a hard rule.
- **[ProcTHOR](https://arxiv.org/pdf/2206.06994)**'s *semantic asset groups* — sets
  of objects that co-occur and must be **sampled and placed together** (a dining
  table with four chairs), plus per-category *room* and *location* annotations
  (a fridge along a wall, a TV never on the floor). That is the relation table's
  justification for existing at all, and the reason relations are also used as
  *proposal moves* and not only as costs.
- **[SceneEval](https://arxiv.org/abs/2503.14756)**'s taxonomy — Collision, Support,
  Navigability, Accessibility, Out-of-bounds — is the test rubric; every one of the
  five now has a term and a test.
- **Maximal Marginal Relevance** (from the same patent's discussion of diversifying
  samples) is why the solver keeps a pool of *dissimilar* finalists rather than the
  best four scores, which would be four rounding errors apart on one arrangement.

#### 3.9.3 Residential space-planning numbers used

Design-manual figures, agreeing across sources to a few centimetres. Every one of
them lives in `lib/layout-rules.ts` and nowhere else.

| Activity | Figure | Source |
|---|---|---|
| Tight walkway (squeeze past) | **600 mm** | universal; derived here from `WALK_RADIUS × 2` |
| Comfortable route | **900 mm** | [Space Stylists](https://www.spacestylistsco.com/blog/commonclearances) (3′-0″ residential), [Archi-Monarch](https://archi-monarch.com/residential-space-planning/) |
| Two-way corridor | 1200 mm | Archi-Monarch |
| In front of hinged storage / a fridge | **600 mm** | Architect-Ant; matches the app's existing rule |
| Dining chair pull-back | **900 mm** (1050–1200 with traffic behind) | [Arcedior](https://arcedior.com/blog/chair-clearance-behind-dining-tables) |
| Service passage behind a seated diner | 560 mm | Archi-Monarch |
| Bedside strip | **500 mm** to get in and make the bed (600 mm preferred for walking) | app's existing rule; Archi-Monarch gives 600 |
| Behind a desk chair | **900–1000 mm** | Archi-Monarch |
| Sofa to coffee table | **400–500 mm** | Archi-Monarch |
| Facing seating units | 1800 mm | Archi-Monarch |
| Door swing | leaf width, **≥600 mm** deep | Architect-Ant |
| Window band kept clear of tall furniture | **400 mm** | Architect-Ant |
| TV viewing distance | **1.2–2.5 × diagonal** | app's existing rule; now derived per screen |

#### 3.9.4 The shape of the fix

- **One table, two readers.** `lib/layout-rules.ts` holds roles, access zones,
  relations and the room profile; `lib/clearance.ts` (checks) and
  `lib/layout-score.ts` (costs) both read it. A property test over twelve randomly
  scattered rooms asserts the solver never leaves behind an `error` the report will
  raise — the exact failure that started this.
- **Zones are derived, never stored.** A zone's depth is what the *activity* needs,
  its width comes from the piece's own `dimMM`, and it lives in the piece's local
  frame. So resizing a piece or the room recalibrates everything by construction:
  there is no cached number to invalidate. The UI's only remaining job is to *offer*
  a re-fit, which is a solve with the inertia weight turned up ~10×.
- **A role is not a category.** The catalog overloads `shape: 'coffee-table'` across
  a 900 mm side table and an 1800 mm six-seater dining table, so the shape cannot
  answer what a piece is *for*. Height does: a top you get your knees under is
  730–750 mm, a coffee table is 400–450 mm, and there is nothing in between.
- **Cost:** the terms are pairwise, so an evaluation is O(n²) and the search does
  thousands. Hoisting everything static into a prepared model, plus an
  axis-aligned-box reject before any exact test and a closed-form lens area for two
  circles, took a 20-piece solve from **8.4 s to 0.27 s** (30 pieces: 18.5 s → 0.43 s).
  A guard test holds it. The remaining factor of ~5 would come from delta-scoring a
  single moved piece instead of the whole room; it is not needed yet.


### 3.10 Layout intelligence, third pass: groups, assignment, and a room you can walk into

> Added 2026-08-24, after the same two complaints came back in a different shape:
> *"the Suggest algorithm doesn't make a lot of sense with how it repositions
> things, sometimes it even gets positioning wrong"* and *"the generated default
> rooms sometimes don't have a great rationale — the arrangement doesn't look like
> an actual room someone will live in"*. §3.9 fixed the three causes it names and
> they have stayed fixed; these are different ones, each measured on the presets the
> app actually ships. Numbers below come from `defaultScene` output for
> `rect 5×4`, `rect 6.5×5`, `l 6×5`, `u 5×4.5` and `t 7×5.5`, solved at seeds 1–3.

#### 3.10.1 Why Suggest still reads as random — six causes, each measured

**1. A relation is a conjunction over every candidate anchor, not an assignment.**
`prepare` walks every ordered pair and keeps one entry per pair `relationFor`
matches. The rug spec lists `anchor: ['sofa', 'bed', 'dining-table']`, so in a room
with both a sofa and a dining table the rug owes **both** — it is charged for not
being under the table it is not under. Measured on the seeded T:

| pair | band | distance | `bandCost` | × weight × `relation` |
|---|---|---|---|---|
| `rug → sofa` | 0–0.80 m | 0.61 m | 0.00 | 0 |
| `rug → dining-table` | 0–0.80 m | 3.57 m | 7.67 | **38.3** |

That 38.3 is the *entire* `relation` term of the seeded T room, and the solver's
answer is to drag the rug out from under the sofa to a point between the two groups
— 1.36 m, 1.60 m and 2.28 m of travel at seeds 3, 1 and 2. The same mechanism moves
the L's floor lamp 1.42–2.62 m: `lamp → sofa` is satisfied at 0.01 m and
`lamp → armchair` is charged 4.46 for the armchair across the room. A lamp cannot be
beside two seats and a rug cannot be under two groups. **The cost of a relation
should be the minimum over its candidate anchors, not the sum.**

**2. The walkway rule is implemented three times, with three thresholds and three
exempt sets.**

| | which pairs | threshold | how measured |
|---|---|---|---|
| `clearance.ts` rule 3 | one side in `WALKWAY_CATEGORIES` (sofa / bed / wardrobe / shelf / fridge / desk) | `MIN_WALKWAY` = `WALK_MIN` = **0.60 m**, fixed | medial axis off the field, ± half a cell |
| `layout-score.ts` circulation | every `isObstacle` pair | `routeWidth(footprint)` = **0.60 → 0.90 m** with area | pairwise `obbGap` |
| `scene-spec.ts` `pinches` | every obstacle pair | `WALK_MIN` = **0.60 m** | pairwise `obbGap` |

Measured on the seeded 7×5.5 T: `analyzeRoom` returns **0 findings**;
`costBreakdown` charges **walkway 40.4**, all of it from two chair↔chair gaps of
0.40 m around a dining table, against a route the solver has widened to 0.90 m
because the room is large. Chairs at one table are not a corridor and the report
knows it; the solver does not. So Suggest scatters the dining set — chair travel
0.70 / 1.08 / **2.18 m** at seed 1 — to relieve a violation nothing ever reported,
and the toast says *"widened the walkways"*. Both halves of "doesn't make sense" out
of one term. `tests/layout-conformance.test.ts` holds the two consumers to each
other in one direction only (solver output must not leave behind an `error` the
report raises); the missing direction — **an arrangement the report is silent about
must not be charged by the solver** — is exactly what let 40 units through.

**3. Nothing requires a move to pay for itself.** `inertia` at 1.5 per metre is real
but small, and `useSuggest`'s gate is `result.after >= result.before` — *any*
improvement is applied wholesale. What ships is whatever the final `best` snapshot
happened to hold, including displacements the annealer accepted uphill and never
revisited. Measured with a greedy revert-to-origin pass over the solver's own output
(cheapest first, three passes, keep the revert unless the total rises by > 0.5):

| room, seed | solver moved | after prune | cost solver → pruned |
|---|---|---|---|
| 6.5×5 living, 1 | 5 | **1** | 6.3 → **6.1** |
| L 6×5, 2 | 8 | **3** | 12.7 → **10.2** |
| L 6×5, 3 | 8 | **3** | 12.7 → **11.9** |
| U 5×4.5, 1 | 2 | **1** | 5.7 → **5.6** |
| T 7×5.5, 1 | 8 | **6** | 27.7 → **26.4** |

Across twelve runs the prune removed **40–63 %** of the moves and left the cost
*equal or lower* in eight of them. Those moves were not trade-offs the search made;
they were noise it never cleaned up — and every one of them is a piece the user
watches jump for no reason. In the L at seed 2 the solver reports "moved 8 pieces"
for four displacements under 15 cm.

**4. Wall affinity is keyed on `Category` while everything else is keyed on `Role`.**
`wallAffinity` (`physics.ts`) says `table: 'prefers-middle'`, which covers the coffee
table, the side table and the dining table alike, and `chair: 'free'`, which covers a
dining chair. So the coffee table is charged `middle` for sitting in front of the sofa
where the relation table put it (T: `middle 5.1`), and the L's side table — whose
whole job is to touch the arm of the armchair — is pulled toward the room's centre by
0.59–1.21 m. That one survives the prune, which is the tell: the cost function
genuinely wants it there. This is §3.9's "a role is not a category" lesson, one file
short of being finished.

**5. Orientation is nearly free.** `alignment` weight 4 × `angleCost` (0…1) caps a
*completely backwards* wall piece at **4 cost units** — less than moving it 2.7 m
costs in inertia. A `free` piece gets `0.4 × quarterTurnCost × 4`, at most 1.6.
Measured yaws coming back from the solver on dining chairs: 8°, 15°, 98°, −113°, and
at seed 3 one chair turned **203°** from where it started, facing away from its own
table. `MOVE_EPSILON` guards translation only (0.02 m); a yaw change of 0.02 rad is
1.1°, so the "moved N pieces" count includes pieces that merely wobbled.

**6. `RoomProfile.anchor` is computed and read by nothing.** Its own comment says
settling it first is what makes a hierarchical solve behave. `layout-solve`'s first
pass is keyed on `LARGE_AREA` footprint area instead, so a bed and a dining table are
peers and there is no group structure anywhere in the solver: every piece is an
independent variable. That is why a group can be reassembled somewhere else on every
press, and why three chairs permute around one table.

#### 3.10.2 Why the default rooms have no rationale — four more

**7. No preset room has a door, or a window.** `footprintForLayout` returns a bare
polygon; `defaultScene` places tv / sofa / table / rug / plant / lamp / bed /
nightstands / wardrobe / chairs / shelf and never a `door` or a `window`.
`roomProfile.apertures` is empty in all five presets. Consequences, all live:

- `navigabilityCost` returns 0 by its own no-door guard, so the finalist re-ranking
  that exists to catch "you can't get there" is **inert on every starter room**.
- `entranceComponents` returns null, so the report's `reach` and `cut-off` rules say
  nothing, and the `door` and `entry` rules never fire.
- The `desk ← window` relation is unreachable.
- Above all: **with no door, no wall has a reason to be the back wall.** The seeder
  picks by `min(depth, 3.3) × 2 + width` arithmetic — a defensible tiebreak, but not a
  rationale a person can read, because the thing that decides it in a real room (what
  you see when you come in, and where the light is) is not in the room at all.

A room you cannot walk into is also, plainly, not a room someone lives in.

**8. The seed is a vignette.** Five to nine pieces, every group centred at `u = 0` of
its frame, nothing on the walls. The starter living room is sofa, coffee table, rug,
TV, plant, lamp: no side table, no storage under the screen, no art, no curtains, no
ceiling light — though `painting`, `mirror`, `curtain`, `lamp-pendant`, `bookshelf`
and `shoe-rack` are all already in the catalog, and all of them are wall-mounted or
shallow, i.e. nearly free in floor terms.

**9. The dining set seeds three chairs.** ~~When the bay cannot give a seated diner
900 mm on both long sides the table goes against the wall (`vTable = hd + gap`), and
the fourth chair's spot is then inside that wall, so `seats()` refuses it. Measured on
the T: `chair-1`, `chair-2`, `chair-3`. Nobody owns a table with three chairs.~~

**Withdrawn — this was not a cause.** The mechanism above is right and the conclusion
drawn from it is wrong, and it contradicts a rule this repo already states in
`lib/layout-rules.ts`: the `seats` access rule is `atLeast: 3` of four sides,
commented *"a table with one end against a wall is not reported as a fault — that is a
real arrangement."* Three chairs is what the room can carry, not a piece the seeder
dropped. The T's bar is 2.1 m deep and a seated diner needs `WALK_COMFORT` = 900 mm of
pull-back, so centring the table there leaves 630 mm on each long side — two sides too
tight, against one side in the wall and three that work. Re-measured over the presets,
the seeder does seat four the moment a bay can hold four:

| room | dining table | chairs |
|---|---|---|
| `t 5.5×4.7` (bar 2.1 m deep) | yes | **3** |
| `open 7.5×5.6` | yes | **4** |
| `open 8×7` | yes | **4** |

`tests/scene-seed.test.ts` asserts exactly three on the T and says why. That test is
the correct behaviour and this cause was the outlier; the count is a reading of the
room, not a bug. Left struck through rather than deleted because the misdiagnosis is
the point: *"nobody owns a table with three chairs"* is an appeal to intuition, and it
lost to the arithmetic in a table this repo had already written down.

**10. The seeder emits layouts its own cost function scores badly, and cannot know.**
Seeded cost before any solve: `rect 5×4` **3.1**, `6.5×5` **8.8**, `L` **43.1**,
`U` **16.1**, `T` **85.5**. `defaultScene` never calls `costBreakdown`. The U's 16.1
is `walkway 11.5` — a nightstand 0.55 m from the wardrobe — and the solver's answer at
seed 1 is to pull the bed **0.64 m off its headboard wall**, which is worse than the
fault it clears.

#### 3.10.3 The shape of the fix

Seven parts, ordered so each is independently shippable and the cheap ones come
first.

**I — One rule, one place (prerequisite).** Promote the report's
`WALKWAY_CATEGORIES` into `layout-rules.ts` as a predicate over `Role`, alongside the
`routeWidth` that already lives there, and have all three consumers read it. Re-key
`wallAffinity` on `Role` too, and give the roles that have a *relation* — coffee
table, side table, nightstand — an affinity of `'by-relation'`: no wall term, no
middle term, their place is decided by what they belong to. Then add the missing
direction to `tests/layout-conformance.test.ts`: an arrangement the report is silent
about must cost the solver nothing on the term implementing that rule.

**II — Relations become an assignment.** Group the prepared relations by
(self, spec) and take the **minimum** over candidate anchors rather than the sum. The
`argmin` anchor is remembered: that is the piece's *parent*, and the parent edges form
a forest Part III needs. Where exclusivity matters — two nightstands must not claim
the same side of one bed — give the `beside` band a side index off `accessZones` and
let the existing overlap term separate them; a Hungarian assignment is available if
that proves insufficient and is almost certainly not needed at these sizes.

**III — The solver moves groups, not pieces.** The structural change, and the one
that makes output look intentional.

1. Extend `roomProfile` with `groups`: the connected components of Part II's parent
   forest, each rooted at its anchor (`RoomProfile.anchor` finally gets a reader).
2. Three tiers instead of two — **A**: whole groups moved rigidly, variables
   (position, quarter-turn), proposals being *back the anchor onto a wall of a bay*,
   *face the group at a focal*, *swap two groups' bays*, *slide along the wall*;
   **B**: members refined inside their group, with the anchor as the frame and the
   group's extent as the search radius rather than the room's; **C**: free pieces as
   today.
3. `lib/rigid-parent.ts` already carries a subtree through a translate-and-rotate
   about a pivot — reuse that offset maths with the relation forest in place of the
   support tree.

Under this schedule a dining set moves as a set, so chairs stop permuting around
their table, and a rug travels with the sofa it is under.

**IV — Every move must pay for itself.** Between the anneal and the offer:

1. **Snap.** Quarter-turn-snap each yaw to its group axis or its wall's yaw when
   within ~12°, re-score, keep if not worse. Ends the 8° chairs.
2. **Prune.** The greedy revert measured in §3.10.1(3): −40 to −63 % of moves, cost
   equal or better in eight runs of twelve. Cost is one `scoreLayout` per moved piece
   per pass — about 30 evaluations against the anneal's 1600, under 2 % of the solve.
3. **Gate on a material margin**, not on `after < before`: something like
   `before − after ≥ max(ABS_GAIN, 0.08 × before)`, so the 3.1 → 2.4 nudge on the
   rect room becomes *"this is already a good arrangement"* instead of a sofa and a
   rug each moving 10 cm under the banner of a rearrangement.
4. **Explain per piece.** `moved` should carry the term that paid for each move
   (`{ index, term, gain }`) — the prune already computes exactly that delta.
   *"The lamp moved to the armchair it lights"* is a suggestion someone trusts; the
   same move unexplained is the one they undo. And give `MOVE_EPSILON` a yaw sibling
   of ~3°, so wobble stops being counted as a move.

**V — The room gets a door and a window, and the seeder reads them.** A companion to
`footprintForLayout` returns each preset's openings — a door on a named wall, one or
two windows — sized from the catalog (900 × 2100, 1200 × 1200), placed and settled
like everything else. `layout-pick` shows the door; the wall-move machinery in
`wall-actions.ts` / `wall-move.ts` already carries wall-mounted pieces when a wall
moves, so dragging it along its wall is nearly free. The seeder's wall choice then
becomes readable in one sentence: **the focal wall is the one you face coming in,
that is not the door's wall, and not a window wall for a screen** — and a desk goes
beside the window, which the relation table has wanted all along. This single change
is most of "the default rooms have no rationale", and it turns four dormant rules
(`door`, `entry`, `reach`, `cut-off`) back on.

**VI — Seeding becomes a scored constructive search.** Keep the templates; change how
a placement is *chosen*. Enumerate candidate plans — (bay → group) × (group → wall of
that bay) × the two flips along that wall, a few dozen to a couple of hundred for the
presets — build each with the existing `place()` / `seats()` machinery, and score it
with the very same `costBreakdown` + `navigabilityCost` the solver uses. Keep the
best; optionally polish it through `solveLayout` in `refit` mode, which already exists
and already means "change as little as possible". This retires cause 10 by
construction: the seeder can no longer emit an 85.5 room, because 85.5 loses to
whatever else it tried.

~~§3.9.4 measures an evaluation at ~0.17 ms, so 200 candidates is ~35 ms, once, on room
creation.~~ **Wrong in both directions, and the correction picks the design.** That
figure was `scoreLayout(ctx, …)`, which re-runs `prepare` on every call. Measured on
the seeded presets (12–17 parts) against an already-prepared model:

| | `rect 6×4` | `t 5.5×4.7` | `open 7.5×5.6` |
|---|---|---|---|
| one `costBreakdown` | 16 µs | 32 µs | 34 µs |
| `navigabilityCost` at `NAV_CELL` | 1466 µs | 1452 µs | 2230 µs |

So an evaluation is **five to ten times cheaper** than the old figure, and the
clearance field is **eight to thirteen times dearer** — 65–92× an evaluation, not the
10–22× an earlier note claimed, which was the same baseline error (the ratio in
`NAV_CELL`'s own comment is corrected too). Scoring 200 candidates *with the field on
each* is **296–453 ms**, which is not "once, on room creation, and nobody notices" — it
is a visible hitch on the first screen of the product.

The measurement therefore chooses the design rather than merely costing it. The first
answer was the two tiers `solveLayout` uses — score every candidate on `costBreakdown`
alone, pay for the field on four finalists — which brings 200 candidates from 296–453 ms
down to 9–16 ms.

**That was tried, and it was the wrong answer.** Two tiers only work when the filter's
ranking is informative about the arbiter's, and circulation is specifically the term
that is not predictable from the others — which is the entire reason it exists. Every
filter dropped rooms that would have won:

- Top four outright, on the seeded T: a 15-piece plan that seals off 2.36 m² of floor
  scored **2.2** before the field and filled all four slots. No 14-piece plan was ever
  compared against it. The room that shipped had two clearance findings on first open.
- Reserving a finalist slot per part count moved the failure one level down: the
  *cheapest* 14-piece plan strands 2.43 m², and the one that strands nothing is third.

The real correction is that part VI's candidate set is nothing like 200. It is the
product of how many genuinely different walls and bay assignments a room has, capped
at three each: **eighteen at the very most**, and one — no search at all — for a plain
rectangle whose openings leave a single usable viewing wall. Eighteen × ~1.9 ms is
about 35 ms, once, on room creation. Measured end-to-end, `defaultScene` per preset:

| | `rect` | `l` | `t` | `u` | `open` |
|---|---|---|---|---|---|
| plans built | 1 | 3 | 18 | 3 | 6 |
| seed time | 0.4 ms | 7.3 ms | 34.3 ms | 7.0 ms | 17.5 ms |
| cost, greedy → searched | 4.8 | 24.7 → **14.7** | 16.9 → **5.5** | 4.9 | 13.4 |
| pieces placed | 12 | 14 | 14 → **15** | 12 | 17 |
| clearance findings | 0 | 0 | 0 | 0 | 0 |

The T is the case worth reading: the search found a room with **one more piece, a third
of the cost, and no stranded floor**, and it is a room no filter would have let through.
So the seeder scores every candidate in full, and `solveLayout` — which evaluates around
sixteen thousand proposals rather than eighteen — keeps its tiers. Same term, same
weight, different budget.

One more thing the enumeration must get right, since both failure modes are silent:
enumerating a knob the layout does not read builds the identical room several times
(the first draft did, three times over, for a plain rectangle), and enumerating too few
narrows the search back to the greedy answer. Only the second is harmful, and it is the
one that looks like success — so `enumeratePlans` mirrors `defaultScene`'s own switch
rather than approximating it.

**VII — Make the room look lived-in.** Tiered fill, each tier placed only if it fits
*and* does not raise the score:

- **Tier 1, identity** — the anchor group: bed + nightstands, sofa + coffee table +
  rug, table + chairs (four of them, from the sides that are actually usable), desk +
  chair.
- **Tier 2, function** — storage against a wall (media unit under the screen,
  wardrobe, bookshelf), the second seat, a side table.
- **Tier 3, dressing** — art centred over the sofa or bed with its centre at ~1.45 m,
  a mirror beside or opposite the window, curtains on every window, a pendant over the
  dining table, a floor lamp in the reading corner, greenery in a corner no route
  uses.

Tier 3 is nearly free geometrically and is the whole difference between a showroom and
a home. It also gets a stopping rule rather than a hand-tuned piece count:
`freeFloorFraction` is already exported, and a target band — roughly 50–65 % free
floor for a living room, more for a bedroom — says when to stop adding. And **stop
centring everything at `u = 0`**: a wall's furniture reads better centred on that
wall's *usable run*, which is a number the seeder will have as soon as it knows where
the openings are.

#### 3.10.4 Order of work

| # | Part | Buys | Status |
|---|---|---|---|
| 1 | IV — prune, snap, gate, per-piece reason | The visible half of "doesn't make sense", with no new concepts | **shipped** |
| 2 | II — relation as `min` over anchors | The wandering rug and the wandering lamp | **shipped** |
| 3 | I — one walkway rule; affinity by role | The phantom 40 in the T; the drifting side table | **shipped** |
| 4 | V — doors and windows in the presets | Most of "no rationale"; four dormant rules turned back on | **shipped** |
| 5 | III — group-rigid solve | Chairs stop permuting; arrangements stay recognisable | not needed yet — see below |
| 6 | VII — dressing | Art, curtains, a pendant, bedside lamps — all wall- or ceiling-mounted, so free | **shipped** |
| 7 | VI — scored constructive seeding | Rooms that score well by construction | **shipped** |

1–3 are small and cover most of the first complaint. 4 covers most of the second.
5–6 are what make the result good rather than merely not wrong.

#### 3.10.5 What shipping 1–4 actually did

Same probe, same five presets, same three seeds. Seeded cost is before any solve;
"moves" is what pressing Suggest does to that seeded room.

| room | seeded cost, before → after | Suggest moved, before → after |
|---|---|---|
| `rect 5×4` | 3.1 → **2.6** | 1–2 → **0** |
| `rect 6.5×5` | 8.8 → 11.0 | 2–5 → **2–3** |
| `l 6×5` | 43.1 → **24.7** | 8 → **3–5** |
| `u 5×4.5` | 16.1 → **4.3** | 2 → **0** |
| `t 7×5.5` | 85.5 → **6.1** | 8 → **0** |

The T's `walkway 40.4` and `relation 38.3` are both zero. The chairs stay at their
table, the rug stays under the sofa, and three of the five presets now answer Suggest
with *"this is already a good arrangement"* — which they always should have. The
6.5 × 5 room's seeded cost went *up* because it has a door and two windows in it now
and three more pieces to be scored; what it does under Suggest is move the sofa 340 mm
back against its wall and the floor lamp to the end of that sofa, which are the two
moves a person would make.

Every remaining move can be named, which is the test that matters: the sofa moves to
the wall, the lamp moves to the seat it lights, the armchair turns to face the sofa.
Nothing moves 2 m for a rounding error any more.

#### 3.10.6 What shipping VII and VI then did

Same five presets. VII hangs a picture over the sofa or bed, curtains at every window,
a pendant over the dining table and a lamp on each nightstand — all wall- or
ceiling-mounted, so `isObstacle` is false for every one of them and none of it takes
floor, blocks a route or enters an access zone. It costs nothing in the room report
and it is most of the difference on screen.

VI turned every greedy choice in the seeder — which wall a group backs onto, which bay
the living group gets — into a plan, built the plans in full, and let `costBreakdown`
pick. Costs are on the report's own grid, with the navigation term on:

| room | pieces, VII → VI | seeded cost, VII → VI | plans built | seed time |
|---|---|---|---|---|
| `rect 6×4` | 12 | 4.8 | 1 | 0.4 ms |
| `l 6×4.7` | 14 | 24.7 → **14.7** | 3 | 7.3 ms |
| `t 5.5×4.7` | 14 → **15** | 16.9 → **5.5** | 18 | 34.3 ms |
| `u 6×5` | 12 | 4.9 | 3 | 7.0 ms |
| `open 7.5×5.6` | 17 | 13.4 | 6 | 17.5 ms |

Zero clearance findings and zero stranded floor throughout. Two presets improved and
three were already at the greedy optimum — which is the honest result, and the reason
plan zero is always the greedy plan: a room the search cannot improve on comes out
unchanged, and `rect` does not search at all.

The T is the case that justifies the whole part. Its winning room has **one more piece,
a third of the cost, and no floor anyone is cut off from** — and it is a room that no
cheap pre-filter would have surfaced, because the plans that score best before the
clearance field runs are the ones that seal a corner off. Details in the part VI note
above.

**Why part III is still not next.** It was the structural answer to chairs permuting around
their table and to a group being reassembled somewhere else on every press. Both of
those turned out to be symptoms of causes 1 and 2 rather than of the flat search: with
the relation an assignment and the walkway rule shared, the dining sets stop moving at
all. Group-rigid moves are still the right shape for a room the user has genuinely
made a mess of — the case where a whole group must cross the room — and the parent
forest that part II now computes is most of the work. It is worth doing when there is
a room that needs it, not before.

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
- [US 2013/0222393 — Method and System for Interactive Layout](https://patents.google.com/patent/US20130222393A1/en) — the same authors' patent, and the only place the density function's terms are written out in extractable text (see §3.9.2)
- [Make it Home: Automatic Optimization of Furniture Arrangement](https://web.cs.ucla.edu/~dt/papers/siggraph11/siggraph11.pdf) — Yu, Yeung, Tang, Chan, Terzopoulos, Osher, SIGGRAPH 2011 — accessible-space rectangles + viewing frusta, Metropolis–Hastings annealing
- [Automatic Generation of Constrained Furniture Layouts](https://arxiv.org/pdf/1711.10939) — per-side padding as four numbers; traversability by morphological erosion (0.25 m kernel)
- [Architect-Ant: Editable Automatic Furnishing of Architectural Floor Plans](https://arxiv.org/html/2606.10953) — arXiv 2606.10953 (2026); a published numeric penalty rubric (door swing 0.60 m, window band 0.40 m, wall-touch 0.15 m)
- [ProcTHOR: Large-Scale Embodied AI Using Procedural Generation](https://arxiv.org/pdf/2206.06994) — NeurIPS 2022; semantic asset groups, room/location annotations
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

**Residential space planning (the numbers in §3.9.3)**
- [Space Stylists & Co — Common clearances](https://www.spacestylistsco.com/blog/commonclearances) · [Archi-Monarch — Residential space planning](https://archi-monarch.com/residential-space-planning/) · [Arcedior — Chair clearance behind dining tables](https://arcedior.com/blog/chair-clearance-behind-dining-tables)

**Accessibility / ergonomics**
- [US Access Board — Clear Floor Space and Turning Space](https://www.access-board.gov/ada/guides/chapter-3-clear-floor-or-ground-space-and-turning-space/) (60″ / 1524 mm turning circle; 36″ / 915 mm route)
- [AS1428.1 design information](https://moddex.com/practical-design-information-about-disability-access-compliance-for-new-building-work-as1428-1/) (1500 mm circulation space)

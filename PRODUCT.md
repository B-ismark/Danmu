# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

**Primary — the design hobbyist.** Someone who enjoys interiors as a creative
hobby: they play, experiment, and mood-board rooms for the pleasure of it, at
home, in a browser, on their own time. They are not required to be planning a
real purchase — but the same person often *drifts* into real stakes (see
Success), so the product must serve both the play and the occasional real
decision without forcing a mode choice up front.

No account, no onboarding gate, no credentials required to start.

## Product Purpose

Danmu is a **local-first interior decoration simulation**. The user picks a
footprint (or captures a real room with photos); Danmu rebuilds it as a scaled
1:1 3D space; and the user redecorates freely — place, move, recolour, restyle,
relight, and arrange furniture. The 3D studio *is* the product.

Success is deliberately plural. A session is a win when the user achieves any of:

- **Creative play / relaxation** — the act itself is the reward; no real-world
  outcome required.
- **Confidence to commit** — they trust the layout and real-world dimensions
  enough to buy furniture or start an actual redecoration.
- **Communicate a plan** — they produce something to align a partner, landlord,
  or friend on a direction.
- **Explore before renovating** — they de-risk a bigger change by trying
  layouts and palettes before any physical work.

## Positioning

A **playful decoration sandbox whose dimensions are trustworthy because they are
code, not AI** — running fully on-device with no backend and no account. A
neighboring product cannot truthfully copy the combination: most 3D room tools
are either technical CAD (accurate but cold and account-bound) or casual
mood-board toys (fun but dimensionally fake). Danmu is warm and playful *and*
dimensionally real *and* private-by-construction at the same time.

## Operating Context

- Runs entirely in the browser. Room data persists to IndexedDB; settings and
  the optional API key to localStorage. The only network call is one optional,
  direct Gemini request (user's own key) during photo detection.
- Two ways in: **quick start** (pick a footprint, land straight in the studio
  with a contextual starter scene) or **capture** (footprint → 4-wall guided
  room capture → furniture detection → studio).
- Two studio surfaces only: **3D Model** and **2D Plan**.
- If detection is unavailable, the studio still fully works — pick a footprint
  and decorate.

## Capabilities and Constraints

**Capabilities:** place / move / recolour / restyle / relight / arrange
furniture in real-time 3D; parametric furniture shapes plus decor; a 2D
top-down floor plan; one-tap restyle palettes; optional photo capture and
furniture detection; saving a room to a file and opening one back — which is how a
room is shared, backed up, and moved between devices without a server.

**Constraints (durable):**

- **Dimensions are code, not AI.** Every size passes through the deterministic
  geometry engine and is clamped (`clampDims`); the AI's size guess is a *hint*
  only. The geometry engine owns real-world sizing, placement, overlap, and
  clearance.
- **AI is optional and detection-only.** Detection runs best-effort (local
  YOLOv8 ONNX, or the user's own Gemini key) and is never required to use the
  product.
- **No AI image generation — ever.** The old photoreal render / compose /
  compare / share pipeline was deleted permanently and must not return, nor any
  AI-render / model-name / cost / quota language in the user-facing UI.
- **No backend.** Nothing leaves the browser except the one optional detection
  call above. A room is shared as a file the user saves and hands over
  themselves — never by uploading it somewhere.
- **A shared room carries no photographs.** The scene file holds the room and its
  furniture; the wall photos stay on the device that took them. A file is made to be
  sent to someone, and the captures show the inside of a home.
- **Single source of truth for furniture** is the scene spec + parts catalog;
  the 3D scene, 2D plan, inspector, catalog, and decor all read from it.

## Brand Commitments

- **Name:** Danmu.
- **Personality (binding):** warm, playful, approachable, rounded — and
  deliberately **not** a technical / professional CAD tool. Future work may
  evolve the look, but must not drift the product into cold, CAD-like territory.

*(Palette, typography, and other visual specifics are owned by DESIGN.md, not
this record.)*

## Evidence on Hand

- Real project artifacts: `DESIGN.md` (canonical design + architecture),
  `CLAUDE.md`, `README.md`, and the running codebase on `main`.
- Licence: **MIT**. Open source. (Optional local YOLOv8 detector weights the
  user may export are AGPL-3.0 and are not committed.)
- **No** testimonials, customers, user counts, pricing, benchmarks, or press
  exist. Future work must not fabricate any of these.

## Product Principles

1. **Play first, trust always.** A creative sandbox whose dimensions are real
   enough to act on — serve the hobbyist's fun without ever making the numbers
   lie.
2. **Local-first and private by construction.** No backend, no account; data
   stays in the browser. Privacy is a structural fact, not a setting.
3. **Dimensions are code, not AI.** Deterministic geometry owns sizing and
   placement; AI is a hint that never becomes authority.
4. **Detection-only AI, never generative.** No AI image generation, ever.
5. **Warm and playful, never CAD.** When in doubt, choose approachable over
   technical.

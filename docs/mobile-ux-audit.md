# Danmu — Mobile UX/UI Audit (2026-09-04)

Scope: every route (`/`, `/onboarding/*`, `/workspace`, `/settings`, `/room/[id]/{model,plan}`),
the studio shells, the design system in `app/globals.css`, the 3D touch layer
(`components/three/Draggable.tsx`), camera pipeline (`lib/capture.ts`), and PWA surface
(`app/manifest.ts`, service worker).

Note: the earlier critiques in `.impeccable/critique/` claim "zero @media queries" and
"capture has no mobile layout". That is stale — the current code has `@media` blocks at
1180/720px, JS breakpoints, a stacked studio, a capture filmstrip, and real touch
gestures in PlanView. This audit is against the current code.

Severity: **P0** flow-breaking on phones · **P1** major friction · **P2** polish.

---

## Systemic issues (fix once, every flow improves)

### S1 — P0: iOS auto-zoom on every input
`.field` is 13px (`globals.css:717`), NumberField 30px tall, EditableText inputs 13–14px.
iOS Safari force-zooms the viewport when focusing any input with font-size < 16px, and
this app correctly does *not* disable user scaling — so every field focus (workspace
filter, room rename, settings key, capture phone-height, detect rename) produces a
jarring zoom-jump that does not always recover.
**Fix:** `@media (pointer: coarse) { input, textarea, select { font-size: 16px !important; } }`
— the single highest-leverage block in this audit.

### S2 — P1: No safe-area handling despite shipping a PWA
Zero hits for `env(safe-area-inset-*)` / `viewport-fit=cover`, but `app/manifest.ts` +
`ServiceWorkerRegistrar` + `apple-icon.tsx` mean the app is installable standalone. On an
installed iPhone: `.chrome-bar` content tucks under the Dynamic Island, `.sticky-cta`
sits on the home indicator, `StorageToast` clips under the notch.
**Fix:** `viewport-fit=cover` in the viewport export; pad `.chrome-bar`, `.sticky-cta`,
Modal, and toasts with `env(safe-area-inset-*)`.

### S3 — P1: Touch targets under 32px across the design system
`.icon-btn` has the right pattern (44px invisible `::after` hit pad, `globals.css:406`).
Nothing else does. Sub-32px controls with no pad: Export trigger 28 (`ExportMenu.tsx:189`),
SelectionHeader 26, RoomTools "Apply" 24, detect "Show" 26 + repair chips 22,
StorageToast actions 26, StudioTabs 28, TransformToolbar 30, PlanChrome "Fit" 28,
`.ds-chip` 28. Dense toolbar clusters (undo/redo + zoom + modes) make mis-taps likely.
**Fix:** extend the `::after` pad pattern to `.ds-chip` / `.toolbar > button` / small
`.ds-btn`, or raise heights under `(pointer: coarse)`.

### S4 — P1: Sticky hover on iOS
Every `:hover` style (`.list-row`, `.icon-btn`, `.editable`, card lift) latches after a
tap on iOS and never clears until you tap elsewhere.
**Fix:** wrap hover rules in `@media (hover: hover)`.

### S5 — P1: Modal has no height ceiling, scroll lock, or sheet form
`Modal.tsx` centers a `min(width, 92vw)` card with `padding: 20`, no `max-height`, no
body scroll-lock. Tall dialogs (studio gate, Confirm, RoomSwitcher) clip in landscape
(390px height); the background rubber-bands behind on iOS.
**Fix:** `maxHeight: min(85dvh, …)` + internal scroll, body scroll lock, and a
bottom-sheet variant below 480px.

### S6 — P2: No `touch-action: manipulation` on controls
Rapid taps on canvas tools can trigger browser double-tap zoom.
**Fix:** `button, a, [role='button'] { touch-action: manipulation; }`.

### S7 — P2: Android install is broken by the icon ladder
Manifest ships only SVG; Chrome wants 192/512 PNG (+ `purpose: 'maskable'`) before
offering install. iOS is covered by `apple-icon.tsx`.

### S8 — P2: Toasts top-right, 26px actions
`StorageToast.tsx:113` pins top-right — collides with the wrapped chrome bar / notch, and
the 14s "Undo" (the most valuable control on the workspace) has a 26px target. Bottom +
safe-area on touch.

### S9 — P2: 10–11.5px meta text everywhere
Below comfortable mobile legibility. Floor at 12px on coarse pointers.

---

## Flow 1 — Welcome (`app/onboarding/welcome/page.tsx`)

Already good: `page-pad` drops to 16px on phones, `.auto-grid` single-column with DOM
order = reading order, `clamp(34px,5vw,54px)` h1, 52px full-width CTA, AI-key disclosure
wraps with `minHeight: 44`, CSS-only vignette.

- **W1 — P1: the hero sells a path that dead-ends on a phone.** "Start decorating" →
  layout-pick → studio → the "studio wants a mouse" gate. A phone visitor walks three
  screens into a modal that then sends them to capture anyway. On touch
  (`hover: none and pointer: coarse`) invert the hierarchy: primary "Photograph your
  room", secondary "Build it on a laptop".
- **W2 — P2:** AI-key field inherits S1 zoom.

## Flow 2 — Layout pick (`app/onboarding/layout-pick/page.tsx`)

Already good: roving tabindex, derived areas, full-width 44/48px CTAs, DocShell wraps.

- **L1 — P1: same dead-end as W1.** On touch, "Start decorating" leads into the gate;
  "Photograph my real room first" is ghost-weight below it. Swap order/weight on touch.
- **L2 — P2: five stacked shape cards push the CTAs below the fold.** Each card is a
  full-width row on a phone (~110px each + header) so the primary action lands under
  667px. Two-up grid on phones (`minmax(min(150px,100%),1fr)`) surfaces the CTAs.

## Flow 3 — Capture (`app/onboarding/capture/page.tsx`)

Already good: 720px JS breakpoint; phone+camera full-bleed viewfinder + filmstrip;
`.sticky-cta` bottom CTA; designed camera-permission errors with an Upload escape;
permission primed on gesture; photos normalized to 1600px; per-shot IndexedDB writes;
live-region announcements; device tilt + stated height recorded.

- **C1 — P0: landscape phones fall out of the mobile layout entirely.** `NARROW` is
  width-only (`(max-width: 720px)`, line 104) and non-narrow uses `height: 100vh`
  (line 541) + the desktop `1fr 360px` camera split. An 844×390 landscape phone — the
  natural way to hold a phone while photographing a room — gets a 360px side rail on a
  390px-tall screen, and `100vh` includes iOS's collapsing URL bar so the filmstrip
  sits under browser chrome. **Fix:** `(max-width: 720px), (max-height: 520px)` and dvh.
- **C2 — P1: on-photo chip targets.** `photoChrome` chips are 22/26px tall on top of
  live photos — Replace/Remove/Move mis-taps. Give action chips ≥32px hit area or fold
  into one "⋯" per card on touch.
- **C3 — P1: drag-to-reorder is desktop-only.** `<img draggable>` (lines 894–899) does
  nothing on touch; the fallback is opening each card's Move menu. Long-press-drag would
  be the native gesture.
- **C4 — P2:** the wrapped top bar (back + title + count + flagged pill + Upload|Camera
  segmented + Skip) costs ~2 rows of the viewfinder on a phone. Fold the source toggle
  under the shutter on narrow.
- **C5 — P2:** "Phone height off the floor" NumberField (30px, S1 zoom) scrolls away in
  camera mode — surface it as a chip on the viewfinder instead.

## Flow 4 — Detect (`app/onboarding/detect/page.tsx`)

Already good: `.split--stack` reflow ≤720; review undo/redo; keyboard box placement;
honest privacy line; calm no-key notice; cancellable LoadingOverlay; truthful status
live region.

- **D1 — P0: the review list is an uncapped sheet and the only CTA scrolls away.** The
  stacked rail row is `auto` (globals.css:908) with no max-height: with 15+ pieces the
  page becomes one long scroll, and "Continue to the studio" lives only in the top bar
  (line 788). Capture solved this with `.sticky-cta`; detect didn't get one.
  **Fix:** sticky CTA + `max-height: 45dvh` with internal scroll on the sheet.
- **D2 — P1: the 721–1023px gap keeps the desktop split.** Inline `'1fr 380px'`
  (line 861) is only overridden ≤720, so large-phone-landscape / iPad-portrait squeeze
  the photo pane to half width while the rail keeps its full 380px.
- **D3 — P1: the photo is unzoomable and unscrollable.** `PhotoEditor.tsx:94` sets
  `touchAction: 'none'` on the whole photo — on a phone that's ~55dvh of screen you
  cannot scroll from, and there is no pinch-zoom, so confirming a small box means
  working on a ~360px-wide image. Add pinch/pan zoom (or `pan-y` when not in add mode).
- **D4 — P1: row + overlay targets.** "Show" 26px, repair chips 22px, on-photo × ~20px.
- **D5 — P2:** the manual-add toolbar is a wrapping row of 34px buttons + a keyboard hint
  ("Arrow keys move it…") that is noise on touch — hide under `(hover: none)`.
- **D6 — P2:** local ONNX detection downloads models and burns battery/quota on cellular;
  say so (or default to manual) on touch/cellular.

## Flow 5 — Workspace (`app/workspace/page.tsx`)

Already good: `noHover` → always-visible card actions; real `<a>` cards; recency groups;
bulk delete + 14s Undo toast; shortcuts.

- **K1 — P1:** header actions 32px (Settings / Import / New Room) — the page's primary
  action is under 44px on touch.
- **K2 — P2:** filter + inline rename inherit S1 zoom.
- **K3 — P2:** Undo toast placement/size — see S8.

## Flow 6 — Settings (`app/settings/page.tsx`)

Already good: `row-grid` collapses ≤720; per-failure authored copy; 15s test timeout;
wired labels.

- S1 applies at its worst here — the key field is a long paste target; iOS zoom-jump
  mid-paste loses your place.
- **P2:** danger-zone buttons 32px.

## Flow 7 — Studio 3D (`/room/[id]/model`)

Already good: honest gate (touch/narrow) with capture path + remembered "open anyway";
stacked layout ≤1023 with canvas-first DOM order and a no-shift `ready` gate; dwell
pick-up (280ms + 10px slop, `Draggable.tsx:84`); second-finger twist; camera keeps the
gesture until the dwell fires; `PerformanceMonitor` + `AdaptiveDpr`; the gizmo
press-plumbing (`lib/gizmo-press.ts`) fixes invisible-plane steals.

- **M1 — P0 (strategic): "Open it anyway" is a squeezed desktop studio.** On a 390px
  phone the canvas gets ~390×460 while TransformToolbar (Move/Scale/Rotate + Snap ≈
  340px) + CatalogToggle wrap into 2–3 rows over it, UndoRedo sits top-right, ViewGizmo
  bottom-right — chrome eats ~40% of the canvas, and `W/S/R` keycaps are meaningless on
  touch. If touch studio is a supported path (the gate permits it), it needs a
  touch-mode toolbar: icon-only 40px controls, bottom-docked, collapsible, no keycaps.
- **M2 — P1: dwell-to-pick-up is undiscoverable.** Nothing says "hold to pick up · one
  finger orbits · two fingers twist". The StudioHelp coach infrastructure exists — add a
  one-time touch-mode card when a touch pointer opens the studio.
- **M3 — P1: TransformControls handles (`size={0.8}`) are 10–16px on a phone canvas.**
  Scale the gizmo up on coarse pointers or add touch-sized handles.
- **M4 — P1: `quality: 'high'` is the default for everyone** (`lib/store.ts:224`) —
  N8AO + SMAA + shadows at DPR 2 is the first-impression jank moment on phone GPUs.
  Default 'low' on coarse pointers / low `deviceMemory`; the toggle already exists.
- **M5 — P2:** Library panel covers ~70% of a phone canvas and its primary instruction
  ("Drag a piece in") is impossible on touch; tap-to-drop lands in "the first clear
  spot", not where you want. On touch: full-width bottom sheet + two-step placement
  (tap piece → tap floor).
- **M6 — P2:** Inspector/PartTree chips + swatches 28px, NumberField 30 — the stacked
  rail is full-width on a phone; there is room for bigger targets (S3).
- **M7 — P2:** room rename input inherits S1; downloads on iOS are awkward — consider
  Web Share for PNGs on touch.

## Flow 8 — Studio 2D plan (`/room/[id]/plan`)

Already good: one-finger pan + two-finger pinch (`PlanView.tsx:869–905`); hover
suppressed on touch (1017); wrapping zoom toolbar; comfort legend capped.

- **P1 — P1: wall handles + NorthDial are precision desktop targets.** Resizing walls by
  touch is sub-44px work on a small canvas.
- **P2 — P2:** the zoom/rotate/fit row (~450px) wraps over a 390px canvas;
  "Fit" button 28px without a hit pad.
- **P3 — P2:** the comfort legend (320px) covers half a phone canvas — auto-collapse to
  a "?" chip on narrow.
- **P4 — P2:** same Library-on-touch issue as M5 (tap-to-drop exists; drag doesn't).

---

## Priority order

1. **S1** — one CSS block; kills iOS zoom-jumps on every screen.
2. **C1** — landscape-phone capture + dvh.
3. **D1** — detect sticky CTA + capped review sheet.
4. **D3** — photo pinch-zoom / scroll on detect.
5. **W1 + L1** — touch-aware CTA hierarchy in onboarding (phones go capture-first).
6. **S2** — safe areas for installed PWA.
7. **S3 + S4** — hit-pad and sticky-hover system pass.
8. **M1 + M2** — touch-mode studio toolbar + coach card.
9. **M4** — quality default on touch.
10. **S5** — modal sheet/scroll pass.

Everything above P1 is small, well-scoped work — the foundations (breakpoints, dvh,
wrapping bars, stacked shells, touch gestures, honest gating) are already in place and
are better than most web apps ship.

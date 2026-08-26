# The 2D plan — UX pass and remediation plan

**Dated 2026-08-25. Status: shipped, except where a phase says otherwise.** Every
phase below carries its own outcome line. `Design.md` and `CLAUDE.md` were updated
in the same pass and are the live description of the app; this file is why it looks
the way it does, and it keeps the findings that motivated each change.

**Verified after the work:** `pnpm typecheck`, `pnpm test` (1006 tests, 56 files),
`pnpm lint` at `--max-warnings 0`, and `pnpm build` all pass. Two new suites came
with it — `tests/plan-hit.test.ts` and `tests/pick-through.test.ts` for the
picker, `tests/drag-resolve.test.ts` for the extracted pipeline.

**Where the work deviated from this plan**, each for a reason found while doing it:

- `hitsAt` returns plain ids rather than the `PlanHit[]` sketched below; nothing
  needed the extra shape. It gained a sibling the plan did not foresee —
  **`planPaintOrder`** — because "topmost" turned out to be undefined: the plan
  painted in insertion order, so which of two overlapping pieces a click got
  depended on the order the user had added furniture in. Ordering by descending
  footprint area makes the drawing and the picker agree by construction, and it is
  what a floor plan wants anyway (the rug under the table under the lamp).
- The multi-add does **not** end on `lib/layout-settle.ts`, as Phase 3b-2 said it
  would. Settling moves furniture that is already placed, and "add three chairs" is
  not permission to rearrange the room. Sequential `placeNewPart` calls give each
  new piece the previous one as an obstacle, which is what the requirement actually
  needed.
- The 3D tab's right-click needs its own raycast to offer "Select what's here" (a
  native `contextmenu` on the wrapper element is not an R3F pointer event, so there
  is no `intersections` to read). `DropConnector` now stashes the scene alongside
  the camera and renderer, which is the same mechanism the drop handler already
  used.
- Phase 5d's "raise the selection in paint order" was **dropped as unnecessary**:
  `planPaintOrder` already puts small pieces on top of large ones, which was the
  case that motivated it. Renaming the user-facing **Locked** wording is
  **deferred** — it touches the Inspector, the HoverCard and the plan together, and
  belongs with a pass over that vocabulary rather than tacked onto this one.

Scope: `components/studio/PlanView.tsx`, its chrome (`PlanChrome.tsx`), the two
things it shares with the 3D tab — selection and dragging — and the two lists
beside the canvas that express the same selection (`PartTree.tsx`,
`CatalogPanel.tsx` / `LibraryPicker.tsx`). Triggered by one feature request (a
modifier-click that disambiguates overlapping pieces) that turned out to sit on
top of several older gaps, and extended by a second (list multi-select and
add-by-modifier) that shares the same selection plumbing.

---

## Part 1 — The UX pass

### The thesis: borrow the spatial grammar, refuse the modal grammar

`PRODUCT.md` binds this app to "warm and playful, never CAD" and "deliberately
**not** a technical / professional CAD tool". The request is for interactions
"in line with standard practice like Blender". Those are only in tension if you
take the whole of Blender. Split it in two:

- **Spatial grammar — adopt it.** What the mouse does over a drawing: which
  button pans, what a drag on empty space means, what a modifier does *during* a
  gesture, how you reach a thing hidden under another thing. This is shared
  muscle memory across Blender, Figma, Illustrator, Sketch and every CAD tool,
  it is invisible when it is right, and it carries no professional tone at all.
- **Modal grammar — refuse it.** `G`/`R`/`S` followed by an axis letter, a typed
  number and a confirm/cancel keypress. That is a language you learn, it is the
  single most CAD-coded thing about Blender, and this app already answers the
  same need with direct drag + arrow-key nudges + the Inspector's number fields.

Everything proposed below is from the first list. Nothing from the second.

Verified against Blender rather than remembered: Alt + select-click in Object
Mode pops **a list of every object under the cursor**, and Shift-Alt adds the
chosen one to the selection instead of replacing it — which is exactly the
requested feature and its natural extension. In 2D editors, middle-drag pans and
the wheel zooms. And across the industry, a click-drag on empty space is a
marquee while a click-drag on an object moves it.

### What the plan already gets right (and must not regress)

- It draws the ergonomic rules as floor regions off the same `accessZones` /
  `clearance-field` the room report reads — no third copy of the numbers.
- It is reachable without a pointer: pieces, walls and the rotate handle are
  focusable and take arrow keys, with a live region behind them.
- Touch is real: one finger pans, two pinch.
- A blocked drag slides along what it hit, tints `--danger`, and says so out
  loud instead of failing silently.
- Its chrome is owned by the page through `PlanViewHandle`, which is what stopped
  the two tabs drifting.

### Findings

Severity: **P1** = wrong or misleading behaviour · **P2** = missing vocabulary a
user will look for · **P3** = polish.

#### A. Parity with the 3D drag — the same gesture, different physics

The 3D `Draggable` resolves a drag through containment → wall snap → magnetic
item-to-item snap → gravity/support → exact OBB collision, cascades to
rigid-parented children, and snaps rotation to the snap mode's step. The plan's
`moveTo` does `clampToRoom` + `collidesAt` and nothing else. Consequences:

- **A1 (P1) — `snapMode` does not exist for a plan drag.** The setting the
  toolbar shows, and which the plan's own arrow keys honour
  ([PlanView.tsx:127-129](../../components/studio/PlanView.tsx#L127-L129)),
  is ignored the moment you use the mouse. Edges do not go flush, centres do not
  align, no snap lines are drawn. Blender's convention for this is Ctrl held
  during a transform; here the mode is already a persistent setting, so the
  drag simply has to read it.
- **A2 (P1) — a plan drag breaks rigid parenting.** It calls `setPosition`
  directly ([PlanView.tsx:434](../../components/studio/PlanView.tsx#L434)),
  while `Draggable` runs `cascadeTransform` over `snapshotDescendants`. Drag a
  desk in 3D and its lamp follows; drag the same desk in the plan and the lamp
  stays behind.
- **A3 (P1) — a plan drag leaves things floating.** `y` is carried through
  untouched, so dragging a vase off the table it sits on keeps it at table
  height over bare floor. `Draggable` re-resolves support with
  `findSupportDetailed` / `groundY`. The plan is a top-down view, which is
  exactly why the user cannot see that this happened.
- **A4 (P2) — no way to cancel a drag.** Blender cancels a transform with
  Esc or RMB and restores the original. Here Esc is bound globally to *deselect*
  ([KeyboardShortcuts.tsx:356-359](../../components/studio/KeyboardShortcuts.tsx#L356-L359)),
  the drag has no cancel at all, and the only way back is Ctrl+Z after the fact.
- **A5 (P3) — rotation does not step.** `setRotation` takes the raw pointer
  angle; the 3D gizmo quantises to 15°/45° by snap mode.

The shape of this is familiar from this repo's own history: two consumers of one
rule each carrying their own copy. The fix is the same as it was for
`layout-rules` — extract the resolve, let both surfaces call it.

#### B. Selection vocabulary — the plan can only select one thing, one way

- **B1 (P2) — no multi-selection.** The store has `selection[]`,
  `toggleInSelection` and `setSelection`; `SelectionHeader` already renders for a
  set. The plan writes only `setSelected`
  ([PlanView.tsx:359](../../components/studio/PlanView.tsx#L359)), so
  Shift-click extends nothing, and Ctrl+A / Ctrl+D / the context menu's
  duplicate-and-delete operate on a selection the plan cannot express.
- **B2 (P2) — no marquee.** A left-drag starting on empty floor does nothing at
  all ([PlanView.tsx:303-347](../../components/studio/PlanView.tsx#L303-L347)),
  which is the one gesture every 2D tool spends on box-select. Free, and the
  most valuable single addition on this list.
- **B3 (P2) — no way to reach an overlapped piece.** The originating request. A
  rug under a table under a lamp: only the last-painted one is clickable, and
  paint order is store order.
- **B4 (P1) — nothing in the plan ever sets `hoveredPartId`.** Only
  `Pickable` does, in 3D ([Pickable.tsx:48](../../components/three/Pickable.tsx#L48)).
  Three things follow: the plan has no hover feedback of any kind; `HoverCard`
  never appears there; and `SceneContextMenu` is handed a hover id that is null
  or stale from the 3D tab
  ([PlanView.tsx:612](../../components/studio/PlanView.tsx#L612)), so
  right-clicking a piece in the plan opens the *room* menu — or worse, another
  piece's actions. `SceneContextMenu.tsx:14` states as fact that "Both surfaces
  keep `hoveredPartId` current." It is true of one of them.

#### C. Navigation

- **C1 (P1) — Alt is already spent, in the view that most needs it.** Alt-drag
  free-rotates the drawing
  ([PlanView.tsx:333-342](../../components/studio/PlanView.tsx#L333-L342)),
  advertised in `planHelp()` as "Alt-drag turns the page". Free rotation is also
  the weakest of the three ways to rotate: `[` / `]` and the two toolbar buttons
  both step 15°, which is what a floor plan actually wants, and free rotation
  makes every label and dimension line fight its own angle.
- **C2 (P2) — a trackpad cannot pan.** `onWheel` always zooms and never reads a
  modifier ([PlanView.tsx:236-241](../../components/studio/PlanView.tsx#L236-L241)).
  Two-finger scroll arrives as a wheel event, so on a laptop the only pans left
  are middle-drag (no middle button), Shift-drag and Space-drag. Blender's 2D
  editors give Ctrl/Shift+wheel to panning; macOS pinch arrives as a
  ctrl-modified wheel, which is the one case that must stay zoom.
- **C3 (P2) — no frame-selected, and `F` lies.** `fit()` resets zoom, pan and
  rotation ([PlanView.tsx:186-190](../../components/studio/PlanView.tsx#L186-L190));
  there is no "put the thing I selected in the middle". `F` is bound to the
  camera's `frameSelected`, so in the plan it is a silent no-op. Blender: Home
  frames all, numpad-period frames the selection.
- **C4 (P2) — hit targets scale with zoom.** Everything lives inside one
  `scale(zoom)` group, so at 0.4× the rotate handle is a ~4-unit dot and the
  wall grab lines are ~6 units wide, while at 4× the same handle is a 36-unit
  blob over the furniture. Handles and hit bands belong in screen space, which is
  what every tool with a gizmo does.

#### D. Feedback and legibility

- **D1 (P1) — the plan ignores `hidden`, so `V` is a no-op there.**
  `Room.tsx:156` filters hidden parts out of the 3D tree;
  `useRoomScene()` does not filter, and the plan does not either
  ([PlanView.tsx:93](../../components/studio/PlanView.tsx#L93)). So a piece you
  hid is invisible and unpickable in 3D, and fully drawn and draggable in the
  plan — while `V` remains armed on both tabs and appears to do nothing on one
  of them. Hiding is in undo history precisely because it is an edit and not a
  view preference; the two tabs disagreeing about it is not defensible either
  way round.
- **D2 (P2) — labels are the first word, truncated to 8 characters**
  ([PlanView.tsx:855](../../components/studio/PlanView.tsx#L855)). Two dining
  chairs both read "Dining". Font size scales with zoom (same `scale(zoom)`
  group as C4), so labels are unreadable zoomed out and oversized zoomed in.
  This is also what makes B3's menu hard: rows need something better to say.
- **D3 (P2) — nothing measures during a drag.** The 3D tab has
  `MeasureGuides`; the plan, which is the tab whose entire premise is trustworthy
  dimensions, shows no distance-to-wall and no gap-to-neighbour while you move a
  piece. It is also the cheapest place in the app to show one.
- **D4 (P3) — "Locked" reads as "I locked this".** `ScenePart.locked` means
  "preserved from a photo" ([scene-spec.ts:170](../../lib/scene-spec.ts#L170)).
  The plan hatches it, tints it `--locked`, the Inspector and HoverCard show a
  **Locked** pill — and it drags freely, correctly. Nothing is broken; the word
  is. (Renaming a persisted field is out of this pass's scope; the *label* is
  not.)
- **D5 (P3) — `W` / `S` / `R` are armed in the plan and do nothing visible.**
  They set the 3D gizmo's transform mode
  ([KeyboardShortcuts.tsx:376-385](../../components/studio/KeyboardShortcuts.tsx#L376-L385)).
  Pressing `R` over a floor plan silently changes a setting on the other tab.
- **D6 (P3) — no drop target.** The catalog's rows are deliberately not
  draggable here because the page catches no drop, so the plan offers
  click-to-drop-in-the-centre. Dropping at the pointer is the obvious
  expectation of a top-down view, and `onDrop` in `Room.tsx` is already the
  pattern to copy.
- **D7 (P3) — no z-order.** `parts.map` paints in store order and the selected
  piece is not raised, so a selected chair can sit under a table's fill, rotate
  handle and all.

#### E. The lists beside the canvas

- **E1 (P2) — the rail's piece list is single-select.** `onSelect` calls
  `setSelected` and rows compare against `selectedPartId`
  ([PartTree.tsx:295-300](../../components/studio/PartTree.tsx#L295-L300)), so
  the list cannot show or build a multi-selection. It is a real `role="listbox"`
  with a roving tabindex and it is explicitly the accessible twin of the canvas —
  which means as soon as the canvas gains a marquee, this list becomes the
  component that lies about the selection.
- **E2 (P2) — the library list has no selection at all.** A click spawns
  immediately ([CatalogPanel.tsx:151](../../components/studio/CatalogPanel.tsx#L151)),
  so "add these four" is four separate round trips, and there is no way to pick
  a set of models before committing them.
- **E3 (P3) — the rail list's search box is labelled as the other panel.**
  Placeholder "Search the catalog…", `aria-label` "Search the furniture in this
  room" ([PartTree.tsx:265-270](../../components/studio/PartTree.tsx#L265-L270)).
  A sighted user and a screen-reader user are told two different things about the
  same field, and the sighted one is told the wrong one.
- **E4 (P3) — "Catalog" already names two things.** The library tab, the rail
  button, the canvas chip and the picker's placeholder all say Catalog; the room's
  own contents are "Pieces". Which word means "what I own" and which means "what
  I can add" is currently decided by which panel you happen to be looking at.

### Explicit non-goals

No modal transform keys (`G`/`R`/`S`), no axis-constraint letters, no numeric
entry buffer, no command line, no snapping-to-arbitrary-reference, no layers
panel, no "professional" chrome or vocabulary. If a change reads as CAD, it is
wrong here even when it is standard there.

---

## Part 2 — The plan

Ordered by dependency, not by value. Phases 0 and 1 unblock the requested
feature; each later phase is independently shippable.

### The dependency map

```
0a lib/plan-hit.ts ──┬──► 2 Alt-click menu + cycling
                     └──► 3 marquee / shift-click in the plan
0b plan writes hover ─┬─► 2 (row hover previews the candidate)
                      ├─► the plan's right-click menu stops being wrong (B4)
                      └─► HoverCard + hover outline in the plan
1 free Alt ──────────────► 2 (blocker: Alt is taken until this ships)
3 canvas multi-select ◄──► 3b rail list multi-select   [SHIP TOGETHER]
4a lib/drag-resolve.ts ──┬► snap / cascade / support parity (A1-A3, A5)
                         └► the plan honours `hidden` (D1) ──► 2, 3 candidate
                                                              filters
5a screen-constant handles ──► makes 2's small candidates hittable at all
6 docs ◄── every phase (planHelp is the only discovery surface)
```

Four dependencies are easy to miss and each one bites silently:

- **2 needs 0b, not just 0a.** A list of names with no hover preview is a list of
  guesses — and two pieces of the same model produce two identical rows.
- **3 and 3b are one shipment.** A marquee that selects four pieces while the
  rail highlights one is worse than no marquee.
- **D1 changes what 2 and 3 may return.** Once `V` hides from the plan, hidden
  parts must leave the candidate list and the marquee — so the filter has to sit
  where both read it, not in one of them.
- **5a is a prerequisite for 2 in practice.** The reason you need a
  disambiguation menu is that the thing you want is small or covered; if handles
  and hit bands still shrink with zoom, the feature papers over a defect instead
  of fixing it.

### Phase 0 — The shared foundation: hit-testing and hover · SHIPPED

Nothing else in this document is possible without these two, and three separate
findings collapse into them.

**0a. `lib/plan-hit.ts` — what is under this point, in order.** Pure, given
world coordinates and the resolved parts:

```
hitsAt(x, z, parts): PlanHit[]     // topmost-first, dedup by id
hitsInRect(rect, parts): string[]  // for the marquee
```

Geometric, not DOM-based: it tests the point against each part's rotated
footprint via `lib/geometry`'s `Foot` / OBB helpers, so a round piece is tested
against the **inscribed ellipse** the renderer actually draws and the collision
maths already uses — `elementsFromPoint` would instead depend on paint order and
require a `data-part-id` the SVG does not carry. Order: paint order reversed
(topmost first), ties broken by smaller footprint, so a lamp on a table
outranks the table.

- Edge cases: zero hits (must be a no-op, never a deselect); a part whose
  footprint is degenerate (0-dim after an import); hidden parts (see 4a — the
  filter is the caller's, so the lib stays honest); walls are **not** parts and
  are handled separately by the existing edge hit lines.
- Tests: `tests/plan-hit.test.ts` — a rect hit and miss inside its own frame at
  0°/45°/90°; the ellipse case (a point in the corner of a round part's bounding
  square must miss); nesting order for three stacked parts; marquee
  intersect-vs-contain.

**0b. The plan writes `hoveredPartId`.** `onPointerMove` (and part-level
`onPointerEnter`) set it; `onPointerLeave` on the `<svg>` clears it. Same
`gestureOwnedByOther` discipline as `Pickable`: a drag in progress owns hover.
This fixes **B4** outright, gives the plan `HoverCard` and a hover outline for
free, and makes the existing right-click menu correct.

- Edge cases: clear hover on unmount and on tab switch (a stale 3D hover already
  leaks into the plan today — `Pickable`'s unmount effect covers the 3D side, so
  the plan's own cleanup closes the loop); do not let hover fire per-frame during
  a drag; touch pointers must not leave a permanent hover behind.
- Docs: delete the "both surfaces" claim in `SceneContextMenu.tsx:14` and
  replace it with what is true.

### Phase 1 — Free the Alt key · SHIPPED

Remove Alt-drag free-rotation. Rotation stays on `[` / `]` and the two
`PlanViewControls` buttons, both 15° steps — a strict improvement for a
measured drawing, and the only consumer of Alt.

- Depends on: nothing. Ship before Phase 2.
- Edge cases: `rotRef` and its pointer-capture path come out with it; `rot`
  state, `onViewChange` and the north rose's counter-rotation all stay (the
  buttons still write `rot`); anyone mid-alt-drag when the code changes is not a
  case, but a stuck `rotRef` after a lost pointerup is — the removal deletes
  that failure mode.
- Docs: `planHelp()` loses "Alt-drag turns the page" and gains the new gesture;
  `Design.md`'s plan section; the coach marks, which fire on first drag.
- **Ratified 2026-08-25: drop it. Shipped.** `rotRef` and its capture/release
  path came out with it, `planHelp()` was rewritten around the new gestures, and
  `[` / `]` plus the toolbar buttons are now the only way the page turns.

### Phase 2 — Alt-click disambiguation (the requested feature) · SHIPPED

One menu, both surfaces, built on Phase 0.

- **3D**: in `Pickable.onClick`, before the shift branch — read `e.intersections`
  (already depth-sorted from that raycast), map each hit up to its owning
  `Pickable` ancestor, dedupe by part id. Filter out everything that is not a
  piece: room shell and wall hit planes, `WallHandles`, gizmo arcs,
  `MeasureGuides`, `Dressing` décor, `PartLight` helpers.
- **2D**: on pointer**up**, not click, and only when the pointer moved less than
  the existing 4px threshold — because Alt-press-and-drag must stay available
  (and after Phase 1, Alt-drag means nothing, so a stray drag should do
  nothing rather than open a menu). Candidates from `hitsAt`.
- **One candidate → select it silently.** Zero → no-op, and specifically not a
  deselect: `onPointerMissed` (3D) and `onCanvasPointerDown`'s modifier-free
  guard (2D) both have to stay out of the way.
- **Shift-Alt-click adds the chosen piece to the selection** instead of replacing
  it, matching Blender. In the plan this needs Phase 3's selection writes; until
  then it degrades to replace.
- **The menu** extends `SceneContextMenu` with a candidate-list request rather
  than becoming a second floating menu — it already owns edge-clamping,
  dismiss-on-wheel/resize/blur, `role="menu"` and arrow-key navigation.
  Rows: category icon + name + a distinguisher, since two "Dining Chair" rows
  teach nothing. Hovering a row sets `hoveredPartId`, so the scene highlights the
  candidate as you read the list — the reason Phase 0b comes first.
- **A second door, because nobody guesses a modifier**: a "Select what's here…"
  entry in the existing right-click menu, which also makes the feature reachable
  on touch (no modifiers exist there — stated at `PlanView.tsx:327-329`) and
  when a window manager eats Alt (GNOME/KDE Alt-drag moves the window; Firefox
  Alt-click means "download"; Alt alone focuses Firefox's menu bar). Hence
  `preventDefault` on the press.
- Edge cases: stale rows — a part deleted, hidden or undone while the menu is
  open (`SceneContextMenu` closes on wheel/resize/blur but not on a scene
  mutation, so it needs to close on a parts change or check per row); close on
  3D↔2D tab switch; a chosen part that belongs to a merged group (list members
  individually and select the member — precision is the point — and let the
  Inspector show the group); walls as candidates route to `setSelectedWall`,
  which is mutually exclusive with part selection
  ([store.ts:231-233](../../lib/store.ts#L231-L233)); long user-typed names must
  ellipsise (`minWidth: 0`) and the menu width must be
  `min(Npx, calc(100vw - 32px))` per rule 4; the gesture must bail while a drag
  or gizmo owns the gesture and while Space is held.
- Tests: `plan-hit` covers the ordering; the candidate-mapping helper for the 3D
  side (intersections → part ids) is pure and gets its own test with a fixture
  list including non-part objects.
**Ratified 2026-08-25: cycling as well as the menu.** Repeat Alt-click within a
small radius of the last one advances to the next candidate down instead of
re-opening the menu — faster than a list for the two-piece case, which is most
of them. The menu stays: it is how you *see* what is there.

- The two must not fight. One press either opens the menu or steps the cycle,
  never both: **first Alt-click at a point cycles** (selects the topmost, or the
  next one down if the point matches the last), and the **menu is the deliberate
  route** — held Alt-click on an already-cycling point, or the right-click
  entry. Simplest rule that stays predictable: cycle on repeat presses at the
  same point, open the menu on the *first* press only when more than one
  candidate exists and nothing is cycling yet.
- Cycle state is a ref, not store state: `{ x, z, ids, index }`, invalidated by
  a press more than ~6px away, by any scene mutation, by a selection change from
  anywhere else, and on tab switch. Without that invalidation the cycle points
  at deleted ids and silently selects nothing.
- Edge cases: the candidate list changing between presses (re-derive and keep
  the index only if the id sequence is unchanged); wrapping past the last
  candidate back to the first, which is what makes it feel like cycling rather
  than a dead end; and cycling must not fight the 4px drag threshold — a press
  that moved is not a cycle step.

### Phase 3 — Selection vocabulary in the plan · SHIPPED

- **Shift-click a piece → `toggleInSelection`**; plain click → `setSelected` (or
  the group, matching `Pickable`).
- **Left-drag on empty floor → marquee**, via `hitsInRect`. Shift-drag extends
  the selection instead of replacing it.
- **This costs Shift-drag-to-pan**, which the help card advertises. Pan survives
  on middle-drag and Space-drag, and Phase 4c adds wheel-panning; the industry
  convention that a drag on empty space is a marquee is worth more than a third
  pan gesture. **Ratified 2026-08-25: drop Shift-drag-to-pan.**
- **Hard dependency both ways with Phase 3b.** The moment the canvas can hold a
  multi-selection, the rail's piece list must show it — it reads `selectedPartId`
  alone today, so a marquee over four pieces would leave the rail claiming one.
  The rail is the accessible twin of the canvas (`PartTree.tsx:20-24`); the two
  disagreeing is worse than neither having the feature. Ship 3 and 3b together.
- Edge cases: a marquee that starts on a piece must move the piece, not select
  (that is the existing behaviour and the reason the empty-space test is on the
  *target*, already checked at `PlanView.tsx:305`); a marquee under 4px is a
  click on nothing → deselect, as today; intersect-vs-contain (pick intersect,
  and say so in the help card); a marquee crossing a hidden part once Phase 4a
  lands; touch has no modifiers, so one finger keeps panning and the marquee is
  pointer-only; `setSelection` must clear `selectedWall`, which it already does.
- Free wins: `SelectionHeader` starts appearing in the plan, and Ctrl+A /
  Ctrl+D / the context menu's multi-part actions start meaning something there.
- Tests: `hitsInRect` under view rotation (the marquee is drawn in screen space
  and tested in world space — the transform is `svgToWorld`, already there).

### Phase 3b — The two lists: multi-select, and adding by gesture · SHIPPED

Two list surfaces in the studio, easy to confuse and named badly, which is part
of the finding:

| Surface | Where | What it lists | Selection today |
|---|---|---|---|
| Rail section **"Pieces"** | left rail, `PartTree.tsx:255-260` | the furniture **in this room** (`role="listbox"`, roving tabindex, per-row Hide / Delete) | single, `setSelected` only |
| Panel **"Add pieces"**, tabs **"Catalog" / "Describe it"** | floating over the canvas, `CatalogPanel.tsx` + `LibraryPicker.tsx` | the **library** you add from (`PART_LIBRARY`) | none — a click spawns immediately |

**3b-0. The naming, first, because the rename collides.** "Catalog" is *already*
the user-facing name of the library side — the tab in `PickerTabs`, the rail
button ("Browse catalog"), the canvas chip, and `LibraryPicker`'s search
placeholder. Renaming the room's piece list to "Catalog" would leave two
different things called Catalog on one screen. The way out that keeps the
requested word: the room's list becomes **"Catalog"**, and the add side takes the
name the code already uses for it internally (`LibraryPicker`, `PART_LIBRARY`,
`searchLibrary`, `PickerTab = 'library'`) and becomes **"Library"** in the UI
too. One knock-on worth fixing in the same pass: the rail list's search box
currently reads "Search the catalog…" while its `aria-label` reads "Search the
furniture in this room" — the placeholder is describing the other panel, which
is very likely why these two read as one thing in the first place.

**3b-1. Shift-click range select, in both lists.** The list convention, and
distinct from the canvas on purpose: in a list Shift extends a contiguous range
from an anchor, while on a canvas Shift toggles one item. Figma does exactly this
split between its layer panel and its canvas, so the inconsistency is the
standard.

- Rail list: `onSelect` grows an event argument; plain click sets, Shift-click
  extends from the anchor through `setSelection`, and the anchor is a ref updated
  on every plain click. Rows read `selection.includes(id)`, not
  `selectedPartId === id`.
- **Ranges span the filtered rows, not the store array.** Both lists are
  searchable, and a range computed over `parts` while the user sees
  `visibleParts` selects things that are not on screen.
- ARIA: `aria-multiselectable="true"` on the listbox, `aria-selected` per row,
  and the keyboard equivalents the pattern requires — Shift+Arrow extends,
  Ctrl+Space toggles one row without collapsing the selection. The rail exists
  *because* the canvas is opaque to assistive tech; a mouse-only multi-select
  there would be the one place that argument does not survive.
- Edge cases: the row's nested Hide / Delete buttons must not receive the range
  gesture; deleting or hiding a row inside a live selection; Enter's "frame this
  piece" behaviour with several selected (frame the anchor); `selectAllParts`
  excludes hidden parts while the rail *shows* them, so Ctrl+A and a manual range
  can disagree about a hidden piece — pick one rule and apply it in both.

**3b-2. Ctrl/Cmd-click adds the clicked model.** As requested. In the library
list this spawns that model without disturbing whatever is selected; in the room
list the same gesture adds another of that piece, which is `duplicateSelection`'s
job and should reuse it rather than grow a second spawn path.

- **macOS: Ctrl+click *is* right-click** and fires `contextmenu` — the same trap
  that made Alt the right answer for the canvas. So the binding is
  `metaKey || ctrlKey` with `preventDefault` on the press, and the row must
  suppress its own context menu for that gesture.
- **This spends the gesture that every file manager, Figma and Explorer use for
  "toggle this one row".** Worth stating plainly: it is a deliberate trade, and
  the recommended alternative — **double-click to add** (the industry "activate"
  gesture for a list row) with Ctrl reserved for toggling — is recorded here so
  it can be swapped by changing one branch. Both can also coexist: double-click
  *and* Ctrl-click add, and per-row toggling lives on Ctrl+Space from the
  keyboard, which the ARIA pattern already requires.
- Where a multi-add lands: sequentially through `placeNewPart`, which takes the
  existing parts and so avoids what the previous one just claimed, then
  `lib/layout-settle.ts` as every other placement path ends (CLAUDE.md rule 3).
  Never N pieces stacked at the room's centre.
- One undo step for one gesture: history debounces mid-gesture writes into a
  single snapshot, so a burst of adds must land inside one debounce window rather
  than as N entries in an 80-deep ring buffer.
- Edge cases: adding while the room is full enough that a piece cannot be placed
  (say so — rule 2's "never silently resize it to fit" has a placement twin:
  never silently drop it); a Ctrl-click on a row whose part was deleted in
  another tab's undo; the library panel's rows are `<button>`s inside a
  `draggable` wrapper, so a modifier-click must not start a drag; and the panel
  is 268px wide, capped `min(268px, calc(100% - 24px))`, so anything new on a row
  reflows rather than spills (rule 4).
- Tests: range-select arithmetic over a filtered list is pure and gets one
  (`tests/list-range.test.ts`): anchor above and below the target, an anchor that
  has been filtered out, a single-row list, and an empty filter result.

### Phase 4 — Drag parity and navigation · SHIPPED

**4a. One resolve, two surfaces.** Extract `Draggable`'s per-frame resolve
(containment → wall snap → item snap → support → collision, plus the
rigid-parent cascade) into `lib/drag-resolve.ts` with explicit arguments, and
call it from both. It is already mostly a composition of pure lib calls, which is
why this is an extraction and not a rewrite. Fixes **A1**, **A2**, **A3**, **A5**
at once, and settles **D1** by making the plan honour `hidden` the way the 3D
tree does — **ratified 2026-08-25: `V` hides a piece from the plan too.** The
filter belongs where the plan resolves its parts, and it has consequences to
carry: a hidden piece is not a marquee candidate, not an Alt-click candidate, not
draggable, and its comfort bands come off the drawing with it — but it stays
listed in the rail (that is the only way back to it) and stays in the room
report, because hiding is a view of the arrangement, not a deletion from it.

- Edge cases: the snapshot-once-per-gesture discipline (`Draggable` builds its
  world snapshot and descendant cache once per drag on purpose — the plan must
  do the same or a piece near the tolerance detaches mid-drag, the same trap
  `wallAttachments` already documents); the plan has no camera, so anything
  view-dependent must not travel into the lib; snap lines need a 2D
  representation or the snap is invisible; `y` resolution changes what the plan
  writes, so `setPosition` calls become three-component and history snapshots
  stay compatible (they already carry the full tuple).
- Tests: `tests/drag-resolve.test.ts` — the assertion that matters is
  *equivalence*: the same part, the same target point, the same room, resolved
  through the lib, must give what `Draggable` gave before the extraction. Plus a
  cascade case and a support case.

**4b. Esc cancels a drag** before it deselects — a scoped Esc, not a second
binding: if `draggingId` is set, restore the pre-drag transform and swallow the
key; otherwise fall through to deselect. Matches Blender, and matters more here
than there because the plan's drag can slide a piece somewhere you did not
intend.

**4c. Wheel panning.** Shift+wheel and (non-pinch) Ctrl+wheel pan; a
ctrl-modified wheel from a macOS pinch stays zoom — distinguish by
`deltaMode`/magnitude, and if that cannot be done reliably, prefer Shift+wheel
alone over a wrong guess. Fixes **C2**.

**4d. Frame selected** on the `PlanViewHandle` (and `Home` = frame all, `.` or
the existing `F` re-pointed at the plan when the plan is the active tab), plus
**D5**: `W`/`S`/`R` gated to the 3D tab so they stop silently changing state
from a screen that has no gizmo.

### Phase 5 — Legibility and feedback · SHIPPED, except 5d

- **5a. Screen-constant handles and hit bands** (**C4**): counter-scale the
  rotate handle, the focus ring, stroke widths and the wall grab lines by
  `1/zoom` so they stay the same size on screen. Labels too, with a floor
  below which they are dropped rather than drawn illegibly (**D2**).
- **5b. Better labels** (**D2**): full name, ellipsised to fit the footprint,
  with the piece's own hover card carrying the rest — cheap once 0b exists.
- **5c. Live measurement during a drag** (**D3**): distance to the nearest wall
  on each axis and the gap to the nearest neighbour, drawn from
  `lib/geometry`'s existing gap/face-clearance helpers, in the unit
  `useSettings` owns and via `formatDim` — a derived measurement, never a
  hand-typed one (rule 2).
- **5d. Raise the selection in paint order** (**D7**), and rename the user-facing
  **Locked** wording (**D4**) to say what the flag means — "From your photo" —
  in the plan, the Inspector and `HoverCard` together, leaving the persisted
  field name alone.
- **5e. Drop at the pointer** (**D6**): re-enable draggable catalog rows on the
  plan and add an `onDrop` that reuses `Room.tsx`'s pattern with `svgToWorld` in
  place of the floor raycast.

### Phase 6 — Documentation and guards · SHIPPED

- `planHelp()` rewritten around the new gestures — it is the only discovery
  surface for any of this, and the coach marks anchor to it. Both tabs' help
  content lives in one file on purpose (`StudioHelp.tsx`), so the 3D half has to
  be read while editing the 2D half.
- **The rename's string sweep**, if 3b-0 is taken as written: `RailSection
  title="Pieces"` and its search placeholder (`PartTree.tsx`); `PickerTabs`'
  "Catalog" label (`LibraryPicker.tsx:194`); `AddPiecesButton`'s "Browse
  catalog" / "Close catalog" and its title text, `CatalogToggle`'s chip and
  title, the "Close catalog" icon button's label, and the "browse the Catalog
  tab" copy (`CatalogPanel.tsx`); `LibraryPicker`'s "Search the catalog…"
  placeholder and its `aria-label`. Two things that look like hits and are not:
  the `sec.pieces` state key and `AddPiecesButton`'s component name are internal,
  and `lib/plan-export.ts:164` prints "Pieces" as a heading over the exported
  plan's contents list — a different sentence, correct as it stands.
- `Design.md`: the plan's section, the chrome-slot table if a slot changes, and
  the shared-drag boundary now that a resolve lives in `lib/`.
- `CLAUDE.md`: one line that dragging resolves through `lib/drag-resolve.ts` in
  both surfaces, in the same voice as the `layout-rules` note — the point being
  that a new snap or clearance goes in the lib, not in a consumer.
- This file: each phase marked shipped or declined, which is what makes it a
  history document rather than a wish.
- `pnpm typecheck` · `pnpm test` · `pnpm lint` after each phase, and remember the
  suite's node-vs-jsdom split: everything new here is pure `lib/` logic and
  belongs in the default node environment.

### Decisions taken, 2026-08-25

1. **Alt-drag free rotation of the drawing: dropped.** `[` / `]` and the two
   toolbar buttons keep stepped 15° rotation. (Phase 1)
2. **Shift-drag-to-pan: dropped**, so a drag on empty floor is the marquee.
   Middle-drag, Space-drag and the new wheel-pan remain. (Phase 3)
3. **`V` hides a piece from the plan too.** (Phase 4a)
4. **Alt-click cycling *and* the menu.** (Phase 2)
5. **Shift-click range select in both lists; Ctrl/Cmd-click adds the clicked
   model.** (Phase 3b)

### The naming, as settled

**Ratified 2026-08-25.** The rail's list of what is in the room is **Catalog**;
the panel you add from is **Library**, which is what every identifier behind it
already said (`LibraryPicker`, `PART_LIBRARY`, `searchLibrary`,
`PickerTab = 'library'`). The full string sweep is listed in Phase 6. One fix came
free with it: the rail list's search box used to read "Search the catalog…" while
its `aria-label` read "Search the furniture in this room" — the visible half
describing the other panel, which is very likely why the two read as one thing.

### What is left

- **5d's Locked wording** (deferred above): `ScenePart.locked` means "came from
  your photo", and the UI says "Locked" in three places while the piece drags
  freely. Nothing is broken; the word is.
- **The 3D tab has no touch route to the picker.** The right-click row covers a
  mouse without Alt, and a long-press equivalent for the 3D canvas was not built.
  The plan has one through its own context menu.
- **Snap lines are computed but not drawn in 2D.** `resolvePlacement` returns
  them and `MeasureGuides` draws them in 3D; the plan shows its own wall
  measurements instead. Drawing the alignment guides there too is a small,
  self-contained follow-up.


---

## Part 3 — What the review found, 2026-08-25

The work above was written, typechecked, linted, tested and pushed **without a
browser ever being opened on it**, and Part 2's phases were marked SHIPPED on that
basis. A read-back of the whole diff afterwards found seven defects. Every one of
them is in pointer plumbing; none of them could fail a test in this repo, because
nothing here drives a pointer. That is the finding behind the findings: for this
kind of change, green CI is evidence about the parts that were already easy.

Two were bad enough to have blocked the merge.

### 1 · A hit-test guard that ate most of the canvas · BLOCKER

`onCanvasPointerDown` opened with `if (e.target !== svgRef.current) return`. The
room floor is a **filled** `<path>`, so every press inside the walls arrives with
`e.target` set to that path and returned immediately. Dead inside the room:

- the **marquee** — the headline gesture of Phase 3, and the help card was by then
  advertising it in as many words
- **Alt-click on bare floor** (Alt-click on a *piece* survived: the piece's own
  handler calls `beginAltPick` before propagation ever reaches here, so the picker
  itself was never broken — only its route over empty floor)
- **one-finger touch pan** and **two-finger pinch** — a regression against `main`,
  on the input mode this view's own header comment claims it exists to serve
- **middle-drag pan** and **Space + left-drag pan** — also regressions, the latter
  including the deliberate case where the press starts *on* a piece

It was redundant as well as wrong: pieces and walls claim their presses with
`stopPropagation`, which is why the canvas handler never sees them. Anything that
does reach it is floor or decoration, and a marquee is the right answer for both.
Deleted, with the reasoning left in place so it is not reintroduced.

### 2 · The snap grid did not travel with the extraction · BLOCKER

Phase 0's whole justification was that the plan's drag ran different physics from
the 3D drag. `resolvePlacement` was extracted faithfully — but the **grid
quantisation was never inside it**. It sat two frames upstream in `Draggable`'s
pointer-move handler, rounding the pointer position before the call, and `PlanView`
had no equivalent. So after the fix, `fine` / `coarse` still changed the magnetic
snap and the keyboard nudge in the plan while leaving a mouse drag off-grid, and
still changed a 3D mouse drag. The exact defect the extraction existed to remove,
surviving the removal — and the PR description listed it as fixed.

The step is now the **first** thing `resolvePlacement` does, `ResolveInput.rawX`
documents that callers must not pre-round, and `Draggable` no longer does.
Quantising *before* the containment clamp is deliberate: rounding a clamped edge
afterwards would shove the piece back through the wall the clamp had just pulled it
out of, which `tests/drag-resolve.test.ts` now pins with an 870 mm-deep sofa whose
clamped edge lands off-lattice on purpose.

**The transferable lesson:** extracting a pipeline means extracting the steps that
live in the *caller*, and those are precisely the ones a diff of the extracted
function cannot show you are missing.

### 3 · `Esc` restored the piece, not the gesture

Cancelling a drag put back the dragged part alone. A lamp that had ridden along on
a desk stayed in mid-air where the cancelled drag had abandoned it, and every member
of a merged group stayed scattered. The comment above the handler reasoned carefully
about why a *wall* drag cannot be reversed and never noticed that a piece drag has
the same multi-body shape. `cascadeTransform` is pure, so replaying it from the start
transform reproduces the descendants exactly — no extra snapshot needed. Group
members needed one, and now carry it.

### 4 · A merged group read a render memo mid-drag

The per-frame delta was `r.pos - lastPos`, and siblings were looked up with
`parts.find(...)` — `parts` being a `useMemo` from the last render, while the dragged
piece tracked a ref. Two pointermoves between two renders and the siblings silently
dropped a delta the dragged piece kept: a fast drag pulls the group apart. The 3D
drag freezes one world snapshot per gesture for exactly this reason. Now every member
is derived from **where it started** plus the total delta, which cannot go stale and
cannot accumulate error.

### 5 · The Alt cycle was measured in the wrong space

`SAME_SPOT_M = 0.06` compared **world metres** to decide whether a second Alt-click
was the same press. That makes the tolerance a function of the camera: pulled back in
the 3D tab, 60 mm of floor is a pixel or two, so the cycle restarted on a twitch and
Alt-click could not step past the second piece; pushed in close it forgave a press
half a sofa away. The plan's own press was already recording client pixels for its
click-versus-drag test, so one gesture was being measured in two units inside one
diff. `SAME_SPOT_PX = 10` now, with world and screen named as separate arguments so
they cannot be swapped, and a test that holds the pixel still while moving the world
point 300 mm.

### 6 · The plan's drop threw away the aim point

`placeNewPart` takes an optional drop point so a wall-mounted piece can take the wall
nearest where it was *aimed*. The 3D tab passes it. The plan's `onDrop` did not —
under a comment reading "Same contract as the 3D tab's `onDrop`". A TV let go against
the left wall landed on whichever wall the default picked.

### 7 · Two comments and a claim that were not true

The `SceneContextMenu` header grew a second copy of its own bullet list. `CATEGORY_ICON`
claimed categories without an obvious glyph fall back to the neutral cube, which was
true of four of the twenty-two — the rest borrow (`chair` → sofa, `desk` → table,
`door` → key), which is fine and is now what it says. And the PR body claimed
`preventDefault` guarded the macOS Ctrl-click collision; no such call exists. It did not
need one — Cmd-click is the macOS route and it works — so the prose was corrected rather
than the code.

### One finding that was wrong

The review also filed an inconsistency between `hitsAt` (inscribed ellipse) and
`hitsInRect` (bounding box) for round pieces. There is none: `footOverlap` branches on
the circle flag and runs SAT over `footCorners`, which is an inscribed 32-gon. Nothing
needed fixing; what was missing was the assertion saying so, which now exists so that
nobody corrects it in the wrong direction.

### What this changes about Part 2

Nothing in the phases is withdrawn. But **SHIPPED in Part 2 means "written, and
verified as far as static tooling reaches"** — for pointer work that is a weaker claim
than it reads as, and the seven above are the measure of the gap. The remaining open
items below are unaffected.

---

Sources for the conventions cited:
[Blender: selecting overlapping objects](https://blenderartists.org/t/how-to-select-overlapping-objects-in-2-8/1328142) ·
[Blender manual — Selecting](https://docs.blender.org/manual/en/2.83/editors/3dview/selecting.html) ·
[Blender manual — Keymap](https://docs.blender.org/manual/en/latest/editors/preferences/keymap.html) ·
[Blender UV/Image editor navigation](https://www.oreilly.com/library/view/learning-blender-a/9780133886283/ch08lev2sec2.html) ·
[Industry-compatible keymap discussion](https://developer.blender.org/T54963)

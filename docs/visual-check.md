# Needs eyes

Places to click, and what "wrong" would look like when you get there. Everything here
typechecks, lints and passes tests — what is left is judgement no gate can make.

**Rebuilt 2026-08-27, after your second pass.** You answered most of the last list on
screen; those items moved to *Answered* and are not to be re-checked. What is left is
short, and it is mostly **new work from this round that nobody has seen** plus a
handful of things that turned out to be live defects rather than doubts.

| branch | state |
|---|---|
| `main` — `4326b44` | PR #17 merged. |
| `fix/visual-check-round-3` | this round, on top of `4326b44`. Four commits of your list, then a fifth carrying the five findings a `/review` pass turned up **on those four**. Gate counts on the tip are at the foot of the review section below. |
| PR #16 — `3b5935c` | **Open, and it needs a rebase** — see below. Its headline regression is closed. |
| `fix/multi-select-drag` | **Not merged, and it still holds one live fix `main` lacks.** Kept for that reason. |
| `fix/clamp-into-footprint` | Local only. Holds a written, tested fix for a known-and-left item. Kept. |

The last full-suite run before this one showed five red in `tests/layout-solve.test.ts`.
All five were timing assertions and all five were **load artifacts** — other sessions
were running suites in this checkout. Proved rather than assumed: the same file passed
50/50 at `4326b44` in a clean worktree, then 50/50 twice on this branch once the
machine was idle. The failing numbers were `2976 ms` and `2009 ms` against a `2000 ms`
ceiling, which is what that looks like.

**Branches were deleted this round, with permission.** Six remotes went:
`feat/drag-convoy-and-layout`, `feat/layer-tree-groups`, `feat/one-studio-shell`,
`feat/sun-presets`, `fix/wall-shadow` (all zero commits `main` lacks) and
`wall-carry-hover-fix` (one commit, marked `-` by `git cherry` — patch-equivalent). The
five merged locals went with them. The two branches above were **kept**, each for a
named reason, and the note that used to point at `wall-carry-hover-fix` as the live
example of a hand-written `positions[p.id] ?? p.pos` has gone with the branch.

---

## What is new this round, and therefore unseen

### A room that changes height carries the right pieces with it — for real this time

You reported this as not working: change the room's Height and the curtain stays put,
the fan stays put. **You were right, and the reason is worse than a bug.** The fix was
written on `fix/multi-select-drag`; when that branch was rebased into what became
PR #17 the commit did not come with it — while the paragraph in *this file* describing
the behaviour **did**, through the same rebase. So the documentation merged and the
code did not. It is ported now.

- **Raise the ceiling.** A fan, a pendant, a curtain rod and an AC unit rise with it and
  keep the same gap below the slab. A picture, a mirror and a TV do **not** move.
- **The wardrobe not moving is the correct answer**, not a fourth symptom of the same
  bug. `floor` and `wall-floor` pieces never move at all.
- **Lower it.** Same pieces come down, nothing ends up below the floor, and anything
  that no longer fits keeps its real size and pokes through — Room check is what says
  so.
- **Lower it, then raise it back.** Everything returns. The round trip is the asymmetric
  case; a sign error is invisible if you only try one direction. (Pinned in
  `tests/room-height-regrade.test.ts`, but the pixels are yours.)
- **Type a ceiling of `1.5`.** Refused, and the message names the **ceiling** range —
  "That height is outside 1.8–12 m". A `1.5` **width** is still accepted; 1 m is a legal
  side. That pair is the whole point: the number was in range, for the wrong axis.
- **Edit the width of a saved room whose ceiling predates this rule.** It must go
  through — only the axis you are editing is judged.
- **The steppers.** Height's arrows stop at 1.8 / 12, W and D at 1 / 50.

### Your fan needs one number typed, once

Unchanged from last time and still true: **type `2.55` into "Height off the floor"** on
the existing fan. The fix is deliberately not retroactive — you had dragged that fan,
which leaves an override indistinguishable from a height you meant.

Then drag a **fresh** fan in and check it arrives at the ceiling (Inspector reads
`2.55` in a 2.80 m room).

### Undo after a multi-piece drag

Your report: *"select the lamp first, then the side table, move them, then Ctrl+Z —
only the side table returns."* Found, and it was not in the drag code at all.

Mid-drag the store is deliberately half written — the 3D tab animates the piece under
your hand as a 3D object and only writes its position at the drop, while the *other*
selected pieces go through the store on every frame. So mid-gesture the store describes
a room that never existed: company moved, piece under the hand still at home. History
takes a snapshot 250 ms after things stop changing, so **any pause longer than a
quarter-second mid-drag recorded exactly that**, and one Ctrl+Z put you back into it. A
single-piece drag was immune, which is why it read as a multi-select bug — and it was
one.

- **Repeat your exact gesture**, and deliberately pause mid-drag for a second before
  releasing. One Ctrl+Z must put **both** pieces back.
- **Then Ctrl+Shift+Z.** Redo must bring both forward again.
- **Escape mid-drag, then Ctrl+Z.** A cancelled drag should not cost you an undo step
  that appears to do nothing.
- **Drag, wait, drag the same set again, then undo twice.** Two gestures, two steps.
- Worth knowing: an edit made *less than 250 ms before* you start a drag now lands in
  the same undo entry as the drag. That is deliberate and it is the one behaviour
  change; the state before both is still the entry underneath.

### WASD no longer pans the camera

You asked for this and the reasoning was better than "W and S are taken". It **was**
both: WASD panned only while nothing was selected, because W/S/R are the gizmo modes
and a selected part had to keep them. A key that means one thing with a selection and
another without it is a key nobody can learn — pressing W to switch to Move with
nothing selected slid the camera instead. It was undocumented too; the help card has
only ever advertised the arrows and Q/E.

- **Arrows pan, Q/E orbit** — still, and in every selection state.
- **W / S / R are the gizmo's, always.** Press them with nothing selected: the camera
  must not move.

### Hide is H

- **Press H** with a piece selected. It hides; press again to show.
- **Press V.** Nothing should happen.
- The letter is changed in all five places that name it: the handler, the right-click
  menu's hint, and both tabs' help cards. **Check the menu hint reads `H`** — that one
  is a string a grep could have missed.

### "Exact size" opens by default

- Select anything: the three millimetre fields should already be open. The collapsed
  summary printed the same numbers, so the fold was hiding a text field, not the
  measurement.
- **The section still collapses**, and must — a rail with several sections open needs a
  way to get its height back.
- **Check the rail at 1024–1279 px** with Exact size open plus whatever else you keep
  open. This is the change most likely to make the right rail feel tall.

### The north dial names its frame

Your report: *"'Light comes from the bottom-right' is misdirecting — it doesn't take
into account whether the user has rotated around the canvas."* Correct, and it was a
bare screen direction with nothing saying what it was a direction **in**. In the 2D
plan it is true of the drawing; in the 3D tab the camera orbits, so the sentence was
false at every heading but one.

It now reads *"Light comes from the dial's bottom-right."* The dial is the one frame
that survives both tabs — 12 px away, never rotates, and the words name exactly where
the marker is drawn.

- **Orbit the 3D camera and re-read it.** It should stay true.
- **Drag the dial through a few bearings** and check the word tracks the dot.
- **Check how it wraps.** The sentence is six characters longer in a column about 88 px
  wide. If it now runs to five lines, say so — the fix for that is stacking the dial
  above the text at narrow widths, not shortening the sentence back into being wrong.

---

## What the review pass found in this round's own work

`/review` was run over the four commits above, not over `main`. It found five things.
All five are fixed here, so what needs eyes is the **fixes**, and two of them changed
behaviour you can see.

### A stepper that destroyed the room, in four units out of five

The worst of them, and this round put it there. Making the room fields honour
`ROOM_SIDE_M` / `ROOM_HEIGHT_M` gave `NumberField` a `max` it never had before — in
**metres**, while the field's value is in the user's `dimUnit`. So a 5 m room in
centimetres reads `500.0` against a max of `50`, and one press of the up chevron
clamped it to `50.0` — 0.5 m — after which the commit refused the room its own arrows
had just made. Metres was the one unit where nothing happened, and metres is the
default.

`boundToUnit` converts the bound into the field's unit and rounds **inward**, because
converting alone is still wrong: 1.8 m is 5.90551 ft, which a foot field renders `5.9`
— two millimetres under its own floor.

- **Settings → change the dimension unit to centimetres, then Room → Room dimensions.**
  Hold the up chevron on Width. It must stop at `5000`, not snap to `50`.
- **Repeat in feet.** Hold the DOWN chevron on Height: it must stop at `6.0` ft and the
  room must still be legal — 5.9 would be refused.
- **Read the sentence under the fields in each unit.** It is derived from the same call
  the arrows are bounded by, so it should now say `100–5000 cm` and `180–1200 cm`, not
  `1–50 m`. If a number there disagrees with where the arrows stop, that is the bug
  back.
- **In metres nothing should have changed at all** — worth confirming, since that is
  the case the original code was written and reviewed in.

The Inspector's own **Exact size** fields had the weaker half of the same bug and were
fixed with it: `min={0.001}` — a floor in no unit at all, a millimetre to someone in
metres and a micrometre to someone in millimetres — and **no ceiling whatsoever**, so
the arrows walked a sofa out past its range and `clampDims` snapped it back on commit.
They are bounded by the piece's own range now, in the field's own unit, which is the
same pair of numbers the sentence under them already printed.

- **Select a sofa, open Exact size, hold the up chevron on Width.** It must stop where
  the sentence below says it will, and the piece must not jump back when you let go.

### A room file this app wrote, that this app would not open

Also from this round. Giving the ceiling its own range made an out-of-range ceiling
**fatal for the whole file** — and the app had written such rooms: the editor gated
every axis with the side range until that commit, and the ceiling-fan bug that started
all of this was reported from a **1.65 m room**. Save that room, open it again, and you
got *"That room file is missing its room, so there's nothing to open."* The room is not
missing; the message named the wrong problem and offered no way forward.

An out-of-range ceiling is now clamped into range and **named in the import toast**,
which is the same contract every imported part size already had from `clampDims`. Width
and depth stay fatal — a width of 0 is no floor — and `Infinity` stays fatal.

- **Make a short room** (type `1.8` for Height, the new floor), save a file, open it.
  It should open, with the room intact.
- **Hand-edit a saved `.danmu.json` to `"height": 1.2` and open it.** It must open, the
  ceiling must be 1.8, and the toast must say so and stay up. A silent clamp here is the
  failure — the whole justification is that it is reported.
- **Check the toast is readable and does not clip.** It is a longer sentence than the
  drop messages beside it.

### Three that are prose, not behaviour

- `Design.md` still said **`V` hides a piece** — one screen from a paragraph this branch
  edited, and `Design.md` is the file that wins when the docs disagree.
- `lib/scene-spec.ts` had its own `CEILING_PAD = 0.02` doing the identical ceiling clamp,
  while `MOUNT_PAD` was being introduced next door as "the single clearance" and its
  comment claimed a fourth copy "was about to" happen. It already had. Consolidated, and
  `tests/scene-build.test.ts` now holds the settle pass and the physics path against
  **each other** rather than against a literal — the only version of that assertion that
  can fail.
- `CLAUDE.md`'s corrected R3F passage was right but greppable-away: `grep flushSync
  node_modules/@react-three/fiber/dist/events-*.esm.js` returns eight hits, all of them a
  bundled reconciler defining and re-exporting the name rather than R3F calling it on a
  pointer event. The passage now leads with the reason that is checkable **in this repo**
  and says outright not to settle it by that grep. (Peer session danmu-f6 hit this
  independently, which is the evidence that it needed saying.)

### What was checked and held

Worth recording so it is not re-checked: the anchor spaces in `heightForNewCeiling`
(every anchor it clamps is centre-anchored, the two it leaves alone are the
bottom-anchored ones); no `transforms` → `physics` import cycle; no `RoomSync` race on
the regrade, because room meta and scene parts are separate IDB keys; no second `H`
handler; no live `WASD` reference anywhere; and a cancelled single-piece drag still
costs no undo entry.

Eighteen mutations were run in all — eleven against the original four commits, seven
against these fixes — each one killed by the assertion that owns it, each reverted.

---

## Still open, and still yours

- **PR #16 is your click, and it needs a rebase first.** See its section below.
- **`fix/multi-select-drag` cannot be deleted yet.** It still holds `snapToWall`'s
  `alongRot` argument, which is a live 191 mm defect on `main` — see *Coverage gaps*.

---

## Answered — nothing to do

Kept visible rather than deleted, so nothing gets re-checked by accident.

- **The fan.** Fixed and confirmed on screen.
- **Multi-piece drag.** Confirmed: a shift-selected set moves as one, in both tabs.
- **A wall-mounted piece leading a selection.** Confirmed: the TV slides along its own
  wall and the chair tracks it.
- **Escape mid-drag, including a window.** Confirmed. The one thing that came out of it
  was the undo defect above, which is a different mechanism and is now fixed.
- **The Style row is four swatches, and the merged Cool Neutral palette.** Confirmed on
  a room.
- **A theme no longer unticks itself when you move the light.** Confirmed.
- **A sun mood with no way in says so.** Confirmed.
- **The lighting row and its tooltips.** Confirmed.
- **Room and layer-tree panels.** Confirmed. The follow-up you asked for — Exact size
  open by default — is shipped and is in the unseen list above.
- **Room panel → Check tab.** Confirmed.
- **Room check — issue row alignment.** Confirmed.
- **A ceiling fan's useless "Where it sits" row**, **a fan stuck to the walls**,
  **dragging one of a group**, **a TV dragging a chair**, **a TV stuck at a wall's far
  edge.** All confirmed earlier.
- **Should starter layouts get a door and a window?** Already true.
- **Which themes should merge?** You chose the two cold neutrals. Done.

---

## Review findings against the convoy work — re-triaged against `main`

The eleven findings danmu-5e raised were written against the pre-merge branch. All nine
that were left open have now been **re-checked against `4326b44`**, and five of them
were executed rather than read — probes run against a pristine `git archive` of that
commit, not against a working tree.

**Fixed by `d5c6a45`, closed:**

- `commit()` now checks `co.valid` before applying the convoy's moves, like the other
  two call sites.
- The dragged piece is always outlined on a refusal, so a finding can no longer name a
  hidden piece with nothing on screen turning red. (Residual: the *sentence* can still
  name a hidden piece.)
- `clearDragClick()` moved above the Alt-key guard, so a stale click-suppression flag
  no longer eats a following Alt-click.

**Not a defect:** the blocked-readout width. The observation was factually right — the
viewport term only engages below a 272 px viewport — but the 240 px term always binds
and the canvas column is at least ~568 px in every layout. The *real* residual is
different and unverified: nothing bounds the tag against the **column**, so a 240 px tag
centred near the column edge could overhang a rail. That one needs eyes.

**Still reproduce, all measured, all in the convoy code:**

1. **A zero-delta commit writes no member moves.** Drag a set out and back and every
   companion is persisted at the last non-zero delta. Reproduced at coarse snap: two
   pieces at `x = 1.0` and `x = 3.0`, pointer path `1.04 → 1.31 → 1.014`, final store
   `1.000` and **`3.100`** — 100 mm of residual, accumulating across gestures. It is
   reachable *because* the grid snap quantises first, so any wobble inside half a step
   lands on the start coordinate bit-for-bit.
2. **Rotating one piece translates the rest of the selection.** The containment clamp is
   a function of rotation as well as size, and rotate/scale share the drag's commit
   path. Measured: a 2.0 × 0.9 sofa against the north wall with a chair also selected,
   rotated to 45° — the sofa moves 575 mm and `resolveConvoy` moves the chair the same,
   `valid = true`. 3D gizmo only; the plan's rotate has no convoy at all, so the two tabs
   disagree.
3. **A rug wider than the room jumps 250 mm on first touch.** The drop clamp centres it,
   the drag clamp pins it to a wall. Narrower than reported: ordinary furniture is saved
   by the polygon legality test coming back `false`, but a rug is exempt from that test,
   so its version commits.
4. **A merged set can be half left behind** when the other half arrives through the
   rigid-child path rather than the selection.
5. **A grandchild is dropped** when the middle link is itself a selection member — and
   `travellingWorld` has already shifted its phantom to a position it never reaches.
   Order-dependent on the `parts` array, which is why no test sees it.

**These are not on this branch.** They belong to the session that owns the convoy code,
which is fixing (1) plus a related self-descendant bug on `fix/convoy-self-support`, and
has been handed the measurements for the other four. Nothing here has been in a browser.

### The scar in `CLAUDE.md` — settled, and it was wrong

It claimed a drag can outrun React, so a per-frame delta read from a render memo drops
a step. **False on this stack, and it blamed the wrong layer entirely.**

- R3F 9.6.1 attaches raw `addEventListener` handlers. There is no internal `flushSync`
  call site and no `unstable_batchedUpdates` anywhere in the bundle, so R3F neither
  causes nor prevents the described drift.
- What actually rules it out for a subscribed store read is React 19.2.8: zustand reads
  through `useSyncExternalStore`, whose store-change path forces the re-render on the
  **sync** lane, and react-dom flushes sync roots in a microtask — before the next
  `pointermove` task can be dispatched.

**The design it justified is still right, for a narrower reason that owes nothing to
scheduling.** A member's own `resolvePlacement` is not the identity: a containment
clamp, a gravity drop or a wall snap is a *correction*. Stepping from the last frame
folds every correction into the next frame's base, so the set deforms a little further
each frame and can never come back; deriving from the gesture's start is idempotent.
The same argument covers the snapshot world, where the live memo's danger is that it is
**fresh**, not stale — it already carries the earlier frames' writes, so a travelling
piece lands at `start + 2×delta`.

`CLAUDE.md` is corrected. The identical wrong mechanism is still stated in
`lib/drag-convoy.ts` and `components/studio/PlanView.tsx`; both are owned by the convoy
work in flight and have been handed the replacement text. `Design.md` never asserted the
mechanism and needs no change.

One thing that could **not** be closed: R3F's own reconciler root has no microtask
flush, so a memo living only inside an R3F-root component subscribed to a store could
still behave the way the old scar described. Nothing on the drag path is shaped that
way today. That points the opposite way from "R3F prevents it", which is why the scar
now credits React by name rather than a library.

---

## PR #16 — the headline regression is closed; the merge is not

**"Suggest straightens furniture you deliberately tilted" is fixed.** Re-measured this
round against three trees with one script — the doc's own fixture, 8 seeds, every piece
set 8° off square:

| tree | pieces reported moved, per seed | of those, pure-straighten no-ops |
| --- | --- | --- |
| `351f5b8` (the commit that was measured) | 5,5,5,5,5,5,5,5 | 4,4,5,4,4,4,4,4 |
| `fix/room-report-and-tidy` @ `3b5935c` | 1,1,1,1,1,1,1,1 | 0,0,1,0,0,0,0,0 |
| `origin/main` @ `4326b44` | 1,1,1,1,1,1,1,1 | 0,0,1,0,0,0,0,0 |

The fix was never the pass *order* — there is still a tidy after the prune on both
refs. It is the fifth argument: `snapYaws` now skips any piece the solve did not touch,
and a piece the prune restored is bit-identical to where it started, so your 8° survives.
**And `main` already has an equivalent**, landed independently by PR #17 — the two refs
are numerically identical seed for seed.

The **blanket-quantiser** mutation the last version of this file called invisible is now
caught, on both refs, by a test named for it. The other three uncovered mutations that
branch's own docblock admits to are still uncovered; not re-checked.

**What is actually open:** PR #16 **conflicts on five paths** against `4326b44` —
`components/studio/RoomTools.tsx`, `lib/layout-rules.ts`, `lib/layout-score.ts`,
`lib/layout-solve.ts` and `tests/suggest-tidiness.test.ts` (add/add). Given the above,
most of those conflicts are the two branches carrying the same fix twice, so the rebase
should be mostly "take main's version". Its unique remaining payload is the `nearestEdge`
centroid perf fix and the RoomTools/clearance wording work.

Residual, unverified: on seed 3 the sofa is still reported as moved with 0.0 mm
displacement on **both** refs. One piece on one seed of eight, versus four-to-five pieces
on eight of eight. Nobody traced why.

---

## Coverage gaps — re-evaluated, and one of them was not a gap

### A detected wall piece keeping the model's yaw — **this is a live defect, not a gap**

The last version of this file recorded this as "found by danmu-f4, fixed, and the fix's
mechanism is pinned by three mutations; the wiring is not." **The fix is not in `main`.**
`grep` for `alongRot` over the whole tree returns nothing, at every commit of PR #17. It
exists only on `fix/multi-select-drag` — the same branch, and the same class of loss, as
the ceiling-carry commit above: the doc landed and the code did not.

And the reason the wiring "could not be pinned" was the fixture, not the problem. Measured
against the real `buildSceneFromRoom`, a 1450 × 60 TV at `x = 2.4` on the north wall of a
5 × 4 room:

| detection yaw | resulting `pos[0]` | correct |
| --- | --- | --- |
| absent / 0 | 1.7750 | 1.7750 |
| π/4 | **1.7750** | **1.9661** |

**191 mm, not 21 mm.** The old attempt used a wardrobe, which is floor-standing, so
`settleParts` smeared the difference; a TV is `wallMounted`, which `settleParts` skips,
and it is the most elongated wall-seeker in the catalog. Three named mutations are
available and each is *already* the live behaviour, which is the strongest form of
"observed failing" there is.

**Not ported here**, and the reason matters: the same branch also passes
`wholePiece: false` to the solver's `snapToWall` call, with a measured claim that
clamping there "costs the search the corners — on the U preset the difference between a
worst-of-twelve of 6.9 and one of 69.4". `main` clamps unconditionally. If that number
still holds, `main` is carrying a solver regression right now. Both changes live in the
same function, so the honest order is: re-measure the `wholePiece` number against the
rewritten `layout-solve.ts`, then port both together.

### The 3D Escape handler's wiring — **genuinely blocked**

Still true. `convoyRestore` is pure and tested; the cancel flag, the skipped commit and
the suppressed click need a real pointer, a pointer capture, an R3F event, a DOM click
and a raycast. jsdom supplies none of them. A source-shape guard in the `reflow.test.ts`
idiom is possible and would be the weak thing it sounds like.

### Every UI change — **partly overtaken**

Not accurate as written. The Inspector's `rail-triple` hook is already pinned in
`tests/reflow.test.ts`. The Check tab's `IssueRow` is not, and it carries exactly the
kind of invariant that file exists for: `alignItems: 'baseline'`, `flexShrink: 0` on the
pill, `minWidth: 0` on the title, and the *absence* of the deleted `verticalAlign: -5px`
magic number. Five one-line assertions, each with a named mutation, in a file that
already exists. Cheap, and worth doing.

Still true and unfixable by any test: none of it tells you the Check tab reads well.

---

## Known-and-left — re-checked, with two corrections

### The L/T/U notch drop — **the stated blocker is wrong, and a better fix already exists**

Reproduced exactly: the square L's vertex centroid is the reflex corner `[3, 2]`, which
`pointInFootprint` calls outside, and `clampIntoFootprint(5, 3.5)` hands it straight
back. The U's is at `(0.00, −0.625)`, also outside.

Two corrections to the entry:

- Swapping in an area centroid is **not** a change to `polygonCentroid`.
  `polyAreaCentroid` already ships in `lib/geometry.ts`, exported, with its own caller.
  The blast radius the entry feared — "whose other caller derives every wall's inward
  normal" — does not apply.
- A **better** fix than that is already written and tested, on the local branch
  `fix/clamp-into-footprint` (`8fbcfa9`). `interiorPoint`: shoelace centroid as the cheap
  first guess, **checked**, with a bounded 0.1 m scan of the bounding box as the
  fallback, and `null` — leave the input alone — when the polygon has no interior at that
  resolution. Its test sweeps eight compass directions across all five presets, because a
  U is only wrong from the side its notch faces.

**Ported, run, and backed out again this round.** It is not free: it moves every seeded
fixture in the repo. Two tests go red, both anticipated by its own commit message —
`wall-parts.test.ts`'s *"does NOT yet keep a drop out of the quadrant an L cuts away"*,
which asserts the old behaviour by name and whose comment says to change the assertion
rather than delete the test (`clampIntoFootprint(5, 3.5, L)` now returns `[2.75, 1.85]`);
and `suggest-tidiness.test.ts`'s *"…on a fixture where the proxy really does hand back
something worse"*, whose fixture is **the one layout in 1512** where the coarse proxy and
the fine grid disagree, found by a search over three room shapes × three sizes × 60
scrambles × 6 repair seeds. Landing the clamp fix means re-running that search to find
the next such layout. That is the whole remaining cost and it is a scriptable one.

### Inward normals on non-convex rooms — **still true, and its gate cannot fail**

Reproduced a third time, independently: stepping 50 mm out and in from every edge
midpoint gives **0 backwards** on `rect` and `l`, **2 of 8** on `t` (edges 2 and 6) and
**3 of 8** on `u` (the whole inner notch). Identical at 5 × 5, 5.5 × 4.7 and 6 × 5. A
winding-derived normal gives 0 wrong on all four.

**The new finding is the test.** `tests/wall-move.test.ts`'s case is titled *"points out
of the room on every edge, and agrees with `offsetWall`"* and asserts only the second
half — it compares `wallOutwardNormal` against `offsetWall`, and `offsetWall` **is
implemented by calling `wallOutwardNormal`**. It cannot fail. It sweeps the U, where
three of eight normals are backwards, and it passes. That is a green from a gate that
cannot go red, on the exact property it claims to check.

Writing the honest sweep is about fifteen lines and it is **red today** — which is the
mutation observation run in the honest direction, and it is why it cannot land on its
own without breaking CI. It should land in the same commit as the winding fix.

The winding fix itself is still blocked, and the blocker is unchanged: `clampIntoFootprint`
clamps a **centre point** and says nothing about a piece's extent, and
`tests/layout-solve.test.ts`'s scrambled-U gate (`worst of 12 < 40`) is what goes red.
`layout-settle`'s `contain` really is the containment push the entry says it is — it
already gates on `footInsidePoly` and ranks only the rejects by `outsideShare`, which is
the right way round. But it is module-private, takes a `ScenePart` rather than a point,
and **two of the four `clampIntoFootprint` call sites must not have it**: `jiggle` and
`pickPartner` are proposal *generators*, and making them extent-legal is the identical
trap the `wholePiece` note above describes. A third call site already gets it via
`settleParts`. That leaves exactly one caller that would benefit.

### `FanGeo` — **worse than recorded**

The entry says `dimMM[2]` is ignored and "group scaling papers over it, so nothing is
visibly wrong today". Both halves are optimistic. `dimMM[0]` is misread too: the blades
span `[−0.2r, +1.4r]`, a swept diameter of **2.8 · r = 1.40 m** for a fan whose `dimMM[0]`
says 1.00 m — so **the 3D blades sweep 40 % wider than the piece's own footprint**, which
is what `collidesAt`, `clearance.ts` and the plan's ellipse all use. Vertically it draws
0.26 m for a stated 0.20 m and is not centred on its anchor, so the ceiling clamp believes
the top is 50 mm below the slab while the rod's real top is 70 mm **above** it. (Invisible
to the eye — the ceiling is shadow-only — so it reads as a shadow oddity.)

The fix is the `lib/brand-mark.ts` precedent: geometry into `lib/fan-geometry.ts`, colour
stays in the component, proportions asserted against `dimMM` in a test with three named
mutations. It **changes what the fan looks like** — narrower blades, shorter rod, the
assembly 60 mm lower — so it needs eyes, and there is a "keep the look" variant that
closes the letter of the entry while leaving the box a lie. That variant should not be
taken.

### `nearestEdge` allocations — **still true; a peer's report of a fix was wrong**

There is no centroid cache. `nearestEdge` takes an optional `centroid` *parameter* and
has since before PR #17; what PR #17 changed was the opposite direction — re-expressing
the loop through `edgeProjection`, which is what **introduced** the per-edge allocation.
Before it, the loop allocated one object per improvement.

Lowest value on the list, and the entry's own trigger ("if the solver ever looks slow")
has not fired. The free win beside it is better: `lib/layout-score.ts` calls
`nearestEdge` with no centroid, per piece per proposal, so the vertex centroid is
recomputed every time. Hoisting it onto `LayoutModel` is bit-identical and free — and it
wants a guard against the mistake the file already warns about, someone "upgrading" the
hoisted value to the area centroid.

### Ranked, if you want any of these taken next

1. **Port `alongRot` + a TV wiring test** — a live 191 mm defect, fix already written,
   gated behind re-measuring the `wholePiece` number.
2. **The honest `wallOutwardNormal` sweep**, landed with the winding fix — turns a
   tautological green into a real gate.
3. **Land `fix/clamp-into-footprint`** — costs one scripted fixture search.
4. **Check-tab invariants in `reflow.test.ts`** — five assertions, cheap.
5. **`fanParts` extraction** — real defect, bigger than recorded, changes the render.
6. **The `layout-score` centroid hoist** — free, with a real assertion.

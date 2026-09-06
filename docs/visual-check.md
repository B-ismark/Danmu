# Needs eyes

Everything in this file typechecks, lints and passes tests. That is exactly why it is
here: these are the things a green suite cannot tell you about.

**This is a live list, not a record.** An item that has been **looked at** is **deleted** —
not struck through, not moved to a "done" section, not archived. `docs/history/` is for
point-in-time studies; this file has no history and is not allowed to grow one. It reached
747 lines and thirty headings before the user said it was "outdated and too crowded", and
every one of those lines had been true once. That is the failure mode to design against:
nothing in here was ever wrong when it was written.

**Merging is not looking, and this rule used to say it was.** The first version deleted an
item when its branch merged, which reads as tidiness and is in fact the file quietly
discarding its own backlog: a fix that shipped without a human seeing it needs eyes *more*
than one still sitting in a PR, not less. The contradiction was already on the page —
two items said "merged, still wants one look" while the rule above them said they should
have been deleted. **When practice and the rule beside it disagree, the practice is
usually the one that has met reality.**

So a merge does not delete an item. It **re-points** it: the branch and PR number are
replaced by the merge commit on `main`, and the gate counts go, because those were measured
on an artifact that no longer exists. What survives is the part that was always the point —
where to click and what wrong looks like.

## How to read an item

Each one names **where to click**, **what wrong looks like**, and **where it rides** — a
branch and PR while it is open, the merge commit on `main` once it lands. An item that
cannot say all three is not ready to be checked and does not belong here yet.

**An empty section is the rule working, not a gap.** It means that owner's fixes are
still uncommitted, so there is nothing anyone else can click on. Filling it anyway would
put items in a live list that only their author can reach, which is the exact failure the
rewrite exists to end. Leave it empty until there is a commit and a PR number.

## How to read a number

Every gate count carries the artifact it was measured on **and its failures**. The
artifact is a commit, never "the tree": a number off a working copy with uncommitted work
in it is a number about a program nobody can ship. The failures matter for a separate
reason — `1484/1487` reads as green to anyone skimming, and three reds beside a commit
hash are still three reds. A count with its artifact but not its failures is the same
defect one level up: a check whose answer nobody reads.

When a branch merges its numbers stop meaning anything, so they go — but the item stays,
now naming the merge commit. Numbers are about an artifact; a click path is about the app.

## Owners

Four lanes, named for what they own rather than for their ids. A lane keeps to its own
section and touches no other, which is what lets several sessions edit one file without a
merge conflict.

**A lane is not a promise that anyone is holding it.** The table says which surface an
item belongs to; it does not say its owner is awake. A stale preamble in someone else's
section is yours to fix if you are the one reading it.

| section | owner | surface |
|---|---|---|
| Sizes and fit | `sizes` | dimension ranges, clamps, clearance, the room report |
| Drag and selection | `drag` | drag, convoy, rotate, scale, snap, both tabs' pointers |
| Layout and Shuffle | `layout` | the solver, Shuffle, bands, arrangement, layout rules |
| Shell and flow | `shell` | rails, panels, capture / detect, copy and CTAs |

---

## Sizes and fit

*Owner: `sizes`. **The four new shapes were LOOKED AT on 2026-09-01 and are gone from this
list.** Standing fan, chest freezer, TV console and stool, seeded apart in a 7 x 5 room and
photographed front-on and from the corner: the fan reads as a pedestal fan — round guard,
dark pole, weighted base — and not as the lollipop the contract could not rule out; the
freezer has its lid seam and handle; the console has two open bays; the stool is a round
seat on splayed legs. Nothing draws outside its own footprint. That is the one question no
test in this repo can answer, and it is answered.

Two things were seen while looking that are NOT shape defects and are filed elsewhere:
every Library click dropped at room centre, so five added pieces landed in one heap
(§ H.3 — **fixed 2026-09-03**, they fan out to the first clear spot now; the ceiling
family was the documented residue and heaped for one more day, because `ceilingSpot`
discarded the aim — **fixed 2026-09-04**, and the drag half of that fix is an item below);
and the plan draws the standing fan and the stool as SQUARES, which is § 32 seen rather
than inferred.

**And the item that replaced them — the pendant and the ceiling fan drawn bigger than
they declare, § 34 — was FIXED and LOOKED AT on 2026-09-02, so it is gone too.** What
was seen: six ceiling fixtures seeded at both ends of both catalogue bands in one 6 x 5
room — pendants at 150 / 400 / 900 mm and fans at 150 / 200 / 450 mm — drawing at six
visibly different sizes. Before the fix all three pendants drew the same 800 mm and all
three fans the same 260 mm, because neither renderer read `dimMM` on any axis. A second
shot with the 400 mm pendant selected shows its geometry sitting INSIDE the selection
box, which is drawn from `dimMM`: 400 mm of cord used to stick out of the top of that
box, and the Inspector's derived "Height off the floor 2.38 m" now matches what is on
screen under a 2.80 m ceiling.

**That look was not optional and it is worth saying why.** A deliberate control mutation
— `FanGeo` passing a literal `200` instead of `part.dimMM[2]` — survives the whole of
`tests/ceiling-fixtures.test.ts`, because nothing in this repo renders geometry. The
band shot is the only thing that can distinguish "the helpers are right" from "the
renderer calls them". Thirteen other mutations were killed.

**Not seen:** a real GPU. All of this is headless Chromium on SwiftShader, so nothing
here speaks to how the shapes look with real lighting on a real device.*

### A bedside lamp draws as a RECTANGLE on a freshly seeded room

**Where to click.** Open the plan tab on a fresh `u`-shape starter and look at the
bedside lamp on each nightstand. It must draw as an **ellipse**, not a rectangle.

**What is wrong.** `defaultScene` authors the `circle` flag at four sites and misses a
fifth: the `u` starter's `lamp-table`. `normalizeStoredParts` re-derives the flag, but
only on the three paths that load a **persisted** snapshot — the seed path hands
`defaultScene` straight to `setParts`. **A room saved and reloaded is therefore NOT the
test**: the load path corrects it, so the defect exists only in a freshly seeded room.

**Seen, and not by me.** The `footprint` lane put it on screen: on `main` `26db2d1` the
bedside lamp is a `<rect>` and ten pieces draw with zero round; at `546fc4f` it is an
`<ellipse>`. Filed here at that lane’s request because the fix is on PR #123 and the
items live on this branch. **The observation is theirs. I have not seen it.** Delete this
item when #123 lands, not before.

### An air purifier's intake slats stand up through it instead of banding around it

**Where to click.** Any room, **3D Model** tab, Library → **Air purifier**. Look at it from
the side, not from above.

**What is wrong.** `AirPurifierGeo` (`components/three/DynamicPart.tsx:1232-1236`) draws its
three intake slats as `<torusGeometry>` with **no rotation**. A torus lies in XY with its
axis on Z; the purifier body is a cylinder about Y. So the three rings stand as vertical
hoops in the `z = 0` plane, cutting edge-on through the body, where they are meant to be
horizontal bands around it. The fix is almost certainly `rotation={[Math.PI/2, 0, 0]}` —
the same axis confusion the washing-machine drum already carries a comment about.

**Why it is filed here and not fixed.** It is a one-line rotation, which is exactly the
class of change that ships upside-down because it was obviously right. Nothing in this repo
renders geometry — the `FanGeo` control mutation above is the standing proof — so no gate
can tell a corrected slat from a slat rotated the other way. Someone has to see it before
and after.

**Found by** the footprint lane, incidentally, while sweeping shapes for compound
footprints. Never in a browser. Related, same class, also unfixed: `DeskGeo` draws the
L-desk's return wing so the piece spans **2.86 m** where every consumer reads 1.60 m, and
32 of 46 shapes draw outside their own `dimMM`.

**Its twin has been looked at, and this one can be settled the same way.** `WardrobeGeo`'s
doors sat here as one class with this item — both one-line rotations, both "obviously
right", both filed because no gate in this repo can tell a corrected rotation from one
flipped twice. That item is deleted because the `footprint` lane put it on screen: a
Playwright A/B, SwiftShader, production builds, one arm at a time. Closed, the panels
stand 12 mm proud; opened on `main` the box **shrank** to 1.380..1.980 against a closed
1.368..1.980, and with the fix it grows to 0.856..1.980 — **+512 mm into the room** —
across three bays with alternating hinge signs, so both directions were measured rather
than reasoned. The write-up is on PR #123; the fix is on `fix/seeded-flags-and-wardrobe-doors`
and unmerged at the time of writing. **That observation is not mine — I have not seen
either piece.** What it establishes for this item is that the route exists. Two traps it
cost, both on that PR rather than in the route section below: a plan piece is never
`visible` to Playwright, because its stroke is drawn only while it is selected — wait on
`{ state: 'attached' }` instead, or the locator resolves and times out; and projecting a
part's world centre through the camera lands on the CANVAS and selects nothing, so
clicking and reading `aria-selected` back is the only aiming that works.

### A ceiling fan hangs flush against the slab — and an OLD room's fan still does not

**Where to click.** Any room, **3D Model** tab, Library → Appliances → **Ceiling fan**,
which ships at 200 mm. Look up. Then open a room that was already in this browser before
today and look at a fan or pendant in that one.

**What changed.** § 35 removed the flat 150 mm drop from `groundY`'s ceiling arm, so a hung
fixture's top now lands at `roomHeight - MOUNT_PAD` at every size instead of only above
260 mm. A newly added fan moves up 30 mm and its downrod meets the ceiling.

**What wrong looks like, in a NEW room.** Any daylight between the top of the downrod and
the slab, or a rod that visibly penetrates it. Neither should be there: the top is 20 mm
below the ceiling by design, which is the same pad every other clamp uses and is meant to
read as flush rather than as a gap.

**What is EXPECTED to look wrong, in an old one.** A room already saved keeps its fixture
where it was, because `pos` is stored and nothing re-places on load — `settleHeights`' cap
is a maximum and a fixture under it is left alone. So an old fan still hangs 30–55 mm short,
and a room where someone adds a second fan today shows **one flush and one short, side by
side**. That is the thing to judge: whether the difference reads as a bug to a user, which
is not a question the arithmetic can answer. Changing the ceiling height by 1 cm and back
re-runs `heightForNewCeiling` over the whole room and lifts them all, which is the cheapest
way to see both states.

**Where it rides.** Merged to `main` in `1d16087` (PR #88).

**Gates.** `tests/ceiling-fixtures.test.ts` compares each fixture's top to the ROOM across
both bands and seven ceiling heights — the comparison nothing in this repo made before. It
cannot see the old-room case, because no test loads a room saved by an older build.

### A room saved BEFORE § 34 draws its pendant half the size

**Where to click.** A room already in this browser holding a pendant or a ceiling fan —
not a fresh one. The § 34 look was on a seeded room, which is a different program.

**What wrong looks like.** Nothing moves, resizes or re-settles — that was derived, and
every load-path consumer reads `dimMM` rather than the renderer. What changes is the
picture: a catalogue pendant drawn 800 mm now draws 400, a 150 mm one shrinks 5.3x, and
the shade's width goes from a constant 300 mm to whatever the piece declares.

**The case worth looking for.** Someone who sized a pendant *by eye* under the old
renderer — dragging the scale gizmo until it looked right — wrote a stored dim of about
half what they were seeing, because `renderBaseDim` returns `p.dimMM` while the drawing
ignored it. That room now opens with the pendant at half again.

**Gates.** None possible: the old and new drawings are both self-consistent, and no test
in this repo renders geometry.

## Drag and selection

*Owner: `drag`. All seven of the previous items were looked at on 2026-08-30 and are gone.
The three below are new, and each is here for a specific reason rather than by default. The
rotate ring, because drei's `TransformControls` is a three.js object with **no DOM**, so
nothing in Playwright can aim a press at its ring — the 2D half of that defect **is**
browser-checked and is not in this list. The refusal sentence, because the question it
raises is a judgement about what the app should do, not a fact a test can settle.*

### A short piece climbs a tall one, and the plan cannot show it

**Where to click.** 3D Model, any room with a wardrobe. Drag a nightstand hard into the
wardrobe's wall and let go. Then look at it in **2D Plan**.

**What to look for.** In 3D, is the nightstand standing on top of the wardrobe at 2.1 m?
In the plan it draws as an ordinary rectangle inside the wardrobe's outline, because the
plan has no y — measured, not guessed: the same drag commits `x=−1.60 y=2.10 z=−2.30`,
and a probe reading only x and z reported it as a collision the app had failed to refuse.

**Why it is here rather than in a test.** Nothing is wrong by the app's own rules — the
resolve's support step is doing exactly what it says, collision refused every frame on
the way up (`valid=false, refusal="blocked"` at raw z = −1.9), and the room report is
right to be quiet because the two no longer share vertical space. The question is whether
a 550 mm nightstand should be able to climb a 2.1 m wardrobe at all, which is a judgement
about what the app should do. **Nobody has reported it**; it was found while building the
control for § 17's curtain drag.

**Where it rides.** Nowhere — no commit changes this. It was found while building the
control for § 17's curtain drag, on `fix/mounted-clash-and-soft-furnishings`, and the
behaviour it describes is `lib/drag-resolve.ts`'s support step doing what it has always
done. This item is here to be *decided*, not to verify a fix.

*Not verified: what this looks like in the 3D tab. Only the committed transform was read.*

### A refusal that names the wall instead of an obstruction that is not there

**Where to click.** Any room. Add a **curtain** from the Library, then in the Inspector set
its width to **4 m** — the range allows 5 m and nothing stops you doing it in a 3 m room.
Now drag it, on **both** tabs.

**What should happen.** It refuses everywhere, because every wall is too short: measured,
**0 of 5,184** swept targets are legal where all 5,184 were before § H.16. The sentence in
the live region should read *"Curtain will not fit there — **it is wider than that wall**"*.
Before this branch it read *"— something is in the way"* in an empty room, which sends you
hunting an obstruction that does not exist. Third place to check: focus the piece in the
plan and press an arrow to **turn** it — that path says *"It does not fit at that angle — "*
and reads the same clause.

**What wrong looks like.** Any of the three still saying "something is in the way" for a
piece with clear floor all round it. Or the opposite over-reach: a piece refused by a real
obstruction being told it is wider than its wall. Put a wardrobe where a normal-width
curtain wants to go — that one should still say "something is in the way".

**The judgement, which is why this is here and not merely a test.** The piece is now
**un-draggable** until you shrink it or grow the room, and nothing on screen says so in as
many words — the sentence explains the refusal, it does not name the way out. Is a true,
actionable refusal enough, or does a piece that fits on no wall need to be *allowed* and
reported instead (the rule-2 shape: it keeps its real size and something else says it does
not fit)? Nothing reports it today — that is § H.16b — so refusing honestly is the interim,
not the answer. **This needs a person's opinion, not a test.**

**Where it rides.** Merged to `main` in `20654e5` (PR #74).

### The turn report and the Library fan-out — PROBED, and four of eleven still want an eye

**Where it rides.** `fix/turn-report-and-spawn-spread` (PR #102). Probed headlessly at
`99a66c7` against a production build; the script is
`C:\Users\bisma\AppData\Local\Temp\claude\danmu-probe\pr102.mjs`.

**What the probe answered, so nobody re-derives it.** Eleven assertions, all green:

| what | measured |
|---|---|
| four Library clicks fan out | `(0.00, 0.00) (0.70, 0.40) (0.00, 0.81) (-0.70, 0.40)` — four distinct spots, all inside |
| four floor lamps in a 2.5 m room | all at `y = 0`, tallest top **1.70 m**. No tower |
| a painting on a wall, turned | *"Nothing turned. Painting is held square to its wall."* |
| a free-standing chair, same room, same gesture | *"Turned a quarter turn."* — the internal control |
| a sofa refused at 90° | spoken *and* outlined red *and* the outline clears again |

**What a probe cannot answer here, and what to look at.** All four are about how it *reads*,
not whether it fires:

1. **The sentence is a paragraph now.** The painting's full announcement is *"Painting
   selected, 0.00 across and -2.46 back, in m. Snap on, fine steps. Nothing turned. Painting
   is held square to its wall. Painting moved 0.02 m to stay in the room."* That is three
   clauses about one keypress, and the 0.02 m nudge is arguably noise the user did not ask
   about. Read it aloud with a screen reader before deciding it is right.
2. **500 ms of red.** `REFUSAL_HOLD_MS` is long enough to sample 84 frames and short enough
   that a probe reading once at 600 ms sees nothing. Whether a person's eye catches it —
   especially away from the piece they were looking at — is not something frames can settle.
3. **"Nothing turned."** is what a wall rider gets. It is accurate and it may read as a
   fault. The alternative wording would be about the wall, not about the turn.
4. **The fan-out ring is hexagonal and starts at the piece's own diagonal.** Four chairs
   look deliberate; whether twelve look like a spiral rather than a scatter has not been
   looked at.

### A ceiling fan now lands where you drop it — and the middle stopped being a promise

**Where it rides.** `feat/ceiling-aim`.

**What changed and why it is here.** § H.3's residue 1, answered by the user on 2026-09-04:
an explicit aim overrides `ceilingSpot`'s midpoint default. Before it, a fan or a pendant
dragged out of the Library hung in the middle of the room wherever the pointer was released,
and a second one was placed exactly inside the first.

**A review then found the reversal had switched on a defect that had been dead code.** The
3D drop resolved every pointer ray against the **floor** plane, which was harmless only for
as long as a ceiling piece discarded its aim. The error at the point the camera looks at is
`|camera x,z| × planeY / (camY − planeY)` — **8.3 m for a fan at 2.38 m under the default
camera, in a room 6 m across** — and it grows toward the corners and diverges as the camera
orbits down. Fixed, and gated by `tests/drop-aim.test.ts`, which asserts a round trip rather
than a coordinate. The 2D plan never had it: `svgToWorldAt` maps screen to world directly.

**Where to click.** `/room/<id>/model`, Library open.

1. **Drag** a ceiling fan onto the canvas near a corner, then again over the middle of the
   ceiling — above the wall tops, not over the floor. It should hang under the pointer both
   times. *Wrong looks like:* it jumps to the centre (the reversal did not reach the drag
   path); it hangs past the wall (containment lost); or — the case the tests were blind to
   and the one to look hardest for — **it lands somewhere legal and plausible that is not
   where you dropped it.** That third one has no tell at all, so drop it deliberately onto a
   piece of furniture and see whether it lands on that piece.
2. **The cross-tab reading, which is the sharpest check here.** Drop a fan at the same place
   in the room on `/plan` and on `/model`. They must land in the same place. The two tabs
   are two code paths for one gesture, and an expected coordinate typed into a test is also
   satisfied by an error that is merely consistent — this comparison is not.
3. **Orbit down to eye level and drop one there.** The error the fix removes diverges as the
   camera approaches the plane, so a low camera is where a residual would be visible. Also
   check that a drop aimed at the upper half of the frame lands at all: an upward ray meets
   no horizontal plane and the handler returns in silence.
4. **Click** the fan row four times without dragging. Four fans, spread on one hexagonal
   ring, all flush to the slab. *Wrong looks like:* a heap at one point (the old behaviour),
   or fans at different heights — a tower is invisible from directly overhead in the 2D
   plan, so **look from eye level**.
5. **The judgement call, and the reason this item exists.** With one fan in the room, is the
   middle still where it should go? That is the half of the old rule the user kept, and the
   only evidence for it is somebody looking at a room with one fan in it.

**What a probe cannot answer.** Whether a hexagonal ring of ceiling fixtures reads as
deliberate or as a mess — the same open question item 4 above raises for chairs, now with
pieces the eye tracks against a flat ceiling rather than against furniture.

### A wall drag and a revisit — PROBED on all eight T edges, and two things still want an eye

**The wiring is measured and the probe goes red without the fix**, which is the part that
makes the green worth anything. `danmu-probe/wall-pin.mjs`, production build, headless
Chromium: seed a T from the picker (meta only — no scene key, which is the state a fresh
room is in), open `/room/<id>/plan`, focus one wall handle, two ArrowRights (`WALL_STEP`
0.05 m, so +10 cm), go to `/workspace`, come back, read `RoomTools`' own verdict.

| | before the fix | after |
|---|---|---|
| edges writing `room:<id>:scene` | **0 of 8** | **8 of 8** |
| edges disagreeing with the room on screen before leaving | 3 | **0** |
| edges handing back a different set of pieces | 8 | **0** |
| worst single edge | Wall 4: **1 issue → 6 issues** | Wall 4: 1 issue → 1 issue |

Three edges legitimately keep a finding across the revisit (Walls 4, 5, 6 → *1 issue*).
That is the fix working, not failing: a wall move may leave a real finding, and the claim
is only that leaving the room does not change the answer.

**Two probe traps worth keeping, because the first run produced a confident wrong FAIL on
three edges.** `RoomTools`' health control carries an `aria-label` only on its COLLAPSED
trigger; at 1440px the rail is open and the verdict is a bare `<span>`, so the probe waited
fifteen seconds for a selector that only exists on a narrow window. And `RoomSync`'s load is
one async effect with three painting writes in order — re-seed, then `setParts(savedScene)`,
then `loadTransforms` — so reading as soon as a verdict appears catches the **intermediate
re-seeded room** and reports it as what the user got back.

**What still wants a person:**

1. **Does the room LOOK like the one you left?** The probe compares the app's verdict and
   the set of piece names. It does not compare positions, and it cannot: two rooms with the
   same twelve names can be arranged completely differently. Drag a wall on a room you have
   arranged by hand, leave, come back, and see whether anything moved.
2. **A wall dragged with the MOUSE, not the arrow keys.** The probe nudges by keyboard
   because a wall handle takes focus cleanly. A pointer drag runs a different code path into
   the same store action and nobody has watched the snapshot land after one.

### The rotate ring no longer drags the piece behind it — 3D only

**Where to click.** 3D tab. Put a nightstand hard against the head of a bed, select the
**bed**, press **R** for rotate. The ring is drawn around the bed and sweeps over the
nightstand. Press **on the ring, at a point where it crosses the nightstand**, and drag to
turn the bed. Do it again in **W** (move) mode, where the arrows and the flat translate
squares reach over the same neighbour.

**What wrong looks like.** Three separate things, and only the first is the reported one:

1. **The nightstand slides.** That was the bug: R3F cannot see the gizmo, so it handed the
   same press to the furniture behind the ring and that piece started a drag of its own.
2. **The selection jumps to the nightstand when you let go.** A gizmo gesture ends in a DOM
   click like any drag, and by then nothing is guarding it. Watch the Inspector's title
   after the drag, not during.
3. **You end up holding one drawer unit instead of the bed.** Merge a bed and two
   nightstands into a group first, then rotate it. A plain click is *drill into the group*,
   so the click ending the gesture used to select one member. The rail's Catalog is where
   this shows: after the rotate the header must still name the whole group.

Also worth a second: rotating a piece with **nothing behind the ring** must be exactly as it
was, and a plain click on a neighbour immediately after a rotate must select that neighbour
— the gate is armed per gesture and dropped by the next press, so a click that goes missing
means it is being armed and never consumed. Two more the review added, both about a gesture
finishing somewhere other than on furniture: a rotate released over a **wall** must not
select that wall, and one released over bare **floor** must not clear the selection.

**And the one that needs two hands, which is why it is the last line of this item.** On a
touch device: press a drawer unit, hold past a second so it picks up, start sliding it, and
while it is still moving put a **second finger on the ring** of whatever is selected. The
drawer must keep following finger one. If it stops dead — and worse, if it is back where it
started after a reload while 3D showed it moved — the hold is outliving its press again.
This is the only defect in the whole item that a mouse cannot produce.

**Where it rides.** `lib/gizmo-press.ts` + `components/three/Draggable.tsx` +
`components/three/Pickable.tsx` + `components/three/RoomShell.tsx` +
`components/three/Room.tsx`. Merged to `main` in **`d2ef257`** (PR #73).


### Eight shapes stopped stretching their details — merged to `main` in `6912849` (PR #90)

**Partly looked at on 2026-09-03**, production build, every pair rendered side by side
at its catalogue size and at the end of its band. What was seen and is therefore NOT in
the list below: the fan puts its extra height into the DOWNROD with the motor unchanged;
the pendant at 150 × 900 is a narrow shade on a long cord rather than a funnel, **and it
casts a clean pool of light on the floor beneath it** — which is the review's blocker
confirmed, since an emitter left at the authored anchor would have been sitting on the
bare cord above the shade with the shade occluding it; the console, stool and nightstand
pairs differ in the right axis only; and a fan given 1500 × 900 reads as an oval in both
tabs. The 2D plan agrees with `dimMM` throughout, which matters because the plan never
group-scaled and is therefore the control.

What is left is below.

**Where to click.** Add each piece below from the **Library**, select it, press `S` for
Scale, and pull it to the end of its band. Then compare against the same piece at its
catalogue size. Every one of these now REBUILDS instead of stretching, so the detail
named should stay the size it is while the piece around it grows.

| add this | drag this axis to | watch |
|---|---|---|
| Ceiling fan | 450 mm tall | the motor housing stays ~80 mm; only the downrod lengthens |
| Pendant lamp | 150 mm wide × 900 mm long | the shade stays a shade; only the cord lengthens |
| TV console | 800 mm tall | the top slab stays ~30 mm and the plinth ~60 mm |
| Stool | 700 mm tall | the seat pad stays ~50 mm; only the legs lengthen |
| Nightstand | 600 mm deep, then double-click to open the drawers | the drawers slide ~180 mm, not 270 |
| Door | 2400 mm tall | the handle stays at ~1 m from the FLOOR, not 1.08 m |
| Door | 35 mm deep (the band's floor) | the panel gets THINNER; it used to freeze at 40 mm, thicker than the door |
| Window | 3200 mm wide | five panes and four mullions, not two panes stretched to 1.6 m each |
| Radiator | 2000 mm wide | 33 fins, not 13 fat ones |
| Fan or Stool | width and depth to DIFFERENT values | it must read as an oval from above, matching the 2D plan — these three round shapes drew a circle over an elliptical footprint |

**What wrong looks like, and it is the reason this cannot be left to the tests.**

- **A piece that changes size when merely dragged.** This is the scar
  `tests/part-scale.test.ts` was written for and the failure mode this whole set has:
  `renderBaseDim` returns the RESOLVED dim for a parametric shape, so if a piece is
  drawn at its authored size while the store holds a resize, `commit()` writes the
  authored size straight back through `setDim` and the resize is silently thrown away.
  Resize one of the six, then MOVE it, and check the Inspector's dimensions did not
  jump back.
- **A detail that has stopped scaling when it should.** The opposite error. A fan's
  BLADES are a proportion (`fanBlade`) and must still grow with the fan; only the motor
  is capped. Same for a console's carcass against its top slab, and a stool's legs
  against its seat. If the whole piece looks rigid, the effective dim is not reaching
  the renderer.
- **A pendant that looks wrong at the bottom of its band.** The cap runs the other way
  too: at 150 mm wide the shade is capped by WIDTH, and at a short drop by height. Try
  800 × 150 as well as 150 × 900.
- **A door handle on the wrong side of its own panel.** `doorHandleY` is measured from
  the panel's bottom edge (`-h / 2 + doorHandleY(...)`), so a mistake here puts it in
  the floor or above the frame. Doors are the one member of this set the user does not
  usually resize, which is exactly why nobody would notice.

**What does not need re-deriving.** The class table runs on every green suite and names
each shape, its authored and stored size, what was drawn, and its own cap — nine rows
across eight shapes, `authored` read from `PART_LIBRARY` rather than typed. The extent
(`top - bottom` = the stored height) is swept over the fan's and the pendant's whole
bands; it is NOT checked for the other six, and the first version of this paragraph
claimed it for "every shape" off a single assertion at a single size.

**What was found by REVIEW rather than by these tests, so treat the green with
proportion.** Three things this file's gate could not see, all now fixed: the pendant's
light was left at the authored anchor while its mesh moved (§ 34's defect re-entered,
and `ceiling-fixtures.test.ts` asserts that property and stayed green because it hands
one dim to both functions); three round shapes drew a circle where the plan draws an
ellipse; and `window` and `radiator` were members of the class nobody had listed. The
gate itself was per-row, so an empty table passed every assertion in it.

### The Inspector now says where the selected piece stands — merged to `main` in `e0c484a` (PR #91)

**All six states were LOOKED AT on 2026-09-03**, production build, one room holding all
of them, selected through the rail the way a user selects. What was seen, verbatim:

| piece | banner |
|---|---|
| dining table | ✓ **On floor** · "Standing on the floor." |
| chair half under it | ✓ **On floor** — *not* "Blocked", which is the whole item |
| lamp on the table | ✓ **On Dining table** · "Resting on Dining table." |
| the same lamp 350 mm up | **Floating** · "Nothing is holding it up…" |
| wall TV | ✓ **Wall-mounted** · "Fixed to a wall." |
| ceiling fan | ✓ **Hanging** · "Hanging from the ceiling." |
| sofa through a wall | **Sticks out of the room** · *the report's own sentence* |

The long one wraps to three lines and does not clip, and the left rail's chip read
"1 issue" throughout — the sofa's, and only the sofa's — so the two surfaces agree on
screen and not merely in a test. **Floating renders in the amber warn tone, visibly
different from the red danger one**, which is the review's point: the report says
nothing at all about a floating piece, so a red banner beside a green chip would be the
very contradiction this item is about.

**What is left is below**, and it is what a screenshot cannot answer.

**Where to click.** Select any piece. The banner sits above the decorating controls,
between the name and the Colour row.

**The last row is the whole point.** `collidesAt` calls a tucked chair a collision and
the room report does not, deliberately — twenty seeded pairs behind that. The banner
sides with the report, so a seeded dining set must not light up red.

**What wrong looks like.**

- **A red banner on the app's own seeded furniture.** Open a fresh room from the layout
  picker and click each piece in turn. Anything red on an arrangement the app just made
  is either the defect back or a genuine finding Room check is also making — check the
  left rail's chip agrees. If the chip says the room is fine and the banner is red, that
  is exactly § 37.
- **Contrast.** The success state is `--success-text` on `--paper-0`, and that pair has
  never been checked by eye or by `tests/color-tokens.test.ts`, which cannot see this
  element. The danger state is `--danger-text` on `--danger-tint`.
- **A long finding title spilling the rail.** The banner shows the report's own `title`
  and `detail`, which are written for a wider panel. `minWidth: 0` and
  `overflowWrap: anywhere` are on the text, and the rail is `overflow: hidden`, so a
  spill here would be silent. Drag the right rail to its narrowest with a piece that has
  a finding selected.
- **A screen reader narrating a drag.** `role="status"` with no `aria-live` is
  deliberate; the pair re-announced on every position write. Worth one pass with a
  reader to confirm selecting a piece announces once and dragging does not chatter.

**What does not need re-deriving.** The agreement with Room check is gated by
`tests/placement-banner.test.tsx`, which mounts the real plan page and compares the two
surfaces — including the tucked-chair case, with the premise asserted. `restingOn` has
eleven clauses of its own. Reverting the banner to `collidesAt`, collapsing `restingOn`
into `findSupportDetailed`, and restoring `aria-live` each go red.

## Layout and Shuffle

*Owner: `layout`. The Shuffle item was a look rather than a check, and the look was taken on
2026-08-30: Shuffle declined to close a 300–400 mm bedside gap, which **confirms the measured
diagnosis** rather than contradicting it. The item's job was to tell us whether the arithmetic
matched the room, and it did, so it is gone. Two things came out of that same look and neither
is an eyes-item: a nightstand passing **through** the bed after a Shuffle (§ H.18), and the
Library search failing to match `stand` → `Nightstand` (§ H.19).*

*— and the first of those two has since been measured and is NOT what it was filed as. The
solver produces no floor collisions at all; what goes through the bed is the LAMP standing on
the nightstand, carried nowhere while the nightstand moved. That fix does want eyes, and it
is the item below, because it is the one defect in this file that the 2D plan is
constitutionally unable to show.*

### The two decline toasts — the halves nobody has pressed, merged to `main` in `4cc663b` (PR #89)

**Half of this item was looked at on 2026-09-03 and the sentence it recorded no longer
exists.** It is back open, and the reason is worth keeping: the observation was correct
about a string this app has stopped producing.

What was seen, in a real browser, seeded U at 6 x 4, production build: presses 1 and 2
gave *"No safe arrangement found — Every layout tried put a piece through a wall or
inside another one, so nothing was moved. Press Fix again for a different try, or unlock
a piece to give it more room."*, press 3 applied and said *"Moved 4 pieces"* with the room
visibly rearranging. The long message **wrapped to four lines and did not clip**, which
was the open question. Presses 1, 2 and 5/7 declining matched the measurement exactly.

**Two things changed under it, and only one of them is cosmetic.**

The refusal now names WHICH impossible condition it hit rather than always saying both,
so the same two presses should read *"No safe arrangement found — The closest it found
put a piece **through a wall**, so nothing was moved. Press Fix again …"*. **Measured on
2026-09-05 against a `lib/layout-solve.ts` whose blob hash matches its own commit, both
before and after the run: `u`/`l`/`t` at 6x4, seeds 1-8, both modes = 48 solves, 9
impossible, 38 applied, 1 no-gain. All 9 name `outside` alone, and all 9 are on the `u`.**
`arrange` declines on seeds 1, 2, 5, 7 — the same four the earlier session saw — so the
press pattern above is unchanged and only the wording moved.

**This item previously said 11, and so did `Design.md` and `scripts/declined-terms-sweep.mjs`.**
The three agreed with each other and all three were wrong; a fourth number, already sitting
in `lib/layout-solve.ts` beside the decline itself, said 9 and was right. Three copies
agreeing is not evidence — it is one unverified number written down three times.

And the body no longer opens *"Every layout tried"*. That universal was true of the
disjunction and false of a single named condition, because the clause comes off the
WINNER's breakdown while `bestCandidate` ranks on the sum of both terms. The title
already says nothing worked, so the body says the narrower true thing.

**The wrap question is OPEN, and an earlier version of this item wrongly retired it.** It
said the new message was "144 with one condition named and 166 with both — so the maximum
is one character *shorter* than the string already observed wrapping to four lines without
clipping". Both numbers came off a draft prefix, *"The closest found put a piece"*, three
characters short of the shipped *"The closest it found put a piece"*. Measured from the
literals in `components/studio/RoomTools.tsx`:

| site | `outside` | `overlap` | both |
|---|---|---|---|
| `:731` Fix (the longest) | 147 | 151 | **169** |
| `:1207` Try a fix, scoped | 116 | 120 | 138 |
| `:1089` re-fit offer | 106 | 110 | 128 |
| `:1208` Try a fix, unscoped | 93 | 97 | 115 |

The old sentence was **167**. So the longest form is two characters LONGER than the one
already seen wrapping, not shorter, and the range across the four sites is **93 to 169** —
someone checking against "144 to 166" would test neither end. The comment in `RoomTools.tsx`
carried the same wrong claim and has been corrected too.

`overlap` alone has never been produced by any solve measured so far — 48 solves across
three room shapes, every refusal `outside` — so *"inside another one"* as a standalone
clause is unseen, and the 169-character both-terms string has never been produced at all.
Those are the two arms to look for; the one quoted above is the one that already exists.

The both-terms string is now driven at all four sites by `tests/impossible-clause-wired.test.tsx`,
which mocks the solver — so it exists in a test and still in no measured solve. If you want to
see the longest form on screen without waiting for one, that file names the shape of refusal
that produces it.

**Open the left rail before trying the re-fit path.** `RoomTools` is mounted only inside
`PartTree` (`PartTree.tsx:364`), and `LeftRailBody` renders `RoomHealthDot` instead of
`PartTree` when the rail is shut — so with it collapsed the whole Room-check surface is
unmounted and none of these four sentences can appear. `railLeftOpen` is persisted in
`STUDIO_PREFS`, so a rail collapsed once stays collapsed across reloads. The re-fit offer
is the sharpest case: it is a watcher in `RoomTools`'s body, and the resize that triggers
it is made from the *right* rail's Inspector, so with the left rail shut a resize produces
no offer at all and reopening does not recover it (the watcher takes the first geometry
change after remount as its baseline). That is pre-existing, not this branch's doing, and
it is filed here because it makes the path this item names unreachable rather than merely
awkward.

What is left is the part that probe could not reach.

**Where to click.**

- **`Try a fix`, on a single finding.** Room check → any finding → its own button. Its
  impossible copy is *"No safe way to move those"* with a different second sentence
  depending on whether the finding named pieces (*"Fix can rearrange the whole
  room…"*) or not (*"Try unlocking a piece…"*). **Neither string has ever rendered.**
  **Measured, and the answer is uncomfortable: 212 confined solves over every finding
  of every preset, scrambled and seeded, declined _zero_ times — for either reason.**
  So the new sentence is unreachable on any fixture that can be built from the
  presets, and so is the one that has shipped beside it for months. A confine locks
  all but the finding's own pieces, which leaves the search almost no room to exceed
  the impossibility it was handed. Kept because it guards against a wrong message
  rather than adding a feature, and because refusing it would leave the older sentence
  covering a case it describes falsely — but if someone can reach this path in a real
  room, that is the thing to find out.
- **The re-fit offer.** Resize a wardrobe well past what the room takes, wait for the
  offer toast, press **Re-fit**. Its impossible copy is *"No safe way to fit that"*.
  Also never rendered, and this is the path most likely to reach it — a resize is the
  state most likely to leave the search with nothing but legal-free answers.

**What wrong looks like.**

- **A narrow window.** The four refusal bodies span **93 to 169** characters at
  `ttl: 14000` — see the table in the decline-toast item above for the per-site figures,
  and check the two ENDS rather than a middle. This bullet twice carried a wrong range
  ("~170", then "144 … 166"); the longest, `Fix` with both conditions named, is 169. The
  toast host is `min(360px, calc(100vw - 32px))` with no `overflow`, so it should grow
  downward; at ~400px wide it will be tall. Check it does not push its own dismiss
  button off, and that 14 s is actually enough to read it.
- **Toast pile-up.** Pressing `Fix` repeatedly stacks identical *"No safe arrangement
  found"* cards — three were on screen at once in the probe. Pre-existing behaviour of
  the toast host rather than anything this branch did, but it reads badly precisely
  when the copy is telling you to press again.
- **Furniture in a wall after a press.** The thing the change exists to prevent. The 2D
  plan is where a small overhang is actually visible — the 3D camera cannot frame a
  wall line and a piece edge together. Nothing crossed a wall in the 3D shots, which is
  weaker evidence than it sounds.
- **A screen reader.** The toast host is `role="status"` / `aria-live="polite"`, so the
  new message should be announced. Not tried.

**What does not need re-deriving.** 18 of 160 solves used to hand back a room more
impossible than the one they were given; 0 do now, with 130 of 160 still moving
something. 10 of 10 mutants killed on the second battery, 13 of 14 on the first.
`checkFit` changed 5 of 100 verdicts, every one `no-room` → `tight`. Chained `Fix`
presses re-introduce findings on the T preset — identical on `main`, so not this branch.

### Fix and Shuffle are two buttons now — merged to `main` in `9ecce9f` (PR #67)

**Where to click.** Left rail, top: the health chip now has **two** buttons under it,
`Fix` (sparkles) and `Shuffle` (shuffle icon). Open any room. Press `Fix` on a room with
nothing wrong — it should say *"This is already a good arrangement"*. Then press
`Shuffle` on the same room: it must actually rearrange it. That difference is the whole
point of the change, and no test can tell you it reads that way on screen.

**What wrong looks like.**

- **The row fitting.** Two `.ds-btn`s sit in a wrapping `display: flex` row under
  the health chip, each `flex: 1 0 auto` — they grow to fill a line they fit on and,
  because they may not shrink, wrap onto two lines rather than cut a word. The rail
  around the row is `overflow: hidden`, so anything past the edge would be eaten
  with no scrollbar and no error.

  **Drag the left rail to its narrowest and press Shuffle.** What to watch is the
  busy label: it becomes `Shuffling…` for the whole 2–3 s freeze, and under
  `prefers-reduced-motion` the ring does not turn, so that word is the only tell
  that anything is happening. It must be whole. Whether the row wraps to two lines
  while it does that is fine and is the intended trade.

  This bullet twice described a version that truncated. It was briefly a `1fr 1fr`
  grid whose columns are 85px at `--rail-left-tight` against 50px of `.ds-btn`
  chrome — 35px for a word that wants ~41px, and ~59px while busy — and the note
  then told a reviewer the full label was *"still reachable on hover"*. It was not:
  Fix's `title` never contains the word "Fix" and Shuffle's contains "Fix" and not
  "Shuffle". **A hand-off note that names the wrong thing to look at does not
  merely mislead, it scopes the search** — someone hovering a cut label to check a
  tooltip would have confirmed the truncation and gone no further.
  (`tests/reflow.test.ts` now holds both halves: that the row wraps and may not
  shrink, and the arithmetic saying why.)
- **The refusal.** On a `t` or `open` footprint roughly a sixth to a third of presses
  answer *"No new arrangement this time"* and leave the room alone. That is **correct**
  — it is refusing to show a room with something in the way — but it must not read as a
  failure, and pressing again must genuinely try something new. Watch whether it feels
  like a broken button.
- **A room that got worse.** Shuffle is allowed to cost more than the arrangement you
  had — that is what "a different arrangement" of an already-optimal room means. What it
  may **not** do is introduce something Room check reports. After a shuffle, open
  **Room** → **Check**: any new error or clash is a defect (0 of 72 in measurement, and
  the gate meant to catch it has since been measured never to fire — see § H.25 — so one
  on screen is worth reporting loudly).

**The freeze and the repeat-after-a-tab-switch are both gone from this list on purpose.**
The tab-switch repeat was fixed on this branch — the attempt counter and the offer history
are module-scope maps keyed by room id now, not per-mount refs. The freeze is the item
below, which covers all four solve buttons rather than only this one.

### A bedside lamp should ride its nightstand through a Shuffle

**Where to click.** Open the **U** preset room (it seeds a bed, a wardrobe, two nightstands
and a lamp on each), go to **3D Model**, and press **Shuffle** half a dozen times. After each
press, find both bedside lamps.

**What wrong looks like.** A lamp standing anywhere except on top of a nightstand — hanging
in the air at about knee height, sunk into the mattress, or inside the wardrobe. Orbit down
to eye level rather than looking from above: at 550 mm a floating lamp is the thing this
whole item is about, and **from directly overhead it is indistinguishable from a lamp sitting
correctly on its nightstand**, which is why no amount of clicking in the 2D Plan can check
this. Turn the camera so you are looking along the floor.

**Also worth one press in 2D.** The plan cannot show the fault, but it can show the
side-effect: after a Shuffle the lamps should sit exactly on their nightstands' outlines and
turn with them, not trail behind at an angle.

**Where it rides.** Merged to `main` in `73c7048` (PR #86). The gate counts this line
used to carry are gone with the merge: they measured a branch tip that `main` has since
moved five PRs past, and quoting them here would be quoting the wrong artifact.

### Does Shuffle keep the bedside table by the bed? — a known defect, `main`

### The solve buttons say they are working — LOOKED AT for three of the four

Kept as a paragraph rather than deleted, because the measurement is the point and because
the fourth button has only just landed.

Chromium against a production build, per-frame sampling from inside the page: pressing
**Suggest** on a scrambled room put `.ds-spinner` in the DOM with `aria-busy="true"`, the
label **Thinking…** and the button `disabled` across **two consecutive animation frames**
17 ms apart — so the compositor had a frame boundary with it up, which is a paint — and the
frames either side of it show gaps of **2983 ms and 2899 ms**, the synchronous solve
blocking the main thread *after* the busy state was already on screen. That is exactly the
sequence `afterPaint`'s two rAFs are for. Try a fix and Check the room share the identical
`useBusyAction` hook, which is what the extraction was for.

Three earlier versions of that probe each reported "never observed" for a reason of their
own making — polling slower than the window, matching the wrong label, and a
MutationObserver whose callback reads the current DOM and so cannot see a state that opens
and closes inside one microtask checkpoint. Worth knowing before anyone re-measures it.

**Still unlooked-at, and small.** **Shuffle** was routed through the same hook on PR #67 and
has the longest solve in the app — one press is up to twelve solves, a median 2.0 s and a
worst 2.9 s on a T — so it is the one worth pressing, and the only one where a missing ring
would be unmistakable. And under **prefers-reduced-motion** the ring should sit still while
the word still changes: the label is the tell that has to survive.

### A wall that stops has nothing to SAY to someone who can see

**Where.** A room whose widest piece nearly fills it — drop a sofa in and drag the room
narrow, or open any room and pull a wall inward until it will not go further. All four wall
surfaces: the 3D handle, the 2D plan's handle, the plan's arrow keys on a focused wall, and
the Inspector's **Pull in 10 cm**.

**What happens now.** The wall stops dead at the widest piece and the reason —
*"“Big sectional” needs 2.4 m — the room will not go narrower than that."* — is spoken into
the studio's live region, which is `sr-only`. A screen-reader user hears it. **Everyone else
gets a wall that stops and no explanation**, and the Inspector's button is the worst case:
press "Pull in" at the stop and literally nothing on screen changes.

**The question for a person**, because it is a judgement and not a defect: does the stop read
as a *limit* or as a *broken button*? A wall that halts under the pointer may well be
self-explanatory, the way bumping a piece into another piece is. If it is not, the fix is a
line in the Inspector's wall panel — `selectedWall` is set on all four paths, so it is on
screen for every one of them — and **not** a toast: `moveWallCarrying` runs once per
animation frame during a drag.

**What is already verified and does not need re-checking**: the width field's `min` is the
furniture floor rather than the static 1; the refusal names the piece in `--danger-text` and
wraps to two lines without overflowing or spilling its rail; the arrows stop dead on the
stop; a room already too small for its sofa reports the piece's real 3.60 m; and the plan's
arrow-key nudge walks the wall to exactly 2.40 and then refuses with the right sentence.

**One layout case not reached.** The message interpolates a **user-authored part name**, and
this is the only place in the app one is rendered as free-flowing text at a fixed narrow
width (everywhere else ellipsises). Names allow 80 characters through `EditableText` and 200
through a scene file, with no space requirement. `overflowWrap: 'anywhere'` is on the line,
but it has only been seen at a 1400px viewport with short names. **Rename a piece to a
~45-character unbroken string, drag the left rail to its narrowest, and refuse a width** — if
the rail grows a horizontal scrollbar, the wrap is not doing its job.

**Where it rides.** Merged to `main` in `270455f` (PR #72).



### A numbered piece can vanish under the piece drawn after it — the exported floor plan

**Half of this was already fixed on `main` when it was rescued, and the rescue said the
opposite.** Rescued 2026-09-03 from `fix/derive-mounted-and-vertical-extent` on the grounds
that it "exists in no commit on `main`" — derived later the same day, that is **false**.
`0e60478`, *"fix(export): a number badge could be buried by the next piece's footprint"*, is
on `main`; `lib/plan-export.ts` draws in **two passes** with a comment describing this exact
defect (*"piece `i + 1`'s fill and outline landed on top of piece `i`'s NUMBER"*); and
`tests/plan-export-order.test.ts` gates it with three assertions, the first being that every
footprint is drawn before the first badge.

**Why the rescue got it wrong is the part worth keeping.** Its author searched `main` and
reported *"no mention of plan export at all"* — about a repo containing `lib/plan-export.ts`
and `tests/plan-export-order.test.ts`. That is § D's trap arriving from the other side: a
search that returns nothing is evidence about the search, not about the tree, and "no mention
anywhere" is the single easiest claim to make and the hardest to notice being wrong. It cost
a rescue of work that was already home, and it would have cost a re-fix.

**What is actually left**, and it is the second of the two causes that item named: the badge
could still be placed at a centroid sitting under a **neighbour's badge**. The gate's own
words are that *"a number can now only be crossed by another number"* — so the draw-order
half is closed and the collision-between-badges half has never been looked at.

**What was seen.** A production build, a room holding a **Ceiling fan** and a **Sofa**,
**Export → Floor plan**. The legend is right — `1 Ceiling fan — 1.00 × 1.00 × 0.20 m (W×D×H)`
and `2 Sofa — 2.20 × 0.95 × 0.88 m`, both numbered, no bare tick anywhere — so the
`wallMounted` → `ridesWall` regression that item was about is closed by a picture. What was
**not** right: the fan's number badge never appeared in the sheet. It is drawn UNDER the
sofa's footprint.

**The question that framed it, and which half of it survives.** It named two possible
causes — a z-order defect in the draw order (every footprint painted, then every badge,
versus one piece fully painted at a time) or a badge placed at a centroid that happens to sit
under a neighbour. **The first is fixed and gated**; the second is what to look for now. The
failure worth naming is unchanged and is why this still wants eyes: *a legend that references
a label the drawing does not carry* is worse than omitting both.

**Where to click.** Any room. Add a large piece — a sofa — then add a small one and drag it
so its footprint sits **inside** the sofa's. Export the floor plan. Both numbers must appear
on the drawing, or neither piece may be numbered in the legend. **The shot that matters now
is two badges close enough to touch**, since a number can still be crossed by another number.

**Where it rides.** `0e60478` on `main` — `lib/plan-export.ts`'s two-pass split, gated by
`tests/plan-export-order.test.ts`. **Merged with nobody having looked at the sheet**, which
is why it is here rather than deleted: the gate proves the draw order, and only a picture
proves the page.

## Shell and flow

*Owner: `shell`. The Library click-through was looked at on 2026-08-30 — the Add rail is
present and the panel is visible on both tabs, which is the whole of what was left for a
person. The three signposts and the click-through are gated by `tests/studio-copy.test.tsx`
and `tests/library-click-through.test.tsx`. The two items below are new, and each
is here because what a test can check about it and what a person can see are different
halves.*

### Pressing Shuffle moves the button out from under the pointer

*Filed by `rails` on 2026-09-05 from a peer's browser measurement during PR #115's review.
Nothing here fixes it, and it is a look rather than a probe because the question is what a
person does next, not what a number says.*

Measured on a production build at 1100 × 900, on the plan tab, in the **left** rail's room
actions row. *(This said "right rail" until a peer checked it: `RoomTools` renders from
`PartTree.tsx:364`, and `PartTree` is `LeftRailBody`. The table below derives from
`--rail-left-tight`, nine lines on, which is the tell that was sitting in the same entry.)*

| | idle | pressed |
|---|---|---|
| the Shuffle button | 95px wide | **175px** |
| the row holding it | 30px, one line | **66px, two lines** |

The row is a wrapping flex row — that is the fix from § E, and it is the right one: at
`--rail-left-tight` there are 85px per column and `.ds-btn` spends 50px of it on chrome,
so a grid cut the word instead. But `Shuffling…` is ~18px wider than `Shuffle`, and the
row answers by wrapping, so **Fix takes the whole first line and Shuffle drops to the
second**. The pointer has not moved and is now over a different control.

**What to look at.** Press Shuffle on the plan tab at a laptop width and do not move the
mouse. Watch whether the button leaves from under the cursor, and whether the reflow reads
as the app responding or as the layout breaking. Then press it again without moving —
whether that second press lands on **Fix** is the thing worth knowing.

**What would fix it, if it needs fixing:** reserve the busy width so the row cannot
reflow — render the longest label as a hidden sizer inside the button, so its width is the
maximum of its two states and neither string changes it. That is a change to `RoomTools`
and it is deliberately not in #115, because the busy window is short and a peer caught it
**once in four runs**: a fix nobody can watch land is worse than a recorded measurement.

**Unverified either way:** a real font at a real DPI, and touch, where the finger is
already lifted before the reflow happens and the second-press question does not arise.

### A dragged SET slides to its binding member — and only a pointer can show it

*Filed by `drag` (§ H.8, built 2026-09-05, PR #113). It is here rather than in a probe
for a reason worth keeping: a probe was built and run against both builds, it reproduced
the old behaviour in a browser — a two-piece selection stopping **3.55 m short** of where
the dragged piece reaches alone — and it still could **not tell the two builds apart**.
An arrow nudge is a fixed step, and in every fixture reachable from the keyboard the
binding member's clamp lands exactly on the lattice, where "refuse" and "slide to the
limit" stop in the same place to six decimals. **A sub-step delta needs a pointer drag**,
which is the one gesture that probe never made. Five versions failed five different ways
and all five are written into `scripts/slide-probe.mjs`.*

**Where to click.** Merge a bed with a nightstand on each side, or shift-click any
multi-selection, and drag it **with the pointer** toward the wall the members are nearest.

**Right.** The set slides until the nearest member is flush against the wall and stops
there, still following the hand. Nothing goes red; nothing is announced.

**Wrong.** The piece under the hand runs ahead of its company. Or the size tag and the
wall-gap labels sit somewhere the piece is not — 3D drew the mesh at the limited position
while publishing the live channel from the pointer's, so `MeasureGuides` built the OBB at
a place the piece was not; that is fixed, and this is where it would show.

**Unverified and named as such:** four mutants survive in that change — both `Draggable`
call sites and the two `settled` gates — because no test in this repo reaches an R3F
component and the probe cannot make a sub-step drag. This row is the only check they have.

### The placement row is two buttons now — does it still read as a row, at every rail width?

**Where to click.** Open any room, select a floor-standing piece, and look at the two
buttons under the Inspector's colour section: **Wall · Floor**. Try it with something
under the piece (a lamp on a desk) and with nothing under it — the row must look the same
both ways now, where it used to grow a third button. Then **drag the right rail's sash as
far left as it goes**.

**What changed.** § B.17 removed **Surface**, because a drag reproduces it exactly:
measured against `resolvePlacement`, dragging a lamp clear of a desk lands it at y = 0 and
dragging it back over lands it on the desk with `supportId` set. Wall and Floor stay
because a drag reaches neither — the wall snap is gated on `ridesWall` so a lamp is never
moved to a wall or turned, and Floor drops the piece **in place** where a drag carries it
sideways.

**What to look for.** Two buttons at 50% each, both words legible, the section's padding
intact on both sides and nothing touching the window edge. The colour swatches in the same
rail should be **six across and square**, not eight narrow rectangles. And, since the
heading above the row went with the third button: whether the row reads as **deliberate**
rather than as something with a piece missing.

**The WIDTH half is measured and settled — it is the LOOK that is left.** A headless probe
walked the rail through 420 / 293 / 276 / 248px: two buttons want 234px of the 243px a rail
dragged to its 276px floor gives them and 206px of 215px at the 248px compact step, with no
child overflowing and nothing painting past the rail's right edge at any of the four. So
`.rail-triple`'s container-query fold is deleted (it set `1fr 1fr`, which is what the
Inspector's inline `repeat(2, 1fr)` already said) and so is the class. `tests/reflow.test.ts`
asserts both are gone.

**What is still owed a REAL browser, and only this.** Headless Chromium renders **no
scrollbar at all** here — measured, `offsetWidth - clientWidth` is 0 in four launch
configurations with the box genuinely scrolling — so every number above is a rail 12–15px
wider than a Windows machine with classic scrollbars would give it. At a **1280px window**
the un-dragged right rail is 307.2px. With three buttons the row had about a pixel to spare
there; with two it has ~120px of slack by the same arithmetic, so this is very likely moot.
Confirming that is one look: **both buttons on one line, nothing touching the rail's right
edge.**

**What a test cannot settle.** Nothing in a test can measure a button's min-content, so
`tests/reflow.test.ts` holds the breakpoints and `tests/where-it-sits.test.tsx` holds which
buttons exist and that Wall genuinely turns the piece; none of them can see a rendered
glyph, a clipped word, or a row that looks unfinished.

**Where it rides.** `dcfe1af` (the 268 → 304 fix), `e4a9f25` (the container move and
304 → 293) and `fix/rider-height-and-report-units` (three buttons → two, then the fold
deleted). **The first two merged with nobody having looked at either**, which is why this
item is still here and why its gate counts are gone.

### Room check now speaks the unit you set — read a few findings in feet

**Where to click.** Settings → **Feet (ft)**, then open a room with problems in it and open
**Room check**. Then switch to **Meters** and read the same findings again without touching
the room.

**What changed.** § B.12. Every finding used to hard-code centimetres while `dimUnit`
defaults to metres, so the panel said `190 cm` beside a room field reading `1.9 m`. Every
length in a finding now renders through `formatLength` in the user's unit.

**The LAYOUT half is measured and clean; what is left is a COPY judgement.** A headless
probe read a room with seven findings in it at all five units: every finding sentence
rendered at its full width with no clipping, and the document's own horizontal overflow was
**0px** in every unit. So this is not a bug hunt. What needs a person is whether the
sentences still *read* well in a coarse unit — `"needs 0.6 ft of clear floor"` is correct
and may be worse prose than `"needs 35 cm"`, and `"About 16.1 ft² of floor has no route to
the door"` is a new sentence nobody has judged.

**Three specific things to check.** A very small gap must never print as zero — the
formatter grows its decimals rather than saying `0.00 m`, so you should see something like
`0.004 m`. The mounted-clash sentence must name **two different** heights (`between 1.05 m
and 1.07 m up`), never the same number twice. And the TV sentence must keep its screen in
**inches** while both distances convert: on feet it should read *"…is 5.4 ft from the
65.6″-class screen — comfortable viewing starts around 6.6 ft."* A screen diagonal is the
product's name worldwide, not a room measurement.

**Already confirmed on screen, so do not re-derive it:** the door swing reads `0.9 m` /
`90 cm` / `2.95 ft` / `35.4 in` / `900 mm`, the route in reads `60 cm` / `23.6 in`, and the
**Step-free** control three rows above the findings says `150 cm` / `59.1 in` — it used to
say `150 cm` whatever the unit, which is the § B.12 defect three rows from where § B.12
fixed it.

**What a test cannot settle.** Whether the wording is worth reading. The arithmetic is
gated in `tests/units.test.ts`, the wiring in `tests/room-tools-findings.test.tsx`, the
band's two-different-numbers property across all five units in `tests/mounted-clash.test.ts`,
and every finding that states a number in `tests/report-units.test.ts`.

**Where it rides.** `fix/rider-height-and-report-units`.

### A lamp on a nightstand you have resized — the CORE case is MEASURED, the rest still wants a person

**Where it rides.** `main`, `04ce6e0` (PR #100). The two earlier attempts were reverted;
this is the third.

**What no test in this repo can see, and why.** `Draggable` writes a part's transform
straight to its `Object3D`, and there is no R3F under jsdom, so
`tests/rider-settle-hooks.test.tsx` proves only that the **store** hands out a corrected
Y. The headless probe closes that gap and is worth keeping:
`…/danmu-probe/rider-height.mjs`, route recorded below.

**MEASURED, 2026-09-03, headless Chromium against a production build of `04ce6e0`.**
U-Shape preset (the only one `enumeratePlans` gives a bed rung, so the only one that
seeds nightstands and bedside lamps). Select a nightstand, type its height `0.55 → 0.75`:

| part | before y | after y | delta |
|---|---|---|---|
| `lamp-1` (on the resized nightstand) | 0.55 | **0.75** | **+0.200** |
| `lamp-2` (on the other nightstand) | 0.55 | 0.55 | 0.000 |
| every other part in the room | — | — | 0.000 |

Typing `0.75 → 0.55` puts `lamp-1` back at 0.55. So the 3D scene **paints** the corrected
height, in-session, with no reload — which is the half that was in doubt.

**And the probe was watched failing.** The identical run against a production build of
`2f3d0dd` — `main` immediately before this landed — grows the nightstand to 0.75 and
leaves `lamp-1` at **0.55**, 200 mm inside it. A browser probe that has only ever been
green is the same decoration as an assertion never seen fail.

**What that run does NOT settle, and it is most of the list.** A number is not a picture:
the SwiftShader screenshot times out, so **nobody has seen this**. Still open —

· **The picture, from eye level.** From directly overhead a floating lamp is
  indistinguishable from a seated one, which is why the 2D plan cannot check this at all.
· **After dragging the lamp once** (a *recorded* edge, not the seeded one the probe used).
  A consumer writing the derived Y back is what killed the first derivation permanently.
· **Press Floor on the lamp after resizing the nightstand.** It must stay on the floor.
  Before this branch's second round it dropped and popped straight back — two clicks, and
  no review lens found it.
· **Resize the nightstand, press Suggest, then type the height back to exactly what it
  was.** The lamp must come back down. Every writer that moves a piece in x/z copies
  `pos[1]` out of the resolved scene, so this is where a baked Y gets stranded — measured
  at 450 mm in the air, persisted.
· **A lamp on a 300 mm support** — an ottoman, a low chest — must not fall through it.
  That is the `> 0.3` bar in `lib/layout-settle.ts:275-280`.
· **It must never climb** onto something above it.
· **Drag a piece with something on it, in a busy room**, and watch for dropped frames.
  Uncached the derivation cost 14.3 ms of a 16.7 ms budget per frame at 60 parts;
  `riderYs` collapses that to one call, and only a real GPU can say whether it is enough.
· **Drag a piece into mid-air over a table** — the Inspector must still say **Floating**.
  Three assertions in `tests/placement-banner.test.tsx` broke when the first version
  seated a piece that was never resting on anything.

---

## Almost nothing here has been in a browser — and here is the route that works

**The heading used to say "nothing", and that stopped being true on `cb711cc`.** Some of
this has now been seen, headlessly, with a before/after and a control, and the route is
written down below because the reason nothing gets looked at is that looking is a
half-hour of setup nobody has to hand.

### What was seen, on the T and the U

`fix/inward-normals-from-winding`, A/B against `origin/main` @ `3da5df2`, three
preset rooms created through `/onboarding/layout-pick` and screenshotted on the 3D
Model tab at 1440x900, zero console errors on all six shots:

| preset | on `main` @ `3da5df2` | on `cb711cc` |
|---|---|---|
| T-Shape 5.5x4.7 | a **wall standing in the middle of the room**, drawn opaque and lit toward the camera, hiding the dining arm and most of its chairs | gone — the arm, its table and all four chairs are visible |
| U-Shape 6x5.0 | the **notch is open**: you see through where its three walls are, to bare floor, and the east return is a detached unlit slab | a closed shell, notch walls present and lit from inside |
| L-Shape 6x4.7 | — | **structurally identical to `main`** |

The L is the control and it is the whole point: it is the one non-convex preset whose
corner average can see all six of its walls, so it renders the same before and after.
A check that swept a rectangle and an L would have shown nothing. The two rooms that
changed are exactly the two the sweep measured wrong (`t#2`, `t#6`, `u#1`, `u#2`,
`u#3`), which is what makes these six pictures evidence rather than six pictures.

Pixel hashes differ on all three pairs, including the L — SwiftShader is not
bit-deterministic across processes, so **do not use an image hash as the comparison**.
Look at them.

### The route, so the next person does not rebuild it

Playwright lives **outside the repo** (`npm i playwright-core` in a scratch dir; the
browsers are already under `AppData/Local/ms-playwright`), because adding it to this
repo's `package.json` puts a browser download in everyone's install.

· `pnpm exec next start -p PORT` — **not** `pnpm start -- -p PORT`, which does not
  pass the flag through.
· Launch flags: `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`.
  Without them there is no WebGL and the canvas never appears.
· `frameloop="demand"`, so nothing draws until something invalidates. Move the mouse
  over the canvas, then wait seconds, not milliseconds.
· The default camera sits inside the furniture. Fourteen `mouse.wheel(0, 240)` steps
  with a beat between them brings the whole shell into frame, which is the only framing
  that can answer a question about walls.
· **One fresh browser context per room**, or IndexedDB hands you the previous room.
· **Killing the server matters more than it looks.** `next start` survives a stopped
  parent process: the port stays held, and if you rebuild `.next` underneath it you are
  serving a mixture of two commits. That happened here and only failed because the
  canvas timed out — it could as easily have produced a plausible screenshot of nothing
  real. Check the port is free with `netstat`, and `taskkill //PID n //F` if it is not.

**Reading the 3D scene itself, which is the only way to check a drawn position.** Two
routes look obvious and both are wrong; each cost a run of the § 12 probe.

· **`canvas.__r3f` does not exist.** In `@react-three/fiber` 9.6.1 the `__r3f` descriptor
  is stamped on three.js **objects**, never on the canvas DOM element — `getRootState(obj)`
  reads `obj.__r3f.root.getState()`. Reach the scene through three's own devtools hook
  instead: `Scene`'s constructor dispatches an `observe` event on `__THREE_DEVTOOLS__` if
  that global exists (three 0.184.0, `src/scenes/Scene.js:115`), so a
  `page.addInitScript` installing an `EventTarget` there catches every scene the app
  builds. The § 12 run saw seven.
· **Nothing in the scene graph has a `name`.** Parts are found by
  `userData[PART_ID_KEY]` — `danmuPartId`, stamped by `Pickable`, the same stamp
  `lib/pick-through.ts` reads to turn a raycast hit back into a piece. `getWorldPosition`
  on that object is what is drawn. Twelve stamped objects in a seeded U-Shape room.

Two DOM traps in the same file, both of which produce a **plausible wrong answer** rather
than an error: `page.mouse.click()` at a `boundingBox()` coordinate lands on nothing when
the row is scrolled out of the viewport (use `locator.click({position})`, which scrolls
first, and assert `aria-selected` after); and a bare `input[type=number]` query returns
the **left rail's room fields** before the Inspector's, so the probe grew the room by
300 mm and correctly reported the lamp had not moved. Filter by
`DOCUMENT_POSITION_FOLLOWING` from the Inspector's own "Exact size" button — which is
already open on a fresh selection, so clicking it unconditionally closes it.

## Nothing else here has been in a browser

Every commit gets a Vercel deployment, and a deployment is the only place the
production-only service worker registers — `next dev` cannot check that one at all.

**Merging moves where you click; it does not take the link away.** Branch tips deploy to
`Preview`, merge commits on `main` deploy to **`Production`**, and old previews persist as
records with a live `environment_url` long after their ref is gone — including refs that no
longer exist at all. So a re-pointed item is still clickable. Derived from
`gh api repos/B-ismark/Danmu/deployments` by `drag`, not assumed.

**But the per-deployment URLs sit behind Vercel deployment protection.** An anonymous GET
of a deployment redirects `302` to `vercel.com/sso-api`: whoever is signed in to that
Vercel account gets through and nobody else does. "Open the preview" is therefore an
instruction that works for one person. If there is a public production alias, that is the
URL this note should carry instead — nobody has found it yet, and it stays unwritten until
someone has.

**For the desktop check you do not need any of that.** `next dev` never registers the
service worker, but `pnpm build && pnpm start` does: `ServiceWorkerRegistrar` gates on
`process.env.NODE_ENV !== 'production'` and on nothing else — not a host, not a deployment.
Verified on `8504929`: `next start` boots in 3.9 s, `/sw.js` serves 200 with
`no-cache, no-store, must-revalidate`, and `serviceWorker` is in the production layout
chunk. No auth wall anywhere in that route.

The real limit is narrower than "you need a deployment", and it is worth knowing which
half of the check it costs you. **A service worker needs a secure context.**
`http://localhost` qualifies by spec; the `http://192.168.x.x` address the same server
prints does not. So a local production build covers the whole desktop check, and the
deployment is needed only for the **phone** — which is exactly where the SSO wall lands, so
the person who can check the phone is the account holder and nobody else.

One caution that comes with the local route, and it is the same one in `sw.js`'s own
comment: a worker registered on a port **outlives the server on it**. Iterating on a
production build at `:3000` leaves one intercepting whatever you run there next.

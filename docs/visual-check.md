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
| Layout and Ideas | `layout` | the solver, the ideas gallery, bands, arrangement, layout rules |
| Shell and flow | `shell` | rails, panels, capture / detect, copy and CTAs |
| Look and light | `look` | the 3D render: grading, materials, lights, what the camera sees |

---

## Sizes and fit

*Owner: `sizes`. Every item previously listed here was looked at and is gone — the last,
a wall stopping 60 cm short of another wall, on 2026-09-30, and then the stripes where two
parts of a piece meet, the near wall's skirting included, on 2026-10-01.*

*Two standing caveats for everything in this section. **No test in this repo renders
geometry** — a control mutation (`FanGeo` passing a literal `200` instead of
`part.dimMM[2]`) survives the whole of `tests/ceiling-fixtures.test.ts` — so a renderer
defect can only ever be settled by looking at it. And **nothing here has been on a real
GPU**: it is all headless Chromium on SwiftShader, which says nothing about how these
shapes look under real lighting on a real device.*

### One bed and one fridge in the Library, and a scanned double comes back double — merged to `main` in `28e1e03` (PR #212), NOT LOOKED AT

The Library's four bed rows and two fridge rows were one piece each in different sizes, and
the size is a field you can type. There is one **Bed** (1400 wide) and one **Fridge** now.
Whether a bed takes two nightstands is read from its width, so a bed you narrow to 900 is
a single for the arranger, and one you widen is a double. A fridge 800 mm or wider is drawn
with French doors; below that, one door.

Review found the drawing did not follow: the bed and the fridge were drawn at their Library
size and stretched, so the 900 bed kept two pillows and the 900 fridge kept one door
stretched across it. Both now redraw at the size you type, and so does the dining table, whose
legs had stretched with it. Its legs stay 55 mm square at any size.

**Where to click.** Library, search `bed`, then `fridge`. Add the bed, select it, type its
width down to 900 in the Inspector, press Suggest; then up to 1800 and Suggest again. Add the
fridge and type its width 790, then 800. Add a dining table and type its width 2400.

**What right looks like.** One row each. The 900 bed has one pillow and gets one nightstand;
the 1800 bed has two pillows and two nightstands. The fridge gains a second door exactly at
800, with its handles at the meeting line. The 2400 table's legs are as slim as the 1500
table's. A photo scan that finds a double bed cut off by the photo's edge comes back about
1.4 m wide, not a single's 0.9 m.

**What wrong looks like.** A bed you cannot type down to 800, a single carrying two pillows
or two nightstands, a fridge with doors that do not meet in the middle, or fat legs on a long
table.

### A starter room names its pieces as the Library does, and the Inspector header is one row — merged to `main` in `b5414e0` (PR #217), NOT LOOKED AT

The user's 2026-10-01 report: a seeded bedroom said **Queen bed** while the Library sells one
**Bed**, and the Inspector spent three rows on a bed — its name, *Bed · Bed double*, and an
*On floor* card. A starter room now uses the Library's own pieces and names (Bed, Rug,
Curtain, Painting, Pendant lamp, Table lamp, TV · 65″). The Inspector's first row is the
name with its Library shelf beside it (a bed reads **Bed**, then a quiet **Bedroom**);
the second line is gone. A door and a window sit on a new **Openings** shelf (the word `lib/room-openings.ts` already uses), in the
Library too, because the shelf now reads as what the piece is and a door is not an
appliance. A scanned bed (a shape the Library no longer sells) takes its kind's shelf. The
placement card shows only when it has something to say: a finding, a piece in mid-air, or
a piece resting on another.

**Where to click.** Create a room from any shape, open a bedroom, select the bed, then a
nightstand, the lamp on it, the curtain and the TV. Hover a few pieces in the 3D tab.

**What right looks like.** Every name in the room is one you can find in the Library. One
header row: the name, then the shelf in grey. No card for the bed on the floor, the TV on
the wall or the pendant on the ceiling. The lamp still says **On Nightstand**. A piece
pushed into a walkway still gets its amber or red card.

**What wrong looks like.** *Queen bed*, *Area rug* or *Bedside lamp* anywhere. A short name
(*Bed*) with its shelf wrapped under it, or a long one (*Washing machine* from a photo, with
its pill) ellipsised behind the shelf at 1024 px. The shelf dropping to a second line there
is the intended reflow, not a defect. A door reading *Appliances*, a radiator hovering as
*fridge*. And one to judge rather than check: the card coming and going moves the Colour,
Light and Floor/Wall rows below it. Press **Floor** on a floating lamp and the row jumps up
by the card's height. Say whether that reads as a jump.

**Where it rides.** `lib/scene-spec.ts` (`BED_LADDER`, the seeder's names, the TV rows
built from `SCREENS`, `libraryShelf`) + `components/studio/Inspector.tsx` +
`components/studio/HoverCard.tsx`.

### An OLD room's ceiling fan still hangs short of the slab — the new-room half LOOKED AT 2026-09-30

**What is already settled.** A newly added fan hangs flush: looked at on the preview and fine.
What nobody has seen is a room saved BEFORE § 35, because the user checking it had none.

**Where to click.** A room that was already in this browser before `1d16087` (PR #88) and holds
a fan or pendant. A fresh room is a different program and cannot show this.

**What is EXPECTED to look wrong.** A room already saved keeps its fixture where it was,
because `pos` is stored and nothing re-places on load — `settleHeights`' cap is a maximum and
a fixture under it is left alone. So an old fan still hangs 30–55 mm short, and adding a second
fan today shows **one flush and one short, side by side**. The thing to judge is whether that
difference reads as a bug to a user. Changing the ceiling height by 1 cm and back re-runs
`heightForNewCeiling` over the whole room and lifts them all.

**Gates.** `tests/ceiling-fixtures.test.ts` compares each fixture's top to the ROOM across
both bands and seven ceiling heights. It cannot see the old-room case, because no test loads
a room saved by an older build.

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

*Owner: `drag`. All seven of the previous items were looked at on 2026-08-30 and are gone,
and so are the four that came after them: Move / Scale / Rotate, a TV changing walls, the
wall pushing what it meets, and a short piece climbing a tall one. The user looked at each
of those on 2026-09-30, and ruled that a nightstand may climb a wardrobe — and, the same
day, a wall stopping at the rug it carries and its knob standing clear of the furniture — and
a table carrying a lamp dragging as smoothly as a bare one. On 2026-10-01 the user looked at
Start over, the drop after a delete and Duplicate, and all three are gone, and then the
right rail's footer, the Wall · Floor placement row, Room check in feet, a lamp riding its
nightstand, and the curtain that vanished on a drag. What is left is
here for a specific reason each. The rotate ring, because drei's `TransformControls` is a
three.js object with **no DOM**, so nothing in Playwright can aim a press at its ring —
the 2D half of that defect **is** browser-checked and is not in this list. The refusal
sentence, because it is a sentence a person has to read in place — the judgement it once
raised was answered on 2026-09-30.*

### A bed dragged between its nightstands leaves no dark streak on the floor — merged to `main` in `bd88347` (PR #215), PROBED

The user's 2026-10-01 report: dragging a bed between two nightstands painted black streaks
across the floor at its head and foot. The floor shadow was drawing every outline as a
solid sheet; outlines now live on a layer that shadow cannot see.

**PROBED** in headless Chromium on a software renderer: the bed's drag, its blocked state
and its release leave a clean floor, and the outlines — the selection rim, the wall
frame — still draw. **What is left for an eye** is a real GPU: drag the bed in the seeded
bedroom slowly across the nightstands and back. A dark band crossing the floor under the
bed is this defect back. A missing outline anywhere — the bed's legs, the rim round a
selected piece, the frame round a selected wall — is the fix gone too far.

**The outlines have their colours back, which is a change you will see.** Every outline
used to draw opaque white whatever it asked for (the colour sat on a material drei
ignored). Now a selected piece's rim is terracotta, a hovered one's sage, a refused
move's red, and a bed's legs carry a soft dark edge rather than a white one. White
anywhere on those is the old bug back.

**Gates.** `tests/strokes.test.tsx`.

**Where it rides.** `components/three/strokes.tsx` + `components/three/Box.tsx` +
`components/three/Highlight.tsx` + `components/three/RoomShell.tsx` +
`components/three/Room.tsx`.

### A fan dropped onto a fan moves aside, and a bed set stops at the wardrobe — merged to `main` in `28e1e03` (PR #212), NOT LOOKED AT

Two reports from the 2026-10-01 batch. A ceiling fan dropped on 2D Plan and another dropped
on 3D Model at the same spot shared one hub, which no drag would allow. A drop now keeps
your aim when the spot is clear, and otherwise takes the nearest clear spot and says so.
Separately, a merged bed with its nightstands, dragged into a wardrobe, let a nightstand
climb the wardrobe and its lamp sink into it. A member can no longer be pushed up onto
something taller than itself, so the set stops at the wardrobe and names the nightstand.

**Where to click.** Drop a ceiling fan on 2D Plan, switch to 3D Model, and drop a second fan
on the first. Then merge a bed with a nightstand (and lamp) each side, and drag the set with
the mouse into a wardrobe.

**What right looks like.** The second fan hangs beside the first, flush to the ceiling, with
a note that the spot was taken. The bed set stops when the nightstand meets the wardrobe,
and the size tag says which piece stopped it. The lamp stays on its nightstand.

**What wrong looks like.** Two fans in one place, or the second jumping somewhere far away.
A nightstand on top of the wardrobe, or a lamp half inside its nightstand.

### Change the model keeps a floor piece inside the room — merged to `main` in `71373dd` (PR #205); the sofa LOOKED AT 2026-10-01; a floor piece over the bed merged to `main` in `6a7f93f` (PR #210), NOT LOOKED AT

**Looked at 2026-10-01:** *"First one works, but when i change from print to nightstand, it
falls through the bed clipping through it, it happens with other pieces too."* The sofa is
right. The nightstand had stopped standing ON the bed (PR #206) and had started standing IN
it instead: it took the print's spot on the wall above the headboard, which is the middle of
the bed. A floor piece swapped in now looks for clear floor the way Duplicate does
(`placeArrival` in `lib/duplicate-place.ts`): the print's spot first, kept to the
millimetre when it is clear, otherwise the nearest clear spot, which beside a bed is beside
the bed. A nightstand, floor lamp, plant, armchair and sofa over a bed are each held to
that in `tests/swap-model.test.ts`.

**Where to click for that half.** The U-Shape (it has the bed). Hang a print on the wall
above the headboard, then **Change the model…** → Nightstand. Undo, and try Floor lamp,
Armchair and Floor plant the same way. *Right:* each one stands on the floor beside the bed,
against that wall, clear of the duvet, in both tabs. *Wrong:* anything inside the bed's
outline in the plan, or poking out of the duvet in 3D.


The curtain half (a print swapped for curtains hangs flat on the print's wall) was looked at
on 2026-10-01 and is gone. This is the other way round. A print swapped for a **sofa** kept
the print's centre, so the 2 m sofa stood 400 mm through the wall. Now a piece that belongs
against a wall (sofa, bed, wardrobe, desk, shelf, fridge) backs onto the print's wall, facing
the room. Anything else (a plant, a chair, a lamp) stays where the print was, pulled in off the
wall. A big sofa swapped in for a small one by a wall stays against that wall, and a piece that
already fits does not move.

**Merged with it.** Only a small tabletop thing (a lamp, a vase, a plant pot) looks for a table
to stand on. A print hung above a bed and swapped for a nightstand used to stand the nightstand
on the bed. And a lamp swapped in for a print looks for its table where the lamp ends up, not
where the print hung.

**Merged in `502fb23` (PR #206).** "A lamp" used to mean any lamp, so a print above the bed swapped for a **floor
lamp** stood the floor lamp on the duvet, and a 1.6 m floor plant the same. Now only a piece of
tabletop size looks for a top, when swapped in and when added from the Library. An ottoman
still goes on a top it does not fit under, which was decided before (§ 50 point 4).

**One known limit, so it does not read as a regression.** In a U-shaped room a piece too wide
for the arm it lands in — a 2 m table swapped in for a print on an arm's end wall — is carried
out into the room's middle, but can still end a couple of centimetres through the plaster,
because there is no spot in an arm that holds it. A piece that fits the arm stays in it.

**Where to click.** Use the 2D plan. Put a print on a side wall, then **Change the model…** →
Sofa. Then a second print → Floor plant. Then swap a small sofa standing against a wall for a
large one. Then a print hung above a desk → Table lamp, and a print above the bed → Nightstand,
then another print above the bed → Floor lamp.

**What right looks like.** The sofa's back is against the print's wall, with its seat facing
the room, at the same point along the wall. The plant stands just inside the wall where the
print hung. The large sofa stays against its wall, inside the room. The lamp stands on the
desk; the nightstand and the floor lamp stand on the floor. *Wrong* looks like any piece
crossing the wall line in the plan, a sofa with its back to the room, or a nightstand or floor
lamp perched on the bed.

**Where it rides.** `lib/swap-model.ts`, `seeksSurface` in `lib/physics.ts`.

### A refusal that names the wall instead of an obstruction that is not there

**The judgement this item used to carry is answered.** The user, 2026-09-30: *"Don't
allow if it's wider than the available space."* So a curtain can no longer be SIZED
wider than its wall (looked at 2026-09-30), and the un-draggable 4 m
curtain in a 3 m room cannot be made from the Inspector any more. The drag sentence is
still worth a look, because a piece CAN still be wider than a wall it is dragged to.

**Where to click.** Rectangle (6 × 4). Add a **curtain**, make it **5 m** wide on a 6 m
wall, then drag it toward a 4 m side wall, on **both** tabs. Then focus it in the plan
and press an arrow to **turn** it.

**What should happen.** It will not go onto the short wall, and the live region reads
*"Curtain will not fit there — **it is wider than that wall**"* — not *"something is in
the way"* when nothing is. The turn reads *"It does not fit at that angle — "* with the
same clause. Put a wardrobe where a normal-width curtain wants to go: that one should
still say "something is in the way".

**Where it rides.** Merged to `main` in `20654e5` (PR #74); the sizing half and the
wall-from-the-pointer fix in `32ccdca` (PR #200).

### The turn report — PROBED, and three of eleven still want an eye (the fan-out ring LOOKED AT 2026-10-01)

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

**What a probe cannot answer here, and what to look at.** All three are about how it *reads*,
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

### The rotate ring no longer drags the piece behind it — only the TOUCH half is left

**The mouse half was LOOKED AT 2026-09-30 and is right** — the bed turns on its ring over
the nightstand and the nightstand stays put — so the three mouse checks are deleted.

**The one that needs two hands.** On a touch device: press a drawer unit, hold past a second so it picks up, start sliding it, and
while it is still moving put a **second finger on the ring** of whatever is selected. The
drawer must keep following finger one. If it stops dead — and worse, if it is back where it
started after a reload while 3D showed it moved — the hold is outliving its press again.
This is the only defect in the whole item that a mouse cannot produce.

**Where it rides.** `lib/gizmo-press.ts` + `components/three/Draggable.tsx` +
`components/three/Pickable.tsx` + `components/three/RoomShell.tsx` +
`components/three/Room.tsx`. Merged to `main` in **`d2ef257`** (PR #73).

### The Inspector's placement banner, with a screen reader — merged to `main` in `e0c484a` (PR #91), the rest LOOKED AT 2026-10-01

The banner itself was looked at on 2026-10-01 — seeded furniture, contrast and a long finding
at the narrowest rail: *"Looks good."* Screen-reader passes are on hold, so one bullet is
left. `role="status"` with no `aria-live` is deliberate, because the pair re-announced on
every position write: with a reader on, selecting a piece should announce once and dragging
it should not chatter.

**What does not need re-deriving.** The agreement with Room check is gated by
`tests/placement-banner.test.tsx`, which mounts the real plan page and compares the two
surfaces. Restoring `aria-live` goes red there.

## Layout and Ideas

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

*The comfort zones in the plan (outline, halos, warm hatch) were looked at by the user on
2026-10-01 and that item is gone.*

### A chair tucks only square to the table and between its legs — merged to `main` in `28e1e03` (PR #212), NOT LOOKED AT

A dining chair turned 30° under the table, or slid along its edge into a corner leg, was
counted as tucked, so drags allowed it, Room check passed it and Ideas handed it back with
the chair through the wood. A dining chair now counts as tucked only within 10° of square to
the edge it goes under, and never where the table or desk has a leg or side panel. Office
chairs swivel and stools have no back, so both stay free to turn. Ideas and Suggest now
move a dining table and its chairs as one set: see the next item.

Two more from review. A chair pushed square into an **L-shaped desk's** inside corner was
refused, because the desk's edge was worked out from its outer box rather than its two arms.
And a chair **dropped** from the Library square under a table was moved out to "the nearest
clear spot"; a drop now gets the same allowance as a drag.

**Where to click.** Rectangle, 3D Model. Turn a dining chair under the table 30° and push it
in; then slide one along the long edge into a corner leg. Open Ideas and page through. Push
an office chair under the desk against its side panel. Add an L-shaped desk and push a dining
chair square into each arm from the inside corner. Drag a dining chair from the Library and
drop it just under one long side of the table, then the other. A dropped chair always
arrives facing the same way, so on one side it faces the table and on the other its back
does.

**What right looks like.** The turned chair is refused under the top, and so is the one
pushed into the leg. In Ideas, every chair is square to the table and none stands in a leg.
The office chair turns freely under the desk but stops at its panel. The chair goes into
both arms of the L. On the side it faces, the dropped chair stays where you let go, tucked,
and nothing says the spot was taken. On the other side it is moved out, and you are told.

**What wrong looks like.** A chair through a leg, or a square chair that will no longer go
under at all. (The crooked-table cost this item used to warn about, 23 in 200 test solves
against 14, is gone with the sets in the next item: 0 in 200.)

### A table and its chairs, and a bed and its nightstands, move as one set — merged to `main` in `0972aed` (PR #214), NOT LOOKED AT

Suggest and Ideas used to move a dining table and its chairs as separate pieces unless you had
merged them. So Ideas handed back chairs turned through the table, and Suggest left tables
crooked rather than swing a leg into a chair. Now a chair standing square at its table's edge
travels with the table, and so does a nightstand at the head of a bed. Nothing is merged and
nothing is stored. It is read from where the pieces stand when you press, so a chair you've
pulled away is free. A set turns only in quarter turns. `docs/what-is-still-open.md` § 52 has the
numbers.

**Where to click.** Open Plan, 3D Model. Press Ideas and page through every idea. Then
T-Shape: knock the dining table a few degrees off square with the chairs tucked and press
Suggest. Then U-Shape: press Suggest and Ideas with the bed and its two nightstands where the
starter put them. Last, pull one chair a metre away from the table, turn it, and press Ideas
again.

**What right looks like.** In every idea, each chair is still square at the table, at the same
side and the same distance, and each nightstand is still at the bed's head. After Suggest, the
table is square and so are its chairs. The chair you pulled away goes its own way.

**What wrong looks like.** A chair through the table, a set that arrives turned a few degrees,
a nightstand left behind when the bed moves, or the pulled-away chair dragged back to the
table. Also watch the U: its arrangements are a little worse on average now (the bed set is a
large body in a small room), and it may offer one idea fewer in three presses.

### Ideas shows a seat on the floor, never standing on a table or a bed — on `claude/amazing-davinci-m8zqys` (PR #222), NOT LOOKED AT

The user's call 2026-09-30: a drag may stand a seat on a coffee table (that stays), but an
idea never shows one there. Measured before the change: every idea in a room with an ottoman
on its coffee table kept it on the top, 48 of 48, because an idea moves pieces across the
floor and keeps their height. Now the seat comes down to the floor beside the table, a hand's
width clear, before the search, and anything standing on it comes with it and stays on it.
A seat kept where it is, or in a group, stays as you left it.

**Where to click.** A Rectangle room at 6 × 4. Add an ottoman from the Library and drag it
onto the coffee table, so it stands on the top. Put a tray (any small box) on the ottoman.
Open **Ideas**. Then press **Try** on a card, and **Back**. Last, keep the ottoman where it
is (**Keep a piece where it is…**) and look again.

**What right looks like.** In every card the ottoman is on the floor, somewhere sensible,
the tray still on it, and the card counts it among the pieces that move. **Try** puts it on
the floor in the room. **Back** puts it on the table again, exactly where it was. Kept, it
stays on the table in every card. A room with nothing standing on anything looks the same as
before.

**What wrong looks like.** An ottoman on the table in a card, floating at table height, or
inside the table. The tray left on the table while the ottoman moves. A lamp on the table
that came down with the ottoman. **Back** leaving the ottoman on the floor. A kept ottoman
that moved. A room that was clean saying *Try Fix first* because of the ottoman.

**Where it rides.** `lib/layout-ideas.ts` (`seatsDown`, `ideaMoved`) +
`components/studio/IdeasPanel.tsx`, and `lib/rigid-parent.ts` (`ridingParents`: a piece with
something on it still rides what it stands on).

### An Ideas panel that runs dry in a room with a group says to ungroup it, where that helps — merged to `main` in `3d70896` (PR #220), NOT LOOKED AT

The user's call 2026-09-30: a group is one block to Ideas, and a large one leaves few
places it fits with a way around it, so the panel can come back empty. It now says why,
and what gives more: *Every layout it tried left something in the way, so your room is
unchanged. Your group moves as one piece: ungroup it for more ideas.* Two groups read
*Your groups each move…* and *ungroup one…*. **Look again** stays. It says this only where
ungrouping lets the pieces move apart: a dining table and its chairs already move as one
block when nobody grouped them, so for that group the sentence stays the ordinary one.

**Where to click.** A `t` room at 6 × 4. Select the sofa and the dining table, press
**Group**, then **Ideas** and wait for it to run dry (measured: no idea in three presses
in a fresh room, 0, 0, 0). Then keep the sofa where it is (**Keep a piece where it is…** in
the Ideas panel) and look again. Last, ungroup, group the dining table with its four
chairs instead, and run Ideas dry if it will.

**What right looks like.** The group sentence under *No ideas this time*, wrapping inside
the card at 1024 px and on a phone. With the sofa kept where it is the group does not move
at all, so the ordinary sentence comes back (*Look again for a different try*), and the
table with its chairs gets the ordinary sentence too. A room with a Room check finding
keeps *Try Fix first* and says nothing about the group.

**What wrong looks like.** *merged set* anywhere on screen. The group sentence for the
table and its chairs, or for a group that is held. The sentence spilling past the card.

**Where it rides.** `lib/layout-shuffle.ts` (`shuffleRefusal`, `groupsToUngroup`) +
`components/studio/IdeasPanel.tsx`.

### An idea keeps the rug inside the walls — § H.6.1, needs eyes on Open Plan and the L

The search now prices a rug through the plaster exactly as it prices a sofa there. Before, it
could not see a rug at all, and Ideas put one 27–788 mm through a wall in 9 of 72 ideas —
five of them on Open Plan — every time with the rug's centre still on the floor, which is
why Room check (which forgives a rug its overhang) never said a word. None of that is a look.

**Where to click.** Open Plan and L-Shape with starter furniture → **Ideas**, then **More
ideas** twice. Then drag the rug so its middle is past a wall and open **Room check**.

**What right looks like.** In every card the rug's whole edge is inside the room: it may run
under the sofa or up to the skirting, never through the wall into the white outside the
plan. With the rug dragged out, Room check lists it as *Outside the room* **with a Try a fix
button** — it used to have none — and pressing it brings the rug back onto the floor.

**What wrong looks like.**
- A card with the rug's edge in the white beyond a wall, in the plan or seen from above in 3D.
- A rug pressed hard into one corner on every card, as though the walls were pushing it —
  the term should keep it in, not make it the only thing the search cares about.
- **Try a fix** on the rug that spins and reports it found nothing.

**A rug you left over the skirting is yours (review rounds 1 and 2).** Fix all and Ideas
either leave a rug exactly where you left it or lay it wholly inside the walls — never
through a wall you did not put it through. Four presses to make, on a 6 × 4 Rectangle with
starter furniture:
- Drag the rug so its east edge runs about 30 cm into the wall, centre still on the floor.
  Room check says nothing about it. Push the sofa into the doorway, press **Fix all**: the
  sofa moves, **the rug does not**, and the toast does not claim it brought anything back
  inside the room.
- Leave that rug unpinned and press **Ideas** three times: a page each time, and in every
  card the rug is either exactly where you left it or wholly inside the room. Wrong is a
  card where it runs through any wall — above all the north or south one, which you never
  put it near. Pin it and press again: a page of ideas, and the rug exactly where you left
  it in every card.
- Make the room 5 × 4 m, pick the rug, and in the Inspector make it 5 × 4 m without
  moving it, so it hangs over whichever wall it sat nearest. Press **Fix all**: the rug
  stays put. Wrong is the rug sliding along so it runs through a different wall.
- Make the room 4.8 × 3.8 m, make the rug as big as it goes (5 × 4 m) and drag it to the
  middle of the room, so it runs 10 cm up every wall, then press **Ideas** three times:
  each press shows ideas, the rug never moves, the rest of the room does. Wrong is any
  press saying *No ideas this time*, or a card where the rug has shifted or turned.

### A chair tucked under its table stays on the floor — § H.6.3, needs eyes in both tabs

Fix all could leave a dining chair more than half under its table, and the next touch
stood it on the tabletop: dragging the set, nudging the chair, or changing a lamp on the
table into a chair. From most angles that is a chair hanging in the air. Tests cover the
drag, the add, the settle and the model swap on the plan page. None of it is a look yet,
and the 3D tab's swap is not in any test.

**Where to click.** T-Shape with starter furniture. Select the dining set (click the
table, then shift-click each chair, or merge them first), drag it a hand's width, and let
go. Then push one chair well in under the table in the plan and nudge it with an arrow
key. Then put a table lamp near the table's edge, select it, **Change the model**, and
pick **Dining chair**. Do each once in the 3D tab too.

**What right looks like.** The set moves, dragged by the table and dragged by a chair,
and every chair stays on the floor through it. Drag the set into a bookcase and it stops
there, with the chair that hit it outlined and named. The nudged chair does not move,
which is what a chair tucked a little way in has always done. The swapped lamp becomes a chair standing on the floor where the lamp was, tucked
under the table's edge rather than on top of it.

**What wrong looks like.**
- A chair seat level with the tabletop, or a chair's legs standing on the table.
- The set refusing to move at all, or moving with a chair left behind.
- The placement banner saying *Floating* about a chair that is on something.
- A lamp or laptop dropped on the table falling to the floor. That is the other half of
  the rule and it must not have moved.

**And one in the 3D tab only.** Give the table an odd size in the Inspector (1613 mm
wide, say), select it and a tucked chair, and drag the table by its body with each tool
in turn: Move, Turn and Scale. The set must move every time, and the Inspector must still
read 1613 after you let go. Wrong: it reads 1610, or 3D refuses the drag while the same
drag goes through in the plan. `Draggable` hands the lead's size to `leadInherited` from
`currentDim()`, which is the held size since #188, and nothing mounts it in a test.

### A seat goes under a surface only where it fits — `1be34c0` on `main` (PR #193, § H.6.4), needs eyes in both tabs

The seat rule asked only which kind of seat goes under which kind of surface. So the
Library's ottoman "tucked" into the coffee table, straight through its lower shelf, and a
tall chair counted as tucked under a table its seat could not clear. It now asks whether
this seat clears this surface's underside. Tests hold the heights; nobody has looked at a
room with it.

**Where to click.** Rectangle with starter furniture. From the Library add an **Ottoman**
and drag it over the middle of the coffee table in the plan, then look in 3D. Push a
dining chair under the dining table and add an **Office chair** under the desk. Then
select the desk, set its height to 650 mm in the Inspector, and push the office chair
under it again.

**What right looks like.**
- The ottoman ends up standing on the coffee table's top, like any piece dropped there.
- **The dining chair sliding under its table, front first, and turning once it is under —
  LOOKED AT 2026-10-01.** The user: *"All good."*
- **The ottoman bullet below was looked at on 2026-09-30 and is right:** it stands on the
  coffee table's top.
- Under the 650 mm desk the office chair's arms would hit the top, so it no longer goes
  under: dragged over the desk it lands on the desktop. A desk from about 690 mm up takes
  it again.
- Suggest and the ideas gallery never park the ottoman inside the coffee table.

**What wrong looks like.**
- An ottoman sunk into a coffee table, with the shelf showing through its cushion.
- A Library-size dining chair or office chair standing on its table or desk.
- A starter room that looks different from before. None should: every seat in the starter
  rooms is a dining chair at a dining table, and all of those fit.

### The ideas gallery replaces Shuffle — `6ff707f` on `main` (PR #159), needs a real phone and a real GPU

**Ideas** sits where Shuffle did, beside **Fix**. It opens a card of arrangements: four
to a page beside a laptop rail, three on a phone, where the card is a sheet resting on
the bottom bar. Press one and the room takes it; **Back to your room** undoes all of it;
the heart saves one to Layouts (it shows a small heart there); **Kept in place** keeps a
piece and asks again from the room on screen. Drag something while it is open and it
says *The room changed* with **Find new ideas**. Looked at in SwiftShader at 1440 and 390
only.

**Where to click.** Any furnished room → left rail (the Room sheet on a phone) → **Ideas**.

**What wrong looks like.**
- The room in 3D not matching the highlighted card after a press, or a press that does
  nothing on a real GPU.
- Placeholders that breathe forever, or the header's *Finding more…* never going away.
- On a phone: the card covering the Room / Add / View bar, a caption cut mid-word
  rather than ellipsised at three lines, or the thumbnails too small to tell apart.
- A heart that is filled for a layout the Layouts tab no longer has.
- Keeping a piece and the next ideas moving it anyway.

### The standing fan is a real pedestal fan now — merged to `main` in `6a7f93f` (PR #210), NOT LOOKED AT

**Looked at 2026-10-01:** *"Can we make the standing fan a bit more detailed/realistic? Just
looks like an oval and a stick now."* `StandingFanGeo` (`components/three/DynamicPart.tsx`) is
rebuilt like the real thing. The base is a weighted round plinth with a domed top and three
switch buttons. The column is two telescoping tubes with a height collar, then a knuckle and
a tilt arm leaning back to the motor. The head is a motor barrel with a rear dome and an
oscillation knob. The guard is a wire cage of two shallow cones, front and back, meeting at
one rim, with rings and spokes and a centre badge, and three translucent pitched blades on a
hub inside it. It reads the piece's colour, so a recoloured fan recolours body and wire
together.

**The size did not change, and the cage shape is why.** In the plan the fan is the oval
450 × 310 (§ 39: the base, not the cage). A flat cage 140 mm deep stuck out of both narrow
ends of that oval, and a drag past it was refused where the plan showed clear floor
(`tests/footprint-outcomes.test.tsx` caught it). The rim now stands right over the base, at
the oval's widest, and the cones and motor taper inside it. Drawn at 449 × 306 × 1300
against 450 × 310 × 1300 declared, nothing outside the oval at the smallest, catalogue or
largest size. **The blades do not spin**, on purpose: the app's spin turns about the vertical
axis, right for a ceiling fan, and it would whirl a pedestal fan's blades like a carousel.

**Where to click.** Add a Standing fan from the Library, then orbit it in 3D: from the front,
from the side, and from behind at eye level. Recolour it. Stretch it to its tallest and
shortest in the Inspector.

**What right looks like.** It reads as a fan at a glance: a cage you can see the blades
through, a motor behind it, a pole, a heavy base. *Wrong* looks like the cage's wires
flickering or crawling as you orbit, the head drifting off its pole when resized, or the base
sticking out past the oval in the plan.

### Pillows, a duvet, clothes, shoes, sofa cushions and a curtain drawn as cloth — merged to `main` in `882db71` (PR #216), NOT LOOKED AT

**Asked 2026-10-01:** *"can you make the pillows, bed cover, clothes and shoes more
realistic?"* and *"if there are any other pieces or decors we can improve the realism, feel
free to add them."* They were boxes, and boxes read as furniture. Now they are cloth
(`lib/soft-goods.ts`):

- **The bed.** Pillows swell to a seam and lean back against the headboard. The duvet rolls
  over the mattress's edge and hangs to a level hem, and a sheet is turned back over it at
  the head. A scatter cushion stands in front of each pillow, in a tone that stays with the
  bed across a reload. The mattress is now its own layer under the duvet.
- **The sofa and armchair.** Seat and back cushions are plump with rounded edges, and the
  backs lean back. A sofa tall enough gets a scatter cushion in each end seat. The armchair
  gets one.
- **The clothes rail.** Coats, dresses, shirts and trousers, each narrowing at the shoulders,
  on a hanger with a hook.
- **The shoe rack.** Loafers, trainers and boots, each an upper on a sole with an opening
  you can see into.
- **The curtain.** One cloth hanging in waves from the rod, gathered at the top and deepening
  toward the hem, on a brass rod and finials.

**The sizes did not change.** Every soft thing stays inside the box the plan draws, and the
sweep holds that at every size the app allows.

**Where to click.** Start a room with a double bed, a sofa, an armchair, a shoe rack, a
clothes rail and a curtain. Orbit each in 3D at eye level, then look from low down and from
above. Recolour each one. Stretch the bed, sofa and curtain to their largest and smallest in
the Inspector. Lock one piece.

**What right looks like.** At a glance each reads as the real thing: pillows you would sit
against, a duvet that drapes, clothes that hang, shoes you could step into, a curtain that
falls in folds. Cushions sit *in* the seat, not on top of it, and never poke above the back
or the headboard. Lock the bed and its scatter cushions take the locked tint with
everything else. That one is worth a look because it was wrong before anyone saw it: the
bed's cushions are remembered per size, and the colour refresh only fired when the cushions
changed, so locking left them their own colour. Fixed in the same branch, and nothing below
the browser can see it.

**What wrong looks like.** Cloth flickering where it meets the frame. A pillow or cushion
floating over the mattress or seat, or buried in it. A duvet showing through the frame's
side. A recolour that leaves the cushions behind. A shoe's dark insole flickering. And one to
look at on purpose: under the curtain's hem the screenshot showed **thin bright slivers**
between the folds. They look like sunlight getting between the back folds and the wall. That
may be right, or it may read as gaps; it needs a real GPU and a human eye.

### Appliances, a door and a TV console drawn as the real objects — merged to `main` in `304b9b4` (PR #218), NOT LOOKED AT

**The other half of the 2026-10-01 realism ask** (*"if there are any other pieces or decors we
can improve the realism, feel free to add them"*). Eight hard pieces were each a box with one
or two things stuck on. They are built from their real parts now (`lib/hard-goods.ts`):

- **Washing machine.** Four feet, a control strip with a detergent drawer, a display and a
  programme dial, a steel ring round a smoked porthole, the door catch, and the filter hatch
  at the foot.
- **Microwave.** A door framing a smoked window with its pull, and a control column with a
  display, a dial and a start button.
- **Chest freezer.** A cabinet on a set-back plinth, a dark seal line under the lid, a handle
  along the lid's edge, and the thermostat badge with its light.
- **Water dispenser.** A recessed alcove where the hot and cold taps hang over a drip tray,
  and a bottle with a neck and shoulder. The taps used to stand 47 mm in front of the
  cabinet and the bottle 20 mm above its own height; both are inside the piece now.
- **Air conditioner.** A lighter fascia, the dark outlet slot with its louvre flap, and a
  small display with a light.
- **Soundbar.** End caps, a cloth grille between them, two low feet.
- **TV console.** It stands on four tapered walnut legs instead of a plinth. A door in each
  end bay stands back inside its frame with a brass pull on the inner edge, and the bays
  between are open niches with a shelf. A wider console gets more bays (two to five).
- **Door.** A frame of stiles and rails round four panels set back on both faces, a brass
  lever on a backplate with a keyhole at hand height, and three hinge knuckles. The lever
  stands 50 mm off the face, as a real one does, which is why the door now measures 100 mm
  deep in the drawn-size table rather than 75.

**The sizes did not change**, except where a piece was drawn bigger than it said: the water
dispenser now fits inside its own height.

**Where to click.** Add each of the eight from the Library. Orbit each at eye level, then from
low down. Recolour each one. Stretch the TV console from narrowest to widest in the Inspector
and watch the bays split. Resize the washing machine and the microwave both wider and taller.

**What right looks like.** At a glance each reads as the appliance itself. The console's doors
sit *inside* the frame with a thin shadow line round them. A door's panels read as recessed.
*Wrong* looks like a detail flickering where it meets the body (two faces fighting), a dial or
ring stretched into an oval after a resize that should not have stretched it, or a console bay
with no door and no shelf. **One to judge on purpose:** in the screenshots the brass lever and
console pulls read as dark bronze, not bright brass. That is the brass the curtain rod already
uses with no reflections to catch, and it needs a real GPU and a human eye to say whether it
reads as metal. The default door colour is also dark enough that its panels show only faintly.

### A television, a nightstand and a stool drawn as the real objects — merged to `main` in `7cea640` (PR #219), NOT LOOKED AT

**The next round of the same realism ask**, in the same module (`lib/hard-goods.ts`):

- **Television.** A slim frame round a screen set back behind it, a slightly deeper chin at
  the foot with a small standby light, and the electronics housing stepped in behind the
  panel. It was one box with a glowing plane laid on its face.
- **Nightstand.** Four short tapered legs, a top that overhangs the carcass a little all
  round, and two drawers set *inside* the frame with a thin reveal round each and a brass
  knob centred on it. Double-click still opens the drawers; the drawer box now slides out
  with its front. It was a block with two faces glued on.
- **Stool.** Three legs splayed out from under the seat to a wider stance, tied by a triangle
  of stretchers a third of the way up, under a seat with its underside eased. It was a disc
  on three plumb sticks. A tall stool keeps the same leg and stretcher thickness, so a bar
  stool reads as a bar stool, not a footstool stretched upward.

**The sizes did not change**, and every part is inside the size the piece declares.

**Where to click.** Add a stool, a nightstand and a TV from the Library. Orbit each at eye
level and from low down. Double-click the nightstand to open its drawers, and again to close
them. Stretch the stool from shortest to tallest and widest to narrowest, and make one oval
by changing only its depth. Recolour all three.

**What right looks like.** The stool's feet stand *on* the floor, neither sunk into it nor
floating. The stretchers meet the legs rather than stopping short of them. The nightstand's
drawers sit flush inside the frame with a thin shadow line round each, and an open drawer
shows its box rather than a front floating on air. *Wrong* looks like a stool leg poking
through the seat's top, a drawer box showing through the nightstand's back as the drawer
starts to open, or the TV's frame flickering against the screen. **One to judge on purpose:**
the knobs are the same brass as the console pulls, which reads as dark bronze in
screenshots. On a dark wood nightstand they nearly disappear.

### A floor lamp and a table lamp drawn as the real objects, lit from their own bulbs — merged to `main` in `a3f0ff4` (PR #221), NOT LOOKED AT

**Round three of the realism ask** (`lib/lamp-form.ts`):

- **Floor lamp.** A wide, low brass disc you could not tip it off, a turned collar, a slim
  pole, and a socket holding a bulb up inside a near-upright drum shade, open at the bottom.
  It was a cone on a stick on a puck.
- **Table lamp.** A glazed ceramic vessel — a turned foot, a full belly and a short neck,
  in a soft sage glaze — under a brass stem, socket and bulb, inside the same kind of drum.
  It was a cone on a rod.

**The half that is not cosmetic: where the light comes from.** Both lamps used to emit from a
fixed height while the lamp itself stretched to its size, so a tall floor lamp lit the
ceiling from above its own shade and a tall table lamp lit from inside its stem. The light
now comes from the drawn bulb at every size.

**Where to click.** Add both lamps from the Library, switch to an evening mood and turn them
on. Orbit at eye level, from a seated height, and from above. Stretch each from shortest to
tallest and narrowest to widest, and make one oval by changing only its depth. Recolour both.

**What right looks like.** The glow pools *under* the shade and the inside of the drum is
lit, at every size. From a seated eye you can see the bulb through the open bottom; from
standing you cannot. The vessel reads as one turned piece, not three stacked lumps. *Wrong*
looks like a bright patch on the ceiling above the shade, a dark shade with the light
somewhere below it, a bulb poking out of the drum's mouth on a short lamp, or the pole
standing clear of the base. **One to judge on purpose:** the sage glaze is a fixed colour;
recolouring tints the shade only — the brass and the ceramic stay as they are, which may read as the colour control doing too little. And the floor lamp's base is a large disc of the same brass as the console pulls, which reads as dark bronze in screenshots — it is the darkest thing in a light room.

### A dining chair, an office chair and an armchair drawn as the real objects — on `claude/affectionate-ritchie-ilawx1`, NOT LOOKED AT

**Round four of the realism ask** (`lib/chair-form.ts`):

- **Dining chair.** Four square legs braced by a low H-stretcher, a seat frame of rails set
  in from the legs' faces, an oat-linen pad on the frame, and a back of a crest rail and a
  lower rail between the rear uprights with three slats standing in both. It was a slab on
  four sticks with three bars across the back.
- **Office chair.** Five casters under a star of round spokes — one pointing straight
  ahead — a hub, a gas lift rising out of its dust cover into the seat mechanism, a seat
  cushion on a pan, T-arms on brackets, and a back cushion on a shell carried by a spine
  from under the seat. It was a box on a box on a box over a star of flat plates.
- **Armchair.** Four turned, tapered wooden legs, two rolled arms the depth of the chair, a
  back panel between them, its seat and back cushions and the scatter cushion as before. It
  had square posts and square-topped arms.

**The sizes did not change, and neither does how a chair tucks.** How high a chair reaches
under a table and how much of its depth the back takes up are now read from the same
numbers the chair is drawn with, rather than copied beside them — and they are the numbers
the old drawings had, so every chair tucks exactly as far as it did.

**Where to click.** Add one of each from the Library. Orbit each at eye level, from low down
and from behind. Tuck the dining chair under a dining table and the office chair under a
desk. Stretch each from smallest to largest on each axis. Recolour all three.

**What right looks like.** Every foot and caster stands *on* the floor. The dining chair's
slats meet both rails, its rails disappear into the legs, and the pad sits on the frame
rather than floating over it. The office chair's lift rises out of the hub and into the
mechanism, and its arms stand on their posts. Tucked, the dining chair's back and the
office chair's arms stop at the table's edge as they did before. *Wrong* looks like a slat
stopping short of a rail, a caster sunk into the floor, the office chair's back cushion
floating off its shell, or an armchair leg standing outside the arm it carries. **Two to
judge on purpose:** a recolour paints the dining chair's frame and leaves its pad oat linen,
while the office chair's cushions take the new colour with the rest — say whether either
reads as the colour control doing the wrong thing. And the dining chair's default wood is
dark enough that the slats and stretchers read only faintly in a dim room.

### The two decline toasts — the halves nobody has pressed, merged to `main` in `4cc663b` (PR #89)

**The refusal now names WHICH impossible condition it hit**, rather than always saying
both, so a declining press should read *"No safe arrangement found — The closest it found
put a piece **through a wall**, so nothing was moved. Press Fix again …"*. Measured on
`u`/`l`/`t` at 6x4, seeds 1-8, both modes: 48 solves, 9 impossible, 38 applied, 1 no-gain,
and all 9 name `outside` alone. `arrange` declines on seeds 1, 2, 5 and 7, so the press
pattern is unchanged and only the wording moved.

**The wrap question is OPEN.** Character counts, from the literals in
`components/studio/RoomTools.tsx`:

| site | `outside` | `overlap` | both |
|---|---|---|---|
| `:731` Fix (the longest) | 147 | 151 | **169** |
| `:1207` Try a fix, scoped | 116 | 120 | 138 |
| `:1089` re-fit offer | 106 | 110 | 128 |
| `:1208` Try a fix, unscoped | 93 | 97 | 115 |

The range across the four sites is **93 to 169** characters. Check the two ENDS, not a
middle — a reviewer given the old "144 to 166" would have tested neither.

**A FIFTH refusal joined this panel, and it is the one arm here that HAS now been on
screen** — 133 characters at `t` 5.5×3.8, rendered on `4cef13a`; the block further down
has the measurement. This sentence said "has never been on screen either" for one commit
after that stopped being true, which is the trap `docs/traps.md` now carries under *a
document contradicts itself and nothing conflicted*. Shuffle used
to answer every failed press with *"Every layout it tried left something in the way …
Press Shuffle again for a different try."* In a room that already carries a hard finding
that press can often fail — `isCleanShuffle` is absolute where the other shuffle gate
is relative (§ 4c) — so the advice was wrong in exactly the room it was most likely to be
read in. On the user's ruling it now names the room's own finding instead. Both sentences
come out of `shuffleRefusal` in `lib/layout-shuffle.ts`, not out of the component.

| Shuffle refusal | length | refusals / 14 presses |
|---|---|---|
| clean — "press again" (unchanged) | 116 | `rect` 6×4 **2/14**, `t` 5.5×4.7 **9/14** |
| blocked, one finding | 112 | `u` 5.5×3.8 **14/14**, `u` 3×2.4 **14/14** |
| blocked, two findings (the longest) | **133** | `t` 5.5×3.8 **10/14** |
| ~~blocked, one finding, long title — 120 at `l` 3×2.4~~ | — | **0/14 — no press produces it** |

**The column above was `seen at` and it named a population no press reaches.** It was
derived by calling `shuffleRefusal(shuffleBlockers(analyzeRoom(...)))` — a LIB-level
derivation that never asked whether `shuffleRoom` actually refuses. It does not at
`l` 3×2.4: that room has one blocker and Shuffle succeeded on **14 of 14** presses, so
the 120-character string is real code output that no user can be shown. Re-derived by
driving `shuffleRoom` itself over ten rooms × 14 attempts, and the browser run agrees —
133 at `t` 5.5×3.8 and 116 at `rect` 6×4, both rendered on `4cef13a`.

**Having a blocker and refusing are not the same thing, and this row asserted they were.**
The sentence above said a press "can never succeed" in a room carrying a hard finding.
`l` 3×2.4 refutes it: `shuffleBlockers` reads `analyzeRoom`, `isCleanShuffle` reads
`breakdownAfter`, and the two can disagree about the same room. The refusal copy is
unaffected — it only renders when `shuffleRoom` returns null, and then it names the cause
correctly — but the reachability claim was wrong.

The lengths were **not** read off the template, which is how the
first version of this row was wrong twice over. It quoted 126 and 145 from a hand-typed
example whose finding title happened to be a noun phrase, and the template it was
measuring spliced the title into *"this one already has …"*, which produced *"this one
already has you can't walk to everything"* on every `access` finding. Deriving the string
from real rooms found the broken grammar; reading the template had not. The finding is
quoted verbatim now, and the longest form came DOWN from 155 to 133.

**RENDERED AT LAST, 2026-09-06 — both Shuffle arms, in a browser, on `4cef13a`.** Playwright,
production build, rooms seeded META-ONLY so `defaultScene` builds the real starter
arrangement (seeding a scene would run `normalizeStoredParts` and re-derive the state the
refusal is about).

| room | arm | rendered message | chars | predicted |
|---|---|---|---|---|
| `t` 5.5×3.8 | blocked, two findings | *Room check reports “No room to pull the chairs out” and 1 more, and Shuffle only offers rooms with nothing in the way. Try Fix first.* | **133** | 133 |
| `rect` 6×4 | clean | *Every layout it tried left something in the way, so your room is unchanged. Press Shuffle again for a different try.* | **116** | 116 |

**Both predicted lengths were exactly right**, which retires the doubt this row carried
about its own table — the derivation-from-real-rooms was sound where the earlier
hand-typed 126/145 was not.

Three things settled that were never eye questions:

· **The quoted finding matches a Room check line WORD FOR WORD** — compared as strings
  between the toast and the room panel in the same DOM. This is the exact defect the row
  records having had (*"this one already has you can’t walk to everything"*), and it is
  not present.
· **The blocked arm carries no "press again"** and the clean arm does. Correct both ways.
· **Neither is clipped.** Both render 306×52 px with `scrollWidth === clientWidth` and
  `scrollHeight === clientHeight`, and walking up from the text found **no ancestor that
  clips at all**. So the wrap question is answered for the two lengths that exist.

**What is NOT closed, stated so nobody reads the above as more than it is:**

· **The 169-character both-terms string still has never been produced — 0 of 840 solves.**
  It is the `Fix` refusal, not Shuffle’s. Swept 2026-09-06 over 5 layouts × 7 sizes × 12
  seeds × both modes: **840 solves, 22 declined for impossibility, and all 22 named
  `outside` alone.** So `overlap` alone is 0/840 as well, and the disjunction has never
  once been the true answer. Measuring the two lengths that occur and implying the 169
  fits would be the same error as the 126/145.

  **It needs both terms to rise in ONE declined solve**, which is what makes the rate
  meaningful rather than merely unobserved: `declinedTermsFor` returns
  `IMPOSSIBLE_TERMS.filter((k) => after[k] > before[k])`, and all four call sites in
  `RoomTools.tsx` pass `result.declinedTerms` on the `declined === 'impossible'` branch.
  The empty-list fallback inside `impossibleClause` — which also returns the 169 — cannot
  fire from the app, because `impossibility` is a SUM over those terms, so a decline
  implies at least one of them rose. **This was driven through the same value the four
  sites render**, which is the check the struck `l` 3×2.4 row did not have.
· **`l` 3×2.4 did not reproduce, and its row is struck above.** Shuffle SUCCEEDED on all
  14 presses, so that 120-char arm is unrendered. **Two instruments reached the same 0/14
  independently** — 14 real presses in a browser, and `shuffleRoom` driven over ten rooms
  × 14 attempts — which is worth more than the row it retired.
· **Whether the wording reads well is untouched.** A probe can say the sentence fits and
  quotes accurately. It cannot say it is good.

**Two probe defects worth keeping, because both reported a believable wrong answer.**
The matcher first accepted `/arrangement/`, which is in the SUCCESS toast ("A different
arrangement, not a fix") — so two rooms "found a toast" that was not a refusal and the
loop stopped satisfied. **A matcher that accepts the thing you are ruling out cannot rule
it out.** Then, with that fixed, the host STACKS toasts and the first long line still
belonged to an earlier success: the run printed a 68-char success message while the
refusal it came for sat further down the same element. Pick the leaf whose own text is
the thing you want, never the first one that is long enough.

**What to look for:** open a `t` at 5.5 × 3.8 (Room panel, type the size), press Shuffle,
and read the toast — the quoted finding must match a line in Room check word for word,
and there must be no "press again" in it. Then a `rect` at 6 × 4, where the old sentence
is still the right one. **Both were rendered on `4cef13a`** — the table above — so what is
left at these two lengths is whether the wording reads well.
`overlap` alone has never been produced by any solve measured so far — **0 of 840**, five
room shapes, every refusal `outside` — so *"inside another one"* as a standalone clause is
unseen, and the 169-character both-terms string has never been produced at all. (This
sentence's own earlier figure was 48 solves across three shapes; the sweep above replaces
it. The **other** "48 solves" in this section, at the top under PR #89, is a different and
narrower measurement — `u`/`l`/`t` at 6×4, seeds 1-8 — and it stands: it carries the
seed-level decline pattern, which the wide sweep does not record.)
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

## Shell and flow

*Owner: `shell`. The Library click-through was looked at on 2026-08-30 — the Add rail is
present and the panel is visible on both tabs, which is the whole of what was left for a
person. The three signposts and the click-through are gated by `tests/studio-copy.test.tsx`
and `tests/library-click-through.test.tsx`. The Catalog tree was looked at on 2026-10-01
and is gone. What is left is here because what a test can check about it and what a person
can see are different halves.*

### The rooms page opens the app, and Settings goes back where it came from — merged to `main` in `150e12a` (PR #211); Back moved to the heading's right, and the footprint page tightened, merged to `main` in `1ea06f1` (PR #213)

**Where to click.**
- A fresh profile (or cleared site data) on `/`. It should open on the empty rooms page, with **Create your first room**.
- An old `/workspace` or `/onboarding/welcome` bookmark. It should land on the same page.
- A private window with site data blocked, on `/`. It should say your rooms can't be opened here, why, and offer **Try again**. It should not offer a **Create** that would fail to save. Nothing tests this screen's failed read.
- Settings opened offline from a room. It should open Settings, not the rooms page.
- Delete a room on `/`. The toast should sit below the top bar, not over it.
- Open Settings three ways, and press its Back each time:
  - from a room's View menu (the gear);
  - with Cmd/Ctrl+, in the studio;
  - from the scan screen's **Set up a key in Settings**.
- Paste a Settings address that has `?from=` into a new tab, and press Back there.
- Settings at phone width (375px).
- Settings opened from the rooms page. Back should sit at the right end of the heading row and read **Back to your rooms**.
- The footprint page (**New room**) at 1280×800. Double-click a shape that is not the picked one.
- The same page at 375px.

**What wrong looks like.**
- A welcome page, or a flash of one, before the rooms.
- Settings' Back anywhere but beside the heading, or missing when Settings was opened from the rooms page.
- On the footprint page: a scroll at 1280×800, or the two buttons on separate lines there; a double-click opening the shape picked before it; the picked shape's tile shifting its contents by a pixel; at 375px, the shapes not reflowing to two or three across, or the buttons not stacking full width.
- Back reading a plain "Back", or going somewhere other than the room or the scan it names. A fresh tab, or a link opened from another site, should push to the path, never leave the app.
- On a phone, the three cards' rows not stacking, or the key field and its buttons running off the card.
- The tinted tiles reading as buttons.

**Settled without eyes.**
- Which paths Settings will honour, what Back says, and how it gets there are in `tests/settings-return.test.ts`. So is the sweep holding every way in except the rooms page to carrying its place. Mutants across three rounds were all caught, counted in the PR.
- The View menu's link carries its room, in `tests/view-menu.test.tsx`.
- Settings' Back placement and fallback are in `tests/settings-back.test.tsx`; the footprint page's double-click, its touch copy and its button row in `tests/layout-pick-open.test.tsx` and `tests/reflow.test.ts`. Eleven mutants, all caught. Measured in Chromium: the footprint page is one screen at 1280×800 and 1024×768, the five shapes span the drawing's width, and Settings' Back ends on the cards' right edge.
- The worker's precache and fallback are in `tests/service-worker.test.ts`.

### View behind a gear, collapsed rails as icon strips — merged to `main` in `5114b5f` (PR #179)

**Looked at: everything but the screen reader.** In the walkthrough the gear menu, the
collapsed strips, Tab → Enter on a strip icon, and on a phone the View sheet (now as tall
as its controls, #187) all passed. The screen-reader stop was skipped for now, not passed.

**Where to click.** With VoiceOver or NVDA on, shut the right rail and move through its
strip icons.

**What wrong looks like.**
- A strip icon announced as "button" with no name.

**Settled without eyes.** Each strip icon asks for its section and opens the rail. The tree
takes that request once and focuses the section. Side tooltips are placed beside their
trigger and capped to the room on that side. `ViewOptions`
has exactly two homes, found by sweeping the tree. From the review: Help closes when View
opens and the other way round, Help's Esc still belongs to a field being typed in first, a
phone View sheet swaps to Details on a pick, the right strip lands focus in the panel it opened (once), and its badge caps at 99+.
In headless Chromium, Help and the gear closed each other both ways at 1440px, and the gear's
card sat inside the window at 600px (x 87–387) and 700px (x 187–487). All of this is in
`tests/collapsed-rails.test.tsx`, `tests/empty-inspector.test.tsx`,
`tests/view-menu.test.tsx` and `tests/rail-intent.test.ts`,
and every assertion was mutation-checked: 30 mutants, all caught, plus 7 more on the review’s
fixes. Two survived their first run (the strip tooltips placed above their icons, and the
focus landing firing again on a later open from the chevron), and each has its own test now.

### One type scale, and piece names you can read at laptop width — `c2137c4` on `main` (PR #157), SWEPT, wants a hand on a real mouse and a real phone

Every font size is one of eight steps now and every transition one of three speeds
(`--fs-*`, `--dur-*` in `globals.css`). Most sizes moved by half a pixel. Swept with
`scripts/fidelity-sweep.mjs` on every screen at 360 / 390 / 768 / 1024 / 1280 / 1440 /
1920, metric and feet: **0 findings** (the build before this had 2 — the plan's unit
readout cut off by its toolbar on a phone — plus the catalog names cut to one letter,
which the sweep could not see until it learned to). SwiftShader, desktop Chromium only.

What the sweep cannot tell you, and a person can:
- **The catalog's hover actions.** Point at a piece row in the left rail: lock, hide and
  remove fade in OVER the end of the name, on a fade of the row's own colour. Wrong looks
  like a grey slab, a hard edge, or the name jumping sideways. On a narrow list only lock
  and hide come up — see the next item.
- **Select a row** (mouse or touch): it opens to two lines — the name keeps the whole
  first line, lock / hide / remove sit right-aligned beneath it. That is also the only
  way a touch screen reaches them. Wrong looks like the buttons sitting on the name, the
  name dropping under the dot, or a row with no way to hide or delete the piece. Do it on
  a piece inside a group too: the group's line should run unbroken through the opened
  row, and on the group's LAST piece stop at the elbow beside the name.
- **A locked or hidden piece** shows a small padlock / crossed eye after its name without
  hovering.
- **On a phone** the 3D tab's Move / Scale / Rotate read in full, with the W / S / R
  keycaps gone. Wrong looks like "M…".

### Pointing at a piece on a narrow list leaves its name readable — merged to `main` in `960036a` (PR #165), PROBED at 1024–1440

**Where to click.** Any furnished room, either tab, in a window 1024–1279 px wide (or a
wider one with the left list dragged to its narrowest). Move the pointer down the piece
rows. Only **lock** and **hide** come up over the end of the name; **remove** waits. Click
**hide** on a row you have not selected: the piece hides on that one click, and the button
under the pointer is still the same one (now *show*). Then click a row: it opens to two
lines with all three under the whole name. Then Tab into a row you have not selected, and
Shift+Tab back into one from the row below: all three come up, and Shift+Tab lands on
Remove first. A group's row does the same with its two: **ungroup** shows, its Remove
waits. At 1280 and wider, with the list at its usual width, a pointed-at row shows all
three, as before.

**Why.** On that list the three buttons covered all but the first ~45 px of the name they
floated over — "Coff" for "Coffee table", with a Remove button under the pointer. Folding
Remove away until the row is selected or reached from the keyboard gives the name back
26 px and keeps a delete from turning up under a passing pointer. Remove is still one click
away (select the row), and Delete removes the selected piece.

**What wrong looks like.**
- A name still cut to four or five letters under the pointer.
- A click on hide that does nothing, or that leaves Remove where hide was — that was the
  first version of this change, caught by the review before it merged.
- The row jumping, or its height changing, as the pointer crosses it.
- A selected row, or a keyboard-focused one, missing its Remove; a screen reader not
  offering Remove on a row.
- Remove missing on a pointed-at row at 1280+ with the list at its usual width.

**What was measured, and on what.** SwiftShader, desktop Chromium, the L-shape's fourteen
starter pieces: `scripts/row-hover-probe.mjs` at 1024, 1100, 1279, 1280, 1440, and 1440 with
the list dragged to 228 px. On `main` its first version read 35 passed, 7 failed — on the
206 px list 11 of 14 names cut under the pointer, "Coffee table" 45 of 71 px. The review of
the first fix found a mouse press unfolding Remove and Shift+Tab stepping past it; the probe
grew both checks, which read 52 passed, 8 failed on that fix (every narrow list failing
both), and 60 of 60 now, "Coffee table" 71 of 71 px. The CSS rule is held by
`tests/reflow.test.ts`, which fifteen mutants of the rule failed. Group rows are not in
the probe's seeded room, so their half is read from the code, not measured. Nobody has
done it with a real mouse, or with a screen reader.

### The laptop studio as panes on a wash — `c2137c4` on `main` (PR #157), SWEPT, needs a real GPU and a Mac

At 1024, 1280 and 1440 on both tabs: the rails and the room are rounded panes with an
even gap; the sash hover line sits in the middle of the gap; the right rail's footer
band follows the pane's lower corners. Over the room, the toolbars and the camera
gizmo should look frosted as the room moves under them; on SwiftShader the blur was
only seen over a still frame. Wrong would be: a square corner poking past a pane, a
dropdown or the room report landing lower than its trigger (a filter crept onto a
rail), or text looking greyer on the rails than on plain paper. With macOS "Reduce
transparency" on, the panes should be solid. The room size fields at 1024 put Height
on a second line with every number whole.

### Floating chrome as pills — `c2137c4` on `main` (PR #157), SWEPT, needs a real GPU and a touch screen

Swept at all seven widths: **0 findings**. On both tabs every cluster over the room is
a rounded capsule with quiet buttons inside: undo/redo; on the plan, Zoom (− m · 100% +)
and Turn and fit (⟲ 0° ⟳ | Fit); on 3D, Move / Scale / Rotate with the chosen mode as a
dark capsule, then Snap and Add. At 1024 on the plan the right corner folds into two
rows (undo/redo + Zoom, then Turn and fit), never three. Press + and − repeatedly: the
buttons must not shift as the percentage changes digits. Wrong would be: a pill that
disappears into a pale wall in 3D (the rim is deliberately soft and the lift is the
shadow, so check a light wall colour), a keyboard focus ring cut off inside the mode
strip, or Comfort zones shorter than undo/redo on a phone.

### Phones get a phone layout, tablets one docked panel — `c2137c4` on `main` (PR #157), SWEPT, needs a real phone and a real tablet

Below 1024px the studio is `SheetShell` (see `Design.md` § Phones and tablets). Under
600px: a one-row app bar, a toolbar (Room · Add · View, or Room · *piece name* · Done
with something selected), and one sheet that rises above the toolbar. From 600 to
1023px: the room with one docked pane and Room · Details tabs. Swept at 360 / 430 / 768 /
1440: **0 findings**. The drag was also probed in the build: pulled up past the top, the
sheet settled at full (613px of a 669px stage on a 390 × 844 window). SwiftShader,
desktop Chromium with a mouse standing in for a finger, which is exactly the part a
phone has to close.

What only a real phone can tell you:
- **Safe areas, on an iPhone with a notch or Dynamic Island.** The app bar clears the
  status bar, and the toolbar's labels clear the home indicator. Wrong looks like
  "Room" sitting under the home bar, or the back chevron under the clock. Do it in
  landscape too: the side insets should keep the chevron and the More button off the
  rounded corners.
- **Safari's own toolbar collapsing.** Scroll a sheet's contents, then tap the room.
  The studio's toolbar stays attached to the bottom edge, with no gap under it and no
  jump when Safari's bar shrinks or grows. This is the iOS 26 fixed-bar report the
  in-flow toolbar exists to avoid; it is **unverified**, so a jump here means the
  workaround was the wrong one.
- **The sheet under a finger.** Drag the grabber up slowly: it follows the finger and
  settles at nearly full. Flick it down from half: it closes. Tap the grabber: it swaps
  half ↔ full. Wrong looks like the page scrolling instead of the sheet moving, or the
  sheet snapping back to where it started.
- **Scrolling a panel to its end.** With Room open, scroll its list past the bottom. The
  page must not scroll or bounce behind it.
- **Pinch and pan in the 2D plan**, now that its zoom box is gone on a phone. Two fingers
  zoom about the point between them; one finger on empty floor pans. Wrong looks like the
  browser zooming the whole page.
- **Add, by tap.** Open Add, tap a piece: it appears in the room at the first clear spot
  and the sheet stays open for the next one.
- **More (⋯).** It opens with How this works and the three exports, each row a
  comfortable thumb target. Tap outside it: it closes.
- **A tablet, portrait (768 or 820 wide).** The pane sits to the right of the room with
  Room · Details tabs. Tap a piece: the pane turns to Details. The room keeps most of the
  width. Wrong looks like the pane squeezing the room under half.

### The lens tilt read needs a real phone, on BOTH engines — merged to `main` in `17f9d62` (PR #148)

**Where to click.** On an Android phone in Chrome and on an iPhone in Safari: reach
the capture screen **by pressing through the app** — the shape picker's *Photograph my
real room first*, or a half-photographed room's *Resume* pill in the workspace — rather
than typing its address. A typed address is a
fresh page and reads the policy the capture route is served with; a press keeps the page
you started on and reads THAT one, which is how every real visit arrives and the only way
a policy scoped to the wrong route shows (`docs/what-is-still-open.md` § 45 measured
exactly that). Then tap **Turn on camera**, grant the camera and (on iOS) the
motion-and-orientation prompt, then hold the phone upright and take a wall photo with the
top edge tipped visibly **down**. The photo must arrive carrying a tilt.

**What wrong looks like.** Nothing. That is the whole problem, and it is why this item
exists rather than a test. When the sensor grant is missing, `deviceorientation` simply
never fires, `useDeviceTilt` reports `null` forever, and the geometry falls back to
assuming a level camera — a ~20% distance error for an ordinary 5° droop, with no error,
no warning and no failing test. The screen looks identical either way.

**How to tell, given there is nothing to see.** The capture screen does not surface tilt
anywhere today (that is filed as its own gap — see § below on making it legible). Until it
does, the check is a devtools one: with the page open, `window.addEventListener(
'deviceorientation', e => console.log(e.beta, e.gamma))` must log a stream of numbers, and
`beta` must fall as the phone tips forward. Silence means the header is still wrong.

**Why both engines, and why this is not paranoia.** The grant was wrong twice on the same
three entries, in opposite directions, and the second time it was *nearly* shipped:
`accelerometer` + `gyroscope` is what the W3C spec requires for the relative
`deviceorientation` event and what Blink enforces, but WebKit implements no
`ondeviceorientationabsolute` and requires `magnetometer` as well for plain
`ondeviceorientation`. All three are granted for that reason. **The WebKit half is the
part that is not verified**: the primary sources were unreachable from the environment the
fix was written in, so it rests on a secondary W3C device-APIs thread and was chosen
because the asymmetry is one-sided — a spare token costs an entry Blink ignores, a missing
one costs every iPhone. An iPhone is the only thing that closes it. If iOS turns out not
to need `magnetometer`, the honest follow-up is to drop it and say so here, not to leave a
token granted "just in case": a permission with no consumer is the other half of the same
rule.

**Where it rides.** `17f9d62` on `main`. `next.config.mjs` grants the trio;
`tests/permissions-policy.test.ts` pins the pairing in both directions, and four mutations
were confirmed to fail it — sensors denied, `geolocation` granted with no consumer, the
consumer import removed, and a new powerful feature granted with no reason row. Every one
of those is a check that the *header text* matches the *source*. **Not one of them can
tell you an event fired.**

### Sampled wall colours — do they look like the room they came from? — merged to `main` in `17f9d62` (PR #148)

**Where to click.** Open a room that was built from photos (the capture flow, not
the picker). Left rail → **Room** → **Use the colours in my photos**. Then compare each
wall in the 3D view against the photo it came from — the capture screen still has them,
or `/onboarding/detect`.

**What wrong looks like.** Four kinds, and only the first would fail a test:

· **The wrong wall.** Wall 2's colour on Wall 3. The mapping is swept over every preset
  in `tests/wall-sample.test.ts`, so this would have to be a footprint the sweep does not
  hold — worth one look at a room whose walls have been dragged.
· **A colour that is not the wall.** A sofa's beige, a curtain's navy, the skirting's
  white. The band is bounded by derived rows and furniture boxes are excluded when the
  room has them, but neither is a guarantee: **a room opened from a saved scene file has
  no detection boxes at all** (`fromDetection` is stripped on export), so that is the
  case most likely to show it. The toast says when furniture was not excluded — check
  that it did.
· **Too dark, uniformly.** Every wall reading like its own shadow. The sample is a median
  over one band, and a wall lit from one side has no single colour; this is the failure
  mode I would expect first and no assertion can see it.
· **Nothing happens.** The button renders only for a room with captures. If it is absent
  on a room that has photos, `hasCaptures` is the thing to check.

**What a test already covers, so you do not have to.** That the band excludes floor and
ceiling (against an independent camera model, across four slots, two aspects, two
lenses, ±5° tilt and three camera heights, and over a footprint with two walls dragged as
well as a centred one); that an ASSUMED lens keeps the band inside the true junctions for
every real lens from 66° to 120°; that a band which leaves the frame by the same edge
twice, or that is under 5% of the frame, is refused; that the mapping refuses a triangle, a
chamfered rectangle, a room turned 30° off the axes, and a room with two walls facing the
same way; that the highlight/shadow trim rejects a shadowed navy curtain; that no key is
written outside the footprint. **What no test covers is whether the result looks like the
room** — every one of those checks is about numbers, and the deliverable is a colour.

**One thing to look at that is new, and it is the reason to re-look at all of this.** The
band this now samples is SMALLER than the one the screenshots in this item were taken
against: with no EXIF focal length it is drawn for a 120° lens rather than a 66° one,
because the old band put about a third of its samples on floor and ceiling for any photo
taken on an ultrawide (the normal case — see `Design.md` § Wall colours). Smaller and on
the wall is the intended trade. **What would say it went too far is a photo whose walls
are read but whose colours now come out flatter or darker than before**, i.e. a band that
has shrunk into one lit strip; and, at the other end, a room where the button now reports
"no wall colour to read" on photos that used to answer.

**Where it rides.** `17f9d62` on `main`, which carries the pure seam, the control and
the shell, and the later rewrite of the band itself. `lib/wall-sample.ts` and
`lib/color-reduce.ts` are tested from synthetic typed arrays; thirteen mutations of the
band's code were each confirmed to fail a test, and two survived the first round — both
were the trap the fix is about.

### Does "Use my photos’ colours" fit the left rail at 1024–1279px? — merged to `main` in `17f9d62` (PR #148)

**Where to click.** Open a photographed room, narrow the window to about 1100px — the
compact step, where the left rail is `--rail-left-tight` **208px** — and look at the
button under the Room section's dimensions.

**What wrong looks like.** The label printing through the button's rounded border, or
running under the rail's right edge and being clipped with no scrollbar and no other
clue. `.ds-btn` is `white-space: nowrap` with no `overflow` of its own, and the rail is
`overflow: hidden`, so those are the two failure modes and both are silent.

**Why it is here.** The label was "Use the colours in my photos" — 28 characters, which
at 12px Nunito is ~168–185px, plus a 13px icon, a 6px gap and 32px of padding: 219–236px
of content in a 208px rail. Font metrics are not derivable from a test, so the exact
figure is a browser question, but the direction was not in doubt. It is shortened to 22
characters AND given its own element with `minWidth: 0` and an ellipsis, which is what
`.ds-btn`'s own comment prescribes for a button with no room. **The busy label is
SHORTER, so the idle state is the one to check.**

**Where it rides.** `17f9d62` on `main`. Font metrics are not derivable from a test,
which is why this is here and not in the suite.

### Scanned furniture should now stand AWAY from the wall by half its own depth — merged to `main` in `17f9d62` (PR #148)

**Where to click.** Photograph or upload a room with a detectable floor piece against a
wall — a wardrobe, a sofa, a chest of drawers — and run the detect screen, then open the
3D tab and the 2D plan. Look at the gap between the piece's back and the plaster.

**What wrong looks like.** The piece pressed flat into the wall with its back plane
through the plaster, or standing a visible hand's width too far out into the room. Also
worth a look on the 2D plan, where a wrong wall standoff reads as a stripe of floor behind
the piece that is not there in the photograph.

**Why it is here.** `placeFloorObject` used to decode the bbox's bottom edge as the
piece's CENTRE. That edge is its near face, so every floor piece landed about half its own
depth too close to the lens — a 850 mm sofa by 425 mm, which is most of a pace. It decodes
the centre now, so a piece's back should sit where the wall is, and its front should sit
half a depth into the room. The suite proves the arithmetic exactly against a projected
solid; what it cannot see is whether the scene then LOOKS right against the photograph it
came from, and there is a second mover downstream — `snapToWall` with `wallStandoff`, which
also nudges a piece toward the plaster and could now be double-counting or fighting it.

**One more thing to check while you are there.** Low pieces should have stopped reading
tall. A nightstand or a coffee table was coming back ~130 mm too tall, because the top row
of a piece whose top is BELOW the lens images its far top edge and the height was being
read at the near one. Compare a nightstand's height against the bed beside it.

**Where it rides.** `17f9d62` on `main`. `tests/detect-pipeline.test.ts` prints the
baseline table on every green run, and that table is the record of what changed — but no
test in this repo renders a room, so the gap between a wardrobe's back and the plaster is
only ever settled by looking.

### A scanned air conditioner or TV should stop coming back over-wide — merged to `main` in `17f9d62` (PR #148)

**Where to click.** Scan a room that has something deep on a wall — an air conditioner or
a split unit is the case, but a chunky TV or a boxed-in window will do — and look at the
piece's WIDTH in the Inspector against the real thing, then at the detect screen for any
"looks wrong" flag on a word that was in fact correct.

**What wrong looks like.** A wall piece noticeably wider or taller than the real one; or
the detect screen offering to repair a label it identified correctly.

**Why it is here.** `placeWallObject` used to put a piece's centre on the plaster, where
its back goes, so its body sat nearer the lens than the placer thought and every angular
measurement was read at the wrong plane. Thin pieces barely showed it — a painting +1.8% —
but the catalogue's air conditioner is 220 mm deep and read **+21.7% wide and 91 mm too
tall**, which put a correct 280 mm unit outside its own 250–350 band and made `judgeLabel`
accuse the word. The arithmetic is now exact against a projected solid at five tilts; what
no test can see is whether a real detector's box on a real AC unit gives a width that looks
right in the room.

**What is NOT worth looking for.** Its distance from the wall. The wall-normal position
never came from this placer in the rendered scene — `snapToWall` recomputes it from the wall
itself — so a wall piece has always sat with its back on the plaster and this change does
not move it.

**Where it rides.** `17f9d62` on `main`. The harness's own deep fixture is a 220 mm
`ac-unit`, added because every wall piece already in the truth table was 30–80 mm deep and
so could not express the error — which is the reason to check this against a real deep
piece rather than trust the green run.

### A picture near a corner should stop appearing twice at two different sizes — merged to `main` in `17f9d62` (PR #148)

**Where to click.** Scan a room that has something hanging close to a corner — a framed
print, a mirror, a wall clock, a curtain that runs up to the return wall. Take the two
photos that share that corner. Then look at the detect screen for a second copy of the same
piece, and at each copy's WIDTH in the Inspector.

**What wrong looks like.** Two of one picture, and the second one noticeably bigger than
the real thing — or a high wall fixture (a vent, an alarm, a corner speaker) turning up as
an oversized ceiling light.

**Why it is here.** An ultrawide frames more than the wall it is pointed at, so a piece on
the RETURN wall is in shot near the shared corner — and both wall and ceiling placers
inverted whatever they were given against their own assumed plane without ever asking
whether the answer was still inside the room. Measured: a 700 × 500 print 800 mm from a
corner came back **893 × 803** — +28% and **+61%** — 764 mm past the end of the wall it was
pinned to; a 300 mm vent read as a ceiling piece came back 386 mm wide and 571 mm outside
the room, having passed the one gate that function already had. Both are refused now.
(Those figures come from the table `tests/photo-geometry.test.ts` prints on every green run.
The ones this item first carried — 960 × 711, 769 mm — were measured against a scratch
re-implementation of the placer instead of the placer, and described a different room.)

**What is NOT worth looking for, and this is the part a test had to establish.** Fewer
rows. The refusal does not delete the second sighting — a refused detection keeps its
catalogue size and gets arranged, so **you should still expect to see two pieces**. What
should be gone is the *fabricated size*: the second copy should look like a plain
catalogue-sized picture rather than a confidently over-large one, and the detect screen
should stop offering to repair a label it read correctly. Deleting the duplicate is a
separate question and nothing here touches the merge distances.

**The one thing this cannot fix, so do not read a failure into it.** The gate is only as
good as the lens. A wide photo whose focal length EXIF does not carry, read as the 66°
default, under-reads every lateral offset and pulls a fabrication back INSIDE the wall
where no bound can see it — the same print lands 2.27 m along a 3.0 m half-span. If a
piece near a corner still comes back over-wide, the lens is the suspect, not the gate.

**Where it rides.** `17f9d62` on `main`, which carries both the gate and the later fix
to the gate's own bound. That the refusal refuses nothing legitimate was established rather
than assumed: the `detect-pipeline` baseline table came out byte-identical and the
off-square sweep diffed clean. What no sweep reaches is whether the piece the user gets is
now one picture at its real size.

### A room whose walls you DRAGGED, then re-scanned — sizes should stop being ~13% small — merged to `main` in `91f1f6a` (PR #150)

**Where to click.** Build a room from photos (the capture flow). Open it, drag one wall —
3D wall handle, the plan view, or Inspector's ±10 cm buttons — far enough to notice, say
half a metre or a metre. Then left rail → **Room** → the **Re-scan** button in the section
header (the circular-arrow glyph), which takes you back to `/onboarding/detect` and re-runs
the geometry against the room you have just reshaped. Compare the wall-mounted pieces — a
TV, a picture, a window — against the same room before the drag.

**What wrong looks like.** Wall pieces coming back noticeably SMALLER than they should be,
and floor pieces sitting off their wall. Every plane, bound and clamp in the geometry used
to be measured from `depth/2` — the room's bounding box — and dragging one wall makes that
the wrong number for both walls on that axis. Measured, on a north wall dragged out a
metre: a 700 × 500 print decoded **611 × 437**, and a sofa was pulled 500 mm off its own
wall.

**Why a person is needed for a fix that is exact in the harness.** Two reasons, and the
second is the real one.

· The suite's proof is a round trip: project a piece with an independent camera model,
  invert it with the placer, require the truth back. That proves the arithmetic and says
  nothing about whether the room the app rebuilt *looks like* the room. Only the drag →
  re-scan → look loop does.
· **The re-scan route itself has never been walked with a reshaped room.** It exists —
  `PartTree`'s header action is an unconditional link, and `RoomSync` deliberately does
  not pin the scene of a reshaped room that still has photos, so that re-scan keeps
  working — but that combination was read out of the code, not exercised. If the button
  silently does nothing on such a room, the fix is real and unreachable, and no test here
  covers the navigation.

**What would NOT be a bug.** Two things, and the second is the one that will look like
the bug this item is watching for.

· ~~An **L, T or U** room still measuring to its bounding box.~~ **That was the first
  bullet here and it is FIXED** — § 44b, below, which is its own item and wants its own
  look. A `rect` room is still the cleanest place to see *this* fix, because it isolates
  the drag from the room shape.
· **A drag big enough to leave the camera outside the room, where every wall piece comes
  back at its catalogue size.** `moveWall` only checks the resulting box against
  `ROOM_SIDE_M`, so dragging one wall of a 6 × 6 room inward by 3 m or more is accepted and
  puts the whole footprint on one side of the origin — at which point `wallFrame` refuses,
  and refusing is correct: the photos were taken from somewhere that is no longer in the
  room. It is indistinguishable **on screen** from the re-scan having silently done
  nothing, which is the first bullet above, so keep the drag modest — a metre on a 6 m
  wall is plenty to see the fix. Filed in § 44.

**Where it rides.** `91f1f6a` on `main`. `wallDistance` is deleted; all five sites read
`wallFrame`, and the change was a verified no-op on every centred room — the
`detect-pipeline` and `off-square-cost` baseline tables came out byte-identical, which is
exactly why the off-centre case is the one that needs eyes. The gate counts are gone: they
were measured on two commits a squash has replaced with one.

*(This entry named the BRANCH, and gave no count to attach to it, until a review of its own
commit caught it — against this file's own rule twelve hundred lines up, that the artifact
is a commit and never "the tree", and two commits after PR #149 re-pointed six items off
that same branch name for exactly this reason. A branch moves; that one was restarted the
same day. The rule turns out to be easy to keep while writing about someone else's work and
easy to drop while writing about your own, which is the only reason this parenthesis
survives the re-point.)*

### A U-Shape's first wall shows no length, and it looks exactly like a missing number

**Where to click.** `/` → **Create your first room** (or **New Room**) → choose **U-Shape** →
*"Photograph my real room first (optional)"* → add four photos. Look at the four cards'
wall-length labels.

**What you will see.** Walls 2, 3 and 4 read `5.00 m`, `6.00 m`, `5.00 m`. **Wall 1 reads
nothing at all** — the chip is just "Wall 1".

**That is correct, and that is the problem.** The `u` preset's notch reaches exactly the
middle of the room, so the standardised camera position is *on one of its own walls* and
there is no wall in front of a north-facing lens; `wallFrame` returns null and the label
declines to invent a number. Refusing is the honest answer about a photograph pointed out
of a doorway. But three walls with lengths and a fourth without reads as a number that
failed to load, on the one line the copy above it tells you to check your photograph
against — and a person cannot tell a deliberate silence from a broken one.

**Why a person is needed.** Whether it needs copy ("no wall ahead from here"), a different
treatment, or nothing at all is a judgement about what a stranger infers from a gap, which
no assertion reaches. It is also entangled with the larger open item — the rig standing the
camera at the bounding box's centre — so the right answer may be to move the camera rather
than to explain the gap. Filed in `docs/what-is-still-open.md` § 44b.

**Where it rides.** The refusal is `9390323`; the label reaching it at all is `e6cd8f4`
on `main` (PR #154). `scripts/capture-route-probe.mjs` pins the absence as an assertion
(S3.1), so the silence cannot regress into a wrong number — what it cannot judge is how
the gap reads.

### Whether a rebuilt room LOOKS like the room you photographed

**Where to click.** Any preset → *"Photograph my real room first"* → four real photos of a
real room → let the detect screen run → **Continue with N pieces** (the button counts what
you kept).

**What wrong looks like.** Furniture at plausible sizes that is nonetheless not your room:
a sofa on the wrong wall, a piece at the right size in the wrong place, proportions that
are individually defensible and collectively unlike the space you stood in.

**Why a person is needed, and this is the residue of a walk rather than an unwalked item.**
`scripts/capture-route-probe.mjs` now walks the whole preset-plus-photos route in a browser
and measures it against the build before § 44b: the geometry moves 3.64× on a T-Shape's
stem wall, both controls hold to the printed digit, and the wall-length labels are right.
So the numbers are established and reachable. What a probe cannot do is upload a photograph
of a real room and have an opinion about the result — its uploads are synthetic, EXIF-less
images, which is exactly why they are deterministic. **This is the part of the original
§ 44b item that survived being looked at**, and it is the only part.

**Where it rides.** `e6cd8f4` on `main` (PR #154), which is the commit that puts the walk
itself there — `scripts/capture-route-probe.mjs` and the prediction committed before it.
The route is unchanged since `9390323`; what the merge adds is the wall-length label being
right on the way through, so someone judging the rebuilt room is no longer judging it past
a number that described a different room.

*(The entry this descends from once said **"Branch `claude/amazing-dijkstra-d0am9g` — to be
re-pointed at its merge commit"**, until a review of its own commit caught it: the third
time an item here cited a branch instead of a commit, and the first to write this file's
rule into itself as a promise to comply later. A promise to comply later is not compliance.
The parenthesis outlives the item it was attached to on purpose — retiring an entry is not
a reason to tidy away its retraction, and the lesson was never about the branch. It is that
the rule is easy to keep while writing about someone else's work and easy to drop while
writing about your own. Which the item then proved twice over: it also asserted that the
capture screen's wall-length label "now states the wall's real length", read out of the
source, and a browser found it still saying 4.70 m about a 2.58 m wall.)*

### A cleaner cream, a deeper ink, plain copy, and Sun direction behind an info button — `0c3cd64` on `main` (PR #158), SWEPT, needs a real phone and a real screen

The paper family lost about half its yellow and the ink went darker; every contrast
ratio in `globals.css` went up, and `tests/color-tokens.test.ts` holds the comments to
the tokens. The Room panel's "Facing" dial is **Sun direction** now, with its
explanation behind an ⓘ that opens on a tap (`InfoTip` in `components/ui/Tooltip.tsx`)
rather than a line of hint under it. The coach-mark pop-ups and the loading card's
rotating tips are gone, and visible copy has no em dashes. The room size hint ("“Area
rug” needs 2.4 m…") shows only once a width or depth is AT that floor.

What a person can see and the sweep cannot:
- **The cream on a real display**, beside the old one if you have it: it should read as
  paper, not as grey and not as yellow. Check the pale wall colours in 3D against it.
- **Sun direction on a phone:** tap ⓘ, the bubble opens above it (below it when the
  sheet is pulled up so the row is near the top) and stays on screen; tap ⓘ again, tap
  anywhere else or scroll the sheet and it closes. A tap on a control under the bubble
  should reach that control. With a mouse it opens on hover and a click closes it; on
  a keyboard, focus opens it, Enter toggles it, and Esc closes the bubble and not the
  sheet. With VoiceOver, the explanation should be read when focus lands on ⓘ.
- **A furnished room smaller than its rug** (resize a rug past the room in the
  Inspector): the size hint should say the rug's size and that it does not fit, never
  that it "needs" the room's own width.
- **The loading card** (run a detection): a pulsing dot, "Working…" and Stop on one
  row, the title under it, and no tips cycling. Nobody has seen it since the tips went.
- **The room size hint:** drag a room's width down to its largest piece; the sentence
  appears at the floor and not before.

### Loading states — `6ff707f` on `main` (PR #159), PROBED in SwiftShader, needs a real phone and a real GPU

A room opening shows paper and "Opening your room…" over the canvas, then "Building the
3D view…" until the first frame; a slow Fix or Try a fix puts up "Arranging your room…"
after 600 ms and replaces it with the result; busy buttons stay at full strength; lists
being read show breathing rows instead of "No … yet". Probed with the CPU throttled 8×
(veil: Setting up → Opening → Building, then gone) and with the worker's replies
delayed 1.8 s (the working toast at 600 ms, then the result), at 1440 and 390.

**What wrong looks like.**
- The previous room, or the starter room, visible for a moment when opening a room.
- A veil that never lifts on a real GPU (the first-frame signal not arriving), or
  "Building the 3D view…" flashing on every tab switch on a fast machine.
- A working toast that stays after its result arrives, or appears for a quick Fix.
- On a phone, the working toast covering the banner's close button (the toast's own
  top-right placement, which this did not change).

### Only kept pieces go into the room — `fdd1f20` on `main` (PR #160)

**Where to click.** Any preset → *"Photograph my real room first"* → photos → the detect
screen. Untick a piece with its ✓ (it turns to +), then **Continue with N pieces**; then
untick everything and read the note and the button again.

The review's tick used to be decoration: every row was built whatever it said, so two
sightings of one bed made two beds. Now a row goes into the room only when it is kept.
Rooms saved before this open exactly as they did (every row is marked kept on load).

**What wrong looks like.**
- A piece you left out standing in the studio, or a kept one missing.
- The + / ✓ toggle reading as "add a new piece" rather than "keep this one" — the icon is
  the add-to-library idiom, and whether it reads that way beside a photo is a person's call.
- "Continue with an empty room" or the *Nothing kept yet* note wrapping badly at 360 px.
- An old room (made before this) opening with pieces missing.

### A bed seen in two photos starts unticked, and says whose it is — `fdd1f20` on `main` (PR #160), PROBED at 360–1920

**Where to click.** Any preset → *"Photograph my real room first"* → photograph the walls
so the bed is in two of them (the foot wall and a side wall) → the detect screen. One bed
row is ticked; the other starts at + and reads *"Probably the bed from Wall 1 again"*
under its name. Tick it back and **Continue with N pieces** counts it.

The hard merge only folds pairs it is sure of, so a bed seen from its foot and its side
came back as two ticked beds. Now a row that shares a quarter of its floor with a kept row
of the same kind starts unticked and names the row it repeats — nothing is deleted.
Probed by seeding the review list directly (a real scan cannot be driven headless): the
caption wraps under the name at 360, the header reads *3 of 4 pieces kept*, no overflow
at seven widths. Twin beds in a corner, where the hard merge used to delete one before this
ran, now reach it, and it gets them wrong: the first bed starts unticked as the second bed
again. That is a known fault, the rest of `docs/what-is-still-open.md` § 46.1, and not what
right looks like, so seeing it is no reason to delete this item.

**What wrong looks like.**
- Two ticked beds where the room has one, or a real second chair starting unticked.
- The caption naming a wall the photo was not taken of, or a row that does not exist.
- The caption clipped, ellipsised or running under the + at 360 px, or pushing the row
  taller than its photo.
- *"Probably the the bed…"*, or a capital mid-sentence — the first letter is lower-cased
  unless the word reads as an acronym (*the TV*), and a detector's own wording is the
  untested half.

### The room's size on the shape picker, and the rough mark when it is skipped — `fdd1f20` on `main` (PR #160), SWEPT and PROBED

**Where to click.** New room → the shape picker. Under the outlines, **Room size · optional**
holds Width, Depth and Ceiling at the selected shape's typical size; change shape and they
follow. Type a width, then change shape: the numbers stay yours, and **Use a typical size**
gives them back. Type an 80 m width and leave the box: it takes a danger rim, a sentence
names the range, and **Start decorating** puts you back in that box rather than building the
room. Then start **without typing**:

- the studio's Room section opens with a quiet note — *Typical sizes, not yours yet.* — and
  **These are right**; its collapsed size reads
  *≈6.0×5.0m*;
- *"Photograph my real room first"* instead: each wall card's length reads *≈… m wall*, and
  the scan screen's subtitle says the sizes are rough until you set the room's size;
- **These are right**, or a size typed into those boxes, clears the note and the ≈ for good.
  Dragging a wall does not.

**What wrong looks like.**
- The note or its button crowding the size boxes in the laptop rail (1024–1279 px), the
  button landing somewhere other than under the sentence, or smaller than a fingertip on a
  phone.
- The note back after a reload once cleared, or on a room whose size was typed on the
  picker. Since 2026-09-29 that includes a reload in the half-second after typing, which
  § 47's leave note now keeps, so the note coming back then is a finding too.
- A ≈ on a measured room, or missing from a rough room's wall lengths.
- The preview's dimension labels unreadable on a phone or oversized on a desk.
- In the studio's glass rail the refused rim is the border alone, since the rail owns the
  box-shadow. Whether that reads as refused beside the other boxes is a person's call.

**What was measured, and on what.** SwiftShader, desktop Chromium, at `06476a8` on PR
#160's branch (squashed into `fdd1f20`): the size step and the note swept at seven widths
in metres and feet; a browser probe walked skip → note → *These are right* → reload,
skip → typed width → reload, typed on the picker, and skip → capture → scan, 18 of 18 on
three runs. A real phone, and a person reading the note, are the unlooked-at half.

### A piece's tag stays on the photo — `ac7104a` on `main` (PR #161), PROBED at 360, 768 and 1280

**Where to click.** The detect screen, with pieces near the photo's right edge and touching
its top — a picture high on the wall, a pendant, a chair at the side of the frame — and, if
a scan hands one back, a box that runs past the frame. Each box's tag (name, how sure, and
the X) used to start at the box's left side whatever the box was, so on a phone a tag at the
right ran up to 132 px past the photo and the whole review scrolled sideways, and one at the
top sat above the photo, where the scroll box cut it off. Now the tag still starts at its
box's left side and slides left only as far as the photo's edge; it sits just above its box,
just below it where there is no room above, and inside its top only for a box as tall as the
photo; and a name too long for the photo ellipsises before the X moves. A box that runs past
the frame is drawn only to the photo's edge, and so is its list row's highlight. On the
photo, Tab reaches one piece at a time: its keep, then its Remove. The X keeps its 24 px,
and still removes its piece while **Add a piece by hand** is on.
`scripts/photo-tag-probe.mjs` checks all of this at the three widths on seeded boxes,
except the Tab order, which `tests/photo-editor.test.tsx` holds.

**What wrong looks like.**
- A tag, or its X, past any edge of the photo, or the review scrolling sideways at 360 px.
- A tag that no longer reads as its box's: not touching the box's top or bottom border, or
  slid so far along that it sits over a different piece.
- A small box at the top (a pendant) that a tap at its centre does not keep or un-keep.
- A name ellipsised when the photo had room for it, or a long name's X squeezed narrower
  than the others.
- With **Add a piece by hand** on, a drag that starts on a tag not drawing a box, or a tap
  on a tag's X not removing its piece.
- Hovering a list row whose box runs past the frame, and its highlight running past too.
- **Known and not fixed here:** two tags on the same line can overlap, and the later one
  covers the earlier one's X. The probe counts these and does not fail on them. The row's
  own Remove in the list still works. Whether it happens often enough on real photos to need
  tags that step aside is a person's call.

**What was measured, and on what.** SwiftShader, desktop Chromium, seeded boxes (no detector
ran): the probe's 147 checks across 360, 768 and 1280 px all pass, against 67 of 147 on
`main` at `fdd1f20`. A copy with the tags not raised and the X off while drawing fails five,
and one whose X may shrink fails two, so those checks can fail. `tests/photo-tag.test.ts`
sweeps the placement rule over 43,200 box, photo and name cases, laid out from the CSS
strings the photo is handed, and the outline over 28,800. A real phone, with a real scan's
boxes, is the unlooked-at half.

### The scan photo stays on screen while the list scrolls — merged to `main` in `a5c63b2` (PR #162), PROBED from 360 to 1920 wide

**Where to click.** *Photograph my real room* → four photos → the scan screen, with enough
pieces that the list runs past the window. Scroll to the end of the list. Beside the list the
photo column stays put and fits the window; on a phone the photo is a strip across the top,
about half the screen, and the list scrolls under it. Swipe on the photo itself: the list
should move. Turn on **Add a piece by hand**: now a drag on the photo draws a box and the
page stays still, and the strip grows its picker and **Place with the keyboard** row without
the photo losing its bottom edge. With a keyboard, Shift+Tab back up the list: every focused
row should come to rest below the strip, and focusing a button in the strip should not move
the page at all.

**What wrong looks like.**
- At the end of the list, the photo gone, cut at its bottom edge, or the last row hidden
  under the strip.
- A swipe that starts on the photo doing nothing while **Add a piece by hand** is off, or
  scrolling the page while it is on.
- The strip jumping in height while the phone's address bar slides away mid-scroll. The
  strip is sized in `svh` so that it should not; headless Chromium has no address bar, so
  this is the one item here nobody has measured at all.
- The photo's own box scrolling a few pixels inside the strip — a tiny second scroll area
  that swallows swipes. That was the failure on a phone on its side (844×390) before the cap
  was measured.
- A focused row hidden under the strip, or **Add this box** focusing with the page jumping
  away from the photo.
- On a short phone (360×640) the photo is 240×180, and 192×144 while adding. Whether that is
  big enough to draw a box on with a finger is a person's call.

**What was measured, and on what.** SwiftShader, desktop Chromium, seeded photos on four
walls with 16 pieces, no detector: `scripts/scan-pin-probe.mjs` at 360×640, 390×844,
844×390, 768×1024, 700×800, 1280×800 and 1920×900, with the touch checks through raw touch
events at the four touch sizes. Before the change the photo was all but gone at the end of
the list at every size. A copy with the photo frame `touch-action: none` in every mode fails
the photo swipe, so that check can fail. A real phone is the unlooked-at half.

---

### A change made just before the phone backgrounds the browser — merged to `main` in `31bac6a` (PR #163), NOT MEASURED

**Where to click.** On a real phone, open a room in the studio. Duplicate a piece, or type a
new width in the Room section, and at once switch to another app (home gesture or app
switcher). Leave it a minute, then kill the browser from the app switcher, reopen it and
open the room again. Do the same with the screen locked instead of switching apps.

**What wrong looks like.**
- The duplicated piece missing, or the width back to what it was.
- Worse: the room half-saved — the new width with the old outline, so the room opens a
  different shape from the size it reports, or pieces standing where the old walls were.

**What was measured, and on what.** Desktop Chromium only, where a reload after duplicating
and a closed tab after typing a width now keep the change 5 of 5 and no room came back
half-saved (§ 47 in `docs/what-is-still-open.md`). The save runs on `visibilitychange`, the
event a phone sends when the browser goes to the background, and the unit test covers that
event — not the phone. Nothing here says how long a phone lets a hidden page run, so whether
the one transaction gets to commit before the browser is frozen or killed is exactly what is
not known. **Since 2026-09-29 that matters less for a typed room size:** the page also
writes that save to localStorage the moment it is hidden, synchronously, and the next open
finishes it (`lib/leave-note.ts`). So a width typed and the browser killed should come back
even if the transaction never committed. A duplicated piece has no such note: a save with no
room edit in it has no read to wait on and asks for its commit at once, which a desktop reload
lets finish 5 of 5 — but asking is not finishing, so a duplicate missing here is the finding
that would justify a note for it too (§ 47, "Still open"). Also try **Safari: type a width and reload at
once**. Desktop Chromium keeps it 5 of 5 now, and WebKit is unmeasured.

---

### A piece the photo cut off says so, and comes back a typical size — merged to `main` in `e998926` (PR #164), PROBED at 360–1280

**Where to click.** *Photograph my real room* → four photos in which something runs off the
side or the top of the frame — a wardrobe cut by the side of the photo, a curtain at the
corner, a tall bookcase whose top is out of shot — then the scan screen, then **Open the
studio**. A row whose box runs off a side, or off the top, now carries a grey line with a
ruler: *"Runs past the edge of the photo, so its width is an estimate"* (or *height*, or
*size* when both are cut). A floor piece cut only at its FOOT — a bed whose end is below the
photo — gets one too, since PR #168: its width and height were in view, but its distance was
assumed, so its size is an estimate (§ 49.10, and the item below). A wall piece cut at the
bottom does get one. In
the studio that piece should be about its usual size, grown from the side the photo saw
toward the side it cut, not the sliver that was in the frame. A row cut on every side the
check could read starts unticked (§ 49 in `docs/what-is-still-open.md`).

**What wrong looks like.**
- The note on a row whose box sits well inside the photo, or missing from one that plainly
  runs off it.
- At 360 px the note crowding the tick or the ✕, its second line running under the ruler
  instead of under the words, or the ruler not level with the first line.
- A grown piece pushing through a side wall, or its visible end moving away from where it
  stood in the photo — the grown side should be the cut one.
- A cut piece still coming back a sliver — "mostly too small", the report this answers.
- **Known and not fixed here:** with the room size skipped, a piece can now come back too
  BIG rather than too small, because a skipped room's walls are guessed and the grown size is
  a catalogue typical one (§ 49.3, § 49.4). Whether a real room reads better too big than
  too small is a person's call. Asking for the room size to fix it is not: the user decided
  2026-09-29 that nothing may depend on people knowing it (D9).

**What was measured, and on what.** SwiftShader, desktop Chromium, one seeded photo with
seven boxes, no detector: `scripts/cut-note-probe.mjs`, 48 of 48 checks at 360, 390, 768 and
1280 px — the note on the four cut rows and on none of the three whole ones, inside its row
(33 px tall) at every width, no sideways scroll. The note is new, so there is no before run,
and no mutant was put through the probe. The geometry is measured in
`tests/scan-tilted-room.test.ts` against a tilted-up, edge-cut fixture shaped like the
photos behind the report: with the lens and room known, pieces read short 7 → 0 of 14 and
the typical width error 19% → 10%; with the room skipped, short 10 → 6 and over 4 → 7. A
real phone, with a real scan, is the unlooked-at half.

---
### A scanned seat stays on the floor, and nothing climbs the tray on it — `0aa19b2` on `main` (PR #195, § H.6.4 follow-ups), NOT PROBED

Two things the scan's tidy-up used to do to a seat, both only in a scanned room. A tray
resting on an ottoman lifted the ottoman onto the tray, and the tray onto that, both in the
air. And an ottoman photographed so close to a coffee table that the room had no space to
push them apart was stood on the tabletop, where Room check could not see it. Tests hold both;
nobody has looked at a scanned room with either.

**Where to click.** Scan a small room with an ottoman beside a coffee table, and one with a
tray on an ottoman. Open the result in 3D and open Room check.

**What right looks like.**
- The ottoman stands on the floor. The tray, if it came through, sits on the ottoman.
- An ottoman left overlapping the coffee table is reported by Room check as two pieces in
  the same place.
- The same for any seat, whatever the scan called it: a stool or an armchair listed as
  *Other* stays on the floor beside a coffee table too.

**What wrong looks like.**
- An ottoman floating half a metre up, or on the coffee table's top.
- An ottoman overlapping the coffee table with Room check saying nothing.

**Expected, not wrong.** Nudging that ottoman by hand stands it on the coffee table, as
dragging any ottoman over one does. Whether a drag should keep it down is an open decision
in `docs/what-is-still-open.md`. A desk with a riser and a monitor scanned together may put
the riser on top of the monitor when the monitor was listed first — filed there too, with
two more of the same kind that are older than `0aa19b2`: a tray across a coffee table and
a box beside it can lift the box onto the tray, and a lamp over a box on a table can end up
inside the box.

## Look and light

### Shoes on the rack, a pipe clothes rail, and a dining table on four legs — merged to `main` in `28e1e03` (PR #212), NOT LOOKED AT

From the 2026-10-01 batch. The shoe rack carries a random mix of shoes, trainers and the odd
boot on its tilted tiers. A new **Clothes rail** follows the reference photo: black pipe with
flanged feet, a top bar of clothes on hangers and a lower bar. The dining table's far side
was drawn as a slab (the desk's side panel); it now stands on four legs, and the desk keeps
its panel and two legs. The legs drawn are the legs the chair rule above checks against.

**Where to click.** Library: add a shoe rack, a clothes rail and a dining table, and orbit
round each at eye level. Stretch the rack and the rail wider in the Inspector.

**What right looks like.** Shoes sitting on their tiers, none through the shelf above or
past the ends, and different each time you add one. Garments on hangers between the posts,
above the lower bar, and more of them on a wider rail. Four legs at the table's corners from
every side.

**What wrong looks like.** A shoe through the shelf above, a garment through the lower bar or
a post, or a dining table with a slab on one end.

### The day track as a slider over the canvas, a frosted base under the selection, no streaks while carrying — merged to `main` in `b955aac` (PR #178), SEEN HEADLESS ONLY

**Where to click.** Open any room in **3D Model** on a wide window, then on a phone. Under the
Move / Scale / Rotate row there is a dashed track with the sun and a clock pill: a shallow
rainbow on the wide window, a flat slider on the phone. Orbit and zoom the camera — the track
must not move. Drag the sun; press further along the track and it should jump there. Open the
Library and look again. Select the sofa, carry it across the floor slowly and quickly, then
carry it into the coffee table.

**What wrong looks like.**
- The track moving with the camera, sitting under the tools row or the Library, or reading as
  a curve on a phone. Measured headless: at 390 × 844 the track was flat, 366 px wide, directly
  under the tools row; a 150 px scrub left from 12:48 landed at 06:30 at the left end.
- **Grey footprints along a carried piece's path.** That was the soft floor shadow keeping every
  frame it had ever drawn (the effects pass switches the renderer's auto-clear off). Headless, a
  sofa carried 14 steps left none, on High; look on **Fast** too, which inherited the fault.
- The base under a selected piece reading as terracotta rather than frosted, or the refused
  state reading as a slightly darker selection rather than light red with *blocked* in the tag.
- A base floating above the floor, showing through a wall, or catching a press meant for the
  piece beside it.
- **On a phone, a blank band over the toolbar after tapping a piece**, with the Move / Scale /
  Rotate row gone off the top. That was the Room list scrolling the tapped piece's row into view
  inside the closed sheet, which slid the whole room up by the sheet's height (384 px at
  390 × 844, measured headless). The stage now cannot scroll; tap three pieces in a row and the
  room should not move.

### A day/night clock with a sun arc over the room, pieces that sway when carried, and sounds — merged to `main` in `4ccbdc1` ([PR #176](https://github.com/B-ismark/Danmu/pull/176)), SEEN HEADLESS ONLY, needs real ears and a real trackpad

**Where to click.** Open any room in **3D Model**. A dashed path circles over the room with the
sun and a clock pill on it; drag the sun along it from morning to evening, then press **Night**
in **Style → Light** and drag the moon. Press **Overcast**, then grab the sun again. Turn the
room with **Plan top faces**. Carry the sofa quickly across the floor and let go; carry it into
the coffee table. In **2D Plan**, drag a piece and drag a wall. Add a piece from the Library,
delete it, recolour one, turn one with R, press Undo and Redo. **View → Sounds** switches it off.

**What wrong looks like.**
- *The arc bullets below describe the ring over the room this branch replaced with the track
  above; they stand for the history, and the sway and sound bullets still apply.*
- The arc or the pill leaving the canvas, sitting under the floating toolbar, or reading as a
  construction line scored across the walls. Measured headless at 1440 × 900 on a 5 × 4 m room:
  noon pill at y 235, 18:30 at y 387, the moon at 22:12 on its own path, and 06:40 pinned to the
  right edge rather than gone — the three fixes this needed (halo not dome, ghosted behind the
  walls, held inside the frame) were each found by looking, so look at a rotated and a zoomed
  view too, and at a tall room.
- **Since the review round** the path is a ring on the eaves rather than a halo 0.9 m up, and it
  gives way: faint with a piece selected, gone while one is carried, full only when reached.
  Measured headless on the same room: noon pill at y 292, 06:40 at y 324 (it used to land by the
  sofa at y 660), class `sun-arc--quiet` with the sofa selected and `--away` while it was carried;
  a handle scrub 06:40 → 06:15 came back with ONE undo. Wrong would be the ring reading as a line
  scored across the back wall at noon, the pill fading while you are aiming at it, or a track
  pull in **Style → Light** taking more than one Undo to put back.
- The moon off its dashes, or the handle jumping to the other horizon as a drag reaches 19:30.
- A seam in the sky while scrubbing — a colour that jumps rather than eases.
- A carried piece leaning INTO its travel (towed by its top), tipping visibly past a few
  degrees, still rocking after half a second, or swaying on a wall piece or a lamp on a table.
  It now tips onto its low corner, so NO corner of a carried sofa should ever go under the floor
  (headless, the sofa's legs stayed clear mid-carry); a long piece should lean visibly less than
  a chair, and a rug not at all.
- **Sound, which nothing headless can hear:** anything that clicks harshly, anything louder
  than a notification, a buzz while dragging fast, the glide hanging on after the hand stops,
  two sounds for one press (a touch pick-up used to pop twice; the move/rotate gizmo used to
  knock down without a pop up), or ANY sound while a room opens or while an undo restores it. The
  sunrise and sunset cues should be felt rather than noticed.

### A piece cut at its foot is judged where it would stand against its wall — merged to `main` in `12b0209` (PR #170), NOT PROBED

**Where to click.** *Photograph my real room* → a photo whose bottom edge cuts off the foot of
a sofa, bed or wardrobe standing a pace out from its wall, and one of a standing fan or a stool
cut the same way. On the scan screen, a foot-cut row whose word is wrong — a nightstand called a
bed — should be flagged: *Measured about … m. Bed range is …*, with the ruler note
*Runs past the edge of the photo, so its size is an estimate*. A correctly named piece standing
well off its wall may be flagged as well. That is the price the user chose (D8, § 49.10 in
`docs/what-is-still-open.md`): it starts unticked, and one tap keeps it.

**What wrong looks like.**
- "about" missing on a foot-cut row, or showing on a row the photo saw whole. A stool or
  standing fan shot with the phone tipped DOWN is a foot cut too, and went without it for a
  commit.
- A one-axis line reading a bare *2.67 m* with no *wide* or *tall* after it.
- At 360 px, the warning line and its chips wrapping under the tick or the ✕.
- A flagged, correctly named piece that takes more than one tap to keep.
- **The part only a real room answers:** how often correct pieces get flagged. The fixture says
  6 of 39 box pieces, every one 800 mm off its wall, and 12 of 28 round ones, some of them
  standing against it. Whether that is tolerable in a person's own room is not something a
  test can say.

### A cloud scan keeps only the walls you photographed — `bd09f2f` on `main` (PR #171, § 49.17), NOT PROBED

**Where to click.** With a Google key in **Settings**, *Photograph my real room* → ONE wall
only → the scan screen. Every row should belong to that photo: its tag on the picture, and its
size read off it. Then again with TWO walls. Then go back and forward so the room reloads, and
read the row names again.

**What wrong looks like.**
- *Danmu couldn’t make sense of the reply* on photos that plainly have furniture in them. With
  one wall that should not happen for this reason at all: every row is filed under the one
  photo, whatever wall it names. With two or more, the reply is refused when no row names a wall
  you photographed; `n`, `N`, `north` and `N WALL` all read as the north wall, and a real reply
  in some fourth form would land here.
- A row with no tag on the photo — a piece filed under a wall nobody photographed, which is
  what this stops.
- A name ending in `__slot:` after the reload.
- A row called by its kind in lower case, `sofa`, is a reply that gave that piece no name. It
  should be rare; many of them means the reply's shape has changed.
- **The part only a real reply answers:** how often Gemini files a row under the wrong wall at
  all. The tests hold what happens when it does, not how often.

### An old scanned room reads its walls back — `a080c3e` on `main` (PR #172, § 49.18), NOT PROBED

**Where to click.** A room scanned with a Google key BEFORE PR #171 merged, if one exists on a
real device. Open it on the **3D Model** tab and read the piece names in the **Catalog** rail and
the Inspector. Then **Rescan** into the scan screen and read the tags on each photo.

**What wrong looks like.**
- A name ending in `__slot:` anywhere: the rail, the Inspector, a tag on a photo.
- A piece that has MOVED or TURNED since the last time the room was open, above all one that
  was dragged but never rotated. Opening a room cleans names and nothing else.
- After a Rescan and Continue, a piece that did not move to the wall its photo shows. That is
  the one step allowed to move it.
- On the scan screen, a row listed under a different wall from the photo its tag sits on.
- **The part only a real room answers:** whether any such room exists at all. It depends on
  what Gemini wrote for a wall before § 49.17, which nobody recorded.

### A scan that left pieces out says how many — `408cdbe` on `main` (PR #173, § 49.19), PROBED WITH A STUBBED REPLY

**Where to click.** A room with two or more wall photos and a Google key → the scan screen.
Probed in Chromium at 360 × 640 and 1280 × 800 with the reply stubbed: five rows, two kept,
three set aside (two filed under walls nobody photographed, one boxed in pixels),
and the card read *3 pieces left out*; a reply that lost nothing showed no card. What a stub
cannot answer is a real reply.

**What wrong looks like.**
- A count that seems too high for the photos. It counts only rows Google named and Danmu could
  not place, so a piece Google never saw is not in it, and that is right.
- The card on a scan where Google's list and Danmu's list are the same length.
- The card on a scan that used only the on-device detector. It counts Google's rows only.
- The card after a reload of a room already scanned: the count is not saved, so it should not
  come back.
- **The part only a real reply answers:** how often a real scan sets pieces aside at all.

### A plant or floor lamp cut by the side of the photo stands where the photo shows it — `0fb6a27` on `main` (PR #180, § 49.9), NOT PROBED

**Where to click.** *Photograph my real room* → a photo in which a plant, a floor lamp, a
standing fan or a stool runs off the LEFT or RIGHT side of the frame with its foot still in the
picture → the scan screen → **Open the studio**, on the **3D Model** tab and the **2D Plan**.
Compare where it stands with the photo: how far out from its wall, and where along it.

**What wrong looks like.**
- The piece standing well out into the room when the photo shows it by its wall.
- The side the photo saw not where the photo shows it. The piece grows toward the cut side,
  and the side that was in view stays put.
- A round piece whose base is ALSO below the photo moving at all. Those stay on the old
  reading on purpose (§ 49.9 in `docs/what-is-still-open.md`).
- A piece in a corner poking through the side wall, in the plan most plainly. It grows to a
  typical size toward the cut side and must stop at the wall; the first version of PR #180
  did not, and a small plant by the wall came out 400 mm wide and 297 mm into the next room.
- **The part only a real room answers:** a plant much smaller or larger than a typical one, shot
  level, now stands up to a hand's width off along the wall (on the fixture, 49 → 80 mm on
  pieces off typical), because it is placed by the typical size it is drawn at. Before, it
  stood where a narrower piece would and was drawn wider there. Which reads better in a real
  room is a person's call.

**What was measured, and on what.** `tests/round-side-cut.test.ts`, 389 rows cut at the side
only, in two rooms at three tilts: along the wall 178 → 103 mm on average, exact at a level
lens and a typical size, none past the side wall, and the 568 rows cut at the foot as well
unchanged. No browser run, and no test renders the room.

### Chairs across a table both come back, and a repeat starts unticked rather than vanishing — `0fb6a27` on `main` (PR #180, § 46.3), NOT PROBED

**Where to click.** *Photograph my real room* → photograph a dining table with chairs on both
sides of it, from the wall behind one row of chairs and from a side wall, on a phone that writes
no focal length (most do not) → the scan screen. Count the chair rows against the chairs in the
room, then tick back any that start unticked and count again.

**What wrong looks like.**
- Fewer chair rows, ticked and unticked together, than chairs in the room. A chair with no row
  at all is the defect this fixes. Before it, a narrow reading of an ultrawide put two chairs one
  behind the other on one spot by the far wall, and one of them was deleted.
- A chair that starts unticked with a reason naming a chair it is not. The soft pass now sees
  pairs the hard merge used to take, so it has more rows to judge.
- More ticked duplicates than before. The fixture measured 51 → 57 across its five readings, so
  a few more is the price, and many more is not.

**What was measured, and on what.** `tests/repeat-sightings.test.ts`, 150 generated rooms read
five ways: pieces with no row at all fell from 91 to 2, the two being one curtain on two lenses.
`tests/distance-doubt.test.ts` holds the two chair pairs. No browser run, and no test drives the
scan screen with a real photo.

### A piece the photo cut off can still be too big for its word, and says "at least" — `0fb6a27` on `main` (PR #180, § 49.5), NOT PROBED

**Where to click.** *Photograph my real room* → a photo in which a sofa or a bed runs off the
LEFT or RIGHT side of the frame with its foot in the picture, and one taken with the phone
tipped up so the bottom of the frame cuts a door or a tall mirror → the scan screen. A rename
alone changes only the row's word, so rename the sofa's row to **Chair** and press the
**Use Chair?** chip it offers, then the door's to **TV** and **Use TV?** (each carries a "?":
the camera already disagrees). Each row should then be flagged, the sofa with a line like
*Measured at least 1.95 m wide and 0.91 m tall. Chair range is 0.38–0.60 m wide.*, with the
ruler note *Runs past the edge of the photo, so its width is an estimate* under it, and a sofa
among its two chips. On the test fixture those are a **chest freezer** and then the sofa,
because a chest freezer is that size too.

**What wrong looks like.**
- "at least" on the axis the photo saw whole, or missing on the one it cut.
- "at least" and "about" on one line. They come from rows that exclude each other.
- A "×" after "at least" when only one axis was cut: *at least 1.96 × 0.91 m* claims the height
  is a lower bound too.
- **The part only a person answers:** whether *at least 1.96 m* beside *its width is an
  estimate* reads as one fact or as two that disagree. The number is what the photo saw, and
  the note is about the piece as built, which may be wider still.
- A number after "at least" that is larger than the photo could have shown. It rounds down:
  1955 mm is *1.95 m*.
- A correctly named piece flagged as too big, where the camera was read right. The measured
  price is only where the lens or the tilt was read wrong: a fridge or a dining chair, 16 across
  seven readings of 150 rooms; and on an **upload from a tipped phone**, which the app reads as
  level, a wall piece at the very edge of its band, 2–20 of about 180 per reading. Each starts
  **unticked** — a flagged row the detector found is never ticked for you; one you drew stays
  ticked — so it is a press to keep, not a loss.
- **The part only a person answers, again:** whether a chest freezer offered first for a sofa
  reads as a helpful second guess or as the app not knowing what a sofa is.

**What was measured, and on what.** `tests/label-repair-population.test.ts`, 150 generated
rooms read seven ways, and every wall kind at the edges of its own band photographed tipped.
No browser run, and no test renders the sentence the page builds from `measuredPhrase`.

---

### High quality is graded again — on a real GPU, in every mood — `c2137c4` on `main` (PR #157)

**Where to click.** Open any room on the **3D Model** tab with **View → Quality → High**
(the default), then flip to **Fast** and back, in each lighting mood. Then **Export → This
3D view** on High and open the PNG beside the screen.

**What wrong looks like.** High reading flatter or greyer than Fast in a way that is not
shadow (the composer used to switch the ACES curve off, so every mood's `exposure` did
nothing on the default quality); the paper backdrop around the room a different colour
inside the canvas than outside it (the grade is depth-gated in `components/three/grade.ts`
to leave the cleared backdrop alone — a banded or haloed silhouette where the room meets
the backdrop would mean that gate is misreading depth); or the saved PNG missing the soft
corner shading the screen shows (snapshots now render through the composer).

**What was measured, and on what.** SwiftShader only, one mood, 1280 × 800: backdrop
251,248,241 on High before, on High after and on Fast — identical — where the ungated
first attempt read 225,224,222. The snapshot PNG matched the High view to within 2 levels
at three sampled points. A real GPU and the other moods are the unlooked-at half.

**Not this item, noticed on the way.** High is much darker than Fast in the same mood,
and it is not the grade: the back wall reads 109 on High and 174 on Fast with the grade on
both. The closed shell (`RoomShell`) is doing its job — the key light casts on High and the
ceiling stops it — so the interior is lit by the hemisphere and environment alone. That is
the lighting pass's to answer (warm interior light sources), not a grading defect.

### High has a bounce light now, and the furniture has real surfaces — `c2137c4` on `main` (PR #157)

**Where to click.** The starter living room on **High**, every mood; then a bedroom and a
room with its windows deleted. Zoom in on a wardrobe, a bed and a lamp.

**What wrong looks like.** High washed out or flat in Day or Sunset (the bounce is an
ambient term — too much and the sun's patch stops reading); a windowless room as bright
as one with windows (it should be dimmer: `lib/bounce.ts` gives it nothing); Evening no
longer dim; wood grain reading as stripes or noise on a painted wardrobe (casework takes
`SURFACE.wood`'s normal map whatever its colour); a lamp shade glowing so hard it clips
white, or not glowing at all with the lamp on.

**What was measured, and on what.** SwiftShader, 1280 × 800, starter living room, Day:
mean interior grey 110 on High before, 145 after, 152 on Fast. Evening before/after
compared by eye — the shade glows, the room stays dim. Grain and sheen were **not visible
at all** on SwiftShader at this camera distance, before or after, so whether they read on
a real GPU is entirely unlooked-at.

**Noticed, not fixed.** The sofa's fabric weave aliases into a moiré at room distance on
both builds — the normal map wants mipmapping or a distance fade.

### A rug sits where a designer would put it — `c2137c4` on `main` (PR #157)

**Where to click.** Any starter living room, **3D Model** tab. Then Library → Rug into a room
with a bed, and another under a dining table, and press **Fix** (or Shuffle) with each.

**What wrong looks like.** Living: the rug's edge should run under the sofa's FRONT legs
only (about 20 cm in) and the coffee table should stand wholly on it; the back legs on the
rug is the old placement. Bedroom: the rug should start a third of the way down the bed,
with both nightstands on bare floor and rug showing past the sides and the foot. Dining:
centred under the table, long side down its length. In every room: never under a
wardrobe, bookcase, nightstand, fridge, or a desk that has an office chair, and never in a
door's swing. A rug at an angle to its group is also wrong.

**What was measured, and on what.** `tests/rug-zones.test.ts` (14 tests; 8 of 9 mutants
caught, the ninth — a proposal straight to the target — measured as changing nothing and
deleted). Starter rooms: only the rug moved in the five offered presets (and the open
plan's dining chairs squared to the other axis). Under **Fix** a stray rug stops ~0.35 m
short of its spot, by design — every relation is a soft band against a linear inertia.
Not yet seen in a browser with a bed or a dining table.

### Fix and Shuffle think in the background now — `c2137c4` on `main` (PR #157)

**Where to click.** Any furnished room → rail → **Shuffle**, then orbit the room while the
button says "Shuffling…". Then press Shuffle and immediately **Ctrl+Z**.

**What wrong looks like.** The room freezing while the button spins (the worker did not
load — the console says "Arranging worker unavailable; running inline."); an arrangement
landing on top of the undo you just made (the stamp check failed). The second press should
end in "The room changed during the search" with the undo standing.

**What was measured, and on what.** SwiftShader, production build, 4 cores, the seeded
9-piece showroom, three presses each. Inline (Worker hidden from the page): Shuffle froze
the page for **567–667 ms** in one frame and finished in 640–790 ms. Worker: worst frame gap
**17–33 ms** throughout, but finished in **~1.0 s** — the worker's own search takes ~900 ms
against ~600 ms inline. Not the copy across threads (a structured clone costs ~10% in node,
within noise), not the canvas (hiding it changed nothing), and not a slow worker thread in
general (a synthetic loop runs at the same speed in both). Unexplained; a real phone and a
real laptop are what settle whether the live room costs a longer wait there too. The stale
path was seen working in that build.

**One more path, found in review and not yet seen in a browser.** Resize a piece until the
"That size change left N problems" toast appears, drag a different piece, *then* press
**Re-fit** in that toast. The drag must survive: the re-fit works from the room with the
drag in it. Before the fix it solved the room from when the toast appeared and wrote over
the drag without a word, because the button was holding an old copy of the room while the
stale check compared press against answer. `tests/refit-press-time.test.tsx` holds the
wiring; nobody has watched it happen.

### Re-scan looks again, and its answer reaches the studio — `c2137c4` on `main` (PR #157)

**Where to click.** A photographed room with furniture found → studio → move a piece and
add one from the Library → Room rail → **Re-scan**. The screen should say *Showing your previous
scan* with **Look again**. Press it, then **Continue with N pieces**.

**What wrong looks like.** The studio still showing the old arrangement after a scan that
found something different (the saved scene won again); no *Before re-scan* entry under
Room check › Layouts, or one that does not put back the moved and added pieces when
applied; the toast naming a layout that is not there.

**What has been seen.** The cached-list notice and **Look again** at 360 and 1280 wide in a
production build (SwiftShader), and Undo restoring the list. The run itself could not be
watched here — no on-device model and no key, so **Look again** ends at *Let's do this by
hand*. The run itself was then driven end to end with Google's reply stubbed in the
browser (a key set, the request answered by the probe): a fresh **Look again** →
**Continue** dropped the scene, wrote a *Before re-scan* layout and raised the toast;
**Look again** → **Undo** → **Continue** left the scene alone and wrote no layout; a
rate-limited **Look again** → **Try again** ran the scan again rather than landing on the
old list. What remains for a person is the studio side: that applying *Before re-scan*
really puts the moved and added pieces back.

### Scanned furniture comes out as the right piece — `c2137c4` on `main` (PR #157)

**Where to click.** Photograph a room with an armchair, a dining table and a sofa, with
the on-device model deployed and a detection key set, and let the scan run.

**What wrong looks like.** The armchair listed or drawn as a two-seat sofa; the dining
table drawn with a desk's side panel and cable rail; the same sofa listed twice, once as
"Couch" and once as "Sofa"; the privacy line saying the photos stayed on the device while
the second look was sending them; after a failed second look, the on-device pieces gone.

**What has been seen.** The dining table beside a desk in the 3D view (SwiftShader): four
legs and aprons against the desk's panel. Nothing else — neither the model nor a key is
available here, so the second look and the merge are held by `tests/detection-dedupe.test.ts`
and the armchair by `tests/shape-contract.test.ts`.

## The browser route, so the next person does not rebuild it

Looking is a half-hour of setup nobody has to hand, which is the actual reason items sit
here unchecked. This is that half-hour, written down once.

Two lessons from the run that established it, kept because they are about method rather
than about that fix. **Pick a control that CANNOT change**: the L-shape preset is the one
non-convex room whose corner average sees all six of its walls, so it rendered identically
before and after — a sweep of a rectangle and an L would have shown nothing at all. And
**never compare screenshots by hash**: SwiftShader is not bit-deterministic across
processes, so pixel hashes differed on every pair including the unchanged control. Look at
them.

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
· **A plan piece is never `visible` to Playwright** — its stroke is drawn only while it is
  selected — so wait on `{ state: 'attached' }`, or the locator resolves and times out.
  (From PR #123's wardrobe-door A/B; moved here when the purifier item it sat in closed.)
· **Projecting a piece's world centre through the camera lands on the canvas and selects
  nothing.** Click, then read `aria-selected` back — that is the only aiming that works.
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

## The service worker, and where you have to be to check it

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

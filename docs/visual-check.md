# Needs eyes

Everything in this file typechecks, lints and passes tests. That is exactly why it is
here: these are the things a green suite cannot tell you about.

**This is a live list, not a record.** An item that has been checked, or whose branch has
merged, is **deleted** — not struck through, not moved to a "done" section, not archived.
`docs/history/` is for point-in-time studies; this file has no history and is not allowed
to grow one. It reached 747 lines and thirty headings before the user said it was
"outdated and too crowded", and every one of those lines had been true once. That is the
failure mode to design against: nothing in here was ever wrong when it was written.

## How to read an item

Each one names **where to click**, **what wrong looks like**, and **which branch or PR**
it rides. An item that cannot say all three is not ready to be checked and does not
belong here yet.

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

When a branch merges its numbers stop meaning anything, and they go with the item.

## Owners

Four sessions, named for what they own rather than for their ids. Each keeps its own
section and touches no other, which is what lets four of us edit one file without a merge
conflict.

| section | owner | surface |
|---|---|---|
| Sizes and fit | `sizes` | dimension ranges, clamps, clearance, the room report |
| Drag and selection | `drag` | drag, convoy, rotate, scale, snap, both tabs' pointers |
| Layout and Shuffle | `layout` | the solver, Shuffle, bands, arrangement, layout rules |
| Shell and flow | `shell` | rails, panels, capture / detect, copy and CTAs |

---

## Sizes and fit

*Owner: `sizes`.*

### A door under a low ceiling — PR #21

Make a room **1.8 m** tall (Room panel, height) with a **door** in it, and open **Room
check**.

It should say the door is 198 cm against a 180 cm ceiling and that it **does not go any
shorter than 198 cm** — the ceiling has to reach 198, or the door has to go. It must
**not** invite you to shrink it, because you cannot: 1980 mm is `door`'s own floor and the
Inspector refuses everything below it.

Same room, a **wardrobe** at 2.2 m, gets the opposite wording. That one can be shrunk, and
the message names the number that would fit (160 cm).

**Wrong looks like:** the door being told to shrink; either piece quoting a number the
Inspector's own limit disagrees with; or both pieces getting the same sentence.

Measured on `870d84d`: typecheck 0, lint 0, 1390/1390, 72/72.

### A curtain the ceiling came down on — merged, still wants one look

Lower a room's ceiling below a **curtain**'s height. The curtain keeps its real size and
stands through the slab, and **Room check says so**. Not resizing is the rule; saying
nothing was the defect.

**Wrong looks like:** silence in Room check, or the curtain quietly shrinking.

### The mount-height field under a piece that cannot fit — merged

Select a wall-mounted piece taller than the room. Its **mount height** field should refuse
the edit and say why, rather than accepting a number and pinning it to 0.

**Wrong looks like:** typing 120 and watching it become 0 with no message.

---

## Drag and selection

*Owner: `drag`.*

Everything below rides **PR #23** (`fix/convoy-self-support`), rebased onto `main`. Measured on
`47c946a`: typecheck 0, lint 0, **1477/1477**, 73/73, build 0. Six of those assertions are
new and each was watched failing first — three mutations on the turn (re-grid it, hand back
the raw spot on an invalid resolve, make the containment extent rotation-blind) and three
on drill-in (never fire, count an empty selection as inside, accept overlap where it asks
for containment).

### A merged set that would not move at all

In a **T-shaped** room, merge a dining table with its chairs and drag the table. All of
them travel together.

Then the half that must still work: drag a set until one member would leave the floor. It
refuses **as a unit** and outlines the member that ran out of room — usually not the piece
under your hand.

**Wrong looks like:** the set sitting completely still under the cursor, in every
direction, in a room you have not touched. Or the opposite — one chair sliding through a
wall while the rest follow the table.

### Turning a piece into a wall — the handle, and now the arrow keys

Plan tab. Turn a **sofa** hard against a wall by its round handle, then open the model tab
and look at that wall from outside.

Twice more with the keyboard: focus the handle and hold an **arrow key**, then **Shift +
arrow** on the piece itself. Those two had no clamp at all and must now behave exactly like
the handle drag, including taking a lamp standing on the piece along.

**Wrong looks like:** corners through the plaster in the model tab; the lamp left behind
facing its old way; or a piece in a tight corner becoming un-turnable, which is the thing
this must **not** do.

### Rotate and scale on a merged set, in 3D

Model tab. Merge a **bed with two nightstands**, select it, press **E** and turn the bed
hard into its own nightstands. Then **R** and scale it up past what the room holds.

On release the bed is inside the room. The turn itself is allowed — a piece in a tight spot
stays turnable — and an overlap is allowed to be reported; the geometry leaving the walls
is not.

**Wrong looks like:** the bed keeping the angle you dragged with a corner out through the
wall. Worth knowing while you look: 3D says nothing in colour after a refused turn — its
tell is **Room check** — where the plan outlines the piece. If that asymmetry bothers you it
is a separate decision, not a defect in this fix.

### Clicking a merged set, then clicking into it

Both tabs, identical, or it is wrong.

Click a merged set → the **whole set**. Click one piece of it again → **that piece alone**.
Click a *different* piece of the same set → that one, still one at a time. **Escape**, or a
click on empty floor, then click the set → the **whole set** back.

**Wrong looks like:** the very first click landing on one piece, so the set can never be
selected by clicking it at all; the second click doing nothing; a sibling click bouncing
you back out to the whole set; or the two tabs disagreeing on any of the four.

### A rug walking out of the room

Plan tab, **T** or **L** room. Drag a rug at the quadrant the shape cuts away.

Its **centre** stays on real floor. Its **edges** may still hang off — under furniture, over
the skirting, across a missing corner — and that must keep working.

**Wrong looks like:** a rug sitting entirely in the notch, in normal colours, as though
placed.

### A resized piece losing its size on the next move

Widen a **wardrobe** in the Inspector, then merely **drag** it. The width survives the drop.

Again with a **coffee table**, which takes the other path internally and must be equally
unchanged. Then resize either with the 3D scale gizmo and confirm it does not jump on
release.

**Wrong looks like:** the width snapping back to what the room was built with — sofa,
curtain, wardrobe, closet, bookshelf and shoe-rack only, which is why it reads as
intermittent.

### A piece too big for the room, turning

Room **3 m** deep, a **4 m** bench in it, turn the bench 90°.

It cannot fit at that angle. Pinned-and-reported and held-and-reported are both honest;
silence is not. Today it pins. This is old behaviour both tabs share that the plan's turn
now reaches for the first time — listed to be looked at, not because it changed.

**Wrong looks like:** the bench parking quietly, in normal colours, half outside the room.

---

## Layout and Shuffle

*Owner: `layout`. Yours to fill — nobody else edits below this line until the next heading.*

---

## Shell and flow

*Owner: `shell`. Yours to fill — nobody else edits below this line until the next heading.*

---

## Nothing here has been in a browser

Every PR gets a Vercel preview, and a preview is the only place the production-only
service worker registers — `next dev` cannot check that one at all.

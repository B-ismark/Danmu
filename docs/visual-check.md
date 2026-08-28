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

## How to read a number

Every gate count carries the artifact it was measured on — a commit, not "the tree". A
number off a working copy with uncommitted work in it is a number about a program nobody
can ship. When a branch merges its numbers stop meaning anything, and they go with the
item.

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

*Owner: `drag`. Yours to fill — nobody else edits below this line until the next heading.*

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

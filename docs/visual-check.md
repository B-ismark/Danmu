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

*Owner: `sizes`. Empty because its one item — a bed added at a wall — **has been looked
at, and it failed.** Two separate defects came out of it and both are measured in
`what-is-still-open.md` § H.2 and § H.3; the arithmetic is settled, so neither is waiting
on eyes any more.*

## Drag and selection

*Owner: `drag`.*

Everything below is **merged** — `main` at `b73e149`, formerly PR #23. The gate counts went
with the artifact they were measured on. What has not gone is the reason each item is here:
six of these assertions were watched failing first — three mutations on the turn (re-grid
it, hand back the raw spot on an invalid resolve, make the containment extent
rotation-blind) and three on drill-in (never fire, count an empty selection as inside,
accept overlap where it asks for containment) — and not one of them can see any of what
follows.

**Five of this section's seven items have now been looked at.** Two held (a merged set does
travel as one; a resized piece keeps its size through the next drag). Three failed, and
their causes are measured rather than left here for another look: the rug and the sofa
dropped into an L / T notch (§ H.4), the piece too big to turn (§ H.5), and the merged-set
click that drills in from a nightstand but never from the bed (§ H.8). The two below are
still unlooked-at, and the second one is only unlooked-at because **the keys it named were
wrong** — see its note.

### Turning a piece into a wall — the handle, and now the arrow keys

*The user tried this and could not tell what it was asking, which is this item's fault. The
overhang it asks you to look for is **allowed on purpose** — a piece in a tight spot has to
stay turnable — so "is anything through the wall" is the wrong question and was never going
to give a clean answer. What is actually being checked is narrower, and it is three things
that must **match each other**.*

Plan tab, a room with a **sofa longer than one of its walls is short** (make the room 3 m
deep in Room tools if the starter room is roomier than that).

Turn the sofa with its round **handle**. Then undo, focus the handle and hold an **arrow
key**. Then undo, and press **Shift + arrow** on the piece itself. Three gestures, one
meaning.

**What right looks like:** all three end with the sofa at the same angle in the same place,
the sofa **outlined in red** while it overhangs, and a lamp standing on it turning with it.

**Wrong looks like:** the three disagreeing with each other; a piece in a tight corner
becoming **un-turnable** (the thing this must not do); the lamp left behind; or an overhang
with **no red outline at all**, which is the 3D tab's version of this and is already a
confirmed defect — § H.5, so you do not need to check that half.

### Room cards that are the shape of the room

Workspace. You need one saved room per shape — from **Start decorating** pick **L**, then
**T**, then **U**, then a plain rectangle, and give each a name you can tell apart.

**What right looks like:** each card's little floor plan is **that room's outline** — the L
has its notch, the U has its two arms — fitted in the picture with the furniture inside the
walls rather than floating in the cut-away part.

**Wrong looks like:** any card still drawing a rectangle (the defect, unfixed); an outline
that runs off the edge of the picture or sits crushed in a corner; or furniture drawn
outside the outline. Two of those would be the fit reading the wrong origin, which is what
happens on a room whose walls have been dragged — so **drag one wall outward in a room, go
back to the workspace, and look at that card again**, which is the case tests can only check
arithmetically.

### The placement row, now two buttons instead of three

*The user asked for this after looking at it, so it is the one item here they have
already half-seen: what they saw was the old row.*

Right rail, select a piece **standing on the floor** — a sofa, a bed, a plant. The
placement row is **Wall · Floor**, two buttons at half the rail each, and there is **no
"Where it sits" heading** above it.

Then put something on a surface: drag a **table lamp** onto a coffee table and select
it. Now there are **three** — Wall · Surface · Floor — and hovering Surface says *"Drop
onto Coffee table"*, naming the actual piece.

Then narrow the window until the right rail is at its tightest (~1024–1280 px). Two
buttons have to fit at that width; three are allowed to reflow to `1fr 1fr` and wrap,
which is what `rail-triple` is for.

**Wrong looks like:** three buttons on a piece standing on bare floor (the fix has not
taken); a clipped or overflowing word at the narrow width, which is the complaint that
started this and the one thing the tests cannot see; the row looking *broken* rather than
deliberate now the heading is gone; or "Drop onto undefined".

**Also worth one press each,** because these two are the reason the third button was kept
rather than deleted: with the lamp on the table, **Floor** should drop it to the floor and
let go of the table, and **Surface** should put it back on top. Neither is reachable by
dragging — dragging the lamp off the table moves it sideways.

### A refused turn now says so in 3D — 500 ms of red

*The one thing in this pass that no test can reach. `lib/refusal.ts` decides what counts as a
refusal and `tests/refusal.test.ts` holds it to that with nine mutations; what nobody has
seen is whether the answer reaches a tinted mesh.*

3D tab, a room **3 m deep** (Room tools) and a sofa longer than that — 4 m if the Inspector
will give you one. Select it, press **R**, and turn it hard across the room.

**What right looks like:** the turn is taken — a piece in a tight corner must stay turnable —
and the sofa is **outlined red for about half a second** after you let go, then goes back to
normal. Same gesture in the 2D plan, same red, same duration: that is the point of the fix,
so check both.

**Wrong looks like:** no red at all in 3D (the defect, unfixed); red that never goes away
(the timer is not clearing); red on the wrong piece; or the two tabs holding it for visibly
different lengths of time. Also worth a look: drag a piece into a wall until it refuses, let
go, and confirm the red still clears — the same code path runs for a translate, where it
should almost never fire.

### Rotate and scale on a merged set, in 3D

*Correction, and the reason this is still open: this item used to say "press **E**" and
"then **R**". **E does not rotate anything** — Q and E orbit the camera
(`components/three/CameraRig.tsx`, `NAV_KEYS`). The gizmo modes are **W** translate, **R**
rotate, **S** scale (`components/studio/KeyboardShortcuts.tsx`), and they are armed on the
3D tab only. So the gesture below has not been tried yet, by anyone.*

Model tab. Merge a **bed with two nightstands**, select it, press **R** and turn the bed
hard into its own nightstands. Then **S** and scale it up past what the room holds.

On release the bed is inside the room. The turn itself is allowed — a piece in a tight spot
stays turnable — and an overlap is allowed to be reported; the geometry leaving the walls
is not.

**Wrong looks like:** the bed keeping the angle you dragged with a corner out through the
wall.

Worth knowing while you look: this item used to note that 3D says nothing in colour after a
refused turn, where the plan outlines the piece, and called that *"a separate decision, not
a defect in this fix."* **The user has now made that decision — it is a defect**, reported
as a couch cutting through the walls instead of being constrained. It is § H.5 with the
overhang measured, so the silence is no longer part of what you are looking for here.

## Layout and Shuffle

*Owner: `layout`. The first three ride **`fa12f1a` / PR #29**, now on `main`. The fourth
fixes nothing and is here anyway — it is the user's own report with a measured cause and a
reverted remedy, so what it needs is a look rather than a check.*

### Does Shuffle keep the bedside table by the bed? — a known defect, `main`

**Nothing was fixed here, so this is a look rather than a check**, and it is the user's own
report: *"the bedside table is never where it should be."* The cause is measured and pinned
by a test that prints its table on every run — at **300 mm** out of place, *all ten* of the
library's furniture relations cost less than the threshold Shuffle needs before it will
offer a rearrangement. It finds the fix and stays quiet.

Put a **nightstand** about **300–400 mm** from a **bed** — close, but visibly not touching —
and press **Shuffle**.

**Wrong looks like:** exactly what the user reported. Shuffle declining to close the gap,
or saying it has nothing to suggest. That is the defect and seeing it confirms the
diagnosis rather than contradicting it. The obvious repair was written, measured and
**reverted**: it fixed the price and gave the solver four runs in 48 with a piece through a
wall, where the shipping code never exceeds a fifth of one such violation. The untried
direction is in `isWorthOffering` — what gets *offered* rather than what gets *searched*.

---

## Shell and flow

*Owner: `shell`. **Empty, and that is the rule working.** Its four items — every bed
rotated 90°, two grey bands at the foot of the right rail, Delete scrolling out of a
tall Inspector, and a wardrobe widening its door instead of gaining a column — were all
on `main` at `aaf2888a` (PR #26) and have now been **looked at by the user, in a
browser, and confirmed good**. So they are deleted, which is what this file does with an
item that has been seen.*


### Three signposts and no sign: the Library — narrowed to the click-through

The user's own find, and the one no gate could ever have made: *"Library isn't on there."*

**The words are gated now** and this item is down to one question a test cannot answer.
`tests/studio-copy.test.tsx` holds the panel's heading at **Library**, holds all three
strings that name it — the help card, the sun note in the left rail's Look section, and
the right-click menu's *Add from library…* — and holds the help card's group heading to
naming the two lists rather than a side. Every one of those was watched failing by
renaming the thing it guards.

**The click-through is gated too, on the 2D plan.**
`tests/library-click-through.test.tsx` mounts the **real** `app/room/[roomId]/plan/page.tsx`
— not a harness reproducing its `{catalogOpen && <CatalogPanel/>}` gate, which would go
green on a page that forgot to render the panel — and presses the rail's **Add**, the
panel's own **X**, and the context menu's *Add from library…* row. Eight mutations were
watched failing, including deleting the page's gate in both directions.

Two things that pass fell out of it and change what is left to look at:

- **Only two of the three signposts are presses.** The sun note in the Look section is a
  `<p>` with no control in it — asserted, so nobody goes looking for a button that never
  existed. The item's old wording said "press each of the three".
- **The 3D tab is not covered and cannot be.** `app/room/[roomId]/model/page.tsx` carries
  the same gate one line apart, and mounting it pulls R3F, three, drei and
  postprocessing. Its trigger is also a *different* one — the canvas `CatalogToggle`
  beside the rail's `Add`.

**What is left for a person:** on the **3D tab**, press the rail's `Add` and the canvas
`Add`, and on **both** tabs check the panel that arrives is actually visible — docked to
the right edge, above the canvas rather than behind it, not clipped by the rail. Being in
the document is what a test can see; being on the screen is not.

**Wrong looks like:** a signpost that reads correctly and leads nowhere — or a panel that
opens somewhere you cannot see it, which the plan-page test would call a pass.

---

## Nothing here has been in a browser

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

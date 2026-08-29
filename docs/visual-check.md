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

*Owner: `sizes`.*

### A door under a low ceiling — on `main`, `85450f7`

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

### A bed added at a wall — on `main`, `4cec92b`

The user's own report, and it takes **two** fixes to be right, so check it after both are
on `main`: this one, and `shell`'s bed geometry.

Drop a **bed** near the **west** wall from the Library, then another near the **east**, then
one near the **south**. Each should arrive with its back to the wall it was dropped at —
three different headings, not three beds facing north.

Then press **Shuffle** and watch what it does with them. Adding now picks a heading, and
the solver has always priced facing; the two agreeing is the point.

**Wrong looks like:** every bed facing the same way on drop, which is what the user
screenshotted. Or, after Shuffle, every bed converging on one wall — that would be a
solver question rather than this fix, because nothing prices *variety*. Also worth looking
at while you are there: a **plant** and a **floor lamp** must still arrive at 0°, since
those have no back to put against anything.

### A curtain the ceiling came down on — still wants one look

Lower a room's ceiling below a **curtain**'s height. The curtain keeps its real size and
stands through the slab, and **Room check says so**. Not resizing is the rule; saying
nothing was the defect.

**Wrong looks like:** silence in Room check, or the curtain quietly shrinking.

### The mount-height field under a piece that cannot fit

Select a wall-mounted piece taller than the room. Its **mount height** field should refuse
the edit and say why, rather than accepting a number and pinning it to 0.

**Wrong looks like:** typing 120 and watching it become 0 with no message.

---

## Drag and selection

*Owner: `drag`.*

Everything below is **merged** — `main` at `b73e149`, formerly PR #23. The gate counts went
with the artifact they were measured on. What has not gone is the reason each item is here:
six of these assertions were watched failing first — three mutations on the turn (re-grid
it, hand back the raw spot on an invalid resolve, make the containment extent
rotation-blind) and three on drill-in (never fire, count an empty selection as inside,
accept overlap where it asks for containment) — and not one of them can see any of what
follows.

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

### A wall-mounted piece you can finally collide with — PR #42, `587d52c`

`collidesAt` carried `if (o.wallMounted) continue;`, so **nothing in the room could collide
with a mounted TV, a painting or a floating shelf**, and it measured every vertical extent
as `[y, y + h]` — right for a sofa, wrong by half a height for anything centred on its
origin. `verticalExtent` in `lib/physics.ts` is the one answer now. Gated at 83 files /
1639 tests / 1639 passed, typecheck 0, lint 0, build exit 0 with its ESLint pass present.

**Where to click.** 3D tab: add a TV to a wall, then drag a tall wardrobe along that wall
into it — it must refuse, and **the size tag must name the TV**. Then drag a 1 m sideboard
to the same spot: it must go under happily, because the TV's underside is at 1.05 m. Repeat
both in the 2D plan, which shares `drag-resolve`. Then add a ceiling fan and drag a 2.3 m
wardrobe under it — refuse — and a 2.1 m one — allow.

**Wrong looks like:** a wardrobe passing through a TV (the skip is not gone); a 1 m
sideboard refused under a TV (the extent is now wrong the other way); or a refusal with
**no name in the tag**, which is the `blockedBy` failure mode this repo has shipped before —
computed on both surfaces and said on one.

**Also worth one look, and it is not a defect:** rooms that ALREADY contain a wardrobe
standing through a mounted TV — a detected room, a scene file, anything Suggest produced,
since the solver does not call `collidesAt`. Those states still load. They simply cannot be
re-created by dragging any more, which is the intended asymmetry rather than a bug.

**Not a click path, a known consequence, and it needs a decision rather than a patch:**
`clearance.ts`'s `solid` list is filtered `!p.wallMounted && … && p.pos[1] < 0.05`, so the
room report will **not** report a wardrobe through a mounted TV while the drag now refuses
to create one. Same question, two answers — the shape `tests/layout-conformance.test.ts`
exists to catch and does not. That filter is load-bearing, not sloppy: it is what makes
four other copies of the same `pos[1] + h` arithmetic safe, because they only ever see
floor-level pieces. It wants a `RULE_HANDLING` row, which is a behaviour call.

---

## Layout and Shuffle

*Owner: `layout`. The first three ride **`fa12f1a` / PR #29**, now on `main`. The fourth
fixes nothing and is here anyway — it is the user's own report with a measured cause and a
reverted remedy, so what it needs is a look rather than a check.*

### A Lock button on every piece row — on `main`, `fa12f1a`

The user asked for it and then went looking for it and could not find it, because it sat
unpushed on one machine. It exists now, so this is the first time anyone can press it.

Open a room, look at the **left rail**. Every piece row has a **padlock** before the eye.
Press it on one piece, then press **Shuffle**. That piece must not move; the others should.
Press the padlock again and Shuffle again — now it should move like anything else.

It is deliberately **solver-only**. A locked piece still drags, turns, resizes, recolours
and deletes by hand, and that is the intended behaviour rather than a gap: a padlock that
stops a deliberate hand is one people learn to leave off.

**Wrong looks like:** the locked piece moving anyway — which would mean the lock composes
wrongly with something and the button is decoration. Or the padlock refusing a drag, which
is the other feature and not this one. Or the lock surviving into a **different room**:
open a second room and check nothing is locked there, because part ids are
`category`-plus-counter and collide across rooms, so an inherited entry would silently
exempt a *different* sofa.

Two states share this row and must not read as one: the padlock is **"locked in place"**
(yours), and the **camera glyph** is **"from your photo"** (the detector's). Hover both.

### 58px of piece name at the narrowest rail — on `main`, `fa12f1a`

The lock is a **third** button on a row that had two, and the piece name pays for it. The
name's remaining width goes from **90px to 58px** at the left rail's own clamp floor —
derived in `tests/reflow.test.ts` from the `.list-row` gap and padding, the rail's clamp,
the count of `IconButton`s inside `PartRow` and the 12px status glyph, and held above a
floor. So it is guarded, and it has never been seen.

Narrow the window until the left rail is at its tightest, then look at a piece with a long
name — a **"Dining / desk table"**, or rename something to twenty characters.

**Wrong looks like:** a name clipped with no ellipsis, or one printing over the padlock.
Those are two different failures with two different causes — `.rail` is `overflow: hidden`,
so anything outgrowing the row is eaten at the edge with no scrollbar and no console line;
an element with no `overflow` of its own paints over its neighbours instead. Neither errors
and neither fails a test. **A 58px name reads as a font bug in a screenshot**, which is why
it is written down as a number rather than left to be noticed.

Same shape as `shell`'s **"Delete from scene" → "Delete"**: in both cases the row was out
of **room**, not out of taste, and in both cases the arithmetic was only checkable because
every term came out of the file that states it rather than out of a comment.

### Shuffle and a piece a few degrees off square — on `main`, `fa12f1a`

Not on the user's list. Found while measuring something else, and it is the largest thing
in this section: over six presets × 40 seeds, **197 of the moved pieces came back between
0.06° and 12° off square** — and every gate was green, because the twelve-seed sweep that
guards this runs on a plain 7.5 × 5.6 rect, the one room shape where it does not happen.
The tidy now squares such a piece *and shoves it* up to `off × radius`. That takes 197 to
**30**.

Press **Shuffle** several times on an **L**, **U** or **T** room. Look along the walls for a
piece that is *almost* straight.

**Wrong looks like:** a sofa or table sitting two or three degrees off, reading as sloppy
rather than as angled on purpose. **The remaining 30 are real and expected** — mostly the U
and the T, where neither the square yaw nor anything within the piece's own reach is legal
— so finding one is not a regression. Finding a *lot* of them is.

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

*Owner: `shell`. All of these ride **`fix/a-bed-that-was-rotated` / PR #26**, gated at
`deb70f2` (`main` merged in): typecheck 0, lint 0, `next build` clean with its own ESLint
pass confirmed to have **run** rather than skipped, suite **1595/1600** — five reds, all
five attributed in `docs/what-is-still-open.md` and none of them in the code below.*

### Every bed in the app was rotated 90° — PR #26

The one thing on this page a user can see without being told what to look for, and it is
the reason to do this item first: it was in every shipped room for months and neither
session that argued about it found it by looking at a bed.

Open a room and look at the **bed** in the 3D tab. Then add each of the four from the
Library — Single, Double, Queen, King — and read the millimetres in the Inspector.

**Wrong looks like:** the headboard running along the **long** side, the two pillows
end-to-end instead of side by side, or a bed too short to lie down in. In the Inspector,
the size not matching the name you pressed — a Double and a Queen both arriving as
`1800 × 2000`, or a Single as `1700 × 1200`. That is what `main` did to three of its four
beds the moment you pressed Add, silently, because the clamp bands were transposed to
agree with the catalog.

**Then compare the tabs.** The 2D plan draws the footprint straight off `dimMM`, so 3D and
plan must agree on which way the bed is long. Two tabs disagreeing is the check that caught
the ceiling fan, and it is the only one that can catch this class without measuring.

### One band at the foot of the right rail, not two — PR #26

Open a room and **select a piece**. Look at the bottom of the right rail.

There must be **one** `--paper-2` band holding one row: `Delete`, `Add`, and the round
revert (the revert only after you have moved something). Then **select a wall** — the same
band, with `Done` where Delete was. Then **click empty floor** — the same band with Add
alone.

**Wrong looks like:** two grey bands stacked; a 1px horizontal line above the row — that
line is what three separate reports called a stray scrollbar and two sessions went looking
for an overflow that was never there; the row's right edge running under the rail's edge
and being cut with **no scrollbar and no clue**; or a label ellipsised to `Add a pie…`.

**Then make the window narrow** — down to about 1024–1280px, where the right rail is at its
floor — and check the row again in all three selection states. The arithmetic says it fits
and there is a test that goes red if either label gets longer, but **nothing in node can
measure a font**, so the fit itself is unverified and this is the only way to know.

### Delete stays put when the panel is taller than the rail — PR #26

Select a **sofa** and open every section in the Inspector — colour, on the surface, exact
size — until the panel scrolls.

**Wrong looks like:** `Delete` scrolling up out of the rail. It used to: it sat inside the
Inspector's own scroll box behind a spacer, so it was at the bottom only while the panel
happened to fit.

### A wider wardrobe should gain a column, not a wider door — PR #26

Select a **wardrobe** and drag its width handle slowly from 600 mm to 4000 mm. Then the
same for a **sofa**'s width.

**Wrong looks like:** doors or seat cushions growing to an impossible width and then
snapping to a different count. The old arithmetic was `Math.round(span / nominal)`, which
minimises the error in the **count** and says nothing about the module — so 890 mm drew one
890 mm door and 900 mm drew two of 450. The count must only ever go **up** as the piece
gets wider.

**And compare the tabs at three widths.** The plan draws the footprint off `dimMM` while
the 3D tab rebuilds the tiling, so the two agreeing is the same cross-check as the bed.

**The look changes on existing rooms** — narrower wardrobe doors, different seat counts.
That is the fix, not a regression. What would be a regression is a module that is still a
lie.

### Three signposts and no sign: the Library — PR #26

The user's own find, and the one no gate could ever have made: *"Library isn't on there."*

Press **Add**. The panel that opens must be headed **Library**. Then follow each of the
three strings that already used the word and check it leads somewhere: the help card
(*Catalog is what is in this room; Library is what you can add*), the **sun note** in the
left rail's Look section on a room with no door or window (*Add a window or a door from the
Library*), and the **right-click menu on empty floor** (*Add from library…*).

**Wrong looks like:** any of those three naming a list the screen does not have. The panel
read "Add pieces" — named for what you do rather than for what it holds — so all three
pointed at a word that was nowhere on screen.

**And check the help card's group heading** while it is open: it must not say the two lists
are *on the left*. Catalog is in the left rail; the Library docks on the right of the
canvas.

### Copy that names a feature the app does not have — PR #26

Hover every control in the studio that opens the Library: the rail's `Add`, the canvas
toolbar's `Add`, and the Inspector's model swap.

**Wrong looks like:** any tooltip offering to **describe a piece in words**. That feature
was deleted and two tooltips went on advertising it — rule 1 wearing a tooltip. Also check
the empty-room state in the left rail: it must point at `Add` by name and not say
"above", because Add has not been above that list since it moved to the right rail, and on
a stacked layout it is not even on the same side.

---

## Almost nothing here has been in a browser — and here is the route that works

**The heading used to say "nothing", and that stopped being true on `cb711cc`.** One
item has now been seen, headlessly, with a before/after and a control, and the route is
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

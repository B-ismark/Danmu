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
every Library click still drops at room centre, so five added pieces land in one heap
(§ H.3); and the plan draws the standing fan and the stool as SQUARES, which is § 32 seen
rather than inferred.

The item below is what replaced them, and it is the opposite case — a defect that
`verticalExtent` cannot express, so no gate will ever go red on it.*

### The pendant lamp and the ceiling fan are drawn bigger than they declare

**Where to click.** Any room, **3D Model** tab. Add a **Pendant lamp** from the Library
(Lighting) and look at the ceiling. Then a **Ceiling fan** (Appliances).

**What wrong looks like.** The pendant's cord going *into* or *through* the ceiling
rather than stopping at it, and the fan's downrod doing the same. Look from a low camera
angle with the dollhouse cut away, because from above the ceiling hides it.

**The arithmetic, so you know what you are looking for.** `PendantLampGeo` draws a 600 mm
cord at `y = +0.3` and a dome reaching `y = -0.2` — **800 mm of geometry for a shape whose
`dimMM[2]` is 400 mm**, and asymmetric about its own origin. `groundY` hangs it by the
model `verticalExtent` believes, so the app thinks its top is at 2.80 in a 2.8 m room and
it is drawn to **3.20**. The ceiling fan is the same defect at 70 mm.

**Why no test sees it.** Every clause that measures this — including the new
`tests/shape-contract.test.ts` ones — asks `verticalExtent`, which computes from `dimMM`.
The renderer disagrees with `dimMM`, so the model and the drawing are both self-consistent
and wrong together. This is `CLAUDE.md` rule 2's `fanBlade` corollary in two more shapes,
and it is the reason that corollary exists.

**Not fixed on sight**, deliberately: moving authored geometry changes what every existing
room looks like, and nobody has had eyes on these two. Recorded as
`what-is-still-open.md` § 34.

**Gates.** Nothing. No test can express it — that is the finding.

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


## Layout and Shuffle

*Owner: `layout`. The Shuffle item was a look rather than a check, and the look was taken on
2026-08-30: Shuffle declined to close a 300–400 mm bedside gap, which **confirms the measured
diagnosis** rather than contradicting it. The item's job was to tell us whether the arithmetic
matched the room, and it did, so it is gone. Two things came out of that same look and neither
is an eyes-item: a nightstand passing **through** the bed after a Shuffle (§ H.18), and the
Library search failing to match `stand` → `Nightstand` (§ H.19).*

### Fix and Shuffle are two buttons now — merged to `main` in `9ecce9f` (PR #67)

**Where to click.** Left rail, top: the health chip now has **two** buttons under it,
`Fix` (sparkles) and `Shuffle` (shuffle icon). Open any room. Press `Fix` on a room with
nothing wrong — it should say *"This is already a good arrangement"*. Then press
`Shuffle` on the same room: it must actually rearrange it. That difference is the whole
point of the change, and no test can tell you it reads that way on screen.

**What wrong looks like.**

- **The row clipping.** Two `.ds-btn`s sit in a `display: flex` row with **no
  `flexWrap`**, inside a rail whose box is `overflow: hidden`. The derived budget is
  ~166px of button in 176px of rail at `--rail-left-tight` — about 10px of slack, never
  measured on a real font. Drag the left rail to its narrowest and watch for `Shuffle`
  losing its right-hand side or its label. There is no scrollbar and no error; the
  glyphs just stop. (`LightingPicker` next door solves the same problem with
  `flexWrap: 'wrap'` *and* two assertions in `tests/reflow.test.ts`; this row has
  neither yet.)
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

**Where it rides.** `fix/room-shrink-stops-at-the-furniture`, PR #72.



## Shell and flow

*Owner: `shell`. The Library click-through was looked at on 2026-08-30 — the Add rail is
present and the panel is visible on both tabs, which is the whole of what was left for a
person. The three signposts and the click-through are gated by `tests/studio-copy.test.tsx`
and `tests/library-click-through.test.tsx`. The one item below is new, and it is here
because what a test can check about it and what a person can see are different halves.*

### The placement row now folds to two rows on a narrow rail — does it look folded, or broken?

**Where to click.** Open any room, select a piece with **something under it** — a lamp
standing on a desk — so the placement row shows three buttons (**Wall · Surface · Floor**)
rather than two. Then **drag the right rail's sash as far left as it goes**.

**What was wrong.** The fold to two columns was written at `max-width: 268px` while a
dragged right rail floors at `--rail-right-min: 276px`, so the fold could never fire for any
width a drag can reach. Measured at 276px: the three buttons wanted 261px of the 243px they
had, and “Floor” painted at **x = 1401.8 in a 1400px window**. The swatch grid in the same
rail wanted 252px in the same 243px, and nobody had reported that one at all.

**What to look for now.** Three buttons should become **two on the first row and one on the
second**, with the section's padding intact on both sides and nothing touching the window
edge. The colour swatches in the same rail should be **six across and square**, not eight
narrow rectangles. Both are measured — `tests/reflow.test.ts` holds the breakpoint above the
rail's own floor and below the narrowest rail that ships un-dragged, and a browser probe
confirms nothing overflows at 276px.

**What a test cannot settle, and why this is here.** Nothing in a test can measure a
button's min-content, so the assertion is only that the fold is *reachable*, not that the
folded layout *reads well*. A lone “Floor” sitting under two buttons may look like a
mistake rather than a row that wrapped — and if it does, the answer is a different
arrangement of that row, not a different breakpoint.

**The second half, and it needs a REAL browser rather than a headless one.** The first fix
was derived against `.rail`, which is outside the Inspector's scrollbar, so the breakpoint
was short by whatever that scrollbar is wide. The container is `.rail-scroll` now — the
scroll box itself — so the scrollbar cancels instead of being estimated, and the number
dropped from 304 to 293. **Headless Chromium renders no scrollbar at all here** (measured:
`offsetWidth - clientWidth` is 0 in four launch configurations, with the box genuinely
scrolling), so what a browser probe can show is a 12px/15px transparent border standing in
for one — never the real thing. On a Windows machine with classic scrollbars, at a **1280px
window**, the un-dragged right rail is 307.2px and the row has about a pixel to spare: look
at whether the three buttons are three, and whether anything is touching the rail's right
edge. That single width is the whole question.

**Where it rides.** `dcfe1af` (the 268 → 304 fix) and `e4a9f25` (the container move and
304 → 293). **Both merged with nobody having looked at either**, which is why this item is
still here and why its gate counts are gone.

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

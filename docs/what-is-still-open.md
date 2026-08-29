# What is still open

Written at the end of a four-session round, as those sessions closed. Everything here
either **needs a measurement nobody has taken**, **needs a decision only the user can
make**, or **was decided against and is recorded so nobody re-proposes it.**

This is not [`visual-check.md`](visual-check.md). That file is for things a human has to
*look at*; this one is for things somebody has to *think about or measure*. An item that
becomes a click path moves there and leaves here.

**Every item names what is unknown, what would unblock it, and whether it exists in a
commit anywhere.** The last part is the one that matters at a wind-down: an item living
only in a scratchpad or a chat window dies with the window, and saying so is the whole
point of writing this down.

---

## Picking this up cold

**Derive the state; do not trust this file for it.** Everything below the next heading was
true when written and rots on the next commit — that is not a flaw in the file, it is what a
hand-off document is. Four commands settle the whole board and take a few seconds:

```bash
git fetch origin && git log --oneline -1 origin/main
gh pr list --state open
git worktree list                       # anything dirty is somebody's unfinished work
for b in $(git for-each-ref --format='%(refname:short)' refs/remotes/origin | grep -v HEAD); do
  git merge-base --is-ancestor $b origin/main || echo "UNMERGED: $b"
done
```

**`main` was deliberately red and PR #38 closes it.** The list is the next section, kept for
the arithmetic rather than as a live baseline. Run the suite before changing anything: green
is **82 files / 1633 tests** on that branch, and matching counts alone are not evidence — see
the note there on why the file count has to travel with the assertion count.

**Loose ends that live nowhere else:**

- **Five branches are fully contained in `main` and await the user's word to delete** —
  `fix/pointer-cancel-note` (its one unique commit landed as #34, then verified per-line as
  fully present), `fix/convoy-self-support`, `fix/a-bed-that-was-rotated`,
  `fix/visual-check-round-3`, `feat/shuffle-lock-and-band-price`. Deleting a remote ref is
  outward-facing and is **not** covered by a grant to commit, push and open PRs. Verify
  containment yourself before asking; do not delete on the strength of this paragraph.
- **`C:/Users/bisma/danmu-rescue/`** holds two patches lifted out of dead sessions'
  `%TEMP%` worktrees. **Both turned out to be superseded drafts of work already on `main`** —
  kept only because checking cost nothing. Safe to delete; check first.
- **Stale gate worktrees under `%TEMP%`** from sessions that ended. `git worktree prune`
  removes only those whose directories are already gone.

**To look at it:** `pnpm dev` for everything except offline and install; `pnpm build &&
pnpm start` for those, because `next dev` never registers the service worker and
`http://localhost` is a secure context while `http://192.168.x.x` is not.

**If several sessions share this checkout again:** stage explicit paths, never `git add -A`,
and never move `HEAD` while another session is live in the same tree. Name each session for
the surface it owns rather than its id.

---

## `main` was red on purpose. Here is the list, and it is closed.

**All five are fixed on `fix/bed-shape-and-its-rotted-fixtures` (PR #38): 82 files,
1633 tests, 0 failed, typecheck 0, lint 0 at `--max-warnings 0`.** Measured on the branch
tip, not on a working tree — and the count is up from 1612 + 5 because two of the
`layout-solve` assertions were split out from behind a failing bar, which is the same reason
the file count has to travel with it.

The baseline it replaces, kept because the arithmetic is the point: **5 failed, 1612 passed,
82 files** on `fa12f1a`, and before that 5 / 1595 / 81 at #26 with #29 adding 17 assertions —
`1600 + 17 = 1617 = 1612 + 5`. **Reconciling that is part of the check**, or a test that
silently stopped being collected hides inside an unchanged failure count. **And the file
count has to travel with it**, or the arithmetic closes over a hole one level up: `82 files`
is what rules out an entire file dropping out while its assertions are replaced elsewhere.

| test | item | fixed by |
|---|---|---|
| `bed-rung-safety` › *refuses, at U 6×5, every rung above the one that ships* | A.1 | `c9fe1a4` |
| `bed-rung-safety` › *still keeps the worst case bounded once the ladder has chosen* | A.1 | `c9fe1a4` |
| `layout-solve` › *stops a scrambled bedroom from ending in the occasional disaster* | A.1 / F | `c9fe1a4` |
| `suggest-tidiness` › *runs the repair pass on every seed* | A.3 | `4be144c` (fixture re-derived) |
| `suggest-tidiness` › *…on a fixture where the proxy really does hand back something worse* | A.3 | `4be144c` (fixture re-derived) |

**Why red was the right trade, in hindsight as well as at the time.** Two of these were a
new test naming a defect that was already on `main`; one was a guard correctly reporting that
its own fixture had gone vacuous; one was a bar that had to stay red until it could fail.
Holding a correct fix out of `main` to keep the suite green would have been a green bought by
not looking. **A red that names a real defect beats a green that hides one** — and the
defect it named turned out to be one line in `propose`, which nothing green would ever have
led anyone to.

**What it cost, so the trade is recorded honestly and not only justified.** Nine merges
landed on a red `main`, so for that stretch nobody could read the suite as a signal, and the
list had to be maintained here by hand. Two of the five reds were also *misdiagnosed* in this
very document for most of that time — see the three wrong claims in section F. A red baseline
is a hand-off document like any other: it rots, and it scopes the next reader's search while
it does.

---

## A · Research — mostly unmeasured. Items 1 and 6 are settled and say so.

### 1. `clampIntoFootprint` aimed every rescue at one point in a non-convex room — FIXED

**Was the biggest open item. Fixed by `c9fe1a4` (PR #38); this is the account, because the
diagnosis took four sessions and the last step was one line.**

`clampIntoFootprint` steps from an outside point toward `interiorPoint(poly)` in 0.15
increments and returns the first hit inside. `findInteriorPoint` takes `polyAreaCentroid`
and, when that is outside the polygon — **which on a U it is, it sits in the void between
the arms** — grid-probes for the interior cell *closest to it*. On a U that is the middle
of the base. So every clamp in that room aimed at the same point in the throat.

Localised by `shell`, one file at a time, without moving `HEAD`, against
`tests/bed-rung-safety.test.ts`:

| reverted to `6e71425` | result | Σ danger |
|---|---|---|
| `lib/layout-score.ts` | 2 failed | 86.10 |
| `lib/layout-solve.ts` | 2 failed | 86.10 |
| **`lib/footprint.ts`** | **2 passed** | **3.90** |
| `lib/clearance.ts` | 2 failed | 86.10 |
| `lib/physics.ts` | 2 failed | 86.10 |

One file, both directions. Per-seed over twelve seeds, `overlap` / `outside` / `door` /
`walkway` were **exactly 0.00 before and after**; the entire delta was `navigation`, 0.00 on
ten seeds, 5.40 on one and **80.70 on seed 5**. A threshold that is merely tight looks like
every seed creeping up. This was eleven seeds untouched and one layout losing 0.67 m² of
floor.

**Why a correctness fix made arrangements worse.** The old code walked toward
`polygonCentroid` — the vertex average — and when every step of that walk was also outside
it returned that void point. The proposal came back *outside* the room, `outside` priced it
at 1000 a unit, and the annealer **discarded it**. The broken clamp was acting as a filter.
Fixing it correctly turned every discarded proposal into an attractive one.

### The step that was missing, and what it cost

The bisection above names a **file**. It does not name a **caller**, and this item sat at
"the operation may be wrong" for four sessions while the answer was that two of that
function's four call sites had no business calling it at all. Both were in
`lib/layout-solve.ts`: `propose`'s last-resort nudge and `pickPartner`. A nudge that fell in
a U's notch — different offset, different piece, every time — came back as the *same* point
in the base, and an annealer handed one location repeatedly takes it. Six movable pieces in
one bay.

**The fix is not the design change this item proposed.** Nearest-interior projection was
tried and measured: the shipped rung went from 80.70 total danger to 102.60 and the ladder
lost monotonicity. It is local but it is not **diverse**, and diversity is the property the
annealer needed. What shipped instead declines the proposal: a new
`distanceToFootprintEdge` + `ON_WALL_M` in `lib/footprint.ts` tell a notch apart from a wall,
`propose` returns `p` unchanged for a notch, and `clampIntoFootprint` is untouched — it still
has one caller, in `lib/scene-spec.ts`, once per piece as a starter room is built.

**Two things fell out of it that are worth keeping:**

- **`pointInFootprint` is HALF-OPEN.** A rectangle's boundary reads *inside* on the west and
  south walls and *outside* on the east and north (verified per wall and per corner, now
  pinned in `tests/footprint.test.ts`). So `!pointInFootprint` never meant "outside the
  room", and the old code walked a 375 mm correction inward on two walls of four in a 5 × 4
  rect. **The change therefore touches rectangles too** — a rectangle's footprint *is* its
  bounding box — which is why it reshuffled every seed fixture in the suite and not only the
  L/T/U ones.
- **`ON_WALL_M = 0` re-reddens four `bed-rung` tests and `layout-solve`.** The solver is
  chaotic under any change to the proposal path, so a seed fixture is a canary for chaos
  rather than a measure of quality. Read a moved fixture that way before reading it as a
  regression.

**Do not measure this from a mixed tree.** Old `footprint.ts` grafted onto the other four
engine files makes a different pair of tests fail and pass — the mirror image of the
shipping configuration. Nobody ships that program and neither result means anything. (The
line-number pointer that used to be here has been dropped: a `:901` rots on the next edit,
and the test is *stops a scrambled bedroom from ending in the occasional disaster*.)

### 2. Nothing prices variety in Shuffle

`FACING_GAIN * angleCost(yaw, edge.yaw)` prices which way a piece faces. Nothing prices
whether several pieces of the same kind face *differently*. The user's report — three beds,
all facing one way — had two causes: how a bed is added (fixed) and how a bed is drawn
(fixed). Whether Shuffle then spreads them or converges them on one wall is untested.

**Unblocked now.** It needed the bed geometry and the added-heading fix in one tree, and
`fix/a-bed-that-was-rotated` is that tree.

### 3. `tests/suggest-tidiness.test.ts` — two reds, both real, both diagnosed

Neither is load-sensitive. Both reproduce running that file alone in ~20 s on an idle
machine, deterministically.

- **`:327`** — *"runs the repair pass on every seed — otherwise the rest of this says
  nothing"*. This is the cut-guard: the assertion that the fixture is genuinely a cut room.
  The corrected bed leaves routes open, so the fixture stopped being cut on all 24 seeds and
  the guard correctly reports that the rest of its describe has gone vacuous. **The fix is a
  new fixture that is actually cut with a 0.9 × 2.0 bed, not a relaxed guard.** Fails in
  14–20 ms, so it is not timing at all.
- **`:555`** — an identity assertion, 1 failing case in 1512 (3 shapes × 3 sizes × 60
  scrambles × 6 repair seeds). Needs the search, not a bar.

**The missing piece, and the item most likely to evaporate:** a standalone re-search
script. An earlier attempt as a Vitest file timed out at ten minutes; it wants to be a plain
Node script that can run for minutes and print a table. **Nothing is written.**

### 4. The contention pattern itself

Every round, a different timing-sensitive test goes red under load and green in isolation.
The standing advice is "trust CI, not the local run" — which works, and which also means
four sessions sharing one CPU can never trust a local suite. **Nobody has asked whether the
bounds are simply too tight for a loaded machine.** Measuring the distribution and deciding
between loosening them and marking them CI-only would retire a recurring false alarm.

One instance from this round is unrecoverable and is recorded as a gap rather than as a
result: gating PR #21's merge produced `1 failed | 1482 passed`, the failing test's identity
was lost to a follow-up run that matched nothing, and it was **never reproduced**. Two greens
on the identical tree afterwards, at 72 s and 76 s against a 48 s baseline. An unidentified
failure that was never reproduced is not a failure explained.

### 5. Is there a public Vercel production alias?

Every per-deployment URL is behind Vercel deployment protection — an anonymous GET redirects
`302` to `vercel.com/sso-api`. If no public alias exists, **every phone and offline check is
permanently one person's job**, and `visual-check.md` cannot name a URL that a second person
could open. Cheap to settle; changes who is able to help.

The desktop half needs none of this: `pnpm build && pnpm start` registers the service worker
on `localhost`, verified — `next start` boots in 3.9 s, `/sw.js` serves 200 with
`no-cache, no-store, must-revalidate`. The wall is only the phone.

### 6. The anchor-first test — no longer forced to move, and here is what changed

Measured over four shapes, 8 seeds, mutation = `anchorIdx` forced to `[]`:

| shape | anchor | worst with | worst without |
|---|---|---|---|
| rect | sofa | 16.58 | 16.15 |
| l | sofa | 20.60 | 25.19 |
| **t** | sofa | **56.33** | **267.68** |
| u | bed | 26.98 | 20.93 |

The T is what the pass is for. The U reads *better* without the pass, so the recommendation
here was to move the test to `footprintForLayout('t', 6, 5)`.

**Superseded in part by `c9fe1a4`, and the reason is worth more than the conclusion.** The
argument for moving was that the U had stopped demonstrating anything — the assertion on it
survived mutating `anchorIdx` to empty, so it was a green that could not fail. That was
true, and it was true of a bar on the *total cost*. The fixture is not what had stopped
discriminating; the **quantity** had. Twelve seeds at U 6 × 5 now:

| | shipped | `anchorIdx = []` |
|---|---|---|
| worst total | 38.53 | 36.24 — **a bar on this cannot see the pass** |
| seeds ending with no hard term | **12 of 12** | **9 of 12** |

So `tests/layout-solve.test.ts` asserts the seed count and the pass has a guard again,
without the fixture moving. That count also fails under `DEFAULT_WEIGHTS.outside = 0` (8 of
12) and `alignment = 0` (9 of 12) — three independent mutations, where the total-cost bar
caught one. **Before moving a fixture, check whether the assertion is measuring the wrong
quantity on the right room**, which is cheaper and was the answer here.

Moving to the T is still worth doing on its own merits and is now optional: G.2 has the
five-preset table, and the T is where the pass earns the most (490.10 → 277.78 worst,
84.22 → 39.43 median at 6 × 5). Note the two tables disagree in magnitude — 8 seeds versus
12, and the earlier one recorded no room sizes — so they are two experiments that agree on
the ranking, not one measurement.

**A constraint on this that only came out of the bandCost work:** any re-price of the cost
function **reshuffles which seed disasters**, so a twelve-seed tail bar cannot survive one.
That is not an argument for a looser bar — it is the reason a tail bar over a fixed seed set
is the wrong instrument for guarding a solver whose weights are still moving. A **count** of
safe seeds is a better instrument for exactly that reason, and it is what shipped. **Owner:
`sizes`** — `layout` was offered it and declined.

### 7. `snapYaws` gives up and leaves the piece crooked — 197 in 240 solves

Found by `layout` while chasing something else, and it is the third instance this round of
the same shape. `snapYaws` squares a piece and asks the hard terms; when refused it **gave
up and handed back a piece a few degrees off**. Over six presets × 40 seeds = **240 solves,
197 crooked pieces, every gate green.**

Green because the twelve-seed sweep that guards this runs on a plain 7.5 × 5.6 rect — **the
one room where it does not happen.** Same shape as item 1 and as the bed transposition: *a
fixture that cannot express the defect.*

Squaring plus a shove of `off × radius` over four axes then four diagonals takes 197 → 30.
Axes alone give 48, so **the diagonals carry a third of it**. The residual 30 are real and
need a search that can move the piece *and* its neighbour, which a finish pass cannot do.

**Re-swept after `c9fe1a4`, because the proposal generator moved underneath it: axes 63,
axes + diagonals 40.** The residual grew and the ratio held — the diagonals still clear
about a third of what the axes leave, 48 → 30 before and 63 → 40 now. The two sweeps are
**not** the same experiment (the first recorded no room sizes) and must not be read as a
regression from the fix. `tests/suggest-tidiness.test.ts` owns the table, the fixture it was
measured on, and the four coordinates that come free only on a diagonal; `lib/layout-solve.ts`
points at it rather than keeping a second copy. **The three diagonal witnesses did not
survive** the proposal change — `rect 5×4` seed 24 is now crooked *with* the diagonals, so it
witnessed nothing — and were re-derived rather than adjusted until green. Four now, `t`
included, because it is the shape with the most crooked pieces and it had no witness at all.

**Shipped in `fa12f1a`, and one thing about it was checked rather than assumed.** The three
diagonal-shove witnesses are coordinates into a space both the cost function and the seeder
define, and item 1 moves starter placements — so they could have gone red for a reason with
nothing to do with the shove. They did not. **That is also what makes 197 → 30 a result
rather than an artifact of the pre-#26 seeder**, and it is the kind of thing that is only
knowable by someone who noticed the witnesses were the fragile part. They then went red for
exactly that reason one commit later, which is the confirmation rather than the refutation:
the property that made them worth checking is the property that made them fragile.

### The Shuffle rename is NOT started

Recorded because a half-done rename reads as a bug, and this document twice implied it was in
hand. The new Lock strings deliberately say **"Suggest"**, so the vocabulary stays internally
consistent. If it lands it lands as **one sweep across all 36 files**, never a file at a time.

---

## B · Decisions only the user can make

Four of these were put to the user and are **answered**. They are kept here rather than
deleted because the answer is the useful part, and because two of them changed shape when
the user went and looked.

7. **Shuffle and hand-placed pieces — ANSWERED by the tree, not by taste.** The user
   reported not being able to find the Lock button. They are right, and it is not a UI
   problem: `feat/shuffle-lock-and-band-price` (`4cc7239` the bandCost fix, `301b008` the
   Lock button) **has no remote branch** — its upstream reads `origin/main`, so both commits
   exist on one machine. There is no Lock in any tree anyone else can run, so nothing was
   there to find. **Push it and open a PR; the product question cannot be asked until the
   button can be pressed.** Same failure mode as the bed fix earlier in the round, and it is
   the reason this document asks of every item whether it exists in a commit anywhere.

8. **After a refused turn, 3D says nothing — ANSWERED, and the framing was wrong.** What
   happens: turn a piece so its corner would go through a wall, and the plan tab draws an
   outline round it. The 3D tab draws nothing at all; its only tell is opening Room check.
   The same refusal is loud in one tab and silent in the other.

   It was recorded as taste on the grounds that telling 3D means inventing a second visual
   channel in the scene. **That is only true of an outline**, so the conclusion stands — the
   silence is a defect, and an outline in 3D remains taste and remains declined.

   **The mechanism first written here was wrong, and the correct one makes this a bigger
   job.** It said `blockedBy` was being computed and dropped, so routing the turn's refusal
   into the size tag would be a one-liner. It would not. In
   `components/three/Draggable.tsx`, `onGizmoChange` opens with

       if (mode !== 'translate') return; // rotate/scale resolve on commit

   and `liveUpdate` has exactly one call site — `:616`, the pointer-drag flush. `announce(`
   appears only inside `liveUpdate` (`:456`), as do `blockedBy` (`:491`) and the only
   `setDragInvalid(true)` (`:494`; the other three sites set `false`). **So during a rotate
   or a scale in 3D the live channel never publishes at all.** Nothing is computed and
   dropped — there is no per-frame feedback for that gesture class by design, and the comment
   says why. That is a *different* defect from the one that had 3D refusing a set in silence,
   which had the value in hand.

   Two ways in, both real work and neither a routing change:
   - **Publish a one-shot live update from `commit()` on refusal.** The gesture is over by
     then, and the live channel is a *drag* channel — `MeasureGuides` reads `live`, and
     `setDragging(null)` happens in the same handler. Needs a decision about whether a
     channel keyed to "a drag is in flight" may carry a message about one that has ended.
   - **Let `onGizmoChange` run `liveUpdate` for rotate and scale.** That deletes the early
     return the file explains rather than adding to it, and means resolving on every gizmo
     frame for two gestures that deliberately do not.

   Found by `drag`, reading the file after this document had already claimed the easy
   version. **A write-up that understates a fix is worse than one that overstates it:**
   somebody opens the file expecting a one-liner and finds a design question.
   An outline in 3D remains taste and remains declined.

9. **A piece too big to turn — DECIDED: it depends on whether any angle fits, and the
   crossed interval is how you tell.**

   Both answers are honest in isolation, which is why neither wins outright:
   - **Hold-and-report** matches every other refusal in the app — the convoy refuses as a
     unit and names the blocker — but applied unconditionally it makes a 4 m bench in a 3 m
     room **permanently un-turnable**, with no way back. `visual-check.md` already names
     "a piece in a tight corner becoming un-turnable" as the thing the rotate work must not
     do.
   - **Pin-and-report** always lets the turn happen, but silently stops position tracking
     input, which reads as the app being broken.

   The distinction that resolves it is already sitting in the code. When a piece is longer
   than the room, the containment clamp's two ends **cross**, and `Math.max(min, Math.min(max, v))`
   with `max < min` returns `min` unconditionally — the same degenerate shape as the door
   whose minimum height exceeded the minimum ceiling, and as the unit-rounded ranges that
   inverted. A crossed interval is not a tight fit; it is the arithmetic saying **no legal
   value exists**.

   So: **detect the crossed interval explicitly.** Where it is crossed — no angle fits —
   allow the turn and report, because refusing would lock the piece out of an operation
   forever and the room report is already saying the true thing. Where it is not crossed —
   this angle does not fit but another does — refuse the angle, keep the last good one, and
   name the blocker, exactly as a refused move behaves. The rule to carry: **a crossed bound
   is a message, never a clamp.**

   **9 depends on 8, and neither of us saw it until `drag` did.** Both halves of that
   decision end in *report*, and in the model tab, for rotate and scale, **there is currently
   nothing to report through** — see item 8. So implementing 9 in `lib/drag-resolve.ts`
   alone buys correct behaviour in the plan and correct *silence* in 3D, which would read as
   the fix half-working. **8 is a prerequisite for 9 being observable in the model tab.** Do
   them in that order or do them together; do not ship 9 first.

10. **"Library" — ANSWERED, and the user's answer is a defect report.** They said *"Library
    isn't on there"*, and the tree agrees: the panel's heading is **"Add pieces"**, its
    trigger reads **"Add"**, and the rail carries `title="Catalog"`. The word "Library"
    survives in exactly one user-visible place — `StudioHelp.tsx:210`, *"**Catalog** is what
    is in this room; **Library** is what you can add"* — which teaches a label the UI no
    longer has, under a heading that reads "The lists on the left" for a panel that now
    lives in the **right** rail.

    **FIXED in `aaf2888`, and not the way this document first proposed.** The count was
    wrong as well: not one stale string but **three**, all already using the word — the help
    card, the sun note in the left rail's Look section (*"Add a window or a door from the
    Library"*), and the right-click menu on empty floor (*"Add from library…"*). **Three
    signposts and no sign.**

    So the fix was **one heading, not three strings**: the panel is headed **Library** again.
    This document had argued the opposite — that the help line and `CLAUDE.md` rule 4 should
    follow the screen. `shell`'s reasoning is better and the reason it wins is worth keeping:
    rule 4 names the two lists for **what they hold**, and "Add pieces" names what you *do*
    with the list. Restoring the heading makes all three strings true **and** makes rule 4's
    own sentence true again **with no edit to the rule** — and *that* is the tell that it is
    the coherent direction rather than merely a reachable one. `CLAUDE.md` was not touched
    and needs no touching.

    The button stays **"Add"**, which is not the same decision reversed: a button is named
    for its action and a list for its contents, so the pair reads "press Add, the Library
    opens" — which is what all three strings already assumed.

    One more stale *direction*, the second this round after the empty state's "above":
    `StudioHelp`'s group heading read **"The lists on the left"**, true of both until the
    Library moved to the right of the canvas. It names the two lists and says which is where
    now. **Not** the sun note — that names the list rather than a side, so it was true before
    and after, and the distinction was written down rather than a third thing "fixed".

11. **One session's tool classifier blocks `gh pr list` while allowing `gh pr create` and
    `gh api`.** That session opened a PR unable to first check whether one already existed
    on the branch. A permission question, and only the user can settle it — no session may
    grant it to another.

---

## C · Decided against — do not re-propose

- **A `SolveOptions` anchor switch.** A production flag production never sets is a second
  code path with no reader.
- **Rebasing a branch whose commits were already rebased into `main` by someone else.**
  Patch-ids drift with context lines, so the rebase drops some and reapplies the rest into a
  tree that already has them. Cherry-pick onto a fresh branch off `main`.
- **An icon-only Delete in the rail footer.** It fits the width arithmetic and hides a
  destructive action behind a glyph.
- **Wrapping the footer row instead of shortening its labels.** It reaches "stacked" again
  at exactly the width the original report was about.
- **A furniture CSV or parts spreadsheet.** `CLAUDE.md` rule 6. Recorded because it has been
  violated twice.
- **Re-baselining any currently failing assertion.** Every red in this document is
  attributed to a cause instead.
- **`bandCost` as `e + e²`.** Measured, correct diagnosis, wrong remedy, **reverted** — and
  the defect it was aimed at is real and now pinned as a characterisation test that prints
  on every run. Swept over all ten relation specs the library can form, a piece **300 mm out
  of band costs less than `MIN_GAIN_ABS` in every one of the ten**: a nightstand 450 mm off a
  bed scores 0.90, so the solver finds the fix, the gate prices it as noise, and Shuffle
  declines to offer it. That is most of both user reports.

  `e + e²` fixes the price (10/10 → 0/10) and wrecks the tail. Scrambled 6 × 5 U, 48 seeds:

  | `bandCost` | worst | median | seeds w/ hard term | largest hard |
  |---|---|---|---|---|
  | `e²` | 13.96 | 3.70 | 4 / 48 | 5.40 |
  | `e + e²` | **337.53** | 3.05 | 7 / 48 | **322.62** |

  Four disasters at 60 / 131 / 253 / 322 that `e²` never produces. `scoreLayout` sums every
  term and only `anyWorse` keeps the hard ones apart, so a stronger `relation` **buys**
  `access`. Capping the linear term at half a walkway was *worse* — 391.76, disaster on a
  different seed — so it is not tunable.

  **The untried direction, recorded in the code: the fault is in what gets OFFERED, not what
  gets searched.** A relation-aware floor in `isWorthOffering` — offer it if any relation
  went from out-of-band to in-band — changes the offer only and cannot destabilise the
  annealer. Unblocked, needs no measurement to start.

---

## D · Would be lost silently

- ~~**`2f4d8d1`** is an unreferenced commit.~~ **Wrong, and the error is worth keeping.**
  `git log --oneline -1` says *"Merge pull request #18"* and `merge-base --is-ancestor` says
  it is an ancestor of `main`. It was read out of a `git branch -vv` line —
  `feat/pin-from-randomise 2f4d8d1` — and mistaken for the branch's own work when it was the
  branch's **base**. Nothing was ever orphaned; `feat/pin-from-randomise` was **renamed**,
  not deleted, and its content is in #29. **A ref listing tells you where a branch points,
  never what it contains** — the second time in this round that a listing was read as a claim
  about content.
- **Eight stale gate worktrees** in temp directories belonging to sessions that have ended,
  plus two live worktrees on branches that have merged.
- ~~**`tests/layout-rules.test.ts:238`.**~~ **Fixed in `aaf2888`**, and the sweep that
  replaced it is the lesson. The fixture was harmless — an anchor picked by *rank*, and
  1900 × 1000 and 1000 × 1900 are the same 1.90 m² — so the **comment** was the defect.
  Two careful greps, one per session, found **one stale bed fixture between them.** A third
  found **seven**, and *all 115 tests in those three files passed either way*: not one was
  load-bearing, which is exactly why the runner could never see them. So the check is now a
  **sweep in the suite** rather than a list — `catalog-clamp.test.ts` scans `tests/` for a
  bed fixture wider than it is long and asserts zero, **with a match count so it cannot pass
  by matching nothing.** A list would have been that grep, frozen.

  It found an eighth on its first run **that is not stale**: `label-repair.test.ts:222` hands
  `judgeLabel` a bed of `[1900, 1234, 600]`, where `1234` is a sentinel that exists to be
  shown recomputed. A detection's `dimMM` is the AI's raw hint and is *allowed* to be
  nonsense — being nonsense is what `clampDims` and `judgeLabel` are for. Excluded with the
  reason written beside it. **Reading it as stale would have deleted a real assertion to make
  a new one look right.**

### Three tooling hazards, all silent, all failing in the direction that looks like success

- **A backslash can be eaten between a shell heredoc and the file.** A line intended as
  `/\bdet\(/` arrived as a literal **0x08 backspace** — `/<BS>det\(/`, a regex that can never
  match — **inside a test whose entire job is to match.** Typecheck and lint both passed. It
  is a plain `code.includes('det({')` now, with no escape for anything to eat. Same family as
  `CLAUDE.md`'s PowerShell UTF-8 warning: the damage happens in transit and the result still
  compiles.
- **Do not restore a mutation with `git checkout HEAD -- <file>` in a dirty tree.** It
  silently wipes *uncommitted* work in the files it touches, and the sweep then reads as
  still-failing-after-restore. **Back up bytes, not refs**, whenever the tree is dirty — which
  in a shared checkout is always.
- **A search for a term cannot find a claim about that term's ABSENCE**, and it will
  confidently return hits that refute nothing. Asked whether a seventeen-line note explaining
  why `Draggable` deliberately has **no** `onPointerCancel` prop was already on `main`,
  `git grep onPointerCancel` returned three files — all of them live
  `onPointerCancel={…}` props on DOM elements, none of them the note. Three hits, zero
  bearing on the question. Same family as `CLAUDE.md`'s `flushSync` warning, where a grep
  hits a re-export nobody calls and a whole passage gets discarded on the strength of it.

  **`git cherry` is no better as a substitute.** On the branch in question it marked four
  commits `+` when only one carried unique content, because the branch had been rebased with
  a squash and the patch-ids had drifted. **Patch-id absence is not content absence** —
  `applyRoomEdits`, `ROOM_AXES`, `steppedValue` and eight distinctive test titles from those
  "missing" commits were all on `main`.

  What settled it was **per-line**: all 1909 substantive added lines across 33 files, each
  checked against `main`'s copy of its own file. 50 absent, resolving four ways — 21 written
  against a doc that has since been rewritten, 11 superseded by a later form that also
  clamps, 1 reflowed with an extra conjunct, and **17 genuinely missing**, which is the note.
  It is on `main` now as PR #34.

---

## E · The next task, scoped but NOT started: component tests under jsdom

This section exists because the scoping is worth more than it looks and lived nowhere
durable. It was derived in a session that is about to be cleared, and a scratchpad note
dies with its session id. **Nothing below is in a commit** — no dependency added, no
config touched, no test written.

### Why this is the next thing

`docs/visual-check.md` says nothing in this app has been in a browser. The reason that
list keeps growing is structural: **no test in this repo has ever mounted a component.**
Derived, not remembered — `grep -rln "from '@/components" tests/` returns nothing. Every
function in `lib/` is asserted; **nothing checks that a component calls it**, so a correct
`lib/` answer computed and then dropped on the floor by its caller is invisible to all
82 test files. That is exactly the shape of the `blockedBy` scar in `CLAUDE.md` — "a
finding the caller drops is a finding that does not exist" — and it went a whole commit
unseen because only a human eye could have caught it.

Of the 21 items in `visual-check.md`, roughly **10 need no browser at all**, only wiring:
does the component render the sentence `lib/` already computes. 3 more are computed
layout. The remaining 8 need a real browser and stay where they are.

### The toolchain facts, already derived — do not re-derive

- react / react-dom **19.2.8**, vitest **4.1.10**, jsdom **30.0.1**, vite 7.
- `vitest.config.ts`: `environment: 'node'`, `include: ['tests/**/*.test.ts']`,
  alias `@` to repo root, `esbuild: { jsx: 'automatic' }`.
- **That `include` does not match `.test.tsx`**, and JSX will not parse inside a
  `.test.ts`. So either widen it to `tests/**/*.test.{ts,tsx}` or write every component
  test through `React.createElement`. Widening is the right call; the second is a
  transcript of JSX rather than JSX.
- `tests/toolchain.test.ts` does **not** pin `include`, `environment` or `esbuild` —
  checked, not assumed. Worth pinning the way the ESLint >= 9 floor is pinned, since all
  three fail in the direction that looks like success: a `.tsx` test that is simply never
  collected reports as a green suite.
- jsdom is opted into **per file** with a `// @vitest-environment jsdom` pragma. Keep it
  that way. Do not switch the suite over — `CLAUDE.md` says so and the reason is that the
  pure-logic files have no business paying for a DOM.

### Two findings from the scoping, both of which should be fixed as part of the work

1. **`vitest.config.ts`'s comment is stale, and it justifies a live setting.** It says a
   test that renders a component — naming `tests/sun-controls.test.ts` — imports a `.tsx`.
   **That file does not exist**; it went with the sun-mood collapse. So `esbuild: { jsx:
   'automatic' }` is currently explained by a file that is gone, and in fact **no test
   imports a `.tsx` at all.** Do **not** delete the setting on that reading: it becomes
   load-bearing the moment the first component test lands. Correct the comment to name the
   real reason. This is the `CLAUDE.md` grep-refutation trap pointing the other way — prose
   that survived its subject, and would have talked the next reader into deleting something
   real.
2. **`tests/vanishing-point.test.ts` contains a `render(` that has nothing to do with
   React** — it is a local image-drawing helper. It is why a naive `grep "render("` over
   `tests/` looks like component coverage already exists. It fooled one pass of this
   scoping already.

### What can actually be mounted

These carry **zero** `@react-three`, `useFrame` or `useThree` references, so jsdom can
mount them (line counts as of `e9e32d2`):

`Inspector` (1088) · `PartTree` (1044) · `LibraryPicker` (326) · `CatalogPanel` (275) ·
`StudioHelp` (265) · `RoomDimsEditor` (207) · `RailFooter` (162)

**Corrected: that list is a starting point, not the boundary.** Re-derived at `4be144c` —
`find components -name '*.tsx'` is **63**, of which 10 mention `@react-three`, `useFrame` or
`useThree`, so **53 are r3f-free** — including the two largest panels in the app, `PlanView`
(1888) and `RoomTools` (1747). Neither is in the seven, and `RoomTools` is the one the first
spike actually needs (below). (This said "50 of the 60" against `62553d2`; both numbers had
moved and the ratio had not. Derive it, do not carry it.)

**And the grep is not a mountability test in the other direction either.** `DynamicPart`
(1264), `Dressing` (169) and `PartLight` (137) contain no `@react-three` string and are
still not mountable: they render `<mesh>` / `<group>` JSX, which only means anything
inside R3F's reconciler. Use the grep to shortlist, then read what the component renders.

**Do not widen that second grep to `<line`.** It is an SVG element, and adding it puts
`PlanView`, `NorthDial` and `ViewGizmo` on the unmountable list — three of the most
mountable files in the repo, `PlanView` being the second-largest panel and a component this
task wants a test on. `<mesh`, `<group`, `<primitive` and `<points` are three-only; the rest
of the lowercase JSX vocabulary is shared with SVG and HTML. Checked by running both greps:
the three-only set returns exactly the three components named above.

The R3F components — `Draggable`, `Room`, `RoomShell`, `DynamicPart` and the rest — are
**not** mountable under jsdom; they want a WebGL context. Those map almost exactly onto
the 8 browser-only items, which is a useful coincidence rather than a plan: it means the
split between "a test can settle this" and "a person must look at this" is a property of
the code, not a judgement call.

### The plan

1. Add `@testing-library/react` (plus its `@testing-library/dom` peer if npm asks for it).
   One dependency. Run `pnpm audit` after.
2. Widen `include` to `tests/**/*.test.{ts,tsx}` and fix the stale comment. Consider
   pinning `include`, `environment` and `esbuild` in `tests/toolchain.test.ts`.
3. **Spike on the smallest real item first: the door that cannot shrink.** `analyzeRoom`
   already asserts the sentence in `tests/clearance.test.ts`; the open question is entirely
   whether the component **renders** it. **That component is `RoomTools`, not the
   Inspector** — this said Inspector and was wrong. Room check lives in
   `components/studio/RoomTools.tsx`, which is what imports `analyzeRoom` (:161) and reads
   `RULE_HANDLING` to decide the **Try a fix** button (:937). Nothing in `Inspector.tsx`
   touches `analyzeRoom` at all. Watch the new assertion fail — mutate the
   component, not the test's own threshold — before trusting a word of it. The whole point
   of this task is that a green from a gate that cannot fail is worth less than no gate.
4. Then the rest of that bucket. Two of them need no mounting at all, only a source-text
   sweep: the Library signposts, and copy still naming a deleted feature.
5. **Delete each item from `visual-check.md` in the same pull request that lands its
   gate.** That file's rule is that an item goes when it has been looked at; a test that
   settles it permanently is stronger than one look, and leaving the item behind would
   claim work that is done.

### What this does not do

It does not put anything in a browser. Eight items stay in `visual-check.md` afterwards
and every one of them still needs a person. Mounting a component under jsdom proves the
wiring, never the pixels — no layout, no overflow, no contrast, no focus ring. **Do not
let a full green here be read as the browser item being closed**, which is the failure
this whole document is about.

---

## F · The red solver seed — FIXED, and what it cost to find

**Resolved by `c9fe1a4` on `fix/bed-shape-and-its-rotted-fixtures` (PR #38).** All five
red tests are green and the suite is **82 files / 1633 tests** with typecheck 0 and lint 0.
This section is kept for the diagnosis, because the cause was not where four sessions of
notes said it was.

**The cause and the fix are item A.1, not this section.** This used to carry its own
competing account of the same defect — naming the repair pass as the place the fix belonged,
which was wrong — and two accounts of one bug is how a search gets scoped away from the
answer. A.1 had the bisection to `lib/footprint.ts` from the start; what was missing was the
step from "that file" to "which caller of that file", and nothing here pointed at `propose`.

### Three claims this section made that were wrong, all in the same direction

Each one made the defect sound bigger and more located than it was, and each is the kind a
reader cannot check without re-measuring:

- **"The route seals."** At U 6×5 seed 5 the reported `navigation` was 80.70, and the
  weight is 120, so the raw quantity was **0.6725** — and `STRANDED_PIECE` is 2 per
  unreachable piece, so 0.6725 cannot contain one. Nothing was stranded: about **0.67 m² of
  a 23.40 m² floor** was cut off from the door. A real finding, and a fifth of a square
  metre rather than a sealed room.
- **"The bed crosses from x = −1.98 to x = +1.98."** That is one number with a ± in front
  of it: 1.98 was the bed's **centre**. A seeded bed is 900 mm wide, so its actual extent
  was 1.53 … 2.43 — a 900 mm piece, not a 3.96 m one. A centre read as a span, which is the
  frame error `CLAUDE.md` collects, in a document about frame errors.
- **"The fix is in the pass."** It was in the *proposal generator*: `propose`'s last-resort
  nudge clamped an out-of-room point with `clampIntoFootprint`, whose one destination is
  `interiorPoint`, so every nudge that fell in a U's notch proposed the same spot in the
  base and the annealer took it. See A.1 for why fixing the clamp *correctly* is what
  exposed this.

### What must not be done about it — still true, and it held

**The bars were not raised to get green**, and that is checkable: `bed-rung-safety`'s bar is
the same number it was, and `layout-solve`'s twelve-seed fixture now ends **12 of 12** with
nothing on any hard term. Two bars did move and both moved for a reason that is written
down beside them — the seed count from 7 to 11 because 7 could not see the pass it guarded,
and the total-cost bar from 40 to 60 because 40 passed by 3.7% on a chaotic solver while
catching nothing the seed count does not catch better.

**The bed was not reverted.** The 90° defect stays fixed.

### And a class of rot worth naming — with the retraction it earned

Every quantity `bed-rung-safety` and `layout-solve`'s bedroom comment quoted about this
sweep was re-derived. Most did not survive. **But the wholesale claim that "those numbers
were never true of any committed state" was itself false**, and it is worth reading how:
re-run with `lib/footprint.ts` alone at `6e71425`, Queen `Σdoor` is **176.84**, so
`rows[0].door > 50` did pass, and deleting it as fabricated was the error. `Σdanger` 3.90
and the medians 8.71 and 14.43 reproduce exactly too. Two figures genuinely do not (Double
median 7.01, and a `Σnavigation` of 453.60 that exceeds that rung's whole `Σdanger`).

So the original author was mostly right and partly not, and a wholesale retraction destroys
the difference. **Retract per number, on a named tree** — which is the same discipline this
document asks of every measurement in it, applied to the one place it is tempting to skip.

---

## G · Found while closing F, measured, and NOT fixed

Both are in a commit only as prose. Neither is caused by PR #38 — the first is pure
geometry with no solver in it, and the second is a pass that predates the branch.

### 1. A brand-new room seals its own routes, at the size the app ships

**This is the one to look at first.** `defaultScene` at the app's own default room —
`ROOM.width` 5.6 × `ROOM.depth` 4.2 in `lib/parts-catalog.ts` — builds starter
arrangements whose `navigation` term is non-zero before the user touches anything. No
solver runs in these numbers: it is `defaultScene` scored by `costBreakdown`.

| preset | floor | starter `navigation` | starter total | `analyzeRoom` says |
|---|---|---|---|---|
| rect | 23.52 m² | 0.00 | 2.40 | — |
| l | 19.37 m² | 2.40 | 55.24 | `zone` ×1 |
| **t** | 16.28 m² | **232.20** | 246.41 | **`reach` ×1, `cut-off` ×1** |
| **u** | 18.35 m² | **474.60** | 476.94 | **`reach` ×1, `cut-off` ×1** |
| open | 23.52 m² | 0.00 | 1.99 | — |

Divide by the weight of 120: the U's raw quantity is **3.955** and the T's is **1.935**.
`STRANDED_PIECE` is 2, so the T's cannot contain a stranded piece at all — that is 1.94 m²
of unreachable floor out of 16.28 — while the U's is at most one stranded piece plus 1.96 m².

**The user-visible half is the last column.** Open a fresh T or U room at the default size
and Room check reports two findings immediately. `outside` is 0.00 in every row, so nothing
is through a wall: containment was fixed (the `room-bays` / `layout-settle` scar in
`CLAUDE.md`) and **navigability was not**. Those are different properties and only the first
one has ever been tested.

Solving does not rescue it either: twelve seeds on the scrambled U at 5.6 × 4.2 give a
median of 211.17 and **1 of 12** seeds ending clean, against 12 of 12 at 6 × 5. The L's
worst seed there is 1025.50.

**Why nobody saw it:** every solver fixture in the suite uses 6 × 5 or 7.5 × 5.6, and at
6 × 5 the U starter is `navigation` 0.00 / total 3.57 — the number `layout-solve.test.ts`
quoted for years as evidence the seeding was innocent. It is innocent *at that size*. The
same shape as A.1 and A.7: a fixture that cannot express the defect, and here the fixture
differs from the shipping default by 40 cm.

**Unknown:** whether the fix is in `defaultScene`'s bay assignment, in `layout-settle`, or
in `lib/room-bays.ts`'s idea of which rectangles a small T leaves. **What would unblock it:**
sweep the starter arrangement across a grid of room sizes per preset and find where each
preset crosses from 0.00 into a finding — the answer is probably an area threshold below
which the starter set has too many pieces for the shape, in which case the fix may be to
place fewer.

### 2. The anchor-first pass helps two presets and hurts one

Measured at `4be144c`, twelve seeds per preset, every preset at 6 × 5, `anchorIdx` emptied
versus shipped — worst run, then median:

| preset | n | worst without → with | median without → with |
|---|---|---|---|
| rect | 11 | 16.17 → 12.60 | 8.77 → 6.83 |
| l | 14 | 33.68 → 35.38 | 17.68 → 17.87 |
| t | 18 | 490.10 → 277.78 | 84.22 → 39.43 |
| u | 12 | 36.24 → 38.53 | 12.08 → 10.46 |
| **open** | 17 | **36.60 → 253.31** | 11.49 → 15.22 |

The T is what the pass is for and it earns its place there. `open` is five times worse in
the tail *with* it. The comment in `lib/layout-solve.ts` used to claim `open 37 → 22` and
that "the disasters stop happening"; it named no room size, so this is not that experiment
re-run and **the difference is not evidence of a regression** — it is evidence that a
measurement whose fixture was never written down can only be replaced.

One limit on the ablation, stated because it cuts both ways: skipping a pass shifts the RNG
stream every later pass draws from, so "without" is a different trajectory rather than this
one minus a pass. `passSteps` is per pool and never reads `anchorIdx`, so the other two
passes do get identical budgets.

**This is a decision, not an optimisation** — gating a pass on the room's shape trades one
preset's tail against another's, which is a statement about which rooms this app is for.
Deliberately not tuned. Whoever picks it up should also read A.6, which reached a
compatible conclusion from a different fixture (4 shapes, 8 seeds, sizes unrecorded) and
recommended moving the U test to the T.

---

## Nothing in this document has been in a browser

Neither has anything in `visual-check.md`. The desktop half of both is reachable with
`pnpm build && pnpm start` and no login.

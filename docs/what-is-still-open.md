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

- **The branch list this paragraph used to carry was wrong in the dangerous direction, and
  its own last sentence is what caught it.** It named five branches as "fully contained in
  `main` and awaiting the user's word to delete". Re-derived per branch with
  `git rev-list --count origin/main..<branch>`:

  | branch | ahead of `main` |
  |---|---|
  | `origin/docs/layout-needs-eyes` | 0 — contained |
  | `origin/docs/the-next-task` | 0 — contained |
  | `origin/feat/shuffle-lock-and-band-price` | 0 — contained |
  | `origin/fix/bed-shape-and-its-rotted-fixtures` | 0 — contained |
  | `origin/fix/clamp-into-footprint` | 0 — contained |
  | `origin/fix/footer-assertion-reads-code` | 0 — contained |
  | `origin/fix/room-report-and-tidy` | 0 — contained |
  | `origin/fix/pointer-cancel-note` | **10 — NOT contained** |
  | `origin/test/component-tests-under-jsdom` | 11 — the open PR |
  | `origin/research/inward-normals` | 13 — the winding fix (knowingly red), STACKED on the PR above, so 11 of the 13 are its |
  | `origin/docs/a-branch-list-that-would-have-deleted-work` | 1 — this correction |

  Three things that list got wrong. `fix/convoy-self-support`, `fix/a-bed-that-was-rotated`
  and `fix/visual-check-round-3` **do not exist on `origin`** — the bed one never did under
  that name; the real branch is `fix/bed-shape-and-its-rotted-fixtures`, merged as #38. Four
  contained branches were **missing** from it. And `fix/pointer-cancel-note`, described as
  having "one unique commit [which] landed as #34, then verified per-line as fully present",
  carries **ten** commits main has never seen, among them `fix(convoy): a merged set carried
  by a MEMBER came apart` and `fix: a chevron that raised the ceiling, a rug shoved through a
  wall, and six gates that could not fail`. Acting on the old paragraph would have deleted
  real work.

  Deleting a remote ref is outward-facing and is **not** covered by a grant to commit, push
  and open PRs. **Re-derive the table before asking, every time** — this one is dated
  2026-08-29 and a branch list is exactly the kind of claim that rots between sessions.
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

**Unblocked now**, and no longer waiting on a tree: the bed geometry and the added-heading
fix are both on `main`, in the merge of `fix/bed-shape-and-its-rotted-fixtures` (PR #38).
The branch name this paragraph used to name does not exist on `origin` and never did.

**Started, in a commit, not on `main`.** `lib/layout-offer.ts` + `tests/layout-offer.test.ts`
exist on `feat/suggest-offer-mmr` (`e999522`) — layer 3a's two pure pieces, ranked and
tested, **imported by nothing**. What is written is `orderOffers` (the ranking) and
`layoutSimilarity` (how alike two arrangements are). What is not written is the wiring at
`RoomTools.tsx:534`, and three things below have to be settled before it can be.

· **The diversity trade is in COST UNITS, not a `[0, 1]` lambda, and that is a result about
  the technique rather than a preference.** Textbook MMR normalises relevance across the
  candidate set, which compares a fraction of the set's cost spread against a share of the
  room — no common unit, so lambda has no stable meaning. Measured, on this input: a
  finalist costing 14.0 that is *never offered* changed which candidate was offered second,
  purely by widening the spread; costs `[10, 10+ε, 10+2ε]` had ε blown up to the full
  relevance range and ordered by it, which is exactly the reasoning `isWorthOffering`
  refuses next door in cost units; and lambda's meaning moved with piece count, so the same
  three costs put the diverse candidate second in a two-piece room and gave pure cost order
  in an eight-piece one. `cost + penalty × closest` has none of the three.
  **The number itself is unmeasured** — what `diversityPenalty` should be, in cost units,
  is the one open value, and `MIN_GAIN_ABS` is the obvious scale to measure it against
  rather than to borrow.

· **The finalist pool cannot supply orientation variety, which is what §A.2 asked for.**
  `similar()` compares x/z and never reads `.yaw`, while `propose` turns a piece *in place*,
  so `remember()` merges a turn-only variant into the candidate it turned from and keeps the
  cheaper. A rotation-only alternative cannot reach the pool at any seed. Adding a yaw term
  to `similar()` would change which candidates survive — squarely inside what layer 2 is
  meant to settle first, and it would move the parked assertions — so this is **recorded,
  not fixed**. Ranking over the pool gives positional variety and nothing else, and the
  symptom if it is forgotten is "the diversity code does nothing".

· **The pool is raw annealer output, so ranking candidates is not ranking outcomes.**
  `snapYaws`, `pruneMoves`, `openRoutes` and a second tidy all run *after* a finalist is
  picked. Two consequences, neither designed for yet: two distinct finalists can
  post-process to the **same** suggestion, which on screen is indistinguishable from the
  ranking doing nothing; and `openRoutes` can refuse the pick outright, so the wiring needs
  to walk down the ranked list rather than take one.

**Layer 3b has not been started.** It needs `relationDistance` / `inRelationBand`, which are
in PR #46 and not on `main`.

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

12. **Room check speaks centimetres to a user who set metres, feet or inches.** Every
    sentence `analyzeRoom` composes hard-codes `cm` — `Math.round(x * 100)` in fifteen
    places in `lib/clearance.ts` — and `RoomTools` renders `issue.detail` verbatim
    (`components/studio/RoomTools.tsx:968`), so nothing converts it. `useSettings.dimUnit`
    defaults to **`'m'`** (`lib/store.ts:408`), which means the shipping default already
    disagrees: the room's own fields say `1.9 m` and the finding beside them says
    `190 cm`. Found by review while checking that a component test's derived `198 cm`
    matched its source — it does, exactly, so this is not a test defect and not new.
    **The decision is which way it should read**, and it is genuinely a decision rather
    than a bug: cm is the natural unit for a clearance, one panel speaking two units is
    not, and `boundsToUnit`'s scar (`CLAUDE.md` rule 2) is about a coarse unit collapsing
    a range — a finding sentence has no chevrons, so it would not inherit that. Three
    coherent answers: leave it and say so here; convert the numbers through `dimUnit`;
    or convert only where the same panel shows a `dimUnit` value. Nobody should pick
    silently, which is why it is in this section and not fixed.
    **Committed:** nothing but this paragraph.

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

## E · Component tests under jsdom — STARTED. The harness is in; the bucket is not.

**Steps 1–4 of the plan below are in a commit.** `@testing-library/react` is a
devDependency, `include` is widened, the config comment is corrected, four assertions in
`tests/toolchain.test.ts` pin the settings, and two component test files exist. Three
`visual-check.md` items are deleted and a fourth is narrowed to the one question a test
cannot answer. What remains is the rest of the bucket — the plan is kept verbatim below,
because the reasoning in it survived contact.

### Why this was the next thing

`docs/visual-check.md` says nothing in this app has been in a browser. The reason that
list keeps growing was structural: **no test in this repo had ever mounted a component.**
Every function in `lib/` is asserted; **nothing checked that a component calls it**, so a
correct `lib/` answer computed and then dropped on the floor by its caller was invisible
to the whole suite. That is exactly the shape of the `blockedBy` scar in `CLAUDE.md` — "a
finding the caller drops is a finding that does not exist" — and it went a whole commit
unseen because only a human eye could have caught it.

`visual-check.md` was 21 items and is **4** — see § H for where the other seventeen went;
of this paragraph's own arithmetic, three went in `95b28fa`, the mount-height
field in this pass, and the Library item is narrowed twice rather than deleted. Of the 17,
roughly **5 are still wiring** — does the component render what `lib/` already computed —
3 are computed layout, and the remaining 8 need a real browser and stay where they are.

*(That split was measured when the file held 17 and it did not survive contact. The user
looked at all seventeen: **8 held, 5 failed, 2 could not be answered because the question
itself was wrong, and 2 are still unchecked.** The failures land mostly in geometry the
jsdom bucket could never have reached. The estimate is left as written because it is what
the plan below was sized against; § H is what actually happened.)*

**Deleting an item because a gate replaced it is the practice here**, not a shortcut past
the "merging is not looking" rule: that rule is about a *fix* nobody saw, while these are
questions a test can now answer in full. The mount-height field is the clearest case — its
three states are three sentences, and each one is asserted. What a gate cannot replace is
anything about pixels, and where a residue like that exists the item is narrowed instead
(see the Library item, twice).

### A whole PAGE mounts under jsdom, which is the finding that unlocks the rest

Scoping assumed component-by-component mounting and listed which components carry no
`@react-three`. That list is still right, but it is not the ceiling: **`app/room/[roomId]/plan/page.tsx`
mounts** — the real page, its rails, its shell, its context menu and its own
`{catalogOpen && <CatalogPanel/>}` gate — in **3.8 s**, needing four things:

- `import 'fake-indexeddb/auto'` — the page loads the saved room on mount.
- **`window.matchMedia` shimmed.** jsdom has none, and `lib/use-media-query.ts` calls it in
  a layout effect, so every rail throws before anything renders. `matches: false` is the
  desktop answer; a stacked-rail run would be a different test and would need a browser.
- **`Element.prototype.scrollIntoView` shimmed.** jsdom implements no scrolling at all, and
  `AddPiecesButton` calls it after opening. An absent method throws *inside the click
  handler*, which reads as the trigger being broken.
- **`act()` around anything that is not a React handler.** `openSceneMenu` dispatches a
  window event, so its state update is outside React's dispatch and does not flush before
  the assertion — the `.click()`-versus-`fireEvent` trap one layer out, failing identically
  to the menu row not existing.

What it does *not* reach: `app/room/[roomId]/plan/page.tsx` warms the 3D chunk in a
`requestIdleCallback`, and jsdom has none, so it falls to a 1500 ms `setTimeout` that never
fires in a fast test and whose `.catch` is empty. **Do not advance timers in a page test**
or R3F arrives. `app/room/[roomId]/model/page.tsx` imports `components/three/Room`
statically and cannot be mounted at all.

**Why this matters for the bucket:** a test that re-implements a page's gate goes green on
a page that dropped it. Mounting the page removes that whole class, so the remaining wiring
items should be written against pages, not harnesses.

### What landed, and what each one is worth

- **`tests/mount-height-refusal.test.tsx`** — the mount-height field, which had three
  states and no gate: a piece **taller than the room** (disabled, `aria-invalid`, "there is
  no height it can hang at", and — the user's exact report — typing 120 writes **no**
  position override rather than pinning it to 0); a number **outside 0…max**, told the range
  while it is still being typed, with the bound derived from `MOUNT_PAD` rather than typed;
  and a range **narrower than one step of the display unit**, which is said in words
  instead of quoted as "0–0.0 ft" — that one in **feet**, where all fourteen of this repo's
  earlier bound defects lived, with the fixture's band asserted so it cannot drift into a
  neighbouring branch and pass for the wrong reason. Eight assertions, eight mutations,
  eight reds.
  One thing found in passing and left alone: **`outOfRange` is evaluated before `noRoom`**,
  so a piece already parked above a sub-step maximum is told the range rather than told
  there is no room to move it. Both messages are true; which one a crossed case should show
  is a copy decision, and the first fixture written here tripped over it and read as the
  `noRoom` branch being dead.
- **`tests/library-click-through.test.tsx`** — the half of the Library item no copy test
  could reach: pressing a signpost **opens** the panel. Mounts the real plan page and
  presses the rail's `Add`, the panel's own `X`, and the context menu's *Add from library…*
  row; also holds the panel shut before anything is pressed, so the rest cannot pass
  against a panel nobody opened. **Eight mutations, eight reds**, including the page's gate
  deleted in *both* directions (never render / always render), the trigger made a no-op,
  the heading renamed, the X disarmed, the menu row disarmed, and `aria-expanded` pinned.
  It also settles a wording defect: only **two** of the three signposts are pressable — the
  sun note is a `<p>` — so `visual-check.md` no longer says "press each of the three".
- **`tests/room-tools-findings.test.tsx`** — mounts `RoomTools` and asserts the room panel
  renders the finding `analyzeRoom` computed: the chip's count with the panel shut, the
  sentence itself once it is open, the *opposite* sentence for a piece that can be shrunk,
  that the two are not the same sentence and are not swapped, and that something which
  HANGS is told it cannot hang rather than that it cannot stand. Six assertions, each
  watched failing by mutating `lib/clearance.ts` or `RoomTools.tsx` — never a threshold in
  the test. Removing the finding entirely fails all six.
- **`tests/studio-copy.test.tsx`** — the two pure-copy items. The Library panel's heading,
  all three strings that name it, the help card's group heading naming the two lists rather
  than a side, the absence of any tooltip offering the deleted describe-a-piece feature, and
  the piece list pointing at `Add` by name rather than by direction. Eight assertions, each
  watched failing by renaming the thing it guards.
  **The deleted-feature sweep is derived from disk**, over every `.tsx` under `app/` and
  `components/` — 82 files — with the count asserted before the loop. Its first version
  named seven studio files by hand, which is the same defect the `include` gate below
  exists to prevent: a panel added or renamed later is simply not swept and the sweep
  stays green. It also missed `RoomTools.tsx`, `PlanView.tsx` and all of `app/`. Caught by
  reviewing this PR's own diff, and both halves were watched failing — a forbidden string
  planted in `RoomTools.tsx` (which the hand-kept list did not cover) goes red, and a walk
  that returns nothing trips the count rather than passing vacuously.
- **The `include` pin is the one that matters most**, and it is the reason step 2 grew a
  test it was only asked to "consider". Narrowing `include` back to `tests/**/*.test.ts`
  takes the run from 16 tests to 13 and **reports green**: the `.tsx` file is simply never
  collected. No error, no skip, no line of output. The toolchain gate catches it by
  deriving the `.tsx` files from disk and checking each against the declared patterns —
  and it asserts the count first, because a pattern with no subject would make the loop
  vacuously true.

### Two things the spike found that the scoping had wrong

1. **`fireEvent`, not the DOM's own `.click()`.** React 19 batches, and a raw dispatch runs
   outside `act()`, so the panel was still shut when the assertion looked for its content.
   It fails identically to the sentence not being rendered at all, which is the trap: the
   first reading of that red was "the component drops the finding".
2. **`StudioHelp` renders two different cards and picks by route** — the full one on
   `/model`, a shorter one everywhere else. Asserting against the wrong one reads as the
   copy being missing rather than as being on the other tab. See G.3.

### The toolchain facts — as of `95b28fa`, which is after the harness landed

The first four bullets here read as an open question until a review of this PR's own diff
caught them: they were the **scoping's** facts, written before the work, left in present
tense under a heading telling the next reader not to re-derive them. Every one of them was
falsified by the commit that sits in the same PR. Corrected in place rather than deleted,
because the shape is worth keeping — a hand-off note is a claim, and the most misleading
kind is the one a heading vouches for.

- react / react-dom **19.2.8**, vitest **4.1.10**, jsdom **30.0.1**, vite 7. Unchanged.
- `vitest.config.ts`: `environment: 'node'`, `include: ['tests/**/*.test.{ts,tsx}']`,
  alias `@` to repo root, `esbuild: { jsx: 'automatic' }`. The `include` was
  `tests/**/*.test.ts` before this PR widened it.
- **The old `include` did not match `.test.tsx`**, and JSX will not parse inside a
  `.test.ts`. The choice was widening it or writing every component test through
  `React.createElement`; widening was taken, because the second is a transcript of JSX
  rather than JSX.
- `tests/toolchain.test.ts` **now pins** `include`, `environment` and `esbuild`, the way
  the ESLint >= 9 floor is pinned, because all three fail in the direction that looks like
  success: a `.tsx` test that is simply never collected reports as a green suite. Measured
  — narrowing `include` back takes the run from 16 tests to 13 with no error and no skip.
- jsdom is opted into **per file** with a `// @vitest-environment jsdom` pragma. Keep it
  that way. Do not switch the suite over — `CLAUDE.md` says so and the reason is that the
  pure-logic files have no business paying for a DOM.

### Two findings from the scoping. The first is FIXED; the second still holds.

1. **`vitest.config.ts`'s comment was stale, and it justified a live setting** — FIXED in
   `95b28fa`. It said a test that renders a component — naming `tests/sun-controls.test.ts`
   — imports a `.tsx`. That file did not exist; it went with the sun-mood collapse. So
   `esbuild: { jsx: 'automatic' }` was explained by a file that was gone, and at that point
   **no test imported a `.tsx` at all** — both true then, neither true now. The setting was
   deliberately *not* deleted on that reading, because it became load-bearing the moment the
   first component test landed, which it has. This is the `CLAUDE.md` grep-refutation trap
   pointing the other way: prose that survived its subject, and would have talked the next
   reader into deleting something real.
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

### 3. The help card has two versions and only one of them explains the two lists

`StudioHelp` reads `usePathname()` and branches on `pathname.endsWith('/model')`. The
full card — including the **The two lists** group that tells the user Catalog is in the
left rail and Library is on the right of the canvas — renders on the 3D tab only. On the
2D Plan tab a shorter card renders and that group is absent.

Found by a component test asserting against the wrong one, which is the reason it is
written down at all: the red looked exactly like the copy having been deleted.

**The question, and it is the user's:** the Library trigger is reachable from both tabs,
so a person who opens Help on the plan is told about pieces, panning and keys but never
what the two lists are. That is either a deliberately shorter card or the same
signpost gap `visual-check.md`'s Library item was about, one tab over. Not touched here,
because adding a group to a help card is a copy decision and the item it would serve was
about copy pointing at things that are not there.

**Committed:** nothing but this paragraph and the comment in
`tests/studio-copy.test.tsx` naming it.

---

## H · The user looked at the real thing. Everything here comes from that, and none of it is built.

Seventeen items were put to the user as a numbered list. They have answered **1–15** and
hold 16 and 17, and the split is:

| outcome | count | items |
|---|---|---|
| held — looked at, nothing wrong | **8** | 1–4 (the `aaf2888a` shell four), 6 (a merged set travels as one), 11 (a resized piece keeps its size), 13 (Lock), 14 (the piece name at the narrowest rail) |
| **failed** | **5** | 5 → § 2 + § 3 *(measured)*, 10 → § 4 *(measured)*, 12 → § 5 *(measured)*, 9 → § 8 *(no cause yet)*, 15 → § 6 *(research)* |
| unanswerable — the question itself was wrong | **2** | 7, 8 — corrected in `visual-check.md` and still open. Item 8 threw off two findings anyway: § 8 and § 9 |
| not yet checked | **2** | 16, 17 |

So "failed" is not one kind of thing, and the fourth column is the part that matters: **three
have a mechanism and a number** (§ 2 – § 5), **one is an observation with no cause yet**
(§ 8), and **one is a research task** (§ 6). Everything below is one of those three, plus two
changes the user asked for outright (§ 1, § 10) and one more measured defect that came out of
a question they could not answer (§ 9).

**Two of the questions put to them were wrong**, which is worth more than the answers: one
named a **bench**, which is not in the catalog at all — `grep -in bench` over `lib/`,
`components/` and `app/` returns two comments and no part — and one told them to press **E**
and **R** to rotate and scale, where **E orbits the camera** and the gizmo modes are W / R /
S. The bench item was answerable anyway because they substituted a couch. The keys item was
not, so that gesture is still unlooked-at and `visual-check.md` now carries the correction
beside it. A hand-off list is a claim, including when this session wrote it.

### 1. The Inspector's "Where it sits" row is three buttons wide and two of them are one button — FIXED

The user's words, having looked at the real thing: *the section seems redundant now and it
takes too much horizontal space.* They offered three ways out — remove it, merge Floor and
Surface "since they're basically the same", or icons only with no text — and asked for one
of them to happen.

**They are right about the merge, and it is provable rather than a matter of taste.**
`components/studio/Inspector.tsx`:

```
groundToFloor():  setPosition([x, 0, z]);          clearParent()
snapToSurface():  support = findSupportDetailed(...)
                  setPosition([x, support?.y ?? 0, z]);  support ? setParent : clearParent
```

With nothing under the piece, `snapToSurface` **is** `groundToFloor`, line for line. They
differ in exactly one case: something IS below, and you want the piece on the floor rather
than on it. That case is real — a vase off a table without moving it in x/z, which no drag
can do, since dragging it off changes where it is — but it is rare, and it is the only
thing the third button buys.

**So the fix is to derive the button rather than delete the capability:** show **Floor**
only when `findSupportDetailed` finds a support, which is precisely when it is not a
duplicate of Surface, and size the grid to however many buttons there are — two, at 50%
each, in the ordinary case. The gate must call `findSupportDetailed` with the *same*
arguments `snapToSurface` uses, or the button can appear when the action would do nothing.

Then drop the `Where it sits` label with it. `Section` is a plain label, not a disclosure,
so nothing needs a heading to be clickable, and each button already carries a title that
says more than the heading does. Keep the `.section .section--flush` wrapper for the
spacing rhythm, and keep `rail-triple` — `app/globals.css:533` reflows it to `1fr 1fr`
on a narrow rail, which is a second reason not to hand-roll the columns.

**Not icons-only.** Three icon+word buttons at 33% each is what does not fit; two at 50%
does. Stripping the words to fit a third button that should not be there solves the
symptom and keeps the cause — and an icon-only control then owes an accessible name on
focus, which is a new obligation taken on for nothing.

**Nothing is committed.** `grep "Where it sits"` finds one live site
(`Inspector.tsx:216`) and no test, so this is a contained change; the two comments above
that JSX explain why wall-mounted parts get the mount-height row instead, and that half
stays exactly as it is.

### The measurements below

Taken at `4b7fe7f` with a throwaway vitest probe, since deleted — every number is
reproducible by calling the functions named, and each one says which function produced it.
Nothing here needed a browser; the user's report is what said where to look.

### 2. A wall-hugging piece is clamped by its UNROTATED extent and then rotated — 200 mm into the plaster — FIXED

The user, having looked: a bed dropped at a wall *"clips through the wall."* It does, and
only on two of the four walls.

`placeNewPart` (`lib/scene-spec.ts`), 6 × 4 rect, bed 1600 × 2000, dropped at each wall:

| drop | committed | yaw | x or z span | wall at | through the plaster |
|---|---|---|---|---|---|
| west | `x = −2.200` | **+90°** | `[−3.200, −1.200]` | `−3.000` | **200 mm** |
| east | `x = +2.200` | **−90°** | `[+1.200, +3.200]` | `+3.000` | **200 mm** |
| north | `z = −1.000` | 0° | `[−2.000, 0.000]` | `−2.000` | none |
| south | `z = +1.000` | 180° | `[0.000, +2.000]` | `+2.000` | none |

`intoRoom` insets the drop point by `dimMM[0]/2000` and `dimMM[1]/2000` — the half-extents
**before rotation** — and the yaw is chosen afterwards, by `snapToWall`, on the line that
returns. A bed inset by its 800 mm half-width and then turned 90° needs 1000 mm of inset,
so it keeps the 200 mm difference and spends it inside the wall.

Why it survived the fix that introduced it: on the north and south walls the yaw is 0 or
180°, where the unrotated extents **are** the rotated ones. That is the symmetric case, and
CLAUDE.md's own rule says a sign or a handedness is invisible in it. It hits every
non-square piece with a wall affinity — bed, sofa, wardrobe, desk, bookshelf — on an east or
west wall.

`resolvePlacement` one file over already had the right arithmetic:
`extX = halfW·|cos| + halfD·|sin|`. So the fix was not new maths.

**What landed.** `aabbExtents` — which already existed, in `lib/item-snap.ts`, of all
places — moved to `lib/geometry.ts` and is now the **one** home for this expression:
`drag-resolve.ts` had written the same four lines out inline and `placeNewPart` had no
rotation term at all, so a primitive with three consumers was living in the magnetism
module and being re-derived by two of them. (`layout-score.ts` keeps a fourth copy on
purpose — typed arrays, innermost solver loop — and says so.) `intoRoom` takes a `rot` and
insets by that, and `placeNewPart` resolves the **yaw before the clamp**, which needs two
passes: one rotation-blind, whose only job is to bring a drop released outside the room to
somewhere inside it so `snapToWall` is asked about a wall of this room, and then the real
clamp at the angle the piece is actually getting.

**Three assertions, in `tests/wall-parts.test.ts`, and the fixture decision is the whole
point:** a 1600 × 2000 **double**, at all four walls. The three tests already there use a
900 × 2000 single and assert only `rot`, so none of them could see this — and a piece whose
plan is square cannot express it at all. All three were watched failing, and the
containment one reports the west wall with a difference of `0.19999999999999996` m.

One thing that came out of writing them and is worth keeping: the polygon test on an
**exactly flush** piece is a coin toss. A bed clamped flush to the north wall of a 6 × 4
read *inside*; the mirror placement at the south wall read *outside*. Both flush, opposite
answers, decided by floating-point noise in how each corner was reached. That is what
`resolvePlacement`'s `slightlyShrunk` (10 mm off each plan axis) is for, and the test uses
the same box for the same reason rather than inventing a tolerance.

**Six mutations, all red:** the unrotated extents restored; the yaw resolved after the
clamp again; `aabbExtents` with its axes swapped; `aabbExtents` with no rotation term;
`intoRoom` clamping every drop to the middle of the room; and nothing ever turned. A
seventh was written and came back GREEN — `const wantsWall = false && affinity === 'must-wall' || …`
— which was the **mutation's** fault and not the test's: `&&` binds tighter than `||`, so it
still evaluated `affinity === 'prefers-wall'` and a bed was still turned. A mutation that
does not mutate reads exactly like an assertion that cannot fail, and the only thing that
tells them apart is checking what the mutant actually says.

### 3. Clicking a Library item drops every piece on the same spot, facing the same way — the false comment is fixed, the behaviour is a decision

Same probe, three beds added the way the **click** path adds them — `spawn()` calls
`placeNewPart` with no `at`, so `ax = az = 0`:

    bed #1: pos=[0.000, 0.000, 0.000] rot=0.0deg
    bed #2: pos=[0.000, 0.000, 0.000] rot=0.0deg
    bed #3: pos=[0.000, 0.000, 0.000] rot=0.0deg

Identical, all three. So the user's *"they indeed face the same way on drop"* is the **click**
path, and the `4cec92b` fix — take the yaw from the nearest wall — can only work where the
pointer named a spot. From the room centre the nearest wall is the same wall every time.

The second half is a doc that is simply false. `spawnMany`'s comment says:

> Placed one after another rather than in parallel: `placeNewPart` reads the parts already
> in the room, so each piece avoids the one before it and four chairs land as four chairs
> instead of one chair four times.

`placeNewPart` reads `existing` in exactly one place — `findSupportUnder`, and only when
`isTabletopProne(cat)`. A chair is not tabletop-prone. **Four chairs land as one chair four
times**, and the comment beside the loop said the opposite. Two sources of truth, and the
prose is the one the next reader believes.

**The comment is fixed** — it now states what the code does and points here. The
*behaviour* is left alone deliberately, because "adding several should spread them out" is a
product decision with at least three defensible answers (spread along the nearest wall, fan
out from the drop point, or leave them stacked and let Shuffle sort it), and picking one
quietly inside a defect fix is how the last one got here. Same for the yaw: from the room
centre there is no wall to take a heading from, and inventing one is a guess in an answer's
clothes.

### 4. A drop into an L / T / U's missing quadrant lands outside the house — ROOT CAUSE FOUND, and it was not the add path

The user: a TV spawned outside the wall in an L, a couch did the same in a T, and *"rug sits
outside of the wall, seems it has no constraints in both plan and model mode."*

**This section's original diagnosis was right about the symptom and wrong about the cause,
and the correction is the useful part.** It said the add path skips containment, named
`clampIntoFootprint` + `contain` as the fix, and treated the deferral as a scope decision.
Measuring it first found something underneath: **`contain` could not have worked in a U no
matter who called it**, and neither could `snapToWall`. See § 11, which is the fix and has
landed.

The measurement that says so — each piece dropped at a point inside the bounding box and
outside the room, then run through `settleParts`, the pass whose entire job is to pull a
piece back inside:

| room | piece | outside before settle | outside AFTER settle |
|---|---|---|---|
| L 6×4.7 | sofa | 32.7 % | **0.0 %** |
| L 6×4.7 | coffee table | 40.8 % | **0.0 %** |
| T 5.5×4.7 | sofa | 51.0 % | **0.0 %** |
| T 5.5×4.7 | TV | 100 % | **100 %** |
| U 6×5 | sofa | 57.1 % | **57.1 %** |
| U 6×5 | rug | 57.1 % | 14.3 % |
| U 6×5 | TV | 100 % | **100 %** |

The L is fixed by the settle pass and always was. The U is not fixed at all, and the T's TV
is not fixed, and those two facts had one cause: every inward normal in this app was decided
by flipping an edge's perpendicular toward `polygonCentroid`, the average of the CORNERS,
which on the U sits in the notch — outside the floor. So `contain` pushed a piece hanging
over such a wall further OUT, and `snapToWall` put a wall rider on the far side of the
plaster. With that fixed the settle pass can do its half.

**What remained of the original plan is DONE, and not the way this paragraph prescribed.**
It used to say the *add* path called no containment at all, that `intoRoom` in
`placeNewPart` did the bounds inset "and only that", that `tests/wall-parts.test.ts`
asserted as much by name in two places, and that doing it properly "still needs the pair —
`clampIntoFootprint` for the centre, `contain`-style extent containment for the piece".
Every clause of that is now false. `intoRoom` calls `containedXZ`, the two named
assertions are flipped and joined by three more, and **the pair was declined**: the
footprint answer alone is exact, so a second centre-only clamp would have been the third
copy of containment rather than the missing half. Landed in `fix/add-path-containment`.

Kept because it is the only place the reasoning is written down: `clampIntoFootprint`'s
own recorded blocker really was retired by § 11 — it said changing `polygonCentroid` would
change every wall's normal, and after the winding fix it no longer would.

Three things the add path's containment turned out to need, none of which this paragraph
anticipated, all of them measured rather than reasoned:

· **Rank walls by DEFICIT, not by distance.** `nearestEdge` orders walls by how far the
  piece's CENTRE is from each; what a push has to clear is the piece's extent along that
  wall MINUS how far in it already is. The two agree only for a square piece. A 1200 × 600
  wardrobe dropped flush into a 6 × 4 corner came back **240 mm / 170 mm out**, and
  500/460 in a 12 × 10 — because the displacement was a fraction of the room, not a length.

· **A round piece is an ELLIPSE, not its bounding box.** `obbExtentAlong` overstates a
  1200 mm round piece's reach at 45° by **248.5 mm**, so the shortfall was positive for a
  piece already correctly placed and it was pushed 249 mm further in, every settle.
  `footExtentAlong` is the one that honours `circle`, as `escape` already did.

· **The ceiling family is not a wall rider.** `settleParts` exempted anything with
  `wallMounted` from containment — correct for a door, whose footprint sits on the boundary
  by design, and wrong for a fan, which rides nothing and had no other way back into an
  L's cut-away quadrant.

**Still open, and it is the drag path, not the add path.** `WALL_GAP`'s own docblock says
every path that puts something against a wall has to agree on it. Three now do — seed,
solve and add all leave 20 mm. The fourth does not: `lib/drag-resolve.ts` sends only
`ridesWall` pieces to `snapToWall`, so a floor-standing piece dragged to a wall is clamped
by a bare bounding-box `Math.max(bnd.minX + extX, …)` with no gap and lands **flush**.
Measured in a browser: a 2400 mm wardrobe walked into the west and north walls of a 6 × 4
room with the arrow keys reports `-1.80 across and -1.70 back`, whose edges are exactly
−3.00 and −2.00. So the same wardrobe is 20 mm off the wall if the app placed it and 0 mm
off if you pushed it there. Pre-existing — `drag-resolve.ts` has never referenced
`WALL_GAP` — and it is a decision rather than an obvious bug: for a drag, stopping where
the user pushed is arguable. Whoever settles it should settle it for all four paths at
once, which is what that docblock asks for.

The rug is the same defect and **not** the documented exemption. `lib/drag-resolve.ts` holds
a *dragged* rug's centre to `pointInFootprint` — that narrow fix is already in, and the
overhang past the skirting is deliberate — while the *add* path now runs the rug through
`containedXZ` like everything else. So "the rug has no constraints" is false of both paths
now; what is left is whether a rug SHOULD be contained, which is a look, not a bug.

### 5. The 3D tab computes the refusal the plan paints red, and clears it on the same tick — FIXED

The user: a couch *"is cutting through the walls instead of being constrained."*

`turnInPlace`, sofa 4000 × 900 turned 90° in a 6 × **3** room:

    pos.z = 0.500, spans z = [−1.500, 2.500], room z = [−1.5, 1.5]
    valid = false, overhang = 1.000 m

The overhang is deliberate and `PlanView` says so in its own comment — *"the turn is TAKEN
either way — refusing an invalid frame would make a piece in a tight spot unturnable"* — and
then it sets `blockedIds([part.id])`, so the plan outlines the piece in red and holds it
there.

`Draggable.commit()` reaches the identical placement through its invalid-drop fallback and
then ends with `setDragInvalid(false)` and `setLive(null)`, **unconditionally**. The
refusal is computed and discarded in the same function. One rule, two consumers, and 3D is
the one that drops it — the exact scar `blockedBy` was added to close, one gesture over.

A second thing that branch gets wrong, in its own words: it claims the re-resolve *"comes
back legal by construction from both branches."* True for a **translate**, where `back` is a
spot this piece already stood in at this angle and size. False for a **rotate or a scale**,
where `back` is where the piece is standing and the only thing that changed is the extent
being tested against the walls. The 1.000 m above is that case, committed silently.

`docs/visual-check.md` had this asymmetry written down and called it *"a separate decision,
not a defect in this fix."* The user has now made the decision.

**What landed.** `lib/refusal.ts` — `refusalAfterGesture()` plus `REFUSAL_HOLD_MS`, and both
surfaces read it. It is a module rather than four lines in `commit()` for two reasons, and
the second is the one that matters: the rule was already written out in the plan and in 3D's
live-drag path, so a third copy was the wrong direction; and a decision living inside an R3F
component **cannot be tested at all** without a WebGL context, which is exactly why
`lib/drag-click.ts` is not in `store.ts`. `Draggable.commit()` now asks that function and,
when the answer is not null, holds the live channel — the same channel every refused piece
already reads through its own per-part selector, so the whole set goes red exactly as it does
mid-drag — then clears on one timer. `PlanView`'s turn asks the same function, and its bare
`500` is now the shared constant.

**Eight assertions, nine mutations, all red:** never a refusal; always a refusal; the convoy
ignored; the dragged piece ignored; the member name kept when the dragged piece is itself the
problem; the dragged piece dropped from the outline set; the dedup removed; the hold cut to
one frame; and `turnInPlace` refusing the turn instead of taking it. The measurement is
pinned too — a 4 m sofa turned 90° in a 6 × 3 room overhangs `1.0` m to six places, with a
2.4 m sofa as the negative control, so a change that quietly starts clamping harder shows up
here as a failing number rather than as a piece that cannot be turned.

**What is NOT verified:** that the red actually appears on screen for those 500 ms. The
decision is tested; the wiring from it to a tinted mesh is three lines in an R3F component
and no test in this repo can see them. It is a new item in `visual-check.md`.

Two things found while fixing it, both stale prose that had cost something already:
`Draggable.tsx`'s own header said the gizmo was *"W=move E=rotate R=scale"* — wrong twice, and
it is where this session's bad hand-off question came from — and `Design.md` gave the snap
angles as `fine` 2.5° / `coarse` 7.5° where `snapSteps` has always returned **15°** and
**45°**. Both corrected, and `Design.md` now names the real keys instead of "Maya-style
modes", since the vagueness is what let the wrong version stand beside it.

### 6. Research: Suggest, from the ground up — the user's explicit ask

Four observations, all the user's, all landing in the same place:

- a merged dining set solved with **one chair hanging in the air**, no floor under it;
- a chair put on a couch, then Suggest, ends **through a wall**;
- a couch a few degrees off square is turned to face **away from the TV** it should face;
- and generally, *"suggest doesn't really seem to know what to do with groups and their
  rotations."*

Their instruction: *"we really need to work on that research and look at the algorithm from
ground up."* This is now the largest open thing in the repo, and it **subsumes** § A.2
(nothing prices variety), § A.3, § A.7 (`snapYaws` leaves 197 of 240 solves crooked) and
§ G.2 (the anchor pass helps two presets and hurts one). Those are four symptoms of one
design that was never designed.

What § A already settles, so the research does not re-derive it: the cost terms exist, two
consumers read them, and `tests/layout-conformance.test.ts` holds those consumers to each
other; `RULE_HANDLING` is production knowledge, not a fixture; and the solver already ends
on `layout-settle`. What is **missing** is three things, and each maps to one observation
above:

1. **Nothing prices support.** A chair needs floor, or a seat, under it. The solver scores
   an `(x, z, yaw)` and `findSupportDetailed` is not in that loop — hence the chair in the
   air, which is not a near-miss but a placement the cost function cannot see.
2. **Nothing prices a relation between two pieces** beyond wall affinity. Couch↔TV,
   table↔chairs, bed↔nightstand. `lib/layout-rules.ts` has `zone`s that describe what a
   piece needs *around* itself; there is no term for what it needs to *face*.
3. **A group is not a unit.** N members are placed as N pieces, so a merged set can be
   solved into a shape it was merged specifically to prevent.

### 7. Research: collision, properly — and the user is open to replacing the engine

Their words, kept because the scope is theirs: *"Do a detailed search to the fundamental
workings of collision generation, simple versus complex collision, and custom collision
hulls for both static meshes and Blueprints, check unreal engine, unity, blender and similar
resources for a better understanding. I'm open to overhauling the current logic/engine if
need be. If we need to build a proper engine and structured algorithm too, that's fine."*

The baseline to research against, so nobody has to reconstruct it: every piece is **one box**
in its own frame (`obbFromPart`) or **one ellipse** (`footFromPart`, when `part.circle`),
tested by separating axes (`obbOverlap`) with a −10 mm pad, plus a vertical-extent test in
`collidesAt` that permits stacking. There is **no per-shape hull anywhere**: a sofa's L, a
dining table's legs, a curtain's drape and a plant's canopy are all the same rectangle. That
is why a chair only tucks under a table by the width of the pad, and why the solver's overlap
term is coarser than what the user can see on screen.

Two properties of the current design are worth carrying into any replacement, because both
were bought with defects: the footprint is **derived from `dimMM`**, so it recalibrates on a
resize for free, and a round piece is tested as an **ellipse rather than its box** — which
`lib/plan-hit.ts` also does for picking, so the thing you can click and the thing that
collides agree.

### 8. Two reports that need a real repro before they can be fixed

**A group drag bounded by the dragged piece's rules rather than the set's.** The user:
dragging a merged bed with a nightstand on each side is blocked toward the side the
nightstands are on.

The obvious mechanism is **refuted, by measurement**. `travelWorld` shifts the travelling
company by the **raw pointer delta** while `resolvePlacement` accepts a snapped one, which
looked like it would let the lead collide with its own company. Measured on bed + two flush
nightstands, asking for +137 mm:

    snap=off     rawDx=137.0mm  acceptedDx=137.0mm  skew=0.0mm  valid=true
    snap=fine    rawDx=137.0mm  acceptedDx=137.0mm  skew=0.0mm  valid=true
    snap=coarse  rawDx=137.0mm  acceptedDx=137.0mm  skew=0.0mm  valid=true

Zero skew at all three settings, because `snapToNeighbors` runs **after** the grid snap and
pulls the lead flush against the very company that travelled with it. Worth keeping on its
own account: **a flush travelling neighbour silently defeats the grid snap**, since the
magnet wins and lands the lead exactly on the raw delta. Coarse snap is a 50 mm lattice and
this drag ignored it.

So the block is something else. The likeliest remaining candidate is the containment clamp
bounding the **lead** by its own extent while a **member** is the piece that runs out of
room — in which case the set stops where the *nightstand* meets the wall and the piece named
is not the piece under the hand, which would match the report exactly. Not settled. Needs a
real drag.

**Clicking a merged set drills in from a nightstand but never from the bed.** And, second
half of the same report, after clicking away a nightstand click acts on that piece alone
where it should select the whole set again. `selectionForPick` is **symmetric** — it has no
notion of which piece — so the defect is not in that function; it is in what `current` holds
when the click arrives. Needs a real click sequence, on both tabs, with the store read
between clicks.

Both are DOM-reachable on the **2D plan**, which is SVG with real elements and is the cheap
way in. The 3D tab needs world→screen mapping to place a synthetic pointer.

### 9. Room previews are all drawn as rectangles — FIXED

The user: *"Room previews should be room shape accurate, they all look like rectangular
rooms atm."*

`PlanThumb` drew `<rect>` from `room.width` and `room.depth` and **never read `layoutId`
or `footprint` at all** — so an L, a T and a U were the same picture, and furniture standing
in the quadrant an L cuts away looked like it was on the floor. It draws the polygon now,
from `room.footprint ?? footprintForLayout(room.layoutId, W, D)`, and its `aria-label` names
the shape when there is one to name.

**The order of that fallback is the fix, not a detail.** `footprint` is only written after a
wall has been dragged, so reading only `footprint` would have looked right in a diff and
changed nothing for almost every room in existence. `layoutId` is always there.

Two more things came out of it. The fit now reads the polygon's **bounds** rather than
`±W / 2`, which is the same correction `resolvePlacement` carries: after independent wall
moves a footprint can be off-centre, and the old origin put such a room's far wall outside
the 240 × 150 picture. And `MiniPlan` in `RoomTools.tsx` — the other plan thumbnail in this
app — was **already** drawing the polygon against the bounds, correctly. Two previews of the
same thing, one right and one wrong, which is this repo's most-repeated shape; the fixed one
now matches the one that was never broken.

**Five assertions, seven mutations, all red** — and two of those mutations survived the first
attempt, both because of the FIXTURE rather than the assertion:

- the T-room test stored `footprintForLayout('t', …)` on a room whose `layoutId` was
  already `'t'`, so honouring the override and ignoring it gave the same eight vertices.
  Deleting the override entirely was green. It stores a five-vertex polygon now.
- the off-centre test shifted x only and left z symmetric at ±2, so reverting the z mapping
  to `z + D / 2` was green. It is off-centre on both axes now.

Both are the failure this repo already names — *"every test for that function used a
rectangle, where the vertex average IS the true centroid"* — reproduced in a file written
the same hour as the fix. Which is the argument for mutating, in one paragraph: the
assertions were real, and the fixtures could not express the defect.

**NOT verified:** that the shape reads correctly at 240 × 150 with furniture drawn over it.
An item in `visual-check.md`.

### 10. Undo / redo should cover selection — a decision, not a defect

The user: *"undo and redo should track selections too, so that you can undo a selection or
redo a selection."* Today `lib/history.ts` tracks the transform and scene maps; selection
lives in `useStudio.selection` and is not on the undo stack.

Flagging one consequence before building it, because it is the reason most tools do **not**
do this: if every click is an undo step, walking back to the move you actually want to undo
costs one press per click you made on the way. The usual answer is a **separate** history for
selection (a back/forward through selections, not entries in the main stack), or coalescing
runs of selection changes into one entry. Which of those the user wants is their call.

---

### 11. Every inward normal in the app was decided by a point that cannot see the wall — FIXED, LANDED, and it cost the solver

**The defect.** Three functions answered "which way is into the room", and all three did
it by flipping the edge's perpendicular toward `polygonCentroid` — the average of the
polygon's CORNERS. Exact for a convex room, wrong for the shapes this app ships, because
the point has to be able to **see** the edge. Swept over the five presets at the sizes the
picker offers, **5 of 30 walls came back backwards**:

| room | wall | why |
|---|---|---|
| T 5.5x4.7 | edges 2 and 6 — the arms' south walls | the corner average is inside the room but on the far side of those walls' lines |
| U 6x5 | edges 1, 2, 3 — the notch's three walls | the corner average is at (0, −0.625), **in the notch, outside the floor** |

Plus one in a dragged off-centre custom room. **The L is entirely correct under the old
predicate** — its corner average sees all six of its walls — so a test sweeping a
rectangle and an L would have shipped green, which is how this survived three separate
encounters. It was also **predicted in writing three times** before anyone fixed it:
`wallOutwardNormal` had already been fixed this way and its docblock quotes the same
2-of-8 / 3-of-8 count; `lib/scene-spec.ts` named `wallSegments` as the survivor; and
`lib/layout-score.ts` said outright that *"the exact answer is the polygon's winding, and
it belongs in `edgeProjection` rather than here."*

**The fix.** `polygonWinding` in `lib/geometry.ts`, one shoelace for the whole repo, read
by `edgeProjection` / `nearestEdge` / `wallSegments`. The solver's cached `edgeCentre`
point becomes a cached `1 | -1`.

**SEEN in a browser, A/B, with a control.** Headless Chromium over SwiftShader, three
preset rooms created through `/onboarding/layout-pick`, zero console errors on six shots:

| preset | before | after |
|---|---|---|
| T 5.5x4.7 | **a wall standing in the middle of the room**, drawn opaque and lit toward the camera, hiding the dining arm and most of its chairs | gone |
| U 6x5.0 | the **notch is open** — you see through where its three walls are, to bare floor — and the east return is a detached unlit slab | a closed shell, notch walls present and lit from inside |
| L 6x4.7 | — | **structurally identical** |

The L is the control and it is what makes the other two evidence rather than two
screenshots. Do not compare these by image hash: SwiftShader is not bit-deterministic
across processes, so all three pairs differ at the pixel level and two of the three
differences are real. The route is in `docs/visual-check.md`.

### …and the part that is a finding rather than a fix

**Correcting the normals makes Suggest worse on the U.** Measured on the landing commit,
`scrambledU` in `tests/layout-solve.test.ts`:

| | before | after |
|---|---|---|
| clean seeds (no hard term) | 12 / 12 | **7 / 12** |
| worst total cost | 38.53 | **92.10** |
| U 6x5 shipped bed, sum of danger over 12 seeds | 0.00 | **118.06** |
| seeds stranding any floor | 0 of 12 | **5 of 12** — 36.00, 5.10, 2.10, 74.10, 0.76 |

Three derived facts kept that from being mis-read, and each took a measurement rather
than an argument:

1. **The scorer did not change its answer; the solver's answer did.** The old tree's
   placements were dumped to disk and re-scored with the NEW scorer: `navigation` stays
   0.00 on every seed. This is not "a checker stopped being blind".
2. **No room is unsafe.** Term by term across all twelve seeds, `outside`, `door` and
   `walkway` are **0.00 everywhere**. The whole cost is `navigation` — floor a person
   cannot walk to.
3. **The old clean sheet was partly bought by mis-modelling the room.** Ground truth
   improved wherever it moved: worst outside-share 61.2% → 42.9%, and the count of pieces
   whose CENTRE sits outside the room 1 → 0. A piece parked in the notch strands no
   walkable floor, because it is not on the floor.

**So the annealer is tuned against wall normals that were backwards on 5 of 30 preset
walls.** That is the starting condition for § H.6, not a reason to revert the geometry.

**How the seven reds were resolved, because "six marks against seven reds" reconciles
only if you know which one is the seventh.** Six are parked with `it.fails`, which is
self-retiring: each goes RED the moment it starts passing, so improving the solver forces
whoever did it to come back and unmark rather than quietly collecting a green. The
seventh was not a mark at all — see below.

- **Two `it.fails` were one number.** `bed-rung-safety`'s `danger < 10` and its
  `danger === 0` assert the **identical expression**, and `=== 0` implies `< 10`. Marking
  both would have recorded one measurement twice and pinned nothing, so the weaker one
  became the **regression baseline** carrying the measured 118.06 and the stronger one
  kept the claim and the mark.
- **One test was half true and was split.** "…and every rung above it produces a finding"
  held two claims; only *the shipped rung is clean* stopped being true. *The ladder comes
  down for a reason* — every wider rung over 50 — still passes and carries the file's
  whole argument, so retiring the pair would have thrown it away. Each half is now named
  for its own claim.
- **The seventh was a STALE FIXTURE, not a false claim, and marking it would have
  disarmed a guard.** `suggest-tidiness`'s "…on a fixture where the proxy really does hand
  back something worse" asserts `openRoutes` returned its input by identity — that the
  fine-grid re-check *refused* the coarse proxy — and it is the only assertion guarding
  that path at all ("delete that re-check and this is the assertion that goes red"). The
  re-swept population is **identical**: scramble 35 still cut by 7.055, input still
  1921.50, still 19 of 54 scrambles cut, still 532 trials, **still exactly 3 refusals, all
  three on scramble 35** — only the seeds moved, 19 / 22 / 26 → 6 / 12 / 22. So the count
  is now asserted, all three seeds are pinned, and the specimen is seed 22 by this file's
  own pre-existing continuity tie-break rather than a fresh one. **Nothing was selected
  for making the assertion pass**, which is the trap the obvious fix walks into.
- **Every parked bar was left where it was.** `layout-solve`'s clean-seed bar is 11
  *because two mutations survived at 7*; widening 60 to clear 92.10 would record the
  regression as the requirement. The baselines are pinned **exactly**, so an improvement
  goes red too — a `<=` would sit green while the numbers drifted in the good direction
  and nobody would re-derive.

**Two comments were describing a program that no longer exists**, and both were corrected
forward rather than deleted, because a bar with no argument is worse than a bar with a
wrong one — the wrong one can be caught. `layout-solve`'s said *"at 12 of 12 clean there
is no hard term left in any of these totals, so a total-cost bar cannot fail on danger
here even in principle"*; at 7 of 12 the worst total is 92.10 of which 74.10 **is**
danger. And `bed-rung-safety`'s docblock quoted medians 15.91 / 15.12 / 10.46 and "no
trade exists at this room at all"; the real medians are 16.75 / 20.78 / 16.74 and the
shipped rung is still the tidiest and much the safest but is no longer clean.

**One measured fact for § H.6 while it is in front of us:** the `outside` cost term reads
**0.00 with a bedside lamp 61% outside the room**, because supported tabletop pieces are
exempt from it. So "nothing prices support" has a second half — **nothing contains a
supported piece either.**

## What in this document has been in a browser, and what has not

The heading here used to read *"nothing in this document has been in a browser"*. That is
now false in both directions and the distinction is the useful part.

**Seen by the user, in a browser, on their own machine:** everything in § H. Fifteen of the
seventeen items put to them, which is where every defect in § 2 – § 5 and § 9 came from.
Their report is the *observation*; the mechanism and every number beside it is arithmetic
this session did afterwards, from the functions named.

**Not seen by anybody:** everything in § A – § G, § H.1's replacement row, and the two
repros in § H.8. The four items still live in `visual-check.md`.

That boundary is the reason § H.8 says "needs a real repro" rather than proposing a fix: two
of the user's reports have a plausible mechanism and no measurement, and one of the two
plausible mechanisms this session did measure came back **refuted**.

The desktop half of both is reachable with `pnpm build && pnpm start` and no login. What
worked, so nobody re-derives it: **Playwright with Chromium, installed outside the repo**
so `package.json` is untouched, driving `next start` on a spare port. Headless needs
`--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader` or the WebGL room is
a blank rectangle; with them the 3D scene renders and screenshots. Onboarding is
`/onboarding/layout-pick` → **Start decorating**, which creates a room and lands on
`/room/<id>/model` with a 6.0 × 4.0 living room of twelve pieces, and the console is
clean. One snag: `page.screenshot()` can exceed a 30 s timeout while the canvas is live —
raise the timeout rather than reading it as a hang.

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

## `main` is red on purpose. Here is the whole list.

**5 failed, 1612 passed, 82 files** on `fa12f1a`, with typecheck 0 and lint 0 — measured on
the merge result before it landed, not on a branch. Every failure is attributed to a cause
below. **A sixth is new, and is somebody's regression.**

The count moved and the failures did not: it was 5 / 1595 / 81 at #26, and #29 added 17
assertions. **Reconciling the arithmetic is part of the check** — 1600 + 17 = 1617 = 1612 + 5.
A red list is only a baseline if the passing count is accounted for too, or a test that
silently stopped being collected hides inside an unchanged failure count.

**And the file count has to travel with it, or the arithmetic still closes over a hole.**
`1600 + 17 = 1617 = 1612 + 5` would hold just as well if an entire test *file* stopped being
collected and its assertions were replaced one-for-one elsewhere. **`82 files` is what rules
that out** — the same class of gap the arithmetic catches, one level up, and the reason all
three numbers are quoted here every time rather than the failure count alone.

| test | item |
|---|---|
| `bed-rung-safety` › *refuses, at U 6×5, every rung above the one that ships* | 1 |
| `bed-rung-safety` › *still keeps the worst case bounded once the ladder has chosen* | 1 |
| `layout-solve` › *stops a scrambled bedroom from ending in the occasional disaster* | 6 |
| `suggest-tidiness` › *runs the repair pass on every seed* | 3 |
| `suggest-tidiness` › *…on a fixture where the proxy really does hand back something worse* | 3 |

**Why red was the right trade.** Two of these are a **new test naming a defect that was
already on `main`**; one is a guard correctly reporting that its own fixture has gone
vacuous; one is a bar that must stay red until it can fail. Holding a correct fix out of
`main` to keep the suite green would be a green bought by not looking — the same defect this
repo already calls *a check that cannot fail*, one level up. **A red that names a real
defect beats a green that hides one.**

What it costs is the ability to read `main` as a signal, which is exactly why the list is
here and not in a commit message.

---

## A · Research — nobody has measured these

### 1. `clampIntoFootprint` aims every rescue at one point in a non-convex room

**The biggest open item, and it is live on `main`.**

`clampIntoFootprint` steps from an outside point toward `interiorPoint(poly)` in 0.15
increments and returns the first hit inside. `findInteriorPoint` takes `polyAreaCentroid`
and, when that is outside the polygon — **which on a U it is, it sits in the void between
the arms** — grid-probes for the interior cell *closest to it*. On a U that is the middle
of the base. So every clamp in that room aims at the same point in the throat.

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
`walkway` are **exactly 0.00 before and after**; the entire delta is `navigation`, which is
0.00 on ten seeds, 5.40 on one and **80.70 on seed 5**. A threshold that is merely tight
looks like every seed creeping up. This is eleven seeds untouched and one layout sealing a
route.

**Why a correctness fix made arrangements worse.** The old code walked toward
`polygonCentroid` — the vertex average — and when every step of that walk was also outside
it returned that void point. The piece came out *outside*, and `contain` in
`layout-settle.ts` then pushed it out along the inward normal to somewhere with room. The
new code lands it legitimately inside, in the one place that seals the route.

**Unknown:** whether the right operation is a **nearest-interior projection** — move the
point the minimum distance that puts it inside, so a piece returns to the arm it came from
rather than being railroaded into the base. That is a design change to a shared primitive,
not a small edit.

**Do not measure this from a mixed tree.** Old `footprint.ts` grafted onto `main`'s other
four engine files makes `layout-solve.test.ts:473` fail and the anchor test at `:901` pass
— the mirror image of the shipping configuration. Nobody ships that program and neither
result means anything. The only trustworthy runs are all-of-main and
all-of-main-minus-`footprint.ts`.

**Committed:** the finding is not. `tests/bed-rung-safety.test.ts` is, on
`fix/a-bed-that-was-rotated`.

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

### 6. The anchor-first test wants moving from the U to the T

Measured over four shapes, 8 seeds, mutation = `anchorIdx` forced to `[]`:

| shape | anchor | worst with | worst without |
|---|---|---|---|
| rect | sofa | 16.58 | 16.15 |
| l | sofa | 20.60 | 25.19 |
| **t** | sofa | **56.33** | **267.68** |
| u | bed | 26.98 | 20.93 |

The T is what the pass is for. Medians are worse with it everywhere, which is the designed
trade. The U now reads *better* without the pass because the bed fix made its anchor easy —
so the U has stopped demonstrating anything and the test should move to
`footprintForLayout('t', 6, 5)`. Its current comment quotes "154.7 without, 6.9 with",
measured on the transposed bed and now dead.

**Related and separate:** `layout-solve.test.ts:901` is red and must stay red for now.
Bumping its median bar 10 → 20 turns it green while leaving an assertion that **survives
mutating `anchorIdx` to empty** — a green that cannot fail. Measured, then reverted.

**A constraint on this that only came out of the bandCost work:** any re-price of the cost
function **reshuffles which seed disasters**, so a twelve-seed tail bar cannot survive one.
That is not an argument for a looser bar — it is the reason a tail bar over a fixed seed set
is the wrong instrument for guarding a solver whose weights are still moving. Worth settling
before the move to the T, not after. **Owner: `sizes`** — `layout` was offered it and
declined, so this is the one item in this document with a named owner rather than a
question.

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

**Shipped in `fa12f1a`, and one thing about it was checked rather than assumed.** The three
diagonal-shove witnesses are coordinates into a space both the cost function and the seeder
define, and item 1 moves starter placements — so they could have gone red for a reason with
nothing to do with the shove. They did not. **That is also what makes 197 → 30 a result
rather than an artifact of the pre-#26 seeder**, and it is the kind of thing that is only
knowable by someone who noticed the witnesses were the fragile part.

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

## Nothing in this document has been in a browser

Neither has anything in `visual-check.md`. The desktop half of both is reachable with
`pnpm build && pnpm start` and no login.

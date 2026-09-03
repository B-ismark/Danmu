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

## The queue — what is open, in the order it should be done

**Re-derive before trusting this.** It is an ordering of the sections below, written
2026-09-01; the sections themselves are the source and they say whether each item
exists in a commit. An item disappears from here when its section says FIXED.

Ranked by three things together, not by any one of them: **criticality** (does a user
hit it), **ease** (is it an afternoon or a measurement campaign), and **dependence** —
which is what moves several of these off the position their severity alone would give
them. Where two items are the same defect one layer apart, they are listed as one.

| # | item | why here | cost | blocks / blocked by |
|---|---|---|---|---|
| 1 | **§ 12** rider keeps the size the room was BUILT at | Confirmed by eye, and the user has already chosen the repair — derive at read time, write nothing (§ B.16). An attempt at the OTHER option was built and reverted; read § 12 before starting | M | **blocked on § 33.3** — B.16's stated cost is "the derivation runs on every read" and the render budget is unmeasured |
| ~~2~~ | ~~**§ 32** everything added from the Library is square-footed~~ | **FIXED** — `isRoundPart` + `ROUND_SHAPES`, derived at all four doors, `CATEGORY_DEFAULTS.circle` deleted | — | — |
| ~~3~~ | ~~**§ 14** a merged group's member cannot be clicked~~ | **FIXED** — the gizmo's invisible translate plane took the press, so `Pickable`'s `selDown` was stale and the drill-in always read "outside". `lib/press-selection.ts` records in the capture phase | — | — |
| ~~4~~ | ~~**§ 17** a drag refused by a wall TV names nothing~~ | **FIXED** — `clash-mounted` in the room report, and `isSoftFurnishing` shared with the drag, which also unblocked dragging anything in front of a curtain | — | — |
| ~~5~~ | ~~**§ 18** Shuffle leaves a nightstand through the bed~~ | **FIXED** — not a floor clash at all: a rider (a lamp on a nightstand) was moved independently of its support and left in mid-air inside the bed, invisible to all five `HARD_TERMS`, to the room report and to the plan. `carryRiders` | — | — |
| — | ~~**§ 31** containment must outrank a blocked door, categorically~~ | **BUILT 2026-09-03.** `IMPOSSIBLE_TERMS` plus a veto at three choice points. The defect was not the near-tie it was filed as: 18 of 160 solves handed back a room MORE impossible than the one they were given, all of them from legal seeded rooms. Now 0 of 160 | done | A.7 and G.1 unblocked |
| ~~7~~ | ~~**§ 34** the pendant and the ceiling fan draw outside their declared size~~ | **FIXED** — `fanColumn` + `pendantDrop` in `scene-spec.ts`, swept at 10 mm across both catalogue bands against `verticalExtent`. The stated blocker (what a pendant's declared height means) was already answered by `isMountedObstruction` + `clearance.ts` rule 2b | — | — |
| ~~7~~ | ~~**§ 33.1** the four newest shapes have never been seen in 3D~~ | **ALREADY DONE, and this row was stale** — `visual-check.md` has recorded the look since 2026-09-01 and deleted its own item; the queue was never updated. Re-confirmed 2026-09-02 alongside § 34 | — | — |
| — | ~~**§ 36** a non-uniform resize walks through both geometry caps~~ | **FIXED 2026-09-03.** Six shapes, not two — the four extra found by grepping for the shape of the bug rather than its symptom. Worst was 2.25× (a fan's motor) and 4× (a pendant's shade) | done | wants eyes |
| 7 | **§ 37** the Inspector's placement banner contradicts the room report | Reviewed 2026-09-02 and held out of PR #87. The idea is wanted; two of its three states are already computed elsewhere and it recomputes them with a different bar | M | none — it is on a branch, in no PR |
| 8 | **G.1** a brand-new room seals its own routes at the size the app ships | Measured, real, and a first-run defect — the worst kind to leave | M | related to § 31: both are the solver's idea of "navigable" |
| 9 | **A.7** `snapYaws` leaves the piece crooked in 197 of 240 solves | Measured, visible, nobody has decided whether it matters | M | after § 31, which may change what a finalist is |
| 10 | **§ 33.3** the render budget is unmeasured | Blocks any answer to "how detailed may a shape be", which was asked directly | M — needs a throttled device | blocks nothing shipping; blocks a decision |
| 11 | **§ 33.2** the on-device detector cannot name the four new shapes | Needs a 50 MB re-export and a digest re-pin on a Python toolchain | L, and mostly not code | the cloud path already handles them, so this is a completeness item |
| 12 | **A.2 / G.2 / G.3** variety in Shuffle, the anchor-first trade, the two help cards | Real but none of them is a defect a user has reported | varies | after everything above |
| 13 | **E** the jsdom component bucket | The harness is in and the bucket is not. Infrastructure, so it pays off across every item above — but it has paid off least when done first | L | none |

**Three that are deliberately not on this list**, so nobody adds them back: the seeder
putting a 1450 mm TV on a 1.2 m wall in the small L and T (`placeNewPart` has no
legality test — real, but it is the *seeder*, and § C says do not grow the presets);
anything in § C at all; and § A.5, the Vercel alias question, which is not engineering.

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

  **Re-derived 2026-08-31.** Four branches are still ahead of `main`:
  `feat/expose-finalists-and-relation-distance` (1), `fix/derive-mounted-and-vertical-extent`
  (1), `fix/pointer-cancel-note` (10), `research/inward-normals` (2).

  On `fix/pointer-cancel-note` specifically, because it is the one that reads as lost work
  and the reading keeps coming out differently. What is derived rather than remembered: 33
  files and 2,316 insertions against its merge base; `main` already defines `gestureFor`,
  `applyRoomEdits` and `boundsToUnit`, so a good deal of its content did land by another
  route; and its `docs/visual-check.md` is the retired **621-line** version that `main`
  deliberately cut to **359**, so a merge resurrects a backlog someone chose to delete.

  **And a correction to a claim made about it in this session, before anyone acts on that
  either.** It was described as an add/add that would redeclare `gestureFor` and break the
  build. That is wrong. `git merge-tree --write-tree origin/main origin/fix/pointer-cancel-note`
  exits 1 with **19 conflicted files, every one of them carrying stages 1, 2 AND 3** — stage 1
  is the common ancestor, so these are ordinary three-way edit/edit conflicts on files both
  sides have changed. Not an add/add, and not a build error waiting to happen: a real
  per-file resolution across `PlanView`, `RoomDimsEditor`, `RoomTools`, `Draggable`,
  `drag-convoy`, `drag-resolve`, `physics`, `rigid-parent`, `scene-file`, `dimension-ranges`
  and nine test files.

  This is the third different account of that branch in this document's history, which is
  the actual finding: **it is neither deletable nor mergeable on any evidence gathered so
  far**, and every session that has looked at it has produced a confident summary from a
  cheaper instrument than the question deserved. The next person to touch it should do a
  per-line pass or leave it alone — and, per CLAUDE.md, read the stage numbers rather than
  the conflict list.
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

**WIRED, by `lib/layout-shuffle.ts` — but not into the offer stage this section was
written about.** `lib/layout-offer.ts` + `tests/layout-offer.test.ts` landed with
`e999522`; `tests/layout-offer-pool.test.ts` followed. For a long time the sentence
here read "**On `main`, and still imported by nothing**", and that stopped being true
when the Shuffle button landed: `shuffleRoom` imports both `orderOffers` and
`layoutSimilarity` and ranks its candidate solves with them at
`DIVERSITY_PENALTY = 4`, the median this section measured.

**Two caveats, because "wired" is doing less work here than it sounds.**

· It ranks a set and then takes **one**. `orderOffers`' first pick has `picked = []`,
  so `closest` is 0 and the score is pure cost — the penalty cannot move `ranked[0]`.
  It only decides the order in which the history filter walks the rest. So the
  diversity term is live for *"do not show me the same room twice in a row"* and inert
  for the first offer, which is not what a median measured over `k`-sized offer sets
  was measuring. **Nothing pins it**; a test that fails at `diversityPenalty: 0` is
  still owed.
· The three bullets below still stand unchanged — the finalist pool cannot supply
  orientation variety, and ranking candidates is not ranking outcomes. Shuffle sidesteps
  both by ranking *whole separate solves* rather than one solve's finalists, which is a
  different technique from the one this section proposed, not a completion of it.

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
  **The number is measured now: 4, with a working range of 2–8.** Taken against
  `MIN_GAIN_ABS`, as this paragraph asked, rather than borrowed from it.

  Method, because the input is the part that decides the answer: five presets × three
  deterministic shoves = fifteen *rearranged* rooms, since the starter arrangements are
  local optima the annealer cannot beat and hand back a pool of one — which
  `tests/layout-offer-pool.test.ts` already pins in both directions, and which is
  therefore the wrong input to tune on. `spotM` and `yawRad` are **not chosen here**:
  they are `LAYOUT_SIMILAR_M` (0.25) and `TURN_EPSILON` (0.05), read off the solver,
  which is what the "no thresholds are defined in this file" rule requires of a caller
  as much as of the file.

  Measured across those fifteen, every one leaving a pool of 3–4:

  | | observed |
  |---|---|
  | finalist cost spread | 0.42 – 15.35, typically 1.5–5 |
  | pairwise similarity | 0.00 – 0.91, per-room means 0.29–0.79 |
  | penalty that first changes the offered set | `[0.25 ×3, 0.5, 2 ×3, 4 ×5, 8 ×2, >128]`, **median 4** |

  Below **0.25** the term never fires in any room measured — it is inert, which is the
  failure this whole design note exists to avoid. Above about **8** the order stops
  responding: cost has stopped mattering and the offer is chosen purely on difference.
  **4** is the value at which the term is live in roughly half the rooms without
  dominating any of them, and it is a median of observations rather than a round number
  someone liked.

  One room refused to reorder at any penalty up to 128 (`l`, seed 3, a pool of three at
  costs 26.79 / 28.90 / 30.46), and the reason is a property of the technique rather
  than a bad number. Both remaining candidates sit at **exactly 0.250** similarity to
  the first pick, so the penalty adds the same quantity to both scores and cancels out
  of the comparison: at penalty 128 they score 60.90 and 62.46, still 1.566 apart,
  which is the cost gap untouched. **A penalty can only ever reorder candidates that
  DIFFER in how alike they are to what is already picked** — an equal-similarity tie is
  immune to it at any magnitude. Worth knowing before someone reads a single unmoved
  room as the term being broken, and worth knowing that the first version of this
  paragraph blamed `k = 3` offering everything anyway, which is wrong: the set is
  indeed fixed, but the ORDER was always still in play and had to be measured.

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

### The Shuffle rename LANDED, and not as the sweep this section demanded

This section used to say the rename was not started, that the Lock strings deliberately said
**"Suggest"** to keep the vocabulary internally consistent, and that *"if it lands it lands as
one sweep across all 36 files, never a file at a time."* What actually happened is neither:
the toolbar button was **split** rather than renamed — **Fix** (the old repair behaviour) and
**Shuffle** (`lib/layout-shuffle.ts`, a different arrangement) — so there is no longer one
name to sweep to.

**The user-facing half is complete and was checked, not assumed.** No on-screen string names
a control called "Suggest": the Lock labels say Fix/Shuffle, `RoomTools`' own copy does, and
the one survivor — `Inspector.tsx`'s *"Suggested · 3"* — is about decor props and is a
different word. `Design.md`'s two live references and the four code comments naming the
control (`storage.ts`, `store.ts` ×2, `fit-check.ts`) were swept with it.

**What is deliberately NOT swept, and why it is not half-done:** every occurrence narrating
what the old button *did wrong* — `layout-rules.ts:7`, `clearance.ts:9`, `Design.md`'s
wall-debt and seeder paragraphs, `layout-conformance.test.ts:10`, `CLAUDE.md` — is a scar
about a thing called Suggest at the time it happened, and renaming those falsifies the
record. `docs/history/**` and `docs/research/**` are point-in-time studies and are untouched
for the same reason.

**Still owed:** the internal hook is `useSuggest` and is now shared by `FixAllButton` and the
per-finding `FixButton`. Internal only, no user can see it, but it is a name for a control the
UI no longer has.

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

13. **Where does the app hang a ceiling piece? — ANSWERED AND FIXED.** It used to hang
    anything over 300 mm THROUGH the slab: `groundY`'s ceiling branch was
    `Math.max(roomHeight - 0.15, h)`, a fixed 150 mm drop to the piece's **centre**, so
    its top landed at `H - 0.15 + h/2` and poked through **iff `h > 300 mm`, at every
    ceiling height**. The seeded Pendant is 400 mm: top 2.850 in a 2.800 m room. A
    ceiling fan at 200 mm cleared by 50 mm, which is why it never looked like a rule.

    The branch takes the lower of the nominal drop and the piece's own half-height now,
    so a shallow fixture stays exactly where it was and a deep one stops crossing the
    slab. The seeded Pendant tops out at **2.780** — `roomHeight` less `MOUNT_PAD`, the
    same pad every other clamp of this quantity uses, because landing it exactly on the
    slab put it 20 mm over `settleHeights`' cap and it would have crept down on each
    load. `CEILING_TOPS` in
    `tests/scene-seed.test.ts` — which #54 landed — went red on the fix, which is what
    it was pinned in both directions to do, and holds the new literals; a `<=` bar would
    have sat green through it and nobody would have come back.

    The catalogue-wide version of the question is `tests/shape-contract.test.ts`: no
    Library piece may reach through the ceiling at its shipped size, **and** nothing hung
    from the ceiling may hang below head height. The second clause exists because the
    first one alone goes green on a pedestal fan that has lost its floor anchor — it
    comes to rest spanning 1.50–2.80 m, entirely inside the room, base at chest height.

    (The first version of this paragraph said "already pinned" with no branch named, in
    the one document whose convention is that every item says whether it exists in a
    commit anywhere. Found by danmu-78 in review.)

    **It is now user-visible**, which is what moved it into this section. Since PR #54
    routes the ceiling family into `MountHeightRow` — correctly, because
    `Inspector.tsx:262` already said the wall-snap buttons are "worse than useless" for a
    piece that rides no wall — selecting the seeded Pendant renders `2.45` against a
    stated maximum of `2.38`, `aria-invalid="true"`, and the line
    `0–2.38 m under this ceiling.` in `--danger-text`, on a piece the app placed and the
    user never touched. **Measured in a browser, not reasoned:** the same room's
    `TV · 55″` renders `1.04` with `aria-invalid="false"`, so the row is right and the
    seeder is what is wrong. The gap is exactly 70 mm at every ceiling height — the 50 mm
    through the slab plus `MOUNT_PAD`'s 20.

    Worse, focusing that field and tabbing away with **nothing typed** re-commits the
    clamped value: `2.45 → 2.38`, the piece drops 70 mm, and the `role="status"` line is
    byte-identical before and after because it reports *across* and *back* and never
    height. `onBlur={commit}` has no "did the draft change" guard.

    **The costed option**, so this is a decision rather than a bug report: hang from the
    TOP instead of the centre — `Math.min(roomHeight - MOUNT_PAD - h / 2, …)` — which
    puts every ceiling piece's top 20 mm under the slab regardless of height. For the
    Pendant that moves the centre 2.65 → 2.58 and makes `bottomMM` land on **2380 =
    `maxBottomMM` exactly**, so the field is valid by construction rather than by luck.
    It also drops the pendant 70 mm, to 2.38 m off the floor over a 0.75 m dining table
    — which is a look, and looks are the user's call. The alternatives are: keep the
    150 mm drop and accept that tall ceiling pieces intersect the slab; or clamp only
    when a piece would poke through, which keeps today's look for the fan and changes
    only the pendant, at the cost of two behaviours where there is now one.

    Nobody should pick this silently, which is why it is here. Whichever way it goes,
    `CEILING_TOPS` moves with it and the blur re-commit is a separate one-line guard
    that should be fixed regardless of the answer.
    **Committed:** nothing but this paragraph. The measurements are in PR #54's review
    comments.

14. **A turn that puts a corner through the wall: keep it and report it, or refuse it?
    Two places in this repo answer that opposite ways, in the same words.**

    `spinSelection`'s docblock (`components/studio/KeyboardShortcuts.tsx`) is explicit:

    > *It deliberately does NOT shuffle anything to make room. If the turn puts a wardrobe
    > corner through the plaster, the piece keeps its real rotation and Room check reports
    > it — silently nudging furniture to make an action succeed is the one thing this app
    > must never do.*

    That is CLAUDE.md rule 2's "say so, never silently resize it to fit", applied to a
    rotation. And `docs/visual-check.md`'s item *Rotate and scale on a merged set, in 3D*
    says the opposite about the same outcome: *"the turn itself is allowed … and an overlap
    is allowed to be reported; the geometry leaving the walls is not"*, with **"the bed
    keeping the angle you dragged with a corner out through the wall"** listed as what
    wrong looks like. Plaster is the wall. So one document calls that outcome the contract
    and the other calls it the defect.

    **Both may be right, and that is the thing to decide.** They are different code paths:
    the context menu's *Turn a quarter* is `spinSelection`, which writes `setRotation`
    directly and runs **no containment resolve at all** (verified by reading it); the R
    gizmo goes through `Draggable` → `resolveDrag`, which does contain. So "a menu turn
    keeps its rotation and gets reported, a gizmo turn is constrained" is a coherent
    position — it is just nowhere written down, and two paths producing different results
    from one user intention is the shape CLAUDE.md warns about under *two features that
    render the same must not be two code paths*.

    **Why it needs deciding before it needs looking at:** item 8 is the one item in
    `docs/visual-check.md` that no one has verified, and verifying it means judging an
    outcome against an expectation. Verifying against the wrong expectation is worse than
    not verifying, because it produces a confident wrong answer. Whoever settles this
    should also say whether *Turn a quarter* and the gizmo are allowed to differ.

    **Committed:** nothing but this paragraph. What is measured: `spinSelection` calls
    `setRotation` with no resolve, `resolveDrag` contains, and the two docs say what is
    quoted above. What is NOT measured: what either path actually does to a merged set at
    a wall — the gizmo could not be driven headless (drei's `TransformControls` is a
    three.js object with no DOM, so a drag cannot be aimed at it), and the menu path needs
    a right-click that lands on a piece in the selection with nothing over it.

15. **The same piece is round or square depending on how it got into the room, and
    `circle` has three sources of truth.** Found by a fixture that could not reach the
    defect it was written for, which is how the last four of these were found.

    `circle` says "draw this footprint as an ellipse" and it is set in three places that
    do not agree:

    | path | sets `circle` | so a Ceiling fan is |
    |---|---|---|
    | detected (`CATEGORY_DEFAULTS`) | `lamp`, `plant`, `fan` | round |
    | seeded (`dress` / `defaultScene`) | four hand-set `{ circle: true }` sites | round |
    | **Library** (`PART_LIBRARY`) | **nothing, on any entry** | **square** |

    So `Ceiling fan`, `Floor lamp`, `Plant` and `Pendant lamp` added from the Library are
    drawn as rectangles in the plan and in the exported PNG, while the identical shape
    seeded into a starter room or found by detection is drawn as an ellipse. **Measured in
    a browser**, not reasoned: a Library ceiling fan comes out of the 2D Plan tab as
    `rect,line,g,text` with no `ellipse`, and the exported sheet draws it as a 1 × 1 m
    square. `PlanView` and `lib/plan-export.ts` both honour the flag correctly — the flag
    is simply absent.

    It is also the reason `lib/plan-export.ts`'s new `circle` branch could not be
    exercised by a Library fixture: the fix is right and reachable (a seeded pendant, a
    detected fan), and the test that was meant to prove it in a browser reached a piece
    that is not round.

    **The fix is `rule 3`, not a fourth column:** derive it from the SHAPE, the way
    `wallMounted` now derives from the anchor. The round set, read off the three existing
    sources rather than chosen: `fan`, `plant`, `lamp-floor`, `lamp-pendant`. Then
    `CATEGORY_DEFAULTS`' `circle` column is deleted like its `wallMounted` column was, the
    four hand-set seed sites lose their `{ circle: true }`, and `PART_LIBRARY` needs
    nothing.

    **Why it is here and not done:** it changes what four Library pieces LOOK like — they
    become round — and looks are the user's call, even when the direction is the one three
    of the four paths and the 3D geometry already agree on. `lamp-table` is deliberately
    NOT in that set, because no path marks a table lamp round today and adding it would be
    a new decision rather than a reconciliation.

    **Committed:** nothing but this paragraph. The predicate is not written; the browser
    measurement above is real.

16. **A rider floats after a reload — ANSWERED: derive at read time, write nothing.** The user picked the second option. `resolvePart` / `resolveParts` already own the one fallback in the app, so a rider Y derived there from its support current dims persists nothing and leaves a re-detect clean. NOT BUILT — this is § H.12. The original framing follows, because the two rejected options are the useful part of the record.

    **Which of three repairs, and each one costs something
    different.** The defect is confirmed by eye (§ H.12) and the arithmetic is already
    gated; what is undecided is where the fix goes, because the obvious one writes to the
    user's room.

    · **Re-settle on load.** Smallest diff, and it writes a position override for every
      rider in the room. Each override pins that value against a re-detect and persists, so
      a user who has never dragged anything acquires a room full of hand-placed pieces.
      That is the objection, and it is the reason this was not done on sight.
    · **Settle at read time, write nothing.** `resolvePart` / `resolveParts` already own the
      one fallback; a rider's Y could be derived there from its support's *current* dims
      rather than stored. Nothing persists, and a re-detect stays clean. Costs: the
      derivation runs on every read, and it needs the support relationship at hand.
    · **Re-settle only the pieces whose support was resized, and only in the session that
      resized it.** Narrowest blast radius, most state to keep, and the least honest of the
      three — the room on disk stays wrong and the screen looks right.

    **Not a decision about whether to fix it.** The user has seen it and it is a defect.

    **Committed:** nothing. § H.12 is the record.

17. **Does the placement row earn its place at all? — ANSWERED: make dragging work.** The user said *"dragging would work"*, which is the middle option: keep the two operations, drop the row. Dragging a lamp clear of a table should DROP it to the floor, and the row becomes redundant rather than removed. NOT BUILT. The framing follows.

    **Original question.** Asked because the user said it
    outright, unprompted, having just confirmed the row was correct: *"I don't think we need
    these 3 features to be honest."*

    That is a harder question than the padding bug beside it (§ H.13) and it should not be
    answered by fixing the padding and moving on. The row is Wall · Surface · Floor, and its
    third button was deliberately kept for a reason recorded in `visual-check.md`: **neither
    Floor-off-a-table nor Surface-back-onto-it is reachable by dragging.** Dragging a lamp
    off a table moves it sideways. So the row is the only way to perform two real operations,
    and deleting it deletes them rather than deleting a control.

    Three ways out, and the middle one is the one worth arguing for:

    · **Keep it.** Fix the padding, leave the model alone.
    · **Keep the operations, drop the row.** Make the two reachable some other way — a drag
      that leaves a surface should drop the piece, which is arguably what a user means by
      dragging a lamp off a table — and the row becomes redundant rather than removed.
    · **Delete it.** Accept that a piece put on a table stays on it until deleted.

    **This needs the user, and it needs them to see the second option**, because "we don't
    need these" and "this should be a drag" are the same complaint if dragging worked.

    **Committed:** nothing.

18. **Should deleting a merged group ask first? — ANSWERED and SHIPPED.** The user checked the fact this turned on: the Undo toast DOES fire on a group delete. So the reversal argument holds, and their answer draws the line somewhere the framing below did not consider — not on blast radius but on GESTURE. *"Delete on group does trigger a toast but that should be acceptable if they used the button, using backspace to delete should require confirmatory modal whether a group or not."* A button labelled Delete cannot be pressed by accident; Backspace is a typing reflex that missed a field. Built in `deleteSelection`. The framing follows, and the count-based middle option it proposed was declined by that same reasoning — a threshold puts the prompt where it is least needed.

    **Original question.** The user reported *"there's no confirmation
    dialogue for grouped models and also other instances of deletion"*.

    **The absence is deliberate and documented in four places**, so this is a decision to
    revisit rather than a defect to fix. `removeParts` in `KeyboardShortcuts.tsx` is the one
    delete path from every surface, and its own comment argues the case: *"Removing a chair
    is cheap and fully reversible — history covers structure, and the toast puts the reversal
    one click away… A dialog on a reversible action only teaches people to dismiss dialogs,
    which is what makes the irreversible ones dangerous."* Deleting a saved layout and
    resetting every transform keep their confirms; this does not.

    **Establish one fact before deciding anything, because it changes which question this
    is.** Does the Undo toast actually appear when a *merged group* is deleted? If it does,
    the argument above holds and the user is asking us to overturn it. If it does not, there
    is no defect in the reasoning at all — the reasoning depends on a reversal being one
    click away on the same screen, and a group delete that reverses silently or not at all
    is simply a bug in the delete path. **Nobody has checked which.**

    A middle answer exists if the toast works and the user still wants a prompt: a group is
    N pieces at once, so the confirm could be scoped to a count — one piece stays instant,
    a set of five asks. That keeps the "don't teach people to dismiss dialogs" property while
    matching what actually feels irreversible.

    **Committed:** nothing.


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

---

## H (second pass) · Nine more items put to the user, answered 2026-08-30

The nine were `visual-check.md`'s whole live list. **Four held, one could not be attempted
because the question named no axis, and the rest produced eight defects — six of them
reported unprompted, off gestures the item was not asking about.** That ratio is the
argument for eyes: the four that held were the four a test could most nearly have reached.

| outcome | items |
|---|---|
| held | three turn gestures agree · room cards draw their own outline · the Library panel is visible on both tabs · a merged set will not scale out through the walls |
| held on its own question, defect alongside | the placement row is two buttons (§ 13) · a wardrobe no longer passes through a mounted TV (§ 17) |
| failed as predicted | the rider floats after a reload (§ 12) · Shuffle will not close a bedside gap — confirms the measured diagnosis; § 18 is the new half |
| could not be attempted | the 500 ms red — the item said "a 4 m sofa" and never said **which field**; the user set Height, found it capped at 1.10 m, and reported the cap. The cap is correct. `visual-check.md` now names Width. |

**The lesson is the same one this file keeps learning.** An instruction that does not name
its axis is not a check, and the person following it reports the wall they hit rather than
the thing you meant. Nobody was wrong here except the note.

### 12. A rider stays at the size the room was BUILT at, after a reload — STILL OPEN, and a fix for it was written and REVERTED

The prediction in `visual-check.md` was exact and the user saw exactly it: resize a surface,
reopen the room, the piece standing on it hangs in the air above the shrunk top.

`settleHeights` answers entirely in `dimMM`, and a resize never touches `dimMM` — it writes
a `dims` override. So the load is: `buildSceneFromRoom` settles against the **authored**
sizes, `loadTransforms` applies the saved ones over the top, and nothing settles again.

**A fix was built on `feat/shape-contract` and taken back out before the PR merged. It was
the wrong one of the three, and § B.16 already said so.** It re-settled on load and wrote
the result into the store — the first option in B.16's list, the one recorded there with
the objection that is the reason it "was not done on sight". **The user has already picked
the second option: derive at read time, write nothing.** Building the first was not a
judgement call that went the other way; it was a decision that had been made being made
again, by someone who had not read the section that made it.

Two things about how it went wrong are worth keeping, because neither is about riders:

- The implementation genuinely believed it had answered the objection, on the grounds that
  it never *created* a position override — only corrected one already there. That is true
  and it is not the same as "writes nothing": correcting an existing entry still mutates
  the persisted `positions` map, which is flushed on the next transform change. **A
  narrower version of a rejected option is still the rejected option.**
- It was caught by a review lens pointed at stale documentation, not by one pointed at
  behaviour. Nothing in the code could have said it: every gate passed, seven assertions
  were mutation-killed at the intended clause, and the fix worked. The contradiction was
  between two sections of one document, and the only reason it surfaced is that **§ B.16
  was never re-read before § 12 was rewritten.** A hand-off document is a claim to
  re-derive — including a claim about what the user decided.

**What is actually wanted, from B.16.** `resolvePart` / `resolveParts` own the one fallback
in the app; a rider's Y is derived there from its support's *current* dims rather than
stored. Nothing persists and a re-detect stays clean.

**What that costs, and why it is not a five-minute change.** `useRoomScene` memoises
`resolveParts` on four store slices and `components/three/Room.tsx` renders from it, so the
render path does reach it. But `usePartTransform` deliberately does **not** go through the
list — it exists for the hot paths, `Draggable` mid-gesture and `Dressing` following its
owner — and a per-part read cannot see the support it stands on. So either the derivation
lives in the list-level readers only and the two paths answer differently, which is the
two-sources-of-truth shape this repo keeps finding, or `usePartTransform` gains the list
and loses the point of its narrow subscription.

**What would unblock it:** a measurement. B.16's stated cost is that "the derivation runs
on every read", and `settleHeights` does a support lookup per part. § 33.3 records that
nobody has measured this app's render budget at all, which makes "is a settle per resolve
affordable" unanswerable rather than merely unanswered. That measurement is the dependency,
and it is why this is not simply the next thing to do.

**Committed:** nothing. The reverted attempt is in `feat/shape-contract`'s history if the
pure settle helper is wanted later, but it is not on `main` and it is not the shape the
answer should take.

**Also still open, and found while building the wrong fix:** `setDim` is
`set((s) => ({ dims: { ...s.dims, [id]: dim } }))` and nothing settles after it, ever — so
the rider floats **immediately, in-session**, and the reload merely makes it stick. Read-time
derivation would fix both halves at once, which is a point in its favour that B.16 did not
have when it was written.

### 13. The placement row's Floor button sits flush against the window edge — FIXED, and the recorded cause was wrong

The row itself is right — the user confirmed **Wall · Floor** on a floor-standing piece, so
the two-button fix took and § H.1 stays FIXED. What they reported alongside it is that at
the narrow rail the **Floor button touches the edge of the window with no padding**.

**FIXED in `42def4b`. The candidate cause below was wrong twice over**, and it is kept
because the way it was wrong is the point: it was a reading of the stylesheet that nobody
had put a browser in front of.

**What it actually was.** `.rail-triple` and `.rail-swatches` are markup in `Inspector.tsx`
and nowhere else — the RIGHT rail. That rail takes three kinds of width: `--rail-right`'s
clamp (276–320px), `--rail-right-tight` (248px, the `compact` step), and whatever the sash
was dragged to, which `DockedShell` renders as `clamp(--rail-right-min, Npx, --rail-max)`.
So **276px is the narrowest a dragged right rail can be, and the fold was written at 268px**
— below it. Every width a drag can reach sat above the breakpoint, and the fold could never
fire.

It looked alive because 248px does clear 268px: **the fold fired for the width nobody drags
to and not for the width they do**, which is why reading the stylesheet agrees with itself
and disagrees with the screen.

Measured in a browser at a rail dragged to 276px, where 33px goes to padding and the border:
the three buttons want 261px of the 243px they get, so “Floor” painted at
**x = 1401.8 in a 1400px window**. `.rail-swatches` wanted 252px in the same 243px — same
dead breakpoint, second victim, and nobody had reported that one. Nothing clips and nothing
scrolls, because `.rail` is `overflow: visible`; `1fr` is `minmax(auto, 1fr)`, so the columns
could not shrink below their own content and the grid overflowed instead.

**And then the fix was itself short by a scrollbar, which is the more useful half of this
entry.** `42def4b` put the breakpoint at 304px and called the 11px above the stated minimum
headroom — “13px to spare at a 1280px viewport”. It was not headroom. It was an omitted
term. The query container was `.rail`, and the Inspector is a scroll box **inside** it, so a
classic scrollbar sits between the box the query measures and the box the grid gets: the
grid has `railWidth − border − padding − sbw` while `@container rail` was being told
`railWidth − border`. 304 was that arithmetic with `sbw` set to zero, and the repo already
held the other derivation 15px away, in `Inspector.tsx`'s own comment about the lighting row
— *"less its border, the section's 16px either side **and a vertical scrollbar**"*. Two
answers to one question, and the breakpoint was taken off the one missing a term.

**Raising the number would have been the wrong repair**, because there is no number: the
scrollbar is ~11-12px on Windows with `scrollbar-width: thin`, 0 with macOS overlay
scrollbars, and larger again at high OS text scaling. Instead the query container moved to
the scroll box itself (`.rail-scroll`, a nested container of the same name, so `@container
rail` inside the Inspector resolves to it while the left rail still resolves to `.rail`).
The scrollbar then cancels rather than being estimated: the grid is exactly
`queryWidth − 32px`, so `261 + 32 = 293` is the widest query box that cannot hold the row,
and the breakpoint is **293px**.

**Measured, and the old arrangement measured failing beside it.** Headless Chromium renders
no scrollbar in any launch configuration tried, so a 12px/15px transparent right border on
the scroll box stands in for one — geometrically the same band. At a **1280px viewport**
with a 15px stand-in: the shipped arrangement folds to two columns at 259px and nothing
overflows; the `dcfe1af` arrangement (`container-type: normal` on `.rail-scroll`, so the
query falls back to `.rail`) stays three-up and **overflows by 2px**. At 12px both are fine,
by one pixel. That one configuration is the entire defect, and it is the shipping default
window width.

**The assertion is token-derived and now two-sided**: the widest container query folding each
class must be at least `--rail-right`'s clamp floor **and strictly below the query box of the
narrowest rail that ships un-dragged** — `(COMPACT_WIDTH + 1) × 24vw − border`, every term
read from the source that owns it. The ceiling was missing for one commit and 304 → 320 →
600 → 99999 all stayed green; each of those folds the shipping default to two columns
permanently, which is the opposite failure and just as silent. Necessary and not sufficient
— nothing in a test can measure a button's min-content — but reachability was the half that
was false, and a test naming a viewport would have agreed with the bug. Its own premise is
pinned too, because mutating the token to `rail-left` left it green.

**The block parser was reading brace indentation, not braces.** `[\s\S]*?\n\}` ends a block
at the first `}` in column 1, so indenting the wider block's closing brace merges the
narrower one into it. Verified: move `.rail-swatches` into the 240px block and indent the
293px block's brace, and the old regex reports the swatches folding at 293 — green, while
the real fold is at a width no drag can reach, which is precisely the defect the test exists
to catch. Brace-counted over `codeOnly(CSS)` now, and the same mutation goes red.

**The cause recorded before any of that, and why it was wrong.** `app/globals.css` carries
`@container rail (max-width: 240px)` whose own comment says *"The last thing to give is
padding, because it is the only thing here whose loss costs nothing but air"* — it drops
`.rail-section-*` padding to zero by design. If that is what fired, the degradation is
working as written and the written intent is wrong: losing the last few pixels of padding
does not cost only air, it costs the boundary between a control and the window. Whether the
rail was actually at or below 240px when they saw it is unverified, and that is the first
thing to establish, because the other possibility is a container-query breakpoint firing
wider than it should.

Two things kill it. That block drops `.rail-section-*` padding to **12px, not to zero**, so
even had it fired there would still have been padding; and it fires at ≤240px, which the
right rail never reaches at all. The guessed remedy — “a floor of 4–6px rather than `0`” —
would have changed a number that was already 12 and left the actual overflow untouched.

This is rule 4's own territory — a control that does not fit must **reflow**, not spill. The
lesson is narrower than the rule, though: the stylesheet was read carefully, the reading was
self-consistent, and it took one measurement to find that the block under suspicion could
not fire and the one that mattered was a different one.

### 14. A merged group's member cannot be selected by clicking it on the canvas — FIXED

*"Selecting a member of a group individually by clicking on it doesn't seem to work again.
Though it works when you individually click on it in the layer."*

**The cause, and it took instrumenting the running app to find — reading the code produced
two confident wrong answers first.** The drill-in asks `selectionForPick` whether the pick
came from INSIDE the group, using the selection **as the press landed**. That value was a
ref on `Pickable`, stamped in that component's own `onPointerDown`. And that handler does
not always run: once a piece is selected the gizmo appears, R3F cannot see the gizmo —
drei's `TransformControls` is a `<primitive>` with no handlers — so its invisible translate
plane takes the press and R3F dispatches nothing to the mesh underneath. The DOM click
still arrives. So `onClick` ran with a value left over from the last press that DID reach
it, `[]` from before anything was selected, and the predicate concluded the pick came from
OUTSIDE the group and handed back the whole group. Every time, unconditionally, because
drilling in requires the set to be selected first and selecting it is what raises the
gizmo.

That is why `PartTree` worked — it calls `setSelected` directly and never consults the
press. And why the 2D plan worked: no gizmo, so its own press always lands. § H.8's older
note that the drill-in worked "from a nightstand and never from the bed" is the same thing
seen through a gizmo that sat over the bed.

The instrumented run, which is the whole diagnosis:

```
[DBG] onClick ns-l selDown= []                  ← stale, the group IS selected
[DBG] drilling ns-l ["bed","ns-l","ns-r"]       ← so it returns the whole group
[DBG] return: consumeGizmoClick                 ← and sometimes eats the click outright
```

**The fix is `lib/press-selection.ts`**: one window listener in the CAPTURE phase, which
runs before any React or R3F handler and before the gizmo's own `mousedown`, so the press
is recorded on the way down whoever ends up claiming it. Outside the store for the same
reason as `lib/drag-click.ts` — so it can be tested without zustand's `persist` and a
localStorage shim.

Verified in a browser on the production build, which is where it was reproduced: click the
bed, all three light up; click a nightstand, the right panel says **Nightstand left** with
its own size fields and only that row is lit in the rail; click the other one and it moves.

Five assertions, all five mutation-killed at the intended clause. The load-bearing one is
not "it records the selection" but **that it records even when a handler swallows the
press** — a bubble-phase listener stands in for the gizmo, and moving the recorder out of
capture turns it red.

**A readout trap worth keeping.** The first three verification runs all reported the fix as
not working, because the probe read the right panel's heading — which says
"Group · 3 · Ungroup" whenever the selected piece BELONGS to a group. It is a group
affordance, not a count, so a working drill-in and a broken one print the same string. The
fix was nearly reverted on that evidence. What settled it was a screenshot.

### 15. The rotate gizmo moves whatever its ring passes over, not the piece you selected — FIXED, see § 27

The sharpest of the nine, and the user generalised it themselves: *"I selected bed to rotate
but the rotate control overlaps the nightstand and it ended up moving the nightstand. I
don't think this issue only exists with nightstands or only in 3d mode."*

**Take the generalisation seriously — it is the same shape as a defect this repo has already
shipped twice.** `docs/traps.md` and CLAUDE.md both carry the pattern: a gesture that
resolves *what is under the pointer* instead of *what the gesture belongs to*.
`drag-click.ts` exists because the first version of the click gate asked the arriving click
which piece it landed on; the answer here is expected to be the same — a gizmo drag belongs
to the selected piece and there is nothing to hit-test.

A rotate that can retarget mid-gesture is also a **silent data change**: it writes a rotation
override onto a piece the user never selected, and `lib/transforms.ts` pins and persists it.

**The guess above was right about the shape and wrong about the mechanism, and § 27 has the
measured version.** There is nothing hit-testing the gizmo to correct: R3F cannot SEE it, so
the same press is delivered twice, and the three guards that would have refused the second
delivery all read state the gizmo sets after R3F has already dispatched. Two things this entry
did not know about are in § 27 as well — the click steals the selection too, and the 2D plan
has the same defect by a different route.

### 16. Pieces still pass through walls in the 2D plan — FIXED, see § 29

*"models are still going through walls in 2d plan mode."*

Both tabs are supposed to end in `lib/drag-resolve.ts` — grid snap, containment, wall snap,
item snap, gravity, vertical clamp, OBB collision — and containment is step two. So either
the plan is not calling it, is calling it with a footprint it should not, or the containment
step is passing a piece it should refuse.

**This is the exact failure the one-drag-one-resolve extraction was meant to end**, and that
extraction has already shipped once with a step left behind in the caller — the grid snap
lived in the 3D pointer-move handler and did not travel. **Look for a step living in
`PlanView` before looking inside `drag-resolve`.**

Needs a repro before anything else: which piece, which wall, dragged or arrow-keyed.

**Answered, and the guess above was wrong in the useful direction.** It was not a step
left in `PlanView`, and it was not the plan at all — both tabs end in the shared resolve,
and the hole was in the resolve's own legality test. § 29 has it. The repro this asked for
turned out to be cheaper as a sweep than as a click path, because the piece that fails is
whichever one is wider than the shortest wall of the room it is in: a property of the pair,
which is exactly the kind of thing choosing an example misses.

### 17. A drag refused by a wall-mounted TV says nothing and names nothing — FIXED, and it was two faults

**Both halves shipped.** The size tag names the blocking piece (`blockedBy` rides the
live drag channel and lands in `MeasureGuides`), and the room report now has a rule of
its own for the case the `solid` filter could not reach.

`clash-mounted` (`lib/clearance.ts`, rule 2b) reports a floor piece standing inside
anything that is not on the floor. Seen in a browser on the production build: *"A piece
is inside something on the wall — “Wardrobe” is standing where “TV” hangs — they share
the same space between 0.98 m and 1.81 m up. Slide one of them along its wall."* With
**Show me** and no **Try a fix**, which is `RULE_HANDLING`'s `movable: false` doing its
job.

Three things about it are decisions rather than mechanics:

- **The two sets are not `floorBlockers` on either side.** The floor side admits a piece
  standing on a surface — a bedside lamp at y = 0.9 is inside a TV mounted at 1.4 m
  exactly as a wardrobe is, and `pos[1] < 0.05` would drop it. The mounted side admits
  the CEILING anchors, so a tall bookshelf under a fan is the same finding rather than a
  shape nobody thought of.
- **Any overlap at all, not rule 2's `CLASH_SHARE`.** That bar forgives deliberate
  composition — a chair tucked under its table — and nothing is meant to be partly
  inside a television. It is also the bar `collidesAt` uses, which is the point: the
  pair the drag refuses is the pair the report names.
- **Doors and windows are excluded**, because `door`, `entry` and `window` already speak
  for them and name the fault rather than the mechanism.

The `RULE_HANDLING` row says `costTerm: null, movable: false`, and
`tests/mounted-clash.test.ts` **measures** that claim rather than repeating it: it drives
a wardrobe from clear of the TV to fully inside it and watches `c.overlap` stay at 0 the
whole way. It is gated on `isObstacle` at both indices and `isObstacle` is false for
anything wall-mounted, so the term is identically zero at every depth — there is no
gradient, and a button would spin and report nothing.

### …and the fault found while looking for the pairs that would fire

**Nothing could be dragged in front of a curtain.** `collidesAt` exempted only rugs, and
a curtain's own geometry puts it in the room: 80 mm of depth in the catalogue (a
40–200 mm range) plus `CURTAIN_STANDOFF = 0.09`, so its inner face stands roughly 200 mm
off the plaster and anything with its back to that wall is inside it. Measured against the shipped presets rather than
reasoned about — four pairs the seeder itself creates were in that state:

| preset | pair | share of the smaller |
|---|---|---|
| `l` 6×5 | Bookshelf ∩ Curtains | 0.056 |
| `u` 6×5 | Wardrobe ∩ Curtains | 0.125 |
| `u` 6×5 | Nightstand ∩ Curtains | 0.281 |
| `u` 6×5 | Bedside lamp ∩ Curtains | 0.320 |

Every one is a state the app loads and the user could not re-create, which is the class
`visual-check.md` keeps recording — and adding the report rule without this would have
opened four of the app's own presets onto an error.

`isSoftFurnishing` (`lib/layout-rules.ts`) is the shared answer, read by the drag and by
the report, so the two cannot diverge again. A `Set<Shape>` rather than a
`Partial<Record<Shape, …>>`, deliberately: a partial table lets a new shape inherit its
category's answer in silence, and the silent answer here switches collision OFF, which
is the direction nothing complains about. Membership is `rug` and `curtain`, pinned in
both directions.

Verified in a browser, same wall, two drags:

| aimed at | committed | |
|---|---|---|
| the curtains | `x=1.60 y=0.00 z=−2.30` | arrived at the wall, on the floor |
| the wardrobe | `x=−1.60 y=2.10 z=−2.30` | climbed it — collision is still on |

**The second run is the control, and the first version of it was not evidence.** It read
only x and z, both drags ended at z = −2.30, and that read as "the wardrobe does not
refuse it". The nightstand had climbed onto the wardrobe: y = 2.10. From directly above,
a nightstand ON a wardrobe and one INSIDE it draw the same rectangle — the same blind
spot as the vase left hanging at table height in `CLAUDE.md`, one piece over. A drag
probe that does not read y cannot tell stacking from penetration.

### What the five review lenses found, and what was done about each

Nineteen findings across the five classes. **Ten were acted on in the same PR** — the six
Class-3 survivors below are the ones worth remembering, because thirteen of my own
mutations had already passed.

**Class 3 · six mutations survived a green file.** The sharpest is the sweep whose whole
purpose was to *measure* the `RULE_HANDLING` claim rather than repeat it. It scored ONE
pair, `[tv, wardrobe]`, and `prepare` gives that `obstacle = [false, true]` — with two
parts and the non-obstacle at index 0, the pair loop body **never executes at all**:
`i = 0` is skipped by the i-gate and `i = 1` has no `j`. So every reading was 0 by *array
arity*, not by gating, and three mutations lived through the whole file: deleting the
j-gate, deleting the accumulation outright, and setting `DEFAULT_WEIGHTS.overlap` to 0
(the weight is applied inside `costBreakdown` before it returns, so a zero weight
satisfies `r === 0` too). Two changes fix it and neither is optional: **a positive
control** — an ordinary floor pair through the same call, measured at exactly 1000 — and
**both part orders**, because which gate is exercised is an accident of array order and
no single ordering can verify both. The other three: `rooms >= 8` where the real number
is 12 (an early return emptying `t` and `u` kept it green), a door fixture carrying
`category` AND `shape` so neither exclusion clause was pinned, and the floor side's soft
exemption with no fixture at all. **The fixture written for that last one still could not
express it** — it set `wallMounted: true` on a `box`, and `verticalExtent` reads
`anchorFor`, not the flag, so the piece sat at [0.15, 0.45] and never met the rug. Two
questions, one flag, again.

**Class 5 · two consumers of `analyzeRoom` were not considered, and both are fixed.**
`checkFit` seats a probe and then runs the report over the seat it chose — but
`overlapsSomething` skipped every `wallMounted` piece, so **"Will it fit?" answered *No
room for it* about a bookshelf and a wardrobe that plainly fit** a 6×5 m room with four
wall TVs. Measured before and after. `isMountedObstruction` is the shared predicate now,
which makes this the third reader and the reason it is a named export rather than an
inline filter. The second consumer is `newRoomFindings`, whose `serious` gate now admits
this rule while the solver cannot price it: **measured at 8 seeds, Shuffle returned null
once with the rule at `error` and never with it suppressed.** That is the gate working —
refusing a candidate that parks a wardrobe inside a TV is the point — and the review's
claim that the "press Shuffle again" toast is therefore false is **refuted**: seven
presses in eight still succeed.

### Three findings recorded and NOT fixed

**1. The claim "the pair the drag refuses is the pair the report names" is false in two
places, and both are the app's own presets.** It is narrowed where it is asserted.

- **Mounted ↔ mounted.** `floorSolids` requires `!wallMounted`, so neither ordering of
  such a pair reaches rule 2b, and `floorBlockers` excludes both from rule 2. The seeder
  puts a **framed print inside a window** in `rect 4.5×4`, `rect 7×3.5`, `rect 3×6`,
  `u 4.5×4` and three `custom` sizes — and `resolvePlacement` on the print *at the
  position it already occupies* returns `valid=false refusal='blocked'`. That is § 17's
  own symptom surviving in the commit that closes § 17.
- **A tucked pair.** `collidesAt` has no `sharesFloor` exemption while rule 2 and the
  seeder's `seats()` both do, so a dining chair under its table is refused by the drag
  and silent in the report **by design** — 20 seeded pairs across `open` and `t`.

Both want the same decision — does `collidesAt` grow the report's exemptions, or does the
report grow the drag's strictness — and it is the same shape as § 31: a question about
which of two consumers is right, not a defect in either.

**2. `lib/physics.ts:216` states the opposite of what the code does.** It says
`isWallMountedPart` "answers yes for a ceiling fan and a pendant, which `ridesWall` and
the `wallMounted` flag both answer no for". Measured false: `normalizeStoredParts`
derives the flag *from* `isWallMountedPart`, so a fan normalises to `wallMounted: true`,
and a bookshelf under one is correctly reported. The danger is the direction of the
repair — reconciling the two comments the wrong way would silently empty every ceiling
anchor out of `mountedSolids`.

**3. The vertical-overlap test and the `-0.01` pad are written out in four and six places
respectively** (`clearance.ts` rules 2 and 2b, `collidesAt`, `fit-check`, plus
`layout-settle` and `seats()` for the pad). Nothing compares the implementations; only
fixtures where they happen to agree. A Class-1 sweep brute-forced 400 000 boundary pairs
and found 90 disagreements between rule 2b's `mTop <= fBottom + 0.005` and `collidesAt`'s
`myBottom >= oyTop - 0.005` — algebraically identical, not the same float operation.
Sub-nanometre, no user consequence, recorded because it is the literal answer to "are
these one predicate": they are not.

**Whether a 550 mm nightstand should climb a 2.1 m wardrobe at all is open**, and is not
this item — nothing reported it, and the resolve is doing exactly what its support step
says. Recorded so the next probe in this area does not read it as a collision bug.

---

The original entry follows, for the reasoning it carries.

The collision half of PR #42 **holds** — the user got *"a little space between wardrobe and
tv. It's not clipping through"*, which is the 90 mm standoff behaving. The fan case holds
too. What failed is the half `visual-check.md` named in advance: *"not triggering any alarms
either."*

That is the `blockedBy` failure mode this repo has shipped before — **computed on both
surfaces and said on one**. The size tag is supposed to name the TV.

**And a second answer to the same question, already predicted and now confirmed from the
other side.** `clearance.ts`'s `solid` list is filtered on not-wall-mounted and floor-level,
so the room report will not report a wardrobe through a mounted TV even though the drag now
refuses to create one. Same question, two answers. That filter is load-bearing — it is what
makes four other copies of the same height arithmetic safe — so this wants a `RULE_HANDLING`
row rather than a change to the filter.

### 18. Shuffle leaves a nightstand through the bed — FIXED

*"Shuffle didn't close gap, nightstand passes through bed."*

The first half **confirms** the measured diagnosis in § A.2 — at 300 mm out of place all ten
furniture relations cost less than `isWorthOffering`'s threshold, so Shuffle finds the fix
and stays quiet. That is not new and is still open there.

The second half is, and it is worse than a gap: the solver **produced an overlap**.
`visual-check.md` already recorded that *the solver does not call `collidesAt`*, filed as a
state that "still loads but cannot be re-created by dragging". A user pressing Shuffle and
getting one is a different claim — it is the app creating that state on request.

**FIXED in `b16cd34` + `b6d2cdd`.** The paragraphs above are the diagnosis as filed; what
the measurement found, and the two things the filing had wrong, are below.

**It is not a floor collision, and the solver was never producing one.** Measured over five
presets × eight shuffle presses, classifying every geometric overlap in the ACCEPTED offer
rather than trusting the cost function: every one is either a rug (which is meant to be
under things) or a `sharesFloor` tucked pair inside its tolerance. Zero floor↔floor
collisions, before the fix and after it. That is what `overlap` weighted 1000 plus
`isCleanShuffle`'s per-term `HARD_TERMS` check is for, and it works. **So the note's advice
to reach for `collidesAt` was aimed at the wrong layer** — and the warning it carried is
still right for a different reason: nothing here needed it.

**What passes through the bed is a RIDER — a lamp standing on a nightstand.** The solver
moved it independently of the piece it stood on, so a shuffle could hand back a bedside lamp
floating at 550 mm in the middle of the mattress with nothing under it. On the `u` preset
over eight presses: inside the bed twice, inside the wardrobe once, and on the other five
merely somewhere else in the room, still in mid-air. After the fix all eight leave both
lamps on their own nightstands.

**Nothing in the app could see it, and that is the transferable part.** Every hard term in
`costBreakdown` accumulates inside `if (!obstacle[i]) continue`, and `isObstacle` requires
`pos[1] < 0.05` — so a piece standing on furniture is invisible to `overlap`, `outside`,
`door`, `access` and `navigation` alike. That is the whole of `HARD_TERMS`, which is the
entire list `isCleanShuffle` reads, so the gate passed it. `lib/clearance.ts` is silent for
the same reason. And from directly above, the 2D plan draws a lamp ON a nightstand and a
lamp INSIDE a bed as the same rectangle. Three independent checks, one blind spot, and it is
the same one that made the § 17 browser probe report the wrong answer until it started
reading `y`.

**It is also the rule the drag has always had.** `lib/drag-convoy.ts` carries rigid children
with the piece under the hand; the solver was the one mover in this app that separated them.

`ridingParents` (`lib/rigid-parent.ts`) derives the relation from live geometry, because
`parentIds` is written by a drag and is empty for a room nobody has dragged in — a
`defaultScene` bedroom seeds the lamp on the nightstand and records nothing.

**Two things decided here, both measured, so nobody re-opens them cheaply:**

- **A rider is NOT excluded from `movableFor`**, which is the obvious one-line version and
  was built first. `randomizeStart` draws from the RNG once per movable piece, so taking two
  lamps out of that set reseeds every piece after them and every seeded arrangement at `u`
  becomes a different room: four baselines moved by hundreds of cost units, and
  `bed-rung-safety`'s tidiness-spread bar — a real assertion, not a record — went from inside
  0.25 to 0.819. Making that green means widening a bar to fit a number. And a pinned rider
  is a *ghost*: `randomizeStart` leaves an immovable piece at its REAL position, which is the
  seeded nightstand's spot, so it scores soft terms from coordinates its support left in the
  first step. As a finish pass beside `snapYaws` the entire cost is **one baseline moving
  0.18**, all of it soft.
- **`p.pos[1] <= 0`, not `<= SUPPORT_Y_EPS`.** The first version refused a chair standing ON
  a 40 mm mat as well as one standing beside it, so moving the mat left the chair behind. The
  test asserts both ends; a one-ended version passed against the wrong value.

**Two the review found and this does NOT fix.** Both are real, both are recorded rather than
repaired, and each says what the repair would cost.

- **`ridingParents` is DERIVED and `parentIds` is STORED, and the drag reads the stored one.**
  After a Shuffle every lamp rides its nightstand; hand-drag that same nightstand and the
  lamp stays behind — because `lib/drag-convoy.ts` reads `parentIds`, which a `defaultScene`
  bedroom never writes. So the two answers are opposite for exactly the room § 18 was filed
  against, and a user who presses Shuffle and then drags sees the app change its mind. Not
  fixed here because the repair is a **choice between two behaviour changes**, not a bug fix:
  either the drag derives too — and a lamp merely set down NEAR a table starts following it,
  which nobody asked for — or a load-time pass writes `parentIds` from `ridingParents`, which
  then has to re-run after every re-detect and makes a derivation into persisted state. Both
  are bigger than § 18 and neither is obviously right.
- **Three thresholds on one axis, over one `findSupportDetailed`.** `ridingParents` asks
  `p.pos[1] > 0`, `settleHeights` asks `support.y > 0.3`, `isObstacle` asks `pos[1] < 0.05`.
  They disagree on a **named pair**: a table lamp at y = 0.30 standing on a 300 mm ottoman —
  the catalogue's minimum ottoman height — is a rider `carryRiders` carries and a piece
  `settleHeights` drops to the floor. Wiring those two together as they stand would make the
  lamp travel with the ottoman and then fall through it. The bar in `lib/layout-settle.ts`
  now names this pair in a comment so the next person meets it before the room does;
  unifying the three is its own change, and the third (`isObstacle`) is a *search* boundary
  rather than a *physics* one, so they may be right to differ.

**The blocker had TWO halves and the first draft of this note retired only one.** It read
*"Moving authored geometry changes how every existing room looks, and nobody has had eyes
on these two"* — and the fix answered the eyes and said nothing about the rooms, which
reads as settled. So, derived rather than assumed: the diff touches no function on any
load path, and `groundY`, `verticalExtent`, `settleHeights`, `heightForNewCeiling` and
`clearance.ts` all read `dimMM` rather than the renderer, so **no saved pendant or fan
moves, resizes or re-settles**. What changes in every room already in IndexedDB is the
picture — a catalogue pendant drawn 800 mm now draws 400. The case worth a human eye is
someone who sized one *by eye* under the old renderer: `renderBaseDim` returns `p.dimMM`,
so dragging the gizmo until it *looked* 400 mm wrote about half that, and the room now
opens at half again. `visual-check.md` carries it, because the § 34 look was on a seeded
room and a warm load is a different program.

**Three things the review found that § 34 does NOT fix**, each with its own home rather
than a sentence here: the fixture-to-ceiling gap (§ 35), the non-uniform resize walking
through both caps (§ 36), and — fixed, but worth naming because it was introduced by the
same commit — `LIGHT_ANCHORS`' copy of the pendant's bulb position, which three of four
review lenses found independently and no gate in the repo could have.

**Looked at again on 2026-09-02, after the review's two changes**, because the first look
predated both: the shade was still upside down and the emitter still sat on the cord when
that screenshot was taken, so it was evidence for the sizes and for nothing else. The
re-look made the actual invariant visible rather than inferred — the selection box is drawn
from `dimMM`, so *"the drawn geometry sits inside its own box"* IS the claim, and a piece
was selected at both ends of both bands: a 150 mm pendant draws a 150 mm pendant inside a
0.15 box, an 800 × 900 one fills its own, and the 1.00 m fan's blades stop exactly at the
box edge rather than 400 mm past it. The shade opens downward and the light now comes from
inside it. Probe: `pw/box34.mjs`, which seeds its own room — a Playwright launch gets a
fresh profile, so a room seeded by an earlier script is gone.

**What is still not verified:** a real GPU. The 3D tab was looked at headless — see
`visual-check.md` for what was seen and what was not. The fixture-to-ceiling gap (§ 35) was
NOT among what was seen: the camera looks down into the room and the ceiling is a
shadow-only plane, so nothing in these shots speaks to it.

### § 35 — a hung fixture stops short of the ceiling, and `min()` is why — FIXED

Found by the § 34 review, and **caused by § 34** in the sense that matters: the gap was
always in the model and the old renderer covered it with geometry that should not have
existed.

`groundY`'s ceiling arm is `Math.max(Math.min(H - 0.15, H - MOUNT_PAD - h/2), h)`. The two
arms cross at h = 260 mm; below that the flat 150 mm nominal drop binds, and the fixture's
top lands at `H - 0.15 + h/2` instead of at `H - MOUNT_PAD`. In a 2.80 m room:

| piece | h | y | drawn top | gap |
|---|---|---|---|---|
| **ceiling fan, as it ships** | 0.20 | 2.650 | 2.750 | **50 mm** |
| fan, smallest legal | 0.15 | 2.650 | 2.725 | **75 mm** |
| fan, largest legal | 0.45 | 2.555 | 2.780 | 20 mm — `MOUNT_PAD`, intended |
| pendant, smallest legal | 0.15 | 2.650 | 2.725 | **75 mm** |
| pendant, as it ships | 0.40 | 2.580 | 2.780 | 20 mm |

So every ceiling fan added from the Library ends its downrod 50 mm below the slab. Before
§ 34 the same fan drew to 2.87 — 70 mm *through* a 2.80 m ceiling — so the gap was
hidden by an error in the other direction.

**The decision, and why it did not need asking.** It is § 34's own question one layer out:
does a hung fixture's `dimMM[2]` mean the body, or the body plus its drop? The two arms of
that `min` answer differently — `H - 0.15` says "a fan hangs 150 mm below the slab on a rod
that is not part of it", `H - MOUNT_PAD - h/2` says "the declared height is everything and
its top goes at the ceiling" — and **`min` does not choose between them, it takes whichever
hangs lower.** The rest of the app had already chosen: `fanColumn` and `pendantDrop` draw
the rod and the cord *inside* `dimMM[2]`, and `verticalExtent`, `clearance.ts` rule 2b,
`settleHeights`, `heightForNewCeiling` and `lib/drag-resolve.ts` all read that height as the
whole extent. Three of those clamp the same quantity at `roomHeight - MOUNT_PAD` and this
line gave a fourth answer. So the flat arm was not a second policy — it was the last reader
of a meaning nothing else held, and removing it is the smaller change.

The arm is `Math.max(roomHeight - MOUNT_PAD - h / 2, h)` now, which makes `groundY` a **fixed
point** of `heightForNewCeiling` rather than merely under its cap — the property that stops a
fixture creeping down 20 mm per load, and the reason `MOUNT_PAD` is in the expression at all.

**What moved.** Only fixtures shallower than the old crossover: up by `0.13 - h/2`, so 55 mm
for the smallest legal fan or pendant, 30 mm for the 200 mm fan the Library ships, nothing at
260 mm and nothing above it. Every top is now `roomHeight - MOUNT_PAD`. Nothing drew through
the ceiling before and nothing does now; the gap only ever ran the safe way.

**What a saved room does — the part that wants eyes.** A placed part's `pos` is stored, and
nothing re-places on load: `settleHeights`' cap is a maximum, so a fixture 50 mm *under* it is
left alone. So a room already in this browser keeps its gap until its ceiling is changed, and
a room where the user adds a second fan today gets one fan flush and one hanging 30 mm short.
That is the same way every other placement decision here behaves — the app does not re-place
what it has already placed — but it is the first time two of the same piece can differ, so it
is a `visual-check.md` item rather than a footnote.

**The gates, and the comparison this repo had never made.** `verticalExtent` and all of
§ 34's clauses measure a fixture against its own `dimMM`; the whole shape contract does too.
This gap is between the fixture and the *room*, and nothing compared `y + top` to
`roomHeight`. `tests/ceiling-fixtures.test.ts` does now, across both bands at 10 mm and
across seven ceiling heights from 1.8 m to 12 m, plus pins at the sizes where the flat arm
bound and a pin at the crossover — where the old and new code agree, which is exactly where a
sweep alone would have stayed green against the defect.

**What this does NOT change, deliberately.** The `wall-high` anchor keeps its own two pads
(0.05 and 0.1): a curtain rod is mounted below the slab rather than against it, so it is not
the same defect, and a test pins it against following along. And the low guard here stays `h`
while the other three clamps use `h / 2 + MOUNT_PAD` or `h / 2` — four answers for a fixture
too tall for its room, reachable only above 2(H - MOUNT_PAD)/3, which is 1.85 m in a 2.8 m
room against a 900 mm tallest ceiling fixture. Unreachable from the catalogue, so changing it
would be an unmeasured change to a case nobody has seen.

### § 36 — a non-uniform resize walks through both geometry caps — **FIXED 2026-09-03**

Also from the § 34 review, and a bigger class than the two shapes it was found in.

`ShapeDispatch` hands a **non-parametric** shape its *authored* `dimMM`
(`components/three/DynamicPart.tsx`), and `Draggable` then scales the whole group by
`groupScaleForDim(part.dimMM, storedDim)` — per axis, with the scale gizmo exposing all
three independently. Anything inside the geometry that is a **proportion of the declared
size** survives that. Anything that is an **absolute metre constant** does not, because it
is chosen before the scale is applied and never sees it.

Both new helpers have exactly one such constant each, and both are the cap that stops the
shape becoming a spike:

- Add the catalogue Pendant lamp (`[350, 350, 400]`) and resize it to 150 × 900, both
  inside its band. Scale becomes `(0.4286, 2.25, 0.4286)`; the drawn shade is 150 mm wide
  and **360 mm tall**, where `domeH ≤ 1.2r` demands 90 mm — four times over the cap, and
  exactly the outcome `pendantDrop`'s own header says it prevents.
- Resize the catalogue fan's height to 450 mm and the housing draws **180 mm** thick,
  where `fanColumn(450)` says 80. `FAN_HUB_R = 0.1` is the same class and predates this.

**The extent invariant is NOT affected** — `top - bottom` of the drawn geometry still
equals the stored height, because it is a pure proportion. So § 34's claim holds and this
is a proportion defect, not a size one. The tests that pin the caps
(`tests/ceiling-fixtures.test.ts`) are green and honest: the app simply never calls either
helper with the resized numbers.

**The options, so nobody re-derives them.** Add both shapes to `PARAMETRIC_SHAPES` so they
rebuild from the current dim instead of group-scaling — which is what that set is *for*,
and costs a re-render per resize frame. Or express every cap as a ratio, which is not
possible for `FAN_HUB_R`, since a hub is a real object with a real size. The first is
probably right and it is not a one-line change.

---

**FIXED 2026-09-03**, and the note above understated it: the class has **six** members,
not two.

**What shipped.** `fan` and `lamp-pendant` join `PARAMETRIC_SHAPES`, which is what that
set is for — the geometry rebuilds from the current dim and `Draggable` leaves the group
at scale 1. So do `tv-console`, `stool`, `nightstand` and `door`, whose caps were
literals inside `DynamicPart.tsx` and are now `consoleSlabs`, `stoolSeat`,
`drawerSlide` and `doorHandleY` in `lib/scene-spec.ts` — the `fanBlade` scar again:
arithmetic that lives only in a TSX renderer is arithmetic no test can reach.

**The whole class, at the top of each band.** `tests/parametric-caps.test.ts` prints
this on every green run, the `detect-pipeline` precedent:

| shape · detail | authored → stored | drawn | its own cap | |
|---|---|---|---|---|
| fan · motor housing | 200 → 450 mm | 180.0 | 80.0 | **2.25×** |
| lamp-pendant · shade | 400 → 900 mm | 360.0 | 210.0 | 1.71× |
| tv-console · top slab | 500 → 800 mm | 48.0 | 30.0 | 1.60× |
| tv-console · plinth | 500 → 800 mm | 96.0 | 60.0 | 1.60× |
| stool · seat pad | 450 → 700 mm | 77.8 | 50.0 | 1.56× |
| nightstand · drawer slide | 400 → 600 mm | 270.0 | 180.0 | 1.50× |
| door · handle height | 2100 → 2400 mm | 1080.0 | 1000.0 | 1.08× |

Read the ratios as a **lower bound**: the sweep moves one axis at a time. The pendant is
1.71× there and **4×** in its own test, and both are right — its shade is capped against
its own WIDTH, so the worst case needs two axes moving in opposite directions
(narrowest × longest, 150 × 900), which a per-axis sweep cannot express.

**The test is about the class, not the shapes**, and that is the part worth keeping:

> `helper(storedDim) ≠ helper(authoredDim) × (storedDim / authoredDim)` ⇒ the shape
> must be parametric.

It was observed failing before the fix, and it failed on exactly the `isParametric`
line with every arithmetic assertion before it already green — which is the whole
character of this defect: **the extent invariant is untouched**, so `top - bottom` still
equals the stored height and every assertion about a piece's SIZE stayed green. A
proportion defect living inside a correct extent is why a catalogue sweep could not see
it.

**Why the four small ones are in.** They are cosmetic where the fan and the pendant were
structural — a 48 mm console top instead of 30, against a motor thicker than the fan is
tall. They are fixed anyway because the class is the finding, and choosing which
instances of a class to fix by how ugly they look is how the next one gets missed. Two
of the six were found by review and four only by grepping for the SHAPE of the bug.

**What was considered and not done.** Expressing every cap as a ratio, the other option
the note above records. It is not available for `FAN_HUB_R`, and it is the wrong answer
for the rest on inspection: a drawer runner, a seat pad, a plinth and a door handle are
real objects at real sizes, and the honest statement is "this does not grow with the
piece" rather than a fraction chosen to look right at one size. Each helper is named for
the object rather than the number for that reason.

**Both directions are mutation-checked.** Dropping the four new shapes from
`PARAMETRIC_SHAPES` goes red; so does turning a cap into a pure proportion, which is the
assertion saying the table's rows are genuinely caps and not proportions wearing a
`min()`.

**Not verified:** nobody has resized one of these on screen. See `docs/visual-check.md`.

---


### § 37 — the Inspector's placement banner answers a question two other surfaces
already answer, and disagrees with both — REVIEWED, NOT MERGED

Reviewed 2026-09-02. The subject is `0202eaa fix(spatial): surface floating placement state`
— one file, 69 insertions in `components/studio/Inspector.tsx` — which arrived here as
`98a614a`, a **local, unpushed** merge of `agents/project-overview-and-understanding` into
`fix/ceiling-fixtures-declared-size`. It adds a `role="status"` banner above the decorating
controls reading `Outside room` / `Blocked` / `Floating` / `Wall-mounted` / `On <piece>` /
`On floor`, in danger or success colours, with a sentence of advice under it.

**Where it exists.** On `agents/project-overview-and-understanding` and in that branch's own
worktree. Not on `main`, not in any pull request. The merge was undone with
`git reset --keep` rather than kept — PR #87 is § 34's, and an unrelated Inspector change
riding it is the "does this commit contain only your hunks" failure — and the commit itself
was not touched.

**Every gate is green, which is the finding rather than a mitigation.** On the merge result:
`pnpm typecheck` clean, `pnpm lint --max-warnings 0` clean, and the full suite at 114 files /
2087 passed + 5 expected-fail. `tests/mount-height-refusal.test.tsx` mounts the **real**
Inspector through the page its own rail renders, so the banner was constructed, rendered and
asserted around under jsdom, and nothing noticed any of the three findings below. They are
about which number the banner reads, not about whether it renders, and no gate in this repo
compares one surface's answer to another's.

**1. A red danger banner on furniture that is correctly composed.** The blocked state is
`collidesAt(effParts, id, …)`, and `collidesAt` (`lib/scene-spec.ts`) deliberately has **no
`sharesFloor` exemption**, while the room report's rule 2 charges a tucked pair against
`TUCKED_CLASH_SHARE` instead of `CLASH_SHARE` (`lib/clearance.ts`, `clashBar`). This is not
inferred: `clearance.ts` states the divergence in its own words — *"a dining chair under its
table is refused by the drag and silent in the report BY DESIGN — twenty seeded pairs"* —
and files it under § 17. The drag may refuse a tuck, because a drag is a live gesture the user
can abandon; a **standing label on a selected piece is not the same act.**
*Fails when:* fresh install, any seeded room, click a dining chair — red banner, *"Blocked —
Move it away from the overlapping piece"*, while Room check says nothing is wrong. The advice
is to break a deliberate arrangement, and it is the app's own seeded content.

**2. The floating check is defeated by the function it asks.** `supportBelow()` calls
`findSupportDetailed` (`lib/physics.ts`), which takes **`x` and `z` only** and returns the
highest floor-standing top whose footprint the mover overlaps. It never compares the mover's
own `y` to that top — correctly, because its job is "what is under here", not "is this
resting". The banner treats a non-null answer as proof of contact, so a piece hovering at any
height above a table reads green, *"On Table — Supported by Table."*
*Fails when:* a lamp placed on a desk and then resized. `settleHeights` settles riders against
the **authored** `dimMM` (see § 12), so the lamp hangs about 350 mm in the air — and the
banner names the desk it is not touching. The state it does catch is a piece floating over
bare floor, which is the half the user is least likely to reach by accident. The commit
message says *"so floating furniture is not reported as clear"*; over furniture, it is.

**3. A third source of truth for "is this placement legal".** The room report answers it
(`lib/clearance.ts`, rules `outside` / `clash` / `clash-mounted`), the live drag answers it
(`blockedIds` / `blockedBy` on the drag channel, painted in the size tag and a live region),
and this adds a third — with a **different bar** from the first, a different lifetime from the
second, and a fourth containment test of its own (`partInsideRoom`, which is box-and-centre,
where the report ranks by the corner-exact `outsideDeficit`). Rule 3 of `CLAUDE.md` names this
exact scar: two consumers carrying their own copies of a placement rule is how Suggest came to
park a bed across a doorway and have Room check report it.

**Smaller things, none of them the reason it was held.** `role="status"` with
`aria-live="polite"` re-announces on every selection change and every position write, so a
drag commits a stream of announcements; the tone glyphs are literal `✓` / `!` rather than
the `Icon` wrapper every other control uses; and there is a second
`import … from '@/lib/scene-spec'` beside the one already at the top of the file.

**What holds, so it is not re-derived.** All four tokens exist (`--danger-tint`,
`--danger-text`, `--success-text`, `--paper-0`). Reading the raw `part.wallMounted` is safe
**here** — `normalizeStoredParts` re-derives it on load, and the file already reads the flag
that way in two places. `collidesAt` is passed the part inside its own list, which is the
documented-correct call and not the "filter the mover out and detection is silently off"
trap. `partInsideRoom` and `verticalExtent` get their arguments in the right order, and both
`part` and `effParts` are resolved rather than authored. `minWidth: 0` is present, so the
label ellipsises rather than spilling its rail.

**What it would take.** The idea is wanted — a selected piece saying where it stands is a
real gap, and two of the three states it invents are already computed elsewhere for the same
piece. The shape of the fix is to **read** those answers rather than recompute them: take
blocked and outside from the room report's findings for this part id, which makes the banner
agree with Room check by construction and inherits every exemption; and give "is it resting"
a real answer in `lib/physics.ts` — a support the mover is actually *on*, which is
`findSupportDetailed`'s top compared against `verticalExtent`'s bottom within a tolerance that
lives beside `MOUNT_PAD` rather than as a `0.005` in a component. That last one is worth
having on its own: nothing in the repo can currently answer "is this piece resting on
anything", which is why § 12's floating rider has no gate either.

**Not verified:** nobody has looked at the banner. The contrast of `--success-text` on
`--paper-0` was not checked, and the announcement behaviour was not tried with a screen
reader.

### 19. Library search: `stand` does not reach `Nightstand` — FIXED

*"I typed stand but I didn't get nightstand as a suggestion."*

**Cause, read off the source rather than reproduced.** `scoreItem` in `lib/shape-search.ts`
scores a query token two ways and neither is containment: an exact token match scores 3, and
a prefix match in either direction scores 1.5.

The haystack for that item is `nightstand`, `tables`, `nightstand`, `nightstand`. The query
token is `stand`. It is not equal to `nightstand`; `nightstand` does not start with `stand`;
`stand` does not start with `nightstand`. Score **0**, and `searchLibrary` filters to
`s > 0`, so the item is not merely ranked low — **it is not in the list at all.**

`SYNONYM` already maps `bedside` to `nightstand`, so the word the user reached for is the one
form nobody thought of: the compound's own tail.

**FIXED in `cf96b48`.** The paragraphs above are the diagnosis as written before the
fix; what shipped, and the two things the plan did not know, are below.

**The plan's fix was a third branch at a weight below prefix** — containment, for a query token of
some minimum length. Two things to get right rather than guess: the length floor (`tokens()`
already drops 1-character tokens, and a floor of 2 would let `an` match half the catalog),
and the weight, which must sit under 1.5 so a genuine prefix still outranks a suffix. This is
pure `lib/` logic with an existing test file, so it is gated the moment it is written — and
the assertion to watch fail is `stand` reaching `Nightstand`, plus a negative that a
2-character token does not drag in the whole catalog.

**What the plan had wrong: `rankLibrary`'s substring fallback could never have saved
this.** It runs only when scoring returns NOTHING, and `stand` does score — the
`desk-standard` shape prefix-matches it at 1.5, so the list came back non-empty with
Nightstand missing from it and the fallback never ran. A reader of the section above would
reasonably expect the search box to have found it by substring; it could not.

**The floor is 4, measured rather than picked.** Every substring of every hay token in the
catalog is a query a user can type — 797 of them — and the question asked of each is how
many of the 43 rows it admits. At a floor of 2, twelve queries reach more than ten rows; at
3, exactly one does (`ing`, the gerund tail, at 14); at 4, none. Four is the smallest floor
with no catch-all, and it is what lets `room`, `robe` and `wave` reach Bedroom, Wardrobe and
Microwave.

**And the assertion the obvious one could not make.** Pinning that `stand` puts the desk
table above Nightstand survives the weight drifting to exactly 1.5: the two rows tie, `sort`
is stable, and the desk table is the earlier catalog row, so it stays first while the
decision is gone. `achi` is the ONE query in the whole substring space where the containment
match sits earlier in `PART_LIBRARY` than the prefix match — AC unit prefix-matches at 1.5,
Washing machine contains it at 1, rows 41 and 34 — so a tie flips the order there and
nowhere else. Five mutations, five kills; the 1.5 one is killed by that assertion alone.

**Three survivors the five mutations did not reach, because they were the decisions rather
than the code.** Each is now pinned, each verified going red.

- **The direction was unguarded.** `hay.includes(q)` widened to
  `hay.includes(q) || q.includes(h)` survived all 56 assertions in the file. What it admits
  is not hypothetical: `armchair` contains `air`, so an air purifier answers a query for a
  chair; `outdoor` contains `door`, so a query the catalog has no answer for comes back with
  two confident wrong ones instead of an empty list. The comment beside the branch already
  refused the reverse direction — and a comment is not a check.
- **Accumulation was untested.** `score +=` → `score =` survived, because every new
  assertion passed a *single* token. `storage robe` is two, landing on Wardrobe by different
  branches (group exact 3 + label containment 1 = 4); under `=` the second overwrites the
  first, Wardrobe scores 1, and the query naming it most precisely ranks it third behind
  Bookshelf and Shoe rack. A multi-word box is what `rankLibrary` is actually fed.
- **The catch-all sweep was measuring the other branch.** Its worst query was `ap` — two
  characters, so a prefix hit on `Appliances`, and the branches are an else-if chain, so
  containment never ran. **Restricting the sweep by token length does not fix it**, which is
  worth writing down because it is the obvious repair: at the floor and above, the widest
  query is `appl`, still a prefix, still the same ten rows. What isolates the branch is a
  query no hay token could match any other way — not equal to one, not a prefix of one, none
  a prefix of it. The answer there is `ppli`, also ten. The two ceilings agreeing is the
  reassuring result; it was only knowable once the query naming it was one the branch served.

Two smaller repairs alongside. The test kept its own copy of the tokeniser, which omitted
`SYNONYM` — correct today only because `plant` is the one synonym key that is also a hay
token and maps to itself — and hard-coded the four haystack fields, so a fifth would have
left the measurement silently scoped to the old four; it imports `hayTokens` from the module
under test now. And `subs.size === 797` was a tripwire on the **catalog**, not a check on the
scorer: no edit to `shape-search.ts` can move it and one added row of furniture turns it red.
It is a floor now, which is all the sweep needs to know it has a space to sweep.

### 20. Deleting a merged group removed only the bed — FIXED

*"when two nightstands and a bed are grouped, deleting group using the one in the right rail
or backspace only deletes the bed."*

**Cause: one expression.** `RailFooter` called `removeParts([selectedId!])`. `selectedPartId`
is the piece a click LANDED on; `selection` is what is selected, and a merged set is selected
whole (`selectionForPick`). The two are the same value for a lone chair and different for
every merged set — which is exactly why it survived, because the defect is invisible on the
pieces anyone tests with.

**The fix is at the call site, not in `removeParts`,** and that is the load-bearing part. The
tempting repair is to expand `groupId` inside the shared delete path, which would then delete
the whole set when a **drilled-in member** is selected — a second bug wearing the first one's
fix. `tests/group-delete.test.tsx` pins the drill-in case and it fails against exactly that
mutation.

**The Backspace half of the report is unreproduced and probably was not the same bug.**
`deleteSelection` already read `selectedIds()`, which returns the whole selection, so by the
code it should have deleted all three. It may have been the rail button pressed first, or a
collapsed selection (§ H.14 is about the canvas click losing group members). Worth one look
now the rail button is fixed; if Backspace still takes only the bed, the cause is in
selection, not in delete.

Shipped with six mutations watched failing. One of them was an apparent survivor and was
not: **a needle spanning a newline matches nothing in a CRLF tree**, so the mutation had
never applied and the green meant nothing. `docs/traps.md` already carries that one.

### 21. Shrinking the room leaves the furniture where it was — FIXED, and this entry was the stale half

*"reducing room size doesn't seem to move the models on the ground along."* Their screenshot
shows a sofa and a floor lamp standing entirely outside the shell.

**Two paths change a room's size and only one of them carries the furniture.** Dragging a
wall goes through `lib/wall-move.ts`, which exists precisely to bring the pieces with it —
CLAUDE.md's own account of `offsetWall` describes `wall-move.ts` carrying furniture inward.
The dimension fields in Room tools are the other path, and the report says they do not.

**FIXED in `c3ff399` (2026-08-30), and the paragraph above had already been overtaken when
it was last read.** `carryForResize` in `lib/wall-move.ts` is the typed-in-Room-tools half,
`recarryForResize` in `lib/transforms.ts` splits its answer across the authored and override
layers, and `RoomDimsEditor` calls it. The missing half was the second one the paragraph
guessed at and worse: the editor carried the pieces hung from the CEILING when the height
changed (`regradeForNewCeiling`) and carried nothing at all when width or depth changed —
one axis of three.

**This entry was stale for two days and nothing noticed**, which is the hand-off rule in
CLAUDE.md meeting its own subject: the fix's docblock names this defect in full, the doc did
not, and a reader trusting the doc would have re-derived a diagnosis that already existed in
code. Re-derive before acting on a note, and correct the note in the same breath.

Two properties worth keeping. **Displacements ADD** — a sofa in a corner belongs to both
walls that meet there, and shrinking on both axes has to move it diagonally; a piece spanning
two OPPOSITE walls gets two cancelling deltas and stays put, which is correct, because it
does not fit and saying so is the room report's job. And it **never makes containment worse**:
a piece that was inside and would end up outside is dropped from the move and keeps its
place, so the room reports a wall standing in it rather than the app silently shoving it.
That decline is exactly what § H.16b now makes visible.

Note this is NOT the same as a piece the room can no longer hold. Carrying is what happens
while there is room to move into; § 22 is what happens when there is not.

### 22. There is no minimum room size, and no floor under a shrink — FIXED

The user's own framing, and it is a design more than a bug: *"there should be default size
and also min width imposed because present models have width that won't allow the room to be
reduced further, so basically, the room be reduced moves models along until the model width
won't allow any further reduction of room width or room meets the default min width for
rooms. It needs to be flexible but close to standard small rooms."*

So the shrink has **two** stops and today it has neither:

· a **hard floor** — a room may not go below some standard-small-room side, whatever is in it;
· a **furniture-derived stop** — before the floor, the widest piece on the axis being
  squeezed is what blocks further reduction.

`ROOM_SIDE_M` already bounds a room's side and `roomAxisRange` already feeds the fields, so
the hard floor has a home. The furniture-derived stop does not, and it is the more
interesting half: it is a *dynamic* minimum, so `boundsToUnit`'s pair-conversion problem
applies to it — a bound that moves has to reach the control in the control's own unit and
round toward the interior, or the arrows and the commit disagree again.

**And it must refuse rather than resize**, per rule 2. When the room cannot shrink further
the app says so; it does not quietly shrink the sofa to make the number fit.

**ANSWERED 2026-08-30: "permit corridors."** So there is no hard floor to raise and the
list above has one stop, not two — `ROOM_SIDE_M.min` stays at 1 m and the furniture-derived
stop is the whole mechanism.

That is also the safer of the two designs, for a reason nobody had priced when the hard
floor was proposed: `lib/scene-file.ts` treats an out-of-range width or depth as **fatal**,
so raising the minimum would make previously-saved small rooms refuse to open — a
regression on real user data, and it would have needed an author-time bound distinct from
the load bound to avoid. Permitting corridors removes that problem rather than solving it.

The dynamic minimum still owes `boundsToUnit` the pair treatment described above.

**SHIPPED 2026-08-30** — `db97bf7` + `f3641c1`, branch
`fix/room-shrink-stops-at-the-furniture`.

`lib/room-floor.ts` is the rule. `furnitureFloor(parts, axis)` is the largest
world-space extent any single piece needs on that axis, rotated, through
`footExtentAlong` — so a round table needs its DIAMETER rather than its bounding
box, which differ by 248.5 mm on a 1200 mm piece. **Every part counts**, and the
filter that looks like it belongs there does not: `floorBlockers` drops rugs,
wall-hung items and anything under 250 mm tall because it answers "what gets in a
walker's way", and a 3 m rug needs 3 m of floor exactly as a 3 m sofa does.

`roomFloor(stop, current)` then clamps to the room's **current** side, which is the
half that is easy to omit and impossible to see afterwards. A room can already be
narrower than something standing in it. Without it the floor sits above the current
width, `NumberField` clamps the value up to its own `min` and one chevron silently
GROWS the room, while a wall drag outward is refused for being still under the
piece — so the one gesture that could fix the room is the one blocked.

Both paths read it: `RoomDimsEditor` → `applyRoomEdits` (which takes a plain number
per axis, so `dimension-ranges.ts` never learns about `ScenePart`), and
`lib/wall-actions.ts`, the single chokepoint for all four wall surfaces. The bound
reaches the stepper through `boundsToUnit` like every other one, so the arrows
cannot walk the room somewhere the commit will refuse.

**And the wall half was not merely missing a stop — it had no voice.**
`moveWallCarrying` has always returned the applied delta and **not one of its four
call sites read it**, so every refusal was silent; `PlanView.onWallKeyDown` was
worse, announcing *"moved in. Room is now 3.0 by 2.4"* on a press that moved
nothing. The refusal now speaks from the chokepoint, once per gesture, which needed
`announce` to be reachable from `lib/` — its dispatch is `lib/announce.ts` now and
only the rendering stayed in `KeyboardShortcuts`.

**Two defects were found in a browser and by nothing else**, both in the same
fifteen minutes, and they are the argument for looking:

· A wall reaches a bound by repeated addition, so thirty-two presses of the plan's
  50 mm step land on 2.3999999999999995 and the wall stopped at **2.45** under a
  message saying the piece needs 2.40 — the number the user is told disagreeing with
  the number they can reach. `ROOM_SIDE_EPS` lives beside `ROOM_SIDE_M` because
  `wall-actions` decides what to SAY and `scene-store.moveWall` decides what to DO,
  and one with a tolerance and one without is a wall that stops for a reason no
  message can name.
· Fixing that moved the defect into the wording. At exactly 2.40 the `fits`
  predicate said a 2.4 m piece does not fit a 2.4 m room, so the alarming *"already
  does not fit"* branch fired at the one size the user had just worked to reach.

**Still open here, and it is the honest residue:** a sighted user gets no sentence
on the wall path. The wall stops — which is legible, the way a collision is — but
the reason travels only through the `sr-only` live region. A toast was considered
and declined: `moveWallCarrying` runs per animation frame during a drag, and the
toast host caps at three with a 9 s TTL. If this is worth solving it wants the drag
channel (`lib/drag-live.ts` / `lib/refusal.ts`), which already carries a per-frame
refusal for pieces and has a surface drawn for it.

### 23. Every long button lied about being busy — FIXED

Not reported by eye and not in `visual-check.md`; found while wiring the loading states the
user asked for, in the code that was supposed to already have them.

`SuggestButton` and `TryFixButton` both held a `busy` flag, both passed it to `disabled`,
and **neither could ever show it.** `solveLayout` is synchronous and runs for seconds on a
furnished room — the #67 shuffle tests measure 2.1–3.5 s for one solve — and the flag was
set on the same tick the solve ran on. React flushes the state change, but the browser is
never handed a frame to paint it in, and `setBusy(false)` has already run by the time it
would be. `TryFixButton`'s `{busy ? 'Trying…' : 'Try a fix'}` had therefore never once been
on screen. Pressing Suggest looked like pressing nothing, for several seconds, and then the
room jumped.

**The third site had the cure written out inline.** `FitCheck.check()` set the flag and then
`setTimeout(…, 0)`, with a comment explaining precisely why — "React cannot paint while the
same tick is still solving". That is the shape `drag-resolve.ts` already records: a step
that lives in ONE caller rather than in the pipeline is a step the next caller is written
without. There are three call sites and there was one yield.

`lib/after-paint.ts` owns it now, and `components/ui/useBusyAction` is the only holder of a
busy flag over synchronous work. Two things in there are load-bearing and neither is
obvious:

· **Two frames, not one.** A `requestAnimationFrame` callback runs *before* the paint of the
  frame it was registered for, so working in the first frame blocks the very paint it is
  waiting for — the yield would be decoration in exactly the way the flag already was. The
  second callback runs after that frame is presented. `setTimeout(…, 0)` is the fallback and
  deliberately not the primary: a macrotask is only promised to run after the current *task*,
  not after a *paint*, so the old inline version worked by coincidence.
· **The re-entry guard is a ref, not the flag.** `disabled` cannot cover the gap between the
  press and the paint, because the render carrying it has not been presented — which is the
  same window the bug lived in. A double-click used to queue two three-second solves.

Mutation-checked seven ways across the two files; every assertion in both was reached.

**What is NOT verified: the paint itself.** jsdom has no compositor. The tests prove the work
is deferred past a frame boundary, which is the mechanism, not the pixel. Someone has to press
Suggest in a browser and see "Thinking…". That is now the only live item in `visual-check.md`.

### 24. What the room-shuffling research is worth — one idea, and two that are not ours

A second agent supplied how games handle "shuffle": modular slots, constraint-based
placement with an A\* check, and Wave Function Collapse. Recorded here so nobody re-proposes
the two that do not apply.

**Modular slots — no, except for one piece.** That pattern shuffles *content*: authored
anchor nodes, each with a table of style options, multiplying out to millions of
permutations. Danmu's furniture is the user's own room, so swapping their sofa for a
different sofa is editing their room, not rearranging it — and there are no authored anchors
to hang it on, because footprints are user-dragged polygons.

The part that transfers is the **counting argument**, and it is a real candidate for § 18.
Shuffle's difficulty is finding arrangements that are structurally *different*, and
re-seeding one annealer mostly re-walks one basin. `room-bays.ts` already derives the
anchors — `roomBays` gives the real rectangles of floor, `baySides` gives each side an
inward normal, a yaw and whether it is a true wall — so **enumerating bay × side × role
assignments is a source of seeds the annealer cannot reach by RNG alone**. Unmeasured, and
cheap to measure: count distinct finalists per preset with and without it, against the table
`tests/layout-shuffle.test.ts` already prints.

**Constraint-based placement — already here, and further along.** Bounding boxes and snap are
`drag-resolve.ts`; "TV faces sofa", "nightstand beside bed" are `Relation`/`relationFor`;
"rug under the seating" is `sharesFloor`; the pathfinding check is `navigabilityCost`, a
distance transform over connected components seeded at the door. The difference is that ours
is a weight *hierarchy* — three orders of magnitude between `overlap` and `balance`, so no
amount of taste buys a collision — rather than a filter.

One thing does transfer: the research runs the path check as a **post-filter**, and #67's
`newRoomFindings` is exactly that. Which says how to test it — *a post-filter is tested by
feeding it something it must reject.* That is the missing fixture behind the finding below.

**Wave Function Collapse — no, and not merely inapplicable.** WFC generates *architecture*
from tile adjacency. The room here is the user's real room, measured; generating its shape is
the one thing this product must not do. Two further blockers even if it were wanted: WFC needs
a discrete tile grid, and sizes here are continuous millimetres through `clampDims`, so
discretising throws away the trust boundary rule 2 exists to protect.

### 25. PR #67 review — three findings, ALL FIXED in `c75242b`

Reviewed at head `52d30ed` on 2026-08-30, gating the PR head itself rather than the tree.
Kept because finding 1 turned into a standing fact about the code rather than a defect
that went away when it was fixed.

1. **FIXED, and it grew. The `newRoomFindings` gate was unpinned.** Deleting `if (newRoomFindings(...).length > 0)
   continue;` from `shuffleRoom` leaves **all 11 tests green**, including the 41-second *never
   offers a room that ROOM CHECK would report*. After #68 the solver largely stops generating
   the candidates the gate discards, so on the fixture presets it never fires and that test
   measures the solver, not the gate. The PR's own commit message calls this gate "what makes
   the zero a guarantee rather than a measurement" — which is precisely the claim nothing
   verifies.

   **Probed, and the answer is stronger than "unpinned": 816 candidates over thirteen
   room configurations — the five presets plus four dining rooms built to provoke it, six
   attempts each — and the gate rejected NONE of them.** That is structural. Only three
   rules in `clearance.ts` reach the severity it filters on: `door`, already refused by
   `isCleanShuffle` through `HARD_TERMS`; `tall`, a fact about a piece's size that the
   gate's own before/after diff cancels; and `clash`, whose gap **#68 closed** — both
   modules read `TUCKED_CLASH_SHARE` now and `isCleanShuffle` demands `overlap === 0`
   exactly, so nothing reaching the gate can hold a pair past that bar.

   **The gate stays.** These two modules have drifted apart once already; what was wrong
   was the claim that a test covered it. `tests/shuffle-gate.test.ts` pins the agreement
   the quiet depends on instead — it walks a chair into a desk in 10 mm steps and asserts
   the room report calls it a clash at exactly the depths the solver charges overlap, so
   it goes red the moment either threshold moves, which is the moment the gate has work
   again. Killed by mutating either tolerance independently; the gate's own wiring is
   pinned separately. **One mutation survives and is recorded in the source rather than
   papered over:** the `|| f.rule === 'clash'` half of `serious` is redundant today,
   because the one place that emits a clash emits it at error severity.
2. **FIXED. Three tests sat at 1.4–2.3× of vitest's default 5000 ms timeout**, so they go red under
   load: 3429 ms, 3548 ms, 2129 ms measured idle. Two neighbouring tests in the same file
   already carry explicit `{ timeout: … }`, so the mechanism was known and these were missed.
   They carry an explicit 30 s now — ~8.5× the worst of the three, so it survives
   contention while still failing on a real order-of-magnitude regression, and deliberately
   not the 60 s / 300 s of the two sweeps beside them. Verified wired by setting it to 1 ms
   and watching exactly those three time out. Compounds the standing note that `main` is
   already intermittently red on machine speed.
3. **FIXED. `lib/layout-shuffle.ts` contradicted itself 155 lines apart** about whether #68 landed:
   line 79 says `layout-score.ts` "no longer exempts" a `sharesFloor` pair from `overlap`;
   lines 234–239 say it exempts them "entirely — a blanket `continue`". #68 did land, and
   `layout-score.ts:649` is now `sharesFloor(...) ? TUCKED_CLASH_SHARE : 0`.

### 26. PR #72 review — five lenses, four defects the gates could not see, ALL FIXED

Run over `db97bf7` + `f3641c1` **after** typecheck, lint, the full suite, a build, a real
browser probe and 31 mutations with zero survivors. It still found four defects and a whole
class of unpinned assertion, which is the argument for the fan-out rather than for a second
pass by the same eyes.

1. **A saved room could be made unopenable — the worst of the four, and only the
   *artifact* lens was ever going to see it.** The tolerance added for the wall drag lets a
   width persist at `0.99999999999999844` (five of six plausible start-width / step pairs
   land there), and `lib/scene-file.ts` treats a width under 1 m as **fatal** on import. A
   room this app had just written came back as *"that room file has no usable room"* — and
   only when the user tried to hand it to someone, which is the whole sharing story of
   rule 5. It is also, exactly, the regression § 22 chose "permit corridors" to avoid,
   arriving from the other end: the tolerance went to the two movers and not to the one
   boundary already documented as fatal. `readRoom` is the third reader of `ROOM_SIDE_EPS`.
2. **The message named a number the field would then refuse.** `formatDim` renders at
   `precisionFor`; the arrows are bounded by `boundsToUnit`, which rounds up to the step
   grid. A 2.4 m rug was announced as needing `7.87 ft`, and 7.87 ft is 2.3988 m, which the
   commit rejected. Four of the five units. This risk had been *reasoned about* while
   writing the code and checked in the arrow direction only — the failure was not missing
   the concern, it was testing the half of it that came to mind.
3. **The refusal was re-derived at render time rather than carried from the commit that
   made it**, so deleting the named piece rewrote the sentence under a standing refusal, and
   deleting every piece rendered an **empty** line in `--danger-text` beside an
   `aria-invalid` field — a silent refusal, in the component whose job is to report one.
4. **One predicate written twice over different operands**, agreeing only while the room is
   wider than 1 m. `namesTheStop` is the predicate now, and because `applyRoomEdits` cannot
   call it (pure over numbers, deliberately), a test pins the *agreement* over the whole
   grid rather than trusting a comment.

**And the finding that changes how assertions get written here.** `ROOM_SIDE_EPS` was pinned
only from BELOW: setting it to **40 mm** left three test files green, because every drift
fixture steps 50 mm — larger than the surviving tolerance, so none of them could see it. At
40 mm the wall walks 40 mm *inside* the sofa and the store persists a room narrower than the
piece in it. **A tolerance, a threshold or a step needs a fixture finer than itself.** Mutate
a constant's VALUE in both directions, not just delete it.

Also fixed from the same review: a de-duplication keyed on message text alone, which
swallowed a second wall's refusal (the sentence names the piece and the axis, not the wall)
while spamming a held one; the resting hint printing the width floor and calling it "a side";
and a wall that **refused a whole frame** rather than stopping at its limit, which at the
plan's minimum zoom left a fast drag up to a metre short of the stop it was naming.

38 mutations across five files, 0 survivors. One is documented as unreachable in the source
rather than given a tautological test — `permittedDelta`'s sign guard, which cannot fire
while `roomFloor` clamps the floor to the current side.

**Still open, and it is a judgement rather than a defect:** a sighted user gets no sentence
on the wall path. See `docs/visual-check.md`.

### 27. § H.15 — the rotate gizmo moved whatever its ring passed over. SHIPPED

Cause read out of the installed source rather than reproduced, because the chain is
complete and each link is checkable in `node_modules`:

- `@react-three/fiber` **9.6.1** raycasts `internal.interaction` — the objects that carry
  event handlers. drei **10.7.7** renders `TransformControls` as a `<primitive>` with none,
  so the ring, the arrows and the planes are **transparent to picking**. A press aimed at a
  handle is delivered to whatever furniture sits behind it, and that piece starts a drag.
- `Draggable.onPointerDown` already had three guards that would refuse such a press —
  `gizmoActive`, `_gestureOwner`, `gestureOwnedByOther` — and **all three read state the
  gizmo sets in its `mouseDown`, which has not happened yet.** drei passes R3F's
  `events.connected` as the controls' `domElement`, so both listen on the same element;
  R3F registered at Canvas mount and the controls when the piece was selected, so R3F's
  dispatch is always first. *Ordering, not logic.*

So the claim is **undone rather than pre-empted** (`lib/gizmo-press.ts`). Nothing the press
set up has moved anything yet, so handing it back in the gizmo's own `onMouseDown` — same
DOM dispatch, microseconds later — is lossless, and it is order-independent: were the two
ever to swap, `gestureOwnedByOther` catches it instead.

**Two things the item did not know about.**

1. **The click steals the selection too, and nothing was stopping it.** A gizmo gesture ends
   in a DOM `click` like any drag; by then `onMouseUp` has cleared `draggingId`, so
   `Pickable`'s `gestureOwnedByOther` is false and the click re-selects whatever mesh the
   ring happened to be over. On the turned piece itself that is not even harmless — a plain
   click is `selectionForPick`, which drills **into** a merged group, so rotating a merged
   bed left you holding one drawer unit. Same gate shape as `lib/drag-click.ts`, same
   deliberate absence of a part id, and armed even when the press held nothing.
2. **The 2D plan has the same defect by a different mechanism** — which is the half of the
   user's *"I don't think this issue only exists with nightstands or only in 3d mode"* that
   turned out to be right. `planPaintOrder` sorts by footprint area **descending**, so the
   smallest piece paints last and sits on top; the turn handle was drawn inside its own
   piece's `<g>`, at that piece's depth, and a nightstand's filled rect covered a bed's
   handle. SVG hit-testing gives the press to whatever is topmost. It draws in a layer of
   its own now, after every piece.

**What was rejected, so nobody re-proposes it.** A capture-phase `pointerdown` listener that
re-runs the gizmo's hover test at the press point and refuses up front. It works, and it is
worse: `axis`, `dragging`, `enabled` and `pointerHover` are all declared `private` in
three-stdlib's `.d.ts`, so it is a cast today and a **silent no-op** the day any of them is
renamed. Asking the gizmo is one source of truth for which presses it took, and
`onPointerDown` re-runs `pointerHover` at the press point before dispatching `mouseDown`,
which is what makes the answer right for a **finger** as well — there is no previous hover to
read on touch, so the stale-`axis` version would have covered mice only.

12 mutations on `lib/gizmo-press.ts`, 0 survivors — after one round in which **M11 survived
and was not equivalent**: swapping the two lines of `claimPressForGizmo` is invisible to
every test whose teardown ends by calling `releasePress`, which is all of them, and stops
being invisible only when a teardown **throws**. The comment claiming the order mattered was
written before anything could see it.

**What no test here reaches:** that the gizmo's `mouseDown` genuinely lands in the same DOM
dispatch, and that a real ring press over a real neighbour now turns one piece and moves
nothing. The 2D half is browser-checked (`elementFromPoint` at the handle, plus the drag);
drei's `TransformControls` has no DOM, so the 3D half is in `docs/visual-check.md`.

### 28. PR #73 review — five lenses, nine defects, and the sharpest one was mine to make

Run over `150bbfa` **after** typecheck, lint, the full suite, a build, a two-artifact browser
A/B and 12 mutations with zero survivors. The fan-out still found nine, and the pattern
across them is worth naming: **eight of the nine are about a window of time, not a value.**
This change is a gate, and a gate's defects are all "for how long" and "who else".

1. **The hold outlived the press it belonged to** — the worst, and only reachable on touch.
   `holdPress` was installed at pointer-down and given back only at pointer-UP, so it stood
   for the whole drag. Put a finger on a drawer unit, dwell past 280 ms, start sliding, then
   put a second finger on the ring of the piece that is still *selected*: `Draggable` refuses
   the second press at `_gestureOwner` so it installs no hold of its own, three-stdlib's
   `TransformControls` has no multi-pointer guard, and its `mouseDown` takes the FIRST
   finger's press back. The drawer stops following, `commit()` never runs for it, and 3D goes
   on drawing it where the drag left it while the store, the plan and any saved file hold the
   old position. The module's own comment — *"nothing has moved yet, so handing it back is
   lossless"* — was true at the instant of the press and false across the window it was open.
   Given back at the touch pick-up and at both places `started` is set.
2. **The two gates have opposite lifetimes and were treated as one rule.** `drag-click` arms
   on pointer-UP, so any later press is a new gesture and can clear it unconditionally. This
   one arms on pointer-DOWN, so a SECOND pointer landing mid-rotate reached
   `clearGizmoClick()` one line before the guards below would have refused the press — two
   fingers on a merged group and the click ending the rotate drilled into it, which is the
   one thing the gate exists to stop.
3. **One consumer was not enough.** A ring sweeps over furniture, walls and floor; only
   furniture consumed. A rotate finishing over plaster left the gate armed with nothing to
   take it, and the next press that would have cleared it can be one that never reaches
   `Draggable` — `WallHandles` stops propagation on its own knob — so it ate an ordinary
   selection a gesture later. `RoomShell`'s wall and `Room`'s `onPointerMissed` consume it
   now, and each is right on its own terms too: a gesture is not a click on whatever it
   happened to finish over.
4. **A press on the plan's leader line fell through to the canvas** — deselect on a tap,
   marquee on a drag, down the middle of the piece you had just selected. Nested inside the
   piece's `<g onPointerDown>` it had been a target that bubbled harmlessly, so nobody had
   noticed it was hittable; every other decorative layer in that file already declines
   presses.
5. **Enter, Space, Delete and Backspace went dead on the turn handle.** `onRotateKeyDown`
   takes the arrows and returns bare for everything else, which used to bubble to the piece's
   own `onKeyDown`. `role="button"` was left advertising an activation key that did nothing,
   and the global Delete is gated on the canvas surface holding focus, which it does not.
6. **An unkeyed `<g>` let React reuse the circle by index**, so Ctrl+D kept DOM focus on a
   node whose piece had changed underneath it: focus ring gone off a control that still had
   focus, `aria-label` silently another piece's name, next arrow key turning the piece the
   user was not being told about.
7. **A cursor cleared that was never set.** The teardown wrote `document.body.style.cursor =
   ''`, which `Pickable` owns while hovering and only re-sets on a fresh `pointerover` — and
   the pointer has not left the mesh, so none is coming. The whole rotate ran under the
   default arrow.
8. **`holdPress` dropping a replaced hold's teardown unrun was unpinned** — the tidy-looking
   version (release the stale one first) survived all 12 mutations with every test green,
   because the only test about replacement passed `() => {}` for both holds.
9. **The `beforeEach` was not a reset and was inert.** Three hand-typed ids fed to an
   id-gated `releasePress`: a hold under any fourth id survived it, and emptying the body left
   every test green. Its replacement caught a second defect on its first run — the obvious
   fix, `claimPressForGizmo()`, *runs* the leaked teardown, so it would have executed the very
   callback it existed to protect the next test from. Displacing the stale hold with a
   harmless one and claiming THAT away is the reset, which ties it to finding 8's property.

**Two things about the method.** A comment I had written was wrong in a way no gate could
see: `claimPressForGizmo`'s docstring said every teardown ends by calling `releasePress`, and
none of them does — so the test built on that sentence modelled a re-entrancy production
never produces. And **a mutation that never applied reported as a kill**: the script's
`assert` threw, the next line was not chained with `&&`, and the build ran unmutated source.
The probe went green and I read it as the assertion holding. Verify the mutation is IN the
artifact — `grep` the file before building — rather than trusting the script said so.

15 mutations on `lib/gizmo-press.ts` after the review, 0 survivors.

### 29. § H.16 — a wall rider was exempt from being in the room. SHIPPED in `20654e5`

*"models are still going through walls in 2d plan mode."*

**It was never the plan.** Both tabs end in `resolvePlacement`, and its legality test
opened with a blanket exemption:

```
const inRoom = ridesAWall || (rug…) || (obbInsidePoly(slightlyShrunk) && pointInFootprint(x, z));
```

The stated reason was that *"the snap above just placed it exactly on an edge — the
exemption is EARNED by that snap"*. **`snapToWall` says in its own comment that it does no
such thing** when the piece is wider than the wall it landed on: it centres it and lets both
ends hang past the corners, on purpose, because shrinking it is what rule 2 forbids and
`clearance.ts` is what reports it. Two functions, one of them stating the premise the other
one denies, in files that already cross-reference each other.

On a rectangle those ends hang over the neighbouring wall's floor and nobody notices. On an
**L, a T or a U** they hang into the missing quadrant — outside the room — and the drag
committed `valid` with no red and nothing said.

| | |
|---|---|
| escapes | **570** of 55,528 accepted placements |
| who | curtain 311 · **window 196** · painting 45 · TV 18 |
| where | L, T, U only. `rect` and `open` clean at every size |
| swept | 42 `PART_LIBRARY` pairs × 3 sizes × 3 angles × 35 targets × 5 layout ids = 66,150 |

Not a curtain defect: **wider than the wall it landed on**. A max-size TV and a max-size
painting do it too, and a mid-size curtain does it in all three non-rectangular presets.

**Deleted rather than repaired, and that was measured rather than judged.** The sweep
scores both builds in one run: the catalogue accepts **55,528** placements with the
exemption and **54,958** without it, so removing it costs **exactly** those 570 and not
one besides — the second half of that sentence is the load-bearing one, and it is a
subtraction rather than a hope. Both columns are pinned in the test. Five of the nine
riders — `door`, `ac/ac-unit`, both mirrors and `tv/soundbar`, the ones that sit in or on
the plaster and are the reason such an exemption gets written — are accepted at all 1,575
samples each without it. The inset in `slightlyShrunk` was already doing that job for
everything else, and it is **5 mm per face**: it subtracts 10 from a dimension in
millimetres and `obbFromPart` halves it. Four documents called it "a 10 mm shrink". A predicate that
needs a carve-out per shape is the tell CLAUDE.md § 3 names, and this one had grown its
justification after the fact.

**Five mistakes on the way, and every one of them was in the CHECKER rather than the fix.
The fix is one deleted line; everything below is the instrument being wrong about it.**

1. **The first sweep reported 11,890 findings and every one was false.** It asked whether
   the whole footprint was inside the polygon; the pipeline asks whether a footprint inset
   by 5 mm a face is, because the clamp parks a piece EXACTLY on the wall and a corner on
   the boundary is not outside. **A checker stricter than the code is not a checker, it is
   a second opinion nobody asked for** — and at 41% noise it would have buried the real
   ones.
   **Then it overshot the other way and nobody said so.** Correcting it left the oracle
   asking only about corners while the pipeline asks about corners *and* the centre, so 54
   samples had four inset corners inside an L and their middle in the removed quadrant.
   Deleting `&& pointInFootprint(x, z, footprint)` from the source made all 54 legal and
   **the escape assertion — the one the file is named for — stayed green**; only a total in
   a different `it` noticed.
2. **The sweep's own coverage assertion measured its own subject.** `expect(considered)
   .toBe(LAYOUTS.length * ROTS.length * …)` shrinks with the arrays it is checking: cut the
   sweep down to the rectangular layouts and the expectation shrinks with it and the file
   stays green, while the sweep can no longer reach a single one of the placements it exists
   for. Both survived a mutation run. Literals now, plus a named check that `l`, `t` and `u`
   are in the list. This is the `module-tiling` defect again in a new place: **a range
   checked against its own declared bounds only ever asks whether it sits inside itself.**
   The reason written beside that literal was **half wrong, and the wrong half was the
   confident one**: it claimed cutting `ROTS` to zero degrees would reach none of the
   escapes, "all of which were in an L, a T or a U at an angle". Measured, the withdrawn
   placements split 170 / 199 / 201 across the three angles. The LAYOUTS half is true (rect
   0, open 0). What the angles actually buy is the asymmetric case — a square-on sweep
   cannot tell a piece's width from its depth.
3. **Five layout ids are four rooms.** `rect`, `open` and `custom` all fall through to the
   same rectangle, so "five layouts" overstated coverage by a room and spent a fifth of the
   budget on a repeat — the one shape that produces zero escapes. Making
   `footprintForLayout` ignore its argument entirely, so all five rooms became that
   rectangle, passed every assertion in the coverage block.
4. **The oracle was the predicate it audits.** `footInsidePoly(footFromPart(pos, rot,
   inset))` reduces to `obbInsidePoly(obbFromPart(pos, rot, inset))` *exactly* —
   `footCorners` returns `obbCorners` verbatim when `circle` is falsy, and both end in the
   same `pointInPoly`. So `valid ⇒ inside` was a theorem about function identity. Replacing
   `pointInPoly` with `return true` turns containment off across the whole app and the
   escape assertion stayed green with **zero** escapes. It is a second implementation now,
   written from the rotation convention rather than copied, and pinned by controls including
   a 2 × 1 m box given a quarter turn — because every rectangle is symmetric in ±x and ±z,
   so a handedness error is invisible and only a **swap of which axis carries width** is
   catchable. The same mutation now reports 3,352.
5. **The sweep was keyed by CATEGORY and the rule is keyed by SHAPE, so it missed a
   shipping rider — and the headline number was wrong by 196.** `anchorFor` reads
   `ANCHOR_BY_SHAPE` before `ANCHOR_BY_CATEGORY`, so a wall-riding shape under a
   non-riding category is unreachable from a category-keyed loop. `other/window` is exactly
   that: in the Library, emitted by `local-detect` and `room-openings`, **196 escapes**, and
   structurally invisible to the guard written to protect the claim. `mirror/mirror-oval`
   and `tv/soundbar` were missing too, and `ac` was worse than missing — the hand-written
   shape map had no row for it, so `shapeFor('ac')` fell through to `'box'` and the row
   reported as "`ac` passes on its own merits" was a **box wearing the `ac` category**. The
   cost of the deletion is 570, not 374. `PART_LIBRARY` enumerates itself now, so a rider
   added tomorrow enters the sweep with no edit and the pinned counts go red until someone
   re-measures.

**The shape all five share:** the fix was one deleted line and was right the first time;
every defect was in the thing measuring it. Four of the five were found by mutation or by a
reviewer with one narrow question, and **none by re-reading the diff**.

16 mutations, **one survivor, and the survivor is the point.** Reversing the precedence in
the new `refusal` derivation — so an obstruction outranks leaving the room — left the test
written to assert that precedence green. The fixture parked a blocker at a plausible-looking
(0, 1.4); the curtain snaps to whichever wall is nearest and went somewhere else entirely,
so `collides` was false and only ONE of the two causes ever held. A test for "when both are
true, X wins" in which both are never true. It derives the blocker's spot from where the
piece actually lands now, and carries two control assertions establishing each cause
separately before asserting their order — and it kills that mutation.

**What it actually feels like, measured in a browser rather than guessed.** The first
version of this paragraph said the fix made a wrong sentence easier to reach — *"Curtain
will not fit there — something is in the way"*, when nothing is in the way and the wall is
too short. **That was written before the probe ran and it is wrong.** Dragging a 2.4 m
curtain from an L's 5 m west wall at the 2.1 m inner stub, it slides along the wall it is
already on — z = 0.00 to z = 1.30 — and simply never jumps to the stub. Nothing is refused,
so nothing is said, and nothing should be: `moveTo` tries the full move and then each axis
alone, and the "keep x, take z" candidate stays legal the whole way. That is the *"slide
along whatever it hit rather than freezing"* behaviour doing its job, and it is why this fix
costs the user nothing where the old one silently cost them a wall.

So the wording question is **not** a consequence of this change *in that room*. But the
paragraph then left it as a question — *"it would take a room where every wall is too short
for the piece, so that all three candidates fail"* — and the review answered it: **it takes
three clicks.** `dimRangeFor('curtain', 'curtain').max[0]` is 5000 mm, so the Inspector
accepts a 4 m curtain in a 3 m room with no clamp and no warning. `snapToWall` centres it on
whichever wall is nearest and lets 500 mm hang past each corner, and every wall is too
short, so all three candidates fail: **0 of 5,184 swept targets are valid, where all 5,184
were before.** The piece is not merely refused somewhere, it is un-draggable everywhere.

That is a real cost of this change and it is stated rather than argued away. What is fixed
here is the half that was a lie: `Resolved` now carries a **`refusal`**, so the sentence in
an empty room reads *"Curtain will not fit there — it is wider than that wall"* instead of
*"something is in the way"*, which sent the user hunting an obstruction that does not exist.
One derivation, `refusalCause`, read by all three surfaces that say it — the 3D drag, the
plan drag and the plan's keyboard turn — because two of them were already carrying identical
hand-written copies of the same sentence, which is the drift that makes two surfaces
disagree in the first place.

**Two things it deliberately does not do**, both recorded rather than done quietly:

- **It does not un-freeze the piece.** Whether a rider that fits on no wall should be
  refused everywhere, or allowed to sit somewhere and be *reported*, is the rule-2 question
  ("it keeps its real size and something else says it does not fit") and the answer depends
  on the reporter below existing. Refusing with a true, actionable sentence is the honest
  interim; silently accepting it again is not.
- **Nothing reported it in the Room panel.** `clearance.ts` emitted door · entry · clash ·
  walk · zone · window · tv · tall · crowding · reach · cut-off · turning, and not one was
  *outside the room* — `tall` is a height check, `freeFloorShare` DISCARDS the outside
  portion rather than reporting it. (Past tense as of § H.16b below, which adds `outside`
  and `overhang`. Do not read the list above as current; `RULE_KINDS` in
  `lib/layout-rules.ts` is the one that cannot go stale.) So `snapToWall`'s own comment, which says
  "`clearance.ts` is what says it does not fit", was **false**, and this branch propagated it
  into two more files before anyone checked. Corrected in all three, and the missing rule
  landed as § H.16b below — so the sentence is true now, for the first time, and it is true
  because the two share one predicate rather than because one of them was fixed to agree.

### § H.16b — nothing reports a piece that is outside the room — FIXED

A new `ClearanceIssue` kind, which per CLAUDE.md § 3 means a `RULE_HANDLING` row in
`layout-score.ts` as well — and `tests/layout-conformance.test.ts` will fail until it has
one, which is the gate working. Three other paths still exempt riders from containment and would each
either feed this rule or be fixed by it — `scene-spec.ts`'s `seats()` (centre-only, and it
uses the *wider* `wallMounted` flag), `wall-move.ts`'s `carryAttached` (exempts riders from
its was-inside/now-inside test), and `layout-settle.ts` (`movable = !ridesWall`, so
`contain()` never runs on one). `placeNewPart` has no legality test at all, so adding an
oversized curtain from the Library seeds the state this branch now refuses to reproduce.
**FIXED.** `RULE_KINDS` gains **two** kinds, not one, and the second is the review's
finding rather than the plan's: `outside` (the centre is off the plan) is
`{ costTerm: 'outside', movable: true }`, but `overhang` (centre in, corners out) is
`{ costTerm: null, movable: false }` with a written reason. The first version had one kind
at `movable: true`, which put a **Try a fix** button on the only finding this rule actually
produces on a shipped preset — a wall-mounted TV — and `movableFor` is
`!locked && !p.wallMounted`, so no solve this app runs can move it. Three lenses found that
independently. `outsideShare` is the wrong instrument for the other half besides: its
samples sit a third of the half-extent in from the edge, so for a sofa side-on the term
reads a flat **0 from 5 mm to 158 mm** of overhang. Both are errors.

The measurement below is what decided it was shippable, and it reproduces on the shipped
rule: **24 rooms, 269 parts, 2 findings**, both `overhang`, both the 1450 mm TV, at exactly
the positions recorded there. (The 273 in the plan block BELOW was taken from an earlier seeder;
269 is what the gate prints now, and the gate prints it on every green run rather than
leaving the number in a document.)

**The predicate is shared, not restated.** `roomContainment` and `partInsideRoom` are in
`lib/footprint.ts` now, and `drag-resolve.ts` reads the second one — a report and a gesture
disagreeing about one piece reads as whichever half you are looking at being broken. The
drag keeps its disjunction and its rug branch; the report applies its own rug rule to the
centre. `ROOM_FIT_SLACK_MM` is the drag's 10 mm, in one place, and it is pinned at BOTH ends:
set it to 0 and a sofa flush against the east wall is flagged, widen it to 200 and a sofa
20 mm through the plaster is not. The upper end was missing from the first battery and seven
mutations stayed green through it — the same one-sided defect as a breakpoint with only a
floor.

**Nine mutations, nine kills.** slack 0 · slack 200 · `box && centre` → `||` · the rug rule
applied to everything · the rug rule dropped · severity always `error` · the rule deleted ·
and the last two again against the preset sweep.

**Seen in a browser, not merely reasoned about.** `scratchpad/pw/probe-h16b.mjs` seeds one
3.0 × 2.4 room holding both kinds — a 1450 mm wall TV overhanging its wall by 425 mm, and an
armchair whose centre is 400 mm past the east wall — and reads the Room panel. The trigger
says **2 issues**; both rows carry the `Worth fixing` pill on `--danger-tint` with
`--danger-text`; *Sticks out of the room* offers **Show me** only, and *Outside the room*
offers **Show me** and **Try a fix**. Each row's copy matches the button it actually has.
Nothing in `.rail-scroll` overflows at 1440 / 1280 / 1100 px. So the `movable` split is
correct **on screen**, which is the only place it was ever going to be wrong.

Two things about that probe are worth keeping. Its first version walked to the innermost
element holding a title and reported *no buttons on either row* — which reads exactly like
the defect being looked for, and would have been believed if the expected answer had been
"no button". A probe that reports the outcome you expect is not evidence; it has to be able
to find the button before its failure to find one means anything. And the screenshot showed
a defect nothing was looking for — see § 30 below, which is not this branch's.

**Still not verified:** whether **Try a fix** on the `outside` row actually clears it. The
button renders and is enabled; what the solver does when pressed is a separate question.

The worry was false positives: this rule fires on pieces nobody dragged, so every seeded and
detected room in existence gets re-judged by it the moment it lands. Measured over
`defaultScene` for all six `LAYOUT_IDS` at four sizes each — 24 rooms, **273 seeded parts** —
with the same predicate the drag uses (`obbInsidePoly` of the piece shrunk by 10 mm, plus
`pointInFootprint` of its centre):

**2 of 273 would be flagged, and both are real.** A 1450 mm `tv/tv` on the east wall of a
3.0 × 2.4 **L** at (1.44, −0.50), and the same TV in the **T** at (1.44, −0.66). That wall
runs 1.2 m; the TV is 1.45 m and overhangs both ends — one into the notch, one past the
corner. So the checker's first act would be to report a defect the SEEDER still creates,
which is the same class § H.16 fixed for dragging and did not fix for seeding. Nothing else
in any preset moves, at any of the four sizes.

**Design notes that survived that measurement**, worth keeping rather than re-deriving:

- The predicate must be the drag's, or the report and the drag disagree about one piece. The
  strict half is shared; the **rug** exemption is not, because the drag's version also asks
  `roomIsWideEnough` and `!shovedIntoRoom`, which are questions about a GESTURE and mean
  nothing for a piece standing still. For a static report a rug is outside only when its
  CENTRE is out — overhang is what a rug is for.
- Keep the disjunction when extracting. The drag reads
  `(rug && … && centreIn) || (obbInside && centreIn)`, and a rug that is fully inside passes
  through the SECOND branch — so collapsing it to `partInsideRoom(…) && (…gesture tests…)`
  silently refuses a shoved rug that ended up entirely in the room.
- The finding's magnitude comes free from the two predicates already being evaluated: centre
  out reads as “standing outside the room”, centre in with corners out as “sticks out of the
  room”. No new instrument — and in particular **not `outsideShare`**, whose samples sit 10%
  in from the edges and would report 0% for a piece 20 mm through the plaster.
- **Superseded by the review — do not implement this bullet as written.** It says
  `RULE_HANDLING` wants `outside: { costTerm: 'outside', movable: true }`, and
  `tests/layout-conformance.test.ts` then demands a `cases()` entry: a bad/good pair in its
  6 × 4 `RECT` where the report raises `outside` on the bad layout, is quiet on the good one,
  and the solver's `outside` term rises between them and is exactly 0 on the good one. A sofa
  at x ≈ 3.2 against x = 0 is the obvious pair; the term already exists, weighted 1000.

### § 30 — the 2D plan draws a wall NAME and a wall RULER in the same place — FIXED

Found by looking at a screenshot taken for § H.16b, which is the only reason it is here: no
test asks whether two pieces of text land on each other, and nothing else in this document
names it. It is a defect that has shipped, is visible on the first room anyone opens in the
2D tab, and was invisible to typecheck, lint and 1,983 assertions.

In **2D Plan**, the North and East wall labels and the room dimension rulers are both drawn
just outside the same wall, and they collide. On a bare 3.0 × 2.4 rect, `East wall` renders
as `Ea` — gap — `wall`, with the vertical `2.40 m` running straight through the middle of
the words, and the `3.00 m` rule strikes through `North wall`. It is not a furniture problem
and not a small-room problem: it reproduces with **an empty room at every size measured**,
and only the amount changes.

Measured by a scratch Playwright probe (`probe-walllabel.mjs`, not in the repo — the method
is the part worth keeping) that intersects the client rect of every
`svg text` node pairwise — a question a browser answers exactly, with nothing eyeballed:

| room | North wall × width | East wall × depth |
|---|---|---|
| 3.0 × 2.4 | 61 × 10 px | 22 × 26 px |
| 5.0 × 4.0 | 43 × 7 px | 15 × 18 px |
| 7.5 × 5.6 | 32 × 5 px | 12 × 13 px |

The overlap **shrinks as the room grows** only because the whole plan is scaled to fit, and
both texts scale with it — `North wall` measures 92 x 26 px at 3.0 x 2.4 and 47 x 13 px at
7.5 x 5.6, the ruler 61 x 22 and 32 x 12. In the plan's own user units the collision is
constant, and there is no size that escapes it.

The mechanism is exact, and it is not a near miss. Both are drawn in `PlanView.tsx`. A wall
label sits 26 user units along its edge's outward normal; the overall-dimension ruler is a
band at 11-26 units outside the plan box on the top and right. For a rectangle the north and
east walls ARE those two sides of the box, so the label is placed inside the ruler's band by
construction. And the ruler is not merely near it: each of its numbers carries an opaque
`fill="var(--paper)"` backdrop rect, drawn AFTER the labels, so it does not overlap the word
so much as **erase the middle of it**. That is exactly what `Ea` - gap - `wall` is. South and
West are quiet because no ruler is drawn on those two sides, so this is two walls' worth of
evidence rather than four.

The first version of this entry blamed "one placed in world units, the other at a fixed
screen offset". That was read off the source and it was wrong — both offsets are fixed, and
the px numbers shrink because of the fit scale. Recorded because a wrong reason in a document
is worse than no reason: it is cheaper to quote than to re-derive, and it scopes the next
person's search.

The fix is therefore a one-line question — move the label out of the band, not nudge it
within one — and the constants are already there to do it against rather than by taste.

**FIXED.** `lib/plan-annotations.ts` now holds both offsets, the ruler’s backdrop extent and
the label’s half-extents, so the numbers being drawn and the numbers being checked are the
same numbers; `PlanView` reads them and `tests/plan-annotations.test.ts` asserts the bands
are disjoint. The RULER moved (18 → 62), not the label: `WALL_LABEL_OFFSET` applies to every
edge of every footprint including the interior edges of an L, T or U, while the ruler only
ever runs along the bounding box — so moving the label would have moved it on six-edge rooms
that never had the problem.

**The first fix was wrong and the browser is the only thing that said so.** It modelled ONE
half-extent for the label, cleared the north wall, and left east overlapping by 4 units —
with every assertion green, because they all derived the label’s band from the same constant
they were checking. A label reaches the ruler by its HEIGHT on a vertical normal (~12 units)
and by its WIDTH on a horizontal one (~42). That is this repo’s "verify in the asymmetric
case" exactly: a north-wall screenshot and a square room hide it identically. The test sweeps
`WALL_AXES` now rather than checking the axis that was looked at.

Two mutation notes worth keeping. Setting the label half-extent to **2** passed all five of
the first assertions — shrinking it moves the band AND the thing measuring the band, so the
gap widens and the plan overlaps exactly as before. It is pinned against the browser numbers
now, and an under-estimate is the only direction that silently re-opens the defect. And a
renderer that went back to a literal would leave every band assertion green, so the test
greps `PlanView` for both rulers — fixing only the top one leaves "East wall", the worse of
the two, exactly as it was.

Verified after the fix by the same probe that found it: rect, L and U at 3.0 × 2.4, 5.0 × 4.0
and 7.5 × 5.6 — nine rooms, up to twelve labels each, no two text boxes intersecting.

### § H.16c — the room said a piece was outside and Fix would not move it — FIXED

Reported by the user with a screenshot, one day after § H.16b shipped, and it was **two
independent defects wearing one symptom**. A sofa in a 6.0 × 4.7 room, reported *Sticks out of
the room*, with no **Try a fix** on the row and the rail's **Fix** moving nothing.

**1. The rule was split on the wrong question.** § H.16b split containment by GEOMETRY — centre
off the plan was `outside` (movable), merely crossing a wall was `overhang` (not movable) — and
justified the second with "every version of it the solver cannot reach: a wall rider, a rug, a
low piece". That reasoning is true of a wall-mounted TV and simply false of a sofa, which is
ordinary movable furniture standing on the floor. The geometry answers *where is it*, which is
what the TITLE is for; it does not answer *can this be fixed*.

The split is `isObstacle` now, which is the **same predicate `layout-score` gates `c.outside`
on** (`if (!obstacle[i]) continue`). That identity is the whole design: a containment finding is
fixable exactly when the cost term can see the piece. The kinds are `outside` and
`outside-immovable`; the titles are unchanged and still geometric.

**2. The cost term had a dead band, so even the rail's Fix could not act.** `outsideShare`
samples a 3 × 3 grid whose outermost points sit a third of the half-extent in from the edge, so
for a 2.2 m sofa side-on it reads **exactly 0.000 until about 160 mm** is through the plaster.
Measured:

| overhang | rule (before) | `outsideShare` | Try a fix (before) |
|---|---|---|---|
| 20 mm | overhang | **0.000** | no |
| 100 mm | overhang | **0.000** | no |
| 300 mm | overhang | 0.333 | no — *though the solver could* |
| 500 mm | outside | 0.667 | yes |

So below ~160 mm the room reported a fault that nothing could price; between there and the
centre leaving the plan, the solver could act and the panel refused to offer it. Fixing only the
rule would have replaced "no button" with "a button that does nothing" for the first band —
which is the anti-pattern `RULE_HANDLING` exists to prevent, arrived at from the other side.
`outsideDeficit` (`lib/geometry.ts`) is corner-exact and non-zero as soon as any corner is out;
`c.outside` takes the **max** of it (normalised by the piece's radius) and the share, so the term
is `>=` its old value for every input and only assertions that read 0 could move.

**Driven end to end in a browser**, which is the only place the original report could be
confirmed: a 6.0 × 4.7 room, sofa at 60 mm (inside the old dead band) and at 300 mm (the
screenshot's case). Both now show **Try a fix**, both move the sofa back inside — persisted to
IndexedDB, read back from there rather than off the screen — and in both the finding is gone and
the panel returns to *Everything fits*.

**What it cost, all of it recorded rather than absorbed.** Seven measured baselines across three
files moved, and each was checked for direction rather than re-pinned:

- `outside` is now **0.00 on all twelve seeds** of the scrambled U, and two more seeds end with
  nothing on any hard term (7 → 9). The term works.
- The phantom-move rate — a piece reported as moved that only got squared up — went **down**,
  23.17% → 13.75%, measured as an A/B on one fixture over 80 seeds.
- The worst seed's total went 92.10 → 412.85, **all of it `navigation`**, and the Double bed rung
  at U 6 × 5 now blocks a door where nothing did before. Both are the same trade and both are
  § 31, which is a decision nobody has made rather than a defect.

The shipped bed rung still keeps the door clear, and that assertion is now named in capitals in
`tests/bed-rung-safety.test.ts` so the next person cannot re-baseline it by accident.

### § 31 — containment now outranks a blocked door by a hair — ANSWERED 2026-09-02, **BUILT 2026-09-03**

Surfaced by § H.16c above, and it is a **decision, not a defect**: two hard terms now price
within a few units of each other on one room, and which one wins is currently an accident of
their weights rather than anything anyone chose.

**ANSWERED by the user, 2026-09-02.** Their words, because the reasoning is the part that
generalises:

> *"door being blocked (avoid if possible) is objectively better than a model going through
> walls. nothing physically impossible should be encouraged. door being blocked can be
> prompted and fix with the fix feature."*

That is the **third option** — a veto rather than a price — and it is stronger than any of
the three framings below anticipated, because it does not order the two terms by how bad
they are. It splits them by KIND. A piece through a wall is *physically impossible*; a
blocked door is a room that is merely bad, and the app already has a way to say so and a
button to act on it. So the two are not comparable quantities at all, and the 200-unit gap
between `outside: 1000` and `door: 800` is the wrong shape of answer even when it happens to
give the right one.

**What the decision forbids, and it is the opposite direction from the incident below.** The
recorded case had the solver *blocking the door* to avoid 190 mm of bed through a wall —
which is what the user wants, arrived at by ten units out of a thousand. The case the
decision actually outlaws is the cheap one: `outsideDeficit` is corner-exact and continuous
from zero, so a 20 mm overhang costs almost nothing and is bought by any door cost at all.
Today the solver will prefer a piece slightly through the plaster over a blocked door, every
time, and that is now wrong by decision rather than by taste. **Measure it before building
anything** — the claim is about the cost function and can be settled without the annealer,
by scoring two arrangements of one room.

**Where it goes, and where it must not.** `costBreakdown`'s own comment argues against a
cliff in as many words — *"a cost function is read as a gradient and a cliff gives the
annealer nothing to walk down"* — and that reasoning still holds for the descent. A step
penalty on `outside` would contradict the file's own design. The decision belongs at the
points where an arrangement is CHOSEN rather than searched:

  · `lowestTotal` in `lib/layout-solve.ts`, which picks which finalist becomes the
    suggestion. `SolveOptions.pick` already exists as the seam for substituting a ranker, so
    a lexicographic default costs one function and no landscape change.
    *(It is called `bestCandidate` now, and it does do this — see BUILT below.)*
  · `anyWorse` over `HARD_TERMS` already keeps the hard terms apart in the finish passes —
    the veto's shape is there, it is just unordered.
    *(Wrong, and left standing as the plan's own error: both its call sites are in
    `snapYaws`, a cosmetic tidy. Nothing was changed there — see BUILT below.)*

**The honest limit of that**, to be written down rather than discovered later: ranking
finalists can only choose among what the search kept. If every finalist has a piece outside,
nothing changes. Whether the pool ever holds both kinds is a measurement nobody has taken.

**Do not re-tune `DEFAULT_WEIGHTS`** to implement this. A weight cannot express it: the door
term is a sum over doors and the outside term is continuous from zero, so no finite weight
makes *any* overhang dearer than *any* door block. That is precisely why the answer is a
veto and not a number.

---

**BUILT 2026-09-03.** What the plan above got right, what it got wrong, and every number that
came out of building it. `IMPOSSIBLE_TERMS` in `lib/layout-solve.ts` is the split,
`impossibility(breakdown)` is the reading, and three choice points act on it.

**The measurement the plan asked for, taken first.** A 6 x 4 room, a door in the south wall,
one 1200 mm wardrobe, at `DEFAULT_WEIGHTS`:

| arrangement | `outside` | `door` |
|---|---|---|
| 0.5 mm through the north wall | 0.75 | 0 |
| 5 mm through | 7.45 | 0 |
| 20 mm through | 29.81 | 0 |
| barely clipping the door path | 0 | 50.00 |
| squarely across the doorway | 0 | 900.00 |

The claim held exactly: a 20 mm overhang was bought by the lightest touch of a door path. And
the reason a weight cannot fix it is visible in the same table — **both terms are continuous
from zero**, so the overhang can always be made smaller than any fixed door cost.

**The plan named the wrong place, and that is the finding.** It put the veto in `lowestTotal`
and in `anyWorse`. Ranking finalists turned out to be the *small* lever, and `anyWorse` turned
out to be the wrong lever entirely.

  · **`lowestTotal` → `bestCandidate`**, ranking least-impossible then cheapest. Measured
    over five presets x eight seeds of a scrambled room: 40 pools held more than one finalist,
    **2** held both kinds, **1** changed hands. Over a wider sweep including seeded rooms the
    old picker chose an impossible finalist 23 times, and the new one finds a legal finalist in
    **6** of those. Real, and small.

  · **`anyWorse` was left alone**, and the plan's line about it — *"the veto's shape is
    there, it is just unordered"* — does not survive reading its call sites. Both are in
    `snapYaws`, a cosmetic tidy that squares a crooked piece, and its own comment already says
    *"better crooked than through a wall"*, which is the ruling. Ordering it there would let a
    tidy block a door in order to straighten a sofa.

  · **`solveLayout`'s accept is where the defect actually lived.** The invariant was
    `after.total >= before` — one number — so an answer could put a wardrobe through a wall
    provided it bought back more than 1000 units of taste elsewhere. Over 160 solves (five
    presets x two modes x scrambled-and-seeded x eight seeds), **18 handed back a room MORE
    impossible than the one they were given, and every one started from a legal seeded room.**
    The L preset's worst went `outside` 0 → 371.6 — about 200 mm of wardrobe inside the
    plaster — while its total improved 811 → 400. That is a **first-run defect**: a brand-new
    L-shaped room, one press of Suggest. `RoomTools` writes a solve straight to the store and
    gates only on `isWorthOffering`, which reads those same totals; **Try a fix** is exempt
    from even that. 18 of 160 → **0 of 160**, with 130 of 160 answers still moving something.

  · **`openRoutes` was a third site nobody had listed.** The repair pass moves obstacles to
    clear a path, so pushing a piece through the plaster is inside its own proposal space and
    scores well — the wall it goes through is not floor the navigation term was counting. The
    gate is on what the anneal may **remember** as its best answer, not on its acceptance
    (that stays on the total, because a cliff there is what `layout-score.ts` argues against)
    and not on its return. Refusing at the return was tried first and is worse: it throws the
    whole repair away, leaving two seeds of one fixture stranding 748.2 and 560.1 of floor.

**Seed 6 of the Double rung at U 6x5 is the ruling in one row**, and it is pinned in
`tests/bed-rung-safety.test.ts`:

| | before | after |
|---|---|---|
| seed 6 | `outside` 8.5, `door` 165.7, `nav` 0 | `outside` **0**, `door` 181.8 |
| seed 11 | `overlap` 24.6, `nav` 8.4 | `overlap` **0**, `nav` 18.0 |

The bed stops standing inside the wall *and* across the door, and blocks only the door — the
trade the user asked for in as many words. Seed 11 gave up a 24.6-unit collision for ten more
units of stranded floor.

**Shuffle is unaffected where it counts, and this was measured rather than argued.** The veto
applies in every mode, including `shuffle`, whose *total* invariant is deliberately exempt.
That exemption's reason does not transfer: it exists because a shuffle is asked for a
DIFFERENT arrangement and a different one is usually dearer, which is about taste and says
nothing about legality. On `rect` 6 x 4 over ten seeds, **before: moved 10, clean 4** — the
six that moved and were not clean carried 520 to 1390 units of `overlap + outside`, and
`isCleanShuffle` discarded every one. **After: moved 4, clean 4**, the same four. Over five
presets x eight presses the button offers an arrangement on **25 of 40 either way**. The
search stopped producing answers that were only ever going to be thrown away.

**What it cost.** Of the 23 solves where the old picker chose an impossible finalist, 6 are
rescued by the new picker and **17 now decline** — the answer is "nothing worth moving" where
it used to be an illegal room. That is the intended trade, and it is the number to revisit if
Suggest turns out to be too quiet.

**Mutation: 14 mutants, 13 killed.** The survivor is the coarse/fine backstop at the end of
`openRoutes`, redundant while `best` is gated and kept because it is two lines. One survivor
was *not* expected and became a test: nothing held the repair's legality ceiling being
**relative** to its input rather than absolute. An absolute ceiling silently disables the
repair in any room already illegal for a reason the pass cannot fix — the ordinary case being
a piece the user has LOCKED standing through a wall — and left every suite green.

**Still open, and deliberately not built.** Ranking finalists can only choose among what the
search kept, and the descent is untouched: the annealer still walks down a total in which a
small overhang is cheap. Nothing measures how often the search never proposes a legal
arrangement at all. `A.7` and `G.1` both sit downstream of this.

---




`DEFAULT_WEIGHTS` has `outside: 1000` and `door: 800`, both against terms normalised to 0..1.
Until `outsideDeficit` landed, containment could not see an overhang below roughly 160 mm on a
sofa-sized piece, so the two never competed and the ordering was never exercised. They compete
now. On the **U 6 × 5** with a 1400 mm Double bed, the solver ended up blocking about 20% of the
door zone — `door` 165.69 — because the containment alternative was around 190 mm of bed through
the wall, which prices at roughly 175. It picked the door by about ten units out of a thousand.

> **Past tense as of 2026-09-03, and the number moved.** That reading was taken before the veto
> below was built. It is now `door` **181.78** with `outside` **0** — the same choice, but arrived
> at categorically rather than by ten units, and the bed is no longer *also* 8.5 units inside the
> wall while it blocks the door. See the BUILT section above.

**Neither answer is good, and that is the point.** The room genuinely has no arrangement that is
both fully inside and clear of the door at that bed width, which is exactly what the bed ladder
exists to detect — and it does: the Double is not a rung this app ships, the shipped rung is the
900 mm Single, and `tests/bed-rung-safety.test.ts` still pins that **the shipped rung keeps the
door clear**. So nothing a user sees today is wrong.

What is undecided is the ordering itself, for the next room where it comes up:

- **Is a blocked door always worse than any overhang?** A door is the room's only entrance; a
  piece 20 mm through the plaster is a drawing error. An argument for `door` above `outside`.
- **Or is being outside the room categorical?** A piece that is not in the room is not in the
  room, and a partially blocked swing is a degree. An argument for the ordering as it stands.
- **Or should the two stop being comparable at all** — a veto rather than a price, the way
  `HARD_TERMS` already keeps the hard terms apart rather than summing them?

The third is the most likely right answer and the largest change, which is why this is written
down rather than done. **Do not re-tune `DEFAULT_WEIGHTS` to make one test go green**; the
numbers in `bed-rung-safety.test.ts` are pinned exactly so that a change here is visible.

The other measured cost of the same trade, recorded in the same place: on the scrambled U the
worst seed went from 92.10 to 412.85 total, all of it `navigation` — the solver used to buy a
connected floor on that seed by letting a piece hang through a wall for free. It strands about
3.4 m² instead now. Eleven of twelve seeds are unaffected and two MORE seeds end completely
clean than before, so the exchange is favourable on balance; it is the tail that moved.


### § 32 — a piece added from the Library was square-footed, whatever shape it was — FIXED

Two files cited this section before it existed, and the entry was written from the code on
2026-09-01. **Confirmed by eye the same day**, in the 2D plan of a room holding both: the
standing fan and the stool were drawn as dashed SQUARES.

**And the fix was confirmed the same way**, which is the only honest way to close an item
whose evidence was a picture: the same plan, the same two pieces, now drawn as dashed
CIRCLES while the freezer and the console stay rectangles. The room in that shot was
seeded straight into IndexedDB with no `circle` on any part, so it also exercises the
persisted path end to end — `normalizeStoredParts` derived every one of them on load.

The defect was never "the fan is drawn wrong". It was that the SAME shape got a different
footprint depending on how it entered the room. Three answers to one question:
`CATEGORY_DEFAULTS.circle`, which only the detection builder read; four hand-written
`{ circle: true }` literals in the seeder; and, for the add path, nothing at all —
`LibraryItem` has no such field and `spawn` never set one. So a ceiling fan found in a
photograph was a circle and one added from the picker was a square, for the whole life of
the add path.

It is not cosmetic. `footFromPart` feeds `lib/plan-hit.ts` (a round piece is picked by the
ellipse it draws), `footOverlap` and `footArea` — a circle is π/4 of its box — and every
clearance and collision answer downstream of those.

**Fixed the way the entry said it should be**, rather than with the cheap patch it warned
against: roundness is a property of the SHAPE. `ROUND_SHAPES` + `isRoundPart` sit beside
`SHAPES`; `CATEGORY_DEFAULTS.circle` is **deleted** rather than left as a second answer;
and the flag is derived at each of the four doors — `addPart`, `normalizeStoredParts`, the
detection builder, and `readPart` at the file boundary, where it joins `clampDims` and
`isWallMountedPart` as something a file has nothing to say about.

The persisted question the entry flagged as a blocker turned out to have a clean answer:
nothing has ever let a user CHOOSE a footprint shape, so deriving can only correct. A room
saved before this holds `circle` only where the detection path happened to set it.

`ROUND_SHAPES` is a decision and is pinned exactly, members and non-members both, because
the failure it guards is a shape being added on a hunch. `mirror-oval` is the one that
keeps wanting to join and must not: it is oval on the WALL and a thin rectangle in plan.
`side-table` and `ottoman` are out for the honest reason — the catalogue ships them square
and life has them both ways.

Ten assertions, and each compares ROUTES against each other rather than checking one route
against a literal, because a test asserting only "the fan is round" would have passed on
the broken code for the detection path and never asked the question that mattered. All ten
mutations die. One of them survived the first run and the gap was real: the seeded test
uses `defaultScene`, and `buildSceneFromRoom` short-circuits an empty detection list into
it, so the DETECTION path — the one that already worked — had no guard at all until a
fixture with a real detection was added.

### § 33 — three things the shape contract left open — 1 DONE, 2 OPEN

From the same session that added `tests/shape-contract.test.ts`. All three are
**measurements or capabilities that do not exist**, not defects.

**1. The four newest shapes had never been looked at in 3D — DONE, 2026-09-01.**
`fan-standing`, `chest-freezer`, `tv-console` and `stool` typecheck, lint, and satisfy
all sixteen contract clauses — and **no test renders geometry**, so nothing in this repo
had an opinion about whether the standing fan reads as a fan or as a lollipop. The
contract can prove a shape is authored at `dimMM` and that its widest element matches; it
cannot prove it looks like the thing it is named after. That remains the honest limit of
the whole contract.

`visual-check.md` recorded the look on 2026-09-01 and deleted its own item: the fan reads
as a pedestal fan, the freezer has its lid seam, the console two open bays, the stool a
round seat on splayed legs. **This paragraph went on saying "never" for a day**, and the
queue row above it did too, which is the rot `CLAUDE.md`'s rule 20 describes — a
hand-off note is a claim, not a fact. Re-confirmed 2026-09-02 alongside § 34, in the
same browser session.

**2. The on-device detector cannot name any of the four, and TypeScript cannot fix
it.** `WORLD_PROMPTS` mirrors `WORLD_VOCAB` in `scripts/export-detector.py`, whose key
order `set_classes()` baked into the graph as class channels — so adding a prompt in
TS alone does *nothing*, and adding one in the middle shifts every label after it by
one. Naming the new shapes on-device means re-running the export, re-hosting the
weights, and re-pinning `MODEL_DIGESTS` on both sides. The cloud path already handles
them, because its prompt interpolates `CATALOG_SHAPES_ORDERED` and `refineShape` now
has cases for all four. `tests/shape-contract.test.ts` pins the two lists against each
other so the drift cannot happen silently again.

**What would unblock it:** a machine with the Python + torch toolchain, and a decision
about whether four more prompts are worth a 50 MB re-export and a re-pin — the
open-vocabulary model's accuracy on added prompts is itself unmeasured.

**3. Nobody has measured the render budget, so "how detailed can a shape be" has no
answer.** The question was asked directly and the framing it came with is worth
correcting first: **subdivision is not a network cost here.** There is no GLB path —
zero `useGLTF`, `GLTFLoader` or `.glb` in the tree, since rule 1 deleted `mesh-cache`
— so every shape is procedural three.js primitives and a more detailed one costs a few
hundred bytes of JS, not a download. The real ceiling is draw calls and frame time.

What is known: the whole renderer uses 25 cylinders, 14 planes, 5 spheres, 5 circles,
3 cones, 2 tori and 2 boxes, with radial segments spanning 8–28. What is **not** known
is the frame cost of a furnished room on a mid-range phone, which is the machine this
is for, and `frameloop="demand"` means the interesting number is cost-per-interaction
rather than steady-state FPS.

**What would unblock it:** a scene with a known part count, `renderer.info` read after
a drag, on a throttled device — the same shape of measurement `tests/detect-pipeline`
prints for detection. Until that exists, "how many segments is too many" is a guess,
and adding detail on the strength of a guess is how a phone-first app stops running on
phones.


### § 34 — two ceiling shapes are drawn bigger than they declare — FIXED

`CLAUDE.md` rule 2's first corollary, in two more shapes, and `fanBlade` was supposed to be
the end of it. Found by a review lens pointed at units and frames, not by any gate.

`PendantLampGeo` (`components/three/DynamicPart.tsx`) nets its group offsets to zero, then
draws a 600 mm cord at `y = +0.3` and a dome cone reaching `y = -0.2`. That is **800 mm of
geometry for a shape whose `dimMM[2]` is 400 mm**, and asymmetric about its own origin —
its top is `3 × h/2`. `FanGeo` is the same defect smaller: drawn extent `[-0.04, +0.22]`
against a declared 200 mm.

| piece | declared | drawn | at its hung Y, in a 2.8 m room |
|---|---|---|---|
| Pendant lamp | 400 mm | 800 mm, `[-0.20, +0.60]` | app believes top = 2.78; **draws to 3.18** |
| Ceiling fan | 200 mm | 260 mm, `[-0.04, +0.22]` | downrod top **2.85**, shade bottom 2.61 |

**Why every gate is green on it.** `verticalExtent` computes from `dimMM`, and so does
`groundY`, and so does `settleHeights`, and so do both new clauses in
`tests/shape-contract.test.ts`. The model is self-consistent; the drawing is
self-consistent; they disagree with each other, and nothing that reads `dimMM` can tell.
`Draggable` scales by `storedDim / part.dimMM`, so this is the truth at scale 1 rather
than an artefact of a resize. **This is exactly the class the `fanBlade` extraction was
supposed to close** — the arithmetic is back inside a TSX renderer, where no test reaches
it.

**FIXED**, with the repair this entry called for: `fanColumn` and `pendantDrop` in
`scene-spec.ts`, read by `FanGeo` and `PendantLampGeo`, swept by
`tests/ceiling-fixtures.test.ts`.

**The blocker turned out to be answerable from the code, not from taste.** This entry said
the fix needed someone to decide what a pendant's declared height *means* — the fixture
alone, or the fixture plus its drop. It does not: `lamp-pendant` is `wallMounted`, is not
soft furnishing, and is neither door nor window, so `isMountedObstruction` admits it and
`clearance.ts` rule 2b reports a pendant intersecting a wardrobe out of
`verticalExtent(dimMM[2])`. Under the fixture-only reading the app would under-report the
pendant's reach by the entire cord and stay silent about a clash the user can see.
`groundY`, `settleHeights` and `verticalExtent` read it the same way. **Six consumers had
already agreed; the renderer was the lone dissenter**, which makes this rule 3 rather than a
product decision. Worth remembering as a shape: an entry can record a blocker that the rest
of the codebase has since answered, and re-deriving it was cheaper than asking.

**Also found on the way, and not in the entry above:** `PendantLampGeo` read `dimMM` on
*no* axis. The shade was a literal `0.15` radius — 300 mm wide on a piece declaring 350,
and the same 300 mm on one declaring 800. Only the height half had been noticed.

**And the centring half is separate from the total.** Both are ceiling anchors, so `pos[1]`
is the mesh CENTRE (`verticalExtent`), and a drawing can have the right total height and
still be wrong: the fan's `[-0.04, +0.22]` is 260 mm *and* off-centre by 90 mm. The sweep
asserts `top` and `bottom` individually rather than their difference.

**What the tests can and cannot reach.** They pin both helpers across the whole catalogue
band at 10 mm, against `verticalExtent` — the function the consumers call — rather than
against a re-derivation, which would pin each helper only to itself. Thirteen mutations,
thirteen killed, including the constant's value in **both** directions after the first
version of that assertion compared `FAN_HUB_H` to a value computed from `FAN_HUB_H` and
survived an 80 → 120 mm move. What no test reaches is **the renderer actually calling
them**: a deliberate control mutation that makes `FanGeo` pass a literal `200` instead of
`part.dimMM[2]` survives the whole file. That is the standing limit — nothing here renders
geometry — and it is why this was a `visual-check.md` item as well as a test.

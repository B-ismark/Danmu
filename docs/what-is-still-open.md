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
   channel in the scene. **That is only true of an outline.** 3D already has a channel for
   exactly this: `blockedBy` rides the live drag channel and lands in the **size tag**,
   which is how a refused *move* names the piece that ran out of room. A refused *turn* does
   not use it. So the cheap fix is to route the turn's refusal through the tag that already
   exists, which is not a new channel and not a preference — it is the same finding being
   dropped by one of two callers, which this codebase already names as a defect class.
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

10. **"Library" — ANSWERED, and the user's answer is a defect report.** They said *"Library
    isn't on there"*, and the tree agrees: the panel's heading is **"Add pieces"**, its
    trigger reads **"Add"**, and the rail carries `title="Catalog"`. The word "Library"
    survives in exactly one user-visible place — `StudioHelp.tsx:210`, *"**Catalog** is what
    is in this room; **Library** is what you can add"* — which teaches a label the UI no
    longer has, under a heading that reads "The lists on the left" for a panel that now
    lives in the **right** rail.

    `CLAUDE.md` rule 4 is the third voice, still asserting the panel is called Library. So
    three sources disagree and the only one a user can see is the one that is wrong.
    **The help line and rule 4 follow the screen, not the other way round** — the principle
    (two lists, named for what they hold, never interchangeable words) is untouched; the
    specific word is not. Prose describing deleted behaviour is the next reader's source of
    truth and no gate sees it, which is why this needed someone to look.

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

---

## D · Would be lost silently

- **`2f4d8d1`** (`feat/pin-from-randomise`) is a commit with **no ref pointing at it**. An
  unreferenced commit is indistinguishable from lost work. Confirm it is superseded by the
  Shuffle lock work, or restore a branch to it.
- **Eight stale gate worktrees** in temp directories belonging to sessions that have ended,
  plus two live worktrees on branches that have merged.
- **`tests/layout-rules.test.ts:238`.** The fixture there is harmless — it asserts an anchor
  by *rank*, and 1900 × 1000 and 1000 × 1900 are the same 1.90 m², so flipping it proves
  nothing either way. **Its comment is not harmless:** it reads "a 2200 × 950 sofa (2.09 m²)
  beat a 1900 × 1000 single bed (1.90 m²)", which after the bed fix describes a bed wider
  than it is long, in the same suite as a new test declaring that impossible. Two files
  disagreeing about which way a bed points, one of them the next reader's source of truth.
  Fixture and comment move together or neither does.

---

## Nothing in this document has been in a browser

Neither has anything in `visual-check.md`. The desktop half of both is reachable with
`pnpm build && pnpm start` and no login.

# Traps

**What this is.** The mistakes that have cost real time in this repo more than once,
indexed by **the symptom you will see first** — because that is what you search for at
the moment it bites, not the cause.

**Why it exists, and the shape it has to keep.** The three companion docs describe the
codebase; this one describes the *work*. Its whole value is tokens not spent
rediscovering something, so it is written to be **grepped and skimmed, never read end to
end**. Each entry is: what you see → why → the move. If an entry needs a paragraph to
justify itself, the justification belongs in `CLAUDE.md` beside the code it is about, and
only the tell belongs here.

**Adding to it.** Two rules.

**One: an entry earns its place by having cost something twice.** A trap that has happened
once is a story; the second time is a pattern, and the pattern is the only thing worth a
future session's attention. Say which two occasions, briefly — a claim with no incident
behind it rots the same way a stale branch table does.

**Two: if a gate can see it, it does not belong here.** This file asks every future
session to remember something; a test checks it once and stays checked. So when a trap
turns out to be mechanically detectable, the right artifact is the assertion, not the
paragraph — and the paragraph is then actively worse than nothing, because it spends
tokens on every read and still relies on someone choosing to look.

**Two limits on rule two, both of which it needs stated.** It applies to entries being
ADDED, not retroactively — an existing entry is not evicted by someone later writing a
test for it, because the entry usually says something the assertion cannot. And "a gate
can see it" means a gate *you* will see fire: `next build`'s silent ESLint skip is
grepped by `ci.yml`, and that entry stays, because a developer running `pnpm build` by
hand gets the exit code and not the grep. The question rule two asks is whether the next
session will be TOLD, not whether a machine somewhere knows.

The case that set this rule: seven docblocks across five files had been separated from
the functions they document, always by a later insertion that kept its own block, so
nothing looked wrong at
the insertion point. It reads like a perfect entry. It is a **26-line scan** —
`adjacentDocblocks` in `tests/docblock-adjacency.test.ts`, 145 lines with its fixtures and
its reasons — and so it is not an entry. (It said "six lines" in the commit that added it,
which is out by 4x and was nobody's measurement. In the one file whose job is to tell the
next session not to trust an unnamed number, that is the wrong place to round.)

What is left for this file, after that, is a shape worth naming: **traps whose symptom is
a correct answer to the wrong question.** A tool that ran, succeeded, and reported about
something other than what you asked. No gate catches those, because there is nothing
malformed to catch.

---

## Reading git state

**Symptom: a diff shows deletions you never made — whole files, someone else's tests, a
fix that just landed.**
`git diff A B` measures how far apart two tips are. `main` has moved; your branch has
not. A merge is three-way and would delete none of it.
→ **Simulate the merge**: `git merge-tree --write-tree --messages <base> <branch>`, then
`git cat-file -p "$TREE:path"` and grep the *result*. For a branch's own change set use
`git diff $(git merge-base origin/main origin/BRANCH)..origin/BRANCH`.
*(Cost: three separate near-panics in one session — once over `lib/storage.ts`, twice
over "PR #42 deletes every test #39 added".)*

**Symptom: `git merge-tree` prints conflict stages 2 and 3 and no stage 1.**
That is add/add, not a silent revert. Read the part where the tool says *how* it reached
its answer; the absent line carries the meaning.

**Symptom: a branch list, a PR list or an "ahead by N" table disagrees with reality.**
Every such list is a hand-off document: true when written, rotting since.
→ Derive per line — `git rev-list --count origin/main..origin/BRANCH`,
`gh pr list --state open`. Never from a diffstat, never from recollection.
*(Cost: a list written from memory named five branches as safe to delete; one of them was
**ten commits ahead**, including a convoy fix. Then the replacement table had a wrong row
in it, in a commit whose subject was that very correction.)*

---

## Editing files from a script

**Symptom: a heredoc ends mid-line and bash warns `here-document ... delimited by
end-of-file`.**
Long heredocs through the Bash tool truncate. It happened at ~7.6 KB.
→ Anything past ~100 lines: **write the script with the Write tool**, then run it by
absolute path.

**Symptom: a Windows path in a heredoc arrives as `C:UsersismaApp...`.**
Doubled backslashes are eaten even inside a quoted heredoc.
→ Forward slashes. Always.

**Symptom: node says `ENOENT: D:\tmp\script.js` for a path that worked as an argument.**
Git Bash translates `/tmp/x` on **argv** but not inside a string in your code.
→ `node /tmp/x.js` is fine; `readFileSync('/tmp/x.js')` inside it is not.

**Symptom: a replacement script reports `needle occurs 0x`.**
Almost always indentation or line endings, not a wrong quote. A docblock nested inside a
`describe` is `   *  `, not ` *  `.
→ **Look at the bytes before guessing**: `sed -n 'N,+5p' file | cat -A`. Guessing costs a
round trip per attempt; `cat -A` costs one.

**Symptom: a source file is full of mojibake and a BOM appeared.**
PowerShell 5.1's `Get-Content` decodes UTF-8 as the ANSI codepage. `-Encoding utf8` on the
write does not save you — the damage is on the read.
→ Never round-trip source through `Get-Content`/`Set-Content`. Editing tools, or node.

**Symptom: `grep -c` returns `0` and the rest of your `&&` chain silently never runs.**
`grep` exits 1 when it matches nothing, and `0` is a legitimate answer you were asking
for.
→ `|| true`, or `printf` the count.

---

## Mutation testing and tests

**Symptom: after mutating and restoring, your own changes are gone.**
`git checkout -- file` / `git checkout HEAD -- file` restores from the index or HEAD. If
your work is uncommitted, it is destroyed.
→ **Commit before mutating.** A throwaway `wip:` commit, squashed later, costs nothing.
The tell is a needle that stops matching, or a lint error naming a parameter you never
touched — **or, worst of the three, no tell at all.** The third occasion was a *comment*
rewrite in `lib/drag-resolve.ts` correcting a false claim, made while the fix itself was
already committed. Two mutation rounds each ended `git checkout -- lib/drag-resolve.ts`,
which is correct for the mutation and fatal for the comment. Nothing stopped matching and
nothing failed to lint, because the file was simply back to a state that compiles; it
surfaced only when `git status` listed three modified files where four were expected. A
restore that eats prose is invisible to every gate in the repo.
→ So: **read the file list, not just the exit code**, after any restore — and prefer
mutating a copy, or committing first, whenever the same file also holds work of yours.
*(Cost: three times — `lib/footprint.ts`, then `lib/layout-score.ts`, then
`lib/drag-resolve.ts`'s comment. All recovered, all avoidable.)*

**Symptom: a mutation you are testing in a BUILT artifact comes back green, and the
assertion looks like decoration.**
The mutation never reached the artifact. A patch script that `assert`s its needle matched
exactly once will throw when the needle matches twice — and if the next line of the shell
command is on a **new line rather than chained with `&&`**, the build runs anyway, on
unmutated source. The probe then passes for the most boring reason there is and reads as
"this assertion cannot fail".
→ **Grep the file for the mutated text after patching and before building**, and print the
count. One line, and it is the only thing that distinguishes "the assertion is decoration"
from "I tested the wrong bytes". Same family as the `EXIT=0` entry under Gates: a step that
did not run reporting success because nothing read its status.
*(Cost: `PlanView.tsx`'s turn handle — two identical `onKeyDown={(e) => onPartKeyDown(e,
part)}` lines, so an anchor that assumed one threw; a full rebuild and probe cycle was spent
concluding a real assertion was worthless. Second occasion in this family: the `EXIT=0`
through a pipe, below.)*

**Symptom: a mutation is applied and lint fails with `'x' is defined but never used`.**
The mutation is still applied. Un-mutate by hand if the restore would eat uncommitted
work.

**Symptom: a mutation changes nothing and every test still passes.**
The assertion cannot fail. This is the highest-value finding in the file, not an
inconvenience.
→ Look for the assertion comparing the thing under test against **a second copy of
itself**. A predicate checked against an inline `bandCost(...) === 0` elsewhere in the
same module passes when the predicate is replaced by `return true`.

**Symptom: you revert your own fix and the test you just wrote for it stays green.**
The assertion is usually sound; the **fixture** cannot reach the defect. A hand-built
object is missing a piece of state that every real producer sets, so the branch with the
bug in it is never entered. (Why, in one place only: `CLAUDE.md`, "mutate what you just
wrote".)
→ Revert the production change and watch **that named test** go red before believing it.
Not "the suite goes red": one mutation reddens a pre-existing test and credits the wrong
half. When it stays green the fixture is the thing to fix, and what it is missing is nearly
always one of three — a **derived flag** the builders all set and the fixture omits
(`wallMounted` absent, and `!undefined` is true, so an unflagged ceiling fan was movable
under the old code and the new); a **refined shape**, where the hand-typed default and the
derivation agree by construction (a `door` fixture was green against a bug about doors,
because that category's row already said `true` — the column is derived now, so grep the
history and not `scene-spec.ts`; the pair that disagreed was `lamp` refining to
`lamp-pendant`); or a **geometry the existing fixtures never had** (every test for a wall
normal used a rectangle, where the vertex average IS the true centroid and all four normals
come out right).
*(Cost: six times in one night — the rectangle, the unflagged fan, the already-true door,
a `CATEGORIES` sweep that yields only each category's DEFAULT shape and was green against a
**full revert** until a label dimension was added, a browser check that added a Library
`Ceiling fan` to exercise a `circle` branch `PART_LIBRARY` sets on no entry, and the one
below. Review found none of the six; mutation found all six.)*

**Symptom: the check runs against a BUILT artifact, so there is nothing in the source to
revert.** The sixth above, and it needs its own move. A PNG export was checked by decoding
the sheet and counting ink pixels in a box at each number badge — a real measurement, with
an empty-floor control, and it **passed against the defect**: `plan-export` fills a
footprint at alpha `0x40`, so a piece drawn over a badge does not erase the digit, it
**tints** it, and "is there ink here" cannot tell those apart.
→ **Rebuild the artifact from the pre-fix source and run the same check against both.**
Two servers, two ports, one script. What that A/B showed is the assertion worth having: the
buried badge's darkest pixel was `[88,52,39]` before and `[42,37,32]` — `PLAN.ink` exactly
— after, while the two unoverlapped badges were byte-identical in both runs and are the
internal control. So the discriminating question was never "is there ink" but **"is the
darkest pixel the badge's own colour"**.
*(Admitted at one occasion, and the reason is that it is not a variant of the entry above:
there the fixture omitted state, here the fixture was right and the MEASURE could not
resolve the defect. Same green, different cause, and a different move — you cannot mutate
a source file to test a check that reads a binary.)*

**Symptom: the expected value is derived from real constants and the test still pins the
bug.** The sharpest form of the entry above: a derived expectation feels safe and is not.
`toBeCloseTo(h / 2 + MOUNT_PAD)` cannot look wrong — every term is a real constant
read out of the module under test — and it pinned a door lifted `MOUNT_PAD` off its
own threshold. It was convincing *because* it was derived: the expression came from
the same misreading as the code, so of course it agreed with it.
→ Derive the expectation from the **requirement, in the requirement's own words** —
a door's bottom sits ON the floor, so its centre is `h / 2` and nothing else — never
from the terms the implementation happens to be written in.
*(Admitted at one occasion because it is the entry above at its worst: same hour, same
model, except that here the unreachable half is the number being compared against rather
than the object being fed in.)*

**Symptom: a sweep passes but you cannot say how many things it swept.**
→ Assert the count as a literal. `toBeGreaterThan(60)` where the real answer is exactly
72 stays green with **eleven** items silently skipped. And do not derive the literal from
the same collection the loop walks — then the assertion measures its own subject.

**Symptom: you want to pin a measured number.**
Pin it **exactly**, both directions, and label it *regression baseline, not a
specification*. A `<=` bar sits green while the numbers drift the good way and nobody
re-derives. An improvement going red is the signal.

**Symptom: a tolerance you chose turns out to equal a step the app already takes.**
Then the step lands exactly ON the boundary, float rounding decides which side, and the
answer is **asymmetric in sign** — the same magnitude of change reads as "changed" turning
one way and "unchanged" turning the other.
→ Compare every new tolerance against the increments in `snapSteps` and the unit steps
before choosing it, and assert it at a value that is *not* one of them.
*(Cost: a "same turn" tolerance that was bit-identical to `Math.PI / 12`, the app's own
rotation step — one press of the turn key read as a turn on 58% of headings and not on
42%. Same class as the `boundsToUnit` scar in `CLAUDE.md`, where a range narrower than one
step of a coarse unit collapses to one number or inverts outright.)*

**Symptom: every fixture in a file is built from the constant the file is testing.**
Then the constant is never exercised at a second value and any value passes. The tell is
a suite that is green with the parameter replaced by a literal, or with a normalisation
replaced by `() => 1`.
→ One fixture either side of the threshold, and at least one value the code did not
supply. Sweeping a table is only a test if the table has rows the code did not write.
*(Cost: 17 of 41 mutations survived a file whose 18 tests all passed one copied value —
including the parameter with the longest docblock in it. And `tests/module-tiling.test.ts`
checking three of six ranges against their own declared bounds, which let a bookshelf's
max go from 450 mm to 1.2 m with the file still green.)*

**Symptom: a tie-break's second key is inverted and nothing goes red.**
The fixture made the first key equal to the quantity the second key compares. "Equal score
→ prefer lower cost", tested with the penalty at 0 — where score *is* cost, so the
clause can never discriminate and inverting it leaves the suite green.
→ One fixture where the keys **disagree**: first key tied, second key strictly
ordered, and ordered the way the code does not already produce.
*(Admitted at one occasion because it is the entry above one level down — there the
fixture is built from the constant it tests, here the discriminator IS the subject. Same
defect, and worth stating twice because the tie-break form does not look like a fixture
problem.)*

**Symptom: `it.fails` and you cannot see what else is broken in that test.**
`it.fails` masks every other failure in the same body.
→ One assertion per parked body; move the guards to a sibling that still passes.

**Symptom: a test is red in CI and green locally, or the reverse, with no code
difference.**
Time-dependent assertion. A gate that races the clock passes on a slow machine.
→ Freeze `Date.now`. **A green from a fast machine is not a green, and a green from a slow
one is not a pass.** `purgeTrash` used `ts < cutoff`, so a docs-only PR reported as
breaking persistence.

**Symptom: a suite that measures something prints nothing.**
vitest 4 discards `console.log` from a passing run.
→ `--disableConsoleIntercept` is already on `pnpm test` and is load-bearing.

---

## Gates

**Symptom: a gate prints `EXIT=0` and the output above it says the tool failed.**
An exit code read through a pipe is the **last** command's exit code. `npx tsc --noEmit |
tail -5` reports `tail`'s status, and `tail` always succeeds.
→ `cmd > /tmp/out.txt 2>&1; echo "EXIT=$?"`, then read the file. Never `cmd | tail`
followed by `$?`.
*(Cost: `TSC EXIT=0` printed while `tsc` was exiting 1 with eleven errors, and it was
nearly acted on. Second occasion: a `pnpm ... | tail` printing `EXIT=0` for a gate that
never started at all — see the worktree-on-`AppData` entry below, where a startup crash
produces no `Test Files` line and a summary grep prints an empty failure list.)*

**Symptom: typecheck goes red in files you have never opened, right after your own
change.**
A declared devDependency that is not installed in **this** worktree. It reads as your
change having broken the suite.
→ The tell is one command: **the failing paths do not intersect your change set.**
`git diff --name-only` against your base, compare. Then
`pnpm install --frozen-lockfile` and re-run.
*(Cost: `@testing-library/react` present in `package.json`, absent from `node_modules`,
eleven errors across six test files, none of them in the change. Second occasion: the
`node_modules` thinning where a package `dist` or `.bin` vanishes and a frozen install
re-links the hollow directory and reports success — same symptom, and there the install is
the fix that does **not** work, so check `node_modules/.bin/vitest` exists rather than
trusting `Done in 4.6s`.)*

**Symptom: `next build` exits 0 and you are not sure it linted.**
It can print `ESLint: Invalid Options` and exit 0 having linted nothing.
→ Grep the build output for `Linting and checking validity of types`. CI does; so should
you.

**Symptom: a failure under load that you cannot reproduce.**
`layout-solve`'s timing assertions fail when anything else is using the machine — a
peer's suite, or your own headless browser.
→ Reproduce in isolation before believing it. And **do not run a browser next to
someone else's gate**.

**Symptom: `pnpm start -- -p 3111` fails with `no such directory: -p`.**
→ `pnpm exec next start -p 3111`.

**Symptom: a served page 404s its chunks, or the canvas never appears, after a rebuild.**
`next start` **survives a stopped parent process**. The port stays held and rebuilding
`.next` underneath it serves a mixture of two commits.
→ `netstat -ano | grep :PORT`, then `taskkill //PID n //F`. A timeout here is luck; the
same setup can produce a plausible screenshot of nothing real.

**Symptom: vitest dies instantly with
`ERR_PACKAGE_IMPORT_NOT_DEFINED: "#module-evaluator"`.**
A worktree under `AppData/Local/Temp`. Same version, same lockfile, works on `D:`.
→ Put worktrees on `D:`. And run `pnpm exec vitest --version` first in any gate script:
a startup error produces no `Test Files` line, so a summary grep prints an empty failure
list and reads as success.

**Symptom: a green CI on a branch, and you want to believe it.**
CI builds the **branch**, not the merge result. A branch off an older `main` is gated
against an older program.
→ Merge `main` in, then read the green.

---

## Numbers

**Symptom: you are about to quote a number from earlier in the session.**
Don't. Four wrong ones in one session: an aggregate quoted as a per-seed figure (118.06
vs 36.00), a branch 13 ahead reported as 2, a seed count of 5 reported as 4, and
`MOUNT_PAD` inferred as `0.03` when it is `0.02` — that last one reached a PR body, a
merged doc and four messages before one `grep` settled it.
→ **Name the artifact every number came from**, and re-derive when the tree moved. The
pattern across all four: *everything measured held; the one thing reasoned did not.*

**Symptom: two files report the same figure to fifteen digits.**
Determinism, not corroboration — same solver, same seed, same fixture, observed twice.
→ Do not lift it into a shared constant. That asserts they must always be equal, which
no measurement supports, and couples them the first time one legitimately moves.

**Symptom: a count measured one way is quoted as a fact about something measured another
way — and it is a count, so it looks like a measurement.**
Two predicates that answer nearly the same question are not the same predicate, and a
number crossing between them is an inference wearing a measurement's clothes. The sweep
for § H.16 counted placements that were **accepted while outside the room** using
`footInsidePoly(footFromPart(..., shrunk))` and got 374. `resolvePlacement`'s own legality
test is `obbInsidePoly(slightlyShrunk) && pointInFootprint(...)`. "374 escaped" was then
written up — in a source comment, in `Design.md` and in `docs/what-is-still-open.md` — as
"removing the exemption costs exactly 374 placements and not one besides", which is a claim
about the SECOND predicate. It happened to be true. Nothing had shown it was.
→ **If the claim is about what a change costs, measure the change**: run the sweep against
both builds and subtract. Here that is one `git checkout`, two runs and a table — 28,739
accepted with the exemption, 28,365 without — and it turns a sentence into a pinned
literal. The tell is a sentence of the form *"X, and nothing else"* where only X was
counted; the second half is always the load-bearing half and is usually the unmeasured one.
*(Cost: twice in the same item. The other direction first — the sweep's initial check asked
whether the WHOLE footprint was inside, where the pipeline asks about one shrunk by 10 mm,
and reported 11,890 findings of which every single one was false. Stricter predicate, same
mistake, opposite sign.)*
**Symptom: a peer reports a gate that matches your prediction.**
Check the **sha**. A cherry-pick onto a different base is a different artifact, and a red
set does not transfer for free.

---

## Working alongside another session

**Symptom: a peer says the user approved something.**
Authorisation does not relay, in either direction. Their permission is not yours, and
saying "this is yours to merge" is *you* handing out permission you do not have.
→ Route the decision to the user in the window that needs it.

**Symptom: you and a peer both hold a doc open.**
→ Claim files by **naming what you hold**, not what you are avoiding. "Does not touch
your three" is a smaller statement than a claim. Send wording for someone else's file
rather than editing it.

**Symptom: you and a peer independently did the same work, in files neither of you
claimed.**
A file claim covers the files you named. Work discovered *during* review lands wherever
the defect is, which is by definition outside both claims — so the moment either of you
finds something in unclaimed territory, the finding itself has to be claimed, out loud,
before the fix is written.
→ When you report a finding in a file nobody holds, say **who is fixing it** in the
same message. "Confirmed, and I am doing it" or "confirmed, it is yours".
*(Cost: two sessions produced the same seven docblock fixes and the same 26-line gate,
in parallel, from the same review — each having told the other about it. Both diffs were
green. One was thrown away.)*

**Symptom: a fix you pushed is not in the tree you are about to ship, and every gate is
green.**
A branch's tip is not what a stack contains. A merge takes the head that existed when it
ran, and a fix pushed to a branch *after* something else branched off it is a real commit
on a real branch and is in neither. Every tip stays green, because a tip is gated against
its own tree.
→ `git merge-base --is-ancestor <sha> <target>` before believing any fix is in
anything, and especially before telling a peer it is. Then check the sha against the tree
you will actually create — a merge simulated in the intended ORDER, not the branch tip and
not `main + branch` alone. The branch survives the merge, so `git branch -r --contains
<sha>` finds a stranded commit and a cherry-pick recovers it.
*(Admitted at ONE occasion, like the tie-break entry above, and for the same reason: the
mechanism is general and the near-miss was expensive. A containment fix was pushed to one
branch after two others had already branched from it, so the stack carried the unfixed
version; both dependent tips were green over trees that had never seen the fix, and a peer
reproduced the original 240 mm defect on `main + the last PR`. What saved it was measuring
the tree the merge ORDER would produce, where all four corners came back at 20 mm. Both
measurements were true of different trees — which is the whole entry.)*

**Symptom: a shared doc conflicts and you are tempted to keep both sides.**
A union merge resurrects items the other branch **deliberately deleted**. Take their
file, re-apply your own additions, then grep for four things they removed to prove none
came back.

**Symptom: a peer's message contains a fact you were about to act on.**
Verify the cheap ones yourself. Two peer claims held exactly and one constant was wrong;
the check was one `grep` each time.

---

## Scope

**Symptom: a predicate that keeps needing another shape added to it.**
Wrong layer. Fix the room, not the object.

**Symptom: you extracted a pipeline and behaviour did not travel.**
Steps living in the *caller* are exactly the ones a diff of the extracted function cannot
show you were missing. Go looking for them.

**Symptom: a dead-code sweep says a token or class is unused.**
Read `tests/` too. Template-string class names match no literal grep, and some tokens
have no `var()` reader on purpose — their consumer is a test.

**Symptom: you grep for a word from a comment and conclude the thing it describes is
gone.**
A grep for the words **in** a comment is not a search for what the comment is **about**.
Prose, identifier and data structure are routinely three vocabularies for one concept —
a block saying "shapes that are fixtures" documents `isLightFixture`, which reads
`LIGHT_BY_SHAPE`, and no single grep finds the other two.
→ Search for plausible **identifiers**, then for the callers, then conclude. And note
the asymmetry that makes this specific case a trap rather than sloppiness: for an
**orphaned** docblock you cannot search by the words in the block, because if those words
appeared at the subject the block would not have read as orphaned in the first place.
*(Cost: a docblock judged dead and deleted in the same commit as the gate that found it,
while its function had five live readers including the Inspector gate the block's last
clause describes. Second occasion: the dead-code sweep above, same mechanism.)*

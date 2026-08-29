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

**Adding to it.** One rule: an entry earns its place by having cost something **twice**.
A trap that has happened once is a story; the second time is a pattern, and the pattern
is the only thing worth a future session's attention. Say which two occasions, briefly —
a claim with no incident behind it rots the same way a stale branch table does.

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
touched.
*(Cost: twice in one session — `lib/footprint.ts`, then `lib/layout-score.ts`. Both
recovered, both avoidable.)*

**Symptom: a mutation is applied and lint fails with `'x' is defined but never used`.**
The mutation is still applied. Un-mutate by hand if the restore would eat uncommitted
work.

**Symptom: a mutation changes nothing and every test still passes.**
The assertion cannot fail. This is the highest-value finding in the file, not an
inconvenience.
→ Look for the assertion comparing the thing under test against **a second copy of
itself**. A predicate checked against an inline `bandCost(...) === 0` elsewhere in the
same module passes when the predicate is replaced by `return true`.

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

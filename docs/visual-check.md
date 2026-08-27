# Needs eyes

Places to click, and what "wrong" would look like when you get there. Everything here
typechecks, lints and passes tests — what is left is judgement no gate can make.

**Rebuilt 2026-08-27, after your report.** Every symptom you reported has been found
and fixed, and **not one of the fixes has been seen on screen by anybody.** So this is
no longer "hunt for bugs"; it is "confirm the fixes", which is a shorter and different
job. What you have already answered moved to *Answered* below — kept visible rather
than deleted, so you can see what left the list and why.

| branch | state |
|---|---|
| `main` — `ebccd01` | danmu-5e's work, merged. Gated 1216/1216. |
| `feat/drag-convoy-and-layout` | this session's, **rebased onto `ebccd01`** as a single commit. Not merged. |
| PR #16 — `3b5935c`, danmu-f4 | **Not merged.** State not re-checked from here; treat the row below it as the last thing anyone confirmed. |

The first two are now one branch. The rebase hit five `Design.md` conflicts — three
taken from `main` (the `shadow-fit.ts` table row, the closed-room shadow rewrite, an
apostrophe), one kept from this branch, one hand-merged; `CLAUDE.md`, `Draggable.tsx`
and `lib/store.ts` auto-merged. Gated on that exact commit at **1313/1313 across 70
files**, typecheck 0, lint 0 at `--max-warnings 0`, `pnpm build` 0.

The earlier prediction here was 1320/71 for all *three* branches merged. Two are
merged, not three, so 1313/70 is the two-branch number and PR #16's tests are the
difference — consistent, but nobody has confirmed the missing 7 are exactly f4's.

`pnpm build` now runs green locally on this branch (exit 0), and its output was
grepped for the two ways Next's own lint pass can skip silently — `Invalid Options`
and `plugin was not detected` — neither of which appeared. The `node_modules` font
asset that used to fail through a directory junction no longer does. CI still runs
build on every push, which remains the answer that counts.

Two sections at the end are **not for you**: the review findings against this branch,
and "Known-and-left". They are here so the branches' state is not mistaken for
reviewed-and-clean.

---

## The fan, one re-check — and one number to type

**Found, and it was never the drop.** `placeNewPart` hangs the Library fan 0.15 m
below the slab — 2.65 m in a 2.80 m room — which is what it does, printed from the
real function. Your room used to be **1.75 m** tall, where 1.60 m *is* the ceiling,
and the room was then corrected to 2.80 while `setRoom` wrote the new height and
re-grounded nothing. 1.75 reproduces your 1.50 exactly; the earlier screenshot's 1.40
is a 1.65 m room. So the fan was never lowered — the ceiling left without it.

- **Your existing fan needs `2.55` typed into "Height off the floor", once.** The fix
  is not retroactive by choice: you had dragged that fan, which leaves an override
  indistinguishable from a height you meant, and silently re-deriving it would undo a
  deliberate one.
- **Then drag a fresh fan in and check it arrives at the ceiling** — Inspector should
  read `2.55` in a 2.80 m room, and it should sit in the middle of the ceiling and
  still drag anywhere you want it.

## A room that changes height carries the right pieces with it

New, and the whole point of the fan fix. Set a room's **Height** in the Room panel
and watch what moves. Nothing here has been in a browser.

- **Raise the ceiling.** A fan, a pendant, a curtain rod and an AC unit should rise
  with it and keep the same gap below the slab. A picture, a mirror and a TV should
  **not** move — those are eye level, measured up from the floor.
- **Lower it.** Same pieces come down; nothing ends up below the floor; anything that
  no longer fits keeps its real size and pokes through, and Room check is what says
  so. A wardrobe never moves at all.
- **Lower it, then raise it back.** Everything should return to where it was. The
  round trip is the asymmetric case — a sign error here is invisible if you only try
  one direction.
- **Type a ceiling of `1.5`.** It should be refused, and the message should name the
  *ceiling* range, not the side range. A `1.5` **width** must still be accepted — it
  is a legal side. This is the defect that made the fan possible: a ceiling was
  bounded by the room-side range, so one metre was a legal ceiling both here and in
  an imported scene file.
- **Edit the width of a room whose ceiling is already out of range** (a saved room
  from before this fix). It must go through: only the axis you are editing is judged.
- **The steppers.** Height's arrows should stop at the ceiling range's ends, and W/D
  at the side range's.

## Multi-piece drag — the whole surface, never once used

Nothing below has been exercised in a browser. It is all code-read and tested.

- **Shift-click three or four chairs, then drag one.** All of them should move, in
  *both* tabs. Before this week only the one under the pointer moved.
- **Same, but drag one into a corner until the set cannot fit.** The set should
  stop as a unit and the size tag should say *"<name> will not fit"* — naming the
  piece that refused, which is not the piece under your hand. Watch for the tag
  running off the screen: part names are user-typed up to 80 characters, and it is
  bounded at `min(240px, calc(100vw − 32px))` with the measurements on their own
  line. Try renaming a chair to something long first.
- **Press Escape mid-drag, in both tabs.** It cancels in the 3D scene now as well as
  the plan — see "Escape mid-drag" below, which is where the detail lives.
- **Touch.** *Completely untested.* Drag a piece on a touchscreen and check the
  selection is not collapsed to one piece when you let go.
- **Alt-click where pieces overlap**, repeatedly, and from a pulled-back camera.
  The "is this the same spot" tolerance is now measured in screen pixels rather
  than metres, so a far camera should no longer restart the cycle on a twitch.
- **Drag a rug under a table, then drag the rug again and release.** The click that
  ends a 3D drag used to select whatever mesh the ray hit — often the table.

## A wall-mounted piece leading a selection

- **Select a TV plus a chair and drag the TV.** The TV should slide *along the wall
  it started on* and stop at that wall's end; the chair should track it exactly.
  It should **not** jump to another wall — measured before the fix, a 0.4 m pointer
  move took the TV 1.6 m across the room and dragged the chair with it.
- **Now select the TV on its own and drag it toward the middle of the room.** It
  *should* still hop to the nearest other wall. That is how you move a picture, and
  it was deliberately kept.

## Escape mid-drag, and the one place it meets the sun

Escape now cancels a drag in the **3D** tab (it already did in the plan). There was
no handler at all before, so the key fell through to the studio's global Escape —
"deselect" — and the piece stayed wherever the pointer had left it.

- **Cancel a drag and check the POSITION, not the shadow.** With the closed room a
  piece can be legitimately shadowless because the sun cannot reach it, so the floor
  is no longer evidence about whether the transform went back. 5e's point, and a
  good one.
- **Cancel a drag that carried company.** Select a desk with a lamp on it, drag,
  press Escape: the lamp must go back too, not hang in the air where the cancelled
  drag left it. Same for a merged set — every member, not just the piece under the
  hand.
- **Cancel a drag of a WINDOW.** The one place this gesture and 5e's shell touch.
  `RoomShell` rebuilds its wall shapes from the store, so putting a window back
  moves its hole, and moving the hole moves where the sun lands. Nothing in the tree
  sets `shadowMap.autoUpdate = false`, so three.js re-bakes shadow maps on every
  rendered frame, and the handler calls `invalidate()` — which is why this should
  work. "Should" is doing real work in that sentence; check the sun patch goes back
  with the window.
- **Press Escape when NOT dragging.** It must still mean "deselect". The handler
  declines the key unless a gesture is in flight, and that is the whole reason the
  global meaning survives.

## The room is closed to the sun

`main`. Your report: *"it's acting as if the room has no ceiling… the tv
shouldn't even be casting any shadow regardless."* Walls cast shadow as well as receive
it now, and there is a ceiling — invisible, because it exists for the light rather than
the eye. Sun reaches the inside only through a window or a door.

**Set quality to High.** None of this exists on Fast, which has no cast shadows at all.

- Starter room, mood **Day**. Right: no sun on the floor except where it comes through
  the window or the doorway. Wrong: sun across the whole floor, as before.
- Hang a TV on a wall and put the sun on the far side of that wall (**Day** plus the
  north dial, or **Sunrise** / **Sunset**). Right: the TV casts nothing.
- **The one I am least confident about, and the first thing I would look at in this
  whole document.** Put a window in one wall, set **Sunrise** or **Sunset**, and look at
  the wall *opposite* the window. Right: a clean patch of sun on it. Wrong: the patch is
  missing, or stippled, or striped. Caster and receiver are the same zero-thickness
  plane there, so the depth comparison is a tie and `shadow-normalBias` (~2.3 cm) is the
  only thing breaking it. If it is wrong, the fix is a larger bias or a shadow shell
  offset outward from the plaster — worth knowing before anything else merges.
- **Is it too dark now?** A sealed room is lit by sky, environment and lamps, so losing
  the direct key makes it flatter. Starter rooms do have a door and a window, so the sun
  does get in. But if **Day** reads too dim to be the default mood, say so: **no ambient
  value was retuned.** Tuning by feel against a picture I could not see is how a mood
  ends up wrong in a way no test finds.
- **`Cool` loses the most** — its key light was the brightest in the set (0.95) and is
  blocked too. Its own description is "flat overcast, no direction", so blocking it
  makes the label true. Does it still read as bright overcast? `Evening`'s key was 0.12
  against a design that wants the lamps to do the work, so I expect no visible change
  there.
- **Sweep four walls and all five moods**, not one wall and one mood. This check
  outlived the per-piece shadow gate it was written for, because it is the *result*
  that matters and the whole thing is a sign: a sign error is invisible on the north
  and south walls and inverted on the east and west. A TV on each wall in turn, under
  `Day`, `Sunrise`, `Sunset`, `Evening` and `Cool`. **`Cool` on the east wall is the
  case that was actually broken, so it is the one worth a look** — the two sunless
  moods use a fixed key light placed up / east / south, and an earlier version of this
  gate covered only the moods with a sun.

## The Style row is four swatches now, and this palette has never been rendered

`main` (`ebccd01`). You asked to merge what was mergeable. `Coastal` and
`Studio Loft` both set the same `cool` mood, so they are one swatch: **Cool Neutral**,
carrying Coastal's sage accent (`#7C9C8E`) and Studio Loft's charcoal case goods
(`#5B554E`).

- **Nobody has seen this palette on a room.** It is a pairing of two halves taken from
  two different sets, so of everything in this document it is the most likely to simply
  look wrong. Press it and look at the whole room, not the swatch.
- Four 30px swatches on **one row** in the Style section, no wrapping, at every width —
  including the 1024–1279px rail, which affords 176px of content against the row's
  138px. Wrong: a second row of one swatch.
- The section's collapsed summary should read `Cool Neutral` after pressing it. Wrong:
  it still says `Coastal`, or goes blank.

**A correction you should have in front of you when judging the choice.** I told
you those two were near-duplicates on colour. They are not. Mean OKLab distance over
the four tones each theme actually paints:

    warm-min vs coastal      0.073   <- closest pair in the old five
    heritage vs afro-mod     0.078
    studio   vs afro-mod     0.138
    heritage vs studio       0.168
    warm-min vs afro-mod     0.266   <- shares `day`, and BOTH ARE STILL IN THE SET
    warm-min vs heritage     0.277
    warm-min vs studio       0.279
    coastal  vs studio       0.304   <- shares `cool`; the pair that was merged
    coastal  vs heritage     0.317
    coastal  vs afro-mod     0.321

So the merged pair was the third most *distinct* in the set, and the genuinely close
pairs were elsewhere. The metric is the wrong instrument rather than the set being
wrong — mean distance over tones is dominated by lightness, so it scores two pale
palettes as similar even when one is beige and the other sage, which is a difference
anyone sees instantly because a whole-room hue shift is loud at a small per-colour
distance. **The merge therefore stands on the shared lighting mood alone**, which is
the half of your report that was actually about overriding. If you would rather
a different pair had gone, it is a small change; the numbers are in
`tests/themes.test.ts`.

**And the criterion is not fully satisfied by what shipped, which is the datum you
need for that choice.** `Warm Minimal` and `Afro-Modern` both still set `day`, so the
Lighting row still shows one option twice — and that pair is at 0.266, *closer* than
the 0.304 pair I merged. I left it because four swatches is the fit ceiling and rust
against beige is the loudest contrast in the set, but on the stated rule it is the pair
with the better case for merging. Three swatches is 102px if you want them merged.

## A theme no longer unticks itself when you move the light

`main`. Your report was *"some of the lighting and the style override each
other"*, and two things were happening — only one of them a bug.

Pressing a theme swatch moves the lighting. That is the feature (one tap, whole look)
and it is legible now that both controls sit in the same Style section. The reverse was
wrong: changing the light **unticked the theme**, so the room stayed every colour
Coastal had painted it while the panel stopped naming Coastal.

- Press a theme swatch, then press a different lighting glyph. Right: the swatch keeps
  its tick and the section header keeps naming the theme. Wrong: the tick vanishes and
  the header's name goes.
- Then press the swatch again. Right: nothing jumps — the colours are already applied,
  and only the light changes back.

## A sun mood with no way in says so

`main`. New, small, and unseen by anyone. Choose a sun mood in a room with no window
and no door, and one line appears under the Lighting row: *"Sunlight only reaches a
room through its openings. Add a window or a door from the Library to let this one
in."*

- Delete the window **and** the door from a starter room, pick **Day**. Right: the line
  appears. Put either back: it goes.
- It should NOT appear for `Evening` or `Cool` — those have no sun to block.
- Worth knowing why it is worded about the room rather than the light: on **Fast**
  quality there are no cast shadows at all, so a sentence claiming the room is unlit
  would be wrong half the time, while this one stays true either way.

**A correction to something you were told earlier.** You were told starter layouts ship
no window or door, which made a sealed room the default case. False —
`lib/room-openings.ts` has been on `main` for a while and gives every preset both,
placed before any furniture. I had grepped for `shape: 'window'` and the openings are
*computed*, not typed. So this hint is for a room someone has emptied, or one rebuilt
from photographs where detection found no opening — not the common case.

## Lighting row and tooltips — from danmu-5e

- **Style section, lighting row, at a window 1024–1279 px wide.** Five icon-only
  buttons (sun / moon / cloud / sunrise / sunset) must sit on **one** row. The left
  rail is 208 px and affords exactly 176 px; the row needs exactly 176 px, so there
  is zero slack by design. Check nothing clips and nothing wraps.
- **Tooltip on those buttons: hover *and* keyboard Tab.** It is `position: fixed`
  and measured, so the failure mode is a bubble clipped at the rail's edge by the
  rail's own `overflow: hidden`.
- **The same tooltip in dark mode, and at the viewer's system theme with no
  explicit choice made.** It is a new surface and has been seen in neither.

## Room and layer-tree panels — from danmu-5e

- **Expand "Room".** The three dimension fields should appear directly, with no
  nested "Room shell" disclosure in between. The collapsed summary beside the
  header must read real metres — e.g. `4.2×3.6m`, not `0.0×0.0m`.
- **A merged group in the layer tree** shows a header row reading `Group · 3`; the
  chevron folds it; members indent under a `├`/`└` connector. The connector's
  vertical stem is drawn to overhang a 2 px flex gap, so a visible dotted break
  means the overhang is wrong.
- **The same group header at a 208 px rail.** The label budget is about 46 px, so
  `Group · 3` may ellipsise to `Group…`. Whether that is acceptable is your call,
  not ours.
- **North dial copy** now reads *"Drag to set north. Light comes from the left."*
  Check the direction word matches where the sun marker actually sits on the rim,
  at a few different bearings.
- **`/onboarding/layout-pick`:** the back button moved from the chrome bar to the
  top of the content column. Needs an eye at narrow widths.

## Room panel → Check tab — from danmu-f4

The findings list was rebuilt and **none of it has been seen in a browser.** It is a
324 px popover, which is where the old layout broke: the severity pill, the title, a
hover-revealed "Show me" and the "Try a fix" button all shared one line, leaving the
title about 85 px for a 110 px phrase, so *"Doors can't open"* wrapped mid-phrase.

- Each finding is now three stacked blocks — pill inline at the head of the title's
  text, then the detail, then a right-aligned action row. **Check the pill sits on
  the title's first line and does not float oddly when the title is one short
  word.** It is `inline-flex` with `verticalAlign: -5px` inside a block, which is
  the part most likely to be a pixel or two out.
- **"Show me" is now permanently visible rather than hover-revealed.** Deliberate:
  it was previously discoverable only by hovering, and it was a `<span>` inside a
  `<button>`, which is invalid and unreachable by keyboard. But it adds visible
  weight to every row, so with several findings the panel may read busier than
  before — the opposite of what was asked for. **Needs a judgement call with real
  findings on screen.**
- The floor reading and the step-free checkbox now share one row (*"88% floor
  clear"* … *"Step-free · 150 cm"*) instead of two full-bleed rows with a divider
  each. It wraps rather than clipping. **Check it at the 400 px gate floor and at
  browser zoom**, where the wrap should engage.
- The "150 cm turning space" explanation moved into the label's `title` tooltip,
  shortened inline to *"· 150 cm"*. Confirm the number is still discoverable.
- Finding titles changed text — a sofa reads **"No room to get out of the sofa"**, a
  wardrobe **"Wardrobe doors can't open"**, a bookcase **"Can't stand at the
  shelves"**. All seven front-clearance rules previously said *"Doors can't open"*.
  **Worth reading them aloud in the panel** to check none is clumsy.

## Room check — issue row alignment (your report, 2026-08-27)

> "'Model can't fully open' and the worth fixing tag aren't aligned as they should
> in the issue modal"

**Was:** the severity pill was an inline-block dropped into the title's text flow,
nudged onto the baseline by a hand-picked `verticalAlign: '-5px'`. Two problems, and
the second is the visible one — a title long enough to wrap put its **second line
underneath the pill**, flush with the pill's left edge instead of with the first line
of the title. "Door can't open fully" plus a "Worth fixing" pill is about 150 px, and
the rail's content box is 176 px at the tight width, so it wrapped as it shipped
rather than at some hypothetical narrow one.

**Now:** a flex row with `alignItems: 'baseline'`, the pill `flexShrink: 0` so it
never breaks across lines, and the title in a `minWidth: 0` column so it wraps inside
its own box instead of forcing the row wider than the rail. The magic constant is
gone.

**Also changed on the same row:** the action buttons were `justifyContent: 'flex-end'`
with `flexWrap: 'wrap'`, so on a narrow rail "Show me" and "Try a fix" stacked
right-aligned — into the same visual column the wrapped title had just moved out of.
They align with the text column now.

**What to check:** open Room check on a room with a door finding, at both rail
widths. The pill should sit on the title's first line; a wrapped title's second line
should start under the first line of the title, not under the pill; the buttons
should line up with the text above them.

**Alternative if you'd rather:** the pill on its own line above the title. That is a
look rather than a correctness question, so it is yours to pick — say the word.

---

---

## Still open, and still yours


- **Delete `origin/wall-carry-hover-fix`?** Verified superseded: one commit `main` lacks,
  and its `lib/wall-actions.ts` carries a `positions[p.id] ?? p.pos` that
  `tests/room-scene.test.ts` now forbids. Not deleted — deleting a branch is not ours to
  do.
- **`edgeProjection`'s inward normal is wrong on concave rooms.** Five edges across the
  shipped `t` and `u` presets have an "inward" normal pointing out of the room, so a TV
  near a T or U room's notch faces the wall and `wallDistance` measures it from the wrong
  side. f4 has it, deliberately on a branch *after* the merge: the fix moves every seeded
  fixture in the repo, and landing it underneath a merge would make the next bisect stop
  on the wrong commit. **It is not the rectangular-room symptom you reported** —
  that was your segment clamp and it is fixed.

---

## Answered — nothing to do

Kept visible rather than deleted, so nothing gets re-checked by accident.

- **A fan sticks to the walls and cannot be moved to the middle of the room.** You
  confirmed it: it drops in the centre of the ceiling and drags freely.
- **A ceiling fan offers a "Where it sits" row it has no use for.** Gone for every
  wall- and ceiling-mounted piece; the numeric height field stays. Visible in your
  own screenshot.
- **Dragging one piece of a group drags the whole group, while rotating one rotates
  only that one.** You reported the inconsistency and chose "honour the selection".
  A merged group now decides what a *click* selects, not what a drag carries. This
  also settles the open question that used to be in this file.
- **Dragging a TV dragged a chair with it.** Same fix.
- **A TV slid along a wall stuck to the far edge, with a gap to the adjoining wall
  that varied.** Fixed and *measured*, so this is closed rather than waiting on your
  eye: aiming a 1.2 m TV 2.6 m along a 6 m wall used to leave 0.20 m of it through
  the adjoining wall, with the centre pinned at the wall's end. Drift is now 0.000 m
  on all four walls and the facing is right on each. Worth a glance in passing, not a
  hunt.

The point of the section is that the removals stay **visible**. A deleted line reads as
an oversight; a line saying "you answered this, here is what happened" reads as
progress.

- **Should selecting one member of a merged group and dragging it move just that
  member?** You settled it: the selection is the unit, and merge decides only what a
  *click* selects.
- **Should starter layouts get a door and a window?** You said yes — and it was already
  true, see the hint item above. Nothing was built, and the claim that prompted the
  question was mine and wrong.
- **Which themes should merge?** You chose the two cold neutrals. Done, with the
  correction to my reasoning above.
- **The old per-piece shadow gate section.** The gate is deleted — it was a workaround at
  the wrong layer, patching one symptom of a missing ceiling one shape at a time. Keep
  your sweep, drop the mechanism.

---

## Open review findings on this branch — still open

danmu-5e reviewed the branch and returned eleven findings. **Two are confirmed and
one of those is fixed; the other nine are read-off-the-code hypotheses with
arithmetic, not reproductions.** They are **still open**: the rebase onto `ebccd01`
described at the top of this file did not address any of them, and re-gating green
at 1313/70 says nothing about them either. A green gate says the suite passes, and
the point of the review is that the suite could not see these.

**Fixed.** A convoy member's support vanished from the world if the support was
travelling too, so selecting a desk and the lamp on it and dragging the desk wrote
the lamp to the floor — reported valid, and persisted. Ctrl+A and drag anything did
it to every tabletop item at once. Measured, fixed, and five mutations now catch it.

**Confirmed, and since fixed.** No Escape-cancel in the 3D tab — see "Escape
mid-drag" above, which is now a thing to look at rather than a thing to avoid
judging.

**Unverified, in the order I would attack them.** Each has a concrete failure
scenario in 5e's review; none has been reproduced:

1. A zero-delta commit writes no member moves while the drag has been writing them
   every frame — so dragging a set out and back to exactly its start could leave the
   companions displaced and persisted.
2. `commit()` applies the convoy's moves without checking `valid`, though the type
   documents "apply only when valid" and the other two call sites do check.
3. Rotate and scale go through the same commit path, and the containment clamp can
   move a piece when only its rotation changed — so rotating one piece may translate
   the rest of the selection.
4. The new drop clamp and the drag clamp disagree for a piece wider than the room:
   one centres it, the other pins it to a wall, so touching it once moves it.
5. A merged set can still be half left behind when the other half is a rigid child
   of the dragged piece.
6. A grandchild is dropped when the middle link is itself a selection member.
7. A hidden piece can be named as the blocker while nothing on screen turns red.
8. The blocked-readout width bounds against the viewport when the box that clips it
   is the canvas column, so on a wide screen the bound never engages.
9. A stale click-suppression flag can eat one following Alt-click.

Plus a documentation defect worth more than it sounds: **a scar written into
`CLAUDE.md` describes a mechanism the React-Three-Fiber version in use appears to
prevent.** The design it justifies is still right, for a narrower reason. `CLAUDE.md`
is the file everyone reads first, so a wrong scar there is worse than no scar — but
correcting it means verifying a claim about a library's internals, which was not
done tonight.

---

## One finding on danmu-f4's branch — reviewed, NOT merged

`fix/room-report-and-tidy` @ `351f5b8` gates clean on its own commit (typecheck 0,
lint 0, 1222/1222 across 66 files) and it fixes five real things, including a sofa's
clearance finding titled "Doors can't open". It also has one regression.

**Suggest now straightens furniture you deliberately tilted, and reports it as a
move.** The tidy pass was given a second run *after* the prune, so it overrides what
the prune decided. `SNAP_TOL` is 12° and "unchanged" is 2.9°, and that gap is a
person's own angle. Measured on the default 7.5 × 5.6 preset with every piece set 8°
off square, 8 seeds:

| | stock `351f5b8` | with the second tidy disabled |
| --- | --- | --- |
| pieces reported moved | 6–7 | 2–3 |
| of those, pieces that never moved at all | 4–5 | 0 |

Each of them reads `stayed put (0 mm), turned 8.0° → 0.00° off square`, and the panel
hands it a sentence like *"freed up the space each piece needs"* about a piece that
did not move. The zeros in the right-hand column are the proof of mechanism: the prune
**does** put the user's 8° back, and the newly-added pass squares it again.

Four of that branch's own fixes are also invisible to its suite — dropping
`'navigation'` from the tidy's veto set, switching off its route guard, removing
`openRoutes`' fine-grid re-check, and turning the tidy into a blanket quantiser each
leave 227 tests green. The last is caught by nothing, even though a test is *named*
for it.

Sent to f4 with the numbers, and the fix is narrow. Nothing in this section is for
you to look at on screen; it is here so the branch's state is not mistaken for
reviewed-and-clean.

**Status, 2026-08-27.** That branch is now **PR #16, mergeable**, brought up to date
with the new `main` and re-gated by f4 at `3b5935c` — typecheck 0, lint 0, 1246/1246
across 69 files, with CI running `pnpm build`. f4 also found and fixed a **2.1×
performance regression** of their own inside it (a 20-piece solve calls `nearestEdge`
49,089 times, and their change had made each call recompute a polygon centroid;
453 → 961 ms median against a 2000 ms ceiling that could not see it). **Whether the
Suggest-straightens-your-tilt regression above is fixed, I do not know** — it was
reported to them and I have not re-measured it, so treat it as open until someone
does. The merge itself is denied to f4 by the classifier, so PR #16 is your click.

---

## Known coverage gaps, stated rather than implied

- **A detected wall piece keeping the model's yaw.** `snapToWall` clamps a piece by
  its extent along the wall, and two callers in `lib/scene-spec.ts` keep the model's
  own yaw rather than the wall's — so the clamp has to be told which rotation will
  really apply. Found by danmu-f4, fixed, and the fix's *mechanism* is pinned by
  three mutations. **The wiring is not**: removing the argument from both call sites
  leaves the suite green, because the difference it makes on the only fixture that
  reaches that branch is 21 mm and the settle pass moves a rotated wardrobe further
  than that. Written into `tests/scene-build.test.ts` beside the assertions so the
  next reader does not mistake green for covered.
- **The 3D Escape handler itself.** `convoyRestore` is pure and tested; the wiring —
  the cancel flag, the skipped commit, the suppressed click — needs a real pointer
  and is not under test.
- **Every UI change in this round.** The Inspector's "Where it sits" row and the
  Check tab's layout have no test that can see them.

## Known-and-left, with reasons

Not "needs eyes" — decisions taken deliberately, recorded so they are not
rediscovered as bugs.

- **A drop into an L / T / U's notch still lands in the notch.**
  `clampIntoFootprint` is the function for that and cannot do it: it walks the
  point toward `polygonCentroid`, which averages the **vertices** rather than the
  area, and for the square L in `tests/wall-parts.test.ts` that average is the
  reflex corner itself — every step of the walk stays inside the notch and the
  fallback returns a point `pointInFootprint` calls outside. Fixing it means
  changing `polygonCentroid`, whose other caller derives every wall's inward normal
  from it. Pinned in
  `tests/wall-parts.test.ts`, which says to delete the assertion, not the test,
  when it changes. Measured since, on the five presets: the U's vertex centroid is
  at `(0.00, −0.70)` and `pointInFootprint` calls it **outside the room**, so on
  that preset the fallback hands back a point outside the footprint and every
  caller treats it as inside. The area centroid is inside the room on all five,
  which makes it strictly better and still not a fix — the clamp guarantees nothing
  about the piece's extent either way.

- **Inward normals are wrong for non-convex rooms, and the fix is written but not
  merged.** Deciding "which side of a wall is inside" by flipping the perpendicular
  toward the centroid is only valid for a convex room. Measured over the presets by
  stepping 50 mm along each claimed normal and asking `pointInFootprint`: the T has
  2 of its 8 edges backwards and the U has 3 of 8 — 16% and 35% of their floor
  reporting the wrong inward direction. On the U the vertex-average centroid is at
  `(0.00, −0.59)`, **outside the room**, so the flip is decided from a point in the
  void. Found by danmu-f4, reproduced independently here.

  The fix (derive it from the polygon's winding, which is exact) is written and
  gated, and it is **still not merged** — for a different reason than it was last
  night. Re-measured on a scrambled U over 24 fixed seeds, on top of danmu-f4's
  `fix/room-report-and-tidy`, which is where the old objection lived:

  | | worst of 24 | seeds leaving furniture outside the room |
  | --- | --- | --- |
  | f4's branch merged with mine, no patch | 29.27 | 0 |
  | + the winding fix | 153.92 | 1 (`outside = 111.11`) |
  | + the winding fix, + an area-centroid clamp | 454.18 | 1 (`outside = 222.22`) |

  The first row is f4's work clearing the objection: no seed of 24 now exceeds
  29.3, where one used to reach 99.3 with `access = 40.00`. The patch then produces
  a new failure instead. `outside` is weighted 1000 over `outsideShare`, so 111.11
  is roughly 11% of one piece standing in the wall — in an arrangement Suggest
  hands you. The blocker is the bullet above: `clampIntoFootprint` clamps a
  **centre point** and says nothing about the piece's extent, so a centre 5 cm
  inside a U's leg leaves a 2 m sofa mostly outside. Substituting a better centroid
  fixes the bad seed outright (153.92 → 19.82) and breaks a different one worse, so
  it moves the failure rather than removing it. What it needs is a containment push
  on the piece's own footprint, which `layout-settle`'s `contain` already is.

  **Owner, 2026-08-27: danmu-f4, on a branch based after
  `feat/drag-convoy-and-layout` lands** — three sessions held `lib/geometry.ts` at once, and the winding fix
  deletes the centroid cache f4 had just added, so doing both in one hand is the
  cheap ordering. danmu-5e reproduced the wrong edges a third time (T `edge2` and
  `edge6`, the U's whole inner notch) and the acceptance criterion is those plus
  `tests/physics-snap.test.ts`'s four-wall **yaw** sweep, which is the assertion that
  speaks when an inward normal flips. **It is not the wall-snap symptom you
  reported:** rect rooms have 0 wrong edges and your room is 6.00 × 4.00 rect.

- **`FanGeo` ignores `dimMM[2]`.** The motor, the rod and its 0.13 m offset are
  literals; only the blade radius reads `dimMM[0]`. Group scaling papers over it,
  so nothing is visibly wrong today, but it is the rule-2 corollary about geometry
  being authored at `part.dimMM`.

- **`nearestEdge` allocates one `EdgeHit` per edge** instead of one per
  improvement, because "which edge is nearest" and "where on this edge" are one
  projection now instead of two copies. A 4-gon pays three short-lived objects. If
  the arrangement solver ever looks slow, that is the first thing to re-measure.

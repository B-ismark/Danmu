# Needs eyes

Things three agents changed overnight (2026-08-26 → 27) that **code cannot verify**.
Everything here typechecks, lints and passes tests; what is left is whether it
*looks* and *feels* right, which is a judgement none of us can make.

Not a changelog — the commit messages are that. This is only the list of places to
click, and what "wrong" would look like when you get there.

Ordered by how likely a problem is to be real and annoying, not by area.

**Nothing here is on `main` yet.** Three branches, all pushed, none merged — so
check out the right one before hunting for a control:

| section | branch |
|---|---|
| 1, 2, 3 (fan, multi-piece drag, wall riders) | `fix/multi-select-drag` |
| 4, 5 (lighting row, tooltips, layer tree, north dial) | `fix/wall-shadow` |
| 6 (wall-mounted shadows) | `fix/wall-shadow` |
| 7 (Room panel → Check tab) | `fix/room-report-and-tidy` |

The three merge together with one small conflict in `Design.md`, resolved and
gated — typecheck 0, lint 0, 1267/1267. **They are still unmerged on purpose**; see
"Open review findings" below.

---

## 1. The fan symptom I could not reproduce

**Reported:** a ceiling fan dragged in from the Library "moved very low to the
ground, even though a fan should just be stuck to the ceiling."

Three of the four fan symptoms had certain causes and are fixed (see
`fix(3d): a ceiling fan is not a wall…`). **This one I could not reproduce from
code, and I want to be plain about that rather than claim four out of four.**
Measured, in a 2.5 m room, for the Library's `Ceiling fan` (1000 × 1000 × 200 mm):

- `placeNewPart` returns `y = 2.35` — correct, just under the slab.
- `resolvePlacement` returns `y = 2.35` when handed a live height of 2.35, **and
  when handed 0, and when handed nothing at all.** There is no path in the resolve
  that lowers it.

The one mechanism I found that could *look* like it: the drag plane. A piece that
is not floor-standing was being dragged against a horizontal plane at the **floor**,
so a fan at 2.35 m had the pointer ray meeting that plane two metres below it, and
every pixel of pointer movement became a far larger move of the floor point it was
following. In a camera looking down at an angle, a fan racing toward the near wall
at a constant 2.35 m reads on screen as dropping toward the floor. That is fixed
(the plane is the piece's own height now).

**To check:** drag a fan in, then drag it around. If it still ends up visibly low,
the cause is something none of the measurements above touch and it is worth saying
so — a screenshot with the Inspector's Y value visible would settle it in one look.

## 2. Multi-piece drag — the whole surface, never once used

Nothing below has been exercised in a browser. It is all code-read and tested.

- **Shift-click three or four chairs, then drag one.** All of them should move, in
  *both* tabs. Before this week only the one under the pointer moved.
- **Same, but drag one into a corner until the set cannot fit.** The set should
  stop as a unit and the size tag should say *"<name> will not fit"* — naming the
  piece that refused, which is not the piece under your hand. Watch for the tag
  running off the screen: part names are user-typed up to 80 characters, and it is
  bounded at `min(240px, calc(100vw − 32px))` with the measurements on their own
  line. Try renaming a chair to something long first.
- **Press Escape mid-drag — in the 2D plan only.** Everything the gesture moved
  should go back: the dragged piece, anything resting on it, and every other
  selected piece. **In the 3D tab this does not work and does something worse than
  nothing** — there is no cancel there at all, and Escape is bound to "deselect", so
  it clears the selection in the middle of the gesture while the drag keeps carrying
  the set it was given at pointer-down, and the release commits it. Confirmed by
  reading, not fixed. Do not judge the 3D tab on this.
- **Touch.** *Completely untested.* Drag a piece on a touchscreen and check the
  selection is not collapsed to one piece when you let go.
- **Alt-click where pieces overlap**, repeatedly, and from a pulled-back camera.
  The "is this the same spot" tolerance is now measured in screen pixels rather
  than metres, so a far camera should no longer restart the cycle on a twitch.
- **Drag a rug under a table, then drag the rug again and release.** The click that
  ends a 3D drag used to select whatever mesh the ray hit — often the table.

## 3. A wall-mounted piece leading a selection

- **Select a TV plus a chair and drag the TV.** The TV should slide *along the wall
  it started on* and stop at that wall's end; the chair should track it exactly.
  It should **not** jump to another wall — measured before the fix, a 0.4 m pointer
  move took the TV 1.6 m across the room and dragged the chair with it.
- **Now select the TV on its own and drag it toward the middle of the room.** It
  *should* still hop to the nearest other wall. That is how you move a picture, and
  it was deliberately kept.

## 4. Lighting row and tooltips — from danmu-5e

- **Style section, lighting row, at a window 1024–1279 px wide.** Five icon-only
  buttons (sun / moon / cloud / sunrise / sunset) must sit on **one** row. The left
  rail is 208 px and affords exactly 176 px; the row needs exactly 176 px, so there
  is zero slack by design. Check nothing clips and nothing wraps.
- **Tooltip on those buttons: hover *and* keyboard Tab.** It is `position: fixed`
  and measured, so the failure mode is a bubble clipped at the rail's edge by the
  rail's own `overflow: hidden`.
- **The same tooltip in dark mode, and at the viewer's system theme with no
  explicit choice made.** It is a new surface and has been seen in neither.

## 5. Room and layer-tree panels — from danmu-5e

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

## 6. Wall-mounted shadows — from danmu-5e, plus one finding

A wall-mounted TV was casting a shadow across the floor when the sun was on the
**far side** of the wall it hangs on: an impossible picture, because walls only
ever receive shadows and never cast (the dollhouse view culls the near ones), so
the light went through the plaster, hit the back of the TV, and the TV — which
does cast — put a shadow on a floor the light never entered. Now gated.

- **Check the four walls, not one.** The whole fix is a sign, and a sign error is
  invisible on the north and south walls and inverted on the east and west ones.
  Put a TV on each wall in turn under **Sunrise** (sun in the east, 7° up) and
  **Sunset** (west, 8°) and check the shadow appears only when the sun is on the
  room side. The maths is verified in both directions — independently, from
  `solar.ts`'s construction rather than from its comments — so what is left is
  whether the *result* reads correctly.

- **Check all five moods, not just the three with a sun.** (`Day`, `Sunrise` and
  `Sunset` have a sun; `Evening` and `Cool` use a fixed studio key light.) The gate
  first covered only the sun moods, which left `Evening` and `Cool` still showing
  the original bug on the south and east walls — that light is derived from an
  offset of `[5, 8, 4]`, i.e. up / east / south, and placed twelve metres or more
  outside the room, so a piece facing away from it had it behind its own wall (dot
  products −0.390 and −0.488). `Cool` carries the brightest ambient of the five, so
  it was the worst case for visibility. **Fixed** — every mood now answers with a
  direction, the sun where there is one and the rig where there is not. **A TV on
  the east wall under `Cool` is the case that was broken, so it is the one worth a
  look.**

## 7. Room panel → Check tab — from danmu-f4

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

---

## Decisions waiting on you

Not bugs, and not for us to settle.

**Should selecting ONE piece of a merged group, then dragging it, move just that
piece — or the whole group?**

Today it moves the whole group, and until tonight you could not get into this
state: clicking a merged piece in the 3D scene selects the whole set, so a
one-member selection was unreachable. The new layer tree makes it reachable — you
can click a single member inside a `Group · 3` — and the drag then quietly
re-expands it to all three. So the rail offers something the drag ignores.

Both readings are defensible and they disagree about a second case:

- **Honour the selection.** The canvas already expands a click to the group before
  any drag starts, so a narrower selection can only have been built deliberately,
  through the one surface that exists to reach inside things the canvas cannot.
  Overriding it protects an accident that is already handled elsewhere.
- **Keep the group whole.** "Merge" reads as *these move as one*, and the studio's
  own help text says a merged set comes back as one piece. Under the first reading,
  selecting *a chair plus one half of a merged pair* and dragging leaves the other
  half behind — which is the thing merging exists to make impossible.

The code change is small and the signal it needs already exists, so this is purely
a question of which behaviour you want. It was left alone rather than guessed at,
because `tests/drag-convoy.test.ts` currently asserts the second reading in a
comment that states it as settled, and changing a test that encodes a decision
needs the person who made it.

---

## Open review findings on `fix/multi-select-drag` — NOT merged

danmu-5e reviewed the branch and returned eleven findings. **Two are confirmed and
one of those is fixed; the other nine are read-off-the-code hypotheses with
arithmetic, not reproductions.** The branch is therefore **not merged**, even though
the three-way merge of all three branches gates clean (typecheck 0, lint 0,
1267/1267). A green gate says the suite passes, and the point of the review is that
the suite could not see these.

**Fixed.** A convoy member's support vanished from the world if the support was
travelling too, so selecting a desk and the lamp on it and dragging the desk wrote
the lamp to the floor — reported valid, and persisted. Ctrl+A and drag anything did
it to every tabletop item at once. Measured, fixed, and five mutations now catch it.

**Confirmed, not fixed.** No Escape-cancel in the 3D tab (see above).

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

## Known-and-left, with reasons

Not "needs eyes" — decisions taken deliberately, recorded so they are not
rediscovered as bugs.

- **A drop into an L / T / U's notch still lands in the notch.**
  `clampIntoFootprint` is the function for that and cannot do it: it walks the
  point toward `polygonCentroid`, which averages the **vertices** rather than the
  area, and for an L that average is the reflex corner itself — every step of the
  walk stays inside the notch and the fallback returns a point `pointInFootprint`
  calls outside. Fixing it means changing `polygonCentroid`, whose other caller
  derives every wall's inward normal from it. Pinned in
  `tests/wall-parts.test.ts`, which says to delete the assertion, not the test,
  when it changes.

- **Inward normals are wrong for non-convex rooms, and the fix is written but not
  merged.** Deciding "which side of a wall is inside" by flipping the perpendicular
  toward the centroid is only valid for a convex room. Measured over the presets by
  stepping 50 mm along each claimed normal and asking `pointInFootprint`: the T has
  2 of its 8 edges backwards and the U has 3 of 8 — 16% and 35% of their floor
  reporting the wrong inward direction. On the U the vertex-average centroid is at
  `(0.00, −0.59)`, **outside the room**, so the flip is decided from a point in the
  void. Found by danmu-f4, reproduced independently here.

  The fix (derive it from the polygon's winding, which is exact) is a patch sitting
  with danmu-f4. It is **not merged** because it makes one specific solver seed go
  catastrophic — 23 of 24 seeds keep their existing cost, one jumps to 99.3 with
  `access = 40.00`, a term that is 0.00 in all 47 other runs. So it is a real bug
  with a seed number rather than a threshold to bump, and it lands in files f4 is
  mid-rewrite in.

- **`FanGeo` ignores `dimMM[2]`.** The motor, the rod and its 0.13 m offset are
  literals; only the blade radius reads `dimMM[0]`. Group scaling papers over it,
  so nothing is visibly wrong today, but it is the rule-2 corollary about geometry
  being authored at `part.dimMM`.

- **`nearestEdge` allocates one `EdgeHit` per edge** instead of one per
  improvement, because "which edge is nearest" and "where on this edge" are one
  projection now instead of two copies. A 4-gon pays three short-lived objects. If
  the arrangement solver ever looks slow, that is the first thing to re-measure.

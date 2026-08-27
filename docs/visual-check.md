# Needs eyes

Things three agents changed overnight (2026-08-26 → 27) that **code cannot verify**.
Everything here typechecks, lints and passes tests; what is left is whether it
*looks* and *feels* right, which is a judgement none of us can make.

Not a changelog — the commit messages are that. This is only the list of places to
click, and what "wrong" would look like when you get there.

Ordered by how likely a problem is to be real and annoying, not by area.

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
- **Press Escape mid-drag.** Everything the gesture moved should go back — the
  dragged piece, anything resting on it, and every other selected piece.
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

- **Check all seven moods, not just the four with a sun.** The gate first covered
  only the sun moods, which left `Evening` and `Cool` — the two that use a fixed
  studio key light — still showing the original bug on the south and east walls
  (that light is derived from an offset of `[5, 8, 4]`, i.e. up / east / south, and
  placed twelve metres or more outside the room, so a piece facing away from it had
  it behind its own wall: dot products −0.390 and −0.488). `Cool` has the brightest
  ambient of the seven, so it was the worst case for visibility. **Fixed** — every
  mood now answers with a direction, the sun where there is one and the rig where
  there is not. **A TV on the east wall under `Cool` is the case that was broken,
  so it is the one worth a look.**

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

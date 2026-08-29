# Suggest and collision — a design to decide on

Research for § H.6 (*Suggest, from the ground up*) and § H.7 (*collision, properly*), read
at `origin/research/inward-normals` — not from a working copy, because the copy on
`docs/the-next-task` is two generations behind and § H does not exist in it.

Nothing here is built and nothing here has been in a browser. Every claim about this repo
was derived from the tree this session and names its file and line; every claim about
another system names its source. **Three of the things § H.6 calls missing are already
present**, and finding that out is what produced the design below — the four symptoms are
not four missing terms.

---

## The thesis

> The four reported symptoms are not term-level bugs. Three of them follow from one
> architectural choice: **a single weighted sum, minimised over a search space that can
> represent impossible arrangements.**

A weighted sum means every term is purchasable. `DEFAULT_WEIGHTS` is written as a hierarchy —
*"Three orders of magnitude between them means no amount of taste can buy a collision"* — but
three orders of magnitude is a big number, not a barrier, and § C of `what-is-still-open.md`
already contains the measurement that proves it: raising `bandCost` to `e + e²` priced
relations correctly (10/10 → 0/10) and produced four disasters at 60 / 131 / 253 / 322 units
that `e²` never produces, because *"`scoreLayout` sums every term and only `anyWorse` keeps
the hard ones apart, so a stronger `relation` **buys** `access`."* Capping the linear term made
it worse on a different seed. **That is not a tuning failure, it is a scalarisation failure**,
and it is already on the record in this repo as one.

A search space that can represent impossible arrangements means the solver spends its budget
discovering physics. `(x, z, yaw)` per piece has no floor in it, so a chair with nothing under
it is not a near-miss the cost function narrowly tolerated — it is a state the cost function
**cannot see**.

The design has three layers, and they are independently shippable in the order given.

| layer | what changes | symptom it kills |
|---|---|---|
| **1 · Representation** | supported pieces are sampled over their support, not the room; a merged set is one rigid body | chair in the air; chair through a wall; groups and their rotations |
| **2 · Feasibility ≠ preference** | hard terms become constraints, not summands | the couch facing away; `bandCost` unfixable; § C's four disasters |
| **3 · Selection** | variety and the offer floor move to the suggestion stage | Shuffle converging; the fix priced as noise |

Layer 1 alone fixes two of the four user-visible reports. Layer 2 is the one that makes the
cost function tunable again. Layer 3 is small and independent of both.

---

## Part 0 · What is already there (checked, not assumed)

§ H.6 names three missing things. Only one is missing.

| § H.6 says | Verified |
|---|---|
| *"Nothing prices support"* | **True.** `grep -n "findSupport\|support" lib/layout-solve.ts lib/layout-score.ts` → **zero hits.** |
| *"there is no term for what it needs to face"* | **False.** `relationCost` (`lib/layout-score.ts:995`) prices facing: `'faces'` adds `2 * toward()`; `'in-front'` adds `1.5 * offAxis(…) + 1.5 * toward()`. Its comment names the exact case: *"A sofa with its back to the television is at a perfect viewing distance and useless."* |
| *"A group is not a unit"* | **Half false.** `proposeGroup` (`lib/layout-solve.ts:1081`) slides, quarter/half-turns and swaps groups **rigidly**, and Pass 0 moves only groups. The gap is *which* groups — § 1.2. |

Three more, so the redesign does not rebuild them:

- **Circulation is already stronger than the published version.** `navigabilityCost` (`:896`)
  finds the components of the clearance field reachable from a door and charges **the area of
  every component that is not**, plus a charge for a piece whose access zones are all
  stranded. Merrell et al. charge the raw *count* of components. Ours says how much floor was
  cut off and whose wardrobe got sealed in.
- **Focal points exist** — `m.profile.focals` drives a proposal that turns a piece to face one.
  That is Merrell's emphasis term, used as a move rather than only as a cost.
- **The move set is richer than either paper's.** Wall snap, park-beside-your-partner,
  align-to-neighbour, quarter-turn snap, group swap. Yu et al. and Merrell et al. both propose
  Gaussian jitter plus a two-item swap and nothing else. **This is the part of the current
  engine most worth keeping**, and § 3 says so again where it matters.

---

## Part 1 · Layer 1 — representation

### 1.1 Support: sample over the parent, do not penalise leaving it

Confirmed absent, and Kal's measurement shows it is absent in both directions: the `outside`
term reads **0.00 with a bedside lamp 61 % outside the room**, because supported tabletop
pieces are exempt from it. Nothing requires a supported piece to have support, and nothing
contains it either.

**Yu et al.'s answer is a tier hierarchy**, and the reason to prefer it over a support cost
term is that it removes the state rather than pricing it. First-tier pieces move over the
room's floor. Second-tier pieces are optimised *over the supporting surface of their parent, by
the same machinery* — the parent's top face is their "room" — and swaps are restricted to
within a tier. The floor is simply the root of the hierarchy.

A lamp then **cannot** be sampled off its table, because the space it is drawn from does not
extend past the table. No weight to trade away, nothing for a strong relation term to buy.
This is the same move `CLAUDE.md` rule 2 already makes for dimensions: put the illegal state
out of reach instead of making it expensive.

It also answers *"a chair put on a couch, then Suggest, ends through a wall"* — the chair is
second-tier while it sits on the couch, so Suggest moves the couch and the chair rides it.

**Cost.** `LayoutModel` grows a parent index and a per-tier placement pass; `propose` picks the
frame from the tier. The scorer is unchanged. **Breaks:** every fixture whose expected output
assumes a flat piece list, and any test that counts proposals.

### 1.2 A merged set is one body — the solver cannot currently see a merge

```
grep -rn "merge\|groupId\|mergedWith" lib/layout-solve.ts lib/layout-score.ts lib/layout-rules.ts
→ no matches
```

Groups come from `intactGroups` (`lib/layout-solve.ts:1031`): connected components of the
relation edges **that are currently satisfied** (`e.cost > GROUP_INTACT` is skipped), movable
members only. So **the grouping is inferred from the arrangement it is about to replace.** A
merged dining set that arrives scrambled has no satisfied chair↔table edge, so no group forms,
so Pass 0 never moves it as a unit and its members are solved as N independent pieces.

That is *"a merged dining set solved with one chair hanging in the air"* precisely: the user's
merge is a durable, explicit statement that these pieces are one thing, and it is the one input
to grouping the solver does not read.

Two changes, different sizes:

1. **A merged set seeds a group unconditionally**, satisfied edges or not — a union of two
   sources, not a redesign. Small, and it is most of the reported symptom.
2. **Membership holds for the whole solve.** Today a group member is still an individual
   candidate for every single-piece move, so a set assembled by Pass 0 can be taken apart by
   Pass 1. A merged set should be *one body with one transform* in the search, exactly as
   `drag-convoy.ts` already treats it under the pointer — the app has two answers to "what is a
   merged set" and only one of them is in the solver.

**This is also the whole of "groups and their rotations."** `proposeGroup` turns a group about
its **centroid** by ±90°/180°. A dining set's centroid is the table, so that reads well; a sofa
and its rug turn about a point between them and both come out displaced. Turning about the
**anchor** — the member the others hold relations to, which `relationParents` already computes
— is a one-line change to `carry`'s pivot and is worth measuring on its own.

---

## Part 2 · Layer 2 — feasibility is not preference

### 2.1 The measurement that already exists

From § C, all of it measured here, none of it mine:

| `bandCost` | worst | median | seeds w/ hard term | largest hard |
|---|---|---|---|---|
| `e²` (ships) | 13.96 | 3.70 | 4 / 48 | 5.40 |
| `e + e²` | **337.53** | 3.05 | 7 / 48 | **322.62** |

The diagnosis recorded with it is correct and is the argument for this layer: a **soft** term
got stronger and **bought** a hard one, because both are addends in one total. § C concludes
*"so it is not tunable"* — right, and the reason it is not tunable is structural, so no further
weight sweep will find the setting. **This is why § 3.2 does not propose one.**

### 2.2 The change

Split the terms into two classes that the solver treats differently:

- **Feasibility** — `overlap`, `outside`, `door`, `navigation`, and the new support and
  containment conditions. A candidate that violates one is **not a worse candidate, it is not
  a candidate.** Rejected at proposal time, or repaired before scoring.
- **Preference** — everything else: `access`, `walkway`, `window`, `wall`, `relation`,
  `middle`, `alignment`, `balance`, `inertia`. Summed and weighted exactly as now.

Then a relation term can be priced honestly — its whole job is to compete with other
preferences — and it has nothing to buy, because feasibility is not for sale. `bandCost` becomes
a question about taste with a bounded downside, which is what § C wanted and could not have.

**What this preserves, deliberately:** the existing weights keep their meaning inside the
preference class; the hard tier already sits three orders of magnitude up, so moving those four
terms out of the sum changes the ranking of *feasible* candidates very little. It is a change to
what can be traded, not to what is preferred.

**What it breaks, and the honest risk.** A feasibility filter can empty the candidate set —
in a room too full, *every* arrangement violates something, and today the solver still returns
its least-bad. That must not become "Suggest does nothing", which would be worse than a bad
suggestion. So feasibility needs a documented fallback: **when no candidate is feasible,
return the best infeasible one and say which condition it violates.** That is `CLAUDE.md` rule 2's
*"when something does not fit, say so — never silently resize it to fit"* applied to
arrangements, and `ClearanceIssue.rule` + `RULE_HANDLING` already carry the vocabulary to say it
in. This fallback is not optional; it is the difference between the layer being a fix and being
a regression.

**Cost.** `scoreLayout` splits its accumulator; `solveLayout`'s accept step gains a feasibility
gate; `anyWorse` — which today is the only thing keeping hard terms apart — is subsumed and can
go. **Breaks:** every assertion that reads `cost.total` as a single number, which is most of
`layout-solve.test.ts`.

---

## Part 3 · Layer 3 — selection, not density

### 3.1 Variety is a property of the set, not of a layout

§ A.2 asks for a term that prices variety, and notes nothing prices whether several pieces of
the same kind face differently. **Merrell et al. do not price it either.** They sample many
layouts, sort by cost, and diversify the returned set with **Maximal Marginal Relevance** — the
information-retrieval criterion for "good, and not like the ones already picked".

Variety is a property of the *set of suggestions*. A term inside the density would make each
individual layout pay for a property no individual layout has. So § A.2 is not blocked on the
cost function and never was: it is a change to whatever picks the finalists.

### 3.2 The offer floor, which § C already scoped

§ C's untried direction — *"the fault is in what gets OFFERED, not what gets searched. A
relation-aware floor in `isWorthOffering` — offer it if any relation went from out-of-band to
in-band"* — is the same stage of the pipeline as MMR and should ship with it. The measured
defect it addresses is stark: **a piece 300 mm out of band costs less than `MIN_GAIN_ABS` in
all ten relation specs**, so a nightstand 450 mm off a bed scores 0.90, the solver finds the
fix, and the gate prices it as noise.

Both changes are confined to the offer stage, cannot destabilise the annealer, and need no
measurement to start.

### 3.3 The one number worth sweeping, and only after layer 2

Yu et al. weight pairwise **orientation** at 10.0 against pairwise **distance** at 1.0–5.0 — a
ratio between 2:1 and 10:1. Ours is fixed at **2:1** (`2 * toward()` inside `relationCost`, both
halves then multiplied by the same `relation: 10`). We sit at the bottom edge of the published
band, and *"a couch a few degrees off square turned to face away from the TV"* is the symptom
that ratio governs.

**Do not sweep it before layer 2.** § C is the record of what a relation sweep does to a summed
objective.

---

## Part 4 · Collision

### 4.1 What we have, and the two things in it that are silent

Every piece is **one box** (`obbFromPart`, `lib/geometry.ts:54`) or **one ellipse**
(`footFromPart`, `:621`, when `part.circle`), tested by separating axes (`obbOverlap`, `:81`)
with a −10 mm pad, plus a vertical-extent test in `collidesAt` (`lib/scene-spec.ts:2412`) that
permits stacking. A round footprint polygonises to a **32-sided inscribed** polygon, inscribed
so a round piece is never reported as hitting something it does not touch.

There is no per-shape hull anywhere: a sofa's L, a dining table's legs, a curtain's drape and a
plant's canopy are all the same rectangle.

Two behaviours were found while reading it, neither of them in the doc, both silent. **Both
are fixed on `main` as of `d26ce5c` (PR #42), and this section is written in the past tense
on purpose** — a research document that keeps describing a defect after it is repaired is the
next reader's source of truth for a bug that no longer exists, and nothing automated sees it.

- `if (o.wallMounted) continue;` — **wall-mounted pieces were not obstacles at all.** Nothing
  collided with a mounted TV or a floating shelf. The line is gone; `collidesAt` now measures
  every obstacle.
- The mover's vertical extent was `pos[1] … pos[1] + h`, i.e. `pos.y` as a floor anchor — but
  the same function's comment says a wall-mounted piece stores `pos.y` as *mid-height*. A
  wall-mounted **mover** was therefore measured against the wrong half-height. Both sides now
  go through `verticalExtent` (`lib/physics.ts`), whose predicate is the **anchor** rather
  than the stored `wallMounted` flag — the flag answers *no* for a ceiling fan, which is
  centred on its origin like a television and was being mis-measured with no skip in front of
  it to hide the fact.

**The measurement, because "it collides now" is not a size.** Driven in a real browser, same
script both sides, Rectangle preset (6.0 × 4.0 m, which ships a `TV · 65″` on the north wall
at z = −1.94): a 2400 × 600 × 2200 wardrobe walked north into it comes to rest at
**z = −1.70 on `3da5df2`** — back face −2.00, which is the wall, with the television entirely
inside the wardrobe and the left rail reading **"Room checks out"** — and at **z = −1.61 on
`587d52c`**, back face −1.91, flush against the TV's front face. **90 mm**, being 60 mm of
television plus 30 mm of `MOUNT_PAD`.

That last detail is not decoration: the room report calling a room fine while a television
stands inside a wardrobe is a *second* defect, in `lib/clearance.ts` rather than in
`collidesAt`, and it is not fixed by #42. Same shape as every other two-consumer
disagreement in this repo — one rule, two readers, one of them wrong — and it is tracked in
`docs/what-is-still-open.md` rather than here.

### 4.2 What the engines actually do — one answer, four times

| system | simple | complex | the practical limit |
|---|---|---|---|
| **Unreal** | box / sphere / capsule / K-DOP; `UCX_` convex hulls bound by FBX name prefix (`UBX_`, `USP_`, `UCP_`) | the render triangles | Complex collision **does not work for physics simulation** — query only. A `UCX_` hull that is not convex is silently convexified, wrongly; a concave shape must ship as **several** `UCX_` pieces |
| **Unity** | primitives | `MeshCollider` | A convex `MeshCollider` is capped at **255 triangles** and is silently simplified past it. Unity's own guidance: **compound primitives outperform** a mesh collider and are more stable |
| **Blender** | box / sphere / capsule / cylinder / cone | Mesh | Mesh is "slow and unstable"; a **compound parent** — shapes taken from the object's children — is the recommended way to build a concave shape |
| **Box2D** | `b2PolygonShape` | — | **8 vertices** per polygon, convex, counter-clockwise. Complex shapes are **multiple fixtures on one body**, and separate prongs must be separate shapes so each generates its own contact |

The consensus is the same sentence four times: **a concave object is a set of convex parts,
authored.** The automatic decomposers — V-HACD, and CoACD, which is what to reach for now since
V-HACD is unmaintained — voxelise and greedily cut until a concavity threshold is met. They
exist because artists import arbitrary meshes and someone has to guess the parts.

### 4.3 Why we do not need any of that, and what we do need

**We have no imported meshes.** Every shape is authored procedurally in `lib/scene-spec.ts`
from `part.dimMM`. We already know the parts — a sofa's seat and its arms, a table's top and
its legs — because we drew them. Running a voxel decomposer over geometry we generated
ourselves spends a hard algorithm recovering information we never lost. **This is the finding
that should stop § H.7's "overhaul the engine" from becoming a mesh pipeline.**

So the transfer is the compound-convex model and the authoring discipline, not the algorithm:

1. A footprint becomes **`Foot[]`** — a few convex parts in the piece's own frame — where today
   it is one `Foot`. `obbOverlap` over the cross product is the same SAT test it already is.
2. **Each part carries its own vertical extent.** This is what buys the reported symptom for
   free: a chair tucks under a table when its seat clears the table's *top* part and misses its
   *leg* parts. Today the −10 mm pad is the entire mechanism, which is exactly why a chair
   tucks under a table by one pad's width.
3. **Broad-phase first.** `obbIntersectionArea` already short-circuits on bounding circles
   because the solver asks this question tens of thousands of times; one bounding circle per
   piece, parts only on a hit, generalises that unchanged.

### 4.4 What the current design gets right and must survive

The doc names two. Both are load-bearing and both were bought with defects, so they are stated
here as constraints on the replacement rather than as praise for the original.

- **The footprint is derived from `dimMM`**, which is what makes it recalibrate on a resize for
  free. A `Foot[]` must be derived the same way, and **authored beside the geometry it
  describes**, in `scene-spec.ts` — for the same reason `fanBlade` lives there. Arithmetic in a
  TSX renderer is arithmetic no test can reach, and that is not a hypothetical here: it is rule
  2's own worked example.
- **A round piece is tested as an ellipse, and `lib/plan-hit.ts` picks against the same
  ellipse**, so the thing you can click and the thing that collides agree. Whatever `Foot[]`
  becomes, picking must read the same function. Two features that render the same must not
  become two code paths — the scar `drag-convoy.ts` already carries.

A third, not in the doc and worth adding: **inscribed, not circumscribed**. Every derived answer
errs slightly small so a false collision never stops a move the user is entitled to make. A
compound hull must keep that direction of error.

### 4.5 What is unmeasured

Whether a solver scoring tens of thousands of arrangements can afford a compound footprint.
The broad-phase makes it plausible; the constant factor is a real question and belongs to
whoever implements it, **with a number rather than an argument.**

---

## Migration

Layers are independently shippable and each is a merge candidate on its own.

| # | change | depends on | gate risk |
|---|---|---|---|
| 0 | `research/inward-normals` lands — **decided: yes** | — | assertions marked on purpose, attributed, **do not loosen**. The count is re-derived on the landing branch and not carried from here: "7" was a reading of a different tree, and one of the seven turned out to need a re-derived fixture rather than a mark |
| 1a | merged sets seed groups unconditionally | 0 | low — additive |
| 1b | group turns pivot on the anchor, not the centroid | 1a | one measurement |
| 1c | tier model: supported pieces sampled over their parent | 0 | fixtures that assume a flat list |
| 2 | feasibility split, with the **"no feasible candidate" fallback that names the violated rule** | 1c | high — most of `layout-solve.test.ts` reads `cost.total` |
| 3a | MMR over the offered set | — | none; offer stage only |
| 3b | relation-aware floor in `isWorthOffering` (§ C's own untried direction) | — | none; offer stage only |
| 3c | sweep the orientation:distance ratio | **2** | meaningless before 2 |
| 4a | `Foot[]` compound footprints, authored in `scene-spec.ts` | — | picking must move with it |
| 4b | per-part vertical extents | 4a | — |

**Row 4b is half done already**, and the half that shipped is the correction rather than the
feature: `verticalExtent` (PR #42) makes *one* extent per part correct at every anchor. What
4b still means is a piece having **more than one** extent — a table's top and its legs — and
that still depends on 4a.

**3a and 3b can start today** and are independent of everything above. They are now the only
part of this document that is unblocked, since 0 is decided and 2 is the one question still
with the user.

---

## Questions for the user — recommendation first

**Status, 2026-08-29: three of the four are answered. Only 2 is still open.** The answered
ones are kept rather than deleted, because a question and its answer together say more than
an answer alone — and because the next person to reach for a furniture CSV or a mesh
pipeline should be able to see that it was asked and settled, not merely absent.

1. **Does `research/inward-normals` land, and when?** *Recommend: yes, with the solver work,
   not before.* Everything above is written against corrected normals. If it does not land, the
   design is not wrong but its first prerequisite is unmet, and the sentence to hold onto is:
   the annealer is tuned against wall normals that are backwards on 5 of 30 preset walls, so
   any weight measured before it lands measures a different program.
   · **ANSWERED — yes, it lands, and explicitly so that the solver work runs on corrected
   normals.** Nothing above needs rewriting; its first prerequisite is simply met. The landing
   work marks a number of existing assertions red on purpose, and **a mark going green is the
   signal that this design is working, not a regression** — do not delete one to get a green.
2. **Is the feasibility split (layer 2) in scope, or is this a layer-1-and-3 job?** *Recommend:
   in scope, and third.* It is the only change that makes the cost function tunable again, and
   § C is the evidence that no weight sweep substitutes for it. It is also the only item here
   that will turn a large number of existing assertions red on purpose.
   · **STILL OPEN. This is the one decision outstanding in this document.** Layers 3a and 3b —
   MMR over the offered set, and the relation-aware offer floor — need no decision and no new
   measurement, so they are the work that can start without this answer.
3. **Bedside clearance: 500 mm, against Panero & Repetto's 36 in ≈ 914 mm** — the source
   Merrell et al. cite, and the only place our numbers and theirs disagree by more than a
   rounding (wardrobe 600 vs 610, dining 900 vs 914, coffee table 400–500 vs 406–457 all agree).
   Ours is documented as *"the bedside strip you need to get in and make the bed"*, which is a
   narrower activity than the one they measured. *Recommend: keep 500 and write the
   disagreement down in `layout-rules.ts`*, because a number that disagrees with its cited
   source should disagree on purpose.
   · **ANSWERED and SHIPPED — PR #43, on `main` at `d26ce5c`.** 500 mm kept, and the
   disagreement is written into `layout-rules.ts` beside the number, along with the three
   figures that do agree and the one that is deliberately more generous than its source (seat
   pull-back 900 against 762). The header claim that our numbers "agree with each other to
   within a few centimetres across sources" is qualified there, because it was not true of all
   of them.
4. **Wall-mounted pieces are not obstacles at all** (§ 4.1), and a wall-mounted mover's vertical
   extent is measured from the wrong anchor. *Recommend: fix as its own small change, not inside
   the collision rewrite* — it is a present-tense defect and the rewrite is not close.
   · **ANSWERED and SHIPPED — PR #42, on `main` at `d26ce5c`.** It was fixed as its own change,
   the rewrite is still not close, and § 4.1 above now carries the measured result rather than
   the defect. What it did **not** do is retire the arithmetic elsewhere. Derived on `d26ce5c`
   rather than recalled — `grep -rn 'pos\[1\] +' lib/` — **six sites in five files still spell
   out their own `pos[1] … pos[1] + h`**: `clearance.ts:308` and `:439`, `fit-check.ts:287`
   (`overlapsSomething`), `layout-score.ts:442`, `physics.ts:453` (`findSupportDetailed`) and
   `rigid-parent.ts:70` (`isPhysicallySupported`). Several are safe because their inputs are
   pre-filtered to floor-standing pieces; **which ones is not re-derived here, and that is the
   point** — a rule with six hand-written copies cannot be checked by reading any one of them.
   This is the "extracting a pipeline means extracting all of it" scar in `CLAUDE.md` arriving
   on schedule. Six named copies of a rule this document just proved wrong is a smaller problem
   than one unnamed copy, and it is still a problem.

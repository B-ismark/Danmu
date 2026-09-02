// The last thing that runs before a scene is handed to the studio: nothing outside
// the room, nothing inside anything else.
//
// This is deliberately NOT the arrangement solver. `lib/layout-solve.ts` searches
// for a *good* layout and costs tens of thousands of evaluations; this repairs two
// specific facts about a layout and is cheap enough to run on every room open,
// including from the store's synchronous initial state, where an annealer has no
// business being.
//
// Measured, because "cheap" was asserted here as "a few hundred microseconds" and
// that was only ever true of the easy case. On this machine, per call:
//
//   ·   65 us — nine pieces, nothing clashing. The seeded path.
//   ·  3.6 ms — nineteen detections of which four are duplicates of pieces already
//                there. The realistic bad case, and the one this pass exists for.
//   · 15.3 ms — twenty pieces stacked on each other in a room whose floor is
//                smaller than their combined footprint. Nothing can be placed, so
//                every candidate position is walked and rejected.
//
// The last two were 78 ms before two changes: the derived facts about each part
// (footprint, role, area) are computed once per pass rather than once per candidate
// position, and a piece that fails to find a spot is not asked again until the next
// pass — having just proved the room full, it would return the same answer for every
// remaining pair. A repair pass on the synchronous store path cannot cost five
// frames.
//
// Two failures, both of which shipped:
//
//   · **Outside the room.** Every seeded arrangement was authored against the
//     footprint's bounding box, so an L / T / U room placed furniture in the
//     quadrant its own walls cut away. Clamping the CENTRE was not enough either —
//     `buildSceneFromRoom` already did that, and a 2.2 m sofa whose centre is
//     150 mm inside the wall is still half in the garden.
//   · **Inside each other.** The detect → scene path does no part-vs-part
//     resolution at all, so two detections of the same sofa, or a wardrobe and a
//     bed the AI both put against the north wall, arrive interpenetrating.
//
// What it will NOT do: resize anything (that would be the one lie this codebase
// exists to avoid — a piece that does not fit keeps its size and `lib/clearance.ts`
// reports it), move a wall-mounted piece off its wall, or move a rug out from under
// the furniture it belongs under. And when a room is simply too full for a piece to
// go anywhere, it leaves that piece where it is rather than inventing a spot: the
// room report is the honest answer there, not a shuffle.

import type { Footprint } from './footprint';
import { interiorPoint, polygonCentroid } from './footprint';
import {
  footArea,
  footFromPart,
  footInsidePoly,
  footIntersectionArea,
  footOverlap,
  edgeProjection,
  nearestEdge,
  polygonWinding,
  footExtentAlong,
  obbExtentAlong,
  outsideShare,
  pointInPoly,
  type Foot,
  type Poly,
} from './geometry';
import { isObstacle, roleOf, sharesFloor, WALL_GAP } from './layout-rules';
import { findSupportDetailed, isFloorStanding, isTabletopProne, MOUNT_PAD, ridesWall, verticalExtent } from './physics';
import type { ScenePart } from './scene-spec';

// Breathing room kept off a wall comes from `layout-rules` (imported above) rather
// than being spelled out again here: a piece this pushes off a wall and a piece the
// user snapped to one have to sit at the same distance from it, and a comment saying
// they match is not the same as their matching.

/** Share of the smaller footprint two pieces may share before this pass treats them
 *  as touching and pushes them apart.
 *
 *  Deliberately NOT the bar the room report calls a collision at: that one is
 *  `CLASH_SHARE = 0.5` in `lib/clearance.ts` (and, where two pieces legitimately
 *  share floor, `TUCKED_CLASH_SHARE` — which lives in `lib/layout-rules.ts` beside
 *  `sharesFloor` itself, since the solver reads it too; this pass deliberately
 *  reads neither, and the constant's own doc says why). This is a settle pass, so it wants the tight epsilon — the same
 *  order as that file's `SWING_CLASH_SHARE`, which exists so a millimetre of
 *  floating-point contact is not a finding.
 *
 *  Being stricter than the report is the safe direction: a scene this leaves alone
 *  is a scene the report is quiet about. It is not reversible, though — a piece the
 *  report would call "meeting untidily" at 30% shared footprint gets moved here, so
 *  do not read this number as what the room report considers a clash. Named for what
 *  it is to keep the two from being confused again; pairs that share floor by design
 *  are exempted by `sharesFloor` before this is consulted, not by the threshold. */
const TOUCH_SHARE = 0.02;

/** How far a piece may be pushed to get out of another's way. Beyond this the room
 *  has no space for it, and further searching is just moving the problem. */
const MAX_PUSH = 2.0;
const PUSH_STEP = 0.05;

/** Passes over the clashing pairs. Moving A off B can put A on C, so this iterates
 *  — but it is a repair, not a solver, and three passes either converge or prove the
 *  room is too full. */
const PASSES = 3;

export type SettleOptions = {
  /** Keep these part ids exactly where they are (the user's locked pieces, and
   *  anything a caller has already decided about). */
  frozen?: Set<string>;
};

/**
 * Pull every part inside the footprint and out of every other part.
 *
 * Returns a new array in the same order, with new `pos` tuples — the caller's parts
 * are not mutated. Only X and Z are ever touched: Y is gravity's answer and belongs
 * to the settle pass in `scene-spec`.
 */
export function settleParts(parts: ScenePart[], footprint: Footprint, opts: SettleOptions = {}): ScenePart[] {
  const poly = footprint as Poly;
  if (poly.length < 3) return parts;
  const frozen = opts.frozen ?? new Set<string>();
  const out = parts.map((p) => ({ ...p, pos: [...p.pos] as [number, number, number] }));
  // Two different questions, and one point was answering both — wrongly, on the
  // rooms this app ships.
  //
  // Which way is INWARD is the polygon's winding, and `nearestEdge` reads that
  // directly now; `winding` here is only the cached form of what it would compute
  // per call. Where to walk a piece that no wall normal could seat is a genuinely
  // different question and does need a point — but an INTERIOR one.
  // `polygonCentroid` averages the CORNERS, which on the U preset lands in the
  // notch, outside the floor entirely, so both fallbacks aimed at the void: a sofa
  // dropped in that notch measured 57 % outside the room before this pass and 57 %
  // after it. `interiorPoint` checks its answer, and falls back to the corner
  // average only when a polygon has no interior to find.
  const inward = interiorPoint(footprint) ?? polygonCentroid(footprint);
  const winding = polygonWinding(poly);

  // `ridesWall`, not `wallMounted`. A piece IN a wall must not be dragged off it by a
  // containment push - its footprint sits on the boundary by design. The ceiling family
  // is not in a wall: a fan or a pendant rides nothing, and `contain` is the only thing
  // that would pull one back inside an L's cut-away quadrant. Gated on the wider flag it
  // was skipped, so a detected fan taking the AI-position branch - which accepts a centre
  // up to 200 mm outside the bounding box - hung outside the house with nothing to bring
  // it in. Same exemption, same fix, as `carryAttached` in `lib/wall-move.ts`.
  const movable = out.map((p) => !ridesWall(p.category, p.shape) && !frozen.has(p.id));

  // ── Inside the room ───────────────────────────────────────────────────────
  for (let i = 0; i < out.length; i++) {
    if (!movable[i]) continue;
    contain(out[i], poly, inward, winding);
  }

  // ── Out of each other ─────────────────────────────────────────────────────
  //
  // Everything each part is, computed once. `pushClear` tests up to 160 candidate
  // positions and each one has to be checked against every other part; rebuilding
  // those parts' footprints, roles and areas per candidate made this pass measure
  // 78 ms on twenty mutually clashing pieces — on a path that runs during the
  // store's synchronous initial state, so it was a visible stall on opening a room
  // the detector had found duplicates in. Only the mover moves, so only the mover's
  // entry is ever stale, and `pushClear` refreshes it.
  const world: World = {
    parts: out,
    feet: out.map(footOf),
    roles: out.map(roleOf),
    obstacle: out.map(isObstacle),
    areas: [],
  };
  world.areas = world.feet.map(footArea);

  // Biggest first, and the bigger of a clashing pair never moves: a room is read
  // from its large pieces outward, and a solve that lets a nightstand shove a bed
  // across the floor reads as damage. Same reason `layout-solve` settles the large
  // furniture in its first pass.
  const order = out
    .map((_, i) => i)
    .sort((a, b) => world.areas[b] - world.areas[a] || a - b);

  for (let pass = 0; pass < PASSES; pass++) {
    let touched = false;
    // One attempt per mover per pass, not one per anchor it clashes with. A piece
    // that could not be placed has just proved the room full, and walking its 160
    // candidate positions again for every remaining pair is where the other 70 ms
    // went: twenty pieces on top of each other is 190 pairs, all of them hopeless,
    // each one re-deriving the same answer. Space another piece frees up is picked
    // up on the next pass, which is what the passes are for.
    const stuck = new Set<number>();
    for (let a = 0; a < order.length; a++) {
      const anchor = order[a];
      if (!world.obstacle[anchor]) continue;
      for (let b = a + 1; b < order.length; b++) {
        const mover = order[b];
        if (!movable[mover] || !world.obstacle[mover]) continue;
        if (stuck.has(mover)) continue;
        if (sharesFloor(world.roles[anchor], world.roles[mover])) continue;
        if (!clashes(world, anchor, mover)) continue;
        if (pushClear(world, mover, poly, inward)) touched = true;
        else stuck.add(mover);
      }
    }
    if (!touched) break;
  }

  return out;
}

/** The scene as the clash pass reads it: the parts, plus the derived facts about
 *  each that do not change while a candidate position is being tried. */
type World = {
  parts: ScenePart[];
  feet: Foot[];
  roles: ReturnType<typeof roleOf>[];
  obstacle: boolean[];
  areas: number[];
};

/** Two pieces sharing more than a rounding error of floor. */
function clashes(w: World, i: number, j: number): boolean {
  return shares(w.feet[i], w.feet[j], Math.min(w.areas[i], w.areas[j]));
}

/** Do these two footprints overlap by more than the touch epsilon? The cheap
 *  bounding test first — it rejects nearly every pair in a real room, and the
 *  intersection area is the expensive half. */
function shares(fa: Foot, fb: Foot, smaller: number): boolean {
  if (!footOverlap(fa, fb, -0.01)) return false;
  return smaller > 0 && footIntersectionArea(fa, fb) / smaller > TOUCH_SHARE;
}

function footOf(p: ScenePart): Foot {
  return footFromPart(p.pos, p.rot, p.dimMM, p.circle);
}

function footAtXZ(p: ScenePart, x: number, z: number): Foot {
  return footFromPart([x, p.pos[1], z], p.rot, p.dimMM, p.circle);
}

/** One piece's height, and what it is standing on, after everything has moved.
 *
 *  Only the pieces whose Y actually CHANGED come back, and that is not tidiness: on
 *  the Suggest path these are written into `useStudio.positions`, where a write is
 *  never free — per `lib/transforms.ts` an override pins that value against a
 *  re-detect and persists into IndexedDB and the scene file. Returning every piece
 *  would stamp an override on the whole room for a solve that lifted nothing. */
export type HeightFix = {
  id: string;
  /** The Y this piece must be at. Same meaning as `pos[1]` — a bottom for a
   *  floor-anchored piece, the mesh CENTRE for every other anchor. */
  y: number;
};

/** Put every piece back on top of whatever is now under it.
 *
 *  **This is the pass Suggest is missing — and Suggest does not call it yet.** Said
 *  plainly because the first version of this docblock said "was missing" and the commit
 *  that carried it was titled `fix(suggest):`, which was a claim about a path no caller
 *  reaches. `grep settleHeights lib/ components/ app/` finds exactly one production
 *  caller, `buildSceneFromRoom` in `lib/scene-spec.ts`. The Suggest handler in
 *  `components/studio/RoomTools.tsx` writes `positions[p.id] = [x, p.pos[1], z]` — the
 *  pre-solve Y, verbatim — and until that line is changed to apply these fixes, this
 *  function fixes nothing a user can press. Wiring it is a different lane's change; the
 *  point of saying so here is that a commit message and a docblock are the two places a
 *  false claim survives every gate in this repo.
 *
 *  What the user saw: put a nightstand on an armchair, press Suggest, and the solver moves the
 *  armchair — `Placement` is `{x, z, yaw}`, so there is no vertical axis in the search —
 *  so the nightstand keeps the armchair's height with nothing under it and hangs in
 *  the air. From directly above, in the plan, it looks correct.
 *
 *  **"…and no concept of one piece riding another" used to be the second half of that
 *  sentence, and it is no longer true.** `lib/layout-solve.ts`'s `carryRiders` derives
 *  the relation (`ridingParents`) and cascades the rider with its support, so the
 *  ordinary case — a lamp on a nightstand, a nightstand on an armchair — no longer
 *  reaches this pass at all. What still does is everything the carry declines: a piece
 *  the USER has locked while its support moves, and a piece the search was scoring as
 *  a floor obstacle. Both are deliberate refusals rather than gaps, and both leave a
 *  piece in the air, which is what keeps this function's reason for existing intact.
 *
 *  **Do not wire it into Suggest without reading the bar below.** `support.y > 0.3`
 *  here and `p.pos[1] > 0` in `ridingParents` are two thresholds on one axis over one
 *  `findSupportDetailed`, and they disagree on a named pair: a table lamp at y = 0.30
 *  on a 300 mm ottoman — the catalogue's minimum — is a rider that `carryRiders`
 *  carries and a piece this pass drops to the floor. Wiring the two together as they
 *  stand makes the lamp travel with the ottoman and then fall through it.
 *
 *  The fix is not a vertical axis in the annealer. The solver's job is where things
 *  stand in plan; a rider's height is a CONSEQUENCE of that, so it is answered
 *  afterwards, once. Three things it does, in the order they have to happen:
 *
 *    1. a tabletop-prone piece (monitor, lamp, plant, ottoman) snaps onto the highest
 *       real surface under its footprint — taller than 0.3 m, so a rug is not a table
 *    2. any other floor-standing piece left above the floor with nothing under it
 *       DROPS. This is the half that fixes the nightstand.
 *    3. the ceiling clamp, so no piece's top pokes through the slab
 *
 *  **Extracted rather than written.** All of it already existed inside
 *  `buildSceneFromRoom`, which is why the detected-scene path never had this bug and
 *  Suggest always did: one caller had the pass and the other could not reach it. A
 *  fresh implementation would have been the third thing in this repo that moves
 *  furniture vertically, after this and `lib/drag-resolve.ts`'s gravity step — and
 *  `drag-resolve` is the one that must NOT be merged into it, because it answers for a
 *  single piece under a pointer, with a live rotation and a legality verdict, where
 *  this answers for a whole room after the fact.
 *
 *  Resolved in ascending Y, and that ordering is load-bearing: `findSupportDetailed`
 *  has **no below-test at all** — it takes the highest `top` whose footprint covers
 *  `MIN_SUPPORT_SHARE` of the mover, above or below — so a lamp resolved before the
 *  desk it stands on can come back resting on itself-from-below.
 *
 *  **Ascending Y is necessary and it is NOT sufficient, and the earlier wording here
 *  claimed otherwise.** It said "every support has already reached its final height
 *  when the thing riding it asks", which holds only while every support starts BELOW
 *  its rider. Start a desk above its monitor — `[desk y=0.6 h=0.75, monitor y=0.3]` —
 *  and the monitor sorts first, takes the floating desk's top at 1.35, and the desk
 *  then drops to the floor: the monitor is left at 1.35 with nothing under it, which
 *  is the very bug this pass exists to fix, one level up. `tests/layout-settle.test.ts`
 *  holds that case as a PARKED `it.fails` so it retires itself the day it is fixed.
 *
 *  Not fixed here, and the reason is a scope one rather than a difficulty one: a
 *  fixed-point loop can DIVERGE, because with no below-test two pieces over one
 *  footprint each take the other's top and both rise every pass. A correct fix has to
 *  say which pieces may act as supports, which is a rule about furniture and belongs in
 *  `lib/layout-rules.ts` beside the others. Unreachable through `buildSceneFromRoom`,
 *  where everything enters at y = 0; reachable the moment Suggest is wired up, which is
 *  why it is written down rather than left to be rediscovered.
 *
 *  Pure: `parts` is not touched — the working copy deep-copies each `pos`, and
 *  `tests/layout-settle.test.ts` asserts it, because dropping the `.map` is otherwise a
 *  silent mutant that every other assertion here still passes. Callers apply the fixes,
 *  and at least one of them hands in the array it is rendering from.
 *
 *  **No `supportId`, deliberately.** The first version returned which piece each
 *  rider had come to rest on, so a caller owning rigid-parent links could re-point
 *  one. Nothing needed it: `lib/rigid-parent.ts` re-validates every edge through
 *  `isPhysicallySupported` before trusting it, so a link left pointing at the piece
 *  that moved away is already handled and the floating piece is fixed without
 *  touching `parentIds`. A field with no reader is the dead-plumbing shape rule 1
 *  describes, whoever leaves it there. RE-PARENTING a rider onto whatever now holds
 *  it up is a real feature and a different question from this bug; when something
 *  wants it, the field comes back in the same commit as its consumer.
 *
 *  `roomHeight` in metres. */
export function settleHeights(parts: ScenePart[], roomHeight: number): HeightFix[] {
  // `MOUNT_PAD`, not a local `CEILING_PAD = 0.02`. It was one, doing this exact job
  // on this exact quantity, and it is the reason the constant it duplicated could
  // claim to be "the single clearance" while a fan placed by detection and a fan
  // placed by a drag drifted apart the first time anyone changed it. Nothing would
  // have said so: both look right, 10 mm apart, in a picture.
  const cap = roomHeight - MOUNT_PAD;
  // A working copy, lowest first. Every read below is against this list, so a piece
  // resolved earlier is already at its final height for the piece above it.
  const work = [...parts].sort((a, b) => a.pos[1] - b.pos[1]).map((p) => ({ ...p, pos: [...p.pos] as [number, number, number] }));
  const out: HeightFix[] = [];

  for (const p of work) {
    const before = p.pos[1];

    // **The ANCHOR, not the `wallMounted` flag, and not a list of shapes.** This read
    // `p.wallMounted || p.shape === 'fan' || p.shape === 'lamp-pendant'` — a predicate
    // that had already needed two shapes appended to it, which is the tell CLAUDE.md
    // names for being at the wrong layer. `isFloorStanding` is `anchorFor(...) ===
    // 'floor'`, so a door (`wall-floor`), a curtain and a television are centred
    // because of their anchor rather than because someone remembered them, and a file
    // that arrives with the flag missing cannot make a television floor-standing.
    const floor = isFloorStanding(p.category, p.shape);

    if (p.category !== 'rug') {
      const support = floor
        ? findSupportDetailed(work, p.id, p.pos[0], p.pos[2], p.dimMM, p.rot, p.circle)
        : null;
      const y = support !== null && support.y > 0.3 ? support.y : null;
      if (isTabletopProne(p.category) && floor && y !== null) {
        p.pos[1] = y;
      } else if (floor && p.pos[1] > 0.05) {
        // Nothing under it any more: the floor. This is the nightstand.
        p.pos[1] = y ?? 0;
      }
    }

    // Ceiling clamp. `verticalExtent` because `pos[1]` means a bottom for a floor
    // anchor and a mesh centre for every other one, so `pos[1] + h` is wrong by half
    // a height for a television — measured at up to 1.10 m on the catalog's curtain.
    const h = p.dimMM[2] / 1000;
    if (verticalExtent(p.category, p.shape, p.dimMM, p.pos[1])[1] > cap) {
      // Both branches need the lower guard, and the centred one did not have it: a
      // 2100 mm door under a 2.0 m ceiling got `1.98 - 1.05 = 0.93`, a CENTRE, which
      // puts its bottom at -0.12 m and `wallApertures` cuts the light hole into the
      // ground. `MOUNT_PAD` on the low side as well as the high side is not invented
      // here — `drag-resolve.ts:187` and `heightForNewCeiling` are both already
      // `Math.max(h / 2 + MOUNT_PAD, Math.min(... - h / 2 - MOUNT_PAD, y))`, so this is
      // the third reader agreeing with them rather than a fourth rule.
      //
      // A piece too tall for the room keeps its real height and pokes through: the
      // guard wins, the clamp loses, and `lib/clearance.ts` reports `tall`. Silently
      // shrinking it to fit is the thing this repo does not do.
      // The low guard is `h / 2`, not `h / 2 + MOUNT_PAD`. The first version of this line
      // contradicted the docblock of the constant it read: `MOUNT_PAD` says `placeNewPart`
      // deliberately does not use it, because "a door's canonical height IS h/2, and
      // padding stood every door 2 cm off its own threshold". `pos[1]` is a CENTRE here,
      // so the pad lifted the bottom - measured: a 2100 mm door under a 2.0 m ceiling
      // came out at bottom 0.020, and a 2400 mm door in a 2.4 m room the same, after
      // which `lib/apertures.ts` cuts the light hole 20 mm up and leaves a strip of
      // plaster under the doorway. `wall-floor` is a centred anchor that is still
      // floor-REFERENCED, which is the trap.
      //
      // A piece too tall for the room therefore keeps its real height and pokes through
      // the TOP, where `lib/clearance.ts` reports `tall`. For a door the clamp declines
      // to move it at all. The HIGH bound is unchanged and does read the constant, so
      // `drag-resolve.ts:187` and `heightForNewCeiling` still answer it with one number.
      p.pos[1] = floor ? Math.max(0, cap - h) : Math.max(h / 2, cap - h / 2);
    }

    if (p.pos[1] !== before) out.push({ id: p.id, y: p.pos[1] });
  }

  return out;
}

/** What a piece needs to be measured against the room: its angle, its size, and
 *  whether it is round. Deliberately NOT `ScenePart` — the add path has these three
 *  before it has a part at all, and asking it to build one would be the reason a
 *  second copy of this containment gets written instead. */
export type ContainSubject = {
  rot: number;
  dimMM: [number, number, number];
  circle?: boolean;
};

/** How badly one candidate position fails to seat the piece. Two numbers, because
 *  they answer two questions and collapsing them into one is what broke this.
 *
 *  `out` is the old quantity: 0 when the whole footprint is inside the polygon,
 *  otherwise how far outside, and it is the ONLY thing that decides whether a
 *  position is acceptable at all. `short` is new: how much clearance the piece is
 *  missing against the wall it is most short of. Ranking is lexicographic — `out`
 *  first, so nothing ever changes class from outside to inside or back, and `short`
 *  only orders positions that are already equally inside. That ordering is the whole
 *  behaviour change here, and it is confined on purpose: the previous code returned
 *  0 for every position fully inside, so `out < bestOut` could not fire and the
 *  ranker could not tell flush from 200 mm through the plaster. */
type Seat = { out: number; short: number };

/** Below this, a shortfall is rounding rather than a gap. Metres. */
const SEAT_TOL = 1e-4;

/** Every wall this piece is short of clearance against, as one push, plus the TOTAL
 *  shortfall for ranking.
 *
 *  **The total, not the worst single wall, and the difference is a whole axis.** The
 *  worst wall lets an UNSATISFIABLE wall mask every other wall's progress: a 7 m sofa
 *  in a 6 m room is 0.52 m short against west and east whatever happens, so a `worst`
 *  of 0.52 survives the Z push unchanged, `seatBetter` sees no improvement, and the
 *  correct move is discarded. Measured on the add path: the axis that FITS came back
 *  at 3.550 with 3.530 owed. A total moves — 1.06 to 1.04 — and is still exactly zero
 *  when no wall is short, which is the only thing the acceptance test asks of it.
 *
 *  **The deficit, not the distance, and that distinction is the bug this closes.**
 *  `nearestEdge` ranks walls by how far the piece's CENTRE is from each; what a
 *  containment push has to clear is the piece's own extent along that wall's normal
 *  MINUS how far in it already is. Those two orderings agree only when the piece is
 *  square. On a 6 × 4 room a 1200 × 600 wardrobe dropped in the south-east corner
 *  violates both walls by 20 mm, but the south wall is nearer (0.30 m) than the east
 *  (0.60 m), so the old loop cleared the south one, found it STILL nearest, computed
 *  `push = 0` and broke with the east wall untouched — handing the whole answer to
 *  the lerp below, whose step is a fraction of the room. Measured: the piece landed
 *  240 mm / 170 mm off two walls it had been dropped flush against, and 500 mm /
 *  460 mm in a 12 × 10 room, because `0.1 × |x0 - centre|` scales with the room and a
 *  gap does not.
 *
 *  Signed, and it needs no `pointInPoly`: `(x - px) · n̂` is positive on the inward
 *  side of the wall and negative on the far side, so one expression covers a piece
 *  20 mm short and a piece a metre out in the garden. The old code faked that sign
 *  with `pointInPoly(x, z) ? need - dist : need + dist`, which is a different
 *  question — a point can be inside the polygon while the piece is not.
 *
 *  **Only for a piece whose centre is IN the room, and that is not a technicality.**
 *  A deficit says "how much more clearance this wall wants"; for a piece already
 *  outside, the wall with the biggest deficit is the one it is furthest beyond, so
 *  ranking by it sends the piece the LONGEST way back rather than the shortest.
 *  **Summed, not one-at-a-time, and that is not a tidy-up.** The first version pushed
 *  along the single worst wall per iteration, which spends an iteration per wall and
 *  spends ALL of them on a wall it cannot satisfy: a 7 m sofa in a 6 m room is 0.52 m
 *  short against west AND east forever, so all six iterations went to the X axis and
 *  the piece's Z was never contained at all — the axis that FITS came back flush,
 *  measured at 3.550 where 3.530 was owed. Summing fixes both ends of that. A corner
 *  clears in ONE step, because the two walls' normals are perpendicular and their
 *  pushes do not interfere; and two opposing walls' pushes CANCEL exactly, which is
 *  the arithmetic that lets the unsatisfiable axis step aside and let the satisfiable
 *  one through. Overshoot on non-perpendicular walls is bounded by the loop
 *  re-measuring and by `seatBetter` refusing anything worse.
 *
 *  Measured on the L below: a 1000 mm fan dropped at `(5.9, 3.9)` — in the quadrant
 *  the L cuts away — came back at `(5.48, 1.48)` under the nearest-wall rule, 2.46 m
 *  from where it was aimed, and at `(2.48, 3.48)` under deficit ranking, 3.45 m away
 *  and in a different arm of the house. Both are legally inside with 20 mm to spare;
 *  only one of them is still near where the user pointed, and "the drop point decides
 *  WHICH part of the room" is the promise `placeNewPart` makes. So the two rules split
 *  cleanly by the question they answer: **inside, the binding constraint is the
 *  greatest deficit; outside, it is the shortest route back in.**
 *
 *  **Only walls the piece is actually in front of.** `edgeProjection` clamps its
 *  segment parameter, so a query past the end of a wall gets that wall's CORNER as
 *  its foot, and the dot product against the corner is not a clearance. Left in, an
 *  L-shaped room breaks: with the outline `(0,0) (6,0) (6,4) (3,4) (3,6) (0,6)`, a
 *  piece at `(1.5, 5)` sits correctly in the upper arm, but the notch edge
 *  `(6,4) → (3,4)` clamps to `(3,4)` and reports `d = -1`, so the piece would be
 *  shoved `need + 1` m along -z out of its own arm. `t` strictly inside `(0, 1)` is
 *  the guard, and when no wall qualifies this returns null and `containedXZ` falls
 *  back to `nearestEdge` — which is the right answer there, because "past every
 *  wall's end" means a corner, and a corner is what the lerp exists for. */
function wallDeficits(
  piece: ContainSubject,
  x: number,
  z: number,
  poly: Poly,
  winding: 1 | -1,
): { dx: number; dz: number; total: number } | null {
  // See the docblock: outside the room this is the wrong question, and answering it
  // anyway is what moved a fan into the other arm of an L.
  if (!pointInPoly(x, z, poly)) return null;
  const f = subjectFootAt(piece, x, z);
  let dx = 0;
  let dz = 0;
  let total = 0;
  let any = false;
  for (let i = 0; i < poly.length; i++) {
    const e = edgeProjection(poly, i, x, z, winding);
    if (!e) continue;
    // Past the end of this wall: `(px, pz)` is a corner, so the dot product below
    // would not be this wall's clearance. See the docblock's L-room measurement.
    if (e.t <= 1e-9 || e.t >= 1 - 1e-9) continue;
    any = true;
    const d = (x - e.px) * e.nx + (z - e.pz) * e.nz;
    // `footExtentAlong`, not `obbExtentAlong`: a round piece's reach towards a wall
    // is its ELLIPSE's, and the box overstates it by up to (root2 - 1) * r, which is
    // 249 mm on a 1200 mm piece at 45 degrees. `escape` above already honours `circle`
    // through `footCorners`, so measuring the shortfall off the box made `Seat.out` and
    // `Seat.short` describe two different pieces and then ranked them as one. Measured:
    // such a piece, already 20 mm clear of a wall, was pushed 249 mm further in and
    // re-pushed on every settle.
    const short = footExtentAlong(f, e.nx, e.nz) + WALL_GAP - d;
    // Only walls that WANT clearance contribute, to the push and to the total alike.
    // A wall with room to spare pushing back would be a spring, not a containment,
    // and would pull every piece to the middle of the floor.
    if (short > 0) {
      total += short;
      dx += e.nx * short;
      dz += e.nz * short;
    }
  }
  return any ? { dx, dz, total } : null;
}

/** Both halves of the seat measure at one position.
 *
 *  `short` is 0 for any position whose centre is outside the room, because
 *  `worstWall` declines to answer there. That is what keeps `seatBetter` identical to
 *  the old `out < bestOut` across the whole outside class — where `out` frequently
 *  ties at `escape`'s `1e-4` floor, and a tie-break invented here would silently
 *  re-rank every position the old code left alone. */
function seatAt(piece: ContainSubject, x: number, z: number, poly: Poly, winding: 1 | -1): Seat {
  return {
    out: escape(piece, x, z, poly),
    short: Math.max(0, wallDeficits(piece, x, z, poly, winding)?.total ?? 0),
  };
}

/** Lexicographic: inside beats outside always, and among equals, more clearance wins. */
function seatBetter(a: Seat, b: Seat): boolean {
  if (a.out !== b.out) return a.out < b.out;
  return a.short < b.short;
}

/** The nearest position to `(x, z)` at which this piece's FOOTPRINT is inside the
 *  room, or the closest this can get. Pure; returns `(x, z)` unchanged when it is
 *  already inside, and unchanged again when nothing it tries is an improvement.
 *
 *  **A footprint answer, not a centre answer, and that is the whole reason it exists.**
 *  `clampIntoFootprint` puts a POINT inside the polygon, which a point 5 cm inside the
 *  leg of a U satisfies with a 2 m sofa mostly through the plaster. This reads the
 *  piece's extent along the wall's own normal (`obbExtentAlong`), so the answer is
 *  about the piece rather than about its middle.
 *
 *  Exported for `placeNewPart`, which had only a BOUNDING-BOX inset and so dropped
 *  pieces into the quadrant an L / T / U cuts away — inside the box, outside the
 *  house. Both scene paths already ended here via `contain`; the add path was the
 *  one surface that did not, and giving it its own containment would have been the
 *  third implementation of "put this back in the room". Same shape as
 *  `lib/drag-resolve.ts`: one resolve, every caller.
 *
 *  **`WALL_GAP` on every wall, or on none — not on two of four.** What the piece is
 *  measured against is `Seat`, whose `short` half counts the missing clearance, so
 *  the 20 mm is now part of the acceptance test rather than only of the push target.
 *  Before, acceptance was `footInsidePoly` alone: a foot corner sitting exactly on
 *  the boundary is read INSIDE at min-x/min-z and OUTSIDE at max-x/max-z, because
 *  `pointInPoly`'s ray test is half-open in z. So a piece dropped flush was returned
 *  untouched against the west and north walls and pushed 20 mm off the east and
 *  south — measured on a 6 × 4 room with a 300 mm lamp: 0.000 / 0.020 / 0.000 /
 *  0.020. One constant, one docblock in `lib/layout-rules.ts` promising every path
 *  agrees on it, and four different answers.
 *
 *  Two passes, and the second is not a fallback for tidiness. The first walks out
 *  along the summed inward normals of EVERY wall the piece is short of,
 *  which is exact for a convex room and can point along a concave wall rather than
 *  away from it; the second lerps toward an interior point, which every shape of
 *  room agrees is inward. `x0`/`z0` are the ORIGINAL position on purpose — the lerp
 *  starts from where the piece was, not from wherever the first pass left it, so a
 *  pass that made things worse cannot compound into the next one. Same reason a
 *  convoy member derives from its start transform rather than from the last frame.
 *
 *  **The lerp is gated on `out` alone, deliberately.** It exists for a piece hanging
 *  out of the room, and its step is a tenth of the way to the middle — an enormous
 *  move to make on behalf of a 20 mm shortfall. A piece that is inside but shy of
 *  its gap keeps whatever the push loop achieved.
 *
 *  `centre` must be an interior point, not `polygonCentroid`: the vertex average sits
 *  in the notch on a T and between the arms on a U, so a walk toward it walks out of
 *  the room. Callers pass `interiorPoint(poly) ?? polygonCentroid(poly)`. */
export function containedXZ(
  piece: ContainSubject,
  x0: number,
  z0: number,
  poly: Poly,
  centre: readonly [number, number],
  winding: 1 | -1,
): [number, number] {
  let x = x0;
  let z = z0;
  let best = seatAt(piece, x, z, poly, winding);
  if (best.out <= 0 && best.short <= SEAT_TOL) return [x0, z0];
  let bestX = x;
  let bestZ = z;

  for (let k = 0; k < 6 && (best.out > 0 || best.short > SEAT_TOL); k++) {
    // Every wall's DEFICIT at once, which is not the nearest wall's distance unless
    // the piece is square. `nearestEdge` is the fallback for "past every wall's end"
    // — a corner, where there is no signed clearance to read — and for a piece whose
    // centre is out of the room, where the short way back is the right answer.
    const w = wallDeficits(piece, x, z, poly, winding);
    let dx: number;
    let dz: number;
    if (w && w.total > SEAT_TOL) {
      dx = w.dx;
      dz = w.dz;
    } else {
      const e = nearestEdge(poly, x, z, winding);
      if (!e) break;
      const need = obbExtentAlong(subjectFootAt(piece, x, z), e.nx, e.nz) + WALL_GAP;
      // Inside the room: the deficit is what is missing. Outside it: the whole way
      // back in, plus the same deficit.
      const push = pointInPoly(x, z, poly) ? need - e.dist : need + e.dist;
      if (push <= SEAT_TOL) break;
      dx = e.nx * push;
      dz = e.nz * push;
    }
    if (Math.abs(dx) + Math.abs(dz) <= SEAT_TOL) break;
    x += dx;
    z += dz;
    const s = seatAt(piece, x, z, poly, winding);
    if (seatBetter(s, best)) {
      best = s;
      bestX = x;
      bestZ = z;
    }
  }

  // Still hanging out — a corner, or a concave wall the normal pointed the wrong way
  // along. Walk in toward the middle, which any shape of room agrees is inward.
  for (let t = 0.1; t <= 1.0001 && best.out > 0; t += 0.1) {
    const nx = x0 + (centre[0] - x0) * t;
    const nz = z0 + (centre[1] - z0) * t;
    const s = seatAt(piece, nx, nz, poly, winding);
    if (seatBetter(s, best)) {
      best = s;
      bestX = nx;
      bestZ = nz;
    }
  }

  return [bestX, bestZ];
}

/** Push a part until its whole footprint is inside the room.
 *
 *  Along the inward normal of the wall it is hanging over, by exactly the deficit —
 *  its own half-extent in that direction, minus how far in it already is. Repeated,
 *  because clearing the south wall in a corner leaves the east one, and each push
 *  changes which wall is nearest. Falls back to walking toward an INTERIOR POINT —
 *  not the centroid, which this used to say: `polygonCentroid` averages the vertices,
 *  so on a T it lands in the notch and on a U between the arms, and a walk toward it
 *  walks out of the room. And if even that cannot seat the piece (one longer than the
 *  room is wide), keeps the least bad position found and lets the room report say so,
 *  because silently shrinking it to fit is what rule 2 forbids.
 *
 *  The arithmetic is `containedXZ`, which is pure and exported; this is the part-shaped
 *  wrapper over it. `placeNewPart` is the other caller. */
function contain(p: ScenePart, poly: Poly, centre: readonly [number, number], winding: 1 | -1): void {
  const [x, z] = containedXZ(p, p.pos[0], p.pos[2], poly, centre, winding);
  p.pos[0] = x;
  p.pos[2] = z;
}

/** `footAtXZ` for a subject rather than a part. The Y handed to `footFromPart` is
 *  discarded — a `Foot` is `{cx, cz, hw, hd, rot}` — so there is nothing to supply,
 *  which is exactly why `containedXZ` can answer without one. */
function subjectFootAt(piece: ContainSubject, x: number, z: number): Foot {
  return footFromPart([x, 0, z], piece.rot, piece.dimMM, piece.circle);
}

/** How badly a part placed here escapes the room: 0 only when the whole footprint
 *  is inside, corner-exact.
 *
 *  The sampled share alone was the acceptance test, and it stops at zero while a
 *  corner is still 20 mm through the wall — its outermost samples sit 10% in from
 *  the edges. So the exact test decides WHETHER a position is acceptable and the
 *  share only ranks the unacceptable ones, which is what a piece too big for the
 *  room needs: something to be least-bad about.
 *
 *  Takes a `ContainSubject` rather than a `ScenePart` because `containedXZ` has only
 *  the three fields; every `ScenePart` satisfies it structurally, so no call site
 *  changed. */
function escape(piece: ContainSubject, x: number, z: number, poly: Poly): number {
  const f = subjectFootAt(piece, x, z);
  if (footInsidePoly(f, poly)) return 0;
  return Math.max(outsideShare(f, poly, 5), 1e-4);
}

/** Slide one part off everything it is inside, and keep it in the room.
 *
 *  Four directions — away from the room's middle, toward it, and both ways along
 *  the perpendicular — walked out in 50 mm steps, and the nearest position that is
 *  clear of every obstacle AND inside the footprint wins. The candidate set is what
 *  makes the answer stable: pushing along the line between two centres alone sends a
 *  sofa clipped by a bed's corner diagonally into the middle of the floor, where a
 *  200 mm slide along the wall was available. */
function pushClear(w: World, index: number, poly: Poly, centre: readonly [number, number]): boolean {
  const p = w.parts[index];
  // Outward from the room's middle, so a piece that clashes near a wall is pushed
  // along it rather than into it.
  let ox = p.pos[0] - centre[0];
  let oz = p.pos[2] - centre[1];
  const len = Math.hypot(ox, oz);
  if (len < 1e-6) {
    ox = Math.sin(p.rot);
    oz = Math.cos(p.rot);
  } else {
    ox /= len;
    oz /= len;
  }
  const dirs: Array<[number, number]> = [
    [ox, oz],
    [-ox, -oz],
    [-oz, ox],
    [oz, -ox],
  ];

  for (let step = PUSH_STEP; step <= MAX_PUSH + 1e-9; step += PUSH_STEP) {
    for (const [dx, dz] of dirs) {
      const x = p.pos[0] + dx * step;
      const z = p.pos[2] + dz * step;
      const me = footAtXZ(p, x, z);
      if (!footInsidePoly(me, poly)) continue;
      if (!clearOfAll(w, index, me)) continue;
      p.pos[0] = x;
      p.pos[2] = z;
      // The one cached footprint that just went stale.
      w.feet[index] = me;
      return true;
    }
  }
  // Nowhere to go. Leaving it put is the honest outcome — `lib/clearance.ts` reports
  // the clash, and a piece teleported into the one free corner of a full room is a
  // worse answer than one that stayed where it was put.
  return false;
}

function clearOfAll(w: World, index: number, me: Foot): boolean {
  const myRole = w.roles[index];
  // The mover's own area is its footprint's, wherever it stands — a translation does
  // not change it, so the cached value holds for every candidate position.
  const myArea = w.areas[index];
  for (let j = 0; j < w.parts.length; j++) {
    if (j === index) continue;
    if (!w.obstacle[j]) continue;
    if (sharesFloor(myRole, w.roles[j])) continue;
    if (shares(me, w.feet[j], Math.min(myArea, w.areas[j]))) return false;
  }
  return true;
}

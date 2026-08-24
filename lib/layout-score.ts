// What makes an arrangement good, written as arithmetic.
//
// `lib/clearance.ts` knows what makes an arrangement *wrong* and says it as a list
// of complaints. A solver cannot use complaints: it needs a number that gets
// smaller as the room gets better, including while it is still bad, so that a move
// which reduces a problem without fixing it is recognised as progress.
//
// Every functional term here reads `lib/layout-rules.ts` — the same table the room
// report reads. That is not tidiness, it is the bug fix: the two used to carry
// separate copies of the rules, the solver's copy was the smaller one, and it did
// not contain doors at all. So "Suggest" would park a bed across a doorway, score
// it as an improvement, and Room check would report the door it had just blocked.
//
// After Merrell et al., *Interactive Furniture Layout Using Interior Design
// Guidelines* (SIGGRAPH 2011) and the term set spelled out in its patent
// (US 2013/0222393): clearance and circulation as violated area, pairwise
// relations as a distance BAND rather than a target, alignment as cos 4Δθ, visual
// balance as an area-weighted centroid. Nothing is learned and nothing is
// downloaded — the guidelines are numbers from design manuals, and the weights are
// a hierarchy rather than a mix.
//
// **It never reads or writes `dimMM` to change it.** Sizes are inputs: they set
// how big every zone is and they are never an output. That is what keeps this
// inside the trust boundary — a suggestion cannot change a measurement.

import type { ScenePart } from './scene-spec';
import type { Footprint } from './footprint';
import {
  buildClearanceField,
  FIELD_CELL,
  componentAreas,
  componentsAround,
  componentsNear,
} from './clearance-field';
import {
  footArea,
  footIntersectionArea,
  frontVector,
  nearestEdge,
  obbGap,
  outsideShare,
  polyCentroid,
  type Foot,
  type Poly,
} from './geometry';
import {
  accessZones,
  doorPath,
  fallbackAffinity,
  footAt,
  formsRoute,
  isObstacle,
  placeAffinity,
  relationFor,
  relationOptions,
  roleOf,
  roomProfile,
  routeWidth,
  sharesFloor,
  WALK_MIN,
  zoneExempt,
  type AccessRule,
  type PlaceAffinity,
  type Relation,
  type Role,
  type RoomProfile,
  type RuleKind,
} from './layout-rules';

/** A part reduced to what the solver moves. Deliberately not a `ScenePart`: the
 *  dimensions are inputs, and a type that cannot express changing them is worth
 *  more than a comment saying not to. */
export type Placement = { x: number; z: number; yaw: number };

export type ScoreWeights = {
  /** Two pieces in the same place. */
  overlap: number;
  /** A piece outside the room. */
  outside: number;
  /** A piece inside a door's swing, or across the way in from it. */
  door: number;
  /** A functional zone — a wardrobe's front, a bed's side, a table's seats —
   *  with something standing in it. */
  access: number;
  /** A gap too narrow to walk down. */
  walkway: number;
  /** Something tall in front of a window. */
  window: number;
  /** Floor, and pieces, that nobody coming through the door can reach.
   *
   *  The one term that is not pairwise, and the reason it is here at all: every
   *  individual gap in a room can pass and the room still be cut in two, because
   *  circulation is a property of the whole floor. Measured on a 6 × 4 room with seven
   *  dining chairs strung across it — nothing overlapping, no zone blocked, no door
   *  touched, and chairs are not route-formers so the walkway term is blind — the
   *  scored total was **0.4**, a near-perfect room, with **5.2 m² of floor** that has
   *  no route to the door. The solver moved nothing, at every seed.
   *
   *  It costs a raster and a distance transform, so it is NOT computed on the
   *  annealer's fast path — see `costBreakdown`'s `navCell`. */
  navigation: number;
  /** A piece that wants a wall and has not got one, or wants the middle. */
  wall: number;
  middle: number;
  /** Square to the room, or to its neighbours. */
  alignment: number;
  /** Pieces that belong together — nightstand to bed, chair to table. */
  relation: number;
  /** Visual weight near the room's middle. */
  balance: number;
  /** Distance from where the piece already was. Small on purpose: it decides
   *  nothing and breaks every tie, which is what stops a suggestion rearranging
   *  the whole room to gain a rounding error. */
  inertia: number;
};

/** Weights are a hierarchy, not a mix. Two pieces in the same place is a fact
 *  about the room; a sofa at 7° to the wall is a matter of taste. Three orders of
 *  magnitude between them means no amount of taste can buy a collision — and a
 *  blocked door sits in the same tier as a collision, because a door you cannot
 *  open is not a stylistic preference either. */
export const DEFAULT_WEIGHTS: ScoreWeights = {
  overlap: 1000,
  outside: 1000,
  door: 800,
  // A square metre of floor nobody can reach is the same tier as a blocked door,
  // because it is the same failure: part of the room is not part of the room.
  navigation: 120,
  access: 60,
  walkway: 40,
  window: 20,
  wall: 12,
  relation: 10,
  middle: 6,
  alignment: 4,
  balance: 2,
  inertia: 1.5,
};

/** How much dearer facing the WRONG WAY is than being a few degrees off square.
 *
 *  `angleCost` is normalised to 0…1 over a half turn, so without this a piece turned
 *  completely backwards cost exactly one `alignment` unit — four, at the weight
 *  above. Which is less than the inertia of moving it 2.7 m, and a third of what a
 *  300 mm walkway pinch costs. The solver duly returned sofas with their backs to
 *  the room and called it an improvement. Applied only where the heading is a fact
 *  rather than a preference: a piece against a wall faces the room, full stop. The
 *  gentler `quarterTurnCost` still governs everything else. */
const FACING_GAIN = 4;

/** Turned up when the room or a piece has been resized and the job is to repair
 *  the arrangement rather than reinvent it: everything that was still fine stays
 *  where it is, and only what the change broke gets moved. */
export const REFIT_INERTIA = 14;

/** How much dearer it is to move a piece the user placed by hand than one the app
 *  put there. A multiplier on that piece's inertia, not a lock: a hand placement can
 *  still be overruled, it just has to buy several times more than a guess does. */
const PLACED_INERTIA = 4;

/** What this module can do about each kind of finding the room report can make.
 *
 *  Two different questions, kept apart because they have different answers:
 *
 *  · `costTerm` — the weight above that implements the same rule, so a finding and
 *    the number the annealer descends can be checked against each other. Null when a
 *    per-proposal cost cannot express it.
 *  · `movable` — can rearranging the pieces involved plausibly clear it? This is what
 *    the room report reads to decide whether to OFFER a fix, and it is not the same
 *    question: `reach` has no weight here because it needs the clearance field, which
 *    is too expensive per proposal — but `solveLayout` scores it over the finalists
 *    through `navigabilityCost`, so moving furniture genuinely does fix it.
 *
 *  The table is here rather than beside the findings because both answers are facts
 *  about the solver. `tests/layout-conformance.test.ts` holds it to `clearance.ts`:
 *  a new kind of finding fails that test until it appears here. */
export const RULE_HANDLING: Record<
  RuleKind,
  { costTerm: keyof ScoreWeights | null; movable: boolean; why?: string }
> = {
  door: { costTerm: 'door', movable: true },
  entry: { costTerm: 'door', movable: true },
  clash: { costTerm: 'overlap', movable: true },
  walk: { costTerm: 'walkway', movable: true },
  zone: { costTerm: 'access', movable: true },
  window: { costTerm: 'window', movable: true },
  tv: { costTerm: 'relation', movable: true },

  // Both of these used to say `costTerm: null` with a note that they were "priced by
  // navigabilityCost over the finalists rather than per proposal". That was not true
  // in the way that matters, and the room report was reading these rows to decide
  // whether to offer a **Try a fix** button. Ranking a handful of finalists only helps
  // when the pool contains a candidate that is better; when the arrangement is already
  // a local minimum on every other term the annealer never leaves it, the pool holds
  // one candidate, and ranking one candidate is a no-op. Measured on a room with 5.2 m²
  // sealed off: nothing moved, at six seeds out of six — a button that did nothing.
  // Now a real term, computed where it is affordable to compute. See `navCell`.
  reach: { costTerm: 'navigation', movable: true },
  'cut-off': { costTerm: 'navigation', movable: true },

  turning: {
    costTerm: null,
    movable: false,
    why:
      'accessibility-only and off by default, and nothing costs turning space — ' +
      '`navigabilityCost` prices reachability, not the largest circle that fits. ' +
      'Offering a fix would be offering a button that does nothing.',
  },
  tall: {
    costTerm: null,
    movable: false,
    why:
      'a fact about the piece’s SIZE, not its placement. This module moves and turns, ' +
      'and `Placement` has no field a dimension could travel in, so no arrangement it ' +
      'can reach would help.',
  },
  crowding: {
    costTerm: null,
    movable: false,
    why: 'a property of the whole room — no rearrangement removes a piece, so there is nothing to descend.',
  },
};

export type LayoutContext = {
  parts: ScenePart[];
  /** Index-aligned with `parts`; entries the solver may not move are still
   *  scored, because a locked piece is still in the way. */
  movable: boolean[];
  footprint: Footprint;
  /** Where each piece started. Present so the inertia term has something to
   *  measure against; when absent that term is simply off. */
  origin?: Placement[];
  /** Index-aligned; true for a piece the USER put where it is, rather than one the
   *  seeder or a detection did.
   *
   *  Inertia was uniform, which treats "the app guessed this" and "I dragged this
   *  here on purpose" as the same claim on staying put. They are not: moving the
   *  first is a suggestion, moving the second is overruling somebody. The store
   *  already knows which is which — `useStudio.positions` holds an entry only for a
   *  piece that has been moved by hand — so this costs a lookup and nothing else. */
  placed?: boolean[];
  /** Cached reading of the room — roles, anchor, focals, openings. Computed once
   *  per solve rather than tens of thousands of times inside the annealer. */
  profile?: RoomProfile;
};

/** One access zone as the solver wants it: the rule it belongs to, and a box in the
 *  owner's LOCAL frame. Local, because that part is what does not change — turning
 *  or moving the piece is two multiplications away, and rebuilding the rule table
 *  per proposal was most of the cost of a solve. */
type LocalZone = { lx: number; lz: number; hw: number; hd: number; r: number; area: number };
type ZoneGroup = { rule: AccessRule; boxes: LocalZone[] };

/** Everything about the room that does not change while the solver runs. Built
 *  once by `prepare`, then handed to every `scoreLayout` call.
 *
 *  This is not an optimisation detail, it is the difference between a button and a
 *  freeze: the terms are all O(n²)-ish, the annealer evaluates them tens of
 *  thousands of times, and the parts of them that depend only on WHAT the furniture
 *  is — its role, its rules, which pairs have a relation at all, where the doors
 *  are — do not change while it runs. Recomputing them per proposal cost 8 seconds
 *  on a twenty-piece room. */
export type LayoutModel = {
  ctx: LayoutContext;
  poly: Poly;
  profile: RoomProfile;
  roles: Role[];
  /** Does this piece get in a walker's way? */
  obstacle: boolean[];
  /** Top of each piece, world Y — a window sightline needs to know. */
  top: number[];
  /** Bounding-circle radius of each footprint, and its area. Both are properties of
   *  the piece's dimensions, which the solver never changes — so a squared-distance
   *  reject against `radius` costs no square root at all, and the area a share is
   *  taken of never needs recomputing. */
  radius: number[];
  area: number[];
  /** Indices of doors, and of windows. */
  doors: number[];
  windows: number[];
  /** Access zones per part, grouped by rule so `atLeast` can be applied. */
  zoneGroups: ZoneGroup[][];
  /** Door swings and window bands, already in world space — apertures belong to
   *  the walls and never move, so these are computed once. */
  apertures: Array<{ owner: number; rule: AccessRule; foot: Foot }>;
  /** Routes in from each door, likewise static. */
  paths: Array<{ owner: number; foot: Foot }>;
  /** What each piece OWES, resolved once, grouped by obligation.
   *
   *  Not a flat list of pairs. A spec that names several anchors — a rug's
   *  `['sofa', 'bed', 'dining-table']` — is one obligation with several ways to
   *  discharge it, and flattening it made the rug owe every group in the room at
   *  once. See `relationOptions`, which owns that reading, and §3.10.1 of
   *  `docs/history/Research.md` for the 38.3 it used to cost.
   *
   *  Resolved here rather than per evaluation for the same reason everything else in
   *  this model is: the table would otherwise be scanned for all 870 ordered pairs of
   *  a thirty-piece room, tens of thousands of times. */
  obligations: Array<{ i: number; options: Array<{ j: number; rel: Relation }> }>;
  /** Does this piece have any anchor at all in this room? Read by `affinity` — a
   *  coffee table with a sofa is placed by the sofa; one on its own has to fall back
   *  to an opinion of its own or it will be left wherever it lands. */
  anchored: boolean[];
  /** Where each piece wants to stand, already resolved through `anchored`. */
  affinity: PlaceAffinity[];
  /** Does this piece's gap with another form a route someone walks down? */
  routeFormer: boolean[];
  /** The pairs allowed to sit closer than a walkway, as an unordered membership
   *  test, `i * n + j` both ways.
   *
   *  The circulation term needs it: the gap between a sofa and its own coffee table
   *  is what the relation asks for, not a route someone walks down, and costing it
   *  as a pinch had the solver pulling apart the arrangement the relation had just
   *  paid to build. Membership is the relation's own BAND — `min < WALK_MIN` — and not
   *  the existence of a relation, so an armchair that is supposed to sit 1.2 m from a
   *  sofa is still charged for sitting 300 mm from one. `lib/clearance.ts` reads the
   *  same rule through `belongTogether`. */
  related: Set<number>;
  /** The route width this room is big enough to be asked for. */
  route: number;
  centre: [number, number];
  /** Scratch, reused by every evaluation. One `Foot` per part with its constant
   *  half-extents already filled in, plus that footprint's axis-aligned extents at
   *  the current heading. Both are rewritten in place per proposal.
   *
   *  Allocating them per evaluation cost more than any single term: a 20-piece room
   *  meant 40 objects and two arrays per proposal, times sixteen thousand
   *  proposals. A model is therefore NOT safe to evaluate from two places at once —
   *  which nothing does, and nothing should. */
  feet: Foot[];
  ex: Float64Array;
  ez: Float64Array;
};

export function prepare(ctx: LayoutContext): LayoutModel {
  const parts = ctx.parts;
  const profile = ctx.profile ?? roomProfile(parts);
  const roles = parts.map(roleOf);
  const doors = profile.apertures.filter((i) => roles[i] === 'door');
  const windows = profile.apertures.filter((i) => roles[i] === 'window');
  const route = routeWidth(ctx.footprint);

  // Zones in each part's own frame. `accessZones` gives them in world space for a
  // placement, so build them at the origin unrotated and keep the offsets.
  const zoneGroups: ZoneGroup[][] = parts.map((p) => {
    if (p.wallMounted) return [];
    const groups = new Map<string, ZoneGroup>();
    for (const zn of accessZones(p, 0, 0, 0)) {
      const g = groups.get(zn.rule.id) ?? { rule: zn.rule, boxes: [] };
      g.boxes.push({
        lx: zn.foot.cx,
        lz: zn.foot.cz,
        hw: zn.foot.hw,
        hd: zn.foot.hd,
        r: Math.hypot(zn.foot.hw, zn.foot.hd),
        area: 4 * zn.foot.hw * zn.foot.hd,
      });
      groups.set(zn.rule.id, g);
    }
    return [...groups.values()];
  });

  const apertures: LayoutModel['apertures'] = [];
  for (const i of profile.apertures) {
    for (const zn of accessZones(parts[i], parts[i].pos[0], parts[i].pos[2], parts[i].rot)) {
      apertures.push({ owner: i, rule: zn.rule, foot: zn.foot });
    }
  }
  const paths = doors.map((i) => ({ owner: i, foot: doorPath(parts[i], route) }));

  const obligations: LayoutModel['obligations'] = [];
  const anchored = parts.map(() => false);
  const related = new Set<number>();
  for (let i = 0; i < parts.length; i++) {
    for (const group of relationOptions(parts[i], parts)) {
      obligations.push({ i, options: group.options.map((o) => ({ j: o.anchor, rel: o.rel })) });
      anchored[i] = true;
      for (const o of group.options) {
        if (o.rel.min < WALK_MIN) {
          related.add(i * parts.length + o.anchor);
          related.add(o.anchor * parts.length + i);
        }
      }
    }
  }

  return {
    ctx,
    poly: ctx.footprint as Poly,
    profile,
    roles,
    obstacle: parts.map(isObstacle),
    top: parts.map((p) => p.pos[1] + p.dimMM[2] / 1000),
    radius: parts.map((p) => Math.hypot(p.dimMM[0], p.dimMM[1]) / 2000),
    area: parts.map((p) => {
      const a = (p.dimMM[0] / 1000) * (p.dimMM[1] / 1000);
      return (p.circle ? (Math.PI / 4) * a : a) || 1;
    }),
    doors,
    windows,
    zoneGroups,
    apertures,
    paths,
    obligations,
    anchored,
    affinity: roles.map((r, i) => {
      const want = placeAffinity(r);
      return want === 'by-relation' && !anchored[i] ? fallbackAffinity(r) : want;
    }),
    routeFormer: roles.map(formsRoute),
    related,
    route,
    centre: polyCentroid(ctx.footprint as Poly),
    feet: parts.map((p) => ({
      cx: 0,
      cz: 0,
      hw: p.dimMM[0] / 2000,
      hd: p.dimMM[1] / 2000,
      rot: 0,
      circle: p.circle,
    })),
    ex: new Float64Array(parts.length),
    ez: new Float64Array(parts.length),
  };
}

/** Total cost of an arrangement. Lower is better; zero is unreachable and not
 *  meant to be — the terms disagree with each other on purpose, which is what
 *  makes the minimum a compromise rather than a rule being obeyed.
 *
 *  Accepts either a context (which it prepares, for callers scoring one layout) or
 *  an already-prepared model (for the annealer, which scores tens of thousands). */
export function scoreLayout(
  ctxOrModel: LayoutContext | LayoutModel,
  placements: Placement[],
  weights: ScoreWeights = DEFAULT_WEIGHTS,
): number {
  const m = 'poly' in ctxOrModel ? ctxOrModel : prepare(ctxOrModel);
  return costBreakdown(m, placements, weights).total;
}

/** Per-term costs. The solver only needs the total, but the UI needs to be able
 *  to say WHY it moved something, and a room report that agrees with the solver is
 *  worth more than one that merely runs beside it. */
export type CostBreakdown = Record<keyof ScoreWeights, number> & { total: number };

const ZERO: CostBreakdown = {
  overlap: 0,
  outside: 0,
  door: 0,
  navigation: 0,
  access: 0,
  walkway: 0,
  window: 0,
  wall: 0,
  middle: 0,
  alignment: 0,
  relation: 0,
  balance: 0,
  inertia: 0,
  total: 0,
};

/** Grid the navigation term is read off, metres — the room report's own.
 *
 *  It is `FIELD_CELL` and not a number of its own, because the moment the two differ
 *  the solver and the report disagree about which floor is walkable, and disagreeing
 *  about a rule is the exact failure `lib/layout-rules.ts` exists to prevent. That is
 *  not hypothetical: at 0.1 m the seeded T room read 2.02 m² stranded and at 0.05,
 *  0.075 and 0.15 it read zero — pure quantisation, and it would have had Suggest
 *  rearranging a room the report was quite right to be quiet about.
 *
 *  It is expensive, and that is the whole reason `costBreakdown` leaves the term off
 *  by default. Measured on a 6 × 4 room against one evaluation:
 *
 *    · 0.05 m — 10 004 cells, 1 190 µs, **10–22×** an evaluation
 *    · 0.10 m —  2 604 cells,   325 µs, **2.6–6×**
 *    · 0.15 m —  1 218 cells,   155 µs, **1.2–3×**
 *
 *  So it is paid a handful of times per solve — the two reported breakdowns, and the
 *  check that decides whether a repair pass is needed at all — and never inside the
 *  search. The repair pass's own inner loop uses a coarser grid and then re-checks its
 *  answer against this one; see `REPAIR_CELL` in `lib/layout-solve.ts`. */
export const NAV_CELL = FIELD_CELL;

/** What a piece nobody can get to is worth, in the same units as a square metre of
 *  unreachable floor. A wardrobe you cannot open is worse than an equivalent patch of
 *  empty carpet, which is why it is more than one. */
const STRANDED_PIECE = 2;

export function costBreakdown(
  m: LayoutModel,
  placements: Placement[],
  weights: ScoreWeights = DEFAULT_WEIGHTS,
  /** Grid for the navigation term, or `null` to leave it at zero.
   *
   *  Off by default, and that default is the annealer's: a distance transform per
   *  proposal costs more than the entire search. Every other caller — the finalists,
   *  the repair pass, the breakdown a suggestion is reported with — passes a cell and
   *  pays for it once. */
  navCell: number | null = null,
): CostBreakdown {
  const { ctx, poly, roles, obstacle, top, radius, area } = m;
  const parts = ctx.parts;
  const c: CostBreakdown = { ...ZERO };

  // The footprints, written into the model's scratch rather than allocated, along
  // with their axis-aligned extents at this heading — those turn the pair loops
  // below into arithmetic for every pair that is not actually close.
  const feet = m.feet;
  const { ex, ez } = m;
  for (let i = 0; i < feet.length; i++) {
    const f = feet[i];
    f.cx = placements[i].x;
    f.cz = placements[i].z;
    f.rot = placements[i].yaw;
    const c0 = Math.abs(Math.cos(f.rot));
    const s0 = Math.abs(Math.sin(f.rot));
    ex[i] = c0 * f.hw + s0 * f.hd;
    ez[i] = s0 * f.hw + c0 * f.hd;
  }

  /** A lower bound on the gap between two pieces, from their axis-aligned boxes.
   *  Tighter than bounding circles for the long thin things furniture mostly is,
   *  and it is the reject that makes the walkway term affordable. */
  const boxGap = (i: number, j: number): number =>
    Math.max(
      Math.abs(feet[j].cx - feet[i].cx) - ex[i] - ex[j],
      Math.abs(feet[j].cz - feet[i].cz) - ez[i] - ez[j],
    );

  // ── Hard: two pieces in the same place, or a piece outside the room ───────
  for (let i = 0; i < feet.length; i++) {
    if (!obstacle[i]) continue;
    for (let j = i + 1; j < feet.length; j++) {
      if (!obstacle[j]) continue;
      if (boxGap(i, j) > 0) continue; // cannot overlap
      // Only seating pushed under a surface genuinely occupies the same floor. NOT
      // the access-zone guests: a nightstand belongs in the strip beside a bed and
      // emphatically not inside it, and exempting it here let the solver bury one
      // in the mattress — which the room report then reported, correctly.
      if (sharesFloor(roles[i], roles[j])) continue;
      const shared = footIntersectionArea(feet[i], feet[j]);
      if (shared > 0) c.overlap += shared / Math.min(area[i], area[j]);
    }
    c.outside += outsideShare(feet[i], poly);
  }

  // ── Openings: the room's own structure, which nothing may stand in ────────
  //
  // Doors were the whole reason this file was rewritten. They are wall-mounted, so
  // the old blocker mask excluded them and every term here was blind to them: a
  // bed across the doorway cost exactly nothing.
  for (const ap of m.apertures) {
    const owner = ap.owner;
    const isWindow = m.roles[owner] === 'window';
    const zoneArea = footArea(ap.foot) || 1;
    const zoneR = Math.hypot(ap.foot.hw, ap.foot.hd);
    for (let i = 0; i < feet.length; i++) {
      if (i === owner) continue;
      if (isWindow ? parts[i].wallMounted : !obstacle[i]) continue;
      if (far2(feet[i], ap.foot, radius[i] + zoneR)) continue;
      if (zoneExempt(m.roles[owner], roles[i])) continue;
      // Height is the whole of the window rule: a low chest under a window is a
      // windowsill, a wardrobe in front of one is a mistake. Doors carry `aboveY`
      // 0, so the same line covers both.
      const over = top[i] - ap.rule.aboveY;
      if (over <= 0) continue;
      const shared = footIntersectionArea(feet[i], ap.foot);
      if (shared <= 0) continue;
      if (isWindow) c.window += (shared / zoneArea) * Math.min(1.5, over);
      else c.door += shared / area[i];
    }
  }

  // The way IN, which is not the same question as whether the leaf can swing: a
  // door that opens perfectly into a room you cannot then walk out of is still a
  // room you cannot walk out of. Weighted at half — it is a corridor, and clipping
  // its edge is not the same as standing in the doorway.
  for (const path of m.paths) {
    const pathR = Math.hypot(path.foot.hw, path.foot.hd);
    for (let i = 0; i < feet.length; i++) {
      if (!obstacle[i] || i === path.owner || zoneExempt('door', roles[i])) continue;
      if (far2(feet[i], path.foot, radius[i] + pathR)) continue;
      const shared = footIntersectionArea(feet[i], path.foot);
      if (shared > 0) c.door += (0.5 * shared) / area[i];
    }
  }

  // ── Functional zones: the things each piece needs clear ───────────────────
  //
  // One term for what used to be four separate rules (wardrobe fronts, bed sides,
  // fridge doors, and nothing at all for a desk or a dining table). `atLeast` is
  // what makes it expressive: a rule over four sides that only needs three costs
  // its cheapest sides and forgives the rest, so a table with one end against a
  // wall is not a fault.
  const scratch: number[] = [];
  for (let i = 0; i < parts.length; i++) {
    const groups = m.zoneGroups[i];
    for (let g = 0; g < groups.length; g++) {
      const { rule, boxes } = groups[g];
      scratch.length = 0;
      const cs = Math.cos(placements[i].yaw);
      const sn = Math.sin(placements[i].yaw);
      for (const box of boxes) {
        // `localToWorld`, inlined: the offsets were built at the origin unrotated,
        // so this is the whole of turning and moving the zone with its owner.
        const zn: Foot = {
          cx: placements[i].x + box.lx * cs + box.lz * sn,
          cz: placements[i].z - box.lx * sn + box.lz * cs,
          hw: box.hw,
          hd: box.hd,
          rot: placements[i].yaw,
        };
        scratch.push(zoneBlocked(m, feet, i, zn, box, rule.aboveY));
      }
      // Keep the `atLeast` cheapest — those are the sides the rule insists on.
      scratch.sort((a, b) => a - b);
      for (let k = 0; k < Math.min(rule.atLeast, scratch.length); k++) c.access += scratch[k];
    }
  }

  // ── Circulation: gaps that are neither flush nor passable ─────────────────
  //
  // Two things here were the solver's alone and are now the report's rule, read
  // through `layout-rules`:
  //
  //   · **Which pairs.** Only a gap between BULKY pieces is a walkway. Every
  //     obstacle pair used to count, so three dining chairs 400 mm apart around
  //     their own table cost `walkway 40.4` on a room `analyzeRoom` reported nothing
  //     about — and the solver flung the dining set across the floor to fix it. See
  //     `formsRoute`.
  //   · **The bar.** `WALK_MIN`, the same fixed 600 mm the report calls a fault at.
  //     This used to be `routeWidth`, which scales to 900 mm in a large room, so the
  //     solver policed a rule the report would never raise and the two disagreed by
  //     construction on every room over 20 m². Comfort beyond 600 mm is expressed
  //     where it is actually a requirement — a diner's pull-back, a desk chair's
  //     push-back — by the access zones, which measure it per activity instead of
  //     applying one number to every gap in the room.
  for (let i = 0; i < feet.length; i++) {
    if (!obstacle[i] || !m.routeFormer[i]) continue;
    for (let j = i + 1; j < feet.length; j++) {
      if (!obstacle[j] || !m.routeFormer[j]) continue;
      // Pieces that belong together are exempt — see `related`.
      if (m.related.has(i * feet.length + j)) continue;
      // `boxGap` never overstates how close they are, so anything it puts beyond the
      // bar cannot be a pinch and never needs the exact corner-to-corner answer.
      if (boxGap(i, j) >= WALK_MIN) continue;
      const gap = obbGap(feet[i], feet[j]);
      // A pinch is a gap someone would try to walk through and could not. Flush is
      // deliberate composition, and the cost has to go back to zero there or the
      // solver will pull everything apart to escape a penalty it cannot.
      if (gap > 0.12 && gap < WALK_MIN) c.walkway += WALK_MIN - gap;
    }
  }

  // ── Where a piece wants to be, and which way it wants to look ─────────────
  let mass = 0;
  let mx = 0;
  let mz = 0;

  for (let i = 0; i < feet.length; i++) {
    const p = parts[i];
    if (p.wallMounted) continue;
    const f = feet[i];
    const edge = nearestEdge(poly, f.cx, f.cz, m.centre);
    // By ROLE, not by category — a coffee table, a side table and a dining table are
    // all `table` and want three different things. And `'by-relation'` pieces get
    // neither term: their place is the relation's answer, and a wall or middle term
    // beside it is a second answer pulling the other way. See `placeAffinity`.
    const affinity = m.affinity[i];

    if (edge) {
      // Distance from the piece's BACK to the wall, not from its centre: a deep
      // wardrobe and a shallow shelf are both against the wall at very different
      // centre distances, and using the centre asks the wardrobe to bury itself.
      const back = edge.dist - halfDepthToward(f, edge.nx, edge.nz);
      if (affinity === 'must-wall' || affinity === 'prefers-wall') {
        c.wall += Math.max(0, back);
        // …and facing INTO the room, which is the other half of being against a
        // wall. A wardrobe with its doors in the plaster is flush and useless.
        //
        // `FACING_GAIN` because it was not: `angleCost` tops out at 1, so a piece
        // turned COMPLETELY the wrong way used to cost four units — less than moving
        // it 2.7 m costs in inertia, and a rounding error against a walkway pinch.
        // Which way a sofa faces is not a matter of taste, and it was priced as one.
        c.alignment += FACING_GAIN * angleCost(placements[i].yaw, edge.yaw);
      } else if (affinity === 'prefers-middle') {
        c.middle += Math.max(0, 1.2 - edge.dist);
      } else {
        // Everything rectilinear reads better square to SOMETHING. Merrell's
        // cos 4Δθ: zero at every quarter turn, smooth in between, and one
        // expression instead of a piecewise fold — so a chair angled toward a sofa
        // is not fined for being at 45°, it is fined a little for being at 20°.
        c.alignment += 0.4 * quarterTurnCost(placements[i].yaw, edge.yaw);
      }
    }

    const a = footArea(f);
    mass += a;
    mx += f.cx * a;
    mz += f.cz * a;
  }

  // ── Pieces that belong together ───────────────────────────────────────────
  //
  // The half of "is this a room" that no clearance rule can see. Every distance is
  // a BAND: zero cost inside it, growing outside, so the rule says "these go
  // together" without dictating exactly where.
  // …and every obligation is discharged by its BEST anchor, not by all of them. A
  // rug is under one group; a reading lamp is beside one seat. Summing over a spec's
  // anchors charged a rug for every group in the room it was not under, which was
  // the whole of the seeded T's 38.3 and the reason the rug ended up parked between
  // the sofa and the dining table where it served neither.
  for (const ob of m.obligations) {
    const i = ob.i;
    let best = Infinity;
    let bestWeight = 0;
    for (const { j, rel } of ob.options) {
      const cost = relationCost(feet, placements, i, j, rel);
      if (cost < best) {
        best = cost;
        bestWeight = rel.weight;
      }
    }
    if (best < Infinity) c.relation += bestWeight * best;
  }

  // ── Balance: the room's weight near its middle ────────────────────────────
  if (mass > 0) {
    c.balance += Math.hypot(mx / mass - m.centre[0], mz / mass - m.centre[1]);
  }

  // ── Inertia: do not move what was already right ───────────────────────────
  //
  // The term that makes this a suggestion rather than a shuffle. Without it the
  // solver returns whatever minimum it happened to land in, which differs
  // everywhere from what the user had for a fraction of a percent of cost — and
  // reads, correctly, as "it just moved everything at random".
  const origin = ctx.origin;
  if (origin) {
    for (let i = 0; i < placements.length; i++) {
      if (!ctx.movable[i]) continue;
      const d = Math.hypot(placements[i].x - origin[i].x, placements[i].z - origin[i].z);
      // A piece the user placed by hand is dearer to move than one the app guessed at
      // — see `LayoutContext.placed`. Not immovable: the solver may still overrule a
      // hand placement, it just has to be worth several times more to do it.
      const claim = ctx.placed?.[i] ? PLACED_INERTIA : 1;
      c.inertia += claim * (d + 0.4 * Math.abs(angleDelta(placements[i].yaw, origin[i].yaw)));
    }
  }

  // Spelled out rather than looped over `Object.keys(weights)`, which allocated a
  // twelve-string array on every evaluation.
  c.overlap *= weights.overlap;
  c.outside *= weights.outside;
  if (navCell !== null) c.navigation = navigabilityCost(m, placements, navCell);
  c.door *= weights.door;
  c.navigation *= weights.navigation;
  c.access *= weights.access;
  c.walkway *= weights.walkway;
  c.window *= weights.window;
  c.wall *= weights.wall;
  c.middle *= weights.middle;
  c.alignment *= weights.alignment;
  c.relation *= weights.relation;
  c.balance *= weights.balance;
  c.inertia *= weights.inertia;
  c.total =
    c.overlap +
    c.outside +
    c.door +
    c.navigation +
    c.access +
    c.walkway +
    c.window +
    c.wall +
    c.middle +
    c.alignment +
    c.relation +
    c.balance +
    c.inertia;
  return c;
}

// ─── Navigability, which is not a pairwise question ─────────────────────────
//
// Every individual gap in a room can pass and the room still be split in two,
// because circulation is a property of the whole floor. `costBreakdown`'s walkway
// term is pairwise and cannot see that; this can, by rasterising the floor and
// asking which parts of it join up — the same field the room report reads, so the
// solver and the report agree about what "you can't get there" means.
//
// It is NOT part of the annealer's inner loop: a distance transform per proposal
// would cost more than the whole search. The solver keeps its best few candidates
// and pays for this once each, which is the coarse-to-fine version of the same
// answer.

/** Square metres of floor, and pieces, that a person coming through the door
 *  cannot reach. Zero when the room has no door — without one there is no telling
 *  which side anybody arrives from, and every claim would be a guess. */
export function navigabilityCost(m: LayoutModel, placements: Placement[], cell?: number): number {
  if (m.doors.length === 0) return 0;
  const parts = m.ctx.parts;
  const solid: number[] = [];
  for (let i = 0; i < parts.length; i++) if (m.obstacle[i]) solid.push(i);
  const feet = solid.map((i) => footAt(parts[i], placements[i].x, placements[i].z, placements[i].yaw));
  const field = buildClearanceField(feet, m.poly, cell);
  if (!field || field.componentCount === 0) return 0;

  const reachable = new Set<number>();
  for (const d of m.doors) {
    for (const id of componentsNear(field, placements[d].x, placements[d].z, 1.2)) reachable.add(id);
  }
  // Nowhere walkable near any door: the room is so full that saying which bits are
  // cut off would be noise. The overlap and access terms already have plenty to
  // say about that arrangement.
  if (reachable.size === 0) return 0;

  let cost = 0;
  const areas = componentAreas(field);
  for (let id = 0; id < areas.length; id++) if (!reachable.has(id)) cost += areas[id];

  // A piece whose own access zones are all stranded is worse than a stranded
  // patch of empty floor: it is a wardrobe you cannot open.
  for (let k = 0; k < solid.length; k++) {
    const i = solid[k];
    const zones = accessZones(parts[i], placements[i].x, placements[i].z, placements[i].yaw);
    if (zones.length === 0) continue;
    let anyReachable = false;
    let anyWalkable = false;
    for (const zn of zones) {
      for (const id of componentsAround(field, zn.foot, 0)) {
        anyWalkable = true;
        if (reachable.has(id)) {
          anyReachable = true;
          break;
        }
      }
      if (anyReachable) break;
    }
    // Nothing walkable anywhere near it is "wedged in", not "unreachable" — a chest in
    // an alcove reads that way and is perfectly reachable, you just cannot stand in a
    // walkable-sized disc while you open it. `lib/clearance.ts`'s own `reach` rule has
    // carried this guard from the start and this did not, which is a disagreement
    // nobody could see while the term was only a tiebreak over four finalists: every
    // seeded T and L room scored 240 units of `navigation` for a piece the room report
    // was quite right to say nothing about.
    if (anyWalkable && !anyReachable) cost += STRANDED_PIECE;
  }
  return cost;
}

/** How much of one access zone is taken, 0..1 of the zone's own area. Sums over
 *  every piece standing in it plus whatever falls outside the room, and saturates
 *  at 1 so a zone with three things in it is "blocked", not "three times
 *  blocked". */
function zoneBlocked(
  m: LayoutModel,
  feet: Foot[],
  owner: number,
  zn: Foot,
  box: LocalZone,
  aboveY: number,
): number {
  let taken = 0;
  for (let j = 0; j < feet.length; j++) {
    if (j === owner) continue;
    if (!m.obstacle[j]) continue;
    if (m.top[j] <= aboveY) continue;
    if (far2(feet[j], zn, m.radius[j] + box.r)) continue;
    if (zoneExempt(m.roles[owner], m.roles[j])) continue;
    taken += footIntersectionArea(feet[j], zn) / box.area;
  }
  // A zone half outside the room is half unusable, which is the same problem as
  // half of it being full of furniture.
  taken += outsideShare(zn, m.poly);
  return Math.min(1, taken);
}

/** Are these two certainly further apart than `reach`? Squared throughout, so the
 *  hot rejects in this file cost four multiplications and no square root.
 *
 *  Conservative in the safe direction: `true` means their bounding circles do not
 *  come within `reach` of each other, which for `reach = rA + rB` means they cannot
 *  be touching. */
function far2(a: Foot, b: Foot, reach: number): boolean {
  const dx = b.cx - a.cx;
  const dz = b.cz - a.cz;
  return dx * dx + dz * dz > reach * reach;
}

/** How badly `i` discharges one relation against one candidate anchor `j`.
 *
 *  Distance in the band the relation asks for, plus — for the two kinds where the
 *  heading is half the point — being turned toward the anchor. `in-front` carries a
 *  facing term for the same reason `faces` does, and did not: a dining chair beside
 *  its table at the right gap and rotated 98° is not at the table, and nothing in the
 *  cost function said so. Measured yaws coming back from the solver on chairs before
 *  this: 8°, 15°, 98°, −113°, and one at 203° — facing away from its own table. */
function relationCost(
  feet: Foot[],
  placements: Placement[],
  i: number,
  j: number,
  rel: Relation,
): number {
  const d =
    rel.kind === 'faces' || rel.kind === 'near'
      ? Math.hypot(feet[j].cx - feet[i].cx, feet[j].cz - feet[i].cz)
      : obbGap(feet[i], feet[j]);
  let cost = bandCost(d, rel.min, rel.max);
  const toward = () => angleCost(placements[i].yaw, Math.atan2(feet[j].cx - feet[i].cx, feet[j].cz - feet[i].cz));
  if (rel.kind === 'faces') {
    // Turned toward it, not merely near it. A sofa with its back to the television
    // is at a perfect viewing distance and useless.
    cost += 2 * toward();
  } else if (rel.kind === 'in-front') {
    // Squarely in front, rather than round the side at the right gap…
    cost += 1.5 * offAxis(feet[j], feet[i]);
    // …and turned to it, which is what sitting AT a table means.
    cost += 1.5 * toward();
  }
  return cost;
}

/** Merrell's `t`: zero inside `[min, max]`, growing quadratically outside. In
 *  metres rather than the paper's normalised ratio, because a nightstand 300 mm
 *  from a bed and a sofa 300 mm from a wall are the same error to a person and the
 *  ratio form would call the first one four times worse. */
function bandCost(d: number, min: number, max: number): number {
  if (d < min) return (min - d) * (min - d);
  if (d > max) return (d - max) * (d - max);
  return 0;
}

/** How far `other` sits off the axis running out of `self`'s front, as a share of
 *  its own half-width. 0 when it is squarely in front, 1 when it has slid entirely
 *  past the corner. */
function offAxis(other: Foot, self: Foot): number {
  const [fx, fz] = frontVector(self.rot);
  const dx = other.cx - self.cx;
  const dz = other.cz - self.cz;
  // Component across the front direction, i.e. along the face.
  const across = Math.abs(dx * fz - dz * fx);
  const span = self.hw + Math.max(other.hw, other.hd);
  return Math.min(1, Math.max(0, (across - self.hw * 0.5) / (span || 1)));
}

/** How far the footprint reaches along a direction — the half-extent that has to
 *  be subtracted to turn a centre distance into a back-of-the-piece distance. */
function halfDepthToward(f: Foot, nx: number, nz: number): number {
  const c = Math.cos(f.rot);
  const s = Math.sin(f.rot);
  return Math.abs(c * nx - s * nz) * f.hw + Math.abs(s * nx + c * nz) * f.hd;
}

/** Smallest turn between two headings, normalised to 0..1 over a half turn. */
function angleCost(a: number, b: number): number {
  return Math.abs(angleDelta(a, b)) / Math.PI;
}

/** …and the same, but satisfied by any quarter turn. `(1 − cos 4Δθ)/2` — Merrell's
 *  alignment term, which is exactly this shape and needs no branches. */
function quarterTurnCost(a: number, b: number): number {
  return (1 - Math.cos(4 * (a - b))) / 2;
}

/** Signed smallest turn from `b` to `a`, in (−π, π]. */
export function angleDelta(a: number, b: number): number {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

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
import { wallAffinity } from './physics';
import {
  buildClearanceField,
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
  footAt,
  isObstacle,
  relationFor,
  roleOf,
  roomProfile,
  routeWidth,
  sharesFloor,
  zoneExempt,
  type AccessRule,
  type Relation,
  type Role,
  type RoomProfile,
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

/** Turned up when the room or a piece has been resized and the job is to repair
 *  the arrangement rather than reinvent it: everything that was still fine stays
 *  where it is, and only what the change broke gets moved. */
export const REFIT_INERTIA = 14;

export type LayoutContext = {
  parts: ScenePart[];
  /** Index-aligned with `parts`; entries the solver may not move are still
   *  scored, because a locked piece is still in the way. */
  movable: boolean[];
  footprint: Footprint;
  /** Where each piece started. Present so the inertia term has something to
   *  measure against; when absent that term is simply off. */
  origin?: Placement[];
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
  /** The pairs that actually have a functional relation, resolved once. The table
   *  is scanned for every ordered pair otherwise, which for thirty pieces is 870
   *  lookups against eleven specs per evaluation. */
  relations: Array<{ i: number; j: number; rel: Relation }>;
  /** …and the same pairs as an unordered membership test, `i * n + j` both ways.
   *  The circulation term needs it: the gap between a sofa and its own coffee table
   *  is what the relation asks for, not a route someone walks down, and costing it
   *  as a pinch had the solver pulling apart the arrangement the relation had just
   *  paid to build. `lib/clearance.ts` skips the same pairs for the same reason. */
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

  const relations: LayoutModel['relations'] = [];
  const related = new Set<number>();
  for (let i = 0; i < parts.length; i++) {
    for (let j = 0; j < parts.length; j++) {
      if (i === j) continue;
      const rel = relationFor(parts[i], parts[j]);
      if (!rel) continue;
      relations.push({ i, j, rel });
      related.add(i * parts.length + j);
      related.add(j * parts.length + i);
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
    relations,
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

export function costBreakdown(
  m: LayoutModel,
  placements: Placement[],
  weights: ScoreWeights = DEFAULT_WEIGHTS,
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
  for (let i = 0; i < feet.length; i++) {
    if (!obstacle[i]) continue;
    for (let j = i + 1; j < feet.length; j++) {
      if (!obstacle[j]) continue;
      // Pieces that belong together are exempt — see `related`.
      if (m.related.has(i * feet.length + j)) continue;
      // `boxGap` never overstates how close they are, so anything it puts beyond a
      // route's width cannot be a pinch and never needs the exact corner-to-corner
      // answer. This one reject is worth a third of an evaluation.
      if (boxGap(i, j) >= m.route) continue;
      const gap = obbGap(feet[i], feet[j]);
      // A pinch is a gap someone would try to walk through and could not. Flush is
      // deliberate composition, and the cost has to go back to zero there or the
      // solver will pull everything apart to escape a penalty it cannot.
      if (gap > 0.12 && gap < m.route) c.walkway += m.route - gap;
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
    const affinity = wallAffinity(p.category);

    if (edge) {
      // Distance from the piece's BACK to the wall, not from its centre: a deep
      // wardrobe and a shallow shelf are both against the wall at very different
      // centre distances, and using the centre asks the wardrobe to bury itself.
      const back = edge.dist - halfDepthToward(f, edge.nx, edge.nz);
      if (affinity === 'must-wall' || affinity === 'prefers-wall') {
        c.wall += Math.max(0, back);
        // …and facing INTO the room, which is the other half of being against a
        // wall. A wardrobe with its doors in the plaster is flush and useless.
        c.alignment += angleCost(placements[i].yaw, edge.yaw);
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
  for (const { i, j, rel } of m.relations) {
    let d: number;
    if (rel.kind === 'faces' || rel.kind === 'near') {
      d = Math.hypot(feet[j].cx - feet[i].cx, feet[j].cz - feet[i].cz);
    } else {
      d = obbGap(feet[i], feet[j]);
    }
    let cost = bandCost(d, rel.min, rel.max);
    if (rel.kind === 'faces') {
      // Turned toward it, not merely near it. A sofa with its back to the
      // television is at a perfect viewing distance and useless.
      cost += 2 * angleCost(placements[i].yaw, Math.atan2(feet[j].cx - feet[i].cx, feet[j].cz - feet[i].cz));
    } else if (rel.kind === 'in-front') {
      // …and actually in front, rather than round the side at the right gap.
      cost += 1.5 * offAxis(feet[j], feet[i]);
    }
    c.relation += rel.weight * cost;
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
      c.inertia += d + 0.4 * Math.abs(angleDelta(placements[i].yaw, origin[i].yaw));
    }
  }

  // Spelled out rather than looped over `Object.keys(weights)`, which allocated a
  // twelve-string array on every evaluation.
  c.overlap *= weights.overlap;
  c.outside *= weights.outside;
  c.door *= weights.door;
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
export function navigabilityCost(m: LayoutModel, placements: Placement[]): number {
  if (m.doors.length === 0) return 0;
  const parts = m.ctx.parts;
  const solid: number[] = [];
  for (let i = 0; i < parts.length; i++) if (m.obstacle[i]) solid.push(i);
  const feet = solid.map((i) => footAt(parts[i], placements[i].x, placements[i].z, placements[i].yaw));
  const field = buildClearanceField(feet, m.poly);
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
    for (const zn of zones) {
      for (const id of componentsAround(field, zn.foot, 0)) {
        if (reachable.has(id)) {
          anyReachable = true;
          break;
        }
      }
      if (anyReachable) break;
    }
    if (!anyReachable) cost += 2;
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

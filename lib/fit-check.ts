// Will this actually fit?
//
// The question that turns a sandbox into something you can act on, and the one
// PRODUCT.md's "confidence to commit" needs answered. Someone is looking at a sofa on
// a shop page. It says 2280 × 950 × 830. Their room already has furniture in it. The
// honest answer is not "the floor is 24 m² and the sofa is 2.2 m²" — it is whether
// there is somewhere it can go that leaves the doors opening, the walkways walkable
// and the seats reachable.
//
// Which is a question this codebase can already answer, so this module computes
// almost nothing itself. It asks the arrangement solver to find the piece a home with
// every existing piece LOCKED, then asks the room report what it thinks of the result.
// Two properties come free from doing it that way rather than writing a bespoke
// search: the spot it suggests is one the report will agree is fine (which
// `tests/layout-conformance.test.ts` now pins), and a "no" is a no by the same rules
// the rest of the app judges a room by.
//
// **Nothing here is clamped.** `clampDims` is the gate on sizes the app STORES, and
// it belongs on the path that adds a piece to the scene — not on the path that
// answers a question about a real product. A user who types the 2700 mm wardrobe off
// a spec sheet and gets told about a 2600 mm one has been silently lied to, which is
// the corollary CLAUDE.md spells out: when something does not fit, say so. So the
// check answers about the size it was given, and reports separately when that size is
// outside the range the studio could represent.

import { analyzeRoom, type ClearanceIssue } from './clearance';
import { dimRangeFor } from './dimension-ranges';
import { footprintBounds, type Footprint } from './footprint';
import { footFromPart, footInsidePoly, footIntersectionArea, type Foot } from './geometry';
import { baySides, roomBays } from './room-bays';
import { roleOf, sharesFloor } from './layout-rules';
import { verticalExtent } from './physics';
import { solveLayout } from './layout-solve';
import { settleParts } from './layout-settle';
import type { Placement } from './layout-score';
import type { Category, ScenePart, Shape } from './scene-spec';

/** The id the probe piece carries while it is being tried. Distinctive so a finding
 *  about it can be recognised, and so it can never collide with a real part. */
export const PROBE_ID = '__fit-probe__';

export type FitCandidate = {
  category: Category;
  shape: Shape;
  /** [W, D, H] in millimetres, exactly as the user entered them. */
  dimMM: [number, number, number];
  name?: string;
};

export type FitStatus =
  /** Somewhere for it, and the room report is happy. */
  | 'fits'
  /** Somewhere for it, but something is tighter than the guidelines want. */
  | 'tight'
  /** Nowhere that does not block or clash with what is already there. */
  | 'no-room'
  /** Taller than the ceiling. Nothing about the floor can help. */
  | 'too-tall';

export type FitResult = {
  status: FitStatus;
  /** Where it would go. Absent for `too-tall`, and for `no-room` when the solver
   *  could not even seat it inside the room. */
  placement?: Placement;
  /** What the room report says about the piece once it is there — the reasons, in the
   *  app's own words, already written for a person to read. */
  issues: ClearanceIssue[];
  /** Ceiling minus the piece's height, mm. Negative is the amount it is over by. */
  headroomMM: number;
  /** The largest clear rectangle of floor the room has, for saying what it DOES have
   *  when the answer is no. Metres. */
  largestBay: { width: number; depth: number } | null;
  /** Set when the entered size is outside the range the studio can represent, so the
   *  UI can say that adding it will bring the size inside that range. */
  outOfRange: boolean;
};

/** Anneal steps per attempt. `solveLayout`'s own default is 1600, tuned for
 *  rearranging a whole room; here exactly one piece moves and everything else is
 *  locked, so the search space is one `(x, z, yaw)` and it converges far sooner.
 *  Measured on a ten-piece room: 187 ms at 1600 steps against 29 ms at 300, with the
 *  same answers. This is the difference between a button and a frozen tab. */
const STEPS = 400;

/** Attempts, hard-capped. Each is a solve, so this is the cost ceiling: the whole
 *  check has to stay inside a button press. */
const MAX_ATTEMPTS = 8;

/** How many of those attempts get a room report. `analyzeRoom` rasterises the floor at
 *  5 cm, so it is the expensive half; the cheapest few placements are the only ones
 *  worth asking about. */
const MAX_EXPLAIN = 4;

/** The attempts to make, in order — the first one is the fast path, so it is the most
 *  likely to be right on its own.
 *
 *  The STARTING POINT matters more than the RNG seed. The solver's inertia term charges
 *  for movement, so every run from one origin explores the same neighbourhood: four
 *  seeds from one start is one attempt, not four. Seeding a dining chair at the centre
 *  of the largest bay, in a room whose table sits in that centre, starts it inside its
 *  own anchor — and every seed agreed on burying it there, so the answer came back "no
 *  room" for a chair in a room with a table in it.
 *
 *  So the starts are spread over the floor the room actually has: each bay's centre
 *  first, then a point in from each side of the largest bay. All are inside the polygon
 *  by construction, because `room-bays` only returns rectangles of real floor. */
function plan(
  room: { footprint: Footprint },
  dimMM: [number, number, number],
): Array<{ start: { x: number; z: number }; seed: number }> {
  const bays = roomBays(room.footprint, { max: 3 });
  const starts = bays.length === 0 ? [centreOf(room.footprint)] : bays.map((b) => ({ x: b.cx, z: b.cz }));
  if (bays.length > 0) {
    // Half the piece's largest side, so a start off a side does not begin outside.
    const inset = Math.max(dimMM[0], dimMM[1]) / 2000;
    for (const side of baySides(bays[0], room.footprint)) {
      starts.push({ x: side.mx + side.nx * inset, z: side.mz + side.nz * inset });
    }
  }
  // One seed per start, then a second pass over the first few if there is budget left.
  const out = starts.map((start) => ({ start, seed: 1 }));
  for (const start of starts) {
    if (out.length >= MAX_ATTEMPTS) break;
    out.push({ start, seed: 2 });
  }
  return out.slice(0, MAX_ATTEMPTS);
}

/**
 * Try to seat `candidate` in the room without moving anything already in it.
 *
 * `parts` must be the room as it stands — resolved through `lib/transforms.ts`, not
 * the authored scene, or the answer describes a room the user is not looking at.
 */
export function checkFit(
  candidate: FitCandidate,
  parts: ScenePart[],
  room: { footprint: Footprint; height: number },
): FitResult {
  const heightM = candidate.dimMM[2] / 1000;
  const headroomMM = Math.round((room.height - heightM) * 1000);
  const range = dimRangeFor(candidate.category, candidate.shape);
  const outOfRange = candidate.dimMM.some((v, i) => v < range.min[i] || v > range.max[i]);
  const bays = roomBays(room.footprint, { max: 1 });
  const largestBay = bays.length > 0 ? { width: bays[0].width, depth: bays[0].depth } : null;

  // Height first, and on its own. A piece that does not go under the ceiling cannot be
  // helped by any arrangement, and saying "no room" about it would point at the wrong
  // problem — the fix is a shorter piece or a taller room, not a tidier floor.
  if (heightM > room.height) {
    return { status: 'too-tall', issues: [], headroomMM, largestBay, outOfRange };
  }

  const probe = probePart(candidate, room);
  const withProbe = [...parts, probe];
  // Everything that is already in the room stays put. That is the whole premise: the
  // user is asking whether this piece fits their room, not whether their room could be
  // rearranged around it. (`Fix` and `Shuffle` are the other question, and they exist.)
  const locked = withProbe.map((p) => p.id !== PROBE_ID);

  // Everything already in the room is frozen for the settle as well as locked for the
  // solve, so the only piece it may nudge is the one being asked about.
  const frozen = new Set(parts.map((p) => p.id));

  // Candidate placements that survived the gates, with the solver's own cost for each.
  // Ranking on that rather than on a room report per attempt is both cheaper and more
  // consistent: the solver picks, and the report is asked once, to explain.
  const seated: Array<{ placement: Placement; part: ScenePart; cost: number }> = [];

  const attempts = plan(room, candidate.dimMM);
  for (let a = 0; a < attempts.length; a++) {
    const { start, seed } = attempts[a];
    {
      withProbe[withProbe.length - 1] = { ...probe, pos: [start.x, probe.pos[1], start.z] };
      const solved = solveLayout(withProbe, room.footprint, locked, { seed, steps: STEPS });
      const placement = solved.placements[withProbe.length - 1];
      const posed = {
        ...probe,
        pos: [placement.x, probe.pos[1], placement.z] as [number, number, number],
        rot: placement.yaw,
      };

      // Then settle, which is how both scene paths end and was the missing step here.
      // `solveLayout` optimises a cost; it does not guarantee containment, and with one
      // piece in an empty room and nothing else to trade against it happily parked a
      // 2.28 m sofa 73 mm through the wall.
      const settledPart = settleParts([...parts, posed], room.footprint, { frozen }).at(-1)!;

      // Inside the room is then checked HERE rather than read off the room report,
      // because the report has no finding for a piece that is outside — containment is
      // a `layout-score` cost (`outside`) with no checker counterpart, one of the
      // asymmetries `RULE_HANDLING` exists to make visible. Leaving it out is not a
      // technicality: with nothing else to say about a sofa half through the wall of a
      // room too small for it, the answer came back "fits".
      //
      // `footInsidePoly`, not `outsideShare` — the latter samples, and its samples sit
      // 10% in from the edges, so it forgives a piece 20 mm through the plaster.
      const foot = footFromPart(settledPart.pos, settledPart.rot, settledPart.dimMM, settledPart.circle);
      if (!footInsidePoly(foot, room.footprint)) continue;

      // …and it must not be INSIDE anything, which is also not something to read off the
      // room report. That report's clash rule is a SHARE of the smaller footprint,
      // deliberately generous so a dining chair tucked under its table is not called a
      // collision — the right bar for a panel whose job is to avoid crying wolf. This
      // feature has the opposite error budget: a false alarm costs a shrug, a false
      // "yes, it fits" costs someone a sofa. So a piece that shares the floor with the
      // candidate may not overlap it at all, and `sharesFloor` is the existing rule for
      // which pairs those are — the same one `layout-settle` separates by.
      if (overlapsSomething(foot, settledPart, parts)) continue;

      const placed: Placement = { x: settledPart.pos[0], z: settledPart.pos[2], yaw: settledPart.rot };
      seated.push({ placement: placed, part: settledPart, cost: solved.after });

      // Fast path for the overwhelmingly common question — "obviously yes". The first
      // attempt starts at the largest bay's centre, which for a room with space in it
      // is already the answer, so asking the report once here settles most presses in
      // one solve instead of all of them.
      if (a === 0) {
        const issues = explain(settledPart, parts, room);
        if (issues.length === 0) {
          return { status: 'fits', placement: placed, issues, headroomMM, largestBay, outOfRange };
        }
      }
    }
  }

  // Nothing was seated inside the room at all.
  if (seated.length === 0) return { status: 'no-room', issues: [], headroomMM, largestBay, outOfRange };

  // Cost sorts the candidates; the ROOM REPORT decides between them. Those are not the
  // same ranking and cannot be swapped, which cost me a regression worth recording: for
  // a pair `sharesFloor` exempts — a dining chair and its table — the solver's cheapest
  // answer is the chair at the table's dead centre, because the relation distance is
  // zero there and the overlap it exempts costs nothing. The report calls that same
  // placement a clash. Ranking on cost alone therefore answered "no room" for a chair
  // in a room containing a table, while ranking on findings had always got it right.
  //
  // So: cheapest first, then explain them in that order and take the first the report
  // is happy with. Bounded, because `analyzeRoom` rasterises the floor and the whole
  // check has to stay inside a button press.
  const ordered = [...seated].sort((a, b) => a.cost - b.cost);
  let best: { placement: Placement; issues: ClearanceIssue[] } | null = null;
  for (const candidateSeat of ordered.slice(0, MAX_EXPLAIN)) {
    const issues = explain(candidateSeat.part, parts, room);
    if (issues.length === 0) {
      return { status: 'fits', placement: candidateSeat.placement, issues, headroomMM, largestBay, outOfRange };
    }
    if (!best || rank(issues) < rank(best.issues)) best = { placement: candidateSeat.placement, issues };
  }

  // An error means the piece is in something, or across a door — a genuine no. A warn
  // means it goes in but something is tighter than the guidelines like, which is a
  // decision for the user rather than a refusal.
  const status: FitStatus = best!.issues.some((i) => i.severity === 'error') ? 'no-room' : 'tight';
  return { status, placement: best!.placement, issues: best!.issues, headroomMM, largestBay, outOfRange };
}

/** How bad a set of findings is, for choosing between placements the report has
 *  actually looked at. Errors dominate; ties break on count, so the placement that
 *  upsets the fewest rules wins. */
function rank(issues: ClearanceIssue[]): number {
  let score = 0;
  for (const i of issues) score += i.severity === 'error' ? 1000 : i.severity === 'warn' ? 10 : 1;
  return score + issues.length;
}

/** What the room report says about the candidate once it is seated there. */
function explain(
  seated: ScenePart,
  parts: ScenePart[],
  room: { footprint: Footprint; height: number },
): ClearanceIssue[] {
  return analyzeRoom([...parts, seated], room).issues.filter((i) => i.partIds.includes(PROBE_ID));
}

/** Flush contact is fine and exact arithmetic still leaves crumbs, so ignore anything
 *  under a square centimetre. Anything a person would call "in the bed" is orders of
 *  magnitude above this. */
const TOUCH_AREA_M2 = 1e-4;

/** Does the seated candidate share floor with, and overlap, anything already there? */
function overlapsSomething(foot: Foot, seated: ScenePart, parts: ScenePart[]): boolean {
  const mine = roleOf(seated);
  for (const other of parts) {
    if (other.wallMounted) continue;
    // Vertical clearance: a monitor over a desk is a stack, not a clash — the same
    // test the room report makes before comparing two footprints at all, and now
    // literally the same arithmetic. `seated` is the CANDIDATE, which is the half that
    // was reachable: a mounted piece can be the thing being fit-checked even though
    // `other.wallMounted` skips mounted obstacles, and its `pos[1]` is a centre.
    const [myBottom, myTop] = verticalExtent(seated.category, seated.shape, seated.dimMM, seated.pos[1]);
    const [itsBottom, itsTop] = verticalExtent(other.category, other.shape, other.dimMM, other.pos[1]);
    if (myTop <= itsBottom + 0.005 || itsTop <= myBottom + 0.005) continue;
    // Note the polarity: `sharesFloor` is TRUE for the pairs that legitimately occupy
    // the same square metre — a dining chair under its table, an ottoman under a coffee
    // table. Those are the ones to SKIP. Reading the name as "competes for the floor"
    // and testing `!sharesFloor` inverts the rule exactly, and quietly: it exempts a
    // sofa 31% inside a bed while flagging a correctly tucked chair.
    if (sharesFloor(mine, roleOf(other))) continue;
    const its = footFromPart(other.pos, other.rot, other.dimMM, other.circle);
    if (footIntersectionArea(foot, its) > TOUCH_AREA_M2) return true;
  }
  return false;
}

/** The candidate as a part the engine can reason about, seeded at the middle of the
 *  room's largest bay — a starting point inside the floor rather than at the origin,
 *  which for an L-shaped room can be outside the house. */
function probePart(candidate: FitCandidate, room: { footprint: Footprint; height: number }): ScenePart {
  const bays = roomBays(room.footprint, { max: 1 });
  const seed = bays.length > 0 ? { x: bays[0].cx, z: bays[0].cz } : centreOf(room.footprint);
  return {
    id: PROBE_ID,
    category: candidate.category,
    name: candidate.name ?? 'This piece',
    shape: candidate.shape,
    // Y at the floor: this asks about floor space, and `groundY` returns 0 for the
    // floor anchor, which is what `clearance.floorBlockers` requires to see it at all.
    pos: [seed.x, 0, seed.z],
    rot: 0,
    dimMM: candidate.dimMM,
    locked: false,
  };
}

function centreOf(poly: Footprint): { x: number; z: number } {
  const b = footprintBounds(poly);
  return { x: b.minX + b.width / 2, z: b.minZ + b.depth / 2 };
}

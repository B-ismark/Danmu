// Room ergonomics checker — deterministic interior-design rules evaluated
// against exact part geometry (lib/geometry). No AI involved: every finding is
// reproducible math over the scene, which is what makes it trustworthy enough
// to plan a real room around.
//
// Thresholds are NOT written here. Every "how much room does this piece need"
// number lives in `lib/layout-rules.ts`, as a zone in the piece's own frame, and
// this file reads that table — because the arrangement solver reads it too, and the
// two carrying separate copies is what let "Suggest" produce layouts that this
// panel immediately complained about. The remaining constants here are about how
// findings are WORDED and when they are worth raising, which is this file's job.
//
// Two of the rules here exist because the geometry engine deliberately does not
// "fix" a problem silently: parts can overlap (nothing resolves part-vs-part at
// build time) and a part can be taller than the room (shrinking it to fit would be
// a dimension lie). Both used to produce no finding at all, so the panel said
// "Everything fits" over an arrangement that plainly did not.

import type { ScenePart, Category } from './scene-spec';
import type { Footprint } from './footprint';
import {
  faceClearance,
  footArea,
  footFromPart,
  footIntersectionArea,
  type Foot,
  type Poly,
} from './geometry';
import {
  buildClearanceField,
  componentAreas,
  componentsAround,
  componentsNear,
  freeShareOf,
  gapTolerance,
  largestFreeCircle,
  pairGaps,
  rasterizeCoverage,
  TURNING_DIAMETER,
  type ClearanceField,
} from './clearance-field';
import {
  accessZones,
  doorPath,
  routeWidth,
  roleOf,
  sharesFloor,
  zoneExempt,
  WALK_MIN,
  type AccessRule,
} from './layout-rules';

export type ClearanceSeverity = 'error' | 'warn' | 'info';

export type ClearanceIssue = {
  id: string;
  severity: ClearanceSeverity;
  title: string;
  detail: string;
  /** parts involved — UI selects these on click */
  partIds: string[];
};

export type RoomReport = {
  issues: ClearanceIssue[];
  /** share of the floor polygon not covered by floor-standing furniture, 0..1 */
  freeFloorShare: number;
  /** The raster the circulation rules were read off, for the plan's heatmap.
   *  Null only when the footprint is degenerate. */
  field: ClearanceField | null;
};

export type AnalyzeOptions = {
  /** Report step-free turning space. Off by default — not every room needs to
   *  meet it, and everyone whose does needs it stated plainly rather than mixed
   *  into the ordinary findings. */
  accessibility?: boolean;
};

// Bulky pieces whose pairwise gaps form walkways people actually use.
const WALKWAY_CATEGORIES = new Set<Category>([
  'sofa', 'bed', 'wardrobe', 'shelf', 'fridge', 'desk',
]);

// DERIVED, not restated — `WALK_MIN` is `WALK_RADIUS × 2`, and `WALK_RADIUS` is
// documented as half the 600 mm walkway rule. Writing 0.6 here spelled the same
// number in three files with nothing tying them together: narrowing the radius
// would have left this rule still policing 600 mm, and the field, the report and
// the solver would disagree about what a walkway is while all three looked right.
const MIN_WALKWAY = WALK_MIN;

/** How much of a door's swing a piece has to take before it is worth saying.
 *  Small, because a door leaf stops on the first thing it meets — this is only here
 *  so a millimetre of floating-point contact is not a finding. */
const SWING_CLASH_SHARE = 0.02;

// ── Same-place rule thresholds ──────────────────────────────────────────────
// Which pieces genuinely share floor is `sharesFloor` in lib/layout-rules — the
// same predicate the solver's overlap term reads, so the two cannot disagree about
// whether a tucked-in chair is a collision. It used to be a pair of category sets
// here: seating pushed under a work surface shares that surface's footprint ON
// PURPOSE, and the chair back rises above the table top so no vertical test
// separates the two. Four chairs round a dining table is the most ordinary
// arrangement there is; reporting four errors on it would teach people to ignore
// this panel.

/** Share of the SMALLER piece's footprint that must lie inside the other before
 *  this is a collision rather than two pieces meeting untidily. Half of a piece
 *  buried in another is unambiguous; a few centimetres of clip is a nudge. */
const CLASH_SHARE = 0.5;

/** …and for a pair that legitimately shares floor, the bar instead of a blanket
 *  exemption. A chair pushed hard under a table reaches perhaps 60% of its own
 *  footprint; a chair standing where the table is reaches all of it, and that is
 *  still worth saying. */
const TUCKED_CLASH_SHARE = 0.85;

/** Issue-id prefix per zone rule, so a finding keeps the id the UI and the tests
 *  already know it by. Anything not listed keys off the rule's own id. */
const ZONE_ISSUE_ID: Record<string, string> = { front: 'front', bedside: 'bed' };

const ZONE_TITLE: Record<string, string> = {
  front: 'Doors can’t open',
  bedside: 'Bed hard to get into',
  seats: 'No room to pull the chairs out',
  seat: 'No room for the chair',
  'push-back': 'No room to push the chair back',
};

const FACE_OF: Record<string, '+x' | '-x' | '+z' | '-z'> = {
  front: '+z',
  back: '-z',
  left: '-x',
  right: '+x',
};

/** One finding's sentence.
 *
 *  A rule about a single face can say the actual measurement, which is what a
 *  person wants — "has 30 cm in front" beats "68% of the space in front is taken".
 *  A rule spread over several faces cannot: three sides at three distances is not a
 *  number, so it reports how many of them are clear instead. Both read the depth
 *  and the wording off the rule rather than restating them. */
function zoneDetail(
  part: ScenePart,
  rule: AccessRule,
  blocked: number,
  clear: number,
  self: Foot,
  others: Foot[],
  poly: Poly,
): string {
  const cm = Math.round(rule.depth * 100);
  if (rule.sides.length === 1) {
    const got = faceClearance(self, FACE_OF[rule.sides[0]], others, poly, rule.depth * 2);
    return `“${part.name}” has ${Math.round(got * 100)} cm ${rule.sides[0] === 'front' ? 'in front' : `on its ${rule.sides[0]}`} — needs ${cm} cm ${rule.reason}.`;
  }
  const need = rule.atLeast === rule.sides.length ? `all ${rule.sides.length}` : `${rule.atLeast} of its ${rule.sides.length}`;
  return `“${part.name}” wants ${cm} cm clear on ${need} sides ${rule.reason} — ${clear === 0 ? 'none of them is' : `only ${clear} ${clear === 1 ? 'is' : 'are'}`} (${blocked} blocked).`;
}

function clashShare(a: ScenePart, b: ScenePart): number {
  return sharesFloor(roleOf(a), roleOf(b)) ? TUCKED_CLASH_SHARE : CLASH_SHARE;
}

/** The pieces that actually get in a walker's way: floor-standing, solid, and
 *  tall enough to stop someone. Rugs and wall-hung items do not block a route,
 *  and a 20 cm-tall pouffe is a step-over rather than an obstacle.
 *
 *  Exported because the 2D plan draws the same circulation the report describes,
 *  and it has to be reading the same set of blockers — the plan used to inflate
 *  each bulky piece by half a walkway and call that the rule, with a comment
 *  admitting the thresholds were copied from this file and had to be kept in
 *  step. */
export function floorBlockers(parts: ScenePart[]): ScenePart[] {
  return parts.filter(
    (p) => !p.wallMounted && p.category !== 'rug' && p.pos[1] < 0.05 && p.dimMM[2] > 250,
  );
}

/** Which walkable regions someone can actually enter the room into.
 *
 *  Null when the room has no door: there is then no telling which side anybody
 *  arrives from, and every "you cannot get to this" claim would be a guess
 *  dressed as a measurement. Callers must treat null as "reachability unknown"
 *  and say nothing, not as "nothing is reachable". */
export function entranceComponents(field: ClearanceField, parts: ScenePart[]): Set<number> | null {
  const doors = parts.filter((p) => p.category === 'door');
  if (doors.length === 0) return null;
  const out = new Set<number>();
  // A door stands ON the wall, where by definition nobody can stand, so look
  // outward from it for the floor it opens onto.
  for (const d of doors) for (const id of componentsNear(field, d.pos[0], d.pos[2], 1.2)) out.add(id);
  return out.size > 0 ? out : null;
}

export function analyzeRoom(
  parts: ScenePart[],
  room: { footprint: Footprint; height: number },
  opts: AnalyzeOptions = {},
): RoomReport {
  const issues: ClearanceIssue[] = [];
  const poly = room.footprint as Poly;

  const solid = floorBlockers(parts);
  const obbs = new Map<string, Foot>();
  for (const p of solid) obbs.set(p.id, footFromPart(p.pos, p.rot, p.dimMM, p.circle));

  // One raster, read by rules 3, 8, 9 and 10. Its cell index IS the index into
  // `solid`, so a finding can name the pieces it is about.
  const solidObbs = solid.map((p) => obbs.get(p.id)!);
  const field = buildClearanceField(solidObbs, poly);

  // ── 1. Door swing blocked, and the way in from it ────────────────────────
  //
  // The swing is the zone `lib/layout-rules` gives a door — a box the width of the
  // leaf and as deep as the leaf is wide, in front of it. It used to be a radius
  // measured from the door's centre POINT, which got both edges wrong: a wardrobe
  // 500 mm to one side of a 900 mm door counted as blocking it, and one standing
  // squarely in front at 950 mm did not.
  const route = routeWidth(room.footprint);
  for (const door of parts.filter((p) => p.category === 'door')) {
    const zones = accessZones(door, door.pos[0], door.pos[2], door.rot);
    const swing = zones[0];
    if (swing) {
      const blockers = solid.filter(
        (p) =>
          p.id !== door.id &&
          !zoneExempt('door', roleOf(p)) &&
          footIntersectionArea(obbs.get(p.id)!, swing.foot) / Math.min(footArea(obbs.get(p.id)!), footArea(swing.foot)) >
            SWING_CLASH_SHARE,
      );
      if (blockers.length > 0) {
        issues.push({
          id: `door-${door.id}`,
          severity: 'error',
          title: 'Door can’t open fully',
          detail: `${blockers.map((b) => b.name).join(', ')} ${blockers.length === 1 ? 'sits' : 'sit'} inside the ${Math.round(swing.rule.depth * 100)} cm swing of “${door.name}”.`,
          partIds: [door.id, ...blockers.map((b) => b.id)],
        });
      }
    }
    // Opening is not the same question as getting in. A door with a clear swing
    // that puts you straight into the back of a sofa is still a door you cannot
    // walk through, and no pairwise gap rule sees it.
    const path = doorPath(door, route);
    const inTheWay = solid.filter(
      (p) =>
        p.id !== door.id &&
        !zoneExempt('door', roleOf(p)) &&
        footIntersectionArea(obbs.get(p.id)!, path) / footArea(path) > 0.12,
    );
    if (inTheWay.length > 0) {
      issues.push({
        id: `entry-${door.id}`,
        severity: 'warn',
        title: 'The way in is blocked',
        detail: `${inTheWay.map((b) => b.name).join(', ')} ${inTheWay.length === 1 ? 'stands' : 'stand'} in the ${Math.round(route * 100)} cm route in from “${door.name}”.`,
        partIds: [door.id, ...inTheWay.map((b) => b.id)],
      });
    }
  }

  // ── 2. Two pieces in the same place ──────────────────────────────────────
  // obbGap returns 0 both for furniture pushed flush together (deliberate) and
  // for furniture occupying the same floor (a mistake), and the walkway rule
  // below skips everything at or under 12 cm as "touching". So interpenetrating
  // parts used to produce no finding at all, and the panel said "Everything
  // fits". buildSceneFromRoom does no part-vs-part resolution, so a detected
  // scene can genuinely arrive like this.
  //
  // "Overlap at all" is the wrong test, though — see TUCKS_UNDER and
  // CLASH_SHARE above. This wants the pieces that are IN each other, not the
  // ones that merely meet.
  for (let i = 0; i < solid.length; i++) {
    for (let j = i + 1; j < solid.length; j++) {
      const a = solid[i];
      const b = solid[j];
      // Only when they also share vertical space — a monitor over a desk is a
      // stack, not a clash. (`solid` is already floor-level, but a part can sit
      // just under 0.05 m and still be short enough to pass under another.)
      const aTop = a.pos[1] + a.dimMM[2] / 1000;
      const bTop = b.pos[1] + b.dimMM[2] / 1000;
      if (aTop <= b.pos[1] + 0.005 || bTop <= a.pos[1] + 0.005) continue;
      const oa = obbs.get(a.id)!;
      const ob = obbs.get(b.id)!;
      const shared = footIntersectionArea(oa, ob);
      if (shared <= 0) continue;
      // Real areas, so a round table is measured as a circle rather than as the
      // square around it — the four phantom corners are precisely where a tucked
      // chair sits, so the square version reported the most ordinary dining
      // arrangement there is as a collision.
      const smaller = Math.min(footArea(oa), footArea(ob));
      if (smaller <= 0 || shared / smaller < clashShare(a, b)) continue;
      issues.push({
        id: `clash-${a.id}-${b.id}`,
        severity: 'error',
        title: 'Two pieces in the same place',
        detail: `“${a.name}” and “${b.name}” overlap on the floor — one of them has to move before this arrangement is real.`,
        partIds: [a.id, b.id],
      });
    }
  }

  // ── 3. Pinched walkways ──────────────────────────────────────────────────
  // Read off the field instead of comparing every bulky pair. Two cells whose
  // nearest obstacles differ sit on the medial axis between those obstacles, and
  // at the point of closest approach the disc that fits there has exactly half
  // the gap as its radius — so this returns the same number `obbGap` did, for
  // every pair at once and in one pass over the raster instead of n².
  //
  // The reading carries the raster's ±half-cell, so the band is narrowed by a
  // whole cell at each end: a finding is raised only when the entire uncertainty
  // range sits inside it. Touching (deliberate composition) and far apart are
  // both fine — the problem zone is a gap someone would try to squeeze through.
  //
  // Gaps against a WALL are deliberately not reported here. The field knows them
  // — the wall is just another owner — but "the sofa is 40 cm from the wall" is
  // usually a description of the room rather than a fault, and saying it every
  // time would teach people to close this panel. A wall gap that genuinely
  // matters is one that pinches the only route through, and that is what rule 9
  // reports, in the terms that actually make it a problem.
  if (field) {
    const band = gapTolerance(field);
    for (const [key, gap] of pairGaps(field)) {
      const [ai, bi] = key.split(':').map(Number);
      if (ai < 0 || bi < 0) continue; // one side is the wall — see rule 9
      const a = solid[ai];
      const b = solid[bi];
      if (!a || !b) continue;
      if (!WALKWAY_CATEGORIES.has(a.category) && !WALKWAY_CATEGORIES.has(b.category)) continue;
      if (gap - band <= 0.12 || gap + band >= MIN_WALKWAY) continue;
      issues.push({
        id: `walk-${a.id}-${b.id}`,
        severity: 'warn',
        title: 'Tight walkway',
        detail: `Only ${Math.round(gap * 100)} cm between “${a.name}” and “${b.name}” — comfortable passage needs ${MIN_WALKWAY * 100} cm.`,
        partIds: [a.id, b.id],
      });
    }
  }

  // ── 4. Functional zones: what each piece needs clear ─────────────────────
  //
  // One pass over `lib/layout-rules`, where there used to be a rule for wardrobe
  // fronts, a rule for bed sides, and nothing at all for a desk, a dining table or
  // a sofa. The table also carries the number, the wording and — through
  // `atLeast` — how many of a rule's sides actually have to hold, which is what
  // lets a double bed want both sides and a dining table want three of four.
  for (const p of solid) {
    const zones = accessZones(p, p.pos[0], p.pos[2], p.rot);
    if (zones.length === 0) continue;
    const others = solid
      .filter((o) => o.id !== p.id && !zoneExempt(roleOf(p), roleOf(o)))
      .map((o) => obbs.get(o.id)!);
    const me = obbs.get(p.id)!;
    const byRule = new Map<string, { rule: AccessRule; blocked: string[]; clear: string[] }>();
    for (const zn of zones) {
      const entry = byRule.get(zn.rule.id) ?? { rule: zn.rule, blocked: [], clear: [] };
      // The narrowest point across the face, not the average of it. A chair against
      // the left third of a 2 m wardrobe takes under a fifth of the zone's AREA and
      // stops the door dead, so a share-of-area test reports nothing — which is the
      // bug `faceClearance` was written to fix, and the reason the report reads the
      // worst probe while the solver's cost reads the total. Same zone, same depth;
      // the solver wants a gradient and the report wants the truth about the
      // tightest point.
      const got = faceClearance(me, FACE_OF[zn.side], others, poly, zn.rule.depth * 2);
      if (got < zn.rule.depth) entry.blocked.push(zn.side);
      else entry.clear.push(zn.side);
      byRule.set(zn.rule.id, entry);
    }
    for (const { rule, blocked, clear } of byRule.values()) {
      if (clear.length >= rule.atLeast) continue;
      issues.push({
        id: `${ZONE_ISSUE_ID[rule.id] ?? rule.id}-${p.id}`,
        severity: 'warn',
        title: ZONE_TITLE[rule.id] ?? 'Not enough room to use it',
        detail: zoneDetail(p, rule, blocked.length, clear.length, me, others, poly),
        partIds: [p.id],
      });
    }
  }

  // ── 5. Windows left visible ──────────────────────────────────────────────
  //
  // Not a clearance so much as a sightline, and height is the whole rule: a low
  // chest under a window is a windowsill, a wardrobe in front of one is a mistake.
  // The zone carries the sill it is measured from, so a high transom window and a
  // floor-to-ceiling one are judged differently without either being special-cased.
  for (const win of parts.filter((p) => roleOf(p) === 'window')) {
    for (const zn of accessZones(win, win.pos[0], win.pos[2], win.rot)) {
      const blockers = solid.filter((p) => {
        if (zoneExempt('window', roleOf(p))) return false;
        if (p.pos[1] + p.dimMM[2] / 1000 <= zn.rule.aboveY + 0.05) return false;
        const f = obbs.get(p.id)!;
        return footIntersectionArea(f, zn.foot) / (footArea(zn.foot) || 1) > 0.15;
      });
      if (blockers.length === 0) continue;
      issues.push({
        id: `window-${win.id}`,
        severity: 'warn',
        title: 'Window is blocked',
        detail: `${blockers.map((b) => b.name).join(', ')} ${blockers.length === 1 ? 'stands' : 'stand'} in front of “${win.name}” and ${blockers.length === 1 ? 'rises' : 'rise'} above its ${Math.round(zn.rule.aboveY * 100)} cm sill.`,
        partIds: [win.id, ...blockers.map((b) => b.id)],
      });
    }
  }

  // ── 6. TV viewing distance ───────────────────────────────────────────────
  const seats = parts.filter((p) => p.category === 'sofa' || p.shape === 'chair-armchair');
  for (const tv of parts.filter((p) => p.category === 'tv' && p.shape === 'tv')) {
    if (seats.length === 0) continue;
    const diag = Math.hypot(tv.dimMM[0], tv.dimMM[2]) / 1000;
    let nearest: ScenePart | null = null;
    let nd = Infinity;
    for (const s of seats) {
      const d = Math.hypot(s.pos[0] - tv.pos[0], s.pos[2] - tv.pos[2]);
      if (d < nd) {
        nd = d;
        nearest = s;
      }
    }
    if (!nearest) continue;
    if (nd < diag * 1.0) {
      issues.push({
        id: `tv-${tv.id}`,
        severity: 'warn',
        title: 'Sitting too close to the TV',
        detail: `“${nearest.name}” is ${nd.toFixed(1)} m from the ${Math.round((diag / 0.0254) * 10) / 10}″-class screen — comfortable viewing starts around ${(diag * 1.2).toFixed(1)} m.`,
        partIds: [tv.id, nearest.id],
      });
    } else if (nd > diag * 3.2) {
      issues.push({
        id: `tv-${tv.id}`,
        severity: 'info',
        title: 'TV may feel small from the seat',
        detail: `“${nearest.name}” sits ${nd.toFixed(1)} m away — ideal range for this screen is ${(diag * 1.2).toFixed(1)}–${(diag * 2.5).toFixed(1)} m.`,
        partIds: [tv.id, nearest.id],
      });
    }
  }

  // ── 7. Taller than the room ──────────────────────────────────────────────
  // The scene builder deliberately does NOT shrink a piece to fit — clamping the
  // dimension would be the one thing this codebase refuses to do, and a 2.6 m
  // wardrobe genuinely does not go under a 2.4 m ceiling. So it keeps its real
  // height, sits on the floor, and passes through the ceiling in the 3D view with
  // nothing said about it. Say it here, where the room's problems are reported.
  for (const p of parts) {
    if (p.wallMounted) continue;
    const h = p.dimMM[2] / 1000;
    if (h <= room.height) continue;
    issues.push({
      id: `tall-${p.id}`,
      severity: 'error',
      title: 'Taller than the room',
      detail: `“${p.name}” is ${Math.round(h * 100)} cm tall and the ceiling is ${Math.round(room.height * 100)} cm — it will not stand up in here. Danmu keeps the real size rather than shrinking it for you.`,
      partIds: [p.id],
    });
  }

  // ── 8. Free floor share ──────────────────────────────────────────────────
  // A by-product of the raster now, rather than its own pass over the room.
  const freeFloorShare = field ? freeShareOf(field) : freeFloorFraction(solidObbs, poly);
  if (freeFloorShare < 0.4) {
    issues.push({
      id: 'crowding',
      severity: 'warn',
      title: 'Room is getting crowded',
      detail: `Furniture covers ${Math.round((1 - freeFloorShare) * 100)}% of the floor — most rooms breathe best under 50%.`,
      partIds: [],
    });
  }

  // ── 9. Can you actually get there? ───────────────────────────────────────
  // The one question a pairwise rule cannot ask. Every individual gap in a room
  // can pass and the room still be split in two, because circulation is a
  // property of the whole floor rather than of any pair of pieces — and it is
  // where a wall pinch finally becomes a fault worth naming, rather than a
  // description of where the sofa sits.
  //
  // Gated hard, because a false "you cannot reach this" is worse than silence:
  // it needs a door to reason from (without one there is no telling which side
  // someone comes in), and it does nothing at all unless the walkable floor has
  // genuinely split into more than one piece.
  const entrance = field ? entranceComponents(field, parts) : null;
  if (field && field.componentCount > 1 && entrance) {
    const reachable = entrance;
    const stranded = solid.filter((p, i) => {
      const near = componentsAround(field, solidObbs[i]);
      // Nothing walkable anywhere near it is "wedged in", not "unreachable" — a
      // stool in a corner reads that way and is perfectly reachable.
      if (near.size === 0) return false;
      for (const id of near) if (reachable.has(id)) return false;
      return true;
    });
    if (stranded.length > 0) {
      issues.push({
        id: 'reach',
        severity: 'warn',
        title: 'You can’t walk to everything',
        detail: `${stranded.map((p) => `“${p.name}”`).join(', ')} ${stranded.length === 1 ? 'sits' : 'sit'} in part of the room that nothing connects to the door — every route in is under ${MIN_WALKWAY * 100} cm wide.`,
        partIds: stranded.map((p) => p.id),
      });
    }
    const cutOff = componentAreas(field).reduce((sum, a, id) => (reachable.has(id) ? sum : sum + a), 0);
    if (cutOff >= 1.5) {
      issues.push({
        id: 'cut-off',
        severity: 'info',
        title: 'Part of the floor is cut off',
        detail: `About ${cutOff.toFixed(1)} m² of floor has no route to the door wider than ${MIN_WALKWAY * 100} cm.`,
        partIds: [],
      });
    }
  }

  // ── 10. Step-free turning space ──────────────────────────────────────────
  // Opt-in: most people do not need this, and the ones who do need it said
  // plainly rather than blended into the ordinary findings.
  if (opts.accessibility && field) {
    const circle = largestFreeCircle(field, entrance ?? undefined);
    const diameter = circle ? circle.r * 2 : 0;
    // Only when even the optimistic reading falls short of the standard.
    if (diameter + field.cell < TURNING_DIAMETER) {
      issues.push({
        id: 'turning',
        severity: 'warn',
        title: 'No room to turn a wheelchair',
        detail: `The largest clear circle in this room is about ${Math.round(diameter * 100)} cm across. A wheelchair needs ${TURNING_DIAMETER * 100} cm to turn on the spot.`,
        partIds: [],
      });
    }
  }

  const order: Record<ClearanceSeverity, number> = { error: 0, warn: 1, info: 2 };
  issues.sort((a, b) => order[a.severity] - order[b.severity]);
  return { issues, freeFloorShare, field };
}


/** Fraction of the footprint NOT covered by any part, 0..1.
 *
 *  A union, not a sum. Summing each part's W x D triple-counted a chair pushed
 *  under a desk, ignored rotation entirely, and counted the whole of a part that
 *  hung outside the room after a wall drag - then clamped the result at 0, so a
 *  busy room confidently reported "100% of the floor covered".
 *
 *  The raster behind it lives in lib/clearance-field.ts now, because the
 *  circulation rules need exactly the same grid and rasterising the room twice
 *  per edit to answer two questions about one picture would be silly. Scanning
 *  each PART over its own bounding box rather than each CELL over every part is
 *  what made it cheap: the cell-major form cost `room area x part count` with
 *  Math.cos/Math.sin in the innermost loop, so a 40 m room (640 000 cells) with
 *  30 pieces meant 19 M point tests and ~38 M trig calls for one percentage.
 *
 *  Measured, identical results to the last bit:
 *
 *  | room                       | before  | after   |
 *  |----------------------------|---------|---------|
 *  | 5 x 5 m, 12 parts          | 7.9 ms  | 0.7 ms  |
 *  | 12 x 9 m open plan, 30     | 121 ms  | 2.5 ms  |
 *  | 40 x 40 m (MAX_ROOM), 30   | 1558 ms | 27.9 ms |
 *
 *  The last row is the one that mattered: analyzeRoom runs on every committed
 *  edit, so a large room paid a 1.5 s freeze per drag-release.
 *
 *  Kept as its own entry point because plenty of callers want the percentage and
 *  nothing else - building the distance transform for them would undo the win
 *  above. analyzeRoom, which needs the field anyway, reads the share off it. */
export function freeFloorFraction(parts: Foot[], poly: Poly): number {
  // Nothing to subtract - skip rasterising the room to divide it by itself.
  if (parts.length === 0) return 1;
  const raster = rasterizeCoverage(parts, poly);
  return raster ? freeShareOf(raster) : 1;
}



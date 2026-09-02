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

import type { ScenePart } from './scene-spec';
import { roomContainment, type Footprint } from './footprint';
import {
  faceClearance,
  footArea,
  footFromPart,
  footIntersectionArea,
  footOverlap,
  type Foot,
  type Poly,
} from './geometry';
import { verticalExtent } from './physics';
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
  belongTogether,
  doorPath,
  formsRoute,
  isObstacle,
  isMountedObstruction,
  isSoftFurnishing,
  routeWidth,
  roleOf,
  sharesFloor,
  zoneExempt,
  TUCKED_CLASH_SHARE,
  WALK_MIN,
  type AccessRule,
  type RuleKind,
} from './layout-rules';
import { dimRangeFor } from './dimension-ranges';

export type ClearanceSeverity = 'error' | 'warn' | 'info';

export type ClearanceIssue = {
  id: string;
  /** Which of `layout-rules`' rules this is, as a value rather than a prefix of
   *  `id`. The id is built for React keys and uniqueness; anything that needs to
   *  BRANCH on the kind of finding — the report deciding whether to offer a fix,
   *  `lib/layout-score.ts`'s `RULE_HANDLING` deciding what the solver can do about
   *  it — reads this instead of parsing that. */
  rule: RuleKind;
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

// Which pieces' pairwise gaps form walkways people actually use now lives in
// `lib/layout-rules.ts` as `formsRoute`, keyed on ROLE — see the import below.
//
// It was a `Set<Category>` here, and the solver had nothing equivalent: it charged
// every obstacle pair, so three dining chairs around their own table cost it
// `walkway 40.4` on a room this file reported nothing about, and "Suggest" flung the
// dining set across the floor to fix a fault nobody had raised. The set was right;
// being only this file's was the bug. Same lesson as `MIN_WALKWAY` below, one rule
// over.

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
// Which pieces genuinely share floor is `sharesFloor` in lib/layout-rules, and so
// is **how far into each other they may be** — `TUCKED_CLASH_SHARE`, imported
// above. It used to be a pair of category sets here: seating pushed under a work
// surface shares that surface's footprint ON PURPOSE, and the chair back rises
// above the table top so no vertical test separates the two. Four chairs round a
// dining table is the most ordinary arrangement there is; reporting four errors on
// it would teach people to ignore this panel.
//
// **This comment used to claim the solver and this file "cannot disagree about
// whether a tucked-in chair is a collision".** They shared the predicate and not
// the bar: `layout-score`'s overlap term exempted the pair outright, at any depth,
// while this file drew the line at 0.85. A shared predicate with a private
// threshold reads exactly like agreement and is not it — see the number's own doc
// in `lib/layout-rules.ts` for what that cost.

/** Share of the SMALLER piece's footprint that must lie inside the other before
 *  this is a collision rather than two pieces meeting untidily. Half of a piece
 *  buried in another is unambiguous; a few centimetres of clip is a nudge.
 *
 *  Stays local, unlike `TUCKED_CLASH_SHARE`: this one is about what is worth
 *  *telling the user*, and the solver deliberately charges every overlap of an
 *  ordinary pair however small, because a cost is a gradient and a report is a
 *  sentence. Those are different questions and a shared constant would assert they
 *  are the same one. */
const CLASH_SHARE = 0.5;

/** Issue-id prefix per zone rule, so a finding keeps the id the UI and the tests
 *  already know it by. Anything not listed keys off the rule's own id. */
const ZONE_ISSUE_ID: Record<string, string> = { front: 'front', bedside: 'bed' };

// There was a `ZONE_TITLE` table here, keyed on `AccessRule.id`, and it was wrong
// in a way nothing could catch: `'front'` is the id of SEVEN rules — a wardrobe's
// doors, a fridge's door, a bookshelf's spines, a shoe rack, an appliance, a sofa's
// seat and an armchair's — and this table gave all of them the wardrobe's headline.
// A sofa 4 cm off the wall was reported as **"Doors can't open"** over a sentence
// about standing up out of a sofa, which reads as the arithmetic being broken when
// in fact only the caption was. The id is a React key (see `AccessRule.id`); the
// headline is `AccessRule.title`, authored beside the depth and the reason it is
// about, where a second rule cannot silently inherit it.

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
 *  and the wording off the rule rather than restating them.
 *
 *  `narrowest` is the number the caller ALREADY measured to decide this was a
 *  finding at all, handed in rather than measured again. The second reading used
 *  the same arguments and so could not disagree — but only by luck, and a sentence
 *  that re-derives the fact it is reporting is one edit away from contradicting the
 *  test that raised it. */
function zoneDetail(
  part: ScenePart,
  rule: AccessRule,
  blocked: number,
  clear: number,
  narrowest: number,
): string {
  const cm = Math.round(rule.depth * 100);
  if (rule.sides.length === 1) {
    return `“${part.name}” has ${Math.round(narrowest * 100)} cm ${rule.sides[0] === 'front' ? 'in front' : `on its ${rule.sides[0]}`} — needs ${cm} cm ${rule.reason}.`;
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
          rule: 'door',
          severity: 'error',
          // The rule's own title, not a copy of it. A door is `wallMounted`, so it
          // never reaches the generic zone loop that reads `AccessRule.title` — which
          // left the rule's title unreachable and this string free to drift from it.
          // That is the failure `ZONE_TITLE` was deleted for, one consumer along.
          title: swing.rule.title,
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
        rule: 'entry',
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
      //
      // `verticalExtent`, not `pos[1] + h`, and the whole extent rather than a top:
      // `pos[1]` is a bottom for a floor anchor and the mesh CENTRE for every other
      // one. Unreachable today — `floorBlockers` admits nothing whose anchor is not
      // the floor — and written correctly anyway, because the set this rule reads is
      // itself an open question. `floorBlockers` answers "who gets in a WALKER's
      // way", which is the right set for the walkway, navigation and window rules and
      // is not obviously the right one for "are these two pieces inside each other".
      //
      // **That widening happened, and it is rule 2b below rather than a change here.**
      // This paragraph used to say the report "stays silent" about a wardrobe inside a
      // mounted TV and that what it needed was "a `RuleKind` and a `RULE_HANDLING` row";
      // both were delivered by the commit that closed § 17, seventy lines down, and
      // leaving the old wording standing is exactly the rot `docs/traps.md` describes —
      // the next reader greps "stays silent", finds this first because it is the more
      // prominent of the two, and re-implements 2b in here. Rule 2 stays as it is: this
      // loop is about walkers, 2b is about vertical containment, and they need different
      // sets on both sides.
      const [aBottom, aTop] = verticalExtent(a.category, a.shape, a.dimMM, a.pos[1]);
      const [bBottom, bTop] = verticalExtent(b.category, b.shape, b.dimMM, b.pos[1]);
      if (aTop <= bBottom + 0.005 || bTop <= aBottom + 0.005) continue;
      const oa = obbs.get(a.id)!;
      const ob = obbs.get(b.id)!;
      const shared = footIntersectionArea(oa, ob);
      if (shared <= 0) continue;
      // Real areas, so a round table is measured as a circle rather than as the
      // square around it — the four phantom corners are precisely where a tucked
      // chair sits, so the square version reported the most ordinary dining
      // arrangement there is as a collision.
      const smaller = Math.min(footArea(oa), footArea(ob));
      // `<`, and it stays `<` — this was briefly `<=` and that was a regression.
      //
      // The argument for flipping it was that `lib/layout-score.ts` charges the
      // EXCESS above the tucked bar and is therefore exactly 0 at it, so flagging
      // at `>=` put a "Two pieces in the same place" finding — and a **Try a fix**
      // button — behind an `overlap` of 0.0000. True, and worth exactly nothing:
      // that share is a quotient of two float geometry results and never lands on
      // 0.85, so the case cannot be constructed and reverting the line fails no
      // test in the repo.
      //
      // What it DID do is move the other bar. `clashShare` returns
      // `TUCKED_CLASH_SHARE` only for a pair that shares floor by design; for every
      // ordinary pair it returns `CLASH_SHARE`, 0.5 — where the solver has no
      // tolerance at all and charges `share` outright, i.e. **500 of a 1000-unit
      // hard term**. And 0.5 is not measure-zero: two 500 mm chairs 250 mm apart,
      // whole steps of the 10 mm drag grid, hit it exactly, and the report went
      // silent on a collision the solver was pricing at half its maximum. That is
      // the divergence this file exists to close, reintroduced at the other end and
      // pointing the more dangerous way. `layout-conformance`'s property is
      // one-directional (flagged ⇒ costlier), so silence was invisible to it — the
      // exact-half case is pinned in `tests/clearance.test.ts` instead.
      if (smaller <= 0 || shared / smaller < clashShare(a, b)) continue;
      issues.push({
        id: `clash-${a.id}-${b.id}`,
        rule: 'clash',
        severity: 'error',
        title: 'Two pieces in the same place',
        detail: `“${a.name}” and “${b.name}” overlap on the floor — one of them has to move before this arrangement is real.`,
        partIds: [a.id, b.id],
      });
    }
  }

  // ── 2b. A floor piece standing inside something that is not on the floor ──
  //
  // § 17. The drag has refused these since PR #42 — `collidesAt` compares full
  // vertical extents and skips only soft furnishings — and the room report said
  // nothing, because rule 2 above runs over `floorBlockers`, which excludes anything
  // wall-mounted by definition. Same question, two answers: a wardrobe through a
  // mounted TV could not be created by dragging and could not be reported once it
  // was there, so a room detected or imported into that state stayed silent about it.
  //
  // The two sets are deliberately NOT `floorBlockers` on either side:
  //
  //   · the floor side admits a piece standing on a surface — a bedside lamp at
  //     y = 0.55 is inside a TV mounted at 1.4 m just as a wardrobe is, and
  //     `floorBlockers`' `pos[1] < 0.05` would drop it;
  //   · the mounted side admits the CEILING anchors too, so a tall bookshelf under a
  //     fan is the same finding rather than a shape nobody thought of.
  //
  // Any overlap at all, rather than rule 2's `CLASH_SHARE`. That bar exists to forgive
  // deliberate composition — a chair tucked under its table — and there is no
  // arrangement in which a piece of furniture is meant to be partly inside a
  // television. It is also the bar `collidesAt` uses, so for a floor↔mounted pair the
  // two agree exactly.
  //
  // **They do not agree everywhere, and the earlier version of this note claimed they
  // did.** Two classes are still refused by the drag and unreported, both measured:
  //   · MOUNTED ↔ MOUNTED. `floorSolids` requires `!wallMounted`, so neither ordering of
  //     such a pair is reachable here and `floorBlockers` excludes both from rule 2. The
  //     seeder ships seven rooms with a framed print inside a window.
  //   · A TUCKED pair. `collidesAt` has no `sharesFloor` exemption while rule 2 and the
  //     seeder's own `seats()` both do, so a dining chair under its table is refused by
  //     the drag and silent in the report BY DESIGN — twenty seeded pairs.
  // Both are recorded in `docs/what-is-still-open.md` § 17. Neither is this rule's job;
  // saying so here is, because the next reader will otherwise read the sentence above
  // as a general guarantee and build on it.
  //
  // Doors and windows are excluded because `door`, `entry` and `window` already speak
  // for them, and they name the fault rather than the mechanism.
  const mountedSolids = parts.filter(isMountedObstruction);
  // Both sides hoisted out of their loops, the way rule 2 reads a precomputed `obbs`
  // Map. The floor side was rebuilt once per mounted piece, which for a room with four
  // wall fixtures did the same `verticalExtent` and `footFromPart` work four times.
  const floorSolids = parts
    .filter((p) => !p.wallMounted && !isSoftFurnishing(p))
    .map((p) => ({
      p,
      y: verticalExtent(p.category, p.shape, p.dimMM, p.pos[1]),
      foot: footFromPart(p.pos, p.rot, p.dimMM, p.circle),
    }));
  for (const m of mountedSolids) {
    const [mBottom, mTop] = verticalExtent(m.category, m.shape, m.dimMM, m.pos[1]);
    const mFoot = footFromPart(m.pos, m.rot, m.dimMM, m.circle);
    for (const { p: f, y: [fBottom, fTop], foot } of floorSolids) {
      if (fTop <= mBottom + 0.005 || mTop <= fBottom + 0.005) continue;
      // The same pad `collidesAt` passes, so flush-against reads as touching rather
      // than as a collision, on both surfaces.
      if (!footOverlap(mFoot, foot, -0.01)) continue;
      // Centimetres, and rounded OUTWARD, for two reasons that pull the same way.
      //
      // Metres at `toFixed(2)` is 1 cm of resolution, and the rule fires on a band as
      // narrow as 5 mm — so a real pair (a 688 mm TV at 1.4 m and a 1063 mm bookshelf,
      // both legal sizes) printed "between 1.06 m and 1.06 m up": a sentence whose
      // whole job is to say WHERE they meet, saying nothing. Heights are not on the
      // 10 mm drag grid — that grid is x/z — and `groundY`'s `wall-mid` answer is
      // `min(1.4, H - h/2 - 0.1)`, an arbitrary real, so sub-centimetre bands are
      // ordinary rather than contrived.
      //
      // Rounding outward (floor the bottom, ceil the top) keeps the printed interval a
      // superset of the real one, so it can never read as empty or inverted — the same
      // reason `boundsToUnit` rounds toward the interior for the opposite kind of
      // bound. And cm is what every other HEIGHT in this file speaks (`tall` says
      // "190 cm tall and the ceiling is 240 cm"); the metres here were the odd one out.
      const lowCm = Math.floor(Math.max(fBottom, mBottom) * 100);
      const highCm = Math.ceil(Math.min(fTop, mTop) * 100);
      issues.push({
        id: `clash-mounted-${f.id}-${m.id}`,
        rule: 'clash-mounted',
        severity: 'error',
        title: 'A piece is inside something on the wall',
        detail: `“${f.name}” is standing where “${m.name}” hangs — they share the same space between ${lowCm} cm and ${highCm} cm up. Slide one of them along its wall.`,
        partIds: [f.id, m.id],
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
      if (!formsRoute(roleOf(a)) || !formsRoute(roleOf(b))) continue;
      // A pair the relation table puts together is not a walkway: 450 mm between a
      // sofa and its own coffee table is the figure `layout-rules` asks for, and
      // reporting it taught people that this panel cries wolf about correct rooms.
      if (belongTogether(a, b)) continue;
      if (gap - band <= 0.12 || gap + band >= MIN_WALKWAY) continue;
      issues.push({
        id: `walk-${a.id}-${b.id}`,
        rule: 'walk',
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
    const byRule = new Map<string, { rule: AccessRule; blocked: string[]; clear: string[]; narrowest: number }>();
    for (const zn of zones) {
      const entry = byRule.get(zn.rule.id) ?? { rule: zn.rule, blocked: [], clear: [], narrowest: Infinity };
      // The narrowest point across the face, not the average of it. A chair against
      // the left third of a 2 m wardrobe takes under a fifth of the zone's AREA and
      // stops the door dead, so a share-of-area test reports nothing — which is the
      // bug `faceClearance` was written to fix, and the reason the report reads the
      // worst probe while the solver's cost reads the total. Same zone, same depth;
      // the solver wants a gradient and the report wants the truth about the
      // tightest point.
      //
      // …and the same SPAN. This did not pass one, so it probed the full width of
      // the face while the rule claimed `span` of it and `lib/layout-score.ts`
      // costed `span` of it. A neighbour standing off the end of a sofa — inside
      // the outer tenth, outside the zone — made this say "4 cm in front" while the
      // solver's access term read zero, and the finding then carried a **Try a
      // fix** button that could not move anything, because nothing it was allowed
      // to move was costing anything. Three files, one rectangle.
      const got = faceClearance(me, FACE_OF[zn.side], others, poly, zn.rule.depth * 2, zn.rule.span);
      if (got < zn.rule.depth) entry.blocked.push(zn.side);
      else entry.clear.push(zn.side);
      entry.narrowest = Math.min(entry.narrowest, got);
      byRule.set(zn.rule.id, entry);
    }
    // `access`, not `rule`: the issue itself now carries a `rule` field, and having
    // an AccessRule of that name a line above `rule: 'zone'` reads like a bug even
    // when it is not one.
    for (const { rule: access, blocked, clear, narrowest } of byRule.values()) {
      if (clear.length >= access.atLeast) continue;
      issues.push({
        id: `${ZONE_ISSUE_ID[access.id] ?? access.id}-${p.id}`,
        rule: 'zone',
        severity: 'warn',
        title: access.title,
        detail: zoneDetail(p, access, blocked.length, clear.length, narrowest),
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
        // The piece's real top against the sill — `verticalExtent` for the same
        // reason as rule 2 above, so a set that ever admits a mounted piece measures
        // it correctly rather than by half a height.
        if (verticalExtent(p.category, p.shape, p.dimMM, p.pos[1])[1] <= zn.rule.aboveY + 0.05) return false;
        const f = obbs.get(p.id)!;
        return footIntersectionArea(f, zn.foot) / (footArea(zn.foot) || 1) > 0.15;
      });
      if (blockers.length === 0) continue;
      issues.push({
        id: `window-${win.id}`,
        rule: 'window',
        severity: 'warn',
        // See the door above: read the rule, never restate it.
        title: zn.rule.title,
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
        rule: 'tv',
        severity: 'warn',
        title: 'Sitting too close to the TV',
        detail: `“${nearest.name}” is ${nd.toFixed(1)} m from the ${Math.round((diag / 0.0254) * 10) / 10}″-class screen — comfortable viewing starts around ${(diag * 1.2).toFixed(1)} m.`,
        partIds: [tv.id, nearest.id],
      });
    } else if (nd > diag * 3.2) {
      issues.push({
        id: `tv-${tv.id}`,
        rule: 'tv',
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
  //
  // This used to open `if (p.wallMounted) continue;`, and that skip deleted the
  // one case the promise above was written for. `heightForNewCeiling`'s own
  // comment says a piece too tall "keeps its real size and its real place and
  // `lib/clearance.ts` reports it" — and the piece that reaches that state first
  // is a wall-mounted one, because the ceiling is what moved. Lower a room to the
  // 1.8 m floor and the catalog's 2.2 m curtain is clamped into
  // `[h/2 + PAD, H - h/2 - PAD]` = `[1.12, 0.68]` — an interval whose ends have
  // crossed, so `Math.max` wins, the centre pins at 1.12 m and 42 cm of curtain
  // stands through the slab. Silently: this pass skipped it, and the Inspector's
  // own mount-height field pinned to 0 without a word (see `MountHeightRow`). A
  // 2.1 m door does the same. That was the whole of "the curtain doesn't reduce
  // when the room height is reduced, and it doesn't state anything as the reason"
  // — not reducing is correct, saying nothing is not.
  //
  // The skip was solving a WORDING problem, not a logic one: "it will not stand up
  // in here" is wrong about something that hangs. So branch the sentence and keep
  // the check.
  //
  // The tail sentence branches for a second reason, and this one is a defect in the
  // range table rather than in the wording. "Danmu keeps the real size rather than
  // shrinking it for you" tells the user the shrinking is THEIRS to do — and for a
  // door that is a lie the Inspector then enforces. `door` has a height floor of
  // 1980 mm and `ROOM_HEIGHT_M.min` is 1800, so **every room between 1.80 m and
  // 1.98 m has no legal door at all**: ask `clampDims` for a 1000 mm door and it
  // returns 1980, unchanged, four times out of four. The user reported this as "the
  // door doesn't reduce its height", which is exactly right and is not a bug in the
  // door — it cannot reduce, and being told to do it anyway is the whole of the
  // complaint. Two range tables in one file disagreeing about the shortest room a
  // door fits in is the kind of thing only arithmetic finds; neither number is
  // wrong on its own.
  //
  // So compare against the piece's own FLOOR, not against the size it happens to
  // hold, and derive the number rather than naming a shape: `dimRangeFor` already
  // owns it, a curtain (800) and a wardrobe (1600) both pass and keep the old
  // sentence, and a shape whose floor is raised later starts telling the truth
  // without anyone editing this string. Deliberately not fixed by lowering the door
  // or raising the room: 1980 mm is a real door and 1.8 m is a real attic, the
  // combination is what does not exist, and rule 2 says report it rather than
  // quietly resize one of them.
  for (const p of parts) {
    const h = p.dimMM[2] / 1000;
    if (h <= room.height) continue;
    const floor = dimRangeFor(p.category, p.shape).min[2] / 1000;
    const lead = p.wallMounted
      ? 'there is no height it can hang at without crossing the floor or the ceiling'
      : 'it will not stand up in here';
    const tail =
      floor > room.height
        ? `It does not go any shorter than ${Math.round(floor * 100)} cm, so nothing you type will fit it in here — the ceiling has to reach ${Math.round(floor * 100)} cm, or the piece has to go.`
        : `Danmu keeps the real size rather than shrinking it for you; ${Math.round(floor * 100)} cm is as short as this piece goes, and that would fit.`;
    issues.push({
      id: `tall-${p.id}`,
      rule: 'tall',
      severity: 'error',
      title: 'Taller than the room',
      detail: `“${p.name}” is ${Math.round(h * 100)} cm tall and the ceiling is ${Math.round(room.height * 100)} cm — ${lead}. ${tail}`,
      partIds: [p.id],
    });
  }

  // ── 7b. Outside the room ─────────────────────────────────────────────────
  // The drag has refused this placement since § H.16 and nothing REPORTED it, so a
  // piece that got outside by any other route — seeded that way, resized after it
  // was placed, or left behind when a wall moved past it — sat there silently.
  // `freeFloorShare` was the nearest thing to a witness and it DISCARDS the outside
  // portion rather than counting it, so a sofa half out of the room read as a room
  // with more free floor than it has.
  //
  // The predicate is the drag's, shared through `roomContainment`. What is NOT
  // shared is the drag's rug exemption: its version also asks `roomIsWideEnough`
  // and `!shovedIntoRoom`, and both are questions about a gesture. For a piece
  // standing still a rug is outside only when its CENTRE is out, because overhang —
  // under the furniture, up to the skirting, across an L's missing corner — is what
  // a rug is for.
  //
  // ── Why this emits TWO kinds ──
  //
  // `RULE_HANDLING.movable` answers "could rearranging clear it", and the honest
  // answer here depends on the PIECE, not on where it happens to be standing. The
  // first version said `movable: true` for everything, which put a **Try a fix**
  // button on a wall-mounted TV that `movableFor` (`!locked && !p.wallMounted`) can
  // never move. A button that spins and then reports it found nothing is the exact
  // anti-pattern this table exists to prevent.
  //
  // The SECOND version split on geometry — centre off the plan is fixable, merely
  // crossing a wall is not — and a user found it in one screenshot within a day: a
  // sofa 300 mm through the wall is ordinary movable furniture standing on the floor,
  // and it was filed under the immovable kind, so the room reported a fault and
  // offered nothing. The geometry answers "where is it", which is what the TITLE is
  // for. It does not answer "can this be fixed".
  //
  // So the split is `isObstacle`, and it is the same predicate `layout-score` gates
  // `c.outside` on (`if (!obstacle[i]) continue`). That identity is the whole point
  // and `tests/layout-conformance.test.ts` holds it: **a containment finding is
  // fixable exactly when the cost term can see the piece.** For a wall rider, a rug,
  // a piece under `OBSTACLE_HEIGHT` or anything standing on a surface, that term is
  // identically zero however far out it is — so no amount of searching can improve
  // it, and the honest row has no button.
  //
  // The cost's own dead band was the other half of that report and is fixed in
  // `layout-score.ts`: `outsideShare` samples a grid whose outermost points sit a
  // third of the half-extent in from the edge, so it read a flat 0.000 up to ~160 mm
  // of overhang on a sofa. `outsideDeficit` is corner-exact and non-zero as soon as
  // any corner is out, so `outside` is now priced across the whole range in which it
  // is reported. Without that, `movable: true` here would have been a second lie.
  for (const p of parts) {
    const c = roomContainment(p.pos, p.rot, p.dimMM, poly, p.circle);
    const out = p.category === 'rug' ? !c.centre : !(c.box && c.centre);
    if (!out) continue;
    // WHERE it is — the title and the remedy sentence.
    const standing = !c.centre;
    // WHETHER anything can be done — the rule, and so the button.
    const fixable = isObstacle(p);
    issues.push({
      id: `${fixable ? 'outside' : 'outside-immovable'}-${p.id}`,
      rule: fixable ? 'outside' : 'outside-immovable',
      // Both are errors. `warn` reads "A bit tight" in the panel, and a piece
      // through the plaster is not a tightness — it is a piece that does not fit,
      // which rule 2 says to state plainly rather than soften.
      severity: 'error',
      title: standing ? 'Outside the room' : 'Sticks out of the room',
      detail:
        (standing
          ? `“${p.name}” is standing off the floor plan entirely — there is no room under it.`
          : `“${p.name}” crosses a wall: part of it is outside the room.`) +
        (fixable
          ? ' Drag it back inside, or use Try a fix.'
          : standing
            ? ' Drag it back inside.'
            : ' Turn it, move it along the wall, or give it a wall it fits on.'),
      partIds: [p.id],
    });
  }

  // ── 8. Free floor share ──────────────────────────────────────────────────
  // A by-product of the raster now, rather than its own pass over the room.
  const freeFloorShare = field ? freeShareOf(field) : freeFloorFraction(solidObbs, poly);
  if (freeFloorShare < 0.4) {
    issues.push({
      id: 'crowding',
      rule: 'crowding',
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
    // Index only — `solidObbs` is built from `solid` and stays index-aligned with it,
    // so the footprint is looked up by position rather than taken off the part.
    const stranded = solid.filter((_, i) => {
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
        rule: 'reach',
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
        rule: 'cut-off',
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
        rule: 'turning',
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



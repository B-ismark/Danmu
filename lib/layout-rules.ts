// What a piece of furniture needs from the room, stated as geometry.
//
// This is the table both the room report (`lib/clearance.ts`) and the arrangement
// solver (`lib/layout-score.ts`) read. They used to carry their own copies: the
// checker knew a wardrobe wants 600 mm in front and a bed wants a side to get in
// on, the solver knew about the wardrobe and not the bed, and neither of them knew
// a door existed — so "Suggest" would park a bed across a doorway and Room check
// would immediately report that it had. One table, two readers.
//
// ── The shape of a rule ─────────────────────────────────────────────────────
//
// Nothing here is a fixed rectangle in room coordinates. Every zone is authored in
// the piece's OWN frame:
//
//   · its DEPTH is what the activity needs — a drawer pulls out 600 mm whether the
//     chest is 400 mm or 2 m wide,
//   · its WIDTH comes from the piece's own `dimMM`, so resizing the piece resizes
//     what it asks for,
//   · its POSITION and ORIENTATION are relative to the piece's front (local +Z),
//     so turning the piece turns its needs with it.
//
// That is the whole of "recalibrate when the room or an object changes": there is
// nothing to recalibrate, because no number was ever measured from the old state.
// Change a dimension and every zone derived from it moves on the next read.
//
// ── Where the numbers come from ─────────────────────────────────────────────
//
// Residential space-planning practice. They agree with each other to within a few
// centimetres across sources — with ONE exception, which is spelled out at the
// bedside line below rather than left for the next reader to discover. A blanket
// "the sources agree" is the kind of claim that stops anyone checking.
//
//   · 600 mm — the tight minimum walkway; also the depth in front of hinged
//     storage and a fridge. Derived here from `WALK_RADIUS` rather than typed
//     twice (see `WALK_MIN`).
//   · 900 mm — the comfortable route, and the pull-back for a seated diner
//     (1050–1200 mm if people also walk behind them). Also the circulation behind
//     a desk chair.
//   · 500 mm — the bedside strip you need to get in and make the bed.
//
//     **This is the one number that disagrees with its source, and it disagrees
//     on purpose.** Panero & Repetto (1975) — the anthropometric reference the
//     furniture-layout literature cites for all of these, and the one Merrell et
//     al. (SIGGRAPH 2011) tabulate directly — put bedside clearance at 36 in
//     ≈ 914 mm. Ours is 45% under that, and it is the only one that is under.
//     Three of ours land within a rounding of the same table — shelving 600 vs
//     24 in ≈ 610, dining all-around 900 vs 36 in ≈ 914, coffee-table-to-seat
//     400–500 vs 16–18 in ≈ 406–457 — and one is deliberately MORE generous: our
//     900 mm seat pull-back against their 30 in ≈ 762 mm, because ours has to
//     cover a diner pushing a chair back rather than someone standing in front of
//     a seat. Being over the reference needs no defence; being 41 cm under it
//     does.
//
//     The gap is a difference of activity, not of measurement. 914 mm is the
//     figure for standing beside a bed and using the floor there as circulation;
//     500 mm is the strip you need to get IN and to tuck a sheet, which is what
//     this zone is titled ("to get in and make the bed") and what a bedroom that
//     is 3 m wide can actually give. Raising it to 914 mm would report most real
//     bedrooms as faulty, which is the opposite of useful.
//
//     Written down because a number that quietly contradicts its own cited source
//     reads as an error to whoever next compares them, and the next person to
//     check will be the third.
//   · 400–500 mm — sofa to coffee table.
//   · 400 mm — the band in front of a window that large furniture should stay out
//     of, and 600 mm for the depth a door leaf sweeps.
//   · TV: 1.2–2.5 × the screen diagonal. A multiple, never a constant — which is
//     why the relation table can carry a function.
//
// Sources are listed in `docs/history/Research.md` §3.9. Nothing here is learned, sampled or
// downloaded; it is a table of numbers from design manuals with the geometry to
// apply them.

import type { Category, Shape, ScenePart } from './scene-spec';
import type { Footprint } from './footprint';
import { WALK_RADIUS } from './clearance-field';
import { footFromPart, localToWorld, polygonArea, type Foot } from './geometry';

// ─── Roles ──────────────────────────────────────────────────────────────────
//
// `Category` says what a thing IS; a role says what it is FOR, which is what the
// rules are about. A `table` is a coffee table, a dining table or a bedside table
// depending on its shape, and those three want completely different things from
// the room — the first wants to be in front of a sofa, the second wants a metre
// clear on every side, the third wants to touch a bed.

export type Role =
  | 'bed'
  | 'sofa'
  | 'armchair'
  | 'dining-chair'
  | 'office-chair'
  | 'ottoman'
  | 'dining-table'
  | 'coffee-table'
  | 'side-table'
  | 'nightstand'
  | 'desk'
  | 'wardrobe'
  | 'bookshelf'
  | 'shoe-rack'
  | 'fridge'
  | 'appliance'
  | 'tv'
  | 'monitor'
  | 'floor-lamp'
  | 'table-lamp'
  | 'rug'
  | 'plant'
  | 'door'
  | 'window'
  | 'wall-art'
  | 'other';

const ROLE_BY_SHAPE: Partial<Record<Shape, Role>> = {
  sofa: 'sofa',
  'chair-armchair': 'armchair',
  'chair-dining': 'dining-chair',
  'chair-office': 'office-chair',
  ottoman: 'ottoman',
  'bed-single': 'bed',
  'bed-double': 'bed',
  'side-table': 'side-table',
  nightstand: 'nightstand',
  'desk-l': 'desk',
  wardrobe: 'wardrobe',
  closet: 'wardrobe',
  bookshelf: 'bookshelf',
  'shoe-rack': 'shoe-rack',
  fridge: 'fridge',
  'washing-machine': 'appliance',
  microwave: 'appliance',
  'water-dispenser': 'appliance',
  'air-purifier': 'appliance',
  radiator: 'appliance',
  tv: 'tv',
  soundbar: 'appliance',
  monitor: 'monitor',
  laptop: 'other',
  'lamp-floor': 'floor-lamp',
  'lamp-table': 'table-lamp',
  'lamp-pendant': 'other',
  rug: 'rug',
  plant: 'plant',
  door: 'door',
  window: 'window',
  mirror: 'wall-art',
  'mirror-oval': 'wall-art',
  painting: 'wall-art',
  curtain: 'other',
  fan: 'other',
  'ac-unit': 'other',
  // A ceiling fan is 'other' because nothing on the floor has to make room for it.
  // A pedestal fan is an obstacle standing in the room, so it gets a real role: 'other'
  // means no access zone and nothing it belongs beside, which for a floor-standing
  // piece is not a description, it is a gap. `tests/shape-contract.test.ts` refuses
  // 'other' for anything `isObstacle` accepts.
  //
  // `chest-freezer` and `tv-console` are deliberately absent: their categories
  // (`fridge`, `shelf`) already answer, and a row here that merely restates the
  // category is a second place for the same fact to drift from.
  'fan-standing': 'appliance',
};

const ROLE_BY_CATEGORY: Partial<Record<Category, Role>> = {
  sofa: 'sofa',
  bed: 'bed',
  chair: 'dining-chair',
  ottoman: 'ottoman',
  table: 'dining-table',
  desk: 'desk',
  nightstand: 'nightstand',
  wardrobe: 'wardrobe',
  shelf: 'bookshelf',
  fridge: 'fridge',
  tv: 'tv',
  monitor: 'monitor',
  lamp: 'floor-lamp',
  rug: 'rug',
  plant: 'plant',
  door: 'door',
  mirror: 'wall-art',
  painting: 'wall-art',
};

/** Shapes that mean "a flat top on legs" and nothing more specific than that. The
 *  catalog uses `coffee-table` for a 1.8 m six-seater dining table and
 *  `desk-standard` for the entry literally labelled "Dining / desk table", so for
 *  these the shape is not the answer — the SIZE is. */
const AMBIGUOUS_TABLE = new Set<Shape>(['coffee-table', 'desk-standard', 'box']);

/** Above this a table is one you sit AT; below it, one you put a mug on. Dining
 *  and desk tops are 730–750 mm because that is what a seated adult's knees need;
 *  coffee tables are 400–450 mm because that is sofa-seat height. There is nothing
 *  in between, which is what makes the height a reliable reading. */
const SIT_AT_HEIGHT = 0.6;
/** …and under this in both plan directions it is a side table whatever its height:
 *  nothing you can seat two people at is 700 mm square. */
const SIDE_TABLE_SPAN = 0.7;

/** What this piece is FOR.
 *
 *  Shape first, since it is usually the more specific of the two — except for the
 *  table-ish shapes, where the catalog overloads one shape across three different
 *  pieces of furniture and the dimensions are the only honest signal. This is the
 *  one place in the codebase where a size decides a BEHAVIOUR rather than the other
 *  way round, and it is safe in the direction that matters: the dimension is read,
 *  never written. */
export function roleOf(part: { category: Category; shape: Shape; dimMM: [number, number, number] }): Role {
  const tableish =
    AMBIGUOUS_TABLE.has(part.shape) && (part.category === 'table' || part.category === 'desk' || part.category === 'other');
  if (tableish) {
    const w = part.dimMM[0] / 1000;
    const d = part.dimMM[1] / 1000;
    const h = part.dimMM[2] / 1000;
    if (w < SIDE_TABLE_SPAN && d < SIDE_TABLE_SPAN) return 'side-table';
    if (h < SIT_AT_HEIGHT) return 'coffee-table';
    // Tall enough to sit at. Which of the two it is, is a question about the room
    // rather than the object, and `wallAffinity` already answers it by category:
    // a desk wants a wall behind it, a dining table wants the middle.
    return part.category === 'desk' ? 'desk' : 'dining-table';
  }
  return ROLE_BY_SHAPE[part.shape] ?? ROLE_BY_CATEGORY[part.category] ?? 'other';
}

// ─── What can be wrong with a room ──────────────────────────────────────────
//
// The kinds of finding this table's rules can produce, named once so that the two
// consumers and the UI can all talk about the same thing.
//
// It exists because "which rule is this" used to be answerable only by matching the
// prefix of a `ClearanceIssue.id` — a string built for React keys and being read as
// a type. That is fine until something needs to BRANCH on it, and the room report
// now does: whether a finding can be cleared by moving furniture decides whether it
// is offered a fix, and getting that wrong means either a button that does nothing
// or no button where one would have helped.
//
// The zone rules (a wardrobe's front, a bed's side, a table's seats) are one kind
// here on purpose. They differ in which side of a piece they measure and not at all
// in what to do about them.
export const RULE_KINDS = [
  'door',
  'entry',
  'clash',
  // The same fault one layer up: a floor piece standing INSIDE something that is not
  // on the floor — a wardrobe through a mounted TV, a bookshelf through a ceiling fan.
  //
  // Its own kind rather than more `clash`, because the two answer "can the solver fix
  // this" differently and `RULE_HANDLING` is read to decide whether a **Try a fix**
  // button appears. `c.overlap` accumulates inside `if (!obstacle[i]) continue`, and
  // `isObstacle` is false for anything wall-mounted, so the term is identically zero
  // for these pairs however deep the overlap. Filing them under `clash` would put a
  // button there that spins and reports nothing.
  //
  // Doors and windows are deliberately not reported here — `door`, `entry` and
  // `window` already speak for them, and in better words than "two pieces in the same
  // place" ("you cannot open this door" is the fault; the overlap is the mechanism).
  'clash-mounted',
  'walk',
  'zone',
  'window',
  'tv',
  'tall',
  'crowding',
  'reach',
  'cut-off',
  'turning',
  // Containment, split by whether the SOLVER can do anything about it rather than
  // by where the piece sits. `outside` is a piece `isObstacle` accepts, which is
  // exactly the set `layout-score`'s `outside` term measures, so a cost exists and a
  // **Try a fix** button is honest. `outside-immovable` is the rest — a wall rider, a
  // rug, a low piece, anything on a surface — where no arrangement this app can
  // search will move it and the button would be a lie.
  //
  // The first version split on GEOMETRY (centre off the plan vs merely crossing a
  // wall) and a user found it in one screenshot: a sofa 300 mm through the wall is
  // ordinary movable furniture, and it was filed under the immovable kind. The title
  // still says where the piece is; the RULE says what can be done about it.
  'outside',
  'outside-immovable',
] as const;
export type RuleKind = (typeof RULE_KINDS)[number];

// ─── Derived thresholds ─────────────────────────────────────────────────────

/** The tight minimum walkway. DERIVED from the field's walk radius rather than
 *  written down again — `lib/clearance.ts` learned this lesson already: two files
 *  spelling 0.6 with nothing tying them together drift silently. */
export const WALK_MIN = WALK_RADIUS * 2;

/** The comfortable route width, and what a seated diner needs to push back. */
export const WALK_COMFORT = 0.9;

/** Breathing room left between a piece's back and the wall behind it, metres.
 *
 *  Small, and load-bearing anyway: it is the difference between furniture that
 *  looks placed and furniture that looks welded on, and every path that puts
 *  something against a wall has to agree on it. Three did not — `snapToWall`
 *  (`lib/physics.ts`) had it inline as `+ 0.02` with a trailing comment, the seeded
 *  arrangements had `SEED_WALL_GAP`, and `lib/layout-settle.ts` had `WALL_GAP` under
 *  a note claiming it matched the first. Nothing tied them together, so the drift
 *  would have shown up as a 20 mm seam between a sofa the user snapped and one the
 *  settler pushed — invisible in a diff, plain in the 3D scene. Same lesson as
 *  `WALK_MIN` above, one file later. */
export const WALL_GAP = 0.02;

/** How close a piece's back has to be to a wall for that wall to take the piece
 *  with it when it moves, metres. Measured from the piece's near FACE, so it is a
 *  gap, not a centre distance.
 *
 *  Deliberately looser than `WALL_GAP`, because "against the wall" in a real
 *  arrangement is anything from welded-on to a hand's width off: the settler
 *  leaves exactly `WALL_GAP`, a user dragging by hand leaves whatever the snap
 *  step gave them (50 mm on the coarse setting), and a piece placed from a photo
 *  detection can be a few centimetres out. At `WALL_GAP` exactly, a sofa the user
 *  nudged 30 mm off the plaster would be abandoned by its own wall — and being
 *  left behind is far more surprising than being taken along.
 *
 *  Here rather than in `lib/wall-move.ts` for the reason `WALL_GAP` above already
 *  records: this is a number about what a piece needs from the room, every
 *  consumer has to agree on it, and the ones that kept private copies drifted. */
export const WALL_ATTACH_TOL = 0.12;

/** How wide a route this particular room can be asked for, metres.
 *
 *  A rule the room cannot satisfy is the same as no rule at all: in a 6 m² box
 *  every arrangement fails a 900 mm route equally, so the term stops
 *  discriminating and the solver spends its budget elsewhere. So the requirement
 *  scales with the room — the tight minimum in a small room, the comfortable
 *  figure once there is floor to spare. This is the "context" half of taking the
 *  room's structure into account; the other half is the footprint's own shape,
 *  which every zone test already sees. */
export function routeWidth(footprint: Footprint): number {
  const area = polygonArea(footprint);
  const t = Math.max(0, Math.min(1, (area - 8) / 12)); // 8 m² → 20 m²
  return WALK_MIN + (WALK_COMFORT - WALK_MIN) * t;
}

/** Which pieces' pairwise gaps are walkways people actually use.
 *
 *  Moved here from `lib/clearance.ts`, where it lived as `WALKWAY_CATEGORIES` and was
 *  the report's alone. The solver had no equivalent and charged EVERY obstacle pair,
 *  which is how three dining chairs 400 mm apart around their own table came to cost
 *  `walkway 40.4` on a room `analyzeRoom` reported nothing about — and how "Suggest"
 *  came to fling a dining set across the room and announce that it had "widened the
 *  walkways". Chairs at one table are not a corridor. One predicate, three readers:
 *  the report, the solver, and the seeder's own `pinches`.
 *
 *  Bulky, floor-standing, and the thing you walk AROUND rather than sit at. A dining
 *  table is deliberately absent for the same reason a chair is: the gap between a
 *  table and its own chairs is the arrangement, and `belongTogether` would have to
 *  undo pair by pair what this settles once. */
const ROUTE_FORMING = new Set<Role>(['sofa', 'bed', 'wardrobe', 'bookshelf', 'fridge', 'desk']);

export function formsRoute(role: Role): boolean {
  return ROUTE_FORMING.has(role);
}

// ─── Where a piece wants to stand ───────────────────────────────────────────

/** What a piece wants from the room's walls.
 *
 *  `wallAffinity` in `lib/physics.ts` answers the same question keyed on `Category`,
 *  and that is the right key for the job it does — deciding where a piece the user
 *  has just added should land. It is the wrong key for SCORING, because `Category`
 *  cannot tell a coffee table from a dining table from a side table: all three are
 *  `table`, all three came out `prefers-middle`, and so the solver charged a coffee
 *  table for sitting in front of the sofa where the relation table had just put it,
 *  and dragged a side table 0.59–1.21 m away from the armchair whose arm it exists
 *  to be within reach of. §3.9's "a role is not a category" lesson, one file short.
 *
 *  `'by-relation'` is the addition: a piece whose place is decided by what it belongs
 *  to has no opinion of its own about walls or middles, and a term that gives it one
 *  is a term fighting the relation. It applies only when the anchor is actually in
 *  the room — see `fallbackAffinity`. */
export type PlaceAffinity = 'must-wall' | 'prefers-wall' | 'prefers-middle' | 'by-relation' | 'free';

const AFFINITY_BY_ROLE: Partial<Record<Role, PlaceAffinity>> = {
  door: 'must-wall',
  window: 'must-wall',
  'wall-art': 'must-wall',
  tv: 'must-wall',
  monitor: 'must-wall',

  bed: 'prefers-wall',
  sofa: 'prefers-wall',
  wardrobe: 'prefers-wall',
  bookshelf: 'prefers-wall',
  'shoe-rack': 'prefers-wall',
  fridge: 'prefers-wall',
  appliance: 'prefers-wall',
  desk: 'prefers-wall',

  'dining-table': 'prefers-middle',

  // Placed by what they belong to, not by the room.
  'coffee-table': 'by-relation',
  'side-table': 'by-relation',
  nightstand: 'by-relation',
  rug: 'by-relation',
  ottoman: 'by-relation',
  'floor-lamp': 'by-relation',
  'table-lamp': 'by-relation',
  'dining-chair': 'by-relation',
  'office-chair': 'by-relation',
  armchair: 'by-relation',

  plant: 'free',
};

export function placeAffinity(role: Role): PlaceAffinity {
  return AFFINITY_BY_ROLE[role] ?? 'free';
}

/** Roles whose BACK is a finished surface — pieces that may legitimately stand off
 *  their wall with a route behind them, dividing a room rather than failing to
 *  reach the plaster.
 *
 *  A sofa's back is upholstered and is the first thing you see walking into an open
 *  plan; a desk's is a modesty panel. A wardrobe's, a bookshelf's and a fridge's are
 *  bare board, hinges and a compressor — no width of walkway behind those makes it a
 *  composition, so they keep the plain distance term. */
const FINISHED_BACK = new Set<Role>(['sofa', 'desk']);

/** What a piece standing off its wall costs, in metres of debt.
 *
 *  Linear in the gap — and for a piece with a finished back, only until `WALK_MIN`,
 *  where the gap stops being dead space and becomes a route. Past that the debt is
 *  FLAT, which is the property that actually matters: a term that keeps rising is a
 *  gradient, and a gradient is an instruction.
 *
 *  This is `lib/scene-spec`'s open plan and `lib/layout-score` disagreeing about one
 *  rule, which is exactly what rule 3 says to fix HERE rather than in either of them.
 *  The seeder leaves `WALK_MIN` behind the sofa on purpose so the living and dining
 *  groups have a way past each other, and says so; the wall term then charged 12/m
 *  for the same gap, which was the ENTIRE residual cost of the open preset (11.53 of
 *  13.08, all of it one sofa). `Suggest` answered by pulling that sofa 0.27–0.53 m
 *  back in at every seed — narrowing the route to something too tight to walk down
 *  and too wide to read as flush, then stopping there because the walkway term
 *  outweighed the rest of the gain. Neither end of that is a room anyone asked for.
 *
 *  Flat past a walkway, so there is nothing to descend; and the only route back to
 *  the wall runs across the dead band, where `walkway` (weight 40) costs more per
 *  metre than `wall` (12) gains. */
export function wallDebt(role: Role, back: number): number {
  const gap = Math.max(0, back);
  return FINISHED_BACK.has(role) ? Math.min(gap, WALK_MIN) : gap;
}

/** What a `'by-relation'` piece wants when the thing it belongs to is not in the
 *  room at all.
 *
 *  Without this a lone coffee table has no opinion whatsoever and the solver will
 *  leave it wherever it lands, which is worse than the rule it replaced. A surface
 *  with nothing to serve still reads better off the wall; everything else is free. */
export function fallbackAffinity(role: Role): PlaceAffinity {
  return role === 'coffee-table' || role === 'side-table' ? 'prefers-middle' : 'free';
}

/** Sill height of a window whose part we cannot measure — only used when a window
 *  part carries no usable Y. Ordinary domestic sills sit at about this. */
const DEFAULT_SILL = 0.9;

/** Below this a piece is a step-over rather than an obstacle, and below this it
 *  cannot block a sightline either. Matches `floorBlockers`. */
const OBSTACLE_HEIGHT = 0.25;

// ─── Access zones ───────────────────────────────────────────────────────────

export type ZoneSide = 'front' | 'back' | 'left' | 'right';

/** One thing a piece needs clear, resolved for that piece's actual size.
 *
 *  `sides` + `atLeast` is what makes a bed expressible: a double wants BOTH of
 *  left and right (atLeast 2), a single wants one of them (atLeast 1), and a
 *  dining table wants three of its four (atLeast 3), because pushed against one
 *  wall it still seats people. A rule with `atLeast` below `sides.length` costs
 *  only its best sides — the cheapest ones are the ones it is allowed to lose. */
export type AccessRule = {
  /** Stable, so a finding can be keyed on it: 'front' | 'bedside' | 'seats' | …
   *
   *  A REACT KEY, not a label — and the difference cost a wrong sentence on screen.
   *  `'front'` is shared by seven roles that want their front clear for seven
   *  different reasons, so `lib/clearance.ts` keying its headline off this id
   *  titled a sofa's seat-access finding **"Doors can't open"**. The id is not
   *  wrong; reading it as a name was. Every rule states its own `title` below. */
  id: string;
  /** The finding's headline, in the room report's voice — "Doors can't open",
   *  "No room to get out of the sofa". Authored here beside the depth and the
   *  reason, because a rule that owns the number owns the words about it: the
   *  headline used to live in a lookup table in the consumer, keyed on `id`, where
   *  two rules sharing an id silently shared a sentence. */
  title: string;
  sides: ZoneSide[];
  atLeast: number;
  /** Clear depth out from the face, metres. */
  depth: number;
  /** Share of the face the zone spans, centred. Under 1 so a zone on one side
   *  does not claim the corners its neighbour is measuring. */
  span: number;
  /** A neighbour only counts against this rule if it rises above this world Y.
   *  0 for ordinary floor clearance; a window's sill for a sightline. */
  aboveY: number;
  /** Said in the room report's voice, completing "… needs 60 cm in front —". */
  reason: string;
};

type RuleSpec = (part: Pick<ScenePart, 'shape' | 'dimMM' | 'pos'>) => AccessRule[];

const zone = (
  id: string,
  title: string,
  sides: ZoneSide[],
  depth: number,
  reason: string,
  opts: { atLeast?: number; span?: number; aboveY?: number } = {},
): AccessRule => ({
  id,
  title,
  sides,
  atLeast: opts.atLeast ?? sides.length,
  depth,
  span: opts.span ?? 0.9,
  aboveY: opts.aboveY ?? 0,
  reason,
});

const ACCESS_BY_ROLE: Partial<Record<Role, RuleSpec>> = {
  // Hinged doors and deep drawers: 600 mm is the figure that lets the door past
  // you and your arm past the door.
  wardrobe: () => [zone('front', 'Wardrobe doors can’t open', ['front'], 0.6, 'to open the doors and reach inside', { span: 1 })],
  fridge: () => [zone('front', 'Fridge door can’t open', ['front'], 0.6, 'to open the door and reach inside', { span: 1 })],
  bookshelf: () => [zone('front', 'Can’t stand at the shelves', ['front'], 0.6, 'to stand and read the spines', { span: 1 })],
  'shoe-rack': () => [zone('front', 'No room at the shoe rack', ['front'], 0.45, 'to stand there and put shoes on')],
  appliance: () => [zone('front', 'Can’t reach the front of it', ['front'], 0.5, 'to reach the front of it')],

  // A bed needs a strip you can walk down and make it from. Both sides for a
  // double, because two people get out of it in two directions.
  bed: (p) => [
    zone('bedside', 'Bed hard to get into', ['left', 'right'], 0.5, 'to get in and make the bed', {
      atLeast: p.shape === 'bed-double' ? 2 : 1,
      span: 0.8,
    }),
  ],

  // Every side you might pull a chair out on. Three of four, so a table with one
  // end against a wall is not reported as a fault — that is a real arrangement.
  'dining-table': () => [
    zone('seats', 'No room to pull the chairs out', ['front', 'back', 'left', 'right'], WALK_COMFORT, 'to pull a chair out and sit down', {
      atLeast: 3,
      span: 0.85,
    }),
  ],

  // The desk's front is where the person is. 900 mm covers the chair pushed back
  // plus getting out of it.
  desk: () => [zone('seat', 'No room for the desk chair', ['front'], WALK_COMFORT, 'to pull the chair back and get up', { span: 1 })],
  'office-chair': () => [zone('push-back', 'No room to push the chair back', ['back'], 0.45, 'to push the chair back and stand up', { span: 0.8 })],

  // Enough to stand up out of, and to walk to the far seat.
  sofa: () => [zone('front', 'No room to get out of the sofa', ['front'], 0.35, 'to get to the seat and stand up out of it', { span: 0.9 })],
  armchair: () => [zone('front', 'No room to get out of the chair', ['front'], 0.3, 'to sit down and get up')],

  // A door's leaf sweeps its own width. Modelled as a box rather than the quarter
  // disc it really is: the box is the conservative reading (it contains the disc),
  // and both the checker and the solver can test it with the same overlap maths
  // they use for everything else.
  door: (p) => [
    zone('swing', 'Door can’t open fully', ['front'], p.dimMM[0] / 1000, 'for the door to open', { span: 1 }),
  ],

  // Not a clearance so much as a sightline: a low chest under a window is fine, a
  // wardrobe in front of one is not, and the difference is entirely height.
  window: (p) => [
    zone('light', 'Window is blocked', ['front'], 0.4, 'so the window is not blocked', {
      span: 1,
      // The sill is the window's own bottom edge — wall-mounted parts are centred
      // on their mesh, so that is `y − h/2`. A window with no usable Y (nothing
      // has placed it yet) falls back to an ordinary domestic sill rather than
      // claiming the sill is at the floor, which would make every low chest a
      // blocker.
      aboveY: p.pos[1] > 0 ? Math.max(0.3, p.pos[1] - p.dimMM[2] / 2000) : DEFAULT_SILL,
    }),
  ],
};

/** What this piece needs clear, resolved against its own dimensions. */
export function accessRules(part: Pick<ScenePart, 'category' | 'shape' | 'dimMM' | 'pos'>): AccessRule[] {
  return ACCESS_BY_ROLE[roleOf(part)]?.(part) ?? [];
}

/** One access rule made concrete: the footprints, one per side, that have to stay
 *  clear.
 *
 *  In the piece's own frame, so a rotation carries it and a resize scales it. The
 *  zone for a left/right side has the depth as its X half-extent and the piece's
 *  own depth as its Z one — i.e. the piece's local axes, which is why the zone can
 *  share the piece's `rot` instead of needing one of its own. */
export function accessZones(
  part: Pick<ScenePart, 'category' | 'shape' | 'dimMM' | 'pos'>,
  x: number,
  z: number,
  yaw: number,
): Array<{ rule: AccessRule; side: ZoneSide; foot: Foot }> {
  const hw = part.dimMM[0] / 2000;
  const hd = part.dimMM[1] / 2000;
  const out: Array<{ rule: AccessRule; side: ZoneSide; foot: Foot }> = [];
  for (const rule of accessRules(part)) {
    const half = rule.depth / 2;
    for (const side of rule.sides) {
      let lx = 0;
      let lz = 0;
      let zhw = hw * rule.span;
      let zhd = half;
      if (side === 'front') lz = hd + half;
      else if (side === 'back') lz = -(hd + half);
      else {
        zhw = half;
        zhd = hd * rule.span;
        lx = side === 'right' ? hw + half : -(hw + half);
      }
      const [dx, dz] = localToWorld(yaw, lx, lz);
      out.push({ rule, side, foot: { cx: x + dx, cz: z + dz, hw: zhw, hd: zhd, rot: yaw } });
    }
  }
  return out;
}

/** Pieces that belong in each other's way.
 *
 *  A coffee table standing in the 350 mm in front of a sofa is not blocking the
 *  sofa, it is the reason the sofa is there; a nightstand inside a bed's side
 *  strip is the arrangement working. Without this the two would fight: the
 *  relation table wants them together and the access rule would fine them for it.
 *
 *  Keyed owner → user, and read in both directions by `zoneExempt`. */
const ZONE_GUESTS: Partial<Record<Role, Role[]>> = {
  bed: ['nightstand', 'side-table', 'table-lamp', 'rug', 'ottoman'],
  sofa: ['coffee-table', 'side-table', 'ottoman', 'rug', 'table-lamp'],
  armchair: ['side-table', 'ottoman', 'rug', 'table-lamp'],
  'dining-table': ['dining-chair', 'office-chair', 'rug', 'table-lamp'],
  'coffee-table': ['ottoman', 'side-table', 'rug'],
  desk: ['office-chair', 'dining-chair', 'monitor', 'other'],
  'office-chair': ['desk', 'dining-table', 'rug'],
  'dining-chair': ['dining-table', 'desk', 'rug'],
  window: ['rug', 'plant', 'side-table', 'nightstand', 'table-lamp'],
  door: ['rug'],
};

/** Is `guest` allowed inside `owner`'s access zone? */
export function zoneExempt(owner: Role, guest: Role): boolean {
  return ZONE_GUESTS[owner]?.includes(guest) ?? false;
}

/** Pieces that share the same FLOOR on purpose — a different and much shorter list
 *  than the zone guests above, and confusing the two is a mistake worth naming.
 *
 *  A nightstand is welcome in the strip beside a bed; it is not welcome INSIDE the
 *  bed. A coffee table belongs in the space in front of a sofa, not in the sofa.
 *  Only seating pushed under a surface genuinely occupies the same square metre as
 *  something else, and that is what this is for.
 *
 *  Read symmetrically — the caller does not know which of the two is the surface. */
const FLOOR_SHARERS: Array<[Role, Role[]]> = [
  ['dining-chair', ['dining-table', 'desk']],
  ['office-chair', ['dining-table', 'desk']],
  ['ottoman', ['coffee-table', 'dining-table', 'desk']],
];

export function sharesFloor(a: Role, b: Role): boolean {
  for (const [seat, surfaces] of FLOOR_SHARERS) {
    if (a === seat && surfaces.includes(b)) return true;
    if (b === seat && surfaces.includes(a)) return true;
  }
  return false;
}

/**
 * How far a `sharesFloor` pair may be inside one another before it stops being a
 * chair tucked under a table and becomes a chair standing where the table is.
 *
 * **It lives here, with the predicate, because it is the second half of the same
 * rule and the report and the solver must not answer it separately.** They did.
 * (A third reader of `sharesFloor`, `lib/layout-settle.ts`, deliberately does not
 * consult this at all — see the note at the end.) It was a
 * `TUCKED_CLASH_SHARE` private to `lib/clearance.ts`, and `lib/layout-score.ts`'s
 * overlap term had no threshold at all — a blanket `continue` that exempted the
 * pair however deep it was. So the solver paid *nothing* for burying a dining
 * chair completely inside the dining table, and the room report called the result
 * a clash. The file that owned the number said in a comment that the two "cannot
 * disagree about whether a tucked-in chair is a collision"; they shared the
 * predicate and not the bar, which is a different thing and reads identical.
 *
 * That is exactly the scar rule 3 of `CLAUDE.md` is about — a rule with one
 * consumer's copy of a number in it — and it stayed invisible while the only
 * caller was inertia-anchored, because a repair barely moves anything. Search from
 * a scattered start and it surfaces: 8 of 40 offers over the shuffle pipeline, and
 * 4 of 120 raw solves over a different harness. Both are named at the overlap term
 * in `lib/layout-score.ts`, with what each one counted — they are two experiments,
 * not two readings of one.
 *
 * The value is unchanged from the one `clearance.ts` chose: a chair pushed hard
 * under a table reaches perhaps 60% of its own footprint — measured on the seeded
 * rooms that contain such a pair (`t` and `open`) it is **0.231** — while a chair
 * standing where the table is
 * reaches all of it, and that is still worth saying.
 *
 * `tests/layout-conformance.test.ts` holds the two consumers to it.
 *
 * ── There is a THIRD consumer, and it deliberately does not read this ─────────
 *
 * `lib/layout-settle.ts` keeps its own blanket `sharesFloor` exemption, and that
 * is a decision rather than the same bug left half-fixed. It is not a clash test:
 * its bar is `TOUCH_SHARE` (0.02), deliberately far stricter than the report,
 * because its job on every room open is the cheap guarantee that nothing is inside
 * anything else. Giving it this tolerance would mean a blunt positional push
 * against a pair that is *supposed* to overlap, on every open, to fix a state the
 * solver can no longer produce.
 *
 * What that leaves is narrow and worth stating plainly: a room that already
 * contains a buried pair — an imported scene file, or one saved before this — is
 * not repaired on open. The room report still names it and **Fix** now prices it,
 * so it is reported and actionable rather than silent. If that ever needs closing,
 * close it there and measure what it moves in existing rooms; do not quietly widen
 * this constant's readership to a pass that is answering a different question.
 */
export const TUCKED_CLASH_SHARE = 0.85;

// ─── Functional relations ───────────────────────────────────────────────────
//
// The other half of "what is this for": a nightstand's whole job is to be within
// arm's reach of a pillow, and a coffee table's is to be reachable from the sofa
// without standing up. A layout can satisfy every clearance rule in the book and
// still be wrong because the pieces have been scattered rather than grouped.
//
// After Merrell et al.'s pairwise-distance term: a band [min, max] rather than a
// target, and a cost that is zero inside it and grows outside — so a relation
// says "these belong together" without dictating exactly where.

export type RelationKind =
  /** Face-to-face gap, and `self` should be alongside `anchor`'s side. */
  | 'beside'
  /** Face-to-face gap off `anchor`'s front. */
  | 'in-front'
  /** Centre-to-centre distance, plus `self` turned toward `anchor`. */
  | 'faces'
  /** Centre-to-centre distance only — for a rug under a group, where facing is
   *  meaningless and the gap is negative by design. */
  | 'near';

export type Relation = {
  /** Which spec this came from. Carried so a consumer can tell one OBLIGATION from
   *  another: a piece owes each spec once, over whichever of that spec's anchors
   *  suits it best, and grouping by this id is what turns the table from a
   *  conjunction into a choice. See `relationSpecId`. */
  specId: string;
  kind: RelationKind;
  /** Metres. `min`/`max` are resolved for the actual pair, so a viewing distance
   *  can be a multiple of the screen it is about. */
  min: number;
  max: number;
  /** Relative to the other cost weights in `layout-score`. */
  weight: number;
  reason: string;
};

type RelationSpec = {
  /** Stable, and the identity of the obligation — see `Relation.specId`. */
  id: string;
  self: Role[];
  anchor: Role[];
  kind: RelationKind;
  band: (self: ScenePart, anchor: ScenePart) => [number, number];
  weight: number;
  reason: string;
};

const band = (min: number, max: number) => () => [min, max] as [number, number];

const RELATIONS: RelationSpec[] = [
  {
    id: 'nightstand-bed',
    self: ['nightstand'],
    anchor: ['bed'],
    kind: 'beside',
    band: band(0, 0.15),
    weight: 1,
    reason: 'a nightstand wants to touch the head of the bed',
  },
  {
    id: 'coffee-table-sofa',
    self: ['coffee-table'],
    anchor: ['sofa'],
    kind: 'in-front',
    band: band(0.4, 0.5),
    weight: 1,
    reason: 'close enough to reach from the sofa, far enough to get past',
  },
  {
    id: 'side-table-seat',
    self: ['side-table'],
    anchor: ['sofa', 'armchair'],
    kind: 'beside',
    band: band(0, 0.4),
    weight: 0.5,
    reason: 'within reach of the arm of the chair',
  },
  {
    id: 'lamp-seat',
    self: ['floor-lamp', 'table-lamp'],
    anchor: ['sofa', 'armchair', 'bed'],
    kind: 'beside',
    band: band(0, 0.7),
    weight: 0.4,
    reason: 'a reading lamp belongs beside the seat it lights',
  },
  {
    // 600 mm is the figure a chair-at-a-table rule wants: further and the chair is
    // not at the table, nearer and it is under it, which is also fine.
    id: 'chair-table',
    self: ['dining-chair', 'office-chair'],
    anchor: ['dining-table', 'desk'],
    kind: 'in-front',
    band: band(0, 0.6),
    weight: 0.9,
    reason: 'a chair belongs at the table it is for',
  },
  {
    id: 'ottoman-seat',
    self: ['ottoman'],
    anchor: ['sofa', 'armchair'],
    kind: 'in-front',
    band: band(0.15, 0.7),
    weight: 0.4,
    reason: 'a footstool wants to be within a leg’s reach',
  },
  {
    // The viewing distance is a property of the SCREEN, so it is computed from
    // the screen — 1.2–2.5 × the diagonal, the same rule the room report states.
    id: 'seat-tv',
    self: ['sofa', 'armchair'],
    anchor: ['tv'],
    kind: 'faces',
    band: (_self, tv) => {
      const diag = Math.hypot(tv.dimMM[0], tv.dimMM[2]) / 1000;
      return [diag * 1.2, diag * 2.5];
    },
    weight: 0.9,
    reason: 'comfortable viewing distance for a screen this size',
  },
  {
    id: 'armchair-sofa',
    self: ['armchair'],
    anchor: ['sofa'],
    kind: 'faces',
    band: band(1.2, 2.6),
    weight: 0.6,
    reason: 'close enough to talk across without raising your voice',
  },
  {
    id: 'rug-group',
    self: ['rug'],
    anchor: ['sofa', 'bed', 'dining-table'],
    kind: 'near',
    band: band(0, 0.8),
    weight: 0.5,
    reason: 'a rug anchors the group it sits under',
  },
  {
    id: 'desk-window',
    self: ['desk'],
    anchor: ['window'],
    kind: 'beside',
    band: band(0, 1.5),
    weight: 0.3,
    reason: 'daylight across the desk rather than into your eyes',
  },
];

/** The relation `self` has to `anchor`, if any — resolved for this actual pair.
 *
 *  One relation per ordered pair: the first spec that matches wins. Two DIFFERENT
 *  specs can still both apply to one piece — an armchair owes "face the screen" and
 *  "sit across from the sofa", which are separate obligations — and they stay
 *  separate because they carry different `specId`s. What must not happen is one
 *  spec being owed several times over because it lists several anchors; that is what
 *  `relationOptions` is for. */
export function relationFor(self: ScenePart, anchor: ScenePart): Relation | null {
  const a = roleOf(self);
  const b = roleOf(anchor);
  for (const spec of RELATIONS) {
    if (!spec.self.includes(a) || !spec.anchor.includes(b)) continue;
    const [min, max] = spec.band(self, anchor);
    if (!(max > 0)) continue;
    return { specId: spec.id, kind: spec.kind, min, max, weight: spec.weight, reason: spec.reason };
  }
  return null;
}

/** The gap a spec asks for, when it asks for the same one of every pair — read by the
 *  SEEDER, which has to choose a spot that satisfies a relation before the two pieces
 *  exist as a pair to resolve it against.
 *
 *  Null for the bands that are genuinely per-pair: a viewing distance is a multiple of
 *  the screen it is about, so there is no one answer to give.
 *
 *  This exists because the alternative is the copy rule 3 forbids. The seeder used to
 *  stand a floor lamp at `sofaHalf + 0.3`, with a comment saying *"lamp-seat wants a
 *  0-0.7 m gap"* — a hand-typed restatement of a number that lives here, three files
 *  away, and free to move without it. That drifts in the direction nobody notices: the
 *  rule changes, the seeder does not, and the starter room quietly stops satisfying a
 *  relation it is still being scored against. */
export function fixedBand(specId: string): [number, number] | null {
  const spec = RELATIONS.find((r) => r.id === specId);
  if (!spec) return null;
  // A constant band ignores its arguments, so calling it with two different pairs and
  // getting the same answer is the test for whether there IS one answer. Cheap, and it
  // cannot go stale the way a hand-kept list of "the constant ones" would.
  const a = spec.band(PROBE_A, PROBE_B);
  const b = spec.band(PROBE_B, PROBE_A);
  return a[0] === b[0] && a[1] === b[1] ? a : null;
}

/** Two differently-sized stand-ins, so `fixedBand` can tell a constant band from one
 *  resolved out of the pair. Never placed, never scored — only measured. */
const PROBE_A = { dimMM: [1000, 1000, 1000], shape: 'sofa' } as unknown as ScenePart;
const PROBE_B = { dimMM: [2500, 400, 1400], shape: 'tv' } as unknown as ScenePart;

/** Every obligation `self` has, each with all the anchors that could discharge it.
 *
 *  The fix for the single largest source of nonsense in a suggestion. `RELATIONS`
 *  lists a rug's anchors as `['sofa', 'bed', 'dining-table']`, meaning *a rug goes
 *  under a group* — but a consumer that walks pairs reads it as *a rug goes under
 *  every group*, and charges the rug for not being under the dining table it is not
 *  under. Measured on the seeded T room: `rug → sofa` cost 0 at 0.61 m, and
 *  `rug → dining-table` cost **38.3** at 3.57 m, which was the whole of that room's
 *  relation term. The solver's answer was to drag the rug out from under the sofa
 *  to a point between the two groups, 1.36–2.28 m depending on the seed. The floor
 *  lamp went the same way, for the same reason, on the L.
 *
 *  A rug is under one group and a lamp is beside one seat. So the anchors of a spec
 *  are ALTERNATIVES: group them, and let the consumer take the best one. */
export function relationOptions(
  self: ScenePart,
  candidates: ScenePart[],
): Array<{ specId: string; options: Array<{ anchor: number; rel: Relation }> }> {
  // The band is resolved PER PAIR — a viewing distance is a multiple of the screen
  // it is about — so each option carries its own resolved relation rather than the
  // group carrying one for all of them. Two screens of different sizes in one room
  // is unusual and would otherwise be scored against whichever was found first.
  const groups = new Map<string, { specId: string; options: Array<{ anchor: number; rel: Relation }> }>();
  for (let j = 0; j < candidates.length; j++) {
    if (candidates[j] === self) continue;
    const rel = relationFor(self, candidates[j]);
    if (!rel) continue;
    const g = groups.get(rel.specId);
    if (g) g.options.push({ anchor: j, rel });
    else groups.set(rel.specId, { specId: rel.specId, options: [{ anchor: j, rel }] });
  }
  return [...groups.values()];
}

/** May these two legitimately sit closer together than a walkway?
 *
 *  The question a circulation rule has to ask before calling a gap a pinch. The band
 *  above puts a coffee table 400–500 mm off the sofa; the 600 mm walkway rule read
 *  that same 450 mm as a pinch, so the room report warned about the one arrangement
 *  this table asks for — on every living room the app has ever seeded. The gap between
 *  a sofa and ITS coffee table, or a bed and ITS nightstand, is the arrangement
 *  working, not a route someone would try to squeeze down. `ZONE_GUESTS` makes the
 *  same point about access zones; this makes it about walkways.
 *
 *  It is the BAND that answers, not the mere existence of a relation. An armchair
 *  facing a sofa is a relation whose band starts at 1.2 m — the two are supposed to
 *  have room between them, so 300 mm there is a genuine pinch and the report should
 *  say so. Exempting every related pair silenced exactly that, along with a sofa
 *  crowding the screen it faces. Only a relation that PERMITS a sub-walkway gap
 *  (`min < WALK_MIN`) grants the exemption. */
export function belongTogether(a: ScenePart, b: ScenePart): boolean {
  return maySnug(relationFor(a, b)) || maySnug(relationFor(b, a));
}

function maySnug(rel: Relation | null): boolean {
  return rel !== null && rel.min < WALK_MIN;
}

// ─── Reading the room ───────────────────────────────────────────────────────


export type RoomProfile = {
  /** The piece the room is arranged around, by index into the parts array, or
   *  null when nothing in here is big enough to be one. Settling it first is what
   *  makes a hierarchical solve behave: a bed's position decides a bedroom, and
   *  optimising it jointly with two nightstands spends the budget on nightstands. */
  anchor: number | null;
  /** Indices worth facing — a screen, a table. */
  focals: number[];
  /** Doors and windows, which belong to the walls and never move. */
  apertures: number[];
};

/** Which roles can be the piece a room is arranged around, in priority order — a
 *  room with a bed in it is arranged around the bed even if there is also a sofa.
 *
 *  The order is the point, and it used to be decoration. This list also produced a
 *  `kind` field ('bedroom', 'living', …) that nothing read, and the ANCHOR was chosen
 *  by footprint area across all four roles at once — so a 2200 × 950 sofa (2.09 m²)
 *  outranked a 1900 × 1000 single bed (1.90 m²) and the profile came back saying the
 *  room was a bedroom arranged around the sofa. Harmless while `anchor` had no reader.
 *  It has one now (`solveLayout`'s first pass), so rank decides first and area only
 *  breaks ties within a rank — two sofas, the bigger one. */
const ANCHOR_ROLES: Role[] = ['bed', 'sofa', 'dining-table', 'desk'];

const FOCAL_ROLES = new Set<Role>(['tv', 'dining-table', 'coffee-table']);
const APERTURE_ROLES = new Set<Role>(['door', 'window']);

/** What a room is arranged around, what is worth facing in it, and where its
 *  openings are. Everything the score needs that is a property of the whole room
 *  rather than of one piece. */
export function roomProfile(parts: ScenePart[]): RoomProfile {
  const focals: number[] = [];
  const apertures: number[] = [];
  let anchor: number | null = null;
  let anchorRank = ANCHOR_ROLES.length;
  let anchorArea = 0;

  for (let i = 0; i < parts.length; i++) {
    const role = roleOf(parts[i]);
    if (APERTURE_ROLES.has(role)) apertures.push(i);
    if (FOCAL_ROLES.has(role)) focals.push(i);
    const rank = ANCHOR_ROLES.indexOf(role);
    if (rank < 0) continue;
    const area = (parts[i].dimMM[0] / 1000) * (parts[i].dimMM[1] / 1000);
    if (rank < anchorRank || (rank === anchorRank && area > anchorArea)) {
      anchorRank = rank;
      anchorArea = area;
      anchor = i;
    }
  }
  return { anchor, focals, apertures };
}

/** Where a person entering through this door arrives, and how wide their route
 *  in has to be.
 *
 *  Separate from the swing zone: a door that opens fine into a room you then
 *  cannot walk out of is still a room you cannot walk out of. The path runs from
 *  the doorway along the wall's inward normal, at least as wide as the leaf,
 *  because that is the width of the hole people come through. */
export function doorPath(
  door: Pick<ScenePart, 'dimMM' | 'pos' | 'rot'>,
  width: number,
  depth = 1.2,
): Foot {
  const w = Math.max(width, door.dimMM[0] / 1000);
  const [dx, dz] = localToWorld(door.rot, 0, depth / 2);
  return { cx: door.pos[0] + dx, cz: door.pos[2] + dz, hw: w / 2, hd: depth / 2, rot: door.rot };
}

/** Shapes nothing is damaged by standing inside: a rug you walk over, a curtain you
 *  push a nightstand against. **Not** "small" and not "thin" — a soundbar is both and
 *  is emphatically solid. The test is whether the two pieces occupying one patch of
 *  floor is an ordinary arrangement somebody would choose on purpose.
 *
 *  A `Set<Shape>` rather than a `Partial<Record<Shape, boolean>>`, and that is the
 *  shape-contract lesson rather than a style choice: a partial table lets a new shape
 *  inherit its category's answer in silence, and the silent answer here would be the
 *  dangerous one — a new soft furnishing would come out solid, which reads as the app
 *  refusing an ordinary drag. Membership is explicit; absence means solid, which is
 *  the direction that fails loudly.
 *
 *  ── Why a curtain is in it ──────────────────────────────────────────────────
 *
 *  It was not, and `collidesAt` exempted only rugs, so **the drag refused to put
 *  anything in front of a curtain**. Measured against the shipped presets rather than
 *  reasoned about: four pairs the seeder itself creates are inside a curtain — the
 *  `l` room's bookshelf, and the `u` room's wardrobe, nightstand and bedside lamp.
 *  Every one of them is a state the app loads and the user cannot re-create by
 *  dragging, which is the same class `visual-check.md` keeps recording. The curtain
 *  is modelled with about 110 mm of depth standing off the wall, so anything with its
 *  back to that wall is inside it by construction.
 *
 *  Read by BOTH the drag (`collidesAt`) and the room report's mounted-clash rule, so
 *  the two cannot come to different answers about the same pair — which is the fault
 *  § 17 was filed for, one layer down. */
const SOFT_SHAPES: ReadonlySet<Shape> = new Set<Shape>(['rug', 'curtain']);

/** Whether a piece is soft — see `SOFT_SHAPES`.
 *
 *  Takes the CATEGORY too, because `rug` was a category test everywhere it appeared
 *  and a room saved before the shape existed can carry `category: 'rug'` with some
 *  other shape on it. Widening a "does this obstruct" answer toward *not* obstructing
 *  is the forgiving direction: the failure is a drag that goes through a rug, not one
 *  that is refused for no visible reason. */
export function isSoftFurnishing(part: { category: Category; shape: Shape }): boolean {
  return part.category === 'rug' || SOFT_SHAPES.has(part.shape);
}

/** The pieces that get in a walker's way — floor-standing, solid, tall enough to
 *  stop someone. The same set `lib/clearance.ts` reports on, as a predicate so the
 *  solver can build the mask once per solve. */
export function isObstacle(part: ScenePart): boolean {
  return (
    !part.wallMounted &&
    roleOf(part) !== 'rug' &&
    part.pos[1] < 0.05 &&
    part.dimMM[2] / 1000 > OBSTACLE_HEIGHT
  );
}

/** A part's footprint at a given placement — the one-liner every consumer of this
 *  module needs, kept here so nobody has to remember that `dimMM` is millimetres
 *  and `pos` is `[x, y, z]`. */
export function footAt(part: ScenePart, x: number, z: number, yaw: number): Foot {
  return footFromPart([x, part.pos[1], z], yaw, part.dimMM, part.circle);
}

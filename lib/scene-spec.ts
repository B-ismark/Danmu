// Scene spec — single source of truth for parts in the 3D + 2D views.
// Either default (hand-curated demo room) or built from AI detections across all 4 wall captures.

import { ROOM } from './parts-catalog';
import {
  footprintForLayout,
  clampIntoFootprint,
  pointInFootprint,
  type Footprint,
  type LayoutId,
} from './footprint';
import {
  anchorFor,
  groundY,
  isFloorStanding,
  wallAffinity,
  snapToWall,
  pullToward,
  findSupportUnder,
  isTabletopProne,
} from './physics';
import type { CaptureSlot, RoomData } from './storage';
import { clampDims } from './dimension-ranges';
import {
  footArea,
  footFromPart,
  footInsidePoly,
  footIntersectionArea,
  footOverlap,
  localToWorld,
  obbGap,
  worldToLocal,
  type Poly,
} from './geometry';
import { backWall, baySides, roomBays, splitBay, type Bay } from './room-bays';
import { belongTogether, isObstacle, roleOf, sharesFloor, WALK_COMFORT, WALK_MIN, WALL_GAP } from './layout-rules';
import { settleParts } from './layout-settle';

// The shape / category / decor vocabularies are written as `as const` arrays with
// the union DERIVED from each, rather than as hand-written unions.
//
// The type is what the compiler checks; the array is what code can check at
// RUNTIME, and `lib/scene-file.ts` needs the second kind: an imported file is a
// stranger's JSON, and "is this a shape we can render" is a question no type can
// answer once the value is already in memory. The alternative — a union plus a
// separate `Set` of the same strings — is a pair that drifts, and it would drift
// silently in the direction that matters, a validator quietly refusing a shape the
// app grew last week. `CATALOG_SHAPES_ORDERED` below is deliberately NOT that list:
// it is the catalog's running order and omits `closet` and the three primitives.
export const SHAPES = [
  'sofa', 'tv', 'closet', 'rug', 'plant',
  // chairs
  'chair-dining', 'chair-office', 'chair-armchair', 'ottoman',
  // beds
  'bed-single', 'bed-double',
  // tables / desks
  'desk-standard', 'desk-l', 'coffee-table', 'side-table', 'nightstand',
  // lamps
  'lamp-floor', 'lamp-table', 'lamp-pendant',
  // wall-hung
  'mirror', 'mirror-oval', 'painting', 'ac-unit', 'window',
  // others
  'monitor', 'laptop', 'fan', 'fridge', 'wardrobe', 'curtain',
  'bookshelf', 'shoe-rack', 'door',
  // appliances
  'soundbar', 'radiator', 'air-purifier', 'washing-machine', 'microwave', 'water-dispenser',
  'box', 'cylinder', 'plane',
] as const;
export type Shape = (typeof SHAPES)[number];

// Decor collection — small props the user can add to / remove from a furniture
// surface. Positions are local-metre offsets from the part centre.
export const DECOR_KINDS = ['books', 'vase', 'plant', 'bowl', 'candle'] as const;
export type DecorKind = (typeof DECOR_KINDS)[number];
export type DecorItem = { id: string; kind: DecorKind; x: number; z: number };

/** Surface sheen, overriding each shape's hand-tuned default. `auto` restores it. */
export const FINISHES = ['auto', 'matte', 'satin', 'polished', 'metal'] as const;
export type Finish = (typeof FINISHES)[number];

// ─── Light emission ─────────────────────────────────────────────────────────
// A lamp described the way a lamp on a shelf is described. Until this existed,
// every "light" in the scene was an emissive material: the fixture LOOKED lit and
// emitted nothing, so switching to the Evening mood darkened a room while the
// floor lamp standing in it contributed exactly nothing.
//
// Units are real (see lib/light-units.ts) so two lamps relate correctly to each
// other. Where the bulb physically sits inside each shape belongs with that
// shape's geometry, not here — see LIGHT_ANCHORS in components/three/PartLight.tsx.

export type PartLight = {
  /** Luminous flux off the box. 800 lm is the usual "60 W equivalent". */
  lumens: number;
  /** Colour temperature. 2700 K is a warm domestic bulb, 6500 K daylight. */
  kelvin: number;
  /** Full cone angle in degrees for a shaded downward fixture. Omitted means a
   *  bare bulb radiating in every direction. */
  coneDeg?: number;
};

/** What each fixture emits when the user has not said otherwise. Values are
 *  ordinary domestic bulbs, not stage lighting. */
const LIGHT_BY_SHAPE: Partial<Record<Shape, PartLight>> = {
  'lamp-table': { lumens: 400, kelvin: 2700 },
  'lamp-floor': { lumens: 800, kelvin: 2700 },
  // A pendant's shade aims the light down rather than making more of it.
  'lamp-pendant': { lumens: 900, kelvin: 3000, coneDeg: 110 },
};

/** The light a part emits: the user's override, else the shape's default, else
 *  none. Most furniture is not a lamp. */
export function lightFor(part: Pick<ScenePart, 'shape' | 'light'>): PartLight | null {
  return part.light ?? LIGHT_BY_SHAPE[part.shape] ?? null;
}

/** True for shapes that are fixtures — the Inspector shows lighting controls for
 *  these and nothing else. */
export function isLightFixture(shape: Shape): boolean {
  return shape in LIGHT_BY_SHAPE;
}

/** Derived-from-array for the same reason as `SHAPES` above. */
export const CATEGORIES = [
  'sofa', 'tv', 'chair', 'table', 'lamp', 'plant', 'shelf', 'rug',
  'bed', 'desk', 'monitor', 'fan', 'fridge', 'wardrobe', 'curtain',
  'mirror', 'painting', 'nightstand', 'ottoman', 'ac', 'door',
  'other',
] as const;
export type Category = (typeof CATEGORIES)[number];

export type ScenePart = {
  id: string;
  category: Category;
  name: string;
  shape: Shape;
  /** default scene transform — overridable via studio store */
  pos: [number, number, number];
  rot: number;
  dimMM: [number, number, number];
  /** locked = preserved from photo (blue tint). false = new build (orange/dashed). */
  locked: boolean;
  /** circular footprint in plan */
  circle?: boolean;
  /** wall-mounted */
  wallMounted?: boolean;
  /** original detection bbox if scene came from detection */
  fromDetection?: { slot: CaptureSlot; bbox: [number, number, number, number]; conf: number };
  /** Body colour (#rrggbb). From photo sampling on detection, or the user's
   *  recolour. When absent the renderer falls back to the per-shape default. */
  color?: string;
  /** Surface finish (sheen). Overrides material roughness/metalness on the
   *  part's meshes via Draggable's FinishApplier. 'auto' / undefined keeps each
   *  shape's hand-tuned default. */
  finish?: Finish;
  /** User-managed decor collection placed on the part's top surface. When
   *  undefined, an auto-suggested arrangement is shown; once the user edits it
   *  this array (possibly empty) takes over. See components/three/Dressing.tsx. */
  decor?: DecorItem[];
  /** What this fixture emits, overriding the per-shape default. Absent means the
   *  default for its shape (see `lightFor`), which for anything that is not a
   *  lamp is no light at all. */
  light?: PartLight;
  /** group id — parts sharing one move together (multi-select merge). */
  groupId?: string;
  /** Reference into the local mesh cache (lib/mesh-cache.ts). When set, the 3D
   *  scene renders the cached GLB instead of the primitive shape. */
  meshHash?: string;
};

// ─── Default scene (used until detection runs) ────────────────────────────
//
// The starter furniture a brand-new room opens with, and the first thing anyone
// sees of this product.
//
// It used to be written against the footprint's BOUNDING BOX — `±width/2`,
// `±depth/2` — and a bounding box is not a room. Every non-rectangular preset
// therefore furnished the void its own walls cut away: the L-shape's entire
// reading nook (armchair, side table) plus its floor lamp stood outside the room in
// mid-air, the U put the bed and both nightstands in its north notch, and the T put
// the sofa, the coffee table and the rug off the side of its stem. Five of the L's
// nine pieces were outside the house.
//
// So nothing here is authored in room coordinates any more. `lib/room-bays.ts`
// finds the rectangles of floor the room actually HAS, `backWall` picks the wall
// each group works off, and every piece is placed in that wall's own frame — `u`
// along it, `v` out from it. A rectangle gets one bay and reads exactly as it did
// before; an L gets its long leg and its wing; a custom footprint the user dragged
// into some shape nobody anticipated gets whatever it has.
//
// Two rules hold every piece placed here:
//
//   · **It must fit.** A piece is only kept if its whole footprint lands inside the
//     room and clear of what is already there. Nothing is ever shrunk to fit — a
//     one-metre room gets a plant and no sofa, which is the honest answer, and
//     `lib/clearance.ts` says the rest.
//   · **The numbers are the shared ones.** Gaps come from `lib/layout-rules.ts`'s
//     bands (450 mm sofa-to-table, a nightstand touching the bed), sizes go through
//     `clampDims`, and heights through `groundY`. The seed and the room report
//     cannot disagree, because they read the same table.
//
// Nothing is locked — it is all a starting point the user edits.

/** A place to arrange things: a wall, and the coordinates of that wall. `u` runs
 *  along it (0 = its middle), `v` out from it into the room (0 = the wall face). */
type SeedFrame = {
  /** The yaw that makes a part's front face into the room from this wall. */
  yaw: number;
  /** Inward normal, so a cluster can tell two frames apart. */
  nx: number;
  nz: number;
  /** Wall length, and how far the bay reaches from it. */
  width: number;
  depth: number;
  onWall: boolean;
  /** Midpoint of the wall — the frame's origin, so a world position can be read
   *  back as `(u, v)`. */
  mx: number;
  mz: number;
  at: (u: number, v: number) => [number, number];
};

/** Gap left between a piece and the wall behind it — `layout-rules`' figure, so a
 *  seeded piece, a user-snapped one and a settled one land in the same place. The
 *  local alias is kept because it reads at every one of its fifteen call sites
 *  below. */
const SEED_WALL_GAP = WALL_GAP;

/** Share of the smaller footprint two seeded pieces may share before the placement
 *  is refused. A seeding epsilon for floating-point contact, NOT the room report's
 *  collision bar — see `seats`. */
const SEED_TOUCH_SHARE = 0.02;

/** How far a dining chair is pushed under the table. Seating tucked under a work
 *  surface is what `sharesFloor` is about — and it is how a laid table looks. */
const CHAIR_TUCK = 0.12;

/** The three-seater the living group is built around. Named because two different
 *  decisions read it: what to place, and how much wall a room needs before that
 *  wall can hold it. */
const SOFA: [number, number, number] = [2200, 950, 880];

/** Real panel sizes, largest first — the same entries the Add-model picker offers.
 *
 *  A shallow room gets a SMALLER SET, never a shrunken one. `layout-rules` puts
 *  comfortable viewing at 1.2–2.5 × the diagonal, which is a property of the screen,
 *  so the honest way to satisfy it in a 2.1 m-deep bay is to choose a screen whose
 *  diagonal suits 2.1 m. Scaling the 65″ down would make the room *look* right and
 *  every measurement in it a lie. */
const SCREENS: Array<{ name: string; dimMM: [number, number, number] }> = [
  { name: 'TV · 65″', dimMM: [1450, 60, 820] },
  { name: 'TV · 55″', dimMM: [1230, 60, 710] },
  { name: 'TV · 43″', dimMM: [970, 60, 570] },
];

/** The biggest screen a given viewing distance can seat someone in front of. Falls
 *  back to the smallest — a room too shallow even for that keeps a real 43″ set and
 *  lets the room report say the seat is close, which is true and fixable by moving
 *  the sofa, unlike a fake dimension. */
function screenFor(distance: number): { name: string; dimMM: [number, number, number] } {
  for (const s of SCREENS) {
    const diag = Math.hypot(s.dimMM[0], s.dimMM[2]) / 1000;
    if (distance >= diag * 1.2) return s;
  }
  return SCREENS[SCREENS.length - 1];
}

/** The bay's sides as frames, best wall first. */
function seedFrames(bay: Bay, poly: Footprint, wantDepth?: number): SeedFrame[] {
  const sides = baySides(bay, poly);
  const best = backWall(sides, wantDepth);
  // A bay split out of the middle of an open plan touches no wall on its cut side;
  // it still has a longest axis, and something has to face down it.
  const ordered = [...sides].sort((a, b) => {
    if (a.onWall !== b.onWall) return a.onWall ? -1 : 1;
    if (a === best) return -1;
    if (b === best) return 1;
    return b.depth - a.depth || b.length - a.length;
  });
  return ordered.map((s) => ({
    yaw: s.yaw,
    nx: s.nx,
    nz: s.nz,
    width: s.length,
    depth: s.depth,
    onWall: s.onWall,
    mx: s.mx,
    mz: s.mz,
    at: (u: number, v: number) => {
      const [dx, dz] = localToWorld(s.yaw, u, v);
      return [s.mx + dx, s.mz + dz] as [number, number];
    },
  }));
}

/** A frame perpendicular to `f` — the side wall a wardrobe wants when the bed has
 *  taken the back one. */
function crossFrame(frames: SeedFrame[], f: SeedFrame): SeedFrame | undefined {
  return frames.find((c) => c.onWall && Math.abs(c.nx * f.nx + c.nz * f.nz) < 0.1);
}

/** How far a candidate spot is from a piece already placed. */
function spotDistance(frame: SeedFrame, spot: { u: number; v: number }, from: ScenePart): number {
  const [x, z] = frame.at(spot.u, spot.v);
  return Math.hypot(x - from.pos[0], z - from.pos[2]);
}

/** Clear wall a piece of this width needs before that wall can hold it. */
const wallFor = (widthMM: number) => widthMM / 1000 + 0.2;

/** Past this, more depth is not a better living room — it is a sofa too far from
 *  the screen. The top of the largest catalog screen's comfortable band plus the
 *  sofa, so the term stops rewarding depth exactly where the viewing rule does. */
const VIEW_DEPTH_ENOUGH = 3.3;

/** The wall to hang a screen on: one long enough for the sofa to stand against the
 *  other end of the bay, and of those, the one with enough depth to back away and
 *  the most wall to arrange along.
 *
 *  Rotating the group is free and the room report cares a great deal — a bay's short
 *  wall can offer twice the viewing distance of its long one. But depth is a
 *  requirement, not a maximand: picking the deepest wall outright put a 6 m room's
 *  sofa on the short wall, 5.4 m from the screen, which the report reads as too FAR.
 *  Where no wall can hold the sofa, `null` hands the choice back to the default
 *  ordering, which at least puts the screen on a real wall. */
function viewingWall(frames: SeedFrame[], sofaDepthMM: number): SeedFrame | null {
  let best: SeedFrame | null = null;
  let bestScore = -Infinity;
  for (const f of frames) {
    if (!f.onWall) continue;
    if (f.width < wallFor(SOFA[0])) continue;
    // Depth has to seat the sofa at all before it is worth comparing.
    if (f.depth < sofaDepthMM / 1000 + 0.3) continue;
    const score = Math.min(f.depth, VIEW_DEPTH_ENOUGH) * 2 + f.width;
    if (score > bestScore) {
      bestScore = score;
      best = f;
    }
  }
  return best;
}

/** How far a group could sit from a screen in this bay — the depth of the wall the
 *  living group would actually use. What decides which bay a living room gets. */
function viewingDepth(bay: Bay, poly: Footprint): number {
  const f = viewingWall(seedFrames(bay, poly), SOFA[1]);
  return f ? Math.min(f.depth, VIEW_DEPTH_ENOUGH) : 0;
}

/** The side facing the one given — where a sofa backed against `f`'s far end ends
 *  up. Whether THAT is a wall or an opening onto the rest of the room decides
 *  whether a route has to be left behind the sofa. */
function oppositeFrame(frames: SeedFrame[], f: SeedFrame): SeedFrame | undefined {
  return frames.find((c) => c.nx * f.nx + c.nz * f.nz < -0.9);
}

export function defaultScene(
  layoutId: LayoutId = 'rect',
  w: number = ROOM.width,
  d: number = ROOM.depth,
  opts: { footprint?: Footprint; height?: number } = {},
): ScenePart[] {
  const poly: Footprint =
    opts.footprint && opts.footprint.length >= 3 ? opts.footprint : footprintForLayout(layoutId, w, d);
  const height = opts.height ?? ROOM.height;
  const bays = roomBays(poly, { max: 2, minSide: 0.9, minArea: 1.2 });
  if (bays.length === 0) return [];

  const parts: ScenePart[] = [];
  const counters: Record<string, number> = {};

  /** Place one piece in a frame, or don't. Returns null when the piece would end up
   *  outside the room or inside something already placed — the caller can then try
   *  another spot, or do without. The id counter only advances on a piece that was
   *  actually kept, so ids stay dense. */
  const place = (
    category: Category,
    name: string,
    shape: Shape,
    dimMM: [number, number, number],
    frame: SeedFrame,
    u: number,
    v: number,
    opt: { turn?: number; extra?: Partial<ScenePart>; keepClear?: boolean } = {},
  ): ScenePart | null => {
    const dim = clampDims(category, shape, dimMM);
    const [x, z] = frame.at(u, v);
    const candidate: ScenePart = {
      id: '',
      category,
      name,
      shape,
      pos: [x, groundY(category, shape, dim, height), z],
      rot: frame.yaw + (opt.turn ?? 0),
      dimMM: dim,
      locked: false,
      ...opt.extra,
    };
    if (!seats(candidate, parts, poly)) return null;
    if (opt.keepClear && pinches(candidate, parts)) return null;
    counters[category] = (counters[category] ?? 0) + 1;
    candidate.id = `${category}-${counters[category]}`;
    parts.push(candidate);
    return candidate;
  };

  /** The first of several spots that works.
   *
   *  `away` reorders the candidates furthest-first from a point — how a bookshelf
   *  ends up at the far end of the wall from the armchair rather than 340 mm from
   *  its side table, which is a gap the room report calls a tight walkway and is
   *  right to. Spacing is not something a fit test can see. */
  const placeSomewhere = (
    category: Category,
    name: string,
    shape: Shape,
    dimMM: [number, number, number],
    frame: SeedFrame,
    spots: Array<{ u: number; v: number; turn?: number }>,
    extra: Partial<ScenePart> = {},
    away?: ScenePart | null,
    keepClear = false,
  ): ScenePart | null => {
    const ordered = away
      ? [...spots].sort((a, b) => spotDistance(frame, b, away) - spotDistance(frame, a, away))
      : spots;
    for (const s of ordered) {
      const hit = place(category, name, shape, dimMM, frame, s.u, s.v, { turn: s.turn, extra, keepClear });
      if (hit) return hit;
    }
    return null;
  };

  // ── Living room: a screen on the wall, a sofa the right distance from it ───
  const living = (bay: Bay, opt: { routeBehind?: boolean } = {}) => {
    const frames = seedFrames(bay, poly);
    const f = viewingWall(frames, SOFA[1]) ?? frames[0];

    const sofaDim = SOFA;
    const sofaHalf = sofaDim[1] / 2000;
    // Backed onto the far side of the bay — unless another group is on the other
    // side of that edge, in which case a route comes first. Circulation outranks
    // screen size here for the same reason it does in `layout-score`'s weights: a
    // walkway you cannot use is a worse room than a screen one size down. In the
    // T-shape this is the whole difference — 25 cm between the sofa's back and a
    // dining chair, or 60 cm and a 43″ set.
    const behind = opt.routeBehind && !oppositeFrame(frames, f)?.onWall ? WALK_MIN : SEED_WALL_GAP;
    const vSofa = Math.max(sofaHalf + SEED_WALL_GAP, f.depth - sofaHalf - behind);
    // The screen is CHOSEN, not scaled: the biggest panel in the catalog whose own
    // 1.2 × diagonal minimum fits the distance this wall can actually offer. A 43″
    // set in a shallow room is a different product, not a 65″ one drawn small — the
    // same distinction as a single bed instead of a double.
    const screen = screenFor(vSofa - 0.06);
    place('tv', screen.name, 'tv', screen.dimMM, f, 0, 0.06, { extra: { wallMounted: true } });
    const sofa = place('sofa', 'Sofa', 'sofa', sofaDim, f, 0, vSofa, { turn: Math.PI });

    // 450 mm off the sofa — the middle of layout-rules' reach-from-the-seat band —
    // but never through the screen wall behind it. Pulling the sofa forward for a
    // route (above) walks the table toward that wall, and in the T's stem it walked
    // 20 mm past it: the gap the relation wants is not always a gap the room has, and
    // the wall wins. The 400 mm end of the band absorbs the difference.
    const tableDim: [number, number, number] = [1100, 600, 420];
    const tableHalf = tableDim[1] / 2000;
    const vTable = Math.max(tableHalf + SEED_WALL_GAP, vSofa - sofaHalf - 0.45 - tableHalf);
    const table = place('table', 'Coffee table', 'coffee-table', tableDim, f, 0, vTable);

    // A rug under whichever of the two got placed, anchoring the group.
    if (sofa) place('rug', 'Area rug', 'rug', [2400, 1600, 5], f, 0, table ? (vSofa + vTable) / 2 : vSofa - 0.4);

    // A plant in the corner by the screen — but only where it is not in the way of
    // anything. It is the one piece here that is pure filler: it has no relation to
    // the group, so a walkway it narrows is a walkway narrowed for nothing, and a
    // narrow bay is better off without it than with a tight-passage finding. Tried at
    // both ends, furthest from the sofa first.
    placeSomewhere(
      'plant',
      'Plant',
      'plant',
      [400, 400, 1600],
      f,
      [
        { u: -(f.width / 2 - 0.4), v: 0.4 },
        { u: f.width / 2 - 0.4, v: 0.4 },
        { u: -(f.width / 2 - 0.4), v: f.depth - 0.4 },
      ],
      { circle: true },
      sofa,
      true,
    );
    // Beside the sofa, at either end — and never in FRONT of it. A fallback spot at
    // `vSofa − 0.6` used to land the lamp inside the sofa's own 350 mm stand-up zone
    // in a narrow bay, which the room report then reported: "Sofa has 0 cm in front".
    // A floor lamp is not one of the sofa's zone guests, and it should not be.
    placeSomewhere(
      'lamp',
      'Floor lamp',
      'lamp-floor',
      [300, 300, 1700],
      f,
      [
        { u: f.width / 2 - 0.25, v: vSofa },
        { u: -(f.width / 2 - 0.25), v: vSofa },
        { u: sofaDim[0] / 2000 + 0.3, v: vSofa },
        { u: -(sofaDim[0] / 2000 + 0.3), v: vSofa },
      ],
      { circle: true },
    );
  };

  // ── Dining: a table off the middle of the bay, chairs tucked under it ──────
  const dining = (bay: Bay) => {
    const f = seedFrames(bay, poly)[0];
    const dim: [number, number, number] = [1500, 850, 750];
    const hw = dim[0] / 2000;
    const hd = dim[1] / 2000;
    // Centred if the bay can give a seated diner the 900 mm pull-back on BOTH long
    // sides; otherwise against the wall, which is what `layout-rules` means by
    // asking for three sides of four. Centring a table in a 2.1 m-deep bay gives
    // 630 mm on each side — two sides too tight instead of one side against a wall
    // and three that work, which is the arrangement people actually build.
    const vTable = f.depth / 2 - hd >= WALK_COMFORT ? f.depth / 2 : hd + SEED_WALL_GAP;
    if (!place('table', 'Dining table', 'desk-standard', dim, f, 0, vTable)) return;

    const chair: [number, number, number] = [480, 520, 850];
    const reach = chair[1] / 2000 - CHAIR_TUCK;
    for (const spot of [
      { u: 0, v: vTable - hd - reach, turn: 0 },
      { u: 0, v: vTable + hd + reach, turn: Math.PI },
      { u: -(hw + reach), v: vTable, turn: Math.PI / 2 },
      { u: hw + reach, v: vTable, turn: -Math.PI / 2 },
    ]) {
      place('chair', 'Dining chair', 'chair-dining', chair, f, spot.u, spot.v, { turn: spot.turn });
    }
  };

  // ── Bedroom: head of the bed to the wall, a side to get in on ─────────────
  const bedroom = (bay: Bay) => {
    const frames = seedFrames(bay, poly);
    const f = frames[0];
    const bed: [number, number, number] = [2000, 1600, 600];
    const bedHalfW = bed[0] / 2000;
    const vBed = bed[1] / 2000 + SEED_WALL_GAP;
    let sleeper = place('bed', 'Double bed', 'bed-double', bed, f, 0, vBed);
    if (!sleeper) {
      // No room for a double. A single is a different piece of furniture, not a
      // resized one — the catalog size stands.
      sleeper = place('bed', 'Single bed', 'bed-single', [1900, 1000, 600], f, 0, 1000 / 2000 + SEED_WALL_GAP);
    }

    // Touching the head end on both sides — layout-rules wants a nightstand within
    // 150 mm of the bed, and both sides of a double are somebody's side.
    const stand: [number, number, number] = [450, 400, 550];
    const uStand = bedHalfW + stand[0] / 2000 + SEED_WALL_GAP;
    for (const u of [-uStand, uStand]) {
      place('nightstand', 'Nightstand', 'nightstand', stand, f, u, stand[1] / 2000 + SEED_WALL_GAP);
    }

    // Wardrobe on a side wall, where its 600 mm of door swing is not the bed.
    const side = crossFrame(frames, f) ?? f;
    const wardrobe: [number, number, number] = [1800, 600, 2100];
    const vWardrobe = wardrobe[1] / 2000 + SEED_WALL_GAP;
    placeSomewhere(
      'wardrobe',
      'Wardrobe',
      'wardrobe',
      wardrobe,
      side,
      [
        { u: 0, v: vWardrobe },
        { u: -side.width / 4, v: vWardrobe },
        { u: side.width / 4, v: vWardrobe },
      ],
      {},
      sleeper,
    );
  };

  // ── A reading nook, for the wing of an L (or any leftover corner) ─────────
  const nook = (bay: Bay) => {
    const frames = seedFrames(bay, poly);
    const f = frames[0];
    const chair: [number, number, number] = [800, 800, 900];
    const chairHalf = chair[1] / 2000;
    const vChair = Math.min(f.depth - chairHalf - SEED_WALL_GAP, chairHalf + 0.35);
    // Along the wing, AWAY from the living group and not pinching it. A wing opens off
    // the room's main bay, so the nook's default end is the shared edge — which put
    // the armchair 250 mm behind the sofa's back, i.e. across the only route from one
    // half of the room to the other.
    const group = parts.find((p) => p.category === 'sofa') ?? null;
    const armchair = placeSomewhere(
      'chair',
      'Armchair',
      'chair-armchair',
      chair,
      f,
      [
        { u: 0.35, v: vChair },
        { u: -0.35, v: vChair },
        { u: 0, v: vChair },
      ],
      {},
      group,
      true,
    );
    if (armchair) {
      // Within reach of the arm of the chair, on whichever side has the room.
      const [uChair] = worldToLocal(f.yaw, armchair.pos[0] - f.mx, armchair.pos[2] - f.mz);
      const reach = chair[0] / 2000 + 0.25;
      placeSomewhere(
        'table',
        'Side table',
        'side-table',
        [450, 450, 550],
        f,
        [
          { u: uChair + reach, v: vChair },
          { u: uChair - reach, v: vChair },
        ],
        {},
        group,
      );
    }
    const shelf: [number, number, number] = [900, 350, 1800];
    const side = crossFrame(frames, f) ?? f;
    const vShelf = shelf[1] / 2000 + SEED_WALL_GAP;
    placeSomewhere(
      'shelf',
      'Bookshelf',
      'bookshelf',
      shelf,
      side,
      [
        { u: -side.width / 3, v: vShelf },
        { u: side.width / 3, v: vShelf },
        { u: 0, v: vShelf },
      ],
      {},
      armchair,
    );
  };

  /** Somewhere green, for a bay too small to furnish. */
  const alcove = (bay: Bay) => {
    const f = seedFrames(bay, poly)[0];
    placeSomewhere(
      'plant',
      'Plant',
      'plant',
      [400, 400, 1600],
      f,
      [
        { u: 0, v: 0.4 },
        { u: 0, v: f.depth / 2 },
      ],
      { circle: true },
    );
  };

  // Which bay gets what. The layout preset states an intention — layout-pick sells
  // the U as a bedroom and the T as "living + dining" — but the BAYS decide whether
  // the room can keep the promise, so every secondary group is conditional on there
  // being somewhere to put it.
  const second = (minArea: number): Bay | null => (bays[1] && bays[1].area >= minArea ? bays[1] : null);
  /** Two groups, one rectangle: cut it in half the long way. */
  const halves = (minArea: number): [Bay, Bay] | null => {
    const b = second(minArea);
    if (b) return [bays[0], b];
    if (bays[0].area >= minArea * 2.4) return splitBay(bays[0]);
    return null;
  };

  switch (layoutId) {
    case 'u': {
      bedroom(bays[0]);
      const spare = second(1.2);
      if (spare) alcove(spare);
      break;
    }
    case 't':
    case 'open': {
      const pair = halves(4.5);
      if (pair) {
        // The living group goes where the VIEWING DEPTH is, not where the floor is.
        // Handing it the larger bay by area put the sofa 1.6 m from a 65″ screen in
        // the T's 2.1 m-deep bar while its 2.6 m-deep stem — which needs no viewing
        // distance to seat four at a table — got the dining set. Swapping the two
        // costs nothing and is what a person would have done.
        const [a, b] = pair;
        const flip = viewingDepth(b, poly) > viewingDepth(a, poly) + 0.05;
        living(flip ? b : a, { routeBehind: true });
        dining(flip ? a : b);
      } else {
        living(bays[0]);
      }
      break;
    }
    case 'l': {
      living(bays[0]);
      const wing = second(2.5);
      if (wing) nook(wing);
      break;
    }
    default: {
      living(bays[0]);
      // A custom footprint can have a wing the presets don't; furnish it if so.
      const wing = second(2.5);
      if (wing) nook(wing);
    }
  }

  // Belt and braces. Everything above is gated on fitting, so this normally has
  // nothing to do — but it is the same guarantee the detection path needs, and one
  // function making it for both beats two hand-checked seeds.
  return settleParts(parts, poly);
}

/** Would this piece leave a gap too narrow to walk down, against anything already
 *  placed?
 *
 *  The room report's own reading of a pinch, so a piece rejected here is exactly a
 *  piece that would have produced a "tight walkway" finding: flush is deliberate
 *  composition and fine, wide open is fine, and the band between is the problem.
 *  Pairs the relation table puts together are exempt — a lamp beside the sofa it
 *  lights is not a corridor. */
function pinches(part: ScenePart, placed: ScenePart[]): boolean {
  const foot = footFromPart(part.pos, part.rot, part.dimMM, part.circle);
  for (const o of placed) {
    if (o.wallMounted || o.category === 'rug' || !isObstacle(o)) continue;
    if (belongTogether(part, o)) continue;
    const gap = obbGap(foot, footFromPart(o.pos, o.rot, o.dimMM, o.circle));
    if (gap > 0.12 && gap < WALK_MIN) return true;
  }
  return false;
}

/** Would this piece sit properly here — wholly inside the room, and clear of what
 *  is already placed?
 *
 *  The EXEMPTIONS are the room report's — rugs go under things, seating tucks under a
 *  table on purpose — but the share is a seeding epsilon, not the report's collision
 *  bar (`CLASH_SHARE = 0.5` there). Nothing being placed for the first time has any
 *  business overlapping anything, so this is as tight as floating point allows, and
 *  the same figure `lib/layout-settle.ts` names `TOUCH_SHARE`. */
function seats(part: ScenePart, placed: ScenePart[], poly: Footprint): boolean {
  if (part.wallMounted) return pointInFootprint(part.pos[0], part.pos[2], poly);
  const foot = footFromPart(part.pos, part.rot, part.dimMM, part.circle);
  // Corner-exact, NOT the sampled share: `outsideShare`'s outermost samples sit 10%
  // in from the edges, so it forgave a coffee table 20 mm through the wall of the
  // T-shape's stem — and the test that was supposed to catch that asked the same
  // forgiving question.
  if (!footInsidePoly(foot, poly as Poly)) return false;
  if (part.category === 'rug') return true;
  const role = roleOf(part);
  const area = footArea(foot);
  for (const o of placed) {
    if (o.wallMounted || o.category === 'rug') continue;
    if (sharesFloor(role, roleOf(o))) continue;
    const other = footFromPart(o.pos, o.rot, o.dimMM, o.circle);
    if (!footOverlap(foot, other, -0.01)) continue;
    const smaller = Math.min(area, footArea(other));
    if (smaller > 0 && footIntersectionArea(foot, other) / smaller > SEED_TOUCH_SHARE) return false;
  }
  return true;
}

// ─── Local model library ──────────────────────────────────────────────────
// Curated list of common room items the user can drop in directly (no AI call).
// Each entry maps to a procedural primitive in components/three/DynamicPart.tsx.
// `group` only drives section headers in the Add-model picker.
export type LibraryItem = {
  label: string;
  group: 'Seating' | 'Tables' | 'Storage' | 'Bedroom' | 'Lighting' | 'Decor' | 'Tech' | 'Appliances' | 'Real sizes';
  category: Category;
  shape: Shape;
  dimMM: [number, number, number];
};

/** drag-and-drop MIME for dragging catalog items onto the 3D canvas. */
export const DND_MIME = 'application/x-danmu-item';

// Parametric shapes rebuild their geometry from the CURRENT dimensions (adding
// modules — pleats, shelves, bays, seats — rather than stretching one mesh). For
// these, Draggable does NOT group-scale the mesh: the geometry owns its size, so
// resizing reads correct + never distorts. All other shapes still group-scale.
const PARAMETRIC_SHAPES = new Set<Shape>([
  'sofa', 'curtain', 'wardrobe', 'closet', 'bookshelf', 'shoe-rack',
]);
export function isParametric(shape: Shape): boolean {
  return PARAMETRIC_SHAPES.has(shape);
}

// Categories whose flat top surface can hold a decor collection (vase, books…).
const DECOR_CATEGORIES = new Set<Category>(['table', 'desk', 'nightstand', 'shelf', 'wardrobe', 'ottoman']);
export function supportsDecor(category: Category, shape: Shape): boolean {
  if (shape === 'shoe-rack') return false; // angled tiers, no flat top
  return DECOR_CATEGORIES.has(category);
}

function seededRand(s: string): () => number {
  let h = 1779033703 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = (h ^= h >>> 16) >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Seeded suggested decor arrangement for a decor-capable part. */
export function autoSurfaceDecor(category: Category, shape: Shape, dim: [number, number, number], id: string): DecorItem[] {
  if (!supportsDecor(category, shape)) return [];
  const w = dim[0] / 1000;
  const d = dim[1] / 1000;
  const rand = seededRand(id);
  const n = shape === 'nightstand' || category === 'ottoman' ? 1 : 2 + Math.floor(rand() * 2);
  const out: DecorItem[] = [];
  for (let i = 0; i < n; i++) {
    out.push({
      id: `${id}-d${i}`,
      kind: DECOR_KINDS[Math.floor(rand() * DECOR_KINDS.length)],
      x: (rand() - 0.5) * w * 0.66,
      z: (rand() - 0.5) * d * 0.55,
    });
  }
  return out;
}

export const PART_LIBRARY: LibraryItem[] = [
  // Seating
  { label: 'Sofa · 3-seat', group: 'Seating', category: 'sofa', shape: 'sofa', dimMM: [2200, 950, 880] },
  { label: 'Armchair', group: 'Seating', category: 'chair', shape: 'chair-armchair', dimMM: [700, 700, 900] },
  { label: 'Dining chair', group: 'Seating', category: 'chair', shape: 'chair-dining', dimMM: [500, 500, 850] },
  { label: 'Office chair', group: 'Seating', category: 'chair', shape: 'chair-office', dimMM: [600, 600, 1100] },
  { label: 'Ottoman', group: 'Seating', category: 'ottoman', shape: 'ottoman', dimMM: [550, 400, 420] },
  // Tables
  { label: 'Coffee table', group: 'Tables', category: 'table', shape: 'coffee-table', dimMM: [1100, 600, 420] },
  { label: 'Side table', group: 'Tables', category: 'table', shape: 'side-table', dimMM: [450, 450, 550] },
  { label: 'Dining / desk table', group: 'Tables', category: 'desk', shape: 'desk-standard', dimMM: [1400, 700, 750] },
  { label: 'L-shaped desk', group: 'Tables', category: 'desk', shape: 'desk-l', dimMM: [1600, 1400, 750] },
  { label: 'Nightstand', group: 'Tables', category: 'nightstand', shape: 'nightstand', dimMM: [450, 400, 550] },
  // Storage
  { label: 'Wardrobe · 4-bay', group: 'Storage', category: 'wardrobe', shape: 'wardrobe', dimMM: [2400, 600, 2200] },
  { label: 'Bookshelf', group: 'Storage', category: 'shelf', shape: 'bookshelf', dimMM: [900, 350, 1800] },
  { label: 'Shoe rack', group: 'Storage', category: 'shelf', shape: 'shoe-rack', dimMM: [800, 300, 900] },
  // Bedroom
  { label: 'Single bed', group: 'Bedroom', category: 'bed', shape: 'bed-single', dimMM: [1900, 1000, 600] },
  { label: 'Double bed', group: 'Bedroom', category: 'bed', shape: 'bed-double', dimMM: [2000, 1600, 600] },
  // Lighting
  { label: 'Floor lamp', group: 'Lighting', category: 'lamp', shape: 'lamp-floor', dimMM: [300, 300, 1700] },
  { label: 'Table lamp', group: 'Lighting', category: 'lamp', shape: 'lamp-table', dimMM: [250, 250, 500] },
  { label: 'Pendant lamp', group: 'Lighting', category: 'lamp', shape: 'lamp-pendant', dimMM: [350, 350, 400] },
  // Decor
  { label: 'Rug', group: 'Decor', category: 'rug', shape: 'rug', dimMM: [2400, 1600, 5] },
  { label: 'Potted plant', group: 'Decor', category: 'plant', shape: 'plant', dimMM: [400, 400, 1600] },
  { label: 'Mirror · rectangular', group: 'Decor', category: 'mirror', shape: 'mirror', dimMM: [600, 30, 1400] },
  { label: 'Mirror · oval', group: 'Decor', category: 'mirror', shape: 'mirror-oval', dimMM: [600, 30, 1100] },
  { label: 'Painting', group: 'Decor', category: 'painting', shape: 'painting', dimMM: [800, 30, 600] },
  { label: 'Curtain', group: 'Decor', category: 'curtain', shape: 'curtain', dimMM: [1600, 80, 2200] },
  { label: 'Window', group: 'Decor', category: 'other', shape: 'window', dimMM: [1200, 60, 1200] },
  // Tech — three real panel sizes, because a small room needs a smaller SET and
  // never a scaled one. `SCREENS` (above) picks between these for the starter scene.
  { label: 'TV · 65"', group: 'Tech', category: 'tv', shape: 'tv', dimMM: [1450, 60, 820] },
  { label: 'TV · 55"', group: 'Tech', category: 'tv', shape: 'tv', dimMM: [1230, 60, 710] },
  { label: 'TV · 43"', group: 'Tech', category: 'tv', shape: 'tv', dimMM: [970, 60, 570] },
  { label: 'Monitor', group: 'Tech', category: 'monitor', shape: 'monitor', dimMM: [600, 200, 400] },
  { label: 'Laptop', group: 'Tech', category: 'monitor', shape: 'laptop', dimMM: [340, 240, 220] },
  // Appliances
  { label: 'Fridge', group: 'Appliances', category: 'fridge', shape: 'fridge', dimMM: [600, 650, 1700] },
  { label: 'Washing machine', group: 'Appliances', category: 'fridge', shape: 'washing-machine', dimMM: [600, 600, 850] },
  { label: 'Microwave', group: 'Appliances', category: 'fridge', shape: 'microwave', dimMM: [500, 380, 300] },
  { label: 'Water dispenser', group: 'Appliances', category: 'fridge', shape: 'water-dispenser', dimMM: [330, 330, 1000] },
  { label: 'Air purifier', group: 'Appliances', category: 'fridge', shape: 'air-purifier', dimMM: [300, 300, 620] },
  { label: 'Radiator', group: 'Appliances', category: 'fridge', shape: 'radiator', dimMM: [800, 120, 580] },
  { label: 'Soundbar', group: 'Tech', category: 'tv', shape: 'soundbar', dimMM: [1000, 110, 90] },
  { label: 'Ceiling fan', group: 'Appliances', category: 'fan', shape: 'fan', dimMM: [1000, 1000, 200] },
  { label: 'AC unit', group: 'Appliances', category: 'ac', shape: 'ac-unit', dimMM: [800, 220, 280] },
  { label: 'Door', group: 'Appliances', category: 'door', shape: 'door', dimMM: [900, 50, 2100] },
];

// ─── Detection → scene builder ────────────────────────────────────────────
// Map detected category to a sensible primitive + default mm dimensions.
const CATEGORY_DEFAULTS: Record<
  Category,
  { shape: Shape; dim: [number, number, number]; circle?: boolean; wallMounted?: boolean }
> = {
  sofa: { shape: 'sofa', dim: [2200, 950, 880] },
  tv: { shape: 'tv', dim: [1450, 60, 820], wallMounted: true },
  chair: { shape: 'chair-dining', dim: [500, 500, 850] },
  table: { shape: 'desk-standard', dim: [1200, 600, 750] },
  desk: { shape: 'desk-standard', dim: [1400, 700, 750] },
  lamp: { shape: 'lamp-floor', dim: [300, 300, 1700], circle: true },
  plant: { shape: 'plant', dim: [400, 400, 1600], circle: true },
  shelf: { shape: 'bookshelf', dim: [900, 350, 1800] },
  wardrobe: { shape: 'wardrobe', dim: [2000, 600, 2100] },
  rug: { shape: 'rug', dim: [2400, 1600, 5] },
  bed: { shape: 'bed-single', dim: [1900, 1000, 600] },
  monitor: { shape: 'monitor', dim: [600, 200, 400] },
  fan: { shape: 'fan', dim: [1000, 1000, 200], circle: true, wallMounted: true },
  fridge: { shape: 'fridge', dim: [550, 550, 850] },
  curtain: { shape: 'curtain', dim: [1600, 80, 2200], wallMounted: true },
  mirror: { shape: 'mirror', dim: [600, 30, 1400], wallMounted: true },
  painting: { shape: 'painting', dim: [800, 30, 600], wallMounted: true },
  nightstand: { shape: 'nightstand', dim: [450, 400, 550] },
  ottoman: { shape: 'ottoman', dim: [550, 400, 420] },
  ac: { shape: 'ac-unit', dim: [800, 220, 280], wallMounted: true },
  door: { shape: 'door', dim: [900, 50, 2100], wallMounted: true },
  other: { shape: 'box', dim: [600, 600, 800] },
};

/** The shapes a detector — cloud or on-device — is allowed to name, in the order
 *  the detection prompt lists them.
 *
 *  ONE list, exported, because there were three that had drifted apart:
 *    · `'window'` was missing here while lib/local-detect.ts maps a detected
 *      window onto it, so the gate in buildSceneFromRoom rejected the hint and a
 *      window rendered as a plain box — even though WindowGeo exists.
 *    · `'shoe-rack'` was here but absent from the prompt's catalog, so the cloud
 *      path could never produce a shape this gate would accept.
 *  lib/detection.ts now interpolates this array into the prompt instead of
 *  restating it.
 *
 *  `'closet'` is deliberately NOT here: it is a legacy alias for `'wardrobe'`
 *  that persisted rooms may still hold (ShapeDispatch and the dimension ranges
 *  keep handling it), but nothing should mint a new one. */
export const CATALOG_SHAPES_ORDERED: readonly Shape[] = [
  'sofa', 'tv', 'wardrobe', 'rug', 'plant',
  'chair-dining', 'chair-office', 'chair-armchair', 'ottoman',
  'bed-single', 'bed-double',
  'desk-standard', 'desk-l', 'coffee-table', 'side-table', 'nightstand',
  'lamp-floor', 'lamp-table', 'lamp-pendant',
  'mirror', 'mirror-oval', 'painting', 'ac-unit', 'window',
  'monitor', 'laptop', 'fan', 'fridge', 'curtain',
  'bookshelf', 'shoe-rack', 'door',
  'soundbar', 'radiator', 'air-purifier', 'washing-machine', 'microwave', 'water-dispenser',
] as const;

const CATALOG_SHAPES = new Set<Shape>(CATALOG_SHAPES_ORDERED);

/** Refine the default shape based on label keywords — turns a generic chair into
 *  an office chair if the AI detected it as such. */
function refineShape(category: Category, label: string): Shape {
  const l = label.toLowerCase();
  switch (category) {
    case 'chair':
      if (/ottoman|footstool|pouf/.test(l)) return 'ottoman';
      if (/office|swivel|desk chair|computer chair|gaming/.test(l)) return 'chair-office';
      if (/arm|lounge|accent|recliner|wingback|easy/.test(l)) return 'chair-armchair';
      return 'chair-dining';
    case 'bed':
      if (/double|queen|king|matrimonial/.test(l)) return 'bed-double';
      return 'bed-single';
    case 'desk':
      if (/l-shape|l shape|corner/.test(l)) return 'desk-l';
      return 'desk-standard';
    case 'table':
      if (/coffee|center/.test(l)) return 'coffee-table';
      if (/side|end|accent|console/.test(l)) return 'side-table';
      if (/night|bedside/.test(l)) return 'nightstand';
      if (/l-shape|corner/.test(l)) return 'desk-l';
      return 'desk-standard';
    case 'lamp':
      if (/pendant|ceiling|chandelier|bulb|hanging/.test(l)) return 'lamp-pendant';
      if (/table|desk|bedside|nightstand/.test(l)) return 'lamp-table';
      return 'lamp-floor';
    case 'shelf':
      if (/wardrobe|closet|cabinet|cupboard/.test(l)) return 'wardrobe';
      if (/shoe|footwear/.test(l)) return 'shoe-rack';
      return 'bookshelf';
    case 'monitor':
      if (/laptop|notebook|macbook|ultrabook|chromebook/.test(l)) return 'laptop';
      return 'monitor';
    case 'mirror':
      if (/oval|round|circular|arch|ellipse/.test(l)) return 'mirror-oval';
      return 'mirror';
    default:
      return CATEGORY_DEFAULTS[category]?.shape ?? 'box';
  }
}

/** Place a detection from a given slot into world space.
 *  Cameras stand at room center facing each wall. bbox.x along wall, no depth → snap to wall.
 *  Returns { pos, rot } in scene coords. */
function placementForSlot(
  slot: CaptureSlot,
  bbox: [number, number, number, number],
  dimMM: [number, number, number],
  wallMounted: boolean,
  shape: Shape,
  room: { width: number; depth: number; height: number } = ROOM,
): { pos: [number, number, number]; rot: number } {
  const cx = bbox[0] + bbox[2] / 2;
  const w = room.width;
  const d = room.depth;
  const dM = dimMM[1] / 1000;
  const hM = dimMM[2] / 1000;

  // Ceiling-mounted (fan) → at ceiling, snap to room center area
  if (shape === 'fan') {
    return { pos: [(cx - 0.5) * (w * 0.5), room.height - 0.15, 0], rot: 0 };
  }

  // Curtain hangs from above window height → top edge at ceiling, anchored to wall
  const yPos = wallMounted
    ? shape === 'curtain'
      ? room.height - hM / 2 - 0.05
      : Math.max(1.2, room.height - hM / 2 - 0.2)
    : 0;

  switch (slot) {
    case 'n':
      return { pos: [(cx - 0.5) * (w * 0.85), yPos, -d / 2 + dM / 2 + 0.05], rot: 0 };
    case 's':
      return { pos: [(0.5 - cx) * (w * 0.85), yPos, d / 2 - dM / 2 - 0.05], rot: Math.PI };
    case 'e':
      return { pos: [w / 2 - dM / 2 - 0.05, yPos, (cx - 0.5) * (d * 0.85)], rot: -Math.PI / 2 };
    case 'w':
      return { pos: [-w / 2 + dM / 2 + 0.05, yPos, (0.5 - cx) * (d * 0.85)], rot: Math.PI / 2 };
  }
}

export function buildSceneFromRoom(room: RoomData): ScenePart[] {
  const dets = room.detectedObjects ?? [];

  // The USER's room dims, not the demo defaults — detection positions come back
  // in metres relative to the real room, so placing them against ROOM's default
  // 5.6×4.2 box silently mis-scaled every layout that wasn't that exact size.
  const rw = room.width ?? ROOM.width;
  const rd = room.depth ?? ROOM.depth;
  const rh = room.height ?? ROOM.height;

  // Non-rectangular rooms: keep detected items inside the actual footprint
  // (detection still reasons about a rectangle, so an item can land in the
  // void of an L/U/T notch — pull it back in). A saved custom footprint wins.
  const footprint =
    room.footprint && room.footprint.length >= 3
      ? (room.footprint as [number, number][])
      : footprintForLayout((room.layoutId ?? 'rect') as LayoutId, rw, rd);

  // The starter scene is seeded from the same polygon, not from the layout preset's
  // idealised rectangle: a room whose walls the user has dragged has a footprint the
  // preset no longer describes, and furnishing the preset put the furniture through
  // the walls.
  if (dets.length === 0) {
    return defaultScene((room.layoutId ?? 'rect') as LayoutId, rw, rd, { footprint, height: rh });
  }

  const parts: ScenePart[] = [];
  const counters: Record<string, number> = {};

  for (const d of dets) {
    const slot = (d.label as string).match(/__slot:([nesw])$/)?.[1] as CaptureSlot | undefined;
    const realSlot: CaptureSlot = slot ?? 'n';
    const cleanLabel = (d.label as string).replace(/__slot:[nesw]$/, '');
    const cat = ((d as { category?: Category }).category ?? 'other') as Category;
    const cfg = CATEGORY_DEFAULTS[cat] ?? CATEGORY_DEFAULTS.other;
    counters[cat] = (counters[cat] ?? 0) + 1;
    // Prefer the detection's own stable key. The positional `${cat}-${n}` is an
    // ordinal, not an identity, and every per-part user edit — positions,
    // rotations, dims, hidden — is stored in a map keyed by this string. So
    // re-running detection with a different set of objects used to re-point the
    // old `sofa-1`'s saved transform at whatever the new `sofa-1` happened to be,
    // and deleting one detection shifted every id after it.
    //
    // Rooms detected before `uid` shipped have none, and fall back to the ordinal
    // — which keeps their existing transforms attached rather than orphaning every
    // one of them in the name of the fix.
    const id = (d as { uid?: string }).uid ?? `${cat}-${counters[cat]}`;
    const aiShape = (d as { shape?: string }).shape as Shape | undefined;
    // Label-based refinement takes priority over the AI's generic shape: the
    // detector often returns shape:'monitor' for a laptop or shape:'mirror' for
    // an oval mirror. When the label maps to a *specific* variant (anything other
    // than the category's generic default), trust the label; only fall back to
    // the raw AI shape when the label is generic.
    const labelShape = refineShape(cat, cleanLabel);
    const catDefaultShape = CATEGORY_DEFAULTS[cat]?.shape ?? 'box';
    const refined: Shape =
      labelShape !== catDefaultShape
        ? labelShape
        : aiShape && CATALOG_SHAPES.has(aiShape) && aiShape !== 'box'
          ? aiShape
          : labelShape;
    // AI-estimated dims are a HINT, never the source of truth — clamp them into
    // the shape's real-world range (lib/dimension-ranges). A wild estimate
    // (3.5 m sofa, 80 mm fridge) collapses to the nearest credible size.
    const aiDim = (d as { dimMM?: [number, number, number] }).dimMM;
    const dim = clampDims(
      cat,
      refined,
      aiDim && aiDim.every((n) => Number.isFinite(n) && n > 0) ? (aiDim as [number, number, number]) : cfg.dim,
    );
    // Prefer AI-estimated position/yaw when present and in-room; otherwise snap to wall.
    const aiPos = (d as { position?: { x: number; y: number; z: number } }).position;
    const aiYaw = (d as { yaw?: number }).yaw;
    let placement: { pos: [number, number, number]; rot: number };
    const w = rw / 2;
    const dHalf = rd / 2;
    const h = rh;
    if (
      aiPos &&
      typeof aiPos.x === 'number' &&
      typeof aiPos.y === 'number' &&
      typeof aiPos.z === 'number' &&
      Math.abs(aiPos.x) <= w + 0.2 &&
      Math.abs(aiPos.z) <= dHalf + 0.2 &&
      aiPos.y >= 0 &&
      aiPos.y <= h
    ) {
      placement = {
        pos: [aiPos.x, aiPos.y, aiPos.z],
        rot: typeof aiYaw === 'number' ? aiYaw : 0,
      };
    } else {
      placement = placementForSlot(realSlot, d.box, dim, !!cfg.wallMounted, refined, { width: rw, depth: rd, height: rh });
    }
    // Gravity: floor-standing items must touch the floor. Wall-mounted / ceiling
    // items snap to their canonical mounting height for the current part height.
    placement.pos[1] = groundY(cat, refined, dim, rh);

    // Logical placement: certain items only make sense against walls (door, fridge,
    // wardrobe, TV) or in the middle (rugs, coffee tables). Nudge accordingly.
    // snapToWall is footprint-edge exact, so L/T/U inner walls count too.
    const aff = wallAffinity(cat);
    // Named `bounds`, not `room` — that shadowed this function's own `room`
    // parameter for the rest of the block.
    const bounds = { width: rw, depth: rd };
    if (aff === 'must-wall') {
      const snapped = snapToWall(placement.pos, dim, footprint);
      placement.pos[0] = snapped.x;
      placement.pos[2] = snapped.z;
      if (snapped.rot !== undefined && (typeof aiYaw !== 'number' || Math.abs(aiYaw) < 0.05)) {
        placement.rot = snapped.rot;
      }
    } else if (aff === 'prefers-wall') {
      const halfW = bounds.width / 2;
      const halfD = bounds.depth / 2;
      const distFromWall = Math.min(
        halfD + placement.pos[2],
        halfD - placement.pos[2],
        halfW + placement.pos[0],
        halfW - placement.pos[0],
      );
      // Always snap via footprint-aware snapToWall — works for L/T/U inner edges too.
      if (distFromWall > 0.2) {
        const snapped = snapToWall(placement.pos, dim, footprint);
        placement.pos[0] = snapped.x;
        placement.pos[2] = snapped.z;
        if (snapped.rot !== undefined && (typeof aiYaw !== 'number' || Math.abs(aiYaw) < 0.05)) {
          placement.rot = snapped.rot;
        }
      }
    } else if (aff === 'prefers-middle') {
      // gentle pull toward room center (only if AI placed it near a wall by mistake).
      const halfW = bounds.width / 2;
      const halfD = bounds.depth / 2;
      const distFromWall = Math.min(
        halfD + placement.pos[2],
        halfD - placement.pos[2],
        halfW + placement.pos[0],
        halfW - placement.pos[0],
      );
      if (distFromWall < 0.6) {
        const pulled = pullToward(placement.pos, [0, 0], 0.4);
        placement.pos[0] = pulled[0];
        placement.pos[2] = pulled[1];
      }
    }
    // Keep the footprint (XZ) inside non-rectangular rooms.
    const [fpx, fpz] = clampIntoFootprint(placement.pos[0], placement.pos[2], footprint);
    placement.pos[0] = fpx;
    placement.pos[2] = fpz;

    parts.push({
      id,
      category: cat,
      name: cleanLabel || cat,
      shape: refined,
      pos: placement.pos,
      rot: placement.rot,
      dimMM: dim,
      locked: d.locked,
      circle: cfg.circle,
      wallMounted: cfg.wallMounted,
      fromDetection: { slot: realSlot, bbox: d.box, conf: d.conf },
      meshHash: (d as { meshHash?: string }).meshHash,
      color: (d as { color?: string }).color,
    });
  }

  // ─── Floor pass: inside the room, out of each other ─────────────────────
  // The per-detection placement above clamps each item's CENTRE into the footprint,
  // which leaves a 2.2 m sofa whose centre is 150 mm inside the wall still half in
  // the garden — and it resolves nothing between two items, so two detections of
  // the same sofa, or a bed and a wardrobe the AI both put against the north wall,
  // arrive interpenetrating. Same guarantee, same code, as the starter scene.
  //
  // A `locked` piece is not exempt: locked means "this came from your photo", and a
  // photo cannot make a piece of furniture be outside the room.
  const settled = settleParts(parts, footprint);

  // ─── Settle pass ─────────────────────────────────────────────────────────
  // The per-part placement above respects wall affinity + anchor type, but the
  // AI frequently puts a monitor at wall-mid Y (~1.4m) even though there's a
  // desk under it. Do a second pass to:
  //   1. Snap tabletop-prone parts (monitor, lamp, plant, ottoman, "other") onto
  //      the highest supporting surface under their XZ footprint when one exists
  //      and the surface is taller than 0.3m (i.e. a real table, not a rug).
  //   2. For any floor-standing part whose Y ended up > 0 with no support
  //      beneath, drop it to the floor — recovers from bad AI Y estimates.
  //   3. Ceiling clamp — no part top should poke through the ceiling.
  const CEILING_PAD = 0.02;
  const cap = rh - CEILING_PAD;
  for (const p of settled) {
    if (p.category !== 'rug') {
      const support =
        p.wallMounted ? null : findSupportUnder(settled, p.id, p.pos[0], p.pos[2], p.dimMM, p.rot);

      if (!p.wallMounted && isTabletopProne(p.category) && support !== null && support > 0.3) {
        p.pos[1] = support;
      } else if (!p.wallMounted && isFloorStanding(p.category, p.shape) && p.pos[1] > 0.05) {
        p.pos[1] = support !== null && support > 0.3 ? support : 0;
      }
    }

    // Ceiling clamp — semantics differ for floor vs wall/ceiling-mounted parts.
    // Floor-standing items have pos[1] = bottom of bounding box; wall-mounted
    // items have pos[1] = mesh center. Keep both under the ceiling.
    const h = p.dimMM[2] / 1000;
    if (p.wallMounted || p.shape === 'fan' || p.shape === 'lamp-pendant') {
      const top = p.pos[1] + h / 2;
      if (top > cap) p.pos[1] = cap - h / 2;
    } else {
      if (p.pos[1] + h > cap) p.pos[1] = Math.max(0, cap - h);
    }
  }

  return settled;
}

/** Whether a part renders as a wall/ceiling-mounted item (geometry centred on
 *  the group origin) rather than floor-anchored. SHAPE-aware: a mirror/tv/etc.
 *  is wall-mounted even if the AI labelled it with an off category — relying on
 *  category alone let a "mirror" come back as category:other → wallMounted:false
 *  → centred geometry sinking half-way through the floor. */
export function isWallMountedPart(cat: Category, shape: Shape): boolean {
  return anchorFor(cat, shape) !== 'floor';
}

/** Compute a sane spawn transform for a NEW part added at the room centre.
 *  Mirrors the gravity rules used by the detection builder so added items never
 *  spawn buried in the floor (wall-mounted) or floating in mid-air.
 *    • wall/ceiling-mounted → canonical mounting height (groundY)
 *    • small tabletop-prone items (lamp, monitor, plant…) → rest on a surface
 *      under the centre if one exists, else the floor
 *    • everything else (sofa, bed, table, wardrobe, chair…) → ALWAYS the floor,
 *      so adding a piece never lands it stacked on whatever happens to sit at
 *      room centre (e.g. the starter coffee table).
 */
export function placeNewPart(
  cat: Category,
  shape: Shape,
  dimMM: [number, number, number],
  room: { width: number; depth: number; height: number },
  existing: ScenePart[],
): { pos: [number, number, number]; wallMounted: boolean } {
  const wallMounted = isWallMountedPart(cat, shape);
  if (wallMounted) {
    const h = dimMM[2] / 1000;
    // Centre-anchored: clamp so the bottom edge never dips below the floor and
    // the top never passes the ceiling, regardless of the canonical height.
    let y = groundY(cat, shape, dimMM, room.height);
    y = Math.max(h / 2 + 0.02, Math.min(room.height - h / 2 - 0.02, y));
    return { pos: [0, y, 0], wallMounted };
  }
  // Only small "goes on a table" items seek a surface; everything else floors.
  const support = isTabletopProne(cat) ? findSupportUnder(existing, '__new__', 0, 0, dimMM) : null;
  const y = support !== null && support > 0.3 ? support : 0;
  return { pos: [0, y, 0], wallMounted };
}

/** Y-aware collision. Used for placement clamping. Rugs/mats exempt.
 *  Allows stacking — if one part's vertical extent doesn't overlap the other's, no collision.
 *  This lets users put a lamp on a desk, monitor on a desk, etc. */
export function collidesAt(
  parts: ScenePart[],
  movingId: string,
  pos: [number, number, number],
  rot: number,
  dimMM: [number, number, number],
): boolean {
  const mover = parts.find((p) => p.id === movingId);
  if (!mover) return false;
  if (mover.category === 'rug') return false;
  const mh = dimMM[2] / 1000;
  // Mover y-bottom (pos.y is the floor anchor in our scene; for wall-mounted it's mid-height).
  const myBottom = pos[1];
  const myTop = pos[1] + mh;
  const me = footFromPart(pos, rot, dimMM, mover.circle);
  for (const o of parts) {
    if (o.id === movingId) continue;
    if (o.category === 'rug') continue;
    if (o.wallMounted) continue;
    const oh = o.dimMM[2] / 1000;
    const oyBottom = o.pos[1];
    const oyTop = o.pos[1] + oh;

    // Vertical separation → no collision (stacking allowed).
    const yOverlap = !(myTop <= oyBottom + 0.005 || myBottom >= oyTop - 0.005);
    if (!yOverlap) continue;

    // XZ overlap — exact separating-axis test, over the ROUND footprint where a
    // piece has one. The tiny negative pad lets flush side-by-side placement read
    // as touching, not colliding.
    if (footOverlap(me, footFromPart(o.pos, o.rot, o.dimMM, o.circle), -0.01)) return true;
  }
  return false;
}

// Scene spec — single source of truth for parts in the 3D + 2D views.
// Either default (hand-curated demo room) or built from AI detections across all 4 wall captures.

import { ROOM } from './parts-catalog';
import {
  footprintForLayout,
  footprintBounds,
  clampIntoFootprint,
  pointInFootprint,
  type Footprint,
  type LayoutId,
} from './footprint';
import {
  anchorFor,
  groundY,
  isFloorStanding,
  ridesWall,
  wallAffinity,
  wallStandoff,
  CURTAIN_STANDOFF,
  snapToWall,
  pullToward,
  findSupportUnder,
  isTabletopProne,
  MOUNT_PAD,
} from './physics';
import type { CaptureSlot, RoomData } from './storage';
import { clampDims, dimRangeFor } from './dimension-ranges';
import {
  footArea,
  footFromPart,
  footInsidePoly,
  footIntersectionArea,
  footOverlap,
  localToWorld,
  nearestEdge,
  obbGap,
  worldToLocal,
  type Foot,
  type Poly,
} from './geometry';
import { aabbExtents } from './geometry';
import { backWall, baySides, roomBays, splitBay, type Bay } from './room-bays';
import {
  accessZones,
  belongTogether,
  doorPath,
  fixedBand,
  formsRoute,
  isObstacle,
  roleOf,
  routeWidth,
  sharesFloor,
  WALK_COMFORT,
  WALK_MIN,
  WALL_GAP,
} from './layout-rules';
import { openingsForRoom, type Opening } from './room-openings';
import { settleParts } from './layout-settle';
// Runtime, but not a cycle: `layout-score` takes only `ScenePart` from here and takes
// it as a TYPE, so the edge back is erased at compile.
import {
  costBreakdown,
  prepare,
  DEFAULT_WEIGHTS,
  NAV_CELL,
  STRANDED_PIECE,
  angleDelta,
  type LayoutContext,
} from './layout-score';

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
/** Radius of a ceiling fan's motor housing, in metres. The blades start here and
 *  `FanGeo` draws the same cylinder, so it is one number rather than two. */
export const FAN_HUB_R = 0.1;

/** Where one blade of a ceiling fan sits, given the fan's declared width.
 *
 *  Pulled out of `FanGeo` because it was WRONG and nothing could say so. The blade
 *  was `size: [r * 1.6]` at `position: [r * 0.6]`, and a box of length 1.6r centred
 *  at 0.6r runs from −0.2r to **1.4r** — so the catalog's 1000 mm fan swept 1.40 m,
 *  and every blade also crossed 100 mm through the far side of its own motor.
 *
 *  Rule 2's corollary, exactly: a shape's geometry must be authored at
 *  `part.dimMM`, because `Draggable` scales by `storedDim / part.dimMM` and a
 *  renderer with its own idea of the size renders the wrong size at scale 1. It was
 *  visible without opening the 3D tab, too — the plan draws a fan as a circle
 *  straight off `dimMM` (`circle: true`), so the two tabs disagreed by 40% on the
 *  same piece.
 *
 *  Returns metres. `tip` is the invariant worth testing: it is the fan's own
 *  radius, so the swept circle is the declared width and nothing else. */
export function fanBlade(widthMM: number): { hub: number; length: number; centre: number; tip: number } {
  const r = widthMM / 2000;
  // A fan narrower than its own hub is not reachable through `clampDims` (the
  // range starts at 900 mm) but the floor keeps this total rather than returning a
  // negative box, which three.js renders inside-out rather than refusing.
  const length = Math.max(0.05, r - FAN_HUB_R);
  return { hub: FAN_HUB_R, length, centre: FAN_HUB_R + length / 2, tip: FAN_HUB_R + length };
}

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
  /** True for a piece that came out of the user's own photo, false for one they
   *  added from the Library. Two consequences: a theme restyle skips it
   *  (`PartTree`), and it draws in `--locked` aubergine rather than `--accent`
   *  terracotta, solid rather than dashed, everywhere a plan or thumbnail draws
   *  furniture.
   *
   *  **The field name is the last place the word "locked" survives, and it is
   *  wrong.** Nothing about such a piece is locked — it drags, resizes, recolours
   *  and deletes like any other. The user-facing surfaces say "From photo" now;
   *  the name stays because `lib/scene-file.ts` writes this key into a saved room
   *  file, so renaming it is a file-format break for a word only developers read. */
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

/** The seeded floor lamp. Named because its own width is part of where it stands:
 *  `lamp-seat` is a GAP between footprints, so an offset that ignores the lamp's half
 *  width is off by that much. */
const LAMP_DIM: [number, number, number] = [300, 300, 1700];

/** The seeded side table, named for the same reason as `LAMP_DIM`: `side-table-seat`
 *  is a gap between footprints, so an offset that ignores this width is off by it. */
const SIDE_TABLE_DIM: [number, number, number] = [450, 450, 550];

/** The three-seater the living group is built around. Named because two different
 *  decisions read it: what to place, and how much wall a room needs before that
 *  wall can hold it. */
const SOFA: [number, number, number] = [2200, 950, 880];

/** …and the two-seater for a bay whose wall cannot leave a route past a three-seater.
 *
 *  A DIFFERENT piece of furniture, not a shrunken one — the same distinction the
 *  screen sizes make, and the one non-negotiable 2 is about. The T's stem is 2.42 m
 *  across; a 2.2 m sofa in it leaves 110 mm at each end, which seals the alcove, and
 *  the room report duly said so: "Coffee table sits in part of the room that nothing
 *  connects to the door". A 1.6 m loveseat leaves 410 mm each side, and the arrangement
 *  is one people actually build in a narrow room. */
const LOVESEAT: [number, number, number] = [1600, 900, 850];

/** Area rugs the living group will try, largest first. Ordinary retail sizes — a rug
 *  is a thing you buy in a size, so a narrow room gets the smaller rug rather than the
 *  big one drawn small. */
const RUGS: Array<[number, number, number]> = [
  [2400, 1600, 5],
  [1700, 1200, 5],
];


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

/** The furthest a sofa is worth putting from the biggest screen there is — the top of
 *  `layout-rules`' 1.2–2.5 × diagonal band, resolved for `SCREENS[0]` rather than
 *  written down again.
 *
 *  Backing the sofa onto the far side of a deep bay is right until the bay is deeper
 *  than any television can carry. Measured on the 7.5 × 5.6 open plan: 5.4 m, which the
 *  room report reads as too FAR and which no catalog panel can fix, because scaling one
 *  up would be inventing a screen nobody sells. Past this the sofa comes off the wall
 *  instead — which is what a large living room looks like anyway, and it leaves a route
 *  behind it. */
const MAX_VIEW = (2.5 * Math.hypot(SCREENS[0].dimMM[0], SCREENS[0].dimMM[2])) / 1000;

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

/** Does this opening sit in this frame's wall?
 *
 *  Same normal, and its centre projects inside the frame's run. What makes "not the
 *  door's wall, and not a window wall for a screen" answerable at all — and it is a
 *  question about the WALL, not about a distance, because a 65″ panel hung 200 mm to
 *  the side of a window is still on the window's wall. */
function frameCarries(f: SeedFrame, o: { x: number; z: number; rot: number }): boolean {
  const [onx, onz] = localToWorld(o.rot, 0, 1);
  if (onx * f.nx + onz * f.nz < 0.9) return false;
  // Along the frame, measured from its midpoint — the frame's own `u`.
  const [u] = worldToLocal(f.yaw, o.x - f.mx, o.z - f.mz);
  return Math.abs(u) <= f.width / 2 + 0.05;
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
 *  taken the back one.
 *
 *  A wall carrying a window is taken last. Full-height storage is exactly what the
 *  window rule exists to keep off a window wall, and with nothing stopping it the
 *  seeded U put its 2.1 m wardrobe squarely in front of one — a fault the room report
 *  raised on the first open, on the app's own starter room. */
function crossFrame(frames: SeedFrame[], f: SeedFrame, openings: Opening[] = []): SeedFrame | undefined {
  const square = frames.filter((c) => c.onWall && Math.abs(c.nx * f.nx + c.nz * f.nz) < 0.1);
  return square.find((c) => !openings.some((o) => frameCarries(c, o))) ?? square[0];
}

/** How far a candidate spot is from a piece already placed. */
function spotDistance(frame: SeedFrame, spot: { u: number; v: number }, from: ScenePart): number {
  const [x, z] = frame.at(spot.u, spot.v);
  return Math.hypot(x - from.pos[0], z - from.pos[2]);
}

/** Clear wall a piece of this width needs before that wall can hold it. */
const wallFor = (widthMM: number) => widthMM / 1000 + 0.2;

/** How far along its wall a group should sit, given how much spare wall there is.
 *
 *  Centred when the wall can spare a route at BOTH ends, and pushed to one side when
 *  it can only spare one — because one usable 600 mm route beats two unusable 410 mm
 *  ones, and a bay whose every route is unusable is a bay nothing can be reached in.
 *  Zero when there is not even one route to make, since sliding the group then only
 *  moves which end is blocked.
 *
 *  It is also the first thing here that does not put everything at `u = 0`, which is
 *  its own small part of why the starter rooms read as drawn rather than lived in. */
function offCentre(wallWidth: number, pieceWidth: number): number {
  const slack = wallWidth - pieceWidth;
  if (slack >= 2 * WALK_MIN || slack < WALK_MIN) return 0;
  // Leave a full walkway on one side; the remainder falls to the other.
  return -(slack - WALK_MIN) / 2;
}

const clampU = (u: number, travel: number) => Math.max(-travel, Math.min(travel, u));

/** Where a placed part sits along its frame — the `u` that put it there, read back.
 *  What lets the rest of a group follow a piece whose own position was searched for
 *  rather than computed. */
function frameU(f: SeedFrame, part: ScenePart): number {
  return worldToLocal(f.yaw, part.pos[0] - f.mx, part.pos[2] - f.mz)[0];
}

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
function viewingWall(frames: SeedFrame[], sofaDepthMM: number, openings: Opening[] = []): SeedFrame | null {
  return viewingWalls(frames, sofaDepthMM, openings)[0] ?? null;
}

/** Every wall that could carry the screen, best first — the ranked form of the
 *  choice above, and the reason `defaultScene` can search at all.
 *
 *  The score is a local opinion about one bay, formed before the seeder knows what
 *  the other bay will do, where the sofa will actually fit along the wall, or whether
 *  the result leaves a route. Those are the things that turn out to decide whether a
 *  room reads as arranged. So the runner-up walls are kept rather than discarded, and
 *  §3.10.3 part VI's constructive search builds a whole room on each of the first few
 *  and lets `costBreakdown` settle it. */
function viewingWalls(frames: SeedFrame[], sofaDepthMM: number, openings: Opening[] = []): SeedFrame[] {
  // Two walls are ruled out before any arithmetic, and this is where the starter
  // room stops being decided by arithmetic at all:
  //
  //   · **Not the door's wall.** A screen hung beside a doorway is watched from the
  //     other end of the room, which is where the door's own route in runs.
  //   · **Not a window wall.** A television in front of a window is the one placement
  //     every viewing guide names, and `layout-rules`' window rule would report it on
  //     the first open. Backing the sofa onto the window instead is the arrangement
  //     people actually build, and it is the one this now produces.
  //
  // Falling back rather than failing: a bedsit whose every wall carries an opening
  // still needs somewhere for the screen, and a reported window beats no room.
  const clear = frames.filter((f) => !openings.some((o) => frameCarries(f, o)));
  const pool = clear.length > 0 ? clear : frames;
  const ok: Array<{ f: SeedFrame; score: number }> = [];
  for (const f of pool) {
    if (!f.onWall) continue;
    if (f.width < wallFor(SOFA[0])) continue;
    // Depth has to seat the sofa at all before it is worth comparing.
    if (f.depth < sofaDepthMM / 1000 + 0.3) continue;
    ok.push({ f, score: Math.min(f.depth, VIEW_DEPTH_ENOUGH) * 2 + f.width });
  }
  // `pool` comes out of `seedFrames` in a deterministic order and the sort is stable,
  // so equal-scoring walls keep it: the search below must enumerate the same plans in
  // the same order every time, or a room would seed differently on its second open.
  ok.sort((a, b) => b.score - a.score);
  return ok.map((e) => e.f);
}

/** How far a group could sit from a screen in this bay — the depth of the wall the
 *  living group would actually use. What decides which bay a living room gets. */
function viewingDepth(bay: Bay, poly: Footprint, openings: Opening[]): number {
  const f = viewingWall(seedFrames(bay, poly), SOFA[1], openings);
  return f ? Math.min(f.depth, VIEW_DEPTH_ENOUGH) : 0;
}

/** The side facing the one given — where a sofa backed against `f`'s far end ends
 *  up. Whether THAT is a wall or an opening onto the rest of the room decides
 *  whether a route has to be left behind the sofa. */
function oppositeFrame(frames: SeedFrame[], f: SeedFrame): SeedFrame | undefined {
  return frames.find((c) => c.nx * f.nx + c.nz * f.nz < -0.9);
}

/** The choices a starter room is made of that the seeder cannot make well on its own.
 *
 *  Each one used to be decided greedily, in isolation, before the thing that would
 *  settle it was known — which wall a group backs onto is chosen by one bay's own
 *  arithmetic, and which bay a group gets is chosen from a viewing depth, both of them
 *  blind to what the other group is about to do with the room. See §3.10.3 part VI. */
type SeedPlan = {
  /** Swap the living and dining groups between the two bays. */
  swap: boolean;
  /** Rank into `viewingWalls` for the living group. */
  livingWall: number;
  /** Rank into `seedFrames` for whatever the second bay gets. */
  secondWall: number;
  /** Which rung of `BED_LADDER` the bedroom starts at. */
  bedRung: number;
};

/** How many runners-up each choice keeps — **four, because a bay has four sides.**
 *
 *  Not a budget. It was three to begin with, which is a budget wearing the clothes of a
 *  cap: it silently withheld one wall of every rectangular bay from the search, and the
 *  T's seeded cost went **5.5 → 1.6, with a sixteenth piece placed**, the moment the
 *  fourth was allowed. Five measures identical to four in every preset, which is the
 *  confirmation that four is the real ceiling and not another guess.
 *
 *  The product is what it bounds: 2 × 4 × 4 = **32 plans at most**, one build-and-score
 *  being 264–461 µs plus the clearance field, so the worst preset seeds in ~53 ms and a
 *  plain rectangle in 0.5 ms. §3.10.3 part VI has the arithmetic for why it is not 200.
 *
 *  `bedRung` does not raise that 32. It is only ever > 1 for the `u`, which has no
 *  swap and no second wall, so its product is 1 × 4 × 1 × 3 = 12; the `t`/`open`
 *  pair that sets the ceiling seeds no bedroom and stays at 2 × 4 × 4. */
const PLAN_RANKS = 4;

/** The bed sizes a starter bedroom may be built from, widest first.
 *
 *  EU mattress standards, and the same four rungs the catalog ships, so the seeded
 *  room and the Library agree about what a Queen is. Every one of them is 2000 long
 *  — width is the only axis that separates them, which is why a bed that does not
 *  work in a bay cannot be fixed by shortening it.
 *
 *  It is a LADDER rather than one size because a single is a different piece of
 *  furniture, not a resized double. The seeder walks down it when a rung will not
 *  fit, and `SeedPlan.bedRung` lets the plan search start further down — which is
 *  what it needs when a rung fits geometrically and still strands the floor behind
 *  it. Correcting the bed's transposed dims made that case real: at 6 × 5 the U's
 *  bay holds a 1600 × 2000 queen with bed, wardrobe and nightstands, and leaves no
 *  route to the door wider than 600 mm, so `navigabilityCost` charged the winning
 *  plan 750.6 where the mis-shaped bed had scored 0. The search was never blind; it
 *  had no better room to choose. This gives it one. */
export const BED_LADDER: ReadonlyArray<{ label: string; shape: Shape; dim: [number, number, number] }> = [
  { label: 'Queen bed', shape: 'bed-double', dim: [1600, 2000, 600] },
  { label: 'Double bed', shape: 'bed-double', dim: [1400, 2000, 600] },
  { label: 'Single bed', shape: 'bed-single', dim: [900, 2000, 600] },
];


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

  const build = (plan: SeedPlan): ScenePart[] => {
    const parts: ScenePart[] = [];
    const counters: Record<string, number> = {};

    // ── The openings, before any furniture ───────────────────────────────────
    //
    // A room with no door has no reason for any wall to be its back wall, which is
    // exactly why the arrangements below used to be decided by wall arithmetic and read
    // as arbitrary. Placed first so every group is arranged AGAINST them: the screen
    // avoids the door's wall and the windows, the door's swing and the way in from it
    // are floor nothing may be seeded onto, and a desk can find its daylight. See
    // `lib/room-openings.ts` for the two rules that choose them.
    const openings = openingsForRoom(poly);
    for (const o of openings) {
      const category: Category = o.kind === 'door' ? 'door' : 'other';
      const shape: Shape = o.kind === 'door' ? 'door' : 'window';
      counters[category] = (counters[category] ?? 0) + 1;
      parts.push({
        id: `${category}-${counters[category]}`,
        category,
        name: o.name,
        shape,
        pos: [o.x, o.y, o.z],
        rot: o.rot,
        dimMM: clampDims(category, shape, o.dimMM),
        locked: false,
        wallMounted: true,
      });
    }
    /** The floor an opening claims: a door's swing, and the route in from it. Nothing
     *  is seeded into either — the room report would report it on the first open, and
     *  a starter room that fails its own check is the worst possible first impression. */
    const openingZones: Foot[] = [];
    for (const p of parts) {
      if (p.category === 'door') {
        for (const zn of accessZones(p, p.pos[0], p.pos[2], p.rot)) openingZones.push(zn.foot);
        openingZones.push(doorPath(p, routeWidth(poly)));
      }
    }

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
        // Wrapped to (−π, π]. `angleDelta(x, 0)` is that, and reusing it beats a second
        // way of saying the same thing. A frame on the −π wall plus any turn away from
        // the room lands outside the principal range — the same rotation, written as
        // −188°, which is what `PlanChrome` would then print at the user.
        rot: angleDelta(frame.yaw + (opt.turn ?? 0), 0),
        dimMM: dim,
        locked: false,
        ...opt.extra,
      };
      if (!seats(candidate, parts, poly)) return null;
      if (blocksOpening(candidate, openingZones)) return null;
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
    const living = (bay: Bay, opt: { routeBehind?: boolean; wall?: number } = {}) => {
      const frames = seedFrames(bay, poly);
      const candidates = viewingWalls(frames, SOFA[1], openings);
      const f = candidates[opt.wall ?? 0] ?? candidates[0] ?? frames[0];

      // A three-seater only where the wall can still leave a route past one. A bay
      // narrower than that gets a two-seater, which is a different piece of furniture
      // rather than a shrunken one — see `LOVESEAT`, and rule 2.
      const sofaDim = f.width >= SOFA[0] / 1000 + WALK_MIN ? SOFA : LOVESEAT;
      const sofaHalf = sofaDim[1] / 2000;
      // Backed onto the far side of the bay — unless another group is on the other
      // side of that edge, in which case a route comes first. Circulation outranks
      // screen size here for the same reason it does in `layout-score`'s weights: a
      // walkway you cannot use is a worse room than a screen one size down. In the
      // T-shape this is the whole difference — 25 cm between the sofa's back and a
      // dining chair, or 60 cm and a 43″ set.
      //
      // …and never further from the screen than any screen can be watched from. A bay
      // deeper than `MAX_VIEW` stops being a reason to back the sofa further away and
      // starts being a room with a walkway behind the sofa, which is what it is.
      const behind = opt.routeBehind && !oppositeFrame(frames, f)?.onWall ? WALK_MIN : SEED_WALL_GAP;
      const vSofa = Math.max(
        sofaHalf + SEED_WALL_GAP,
        Math.min(f.depth - sofaHalf - behind, MAX_VIEW),
      );
      // The screen is CHOSEN, not scaled: the biggest panel in the catalog whose own
      // 1.2 × diagonal minimum fits the distance this wall can actually offer. A 43″
      // set in a shallow room is a different product, not a 65″ one drawn small — the
      // same distinction as a single bed instead of a double.
      const screen = screenFor(vSofa - 0.06);

      // ── Where along the wall the group sits ──────────────────────────────────
      //
      // Not `u = 0`. Two different things push it off centre, and both were reported
      // as faults on the app's own starter rooms before it did:
      //
      //   · **A seat across a narrow alcove is a wall.** The T's stem is 2.42 m and a
      //     centred two-seater leaves 410 mm at each end, so the room report said what
      //     it should — "Coffee table sits in part of the room that nothing connects to
      //     the door". Slid to one side the same furniture leaves one 600 mm route in.
      //   · **A door on the NEXT wall reaches round the corner.** The open plan's sofa
      //     clipped the swing of a door on the wall beside it by 5 % of its own
      //     footprint, so the placement was refused and the room came out with a
      //     television, a coffee table and nowhere to sit.
      //
      // So the offset is searched rather than computed: the composed answer first, then
      // steps out along the wall either way. Whatever the sofa accepts is where the
      // whole group goes, so the screen still faces the seat.
      const sofaW = sofaDim[0] / 1000;
      const travel = Math.max(0, (f.width - sofaW) / 2);
      const uBase = offCentre(f.width, sofaW);
      const uTries = [uBase];
      for (let step = 0.3; step <= travel + 1e-9; step += 0.3) {
        uTries.push(clampU(uBase + step, travel), clampU(uBase - step, travel));
      }
      const sofa = placeSomewhere(
        'sofa',
        'Sofa',
        'sofa',
        sofaDim,
        f,
        uTries.map((u) => ({ u, v: vSofa, turn: Math.PI })),
      );
      const uGroup = sofa ? frameU(f, sofa) : uBase;
      place('tv', screen.name, 'tv', screen.dimMM, f, uGroup, 0.06, { extra: { wallMounted: true } });

      // 450 mm off the sofa — the middle of layout-rules' reach-from-the-seat band —
      // but never through the screen wall behind it. Pulling the sofa forward for a
      // route (above) walks the table toward that wall, and in the T's stem it walked
      // 20 mm past it: the gap the relation wants is not always a gap the room has, and
      // the wall wins. The 400 mm end of the band absorbs the difference.
      const tableDim: [number, number, number] = [1100, 600, 420];
      const tableHalf = tableDim[1] / 2000;
      const vTable = Math.max(tableHalf + SEED_WALL_GAP, vSofa - sofaHalf - 0.45 - tableHalf);
      const table = place('table', 'Coffee table', 'coffee-table', tableDim, f, uGroup, vTable);

      // A rug under whichever of the two got placed, anchoring the group. Rugs come in
      // sizes, so a narrow bay gets a smaller one rather than a large one shoved through
      // the wall — the T's stem is 2.42 m across and a 2.4 m rug touches both sides of
      // it. Largest first; if neither fits, the group does without, which is honest.
      const vRug = table ? (vSofa + vTable) / 2 : vSofa - 0.4;
      if (sofa) {
        for (const dim of RUGS) {
          if (place('rug', 'Area rug', 'rug', dim, f, uGroup, vRug)) break;
        }
      }

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
      //
      // Beside the sofa, at a gap taken from `lamp-seat` itself rather than restated
      // here. A quarter of the band keeps the lamp at the near end of what the rule
      // allows — "beside the seat it lights" means beside it — while staying inside
      // whatever the rule currently says, which a copied figure cannot promise.
      // Derived from the sofa actually placed too, so a loveseat's lamp comes in
      // closer rather than sitting at a three-seater's offset.
      const lampGap = (fixedBand('lamp-seat')?.[1] ?? 0.7) * 0.25;
      const lampU = sofaDim[0] / 2000 + LAMP_DIM[0] / 2000 + lampGap;
      placeSomewhere(
        'lamp',
        'Floor lamp',
        'lamp-floor',
        LAMP_DIM,
        f,
        // Beside the sofa FIRST, the ends of the wall only as a fallback — and beside
        // the sofa where the sofa actually is, not where `u = 0` is.
        //
        // Both halves of that were wrong, and together they were the single largest
        // fault left in any starter room. `lamp-seat` asks for a 0–0.7 m gap to the
        // seat it lights; the wall-end spots came first in this list and fit, so the
        // lamp took one — 2.75 m from the sofa on the L's 6 m wall. That one piece was
        // 3.7–5.0 of the L's 6.63 relation cost, and moving it was the biggest single
        // gain Suggest could find on a brand-new room. Which is the complaint this
        // whole line of work started from: the app shipping a room, then immediately
        // offering to fix it.
        //
        // The `u = 0` half is drift. These offsets were written when the group was
        // centred on its wall; the sofa's `u` is SEARCHED now (see `uTries`), and
        // nothing moved these with it — so on any wall where the search shifted the
        // group, "beside the sofa" pointed at empty floor.
        [
          { u: uGroup + lampU, v: vSofa },
          { u: uGroup - lampU, v: vSofa },
          { u: f.width / 2 - 0.25, v: vSofa },
          { u: -(f.width / 2 - 0.25), v: vSofa },
        ],
        { circle: true },
      );
    };

    // ── Dining: a table off the middle of the bay, chairs tucked under it ──────
    const dining = (bay: Bay, opt: { wall?: number } = {}) => {
      const frames = seedFrames(bay, poly);
      const f = frames[opt.wall ?? 0] ?? frames[0];
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
    const bedroom = (bay: Bay, opt: { wall?: number; rung?: number } = {}) => {
      const frames = seedFrames(bay, poly);
      const f = frames[opt.wall ?? 0] ?? frames[0];
      // Down the ladder from wherever the plan starts. `bed` is whatever actually
      // landed, so `bedHalfW` below is the placed bed's width and not the wished-for
      // one — the nightstands follow the bed that exists.
      const start = Math.min(opt.rung ?? 0, BED_LADDER.length - 1);
      let sleeper: ScenePart | null = null;
      let bed: [number, number, number] = BED_LADDER[start].dim;
      for (let i = start; i < BED_LADDER.length && !sleeper; i++) {
        const rung = BED_LADDER[i];
        // Derived from the rung, never typed beside it: half the LENGTH is how far the
        // bed stands off the wall its head is against.
        sleeper = place('bed', rung.label, rung.shape, rung.dim, f, 0, rung.dim[1] / 2000 + SEED_WALL_GAP);
        if (sleeper) bed = rung.dim;
      }
      const bedHalfW = bed[0] / 2000;
      // Touching the head end on both sides — layout-rules wants a nightstand within
      // 150 mm of the bed, and both sides of a double are somebody's side.
      const stand: [number, number, number] = [450, 400, 550];
      const uStand = bedHalfW + stand[0] / 2000 + SEED_WALL_GAP;
      for (const u of [-uStand, uStand]) {
        place('nightstand', 'Nightstand', 'nightstand', stand, f, u, stand[1] / 2000 + SEED_WALL_GAP);
      }

      // Wardrobe on a side wall, where its 600 mm of door swing is not the bed.
      const side = crossFrame(frames, f, openings) ?? f;
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
    const nook = (bay: Bay, opt: { wall?: number } = {}) => {
      const frames = seedFrames(bay, poly);
      const f = frames[opt.wall ?? 0] ?? frames[0];
      const chair: [number, number, number] = [800, 800, 900];
      const chairHalf = chair[1] / 2000;
      const vChair = Math.min(f.depth - chairHalf - SEED_WALL_GAP, chairHalf + 0.35);
      // Along the wing, AWAY from the living group and not pinching it. A wing opens off
      // the room's main bay, so the nook's default end is the shared edge — which put
      // the armchair 250 mm behind the sofa's back, i.e. across the only route from one
      // half of the room to the other.
      const group = parts.find((p) => p.category === 'sofa') ?? null;
      // …and TURNED TOWARD it, which is the half of `armchair-sofa` that a distance
      // cannot state. `relationCost` charges a `faces` relation twice: once for the gap,
      // once for the heading — `2 × angleCost` — and the seeder was only ever answering
      // the first. On the L that was the WHOLE of its relation cost: the armchair sat
      // 2.355 m from the sofa with a 1.2–2.6 m band, i.e. dead centre, and was still
      // charged 0.479 for sitting square to its own wall while the sofa lay 43° off its
      // nose. `Suggest` then answered the only way it could — by shoving a chair that
      // was already in the right place, up to 735 mm, on every seed.
      //
      // Derived from the spot, not chosen: each candidate carries the turn that aims it
      // at the group from THERE, so `seats` tests the footprint the chair will actually
      // have. An angled chair is also free under `alignment`, which asks for a quarter
      // turn from something and forgives 45° outright.
      const aimAtGroup = (u: number, v: number): number => {
        if (!group) return 0;
        const [x, z] = f.at(u, v);
        return angleDelta(Math.atan2(group.pos[0] - x, group.pos[2] - z), f.yaw);
      };
      const armchair = placeSomewhere(
        'chair',
        'Armchair',
        'chair-armchair',
        chair,
        f,
        [0.35, -0.35, 0].map((u) => ({ u, v: vChair, turn: aimAtGroup(u, vChair) })),
        {},
        group,
        true,
      );
      if (armchair) {
        // Within reach of the arm of the chair, on whichever side has the room — at a
        // gap taken from `side-table-seat` rather than restated here, for the same
        // reason the floor lamp's is. A quarter of the band: "within reach of the arm"
        // means the near end of what the rule allows, not the middle of it.
        const [uChair] = worldToLocal(f.yaw, armchair.pos[0] - f.mx, armchair.pos[2] - f.mz);
        const sideGap = (fixedBand('side-table-seat')?.[1] ?? 0.4) * 0.25;
        const reach = chair[0] / 2000 + SIDE_TABLE_DIM[0] / 2000 + sideGap;
        placeSomewhere(
          'table',
          'Side table',
          'side-table',
          SIDE_TABLE_DIM,
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
      const side = crossFrame(frames, f, openings) ?? f;
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
    const second = (minArea: number) => secondBay(bays, minArea);
    const halves = (minArea: number) => halveBays(bays, minArea);

    switch (layoutId) {
      case 'u': {
        bedroom(bays[0], { wall: plan.livingWall, rung: plan.bedRung });
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
          //
          // That reading is still the plan the search starts from — `plan.swap` is
          // false for the first candidate — but it is now a starting point and not the
          // answer: viewing depth is one bay's opinion of itself, and which bay should
          // hold the sofa also depends on where the dining set then has to go.
          const [a, b] = pair;
          const deeper = viewingDepth(b, poly, openings) > viewingDepth(a, poly, openings) + 0.05;
          const flip = plan.swap ? !deeper : deeper;
          living(flip ? b : a, { routeBehind: true, wall: plan.livingWall });
          dining(flip ? a : b, { wall: plan.secondWall });
        } else {
          living(bays[0], { wall: plan.livingWall });
        }
        break;
      }
      case 'l': {
        living(bays[0], { wall: plan.livingWall });
        const wing = second(2.5);
        if (wing) nook(wing, { wall: plan.secondWall });
        break;
      }
      default: {
        living(bays[0], { wall: plan.livingWall });
        // A custom footprint can have a wing the presets don't; furnish it if so.
        const wing = second(2.5);
        if (wing) nook(wing, { wall: plan.secondWall });
      }
    }

    // ── Dressing, once the furniture is settled ──────────────────────────────
    //
    // The other half of "it doesn't look like a room someone lives in". Everything
    // above answers where the furniture goes; none of it answers why the room looks
    // like a showroom, and the answer to that is that a showroom has no pictures, no
    // curtains and one light. Five to nine pieces of furniture on bare walls is a
    // vignette.
    //
    // Every piece here is **wall- or ceiling-mounted**, which is what makes it safe to
    // add late: `isObstacle` is false for all of them, so none of it takes floor, blocks
    // a route, narrows a walkway or enters anybody's access zone. It costs nothing in
    // the room report and it is most of the difference in the scene. The catalog already
    // carries every one of them.
    dress(parts, poly, height, counters);

    // Belt and braces. Everything above is gated on fitting, so this normally has
    // nothing to do — but it is the same guarantee the detection path needs, and one
    // function making it for both beats two hand-checked seeds.
    return settleParts(parts, poly);
  };

  // ── The search: build a few whole rooms and keep the one that scores best ──
  //
  // §3.10.3 part VI. Every choice above is a local one: which wall the sofa backs
  // onto is decided from one bay's own width and depth, and which bay the living
  // group gets is decided from a viewing depth — both of them before the seeder knows
  // what the other group will do, where the sofa will actually fit along that wall, or
  // whether the result leaves anyone a way through. That is measurable rather than
  // aesthetic: the seeded T scored **85.5** against a cost function that was sitting
  // right there and was never asked.
  //
  // So the choices become a plan, a few plans get built in full, and `costBreakdown`
  // — the same function the solver descends — says which room won. The seeder can no
  // longer emit a room its own cost function hates, because that room now has to beat
  // the others.
  //
  // **Including the clearance field, on every candidate.** The solver cannot afford
  // that and tiers instead; this does not have to, and the difference is the size of
  // the candidate set, not a difference of opinion about the cost. `solveLayout`
  // evaluates around sixteen thousand proposals, where a term 65–92× an evaluation is
  // the entire budget; `enumeratePlans` returns **thirty-two at the very most**, where
  // the same term is ~1.5 ms each and the worst preset seeds in 48 ms.
  //
  // Two tiers were tried here first, and were wrong twice over. Circulation is not
  // predictable from the other terms — that is the whole reason it exists as a term —
  // so any filter that ranks without it drops rooms that would have won. Measured on
  // the T, where every plan but one strands floor: a 15-piece plan sealing off 2.36 m²
  // filled all four finalist slots, and reserving a slot per part count only moved the
  // failure down a level, since the cheapest 14-piece plan strands 2.43 m² while the
  // third-cheapest strands none. The room that shipped had two clearance findings on
  // its first open. A cheap filter in front of an unpredictable term is a way of not
  // asking the question.
  const plans = enumeratePlans(layoutId, bays, poly);
  if (plans.length === 1) return build(plans[0]);

  const built = plans.map(build);
  // A plan that simply failed to place things is not a tidy room, it is an empty one,
  // and every term here gets CHEAPER as furniture is removed. So a piece that could
  // not be placed is charged at exactly what a piece nobody can reach is charged —
  // `STRANDED_PIECE` at the navigation weight — which is the same failure stated
  // twice: part of the room is not part of the room.
  //
  // That charge is FLAT, and the sentence above is true of a nightstand and false of
  // the piece the room is named after. A missing nightstand and a missing bed are both
  // 240 units, which is why a bedless plan could win a bedroom: measured at the U's
  // 6 × 4, the bedless room scored 484.06 against the best bed-bearing room's 496.95
  // and took the room by 2.7%. Rule (B) below is what answers that, rather than a
  // heavier charge — a weight tuned until the bed wins is a weight tuned against the
  // one size someone happened to print.
  const most = Math.max(...built.map((p) => p.length));

  const scored = built.map((parts, i) => {
    const ctx: LayoutContext = { parts, movable: parts.map(() => true), footprint: poly };
    const model = prepare(ctx);
    const places = parts.map((p) => ({ x: p.pos[0], z: p.pos[2], yaw: p.rot }));
    const missing = (most - parts.length) * STRANDED_PIECE * DEFAULT_WEIGHTS.navigation;
    const bd = costBreakdown(model, places, DEFAULT_WEIGHTS, NAV_CELL);
    return {
      parts,
      rung: plans[i].bedRung,
      hasBed: parts.some((q) => q.category === 'bed'),
      navigation: bd.navigation,
      total: bd.total + missing,
    };
  });

  // Strictly less than, so an exact tie keeps the earlier plan — and plan zero is
  // the greedy one, so a room the search cannot improve on comes out unchanged.
  const cheapest = (of: typeof scored): ScenePart[] => {
    let best = of[0].parts;
    let bestCost = Infinity;
    for (const c of of) {
      if (c.total < bestCost) {
        bestCost = c.total;
        best = c.parts;
      }
    }
    return best;
  };

  // ── Which BED, before which wall ─────────────────────────────────────────────
  //
  // The rung is not a cost dimension, and letting it be one was measured doing real
  // damage: at the U's 8 × 7.5 all three rungs place thirteen pieces with navigation
  // 0.0 and nothing missing, and their totals are 4.31 / 4.29 / 4.28 — so the bed in
  // a user's starter bedroom was decided by 0.03 on 4.3, under 1%, in terms that say
  // nothing about beds. 8 × 6.5 gave the queen and 8 × 7.5 the single off the same
  // ladder, which is a BIGGER room getting a SMALLER bed; the U's bays are strictly
  // monotonic in depth (measured), so that was never the footprint's doing.
  //
  // `DEFAULT_WEIGHTS` has no opinion about bed size, and the honest answer to that is
  // to take the choice away from it rather than to add a term that gives it one. A
  // lexicographic "cheapest, then widest" does not work either: 4.28 and 4.29 are not
  // a tie, so the widest-bed criterion never runs unless it is "within ε", and ε is
  // the tuned constant in a different coat.
  //
  // So the rung is chosen first, by a predicate, and the wall search runs inside it:
  //
  //   (A) the widest rung whose best plan places the bed AND strands nothing.
  //       `navigation === 0` is not a threshold — it is the definition of "this room
  //       strands no floor", and it is already computed. Monotonic by construction: a
  //       deeper bay cannot make a narrow rung qualify where a wide one did not.
  //   (B) failing that, the widest rung that places a bed AT ALL, and `clearance.ts`
  //       reports the route. This is rule 2 of CLAUDE.md where nobody had applied it —
  //       dropping the piece is the limit case of silently resizing it to fit, and the
  //       one form of it the user cannot see. A stranded route is a warning they can
  //       act on; a missing bed is absence.
  //   (C) no plan places a bed — every preset but the `u`, which seeds no bedroom at
  //       all — and the global cheapest stands, exactly as before.
  const rungsPresent = [...new Set(scored.map((c) => c.rung))].sort((a, b) => a - b);
  for (const stage of [(c: (typeof scored)[number]) => c.hasBed && c.navigation === 0, (c: (typeof scored)[number]) => c.hasBed]) {
    for (const rung of rungsPresent) {
      const ok = scored.filter((c) => c.rung === rung && stage(c));
      if (ok.length) return cheapest(ok);
    }
  }
  return cheapest(scored);
}

/** Which bay a second group would get, and how a lone bay is cut in half for two. */
function secondBay(bays: Bay[], minArea: number): Bay | null {
  return bays[1] && bays[1].area >= minArea ? bays[1] : null;
}
function halveBays(bays: Bay[], minArea: number): [Bay, Bay] | null {
  const b = secondBay(bays, minArea);
  if (b) return [bays[0], b];
  if (bays[0].area >= minArea * 2.4) return splitBay(bays[0]);
  return null;
}

/** The plans worth building for this room.
 *
 *  Bounded by construction rather than by a budget: the product of how many real
 *  alternatives each choice has, capped at `PLAN_RANKS`. A room with one usable
 *  viewing wall and no second group therefore gets **one plan and no search at all**,
 *  which is the common case and costs exactly what the seeder cost before.
 *
 *  It mirrors the switch in `defaultScene` rather than approximating it, and that is
 *  load-bearing in both directions: enumerating a knob the layout does not read builds
 *  the identical room several times over — the first draft did, three times for a plain
 *  rectangle — and enumerating too few silently narrows the search to the greedy
 *  answer. Both are invisible; only the second is harmful, and it is the one that
 *  looks like success.
 *
 *  Plan zero is always the greedy plan — no swap, top-ranked wall for both groups —
 *  which is the room the seeder produced before this existed. The search can therefore
 *  only ever return that room or one that scores better than it. */
function enumeratePlans(layoutId: LayoutId, bays: Bay[], poly: Footprint): SeedPlan[] {
  const openings = openingsForRoom(poly);
  /** How many walls of this bay are genuinely different choices for this group. */
  const ranks = (bay: Bay | null | undefined, viewing: boolean): number => {
    if (!bay) return 1;
    const frames = seedFrames(bay, poly);
    const n = viewing ? viewingWalls(frames, SOFA[1], openings).length : frames.length;
    return Math.max(1, Math.min(PLAN_RANKS, n));
  };

  let first = 1;
  let second = 1;
  let swaps = [false];
  // Only a preset that seeds a bedroom has a rung to choose.
  let rungs = 1;
  switch (layoutId) {
    case 'u':
      // The bed's wall is the whole room's axis, and the alcove is a plant: nothing
      // to swap and no second wall to choose.
      first = ranks(bays[0], false);
      rungs = BED_LADDER.length;
      break;
    case 't':
    case 'open': {
      const pair = halveBays(bays, 4.5);
      if (pair) {
        // Either half may end up holding the living group, so the index has to span
        // whichever offers more — a rank that no plan can use costs one build.
        first = Math.max(ranks(pair[0], true), ranks(pair[1], true));
        second = Math.max(ranks(pair[0], false), ranks(pair[1], false));
        swaps = [false, true];
      } else {
        first = ranks(bays[0], true);
      }
      break;
    }
    default: {
      // `l`, and any footprint the presets do not name. A wing is furnished if there
      // is one; if there is not, the second wall is not a choice.
      first = ranks(bays[0], true);
      second = ranks(secondBay(bays, 2.5), false);
    }
  }

  const plans: SeedPlan[] = [];
  for (const swap of swaps) {
    for (let livingWall = 0; livingWall < first; livingWall++) {
      for (let secondWall = 0; secondWall < second; secondWall++) {
        for (let bedRung = 0; bedRung < rungs; bedRung++) {
          plans.push({ swap, livingWall, secondWall, bedRung });
        }
      }
    }
  }
  return plans;
}

// ─── Dressing ───────────────────────────────────────────────────────────────
//
// What turns a plan into a room. Each rule is one sentence of ordinary domestic
// sense, applied to whatever the seeder actually managed to place:
//
//   · a picture goes over the sofa or the bed, centred on it, at gallery height;
//   · every window gets curtains;
//   · a pendant hangs over the dining table;
//   · a lamp stands on each nightstand.
//
// Nothing here is placed unless the thing it belongs to exists, so a room with no bed
// gets no bedside lamp and a room with no window gets no curtains. And nothing here
// takes floor: `isObstacle` is false for every one of them.

/** Centre height of a picture hung over furniture. Museums hang to a 1.45 m centre
 *  and living rooms hang lower over a sofa; this is the compromise both look right
 *  at, and it is clamped to the room so a low ceiling does not put art in the coving. */
const ART_CENTRE = 1.45;

/** How far a curtain overhangs the window it dresses, each side. Curtains that stop
 *  at the reveal look like blinds. */
const CURTAIN_OVERHANG = 0.2;


/** Add the wall- and ceiling-mounted pieces that make a room look inhabited.
 *
 *  Mutates `parts`, which is what everything else in `defaultScene` does — it runs
 *  once, at the end, and `settleParts` leaves wall-mounted pieces alone. */
function dress(
  parts: ScenePart[],
  poly: Footprint,
  height: number,
  counters: Record<string, number>,
): void {
  const add = (
    category: Category,
    name: string,
    shape: Shape,
    dimMM: [number, number, number],
    pos: [number, number, number],
    rot: number,
    extra: Partial<ScenePart> = {},
  ) => {
    counters[category] = (counters[category] ?? 0) + 1;
    parts.push({
      id: `${category}-${counters[category]}`,
      category,
      name,
      shape,
      pos,
      rot,
      dimMM: clampDims(category, shape, dimMM),
      locked: false,
      wallMounted: true,
      ...extra,
    });
  };

  const roles = parts.map(roleOf);
  const at = (i: number) => parts[i];

  // ── Curtains, one pair per window ────────────────────────────────────────
  for (let i = 0; i < parts.length; i++) {
    if (roles[i] !== 'window') continue;
    const w = at(i);
    const width = w.dimMM[0] / 1000 + CURTAIN_OVERHANG * 2;
    // Hung from the ceiling, on the window's own wall and facing the way it does, so
    // a window on any wall of any footprint is dressed by the same two lines. The Y
    // comes from `groundY`, which is the one place that knows a curtain is ceiling-
    // anchored — writing 0 here left every pair of curtains lying on the floor.
    // Floor to just under the ceiling, and positioned at its MESH CENTRE — which is
    // what `placementForSlot` does for a curtain and what `groundY` does not: its
    // `ceiling` branch is for a pendant or a fan, small things hung just below the
    // slab, and using it put a 2.6 m curtain's centre at 2.65 m, i.e. most of it
    // through the ceiling.
    const drop = Math.max(1.2, height - 0.2);
    const dim: [number, number, number] = [width * 1000, 80, drop * 1000];
    // In FRONT of the glass, along the window's own facing direction — `w.rot` is
    // the wall's yaw and local +Z faces into the room, so `localToWorld` is the
    // one expression that gets this right on all four walls of any footprint.
    const [ox, oz] = localToWorld(w.rot, 0, w.dimMM[1] / 2000 + CURTAIN_STANDOFF);
    add('curtain', 'Curtains', 'curtain', dim, [w.pos[0] + ox, height - drop / 2 - 0.05, w.pos[2] + oz], w.rot);
  }

  // ── A picture over the sofa, or over the bed ─────────────────────────────
  //
  // Only when the piece has a wall behind it to hang on. `nearestEdge` from the
  // piece's own BACK rather than its centre, because that is the wall it is against.
  for (const want of ['sofa', 'bed'] as const) {
    const i = parts.findIndex((_, k) => roles[k] === want);
    if (i < 0) continue;
    const p = at(i);
    const [bx, bz] = localToWorld(p.rot, 0, -(p.dimMM[1] / 2000));
    const back = nearestEdge(poly, p.pos[0] + bx, p.pos[2] + bz);
    if (!back || back.dist > 0.35) continue;
    // Facing the same way the piece does: the wall behind a sofa faces the room.
    if (Math.cos(back.yaw - p.rot) < 0.9) continue;
    const w = Math.min(1.2, (p.dimMM[0] / 1000) * 0.6);
    add(
      'painting',
      'Framed print',
      'painting',
      [w * 1000, 30, w * 700],
      [back.px + back.nx * 0.03, Math.min(ART_CENTRE, height - 0.5), back.pz + back.nz * 0.03],
      back.yaw,
    );
  }

  // ── A pendant over the dining table ──────────────────────────────────────
  const table = parts.findIndex((_, k) => roles[k] === 'dining-table');
  if (table >= 0) {
    const t = at(table);
    // Ceiling-anchored, so `groundY` decides the height rather than a number here.
    add('lamp', 'Pendant', 'lamp-pendant', [350, 350, 400], [t.pos[0], 0, t.pos[2]], t.rot, {
      wallMounted: false,
      circle: true,
    });
    const last = parts[parts.length - 1];
    last.pos[1] = groundY('lamp', 'lamp-pendant', last.dimMM, height);
  }

  // ── A lamp on each nightstand ────────────────────────────────────────────
  for (let i = 0; i < parts.length; i++) {
    if (roles[i] !== 'nightstand') continue;
    const s = at(i);
    add('lamp', 'Bedside lamp', 'lamp-table', [250, 250, 500], [s.pos[0], s.pos[1] + s.dimMM[2] / 1000, s.pos[2]], s.rot, {
      wallMounted: false,
    });
  }
}

/** Would this piece leave a gap too narrow to walk down, against anything already
 *  placed?
 *
 *  The room report's own reading of a pinch, so a piece rejected here is exactly a
 *  piece that would have produced a "tight walkway" finding: flush is deliberate
 *  composition and fine, wide open is fine, and the band between is the problem.
 *  Pairs the relation table puts together are exempt — a lamp beside the sofa it
 *  lights is not a corridor. */
/** Would this piece stand in a door's swing, or across the way in from it?
 *
 *  A rug may — it is what goes inside a doorway — and nothing wall-mounted or
 *  ankle-high is in anybody's way. Everything else is refused the spot and the caller
 *  tries the next one, which is the whole mechanism by which a seeded room now has a
 *  door you can open. */
function blocksOpening(part: ScenePart, zones: Foot[]): boolean {
  if (zones.length === 0 || part.wallMounted || !isObstacle(part)) return false;
  const foot = footFromPart(part.pos, part.rot, part.dimMM, part.circle);
  const area = footArea(foot) || 1;
  for (const zn of zones) {
    if (footIntersectionArea(foot, zn) / area > SEED_TOUCH_SHARE) return true;
  }
  return false;
}

function pinches(part: ScenePart, placed: ScenePart[]): boolean {
  const foot = footFromPart(part.pos, part.rot, part.dimMM, part.circle);
  // Only between pieces whose gap is a route someone walks down — `formsRoute`, the
  // same predicate the report and the solver read. Without it this refused to seed a
  // dining chair beside its neighbour, which is not a corridor and is how a table
  // ends up with three chairs.
  if (!formsRoute(roleOf(part))) return false;
  for (const o of placed) {
    if (o.wallMounted || o.category === 'rug' || !isObstacle(o)) continue;
    if (!formsRoute(roleOf(o))) continue;
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
  group: 'Seating' | 'Tables' | 'Storage' | 'Bedroom' | 'Lighting' | 'Decor' | 'Tech' | 'Appliances';
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

/**
 * A three.js group scale, read back as millimetres.
 *
 * The axis mapping is the whole content and it is not the identity: a `dimMM` is
 * `[width, DEPTH, HEIGHT]` while a three.js scale is `(x, y = up, z)`, so depth and
 * height cross over. Getting it backwards swaps a wardrobe's depth with its height
 * — invisible on anything square, gross on anything that is not.
 *
 * Here rather than in the component that uses it, where it was written out three
 * times, because arithmetic that exists only inside a TSX renderer is arithmetic no
 * test can reach. That is the `fanBlade` scar. `renderBaseDim` in lib/transforms.ts
 * is what decides the `base` these take.
 */
export function dimFromGroupScale(
  base: [number, number, number],
  scale: { x: number; y: number; z: number },
): [number, number, number] {
  return [base[0] * scale.x, base[1] * scale.z, base[2] * scale.y];
}

/** The inverse of `dimFromGroupScale`, in three.js's own `(x, y, z)` order. */
export function groupScaleForDim(
  base: [number, number, number],
  dim: [number, number, number],
): [number, number, number] {
  return [dim[0] / base[0], dim[2] / base[2], dim[1] / base[1]];
}

/** How wide (or tall) one module of a parametric shape wants to be, in METRES.
 *
 *  A parametric shape tiles: a wider wardrobe gains a bay, a longer sofa gains a
 *  cushion. Every one of them used to derive its count the same way, inline in its
 *  renderer — `Math.round(span / nominal)` — and that expression minimises the error
 *  in the COUNT while saying nothing about the module, which is the thing with a
 *  real-world size. The wardrobe showed it worst: at 890 mm, `round(0.89 / 0.6)` is
 *  1, so it drew a single 890 mm door; at 900 mm it drew two of 450. Dragging the
 *  width handle through that band made the doors grow to an impossible width and
 *  then snap to a different count, which is what "the models are not modular
 *  enough" describes.
 *
 *  So the count comes off the MODULE's range instead. Three numbers rather than
 *  one, and the pair of bounds is what does the work — the same argument
 *  `boundsToUnit` is built on in `lib/units.ts`: one end cannot tell you whether an
 *  interval survived.
 *
 *  `max >= 2 * min` for every row below, and that is a constraint rather than a
 *  coincidence. Where it fails there are spans no integer count can tile inside the
 *  range at all — with min 450 and max 750, an 890 mm wardrobe has no legal answer,
 *  since one bay is over the max and two are under the min. `moduleCount` still
 *  returns something there (see below), but the range would be quietly unsatisfiable
 *  in a band nobody had noticed, which is the shape of defect this replaces.
 *
 *  The nominals are chosen so that **every shipped catalog preset keeps the count it
 *  has today**. That is deliberate and it is not a "keep the look" dodge: the defect
 *  is in the bands between the presets, and a change that also redrew the four
 *  pieces the presets describe would make it impossible to tell a fix from a
 *  restyle. `tests/module-tiling.test.ts` pins both halves — the presets by name and
 *  the whole legal range by sweep. */
export type ModuleRange = { min: number; nominal: number; max: number };

export const MODULE_RANGE: Partial<Record<Shape, ModuleRange>> = {
  // A wardrobe bay is a door. 400–800 mm covers a narrow single through a wide
  // slider; 600 is the classic single-door width and keeps the 2400 mm preset at the
  // four bays it draws today.
  wardrobe: { min: 0.4, nominal: 0.6, max: 0.8 },
  closet: { min: 0.4, nominal: 0.6, max: 0.8 },
  // A seat cushion. The nominal is high in its own range on purpose: 900 mm is a
  // two-seater's cushion and it is what keeps the 2200 mm preset at two rather than
  // silently promoting it to a three-seater.
  sofa: { min: 0.47, nominal: 0.9, max: 0.95 },
  // A shelf gap.
  bookshelf: { min: 0.22, nominal: 0.35, max: 0.45 },
  // A shoe tier.
  'shoe-rack': { min: 0.13, nominal: 0.2, max: 0.26 },
  // A curtain pleat. The old floor of 8 pleats produced 50 mm pleats on a 400 mm
  // curtain — below any plausible minimum — so the floor goes and the range answers.
  curtain: { min: 0.07, nominal: 0.11, max: 0.14 },
};

/** How many modules tile `span` metres, preferring a module near `nominal` and
 *  keeping it inside `[min, max]` whenever an integer count can.
 *
 *  Monotonic in `span` — a piece that gets wider never loses a module. `Math.round`
 *  on its own is not: it flips at each half-step, which is the jump the wardrobe
 *  showed. All three quantities here are non-decreasing in `span`, and
 *  `tests/module-tiling.test.ts` sweeps for it rather than trusting the argument.
 *
 *  When no count keeps the module in range — possible only if a row breaks the
 *  `max >= 2 * min` rule above — it falls back to the count nearest `nominal`, which
 *  is exactly the old behaviour. So a bad range degrades to what shipped rather than
 *  to nonsense, and the sweep is what says whether any row is in that state. */
export function moduleCount(span: number, r: ModuleRange): number {
  if (!Number.isFinite(span) || span <= 0) return 1;
  const target = Math.max(1, Math.round(span / r.nominal));
  const lo = Math.max(1, Math.ceil(span / r.max));
  const hi = Math.floor(span / r.min);
  // Not a two-sided clamp: `hi < lo` means the interval is empty, and clamping
  // through an inverted interval lands on whichever bound is applied second — the
  // `NumberField` scar in CLAUDE.md, where a door's inverted range made every press
  // land on `min` and DOWN raise its maximum.
  if (hi < lo) return target;
  return Math.min(hi, Math.max(lo, target));
}

/** The module range a parametric shape tiles by, or `null` for a shape that does not
 *  tile. Separate from `MODULE_RANGE` so a caller reads one shape rather than the
 *  table, and so a shape added to `PARAMETRIC_SHAPES` without a range is a `null`
 *  a renderer must handle rather than an `undefined` it will spread into NaN. */
export function moduleRangeFor(shape: Shape): ModuleRange | null {
  return MODULE_RANGE[shape] ?? null;
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
  { label: 'Sofa', group: 'Seating', category: 'sofa', shape: 'sofa', dimMM: [2200, 950, 880] },
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
  { label: 'Wardrobe', group: 'Storage', category: 'wardrobe', shape: 'wardrobe', dimMM: [2400, 600, 2200] },
  { label: 'Bookshelf', group: 'Storage', category: 'shelf', shape: 'bookshelf', dimMM: [900, 350, 1800] },
  { label: 'Shoe rack', group: 'Storage', category: 'shelf', shape: 'shoe-rack', dimMM: [800, 300, 900] },
  // Bedroom. Beds are the one place where size classes are real products rather
  // than variants of each other — a king will not fit where a single does — so
  // the ladder is a deliberate three, authored INSIDE clampDims' bed bands (the
  // old preset sheet's dims sat outside them and were silently clamped on add).
  // Everything between the rungs is reachable by resizing.
  // Mattress sizes are EU standards and every one of them is 2000 long; what
  // separates the rungs is WIDTH. dimMM is [W, L, H] here as everywhere -- see the
  // note above the ladder for why that had to be said twice.
  { label: 'Single bed', group: 'Bedroom', category: 'bed', shape: 'bed-single', dimMM: [900, 2000, 600] },
  { label: 'Double bed', group: 'Bedroom', category: 'bed', shape: 'bed-double', dimMM: [1400, 2000, 600] },
  { label: 'Queen bed', group: 'Bedroom', category: 'bed', shape: 'bed-double', dimMM: [1600, 2000, 600] },
  // 600 mm, the same as the others: `BedGeo` scales the frame, mattress, duvet,
  // pillows AND a `h * 1.4` headboard off dimMM[2], so a taller number here does
  // not make a king-size bed — it makes a 67%-larger bed with a 1.4 m headboard.
  // A king is WIDER than a double, and width is dimMM[0].
  //
  // That last sentence used to end "which is dimMM[1]'s job", and it is the whole
  // reason this ladder was transposed for as long as it was: the belief was
  // written down beside the numbers it produced, so every reader who checked the
  // numbers against the comment found them consistent. `BedGeo` disagrees and
  // always did — its headboard spans dimMM[0] and a double's two pillows sit side
  // by side across it — as do `Inspector`'s ['Width','Depth','Height'] labels, the
  // seed's `vBed`, and this file's own `[W, D, H]` header. Five readers against one
  // comment. A 2000-wide, 1600-long "double" renders as a plausible but oversized
  // bed rather than a broken one, which is why it survived being looked at.
  { label: 'King bed', group: 'Bedroom', category: 'bed', shape: 'bed-double', dimMM: [1800, 2000, 600] },
  // Lighting
  { label: 'Floor lamp', group: 'Lighting', category: 'lamp', shape: 'lamp-floor', dimMM: [300, 300, 1700] },
  { label: 'Table lamp', group: 'Lighting', category: 'lamp', shape: 'lamp-table', dimMM: [250, 250, 500] },
  { label: 'Pendant lamp', group: 'Lighting', category: 'lamp', shape: 'lamp-pendant', dimMM: [350, 350, 400] },
  // Decor
  { label: 'Rug', group: 'Decor', category: 'rug', shape: 'rug', dimMM: [2400, 1600, 5] },
  { label: 'Plant', group: 'Decor', category: 'plant', shape: 'plant', dimMM: [400, 400, 1600] },
  { label: 'Mirror', group: 'Decor', category: 'mirror', shape: 'mirror', dimMM: [600, 30, 1400] },
  { label: 'Oval mirror', group: 'Decor', category: 'mirror', shape: 'mirror-oval', dimMM: [600, 30, 1100] },
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
  // Fridges are the other real-class item: the 60 cm freestanding box and the
  // French door are footprints a kitchen actually chooses between, not variants.
  { label: 'Fridge', group: 'Appliances', category: 'fridge', shape: 'fridge', dimMM: [600, 650, 1700] },
  { label: 'French door fridge', group: 'Appliances', category: 'fridge', shape: 'fridge', dimMM: [910, 720, 1780] },
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
  bed: { shape: 'bed-single', dim: [900, 2000, 600] },
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

/** The catalogue's typical size on ONE axis for a category, narrowed to the
 *  shape's own legal range. Axis 0 = W, 1 = D, 2 = H.
 *
 *  For the axes a photo cannot see. Every caller is a measurement that came back
 *  short, so this is the number that fills the gap — derived from the same two
 *  tables the scene builder uses, never a literal at the call site.
 *
 *  Clamping an INVENTED number is not the "silently resize it to fit" that rule 2
 *  forbids. That rule protects measurements; these axes have none to protect.
 *
 *  `CATEGORY_DEFAULTS` stays unexported on purpose — handing out the whole table
 *  invites a caller to read `.dim` and skip `clampDims` altogether. */
export function defaultAxisFor(category: Category, shape: Shape, axis: 0 | 1 | 2): number {
  const typical = (CATEGORY_DEFAULTS[category] ?? CATEGORY_DEFAULTS.other).dim[axis];
  const r = dimRangeFor(category, shape);
  return Math.min(Math.max(typical, r.min[axis]), r.max[axis]);
}

/** Depth — the axis NO single photo can observe. Kept as its own name because
 *  that fact is a property of photography, not of a particular anchor.
 *
 *  `GeoPlacement` in lib/photo-geometry.ts returns W and H and says so in the type,
 *  so the detection path has to supply the third number from somewhere, and the
 *  honest somewhere is the two tables that already hold typical sizes and legal
 *  bounds. It used to be a bare `?? 500` on the detect screen, which sits outside
 *  the allowed depth of a TV (40–120), a mirror or a painting (15–60) and a curtain
 *  (40–200): every thin wall-mounted piece the on-device detector found arrived half
 *  a metre deep, because that path sends no dimension hint at all. */
export function defaultDepthFor(category: Category, shape: Shape): number {
  return defaultAxisFor(category, shape, 1);
}

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

  // How far the part's centre stands off the wall. A curtain takes the extra
  // standoff for the same reason the seeded pair does: hung flush it is coplanar
  // with the window it dresses, and the two z-fight.
  const inset = dM / 2 + 0.05 + (shape === 'curtain' ? CURTAIN_STANDOFF : 0);

  switch (slot) {
    case 'n':
      return { pos: [(cx - 0.5) * (w * 0.85), yPos, -d / 2 + inset], rot: 0 };
    case 's':
      return { pos: [(0.5 - cx) * (w * 0.85), yPos, d / 2 - inset], rot: Math.PI };
    case 'e':
      return { pos: [w / 2 - inset, yPos, (cx - 0.5) * (d * 0.85)], rot: -Math.PI / 2 };
    case 'w':
      return { pos: [-w / 2 + inset, yPos, (0.5 - cx) * (d * 0.85)], rot: Math.PI / 2 };
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
    // Prefer the estimated position/yaw when present and in-room; otherwise snap
    // to wall. "Estimated" is either measured (lib/detect-refine.ts wrote it from
    // the calibrated camera) or the model's own guess on an uncalibrated slot;
    // this cannot tell them apart and does not need to, because the only axes it
    // reads are the two a photo can actually locate.
    //
    // **Y is deliberately neither read nor tested here.** `groundY` overwrites
    // pos[1] unconditionally just below, so passing `aiPos.y` through was
    // dead. The height check was worse than dead: it gated x and z — the axes we
    // keep — on an axis nothing consumes, so a detection whose Y was out of the
    // room lost its perfectly good floor position and fell back to slot-snapping.
    // A fan the model put 3.2 m up in a 2.8 m room is a fan with a wrong height,
    // not a fan in the wrong corner. Y is owned by the anchor, and only there.
    const aiPos = (d as { position?: { x: number; y: number; z: number } }).position;
    const aiYaw = (d as { yaw?: number }).yaw;
    /** Does the model's own yaw survive a wall snap?
     *
     *  Hoisted because it is read three times and used to be written out twice —
     *  and the third reader is the one that made it matter. `snapToWall` clamps a
     *  piece by its extent ALONG the wall, which is `dimMM[0]` only when the piece
     *  is turned to the wall's heading. Where the model's yaw wins it is not, so
     *  the clamp has to be told the rotation that will really apply. A third copy
     *  of the predicate is how the two would have drifted apart. */
    const keepsAiYaw = typeof aiYaw === 'number' && Math.abs(aiYaw) >= 0.05;
    /** …and therefore the yaw the clamp must measure across. `undefined` lets
     *  `snapToWall` use the wall's own heading, which is what will really apply
     *  whenever the snapped `rot` wins. */
    const clampRot = keepsAiYaw ? aiYaw : undefined;
    let placement: { pos: [number, number, number]; rot: number };
    const w = rw / 2;
    const dHalf = rd / 2;
    if (
      aiPos &&
      typeof aiPos.x === 'number' &&
      typeof aiPos.z === 'number' &&
      Math.abs(aiPos.x) <= w + 0.2 &&
      Math.abs(aiPos.z) <= dHalf + 0.2
    ) {
      placement = {
        pos: [aiPos.x, 0, aiPos.z],
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
      const snapped = snapToWall(placement.pos, dim, footprint, wallStandoff(refined), null, { alongRot: clampRot });
      placement.pos[0] = snapped.x;
      placement.pos[2] = snapped.z;
      if (snapped.rot !== undefined && !keepsAiYaw) {
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
        const snapped = snapToWall(placement.pos, dim, footprint, wallStandoff(refined), null, { alongRot: clampRot });
        placement.pos[0] = snapped.x;
        placement.pos[2] = snapped.z;
        if (snapped.rot !== undefined && !keepsAiYaw) {
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
  // `MOUNT_PAD`, not a local `CEILING_PAD = 0.02`. It was one, doing this exact
  // job on this exact quantity, and it is the reason the constant it duplicated
  // could claim to be "the single clearance" while a fan placed by detection and
  // a fan placed by a drag would have drifted apart the first time anyone changed
  // it. Nothing would have said so: both look right, 10 mm apart, in a picture.
  const cap = rh - MOUNT_PAD;
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

/** What a plain click or press on `id` selects.
 *
 *  A merged set is selected WHOLE: clicking one sideboard of a merged pair selects
 *  both, because that is what "merged" means to a pointer.
 *
 *  It does not mean a drag carries the group. `lib/drag-convoy.ts` used to close
 *  the travelling set over `groupId` AFTER the selection, so dragging one piece
 *  moved its whole group even when only that piece was selected — and rotation
 *  never did, so the two gestures disagreed about what a one-member selection
 *  meant. Unreachable until the layer tree made a single member selectable, and
 *  reported the moment it did. The selection is the unit now: merge decides what a
 *  CLICK selects, and a drag carries what is selected.
 *
 *  Both tabs read this, which is the other half of the same fix. `Pickable` had it
 *  inline and the plan had NOTHING — a press there selected one piece of a merged
 *  pair and the convoy's closure quietly put the rest back, so the plan looked
 *  right for a reason that had nothing to do with selection. Removing the closure
 *  without this would have left the two tabs dragging different sets.
 *
 *  DRILL-IN is the third parameter, and it is the whole reason this takes the
 *  current selection rather than just the part. Click a merged set and you get the
 *  set; click again, inside it, and you get the one piece you pointed at. The rule
 *  is stated once, as a question about the selection and not as a click counter:
 *  **you are inside a group when the selection lies entirely within it**, and a
 *  pick made from inside names one piece. So the set comes whole from outside, the
 *  member comes alone from inside, and pointing at a SIBLING while drilled in keeps
 *  you at the member level rather than throwing you back out to the set — which is
 *  what a click counter would have done, and which reads as the drill-in randomly
 *  forgetting itself.
 *
 *  Climbing back out needs nothing new: Escape and a click on empty floor both
 *  clear the selection (`KeyboardShortcuts`, `PlanView`, `Room`), and an empty
 *  selection is outside every group by this rule, so the next click on the set
 *  takes it whole again. A dedicated "leave group" gesture would be a fourth thing
 *  to teach for an answer the two existing ones already give in both tabs.
 *
 *  `current` is REQUIRED, not defaulted. A caller that forgets it would silently
 *  keep the old whole-group behaviour, which is drill-in working in one tab and not
 *  the other — this repo's most-repeated defect, and one the compiler will catch
 *  here instead. Note that it answers a different question from the click/drag gate
 *  in `lib/drag-click.ts`, which deliberately holds NO part id: "was this press a
 *  drag" is not "which member did it land on", and giving that gate an id is the
 *  scar recorded there. */
export function selectionForPick(parts: ScenePart[], id: string, current: readonly string[]): string[] {
  const me = parts.find((p) => p.id === id);
  if (!me?.groupId) return [id];
  const group = parts.filter((p) => p.groupId === me.groupId).map((p) => p.id);
  // Already inside this group — the whole selection is within it — so this pick is
  // a drill-in and names the one piece. An empty selection is deliberately NOT
  // "inside": `every` over nothing is true, and treating that as inside would make
  // the very first click on a merged set select one piece of it.
  const inside = current.length > 0 && current.every((c) => group.includes(c));
  return inside ? [id] : group;
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
  room: { width: number; depth: number; height: number; footprint?: Footprint },
  existing: ScenePart[],
  /** Where the user aimed, if they aimed — the drop point on the floor. A wall
   *  part takes the wall nearest it; everything else is placed there, kept inside
   *  the room by `intoRoom` below. */
  at?: [number, number],
): { pos: [number, number, number]; rot: number; wallMounted: boolean } {
  const wallMounted = isWallMountedPart(cat, shape);
  const ax = at?.[0] ?? 0;
  const az = at?.[1] ?? 0;

  /** The drop point, kept inside the room it is being dropped into.
   *
   *  Both drop handlers used to do this themselves, and both did it only
   *  `if (!wallMounted)` — which is `isWallMountedPart`, true for a ceiling fan.
   *  A fan rides no wall, so nothing above put it on one, and that guard meant
   *  nothing below pulled it in either: a fan dragged from the library landed
   *  exactly where the pointer was released, outside the walls included. One
   *  clamp, here, for everything that is not placed BY a wall.
   *
   *  The bounds inset, and deliberately ONLY that. The notch an L / T / U cuts
   *  away is invisible to a bounding box, and `clampIntoFootprint` is the function
   *  that answers it. It used not to be able to: it walked toward `polygonCentroid`,
   *  the average of the VERTICES rather than of the area, which for an L is the reflex
   *  corner itself, so every step of the walk stayed in the notch. That is fixed — it
   *  aims at `interiorPoint` and CHECKS the answer — and the reason this function does
   *  not call it is now a scope decision rather than an impossibility.
   *
   *  Two halves to that decision, and both are about extent. This clamps a CENTRE, so
   *  a point 5 cm inside the leg of a U satisfies it with a 2 m sofa mostly through
   *  the wall; the containment that reads a piece's footprint is `contain` in
   *  `lib/layout-settle.ts`, which every solved placement already ends on. And wiring
   *  it in here moves every drop into an L / T / U, which wants its own diff. So a
   *  drop into an L's notch is still a drop into the notch, and that is written down
   *  here — and asserted, by name, in `tests/wall-parts.test.ts` — rather than left as
   *  a surprise.
   *
   *  (`polygonCentroid` is untouched and still has callers. `wallSegments` is one, and
   *  it flips its inward normals toward that vertex average, which is the defect
   *  `wallOutwardNormal` was fixed for — it reads the polygon's winding now. Same
   *  reflex corner, one function over; not this change's to make.)
   *
   *  The support probe below reads the CLAMPED point either way: a piece let go
   *  outside the room was asking what it could stand on out there. */
  function intoRoom(x: number, z: number, rot: number): [number, number] {
    if (!room.footprint) return [x, z];
    const b = footprintBounds(room.footprint);
    // The extent the piece will have AT THE ANGLE IT IS ABOUT TO BE GIVEN, which is
    // why `rot` is a parameter and why the caller below resolves the yaw before it
    // calls this. It used to read `dimMM[0] / 2000` and `dimMM[1] / 2000` — the half-
    // extents before rotation — while the yaw was chosen afterwards, on the line that
    // returns. A 1600 × 2000 bed was therefore inset by its 800 mm half-width, then
    // turned 90° to face its wall, where it needs 1000, and kept the 200 mm difference
    // inside the plaster: every bed, sofa, wardrobe and bookshelf added at an east or
    // west wall, in every room.
    //
    // Invisible at the north and south walls, where the yaw is 0 or 180° and the
    // unrotated extents ARE the rotated ones — so the three tests written for the
    // heading fix all passed, and so did the two walls anybody would think to check
    // first. `aabbExtents` is the one place this arithmetic lives; `lib/drag-resolve.ts`
    // had its own copy of the same four lines and now reads this one too.
    const { ex: halfW, ez: halfD } = aabbExtents(rot, dimMM);
    // A piece wider than the room cannot be inset from both sides — centre it,
    // rather than letting the min beat the max and pin it against one wall. It
    // keeps its real size and `lib/clearance.ts` reports that it does not fit;
    // silently shrinking it to suit is what rule 2 forbids.
    const cx = halfW * 2 >= b.maxX - b.minX ? (b.minX + b.maxX) / 2 : Math.max(b.minX + halfW, Math.min(b.maxX - halfW, x));
    const cz = halfD * 2 >= b.maxZ - b.minZ ? (b.minZ + b.maxZ) / 2 : Math.max(b.minZ + halfD, Math.min(b.maxZ - halfD, z));
    return [cx, cz];
  }

  /** Where a ceiling piece hangs the moment it is added: the middle of the room.
   *
   *  Not under the pointer. A fan or a pendant belongs in the middle of a ceiling
   *  far more often than it belongs wherever the cursor happened to be when the
   *  button came up, and it is a DEFAULT rather than a rule — `ridesWall` is false
   *  for this family, so nothing snaps it anywhere and a drag moves it freely.
   *
   *  The bounds midpoint, tested against the polygon instead of assumed: the middle
   *  of an L's bounding box is the reflex corner it cuts away, and a fan hung there
   *  hangs outside the room. When that happens the drop point is the better answer,
   *  because at least the user aimed it. */
  function ceilingSpot(): [number, number] {
    if (!room.footprint) return [0, 0];
    const b = footprintBounds(room.footprint);
    const mx = (b.minX + b.maxX) / 2;
    const mz = (b.minZ + b.maxZ) / 2;
    // `rot: 0` — a ceiling piece is returned with `rot: 0` by the branch that calls
    // this, so 0 is the angle it will actually have rather than a stand-in.
    return pointInFootprint(mx, mz, room.footprint) ? [mx, mz] : intoRoom(ax, az, 0);
  }
  if (wallMounted) {
    const h = dimMM[2] / 1000;
    // Centre-anchored: clamp so the bottom edge never dips below the floor and
    // the top never passes the ceiling, regardless of the canonical height. The
    // bound is exactly h/2 rather than h/2 + a pad, because a door's canonical
    // height IS h/2 — padding it stood every door 2 cm off its own threshold.
    let y = groundY(cat, shape, dimMM, room.height);
    y = Math.max(h / 2, Math.min(room.height - h / 2, y));
    // Against a wall, facing into the room — not hovering in the middle of it.
    // `Draggable` already snaps these on the first drag, so spawning at the
    // centre only meant the piece jumped the moment it was touched; for a DOOR
    // it was worse than cosmetic, since `wallApertures` cuts its hole in
    // whichever wall is nearest and a door at the centre cut one in a wall it
    // was nowhere near. Ceiling parts (fan, pendant) are wall-mounted by the
    // centred-geometry test but do not ride a wall — hence `ridesWall`.
    if (room.footprint && ridesWall(cat, shape)) {
      const snapped = snapToWall([ax, 0, az], dimMM, room.footprint, wallStandoff(shape));
      return { pos: [snapped.x, y, snapped.z], rot: snapped.rot ?? 0, wallMounted };
    }
    // Ceiling family: hung at `y`, in the middle of the room — see `ceilingSpot`.
    const [cx, cz] = ceilingSpot();
    return { pos: [cx, y, cz], rot: 0, wallMounted };
  }
  // …facing the wall it belongs against, which used to be a flat `rot: 0` for every
  // floor-standing piece there is. Add three beds to three different walls and all
  // three point the same way — headboards north, two of them into open floor — which
  // is what the user saw and reported as "all beds face that side".
  //
  // The app already owns this answer twice over and neither reader was the add path.
  // `lib/layout-score.ts` charges every `prefers-wall` piece
  // `FACING_GAIN * angleCost(yaw, edge.yaw)` — being turned the wrong way against
  // your own wall is priced, and priced highly, because "which way a sofa faces is
  // not a matter of taste". So Shuffle fixes this on the first press: measured over
  // three seeds on a 6×5 rect with a bed dropped at each of three walls, every seed
  // returns 0 / 90 / −90 degrees, each headboard against its own wall. The defect
  // was never that the room could not be arranged; it was that adding a piece
  // produced a heading the solver would immediately overrule, and the user had to
  // press a button to get an orientation the app already knew.
  //
  // A DEFAULT, not a rule, in the same sense `ceilingSpot` above means it. Only the
  // YAW is taken from the wall; the piece is not moved to it, because being placed
  // where you aimed is a promise and facing north is not. That is also why this does
  // not make a floor piece ride its wall: `lib/drag-resolve.ts` snaps `ridesWall`
  // pieces only, a bed is not one, and a bed that snapped on add but not on the next
  // drag would be two behaviours for one piece.
  //
  // Nearest wall unconditionally rather than within some threshold. A piece with a
  // wall affinity dropped in the middle of the floor is going to a wall sooner or
  // later, so the nearest one is a better guess than a fixed heading, and a distance
  // cutoff here would be a number with nothing to derive it from.
  //
  // ── Order: the YAW is resolved BEFORE the containment clamp, and that ordering is
  // the whole of the 200 mm fix described in `intoRoom`. A piece's extent along X is a
  // function of its angle, so a clamp that runs first is clamping the wrong number.
  //
  // Which needs a point to name a wall from, before there is a clamped one — hence two
  // passes. The first is rotation-blind and exists only to bring a drop released
  // outside the room to somewhere inside it, so that `snapToWall` is asked about a wall
  // of this room rather than one behind the user's pointer; `rot` is not yet known, and
  // 0 is honest about that rather than a guess at it. The second pass is the real
  // clamp, at the angle the piece is actually getting. Both agree on the wall for any
  // drop that was inside to begin with, which is every drop the UI can produce except
  // a drag released past the wall.
  const affinity = wallAffinity(cat);
  const wantsWall = affinity === 'must-wall' || affinity === 'prefers-wall';
  const [nameWallFromX, nameWallFromZ] = intoRoom(ax, az, 0);
  const rot =
    room.footprint && wantsWall
      ? (snapToWall([nameWallFromX, 0, nameWallFromZ], dimMM, room.footprint).rot ?? 0)
      : 0;

  // Only small "goes on a table" items seek a surface; everything else floors. The
  // support probe reads the FINAL point, not the rotation-blind one above: a piece
  // asks what it can stand on where it is going to be standing.
  const [fx, fz] = intoRoom(ax, az, rot);
  const support = isTabletopProne(cat) ? findSupportUnder(existing, '__new__', fx, fz, dimMM) : null;
  const y = support !== null && support > 0.3 ? support : 0;
  return { pos: [fx, y, fz], rot, wallMounted };
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

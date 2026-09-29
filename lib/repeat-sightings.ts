// Repeat sightings — one piece of furniture found in more than one photo.
//
// The capture flow asks for four walls from the middle of the room, so anything
// big enough to matter is in two or three of the pictures: a bed fills the foot
// wall's photo and half of each side wall's. The detector reads every photo on
// its own and cannot know that three bed boxes are one bed, and the hard merge in
// `lib/detect-refine.ts` only catches the pairs it is sure of — same word, and
// centres within a tier distance chosen so that four dining chairs survive as
// four. A bed measured from its foot and from its side disagrees by more than
// that, and a detector that says "bed" in one photo and "double bed" in the next
// fails the word test before distance is asked. So a room came back with five
// beds, and every one of them was ticked.
//
// This module is the SOFT half of that decision, and it deletes nothing. It asks
// the question a person asks looking at the list — could these two rows be
// standing in the same spot? — and answers with an index into the list, never
// with a removal. The review screen leaves a repeat unticked and says which row it
// probably repeats; ticking it back is one tap. That asymmetry is the one
// `detect-refine.ts` argues for throughout: a real piece that never appears is
// worse than a duplicate. What changed is where the duplicate is paid for — once,
// on the list, by a row that starts unticked and says why, rather than in the
// studio, by a bed nobody asked for.
//
// Two facts carry it, and both are properties of the room, not of the detector:
//
//   · Two pieces cannot occupy the same floor. Two same-kind footprints that share
//     a large part of their area are one piece measured twice, however far apart
//     their centres came out — which is the number the hard merge compares, and
//     the one a bed seen side-on, or cut off by the edge of the frame, gets most
//     wrong.
//   · Within one photo, two boxes that do not touch are two things. The detector
//     saw a gap between them; twin beds against one wall are twin beds, whatever
//     the measurement says. Boxes in one photo that DO touch can still be one
//     piece, because a photo is read more than once — the on-device detector runs
//     two models over every picture and a key adds Google's second look — and each
//     pass draws its own box round the same bed. The hard merge takes the pairs
//     whose boxes nearly coincide; this takes the rest.
//
// Pure — no React, no DOM — so the rule that decides what starts unticked can be
// tested without a screen.

import { footArea, footFromPart, footIntersectionArea, type Foot } from './geometry';
import { clampDims, dimRangeFor } from './dimension-ranges';
import {
  defaultAxisFor,
  estimateInRoom,
  isRoundPart,
  isWallMountedPart,
  sceneShapeFor,
  startingSpot,
  type Category,
  type Shape,
} from './scene-spec';
import { geoPlace, geoRefine, measuredPlane, sameThingKey, type CalMap, type RoomDims } from './detect-refine';
import { atLens, cutByFrame, frameCuts, PLAUSIBLE_HFOV_DEG } from './photo-geometry';
import { sourceOf } from './detect-confidence';
import type { Detection } from './detection';

/** Two rows are one piece when they share at least this much of the SMALLER one.
 *
 *  Over the smaller rather than the union on purpose, and the opposite choice to
 *  the hard merge's box test: the two sightings of one piece are measured from
 *  different walls and so come back at different sizes — a bed's side view reads
 *  its length as its width — and the union of a big estimate and a small one is
 *  dominated by the big one even when the small one sits wholly inside it.
 *
 *  A quarter, because the two estimates are independent measurements whose error
 *  is a sizeable fraction of the piece: a bed measured from its side lands ~0.2 m
 *  off its true centre, and a chair measured from two walls can miss by most of
 *  its own depth. Two real neighbours of one kind — chairs at a table, a pair of
 *  bedside tables — do not share floor at all, so any overlap between them is
 *  measurement error, and it takes a lot of it to reach a quarter. When it does,
 *  the cost is a row that starts unticked and says why. */
export const REPEAT_SHARE = 0.25;

/** Which plane a row was measured on — the same split `geoRefine` makes, curtain
 *  exception included, because that is what `position.y` means: 0 at the floor, the
 *  piece's centre on a wall, the slab on the ceiling. */
type Plane = 'floor' | 'wall' | 'ceiling';

type Solid = {
  plane: Plane;
  foot: Foot;
  area: number;
  /** Vertical extent, metres. Only compared on a wall, where `y` is the centre. */
  y0: number;
  y1: number;
};

/** The shape the room will build this row as — the room's rule, not a copy of it. */
function shapeOf(d: Detection): Shape {
  return sceneShapeFor(d.category as Category, d.label, d.shape);
}

function planeOf(d: Detection): Plane {
  return measuredPlane(d.category as Category, shapeOf(d));
}

/** Where the row stands and how big it is, as the room will build it.
 *
 *  A row the camera placed is compared where it was measured. A row it could not
 *  place — most often a bed cut off by the bottom of the frame, whose nearest edge
 *  is out of the picture — still becomes a piece, at the spot on its photo's wall
 *  under the middle of its box, and that is where it is compared: the question is
 *  whether the room you get will have two beds in one place, and that is the place.
 *  Without the room's size there is no such spot, and the row has nothing to compare. */
function solidOf(d: Detection, room: RoomDims | null): Solid | null {
  const cat = d.category as Category;
  const shape = shapeOf(d);
  const hint = d.dimMM && d.dimMM.every((n) => Number.isFinite(n) && n > 0) ? d.dimMM : null;
  const dims: [number, number, number] = hint
    ? clampDims(cat, shape, hint)
    : [defaultAxisFor(cat, shape, 0), defaultAxisFor(cat, shape, 1), defaultAxisFor(cat, shape, 2)];
  let spot: { x: number; y: number; z: number; rot: number } | null = null;
  if (room) {
    const start = startingSpot(d.slot, d.box, dims, isWallMountedPart(cat, shape), shape, d.position, d.yaw, room);
    // A measured height where there is one: on a wall it is the piece's centre, and
    // the start spot's is only a default. Floor pieces all stand at 0 either way. Only
    // from a position the spot was taken from, though: one the room refused is
    // refused whole, or its height would ride a place it never described. And only a
    // height that is a number: nothing checks the cloud's JSON, and a place with no
    // height gave every wall reading NaN, which shares nothing with anything — so a
    // print read twice that way was never one print.
    const y = estimateInRoom(d.position, room) && Number.isFinite(d.position.y) ? d.position.y : start.pos[1];
    spot = { x: start.pos[0], y, z: start.pos[2], rot: start.rot };
  } else if (d.position) {
    spot = { ...d.position, rot: d.yaw ?? 0 };
  }
  if (!spot) return null;
  const { x, y, z, rot } = spot;
  const plane = planeOf(d);
  // On the floor a photo measures WHERE a piece stands and never which way it
  // faces: every floor decode assumes the piece is square to the lens that saw
  // it, so one bed seen from its foot and from its side comes back a quarter-turn
  // apart, two rectangles crossing at the headboard that share a sixth of their
  // floor. The honest footprint for a heading nobody measured is the circle the
  // piece could turn within. On a wall the heading is the wall's, which is known.
  const m = Math.max(dims[0], dims[1]);
  const foot =
    plane === 'floor'
      ? footFromPart([x, y, z], 0, [m, m, dims[2]], true)
      : footFromPart([x, y, z], rot, dims, isRoundPart(shape));
  const h = dims[2] / 1000;
  return { plane, foot, area: footArea(foot), y0: y - h / 2, y1: y + h / 2 };
}

/** How much of the smaller of two pieces the pair shares — in plan, and on a wall
 *  in height as well, so a mirror hung above a picture on the same stretch of wall
 *  is two things. Floor pieces all stand at y = 0, so height tells them nothing. */
function sharedPart(a: Solid, b: Solid): number {
  const small = Math.min(a.area, b.area);
  if (!(small > 0)) return 0;
  const plan = footIntersectionArea(a.foot, b.foot) / small;
  if (a.plane !== 'wall') return plan;
  const tall = Math.min(a.y1 - a.y0, b.y1 - b.y0);
  if (!(tall > 0)) return 0;
  const lift = Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0)) / tall;
  return plan * lift;
}

/** Do two boxes in one photo overlap at all? Touching edges are not overlap: the
 *  detector drew a line between them. */
function boxesMeet(a: Detection['box'], b: Detection['box']): boolean {
  const w = Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]);
  const h = Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]);
  return w > 0 && h > 0;
}

/** Could `later` be `first` seen again? Everything but the overlap itself. */
function sameKind(first: Detection, later: Detection): boolean {
  if (first.category !== later.category) return false;
  if (first.slot === later.slot && !boxesMeet(first.box, later.box)) return false;
  if (planeOf(first) !== planeOf(later)) return false;
  // "Something else" is a bucket, not a kind: a stool and a basket both land in it.
  // There the word is all there is to go on.
  if (first.category === 'other' && sameThingKey(first.label) !== sameThingKey(later.label)) return false;
  return true;
}

/** How finely the lens is swept, in degrees of horizontal field of view. */
const LENS_STEP_DEG = 2;

/** Every lens a phone could have taken a photo with, as a horizontal field of view
 *  in degrees — the range the floor-line solve accepts, every `LENS_STEP_DEG`.
 *  Exported so the sweep's own ends can be held: at the narrow end almost nothing
 *  in a room is in two photos, so no behaviour reaches it. */
export const SWEPT_HFOV_DEG: readonly number[] = (() => {
  const out: number[] = [];
  for (let deg = PLAUSIBLE_HFOV_DEG.min; deg <= PLAUSIBLE_HFOV_DEG.max + 1e-9; deg += LENS_STEP_DEG) out.push(deg);
  return out;
})();

/** The same lenses as `k`, which is what the placers read. */
const LENSES: readonly number[] = SWEPT_HFOV_DEG.map((deg) => 2 * Math.tan((deg * Math.PI) / 360));

/** How far past its photo's side a cut-off floor box is carried at each step of
 *  `reachedSolids`, as a share of the frame's width. */
const REACH_STEP = 0.02;

/** …and at most one frame's width past it. Only a limit on the work: the walk
 *  stops long before, at the catalogue's widest piece of the kind. */
const REACH_STEPS = Math.round(1 / REACH_STEP);

/** Where a row would stand if its photo had been taken on each of `LENSES` — every
 *  place the camera could have meant, per lens — or null when there is nothing to
 *  doubt: a lens EXIF measured, and a box the frame did not cut.
 *
 *  **Why the lens, and why only an assumed one.** Most photos carry no focal length
 *  (`CLAUDE.md` records four real phone photos, and not one did), so the lens is
 *  assumed to be a typical phone's main camera, and in a small room the wall is as
 *  often shot on the ultrawide. A wrong lens moves a floor piece along its OWN
 *  photo's line of sight — distance goes as `1/k` — so one bed seen from the foot
 *  wall and from a side wall is pushed two different ways, and the two sightings
 *  land apart by an error neither measurement shares. No tolerance on the
 *  comparison absorbs that: it is a metre at an ultrawide, and a tolerance that
 *  large would merge a room's dining chairs. What the two sightings DO share is the
 *  phone, so the question becomes whether ONE lens a phone could have puts them in
 *  the same place. A lens EXIF measured is held fixed — a bound may falsify an
 *  assumption, never overrule a measurement — and every entry is then that one
 *  lens's answer, so a pair with one measured and one assumed lens sweeps only the
 *  assumed one.
 *
 *  **Where a floor line tied the height to the lens** (`CameraCal.floorLine`), each
 *  lens is asked with the height that line gives at it (`atLens`), and a lens it would
 *  need a camera out of a person's reach for answers nothing. Carrying the one lens's
 *  height to every other is a camera the photo contradicts: it holds each floor
 *  piece's width and moves it along its line of sight, where the line holds the
 *  distance and rescales the width. On the generated rooms shot 1.3–1.7 m up, that
 *  took the repeats left ticked from 96 to 44 across four readings. Since the placers
 *  grow a cut-off axis to its typical size it is 63 to 53: 16 → 4 at 1.3 m, where
 *  the lens was solved against a height 0.2 m wrong, and within one either way in
 *  the other three, because the growth met most of the sightings it had rescued.
 *
 *  **Why a cut-off side is doubted even at a measured lens** is `reachedSolids`:
 *  it is the box that is short, not the lens that is wrong.
 *
 *  Exported for `tests/repeat-sightings.test.ts` and for no other caller: which
 *  lenses answer nothing for a row is not visible through `findRepeats`, and a
 *  sweep that quietly asked every lens the assumed one's question passed it. */
export function sweptSolids(d: Detection, room: RoomDims | null, cals: CalMap): Solid[][] | null {
  const cal = cals[d.slot];
  if (!room || !cal) return null;
  const measured = cal.lens === 'measured';
  const cut = cutSides(d);
  if (measured && !cut) return null;
  // The row as the camera first saw it: a box and a word. A refined row's position,
  // heading and size are the ASSUMED lens's answers, and a placer keeps a heading or
  // a size it is handed — it reads them as the model's hint — so leaving them on
  // carries that lens's answer into every other one. A TV the east photo put on the
  // east wall, located at the true lens on the north wall, would still face east.
  const bare = { ...d, position: undefined, yaw: undefined, dimMM: undefined };
  const at = (k: number): Solid[] => {
    const c = atLens(cal, k, d.slot, room.footprint);
    if (!c) return [];
    const lens = { [d.slot]: c };
    const r = geoPlace(bare, lens, room);
    const s = r.position ? solidOf(r, room) : null;
    const out = s ? [s] : [];
    if (cut) out.push(...reachedSolids(bare, cut, lens, room));
    return out;
  };
  if (measured) {
    const one = at(cal.k);
    return LENSES.map(() => one);
  }
  return LENSES.map(at);
}

type Cut = { left: boolean; right: boolean };

/** Which sides of its photo cut a FLOOR row's box, or null when neither did.
 *
 *  A wall row is not walked. The wall placer reads a box against the plane the
 *  piece hangs on, so a cut edge lands on a real point of that wall and the box
 *  measures the part it saw, rather than mistaking the frame for a corner. Measured
 *  over the same 150 rooms at 80° to 120°: walking wall rows too changed no count,
 *  since a wall piece seen twice was never left doubled at a lens read right or
 *  assumed (none of 25, 37, 56 and 105), and it took the table a third longer. */
function cutSides(d: Detection): Cut | null {
  if (planeOf(d) !== 'floor') return null;
  const { left, right } = frameCuts(d.box);
  return left || right ? { left, right } : null;
}

/** Where a floor row cut off by the side of its photo could stand, at one lens: the
 *  box carried past the frame a step at a time, and each longer box asked again.
 *
 *  **Why the box as seen is not enough.** `lateralSpan` reads a floor box's outer
 *  edge as the piece's NEAR corner and its inner edge as the FAR one, which is
 *  right for a whole piece and backwards for a cut one: the frame's edge is not a
 *  corner of anything. So the far corner's ray is held against a near corner that
 *  was never seen, and the width comes out short — often below nothing. A fridge
 *  in the corner of a 106° photo came back −79 mm wide at its true lens. The
 *  placer no longer refuses that: it keeps the edge the photo did see and gives
 *  the cut axis at least the kind's typical size (`PieceFootprint.whole`), which
 *  bounds the piece from below and does not measure it. So the row has a place —
 *  a TYPICAL fridge's — and the sighting that saw the real one whole may still
 *  not meet it, because the real one is longer, or its seen edge was read at a
 *  distance the missing corner would have moved.
 *
 *  **Why walk it rather than solve it.** The piece really did carry on out of
 *  frame, by an amount the photo does not hold, so every length is a candidate
 *  and none is the answer. The walk stops where the kind's own catalogue does:
 *  a box whose width has passed the widest piece of the kind is a piece that does
 *  not exist, and widening only widens it further. A step whose size falls outside
 *  the kind's range is skipped. Every carried box is still cut, so the placer
 *  grows each to the typical size too: the short steps repeat the row's own
 *  answer and the long ones ask about a longer piece. Every candidate left stands
 *  where a real piece of that kind could, which is the question the repeat check
 *  asks.
 *
 *  **Why only the sides.** Cut off at the bottom, the near face is read from the
 *  last row of pixels, which bounds it rather than measures it, and the same walk
 *  down the photo was measured on the same 150 rooms: alone, it took the repeats
 *  left at 106° read as 66° from 27 to 25 while starting one more real piece
 *  unticked there, and one more at 106° read as 106°, and it doubled the table's
 *  time over the sides' walk. Walking both at once is a grid, and did not finish
 *  in half an hour. Filed with those numbers in `docs/what-is-still-open.md`
 *  § 46.2. A box cut at both sides is carried out both ways at once, and a floor
 *  piece's height is not compared, so a box cut at the top needs nothing.
 *
 *  Never a measurement: this answers only "could these two be one piece", and the
 *  row keeps the size and place `refineDetections` gave it. */
function reachedSolids(bare: Detection, cut: Cut, cals: CalMap, room: RoomDims): Solid[] {
  const range = dimRangeFor(bare.category as Category, shapeOf(bare));
  const [x, y, w, h] = bare.box;
  const out: Solid[] = [];
  for (let i = 1; i <= REACH_STEPS; i++) {
    const left = cut.left ? i * REACH_STEP : 0;
    const right = cut.right ? i * REACH_STEP : 0;
    const r = geoRefine({ ...bare, box: [x - left, y, w + left + right, h] }, cals, room);
    if (!r.position || !r.dimMM) continue;
    const [wide, , tall] = r.dimMM;
    if (wide > range.max[0]) break;
    if (wide < range.min[0] || tall < range.min[2] || tall > range.max[2]) continue;
    const s = solidOf(r, room);
    if (s) out.push(s);
  }
  return out;
}

/** For each row, the index of the row it most likely repeats — or null when it is
 *  a piece in its own right.
 *
 *  `keep[i]` says whether row i would be ticked on its own merits (the page passes
 *  `shouldAutoConfirm`). It decides which sighting of a piece is THE one, and it
 *  comes first among the tie-breaks because the alternative loses the piece: if a
 *  bed's best-framed sighting were one the confidence policy leaves unticked, and
 *  its other sightings were unticked for being repeats, no bed would be ticked at
 *  all. So the order is:
 *
 *    1. a row the user drew — theirs is never the repeat;
 *    2. a row that would be kept;
 *    3. a row whose box is not cut off by the photo's edge, since it measured the
 *       whole piece;
 *    4. the bigger box — the photo that saw the most of it;
 *    5. list order.
 *
 *  Greedy, like non-maximum suppression: rows are taken in that order, and each
 *  either repeats a piece already accepted (the one it shares the most with) or
 *  becomes one. A repeat is never the target of another repeat, so a piece seen in
 *  four photos is one piece and three repeats of it, not a chain.
 *
 *  Two rows from different photos are compared at every lens either photo could
 *  have been taken on (`sweptSolids`) and at the lens they were measured with, and
 *  the best of those is their share. Two rows from ONE photo are compared as
 *  measured: one photo has one lens, and a wrong one moves both sightings the same
 *  way.
 *
 *  **What the sweep costs, measured** on 150 random furnished rooms photographed
 *  from the middle — generated by `tests/helpers/furnished-rooms.ts`, and printed
 *  and held by `tests/repeat-sightings.test.ts`. A 106° ultrawide read as the
 *  assumed 66°: repeats left ticked 247 → 5. At 120°: 452 → 21. The price is real
 *  pieces that start unticked — 37 → 41 at 106° read as 66°, 11 → 20 when the
 *  ultrawide was assumed at its true 106°, 4 → 4 at 120° assumed correctly, and
 *  2 → 10 when the assumed 66° was right. Every one of those 21 is a dining chair
 *  cut off by the bottom of its frame, standing near a neighbour seen from another
 *  wall, and 13 of them are in one photo only — two chairs lined up, not one chair
 *  seen twice. A box that runs out of the picture at the bottom has an unmeasured
 *  distance (the ray through the last row of pixels only bounds its near face), so
 *  some lens will stand the two in one place. It starts unticked, says which chair
 *  it repeats, and one tap ticks it back — the trade `detect-refine.ts` makes
 *  throughout, paid on the list rather than in the studio.
 *
 *  A wall piece near a corner is in that count because the placers locate it: the
 *  other photo sees it on the RETURN wall, and at the lens it was really taken on
 *  that sighting is refused as a measurement and put where its line of sight meets
 *  a wall (`geoLocate`). So the sweep can only compare it there if it re-asks the
 *  camera from the box alone — which is why `sweptSolids` strips the heading and
 *  size as well as the position. Before those sightings were located, the TVs,
 *  pictures, mirrors and curtains of the same rooms were 56 of the 83 repeats left
 *  at 106° read as 66°, and 105 of the 152 at 120°.
 *  A floor piece cut off by the SIDE of its photo is in that count because
 *  `reachedSolids` walks its box out of the frame — which runs on a measured lens
 *  too, since it doubts the box and not the lens. With the lens marked measured,
 *  so that the side walk is the only doubt left, the same rooms go 7 → 5 at 106°
 *  and 35 → 34 at 120°, and lose exactly the pieces the unswept rule loses. Before
 *  the walk, those sightings were 134 of the 135 repeats left across the four
 *  ultrawide readings; before the placers grew a cut side to its typical size, the
 *  walk still had 23 and 43 to take at a measured lens, and the growth took most.
 *  What is left — 5 at 106° read as 66°, 3 at its true lens, 21 and 24 at 120° —
 *  is 50 floor pieces with a sighting cut off at a bottom CORNER of its photo, one
 *  cut at the bottom alone, and two wall pieces cut at the side (the walk is for
 *  floor rows only). The side is walked round; the bottom still bounds the piece's
 *  near face rather than measuring it, so its distance is not held by anything.
 *
 *  `room` is required, and null only while the screen is still loading it: without
 *  it, a row with no position has nothing to compare and is its own piece. `cals`
 *  is the lens each photo was measured with, the map `refineDetections` was given. */
export function findRepeats(
  dets: readonly Detection[],
  keep: readonly boolean[],
  room: RoomDims | null,
  cals: CalMap,
): (number | null)[] {
  const solids = dets.map((d) => solidOf(d, room));
  // Swept on demand and once per row: only a row with a same-kind partner in
  // another photo ever needs it, and each costs a geometry pass per lens.
  const swept = new Map<number, Solid[][] | null>();
  const sweptOf = (i: number) => {
    if (!swept.has(i)) swept.set(i, sweptSolids(dets[i], room, cals));
    return swept.get(i)!;
  };
  const shareOf = (p: number, i: number): number => {
    const a = solids[p];
    const b = solids[i];
    let best = a && b ? sharedPart(a, b) : 0;
    if (dets[p].slot === dets[i].slot) return best;
    const sa = sweptOf(p);
    const sb = sweptOf(i);
    if (!sa && !sb) return best;
    for (let t = 0; t < LENSES.length; t++) {
      const xs = sa ? sa[t] : a ? [a] : [];
      const ys = sb ? sb[t] : b ? [b] : [];
      for (const x of xs) for (const y of ys) best = Math.max(best, sharedPart(x, y));
    }
    return best;
  };
  const score = (i: number) => [
    sourceOf(dets[i]) === 'manual' ? 0 : 1,
    keep[i] ? 0 : 1,
    // The same test `geoRefine` sizes a cut axis by, so a box ranked clipped is one
    // the placers grew.
    cutByFrame(dets[i].box) ? 1 : 0,
    -(dets[i].box[2] * dets[i].box[3]),
  ];
  const order = dets
    .map((_, i) => i)
    .sort((a, b) => {
      const sa = score(a);
      const sb = score(b);
      for (let k = 0; k < sa.length; k++) if (sa[k] !== sb[k]) return sa[k] - sb[k];
      return a - b;
    });

  const out: (number | null)[] = dets.map(() => null);
  const pieces: number[] = [];
  for (const i of order) {
    const d = dets[i];
    let best = -1;
    let bestShare = 0;
    if (sourceOf(d) !== 'manual') {
      for (const p of pieces) {
        if (!sameKind(dets[p], d)) continue;
        const share = shareOf(p, i);
        if (share >= REPEAT_SHARE && share > bestShare) {
          best = p;
          bestShare = share;
        }
      }
    }
    if (best >= 0) out[i] = best;
    else pieces.push(i);
  }
  return out;
}

/** The rows to tick before the user has looked: kept on their own merits, and not
 *  a repeat of another row. The one place the seeding decision is made, so the
 *  screen and the tests cannot disagree about it. */
export function keptAtFirst(
  dets: readonly Detection[],
  keep: readonly boolean[],
  room: RoomDims | null,
  cals: CalMap,
): Set<number> {
  const repeats = findRepeats(dets, keep, room, cals);
  const out = new Set<number>();
  dets.forEach((_, i) => {
    if (keep[i] && repeats[i] === null) out.add(i);
  });
  return out;
}

/** Whether two lists are the same rows but for a sampled colour — the one write the
 *  review screen makes that nothing measured reads. The colour fill lands a moment
 *  after every list does and writes each row once, and without this the screen ran
 *  `findRepeats` over every lens a phone could have a second time for it: 6 ms a room
 *  on a desktop, 33 at the worst of 150 generated rooms, and several times that on the
 *  phones this screen is for.
 *
 *  Shallow, and that is the contract rather than a shortcut: the fill spreads a row
 *  (`{ ...x, color }`) and keeps every other field's reference, while every edit that
 *  does matter — a rename, a repair, a re-placement — replaces the field it changes. */
export function sameButColor(a: readonly Detection[], b: readonly Detection[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every((x, i) => {
    const y = b[i];
    if (x === y) return true;
    const keys = new Set([...Object.keys(x), ...Object.keys(y)] as (keyof Detection)[]);
    for (const k of keys) if (k !== 'color' && !Object.is(x[k], y[k])) return false;
    return true;
  });
}

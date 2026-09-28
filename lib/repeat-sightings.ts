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
import { anchorFor } from './physics';
import { clampDims } from './dimension-ranges';
import {
  defaultAxisFor,
  isRoundPart,
  isWallMountedPart,
  sceneShapeFor,
  startingSpot,
  type Category,
  type Shape,
} from './scene-spec';
import { sameThingKey } from './detect-refine';
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

/** A box this close to the photo's edge is clipped: the piece carries on out of
 *  frame, so its measured width is a lower bound rather than a size. */
const EDGE = 0.01;

/** The room the rows will be built into — only its size is read, for where a row
 *  the camera could not place will start (`startingSpot`). */
export type RoomSize = { width: number; depth: number; height: number };

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
  const anchor = anchorFor(d.category as Category, shapeOf(d));
  if (anchor === 'ceiling' && d.category !== 'curtain') return 'ceiling';
  return anchor === 'floor' ? 'floor' : 'wall';
}

/** Where the row stands and how big it is, as the room will build it.
 *
 *  A row the camera placed is compared where it was measured. A row it could not
 *  place — most often a bed cut off by the bottom of the frame, whose nearest edge
 *  is out of the picture — still becomes a piece, at the spot on its photo's wall
 *  under the middle of its box, and that is where it is compared: the question is
 *  whether the room you get will have two beds in one place, and that is the place.
 *  Without the room's size there is no such spot, and the row has nothing to compare. */
function solidOf(d: Detection, room: RoomSize | null): Solid | null {
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
    // the start spot's is only a default. Floor pieces all stand at 0 either way.
    spot = { x: start.pos[0], y: d.position?.y ?? start.pos[1], z: start.pos[2], rot: start.rot };
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

function clipped(box: Detection['box']): boolean {
  const [x, y, w, h] = box;
  return x <= EDGE || y <= EDGE || x + w >= 1 - EDGE || y + h >= 1 - EDGE;
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
 *    3. a row whose box is not cut off by the photo's edge, since its width is a
 *       measurement rather than a lower bound;
 *    4. the bigger box — the photo that saw the most of it;
 *    5. list order.
 *
 *  Greedy, like non-maximum suppression: rows are taken in that order, and each
 *  either repeats a piece already accepted (the one it shares the most with) or
 *  becomes one. A repeat is never the target of another repeat, so a piece seen in
 *  four photos is one piece and three repeats of it, not a chain.
 *
 *  `room` is required, and null only while the screen is still loading it: without
 *  it, a row with no position has nothing to compare and is its own piece. */
export function findRepeats(
  dets: readonly Detection[],
  keep: readonly boolean[],
  room: RoomSize | null,
): (number | null)[] {
  const out: (number | null)[] = dets.map(() => null);
  const solids = dets.map((d) => solidOf(d, room));
  const score = (i: number) => [
    sourceOf(dets[i]) === 'manual' ? 0 : 1,
    keep[i] ? 0 : 1,
    clipped(dets[i].box) ? 1 : 0,
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

  const pieces: number[] = [];
  for (const i of order) {
    const d = dets[i];
    const s = solids[i];
    let best = -1;
    let bestShare = 0;
    if (s && sourceOf(d) !== 'manual') {
      for (const p of pieces) {
        const ps = solids[p];
        if (!ps || !sameKind(dets[p], d)) continue;
        const share = sharedPart(ps, s);
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
  room: RoomSize | null,
): Set<number> {
  const repeats = findRepeats(dets, keep, room);
  const out = new Set<number>();
  dets.forEach((_, i) => {
    if (keep[i] && repeats[i] === null) out.add(i);
  });
  return out;
}

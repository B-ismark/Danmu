// Which wall a photo belongs to, decided rather than asked.
//
// The four capture slots are `n`/`e`/`s`/`w`, and those ids are a CYCLIC ORDER,
// not compass directions — `lib/capture.ts` says so, and the labels the user sees
// have read "Wall 1 … Wall 4" ever since. Nothing outside this file's own
// arithmetic cares where north is: `slotToWorld` maps the four ids onto the
// room's own axes, and the room's relationship to true north lives separately in
// `Site.bearingDeg`, which the user sets on a dial for the sun.
//
// That is the fact that makes auto-slotting safe. A compass bearing cannot tell
// anyone which wall of their living room "faces north" in a way they would
// recognise, but it does not have to: four bearings 90° apart, in order, are
// exactly four consecutive walls, and any constant error common to all of them —
// the local magnetic declination, a phone that writes magnetic where another
// writes true — cancels out of the differences entirely.
//
// WHAT IS AT STAKE IF THIS IS WRONG, because it is not cosmetic. `wallDistance`
// returns `depth/2` for n/s and `width/2` for e/w, so a photo of the long wall
// filed under a short one is measured from the wrong distance, and every size and
// position read off it is wrong. A wrong slot is a wrong room. Hence the ladder
// below reports which rung answered, and the screen shows it.
//
// THE LADDER, strongest rung first:
//
//   1. `bearing` — the file's own compass tag, against an anchor derived from the
//      photos already placed. Assumes nothing about how the set was shot.
//   2. `time` — EXIF shutter time orders a set nobody kept track of. It needs the
//      clockwise instruction to have been followed, so it is weaker than a
//      bearing, but it is a real measurement rather than whatever order a file
//      picker handed us.
//   3. `order` — arrival order into the first free slot. What this screen always
//      did, and still the right answer for the live camera, where the person is
//      standing in the room turning right as instructed.
//   4. `manual` — the user moved it. Beats everything; never overridden.
//
// NOT A RUNG: vanishing points. The plan this phase comes from proposed them for
// the no-bearing case, and the geometry refuses. Every shot here frames one wall
// straight-on from the middle of a box, so in EVERY photo the wall-parallel
// direction has its vanishing point at infinity and the view-axis direction has
// its own at the principal point. That pair is identical whichever wall is in
// front of the lens, and nothing in it is labelled with which world axis it is,
// so two photos cannot be told apart — let alone ordered.
// `lib/vanishing-point.ts` returns a field of view and a tilt for exactly this
// reason, and no bearing. The one signal that does survive is weaker than it
// sounds: in a non-square room the long wall subtends a visibly wider angle than
// the short one, so the wall corners would separate {n,s} from {e,w} — an axis,
// never a direction, and only after finding two corners. `wallSpan` in
// `lib/photo-geometry.ts` exposes the same fact as a number the user can check
// against their own photo, which is cheaper and honest.

import type { CaptureSlot } from './storage';
import { circularMeanDeg, circularSpreadDeg } from './compass';

/** Clockwise, and the index into it IS the quarter-turn count. `photo-geometry`'s
 *  `slotToWorld` puts n at −Z, e at +X, s at +Z, w at −X, which is clockwise in a
 *  plan drawn with +X right and −Z up — the same turn the capture instruction
 *  asks for. */
export const SLOT_ORDER: readonly CaptureSlot[] = ['n', 'e', 's', 'w'];

/** Which rung of the ladder decided a slot. Carried to the screen, which says so
 *  — a guess presented as an answer is the failure this whole file exists to
 *  avoid. */
export type SlotSignal = 'bearing' | 'time' | 'order' | 'manual';

/** What a photo's own bytes said about itself. Both optional, and both absent for
 *  anything that came through a messaging app. */
export type PhotoFacts = {
  /** Compass bearing the lens faced, degrees clockwise from north. */
  bearingDeg?: number;
  /** Shutter time, ms since epoch, from EXIF. Used only to ORDER a set — never
   *  stored, never sent. */
  shotAt?: number;
};

/** A photo already on the screen: where it sits, and what it knows. */
export type PlacedPhoto = { slot: CaptureSlot; bearingDeg?: number };

export type Placement = {
  /** Index into the batch handed to `placePhotos`, so a caller can keep its own
   *  blobs straight after the batch has been reordered by shutter time. */
  index: number;
  slot: CaptureSlot;
  by: SlotSignal;
  /** Set when the bearing pointed at a wall that was already taken and this photo
   *  fell down the ladder instead. The screen says so; placing it somewhere
   *  quietly is how a room ends up measured off the wrong wall. */
  clashedWith?: CaptureSlot;
};

export type PlaceResult = {
  placed: Placement[];
  /** Photos there was no wall left for. Four walls is the whole model. */
  rejected: number[];
};

const norm360 = (deg: number) => ((deg % 360) + 360) % 360;

/** A slot's index is its quarter-turn count from `n`. */
export const slotIndex = (slot: CaptureSlot): number => SLOT_ORDER.indexOf(slot);

/** Anchors more than this far out of agreement are not describing the same room.
 *  A slot flips at 45° of anchor error, so this leaves a good part of that margin
 *  unspent — the alternative is filing a wall by a magnetometer that was sitting
 *  next to a fridge. */
export const MAX_ANCHOR_SPREAD_DEG = 30;

/**
 * The bearing that corresponds to slot `n`, from the photos already placed.
 *
 * Derived, never stored. Each placed photo carrying a bearing implies one:
 * `bearing − 90° × its quarter-turn count`. They are averaged as directions
 * rather than as numbers, because 359° and 1° average to 180° otherwise — the
 * same trap `lib/compass.ts` documents, and the reason this borrows its mean.
 *
 * Returns null when nothing placed carries a bearing, and — deliberately — also
 * when the implied anchors disagree past `MAX_ANCHOR_SPREAD_DEG`. A set whose own
 * bearings contradict each other has no anchor worth having, and saying so drops
 * the caller one rung down the ladder instead of one wall around the room.
 */
export function anchorFrom(placed: readonly PlacedPhoto[]): number | null {
  const implied: number[] = [];
  for (const p of placed) {
    if (p.bearingDeg === undefined || !Number.isFinite(p.bearingDeg)) continue;
    implied.push(norm360(p.bearingDeg - 90 * slotIndex(p.slot)));
  }
  const mean = circularMeanDeg(implied);
  if (!mean) return null;
  if (implied.length > 1 && circularSpreadDeg(mean.resultant) > MAX_ANCHOR_SPREAD_DEG) return null;
  return norm360(mean.deg);
}

/** The slot a bearing points at, given the anchor. Rounds to the nearest
 *  quarter-turn: a bearing 40° off the ideal still names its own wall, and 50°
 *  names the next one round, which is the best any single reading can do. */
export function slotFromBearing(bearingDeg: number, anchorDeg: number): CaptureSlot {
  const turns = Math.round(norm360(bearingDeg - anchorDeg) / 90) % 4;
  return SLOT_ORDER[turns];
}

/** Shift one slot `steps` quarter-turns clockwise. Applied across the whole set,
 *  this is the entirety of the "rotate them all" control: the labels move
 *  together, so the set stays four consecutive walls in order and only its
 *  starting point changes.
 *
 *  It also re-teaches the anchor for free. `anchorFrom` reads the bearings off
 *  the photos where they now sit, so a rotation carries the anchor with them and
 *  the next bearing-carrying photo lands consistently with what the user just
 *  said. Nothing needs to persist the correction. */
export function rotateSlot(slot: CaptureSlot, steps: number): CaptureSlot {
  const i = (((slotIndex(slot) + steps) % 4) + 4) % 4;
  return SLOT_ORDER[i];
}

/**
 * Give each photo in a batch a wall.
 *
 * Incremental, and anchored on what is already there: a photo that arrives never
 * moves the photos already placed. That is a deliberate refusal of the obvious
 * design — re-optimising the whole assignment on every add would shuffle a screen
 * the user is looking at, rewrite up to four IndexedDB keys per drop, and turn a
 * correction they had already made into a suggestion. The way to change the
 * anchor is the rotation control, which says what it does.
 *
 * `shotAt` orders the batch only when EVERY photo in it has one. A partial set
 * sorted by time interleaves the timed photos through the untimed ones' positions
 * and is worse than the arrival order it replaced.
 */
export function placePhotos(
  existing: readonly PlacedPhoto[],
  batch: readonly PhotoFacts[],
): PlaceResult {
  const taken = new Set<CaptureSlot>(existing.map((e) => e.slot));
  // A copy, because the anchor grows as bearing-carrying photos land and the
  // caller's array is not ours to write into.
  const placedSoFar: PlacedPhoto[] = existing.map((e) => ({ ...e }));

  const queue = batch.map((facts, index) => ({ facts, index }));
  const timed = queue.length > 1 && queue.every((o) => o.facts.shotAt !== undefined);
  if (timed) queue.sort((a, b) => a.facts.shotAt! - b.facts.shotAt!);

  const firstFree = (): CaptureSlot | null => SLOT_ORDER.find((s) => !taken.has(s)) ?? null;

  const placed: Placement[] = [];
  const rejected: number[] = [];

  for (const { facts, index } of queue) {
    const free = firstFree();
    if (!free) {
      rejected.push(index);
      continue;
    }

    const anchor = anchorFrom(placedSoFar);
    let slot = free;
    let by: SlotSignal = timed ? 'time' : 'order';
    let clashedWith: CaptureSlot | undefined;

    if (anchor !== null && facts.bearingDeg !== undefined && Number.isFinite(facts.bearingDeg)) {
      const wanted = slotFromBearing(facts.bearingDeg, anchor);
      if (!taken.has(wanted)) {
        slot = wanted;
        by = 'bearing';
      } else {
        // Two photos of one wall, or a magnetometer that was lying. Either way the
        // bearing has been contradicted, so it stops deciding — and the screen is
        // told which wall it collided with, because "this may be a second photo of
        // Wall 1" is the sentence that helps.
        clashedWith = wanted;
      }
    }

    taken.add(slot);
    // A clashing photo contributes NO bearing to the anchor. Its slot is a
    // fallback we chose, not a wall its compass earned, so pairing the two would
    // feed the anchor a relationship that does not exist — and the anchor would
    // then fail its own agreement gate on a contradiction of our own making,
    // silently costing every later photo in the batch its bearing rung.
    placedSoFar.push({ slot, bearingDeg: clashedWith ? undefined : facts.bearingDeg });
    placed.push({ index, slot, by, ...(clashedWith ? { clashedWith } : {}) });
  }

  return { placed, rejected };
}

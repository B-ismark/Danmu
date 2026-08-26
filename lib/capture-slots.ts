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

// ─── Moving a placed set around ─────────────────────────────────────────────
//
// The screen holds one record per wall and lets the user permute them: turn the
// whole set round, swap two, drop one. Those permutations lived in the component
// as three hand-written spreads, and three separate bugs came out of a
// read-through of them — a quality score landing on the photo that had replaced
// the one it was scored for, a clash flag pointing at a wall whose photo had been
// deleted, and a clash flag left pointing at the old wall after a move. All three
// are the same shape of mistake: a fact about ONE photo written against a SLOT.
//
// So they live here, pure and generic over whatever payload the screen carries,
// beside the ladder that creates `by` and `clashedWith` in the first place.
//
// THE LIFETIME OF A CLASH FLAG, because it is a cross-reference and those rot:
// it survives a rotation (both photos move together, so "these two may be one
// wall" is still true and the reference is just relabelled) and nothing else. A
// swap, a delete or a replace means the user is working on the assignment
// themselves, which is what the flag was asking for — and it is better to drop a
// hint that has been acted on than to maintain a pointer to a photo that may no
// longer exist.

/** One record per wall, `null` where there is no photo. */
export type SlotMap<T> = Record<CaptureSlot, T | null>;

/** What these helpers need to know about a payload: the two fields this file's
 *  decisions write onto it. Everything else rides along untouched. */
export type Slotted = { by?: SlotSignal; clashedWith?: CaptureSlot };

/** A set with no photos in it. Exported so the screen does not keep a second
 *  copy of the same literal — the one place four slot ids are written down. */
export const emptySlotMap = <T>(): SlotMap<T> => ({ n: null, e: null, s: null, w: null });

/** The `from → to` mapping a rotation implies, for `roomStore.reslotCaptures`.
 *  Derived from the same `rotateSlot` the screen's own state uses, so the store
 *  and the screen cannot disagree about where a photo went. */
export function rotationMapping(steps: number): Record<CaptureSlot, CaptureSlot> {
  const out = {} as Record<CaptureSlot, CaptureSlot>;
  for (const s of SLOT_ORDER) out[s] = rotateSlot(s, steps);
  return out;
}

/** …and the mapping for one move, which is a swap when the target is occupied
 *  and a plain move when it is not. */
export function swapMapping<T>(
  map: SlotMap<T>,
  from: CaptureSlot,
  to: CaptureSlot,
): Partial<Record<CaptureSlot, CaptureSlot>> {
  const out: Partial<Record<CaptureSlot, CaptureSlot>> = { [from]: to };
  if (map[to]) out[to] = from;
  return out;
}

/** Turn the whole set `steps` walls round. Every photo keeps its payload; `by`
 *  becomes `manual`, because after this the reason it is where it is *is* the
 *  user; and a clash reference is relabelled along with the walls it names. */
export function rotateSet<T extends Slotted>(map: SlotMap<T>, steps: number): SlotMap<T> {
  const next = emptySlotMap<T>();
  for (const s of SLOT_ORDER) {
    const p = map[s];
    if (!p) continue;
    next[rotateSlot(s, steps)] = {
      ...p,
      by: 'manual',
      clashedWith: p.clashedWith ? rotateSlot(p.clashedWith, steps) : undefined,
    };
  }
  return next;
}

/** Move one photo, swapping with whatever is already there. Clash flags across
 *  the whole set are dropped — see the note above. */
export function swapSet<T extends Slotted>(
  map: SlotMap<T>,
  from: CaptureSlot,
  to: CaptureSlot,
): SlotMap<T> {
  if (from === to || !map[from]) return map;
  const next = withoutClashes(map);
  const moving = next[from]!;
  const displaced = next[to];
  next[from] = displaced ? { ...displaced, by: 'manual' } : null;
  next[to] = { ...moving, by: 'manual' };
  return next;
}

/** Take one photo out. Every clash flag in the set goes with it — not only the
 *  ones naming this wall, per the lifetime rule above. The narrow version would
 *  be defensible too, but the wide one is the same rule as `swapSet`'s and has no
 *  case where it can leave a chip reading "maybe Wall 1 again" beside an empty
 *  Wall 1, which is worse than no chip. */
export function clearSlot<T extends Slotted>(map: SlotMap<T>, slot: CaptureSlot): SlotMap<T> {
  const next = withoutClashes(map);
  next[slot] = null;
  return next;
}

/** Every photo, with no clash flags. */
export function withoutClashes<T extends Slotted>(map: SlotMap<T>): SlotMap<T> {
  const next = emptySlotMap<T>();
  for (const s of SLOT_ORDER) {
    const p = map[s];
    next[s] = p ? { ...p, clashedWith: undefined } : null;
  }
  return next;
}

/**
 * Write `patch` onto the photo at `slot`, but only while it is still that photo.
 *
 * Quality scoring is async and keyed on nothing: it is started for one blob and
 * resolves whenever it resolves. Written back by slot alone, it lands on whatever
 * occupies that wall by then — so rotating a set while its photos were still
 * being scored relabelled every score, and the chip then described a different
 * image. The blob is the identity, and the identity is the check.
 *
 * Returns the same map object when the photo has moved on, so React can skip the
 * render as well as the wrong write.
 */
export function patchIfSame<T extends { blob: unknown }>(
  map: SlotMap<T>,
  slot: CaptureSlot,
  blob: unknown,
  patch: Partial<T>,
): SlotMap<T> {
  const at = map[slot];
  if (!at || at.blob !== blob) return map;
  return { ...map, [slot]: { ...at, ...patch } };
}

/**
 * What just happened, for the live region.
 *
 * Pure, and takes its own labeller, so it does not have to reach into
 * `lib/capture.ts` (which is a client module, and would close a cycle). Built
 * here rather than inline because it has four plural decisions and one edge case
 * that was wrong: with every wall already full, nothing is placed, and the
 * sentence read "0 photo added: ." before the rejection was mentioned at all.
 */
export function describePlacement(
  result: PlaceResult,
  labelOf: (slot: CaptureSlot) => string,
): string {
  const { placed, rejected } = result;
  const tooMany = rejected.length
    ? `${rejected.length} photo${rejected.length > 1 ? 's' : ''} could not be added — all four walls already have one.`
    : '';
  if (!placed.length) return tooMany || 'Nothing to add.';

  const compass = placed.filter((p) => p.by === 'bearing').length;
  const timed = placed.some((p) => p.by === 'time');
  return [
    `${placed.length} photo${placed.length > 1 ? 's' : ''} added: ${placed.map((p) => labelOf(p.slot)).join(', ')}.`,
    compass > 0 ? `${compass} placed from the photo’s own compass.` : '',
    timed ? 'Ordered by when they were taken.' : '',
    ...placed
      .filter((p) => p.clashedWith)
      .map((p) => `${labelOf(p.slot)} may be a second photo of ${labelOf(p.clashedWith!)} — check it.`),
    tooMany,
  ]
    .filter(Boolean)
    .join(' ');
}

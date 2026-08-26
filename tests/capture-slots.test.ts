import { describe, it, expect } from 'vitest';
import {
  MAX_ANCHOR_SPREAD_DEG,
  SLOT_ORDER,
  anchorFrom,
  clearSlot,
  describePlacement,
  patchIfSame,
  placePhotos,
  rotateSet,
  rotateSlot,
  rotationMapping,
  slotFromBearing,
  slotIndex,
  swapMapping,
  swapSet,
  type PlacedPhoto,
  type SlotMap,
  type SlotSignal,
} from '@/lib/capture-slots';
import type { CaptureSlot } from '@/lib/storage';

/** Angular distance between two bearings, so an assertion about "0°" survives a
 *  result of 359.9999. */
const apart = (a: number, b: number) => Math.abs(((((a - b) % 360) + 540) % 360) - 180);
const near = (a: number, b: number) => apart(a, b) < 0.5;

describe('the slot order is the quarter-turn count', () => {
  it('runs clockwise from n, and the index is the number of turns', () => {
    expect([...SLOT_ORDER]).toEqual(['n', 'e', 's', 'w']);
    expect(slotIndex('n')).toBe(0);
    expect(slotIndex('s')).toBe(2);
  });

  it('rotates in both directions and wraps', () => {
    expect(rotateSlot('n', 1)).toBe('e');
    expect(rotateSlot('w', 1)).toBe('n');
    // Anticlockwise is the half nobody tests, and a `%` on a negative number in
    // JS returns a negative number — the bug this asserts against.
    expect(rotateSlot('n', -1)).toBe('w');
    expect(rotateSlot('e', -3)).toBe('s');
    expect(rotateSlot('s', 4)).toBe('s');
    expect(rotateSlot('s', -8)).toBe('s');
  });
});

describe('slotFromBearing', () => {
  it('maps each quarter-turn from the anchor to the next wall round', () => {
    expect(slotFromBearing(215, 215)).toBe('n');
    expect(slotFromBearing(305, 215)).toBe('e');
    expect(slotFromBearing(35, 215)).toBe('s');
    expect(slotFromBearing(125, 215)).toBe('w');
  });

  it('rounds to the nearest wall rather than the one it passed', () => {
    // 44° off still names its own wall; 46° names the next. That 45° is all the
    // margin a single magnetometer reading gets, and it is why the anchor spread
    // gate is tighter than 45.
    expect(slotFromBearing(215 + 44, 215)).toBe('n');
    expect(slotFromBearing(215 + 46, 215)).toBe('e');
  });

  it('wraps rather than falling off the end of the order', () => {
    // 359° from the anchor rounds to FOUR quarter-turns. Without the `% 4` this
    // indexes past the array and returns undefined, which typechecks.
    expect(slotFromBearing(215 + 359, 215)).toBe('n');
    expect(slotFromBearing(-90, 0)).toBe('w');
  });
});

describe('anchorFrom', () => {
  it('reads the anchor off one placed photo, whichever wall it sits on', () => {
    expect(near(anchorFrom([{ slot: 'n', bearingDeg: 215 }])!, 215)).toBe(true);
    // Same room, same anchor, described by the photo two walls round.
    expect(near(anchorFrom([{ slot: 's', bearingDeg: 35 }])!, 215)).toBe(true);
    expect(near(anchorFrom([{ slot: 'w', bearingDeg: 125 }])!, 215)).toBe(true);
  });

  it('averages agreeing photos as directions, not as numbers', () => {
    // Implied anchors 359° and 1°. The arithmetic mean is 180° — the opposite
    // side of the room — which is exactly the bug `circularMeanDeg` exists for.
    const a = anchorFrom([
      { slot: 'n', bearingDeg: 359 },
      { slot: 'e', bearingDeg: 91 },
    ]);
    expect(a).not.toBeNull();
    expect(near(a!, 0)).toBe(true);
  });

  it('refuses an anchor its own photos disagree about', () => {
    // Implied 0° and 90°: two photos that cannot both be right, and averaging
    // them lands 45° from each — precisely the value at which a slot flips.
    expect(
      anchorFrom([
        { slot: 'n', bearingDeg: 0 },
        { slot: 'e', bearingDeg: 180 },
      ]),
    ).toBeNull();
  });

  it('accepts a disagreement small enough to leave the answer intact', () => {
    // Implied 0° and 30° — a 15° spread, half the gate.
    const a = anchorFrom([
      { slot: 'n', bearingDeg: 0 },
      { slot: 'e', bearingDeg: 120 },
    ]);
    expect(a).not.toBeNull();
    expect(near(a!, 15)).toBe(true);
  });

  it('has no anchor when nothing placed carries a bearing', () => {
    expect(anchorFrom([])).toBeNull();
    expect(anchorFrom([{ slot: 'n' }, { slot: 'e' }])).toBeNull();
  });

  it('ignores a bearing that is not a number', () => {
    // A `pose` read back out of IndexedDB is only as good as what went in.
    expect(anchorFrom([{ slot: 'n', bearingDeg: NaN }])).toBeNull();
    expect(near(anchorFrom([{ slot: 'n', bearingDeg: NaN }, { slot: 'e', bearingDeg: 305 }])!, 215)).toBe(true);
  });

  it('states the gate as a number rather than burying it', () => {
    expect(MAX_ANCHOR_SPREAD_DEG).toBeLessThan(45);
  });
});

describe('placePhotos — the ladder', () => {
  it('files four bearing-carrying photos onto four consecutive walls, in any pick order', () => {
    // A room whose four walls read 35° / 125° / 215° / 305°, handed over shuffled.
    // The FIRST photo is placed by order, not by bearing: its own bearing had
    // nothing to be measured against yet, and any wall would have done. It
    // becomes the anchor, and the other three are then measured against it — so
    // the one thing the rotation control fixes is where this first photo landed.
    const { placed, rejected } = placePhotos([], [
      { bearingDeg: 35 },
      { bearingDeg: 215 },
      { bearingDeg: 125 },
      { bearingDeg: 305 },
    ]);
    expect(rejected).toEqual([]);
    expect(placed.map((p) => [p.index, p.slot, p.by])).toEqual([
      [0, 'n', 'order'],
      [1, 's', 'bearing'],
      [2, 'e', 'bearing'],
      [3, 'w', 'bearing'],
    ]);
    // Four distinct walls, which is the only property the geometry needs.
    expect(new Set(placed.map((p) => p.slot)).size).toBe(4);
  });

  it('anchors on the photos already there, so an arriving photo never moves them', () => {
    const existing: PlacedPhoto[] = [{ slot: 'n', bearingDeg: 215 }];
    const frozen = JSON.stringify(existing);
    const { placed } = placePhotos(existing, [{ bearingDeg: 125 }]);
    expect(placed).toEqual([{ index: 0, slot: 'w', by: 'bearing' }]);
    // The caller's array is not ours. A reslot of what is already on screen is
    // the rotation control's job, and it says so before it does it.
    expect(JSON.stringify(existing)).toBe(frozen);
  });

  it('carries the rotation the user made into where the next photo lands', () => {
    // The set was placed, then rotated one turn clockwise: the photo that was on
    // n now reads e. A new photo from the same room must follow the correction,
    // and it does because the anchor is DERIVED from where the photos now sit.
    const rotated: PlacedPhoto[] = [{ slot: rotateSlot('n', 1), bearingDeg: 215 }];
    const { placed } = placePhotos(rotated, [{ bearingDeg: 305 }]);
    expect(placed[0].slot).toBe('s');
    expect(placed[0].by).toBe('bearing');
  });

  it('orders a batch by its shutter times when every photo has one', () => {
    const { placed } = placePhotos([], [{ shotAt: 3000 }, { shotAt: 1000 }, { shotAt: 2000 }]);
    expect(placed.map((p) => [p.index, p.slot, p.by])).toEqual([
      [1, 'n', 'time'],
      [2, 'e', 'time'],
      [0, 's', 'time'],
    ]);
  });

  it('keeps arrival order when only some of the batch is timed', () => {
    // A partial sort interleaves the timed photos through the untimed ones'
    // positions, which is worse than the order the picker gave us.
    const { placed } = placePhotos([], [{ shotAt: 3000 }, {}, { shotAt: 1000 }]);
    expect(placed.map((p) => [p.index, p.slot, p.by])).toEqual([
      [0, 'n', 'order'],
      [1, 'e', 'order'],
      [2, 's', 'order'],
    ]);
  });

  it('does not call a single photo "time" — nothing was ordered', () => {
    const { placed } = placePhotos([], [{ shotAt: 3000 }]);
    expect(placed[0].by).toBe('order');
  });

  it('says which wall a contradicted bearing pointed at instead of placing it quietly', () => {
    // Two photos of one wall, or a magnetometer next to a fridge. Either way the
    // second one's bearing has been contradicted, so it stops deciding — and the
    // screen is told what it collided with.
    const { placed } = placePhotos([], [{ bearingDeg: 10 }, { bearingDeg: 15 }]);
    expect(placed[0]).toEqual({ index: 0, slot: 'n', by: 'order' });
    expect(placed[1]).toEqual({ index: 1, slot: 'e', by: 'order', clashedWith: 'n' });
  });

  it('does not let a clashing photo poison the anchor for the ones behind it', () => {
    // Two photos of Wall 1 (10° and 15°), then a genuine Wall 3 at 190°.
    //
    // The second photo goes to `e` as a fallback. If its bearing were then paired
    // with that slot, the set would imply anchors of 10° and 285° — 85° apart,
    // failing the agreement gate — and the third photo would lose its bearing rung
    // to a contradiction we manufactured ourselves.
    const { placed } = placePhotos([], [{ bearingDeg: 10 }, { bearingDeg: 15 }, { bearingDeg: 190 }]);
    expect(placed[1]).toEqual({ index: 1, slot: 'e', by: 'order', clashedWith: 'n' });
    // `s` either way — it is the first free wall as well as the measured one — so
    // `by` is the whole of the evidence here, which is why it is asserted and not
    // the slot: a poisoned anchor gives up and says `order`.
    expect(placed[2]).toEqual({ index: 2, slot: 's', by: 'bearing' });
  });

  it('leaves the clash flag off a photo whose bearing was believed', () => {
    const { placed } = placePhotos([], [{ bearingDeg: 10 }, { bearingDeg: 100 }]);
    expect(placed[1].clashedWith).toBeUndefined();
    expect(placed[1].by).toBe('bearing');
  });

  it('falls to order when the set it is anchoring on contradicts itself', () => {
    const { placed } = placePhotos(
      [
        { slot: 'n', bearingDeg: 0 },
        { slot: 'e', bearingDeg: 180 },
      ],
      [{ bearingDeg: 180 }],
    );
    expect(placed[0]).toEqual({ index: 0, slot: 's', by: 'order' });
  });

  it('rejects the fifth photo rather than inventing a wall', () => {
    const { placed, rejected } = placePhotos([], [{}, {}, {}, {}, {}, {}]);
    expect(placed.map((p) => p.slot)).toEqual(['n', 'e', 's', 'w']);
    expect(rejected).toEqual([4, 5]);
  });

  it('rejects everything when the room is already full', () => {
    const full: PlacedPhoto[] = SLOT_ORDER.map((slot) => ({ slot }));
    expect(placePhotos(full, [{ bearingDeg: 10 }])).toEqual({ placed: [], rejected: [0] });
  });

  it('fills the gap a removed photo left, not the end of the row', () => {
    const { placed } = placePhotos([{ slot: 'n' }, { slot: 's' }], [{}]);
    expect(placed[0].slot).toBe('e');
  });
});

// ─── Moving a placed set around ─────────────────────────────────────────────
//
// These three bugs all shipped, and all came out of a read-through rather than a
// failing test, because the logic was three hand-written spreads inside a React
// component. That is why it lives in `lib/` now.

type Card = { blob: object; quality?: string; by?: SlotSignal; clashedWith?: CaptureSlot };

/** A set with a distinct blob per wall, so identity is observable. */
function set(spec: Partial<Record<CaptureSlot, Partial<Card>>>): SlotMap<Card> {
  const out: SlotMap<Card> = { n: null, e: null, s: null, w: null };
  for (const s of SLOT_ORDER) {
    const v = spec[s];
    if (v) out[s] = { blob: { id: s }, ...v } as Card;
  }
  return out;
}
const walls = (m: SlotMap<Card>) =>
  Object.fromEntries(SLOT_ORDER.filter((s) => m[s]).map((s) => [s, (m[s]!.blob as { id: string }).id]));

describe('rotateSet', () => {
  it('turns the whole set round and keeps every photo', () => {
    expect(walls(rotateSet(set({ n: {}, e: {} }), 1))).toEqual({ e: 'n', s: 'e' });
  });

  it('claims the placement as the user’s, because it now is', () => {
    expect(rotateSet(set({ n: { by: 'bearing' } }), 1).e!.by).toBe('manual');
  });

  it('relabels a clash rather than dropping or stranding it', () => {
    // Two photos of one wall are still two photos of one wall after a rotation —
    // both moved together, so the reference is only renamed.
    const after = rotateSet(set({ n: {}, e: { clashedWith: 'n' } }), 1);
    expect(after.s!.clashedWith).toBe('e');
    expect(after.e!.clashedWith).toBeUndefined();
  });

  it('goes backwards too', () => {
    expect(walls(rotateSet(set({ n: {}, e: {} }), -1))).toEqual({ n: 'e', w: 'n' });
  });
});

describe('swapSet', () => {
  it('swaps two photos past each other', () => {
    expect(walls(swapSet(set({ n: {}, s: {} }), 'n', 's'))).toEqual({ n: 's', s: 'n' });
  });

  it('vacates the wall a photo moved off when the target was empty', () => {
    expect(walls(swapSet(set({ n: {} }), 'n', 'w'))).toEqual({ w: 'n' });
  });

  it('drops every clash flag, including one naming a wall it did not touch', () => {
    // A clash asks the user to check an assignment. Once they start moving photos
    // themselves it has been answered, and a cross-reference kept past that point
    // is a pointer to a photo that may not be there any more.
    const after = swapSet(set({ n: {}, e: { clashedWith: 'n' }, s: { clashedWith: 'n' } }), 'n', 'w');
    expect(after.e!.clashedWith).toBeUndefined();
    expect(after.s!.clashedWith).toBeUndefined();
  });

  it('does nothing at all when there is no photo to move', () => {
    const before = set({ e: {} });
    expect(swapSet(before, 'n', 'e')).toBe(before);
    expect(swapSet(before, 'e', 'e')).toBe(before);
  });
});

describe('clearSlot', () => {
  it('takes the photo out', () => {
    expect(walls(clearSlot(set({ n: {}, e: {} }), 'n'))).toEqual({ e: 'e' });
  });

  it('clears a clash on ANOTHER wall that named the one being emptied', () => {
    // "Maybe Wall 1 again" beside an empty Wall 1 is worse than no chip at all.
    expect(clearSlot(set({ n: {}, e: { clashedWith: 'n' } }), 'n').e!.clashedWith).toBeUndefined();
  });
});

describe('patchIfSame', () => {
  it('writes the patch while it is still the same photo', () => {
    const before = set({ n: {} });
    expect(patchIfSame(before, 'n', before.n!.blob, { quality: 'sharp' }).n!.quality).toBe('sharp');
  });

  it('refuses to write onto the photo that replaced the one it was scored for', () => {
    // The shipped bug: quality scoring is async and was written back by SLOT, so
    // rotating a set mid-scoring relabelled every score and the chip then
    // described a different image.
    //
    // TWO photos, deliberately. A one-photo fixture leaves the old wall EMPTY
    // after the rotation, and an empty wall is refused by the `!at` guard whether
    // or not identity is checked at all — so it passed against a mutant with the
    // identity check removed. Mutation testing is what caught that; the case that
    // matters is a wall occupied by a DIFFERENT photo.
    const before = set({ n: {}, w: {} });
    const rotated = rotateSet(before, 1);
    const stale = before.n!.blob;
    expect(rotated.n!.blob).toBe(before.w!.blob);
    expect(patchIfSame(rotated, 'n', stale, { quality: 'sharp' })).toBe(rotated);
    expect(rotated.n!.quality).toBeUndefined();
    // …and it lands correctly when addressed to where that photo actually went.
    expect(patchIfSame(rotated, 'e', stale, { quality: 'sharp' }).e!.quality).toBe('sharp');
  });

  it('returns the same object for an empty wall, so React can skip the render', () => {
    const before = set({ e: {} });
    expect(patchIfSame(before, 'n', {}, { quality: 'sharp' })).toBe(before);
  });
});

describe('the mapping handed to the store matches what the screen does', () => {
  it('rotation: every wall moves, and it agrees with rotateSet', () => {
    const m = rotationMapping(1);
    expect(m).toEqual({ n: 'e', e: 's', s: 'w', w: 'n' });
    for (const s of SLOT_ORDER) expect(m[s]).toBe(rotateSlot(s, 1));
  });

  it('move: a swap when the target is taken, a plain move when it is not', () => {
    expect(swapMapping(set({ n: {}, s: {} }), 'n', 's')).toEqual({ n: 's', s: 'n' });
    expect(swapMapping(set({ n: {} }), 'n', 's')).toEqual({ n: 's' });
  });
});

describe('describePlacement', () => {
  const L = (s: CaptureSlot) => `Wall ${SLOT_ORDER.indexOf(s) + 1}`;
  const FULL = SLOT_ORDER.map((slot) => ({ slot }));

  it('names the walls and how they were decided', () => {
    const said = describePlacement(placePhotos([], [{ bearingDeg: 10 }, { bearingDeg: 100 }]), L);
    expect(said).toContain('2 photos added: Wall 1, Wall 2.');
    // The curly apostrophe the rest of this screen's copy uses. A straight one
    // here would be the only ASCII quote in a sentence sitting beside four typeset
    // ones, which is the kind of thing nobody sees until it is on screen.
    expect(said).toContain('1 placed from the photo’s own compass.');
  });

  it('has something to say about an empty batch rather than an empty string', () => {
    // Unreachable from the screen — `addFiles` returns before this when nothing
    // survived the file filter — but a live region handed '' says nothing at all,
    // and a total function is cheaper than a caller who has to remember.
    expect(describePlacement({ placed: [], rejected: [] }, L)).toBe('Nothing to add.');
  });

  it('does not say "0 photo added: ." when every wall is full', () => {
    // The shipped bug. Nothing is placed, so the sentence had no walls to name,
    // and the rejection was appended after it rather than replacing it.
    const said = describePlacement(placePhotos(FULL, [{}]), L);
    expect(said).toBe('1 photo could not be added — all four walls already have one.');
    expect(said).not.toContain('0 photo');
  });

  it('is singular for one and plural for more', () => {
    expect(describePlacement(placePhotos([], [{}]), L)).toContain('1 photo added: Wall 1.');
    expect(describePlacement(placePhotos(FULL, [{}, {}]), L)).toContain('2 photos could not be added');
  });

  it('mentions the shutter-time ordering only when it was used', () => {
    expect(describePlacement(placePhotos([], [{ shotAt: 2 }, { shotAt: 1 }]), L)).toContain(
      'Ordered by when they were taken.',
    );
    expect(describePlacement(placePhotos([], [{}, {}]), L)).not.toContain('Ordered by');
  });

  it('says which wall a contradicted bearing pointed at', () => {
    const said = describePlacement(placePhotos([], [{ bearingDeg: 10 }, { bearingDeg: 15 }]), L);
    expect(said).toContain('Wall 2 may be a second photo of Wall 1 — check it.');
  });

  it('reports both halves when some land and some do not', () => {
    const said = describePlacement(placePhotos([{ slot: 'n' }, { slot: 'e' }], [{}, {}, {}]), L);
    expect(said).toContain('2 photos added: Wall 3, Wall 4.');
    expect(said).toContain('1 photo could not be added');
  });
});

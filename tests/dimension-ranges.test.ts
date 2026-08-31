import { describe, it, expect } from 'vitest';
import { applyRoomEdits, clampDims, dimRangeFor, dimsWithinRange, ROOM_AXES, ROOM_SIDE_EPS, ROOM_SIDE_M, roomAxisRange, type RoomAxis } from '@/lib/dimension-ranges';
import { stepFor, toMM } from '@/lib/units';

describe('dimRangeFor', () => {
  it('keeps electronics on a tight leash (fixed tier)', () => {
    expect(dimRangeFor('monitor', 'laptop').flex).toBe('fixed');
    expect(dimRangeFor('tv', 'tv').flex).toBe('fixed');
    expect(dimRangeFor('door', 'door').flex).toBe('fixed');
  });

  it('gives made-to-measure furniture creative room (flexible tier)', () => {
    expect(dimRangeFor('table', 'coffee-table').flex).toBe('flexible');
    expect(dimRangeFor('rug', 'rug').flex).toBe('flexible');
    expect(dimRangeFor('sofa', 'sofa').flex).toBe('flexible');
  });

  it('falls back to the category, then a wide default', () => {
    // box shape with a known category → category range. Asserted through `flex`,
    // which is the actual discriminator: the permissive fallback is 'flexible', so
    // only a real category hit can be 'standard'. This used to read
    // `min[0] > 1000`, which passed only because the bed rows were transposed and
    // dimMM[0] held a length; un-transposing them dropped it to 800 and the
    // assertion went red for a reason that had nothing to do with what it tests.
    expect(dimRangeFor('bed', 'box').flex).toBe('standard');
    // …and it is the bed row rather than some other standard one.
    expect(dimRangeFor('bed', 'box').min[1]).toBeGreaterThan(1000);
    // unknown both ways → permissive fallback.
    expect(dimRangeFor('other', 'cylinder').flex).toBe('flexible');
  });
});

describe('clampDims', () => {
  it('blocks a laptop from scaling to desk width', () => {
    const d = clampDims('monitor', 'laptop', [1200, 240, 20]);
    expect(d[0]).toBeLessThanOrEqual(420);
  });

  it('lets a dining table stretch within its wide band', () => {
    const d = clampDims('desk', 'desk-standard', [2200, 1000, 760]);
    expect(d).toEqual([2200, 1000, 760]); // untouched — within range
  });

  it('collapses absurd AI estimates to credible sizes', () => {
    // "3.5m-wide fridge" → max credible fridge.
    const fridge = clampDims('fridge', 'fridge', [3500, 650, 1700]);
    expect(fridge[0]).toBeLessThanOrEqual(950);
    // "8cm sofa" → min credible sofa.
    const sofa = clampDims('sofa', 'sofa', [80, 950, 880]);
    expect(sofa[0]).toBeGreaterThanOrEqual(1200);
  });

  it('clamps each axis independently', () => {
    const d = clampDims('tv', 'tv', [10000, 1, 820]);
    expect(d[0]).toBe(2000);
    expect(d[1]).toBe(40);
    expect(d[2]).toBe(820);
  });
});

describe('dimsWithinRange', () => {
  it('agrees with clampDims', () => {
    // H is open-lid height: 220 mm is the catalog's own laptop.
    expect(dimsWithinRange('monitor', 'laptop', [340, 240, 220])).toBe(true);
    expect(dimsWithinRange('monitor', 'laptop', [1200, 240, 220])).toBe(false);
  });
});

describe('a sofa is always wider than it is deep', () => {
  it('cannot be clamped into a bed', () => {
    // A library size search for 160x200cm asks every shape for 1600 wide and 2000
    // deep. The sofa depth max was 1800, so the clamp let 1800 through and the
    // catalog badged — and added — a 1.6 x 1.8 m sofa.
    const d = clampDims('sofa', 'sofa', [1600, 2000, 880]);
    expect(d[1]).toBeLessThan(d[0]);
  });

  it('holds for every legal size, not only that one', () => {
    // clampDims is per-axis and cannot express a ratio, so the guarantee has to be
    // carried by the constants: the deepest legal depth below the narrowest legal
    // width. Assert the PAIR — widening either end on its own is how the absurd
    // size gets back in, and neither end can see that from where it sits.
    const r = dimRangeFor('sofa', 'sofa');
    expect(r.max[1]).toBeLessThan(r.min[0]);
  });
});

describe('applyRoomEdits', () => {
  const ROOM = { width: 4, depth: 3, height: 2.5 };

  it('writes the axes in the batch and takes the rest off the room', () => {
    const { room, rejected } = applyRoomEdits(ROOM, { width: 5 });
    expect(rejected).toBeNull();
    expect(room).toEqual({ width: 5, depth: 3, height: 2.5 });
  });

  it('cannot commit a value it never judged — the NaN a cleared field leaves behind', () => {
    // The live sequence, in order: clear the Height box, that batch is refused
    // and the empty string stays on screen, then type one character in Width.
    // `RoomDimsEditor` judged the edited axis and wrote all three out of the
    // FORM, so the width commit carried `parseFloat('') === NaN` into the store
    // and into IndexedDB. The second call is the one that used to corrupt.
    const refused = applyRoomEdits(ROOM, { height: NaN });
    expect(refused.rejected).toBe('height');
    expect(refused.room).toEqual(ROOM);

    const after = applyRoomEdits(ROOM, { width: 5 });
    expect(after.rejected).toBeNull();
    expect(Number.isNaN(after.room.height)).toBe(false);
    expect(after.room.height).toBe(2.5);
  });

  it('refuses the whole batch when one axis of it is out of range', () => {
    // All-or-nothing on purpose: writing the good axis changes the room, the
    // editor resyncs its fields from the room, and the refused number would be
    // wiped off the screen while the message still named it.
    const { room, rejected } = applyRoomEdits(ROOM, { width: 5, height: 99 });
    expect(rejected).toBe('height');
    expect(room).toEqual(ROOM);
  });

  it('names the axis that is out of range, not the first one in the batch', () => {
    expect(applyRoomEdits(ROOM, { width: 5, depth: 0.2 }).rejected).toBe('depth');
    expect(applyRoomEdits(ROOM, { width: 0.2, depth: 3.5 }).rejected).toBe('width');
  });

  it('holds a ceiling to the ceiling range and a side to the side range', () => {
    // 1.5 m is a legal side and an illegal ceiling; 20 m is a legal side and an
    // illegal ceiling too. Sharing one range for all three axes is the defect
    // ROOM_HEIGHT_M exists to prevent, so the asymmetry IS the assertion — a
    // fixture that only used values legal or illegal for both could not see it.
    expect(applyRoomEdits(ROOM, { width: 1.5 }).rejected).toBeNull();
    expect(applyRoomEdits(ROOM, { height: 1.5 }).rejected).toBe('height');
    expect(applyRoomEdits(ROOM, { depth: 20 }).rejected).toBeNull();
    expect(applyRoomEdits(ROOM, { height: 20 }).rejected).toBe('height');
  });

  it('leaves every other axis alone, swept over all three rather than sampled', () => {
    for (const axis of ROOM_AXES) {
      const edits: Partial<Record<RoomAxis, number>> = { [axis]: 2.4 };
      const { room, rejected } = applyRoomEdits(ROOM, edits);
      expect(rejected).toBeNull();
      expect(room[axis]).toBe(2.4);
      for (const other of ROOM_AXES) {
        if (other !== axis) expect(room[other]).toBe(ROOM[other]);
      }
    }
  });

  it('does not mutate the room it was handed', () => {
    const src = { ...ROOM };
    applyRoomEdits(src, { width: 5 });
    expect(src).toEqual(ROOM);
  });
});

describe('ROOM_AXES', () => {
  it('names each axis exactly once', () => {
    // `RoomAxis` is derived from this array now, so the array is the thing that
    // can be wrong. A hand-written union beside a hand-kept tuple accepted
    // `['width', 'width', 'height']` — three entries, correct type, one axis
    // unreachable and another judged twice.
    expect([...new Set(ROOM_AXES)]).toEqual([...ROOM_AXES]);
    expect(ROOM_AXES.length).toBe(3);
  });

  it('covers every axis roomAxisRange can answer for', () => {
    // The derived union means this loop is exhaustive by construction: adding a
    // fourth axis to ROOM_AXES widens RoomAxis, and anything switching on it
    // stops compiling. The assertion is that each one has a usable range.
    for (const axis of ROOM_AXES) {
      const r = roomAxisRange(axis);
      expect(r.min).toBeGreaterThan(0);
      expect(r.max).toBeGreaterThan(r.min);
    }
  });
});

describe('applyRoomEdits pending', () => {
  const ROOM = { width: 4, depth: 3, height: 2.5 };

  it('hands the whole batch back when it refuses one axis of it', () => {
    // The behaviour the editor's retry rests on, and the reason it is HERE: it
    // lived in the component, where the repo's own precedent (lib/drag-click.ts)
    // says a decision has no gate. Clearing the caller's pending set on this path
    // is the defect — the good width goes with the bad height.
    const { pending, rejected } = applyRoomEdits(ROOM, { width: 5, height: 99 });
    expect(rejected).toBe('height');
    expect(pending).toEqual({ width: 5, height: 99 });
  });

  it('keeps nothing pending once the batch is taken', () => {
    const { pending, rejected } = applyRoomEdits(ROOM, { width: 5, depth: 3.5 });
    expect(rejected).toBeNull();
    expect(pending).toEqual({});
  });

  it('a retry of the returned batch commits it whole once the bad axis is fixed', () => {
    // The full sequence, which is what the user actually does: legal width and
    // illegal height in one debounce window, refused; the height corrected; and
    // the width must still be in the commit rather than snapped back.
    const first = applyRoomEdits(ROOM, { width: 5, height: 99 });
    expect(first.room).toEqual(ROOM);
    const retry = applyRoomEdits(ROOM, { ...first.pending, height: 2.6 });
    expect(retry.rejected).toBeNull();
    expect(retry.room).toEqual({ width: 5, depth: 3, height: 2.6 });
  });
});

describe('ROOM_SIDE_EPS', () => {
  it('is far below the finest size the app can display', () => {
    // Pinned only from BELOW before this: a review set it to 0.04 — forty
    // millimetres — and every test in three files stayed green, because both drift
    // fixtures step 50 mm, which is larger than the surviving tolerance. At 40 mm a
    // wall stops 40 mm INSIDE the sectional and `moveWall` persists a room narrower
    // than the piece standing in it: rule 2's "never silently resize it to fit", in
    // the constant added to prevent it.
    //
    // The bound is DERIVED from the unit table rather than typed, so a new unit
    // with a finer step tightens it automatically.
    const finestMM = Math.min(...(['m', 'cm', 'mm', 'ft', 'in'] as const).map((u) => toMM(stepFor(u), u)));
    expect(ROOM_SIDE_EPS).toBeGreaterThan(0);
    expect(ROOM_SIDE_EPS * 1000, 'a tolerance the user can see is not a tolerance').toBeLessThan(finestMM / 100);
  });
});

describe('applyRoomEdits furniture floors', () => {
  const ROOM = { width: 4, depth: 3, height: 2.5 };

  it('refuses a side the furniture will not fit on, and says which rule refused', () => {
    const r = applyRoomEdits(ROOM, { width: 2 }, { width: 2.4 });
    expect(r.rejected).toBe('width');
    expect(r.rejectedBy).toBe('floor');
    expect(r.room).toEqual(ROOM);
  });

  it('takes the same edit when no floor is given — the bound is opt-in', () => {
    // Every caller that existed before the stop passes two arguments and must keep
    // behaving exactly as it did. A third parameter that changed the two-argument
    // answer would be a silent behaviour change for `lib/scene-file.ts`'s
    // neighbours and for every existing test above.
    const r = applyRoomEdits(ROOM, { width: 2 });
    expect(r.rejected).toBeNull();
    expect(r.rejectedBy).toBeNull();
    expect(r.room.width).toBe(2);
  });

  it('takes a value exactly ON the floor', () => {
    // The stop is the size the piece needs, so that size fits. An exclusive
    // comparison here makes the number the message names the one number the field
    // will not accept, which is the shape of the `boundsToUnit` bug in a different
    // place.
    expect(applyRoomEdits(ROOM, { width: 2.4 }, { width: 2.4 }).rejected).toBeNull();
  });

  it('lets the room GROW past the floor', () => {
    expect(applyRoomEdits(ROOM, { width: 6 }, { width: 2.4 }).rejected).toBeNull();
  });

  it('applies the floor per axis, and never to the ceiling', () => {
    // A floor is a fact about the plan, so it has no business bounding a height —
    // a piece taller than the ceiling keeps its height and clearance.ts reports it.
    expect(applyRoomEdits(ROOM, { depth: 2 }, { width: 2.4 }).rejected).toBeNull();
    expect(applyRoomEdits(ROOM, { depth: 2 }, { depth: 2.4 }).rejected).toBe('depth');
    expect(applyRoomEdits(ROOM, { height: 2 }, { width: 2.4, depth: 2.4 }).rejected).toBeNull();
  });

  it('says "range" rather than "floor" when the floor is only the hard minimum', () => {
    // `roomFloor` returns ROOM_SIDE_M.min for an empty room, so the editor passes
    // that number on every commit. Reporting it as a furniture refusal would make
    // the caller render "… needs 1 m" with no piece to name — a refusal pointing at
    // nothing. Below the static min the static message is the honest one.
    const r = applyRoomEdits(ROOM, { width: 0.5 }, { width: ROOM_SIDE_M.min });
    expect(r.rejected).toBe('width');
    expect(r.rejectedBy).toBe('range');
  });

  it('names the piece even when the value is below the static minimum too', () => {
    // This is the ORDER, and it is the only assertion that can see it: 0.5 fails
    // both rules, so checking the static range first answers "outside 2.4–50 m"
    // where checking the floor first answers "the sectional needs 2.4 m". Every
    // other case here fails exactly one rule and passes under either ordering.
    const r = applyRoomEdits(ROOM, { width: 0.5 }, { width: 2.4 });
    expect(r.rejectedBy).toBe('floor');
  });

  it('reports "range" for an infinite value even while a floor is in force', () => {
    // `NaN < floor` is false all by itself; `-Infinity < floor` is TRUE, so without
    // the finiteness guard a room whose width parsed to -Infinity would be blamed
    // on the sofa. The one case that guard exists for, and the only one that can
    // observe it.
    expect(applyRoomEdits(ROOM, { width: -Infinity }, { width: 2.4 }).rejectedBy).toBe('range');
  });

  it('reports "range" for a NaN even while a floor is in force', () => {
    // `NaN < floor` is false, so a cleared field falls through to the static check
    // and keeps the message it had. An `<=` or a negated comparison here would
    // start telling the user a sofa is the reason their empty Height box was
    // refused.
    const r = applyRoomEdits(ROOM, { width: NaN }, { width: 2.4 });
    expect(r.rejected).toBe('width');
    expect(r.rejectedBy).toBe('range');
  });

  it('reports "range" for a value over the maximum, floor or no floor', () => {
    const r = applyRoomEdits(ROOM, { width: 99 }, { width: 2.4 });
    expect(r.rejectedBy).toBe('range');
  });

  it('hands the whole batch back on a floor refusal, exactly as on a range one', () => {
    const r = applyRoomEdits(ROOM, { depth: 2.8, width: 2 }, { width: 2.4 });
    expect(r.rejectedBy).toBe('floor');
    expect(r.pending).toEqual({ depth: 2.8, width: 2 });
  });
});

describe('applyRoomEdits does not hand back its own argument', () => {
  it('returns a copy of the batch, not the object it was given', () => {
    // Aliasing is invisible to every other assertion here, because they all build
    // a fresh `edits` per call. A caller that kept `pending` and added the next
    // keystroke's axis to it would be writing into the rule's argument.
    const edits = { width: 5, height: 99 };
    const { pending } = applyRoomEdits({ width: 4, depth: 3, height: 2.5 }, edits);
    expect(pending).toEqual(edits);
    expect(pending).not.toBe(edits);
    (pending as Record<string, number>).depth = 7;
    expect(edits).toEqual({ width: 5, height: 99 });
  });
});

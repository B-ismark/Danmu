import { describe, it, expect } from 'vitest';
import { applyRoomEdits, clampDims, dimRangeFor, dimsWithinRange, ROOM_AXES, roomAxisRange, type RoomAxis } from '@/lib/dimension-ranges';

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
    // box shape with a known category → category range.
    expect(dimRangeFor('bed', 'box').min[0]).toBeGreaterThan(1000);
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

import { describe, expect, it } from 'vitest';
import { floorRefusal, furnitureFloor, roomFloor, roomFloors } from '@/lib/room-floor';
import { ROOM_SIDE_M } from '@/lib/dimension-ranges';
import type { ScenePart } from '@/lib/scene-spec';

let n = 0;
function part(p: Partial<ScenePart> & Pick<ScenePart, 'dimMM'>): ScenePart {
  return {
    id: `p-${++n}`,
    name: 'Piece',
    category: 'sofa',
    shape: 'sofa',
    pos: [0, 0, 0],
    rot: 0,
    locked: false,
    ...p,
  } as ScenePart;
}

describe('furnitureFloor', () => {
  it('is null for an empty room — there is nothing to stop a shrink', () => {
    expect(furnitureFloor([], 'width')).toBeNull();
    expect(furnitureFloor([], 'depth')).toBeNull();
  });

  it('is the piece measured on the axis asked for, not the other one', () => {
    const sofa = part({ dimMM: [2200, 900, 800], name: 'Sofa' });
    expect(furnitureFloor([sofa], 'width')?.metres).toBeCloseTo(2.2, 9);
    expect(furnitureFloor([sofa], 'depth')?.metres).toBeCloseTo(0.9, 9);
  });

  it('picks the WIDEST piece, whatever order it is in', () => {
    const small = part({ dimMM: [600, 600, 700], name: 'Stool' });
    const big = part({ dimMM: [2400, 800, 800], name: 'Sectional' });
    const mid = part({ dimMM: [1400, 600, 700], name: 'Console' });
    // Both orders: a reduce seeded with `parts[0]` and never compared, or one that
    // keeps the LAST rather than the largest, passes one of these and fails the other.
    expect(furnitureFloor([small, big, mid], 'width')?.name).toBe('Sectional');
    expect(furnitureFloor([big, small, mid], 'width')?.name).toBe('Sectional');
    expect(furnitureFloor([mid, small, big], 'width')?.name).toBe('Sectional');
  });

  it('answers per axis — the widest and the deepest can be different pieces', () => {
    const wide = part({ dimMM: [2400, 500, 800], name: 'Sideboard' });
    const deep = part({ dimMM: [1600, 2000, 600], name: 'Bed' });
    expect(furnitureFloor([wide, deep], 'width')?.name).toBe('Sideboard');
    expect(furnitureFloor([wide, deep], 'depth')?.name).toBe('Bed');
  });

  it('measures the ROTATED extent — a quarter turn swaps the two axes', () => {
    const bed = part({ dimMM: [1600, 2000, 600], rot: Math.PI / 2 });
    expect(furnitureFloor([bed], 'width')?.metres).toBeCloseTo(2.0, 9);
    expect(furnitureFloor([bed], 'depth')?.metres).toBeCloseTo(1.6, 9);
  });

  it('measures the rotated extent at an angle that is not a multiple of 90°', () => {
    // 2000 x 600 at 30°. Asymmetric on purpose: at 45° the two axes come out equal
    // and a swapped (dx, dz) is invisible — the same reason CLAUDE.md gives for
    // verifying anything with a handedness in the non-square case.
    const desk = part({ dimMM: [2000, 600, 750], rot: Math.PI / 6 });
    expect(furnitureFloor([desk], 'width')?.metres).toBeCloseTo(2.032051, 5);
    expect(furnitureFloor([desk], 'depth')?.metres).toBeCloseTo(1.519615, 5);
  });

  it('a ROUND piece needs its diameter, not its bounding box', () => {
    // A 1200 mm round table at 45°: the ellipse answer is 1.200 m, the box answer
    // 1.697 m. Half a metre of room refused for nothing if this reads the box —
    // which is exactly the `footExtentAlong` / `obbExtentAlong` distinction, and the
    // reason this module calls the first.
    const table = part({ dimMM: [1200, 1200, 750], rot: Math.PI / 4, circle: true });
    expect(furnitureFloor([table], 'width')?.metres).toBeCloseTo(1.2, 6);
    expect(furnitureFloor([table], 'depth')?.metres).toBeCloseTo(1.2, 6);
  });

  it('does not care where the piece is standing', () => {
    const here = part({ dimMM: [2200, 900, 800], pos: [0, 0, 0] });
    const there = part({ dimMM: [2200, 900, 800], pos: [12, 0, -40] });
    expect(furnitureFloor([here], 'width')?.metres).toBe(furnitureFloor([there], 'width')?.metres);
  });

  it('counts a rug and a wall-mounted piece — this is NOT floorBlockers', () => {
    // `floorBlockers` (lib/clearance.ts) drops rugs, wall-hung items and anything
    // under 250 mm tall, because it answers "what gets in a walker's way". Reusing
    // it here would let a shrink cut a 3 m rug in half and say nothing. If someone
    // adds that filter, this is the test that goes red.
    const rug = part({ dimMM: [3000, 2000, 10], category: 'rug', shape: 'rug', name: 'Rug' });
    const tv = part({ dimMM: [1500, 80, 900], wallMounted: true, name: 'TV' });
    expect(furnitureFloor([rug], 'width')?.name).toBe('Rug');
    expect(furnitureFloor([tv], 'width')?.name).toBe('TV');
    expect(furnitureFloor([rug, tv], 'width')?.metres).toBeCloseTo(3.0, 9);
  });

  it('names the piece it chose, so the refusal can point at something', () => {
    const big = part({ dimMM: [2400, 800, 800], name: 'Sectional', id: 'sec-1' });
    const got = furnitureFloor([part({ dimMM: [600, 600, 700] }), big], 'width');
    expect(got?.id).toBe('sec-1');
    expect(got?.name).toBe('Sectional');
  });
});

describe('roomFloor', () => {
  it('is the hard floor when the room is empty', () => {
    expect(roomFloor(null, 4)).toBe(ROOM_SIDE_M.min);
  });

  it('is raised by the furniture', () => {
    expect(roomFloor({ metres: 2.4, id: 'a', name: 'A' }, 4)).toBeCloseTo(2.4, 9);
  });

  it('never drops BELOW the hard floor, however small the furniture', () => {
    expect(roomFloor({ metres: 0.4, id: 'a', name: 'A' }, 4)).toBe(ROOM_SIDE_M.min);
  });

  it('never rises ABOVE what the room already is', () => {
    // A 3 m room holding a 4 m piece. Without this clamp the field's `min` sits
    // above its own value, so one press of a chevron grows the room — and a wall
    // drag OUTWARD is refused, blocking the one gesture that could fix it.
    expect(roomFloor({ metres: 4, id: 'a', name: 'A' }, 3)).toBeCloseTo(3, 9);
  });

  it('lets that room grow, and re-tightens as it does', () => {
    const stop = { metres: 4, id: 'a', name: 'A' };
    expect(roomFloor(stop, 3)).toBeCloseTo(3, 9); // frozen, not moved
    expect(roomFloor(stop, 3.5)).toBeCloseTo(3.5, 9); // grew: floor follows
    expect(roomFloor(stop, 4.2)).toBeCloseTo(4, 9); // past the piece: the stop bites
  });
});

describe('roomFloors', () => {
  it('does not answer both axes from one of them', () => {
    const wide = part({ dimMM: [2400, 500, 800], name: 'Sideboard' });
    const deep = part({ dimMM: [1600, 2000, 600], name: 'Bed' });
    const got = roomFloors([wide, deep], { width: 5, depth: 5 });
    expect(got.width.metres).toBeCloseTo(2.4, 9);
    expect(got.depth.metres).toBeCloseTo(2.0, 9);
    expect(got.width.stop?.name).toBe('Sideboard');
    expect(got.depth.stop?.name).toBe('Bed');
  });

  it('applies the current-side clamp per axis, not once for the pair', () => {
    // The piece is bigger than the room on BOTH axes, and the room is a different
    // size on each — so each axis freezes at its own current side. The first
    // version of this used a piece that was small on depth, where `min(0.5, 6)` and
    // `min(0.5, 3)` are both under the hard floor and come out identical: the
    // assertion was real and the fixture could not express the defect. Feeding
    // `current.width` to the depth axis survived it.
    const huge = part({ dimMM: [4000, 3500, 800], name: 'Sectional' });
    const got = roomFloors([huge], { width: 3, depth: 2.5 });
    expect(got.width.metres).toBeCloseTo(3, 9);
    expect(got.depth.metres).toBeCloseTo(2.5, 9);
  });

  it('is the hard floor on both axes for an empty room, and names nothing', () => {
    const got = roomFloors([], { width: 4, depth: 3 });
    expect(got.width.metres).toBe(ROOM_SIDE_M.min);
    expect(got.depth.metres).toBe(ROOM_SIDE_M.min);
    expect(got.width.stop).toBeNull();
  });
});

describe('floorRefusal', () => {
  const STOP = { metres: 2.4, id: 'a', name: 'Sectional' };

  it('names the piece and the size it needs', () => {
    const s = floorRefusal(STOP, 'width', '2.4 m', true);
    expect(s).toContain('Sectional');
    expect(s).toContain('2.4 m');
  });

  it('says narrower for width and shallower for depth', () => {
    expect(floorRefusal(STOP, 'width', '2.4 m', true)).toContain('narrower');
    expect(floorRefusal(STOP, 'depth', '2.4 m', true)).toContain('shallower');
    expect(floorRefusal(STOP, 'width', '2.4 m', true)).not.toContain('shallower');
    expect(floorRefusal(STOP, 'depth', '2.4 m', false)).toContain('shallower');
  });

  it('does not claim a piece that already does not fit "needs" the room it is in', () => {
    // The branch that makes the sentence true. `roomFloor` pins the floor to the
    // current side when the room is already too small, so a message built around
    // the bound would say a 4 m sectional needs 3 m. Both branches name the
    // piece's OWN size; only the clause differs.
    const doesNot = floorRefusal(STOP, 'width', '4.0 m', false);
    expect(doesNot).toContain('already does not fit');
    expect(doesNot).toContain('4.0 m');
    expect(doesNot).not.toContain('needs');
    expect(floorRefusal(STOP, 'width', '2.4 m', true)).not.toContain('already does not fit');
  });
});

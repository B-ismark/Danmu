import { describe, expect, it } from 'vitest';
import { nearestWall, type Footprint } from '@/lib/footprint';
import { ridesWall, wallUnderPress } from '@/lib/menu-target';

// A 6 × 4 room centred on the origin, wound so its signed area is positive:
// wall 0 is the north wall (z = −2), 1 east (x = 3), 2 south (z = 2), 3 west.
const BOX: Footprint = [
  [-3, -2],
  [3, -2],
  [3, 2],
  [-3, 2],
];
// An L: the north-east quadrant cut away. Wall 2 is the notch's inner face.
const L: Footprint = [
  [-3, -2],
  [0, -2],
  [0, 0],
  [3, 0],
  [3, 2],
  [-3, 2],
];

const TV = { category: 'tv', shape: 'tv' } as const;
const DOOR = { category: 'door', shape: 'door' } as const;
const SOFA = { category: 'sofa', shape: 'sofa' } as const;
const FAN = { category: 'fan', shape: 'fan' } as const;

describe('nearestWall', () => {
  it('names the wall, how far along it, and how far off it', () => {
    const w = nearestWall(BOX, 1.5, -1.9)!;
    expect(w.index).toBe(0);
    expect(w.t).toBeCloseTo(0.75, 9);
    expect(w.dist).toBeCloseTo(0.1, 9);
  });

  it('reads t from the wall\'s own start corner, whichever way it runs', () => {
    // The south wall runs east → west, so a point near its EAST end is t ≈ 0.
    const w = nearestWall(BOX, 2.4, 1.95)!;
    expect(w.index).toBe(2);
    expect(w.t).toBeCloseTo(0.1, 9);
  });

  it('clamps t to the wall, so a point past a corner measures to the corner', () => {
    const w = nearestWall(BOX, 3.5, -2.5)!;
    expect([0, 1]).toContain(w.index);
    expect(w.dist).toBeCloseTo(Math.hypot(0.5, 0.5), 9);
    expect(w.t === 1 || w.t === 0).toBe(true);
  });

  it('finds a notch wall in a non-convex room, not the bounding box\'s side', () => {
    // Just inside the notch's inner face: the bounding box would say "north
    // wall, 2 m away"; the room says wall 2, 0.05 m away.
    const w = nearestWall(L, 0.05, -1)!;
    expect(w.index).toBe(1);
    expect(w.dist).toBeCloseTo(0.05, 9);
    const v = nearestWall(L, 1.5, 0.05)!;
    expect(v.index).toBe(2);
    expect(v.t).toBeCloseTo(0.5, 9);
  });

  it('gives a tie to the lower index', () => {
    // Equidistant from the north and east walls.
    expect(nearestWall(BOX, 2, -1)!.index).toBe(0);
  });

  it('has no answer for an outline with no walls', () => {
    expect(nearestWall([[0, 0], [1, 0]], 0, 0)).toBeNull();
  });
});

describe('wallUnderPress', () => {
  // Binary-exact, so an edge case is the edge and not a rounding.
  const BAND = 0.125;

  it('opens the wall for a press anywhere in the band over bare floor', () => {
    expect(wallUnderPress(BOX, 0, -1.875, BAND, null)).toEqual({ index: 0, t: 0.5 });
    expect(wallUnderPress(BOX, 0, -2.125, BAND, null)?.index).toBe(0);
  });

  it('opens the wall beyond the line through a TV hanging there — the reported bug', () => {
    expect(wallUnderPress(BOX, 0, -2.0625, BAND, TV)).toEqual({ index: 0, t: 0.5 });
    expect(wallUnderPress(BOX, 0, -2.0625, BAND, DOOR)?.index).toBe(0);
  });

  it('leaves the TV its own body on the room side — even a hair inside the line', () => {
    // The plan draws a TV straddling the line; its centre measured ~3 mm in.
    expect(wallUnderPress(BOX, 0, -1.997, BAND, TV)).toBeNull();
    expect(wallUnderPress(BOX, 0, -1.9375, BAND, TV)).toBeNull();
  });

  it('leaves the press to a piece that stands in the room, on either side', () => {
    expect(wallUnderPress(BOX, 0, -1.9375, BAND, SOFA)).toBeNull();
    expect(wallUnderPress(BOX, 0, -2.0625, BAND, SOFA)).toBeNull();
  });

  it('leaves the press to a ceiling piece, which rides no wall', () => {
    expect(wallUnderPress(BOX, 0, -2.0625, BAND, FAN)).toBeNull();
  });

  it('is nobody\'s wall outside the band', () => {
    expect(wallUnderPress(BOX, 0, -1.75, BAND, null)).toBeNull();
    expect(wallUnderPress(BOX, 0, -2.25, BAND, TV)).toBeNull();
  });

  it('includes the band\'s edge', () => {
    expect(wallUnderPress(BOX, 0, -2 + BAND, BAND, null)?.index).toBe(0);
    expect(wallUnderPress(BOX, 0, -2 - BAND, BAND, TV)?.index).toBe(0);
  });

  it('reads "outside" from the room, not its bounding box — an L\'s notch', () => {
    // Just beyond the notch's inner face (wall 2, z = 0) is inside the bounding
    // box and outside the room: the wall's side.
    expect(wallUnderPress(L, 1.5, -0.0625, BAND, TV)?.index).toBe(2);
    expect(wallUnderPress(L, 1.5, 0.0625, BAND, TV)).toBeNull();
  });
});

describe('ridesWall', () => {
  it('is true for wall pieces and false for floor and ceiling ones', () => {
    expect(ridesWall('tv', 'tv')).toBe(true);
    expect(ridesWall('door', 'door')).toBe(true);
    expect(ridesWall('other', 'window')).toBe(true);
    expect(ridesWall('sofa', 'sofa')).toBe(false);
    expect(ridesWall('fan', 'fan')).toBe(false);
  });
});

import { describe, it, expect } from 'vitest';
import {
  accessRules,
  accessZones,
  doorPath,
  relationFor,
  roleOf,
  roomProfile,
  routeWidth,
  sharesFloor,
  zoneExempt,
  WALK_MIN,
  WALK_COMFORT,
} from '@/lib/layout-rules';
import { footIntersectionArea, frontVector, pointInFoot } from '@/lib/geometry';
import type { ScenePart } from '@/lib/scene-spec';
import type { Footprint } from '@/lib/footprint';

const RECT: Footprint = [
  [-3, -2],
  [3, -2],
  [3, 2],
  [-3, 2],
];
const TINY: Footprint = [
  [-1.4, -1.2],
  [1.4, -1.2],
  [1.4, 1.2],
  [-1.4, 1.2],
];

let n = 0;
function part(p: Partial<ScenePart> & Pick<ScenePart, 'category' | 'shape' | 'dimMM'>): ScenePart {
  return { id: `${p.category}-${++n}`, name: p.category, rot: 0, locked: false, pos: [0, 0, 0], ...p } as ScenePart;
}

describe('roleOf', () => {
  it('reads the unambiguous shapes straight off', () => {
    expect(roleOf(part({ category: 'sofa', shape: 'sofa', dimMM: [2200, 950, 880] }))).toBe('sofa');
    expect(roleOf(part({ category: 'bed', shape: 'bed-double', dimMM: [1600, 2000, 600] }))).toBe('bed');
    expect(roleOf(part({ category: 'chair', shape: 'chair-office', dimMM: [600, 600, 1000] }))).toBe('office-chair');
    expect(roleOf(part({ category: 'door', shape: 'door', dimMM: [900, 50, 2100] }))).toBe('door');
  });

  it('tells a dining table from a coffee table by its height', () => {
    // The catalog overloads one shape across three pieces of furniture — its
    // 1.8 m six-seater dining table is `shape: 'coffee-table'` — so the shape is
    // not the answer and the size is. A top you can get your knees under is
    // 730–750 mm; a coffee table is 400–450 mm, which is sofa-seat height.
    const coffee = part({ category: 'table', shape: 'coffee-table', dimMM: [1100, 600, 420] });
    const dining = part({ category: 'table', shape: 'coffee-table', dimMM: [1800, 900, 750] });
    expect(roleOf(coffee)).toBe('coffee-table');
    expect(roleOf(dining)).toBe('dining-table');
  });

  it('separates a desk from a dining table by what the room wants, not the top', () => {
    // Both are 750 mm and both are `desk-standard`. `wallAffinity` already decides
    // this by category — a desk wants a wall behind it, a dining table the middle —
    // so the role follows the same call rather than inventing a second one.
    expect(roleOf(part({ category: 'desk', shape: 'desk-standard', dimMM: [1400, 700, 750] }))).toBe('desk');
    expect(roleOf(part({ category: 'table', shape: 'desk-standard', dimMM: [1400, 700, 750] }))).toBe('dining-table');
  });

  it('calls anything small enough a side table whatever its height', () => {
    expect(roleOf(part({ category: 'table', shape: 'coffee-table', dimMM: [450, 450, 550] }))).toBe('side-table');
  });
});

describe('accessZones', () => {
  const wardrobe = () => part({ category: 'wardrobe', shape: 'wardrobe', dimMM: [2000, 600, 2100] });

  it('puts the zone in front of the piece, whichever way it is turned', () => {
    for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2, 0.7]) {
      const [zn] = accessZones(wardrobe(), 0, 0, yaw);
      const [fx, fz] = frontVector(yaw);
      // Its centre sits along the front direction, at half the piece's depth plus
      // half the zone's own.
      const reach = 0.3 + zn.rule.depth / 2;
      expect(zn.foot.cx).toBeCloseTo(fx * reach, 9);
      expect(zn.foot.cz).toBeCloseTo(fz * reach, 9);
      // …and a point just outside the doors is inside it, on every heading.
      expect(pointInFoot(fx * 0.4, fz * 0.4, zn.foot)).toBe(true);
      expect(pointInFoot(-fx * 0.4, -fz * 0.4, zn.foot)).toBe(false);
    }
  });

  it('scales with the piece rather than being a fixed rectangle', () => {
    // The whole of "recalibrate when a size changes": nothing was measured from
    // the old dimensions, so a wider wardrobe asks for a wider zone with no
    // recomputation step anywhere.
    const narrow = accessZones(part({ category: 'wardrobe', shape: 'wardrobe', dimMM: [600, 600, 2100] }), 0, 0, 0)[0];
    const wide = accessZones(part({ category: 'wardrobe', shape: 'wardrobe', dimMM: [2400, 600, 2100] }), 0, 0, 0)[0];
    expect(wide.foot.hw / narrow.foot.hw).toBeCloseTo(4, 6);
    // The DEPTH is what the activity needs and does not scale — a door swings the
    // same 600 mm whether the wardrobe is 600 mm or 2.4 m wide.
    expect(wide.foot.hd).toBeCloseTo(narrow.foot.hd, 9);
  });

  it('a deeper piece pushes its zone further out, not into itself', () => {
    const shallow = accessZones(part({ category: 'shelf', shape: 'bookshelf', dimMM: [900, 300, 1800] }), 0, 0, 0)[0];
    const deep = accessZones(part({ category: 'shelf', shape: 'bookshelf', dimMM: [900, 800, 1800] }), 0, 0, 0)[0];
    expect(deep.foot.cz - shallow.foot.cz).toBeCloseTo(0.25, 9);
  });

  it('asks a double bed for both sides and a single for one', () => {
    const [dbl] = accessRules(part({ category: 'bed', shape: 'bed-double', dimMM: [1600, 2000, 600] }));
    const [sgl] = accessRules(part({ category: 'bed', shape: 'bed-single', dimMM: [900, 2000, 600] }));
    expect(dbl.sides).toEqual(['left', 'right']);
    expect(dbl.atLeast).toBe(2);
    expect(sgl.atLeast).toBe(1);
  });

  it('asks a dining table for three of its four sides', () => {
    const [rule] = accessRules(part({ category: 'table', shape: 'coffee-table', dimMM: [1800, 900, 750] }));
    expect(rule.sides).toHaveLength(4);
    expect(rule.atLeast).toBe(3);
    expect(rule.depth).toBeCloseTo(WALK_COMFORT, 9);
  });

  it('gives a door a swing as deep as its leaf is wide', () => {
    const [rule] = accessRules(part({ category: 'door', shape: 'door', dimMM: [900, 50, 2100] }));
    expect(rule.depth).toBeCloseTo(0.9, 9);
    const [wide] = accessRules(part({ category: 'door', shape: 'door', dimMM: [1400, 50, 2100] }));
    expect(wide.depth).toBeCloseTo(1.4, 9);
  });

  it('measures a window’s zone from its own sill', () => {
    const high = part({ category: 'other', shape: 'window', dimMM: [1200, 60, 600], pos: [0, 2.0, -1.98], wallMounted: true });
    const low = part({ category: 'other', shape: 'window', dimMM: [1200, 60, 1800], pos: [0, 1.3, -1.98], wallMounted: true });
    expect(accessRules(high)[0].aboveY).toBeCloseTo(1.7, 6);
    expect(accessRules(low)[0].aboveY).toBeCloseTo(0.4, 6);
  });
});

describe('zoneExempt', () => {
  it('lets the pieces that belong together share floor', () => {
    expect(zoneExempt('bed', 'nightstand')).toBe(true);
    expect(zoneExempt('sofa', 'coffee-table')).toBe(true);
    expect(zoneExempt('dining-table', 'dining-chair')).toBe(true);
    expect(zoneExempt('desk', 'office-chair')).toBe(true);
  });

  it('and nothing else', () => {
    expect(zoneExempt('bed', 'wardrobe')).toBe(false);
    expect(zoneExempt('door', 'bed')).toBe(false);
    expect(zoneExempt('coffee-table', 'dining-chair')).toBe(false);
  });

  it('is not the same question as sharing floor', () => {
    // The distinction that a random-room test caught the hard way: exempting the
    // zone guests from the OVERLAP term too let the solver bury a nightstand in the
    // mattress and a coffee table in the sofa, and the room report — reading the
    // narrower rule — reported both, correctly.
    expect(zoneExempt('bed', 'nightstand')).toBe(true);
    expect(sharesFloor('bed', 'nightstand')).toBe(false);
    expect(zoneExempt('sofa', 'coffee-table')).toBe(true);
    expect(sharesFloor('sofa', 'coffee-table')).toBe(false);
    // Only seating pushed under a surface genuinely occupies the same square metre.
    expect(sharesFloor('dining-chair', 'dining-table')).toBe(true);
    expect(sharesFloor('dining-table', 'dining-chair')).toBe(true);
    expect(sharesFloor('office-chair', 'desk')).toBe(true);
    expect(sharesFloor('ottoman', 'coffee-table')).toBe(true);
    expect(sharesFloor('wardrobe', 'bed')).toBe(false);
  });
});

describe('routeWidth', () => {
  it('asks a small room for the tight minimum and a big one for comfort', () => {
    // A rule the room cannot satisfy is the same as no rule: in a 6.7 m² box every
    // arrangement fails a 900 mm route equally and the term stops discriminating.
    expect(routeWidth(TINY)).toBeCloseTo(WALK_MIN, 6);
    expect(routeWidth(RECT)).toBeCloseTo(WALK_COMFORT, 6);
  });

  it('never asks for less than the minimum or more than comfort', () => {
    const w = routeWidth([
      [0, 0],
      [3.2, 0],
      [3.2, 3.2],
      [0, 3.2],
    ]);
    expect(w).toBeGreaterThanOrEqual(WALK_MIN);
    expect(w).toBeLessThanOrEqual(WALK_COMFORT);
  });
});

describe('relationFor', () => {
  it('pairs a nightstand with the head of a bed', () => {
    const rel = relationFor(
      part({ category: 'nightstand', shape: 'nightstand', dimMM: [450, 400, 550] }),
      part({ category: 'bed', shape: 'bed-double', dimMM: [1600, 2000, 600] }),
    )!;
    expect(rel.kind).toBe('beside');
    expect(rel.max).toBeLessThan(0.3);
  });

  it('derives a viewing distance from the screen rather than a constant', () => {
    const sofa = part({ category: 'sofa', shape: 'sofa', dimMM: [2200, 950, 880] });
    const small = relationFor(sofa, part({ category: 'tv', shape: 'tv', dimMM: [700, 60, 420], wallMounted: true }))!;
    const big = relationFor(sofa, part({ category: 'tv', shape: 'tv', dimMM: [1650, 60, 950], wallMounted: true }))!;
    expect(small.kind).toBe('faces');
    // 1.2–2.5 × the diagonal, which is the same rule the room report states.
    expect(small.max / small.min).toBeCloseTo(big.max / big.min, 9);
    expect(big.min).toBeGreaterThan(small.max);
  });

  it('has nothing to say about pieces with no functional relationship', () => {
    expect(
      relationFor(
        part({ category: 'wardrobe', shape: 'wardrobe', dimMM: [2000, 600, 2100] }),
        part({ category: 'fridge', shape: 'fridge', dimMM: [600, 600, 1800] }),
      ),
    ).toBeNull();
  });
});

describe('roomProfile', () => {
  it('names the room after what is in it, and finds what it is arranged around', () => {
    const bed = part({ category: 'bed', shape: 'bed-double', dimMM: [1600, 2000, 600] });
    const stand = part({ category: 'nightstand', shape: 'nightstand', dimMM: [450, 400, 550] });
    const p = roomProfile([stand, bed]);
    expect(p.kind).toBe('bedroom');
    expect(p.anchor).toBe(1);
  });

  it('prefers a bed to a sofa when a room has both', () => {
    const parts = [
      part({ category: 'sofa', shape: 'sofa', dimMM: [2200, 950, 880] }),
      part({ category: 'bed', shape: 'bed-double', dimMM: [1600, 2000, 600] }),
    ];
    expect(roomProfile(parts).kind).toBe('bedroom');
  });

  it('collects the openings and the things worth facing', () => {
    const parts = [
      part({ category: 'door', shape: 'door', dimMM: [900, 50, 2100], wallMounted: true }),
      part({ category: 'tv', shape: 'tv', dimMM: [1450, 60, 820], wallMounted: true }),
      part({ category: 'other', shape: 'window', dimMM: [1200, 60, 1400], wallMounted: true }),
    ];
    const p = roomProfile(parts);
    expect(p.apertures).toEqual([0, 2]);
    expect(p.focals).toEqual([1]);
  });
});

describe('doorPath', () => {
  it('runs into the room from the doorway, at least as wide as the leaf', () => {
    const door = part({ category: 'door', shape: 'door', dimMM: [900, 50, 2100], pos: [0, 1.05, -1.98] });
    const narrow = doorPath(door, 0.6);
    expect(narrow.hw * 2).toBeCloseTo(0.9, 9); // the leaf wins over the route width
    expect(doorPath(door, 1.2).hw * 2).toBeCloseTo(1.2, 9);
    // Into the room, i.e. along the door's front.
    expect(narrow.cz).toBeGreaterThan(door.pos[2]);
  });

  it('turns with the wall it is on', () => {
    const door = part({ category: 'door', shape: 'door', dimMM: [900, 50, 2100], pos: [2.98, 1.05, 0], rot: -Math.PI / 2 });
    const path = doorPath(door, 0.9);
    // East wall: the inward normal is −x, so the path reaches back toward the middle.
    expect(path.cx).toBeLessThan(door.pos[0]);
    expect(path.cz).toBeCloseTo(0, 6);
  });

  it('overlaps a piece parked in the doorway and not one out of the way', () => {
    const door = part({ category: 'door', shape: 'door', dimMM: [900, 50, 2100], pos: [0, 1.05, -1.98] });
    const path = doorPath(door, 0.9);
    const bed = (cz: number) => ({ cx: 0, cz, hw: 0.8, hd: 1, rot: 0 });
    expect(footIntersectionArea(path, bed(-1))).toBeGreaterThan(0);
    expect(footIntersectionArea(path, bed(1.5))).toBe(0);
    // One rule spread over two sides is two zones — the rule is what `atLeast`
    // counts, the zones are what the geometry tests.
    expect(accessZones(part({ category: 'bed', shape: 'bed-double', dimMM: [1600, 2000, 600] }), 0, -1, 0)).toHaveLength(2);
  });
});

import { describe, expect, it } from 'vitest';
import { backWall, baySides, insetBay, roomBays, splitBay, type Bay } from '../lib/room-bays';
import { footprintForLayout, offsetWall, type Footprint } from '../lib/footprint';
import { outsideShare, pointInPoly, polygonArea } from '../lib/geometry';

/** A bay as a footprint the containment test understands. */
const asFoot = (b: Bay) => ({ cx: b.cx, cz: b.cz, hw: b.width / 2, hd: b.depth / 2, rot: 0 });

/** Every returned bay has to be floor that exists — this is the whole point of the
 *  module, and the bug it replaces was a rectangle that spanned an L's missing
 *  quadrant. Tested with the sampled containment share the rest of the engine uses,
 *  not with the module's own internals. */
function allInside(bays: Bay[], poly: Footprint): boolean {
  return bays.every((b) => outsideShare(asFoot(insetBay(b, 0.01)), poly, 9) === 0);
}

describe('roomBays', () => {
  it('gives a rectangle one bay: the whole room', () => {
    const poly = footprintForLayout('rect', 6, 4);
    const bays = roomBays(poly);
    expect(bays).toHaveLength(1);
    expect(bays[0].width).toBeCloseTo(6);
    expect(bays[0].depth).toBeCloseTo(4);
  });

  it('splits an L into a leg and a wing, neither in the void', () => {
    const poly = footprintForLayout('l', 6, 4.7);
    const bays = roomBays(poly);
    expect(bays.length).toBe(2);
    expect(allInside(bays, poly)).toBe(true);
    // Between them they account for most of the floor — a decomposition that found
    // one bay and stopped would pass the containment test and be useless.
    const covered = bays.reduce((s, b) => s + b.area, 0);
    expect(covered).toBeGreaterThan(polygonArea(poly) * 0.9);
  });

  it('refuses a rectangle that spans the notch of a U', () => {
    const poly = footprintForLayout('u', 6, 5);
    const bays = roomBays(poly);
    expect(allInside(bays, poly)).toBe(true);
    // The bounding box is 30 m²; the room is 21.6. No bay may claim the difference.
    expect(bays[0].area).toBeLessThan(polygonArea(poly));
  });

  it('handles a T, and an off-centre room made by dragging one wall', () => {
    for (const poly of [footprintForLayout('t', 5.5, 4.7), offsetWall(footprintForLayout('rect', 5, 4), 1, 2.5)]) {
      const bays = roomBays(poly);
      expect(bays.length).toBeGreaterThan(0);
      expect(allInside(bays, poly)).toBe(true);
    }
  });

  it('returns largest first, and nothing below the floor it was asked for', () => {
    const bays = roomBays(footprintForLayout('l', 6, 4.7), { minArea: 8 });
    expect(bays).toHaveLength(1); // the 6.9 m² wing is under the bar
    for (let i = 1; i < bays.length; i++) expect(bays[i - 1].area).toBeGreaterThanOrEqual(bays[i].area);
  });

  it('says nothing about a degenerate footprint', () => {
    expect(roomBays([[0, 0], [1, 0]] as Footprint)).toEqual([]);
  });
});

describe('baySides / backWall', () => {
  it('knows which sides of a bay are real walls', () => {
    const poly = footprintForLayout('l', 6, 4.7);
    const [leg] = roomBays(poly);
    const sides = baySides(leg, poly);
    expect(sides).toHaveLength(4);
    // The leg of this L is the north band: N, E and W are the room's own walls, and
    // its south side is the open edge onto the wing. A cluster backed against THAT
    // is a sofa in the middle of the room facing nothing, which is why the flag
    // exists.
    expect(sides.filter((s) => s.onWall)).toHaveLength(3);
    const open = sides.find((s) => !s.onWall)!;
    expect(open.nz).toBeLessThan(0); // faces north, i.e. it is the southern edge
  });

  it('faces a part into the room from the wall it picks', () => {
    const poly = footprintForLayout('rect', 6, 4);
    const [bay] = roomBays(poly);
    const wall = backWall(baySides(bay, poly))!;
    expect(wall.onWall).toBe(true);
    // Front (local +Z) is (sin yaw, cos yaw) — the one rotation convention.
    expect(Math.sin(wall.yaw)).toBeCloseTo(wall.nx);
    expect(Math.cos(wall.yaw)).toBeCloseTo(wall.nz);
  });

  it('prefers the wall with room to back away from it', () => {
    // 6 × 4: the long north wall gives 4 m of depth, the short east wall 6 m of
    // depth but only 4 m of wall. A television wants the depth AND the wall, and the
    // north wall is the arrangement everyone actually builds.
    const poly = footprintForLayout('rect', 6, 4);
    const [bay] = roomBays(poly);
    const wall = backWall(baySides(bay, poly))!;
    expect(wall.length).toBeCloseTo(6);
  });

  it('has no wall to offer a bay cut out of open floor', () => {
    const poly = footprintForLayout('rect', 8, 6);
    const [bay] = roomBays(poly);
    const [west] = splitBay(bay);
    const sides = baySides(west, poly);
    expect(sides.filter((s) => s.onWall)).toHaveLength(3);
    expect(backWall(sides)).not.toBeNull();
  });
});

describe('splitBay', () => {
  it('halves the longer axis and keeps the whole area', () => {
    const [bay] = roomBays(footprintForLayout('rect', 8, 4));
    const [a, b] = splitBay(bay);
    expect(a.width).toBeCloseTo(4);
    expect(b.width).toBeCloseTo(4);
    expect(a.area + b.area).toBeCloseTo(bay.area);
  });
});

describe('sideOnWall', () => {
  // `onWall` decides where furniture puts its back. It used to be five probes and
  // `distToBoundary`, which is wrong in two ways that compound: the probes leave
  // gaps, and the distance is to the NEAREST edge in ANY direction, so a probe
  // standing in the mouth of a notch is millimetres from the notch's own side walls
  // and passes. Both cases below reported `onWall: true` before.

  /** 6 x 4, with a 1.2 m x 0.5 m alcove in the north wall, placed so that the old
   *  probes at x = 0.24, 1.62, 3, 4.38, 5.76 all miss it. */
  const NOTCHED: Footprint = [
    [0, 0],
    [0.33, 0],
    [0.33, -0.5],
    [1.53, -0.5],
    [1.53, 0],
    [6, 0],
    [6, 4],
    [0, 4],
  ];

  it('refuses a side with a hole in it, however the probes fall', () => {
    const bay = roomBays(NOTCHED)[0];
    // The main bay is the full 6 x 4 — the alcove is extra floor beyond it.
    expect(bay.area).toBeCloseTo(24);
    const [north, east, south, west] = baySides(bay, NOTCHED);
    // 1.2 m of this side's 6 m is the open mouth of the alcove, not wall.
    expect(north.onWall).toBe(false);
    // …and the three sides that are unbroken wall still are.
    expect(east.onWall).toBe(true);
    expect(south.onWall).toBe(true);
    expect(west.onWall).toBe(true);
  });

  it('does not offer a holed side as somewhere to put a sofa’s back', () => {
    const bay = roomBays(NOTCHED)[0];
    const back = backWall(baySides(bay, NOTCHED));
    expect(back).not.toBeNull();
    // The north side is the one with the most depth in front of it, so it would have
    // won on score. It has to lose on being a wall.
    expect(back!.mz).not.toBeCloseTo(0);
  });

  it('claims a side only when stepping out across it leaves the room', () => {
    // The property `backWall` actually depends on, checked independently of how
    // `sideOnWall` decides it: if a side is wall along its whole length, then a point
    // just OUTSIDE it is outside the room at every point along it. Where a side
    // crosses open floor — the U bar's north edge over the legs, the L's inner
    // corner — the outward probe lands back inside, and the side must not be claimed.
    for (const layout of ['rect', 'l', 't', 'u'] as const) {
      const poly = footprintForLayout(layout, 6, 4.7);
      for (const bay of roomBays(poly)) {
        for (const s of baySides(bay, poly)) {
          if (!s.onWall) continue;
          for (let i = 0; i <= 20; i++) {
            const u = ((i / 20) * 2 - 1) * (s.length / 2) * 0.98;
            // Along the side is perpendicular to its inward normal.
            const px = s.mx - s.nz * u;
            const pz = s.mz + s.nx * u;
            // 50 mm out — beyond WALL_TOL, so a wall within tolerance still counts.
            const outside = pointInPoly(px - s.nx * 0.05, pz - s.nz * 0.05, poly);
            expect(outside, `${layout}: side at (${s.mx},${s.mz}) claims wall at u=${u.toFixed(2)}`).toBe(false);
          }
        }
      }
    }
  });

  it('still recognises a plain rectangle’s four walls', () => {
    const poly = footprintForLayout('rect', 6, 4);
    const bay = roomBays(poly)[0];
    expect(baySides(bay, poly).every((s) => s.onWall)).toBe(true);
  });
});

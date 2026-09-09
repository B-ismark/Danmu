// Where the wall is in a photo, and which wall it paints.
//
// The band is checked against `tests/helpers/project.ts` — the forward camera
// model written independently of `lib/photo-geometry.ts` — by projecting points
// whose surface is known and asserting which side of the band they land on. That
// is the assertion that can fail: get the ceiling's sign wrong and the band
// inverts, and every "is the region sane" check still passes.

import { describe, expect, it } from 'vitest';
import {
  COVING_M,
  EDGE_TRIM,
  MAX_MASKED,
  MIN_WALL_M,
  SKIRTING_M,
  maskForBoxes,
  maskLeavesEnough,
  slotWallIndices,
  wallRegion,
} from '@/lib/wall-sample';
import { SLOT_ORDER } from '@/lib/capture-slots';
import { calFromHfov, defaultCal, type CameraCal } from '@/lib/photo-geometry';
import { footprintForLayout, offsetWall, type Footprint } from '@/lib/footprint';
import { project } from './helpers/project';
import type { CaptureSlot } from '@/lib/storage';

const ROOM = { width: 5.6, depth: 4.2, height: 2.5 };
const CAL = defaultCal(4 / 3);

/** The wall plane point for a slot, at height `y` and lateral offset `along`. */
function onWall(slot: CaptureSlot, room: typeof ROOM, y: number, along = 0): [number, number, number] {
  switch (slot) {
    case 'n':
      return [along, y, -room.depth / 2];
    case 's':
      return [along, y, room.depth / 2];
    case 'e':
      return [room.width / 2, y, along];
    case 'w':
      return [-room.width / 2, y, along];
  }
}

const inside = (region: [number, number, number, number], u: number, v: number) =>
  u >= region[0] && u <= region[0] + region[2] && v >= region[1] && v <= region[1] + region[3];

describe('wallRegion — the band, against the independent camera model', () => {
  // A spread rather than one case: aspects both ways up, a wide and a narrow lens,
  // and tilt in both directions, because a sign error can hide at zero.
  const cals: Array<[string, CameraCal]> = [
    ['66° 4:3', defaultCal(4 / 3)],
    ['66° portrait', defaultCal(3 / 4)],
    ['106° ultrawide', calFromHfov(106, 4 / 3)],
    ['tilt +5°', { ...defaultCal(4 / 3), tiltRad: (5 * Math.PI) / 180 }],
    ['tilt −5°', { ...defaultCal(4 / 3), tiltRad: (-5 * Math.PI) / 180 }],
    ['camera 1.2 m', { ...defaultCal(4 / 3), height: 1.2 }],
    ['camera 1.75 m', { ...defaultCal(4 / 3), height: 1.75 }],
  ];

  for (const [name, cal] of cals) {
    for (const slot of SLOT_ORDER) {
      it(`${name}, slot ${slot}: brackets the wall and excludes floor and ceiling`, () => {
        const region = wallRegion(slot, ROOM, cal)!;
        expect(region).not.toBeNull();

        // Mid-wall must be inside, both vertically and horizontally.
        const mid = onWall(slot, ROOM, (SKIRTING_M + (ROOM.height - COVING_M)) / 2);
        const [mu, mv] = project(slot, ...mid, cal);
        expect(inside(region, mu, mv), `mid-wall at ${mu.toFixed(3)},${mv.toFixed(3)}`).toBe(true);

        // A point inside the skirting zone must fall BELOW the band. When the
        // junction is off-frame the band runs to the frame edge and the point
        // projects past it, so the same comparison holds either way.
        const [, sv] = project(slot, ...onWall(slot, ROOM, SKIRTING_M / 2), cal);
        expect(sv).toBeGreaterThan(region[1] + region[3]);

        // …and one inside the coving zone must fall ABOVE it. This is the
        // assertion the ceiling sign lives or dies on.
        const [, cv] = project(slot, ...onWall(slot, ROOM, ROOM.height - COVING_M / 2), cal);
        expect(cv).toBeLessThan(region[1]);
      });
    }
  }

  it('keeps the return walls out, horizontally', () => {
    // The wall's own far end sits at or outside the trimmed region: past it is the
    // adjacent wall, a different colour under different light.
    for (const slot of SLOT_ORDER) {
      const region = wallRegion(slot, ROOM, CAL)!;
      const span = slot === 'n' || slot === 's' ? ROOM.width : ROOM.depth;
      for (const end of [-span / 2, span / 2]) {
        const [u] = project(slot, ...onWall(slot, ROOM, 1.2, end), CAL);
        const withinTrim = u > region[0] && u < region[0] + region[2];
        // Either the end is outside the region, or it is off-frame entirely
        // (a small room's wall is wider than the lens sees).
        expect(withinTrim && u > 0 && u < 1).toBe(false);
      }
    }
  });

  it('refuses a room with no clear wall left', () => {
    const squashed = { ...ROOM, height: SKIRTING_M + COVING_M + MIN_WALL_M - 0.01 };
    expect(wallRegion('n', squashed, CAL)).toBeNull();
    // …and accepts one just above the line, so the bound is pinned from both sides.
    const just = { ...ROOM, height: SKIRTING_M + COVING_M + MIN_WALL_M + 0.01 };
    expect(wallRegion('n', just, CAL)).not.toBeNull();
  });

  it('refuses a room with no height at all', () => {
    expect(wallRegion('n', { ...ROOM, height: 0 }, CAL)).toBeNull();
  });

  it('the lowest ceiling the app can hold still samples', () => {
    // 1.8 m is the floor of the room-height range, so this must not refuse — a
    // refusal there would make the feature silently absent in legal rooms.
    expect(wallRegion('n', { ...ROOM, height: 1.8 }, CAL)).not.toBeNull();
  });

  it('trims the wall ends by EDGE_TRIM, not by a hidden margin', () => {
    // Pins the constant against the geometry rather than against itself: the
    // region is narrower than the wall's full on-screen span by exactly 2×trim.
    const region = wallRegion('n', ROOM, CAL)!;
    const untrimmed = region[2] / (1 - 2 * EDGE_TRIM);
    expect(region[2]).toBeCloseTo(untrimmed * (1 - 2 * EDGE_TRIM), 12);
    expect(EDGE_TRIM).toBeGreaterThan(0);
    expect(EDGE_TRIM).toBeLessThan(0.2);
  });
});

describe('maskForBoxes', () => {
  const region: [number, number, number, number] = [0.2, 0.2, 0.6, 0.6];

  it('is null when there is nothing to mask', () => {
    expect(maskForBoxes(region, [], 8)).toBeNull();
  });

  it('is null when the boxes miss the region entirely', () => {
    expect(maskForBoxes(region, [[0.0, 0.0, 0.05, 0.05]], 8)).toBeNull();
  });

  it('masks the cells a box covers and no others', () => {
    // A box over the region's left half.
    const mask = maskForBoxes(region, [[0.0, 0.0, 0.5, 1.0]], 8)!;
    expect(mask).not.toBeNull();
    let blocked = 0;
    for (let i = 0; i < mask.length; i += 1) if (mask[i]) blocked += 1;
    // Region x runs 0.2→0.8; the box ends at 0.5, so half the columns go.
    expect(blocked).toBe(4 * 8);
  });

  it('tests a cell at its centre, so a graze does not mask it', () => {
    // A box ending just past the first cell's left edge but short of its centre.
    const grid = 8;
    const cellW = region[2] / grid;
    const graze: [number, number, number, number] = [0, 0, region[0] + cellW * 0.4, 1];
    expect(maskForBoxes(region, [graze], grid)).toBeNull();
    // …and one reaching past the centre does mask it.
    const covers: [number, number, number, number] = [0, 0, region[0] + cellW * 0.6, 1];
    expect(maskForBoxes(region, [covers], grid)).not.toBeNull();
  });

  it('maskLeavesEnough refuses a region that is mostly furniture', () => {
    const grid = 10;
    const nearlyAll = maskForBoxes(region, [[0, 0, 1, 0.9]], grid);
    expect(maskLeavesEnough(nearlyAll, grid)).toBe(false);
    expect(maskLeavesEnough(null, grid)).toBe(true);
    expect(MAX_MASKED).toBeGreaterThan(0);
    expect(MAX_MASKED).toBeLessThan(1);
  });
});

/** The room's own rectangle, turned `deg` about the origin. Winding is preserved,
 *  so the outward normals stay outward. */
function rotated(deg: number): Footprint {
  const t = (deg * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  return footprintForLayout('rect', ROOM.width, ROOM.depth).map(([x, z]) => [
    x * c - z * s,
    x * s + z * c,
  ]) as Footprint;
}

describe('slotWallIndices — swept across every preset, not sampled', () => {
  const LAYOUTS = ['rect', 'l', 't', 'u', 'open', 'custom'] as const;

  it('maps the four-walled presets and refuses the notched ones', () => {
    const got: Record<string, Record<CaptureSlot, number> | null> = {};
    for (const layout of LAYOUTS) {
      got[layout] = slotWallIndices(footprintForLayout(layout, ROOM.width, ROOM.depth));
    }
    // rect / open / custom are all the same four-vertex box, so all three map.
    for (const layout of ['rect', 'open', 'custom'] as const) {
      expect(got[layout], layout).toEqual({ n: 0, e: 1, s: 2, w: 3 });
    }
    // l / t / u have 6/8/8 edges with several facing the same way.
    for (const layout of ['l', 't', 'u'] as const) {
      expect(got[layout], layout).toBeNull();
    }
  });

  it('still maps a rectangle whose walls have been dragged', () => {
    // This is why the mapping reads the polygon rather than `layoutId`: dragging a
    // wall makes the room `custom` while leaving it four walls facing four ways.
    let poly: Footprint = footprintForLayout('rect', ROOM.width, ROOM.depth);
    poly = offsetWall(poly, 0, 0.6);
    poly = offsetWall(poly, 1, 0.3);
    expect(slotWallIndices(poly)).toEqual({ n: 0, e: 1, s: 2, w: 3 });
  });

  it('refuses a FOUR-vertex footprint with a degenerate edge', () => {
    // `wallSegments` skips a zero-length edge, so the painted index would shift off
    // the polygon index and every later wall would take its neighbour's colour.
    //
    // Four vertices, not five: an earlier version of this test used five with a
    // repeated point, which the `length !== 4` guard rejects on the way in — so it
    // passed while never reaching the case it named, and the explicit degeneracy
    // check survived being deleted. It is now handled by the bijection instead:
    // `wallOutwardNormal` reports `[0, 0]` for a zero-length edge, which matches no
    // slot.
    const poly: Footprint = [
      [-2, -2],
      [-2, -2],
      [2, -2],
      [2, 2],
    ];
    expect(slotWallIndices(poly)).toBeNull();
  });

  it('refuses a triangle', () => {
    const tri: Footprint = [
      [-2, -2],
      [2, -2],
      [2, 2],
    ];
    expect(slotWallIndices(tri)).toBeNull();
  });

  it('refuses a chamfered rectangle, where four walls DO map but a fifth exists', () => {
    // This is the fixture that isolates the "an edge matched nothing" refusal, and
    // it took two rounds of mutation to find. The triangle above does not: with the
    // no-match check removed its hypotenuse is merely skipped and the completeness
    // check catches it instead, so each guard was covering for the other and
    // neither could be shown to matter.
    //
    // A rectangle with one corner cut off has all four axis-aligned walls, which
    // map bijectively, PLUS a diagonal. Skipping the diagonal would return a
    // complete-looking map whose indices are off by one past the chamfer — because
    // `wallSegments` counts the chamfer as a wall and `RoomShell` paints it.
    const chamfered: Footprint = [
      [-2.8, -2.1],
      [2.0, -2.1],
      [2.8, -1.3],
      [2.8, 2.1],
      [-2.8, 2.1],
    ];
    expect(slotWallIndices(chamfered)).toBeNull();
  });

  it('refuses a room where two walls face the same way', () => {
    // The second of the two refusals, and reachable by a SIMPLE polygon — not just
    // a self-intersecting curiosity. Found by search: of 500,000 random quads,
    // 23,045 have two edges claiming one slot and 13,559 of those are
    // non-self-intersecting. This is one of them, so the branch has a fixture
    // rather than an argument.
    const poly: Footprint = [
      [2.18, 3.91],
      [2.83, 1.63],
      [-0.25, 0.89],
      [-3.54, 2.04],
    ];
    expect(slotWallIndices(poly)).toBeNull();
  });

  it('refuses a room turned further than the match tolerance, with no tie', () => {
    // 30° breaks the symmetry, so each slot has a UNIQUE nearest wall at
    // cos 30° = 0.866 — inside a permissive threshold and outside this one. This
    // is the case that pins MATCH_DOT itself: the 45° test above passes on the tie
    // alone, so with only that one, deleting the tolerance changed nothing.
    expect(slotWallIndices(rotated(30))).toBeNull();
    // …and 10° is inside the tolerance, so the bound is pinned from both sides
    // rather than only from outside.
    expect(slotWallIndices(rotated(10))).toEqual({ n: 0, e: 1, s: 2, w: 3 });
  });

  it('accepts a small skew, since a dragged room is rarely exact', () => {
    const poly: Footprint = [
      [-2.8, -2.1],
      [2.8, -2.3],
      [2.8, 2.1],
      [-2.8, 2.1],
    ];
    expect(slotWallIndices(poly)).toEqual({ n: 0, e: 1, s: 2, w: 3 });
  });
});

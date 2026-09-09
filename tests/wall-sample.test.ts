// Where the wall is in a photo, and which wall it paints.
//
// The band is checked against `tests/helpers/project.ts` — the forward camera
// model written independently of `lib/photo-geometry.ts` — by projecting points
// whose surface is known and asserting which side of the band they land on. That
// is the assertion that can fail: get the ceiling's sign wrong and the band
// inverts, and every "is the region sane" check still passes.

import { describe, expect, it } from 'vitest';
import {
  wallColorProposal,
  bandCal,
  COVING_M,
  EDGE_TRIM,
  MAX_MASKED,
  MIN_BAND_FRAC,
  MIN_WALL_M,
  SKIRTING_M,
  WIDEST_HFOV_DEG,
  maskForBoxes,
  maskLeavesEnough,
  slotWallIndices,
  wallRegion,
} from '@/lib/wall-sample';
import { SLOT_ORDER } from '@/lib/capture-slots';
import {
  calFromHfov,
  defaultCal,
  wallColumnsAtHeight,
  wallDistance,
  wallFrame,
  wallRowAtHeight,
  wallSpan,
  type CameraCal,
  type WallFrame,
} from '@/lib/photo-geometry';
import { footprintForLayout, offsetWall, type Footprint } from '@/lib/footprint';
import { ALONG, project } from './helpers/project';
import type { CaptureSlot } from '@/lib/storage';

const ROOM = { width: 5.6, depth: 4.2, height: 2.5 };
const RECT = footprintForLayout('rect', ROOM.width, ROOM.depth);
const CAL = defaultCal(4 / 3);

/** A point on the framed wall of ANY footprint, at lateral offset `t` along the
 *  image's own left-to-right axis. `ALONG` is that axis; the view axis is it turned
 *  a quarter turn — (x, z) → (z, −x) — which reads off the rig's four slots: image
 *  right +X looks −Z (n), right +Z looks +X (e), and so on round.
 *
 *  The centred-room helper below stays hand-written per slot and the two are
 *  asserted to agree, because this one is the only way to reach an OFF-CENTRE room
 *  and that is where the ±width/2 defect lives. */
function wallPoint(slot: CaptureSlot, wall: WallFrame, t: number, y: number): [number, number, number] {
  const [ax, az] = ALONG[slot];
  return [ax * t + az * wall.distance, y, az * t - ax * wall.distance];
}

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

describe('wallFrame — the footprint\'s bounds, not ±width/2', () => {
  it('agrees with the ±half pair for a room that IS centred', () => {
    // The bridge assertion: as long as the footprint is centred on the origin the
    // honest version and the pair the placers use are the same number, which is why
    // nothing noticed for as long as no wall had been dragged.
    for (const slot of SLOT_ORDER) {
      const frame = wallFrame(slot, RECT)!;
      expect(frame.distance).toBeCloseTo(wallDistance(slot, ROOM), 12);
      expect(frame.right - frame.left).toBeCloseTo(wallSpan(slot, ROOM), 12);
      expect(frame.left).toBeCloseTo(-frame.right, 12);
    }
  });

  it('goes off-centre with the room, in the lens\'s own axes', () => {
    // `scene-store.ts`'s `moveWall` contract: width/depth are re-derived from the
    // new bounding box and every downstream consumer reads BOUNDS. Drag the east
    // wall out a metre and the north wall's midpoint is no longer in front of the
    // camera — ±width/2 says it still is.
    const poly = offsetWall(RECT, 1, 1);
    const n = wallFrame('n', poly)!;
    expect(n.distance).toBeCloseTo(ROOM.depth / 2, 12);
    expect(n.left).toBeCloseTo(-ROOM.width / 2, 12);
    expect(n.right).toBeCloseTo(ROOM.width / 2 + 1, 12);
    // …and the wall the drag moved is a metre further away, which ±width/2 splits
    // between the two sides instead.
    expect(wallFrame('e', poly)!.distance).toBeCloseTo(ROOM.width / 2 + 1, 12);
    expect(wallFrame('w', poly)!.distance).toBeCloseTo(ROOM.width / 2, 12);
  });

  it('refuses a footprint the camera is not standing in', () => {
    // The rig's premise is a camera at the world origin. A polygon that does not
    // contain it describes a room photographed from outside, where `distance` goes
    // negative and every projection is a mirror image of the truth.
    const pushed = RECT.map(([x, z]) => [x + 10, z]) as Footprint;
    expect(wallFrame('w', pushed)).toBeNull();
    const behind = RECT.map(([x, z]) => [x, z + 10]) as Footprint;
    expect(wallFrame('n', behind)).toBeNull();
    // The other half of the same premise, and it needs its own case: for the north
    // wall of a room pushed EAST the distance is perfectly positive — that wall is
    // still 2.1 m ahead — and what is wrong is that the whole of it lies to one
    // side of the lens. Without this, the lateral half of the guard is untestable
    // and mutating it away changes nothing.
    expect(wallFrame('n', pushed)).toBeNull();
    // …while the wall the shift did not move laterally is still measurable, so the
    // refusal is not "anything shifted".
    expect(wallFrame('e', pushed)).not.toBeNull();
  });

  it('refuses non-finite dimensions and a degenerate polygon', () => {
    // `lib/dimension-ranges.ts` documents NaN as a live hazard on this path, and a
    // NaN bound reaches every comparison below as `false` — so the band came back
    // as the confident whole frame.
    expect(wallFrame('n', [[NaN, -2], [2, -2], [2, 2], [-2, 2]])).toBeNull();
    expect(wallFrame('n', [[-2, -2], [2, Infinity], [2, 2], [-2, 2]])).toBeNull();
    expect(wallFrame('n', [[-2, -2], [2, 2]])).toBeNull();
  });
});

describe('wallRowAtHeight / wallColumnsAtHeight — against the independent camera model', () => {
  /** A rectangle with two walls dragged, so it is asymmetric on BOTH axes. A
   *  centred room cannot tell `left`/`right` from `−right`/`−left`, which is how a
   *  swapped lateral axis on the s and w slots survived a first mutation round. */
  const SKEWED = offsetWall(offsetWall(RECT, 1, 1), 0, 0.8);

  it('names the framed wall\'s own two corners, in image order', () => {
    // `wallColumnsAtHeight` divides `wall.left` and `wall.right` by the forward
    // distance, and the test above projects the same two numbers through the
    // forward model — so the two agree whatever those numbers are. This is the
    // assertion that says they are the RIGHT two: each end must be a corner of the
    // framed wall, and `left` must be the one that lands on the image's left.
    const xs = SKEWED.map(([x]) => x);
    const zs = SKEWED.map(([, z]) => z);
    const b = { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
    const corners: Record<CaptureSlot, Array<[number, number]>> = {
      n: [[b.minX, b.minZ], [b.maxX, b.minZ]],
      s: [[b.minX, b.maxZ], [b.maxX, b.maxZ]],
      e: [[b.maxX, b.minZ], [b.maxX, b.maxZ]],
      w: [[b.minX, b.minZ], [b.minX, b.maxZ]],
    };
    for (const slot of SLOT_ORDER) {
      const wall = wallFrame(slot, SKEWED)!;
      const ends = [wall.left, wall.right].map((t) => {
        const [x, , z] = wallPoint(slot, wall, t, 0);
        return [x, z] as [number, number];
      });
      const key = (p: [number, number]) => `${p[0].toFixed(6)},${p[1].toFixed(6)}`;
      expect(ends.map(key).sort(), slot).toEqual(corners[slot].map(key).sort());
      const [lu] = project(slot, ...wallPoint(slot, wall, wall.left, 1), CAL);
      const [ru] = project(slot, ...wallPoint(slot, wall, wall.right, 1), CAL);
      expect(lu, `${slot} left`).toBeLessThan(ru);
    }
  });

  const cals: Array<[string, CameraCal]> = [
    ['66° 4:3', defaultCal(4 / 3)],
    ['106° portrait', calFromHfov(106, 3 / 4)],
    ['tilt +12°', { ...defaultCal(4 / 3), tiltRad: (12 * Math.PI) / 180 }],
    ['tilt −12°', { ...defaultCal(4 / 3), tiltRad: (-12 * Math.PI) / 180 }],
    ['camera 1.2 m', { ...defaultCal(4 / 3), height: 1.2 }],
  ];

  for (const [name, cal] of cals) {
    it(`${name}: both projections match the forward model, on and off frame`, () => {
      for (const [poly, slot] of SLOT_ORDER.flatMap(
        (slot) => [[RECT, slot], [SKEWED, slot]] as Array<[Footprint, CaptureSlot]>,
      )) {
        const wall = wallFrame(slot, poly)!;
        for (const y of [0, 0.18, 1.2, 2.28, 2.5]) {
          const [, v] = project(slot, ...wallPoint(slot, wall, 0, y), cal);
          expect(wallRowAtHeight(y, wall.distance, cal), `${slot} y=${y}`).toBeCloseTo(v, 12);
          const cols = wallColumnsAtHeight(y, wall, cal)!;
          const [lu] = project(slot, ...wallPoint(slot, wall, wall.left, y), cal);
          const [ru] = project(slot, ...wallPoint(slot, wall, wall.right, y), cal);
          expect(cols.left, `${slot} left y=${y}`).toBeCloseTo(lu, 12);
          expect(cols.right, `${slot} right y=${y}`).toBeCloseTo(ru, 12);
          // `right` must land on the image's RIGHT, per `project`'s own slot
          // switch. This is the assertion the lateral sign lives on: swap the two
          // and a centred room notices nothing, while an off-centre one paints the
          // wall opposite the one it sampled.
          expect(ru, `${slot} right of left y=${y}`).toBeGreaterThan(lu);
          expect(ru, `${slot} right of centre y=${y}`).toBeGreaterThan(0.5);
        }
      }
    });
  }

  it('returns the row UNCLAMPED, which is the whole point of the contract', () => {
    // The docstring's own example: a level camera 1.5 m up, 2.8 m from the wall, on
    // a 66° lens must look down 28.2° to see the wall-floor junction while its frame
    // reaches 26°. The junction is real and it is below the picture.
    const v = wallRowAtHeight(0, 2.8, defaultCal(4 / 3))!;
    expect(v).toBeGreaterThan(1);
    // …and a ceiling junction can leave by the top the same way.
    const up = wallRowAtHeight(2.5, 1.2, defaultCal(4 / 3))!;
    expect(up).toBeLessThan(0);
    // This is the information the first version threw away by returning null for
    // both: `0.5 − b·aspect/k` is a signed row, and which side of the frame it is
    // on is the only thing that tells a caller whether its band is empty.
  });

  it('refuses a row level with or behind the lens rather than mirroring it', () => {
    // Tilt far enough and a point on the wall passes the lens plane, where the
    // projection is not a row but its reflection. `forwardAtHeight` is what says so.
    const steep: CameraCal = { ...defaultCal(4 / 3), tiltRad: (-80 * Math.PI) / 180 };
    expect(wallRowAtHeight(0, 0.3, steep)).toBeNull();
    expect(wallColumnsAtHeight(0, { distance: 0.3, left: -1, right: 1 }, steep)).toBeNull();
  });

  it('the wall\'s ends move inward as the row drops under tilt', () => {
    // The property `wallColumnsAtHeight` exists for, stated as a comparison rather
    // than a number: under a downward tilt the lower rows are further ahead, so the
    // same wall is narrower on screen there. The version that divided by the wall
    // distance alone returned one answer for every row and called it exact.
    const wall = wallFrame('n', RECT)!;
    const tilted: CameraCal = { ...defaultCal(4 / 3), tiltRad: (30 * Math.PI) / 180 };
    const top = wallColumnsAtHeight(2.28, wall, tilted)!;
    const bottom = wallColumnsAtHeight(SKIRTING_M, wall, tilted)!;
    expect(bottom.right).toBeLessThan(top.right);
    expect(bottom.left).toBeGreaterThan(top.left);
    // Level, the two rows agree exactly — which is why zero tilt could not see it.
    const level = wallColumnsAtHeight(2.28, wall, CAL)!;
    expect(wallColumnsAtHeight(SKIRTING_M, wall, CAL)!.right).toBeCloseTo(level.right, 12);
  });
});

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
        const region = wallRegion(slot, RECT, ROOM.height, cal, 'measured')!;
        expect(region).not.toBeNull();

        // The two point helpers must agree on the wall PLANE before either is
        // trusted. Only at the centre: `onWall`'s offset is a world coordinate and
        // `wallPoint`'s is the image's left-to-right axis, so they are the same
        // point either way at zero and mirror images of each other on s and w.
        // Which of the two conventions is right laterally is settled below,
        // against `project`, rather than by comparing these two with each other.
        // Componentwise rather than `toEqual`, which separates −0 from 0 and would
        // fail on the two slots whose axis is negated for no reason a reader cares
        // about.
        const wall = wallFrame(slot, RECT)!;
        const centre = onWall(slot, ROOM, 1.1, 0);
        wallPoint(slot, wall, 0, 1.1).forEach((c, i) => expect(c).toBeCloseTo(centre[i], 12));

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

  it('an ASSUMED lens stays on the wall for every real lens up to the widest', () => {
    // The defect this replaced, and the normal path rather than an edge case: with
    // no EXIF focal length the band was drawn for the 66° phone main, and a photo
    // taken on the 106° ultrawide put 32.1% of the sample on floor and ceiling —
    // level camera, in-spec room, nothing exotic. `CLAUDE.md` records that not one
    // of the four real phone photos this repo was tested against carried a focal
    // length, so this was the ordinary case.
    //
    // The assertion is the honest form of that measurement: whatever lens the photo
    // was really taken on, the band must sit strictly inside the two TRUE junctions
    // for that lens. Assuming the widest is what makes it hold in one direction, and
    // the direction is the argument — a narrower real lens only leaves more wall
    // around the band.
    const assumed = wallRegion('n', RECT, ROOM.height, defaultCal(4 / 3), 'assumed')!;
    expect(assumed).not.toBeNull();
    for (const realHfov of [66, 80, 90, 106, WIDEST_HFOV_DEG]) {
      const real = calFromHfov(realHfov, 4 / 3);
      const [, ceilingV] = project('n', ...onWall('n', ROOM, ROOM.height), real);
      const [, floorV] = project('n', ...onWall('n', ROOM, 0), real);
      expect(assumed[1], `${realHfov}° ceiling junction`).toBeGreaterThan(ceilingV);
      expect(assumed[1] + assumed[3], `${realHfov}° floor junction`).toBeLessThan(floorV);
    }
  });

  it('a MEASURED lens is used as measured, and the widening is one-way', () => {
    // `bandCal` must not touch a photo that told us its lens — that would trade the
    // silent-wrong-answer defect for a silently smaller sample — and must not
    // NARROW an ultrawide that did.
    const ultra = calFromHfov(106, 4 / 3);
    expect(bandCal(ultra, 'measured')).toBe(ultra);
    expect(bandCal(ultra, 'assumed').k).toBeGreaterThan(ultra.k);
    expect(bandCal(calFromHfov(WIDEST_HFOV_DEG + 8, 4 / 3), 'assumed').k).toBeCloseTo(
      calFromHfov(WIDEST_HFOV_DEG + 8, 4 / 3).k,
      12,
    );
    // The widening keeps the pose, which is the half a spread could drop.
    const posed: CameraCal = { ...defaultCal(4 / 3), height: 1.2, tiltRad: 0.1 };
    expect(bandCal(posed, 'assumed').height).toBe(1.2);
    expect(bandCal(posed, 'assumed').tiltRad).toBe(0.1);
    expect(bandCal(posed, 'assumed').aspect).toBe(posed.aspect);
    // …and a measured band is genuinely taller than an assumed one, so the two
    // paths are not the same code with a different name.
    const m = wallRegion('n', RECT, ROOM.height, ultra, 'measured')!;
    const a = wallRegion('n', RECT, ROOM.height, ultra, 'assumed')!;
    expect(m[3]).toBeGreaterThan(a[3]);
  });

  it('refuses a band whose two edges leave the frame on the SAME side', () => {
    // The worst defect this file has had. A 10 m-deep room at the tilt sensor's own
    // 45° limit puts both junctions ABOVE the picture (v −0.906 and −0.098): the
    // previous version could not tell that from one leaving by each side, defaulted
    // the top to 0 and the bottom to 1, and returned the whole frame — reporting
    // success while sampling the floor.
    const deep = footprintForLayout('rect', ROOM.width, 10);
    const down: CameraCal = { ...defaultCal(4 / 3), tiltRad: (45 * Math.PI) / 180 };
    expect(wallRegion('n', deep, ROOM.height, down, 'measured')).toBeNull();
    // The other edge, and a tighter room than the one above: an 1.8 m ceiling at
    // −30° of tilt — inside `vanishing-point`'s own MAX_TILT_DEG — puts both
    // junctions below the picture (v 1.033 and 2.833) and gave a region that was
    // 84.7% ceiling.
    const low = footprintForLayout('rect', ROOM.width, 3.6);
    const up: CameraCal = { ...defaultCal(4 / 3), tiltRad: (-30 * Math.PI) / 180 };
    expect(wallRegion('n', low, 1.8, up, 'measured')).toBeNull();
  });

  it('refuses a band too small ON SCREEN, not merely in the room', () => {
    // `MIN_WALL_M` asks whether the ROOM has clear wall; this asks whether it is
    // visible. Same 10 m room, tilt 38.5°: 4.9% of the frame tall, which the 24×24
    // resample would have stretched into a full grid of samples so that
    // `MIN_SAMPLES` never noticed.
    const deep = footprintForLayout('rect', ROOM.width, 10);
    const at = (deg: number): CameraCal => ({ ...defaultCal(4 / 3), tiltRad: (deg * Math.PI) / 180 });
    expect(wallRegion('n', deep, ROOM.height, at(38.5), 'measured')).toBeNull();
    // …and 38°, at 6.0%, is accepted — the bound pinned from both sides, half a
    // degree apart, so it is MIN_BAND_FRAC being tested and not the tilt.
    const just = wallRegion('n', deep, ROOM.height, at(38), 'measured')!;
    expect(just).not.toBeNull();
    expect(just[3]).toBeGreaterThanOrEqual(MIN_BAND_FRAC);
    expect(just[3]).toBeLessThan(MIN_BAND_FRAC * 1.3);
  });

  it('keeps the RETURN wall out of an off-centre room', () => {
    // R29's fixture, from the contract `scene-store.ts` states. The east wall is
    // dragged out a metre, so the north wall's midpoint sits at x = +0.5 while
    // ±width/2 still centres it on the lens: the region's left sixth was west wall,
    // full band height, and every row was measured from a distance 11% wrong.
    const poly = offsetWall(footprintForLayout('rect', 1.5, 5), 1, 1);
    const region = wallRegion('n', poly, ROOM.height, CAL, 'measured')!;
    expect(region).not.toBeNull();
    const wall = wallFrame('n', poly)!;
    // A point on the WEST return wall, a little nearer the camera than the corner.
    const [ru] = project('n', wall.left, 1.2, -(wall.distance - 0.2), CAL);
    expect(ru).toBeLessThan(region[0]);
    // …while the framed wall's own midpoint is inside, and is NOT at u 0.5.
    const [mu, mv] = project('n', ...wallPoint('n', wall, (wall.left + wall.right) / 2, 1.2), CAL);
    expect(inside(region, mu, mv)).toBe(true);
    expect(Math.abs(mu - 0.5)).toBeGreaterThan(0.05);
  });

  it('refuses a band too NARROW on screen as well as too short', () => {
    // The other direction of MIN_BAND_FRAC, and reachable inside the room range:
    // `ROOM_SIDE_M` allows 50 m, so a 1.5 m-wide wall photographed from 25 m away
    // is 4.6% of the frame across — an eighth of a phone screen's width, at which
    // point the 24×24 resample is inventing detail. The band is 8.6% TALL there, so
    // the height check does not answer this one for it.
    const far = footprintForLayout('rect', 1.5, 50);
    expect(wallRegion('n', far, ROOM.height, CAL, 'measured')).toBeNull();
    // …and the same wall at 10 m is 11.5% across and is read.
    const near = footprintForLayout('rect', 1.5, 20);
    expect(wallRegion('n', near, ROOM.height, CAL, 'measured')).not.toBeNull();
  });

  it('keeps the return walls out at every row of a TILTED band', () => {
    // The 3.6%-of-the-band leak, as a fixture that can express it: the wall's ends
    // have to be inside the frame for an overshoot to be visible at all, so the
    // framed wall is narrow (2.5 m) at 2.1 m. My first probe used a 5.6 m wall,
    // where the columns clamp to the frame and no error can show — the same
    // "fixture cannot express the defect" trap this file keeps finding.
    const narrow = { width: 2.5, depth: 4.2, height: 2.5 };
    const poly = footprintForLayout('rect', narrow.width, narrow.depth);
    //
    // Both signs of tilt, because the band's binding row swaps between them — down
    // the bottom row is furthest ahead and narrowest, up it is the top row — and
    // that is what makes the INTERSECTION of the two load-bearing rather than a
    // choice of one.
    for (const deg of [30, -30]) {
      const tilted: CameraCal = { ...defaultCal(4 / 3), tiltRad: (deg * Math.PI) / 180 };
      const region = wallRegion('n', poly, narrow.height, tilted, 'measured')!;
      expect(region, `${deg}°`).not.toBeNull();
      for (const end of [-narrow.width / 2, narrow.width / 2]) {
        for (const y of [SKIRTING_M, 1.2, narrow.height - COVING_M]) {
          const [u] = project('n', ...onWall('n', narrow, y, end), tilted);
          expect(u > region[0] && u < region[0] + region[2], `${deg}° end ${end} at y ${y}`).toBe(false);
        }
      }
    }
  });

  it('refuses a room with no clear wall left', () => {
    // Both ceilings here are under a metre, so the camera has to come down with
    // them or the camera-above-the-ceiling refusal answers first and this pins
    // nothing. Found by writing the guard and watching the pinning half go null.
    const low: CameraCal = { ...defaultCal(4 / 3), height: 0.4 };
    const squashed = SKIRTING_M + COVING_M + MIN_WALL_M - 0.01;
    expect(wallRegion('n', RECT, squashed, low, 'measured')).toBeNull();
    // …and accepts one just above the line, so the bound is pinned from both sides.
    const just = SKIRTING_M + COVING_M + MIN_WALL_M + 0.01;
    expect(wallRegion('n', RECT, just, low, 'measured')).not.toBeNull();
  });

  it('the lowest ceiling the app can hold still samples', () => {
    // 1.8 m is `ROOM_HEIGHT_M.min`, so this must not refuse — a refusal there would
    // make the feature silently absent in legal rooms, and every new guard in this
    // function is one more chance of it. Both lens paths, since the assumed one
    // draws a smaller band and is the one that could fall under MIN_BAND_FRAC.
    expect(wallRegion('n', RECT, 1.8, CAL, 'measured')).not.toBeNull();
    expect(wallRegion('n', RECT, 1.8, CAL, 'assumed')).not.toBeNull();
    for (const slot of SLOT_ORDER) {
      expect(wallRegion(slot, RECT, 1.8, CAL, 'assumed'), slot).not.toBeNull();
    }
  });

  it('refuses a room with no height at all, or a non-finite one', () => {
    expect(wallRegion('n', RECT, 0, CAL, 'measured')).toBeNull();
    expect(wallRegion('n', RECT, NaN, CAL, 'measured')).toBeNull();
    expect(wallRegion('n', RECT, Infinity, CAL, 'measured')).toBeNull();
  });

  it('refuses a camera at or above the ceiling', () => {
    // The two ranges do not overlap on their own — `pose.heightM` solves as high as
    // 2.2 m and a legal ceiling starts at 1.8 m — so a real pose record can describe
    // a photograph taken from inside the slab. `placeCeilingObject` refuses the
    // mirror case; this is the same refusal on this path.
    const high: CameraCal = { ...defaultCal(4 / 3), height: 2.2 };
    expect(wallRegion('n', RECT, 1.8, high, 'measured')).toBeNull();
    expect(wallRegion('n', RECT, 2.5, high, 'measured')).not.toBeNull();
    expect(wallRegion('n', RECT, 2.5, { ...defaultCal(4 / 3), height: 0 }, 'measured')).toBeNull();
  });

  it('refuses a footprint the band cannot be measured from', () => {
    expect(wallRegion('n', [[NaN, -2], [2, -2], [2, 2], [-2, 2]], 2.5, CAL, 'measured')).toBeNull();
    const behind = RECT.map(([x, z]) => [x, z + 10]) as Footprint;
    expect(wallRegion('n', behind, 2.5, CAL, 'measured')).toBeNull();
  });

  it('trims the wall ends by EDGE_TRIM off the COMPUTED columns', () => {
    // Pins the constant against the geometry rather than against itself. The
    // earlier version of this test divided the region's width by (1 − 2·trim) and
    // asserted the product back — true for any width at all.
    const wall = wallFrame('n', RECT)!;
    const cols = wallColumnsAtHeight(SKIRTING_M, wall, CAL)!;
    const left = Math.max(0, cols.left);
    const right = Math.min(1, cols.right);
    const region = wallRegion('n', RECT, ROOM.height, CAL, 'measured')!;
    expect(region[2]).toBeCloseTo((right - left) * (1 - 2 * EDGE_TRIM), 12);
    expect(region[0]).toBeCloseTo(left + (right - left) * EDGE_TRIM, 12);
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

describe('wallColorProposal — which wall actually gets painted', () => {
  const RECT = footprintForLayout('rect', ROOM.width, ROOM.depth);
  const L = footprintForLayout('l', ROOM.width, ROOM.depth);
  const found = (...pairs: Array<[CaptureSlot, string]>) =>
    pairs.map(([slot, hex]) => ({ slot, hex }));

  it('maps each photo to its own wall in a four-walled room', () => {
    const p = wallColorProposal(
      found(['n', '#8ca082'], ['e', '#c8b49b'], ['s', '#efe7d8'], ['w', '#7a6a58']),
      [],
      RECT,
      true,
    );
    expect(p.perWall).toEqual({ 0: '#8ca082', 1: '#c8b49b', 2: '#efe7d8', 3: '#7a6a58' });
    expect(p.allWalls).toBeNull();
  });

  it('paints only the walls that were photographed', () => {
    const p = wallColorProposal(found(['e', '#c8b49b']), [{ slot: 'n', reason: 'blocked' }], RECT, true);
    expect(p.perWall).toEqual({ 1: '#c8b49b' });
    expect(p.skipped).toEqual([{ slot: 'n', reason: 'blocked' }]);
  });

  it('falls back to ONE colour when the room has no four-wall mapping', () => {
    // An L cannot say which wall each photo shows, so four guesses would be the
    // wrong wall three times. The single colour is the per-channel median.
    const p = wallColorProposal(found(['n', '#202020'], ['e', '#404040'], ['s', '#808080']), [], L, true);
    expect(p.perWall).toEqual({});
    expect(p.allWalls).toBe('#404040');
  });

  it('proposes nothing at all when nothing was read', () => {
    const p = wallColorProposal([], [{ slot: 'n', reason: 'no-wall' }], RECT, false);
    expect(p.perWall).toEqual({});
    expect(p.allWalls).toBeNull();
    // …and the reasons survive, because a silent skip reads as a half-working
    // feature.
    expect(p.skipped).toHaveLength(1);
    expect(p.usedBoxes).toBe(false);
  });

  it('carries usedBoxes through, so the UI can say furniture was not excluded', () => {
    expect(wallColorProposal(found(['n', '#111111']), [], RECT, false).usedBoxes).toBe(false);
    expect(wallColorProposal(found(['n', '#111111']), [], RECT, true).usedBoxes).toBe(true);
  });

  it('every key it produces is a real wall of the footprint it was given', () => {
    // A property, not a guard: the in-range check in `wallColorProposal` cannot
    // fire, because `slotWallIndices` produces the indices as its own loop index
    // over this same polygon. Deleting that check breaks nothing, which is why the
    // code says so instead of this test pretending to cover it. What this DOES
    // pin is the property itself, so a future matcher that stops deriving indices
    // from the polygon has something to fail.
    for (const layout of ['rect', 'open', 'custom'] as const) {
      const poly = footprintForLayout(layout, ROOM.width, ROOM.depth);
      const p = wallColorProposal(
        found(['n', '#111111'], ['e', '#222222'], ['s', '#333333'], ['w', '#444444']),
        [],
        poly,
        true,
      );
      for (const key of Object.keys(p.perWall)) {
        expect(Number(key)).toBeGreaterThanOrEqual(0);
        expect(Number(key)).toBeLessThan(poly.length);
      }
    }
  });
});

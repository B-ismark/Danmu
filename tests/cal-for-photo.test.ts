// The scan screen's camera ladder: what each photo's camera is taken to be, from
// what the photo told us. It used to live inside `app/onboarding/detect/page.tsx`,
// where nothing could run it; `calForPhoto` is that code, moved.
//
// Each case asks the question a rung exists to answer — where does the wall-floor
// line land for the camera it chose — rather than restating the arithmetic, so a
// rung that spends the line on the wrong unknown fails here.

import { describe, expect, it } from 'vitest';
import {
  CAM_HEIGHT,
  calForPhoto,
  calFromHfov,
  calsForRoom,
  defaultCal,
  wallFrame,
  wallRowAtHeight,
  type CameraCal,
} from '@/lib/photo-geometry';
import type { CaptureSlot } from '@/lib/storage';
import { footprintForLayout } from '@/lib/footprint';

const ROOM = footprintForLayout('rect', 6, 4);
const ASPECT = 4 / 3;
const NONE = { aspect: ASPECT, view: {}, exifHfov: null, vanishing: null, floorLine: null };
const D = wallFrame('n', ROOM)!.distance;
const hfovOf = (k: number) => (2 * Math.atan(k / 2) * 180) / Math.PI;

describe('calForPhoto', () => {
  it('with nothing to go on, is the typical phone lens, level, at the assumed height', () => {
    const cal = calForPhoto(NONE, 'n', ROOM);
    expect(cal).toEqual(defaultCal(ASPECT));
    expect(cal.lens).toBeUndefined();
  });

  it('keeps a height and tilt measured at capture, whatever else it lacks', () => {
    const cal = calForPhoto({ ...NONE, view: { height: 1.3, tiltRad: -0.1 } }, 'n', ROOM);
    expect(cal).toMatchObject({ ...defaultCal(ASPECT), height: 1.3, tiltRad: -0.1 });
  });

  it('with no lens, spends the floor line on the lens at the assumed height', () => {
    const cal = calForPhoto({ ...NONE, floorLine: 0.9 }, 'n', ROOM);
    expect(cal.height).toBeUndefined();
    expect(hfovOf(cal.k)).not.toBeCloseTo(66, 0);
    // The lens it solved is the one that puts the wall's foot where the photo shows it.
    expect(wallRowAtHeight(0, D, cal)).toBeCloseTo(0.9, 9);
    expect(cal.floorLine).toBe(0.9);
  });

  it('falls back to the typical lens when the floor line cannot be a floor line', () => {
    expect(calForPhoto({ ...NONE, floorLine: 0.5 }, 'n', ROOM)).toEqual(defaultCal(ASPECT));
  });

  it('with an EXIF lens, spends the floor line on the camera height instead', () => {
    // A lens wide enough to show the wall's foot from a standing height (below).
    const cal = calForPhoto({ ...NONE, exifHfov: 110, floorLine: 0.9 }, 'n', ROOM);
    expect(cal.lens).toBe('measured');
    expect(cal.k).toBeCloseTo(calFromHfov(110, ASPECT).k, 12);
    expect(cal.height).not.toBeCloseTo(CAM_HEIGHT, 2);
    expect(wallRowAtHeight(0, D, cal)).toBeCloseTo(0.9, 9);
  });

  it('never refits a height the phone measured', () => {
    const cal = calForPhoto({ ...NONE, exifHfov: 80, floorLine: 0.9, view: { height: 1.3 } }, 'n', ROOM);
    expect(cal.height).toBe(1.3);
  });

  it('takes the lens and the tilt from the vanishing points when EXIF has no lens', () => {
    const cal = calForPhoto({ ...NONE, vanishing: { hfovDeg: 90, tiltDeg: -6 } }, 'n', ROOM);
    expect(cal.lens).toBe('assumed');
    expect(hfovOf(cal.k)).toBeCloseTo(90, 9);
    expect(cal.tiltRad).toBeCloseTo((-6 * Math.PI) / 180, 12);
  });

  it('keeps a tilt the phone measured over the one the vanishing points inferred', () => {
    const cal = calForPhoto({ ...NONE, view: { tiltRad: 0.05 }, vanishing: { hfovDeg: 90, tiltDeg: -6 } }, 'n', ROOM);
    expect(cal.tiltRad).toBe(0.05);
  });

  it('ignores the vanishing points when EXIF gave the lens', () => {
    const cal = calForPhoto({ ...NONE, exifHfov: 80, vanishing: { hfovDeg: 90, tiltDeg: -6 } }, 'n', ROOM);
    expect(cal.lens).toBe('measured');
    expect(hfovOf(cal.k)).toBeCloseTo(80, 9);
    expect(cal.tiltRad).toBeUndefined();
  });
});

// Field test, four real rooms: on a 1x lens a level phone at chest height does not
// show the wall's foot, so the strongest low edge can be a sofa top or a headboard,
// and a height fitted from it puts the camera at the knees. `calForPhoto` refuses a
// fit below a standing height where the floor could not be in the picture for
// someone standing — and only there.
describe('a floor line the standing camera could not see', () => {
  // 6 × 4 room, north wall 2 m away. At 80° a standing camera's floor junction sits
  // below the frame; at 110° it is in it.
  const at80 = calFromHfov(80, ASPECT);
  /** The floor line a camera at `h` on `cal`'s lens shows on the north wall. */
  const lineAt = (h: number, cal: CameraCal) => wallRowAtHeight(0, D, { ...cal, height: h })!;

  it('is not spent on a knee-height camera', () => {
    expect(lineAt(CAM_HEIGHT, at80)).toBeGreaterThan(1);
    const cal = calForPhoto({ ...NONE, exifHfov: 80, floorLine: lineAt(1.0, at80) }, 'n', ROOM);
    expect(cal.height).toBeUndefined();
    expect(cal.floorLine).toBeUndefined();
  });

  it('is, for a phone held a little low — the floor really is in that frame', () => {
    // A 1.2 m camera on the same lens sees the floor at 0.977: in frame, while a
    // 1.5 m camera would not. The geometry cannot tell this from furniture, so it
    // is the HEIGHT that decides.
    const line = lineAt(1.2, at80);
    expect(line).toBeLessThan(1);
    const cal = calForPhoto({ ...NONE, exifHfov: 80, floorLine: line }, 'n', ROOM);
    expect(cal.height).toBeCloseTo(1.2, 9);
  });

  it('is, where the wider lens takes the floor in, however low the camera', () => {
    const at110 = calFromHfov(110, ASPECT);
    expect(lineAt(CAM_HEIGHT, at110)).toBeLessThan(1);
    const cal = calForPhoto({ ...NONE, exifHfov: 110, floorLine: lineAt(0.9, at110) }, 'n', ROOM);
    expect(cal.height).toBeCloseTo(0.9, 9);
  });

  it('is, when the phone is tilted down far enough to see the floor', () => {
    const tilted = { ...at80, tiltRad: (15 * Math.PI) / 180 };
    expect(lineAt(CAM_HEIGHT, tilted)).toBeLessThan(1);
    const cal = calForPhoto(
      { ...NONE, exifHfov: 80, view: { tiltRad: tilted.tiltRad }, floorLine: lineAt(1.0, tilted) },
      'n',
      ROOM,
    );
    expect(cal.height).toBeCloseTo(1.0, 9);
  });
});

// One person stands in one spot and turns: the phone is at the same height in every
// shot, so a height the photos AGREE on stands in for the photos that measured none.
describe('calsForRoom', () => {
  const SQUARE = footprintForLayout('rect', 4, 4);
  const WIDE = 110;
  /** The floor line a camera at `h` on the WIDE lens would show on `slot`. */
  const lineAt = (h: number, slot: CaptureSlot) =>
    wallRowAtHeight(0, wallFrame(slot, SQUARE)!.distance, { ...calFromHfov(WIDE, ASPECT), height: h })!;
  const photo = (floorLine: number | null, view = {}) => ({ ...NONE, view, exifHfov: WIDE, floorLine });
  const fit = (h: number, slot: CaptureSlot) => photo(lineAt(h, slot));

  it('hands an agreed height to a photo that measured none', () => {
    const cals = calsForRoom({ n: fit(1.3, 'n'), e: fit(1.4, 'e'), s: photo(null) }, SQUARE);
    expect(cals.n!.height).toBeCloseTo(1.3, 9);
    expect(cals.e!.height).toBeCloseTo(1.4, 9);
    expect(cals.s!.height).toBeCloseTo(1.35, 9);
    // It is the set's height, not a reading of this photo, so no line ties it to the lens.
    expect(cals.s!.floorLine).toBeUndefined();
  });

  it('shares nothing from a single fit', () => {
    const cals = calsForRoom({ n: fit(1.3, 'n'), e: photo(null) }, SQUARE);
    expect(cals.e!.height).toBeUndefined();
  });

  it('shares nothing from two fits that disagree, rather than a blend nobody measured', () => {
    // Field test, seaview suite: 1.46 and 1.01 (a sofa top), true ~1.5.
    const cals = calsForRoom({ n: fit(1.46, 'n'), e: fit(1.01, 'e'), s: photo(null) }, SQUARE);
    expect(cals.n!.height).toBeCloseTo(1.46, 9);
    expect(cals.e!.height).toBeCloseTo(1.01, 9);
    expect(cals.s!.height).toBeUndefined();
  });

  it('lets an agreeing majority outvote a misread line', () => {
    const cals = calsForRoom(
      { n: fit(1.5, 'n'), e: fit(1.4, 'e'), s: fit(1.0, 's'), w: photo(null) },
      SQUARE,
    );
    expect(cals.n!.height).toBeCloseTo(1.5, 9);
    expect(cals.e!.height).toBeCloseTo(1.4, 9);
    expect(cals.s!.height).toBeCloseTo(1.45, 9);
    expect(cals.s!.floorLine).toBeUndefined();
    expect(cals.w!.height).toBeCloseTo(1.45, 9);
  });

  it('keeps each agreeing fit as that photo’s own', () => {
    const cals = calsForRoom({ n: fit(1.5, 'n'), e: fit(1.45, 'e'), s: fit(1.3, 's') }, SQUARE);
    expect(cals.s!.height).toBeCloseTo(1.3, 9);
    expect(cals.s!.floorLine).toBeDefined();
  });

  it('shares nothing when no group is a majority', () => {
    // Two pairs, each agreeing within itself: 1.0 / 1.05 and 1.5 / 1.52.
    const cals = calsForRoom(
      { n: fit(1.0, 'n'), e: fit(1.05, 'e'), s: fit(1.5, 's'), w: fit(1.52, 'w') },
      SQUARE,
    );
    expect(cals.n!.height).toBeCloseTo(1.0, 9);
    expect(cals.e!.height).toBeCloseTo(1.05, 9);
    expect(cals.s!.height).toBeCloseTo(1.5, 9);
    expect(cals.w!.height).toBeCloseTo(1.52, 9);
  });

  it('never replaces a height the phone gave, nor counts it as a fit', () => {
    // Without the phone's 1.0 counted, 1.3 and 1.4 agree and the set has a height.
    const cals = calsForRoom(
      { n: fit(1.3, 'n'), e: fit(1.4, 'e'), w: photo(lineAt(1.0, 'w'), { height: 1.0 }), s: photo(null) },
      SQUARE,
    );
    expect(cals.w!.height).toBe(1.0);
    expect(cals.s!.height).toBeCloseTo(1.35, 9);
  });

  it('leaves a lens-less photo that solved its lens from its own line alone', () => {
    // Its line ties its height to its lens; `atLens` re-solves through it.
    const lensless = { ...NONE, floorLine: 0.9 };
    const cals = calsForRoom({ n: fit(1.3, 'n'), e: fit(1.4, 'e'), s: lensless }, SQUARE);
    expect(cals.s).toEqual(calForPhoto(lensless, 's', SQUARE));
    expect(cals.s!.floorLine).toBe(0.9);
  });

  it('gives a photo with neither lens nor line the agreed height on the typical lens', () => {
    const cals = calsForRoom({ n: fit(1.3, 'n'), e: fit(1.4, 'e'), s: NONE }, SQUARE);
    const { height, ...rest } = cals.s!;
    expect(rest).toEqual(defaultCal(ASPECT));
    expect(height).toBeCloseTo(1.35, 9);
  });
});

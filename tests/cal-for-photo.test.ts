// The scan screen's camera ladder: what each photo's camera is taken to be, from
// what the photo told us. It used to live inside `app/onboarding/detect/page.tsx`,
// where nothing could run it; `calForPhoto` is that code, moved.
//
// Each case asks the question a rung exists to answer — where does the wall-floor
// line land for the camera it chose — rather than restating the arithmetic, so a
// rung that spends the line on the wrong unknown fails here.

import { describe, expect, it } from 'vitest';
import { CAM_HEIGHT, calForPhoto, calFromHfov, calsForRoom, defaultCal, wallFrame, wallRowAtHeight } from '@/lib/photo-geometry';
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
// show the wall's foot, so the strongest low edge is a sofa top or a headboard and a
// height fitted from it puts the camera at the knees. `calForPhoto` now refuses a
// floor line where the floor could not be in the picture for someone standing.
describe('a floor line the standing camera could not see', () => {
  // 6 × 4 room, north wall 2 m away. At 80° a standing camera's floor junction sits
  // below the frame (row ≈ 1.10); at 110° it is in it (row ≈ 0.85).
  it('is not spent on the camera height', () => {
    expect(wallRowAtHeight(0, D, { ...calFromHfov(80, ASPECT), height: CAM_HEIGHT })!).toBeGreaterThan(1);
    const cal = calForPhoto({ ...NONE, exifHfov: 80, floorLine: 0.9 }, 'n', ROOM);
    expect(cal.height).toBeUndefined();
    expect(cal.floorLine).toBeUndefined();
  });

  it('is, where the wider lens takes the floor in', () => {
    expect(wallRowAtHeight(0, D, { ...calFromHfov(110, ASPECT), height: CAM_HEIGHT })!).toBeLessThan(1);
    const cal = calForPhoto({ ...NONE, exifHfov: 110, floorLine: 0.8 }, 'n', ROOM);
    expect(cal.height).toBeDefined();
    expect(wallRowAtHeight(0, D, cal)).toBeCloseTo(0.8, 9);
  });

  it('is, when the phone is tilted down far enough to see the floor', () => {
    const tilt = (15 * Math.PI) / 180;
    expect(wallRowAtHeight(0, D, { ...calFromHfov(80, ASPECT), height: CAM_HEIGHT, tiltRad: tilt })!).toBeLessThan(1);
    const cal = calForPhoto({ ...NONE, exifHfov: 80, view: { tiltRad: tilt }, floorLine: 0.8 }, 'n', ROOM);
    expect(cal.height).toBeDefined();
  });
});

// One person stands in one spot and turns: the phone is at the same height in every
// shot, so a height one photo measured stands in for the photos that measured none.
describe('calsForRoom', () => {
  const SQUARE = footprintForLayout('rect', 4, 4);
  const WIDE = 110;
  /** The floor line a camera at `h` on the WIDE lens would show on `slot`. */
  const lineAt = (h: number, slot: 'n' | 'e' | 's' | 'w') =>
    wallRowAtHeight(0, wallFrame(slot, SQUARE)!.distance, { ...calFromHfov(WIDE, ASPECT), height: h })!;
  const photo = (floorLine: number | null, view = {}) => ({ ...NONE, view, exifHfov: WIDE, floorLine });

  it('hands the measured height to a photo that measured none', () => {
    const cals = calsForRoom({ n: photo(lineAt(1.3, 'n')), e: photo(null) }, SQUARE);
    expect(cals.n!.height).toBeCloseTo(1.3, 9);
    expect(cals.e!.height).toBeCloseTo(1.3, 9);
    // It is the set's height, not a reading of this photo, so no line ties it to the lens.
    expect(cals.e!.floorLine).toBeUndefined();
  });

  it('takes the median, and with three or more lets it outvote a misread line', () => {
    const cals = calsForRoom(
      { n: photo(lineAt(1.5, 'n')), e: photo(lineAt(1.45, 'e')), s: photo(lineAt(1.05, 's')), w: photo(null) },
      SQUARE,
    );
    expect(cals.n!.height).toBeCloseTo(1.5, 9);
    expect(cals.e!.height).toBeCloseTo(1.45, 9);
    expect(cals.s!.height).toBeCloseTo(1.45, 9);
    expect(cals.w!.height).toBeCloseTo(1.45, 9);
  });

  it('keeps a fit within a fifth of the median as that photo’s own', () => {
    const cals = calsForRoom(
      { n: photo(lineAt(1.5, 'n')), e: photo(lineAt(1.45, 'e')), s: photo(lineAt(1.25, 's')) },
      SQUARE,
    );
    expect(cals.s!.height).toBeCloseTo(1.25, 9);
    expect(cals.s!.floorLine).toBeDefined();
  });

  it('with only two fits, cannot tell which misread and leaves both', () => {
    const cals = calsForRoom({ n: photo(lineAt(1.5, 'n')), e: photo(lineAt(1.0, 'e')) }, SQUARE);
    expect(cals.n!.height).toBeCloseTo(1.5, 9);
    expect(cals.e!.height).toBeCloseTo(1.0, 9);
  });

  it('never replaces a height the phone gave, nor counts it as a fit', () => {
    const cals = calsForRoom({ n: photo(lineAt(1.3, 'n')), e: photo(lineAt(1.3, 'e'), { height: 1.6 }), s: photo(null) }, SQUARE);
    expect(cals.e!.height).toBe(1.6);
    expect(cals.s!.height).toBeCloseTo(1.3, 9);
  });

  it('with no fit anywhere, is each photo’s own camera', () => {
    const photos = { n: photo(null), e: { ...NONE, floorLine: 0.9 } };
    const cals = calsForRoom(photos, SQUARE);
    expect(cals.n).toEqual(calForPhoto(photos.n, 'n', SQUARE));
    expect(cals.e).toEqual(calForPhoto(photos.e, 'e', SQUARE));
  });

  it('re-solves a lens-less photo’s lens at the shared height rather than the guess', () => {
    const lensless = { ...NONE, floorLine: 0.9 };
    const cals = calsForRoom({ n: photo(lineAt(1.2, 'n')), e: lensless }, SQUARE);
    expect(cals.e!.height).toBeCloseTo(1.2, 9);
    expect(wallRowAtHeight(0, wallFrame('e', SQUARE)!.distance, cals.e!)).toBeCloseTo(0.9, 9);
    expect(cals.e!.k).not.toBeCloseTo(calForPhoto(lensless, 'e', SQUARE).k, 3);
  });
});

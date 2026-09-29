// The scan screen's camera ladder: what each photo's camera is taken to be, from
// what the photo told us. It used to live inside `app/onboarding/detect/page.tsx`,
// where nothing could run it; `calForPhoto` is that code, moved.
//
// Each case asks the question a rung exists to answer — where does the wall-floor
// line land for the camera it chose — rather than restating the arithmetic, so a
// rung that spends the line on the wrong unknown fails here.

import { describe, expect, it } from 'vitest';
import { CAM_HEIGHT, calForPhoto, calFromHfov, defaultCal, wallFrame, wallRowAtHeight } from '@/lib/photo-geometry';
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
    const cal = calForPhoto({ ...NONE, exifHfov: 80, floorLine: 0.9 }, 'n', ROOM);
    expect(cal.lens).toBe('measured');
    expect(cal.k).toBeCloseTo(calFromHfov(80, ASPECT).k, 12);
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

import { describe, it, expect } from 'vitest';
import { circularMeanDeg, circularSpreadDeg } from '@/lib/bearings';

// Averaging bearings is silently wrong in most hand-rolled versions, and this is
// the file that says so: the mean of 359° and 1° is 0°, not 180°.
//
// These tests outlived what they were written for. The module was
// `lib/compass.ts`, and this suite covered a device-magnetometer read — a snap to
// 5°, a failure vocabulary, a shaky-reading threshold. That read went with the
// solar apparatus (see `lib/solar.ts`'s header) and the maths did not, because
// `lib/capture-slots.ts` averages the EXIF bearings of a set of room photos to
// work out which wall each one is. So the consumer changed, the module was
// renamed to match its contents, and every assertion below is about the
// arithmetic rather than about a sensor.
describe('circularMeanDeg', () => {
  it('averages across the north seam instead of through south', () => {
    // The bug this exists to prevent: (359 + 1) / 2 = 180, pointing the room the
    // exact opposite way from the reading.
    const m = circularMeanDeg([359, 1])!;
    expect(Math.min(m.deg, 360 - m.deg)).toBeCloseTo(0, 6);
    expect(m.resultant).toBeCloseTo(1, 3);

    const m2 = circularMeanDeg([350, 10, 0])!;
    expect(Math.min(m2.deg, 360 - m2.deg)).toBeCloseTo(0, 6);
  });

  it('agrees with the plain mean when nothing wraps', () => {
    expect(circularMeanDeg([100, 110, 120])!.deg).toBeCloseTo(110, 6);
    expect(circularMeanDeg([215])!.deg).toBeCloseTo(215, 6);
  });

  it('reports full agreement for a set that all pointed one way', () => {
    expect(circularMeanDeg([215, 215, 215])!.resultant).toBeCloseTo(1, 9);
  });

  it('reports no agreement for opposed bearings, without inventing a direction', () => {
    const m = circularMeanDeg([0, 180])!;
    expect(m.resultant).toBeCloseTo(0, 9);
    // The resultant is the caller's cue to refuse: `capture-slots` will not derive
    // an anchor from a set that disagrees like this rather than pick a side.
    expect(m.resultant).toBeLessThan(0.6);
  });

  it('has nothing to say about no samples', () => {
    expect(circularMeanDeg([])).toBeNull();
  });

  it('is unmoved by how the same direction is written', () => {
    const a = circularMeanDeg([10, 20])!;
    const b = circularMeanDeg([370, 380])!;
    expect(b.deg).toBeCloseTo(a.deg, 6);
    expect(b.resultant).toBeCloseTo(a.resultant, 6);
  });
});

describe('circularSpreadDeg', () => {
  it('is zero for a set that never disagreed and grows as readings scatter', () => {
    expect(circularSpreadDeg(1)).toBe(0);
    let prev = -1;
    for (const r of [0.999, 0.99, 0.95, 0.9, 0.8, 0.7]) {
      const s = circularSpreadDeg(r);
      expect(s).toBeGreaterThanOrEqual(prev);
      prev = s;
    }
  });

  it('crosses 15 degrees of spread somewhere a real set of photos reaches', () => {
    // 15° was the threshold the retired magnetometer read called 'shaky', and it
    // is the same order of disagreement a set of EXIF bearings shows: four photos
    // taken by hand round one room agree far better than 0.9. Stated here as a
    // literal rather than imported, because the constant it used to name went
    // with the sensor.
    expect(circularSpreadDeg(0.995)).toBeLessThan(15);
    expect(circularSpreadDeg(0.9)).toBeGreaterThan(15);
  });

  it('survives a zero resultant rather than returning Infinity', () => {
    expect(Number.isFinite(circularSpreadDeg(0))).toBe(true);
  });
});


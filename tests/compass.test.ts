import { describe, it, expect } from 'vitest';
import {
  circularMeanDeg,
  circularSpreadDeg,
  snapBearing,
  compassFailureMessage,
  SHAKY_SPREAD_DEG,
  type CompassFailure,
} from '@/lib/compass';

// The sensor read itself is not tested — it is two vendor-specific event APIs behind
// a permission prompt. What is tested is every decision the app makes about the
// numbers that come out, starting with the one that is silently wrong in most
// hand-rolled compasses: averaging bearings across the 359°/0° seam.

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

  it('reports full agreement for a needle that did not move', () => {
    expect(circularMeanDeg([215, 215, 215])!.resultant).toBeCloseTo(1, 9);
  });

  it('reports no agreement for opposed readings, without inventing a direction', () => {
    const m = circularMeanDeg([0, 180])!;
    expect(m.resultant).toBeCloseTo(0, 9);
    // Below MIN_AGREEMENT, so readCompass rejects this rather than picking a side.
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
  it('is zero for a still needle and grows as readings scatter', () => {
    expect(circularSpreadDeg(1)).toBe(0);
    let prev = -1;
    for (const r of [0.999, 0.99, 0.95, 0.9, 0.8, 0.7]) {
      const s = circularSpreadDeg(r);
      expect(s).toBeGreaterThanOrEqual(prev);
      prev = s;
    }
  });

  it('crosses the shaky threshold somewhere a real magnetometer reaches', () => {
    // A steady phone holds well above 0.99; one being waved about does not. The
    // threshold has to sit between those, or it either never fires or always does.
    expect(circularSpreadDeg(0.995)).toBeLessThan(SHAKY_SPREAD_DEG);
    expect(circularSpreadDeg(0.9)).toBeGreaterThan(SHAKY_SPREAD_DEG);
  });

  it('survives a zero resultant rather than returning Infinity', () => {
    expect(Number.isFinite(circularSpreadDeg(0))).toBe(true);
  });
});

describe('snapBearing', () => {
  it('rounds to 5°, the dial’s own step', () => {
    expect(snapBearing(212)).toBe(210);
    expect(snapBearing(213)).toBe(215);
    expect(snapBearing(0.4)).toBe(0);
  });

  it('wraps 358° to 0 rather than to 360, which the dial has no room for', () => {
    expect(snapBearing(358)).toBe(0);
    expect(snapBearing(360)).toBe(0);
    expect(snapBearing(-5)).toBe(355);
  });

  it('stays inside the dial’s range for any input', () => {
    for (let d = -720; d <= 720; d += 7) {
      const b = snapBearing(d);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThan(360);
      expect(b % 5).toBe(0);
    }
  });
});

describe('compassFailureMessage', () => {
  const ALL: CompassFailure[] = ['unsupported', 'insecure', 'denied', 'relative', 'unstable'];

  it('names a way forward for every failure', () => {
    for (const f of ALL) {
      const m = compassFailureMessage(f);
      expect(m.length).toBeGreaterThan(10);
      // Four of the five point at the dial, which always works; the fifth says to
      // try again, because the sensor is there and the room is what is wrong.
      expect(m.toLowerCase()).toMatch(/dial|try again/);
    }
  });

  it('distinguishes a device with no compass from one that refused', () => {
    const seen = new Set(ALL.map(compassFailureMessage));
    expect(seen.size).toBe(ALL.length);
  });
});

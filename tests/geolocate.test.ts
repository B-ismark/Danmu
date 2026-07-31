import { describe, it, expect } from 'vitest';
import { coarsen, failureFromCode, geoFailureMessage, type GeoFailure } from '@/lib/geolocate';

// The browser call itself is not tested — it is a permission prompt behind a
// callback API. What IS tested is everything the app decides on its own: how much
// precision it throws away, and that no error code can reach the screen without
// something to say about it.

describe('coarsen', () => {
  it('keeps one decimal place — about 11 km, which the sun cannot tell apart', () => {
    expect(coarsen(51.50735, 90)).toBe(51.5);
    expect(coarsen(-0.12776, 180)).toBe(-0.1);
    expect(coarsen(5.6037, 90)).toBe(5.6);
    expect(coarsen(151.2093, 180)).toBe(151.2);
  });

  it('discards the precision a GPS fix would have carried', () => {
    // Two positions 300 m apart must become the same stored coordinate — the point
    // of rounding is that the value cannot identify a building.
    expect(coarsen(51.5211, 90)).toBe(coarsen(51.5238, 90));
  });

  it('never emits -0, which a number field would render as "-0"', () => {
    expect(Object.is(coarsen(-0.02, 90), 0)).toBe(true);
    expect(Object.is(coarsen(-0, 90), 0)).toBe(true);
  });

  it('clamps to the axis', () => {
    expect(coarsen(112, 90)).toBe(90);
    expect(coarsen(-200, 180)).toBe(-180);
  });
});

describe('failureFromCode', () => {
  it('maps the spec’s three codes', () => {
    expect(failureFromCode(1)).toBe('denied');
    expect(failureFromCode(2)).toBe('unavailable');
    expect(failureFromCode(3)).toBe('timeout');
  });

  it('treats anything else as no fix rather than throwing', () => {
    expect(failureFromCode(0)).toBe('unavailable');
    expect(failureFromCode(99)).toBe('unavailable');
  });
});

describe('geoFailureMessage', () => {
  const ALL: GeoFailure[] = ['unsupported', 'insecure', 'denied', 'unavailable', 'timeout'];

  it('has something to say about every failure, and names the way out', () => {
    for (const f of ALL) {
      const m = geoFailureMessage(f);
      expect(m.length).toBeGreaterThan(10);
      // Every one of these ends with the same escape hatch, because the fields stay
      // editable no matter which failure it was.
      expect(m.toLowerCase()).toContain('coordinates');
    }
  });

  it('says nothing about model names, cost or quota', () => {
    // The user-facing copy rule from CLAUDE.md, asserted where copy is authored.
    for (const f of ALL) {
      expect(geoFailureMessage(f)).not.toMatch(/gemini|api key|quota|cost|token/i);
    }
  });
});

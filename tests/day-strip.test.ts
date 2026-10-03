import { describe, it, expect } from 'vitest';
import { HORIZONS, MAX_WIDTH, hourT, scrubHour, skyGradient, stripFor, stripX, tAtX } from '@/lib/day-strip';
import { SUNRISE_H, SUNSET_H, isDaytime } from '@/lib/lighting-moods';

// The day over the canvas: the whole clock on one strip, painted as its sky, with the
// value read off x the way a slider's is.

const INSET = 43;

describe('the strip', () => {
  it('never grows past its cap, however wide the canvas', () => {
    expect(stripFor(3000, INSET).width).toBe(MAX_WIDTH);
    expect(stripFor(300, INSET).width).toBe(300);
    expect(stripFor(-5, INSET).width).toBe(0);
  });

  it('keeps the handle whole at both ends: midnight sits an inset in from the box', () => {
    for (const w of [300, 520]) {
      const s = stripFor(w, INSET);
      expect(stripX(s, 0)).toBeCloseTo(INSET, 9);
      expect(stripX(s, 1)).toBeCloseTo(w - INSET, 9);
      expect(stripX(s, 0.5)).toBeCloseTo(w / 2, 9);
    }
  });

  it('reads the value off x, and hands back the point it drew', () => {
    for (const w of [300, 520]) {
      const s = stripFor(w, INSET);
      for (let i = 0; i <= 10; i++) expect(tAtX(s, stripX(s, i / 10)), `${w} @ ${i}`).toBeCloseTo(i / 10, 9);
      // Past either end is that end, and the handle never leaves the strip.
      expect(tAtX(s, -50)).toBe(0);
      expect(tAtX(s, w + 50)).toBe(1);
      expect(stripX(s, -0.5)).toBe(stripX(s, 0));
      expect(stripX(s, 1.5)).toBe(stripX(s, 1));
    }
    // A strip with no run at all has one answer, its middle.
    expect(tAtX(stripFor(80, INSET), 10)).toBe(0.5);
  });

  it('runs midnight to midnight', () => {
    expect(hourT(0)).toBe(0);
    expect(hourT(12)).toBe(0.5);
    expect(hourT(18)).toBe(0.75);
    expect(hourT(25)).toBeCloseTo(1 / 24, 9);
    expect(hourT(-1)).toBeCloseTo(23 / 24, 9);
  });
});

describe('scrubbing the strip', () => {
  it('lands on five-minute steps, inside the clock', () => {
    for (let i = 0; i <= 400; i++) {
      const h = scrubHour(i / 400);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(24);
      const m = h * 60;
      expect(Math.abs(m - Math.round(m / 5) * 5), `t=${i / 400}`).toBeLessThan(1e-6);
    }
    expect(scrubHour(0)).toBe(0);
    expect(scrubHour(0.5)).toBe(12);
    // The right end is a step short of the next midnight, not the wrap back to 00:00.
    expect(scrubHour(1)).toBeCloseTo(24 - 1 / 12, 9);
    expect(scrubHour(1.4)).toBeCloseTo(24 - 1 / 12, 9);
    expect(scrubHour(-0.4)).toBe(0);
    // Nearest step, not the one below: 12:04 lands on 12:05, 12:02 on 12:00.
    expect(scrubHour((12 + 4 / 60) / 24)).toBeCloseTo(12 + 5 / 60, 9);
    expect(scrubHour((12 + 2 / 60) / 24)).toBeCloseTo(12, 9);
  });

  it('crosses the horizon where the paint says it does', () => {
    // A hair either side of each painted horizon is the other body. The strip is
    // one track now, so a drag CAN cross — and must cross at the gold, not near it.
    const [rise, set] = HORIZONS;
    expect(isDaytime(scrubHour(rise - 0.01))).toBe(false);
    expect(isDaytime(scrubHour(rise + 0.01))).toBe(true);
    expect(isDaytime(scrubHour(set - 0.01))).toBe(true);
    expect(isDaytime(scrubHour(set + 0.01))).toBe(false);
  });
});

describe('the sky it is painted with', () => {
  const g = skyGradient();
  const stop = (token: string) =>
    [...g.matchAll(new RegExp(`var\\(${token}\\) ([\\d.]+)%`, 'g'))].map((m) => Number(m[1]));

  it('puts the gold exactly on the clock\'s sunrise and sunset', () => {
    expect(stop('--accent-2')).toEqual([(SUNRISE_H / 24) * 100, (SUNSET_H / 24) * 100].map((n) => Number(n.toFixed(3))));
    expect(HORIZONS).toEqual([SUNRISE_H / 24, SUNSET_H / 24]);
  });

  it('is night at both ends and paper at the middle of the day', () => {
    expect(stop('--ink')).toEqual([0, 100]);
    expect(stop('--paper')).toEqual([Number((((SUNRISE_H + SUNSET_H) / 2 / 24) * 100).toFixed(3))]);
  });

  it('runs left to right without a stop going backwards, in tokens only', () => {
    const at = [...g.matchAll(/ ([\d.]+)%/g)].map((m) => Number(m[1]));
    expect(at.length).toBe(9);
    for (let i = 1; i < at.length; i++) expect(at[i]).toBeGreaterThan(at[i - 1]);
    expect(g).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });
});

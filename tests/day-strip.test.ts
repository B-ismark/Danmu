import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { EVENING_BEGINS_H, HORIZONS, MAX_WIDTH, MORNING_ENDS_H, glyphAt, hourT, phaseWords, scrubHour, skyGradient, stripFor, stripX, tAtX } from '@/lib/day-strip';
import { SUNRISE_H, SUNSET_H, TIME_STOPS, isDaytime, sunAt } from '@/lib/lighting-moods';

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

  it('puts the dawn and the dusk exactly on the clock\'s sunrise and sunset', () => {
    expect([...stop('--sky-dawn'), ...stop('--sky-dusk')]).toEqual([(SUNRISE_H / 24) * 100, (SUNSET_H / 24) * 100].map((n) => Number(n.toFixed(3))));
    expect(HORIZONS).toEqual([SUNRISE_H / 24, SUNSET_H / 24]);
  });

  it('is night at both ends and noon at the middle of the day', () => {
    expect(stop('--sky-night')).toEqual([0, 100]);
    expect(stop('--sky-noon')).toEqual([Number((((SUNRISE_H + SUNSET_H) / 2 / 24) * 100).toFixed(3))]);
  });

  it('runs left to right without a stop going backwards, in tokens only', () => {
    const at = [...g.matchAll(/ ([\d.]+)%/g)].map((m) => Number(m[1]));
    expect(at.length).toBe(9);
    for (let i = 1; i < at.length; i++) expect(at[i]).toBeGreaterThan(at[i - 1]);
    expect(g).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });
});

describe('the pill\'s paint, read from the stylesheet', () => {
  const css = readFileSync(join(process.cwd(), 'app', 'globals.css'), 'utf8');
  const rule = (sel: string) => css.match(new RegExp(`\\n${sel.replace(/[.\-_]/g, '\\$&')} \\{([^}]*)\\}`))?.[1] ?? '';

  it('has no halo ring at rest, in either theme of the pill', () => {
    expect(rule('.day-strip__handle')).not.toMatch(/0 0 0 \dpx/);
    expect(rule('.day-strip--night .day-strip__handle')).not.toMatch(/0 0 0 \dpx/);
  });

  it('shows a ring to the keyboard only', () => {
    expect(css).toMatch(/\.day-strip__handle:focus-visible \{ outline: 2px solid/);
  });

  it('grows out on the spring token, and under reduced motion fades instead', () => {
    expect(css).toMatch(/--ease-spring: cubic-bezier\(/);
    expect(rule('.day-strip__sky')).toContain('clip-path calc(var(--dur-slow) * 1.5) var(--ease-spring)');
    const reduced = css.slice(css.indexOf('.day-strip, .day-strip__handle'));
    expect(reduced).toMatch(/\.day-strip__sky \{ transition: opacity/);
    expect(reduced).toMatch(/\.day-strip--open \.day-strip__glyph \{ animation: none; \}/);
  });
});

describe('the glyph in the pill', () => {
  // Bands from the app's own model, not typed: night is `isDaytime`'s, and morning and
  // evening are where the named Morning and Evening stops are nearer than Midday.
  const at = (id: string) => TIME_STOPS.find((s) => s.id === id)!.hour;

  it('takes its bands from the lighting model', () => {
    expect(MORNING_ENDS_H).toBe((at('morning') + at('midday')) / 2);
    expect(EVENING_BEGINS_H).toBe((at('midday') + at('evening')) / 2);
    // Pinned as literals too, so a drifting stop is a decision someone sees.
    expect(MORNING_ENDS_H).toBeCloseTo(10.2, 9);
    expect(EVENING_BEGINS_H).toBeCloseTo(15.65, 9);
  });

  it('runs night, morning, day, evening, night through the clock', () => {
    const seq: string[] = [];
    for (let m = 0; m < 24 * 60; m += 5) {
      const p = glyphAt(m / 60).phase;
      if (seq[seq.length - 1] !== p) seq.push(p);
    }
    expect(seq).toEqual(['night', 'morning', 'day', 'evening', 'night']);
    expect(glyphAt(SUNRISE_H).phase).toBe('night');
    expect(glyphAt(SUNRISE_H + 1 / 12).phase).toBe('morning');
    expect(glyphAt(MORNING_ENDS_H - 1 / 12).phase).toBe('morning');
    expect(glyphAt(MORNING_ENDS_H).phase).toBe('day');
    expect(glyphAt(EVENING_BEGINS_H - 1 / 12).phase).toBe('day');
    expect(glyphAt(EVENING_BEGINS_H).phase).toBe('evening');
    expect(glyphAt(SUNSET_H - 1 / 12).phase).toBe('evening');
    expect(glyphAt(SUNSET_H).phase).toBe('night');
    // Every named moment shows its own picture.
    expect(TIME_STOPS.map((s) => glyphAt(s.hour).phase)).toEqual(['morning', 'day', 'evening', 'night']);
    for (let m = 0; m < 24 * 60; m += 5) expect(glyphAt(m / 60).phase === 'night', `${m}`).toBe(!isDaytime(m / 60));
  });

  it('lifts the sun out of the horizon with its elevation, continuously', () => {
    // On the line at the horizon, clear of it at the band's edge; in between it only
    // ever climbs through the morning and only ever sinks through the evening, in
    // steps no larger than the hour's.
    expect(glyphAt(SUNRISE_H + 1 / 60).lift).toBeLessThan(0.01);
    expect(glyphAt(SUNSET_H - 1 / 60).lift).toBeLessThan(0.01);
    expect(glyphAt(MORNING_ENDS_H - 1 / 60).lift).toBeGreaterThan(0.99);
    expect(glyphAt(EVENING_BEGINS_H + 1 / 60).lift).toBeGreaterThan(0.99);
    expect(glyphAt(12).lift).toBe(1);
    expect(glyphAt(22).lift).toBe(1);
    let prev = 0;
    for (let h = SUNRISE_H + 0.01; h < MORNING_ENDS_H; h += 0.01) {
      const l = glyphAt(h).lift;
      expect(l, `${h}`).toBeGreaterThanOrEqual(prev);
      expect(l - prev, `jump at ${h}`).toBeLessThan(0.02);
      prev = l;
    }
    prev = 1;
    for (let h = EVENING_BEGINS_H + 0.01; h < SUNSET_H; h += 0.01) {
      const l = glyphAt(h).lift;
      expect(l, `${h}`).toBeLessThanOrEqual(prev);
      expect(prev - l, `jump at ${h}`).toBeLessThan(0.02);
      prev = l;
    }
    // It follows the sky, not the clock: at the Morning stop the sun is under half way.
    expect(glyphAt(at('morning')).lift).toBeCloseTo(sunAt(at('morning')).elevationDeg / sunAt(MORNING_ENDS_H).elevationDeg, 3);
    expect(glyphAt(at('morning')).lift).toBeCloseTo(0.44, 2);
    expect(glyphAt(at('evening')).lift).toBeCloseTo(0.295, 3);
  });

  it('says the picture after the clock, and nothing extra by day', () => {
    expect(phaseWords('morning', false)).toBe(', morning');
    expect(phaseWords('day', false)).toBe('');
    expect(phaseWords('evening', false)).toBe(', evening');
    expect(phaseWords('night', false)).toBe(', night');
    expect(phaseWords('night', true)).toBe(', overcast');
  });
});

describe('the glyph\'s paint, read from the stylesheet', () => {
  const css = readFileSync(join(process.cwd(), 'app', 'globals.css'), 'utf8');
  const hex = (n: string) => new RegExp(`--${n}: (#[0-9A-Fa-f]{6})`).exec(css)![1];
  const lum = (h: string) => {
    const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const contrast = (a: string, b: string) => {
    const [p, q] = [lum(a), lum(b)].sort((m, n) => n - m);
    return (p + 0.05) / (q + 0.05);
  };
  const hue = (h: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    return Math.atan2(Math.sqrt(3) * (g - b), 2 * r - g - b);
  };

  it('warms the sun toward the horizon from tokens, evening warmer than morning', () => {
    expect(css).toMatch(/\.celestial--morning \{ color: color-mix\(in srgb, var\(--sun-rise\) calc\(\(1 - var\(--lift\)\) \* 100%\), var\(--sun\)\); \}/);
    expect(css).toMatch(/\.celestial--evening \{ color: color-mix\(in srgb, var\(--sun-set\) calc\(\(1 - var\(--lift\)\) \* 100%\), var\(--sun\)\); \}/);
    for (const t of ['sun-rise', 'sun-set']) expect(contrast(hex(t), hex('paper')), t).toBeGreaterThanOrEqual(3);
    // "Warmer" as a hue: the evening sun sits nearer red than the morning one, and
    // both nearer than the day's gold.
    expect(hue(hex('sun-set'))).toBeLessThan(hue(hex('sun-rise')));
    expect(hue(hex('sun-rise'))).toBeLessThan(hue(hex('sun')));
  });

  it('draws sunrise and sunset off --lift', () => {
    expect(css).toMatch(/\.celestial__body \{[^}]*transform: translateY\(calc\(\(1 - var\(--lift\)\) \* 4\.5px\)\)/);
    expect(css).toMatch(/\.celestial__horizon \{ opacity: calc\(1 - var\(--lift\)\); \}/);
    expect(css).toMatch(/\.celestial__under \{ fill-opacity: var\(--lift\); \}/);
    // The moon is the pill's colour, not the sun's.
    expect(css).toMatch(/\.celestial--night \{ color: inherit; \}/);
  });

  it('animates none of it under reduced motion', () => {
    const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce) {\n  .day-strip, .day-strip__handle'));
    const block = reduced.slice(0, reduced.indexOf('transition: none;'));
    for (const c of ['.celestial,', '.celestial__rays', '.celestial__disc', '.celestial__bite', '.celestial__body', '.celestial__horizon', '.celestial__under']) {
      expect(block, c).toContain(c);
    }
  });
});

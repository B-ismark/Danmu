import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LIGHTINGS } from '@/lib/store';
import {
  SKY_KEYS,
  SUNRISE_H,
  SUNSET_H,
  NOON_H,
  TIME_STOPS,
  formatClock,
  keyAt,
  legacyLighting,
  lightingAt,
  mixHex,
  moonAt,
  skyAt,
  sunAt,
  wrapHour,
} from '@/lib/lighting-moods';
import { THEMES } from '@/lib/themes';

// The light is a CLOCK now: one hour (0–24) that the sky, the sun and the moon are
// all derived from, plus Overcast, which ignores it. It used to be five fixed moods
// and the old ids are still out there in localStorage and in live undo stacks, so
// half of this file is about the clock and half about getting from the old world to
// it without anyone's room going dark.
//
// What the compiler cannot see, and so what is pinned here:
//
//   1. A seam. The sky is blended between keyframes; a table out of order, or a
//      blend that does not wrap at midnight, jumps — and a jump is invisible in any
//      screenshot of one moment. So the day is walked minute by minute.
//   2. A sun that shines up through the floor, or a key light that switches on at
//      full strength the instant it clears the horizon.
//   3. The named stops drifting off the pictures they replaced.
//   4. A retired id that maps to nothing, which used to take the scene down on the
//      first paint (`Room` indexed a mood table by it).

const src = (...p: string[]) => readFileSync(join(__dirname, '..', ...p), 'utf8');
const PICKER = src('components', 'studio', 'LightingPicker.tsx');

/** A colour distance, 0–441, crude and sufficient for "did this jump". */
function dist(a: string, b: string): number {
  const n = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [n(a), n(b)];
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

describe('the two kinds of light', () => {
  it('are daylight, which follows the clock, and overcast, which does not', () => {
    expect([...LIGHTINGS]).toEqual(['daylight', 'overcast']);
    const a = lightingAt('overcast', 7, 0);
    const b = lightingAt('overcast', 22, 0);
    expect(a).toEqual(b);
    expect(a.key?.body).toBe('studio');
    expect(lightingAt('daylight', 7, 0)).not.toEqual(lightingAt('daylight', 22, 0));
  });
});

describe('the day', () => {
  it('puts the sun up between sunrise and sunset and nowhere else', () => {
    // Walked at five-minute steps, the resolution a drag lands on.
    let up = 0;
    for (let m = 0; m < 24 * 60; m += 5) {
      const h = m / 60;
      const inDay = h > SUNRISE_H && h < SUNSET_H;
      expect(sunAt(h).elevationDeg > 0, `${formatClock(h)}`).toBe(inDay);
      if (inDay) up++;
    }
    // 06:00–19:30 exclusive at 5-minute steps.
    expect(up).toBe(161);
  });

  it('peaks due south at solar noon, and rises and sets on the two sides of north', () => {
    const noon = sunAt(NOON_H);
    expect(noon.azimuthDeg).toBeCloseTo(180, 9);
    expect(noon.elevationDeg).toBeCloseTo(60, 9);
    expect(sunAt(SUNRISE_H).azimuthDeg).toBeLessThan(90);
    expect(sunAt(SUNSET_H).azimuthDeg).toBeGreaterThan(270);
  });

  it('brings the moon round the same arc through the night', () => {
    expect(moonAt(12).elevationDeg).toBeLessThan(0);
    expect(moonAt(0).elevationDeg).toBeGreaterThan(20);
    // Never both up: the key light is one body at a time.
    for (let m = 0; m < 24 * 60; m += 5) {
      const h = m / 60;
      expect(sunAt(h).elevationDeg > 0 && moonAt(h).elevationDeg > 0, formatClock(h)).toBe(false);
    }
  });

  it('fades the key light in at the horizon instead of switching it on', () => {
    // The largest step in key intensity between neighbouring minutes, all day. A
    // light that snaps on at 0.25 as the sun clears the horizon is the defect.
    let worst = 0;
    let prev = keyAt(0, 0)?.intensity ?? 0;
    for (let m = 1; m <= 24 * 60; m++) {
      const cur = keyAt(m / 60, 0)?.intensity ?? 0;
      worst = Math.max(worst, Math.abs(cur - prev));
      prev = cur;
    }
    expect(worst).toBeLessThan(0.02);
  });

  it('never points a key light below the floor', () => {
    for (let m = 0; m < 24 * 60; m += 5) {
      const k = keyAt(m / 60, 0);
      if (k) expect(k.dir[1], formatClock(m / 60)).toBeGreaterThan(0);
    }
  });

  it('turns the whole day with the room, and half a turn reverses it', () => {
    const at0 = keyAt(10, 0)!;
    const at180 = keyAt(10, 180)!;
    expect(at0.dir[0]).toBeCloseTo(-at180.dir[0], 12);
    expect(at0.dir[2]).toBeCloseTo(-at180.dir[2], 12);
    expect(at0.dir[1]).toBeCloseTo(at180.dir[1], 12);
    expect(lightingAt('overcast', 10, 0).key).toEqual(lightingAt('overcast', 10, 137).key);
  });
});

describe('the sky', () => {
  it('has its keyframes in order, starting at midnight', () => {
    expect(SKY_KEYS[0].h).toBe(0);
    for (let i = 1; i < SKY_KEYS.length; i++) expect(SKY_KEYS[i].h).toBeGreaterThan(SKY_KEYS[i - 1].h);
    expect(SKY_KEYS[SKY_KEYS.length - 1].h).toBeLessThan(24);
  });

  it('lands exactly on each keyframe', () => {
    for (const k of SKY_KEYS) {
      const s = skyAt(k.h);
      expect(s.bg, `${k.h}h`).toBe(k.bg.toLowerCase());
      expect(s.exposure).toBeCloseTo(k.exposure, 12);
    }
  });

  it('has no seam anywhere in the day, midnight included', () => {
    // The largest background step between neighbouring minutes. The dusk rows are
    // the steepest part of the day by design — paper to near-black in about three
    // hours — and that is ~1.8 per minute at the steepest; a seam is a whole row's
    // difference in one step, which is well over 100.
    let worst = 0;
    let at = '';
    for (let m = 0; m < 24 * 60; m++) {
      const d = dist(skyAt(m / 60).bg, skyAt((m + 1) / 60).bg);
      if (d > worst) {
        worst = d;
        at = formatClock(m / 60);
      }
    }
    expect(worst, `steepest minute at ${at}`).toBeLessThan(6);
  });

  it('is darker at night than at noon, and lets the lamps do the work after dark', () => {
    expect(skyAt(0).hemi[2]).toBeLessThan(skyAt(NOON_H).hemi[2] / 4);
    expect(skyAt(22.2).envMul).toBeLessThan(skyAt(NOON_H).envMul / 2);
  });
});

describe('the named times', () => {
  it('are four, in order, and each in its own part of the day', () => {
    expect(TIME_STOPS.map((t) => t.id)).toEqual(['morning', 'midday', 'evening', 'night']);
    const [morning, midday, evening, night] = TIME_STOPS.map((t) => t.hour);
    expect(sunAt(morning).elevationDeg).toBeGreaterThan(5);
    expect(sunAt(morning).azimuthDeg).toBeLessThan(135);
    expect(sunAt(midday).elevationDeg).toBeGreaterThan(50);
    expect(sunAt(evening).elevationDeg).toBeGreaterThan(5);
    expect(sunAt(evening).azimuthDeg).toBeGreaterThan(225);
    expect(sunAt(night).elevationDeg).toBeLessThan(0);
  });

  it('each have a glyph and a hint in the picker', () => {
    // The one source-level check: `STOP_UI` is a Record keyed by stop id, which is
    // the exhaustiveness check, and its hint is the half of the accessible name that
    // says "from the east" — no glyph conveys a direction.
    const start = PICKER.indexOf('const STOP_UI: Record<TimeStopId, { hint: string; icon: IconName }> = {');
    expect(start).toBeGreaterThan(-1);
    const inner = PICKER.slice(start, PICKER.indexOf('\n};', start));
    const named = [...inner.matchAll(/^ {2}(\w+): \{ hint: '[^']+', icon: '[^']+' \}/gm)].map((m) => m[1]);
    expect(named).toEqual(TIME_STOPS.map((t) => t.id));
  });
});

describe('the clock face', () => {
  it('reads 24-hour, zero-padded, and wraps at midnight', () => {
    expect(formatClock(7.6)).toBe('07:36');
    expect(formatClock(18.5)).toBe('18:30');
    expect(formatClock(23.999)).toBe('00:00');
    expect(formatClock(-0.5)).toBe('23:30');
    expect(wrapHour(25)).toBe(1);
  });

  it('blends colours through their midpoint', () => {
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(mixHex('#102030', '#102030', 0.3)).toBe('#102030');
  });
});

describe('getting from five moods to the clock', () => {
  it('maps every retired mood onto the stop that is its picture', () => {
    expect(legacyLighting('day')).toEqual({ lighting: 'daylight', hour: 12.8 });
    expect(legacyLighting('sunrise')).toEqual({ lighting: 'daylight', hour: 7.6 });
    expect(legacyLighting('sunset')).toEqual({ lighting: 'daylight', hour: 18.5 });
    expect(legacyLighting('evening')).toEqual({ lighting: 'daylight', hour: 22.2 });
    expect(legacyLighting('cool')).toEqual({ lighting: 'overcast' });
    // Each old sun stop lands on a named time, so the picker shows it pressed.
    for (const id of ['day', 'sunrise', 'sunset', 'evening']) {
      expect(TIME_STOPS.map((t) => t.hour), id).toContain(legacyLighting(id)!.hour);
    }
  });

  it('refuses what it does not know rather than guessing', () => {
    // `'sun'` was a latitude and a clock — there is no honest "the one you meant".
    for (const junk of ['sun', 'noon', 'golden', '', 42, null, undefined, {}]) {
      expect(legacyLighting(junk), String(junk)).toBeNull();
    }
    for (const id of LIGHTINGS) expect(legacyLighting(id)).toEqual({ lighting: id });
  });

  it('gives every daylight theme an hour, and no overcast one', () => {
    for (const t of THEMES) {
      if (t.lighting === 'daylight') expect(t.hour, t.id).toBeTypeOf('number');
      else expect(t.hour, t.id).toBeUndefined();
    }
  });
});

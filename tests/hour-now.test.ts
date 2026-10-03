// @vitest-environment jsdom
//
// The light opens at the person's own clock. Two halves, and either alone is the
// defect: the first hour has to BE the clock's, and the hour must not be remembered,
// or yesterday's scrub comes back over today's clock on every reload.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hourNow } from '@/lib/lighting-moods';

const KEY = 'danmu-studio-prefs';
const at = (h: number, m: number) => new Date(2026, 9, 3, h, m, 0);

describe('hourNow', () => {
  it('reads the local clock to the scrub’s five minutes', () => {
    expect(hourNow(at(7, 36))).toBeCloseTo(7 + 35 / 60, 9);
    expect(hourNow(at(7, 38))).toBeCloseTo(7 + 40 / 60, 9);
    expect(hourNow(at(19, 0))).toBe(19);
    expect(hourNow(at(0, 0))).toBe(0);
  });

  it('folds 23:58 to midnight rather than to 24', () => {
    expect(hourNow(at(23, 58))).toBe(0);
  });
});

describe('the studio opens at the clock', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(at(20, 10));
    vi.resetModules();
    localStorage.clear();
  });
  afterEach(() => vi.useRealTimers());

  it('on a fresh browser', async () => {
    const { useStudio } = await import('@/lib/store');
    expect(useStudio.getState().hour).toBeCloseTo(20 + 10 / 60, 9);
  });

  it('and not at the hour scrubbed to last time', async () => {
    localStorage.setItem(KEY, JSON.stringify({ state: { lighting: 'daylight', hour: 9, quality: 'high' }, version: 0 }));
    const { useStudio } = await import('@/lib/store');
    expect(useStudio.getState().hour).toBeCloseTo(20 + 10 / 60, 9);
    // The rest of the preferences still come back.
    expect(useStudio.getState().quality).toBe('high');
  });

  it('does not write the hour down', async () => {
    const { useStudio } = await import('@/lib/store');
    useStudio.getState().setHour(9);
    const saved = JSON.parse(localStorage.getItem(KEY)!).state;
    expect(saved).not.toHaveProperty('hour');
    expect(saved.lighting).toBe('daylight');
  });

  it('a retired mood still lands on its picture', async () => {
    localStorage.setItem(KEY, JSON.stringify({ state: { lighting: 'sunset' }, version: 0 }));
    const { useStudio } = await import('@/lib/store');
    expect(useStudio.getState().hour).toBe(18.5);
  });
});

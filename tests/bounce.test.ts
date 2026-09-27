import { describe, expect, it } from 'vitest';
import { BOUNCE_GAIN, MAX_GLAZING_RATIO, bounceIntensity, glazingArea } from '@/lib/bounce';

const ROOM_6x4: [number, number][] = [[-3, -2], [3, -2], [3, 2], [-3, 2]];
const win = (w = 1200, h = 1200) => ({ shape: 'window', wallMounted: true, dimMM: [w, 60, h] });

describe('glazingArea', () => {
  it('sums wall-mounted windows by width × height ([W, D, H])', () => {
    expect(glazingArea([win(), win(1000, 1500)])).toBeCloseTo(1.44 + 1.5, 9);
  });
  it('ignores doors, loose windows and everything else', () => {
    expect(
      glazingArea([
        { shape: 'door', wallMounted: true, dimMM: [900, 40, 2100] },
        { ...win(), wallMounted: false },
        { shape: 'painting', wallMounted: true, dimMM: [800, 30, 600] },
      ]),
    ).toBe(0);
  });
});

describe('bounceIntensity', () => {
  it('is the key times the gain times the glazing ratio — the calibrated case', () => {
    // Two catalogue windows in a 6 × 4 room: 2.88 / 24 = 0.12.
    expect(bounceIntensity(1, 2.88, ROOM_6x4)).toBeCloseTo(BOUNCE_GAIN * 0.12, 9);
    expect(BOUNCE_GAIN).toBe(3);
  });
  it('scales with the key light, so Evening stays dim', () => {
    expect(bounceIntensity(0.12, 2.88, ROOM_6x4)).toBeCloseTo(0.12 * BOUNCE_GAIN * 0.12, 9);
  });
  it('gives a windowless room nothing, and no key nothing', () => {
    expect(bounceIntensity(1.4, 0, ROOM_6x4)).toBe(0);
    expect(bounceIntensity(0, 2.88, ROOM_6x4)).toBe(0);
    expect(bounceIntensity(1.4, 2.88, [])).toBe(0);
    // A NaN light intensity is a black room, not a dim one.
    expect(bounceIntensity(1.4, Number.NaN, ROOM_6x4)).toBe(0);
  });
  it('stops growing once the room is effectively all glass', () => {
    expect(MAX_GLAZING_RATIO).toBe(0.35);
    const capped = bounceIntensity(1, 24 * MAX_GLAZING_RATIO, ROOM_6x4);
    expect(bounceIntensity(1, 24, ROOM_6x4)).toBeCloseTo(capped, 9);
    expect(bounceIntensity(1, 24 * 0.2, ROOM_6x4)).toBeLessThan(capped);
  });
});

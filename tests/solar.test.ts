import { describe, it, expect } from 'vitest';
import { sunDirection, daylightKelvin } from '@/lib/solar';

// What is left of the sun after the collapse, and it is the half that was never
// a guess: an axis convention and a colour ramp.
//
// This suite used to be 221 lines, most of it holding a NOAA solar-position
// calculator to account — declination at the solstices, the solar-noon altitude
// identity, the equation of time inside its real range, London on a known date.
// Every one of those passed. They went with the calculator, which was deleted for
// a reason no test could have caught: see `lib/solar.ts`'s header. A correct
// answer to a question the user cannot check is still the wrong feature.
//
// The two functions below carry the four fixed presets in `Room`'s `LIGHTING`
// table. `tests/lighting-moods.test.ts` holds that table to this one.

describe('sunDirection', () => {
  it('maps compass azimuth onto the scene’s axes', () => {
    // Scene axes: +X east, +Z south, so scene north is -Z.
    const [ex, , ez] = sunDirection(0.001, 90)!;
    expect(ex).toBeCloseTo(1, 3);
    expect(ez).toBeCloseTo(0, 3);
    const [sx, , sz] = sunDirection(0.001, 180)!;
    expect(sx).toBeCloseTo(0, 3);
    expect(sz).toBeCloseTo(1, 3);
    const [nx, , nz] = sunDirection(0.001, 0)!;
    expect(nx).toBeCloseTo(0, 3);
    expect(nz).toBeCloseTo(-1, 3);
  });

  it('is a unit vector pointing up', () => {
    const v = sunDirection(35, 210)!;
    expect(Math.hypot(...v)).toBeCloseTo(1, 9);
    expect(v[1]).toBeGreaterThan(0);
  });

  it('turns with the room’s compass bearing', () => {
    // A southern sun in a room whose north faces 90 degrees east of true north
    // comes from the room's own west.
    const turned = sunDirection(30, 180, 90)!;
    const plain = sunDirection(30, 90)!;
    expect(turned[0]).toBeCloseTo(plain[0], 9);
    expect(turned[2]).toBeCloseTo(plain[2], 9);
  });

  it('refuses to shine up through the floor', () => {
    expect(sunDirection(0, 180)).toBeNull();
    expect(sunDirection(-12, 180)).toBeNull();
  });
});


describe('daylightKelvin', () => {
  it('is warm at the horizon and neutral overhead', () => {
    expect(daylightKelvin(0)).toBe(2000);
    expect(daylightKelvin(60)).toBe(5600);
    expect(daylightKelvin(89)).toBe(5600);
  });

  it('rises monotonically', () => {
    let prev = -1;
    for (let a = 0; a <= 60; a += 5) {
      const k = daylightKelvin(a);
      expect(k).toBeGreaterThan(prev);
      prev = k;
    }
  });
});

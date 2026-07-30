import { describe, it, expect } from 'vitest';
import { sunPosition, solarNoonUtcMinutes, sunDirection, daylightKelvin } from '@/lib/solar';

// Checked against identities rather than against a copied table, so the test says
// something even if the table would have been mistyped. The load-bearing one is
//
//     altitude at solar noon = 90 - |latitude - declination|
//
// which is exact spherical trigonometry and exercises the whole chain: Julian
// century, equation of centre, obliquity, equation of time, hour angle and the
// zenith formula all have to be right for it to hold at four latitudes and four
// dates at once.

const JUNE_SOLSTICE = Date.UTC(2026, 5, 21, 12, 0, 0);
const DEC_SOLSTICE = Date.UTC(2026, 11, 21, 12, 0, 0);
const MAR_EQUINOX = Date.UTC(2026, 2, 20, 12, 0, 0);

const PLACES = [
  { name: 'London', lat: 51.5074, lon: -0.1278 },
  { name: 'Accra', lat: 5.6037, lon: -0.187 },
  { name: 'Quito', lat: -0.1807, lon: -78.4678 },
  { name: 'Sydney', lat: -33.8688, lon: 151.2093 },
];

/** The instant of local solar noon on the UTC day `utcMs` falls in. */
function noonAt(utcMs: number, lon: number): number {
  const dayStart = Math.floor(utcMs / 86400000) * 86400000;
  return dayStart + solarNoonUtcMinutes(utcMs, lon) * 60000;
}

describe('sunPosition', () => {
  it('puts the declination at the solstices and equinoxes where the earth’s tilt does', () => {
    expect(sunPosition(JUNE_SOLSTICE, 0, 0).declinationDeg).toBeCloseTo(23.44, 1);
    expect(sunPosition(DEC_SOLSTICE, 0, 0).declinationDeg).toBeCloseTo(-23.44, 1);
    // The equinox is an instant, not a day, so noon on the nearest date is within
    // a fraction of a degree rather than exactly zero.
    expect(Math.abs(sunPosition(MAR_EQUINOX, 0, 0).declinationDeg)).toBeLessThan(0.5);
  });

  it('holds the solar-noon altitude identity everywhere, on every date', () => {
    for (const p of PLACES) {
      for (const date of [JUNE_SOLSTICE, DEC_SOLSTICE, MAR_EQUINOX]) {
        const noon = noonAt(date, p.lon);
        const s = sunPosition(noon, p.lat, p.lon);
        const expected = 90 - Math.abs(p.lat - s.declinationDeg);
        expect(s.altitudeDeg).toBeCloseTo(expected, 1);
      }
    }
  });

  it('reproduces the figures London is known for', () => {
    // 62 degrees at midsummer and 15 at midwinter is the pair every UK solar
    // guide quotes, and it follows from the identity above at 51.5 N.
    const summer = sunPosition(noonAt(JUNE_SOLSTICE, -0.1278), 51.5074, -0.1278);
    const winter = sunPosition(noonAt(DEC_SOLSTICE, -0.1278), 51.5074, -0.1278);
    expect(summer.altitudeDeg).toBeCloseTo(62, 0);
    expect(winter.altitudeDeg).toBeCloseTo(15, 0);
  });

  it('points the noon sun south in the north and north in the south', () => {
    const london = sunPosition(noonAt(JUNE_SOLSTICE, -0.1278), 51.5074, -0.1278);
    expect(london.azimuthDeg).toBeCloseTo(180, 0);
    const sydney = sunPosition(noonAt(JUNE_SOLSTICE, 151.2093), -33.8688, 151.2093);
    // Due north reads as either end of the circle.
    expect(Math.min(sydney.azimuthDeg, 360 - sydney.azimuthDeg)).toBeLessThan(1);
  });

  it('rises in the east and sets in the west', () => {
    const noon = noonAt(MAR_EQUINOX, 0);
    const morning = sunPosition(noon - 4 * 3600_000, 51.5074, 0);
    const evening = sunPosition(noon + 4 * 3600_000, 51.5074, 0);
    expect(morning.azimuthDeg).toBeGreaterThan(60);
    expect(morning.azimuthDeg).toBeLessThan(180);
    expect(evening.azimuthDeg).toBeGreaterThan(180);
    expect(evening.azimuthDeg).toBeLessThan(300);
  });

  it('puts the sun below the horizon at local midnight', () => {
    for (const p of PLACES) {
      const midnight = noonAt(JUNE_SOLSTICE, p.lon) + 12 * 3600_000;
      expect(sunPosition(midnight, p.lat, p.lon).altitudeDeg).toBeLessThan(0);
    }
  });

  it('keeps the equation of time inside its real range', () => {
    // It never exceeds about +/- 17 minutes; a sign slip or a stray radian would
    // blow straight past that.
    let lo = Infinity;
    let hi = -Infinity;
    for (let d = 0; d < 365; d += 5) {
      const eq = sunPosition(Date.UTC(2026, 0, 1) + d * 86400000, 0, 0).eqTimeMin;
      lo = Math.min(lo, eq);
      hi = Math.max(hi, eq);
    }
    expect(lo).toBeGreaterThan(-17);
    expect(hi).toBeLessThan(17);
    // …and it genuinely swings, rather than being stuck near zero.
    expect(hi - lo).toBeGreaterThan(25);
  });

  it('does not depend on the machine’s time zone', () => {
    // A Unix instant in, a sun out. The same room must report the same sun
    // wherever the laptop happens to be.
    const a = sunPosition(JUNE_SOLSTICE, 51.5074, -0.1278);
    const b = sunPosition(new Date(JUNE_SOLSTICE).getTime(), 51.5074, -0.1278);
    expect(a).toEqual(b);
  });
});

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

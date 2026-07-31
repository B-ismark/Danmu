// Where the sun is, from first principles.
//
// This is the one thing in Danmu that a model could not do better: the sun's
// position is a solved problem in astronomy, accurate to a hundredth of a degree
// from a page of arithmetic, with no data to download and nothing to guess. It
// sits on the correct side of the trust boundary by construction — ask it for
// 3 pm on 21 June in Accra and it answers, the same way, forever.
//
// The algorithm is NOAA's solar-position calculator (itself Meeus, *Astronomical
// Algorithms*, ch. 25): mean longitude and anomaly from the Julian century, the
// equation of centre for the orbit's eccentricity, obliquity for the tilt, and the
// equation of time for the difference between the clock and the sky. Good to
// ~0.01° for years within a century or so of 2000, which is far finer than the
// sun's own half-degree disc.
//
// Two conventions, both easy to get backwards and both pinned by tests:
//   · **Azimuth is measured from true north, clockwise** — N 0°, E 90°, S 180°.
//   · **The scene is not the compass.** Danmu's +X is east and +Z is south, so a
//     room's own north depends on which way the user says it faces; `sunDirection`
//     takes that bearing and returns a vector in scene axes.

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

/** Unix epoch as a Julian Day number. */
const JD_UNIX_EPOCH = 2440587.5;
const MS_PER_DAY = 86400000;

export type SunPosition = {
  /** Degrees above the horizon. Negative when the sun is down. */
  altitudeDeg: number;
  /** Degrees clockwise from true north. */
  azimuthDeg: number;
  /** The sun's declination — its latitude on the celestial sphere. ±23.44° at the
   *  solstices, 0 at the equinoxes. */
  declinationDeg: number;
  /** Equation of time, minutes: true solar time minus mean (clock) solar time. */
  eqTimeMin: number;
};

/** Julian centuries since J2000.0. */
function julianCentury(utcMs: number): number {
  return (utcMs / MS_PER_DAY + JD_UNIX_EPOCH - 2451545) / 36525;
}

/** Declination, obliquity and the equation of time — everything that depends on
 *  the date but not on where you are standing. */
function solarDate(t: number): { declRad: number; eqTimeMin: number } {
  // Geometric mean longitude and mean anomaly of the sun, degrees.
  const l0 = (280.46646 + t * (36000.76983 + t * 0.0003032)) % 360;
  const m = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);

  // Equation of the centre: the correction from a circular orbit to the real
  // elliptical one. Without it the sun is up to two degrees out of place.
  const mRad = m * RAD;
  const c =
    Math.sin(mRad) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
    Math.sin(2 * mRad) * (0.019993 - 0.000101 * t) +
    Math.sin(3 * mRad) * 0.000289;

  const trueLong = l0 + c;
  const omega = (125.04 - 1934.136 * t) * RAD;
  // Apparent longitude — aberration and nutation.
  const lambda = (trueLong - 0.00569 - 0.00478 * Math.sin(omega)) * RAD;

  const eps0 = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const eps = (eps0 + 0.00256 * Math.cos(omega)) * RAD;

  const declRad = Math.asin(Math.sin(eps) * Math.sin(lambda));

  const y = Math.tan(eps / 2) ** 2;
  const l0Rad = l0 * RAD;
  const eqTimeMin =
    4 *
    DEG *
    (y * Math.sin(2 * l0Rad) -
      2 * e * Math.sin(mRad) +
      4 * e * y * Math.sin(mRad) * Math.cos(2 * l0Rad) -
      0.5 * y * y * Math.sin(4 * l0Rad) -
      1.25 * e * e * Math.sin(2 * mRad));

  return { declRad, eqTimeMin };
}

/** The sun's position in the sky, for a UTC instant and a place on earth.
 *
 *  `utcMs` is a Unix timestamp so nothing here depends on the machine's time
 *  zone — a room that reports 3 pm in Accra must report the same sun on a laptop
 *  in Berlin. */
export function sunPosition(utcMs: number, latDeg: number, lonDeg: number): SunPosition {
  const t = julianCentury(utcMs);
  const { declRad, eqTimeMin } = solarDate(t);

  const utcMinutes = ((utcMs % MS_PER_DAY) + MS_PER_DAY) % MS_PER_DAY / 60000;
  // True solar time: the clock, corrected for the orbit and for how far east the
  // place is of its meridian. 4 minutes per degree of longitude.
  const trueSolarMin = utcMinutes + eqTimeMin + 4 * lonDeg;
  // Hour angle: 0 at local solar noon, negative in the morning.
  let hourAngle = trueSolarMin / 4 - 180;
  if (hourAngle < -180) hourAngle += 360;
  if (hourAngle > 180) hourAngle -= 360;
  const haRad = hourAngle * RAD;

  const latRad = latDeg * RAD;
  const cosZenith = Math.min(
    1,
    Math.max(
      -1,
      Math.sin(latRad) * Math.sin(declRad) + Math.cos(latRad) * Math.cos(declRad) * Math.cos(haRad),
    ),
  );
  const zenith = Math.acos(cosZenith);
  const altitudeDeg = 90 - zenith * DEG;

  let azimuthDeg: number;
  const sinZenith = Math.sin(zenith);
  if (sinZenith < 1e-9) {
    // Sun exactly overhead: azimuth is undefined, and 180 is the value that keeps
    // a caller's shadow direction continuous through the singularity.
    azimuthDeg = 180;
  } else {
    const cosAz = Math.min(
      1,
      Math.max(-1, (Math.sin(latRad) * cosZenith - Math.sin(declRad)) / (Math.cos(latRad) * sinZenith)),
    );
    const az = Math.acos(cosAz) * DEG;
    // acos gives the angle from south; the branch depends on morning vs afternoon.
    azimuthDeg = hourAngle > 0 ? (az + 180) % 360 : (540 - az) % 360;
  }

  return { altitudeDeg, azimuthDeg, declinationDeg: declRad * DEG, eqTimeMin };
}

/** UTC minutes past midnight at which the sun crosses the local meridian.
 *
 *  Useful on its own — it is how a caller turns "midday" into an instant without
 *  pretending the clock and the sky agree, which they do not by up to a quarter of
 *  an hour. */
export function solarNoonUtcMinutes(utcMs: number, lonDeg: number): number {
  const { eqTimeMin } = solarDate(julianCentury(utcMs));
  return 720 - 4 * lonDeg - eqTimeMin;
}

/** A unit vector in SCENE axes pointing from the room toward the sun.
 *
 *  Scene axes are +X east, +Z south (see `lib/footprint.ts`), so scene north is
 *  -Z. `northBearingDeg` is the compass bearing the room's own north edge faces:
 *  0 when the room is square to the compass, and it rotates the sun round the
 *  room by exactly that much.
 *
 *  Returns null below the horizon rather than a downward vector — a light shining
 *  up through the floor is worse than no light, and "the sun is not up" is
 *  something the caller has to say out loud anyway. */
export function sunDirection(
  altitudeDeg: number,
  azimuthDeg: number,
  northBearingDeg = 0,
): [number, number, number] | null {
  if (altitudeDeg <= 0) return null;
  const alt = altitudeDeg * RAD;
  const az = (azimuthDeg - northBearingDeg) * RAD;
  const horizontal = Math.cos(alt);
  return [horizontal * Math.sin(az), Math.sin(alt), -horizontal * Math.cos(az)];
}

// ── The calendar bridge ──────────────────────────────────────────────────────
//
// The sun mood asks its question in local civil time — "4 pm on 12 December" —
// while `sunPosition` answers about UTC instants. Both directions of that
// conversion live here, side by side, for the same reason `toRecord`/`fromRecord`
// do: a hand-written read and a hand-written write drift. They already had. The
// View panel formatted its date label against a fixed non-leap year while the
// scene built its instant from the real one, so through every leap year after
// 28 February the label read a day later than the light it described.

/** 365, or 366 in a leap year. */
export function daysInYear(year: number): number {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 366 : 365;
}

/** The UTC instant for a day-of-year and a local clock time.
 *
 *  Built through the platform's own Date so the browser's zone and its DST rules
 *  do the conversion — the alternative is deriving an offset from longitude, which
 *  is off by an hour for half the year in any country that puts its clocks
 *  forward. The assumption this makes is that the room is in the same time zone as
 *  the person looking at it, which is true of a room you live in. */
export function localInstant(
  dayOfYear: number,
  minutes: number,
  year: number = new Date().getFullYear(),
): number {
  const day = Math.min(daysInYear(year), Math.max(1, Math.round(dayOfYear)));
  const d = new Date(year, 0, 1, 0, 0, 0, 0);
  d.setDate(day);
  d.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return d.getTime();
}

/** What the user's own clock reads, in the terms the sun mood stores.
 *
 *  A left inverse of `localInstant` to the minute, which is the whole point: it is
 *  what lets "Now" light the room with the light that is actually outside the
 *  window, instead of an hour off it.
 *
 *  The day count rounds rather than floors because a clock change makes one local
 *  day 23 hours long and another 25, and flooring loses a day every spring. */
export function localClock(now: number = Date.now()): { dayOfYear: number; minutes: number } {
  const d = new Date(now);
  const midnight = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const jan1 = new Date(d.getFullYear(), 0, 1).getTime();
  return {
    dayOfYear: Math.round((midnight - jan1) / MS_PER_DAY) + 1,
    minutes: d.getHours() * 60 + d.getMinutes(),
  };
}

/** Warm-to-white daylight for a given sun altitude, as a hex colour.
 *
 *  Not a physical model of atmospheric scattering — a two-point interpolation
 *  between the numbers photographers already use: ~2000 K at the horizon, ~5600 K
 *  once the sun is well up. It goes through `hexFromKelvin` so it lands on the same
 *  Planckian locus as every lamp in the room, which is what stops a sunlit room and
 *  a lamplit one looking like they were coloured by different people. */
export function daylightKelvin(altitudeDeg: number): number {
  const a = Math.min(60, Math.max(0, altitudeDeg));
  return Math.round(2000 + (5600 - 2000) * (a / 60) ** 0.5);
}

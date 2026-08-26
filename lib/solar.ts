// Sunlight, as the two things a room can actually show you: which way it comes
// in, and what colour it is.
//
// This file used to be a full NOAA solar-position calculator (Meeus,
// *Astronomical Algorithms*, ch. 25) — declination, obliquity, the equation of
// time, the lot — driven by a latitude, a longitude, a date and a clock the user
// typed into the View panel. It was accurate to ~0.01°, and that was the problem:
// nobody arranging furniture can verify a hundredth of a degree, or tell a
// correct 4 pm in December from a plausible one. The repo already argues this
// one level down, where it coarsens a geolocation fix to ~11 km because
// "precision the sun cannot use is precision not worth holding"; solar accuracy
// the *user* cannot check is accuracy not worth holding either.
//
// So the four moments that apparatus existed to reach — sunrise, noon, golden
// hour, sunset — are fixed angles in `Room`'s `LIGHTING` table now, and what
// survives here is the part that was never a guess: the axis convention, and the
// warm-to-white ramp shared with the room's own lamps.
//
// One convention, easy to get backwards and pinned by tests:
//   · **Azimuth is measured from true north, clockwise** — N 0°, E 90°, S 180°.
//   · **The scene is not the compass.** Danmu's +X is east and +Z is south, so a
//     room's own north depends on which way the user says it faces; `sunDirection`
//     takes that bearing and returns a vector in scene axes.

const RAD = Math.PI / 180;

/** A unit vector in SCENE axes pointing from the room toward the sun.
 *
 *  Scene axes are +X east, +Z south (see `lib/footprint.ts`), so scene north is
 *  -Z. `northBearingDeg` is the compass bearing the room's own north edge faces:
 *  0 when the room is square to the compass, and it rotates the sun round the
 *  room by exactly that much. That bearing is the one fact about the sun the user
 *  still owns, because it is the only one whose effect is visible at furniture
 *  scale — it changes *which wall* the light comes through.
 *
 *  Returns null below the horizon rather than a downward vector — a light shining
 *  up through the floor is worse than no light, and "the sun is not up" is
 *  something the caller has to say out loud anyway. Every shipped preset is above
 *  it, but the guard stays: it is what makes the return type honest for a caller
 *  that computes an elevation rather than reading one off a table. */
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

/** Warm-to-white daylight for a given sun altitude, as a colour temperature.
 *
 *  Not a physical model of atmospheric scattering — a two-point interpolation
 *  between the numbers photographers already use: ~2000 K at the horizon, ~5600 K
 *  once the sun is well up. It goes through `hexFromKelvin` so it lands on the same
 *  Planckian locus as every lamp in the room, which is what stops a sunlit room and
 *  a lamplit one looking like they were coloured by different people.
 *
 *  Kept as a function of elevation rather than folded into each preset as a
 *  hand-typed kelvin: the presets then carry two numbers about the sky and none
 *  about the look, and Sunrise and Sunset cannot drift apart in colour while
 *  agreeing on height. */
export function daylightKelvin(altitudeDeg: number): number {
  const a = Math.min(60, Math.max(0, altitudeDeg));
  return Math.round(2000 + (5600 - 2000) * (a / 60) ** 0.5);
}

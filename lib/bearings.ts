// Averaging bearings, which is not the same as averaging numbers.
//
// This file was `lib/compass.ts`, and most of it was a device-magnetometer read:
// two vendor-specific orientation APIs, an iOS permission gate, a 1.4-second
// sampling window and a failure vocabulary, all so the sun mood could learn which
// way a room points without the user guessing at "my north wall faces 215°".
//
// That went with the rest of the solar apparatus (see the header of
// `lib/solar.ts`), and it went for a reason that was measured rather than
// assumed: the button's own help text read "On a phone: aim its top edge at the
// wall at the top of the plan and tap Compass", while `NarrowViewportBanner`
// matches `(hover: none) and (pointer: coarse)` and shows phone users a go-away
// modal. The one device that could answer was the one device the studio refuses.
//
// What is left is the part that was never about a sensor, and it has a live
// consumer that has nothing to do with the sun: `lib/capture-slots.ts` averages
// the EXIF compass bearings of a set of room photos to work out which wall each
// one is. So the maths stays and the *name* changes with the contents — a module
// called `compass.ts` with no compass in it is the kind of scar this repo keeps
// finding, and the next person to open it cannot tell a deliberate trim from a
// half-finished deletion.
//
// The sign convention it assumes, because getting it wrong is invisible at 0° and
// 180° and inverts every answer on the side walls (the same trap `lib/geometry.ts`
// documents for rotations): a bearing is measured CLOCKWISE FROM TRUE NORTH.

const norm360 = (deg: number) => ((deg % 360) + 360) % 360;

/** Mean of a set of bearings, as a bearing.
 *
 *  Averaging 359° and 1° arithmetically gives 180° — the exact opposite of the
 *  answer. So the samples are averaged as unit vectors and the mean direction read
 *  back off the resultant, whose LENGTH doubles as the agreement measure: 1 is a
 *  set that all pointed the same way, 0 is samples pointing every way at once. */
export function circularMeanDeg(samples: number[]): { deg: number; resultant: number } | null {
  if (!samples.length) return null;
  let sx = 0;
  let sy = 0;
  for (const d of samples) {
    const r = (d * Math.PI) / 180;
    sx += Math.sin(r);
    sy += Math.cos(r);
  }
  sx /= samples.length;
  sy /= samples.length;
  const resultant = Math.hypot(sx, sy);
  // Perfectly opposed samples have no mean direction. Saying so beats returning
  // whatever atan2(0, 0) happens to be.
  if (resultant < 1e-9) return { deg: 0, resultant: 0 };
  // atan2(sin, cos) — not the usual (y, x) — because bearings run clockwise from
  // north, which is exactly what this argument order measures.
  return { deg: norm360((Math.atan2(sx, sy) * 180) / Math.PI), resultant };
}

/** Circular standard deviation in degrees, from a resultant length. `sqrt(-2 ln R)`
 *  is the standard estimator; it is 0 for a set that never disagreed and grows
 *  without bound as the readings scatter. */
export function circularSpreadDeg(resultant: number): number {
  const r = Math.min(1, Math.max(1e-6, resultant));
  // `+ 0` normalises the -0 that a perfectly consistent set produces: log(1) is -0,
  // and -0 survives sqrt and round all the way to a "±-0°" on screen.
  return Math.round((Math.sqrt(-2 * Math.log(r)) * 180) / Math.PI) + 0;
}

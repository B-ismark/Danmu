// Reading the room's bearing off the device's magnetometer.
//
// The sun mood needs one number nothing else in the app can derive: which way the
// room actually points. Latitude comes from `lib/geolocate.ts`, the date and time
// from the clock, and the bearing was the last fact still typed — or rather
// guessed, since "my north wall faces 215°" is not something anyone knows about
// their own living room. A phone knows. It is standing in the room already.
//
// WHAT THE NUMBER MEANS, because a sign error here is invisible at 0° and 180° and
// inverts every answer on the side walls (the same trap `lib/geometry.ts` documents
// for rotations):
//
//   · A compass heading is measured CLOCKWISE FROM TRUE NORTH, and it is the
//     direction the device's TOP EDGE points.
//   · `site.bearingDeg` is the true bearing of the plan's UP direction — scene -Z,
//     the edge drawn at the top of the floor plan (see `sunDirection`).
//   · So the gesture is: aim the phone's top edge at the wall drawn at the top of
//     the plan, and the heading IS the bearing. No conversion, which is the whole
//     reason to define the gesture this way round.
//
// The physical top edge is what the instruction names, deliberately, rather than
// the top of the screen: compensating for `screen.orientation.angle` would be
// correct in the spec and unreliable in practice (the sign of the angle differs
// between devices in landscape), while "the end of the phone with the camera on it"
// is unambiguous in any grip.
//
// Two APIs, because there is no single one:
//   · iOS/Safari — `deviceorientation` carries `webkitCompassHeading`, a true-north
//     heading, and needs `DeviceOrientationEvent.requestPermission()` from inside a
//     user gesture.
//   · Everyone else — `deviceorientationabsolute` (or `deviceorientation` with
//     `absolute === true`) carries `alpha`, measured COUNTER-clockwise from north,
//     so a heading is its complement. A `deviceorientation` event WITHOUT
//     `absolute` is relative to wherever the device was when listening started and
//     is not a compass at all; treating it as one would produce a confident wrong
//     bearing, which is worse than no bearing.
//
// Nothing leaves the device. This is a sensor read, not egress — it needs
// `accelerometer` / `gyroscope` / `magnetometer` in `Permissions-Policy`
// (next.config.mjs) and a secure context, and that is all.

export type CompassFailure =
  | 'unsupported'
  | 'insecure'
  | 'denied'
  /** Orientation events arrived, but with no true-north reference in them. */
  | 'relative'
  /** Readings disagreed so badly that no single bearing is defensible. */
  | 'unstable';

export type CompassResult =
  | {
      ok: true;
      /** True bearing of the plan's up edge, snapped to 5°. */
      bearingDeg: number;
      /** Circular standard deviation of the samples, degrees — how much the needle
       *  wandered while it was being read. */
      spreadDeg: number;
      /** iOS's own accuracy estimate, degrees, when it gives one. */
      accuracyDeg: number | null;
      samples: number;
    }
  | { ok: false; failure: CompassFailure };

const norm360 = (deg: number) => ((deg % 360) + 360) % 360;

/** Mean of a set of bearings, as a bearing.
 *
 *  Averaging 359° and 1° arithmetically gives 180° — the exact opposite of the
 *  answer. So the samples are averaged as unit vectors and the mean direction read
 *  back off the resultant, whose LENGTH doubles as the agreement measure: 1 is a
 *  needle that did not move, 0 is samples pointing every way at once. */
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
 *  is the standard estimator; it is 0 for a needle that never moved and grows
 *  without bound as the readings scatter. */
export function circularSpreadDeg(resultant: number): number {
  const r = Math.min(1, Math.max(1e-6, resultant));
  // `+ 0` normalises the -0 that a perfectly still needle produces: log(1) is -0,
  // and -0 survives sqrt and round all the way to a "±-0°" on screen.
  return Math.round((Math.sqrt(-2 * Math.log(r)) * 180) / Math.PI) + 0;
}

/** To the nearest 5°, which is the dial's own step and about as fine as a phone
 *  magnetometer deserves to be believed. Reporting 217° would be false precision
 *  dressed as a measurement. */
export function snapBearing(deg: number): number {
  return norm360(Math.round(norm360(deg) / 5) * 5);
}

/** Below this resultant the samples disagree by roughly 50° or more, and there is
 *  no bearing worth writing into the room. */
const MIN_AGREEMENT = 0.6;
/** Above this spread the value is used but reported as shaky — a magnetometer next
 *  to a radiator or a laptop reads tens of degrees off. */
export const SHAKY_SPREAD_DEG = 15;

export function compassFailureMessage(failure: CompassFailure): string {
  switch (failure) {
    case 'unsupported':
      return 'No compass on this device — drag the dial instead.';
    case 'insecure':
      return 'The compass needs https (or localhost) — drag the dial instead.';
    case 'denied':
      return 'Motion access was declined. Drag the dial instead.';
    case 'relative':
      return 'This device reports tilt but not direction — drag the dial instead.';
    case 'unstable':
      return 'The needle would not settle. Move away from metal, hold level, try again.';
  }
}

type CompassEvent = DeviceOrientationEvent & {
  webkitCompassHeading?: number;
  webkitCompassAccuracy?: number;
};

type OrientationCtor = typeof DeviceOrientationEvent & {
  requestPermission?: () => Promise<'granted' | 'denied' | 'prompt'>;
};

/** True-north heading of the device's top edge, or null when this event carries no
 *  compass reference. */
function headingOf(e: CompassEvent, absoluteEvent: boolean): number | null {
  const ios = e.webkitCompassHeading;
  // iOS reports -1 rather than absent when the magnetometer has nothing yet.
  if (typeof ios === 'number' && Number.isFinite(ios) && ios >= 0) return norm360(ios);
  if ((absoluteEvent || e.absolute === true) && typeof e.alpha === 'number' && Number.isFinite(e.alpha)) {
    return norm360(360 - e.alpha);
  }
  return null;
}

/** Sample the compass for `windowMs` and return one bearing.
 *
 *  A window rather than a single event because a magnetometer jitters several
 *  degrees at rest, and because the first event or two after a listener attaches
 *  are often stale. Never rejects — a declined permission is an answer.
 *
 *  Must be called synchronously from the tap that asked for it: iOS ties
 *  `requestPermission()` to user activation, so it is the first await here. */
export async function readCompass(windowMs = 1400): Promise<CompassResult> {
  if (typeof window === 'undefined' || typeof DeviceOrientationEvent === 'undefined') {
    return { ok: false, failure: 'unsupported' };
  }
  if (window.isSecureContext === false) return { ok: false, failure: 'insecure' };

  const ctor = DeviceOrientationEvent as OrientationCtor;
  if (typeof ctor.requestPermission === 'function') {
    let state: string;
    try {
      state = await ctor.requestPermission();
    } catch {
      // Thrown when the call has lost its user activation. Indistinguishable from a
      // refusal from where the user is standing, and the remedy is the same: tap it.
      return { ok: false, failure: 'denied' };
    }
    if (state !== 'granted') return { ok: false, failure: 'denied' };
  }

  // Both event types, not whichever one is advertised. Choosing up front on
  // `'ondeviceorientationabsolute' in window` reported "no compass on this device"
  // on any browser that exposes the absolute event and then only ever fires the
  // plain one — a false negative on hardware that works. Whichever arrives with a
  // true-north reference in it is the one that counts, and `headingOf` refuses the
  // rest, so listening to both cannot let a relative reading through.
  const TYPES = ['deviceorientationabsolute', 'deviceorientation'] as const;

  return new Promise((resolve) => {
    const headings: number[] = [];
    // Counts only events that carried an actual angle. A desktop with no sensors can
    // still fire `deviceorientation` with alpha/beta/gamma all null, and counting
    // those as "orientation works, direction does not" told a laptop user their
    // machine reports tilt when it reports nothing at all.
    let oriented = 0;
    let accuracyDeg: number | null = null;

    const onEvent = (raw: Event) => {
      const e = raw as CompassEvent;
      if (e.alpha !== null || e.beta !== null || e.gamma !== null) oriented += 1;
      const h = headingOf(e, raw.type === 'deviceorientationabsolute');
      if (h !== null) headings.push(h);
      const acc = e.webkitCompassAccuracy;
      if (typeof acc === 'number' && acc >= 0) accuracyDeg = acc;
    };

    const finish = () => {
      for (const t of TYPES) window.removeEventListener(t, onEvent);
      if (!headings.length) {
        // Angles but no heading among them is a different fact from no angles at all:
        // the first is a device with orientation sensing and no compass reference,
        // the second is a device with neither. They get different sentences.
        resolve({ ok: false, failure: oriented > 0 ? 'relative' : 'unsupported' });
        return;
      }
      const mean = circularMeanDeg(headings)!;
      if (mean.resultant < MIN_AGREEMENT) {
        resolve({ ok: false, failure: 'unstable' });
        return;
      }
      resolve({
        ok: true,
        bearingDeg: snapBearing(mean.deg),
        spreadDeg: circularSpreadDeg(mean.resultant),
        accuracyDeg,
        samples: headings.length,
      });
    };

    for (const t of TYPES) window.addEventListener(t, onEvent);
    setTimeout(finish, windowMs);
  });
}

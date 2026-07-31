// Asking the device where it is — for the sun path, and for nothing else.
//
// This is the app's second permission prompt (the camera on the capture screen is
// the first), so it is worth being exact about what it buys and what it costs.
//
// It buys the two numbers the sun mood cannot derive: the latitude its altitude
// depends on, and the longitude its solar noon depends on. Typing those is a
// research task — most people do not know their own to a degree — and getting them
// wrong tilts every shadow in the room.
//
// It costs a coordinate, which is why the answer is COARSENED before it is stored.
// A tenth of a degree is about 11 km, and across 11 km the sun's altitude moves by
// 0.1° and solar noon by 24 seconds: less than the half-degree width of the sun's
// own disc, and far below anything a rendered room could show. So the room keeps
// enough to be lit correctly and not enough to say which building it is in. This is
// also why high accuracy is never requested — GPS-grade precision would be rounded
// away regardless, while spinning the radio for several seconds to produce it.
//
// Nothing is sent anywhere. The fix lands in `RoomData.site` in IndexedDB like
// every other fact about the room; the browser's own location service is the only
// party that ever holds the precise position, and this app never receives it.

export type GeoFailure = 'unsupported' | 'insecure' | 'denied' | 'unavailable' | 'timeout';

export type GeoResult =
  | { ok: true; lat: number; lon: number }
  | { ok: false; failure: GeoFailure };

/** One tenth of a degree, clamped to the axis. Also normalises `-0`, which is a
 *  real possibility on the equator and the prime meridian and reads as "-0" in a
 *  number field. */
export function coarsen(deg: number, limit: number): number {
  const clamped = Math.min(limit, Math.max(-limit, deg));
  return Math.round(clamped * 10) / 10 + 0;
}

/** `GeolocationPositionError.code` → which of our cases it is. The numbers are
 *  the spec's PERMISSION_DENIED / POSITION_UNAVAILABLE / TIMEOUT; anything else a
 *  browser invents is treated as "no fix", which is what the user can act on. */
export function failureFromCode(code: number): GeoFailure {
  if (code === 1) return 'denied';
  if (code === 3) return 'timeout';
  return 'unavailable';
}

/** What to put on screen. Each one names the alternative, because there is always
 *  one: the coordinate fields are right there and stay editable. */
export function geoFailureMessage(failure: GeoFailure): string {
  switch (failure) {
    case 'unsupported':
      return 'This browser has no location service — type the coordinates instead.';
    case 'insecure':
      return 'Location needs https (or localhost) — type the coordinates instead.';
    case 'denied':
      return 'Location permission was declined. Type the coordinates instead.';
    case 'timeout':
      return 'Location took too long. Try again, or type the coordinates.';
    case 'unavailable':
      return 'No location fix available. Type the coordinates instead.';
  }
}

/** The device's position, coarsened, or a reason it is not coming.
 *
 *  Never rejects: a permission the user declined is an ordinary answer, not an
 *  exception, and every caller would otherwise need a try/catch around a promise
 *  whose only failure mode is expected. The secure-context check runs first because
 *  browsers report an insecure origin as a plain permission denial, and telling
 *  someone to check their browser settings when the real problem is `http://` sends
 *  them somewhere they cannot fix it. */
export function requestLocation(timeoutMs = 10_000): Promise<GeoResult> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return Promise.resolve({ ok: false, failure: 'unsupported' });
  }
  if (typeof window !== 'undefined' && window.isSecureContext === false) {
    return Promise.resolve({ ok: false, failure: 'insecure' });
  }
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (p) =>
        resolve({
          ok: true,
          lat: coarsen(p.coords.latitude, 90),
          lon: coarsen(p.coords.longitude, 180),
        }),
      (e) => resolve({ ok: false, failure: failureFromCode(e.code) }),
      // A five-minute-old fix is fine: the room has not moved, and reusing one
      // avoids a second wait for an answer already in the browser's hand.
      { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 5 * 60_000 },
    );
  });
}

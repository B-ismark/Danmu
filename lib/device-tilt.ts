'use client';

// Lens tilt at the shutter, from the phone's own orientation sensors.
//
// Standard EXIF has no tilt field, so this is the only way to know it — and it is
// worth knowing: a 5° droop, which is ordinary handheld, mis-reads distance by
// about 20% (tests/photo-geometry.test.ts pins both directions). It applies to the
// live-camera path only. An uploaded photo has to fall back to the assumption
// that the phone was level, until vanishing-point calibration lands.
//
// Deliberately conservative: this reports a tilt ONLY for a phone held upright in
// portrait and roughly unrolled. In landscape, or rolled onto its side, the
// mapping from beta/gamma to lens tilt is a different expression, and a wrong
// tilt is worse than none — the geometry engine's fallback is exactly the level
// camera it always assumed.

import { useCallback, useEffect, useRef, useState } from 'react';

/** How far from upright the phone may be rolled and still be read. */
const MAX_ROLL_DEG = 25;
/** Plausible band for a phone being aimed at a wall, in beta. */
const MIN_BETA = 45;
const MAX_BETA = 135;

/**
 * Lens tilt in degrees, positive when the lens points DOWN, from a
 * `deviceorientation` reading. Null when the pose is one this cannot read.
 *
 * `beta` is rotation about the device's X axis: 0 is flat on a table screen-up,
 * 90 is upright. A phone held upright aiming straight at a wall reads beta ≈ 90,
 * so the lens tilt is simply how far short of upright it is.
 */
export function tiltFromOrientation(beta: number | null, gamma: number | null): number | null {
  if (beta === null || !Number.isFinite(beta)) return null;
  // gamma is the roll. Absent is fine (some devices omit it); wildly off is not.
  if (gamma !== null && Number.isFinite(gamma) && Math.abs(gamma) > MAX_ROLL_DEG) return null;
  if (beta < MIN_BETA || beta > MAX_BETA) return null;
  return 90 - beta;
}

type PermissionCapable = {
  requestPermission?: () => Promise<'granted' | 'denied' | 'default'>;
};

/**
 * Latest readable lens tilt, plus the gesture-bound permission request iOS
 * requires. `tilt` stays null until a reading arrives and passes the gate above,
 * which is also what a browser with no such sensor reports forever.
 */
export function useDeviceTilt(): { tilt: number | null; requestAccess: () => Promise<void> } {
  const [tilt, setTilt] = useState<number | null>(null);
  const listening = useRef(false);

  // Stable across renders, so the reference passed to addEventListener is the
  // same one removeEventListener gets. A handler redefined per render would leave
  // the first one attached forever.
  const onReading = useCallback((e: DeviceOrientationEvent) => {
    setTilt(tiltFromOrientation(e.beta, e.gamma));
  }, []);

  const attach = useCallback(() => {
    if (listening.current || typeof window === 'undefined') return;
    listening.current = true;
    window.addEventListener('deviceorientation', onReading);
  }, [onReading]);

  // Everywhere except iOS the events simply flow once listened for.
  useEffect(() => {
    const DOE =
      typeof window !== 'undefined'
        ? (window.DeviceOrientationEvent as unknown as PermissionCapable | undefined)
        : undefined;
    if (DOE && typeof DOE.requestPermission !== 'function') attach();
    return () => {
      if (typeof window !== 'undefined') window.removeEventListener('deviceorientation', onReading);
      listening.current = false;
    };
  }, [attach, onReading]);

  /** iOS gates the sensor behind an explicit grant from inside a user gesture.
   *  Refusal is a normal outcome, not an error: it means no tilt, and the
   *  geometry falls back to level. */
  const requestAccess = useCallback(async () => {
    const DOE = typeof window !== 'undefined' ? (window.DeviceOrientationEvent as unknown as PermissionCapable) : undefined;
    if (DOE && typeof DOE.requestPermission === 'function') {
      try {
        if ((await DOE.requestPermission()) !== 'granted') return;
      } catch {
        return;
      }
    }
    attach();
  }, [attach]);

  return { tilt, requestAccess };
}

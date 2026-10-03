// The geometry of the day over the canvas (`components/studio/DayStrip.tsx`): where
// the handle sits for an hour, which hour a pointer means, and how the strip's sky is
// painted. Kept here so it can be tested without a browser.
//
// It is SCREEN geometry, not a path in the room. The first version drew the sun's
// real sky path round the room in 3D, and a control that moved every time the camera
// did; the second bent the track into a rainbow over the canvas and split the clock in
// two — the sun's half and the moon's — because on an arc the horizon was an invisible
// point and a drag whose meaning flipped there was one nobody could learn.
//
// The strip makes the horizon VISIBLE, which is what lets it be one track. It is the
// whole clock, midnight to midnight, painted as the sky it scrubs — night at both ends,
// peach at sunrise, rose at sunset, haze at noon — so the place the sun turns into the moon
// is a place you can see before your hand gets there. The value is read off x alone,
// the way a slider's is.

import { SUNRISE_H, SUNSET_H } from './lighting-moods';

export type Strip = {
  /** The strip's box, in CSS px. */
  width: number;
  /** Kept clear at each end, so the handle is whole at midnight. */
  inset: number;
};

/** Past `MAX_WIDTH` a drag across the day stops being a gesture of the wrist and
 *  becomes one of the arm. */
export const MAX_WIDTH = 520;

/** The strip a slot this wide gets. */
export function stripFor(available: number, inset: number): Strip {
  return { width: Math.max(0, Math.min(MAX_WIDTH, available)), inset };
}

/** The length the handle's centre can travel. */
function run(strip: Strip): number {
  return Math.max(0, strip.width - strip.inset * 2);
}

/** Point `t` of the clock (0 at midnight, 1 at the next) as x from the strip's left. */
export function stripX(strip: Strip, t: number): number {
  return strip.inset + Math.min(1, Math.max(0, t)) * run(strip);
}

/** The point of the clock a pointer at `x` (px from the strip's left) means. */
export function tAtX(strip: Strip, x: number): number {
  const r = run(strip);
  if (r === 0) return 0.5;
  return Math.min(1, Math.max(0, (x - strip.inset) / r));
}

/** Where `hour` sits on the clock, 0–1. */
export function hourT(hour: number): number {
  return (((hour % 24) + 24) % 24) / 24;
}

/** Five minutes: the step a scrub lands on. A clock that reads 17:33 then 17:34 as
 *  the hand trembles is noise, and nothing about furniture turns on a minute. */
const STEP_H = 1 / 12;

/** The hour a scrub to point `t` means. The right end is the next midnight, which is
 *  this one; it lands a step short so the handle stays where the hand let go rather
 *  than leaping to the other end. */
export function scrubHour(t: number): number {
  const h = Math.round((Math.min(1, Math.max(0, t)) * 24) / STEP_H) * STEP_H;
  return Math.min(24 - STEP_H, h);
}

/** The strip's paint, as a CSS gradient over the theme's tokens. The two horizons are
 *  placed from `SUNRISE_H` and `SUNSET_H` rather than typed as percentages, so the
 *  warm band on the strip is exactly where the handle turns from moon to sun: a sky whose
 *  dawn sat a few px off the clock's would be the invisible-horizon problem again,
 *  merely smaller. */
export function skyGradient(): string {
  const pct = (h: number) => `${((h / 24) * 100).toFixed(3)}%`;
  const rise = SUNRISE_H;
  const set = SUNSET_H;
  const noon = (rise + set) / 2;
  // Twilight either side of each horizon: an hour of lilac before dawn, and the
  // peach (dusk: rose) giving way to the day's haze over the two hours after.
  return `linear-gradient(90deg, ${[
    `var(--sky-night) 0%`,
    `var(--sky-twilight) ${pct(rise - 1)}`,
    `var(--sky-dawn) ${pct(rise)}`,
    `var(--sky-haze) ${pct(rise + 2)}`,
    `var(--sky-noon) ${pct(noon)}`,
    `var(--sky-haze) ${pct(set - 2)}`,
    `var(--sky-dusk) ${pct(set)}`,
    `var(--sky-twilight) ${pct(set + 1)}`,
    `var(--sky-night) 100%`,
  ].join(', ')})`;
}

/** The two horizons, 0–1 along the strip: where the paint turns peach or rose and the handle
 *  turns between sun and moon. */
export const HORIZONS: readonly [number, number] = [SUNRISE_H / 24, SUNSET_H / 24];

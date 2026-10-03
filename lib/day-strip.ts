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

import { SUNRISE_H, SUNSET_H, TIME_STOPS, isDaytime, sunAt } from './lighting-moods';

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

// ── The glyph in the pill ──────────────────────────────────────────────────
//
// Four pictures, not two: the moon, the sun rising out of a horizon line, the sun
// clear of it, and the sun sinking back into it. They are not invented hours. Night
// is `isDaytime`'s, so the moon is drawn exactly while the key light is the moon or
// nothing; and the morning and evening bands are the app's own named moments —
// `TIME_STOPS` — read as a nearest-neighbour map: the glyph is the morning one for as
// long as Morning is the nearer of Morning and Midday, and the evening one from the
// hour Evening becomes nearer than Midday. With the stops as they stand that is
// sunrise to 10:12 and 15:39 to sunset, and moving a stop moves its band.

/** What the pill is drawing. */
export type DayPhase = 'night' | 'morning' | 'day' | 'evening';

const stopAt = (id: (typeof TIME_STOPS)[number]['id']) => TIME_STOPS.find((s) => s.id === id)!.hour;
/** The hour the morning glyph has finished rising: halfway from Morning to Midday. */
export const MORNING_ENDS_H = (stopAt('morning') + stopAt('midday')) / 2;
/** The hour the evening glyph starts to sink: halfway from Midday to Evening. */
export const EVENING_BEGINS_H = (stopAt('midday') + stopAt('evening')) / 2;

/** The glyph at `hour`: which picture, and how far the sun stands above its horizon
 *  line — `lift` 0 is the disc's centre ON the line (the moment of sunrise or sunset),
 *  1 is the full day sun with no horizon drawn. It is the sun's own ELEVATION, scaled
 *  so the band's far edge is 1, which makes the morph follow the sky rather than the
 *  clock: the sun clears the line quickly after dawn and lingers high, the way the
 *  light in the room does. Continuous in the hour everywhere inside the day, so a
 *  scrub morphs the glyph rather than swapping it; the horizons themselves are where
 *  the sun becomes the moon, and that one change is a transition in CSS. Night's lift
 *  is 1, so the moon is drawn centred and clear of any line. Rounded to a thousandth:
 *  it is written into a style, and a finer step is a write nobody can see. */
export function glyphAt(hour: number): { phase: DayPhase; lift: number } {
  if (!isDaytime(hour)) return { phase: 'night', lift: 1 };
  // Folded only when it needs folding: `(h + 24) % 24` moves 15.65 off itself by an
  // ulp, and the band edges are exactly such sums.
  const h = hour >= 0 && hour < 24 ? hour : ((hour % 24) + 24) % 24;
  const phase: DayPhase = h < MORNING_ENDS_H ? 'morning' : h >= EVENING_BEGINS_H ? 'evening' : 'day';
  if (phase === 'day') return { phase, lift: 1 };
  const edge = sunAt(phase === 'morning' ? MORNING_ENDS_H : EVENING_BEGINS_H).elevationDeg;
  const lift = Math.min(1, Math.max(0, sunAt(h).elevationDeg / edge));
  return { phase, lift: Math.round(lift * 1000) / 1000 };
}

/** What the slider's value text says after the clock: the picture's name, except by
 *  day, where the clock alone is the answer. Overcast is hour-blind, and says so. */
export function phaseWords(phase: DayPhase, overcast: boolean): string {
  if (overcast) return ', overcast';
  return phase === 'day' ? '' : `, ${phase}`;
}

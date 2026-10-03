import type { Lighting } from './store';
import { daylightKelvin, sunDirection } from './solar';
import { hexFromKelvin } from './light-units';

// What the room's light looks like at a given moment. Read by the 3D scene
// (`Room`), by the day strip over the canvas (`DayStrip`), by the day strip's own
// controls, and by `tests/lighting-moods.test.ts`.
//
// ── A clock, not a set of moods ──────────────────────────────────────────────
//
// This used to be five fixed moods, three of them sun angles (Sunrise, Day,
// Sunset) and two studio looks (Evening, Cool). That was itself a collapse: before
// it, one 'sun' mood computed a real solar position from a latitude, a longitude,
// a date and a clock. The collapse's argument still holds and is not reversed
// here: **nobody arranging furniture can check a hundredth of a degree**, so there
// is still no latitude, no date and no location permission.
//
// What changed is the unit. Five buttons answer "what does the room look like in
// the morning?"; they cannot answer "when does the sun leave the sofa?", which is
// the question someone asks of a room they are about to live in. So the moods are
// now one continuous **hour** (0–24) scrubbed along an arc, and the four named
// moments are stops on it (`TIME_STOPS`). The sun's path is a stated, temperate
// mid-latitude day — up at 06:00 in the east-north-east, highest at 12:45 due
// south, down at 19:30 west-north-west — which is a choice made once, here, rather
// than a guess dressed as a fact. Nothing in the UI names a date or a place.
//
// The room's own BEARING (`Site.bearingDeg`) is still the one fact the user owns,
// for the reason it always was: it is the only input whose effect is visible at
// furniture scale, because it changes which wall the light comes through.
//
// ── Two kinds of light, still ────────────────────────────────────────────────
//
//   · **daylight** — sky, sun and moon all follow the clock. Colours come from
//     `SKY_KEYS`, a keyframe table blended between neighbours, and the key light
//     is DERIVED (direction from `sunAt`/`moonAt`, colour from `daylightKelvin`,
//     strength from the air-mass term) so a colour and a height cannot drift apart.
//   · **overcast** — the old Cool studio look: flat, directionless, hour-blind.
//
// Hex rather than a token because none of these can be reached from CSS — the
// same reason `lib/scene-palette.ts` exists. They are LIGHT colours, not surfaces
// the user can recolour, so rule 4 has nothing to say about them beyond where
// they live.

/** Ambient conditions for a moment. Blended as a whole, so every field has to be
 *  something that interpolates: colours as hex, levels as numbers. */
export type Sky = {
  bg: string;
  hemi: [string, string, number];
  fill: { color: string; intensity: number };
  env: [string, string, string];
  /** Scales the studio environment with the moment. Dimming the three lights and
   *  leaving this at full strength was the reason a "dark" evening once still read
   *  as a fully-lit amber room: every material has envMapIntensity 0.5, so the
   *  environment was quietly supplying most of the light in the scene. */
  envMul: number;
  exposure: number;
};

/** The key light, resolved. `body` says what it IS, because the arc draws a sun
 *  and a moon differently and the sentence under the control names it. */
export type KeyLightSpec = {
  /** Unit vector in scene axes, from the room toward the light. */
  dir: [number, number, number];
  color: string;
  intensity: number;
  body: 'sun' | 'moon' | 'studio';
};

export type LightState = Sky & { key: KeyLightSpec | null };

// ── The day ────────────────────────────────────────────────────────────────

export const SUNRISE_H = 6;
export const SUNSET_H = 19.5;
/** Solar noon of this stated day — the midpoint, where the sun is due south. */
export const NOON_H = (SUNRISE_H + SUNSET_H) / 2;
const PEAK_SUN_DEG = 60;
const PEAK_MOON_DEG = 38;
/** Where the sun rises and sets, clockwise from true north. A summer-ish day at a
 *  temperate latitude rises north of east and sets north of west, which is what
 *  makes a north-facing window catch a sliver of low sun at either end. */
const RISE_AZ = 65;
const SET_AZ = 295;

/** Midday: the hour a server renders, and the fallback for an hour that is not one.
 *  A browser opens at its own clock instead (`hourNow`). */
export const DEFAULT_HOUR = 12.8;

/** `h` folded into [0, 24). */
export function wrapHour(h: number): number {
  return ((h % 24) + 24) % 24;
}

/** The hour on the person's own clock, to the scrub's five minutes — the light the
 *  studio opens at. Local time, not a place: the day is still the one typical day
 *  above, so 7 pm here is the same evening it is anywhere. */
export function hourNow(now: Date = new Date()): number {
  return wrapHour((Math.round((now.getHours() * 60 + now.getMinutes()) / 5) * 5) / 60);
}

/** How far through the day (0 at sunrise, 1 at sunset). Outside [0, 1] at night. */
export function dayFraction(hour: number): number {
  return (wrapHour(hour) - SUNRISE_H) / (SUNSET_H - SUNRISE_H);
}

/** How far through the night (0 at sunset, 1 at the next sunrise). Outside
 *  [0, 1] by day. */
export function nightFraction(hour: number): number {
  const since = wrapHour(wrapHour(hour) - SUNSET_H);
  return since / (24 - (SUNSET_H - SUNRISE_H));
}

export type SkyAngle = { azimuthDeg: number; elevationDeg: number };

/** Where a body stands on the day's arc at fraction `t` of its time up. The same
 *  path for the sun and the moon — the moon "comes round" the way the sun went —
 *  which is not astronomy and does not claim to be. It is what lets one body
 *  stand in for both. */
function onArc(t: number, peakDeg: number): SkyAngle {
  // Off its own stretch of the clock a body is DOWN, whatever the sine says: the
  // sine is periodic, and left alone it raised the moon again at 16:35. Pinned to
  // exactly 0 at the ends too, because sin(π) is 1e-16 and "up by a femtodegree"
  // at 19:30 is a sun that has set.
  const up = t > 0 && t < 1;
  const e = peakDeg * Math.sin(Math.PI * t);
  return {
    azimuthDeg: RISE_AZ + t * (SET_AZ - RISE_AZ),
    elevationDeg: up ? e : -Math.abs(e),
  };
}

/** The sun at `hour`. Negative elevation below the horizon, and it is left
 *  negative rather than clamped: `sunDirection` returns null there, which is the
 *  honest "the sun is not up". */
export function sunAt(hour: number): SkyAngle {
  return onArc(dayFraction(hour), PEAK_SUN_DEG);
}

/** The moon at `hour`, on the same arc through the night. */
export function moonAt(hour: number): SkyAngle {
  return onArc(nightFraction(hour), PEAK_MOON_DEG);
}

export function isDaytime(hour: number): boolean {
  const t = dayFraction(hour);
  return t > 0 && t < 1;
}

/** "07:36" — a clock face, 24-hour, because "7:36" beside "19:36" reads as a
 *  typo and AM/PM doubles the width of a pill that sits on the room. */
export function formatClock(hour: number): string {
  const mins = Math.round(wrapHour(hour) * 60) % (24 * 60);
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
}

/** The four named moments — the old moods, as places on the clock.
 *
 *  Each is where its predecessor's picture lives on this day: Morning is low
 *  eastern light still high enough to reach the far wall, Midday the overhead
 *  sun, Evening the low gold western rake, Night the lamp-lit room the Evening
 *  studio look used to be. */
export const TIME_STOPS = [
  { id: 'morning', label: 'Morning', hour: 7.6 },
  { id: 'midday', label: 'Midday', hour: 12.8 },
  { id: 'evening', label: 'Evening', hour: 18.5 },
  { id: 'night', label: 'Night', hour: 22.2 },
] as const;
export type TimeStopId = (typeof TIME_STOPS)[number]['id'];

// ── The sky, as keyframes ──────────────────────────────────────────────────
//
// Each row is the ambient picture at one hour, and `skyAt` blends between the two
// rows either side. The anchors are the retired moods' own values — `12.75` is the
// old Day, `6.8` the old Sunrise, `19.0` the old Sunset, `21.8` the old Evening —
// so someone who knew those pictures finds them again on the clock; the rows in
// between are the transitions the five buttons could never show.
//
// Night's ambient is pulled down hard for the reason the Evening mood's was: it is
// the moment where the lamps are supposed to do the work, and at generous levels
// a real 800 lm floor lamp changes nothing visible.
type SkyKey = Sky & { h: number };

export const SKY_KEYS: readonly SkyKey[] = [
  {
    h: 0,
    bg: '#1d1a1f',
    hemi: ['#8ea0d6', '#231d1b', 0.05],
    fill: { color: '#4a4a7a', intensity: 0.05 },
    env: ['#9aa6d8', '#6a5f8a', '#4a4270'],
    envMul: 0.16,
    exposure: 1.15,
  },
  {
    h: 4.9,
    bg: '#2a2733',
    hemi: ['#9aa8d8', '#2a2426', 0.08],
    fill: { color: '#5b5f95', intensity: 0.06 },
    env: ['#a8b2dc', '#7d6f98', '#565080'],
    envMul: 0.22,
    exposure: 1.12,
  },
  {
    // Dawn glow — the one row neither end of the old set had, and without it the
    // sky went from night to sunrise in a single step.
    h: 5.8,
    bg: '#8f7c80',
    hemi: ['#d9b9b0', '#4a4040', 0.16],
    fill: { color: '#8a8fbf', intensity: 0.08 },
    env: ['#e8c2a8', '#b39aa8', '#8a82a8'],
    envMul: 0.36,
    exposure: 1.1,
  },
  {
    h: 6.8,
    bg: '#F3E9E2',
    hemi: ['#ffd9be', '#8f7f70', 0.3],
    fill: { color: '#b9c6e0', intensity: 0.1 },
    env: ['#ffe6cf', '#f2ded2', '#e8e0dc'],
    envMul: 0.55,
    exposure: 1.05,
  },
  {
    h: 9.5,
    bg: '#F8F4EE',
    hemi: ['#fff4e6', '#bdb3a2', 0.36],
    fill: { color: '#d3ddf2', intensity: 0.13 },
    env: ['#fff4e4', '#f1ede6', '#f6ece0'],
    envMul: 0.65,
    exposure: 1.02,
  },
  {
    h: 12.75,
    bg: '#FBF9F6',
    hemi: ['#ffffff', '#cfc7b6', 0.4],
    fill: { color: '#dfe7ff', intensity: 0.15 },
    env: ['#fffaf0', '#eef3ff', '#fff3e0'],
    envMul: 0.7,
    exposure: 1.0,
  },
  {
    h: 16.2,
    bg: '#F9F2E8',
    hemi: ['#fff0dc', '#c5b69f', 0.36],
    fill: { color: '#d0d6ea', intensity: 0.13 },
    env: ['#fff0da', '#f4e6d6', '#efe2d6'],
    envMul: 0.62,
    exposure: 1.03,
  },
  {
    h: 19.0,
    bg: '#F0DFCE',
    hemi: ['#ffd6a4', '#8a7867', 0.26],
    fill: { color: '#b6bfd7', intensity: 0.1 },
    env: ['#ffe6c4', '#f3d4ba', '#e5dbd3'],
    envMul: 0.55,
    exposure: 1.08,
  },
  {
    h: 20.2,
    bg: '#4a3a3a',
    hemi: ['#e8b48f', '#4a3a30', 0.12],
    fill: { color: '#7a5f9a', intensity: 0.07 },
    env: ['#f2b98a', '#c9876a', '#6d5a92'],
    envMul: 0.3,
    exposure: 1.12,
  },
  {
    h: 21.8,
    bg: '#27201C',
    hemi: ['#ffd9a8', '#3a2c20', 0.07],
    fill: { color: '#6a4b8a', intensity: 0.06 },
    env: ['#ffce93', '#ff9d5c', '#5b4a8a'],
    envMul: 0.2,
    exposure: 1.15,
  },
];

/** The old Cool studio look, unchanged. Hour-blind on purpose: overcast is the
 *  light you pick to see the room WITHOUT the sun's opinion about it. */
export const OVERCAST: Sky & { key: { color: string; intensity: number } } = {
  bg: '#EAEEF1',
  hemi: ['#eaf1ff', '#c4cdd4', 0.95],
  key: { color: '#eef4ff', intensity: 0.95 },
  fill: { color: '#d6e2ee', intensity: 0.4 },
  env: ['#f2f6ff', '#dfe9f5', '#e8eef5'],
  envMul: 1,
  exposure: 0.95,
};

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Blend two `#rrggbb` colours. In sRGB rather than linear light: these are
 *  art-directed keyframes, and an sRGB blend is what the person who picked them
 *  sees as "halfway". */
export function mixHex(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  const c = (x: number, y: number) => Math.round(x + (y - x) * t).toString(16).padStart(2, '0');
  return `#${c(ar, br)}${c(ag, bg)}${c(ab, bb)}`;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Eased so a keyframe is a place the sky lingers, not a corner it turns. */
const ease = (t: number) => t * t * (3 - 2 * t);

/** The ambient sky at `hour`, blended between the keyframes either side. Wraps
 *  past midnight, so 23:30 blends Night toward the 00:00 row and never jumps. */
export function skyAt(hour: number): Sky {
  const h = wrapHour(hour);
  let i = SKY_KEYS.length - 1;
  for (let k = 0; k < SKY_KEYS.length; k++) if (SKY_KEYS[k].h <= h) i = k;
  const a = SKY_KEYS[i];
  const b = SKY_KEYS[(i + 1) % SKY_KEYS.length];
  const span = wrapHour(b.h - a.h) || 24;
  const t = ease(wrapHour(h - a.h) / span);
  return {
    bg: mixHex(a.bg, b.bg, t),
    hemi: [mixHex(a.hemi[0], b.hemi[0], t), mixHex(a.hemi[1], b.hemi[1], t), lerp(a.hemi[2], b.hemi[2], t)],
    fill: { color: mixHex(a.fill.color, b.fill.color, t), intensity: lerp(a.fill.intensity, b.fill.intensity, t) },
    env: [mixHex(a.env[0], b.env[0], t), mixHex(a.env[1], b.env[1], t), mixHex(a.env[2], b.env[2], t)],
    envMul: lerp(a.envMul, b.envMul, t),
    exposure: lerp(a.exposure, b.exposure, t),
  };
}

/** Fades a body in over its first few degrees, so the key light does not switch
 *  on at full strength the instant it clears the horizon. */
function horizonFade(elevationDeg: number, overDeg: number): number {
  return ease(Math.min(1, Math.max(0, elevationDeg / overDeg)));
}

const MOONLIGHT = '#aebcff';

/** The key light at `hour`: the sun while it is up, the moon while it is up, and
 *  nothing in the gap either side of the horizon — which is a real answer, not a
 *  missing one; the key light goes out rather than shine up through the floor. */
export function keyAt(hour: number, northBearingDeg: number): KeyLightSpec | null {
  const sun = sunAt(hour);
  if (sun.elevationDeg > 0) {
    const dir = sunDirection(sun.elevationDeg, sun.azimuthDeg, northBearingDeg);
    if (!dir) return null;
    return {
      dir,
      color: hexFromKelvin(daylightKelvin(sun.elevationDeg)),
      // Air mass, roughly: the sun is dimmer near the horizon because its light
      // takes a longer path through the atmosphere. sin(altitude) is the standard
      // first approximation and it is what makes morning read as morning rather
      // than as midday pointed sideways.
      intensity: (0.25 + 1.35 * Math.sin((sun.elevationDeg * Math.PI) / 180)) * horizonFade(sun.elevationDeg, 8),
      body: 'sun',
    };
  }
  const moon = moonAt(hour);
  if (moon.elevationDeg > 0) {
    const dir = sunDirection(moon.elevationDeg, moon.azimuthDeg, northBearingDeg);
    if (!dir) return null;
    return { dir, color: MOONLIGHT, intensity: 0.14 * horizonFade(moon.elevationDeg, 6), body: 'moon' };
  }
  return null;
}

/** The bearing a room is assumed to have when nobody has told us which way it
 *  faces: square to the compass. Zero is honest in a way a latitude never was —
 *  "nobody has said" and "the plan's top edge really is north" produce the same
 *  picture, and the daylight control names the direction it is using either way. */
export const DEFAULT_BEARING_DEG = 0;

/** The studio key light's direction — a fixed three-quarter position, as a unit
 *  vector from the room toward the light. Overcast's key. */
const KEY_OFFSET: [number, number, number] = [5, 8, 4];
const KEY_LEN = Math.hypot(...KEY_OFFSET);
export const KEY_DIR: [number, number, number] = [
  KEY_OFFSET[0] / KEY_LEN,
  KEY_OFFSET[1] / KEY_LEN,
  KEY_OFFSET[2] / KEY_LEN,
];

/** Everything the scene needs to light the room, for one light kind, hour and
 *  bearing. The single derivation `Room` and `DayStrip` both read, so the light and
 *  the control over it cannot disagree about the sky. */
export function lightingAt(lighting: Lighting, hour: number, northBearingDeg: number): LightState {
  if (lighting === 'overcast') {
    const { key, ...sky } = OVERCAST;
    return { ...sky, key: { dir: KEY_DIR, color: key.color, intensity: key.intensity, body: 'studio' } };
  }
  return { ...skyAt(hour), key: keyAt(hour, northBearingDeg) };
}

/** What a mood id from before the clock means on it. The old ids were persisted
 *  (localStorage, and every undo snapshot in a live tab), so a browser that last
 *  ran the five-mood build carries one. Each maps to the stop that IS its picture;
 *  anything else is `null`, and the caller falls back to its default rather than
 *  guessing — `'sun'` had no fixed angle of its own, so there is no honest "the one
 *  you meant". */
export function legacyLighting(id: unknown): { lighting: Lighting; hour?: number } | null {
  switch (id) {
    case 'daylight':
    case 'overcast':
      return { lighting: id };
    case 'day':
      return { lighting: 'daylight', hour: 12.8 };
    case 'sunrise':
      return { lighting: 'daylight', hour: 7.6 };
    case 'sunset':
      return { lighting: 'daylight', hour: 18.5 };
    case 'evening':
      return { lighting: 'daylight', hour: 22.2 };
    case 'cool':
      return { lighting: 'overcast' };
    default:
      return null;
  }
}

/** Eight points, because sixteen would be precision the sentence around it does
 *  not have. Takes a TRUE bearing, clockwise from north. */
const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
export function compassName(deg: number): string {
  return COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}

/** The bearing one eighth-turn from `deg`. Snaps to the nearest compass point
 *  first, so a bearing a photo supplied (213 deg) steps to 225 and then by whole points. */
export function turnedBearing(deg: number, dir: 1 | -1): number {
  const onPoint = deg % 45 === 0;
  const next = onPoint ? deg + 45 * dir : (dir > 0 ? Math.ceil(deg / 45) : Math.floor(deg / 45)) * 45;
  return ((next % 360) + 360) % 360;
}

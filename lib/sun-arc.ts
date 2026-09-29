// The geometry of the day's track over the canvas (`components/studio/SunArc.tsx`):
// where the handle sits for a point of the day, and which point a pointer means.
// Kept here so it can be tested without a browser.
//
// It is SCREEN geometry, not a path in the room. The first version drew the sun's
// real sky path round the room in 3D, turned by the bearing — honest about which
// wall the morning comes through, and a control that moved every time the camera
// did: pinned to the frame's edge at dawn, clipped under the toolbar at noon, and on
// a phone a handle that wandered across the room. The light itself still comes from
// the real direction (`lightingAt`), so orbiting the camera still shows which wall it
// comes through. The control no longer has to.
//
// One shape for both widths. A track is a shallow circular arc — a rainbow — whose
// `sag` is how far its ends sit below its crown, and a phone's straight slider is
// the same track with `sag` 0. The VALUE is read off x alone, the way a slider's
// is: the arc is the path the handle rides, not a dial you have to trace. That keeps
// the two forms one gesture, and it makes a drag below or above the arc still mean
// the obvious thing.

import { SUNRISE_H, SUNSET_H, hourOnDayArc, hourOnNightArc } from './lighting-moods';

export type Track = {
  /** The track's box, in CSS px. */
  width: number;
  /** How far the ends sit below the crown. 0 is a straight slider. */
  sag: number;
  /** Kept clear at each end, so the handle is whole at sunrise and sunset. */
  inset: number;
};

/** The half-width of the arc's chord. */
function half(track: Track): number {
  return Math.max(0, track.width / 2 - track.inset);
}

/** The circle a track's arc is a piece of: its radius, from the chord and the sag. */
function radius(track: Track): number {
  const a = half(track);
  return (a * a + track.sag * track.sag) / (2 * track.sag);
}

/** Where on the track point `t` (0 at the left end, 1 at the right) sits: x from the
 *  left of the box, y down from the crown. */
export function trackPoint(track: Track, t: number): [number, number] {
  const a = half(track);
  const u = Math.min(1, Math.max(0, t));
  const dx = (u * 2 - 1) * a;
  const x = track.width / 2 + dx;
  if (track.sag <= 0 || a === 0) return [x, 0];
  const r = radius(track);
  // Below the crown by how far the circle has fallen away at this offset.
  return [x, r - Math.sqrt(Math.max(0, r * r - dx * dx))];
}

/** The point of the track a pointer at `x` (px from the left of the box) means. */
export function tAtX(track: Track, x: number): number {
  const a = half(track);
  if (a === 0) return 0.5;
  return Math.min(1, Math.max(0, (x - (track.width / 2 - a)) / (2 * a)));
}

/** The track from `from` to `to` as an SVG path in the box's own px, offset down
 *  by `top`. A piece of it rather than a dash pattern over the whole, because the
 *  value runs along x and a dash runs along the arc's length, and the two part
 *  company toward the ends — the travelled stroke would stop short of the handle. */
export function trackPath(track: Track, from = 0, to = 1, top = 0): string {
  const [x0, y0] = trackPoint(track, from);
  const [x1, y1] = trackPoint(track, to);
  if (track.sag <= 0) return `M ${x0} ${y0 + top} L ${x1} ${y1 + top}`;
  const r = radius(track);
  return `M ${x0} ${y0 + top} A ${r} ${r} 0 0 1 ${x1} ${y1 + top}`;
}

/** The track a canvas this wide gets. Narrower than `LINE_BELOW` and there is no
 *  arc worth the height it costs over the room — a phone, or a desktop canvas with
 *  the Library open — so the arc flattens into a slider. The arc's own width is
 *  capped: past `MAX_WIDTH` it stops being a gesture of the wrist and becomes one
 *  of the arm. */
export const MAX_WIDTH = 560;
export const LINE_BELOW = 480;
export function trackFor(available: number, inset: number): Track {
  const width = Math.max(0, Math.min(MAX_WIDTH, available));
  // About a seventh of the width, so the shape stays the same rainbow as it
  // narrows; capped so it never takes more of the room's top than a toolbar row.
  const sag = width < LINE_BELOW ? 0 : Math.min(64, width / 7);
  return { width, sag, inset };
}

/** Five minutes: the step a scrub lands on. A clock that reads 17:33 then 17:34 as
 *  the hand trembles is noise, and nothing about furniture turns on a minute. */
const STEP_H = 1 / 12;

/** The hour a scrub to point `t` of the arc means, held inside the half of the
 *  clock the gesture is scrubbing. The day arc's two ends are sunrise and sunset
 *  EXACTLY, and `isDaytime` is strict there — so a scrub to the end of the arc
 *  used to land on 06:00, which is night: the handle turned into the moon under
 *  the hand's release and the dusk sound played at dawn. One step in from each end
 *  keeps the sun a sun. The night's ends are already night. */
export function scrubHour(half: 'day' | 'night', t: number): number {
  if (half === 'night') return Math.round(hourOnNightArc(t) / STEP_H) * STEP_H % 24;
  const h = Math.round(hourOnDayArc(t) / STEP_H) * STEP_H;
  return Math.min(SUNSET_H - STEP_H, Math.max(SUNRISE_H + STEP_H, h));
}

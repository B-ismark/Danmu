// Where the sun's arc is drawn over a room: the geometry `components/three/SunArc.tsx`
// draws and hit-tests, kept here so it can be tested without a canvas.

import { SUNRISE_H, SUNSET_H, hourOnDayArc, hourOnNightArc, type SkyAngle } from './lighting-moods';

/** Where a body on the sky is drawn on the halo. The azimuth is the true one —
 *  turned by the room's bearing, +X east, +Z south — and the elevation lifts it
 *  above the eaves. The distance out is the SAME at every elevation: a ring round
 *  the room rather than a dome over it, so from straight above (the top view) the
 *  sun is on the ring outside the walls instead of over the middle of the floor,
 *  where a dome's noon sun sat on the furniture. `sunDirection` refuses the
 *  horizon, since a light cannot shine up through the floor; a path can be drawn
 *  there, and the arc's two ends are exactly at 0°. */
export function skyPoint(
  a: SkyAngle,
  bearingDeg: number,
  r: { across: number; up: number; base: number },
  c: [number, number],
): [number, number, number] {
  const alt = (a.elevationDeg * Math.PI) / 180;
  const az = ((a.azimuthDeg - bearingDeg) * Math.PI) / 180;
  return [c[0] + r.across * Math.sin(az), r.base + r.up * Math.sin(alt), c[1] - r.across * Math.cos(az)];
}

/** The halo's shape for a room: centred on its footprint, its horizon at the top
 *  of the walls, clear of every corner across, and a low crown.
 *
 *  The horizon is the part that matters. The first two versions stood the arc on
 *  the FLOOR, which put the rising and setting ends at floor level beside the room
 *  — and from the default view the near end of that projects straight into the
 *  room: measured at 06:40 in a 5 × 4 m room, the sun's handle sat beside the sofa,
 *  where a press meant for the sofa grabbed the sun instead. On the eaves, every
 *  point of the arc is above every wall, so from any camera looking down at the
 *  room the handle is over the plaster or the sky and never among the furniture.
 *  The crown is kept low (0.6 m) so the noon sun stays in frame under the toolbar. */
export function sunArcShape(
  bounds: { cx: number; cz: number; width: number; depth: number },
  roomHeight: number,
): { center: [number, number]; radius: { across: number; up: number; base: number } } {
  return {
    center: [bounds.cx, bounds.cz],
    // Half the diagonal plus a margin: the ring clears the corners, not just the
    // middle of each wall, so no point of it is over the floor from above.
    radius: { across: Math.hypot(bounds.width, bounds.depth) / 2 + 0.35, up: 0.6, base: roomHeight },
  };
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

// Where the sun's arc is drawn over a room: the geometry `components/three/SunArc.tsx`
// draws and hit-tests, kept here so it can be tested without a canvas.

import type { SkyAngle } from './lighting-moods';

/** A direction on the sky that does NOT refuse the horizon. `sunDirection` returns
 *  null at or below 0° on purpose — a light cannot shine up through the floor — but
 *  a path can be drawn there, and the arc's two ends are exactly at 0°. Same axes:
 *  +X east, +Z south, bearing rotating the whole sky. */
export function skyPoint(
  a: SkyAngle,
  bearingDeg: number,
  r: { across: number; up: number; base: number },
  c: [number, number],
): [number, number, number] {
  const alt = (a.elevationDeg * Math.PI) / 180;
  const az = ((a.azimuthDeg - bearingDeg) * Math.PI) / 180;
  const h = Math.cos(alt);
  return [c[0] + r.across * h * Math.sin(az), r.base + r.up * Math.sin(alt), c[1] - r.across * h * Math.cos(az)];
}

/** The halo's shape for a room: centred on its footprint, its horizon at the top
 *  of the walls, just clear of them across, and a low crown.
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
    radius: { across: Math.max(bounds.width, bounds.depth) * 0.5 + 0.6, up: 0.6, base: roomHeight },
  };
}

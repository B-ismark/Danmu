import { wallOutwardNormal, type Footprint } from './footprint';

/** What a wall is called on screen. One function, because the Inspector, the plan
 *  and the Ideas captions each carried their own copy of this convention and a
 *  caption that says "north wall" over a plan that says "Wall 3" is two rooms.
 *
 *  `yaw` is `wallSegments`' (the plane's +Z face points INWARD). A four-sided room
 *  is labelled by the side of the plan the wall is on — north is the TOP of the
 *  plan, and the labels do not follow `Site.bearingDeg`, which only turns the sun
 *  and the "Plan top faces …" readout. Any other outline numbers its edges. */
export function wallLabelFor(yaw: number, index: number, useCompass: boolean): string {
  if (!useCompass) return `Wall ${index + 1}`;
  const inX = Math.sin(yaw);
  const inZ = Math.cos(yaw);
  if (Math.abs(inZ) >= Math.abs(inX)) return inZ > 0 ? 'North wall' : 'South wall';
  return inX > 0 ? 'West wall' : 'East wall';
}

/** The label of edge `index` of a footprint, as the plan and the Inspector show it. */
export function wallLabelOf(poly: Footprint, index: number): string {
  const [ox, oz] = wallOutwardNormal(poly, index);
  return wallLabelFor(Math.atan2(-ox, -oz), index, poly.length === 4);
}

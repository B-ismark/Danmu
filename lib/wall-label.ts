import { wallOutwardNormal, type Footprint } from './footprint';

/** What a wall is called on screen. One function, because the Inspector, the plan
 *  and the Ideas captions each carried their own copy of this convention and a
 *  caption that says "north wall" over a plan that says "Wall 3" is two rooms.
 *
 *  `yaw` is `wallSegments`' (the plane's +Z face points INWARD). A four-sided room
 *  is labelled by the side of the plan the wall is on — Top, Bottom, Left,
 *  Right, as drawn, with no compass words (nobody knows which way their room
 *  faces). The top of the plan is the north wall of the scene's axes, and the
 *  labels do not follow `Site.bearingDeg`, which only turns the sun. Any other outline numbers its edges. */
export function wallLabelFor(yaw: number, index: number, useCompass: boolean): string {
  if (!useCompass) return `Wall ${index + 1}`;
  const inX = Math.sin(yaw);
  const inZ = Math.cos(yaw);
  if (Math.abs(inZ) >= Math.abs(inX)) return inZ > 0 ? 'Top wall' : 'Bottom wall';
  return inX > 0 ? 'Left wall' : 'Right wall';
}

/** The label of edge `index` of a footprint, as the plan and the Inspector show it. */
export function wallLabelOf(poly: Footprint, index: number): string {
  const [ox, oz] = wallOutwardNormal(poly, index);
  return wallLabelFor(Math.atan2(-ox, -oz), index, poly.length === 4);
}

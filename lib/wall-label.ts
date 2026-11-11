import { wallOutwardNormal, type Footprint } from './footprint';

/** What a wall is called on screen. One function, because the Inspector, the plan
 *  and the Ideas captions each carried their own copy of this convention and a
 *  caption that says "north wall" over a plan that says "Wall 3" is two rooms.
 *
 *  `yaw` is `wallSegments`' (the plane's +Z face points INWARD). A four-sided room
 *  is labelled by where the wall stands in the 3D room, with no compass words
 *  (nobody knows which way their room faces): the wall at the top of the plan is
 *  the Back wall and the one at the bottom is the Front wall, because the studio's
 *  "Front" camera (`CameraRig` PRESETS) stands at the plan's bottom edge and looks
 *  toward its top. Left and Right are the plan's own left and right, which are also
 *  what that camera sees. "Top wall" was dropped because in the 3D Inspector it
 *  reads as the ceiling. The labels do not follow `Site.bearingDeg`, which only
 *  turns the sun. Any other outline numbers its edges. */
export function wallLabelFor(yaw: number, index: number, fourSided: boolean): string {
  if (!fourSided) return `Wall ${index + 1}`;
  const inX = Math.sin(yaw);
  const inZ = Math.cos(yaw);
  if (Math.abs(inZ) >= Math.abs(inX)) return inZ > 0 ? 'Back wall' : 'Front wall';
  return inX > 0 ? 'Left wall' : 'Right wall';
}

/** The label of edge `index` of a footprint, as the plan and the Inspector show it. */
export function wallLabelOf(poly: Footprint, index: number): string {
  const [ox, oz] = wallOutwardNormal(poly, index);
  return wallLabelFor(Math.atan2(-ox, -oz), index, poly.length === 4);
}

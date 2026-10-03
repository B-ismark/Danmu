// Where each photo's wall is on the room's outline, for the capture screen's small
// plan. The wall is `wallFrame`'s — the same answer the geometry measures from — so
// the wall the plan lights up as "Wall 2" is the wall a photo filed under Wall 2 is
// measured against, and a room whose lens has no wall ahead (the `u`'s north view)
// lights nothing rather than a bounding-box side the camera is not facing.

import type { CaptureSlot } from './storage';
import type { Footprint } from './footprint';
import { wallFrame } from './photo-geometry';

/** The rig's world → lens map for one slot: `forward` along the view, `right`
 *  across it. The same table `photo-geometry` keeps privately; the round trip in
 *  `tests/capture-plan.test.ts` holds this copy to that one through `wallFrame`. */
function lensOf(slot: CaptureSlot, x: number, z: number): [forward: number, right: number] {
  switch (slot) {
    case 'n':
      return [-z, x];
    case 's':
      return [z, -x];
    case 'e':
      return [x, z];
    case 'w':
      return [-x, -z];
  }
}

const near = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

/** The framed wall's two ends in plan coordinates — the outline's own corners, so a
 *  slanted wall is drawn slanted — or null where the lens has no wall ahead of it.
 *
 *  `wallFrame` answers with a distance and two lateral ends, which is enough to
 *  measure from and not enough to draw: on an oblique wall the ends are at different
 *  distances, and placing both at the centre crossing floats the line off the
 *  outline. So the edge it chose is found again — the one whose left end is exactly
 *  that lateral end and which crosses the view column at exactly that distance. */
export function framedWall(slot: CaptureSlot, footprint: Footprint): [[number, number], [number, number]] | null {
  const f = wallFrame(slot, footprint);
  if (!f) return null;
  const n = footprint.length;
  for (let i = 0; i < n; i++) {
    const a = footprint[i];
    const b = footprint[(i + 1) % n];
    const [af, ar] = lensOf(slot, a[0], a[1]);
    const [bf, br] = lensOf(slot, b[0], b[1]);
    // The left end and the crossing pin it: two edges sharing both would overlap,
    // which a simple outline cannot do. (A right-end check too was mutated away with
    // nothing failing, for that reason.)
    if (!near(Math.min(ar, br), f.left) || ar === br) continue;
    const crossing = af + ((bf - af) * -ar) / (br - ar);
    if (near(crossing, f.distance)) return [[a[0], a[1]], [b[0], b[1]]];
  }
  return null;
}

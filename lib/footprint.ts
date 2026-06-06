// Room footprint as a polygon (XZ metres, room-centred). Lets the scene be
// non-rectangular (L / T / U / open) instead of a single width×depth box.
// +X = right (East), +Z = toward South — same axes as the scene.

export type LayoutId = 'rect' | 'l' | 't' | 'u' | 'open' | 'custom';
export type Footprint = [number, number][];

/** Build a centred polygon for a layout preset from overall width/depth. */
export function footprintForLayout(layout: LayoutId, w: number, d: number): Footprint {
  const hw = w / 2;
  const hd = d / 2;
  switch (layout) {
    case 'l': {
      // Remove the South-East quadrant.
      const lx = 0.42 * w;
      const lz = 0.42 * d;
      return [
        [-hw, -hd],
        [hw, -hd],
        [hw, hd - lz],
        [hw - lx, hd - lz],
        [hw - lx, hd],
        [-hw, hd],
      ];
    }
    case 't': {
      // North bar full width; stem runs South.
      const armD = 0.45 * d;
      const stem = 0.22 * w;
      return [
        [-hw, -hd],
        [hw, -hd],
        [hw, -hd + armD],
        [stem, -hd + armD],
        [stem, hd],
        [-stem, hd],
        [-stem, -hd + armD],
        [-hw, -hd + armD],
      ];
    }
    case 'u': {
      // Opening (notch) on the North edge.
      const notch = 0.22 * w;
      const depth = 0.5 * d;
      return [
        [-hw, -hd],
        [-notch, -hd],
        [-notch, -hd + depth],
        [notch, -hd + depth],
        [notch, -hd],
        [hw, -hd],
        [hw, hd],
        [-hw, hd],
      ];
    }
    case 'rect':
    case 'open':
    case 'custom':
    default:
      return [
        [-hw, -hd],
        [hw, -hd],
        [hw, hd],
        [-hw, hd],
      ];
  }
}

export function polygonCentroid(poly: Footprint): [number, number] {
  let x = 0;
  let z = 0;
  for (const p of poly) {
    x += p[0];
    z += p[1];
  }
  return [x / poly.length, z / poly.length];
}

/** Ray-cast point-in-polygon (XZ). */
export function pointInFootprint(x: number, z: number, poly: Footprint): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0];
    const zi = poly[i][1];
    const xj = poly[j][0];
    const zj = poly[j][1];
    const intersect = zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** Pull (x,z) inside the footprint by stepping toward the centroid. Returns the
 *  point unchanged if already inside. Used to keep detected items out of the
 *  void of an L/U/T room. */
export function clampIntoFootprint(x: number, z: number, poly: Footprint): [number, number] {
  if (pointInFootprint(x, z, poly)) return [x, z];
  const [cx, cz] = polygonCentroid(poly);
  for (let t = 0.15; t < 1; t += 0.15) {
    const nx = x + (cx - x) * t;
    const nz = z + (cz - z) * t;
    if (pointInFootprint(nx, nz, poly)) return [nx, nz];
  }
  return [cx, cz];
}

/** Per-edge wall placement: midpoint, length, and Y-rotation so a plane's +Z
 *  face points INWARD (toward the centroid). Drives RoomShell's wall meshes. */
export function wallSegments(
  poly: Footprint,
): Array<{ x: number; z: number; len: number; yaw: number }> {
  const [cx, cz] = polygonCentroid(poly);
  const out: Array<{ x: number; z: number; len: number; yaw: number }> = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const mx = (a[0] + b[0]) / 2;
    const mz = (a[1] + b[1]) / 2;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1e-4) continue;
    // Edge direction; perpendicular candidate.
    let nx = -(b[1] - a[1]);
    let nz = b[0] - a[0];
    const nl = Math.hypot(nx, nz) || 1;
    nx /= nl;
    nz /= nl;
    // Flip to point toward the centroid (inward).
    if ((cx - mx) * nx + (cz - mz) * nz < 0) {
      nx = -nx;
      nz = -nz;
    }
    out.push({ x: mx, z: mz, len, yaw: Math.atan2(nx, nz) });
  }
  return out;
}

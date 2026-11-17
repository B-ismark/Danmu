// UVs in metres for a box-like mesh, so a texture's grain is the same size on every
// piece.
//
// drei's `RoundedBox` and three's `BoxGeometry` both give each face UVs from 0 to 1,
// whatever its size. With one shared texture that means a 400 mm drawer front and a
// 2 m wardrobe door show the same number of grain lines — the wardrobe's five times
// coarser — and a 20 mm shelf edge squeezes a whole tile into a sliver. A material
// cannot fix that, because the texture is shared by every piece; the geometry can.
//
// So each vertex is projected onto the face its normal points most along, in the
// mesh's own units (metres here), and the texture's `repeat` turns metres into tiles
// (`lib/textures.ts`, `tileM`). The axis pairs are chosen so wood grain — which runs
// along V — goes UP a door or a side panel and ALONG the width of a top, the way
// furniture is actually cut.
//
// A rounded corner's vertices sit between two faces and take whichever their normal
// favours, so the grain changes direction across the bevel. At a 3–30 mm fillet that
// is a sub-pixel seam at any viewing distance, and it is the honest price of not
// unwrapping a mesh the library generates for us.

/** Writes metric UVs for `positions`/`normals` (xyz triples) into a new array. */
export function boxProjectUV(positions: ArrayLike<number>, normals: ArrayLike<number>): Float32Array {
  const n = Math.floor(positions.length / 3);
  const uv = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const x = positions[i * 3];
    const y = positions[i * 3 + 1];
    const z = positions[i * 3 + 2];
    const ax = Math.abs(normals[i * 3]);
    const ay = Math.abs(normals[i * 3 + 1]);
    const az = Math.abs(normals[i * 3 + 2]);
    let u: number;
    let v: number;
    if (ay >= ax && ay >= az) {
      // Top / bottom: grain (V) along the width.
      u = z;
      v = x;
    } else if (ax >= az) {
      // Side panels: grain up.
      u = z;
      v = y;
    } else {
      // Front / back: grain up.
      u = x;
      v = y;
    }
    uv[i * 2] = u;
    uv[i * 2 + 1] = v;
  }
  return uv;
}

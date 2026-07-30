// Calibrating a camera from the photo itself.
//
// The rest of the calibration ladder needs something the file tells us: EXIF for
// the lens, `deviceorientation` for the tilt. Neither exists for an upload whose
// metadata a messaging app stripped on the way here, which is most of them — and
// `lib/jpeg-strip.ts` in this same codebase is one of the things doing the
// stripping, so this is not a hypothetical.
//
// A room photograph carries the answer in its own geometry. Rooms are boxes: three
// families of parallel lines, mutually perpendicular, each family converging on a
// vanishing point. With the principal point at the image centre, two vanishing
// points in PERPENDICULAR world directions give the focal length in closed form,
// and the vertical one gives the camera's tilt. No model, no training data, no
// download — the same class of thing as `lib/solar.ts`, and on the same side of
// the trust boundary: the output is a hint that still passes through `clampDims`.
//
// Working in the tangent space `lib/photo-geometry.ts` already uses:
//
//     X = u − 0.5                 (u = x / width)
//     Y = (0.5 − v) / aspect      (v = y / height)
//
// so a ray through the image is `(X·k, Y·k, 1)` — exactly `tanX`, `tanY`, 1. Two
// vanishing points are perpendicular world directions when those rays are
// perpendicular:
//
//     X₁X₂k² + Y₁Y₂k² + 1 = 0     ⇒     k² = −1 / (X₁X₂ + Y₁Y₂)
//
// which needs the dot product to be negative — a pair that fails this is not an
// orthogonal pair, and saying nothing is the right answer.
//
// The tilt comes out of the same picture twice over. A world-vertical direction
// projects to the vertical vanishing point, where the ray's forward component is
// zero: `Y_v·k = −cot θ`. The horizon — the join of the two horizontal vanishing
// points — is where the ray's UP component is zero: `Y_h·k = tan θ`. The vertical
// point is used when it exists and the horizon when it does not, because a level
// camera pushes the vertical point to infinity and an oblique one pushes the
// horizon out of frame; between them one is always well conditioned.

export type Segment = { x1: number; y1: number; x2: number; y2: number };

export type VanishingCalibration = {
  /** Horizontal field of view, degrees. */
  hfovDeg: number;
  /** Camera tilt, degrees, positive when the lens points DOWN — the same sign
   *  convention as `CameraCal.tiltRad`. */
  tiltDeg: number;
  /** Total pixel length of the segments the answer explains. Callers use it to
   *  prefer a well-supported estimate over a thin one. */
  support: number;
  /** Share of the measured segment length that the three implied directions
   *  account for, 0..1. The single most useful number for telling a real
   *  calibration from a coincidence — see MIN_COVERAGE. */
  coverage: number;
};

// ─── Sanity gates ───────────────────────────────────────────────────────────
// Every one of these returns null rather than a confident wrong number, which is
// the rule the rest of the geometry engine is written to.

const MIN_HFOV = 20;
const MAX_HFOV = 150;
/** Beyond this the "tilt" is far more likely to be a mis-clustered vanishing
 *  point than a photograph someone actually took of their living room. */
const MAX_TILT_DEG = 30;
/** A vanishing point needs this many segments before it is a direction rather
 *  than a coincidence. Two lines always meet somewhere. */
const MIN_INLIERS = 4;

/** Share of the measured segment length the answer must account for.
 *
 *  This is the gate that separates a calibration from a coincidence, and it is
 *  sharp rather than gradual. Measured on a synthetic room rendered at four
 *  resolutions: every correct answer explained 100% of the segments, and the one
 *  wrong answer — 144 degrees and a 20 degree tilt, comfortably inside all the
 *  other gates — explained 47%. A frame that leaves half the straight lines in a
 *  photograph unaccounted for is not the frame of that room.
 *
 *  Tuned against synthetic scenes only, so it is set well below the 100% they
 *  produce: a real photograph has edges belonging to cushions and pot plants that
 *  no room frame explains. Erring toward rejection is the cheap direction — the
 *  calibration ladder has three fallbacks behind this, and a wrong answer here
 *  mis-sizes an entire room. */
const MIN_COVERAGE = 0.6;

/** How far off parallel a segment may be from the vanishing direction and still
 *  count, in radians. Generous, because the segments come out of a raster and a
 *  20-pixel line has a degree of slop in its endpoints alone. */
const INLIER_TOL = (2.5 * Math.PI) / 180;

/** Pairs considered per RANSAC round. Every pair when there are few segments,
 *  which makes the whole thing DETERMINISTIC — no seed to get wrong, and the same
 *  photo calibrates the same way twice. */
const MAX_SAMPLED = 90;

/** Two hypotheses explaining this much of the same segments are one vanishing
 *  point seen twice, not two directions. */
const SAME_VP_OVERLAP = 0.5;
/** …and two candidates sharing this much cannot be an orthogonal PAIR, whatever
 *  their dot product says: a family that votes for both ends of a pair is the
 *  signature of a straddling hypothesis, not of a box. */
const MAX_PAIR_OVERLAP = 0.25;
/** Distinct vanishing points kept for the pair search. A room has three; the
 *  slack is for the ones fitted to furniture edges. */
const MAX_CANDIDATES = 8;

type Prepared = {
  /** midpoint in tangent-space units */
  mx: number;
  my: number;
  /** unit direction in the same units */
  dx: number;
  dy: number;
  /** pixel length, used as the vote weight */
  len: number;
};

type VP = {
  x: number;
  y: number;
  support: number;
  inliers: number;
  vertical: boolean;
  /** Which pool segments voted for it — the identity used to tell one vanishing
   *  point from another, and to reject a pair drawn from a single family. */
  mask: Uint8Array;
};

/**
 * Recover focal length and tilt from line segments in a photograph.
 *
 * Takes segments rather than pixels so the maths is testable without decoding an
 * image: a synthetic room projected through a known camera has to come back with
 * that camera's numbers, which is a far stronger test than anything that could be
 * asserted about a JPEG.
 */
export function calibrateFromSegments(
  segments: Segment[],
  width: number,
  height: number,
): VanishingCalibration | null {
  if (segments.length < MIN_INLIERS * 2 || width <= 0 || height <= 0) return null;
  const aspect = width / height;

  const prepared: Prepared[] = [];
  for (const s of segments) {
    const px = (s.x2 - s.x1) / width;
    const py = -(s.y2 - s.y1) / (height * aspect);
    const len = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
    const n = Math.hypot(px, py);
    if (n < 1e-9 || len < 1e-9) continue;
    prepared.push({
      mx: (s.x1 + s.x2) / (2 * width) - 0.5,
      my: (0.5 - (s.y1 + s.y2) / (2 * height)) / aspect,
      dx: px / n,
      dy: py / n,
      len,
    });
  }
  if (prepared.length < MIN_INLIERS * 2) return null;

  const pool = [...prepared].sort((a, b) => b.len - a.len).slice(0, MAX_SAMPLED);
  const vps = candidateVanishingPoints(pool);
  if (vps.length < 2) return null;

  // Choose the PAIR, not two vanishing points one after the other.
  //
  // Picking the strongest point, then the strongest of what is left, then testing
  // the survivors for orthogonality is the obvious structure and it is not stable:
  // a candidate that straddles two families scores well, consumes segments from
  // both, and everything after it is fitted to the wreckage. Measured on a
  // synthetic room, a pixel and a half of endpoint noise was enough to flip the
  // answer from 75° to 21° — not a degradation, a different pair being chosen.
  //
  // …and scoring the pair by its own support is not enough either. A hypothesis
  // straddling two families collects segments from both, so "most support"
  // rewards exactly the candidate that should be thrown away. The score is
  // therefore how well the WHOLE FRAME the pair implies explains the whole image:
  // two perpendicular directions fix the third by cross product, and a real box
  // has segments along all three while a straddling pair implies a third direction
  // nothing in the photograph points along.
  let best: { hfovDeg: number; tiltDeg: number; support: number } | null = null;
  for (let i = 0; i < vps.length; i++) {
    for (let j = i + 1; j < vps.length; j++) {
      const a = vps[i];
      const b = vps[j];
      // Two views of the same family are not two directions.
      if (overlap(a.mask, b.mask) > MAX_PAIR_OVERLAP) continue;
      const dot = a.x * b.x + a.y * b.y;
      if (dot >= -1e-6) continue;
      const k = Math.sqrt(-1 / dot);
      if (!Number.isFinite(k) || k <= 0) continue;
      const hfovDeg = (2 * Math.atan(k / 2) * 180) / Math.PI;
      if (hfovDeg < MIN_HFOV || hfovDeg > MAX_HFOV) continue;
      const tiltRad = tiltFrom([a, b], k);
      if (tiltRad === null) continue;
      const tiltDeg = (tiltRad * 180) / Math.PI;
      if (!Number.isFinite(tiltDeg) || Math.abs(tiltDeg) > MAX_TILT_DEG) continue;
      const support = frameSupport(pool, a, b, k);
      if (!best || support > best.support) best = { hfovDeg, tiltDeg, support };
    }
  }
  if (!best) return null;
  const totalLen = pool.reduce((t, s) => t + s.len, 0);
  const coverage = totalLen > 0 ? best.support / totalLen : 0;
  if (coverage < MIN_COVERAGE) return null;
  return { ...best, coverage };
}

/** Total segment length explained by the three perpendicular directions this pair
 *  implies.
 *
 *  The third direction is the cross product of the other two, and it is very often
 *  the one at INFINITY — a wall photographed square-on has its lateral edges
 *  exactly parallel in the image. That case has to be scored, not skipped: it is
 *  the most common composition there is, and skipping it hands the win to whatever
 *  spurious pair happened to imply a finite third point. */
function frameSupport(pool: Prepared[], a: VP, b: VP, k: number): number {
  const d1: [number, number, number] = [a.x * k, a.y * k, 1];
  const d2: [number, number, number] = [b.x * k, b.y * k, 1];
  const d3: [number, number, number] = [
    d1[1] * d2[2] - d1[2] * d2[1],
    d1[2] * d2[0] - d1[0] * d2[2],
    d1[0] * d2[1] - d1[1] * d2[0],
  ];
  const n3 = Math.hypot(...d3);
  let third: { point: { x: number; y: number } } | { dir: [number, number] } | null = null;
  if (n3 > 1e-9) {
    if (Math.abs(d3[2]) / n3 > 1e-3) {
      third = { point: { x: d3[0] / d3[2] / k, y: d3[1] / d3[2] / k } };
    } else if (Math.hypot(d3[0], d3[1]) > 1e-9) {
      third = { dir: [d3[0], d3[1]] };
    }
  }

  const sinTol = Math.sin(INLIER_TOL);
  let total = 0;
  for (const s of pool) {
    if (consistent(s, a) || consistent(s, b)) {
      total += s.len;
      continue;
    }
    if (!third) continue;
    if ('point' in third) {
      if (consistent(s, third.point)) total += s.len;
    } else {
      const [ux, uy] = third.dir;
      const n = Math.hypot(ux, uy);
      if (Math.abs((s.dx * uy - s.dy * ux) / n) <= sinTol) total += s.len;
    }
  }
  return total;
}

/** Share of the smaller inlier set the two have in common. */
function overlap(a: Uint8Array, b: Uint8Array): number {
  let both = 0;
  let ca = 0;
  let cb = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i]) ca++;
    if (b[i]) cb++;
    if (a[i] && b[i]) both++;
  }
  const smaller = Math.min(ca, cb);
  return smaller === 0 ? 1 : both / smaller;
}

/** Tilt from whichever construction is conditioned for this photograph. */
function tiltFrom(vps: VP[], k: number): number | null {
  const vertical = vps.find((v) => v.vertical);
  if (vertical) {
    const b = vertical.y * k;
    // A level camera pushes the vertical point toward infinity; the reciprocal
    // handles it gracefully, but a point AT the horizon line is a mis-cluster.
    if (Math.abs(b) < 1e-6) return null;
    return Math.atan(-1 / b);
  }
  // No vertical point: the horizon is the join of two horizontal ones, and the
  // tilt is where it sits relative to the image centre.
  const horiz = vps.filter((v) => !v.vertical);
  if (horiz.length < 2) return null;
  const [h1, h2] = horiz;
  const dx = h2.x - h1.x;
  if (Math.abs(dx) < 1e-9) return null; // horizon vertical in the image: not a horizon
  const yAtCentre = h1.y + ((h2.y - h1.y) * (0 - h1.x)) / dx;
  return Math.atan(yAtCentre * k);
}

/** Every distinct vanishing point the segments support, strongest first.
 *
 *  Exhaustive over segment pairs rather than randomly sampled: the pool is
 *  bounded, so this is cheap, and a DETERMINISTIC answer matters more here than
 *  the last few percent of speed — the same photo has to calibrate the same way
 *  twice, and a seeded RNG is one more thing to get wrong.
 *
 *  Deduplicated by inlier set rather than by position: two hypotheses built from
 *  different pairs of the same family land at slightly different points but
 *  explain the same segments, and treating those as two directions is how a
 *  spurious "orthogonal pair" gets made out of one family. */
function candidateVanishingPoints(pool: Prepared[]): VP[] {
  const found: VP[] = [];
  for (let a = 0; a < pool.length; a++) {
    for (let b = a + 1; b < pool.length; b++) {
      const v = intersect(pool[a], pool[b]);
      if (!v) continue;
      const mask = new Uint8Array(pool.length);
      let support = 0;
      let inliers = 0;
      let vert = 0;
      let horiz = 0;
      for (let i = 0; i < pool.length; i++) {
        if (!consistent(pool[i], v)) continue;
        mask[i] = 1;
        support += pool[i].len;
        inliers++;
        // Vertical in the IMAGE — what tells a wall corner from a skirting board.
        // Weighted by length so one stray short segment cannot flip it.
        if (Math.abs(pool[i].dy) > Math.abs(pool[i].dx)) vert += pool[i].len;
        else horiz += pool[i].len;
      }
      if (inliers < MIN_INLIERS) continue;
      found.push({ x: v.x, y: v.y, support, inliers, vertical: vert > horiz, mask });
    }
  }
  found.sort((p, q) => q.support - p.support);

  const kept: VP[] = [];
  for (const c of found) {
    if (kept.length >= MAX_CANDIDATES) break;
    if (kept.some((k) => overlap(k.mask, c.mask) > SAME_VP_OVERLAP)) continue;
    kept.push(c);
  }
  return kept;
}

/** Where the infinite lines through two segments meet, or null when they are
 *  parallel — a vanishing point at infinity carries no focal length. */
function intersect(p: Prepared, q: Prepared): { x: number; y: number } | null {
  // Line through a point with a direction: dy·x − dx·y + (dx·py − dy·px) = 0.
  const a1 = p.dy;
  const b1 = -p.dx;
  const c1 = p.dx * p.my - p.dy * p.mx;
  const a2 = q.dy;
  const b2 = -q.dx;
  const c2 = q.dx * q.my - q.dy * q.mx;
  const w = a1 * b2 - b1 * a2;
  // Scaled against the directions' own magnitudes (both unit), so this is
  // |sin(angle between them)| — a true parallelism test rather than a threshold
  // on an arbitrary determinant.
  if (Math.abs(w) < 1e-4) return null;
  return { x: (b1 * c2 - c1 * b2) / w, y: (c1 * a2 - a1 * c2) / w };
}

/** Does this segment point at that vanishing point?
 *
 *  The angle between the segment and the line joining it to the point — NOT the
 *  distance from the point to the segment's line. Distance is meaningless here:
 *  a vanishing point ten image-widths away is normal, and every real inlier would
 *  fail a distance threshold that a nearby false one passes. */
function consistent(s: Prepared, v: { x: number; y: number }): boolean {
  const tx = v.x - s.mx;
  const ty = v.y - s.my;
  const n = Math.hypot(tx, ty);
  if (n < 1e-9) return false;
  // |sin| of the angle between the two unit directions.
  const sin = Math.abs((s.dx * ty - s.dy * tx) / n);
  return sin <= Math.sin(INLIER_TOL);
}

// ─── Finding the segments ───────────────────────────────────────────────────
//
// A cut-down Line Segment Detector: gradient, then grow regions of pixels whose
// gradient points the same way, then take each region's principal axis. That is
// LSD's core idea without its statistical validation step, which exists to bound
// false detections in arbitrary images — here a false segment costs one RANSAC
// outlier among dozens, which the inlier count already absorbs.
//
// A Hough transform would have been the obvious alternative and is the wrong tool:
// it returns infinite lines, and the consistency test above needs a segment's
// MIDPOINT to measure an angle from.

/** Gradient magnitude below which a pixel is texture, as a fraction of the
 *  strongest gradient in the image. Relative, so it survives a dim photo. */
const EDGE_FRACTION = 0.12;
/** How far two neighbouring pixels' gradients may point apart and still be called
 *  the same edge, in radians. LSD's own default. */
const ANGLE_TOL = (22.5 * Math.PI) / 180;
/** A region flatter than this is a line; anything rounder is a blob or a corner
 *  and its "principal axis" would be noise. */
const MAX_THICKNESS_RATIO = 0.3;
const MAX_SEGMENTS = 400;

/** Luminance from RGBA pixels — the shape `CanvasRenderingContext2D.getImageData`
 *  hands back. Rec. 709 weights, matching `lib/image-quality.ts`. */
export function toGrayscale(rgba: Uint8ClampedArray, width: number, height: number): Float32Array {
  const out = new Float32Array(width * height);
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    out[i] = 0.2126 * rgba[p] + 0.7152 * rgba[p + 1] + 0.0722 * rgba[p + 2];
  }
  return out;
}

/** Straight edges in a greyscale image, longest first. */
export function detectSegments(gray: Float32Array, width: number, height: number): Segment[] {
  if (width < 8 || height < 8 || gray.length < width * height) return [];
  const n = width * height;
  const mag = new Float32Array(n);
  const ang = new Float32Array(n);
  let maxMag = 0;

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const tl = gray[i - width - 1];
      const tc = gray[i - width];
      const tr = gray[i - width + 1];
      const ml = gray[i - 1];
      const mr = gray[i + 1];
      const bl = gray[i + width - 1];
      const bc = gray[i + width];
      const br = gray[i + width + 1];
      const gx = tr + 2 * mr + br - (tl + 2 * ml + bl);
      const gy = bl + 2 * bc + br - (tl + 2 * tc + tr);
      const m = Math.hypot(gx, gy);
      mag[i] = m;
      ang[i] = Math.atan2(gy, gx);
      if (m > maxMag) maxMag = m;
    }
  }
  if (maxMag <= 0) return [];
  const threshold = maxMag * EDGE_FRACTION;
  const minLen = Math.max(24, Math.min(width, height) * 0.04);

  const seen = new Uint8Array(n);
  const stack = new Int32Array(n);
  const region: number[] = [];
  const segments: Array<Segment & { len: number }> = [];

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const start = y * width + x;
      if (seen[start] || mag[start] < threshold) continue;

      // Grow against the region's RUNNING MEAN angle rather than the seed's, so a
      // gently curving edge is not chased round a corner by its own drift.
      region.length = 0;
      let sumSin = Math.sin(ang[start]);
      let sumCos = Math.cos(ang[start]);
      let top = 0;
      stack[top++] = start;
      seen[start] = 1;
      region.push(start);
      while (top > 0) {
        const at = stack[--top];
        const ax = at % width;
        const ay = (at - ax) / width;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = ax + dx;
            const ny = ay + dy;
            if (nx < 1 || ny < 1 || nx >= width - 1 || ny >= height - 1) continue;
            const ni = ny * width + nx;
            if (seen[ni] || mag[ni] < threshold) continue;
            const mean = Math.atan2(sumSin, sumCos);
            let d = ang[ni] - mean;
            while (d > Math.PI) d -= 2 * Math.PI;
            while (d < -Math.PI) d += 2 * Math.PI;
            if (Math.abs(d) > ANGLE_TOL) continue;
            seen[ni] = 1;
            sumSin += Math.sin(ang[ni]);
            sumCos += Math.cos(ang[ni]);
            stack[top++] = ni;
            region.push(ni);
          }
        }
      }
      if (region.length < 8) continue;

      const seg = principalAxis(region, width, minLen);
      if (seg) segments.push(seg);
    }
  }

  segments.sort((a, b) => b.len - a.len);
  return segments.slice(0, MAX_SEGMENTS).map(({ x1, y1, x2, y2 }) => ({ x1, y1, x2, y2 }));
}

/** The region's long axis, as a segment — or null when the region is too round
 *  or too short to be a line. */
function principalAxis(
  region: number[],
  width: number,
  minLen: number,
): (Segment & { len: number }) | null {
  let sx = 0;
  let sy = 0;
  for (const i of region) {
    const x = i % width;
    sx += x;
    sy += (i - x) / width;
  }
  const cx = sx / region.length;
  const cy = sy / region.length;

  let xx = 0;
  let xy = 0;
  let yy = 0;
  for (const i of region) {
    const x = i % width;
    const dx = x - cx;
    const dy = (i - x) / width - cy;
    xx += dx * dx;
    xy += dx * dy;
    yy += dy * dy;
  }
  xx /= region.length;
  xy /= region.length;
  yy /= region.length;

  // Eigenvalues of the 2×2 covariance, largest first.
  const tr = xx + yy;
  const det = xx * yy - xy * xy;
  const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
  const l1 = tr / 2 + disc;
  const l2 = tr / 2 - disc;
  if (l1 <= 1e-9) return null;
  if (Math.sqrt(Math.max(0, l2) / l1) > MAX_THICKNESS_RATIO) return null;

  // Eigenvector for l1.
  let ex = xy;
  let ey = l1 - xx;
  if (Math.hypot(ex, ey) < 1e-9) {
    ex = 1;
    ey = 0;
  }
  const en = Math.hypot(ex, ey);
  ex /= en;
  ey /= en;

  let tMin = Infinity;
  let tMax = -Infinity;
  for (const i of region) {
    const x = i % width;
    const t = (x - cx) * ex + ((i - x) / width - cy) * ey;
    if (t < tMin) tMin = t;
    if (t > tMax) tMax = t;
  }
  const len = tMax - tMin;
  if (len < minLen) return null;
  return {
    x1: cx + ex * tMin,
    y1: cy + ey * tMin,
    x2: cx + ex * tMax,
    y2: cy + ey * tMax,
    len,
  };
}

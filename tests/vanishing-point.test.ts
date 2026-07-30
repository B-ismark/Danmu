import { describe, it, expect } from 'vitest';
import { calibrateFromSegments, detectSegments, toGrayscale, type Segment } from '@/lib/vanishing-point';

// A synthetic room, projected through a camera whose focal length and tilt we
// chose, has to come back with those numbers. That is a far stronger test than
// anything that could be asserted about a real JPEG, and it exercises exactly the
// property the module claims: the geometry of a box is enough.

const W = 1600;
const H = 1200;
const ASPECT = W / H;

const hfovToK = (deg: number) => 2 * Math.tan(((deg / 2) * Math.PI) / 180);

/** Project a world point (camera at the origin, axes right / up / forward) into
 *  pixels. The exact inverse of `ray()` in lib/photo-geometry.ts: that maps an
 *  image point to (a, b·cosθ − sinθ, b·sinθ + cosθ), and −sin·up + cos·fwd
 *  recovers the 1 while cos·up + sin·fwd recovers b. */
function project(
  p: [number, number, number],
  k: number,
  tiltRad: number,
): [number, number] | null {
  const [right, up, fwd] = p;
  const c = Math.cos(tiltRad);
  const s = Math.sin(tiltRad);
  const denom = -s * up + c * fwd;
  if (denom <= 1e-6) return null; // behind the camera
  const a = right / denom;
  const b = (c * up + s * fwd) / denom;
  return [(0.5 + a / k) * W, (0.5 - (b * ASPECT) / k) * H];
}

/** Turn the camera on the spot — rotation about the world's own up axis, which
 *  leaves vertical lines vertical and gives the two horizontal families finite
 *  vanishing points instead of parallel ones. */
function yawed(p: [number, number, number], yawRad: number): [number, number, number] {
  const c = Math.cos(yawRad);
  const s = Math.sin(yawRad);
  return [p[0] * c + p[2] * s, p[1], -p[0] * s + p[2] * c];
}

/** The edges of a box room, as world segments in three perpendicular families. */
function roomEdges(): Array<[[number, number, number], [number, number, number]]> {
  const out: Array<[[number, number, number], [number, number, number]]> = [];
  const xs = [-2, -0.7, 0.7, 2];
  const ys = [-1.5, 1.3];
  const zs = [2.5, 4.5, 6.5];
  for (const x of xs) for (const z of [zs[0], zs[2]]) out.push([[x, ys[0], z], [x, ys[1], z]]);
  for (const x of xs) for (const y of ys) out.push([[x, y, zs[0]], [x, y, zs[2]]]);
  for (const y of ys) for (const z of zs) out.push([[xs[0], y, z], [xs[3], y, z]]);
  return out;
}

function sceneSegments(k: number, tiltRad: number, yawRad = 0): Segment[] {
  const out: Segment[] = [];
  for (const [a, b] of roomEdges()) {
    const pa = project(yawed(a, yawRad), k, tiltRad);
    const pb = project(yawed(b, yawRad), k, tiltRad);
    if (!pa || !pb) continue;
    out.push({ x1: pa[0], y1: pa[1], x2: pb[0], y2: pb[1] });
  }
  return out;
}

describe('calibrateFromSegments', () => {
  it('recovers a lens and a tilt from a head-on room', () => {
    // Head-on, so the lateral family is parallel in the image and contributes no
    // vanishing point. The depth and vertical families are enough — they are
    // perpendicular, which is the only thing the closed form asks for.
    const got = calibrateFromSegments(sceneSegments(hfovToK(75), (6 * Math.PI) / 180), W, H);
    expect(got).not.toBeNull();
    expect(got!.hfovDeg).toBeCloseTo(75, 1);
    expect(got!.tiltDeg).toBeCloseTo(6, 1);
  });

  it('recovers an ultrawide, which is the lens the default is worst for', () => {
    // A 66° default under-reads a 106° ultrawide by more than a factor of two.
    const got = calibrateFromSegments(sceneSegments(hfovToK(106), (4 * Math.PI) / 180), W, H);
    expect(got).not.toBeNull();
    expect(got!.hfovDeg).toBeCloseTo(106, 1);
    expect(got!.tiltDeg).toBeCloseTo(4, 1);
  });

  it('handles a level camera, where the vertical point runs off to infinity', () => {
    // Nothing converges vertically, so the tilt has to come from the horizon
    // instead — a different branch, and the common case for a photo taken at
    // chest height.
    const got = calibrateFromSegments(sceneSegments(hfovToK(70), 0, (25 * Math.PI) / 180), W, H);
    expect(got).not.toBeNull();
    expect(got!.hfovDeg).toBeCloseTo(70, 1);
    expect(Math.abs(got!.tiltDeg)).toBeLessThan(0.5);
  });

  it('handles an oblique tilted view, where all three points are finite', () => {
    const got = calibrateFromSegments(sceneSegments(hfovToK(82), (9 * Math.PI) / 180, (20 * Math.PI) / 180), W, H);
    expect(got).not.toBeNull();
    expect(got!.hfovDeg).toBeCloseTo(82, 1);
    expect(got!.tiltDeg).toBeCloseTo(9, 1);
  });

  it('survives noisy endpoints, because a raster does not give exact ones', () => {
    const rand = rng(7);
    const noisy = sceneSegments(hfovToK(75), (6 * Math.PI) / 180).map((s) => ({
      x1: s.x1 + (rand() - 0.5) * 3,
      y1: s.y1 + (rand() - 0.5) * 3,
      x2: s.x2 + (rand() - 0.5) * 3,
      y2: s.y2 + (rand() - 0.5) * 3,
    }));
    const got = calibrateFromSegments(noisy, W, H);
    expect(got).not.toBeNull();
    // Measured, not guessed: a sweep of 0, 1, 2, 3 and 5 px of endpoint noise on
    // this scene gives 75.00, 75.03, 75.06, 75.74 and 76.23 degrees, with the tilt
    // never moving past 6.03. The bound below is the worst of those with a little
    // room; tightening it would be a claim the method does not support, and
    // loosening it would stop catching a regression.
    expect(Math.abs(got!.hfovDeg - 75)).toBeLessThan(1.5);
    expect(Math.abs(got!.tiltDeg - 6)).toBeLessThan(0.5);
  });

  it('says nothing rather than something wrong', () => {
    // One family of parallel lines is not a calibration, however many of them
    // there are: a single vanishing point cannot give a focal length.
    const oneFamily: Segment[] = [];
    for (let i = 0; i < 12; i++) oneFamily.push({ x1: 100 + i * 90, y1: 100, x2: 100 + i * 90, y2: 900 });
    expect(calibrateFromSegments(oneFamily, W, H)).toBeNull();
    // …and neither is a handful of segments.
    expect(calibrateFromSegments(oneFamily.slice(0, 3), W, H)).toBeNull();
    expect(calibrateFromSegments([], W, H)).toBeNull();
  });

  it('refuses a result outside the range a camera can have', () => {
    // Two vanishing points that are not orthogonal directions produce an
    // arbitrary focal length. The gates are what stop that reaching clampDims as
    // a "measurement".
    const absurd: Segment[] = [];
    for (let i = 0; i < 6; i++) {
      absurd.push({ x1: 800, y1: 600, x2: 800 + Math.cos(i) * 400, y2: 600 + Math.sin(i) * 400 });
    }
    const got = calibrateFromSegments(absurd, W, H);
    if (got) {
      expect(got.hfovDeg).toBeGreaterThanOrEqual(20);
      expect(got.hfovDeg).toBeLessThanOrEqual(150);
      expect(Math.abs(got.tiltDeg)).toBeLessThanOrEqual(30);
    }
  });
});

// ─── The detector ───────────────────────────────────────────────────────────

// The detector's own tests run small because they are about orientation, not
// accuracy. The end-to-end test below runs at 1600 x 1200, which is what
// `normalizePhoto` actually produces: it caps the long edge at 1600, so that is
// the resolution real input arrives at.
const IW = 480;
const IH = 360;

/** Paint a bright line into a dark field, three pixels wide. */
function draw(img: Float32Array, w: number, h: number, s: Segment, value = 235) {
  const steps = Math.ceil(Math.hypot(s.x2 - s.x1, s.y2 - s.y1) * 2);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = Math.round(s.x1 + (s.x2 - s.x1) * t);
    const y = Math.round(s.y1 + (s.y2 - s.y1) * t);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const px = x + dx;
        const py = y + dy;
        if (px < 0 || py < 0 || px >= w || py >= h) continue;
        img[py * w + px] = value;
      }
    }
  }
}

function blank(w: number, h: number, value = 25): Float32Array {
  return new Float32Array(w * h).fill(value);
}

/** Angle of a segment, folded to [0, 180). */
function angleOf(s: Segment): number {
  const a = (Math.atan2(s.y2 - s.y1, s.x2 - s.x1) * 180) / Math.PI;
  return ((a % 180) + 180) % 180;
}

describe('detectSegments', () => {
  it('finds the bars that are there and nothing that is not', () => {
    const img = blank(IW, IH);
    draw(img, IW, IH, { x1: 120, y1: 40, x2: 120, y2: 320 });
    draw(img, IW, IH, { x1: 300, y1: 40, x2: 300, y2: 320 });
    const found = detectSegments(img, IW, IH);
    expect(found.length).toBeGreaterThanOrEqual(2);
    // A drawn bar has two edges, so more than two segments is right, not wrong —
    // but every one of them must be vertical.
    for (const s of found) {
      const a = angleOf(s);
      expect(Math.min(a, 180 - a)).toBeGreaterThan(85);
    }
  });

  it('separates orientations rather than merging them at a crossing', () => {
    const img = blank(IW, IH);
    draw(img, IW, IH, { x1: 60, y1: 180, x2: 420, y2: 180 });
    draw(img, IW, IH, { x1: 240, y1: 30, x2: 240, y2: 330 });
    const angles = detectSegments(img, IW, IH).map(angleOf);
    expect(angles.some((a) => Math.min(a, 180 - a) < 5)).toBe(true);
    expect(angles.some((a) => Math.min(a, 180 - a) > 85)).toBe(true);
  });

  it('keeps its hands off an image with nothing in it', () => {
    expect(detectSegments(blank(IW, IH), IW, IH)).toEqual([]);
  });

  it('rejects a blob, which has no principal axis worth the name', () => {
    const img = blank(IW, IH);
    for (let y = 150; y < 210; y++) for (let x = 210; x < 270; x++) img[y * IW + x] = 235;
    for (const s of detectSegments(img, IW, IH)) {
      // A square's own edges are legitimate lines; what must NOT come back is a
      // diagonal through the middle of it.
      const a = angleOf(s);
      const off = Math.min(a, Math.abs(a - 90), 180 - a);
      expect(off).toBeLessThan(6);
    }
  });
});

describe('end to end, from pixels', () => {
  /** Rasterise a room seen through a known camera, at a given size. */
  function render(w: number, h: number, hfovDeg: number, tiltDeg: number, yawDeg: number) {
    const k = hfovToK(hfovDeg);
    const tilt = (tiltDeg * Math.PI) / 180;
    const img = blank(w, h);
    let drawn = 0;
    for (const [a, b] of roomEdges()) {
      const pa = project(yawed(a, (yawDeg * Math.PI) / 180), k, tilt);
      const pb = project(yawed(b, (yawDeg * Math.PI) / 180), k, tilt);
      if (!pa || !pb) continue;
      const s = { x1: (pa[0] / W) * w, y1: (pa[1] / H) * h, x2: (pb[0] / W) * w, y2: (pb[1] / H) * h };
      if (!Number.isFinite(s.x1 + s.y1 + s.x2 + s.y2)) continue;
      if (Math.max(s.x1, s.x2) < 0 || Math.min(s.x1, s.x2) > w) continue;
      if (Math.max(s.y1, s.y2) < 0 || Math.min(s.y1, s.y2) > h) continue;
      draw(img, w, h, s);
      drawn++;
    }
    return { img, drawn };
  }

  it('calibrates a drawn perspective room at the size photos actually arrive', () => {
    // The whole pipeline: rasterise a room whose camera we know, find the edges
    // back out of the pixels, and recover the lens. 1600 x 1200 because that is
    // what normalizePhoto produces.
    const { img, drawn } = render(1600, 1200, 78, 7, 18);
    expect(drawn).toBeGreaterThan(8);
    const got = calibrateFromSegments(detectSegments(img, 1600, 1200), 1600, 1200);
    expect(got).not.toBeNull();
    // Measured 78.04 and 7.02 against a truth of 78 and 7.
    expect(Math.abs(got!.hfovDeg - 78)).toBeLessThan(1.5);
    expect(Math.abs(got!.tiltDeg - 7)).toBeLessThan(1);
    expect(got!.coverage).toBeGreaterThan(0.9);
  });

  it('says nothing when the pixels do not support an answer', () => {
    // Same scene at 800 x 600, where the edge fragments are short enough that the
    // best frame explains under half the segments. Before the coverage gate this
    // returned 143.85 degrees and a −20 degree tilt — a confidently wrong answer,
    // comfortably inside every other sanity bound, which would have gone through
    // clampDims as a measurement. It is the reason that gate exists.
    const { img } = render(800, 600, 78, 7, 18);
    expect(calibrateFromSegments(detectSegments(img, 800, 600), 800, 600)).toBeNull();
  });
});

describe('toGrayscale', () => {
  it('uses the same luminance weights the rest of the app does', () => {
    const rgba = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255]);
    const g = toGrayscale(rgba, 4, 1);
    expect(g[0]).toBeCloseTo(0.2126 * 255, 4);
    expect(g[1]).toBeCloseTo(0.7152 * 255, 4);
    expect(g[2]).toBeCloseTo(0.0722 * 255, 4);
    expect(g[3]).toBeCloseTo(255, 4);
  });
});

/** Seeded PRNG — a flaky geometry test is worse than no geometry test. */
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

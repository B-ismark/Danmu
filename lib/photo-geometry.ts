// Photo geometry engine — deterministic position + size from a wall photo.
//
// The capture rig is standardised: camera at the ROOM CENTRE, CAM_HEIGHT off
// the floor, level, framing one wall straight-on (slots n/e/s/w). The user
// already entered the room's real W×D×H. That makes every photo a calibrated
// scene: a pinhole camera at a known pose looking at a wall at a known
// distance. From a 2D bounding box alone we can then compute, with no AI:
//
//   · the object's floor position — backproject the bbox bottom edge onto the
//     floor plane (y = 0), i.e. a floor homography
//   · its real width and height — angular size × distance
//
// Only depth (front-to-back) is unobservable from one photo; it stays with the
// category default and clampDims guards it like everything else. The one
// exception is a CEILING object, where height is unobservable too — a fan seen
// from below projects as a disc, so its bbox has no thickness in it. See
// `placeCeilingObject`.
//
// World frame matches lib/detection.ts: origin = room-centre floor, +X East,
// +Y up, +Z toward the South wall. Slot cameras: n looks −Z, s +Z, e +X, w −X.

import type { CaptureSlot } from './storage';
import {
  calibrateFromSegments,
  detectSegments,
  toGrayscale,
  type VanishingCalibration,
} from './vanishing-point';

/** Camera height assumed when the photo and the user tell us nothing (metres).
 *  A real shooter is anywhere between about 1.2 and 1.75 m, and distance scales
 *  linearly with this number (∂d/∂h = d/h), so an assumed height is a ±17% error
 *  on every width and height derived from the photo. `CameraCal.height` carries a
 *  known one; this is only the floor. */
export const CAM_HEIGHT = 1.5;

/** Default horizontal FOV when nothing better is available — typical phone
 *  main camera (~66°). EXIF, then the wall-floor line, replace this. A wall shot
 *  in a small room is often taken on the ULTRAWIDE (~106°), which this under-reads
 *  by more than a factor of two: that mis-sizes wall-mounted items directly, and
 *  mis-PLACES floor-standing ones (their size survives, because distance scales as
 *  1/k and angular size as k — until the wall clamp breaks the cancellation). */
const DEFAULT_HFOV_DEG = 66;

export type CameraCal = {
  /** tan of half-hFOV × 2 — horizontal tangent span per normalized image unit:
   *  tanX(u) = (u − 0.5) · k */
  k: number;
  /** image aspect (width / height) — vertical tangent uses k / aspect. */
  aspect: number;
  /** Camera height off the floor in metres. Absent → CAM_HEIGHT. */
  height?: number;
  /** Camera tilt in radians, positive when the lens points DOWN. Absent → level.
   *  Handheld shots are routinely 5° off, which at 3 m under-reads distance by
   *  19% — the single largest error in this module when it is not known. */
  tiltRad?: number;
};

export function defaultCal(aspect: number): CameraCal {
  return { k: 2 * Math.tan(((DEFAULT_HFOV_DEG / 2) * Math.PI) / 180), aspect };
}

/** Build a calibration from a known horizontal field of view — the EXIF path.
 *  See `hfovFromFocal35` in lib/exif.ts for where the angle comes from. */
export function calFromHfov(hfovDeg: number, aspect: number, view?: CameraView): CameraCal {
  return { k: 2 * Math.tan(((hfovDeg / 2) * Math.PI) / 180), aspect, ...view };
}

/** What we know about where the camera was, as opposed to what lens it had. */
export type CameraView = { height?: number; tiltRad?: number };

const heightOf = (cal: CameraCal) => cal.height ?? CAM_HEIGHT;
const tiltOf = (cal: CameraCal) => cal.tiltRad ?? 0;

/** Distance from the room-centre camera to the framed wall. */
export function wallDistance(slot: CaptureSlot, room: { width: number; depth: number }): number {
  return slot === 'n' || slot === 's' ? room.depth / 2 : room.width / 2;
}

/** How wide the wall in this slot is — the other half of the same convention, so
 *  it lives beside it rather than in the screen that shows it. `slotToWorld` puts
 *  n and s across the room's width and e and w across its depth, and getting one
 *  of these two functions right while the other disagrees is a room measured off
 *  the wrong axis.
 *
 *  Read by `lib/capture-slots.ts` for the one check a person can make against
 *  their own photograph: a slot whose wall should be 5.6 m wide, holding a
 *  picture of a 4.2 m wall, is a set that wants rotating. */
export function wallSpan(slot: CaptureSlot, room: { width: number; depth: number }): number {
  return slot === 'n' || slot === 's' ? room.width : room.depth;
}

/**
 * The wall-floor line ties camera height, focal length and tilt together in one
 * equation — which means it can solve for ONE of them when the other two are
 * known.
 *
 * A ray leaving the camera at image row v has, after the tilt rotation, a
 * vertical component `b·cosθ − sinθ` and a forward component `b·sinθ + cosθ`
 * where `b = tanY(v)`. Requiring it to land on the floor at exactly the wall
 * distance D gives
 *
 *     b = (D·sinθ − H·cosθ) / (H·sinθ + D·cosθ)
 *
 * which reduces to the familiar `b = −H/D` for a level camera. `bAtFloorLine`
 * below is that expression; the two solvers each invert it for their unknown.
 */
function bAtFloorLine(height: number, d: number, tiltRad: number): number {
  const c = Math.cos(tiltRad);
  const s = Math.sin(tiltRad);
  const denom = height * s + d * c;
  return denom === 0 ? NaN : (d * s - height * c) / denom;
}

/**
 * Solve for FOCAL LENGTH, assuming a camera height. The original path, still the
 * fallback when the photo carries no lens information.
 *
 * Returns null when vFloor is implausible (≤ centre — the floor line must be in
 * the lower half of a level frame) or the answer is not a lens.
 */
export function calibrateFromFloorLine(
  vFloor: number,
  slot: CaptureSlot,
  room: { width: number; depth: number },
  aspect: number,
  view?: CameraView,
): CameraCal | null {
  if (vFloor <= 0.52 || vFloor >= 0.99) return null;
  const d = wallDistance(slot, room);
  const height = view?.height ?? CAM_HEIGHT;
  const tiltRad = view?.tiltRad ?? 0;
  const b = bAtFloorLine(height, d, tiltRad);
  if (!Number.isFinite(b)) return null;
  // b = (0.5 − vFloor)·k / aspect, and 0.5 − vFloor is negative here.
  const k = (b * aspect) / (0.5 - vFloor);
  if (!(k > 0)) return null;
  // Sanity: equivalent hFOV between 30° and 120°.
  const hfov = (2 * Math.atan(k / 2) * 180) / Math.PI;
  if (hfov < 30 || hfov > 120) return null;
  return { k, aspect, ...view };
}

/** Plausible band for a solved camera height, in metres. Outside it the floor
 *  line was not the floor line — a rug edge, a skirting shadow, a strip of
 *  sunlight — and the honest answer is "no measurement", not a confident wrong
 *  number. */
const MIN_SOLVED_HEIGHT = 0.8;
const MAX_SOLVED_HEIGHT = 2.2;

/**
 * Solve for CAMERA HEIGHT, given a known lens.
 *
 * This is the same one equation as `calibrateFromFloorLine`, inverted for the
 * other unknown. When EXIF tells us the field of view, height stops being the
 * 1.5 m assumption that costs ±17% on every measurement and becomes something
 * the photo measured:
 *
 *     H = D · (sinθ − b·cosθ) / (b·sinθ + cosθ)
 */
export function heightFromFloorLine(
  vFloor: number,
  slot: CaptureSlot,
  room: { width: number; depth: number },
  cal: CameraCal,
): number | null {
  if (vFloor <= 0.5 || vFloor >= 0.99) return null;
  const d = wallDistance(slot, room);
  const b = ((0.5 - vFloor) * cal.k) / cal.aspect;
  const tiltRad = tiltOf(cal);
  const c = Math.cos(tiltRad);
  const s = Math.sin(tiltRad);
  const denom = b * s + c;
  if (denom === 0) return null;
  const height = (d * (s - b * c)) / denom;
  if (!Number.isFinite(height) || height < MIN_SOLVED_HEIGHT || height > MAX_SOLVED_HEIGHT) return null;
  return height;
}

const tanX = (u: number, cal: CameraCal) => (u - 0.5) * cal.k;
/** positive up */
const tanY = (v: number, cal: CameraCal) => ((0.5 - v) * cal.k) / cal.aspect;

/** Direction of the ray through a normalized image point, in world-aligned
 *  camera axes (right / up / forward) with the camera's tilt applied.
 *
 *  Tilting the lens down by θ rotates every ray about the camera's right axis:
 *  the forward axis itself acquires `up = −sinθ`, which is what makes a level
 *  camera's simple `distance = height / tanDown` wrong by 19% at 3 m for a very
 *  ordinary 5° of handheld droop. At θ = 0 this collapses to (tanX, tanY, 1) and
 *  every formula below reduces to the one it replaced. */
function ray(u: number, v: number, cal: CameraCal): { right: number; up: number; fwd: number } {
  const a = tanX(u, cal);
  const b = tanY(v, cal);
  const c = Math.cos(tiltOf(cal));
  const s = Math.sin(tiltOf(cal));
  return { right: a, up: b * c - s, fwd: b * s + c };
}

/** Map a camera-frame (forward, right) floor point into world XZ + facing yaw. */
function slotToWorld(
  slot: CaptureSlot,
  forward: number,
  right: number,
): { x: number; z: number; yaw: number } {
  switch (slot) {
    // Image LEFT = −X → right = +X; looking −Z. Wall items face +Z (yaw 0).
    case 'n':
      return { x: right, z: -forward, yaw: 0 };
    // Image LEFT = +X (mirrored) → right = −X; looking +Z. Face −Z (yaw π).
    case 's':
      return { x: -right, z: forward, yaw: Math.PI };
    // Image LEFT = −Z → right = +Z; looking +X. Face −X (yaw −π/2).
    case 'e':
      return { x: forward, z: right, yaw: -Math.PI / 2 };
    // Image LEFT = +Z → right = −Z; looking −X. Face +X (yaw +π/2).
    case 'w':
      return { x: -forward, z: -right, yaw: Math.PI / 2 };
  }
}

export type GeoPlacement = {
  /** world position — x/z centre; y = 0 floor anchor (floor), mount centre
   *  (wall), or the ceiling plane itself (ceiling — the surface intersected, not an
   *  estimate; the row of the bbox that is intersected is the MIDDLE one, and
   *  `placeCeilingObject` is where that matters). Downstream, `groundY` owns this
   *  axis outright. */
  position: { x: number; y: number; z: number };
  /** real size estimate in mm — [W, H]; depth is NOT observable from one photo. */
  widthMM: number;
  heightMM: number;
  /** facing-into-the-room yaw for wall-adjacent items. */
  yaw: number;
  /** Forward distance from the camera, in metres.
   *
   *  Not a confidence input, though it read as one for a while — the doc used to
   *  say "useful for confidence weighting" and PlanDetect's Phase 6 listed wiring
   *  it in. It was declined there and the reason belongs here: `lib/detect-confidence.ts`
   *  argues that the fix for an uncalibrated number is corroboration, not a second
   *  invented threshold, and "a detection more than X metres away is Y less certain"
   *  is exactly that second invented threshold.
   *
   *  What it IS for: the observable these placements are tested through. A caller
   *  reads `pos` and `dimMM`, but a test cannot tell a tilt-aware solve from a naive
   *  one by looking at a position — the distance is the term the calibration
   *  actually moves, so `tests/photo-geometry.test.ts` asserts on it directly
   *  (clamped to the wall, ratio against the assumed-height solve, and so on).
   *  `RoomTools`' `top.distance` is a different type; nothing reads this one at
   *  runtime, and that is correct rather than an oversight. */
  distance: number;
};

/**
 * Floor-standing object: backproject the bbox bottom-centre onto the floor
 * plane, then size from angular extents at that distance.
 * box = [x, y, w, h] normalized 0..1, origin top-left.
 */
export function placeFloorObject(
  box: [number, number, number, number],
  slot: CaptureSlot,
  room: { width: number; depth: number },
  cal: CameraCal,
): GeoPlacement | null {
  const [bx, by, bw, bh] = box;
  const uC = bx + bw / 2;
  const vBottom = by + bh;
  const height = heightOf(cal);

  // Where the bottom edge's ray meets the floor plane.
  const bottom = ray(uC, vBottom, cal);
  if (bottom.up >= -0.02) return null; // at or above the horizon — not on the floor
  let t = height / -bottom.up; // along the ray
  let d = t * bottom.fwd; // forward distance from the camera
  if (!(d > 0)) return null;

  const wallD = wallDistance(slot, room);
  d = Math.min(Math.max(d, 0.3), wallD);
  t = d / bottom.fwd; // re-derive after clamping so lateral and width agree

  // Both horizontal edges share this row, so they share `t`.
  const right = t * bottom.right;
  const widthM = t * (tanX(bx + bw, cal) - tanX(bx, cal));

  // Top of the object, at the same forward distance rather than the same ray
  // length — a tilted camera sees the top edge along a different ray.
  const top = ray(uC, by, cal);
  if (!(top.fwd > 0)) return null;
  const heightM = height + (d / top.fwd) * top.up;
  if (widthM <= 0.01 || heightM <= 0.01) return null;

  const { x, z, yaw } = slotToWorld(slot, d, right);
  return {
    position: { x, y: 0, z },
    widthMM: Math.round(widthM * 1000),
    heightMM: Math.round(heightM * 1000),
    yaw,
    distance: d,
  };
}

/**
 * Wall-mounted object (TV, painting, window, AC…): assume it lies ON the
 * framed wall plane at the known wall distance — both size and mount height
 * follow directly.
 */
export function placeWallObject(
  box: [number, number, number, number],
  slot: CaptureSlot,
  room: { width: number; depth: number },
  cal: CameraCal,
): GeoPlacement | null {
  const [bx, by, bw, bh] = box;
  const d = wallDistance(slot, room);
  const uC = bx + bw / 2;
  const height = heightOf(cal);

  // Everything lies on one vertical plane at forward distance d, so each row's
  // ray is scaled to reach that plane rather than sharing one length.
  const rTop = ray(uC, by, cal);
  const rBottom = ray(uC, by + bh, cal);
  const rMid = ray(uC, by + bh / 2, cal);
  if (!(rTop.fwd > 0) || !(rBottom.fwd > 0) || !(rMid.fwd > 0)) return null;

  const tMid = d / rMid.fwd;
  const right = tMid * rMid.right;
  const widthM = tMid * (tanX(bx + bw, cal) - tanX(bx, cal));
  const topM = height + (d / rTop.fwd) * rTop.up;
  const bottomM = height + (d / rBottom.fwd) * rBottom.up;
  const heightM = topM - bottomM;
  if (widthM <= 0.01 || heightM <= 0.01) return null;

  const { x, z, yaw } = slotToWorld(slot, d, right);
  return {
    position: { x, y: (topM + bottomM) / 2, z },
    widthMM: Math.round(widthM * 1000),
    heightMM: Math.round(heightM * 1000),
    yaw,
    distance: d,
  };
}

/** A ceiling placement carries NO height — see `placeCeilingObject`. Modelled as
 *  an `Omit` rather than a `heightMM` of 0 or null so that nothing downstream can
 *  read a measurement which was never taken. */
export type GeoCeilingPlacement = Omit<GeoPlacement, 'heightMM'>;

/**
 * Ceiling-mounted object (fan, pendant): it lies ON the ceiling plane at a known
 * HEIGHT above the camera, which makes it the mirror of `placeWallObject` — that
 * one knows the plane's distance, this one knows its rise — rather than of
 * `placeFloorObject`.
 *
 * **The MIDDLE bbox row is what gets intersected, not an edge, and that is the
 * whole accuracy of this function.** A floor object is a vertical thing whose
 * bottom edge is at one distance, so backprojecting that edge is right. A ceiling
 * fan is a horizontal PLATE seen obliquely: its image spans a range of distances,
 * with the top of the bbox being its NEAREST edge. Intersecting the top row
 * measures the near edge and then applies the disc's full angular width at that
 * shorter distance — for a 1.2 m fan 2.5 m away, 0.94 m, a 22% under-read that is
 * further from the truth than the catalogue default it was supposed to improve on.
 * The centre row lands within a few percent.
 *
 * **Width only, and the reason is geometric rather than lazy.** That same plate
 * has no thickness in its bbox: the vertical extent is the foreshortened diameter.
 * Deriving H from it manufactures a fan 1200 mm tall, which `clampDims` then
 * squashes to 450 — a fake measurement followed by a silent resize, both halves of
 * what CLAUDE.md rule 2 forbids, in one function. Height stays with the catalogue.
 *
 * **A level camera in a normal room does not see the ceiling at all**, and this
 * refuses every such shot rather than pretending. At 66° hFOV on 4:3 the vertical
 * half-angle is ~24°, so from 1.5 m the ceiling of a 2.8 m room first enters frame
 * 2.9 m away — beyond the wall being photographed. It is the same fact
 * `calibrateFromFloorLine` runs into at the other end of the frame. What DOES see a
 * ceiling: an ultrawide (~106°, in frame from 1.3 m out), a camera tilted up, or a
 * tall room. So this earns its keep on real phone captures and on the arbitrary
 * uploads the capture rig is heading toward, not on the nominal rig.
 *
 * Which is why an intersection PAST the far wall is refused rather than clamped to
 * it, the one place this deliberately departs from `placeFloorObject`. The floor is
 * visible right up to the wall, so a foot landing slightly beyond it is measurement
 * error and clamping recovers it. The ceiling of a level 66° shot is not in frame at
 * all — so a high pixel there is WALL, and clamping it onto the ceiling plane
 * measures a picture frame as an undersized ceiling fan — the width comes out at
 * the wall distance rather than the true one, so it is wrong by whatever the clamp
 * moved. Refusing hands the detection
 * back untouched, which is exactly the behaviour that existed before this function
 * did. Being no better than before beats being confidently wrong.
 */
export function placeCeilingObject(
  box: [number, number, number, number],
  slot: CaptureSlot,
  room: { width: number; depth: number; height: number },
  cal: CameraCal,
): GeoCeilingPlacement | null {
  const [bx, by, bw, bh] = box;
  const uC = bx + bw / 2;
  const rise = room.height - heightOf(cal);
  if (!(rise > 0.05)) return null; // camera at or above the slab — not a room

  // The one row that is read. `bh` is used ONLY to find its centre — no height is
  // derived from it, which is the point of the whole function.
  const mid = ray(uC, by + bh / 2, cal);
  if (mid.up <= 0.02) return null; // at or below the horizon — not on the ceiling
  const t = rise / mid.up; // along the ray
  const d = t * mid.fwd; // forward distance from the camera
  if (!(d > 0)) return null;

  // Nothing on this room's ceiling is beyond the wall being photographed, so a ray
  // that only reaches the ceiling plane out there never touched the ceiling at all.
  // REFUSED, not clamped — see the note above.
  if (d > wallDistance(slot, room)) return null;

  const right = t * mid.right;
  const widthM = t * (tanX(bx + bw, cal) - tanX(bx, cal));
  if (widthM <= 0.01) return null;

  const { x, z, yaw } = slotToWorld(slot, d, right);
  return {
    // y is the ceiling plane itself: unlike the other two placers this is not an
    // estimate, it is the surface that was intersected. `groundY` still owns the
    // axis downstream and hangs the part just under the slab.
    position: { x, y: room.height, z },
    widthMM: Math.round(widthM * 1000),
    yaw,
    distance: d,
  };
}

/** Aspect ratio (width / height) of an image blob. Browser only. */
export async function imageAspect(blob: Blob): Promise<number> {
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = url;
    });
    return img.naturalWidth / Math.max(1, img.naturalHeight);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Read the lens and the tilt out of a photo's own geometry — the vanishing-point
 * path, for the photos EXIF cannot help with. Browser only; the maths it wraps is
 * pure and tested in `lib/vanishing-point.ts`.
 *
 * Runs at the image's own resolution rather than a thumbnail, and that is not an
 * oversight: the same synthetic room calibrates to 78.0° at 1600 px, 77.8° at
 * 1200, and is correctly REFUSED at 800, because the edge fragments get too short
 * for their angles to mean anything. `normalizePhoto` caps the long edge at
 * 1600 px, so what arrives here is already the resolution this was measured at.
 */
export async function calibrateFromPhoto(blob: Blob): Promise<VanishingCalibration | null> {
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = url;
    });
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    if (w < 2 || h < 2) return null;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, w, h);
    const gray = toGrayscale(ctx.getImageData(0, 0, w, h).data, w, h);
    return calibrateFromSegments(detectSegments(gray, w, h), w, h);
  } catch {
    // An undecodable photo is a photo we calibrate some other way, not a crash.
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Find the wall-floor boundary row in a photo for calibration. Looks for the
 * strongest horizontal luminance edge in the lower band of the image. Cheap
 * (small canvas), deterministic, and honest about failure: returns null when
 * no row is clearly dominant (occluded floor line, busy rug, low contrast).
 * Runs only in the browser.
 */
export async function findFloorLine(blob: Blob): Promise<number | null> {
  const SAMPLE_W = 160;
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = url;
    });
    const aspect = img.naturalWidth / img.naturalHeight;
    const w = SAMPLE_W;
    const h = Math.max(60, Math.round(SAMPLE_W / aspect));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;
    const lum = (i: number) => 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];

    // Per-row edge energy: mean |row − previous row| luminance difference.
    const lo = Math.floor(h * 0.55);
    const hi = Math.floor(h * 0.97);
    let bestRow = -1;
    let bestE = 0;
    let sumE = 0;
    let n = 0;
    for (let y = lo; y < hi; y++) {
      let e = 0;
      for (let x = 0; x < w; x++) {
        e += Math.abs(lum((y * w + x) * 4) - lum(((y - 1) * w + x) * 4));
      }
      e /= w;
      sumE += e;
      n++;
      if (e > bestE) {
        bestE = e;
        bestRow = y;
      }
    }
    const meanE = sumE / Math.max(1, n);
    // Dominance gate — the floor line must clearly beat the band's noise floor.
    if (bestRow < 0 || bestE < meanE * 2.2 || bestE < 6) return null;
    return bestRow / h;
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

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
// category default and clampDims guards it like everything else.
//
// World frame matches lib/detection.ts: origin = room-centre floor, +X East,
// +Y up, +Z toward the South wall. Slot cameras: n looks −Z, s +Z, e +X, w −X.

import type { CaptureSlot } from './storage';

/** Camera height used in the capture instructions (metres). */
export const CAM_HEIGHT = 1.5;

/** Default horizontal FOV when no calibration is available — typical phone
 *  main camera (~66°). Calibration from the wall-floor line replaces this. */
const DEFAULT_HFOV_DEG = 66;

export type CameraCal = {
  /** tan of half-hFOV × 2 — horizontal tangent span per normalized image unit:
   *  tanX(u) = (u − 0.5) · k */
  k: number;
  /** image aspect (width / height) — vertical tangent uses k / aspect. */
  aspect: number;
};

export function defaultCal(aspect: number): CameraCal {
  return { k: 2 * Math.tan(((DEFAULT_HFOV_DEG / 2) * Math.PI) / 180), aspect };
}

/** Distance from the room-centre camera to the framed wall. */
export function wallDistance(slot: CaptureSlot, room: { width: number; depth: number }): number {
  return slot === 'n' || slot === 's' ? room.depth / 2 : room.width / 2;
}

/**
 * Calibrate focal length from the wall-floor boundary line. With a level
 * camera at CAM_HEIGHT and the wall at distance d, the floor line sits
 * tan_down = CAM_HEIGHT / d below the image centre:
 *     (vFloor − 0.5) · k / aspect = CAM_HEIGHT / d   →   solve k.
 * Returns null when vFloor is implausible (≤ centre — floor line must be in
 * the lower half).
 */
export function calibrateFromFloorLine(
  vFloor: number,
  slot: CaptureSlot,
  room: { width: number; depth: number },
  aspect: number,
): CameraCal | null {
  if (vFloor <= 0.52 || vFloor >= 0.99) return null;
  const d = wallDistance(slot, room);
  const k = ((CAM_HEIGHT / d) * aspect) / (vFloor - 0.5);
  // Sanity: equivalent hFOV between 30° and 120°.
  const hfov = (2 * Math.atan(k / 2) * 180) / Math.PI;
  if (hfov < 30 || hfov > 120) return null;
  return { k, aspect };
}

const tanX = (u: number, cal: CameraCal) => (u - 0.5) * cal.k;
/** positive up */
const tanY = (v: number, cal: CameraCal) => ((0.5 - v) * cal.k) / cal.aspect;

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
  /** world position — x/z centre; y = 0 floor anchor (floor) or mount centre (wall). */
  position: { x: number; y: number; z: number };
  /** real size estimate in mm — [W, H]; depth is NOT observable from one photo. */
  widthMM: number;
  heightMM: number;
  /** facing-into-the-room yaw for wall-adjacent items. */
  yaw: number;
  /** forward distance from the camera (m) — useful for confidence weighting. */
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
  const tDown = -tanY(vBottom, cal); // > 0 when bottom edge is below centre
  if (tDown <= 0.02) return null; // bottom at/above horizon — not on the floor
  let d = CAM_HEIGHT / tDown;
  const wallD = wallDistance(slot, room);
  d = Math.min(Math.max(d, 0.3), wallD);

  const right = d * tanX(uC, cal);
  const widthM = d * (tanX(bx + bw, cal) - tanX(bx, cal));
  // Top of the object above the floor at distance d.
  const heightM = CAM_HEIGHT + d * tanY(by, cal);
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

  const right = d * tanX(uC, cal);
  const widthM = d * (tanX(bx + bw, cal) - tanX(bx, cal));
  const topM = CAM_HEIGHT + d * tanY(by, cal);
  const bottomM = CAM_HEIGHT + d * tanY(by + bh, cal);
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

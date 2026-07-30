import { describe, it, expect } from 'vitest';
import {
  CAM_HEIGHT,
  defaultCal,
  calFromHfov,
  wallDistance,
  calibrateFromFloorLine,
  heightFromFloorLine,
  placeFloorObject,
  placeWallObject,
  type CameraCal,
} from '@/lib/photo-geometry';
import { hfovFromFocal35 } from '@/lib/exif';
import type { CaptureSlot } from '@/lib/storage';

const ROOM = { width: 6, depth: 4 };
const CAL: CameraCal = { k: 1.2, aspect: 4 / 3 };

// ── Synthetic projector — the inverse of the lib, written independently ─────
// Project a world point seen from the slot camera into normalized image coords.
// Honours cal.height and cal.tiltRad, so the same helper generates the level
// cases and the tilted ones.
function project(slot: CaptureSlot, x: number, y: number, z: number, cal: CameraCal): [number, number] {
  // world → camera frame (forward, right, up)
  let forward = 0;
  let right = 0;
  switch (slot) {
    case 'n':
      forward = -z;
      right = x;
      break;
    case 's':
      forward = z;
      right = -x;
      break;
    case 'e':
      forward = x;
      right = z;
      break;
    case 'w':
      forward = -x;
      right = -z;
      break;
  }
  const up = y - (cal.height ?? CAM_HEIGHT);
  // Rotate the world offset back into the untilted lens frame — the inverse of
  // the rotation lib/photo-geometry applies to each ray.
  const th = cal.tiltRad ?? 0;
  const c = Math.cos(th);
  const s = Math.sin(th);
  const upCam = up * c + forward * s;
  const fwdCam = -up * s + forward * c;
  const u = right / fwdCam / cal.k + 0.5;
  const v = 0.5 - (upCam / fwdCam) * (cal.aspect / cal.k);
  return [u, v];
}

/** bbox of a wall-parallel rectangle (width w, height h) standing on the floor
 *  at world centre (x, z), as seen from the slot camera.
 *
 *  Projects the four corners and takes their extent rather than deriving a
 *  half-width analytically: under tilt a fronto-parallel rectangle images as a
 *  trapezoid, and the bounding box of a trapezoid is what a detector would
 *  actually hand us. */
function bboxOfFloorObject(
  slot: CaptureSlot,
  x: number,
  z: number,
  wM: number,
  hM: number,
  cal: CameraCal,
): [number, number, number, number] {
  // The face spans ±w/2 along the camera's "right" axis, which is a different
  // world axis per slot.
  const along: Record<CaptureSlot, [number, number]> = {
    n: [1, 0],
    s: [-1, 0],
    e: [0, 1],
    w: [0, -1],
  };
  const [ax, az] = along[slot];
  const pts: Array<[number, number]> = [];
  for (const sgn of [-1, 1]) {
    for (const y of [0, hM]) {
      pts.push(project(slot, x + ax * sgn * (wM / 2), y, z + az * sgn * (wM / 2), cal));
    }
  }
  const us = pts.map((p) => p[0]);
  const vs = pts.map((p) => p[1]);
  const u0 = Math.min(...us);
  const v0 = Math.min(...vs);
  return [u0, v0, Math.max(...us) - u0, Math.max(...vs) - v0];
}

describe('wallDistance', () => {
  it('n/s walls sit at depth/2; e/w at width/2', () => {
    expect(wallDistance('n', ROOM)).toBe(2);
    expect(wallDistance('s', ROOM)).toBe(2);
    expect(wallDistance('e', ROOM)).toBe(3);
    expect(wallDistance('w', ROOM)).toBe(3);
  });
});

describe('calibrateFromFloorLine', () => {
  it('round-trips: floor line projected with known k recovers k (portrait shot)', () => {
    // Portrait orientation (aspect < 1) — the only case where a level camera
    // 1.5m up actually sees the wall-floor line of a nearby wall in frame.
    const PORTRAIT: CameraCal = { k: 1.2, aspect: 0.75 };
    const [, vFloor] = project('n', 0, 0, -2, PORTRAIT);
    expect(vFloor).toBeLessThan(0.99); // line is inside the frame
    const cal = calibrateFromFloorLine(vFloor, 'n', ROOM, PORTRAIT.aspect);
    expect(cal).not.toBeNull();
    expect(cal!.k).toBeCloseTo(PORTRAIT.k, 5);
  });

  it('returns null when the floor line would be outside a landscape frame', () => {
    const [, vFloor] = project('n', 0, 0, -2, CAL); // lands beyond v=1
    expect(calibrateFromFloorLine(vFloor, 'n', ROOM, CAL.aspect)).toBeNull();
  });

  it('rejects a floor line above the image centre', () => {
    expect(calibrateFromFloorLine(0.4, 'n', ROOM, 4 / 3)).toBeNull();
  });
});

describe('placeFloorObject', () => {
  it('recovers position and size on the N wall side', () => {
    // 1.6m-wide, 0.9m-tall sideboard at (0.8, -1.5), seen from the N camera.
    const box = bboxOfFloorObject('n', 0.8, -1.5, 1.6, 0.9, CAL);
    const g = placeFloorObject(box, 'n', ROOM, CAL)!;
    expect(g.position.x).toBeCloseTo(0.8, 2);
    expect(g.position.z).toBeCloseTo(-1.5, 2);
    expect(g.widthMM).toBeCloseTo(1600, -1);
    expect(g.heightMM).toBeCloseTo(900, -1);
    expect(g.yaw).toBeCloseTo(0);
  });

  it('recovers position via the mirrored S camera', () => {
    const box = bboxOfFloorObject('s', -0.5, 1.2, 0.6, 1.8, CAL);
    const g = placeFloorObject(box, 's', ROOM, CAL)!;
    expect(g.position.x).toBeCloseTo(-0.5, 2);
    expect(g.position.z).toBeCloseTo(1.2, 2);
    expect(g.heightMM).toBeCloseTo(1800, -1);
    expect(g.yaw).toBeCloseTo(Math.PI);
  });

  it('recovers position via the E camera (axes swapped)', () => {
    const box = bboxOfFloorObject('e', 2.0, 0.7, 1.0, 0.5, CAL);
    const g = placeFloorObject(box, 'e', ROOM, CAL)!;
    expect(g.position.x).toBeCloseTo(2.0, 2);
    expect(g.position.z).toBeCloseTo(0.7, 2);
    expect(g.widthMM).toBeCloseTo(1000, -1);
  });

  it('clamps distance to the wall (bbox bottom near the horizon)', () => {
    // Bottom edge barely below centre → naive distance would exceed the room.
    const g = placeFloorObject([0.45, 0.2, 0.1, 0.33], 'n', ROOM, CAL)!;
    expect(g.distance).toBeLessThanOrEqual(wallDistance('n', ROOM));
  });

  it('returns null when the bottom edge is above the horizon', () => {
    expect(placeFloorObject([0.4, 0.1, 0.2, 0.3], 'n', ROOM, CAL)).toBeNull();
  });
});

describe('placeWallObject', () => {
  it('recovers a TV mounted on the N wall — size and mount height', () => {
    // 1.2m × 0.7m panel centred 1.4m up at x = -0.6 on the N wall (z = -2).
    const [u1, vTop] = project('n', -0.6 - 0.6, 1.4 + 0.35, -2, CAL);
    const [u2, vBottom] = project('n', -0.6 + 0.6, 1.4 - 0.35, -2, CAL);
    const box: [number, number, number, number] = [u1, vTop, u2 - u1, vBottom - vTop];
    const g = placeWallObject(box, 'n', ROOM, CAL)!;
    expect(g.position.x).toBeCloseTo(-0.6, 2);
    expect(g.position.z).toBeCloseTo(-2, 2);
    expect(g.position.y).toBeCloseTo(1.4, 2);
    expect(g.widthMM).toBeCloseTo(1200, -1);
    expect(g.heightMM).toBeCloseTo(700, -1);
  });
});

describe('defaultCal', () => {
  it('uses a plausible phone FOV', () => {
    const cal = defaultCal(4 / 3);
    const hfov = (2 * Math.atan(cal.k / 2) * 180) / Math.PI;
    expect(hfov).toBeGreaterThan(55);
    expect(hfov).toBeLessThan(80);
  });
});

// ── Camera pose: tilt and height ───────────────────────────────────────────
// The module used to assume a level camera exactly CAM_HEIGHT off the floor.
// Both are now inputs, and these pin what knowing them is worth.

const DOWN_5: CameraCal = { k: 1.2, aspect: 4 / 3, tiltRad: (5 * Math.PI) / 180 };
const UP_5: CameraCal = { k: 1.2, aspect: 4 / 3, tiltRad: (-5 * Math.PI) / 180 };

/** bbox of a panel lying ON the framed wall, from its four corners. */
function bboxOfWallPanel(
  slot: CaptureSlot,
  x: number,
  y: number,
  z: number,
  wM: number,
  hM: number,
  cal: CameraCal,
): [number, number, number, number] {
  const pts: Array<[number, number]> = [];
  for (const dx of [-wM / 2, wM / 2]) {
    for (const dy of [-hM / 2, hM / 2]) {
      pts.push(project(slot, x + dx, y + dy, z, cal));
    }
  }
  const us = pts.map((p) => p[0]);
  const vs = pts.map((p) => p[1]);
  const u0 = Math.min(...us);
  const v0 = Math.min(...vs);
  return [u0, v0, Math.max(...us) - u0, Math.max(...vs) - v0];
}

describe('camera tilt', () => {
  it('recovers a centred object exactly when the tilt is known', () => {
    for (const cal of [DOWN_5, UP_5]) {
      const box = bboxOfFloorObject('n', 0, -1.5, 1.6, 0.9, cal);
      const g = placeFloorObject(box, 'n', ROOM, cal)!;
      expect(g.position.x).toBeCloseTo(0, 6);
      expect(g.position.z).toBeCloseTo(-1.5, 6);
      expect(g.heightMM).toBeCloseTo(900, -1);
    }
  });

  it('is close, not exact, off to one side — a tilted rectangle images as a trapezoid', () => {
    // The two rows of the object project at different scales, so its bounding box
    // is centred on the WIDER row while the decode works from the bottom one.
    // Nothing can recover that from a bbox alone; the residue is a few per cent,
    // against the ~20% below for ignoring tilt altogether.
    for (const cal of [DOWN_5, UP_5]) {
      const g = placeFloorObject(bboxOfFloorObject('n', 0.8, -1.5, 1.6, 0.9, cal), 'n', ROOM, cal)!;
      expect(Math.abs(g.position.x - 0.8)).toBeLessThan(0.06);
      expect(g.position.z).toBeCloseTo(-1.5, 2);
      expect(Math.abs(g.widthMM - 1600)).toBeLessThan(90);
    }
  });

  it('mis-reads distance in BOTH directions when tilt is ignored', () => {
    // Tilting the lens down moves the scene UP the frame, so a floor point looks
    // nearer the horizon and decodes as FURTHER away. Tilting up does the
    // reverse. This is the largest error in the module when tilt is unknown.
    // Kept well clear of the far wall: the distance clamp would otherwise absorb
    // part of the error and understate it. (It bounds the damage in the product,
    // which is why a bad calibration shows up as furniture piled against the
    // opposite wall rather than outside the room.)
    const trueZ = -1.4;
    for (const [cal, dir] of [[DOWN_5, 'down'], [UP_5, 'up']] as const) {
      const box = bboxOfFloorObject('n', 0, trueZ, 1.0, 0.9, cal);
      const naive = placeFloorObject(box, 'n', ROOM, { k: cal.k, aspect: cal.aspect })!;
      const aware = placeFloorObject(box, 'n', ROOM, cal)!;
      expect(aware.distance).toBeCloseTo(1.4, 6);
      expect(naive.distance).toBeLessThan(wallDistance('n', ROOM)); // not clamped
      const error = (naive.distance - 1.4) / 1.4;
      expect(Math.abs(error)).toBeGreaterThan(0.15);
      expect(dir === 'down' ? error : -error).toBeGreaterThan(0);
    }
  });

  it('recovers a wall-mounted panel under tilt', () => {
    const box = bboxOfWallPanel('n', -0.6, 1.4, -2, 1.2, 0.7, DOWN_5);
    const g = placeWallObject(box, 'n', ROOM, DOWN_5)!;
    expect(Math.abs(g.position.x - -0.6)).toBeLessThan(0.02);
    expect(g.position.y).toBeCloseTo(1.4, 2);
    expect(Math.abs(g.heightMM - 700)).toBeLessThan(20);
  });
});

describe('camera height', () => {
  it('scales a floor object in size AND position', () => {
    // Height is the term that sets the scale of the whole reconstruction: the
    // floor line fixes the ratios, the shooter's height turns them into metres.
    // This is the ±17% the fixed 1.5 m assumption cost on every measurement.
    const cal: CameraCal = { k: 1.2, aspect: 4 / 3, height: 1.3 };
    const box = bboxOfFloorObject('n', 0, -1.5, 1.6, 0.9, cal);
    const right = placeFloorObject(box, 'n', ROOM, cal)!;
    expect(right.position.z).toBeCloseTo(-1.5, 6);
    expect(right.widthMM).toBeCloseTo(1600, -1);

    const assumed = placeFloorObject(box, 'n', ROOM, { k: cal.k, aspect: cal.aspect })!;
    const ratio = CAM_HEIGHT / 1.3;
    expect(assumed.distance / right.distance).toBeCloseTo(ratio, 6);
    expect(assumed.widthMM / right.widthMM).toBeCloseTo(ratio, 3);
  });
});

describe('heightFromFloorLine', () => {
  it('solves for the shooter height once the lens is known', () => {
    // The same equation calibrateFromFloorLine uses, inverted for the other
    // unknown — which is what EXIF makes possible. Portrait framing on the far
    // wall, the case where the floor line is actually inside the frame.
    const cal: CameraCal = { k: 1.2, aspect: 0.75, height: 1.62 };
    const [, vFloor] = project('e', 3, 0, 0, cal);
    expect(vFloor).toBeLessThan(0.99);
    expect(heightFromFloorLine(vFloor, 'e', ROOM, cal)).toBeCloseTo(1.62, 6);
  });

  it('solves it under tilt too', () => {
    const cal: CameraCal = { k: 1.2, aspect: 0.75, height: 1.35, tiltRad: (4 * Math.PI) / 180 };
    const [, vFloor] = project('n', 0, 0, -2, cal);
    expect(heightFromFloorLine(vFloor, 'n', ROOM, cal)).toBeCloseTo(1.35, 6);
  });

  it('refuses an answer that is not a person holding a phone', () => {
    // A rug edge or a skirting shadow mistaken for the floor line. Better to
    // report nothing than a confident wrong height.
    expect(heightFromFloorLine(0.55, 'n', ROOM, { k: 1.2, aspect: 0.75 })).toBeNull();
    expect(heightFromFloorLine(0.4, 'n', ROOM, { k: 1.2, aspect: 0.75 })).toBeNull();
  });
});

describe('calFromHfov', () => {
  it('round-trips a 35 mm-equivalent focal length into a usable calibration', () => {
    const cal = calFromHfov(hfovFromFocal35(26, 4 / 3)!, 4 / 3);
    const g = placeFloorObject(bboxOfFloorObject('n', 0, -1.2, 1.0, 0.8, cal), 'n', ROOM, cal)!;
    expect(g.position.z).toBeCloseTo(-1.2, 6);
    expect(g.widthMM).toBeCloseTo(1000, -1);
  });

  it('halves a wall-mounted TV when an ultrawide shot is read as 66°', () => {
    // Where the assumed FOV really hurts. A wall item's distance is PINNED to the
    // wall rather than derived from its bottom edge, so the angular size is not
    // divided back out and the whole error lands on the measurement.
    const wide = calFromHfov(hfovFromFocal35(13, 4 / 3)!, 4 / 3);
    const box = bboxOfWallPanel('n', 0, 1.4, -2, 1.4, 0.8, wide);
    const right = placeWallObject(box, 'n', ROOM, wide)!;
    const assumed = placeWallObject(box, 'n', ROOM, defaultCal(4 / 3))!;
    expect(right.widthMM).toBeCloseTo(1400, -1);
    expect(assumed.widthMM).toBeLessThan(right.widthMM * 0.55);
  });

  it('leaves a FLOOR object’s SIZE alone — the assumed FOV cancels out', () => {
    // Distance is H·aspect / ((v−0.5)·k) and width is that times k·Δu, so k
    // divides out exactly. Getting the lens wrong moves a floor-standing piece
    // around the room; it does not resize it. Near enough to the camera that the
    // wall clamp stays out of it — see below for what happens when it does not.
    const wide = calFromHfov(hfovFromFocal35(13, 4 / 3)!, 4 / 3);
    const box = bboxOfFloorObject('n', 0, -0.9, 1.6, 0.9, wide);
    const right = placeFloorObject(box, 'n', ROOM, wide)!;
    const assumed = placeFloorObject(box, 'n', ROOM, defaultCal(4 / 3))!;
    expect(assumed.distance).toBeLessThan(wallDistance('n', ROOM));
    expect(assumed.widthMM).toBe(right.widthMM);
    expect(assumed.heightMM).toBe(right.heightMM);
    expect(assumed.distance).toBeGreaterThan(right.distance * 1.8);
  });

  it('…until the wall clamp bites, which then shrinks it', () => {
    // Once the mis-scaled distance runs past the far wall it is clamped, and the
    // angular size is re-scaled to the clamped distance — so the cancellation
    // breaks and the piece comes out small as well as mislocated.
    const wide = calFromHfov(hfovFromFocal35(13, 4 / 3)!, 4 / 3);
    const box = bboxOfFloorObject('n', 0, -1.5, 1.6, 0.9, wide);
    const right = placeFloorObject(box, 'n', ROOM, wide)!;
    const assumed = placeFloorObject(box, 'n', ROOM, defaultCal(4 / 3))!;
    expect(assumed.distance).toBe(wallDistance('n', ROOM));
    expect(assumed.widthMM).toBeLessThan(right.widthMM * 0.7);
  });
});

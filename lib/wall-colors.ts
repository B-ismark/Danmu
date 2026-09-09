'use client';

// Read a room's real wall colours out of its capture photos.
//
// BROWSER ONLY, and deliberately thin: it decodes, builds a camera, and hands off.
// Where the wall is and which wall it paints are in `lib/wall-sample.ts`; reducing
// pixels to a colour is in `lib/color-reduce.ts`. Both are pure and tested. The
// only thing that lives here is the part a test could not reach anyway.
//
// This is a HINT in the rule 2 sense even though a colour is not a dimension: it
// lands through the ordinary `setWallColor` / `setAllWallColors` setters, so it is
// one undo step and the user can change or reset any of it afterwards. Nothing
// here writes to storage or applies anything on load.

import { SAMPLE_GRID, decodeBitmap, sampleBitmapRegion } from './color-sample';
import { calFromHfov, defaultCal, type CameraCal, type CameraView } from './photo-geometry';
import { hfovFromFocal35 } from './exif';
import {
  maskForBoxes,
  maskLeavesEnough,
  wallColorProposal,
  wallRegion,
  type LensSource,
  type Region,
  type Skipped,
  type WallColorProposal,
} from './wall-sample';
import type { Footprint } from './footprint';
import type { Capture, CaptureSlot } from './storage';

export type { SkipReason, WallColorProposal } from './wall-sample';

/** What a stored pose may say before it stops being a measurement. The height pair
 *  matches `heightFromFloorLine`'s own solved range, and the tilt matches the band
 *  `tiltFromOrientation` accepts, so a pose this app wrote is always inside them
 *  and only a corrupt one is not. */
const MIN_POSE_HEIGHT_M = 0.5;
const MAX_POSE_HEIGHT_M = 2.5;
const MAX_POSE_TILT_DEG = 45;

/** The camera for a capture, and **whether the lens in it was measured or
 *  assumed** — which the band needs to know, so the two travel together rather
 *  than as a camera plus a flag a caller could forget to pass.
 *
 *  EXIF focal length when the photo carried one, otherwise the default, plus
 *  whatever the capture screen measured about the pose. The same ladder the detect
 *  screen climbs, minus the floor-line solve — and this comment used to justify
 *  skipping that rung by saying a lens error only makes the band slightly the
 *  wrong height. It does not: read a 106° ultrawide as the 66° default and a third
 *  of the band is floor and ceiling (`WIDEST_HFOV_DEG`). What stands in for the
 *  missing rung is assuming the WIDE end instead of the typical one, which is
 *  sound only because the error is one-sided. */
function calFor(pose: Capture['pose'], aspect: number): { cal: CameraCal; lens: LensSource } {
  const view: CameraView = {};
  // Validated, not copied. A pose is a record this app wrote, so a zero or NaN
  // height in it is a bug rather than a user's mistake — but copying it through
  // made `wallRegion` refuse and the user was told their ROOM had too little clear
  // wall, which is a confident answer about the wrong thing. Out of range, drop it
  // and fall back to the assumed camera, the same posture as a focal-length tag
  // outside the plausible band.
  if (pose?.heightM !== undefined && pose.heightM > MIN_POSE_HEIGHT_M && pose.heightM < MAX_POSE_HEIGHT_M) {
    view.height = pose.heightM;
  }
  if (pose?.tiltDeg !== undefined && Math.abs(pose.tiltDeg) <= MAX_POSE_TILT_DEG) {
    view.tiltRad = (pose.tiltDeg * Math.PI) / 180;
  }
  // `hfovFromFocal35` returns null for a tag outside 20–150°, which is a
  // transcription error rather than a lens. Falling through to the assumed lens is
  // the right answer there rather than an error to report — but it is `assumed`,
  // not `measured`, because a rejected tag told us nothing.
  const hfov = pose?.focal35mm !== undefined ? hfovFromFocal35(pose.focal35mm, aspect) : null;
  if (hfov !== null) return { cal: calFromHfov(hfov, aspect, view), lens: 'measured' };
  return { cal: { ...defaultCal(aspect), ...view }, lens: 'assumed' };
}

/**
 * Sample one colour per photographed wall.
 *
 * **Null means this room has no photographs**, and nothing else — there is not
 * even a skip to report. Every other outcome is a proposal, which may carry no
 * colours at all and a reason per photo. The first version's docblock said null
 * meant "nothing to sample at all", which is a different and larger claim: four
 * captures that all failed returned a non-null empty proposal, and the one real
 * caller ignored the documented contract and re-checked by hand. A contract a
 * caller works around is not a contract.
 */
export async function sampleWallColors(args: {
  captures: readonly Capture[];
  /** The room's ceiling height in metres. **Its width and depth are deliberately
   *  not taken:** the wall geometry comes from `footprint` through `wallFrame`,
   *  which reads the polygon's bounds, and `scene-store.ts`'s `moveWall` contract
   *  says every downstream consumer must. Handing this the bbox dims was how the
   *  first version got them from ±width/2 anyway. */
  ceilingM: number;
  footprint: Footprint;
  /** Normalized furniture boxes per slot, when the room has them. */
  boxesBySlot?: Partial<Record<CaptureSlot, readonly Region[]>>;
}): Promise<WallColorProposal | null> {
  const { captures, ceilingM, footprint, boxesBySlot } = args;
  if (captures.length === 0) return null;

  const found: Array<{ slot: CaptureSlot; hex: string }> = [];
  const skipped: Skipped[] = [];

  for (const cap of captures) {
    // ONE decode per photo, and the caller of `decodeBitmap` owns the lifetime.
    // The aspect has to come out of the decoded image because the camera
    // calibration is a function of it and the region is a function of the camera,
    // so the earlier shape — `imageAspect` and then a second `createImageBitmap`
    // inside the sampler — decoded four multi-megabyte JPEGs twice and reported
    // the second failure as a photo that could not be read.
    const bmp = await decodeBitmap(cap.blob);
    if (!bmp) {
      skipped.push({ slot: cap.slot, reason: 'unreadable' });
      continue;
    }
    try {
      const aspect = bmp.height > 0 ? bmp.width / bmp.height : NaN;
      if (!(aspect > 0) || !Number.isFinite(aspect)) {
        skipped.push({ slot: cap.slot, reason: 'unreadable' });
        continue;
      }
      const { cal, lens } = calFor(cap.pose, aspect);
      const region = wallRegion(cap.slot, footprint, ceilingM, cal, lens);
      if (!region) {
        skipped.push({ slot: cap.slot, reason: 'no-wall' });
        continue;
      }
      const boxes = boxesBySlot?.[cap.slot] ?? [];
      const mask = maskForBoxes(region, boxes, SAMPLE_GRID);
      if (!maskLeavesEnough(mask, SAMPLE_GRID)) {
        skipped.push({ slot: cap.slot, reason: 'blocked' });
        continue;
      }
      const hex = sampleBitmapRegion(bmp, region, mask ?? undefined);
      if (!hex) {
        skipped.push({ slot: cap.slot, reason: 'unsampled' });
        continue;
      }
      found.push({ slot: cap.slot, hex });
    } finally {
      bmp.close();
    }
  }

  // The furniture fact is derived from `found` inside the proposal, not tracked
  // here: a flag maintained alongside this loop is what reported furniture as
  // excluded from samples that the refusals below had already thrown away.
  return wallColorProposal(found, skipped, footprint, boxesBySlot);
}

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

import { SAMPLE_GRID, sampleRegionColor } from './color-sample';
import { calFromHfov, defaultCal, imageAspect, type CameraCal, type CameraView } from './photo-geometry';
import { hfovFromFocal35 } from './exif';
import {
  maskForBoxes,
  maskLeavesEnough,
  wallColorProposal,
  wallRegion,
  type Region,
  type Skipped,
  type WallColorProposal,
} from './wall-sample';
import type { Footprint } from './footprint';
import type { Capture, CaptureSlot } from './storage';

export type { SkipReason, WallColorProposal } from './wall-sample';

/** The camera for a capture: EXIF focal length if the photo carried one, the 66°
 *  default otherwise, plus whatever the capture screen measured. The same ladder
 *  the detect screen climbs, minus the floor-line solve — which is not needed
 *  here, because a lens error only makes the sampled band slightly the wrong
 *  height and the skirting/coving allowances absorb that. */
function calFor(pose: Capture['pose'], aspect: number): CameraCal {
  const view: CameraView = {};
  if (pose?.heightM !== undefined) view.height = pose.heightM;
  if (pose?.tiltDeg !== undefined) view.tiltRad = (pose.tiltDeg * Math.PI) / 180;
  // `hfovFromFocal35` returns null for a tag outside 20–150°, which is a
  // transcription error rather than a lens. Falling through to the default is the
  // right answer there, not an error to report: the band is forgiving of the lens.
  const hfov = pose?.focal35mm !== undefined ? hfovFromFocal35(pose.focal35mm, aspect) : null;
  if (hfov !== null) return calFromHfov(hfov, aspect, view);
  return { ...defaultCal(aspect), ...view };
}

/**
 * Sample one colour per photographed wall.
 *
 * Returns null when there was nothing to sample at all, so a caller can say that
 * rather than show an empty result.
 */
export async function sampleWallColors(args: {
  captures: readonly Capture[];
  room: { width: number; depth: number; height: number };
  footprint: Footprint;
  /** Normalized furniture boxes per slot, when the room has them. */
  boxesBySlot?: Partial<Record<CaptureSlot, readonly Region[]>>;
}): Promise<WallColorProposal | null> {
  const { captures, room, footprint, boxesBySlot } = args;
  if (captures.length === 0) return null;

  const found: Array<{ slot: CaptureSlot; hex: string }> = [];
  const skipped: Skipped[] = [];
  let usedBoxes = false;

  for (const cap of captures) {
    // `imageAspect` REJECTS on a blob the browser cannot decode rather than
    // returning a falsy number, so the guard has to be a catch. Getting this wrong
    // would take out the whole sample on one bad photo instead of skipping it.
    let aspect: number;
    try {
      aspect = await imageAspect(cap.blob);
    } catch {
      skipped.push({ slot: cap.slot, reason: 'unreadable' });
      continue;
    }
    if (!(aspect > 0) || !Number.isFinite(aspect)) {
      skipped.push({ slot: cap.slot, reason: 'unreadable' });
      continue;
    }
    const region = wallRegion(cap.slot, room, calFor(cap.pose, aspect));
    if (!region) {
      skipped.push({ slot: cap.slot, reason: 'no-wall' });
      continue;
    }
    const boxes = boxesBySlot?.[cap.slot] ?? [];
    const mask = maskForBoxes(region, boxes, SAMPLE_GRID);
    if (mask) usedBoxes = true;
    if (!maskLeavesEnough(mask, SAMPLE_GRID)) {
      skipped.push({ slot: cap.slot, reason: 'blocked' });
      continue;
    }
    const hex = await sampleRegionColor(cap.blob, region, mask ?? undefined);
    if (!hex) {
      skipped.push({ slot: cap.slot, reason: 'unreadable' });
      continue;
    }
    found.push({ slot: cap.slot, hex });
  }

  return wallColorProposal(found, skipped, footprint, usedBoxes);
}

// Where the phone's sheet rests, and where a released drag sends it.
//
// Pure, so the rule a finger meets is testable without a pointer. The heights come
// from the stylesheet (`--sheet-half`, `--sheet-top-gap` in `app/globals.css`), read
// by the caller and handed in here, so the height a drag settles on and the height
// the CSS draws for that detent are one number rather than two that agree today.

export type SheetSnap = 'closed' | 'half' | 'full';

/** A drag shorter than this is a tap on the grabber, not a resize. */
export const TAP_PX = 6;
/** Released faster than this (px/ms) is a flick, and carries one detent further. */
export const FLICK = 0.5;

/** The three resting heights in px, `closed, half, full`, for a stage `stagePx`
 *  tall. `halfShare` is `--sheet-half` as a fraction; `topGapPx` is
 *  `--sheet-top-gap`, the strip of room the tallest sheet always leaves showing. */
export function sheetHeights(stagePx: number, halfShare: number, topGapPx: number): [number, number, number] {
  const full = Math.max(0, stagePx - topGapPx);
  return [0, Math.min(full, stagePx * halfShare), full];
}

/** Where a released drag settles: the nearest resting height, with a flick carrying
 *  one step further in its direction. A positive `velocityPxPerMs` means rising. */
export function settleSheet(heightPx: number, velocityPxPerMs: number, heights: [number, number, number]): SheetSnap {
  const order: SheetSnap[] = ['closed', 'half', 'full'];
  let nearest = 0;
  for (let i = 1; i < 3; i++) if (Math.abs(heights[i] - heightPx) < Math.abs(heights[nearest] - heightPx)) nearest = i;
  if (velocityPxPerMs > FLICK && heightPx > heights[nearest]) nearest = Math.min(2, nearest + 1);
  if (velocityPxPerMs < -FLICK && heightPx < heights[nearest]) nearest = Math.max(0, nearest - 1);
  return order[nearest];
}

/** A tap on the grabber cycles the two open detents (HIG § Sheets). A sheet sized
 *  to its content (`fit`) has one open height, so there is nothing to cycle to and
 *  the tap lowers it. */
export function cycleSheet(snap: SheetSnap, fit = false): SheetSnap {
  if (fit) return 'closed';
  return snap === 'full' ? 'half' : 'full';
}

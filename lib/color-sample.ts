'use client';

// Sample the dominant colour of a detected object straight from the photo.
// Zero API cost and exact to the actual pixels — far more faithful than asking
// the model to name a colour. Used by the detect flow to fill ScenePart.color.
//
// BROWSER ONLY. This file decodes and draws; the arithmetic it wraps is pure and
// tested in `lib/color-reduce.ts` — the same seam `calibrateFromPhoto` draws for
// the vanishing-point maths, at the same place (the typed array `getImageData`
// hands back). It used to be one function, which is why it had no test.
//
// Robustness: we downscale the region to a small grid, drop the brightest and
// darkest samples (specular highlights / cast shadows skew the average), then take
// the per-channel median of what remains. See `dominantColor` for why each of
// those three steps is there.

import { dominantColor } from './color-reduce';

/** Side of the square grid the region is downsampled into, for speed and
 *  denoising. Exported because a caller building a `mask` has to index against it. */
export const SAMPLE_GRID = 24;

/** How much of a detection box to trim off each side before sampling, so we read
 *  the object's body rather than its edge and the background bleeding in around a
 *  generous box. */
const BOX_INSET = 0.12;

/** Sample a normalized [x,y,w,h] box of an image blob → "#rrggbb" or null. */
export async function sampleBoxColor(
  blob: Blob,
  box: [number, number, number, number],
): Promise<string | null> {
  return sampleRegionColor(blob, [
    box[0] + box[2] * BOX_INSET,
    box[1] + box[3] * BOX_INSET,
    box[2] * (1 - 2 * BOX_INSET),
    box[3] * (1 - 2 * BOX_INSET),
  ]);
}

/**
 * Decode a photo once. Null when the browser cannot decode the blob at all, which
 * is a different outcome from "decoded and had nothing to sample" and is reported
 * as such.
 *
 * **The caller closes it, in a `finally`.** Exported for the wall sampler, which
 * needs the image's ASPECT before it can say which region to read — the camera
 * calibration is a function of it — and would otherwise decode every photo twice:
 * once through `imageAspect`, once here, over four multi-megabyte JPEGs, with the
 * second decode's failure indistinguishable from a corrupt file.
 */
export async function decodeBitmap(blob: Blob): Promise<ImageBitmap | null> {
  try {
    return await createImageBitmap(blob);
  } catch {
    return null;
  }
}

/**
 * Sample a normalized [x,y,w,h] region of an already-decoded image → "#rrggbb"
 * or null.
 *
 * `mask` is consulted per grid cell in row-major order and skips that cell — the
 * wall sampler passes one to keep the furniture out of the wall's colour. It is
 * indexed against `SAMPLE_GRID × SAMPLE_GRID`, so a caller building one has to
 * agree with that rather than assume a size; `dominantColor` refuses a mask of the
 * wrong length rather than honouring its prefix.
 *
 * Null means the region yielded no usable colour — no 2D context, or too few
 * opaque samples once the mask is applied. It does NOT mean the photo was
 * unreadable; that is `decodeBitmap`'s answer, and conflating the two told a user
 * their photo could not be read about a photo that decoded perfectly well.
 */
export function sampleBitmapRegion(
  bmp: ImageBitmap,
  region: [number, number, number, number],
  mask?: ArrayLike<number>,
): string | null {
  const iw = bmp.width;
  const ih = bmp.height;

  const bx = Math.max(0, region[0] * iw);
  const by = Math.max(0, region[1] * ih);
  const bw = Math.max(1, region[2] * iw);
  const bh = Math.max(1, region[3] * ih);

  const GRID = SAMPLE_GRID;
  const canvas = document.createElement('canvas');
  canvas.width = GRID;
  canvas.height = GRID;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(bmp, bx, by, bw, bh, 0, 0, GRID, GRID);

  const { data } = ctx.getImageData(0, 0, GRID, GRID);
  return dominantColor(data, mask ? { mask } : undefined);
}

/**
 * Sample a normalized [x,y,w,h] region of an image blob → "#rrggbb" or null.
 *
 * Decode, sample, close — the two halves above with the lifetime handled. The
 * `finally` is not tidiness: `sampleBitmapRegion` can throw (a tainted canvas, an
 * OOM on `getImageData`) and the bitmap held the decoded pixels of a
 * multi-megabyte photo.
 */
export async function sampleRegionColor(
  blob: Blob,
  region: [number, number, number, number],
  mask?: ArrayLike<number>,
): Promise<string | null> {
  const bmp = await decodeBitmap(blob);
  if (!bmp) return null;
  try {
    return sampleBitmapRegion(bmp, region, mask);
  } catch {
    return null;
  } finally {
    bmp.close();
  }
}

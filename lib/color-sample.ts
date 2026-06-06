'use client';

// Sample the dominant colour of a detected object straight from the photo.
// Zero API cost and exact to the actual pixels — far more faithful than asking
// the model to name a colour. Used by the detect flow to fill ScenePart.color.
//
// Robustness: we downscale the bbox region to a small grid, drop the brightest
// and darkest samples (specular highlights / cast shadows skew the average),
// then take the per-channel median of what remains. Median beats mean for
// rejecting the odd stray pixel (a cushion logo, a glint).

/** Sample a normalized [x,y,w,h] box of an image blob → "#rrggbb" or null. */
export async function sampleBoxColor(
  blob: Blob,
  box: [number, number, number, number],
): Promise<string | null> {
  try {
    const bmp = await createImageBitmap(blob);
    const iw = bmp.width;
    const ih = bmp.height;

    // Inset the box 12% on each side so we read the object's body, not its
    // edge / the background bleeding in around a generous detection box.
    const inset = 0.12;
    const bx = Math.max(0, (box[0] + box[2] * inset) * iw);
    const by = Math.max(0, (box[1] + box[3] * inset) * ih);
    const bw = Math.max(1, box[2] * (1 - 2 * inset) * iw);
    const bh = Math.max(1, box[3] * (1 - 2 * inset) * ih);

    // Downsample the region into a small grid for speed + denoising.
    const GRID = 24;
    const canvas = document.createElement('canvas');
    canvas.width = GRID;
    canvas.height = GRID;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      bmp.close();
      return null;
    }
    ctx.drawImage(bmp, bx, by, bw, bh, 0, 0, GRID, GRID);
    bmp.close();

    const { data } = ctx.getImageData(0, 0, GRID, GRID);
    const samples: Array<[number, number, number, number]> = []; // r,g,b,luma
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 128) continue; // skip transparent
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      samples.push([r, g, b, luma]);
    }
    if (samples.length < 8) return null;

    // Drop the brightest + darkest 15% by luma.
    samples.sort((a, b) => a[3] - b[3]);
    const cut = Math.floor(samples.length * 0.15);
    const mid = samples.slice(cut, samples.length - cut);
    const pool = mid.length >= 4 ? mid : samples;

    const median = (idx: 0 | 1 | 2) => {
      const vals = pool.map((s) => s[idx]).sort((a, b) => a - b);
      return vals[Math.floor(vals.length / 2)];
    };
    return rgbToHex(median(0), median(1), median(2));
  } catch {
    return null;
  }
}

function rgbToHex(r: number, g: number, b: number): string {
  const h = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

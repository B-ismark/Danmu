'use client';

// Cheap client-side image quality scoring. No AI call.
// Returns brightness, sharpness (Laplacian variance), resolution. Used as a soft guardrail
// in the capture step so a dark or blurry shot is caught while the user is still
// standing in the room, rather than after detection quietly misses half of it.

export type Quality = {
  width: number;
  height: number;
  /** mean luminance 0..255 */
  brightness: number;
  /** Laplacian variance — higher = sharper. ~50+ is acceptable, <20 is blurry */
  sharpness: number;
  flags: QualityFlag[];
};

export type QualityFlag = 'low-res' | 'too-dark' | 'too-bright' | 'blurry' | 'ok';

const SAMPLE_SIZE = 320;

export async function scoreQuality(blob: Blob): Promise<Quality> {
  const img = await blobToImage(blob);
  const w = img.naturalWidth;
  const h = img.naturalHeight;

  // Downsample to SAMPLE_SIZE on long edge for fast analysis.
  const ratio = SAMPLE_SIZE / Math.max(w, h);
  const sw = Math.max(32, Math.round(w * ratio));
  const sh = Math.max(32, Math.round(h * ratio));
  const c = document.createElement('canvas');
  c.width = sw;
  c.height = sh;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, sw, sh);
  const data = ctx.getImageData(0, 0, sw, sh).data;

  // Brightness: mean luminance (Rec. 709)
  let sum = 0;
  const lum = new Float32Array(sw * sh);
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    const l = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    lum[j] = l;
    sum += l;
  }
  const brightness = sum / (sw * sh);

  // Sharpness: Laplacian variance — convolve [0,-1,0,-1,4,-1,0,-1,0]
  let s2 = 0;
  let s = 0;
  let count = 0;
  for (let y = 1; y < sh - 1; y++) {
    for (let x = 1; x < sw - 1; x++) {
      const idx = y * sw + x;
      const v =
        4 * lum[idx] - lum[idx - 1] - lum[idx + 1] - lum[idx - sw] - lum[idx + sw];
      s += v;
      s2 += v * v;
      count++;
    }
  }
  const mean = s / count;
  const variance = s2 / count - mean * mean;

  const flags: QualityFlag[] = [];
  if (Math.max(w, h) < 800) flags.push('low-res');
  if (brightness < 40) flags.push('too-dark');
  if (brightness > 220) flags.push('too-bright');
  if (variance < 20) flags.push('blurry');
  if (flags.length === 0) flags.push('ok');

  return { width: w, height: h, brightness, sharpness: variance, flags };
}

function blobToImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(e);
    };
    img.src = url;
  });
}

// Warm, sentence-case labels. The old caps ('LOW-RES', 'OVEREXPOSED', 'BLURRY')
// read like a photogrammetry tool's error log; this is a decorating app talking
// to someone holding a phone.
export function flagLabel(f: QualityFlag): string {
  switch (f) {
    case 'low-res':
      return 'Quite small';
    case 'too-dark':
      return 'Very dark';
    case 'too-bright':
      return 'Very bright';
    case 'blurry':
      return 'A bit blurry';
    case 'ok':
      return 'Looks good';
  }
}

/** Every flag names its own way out — a badge that only states the problem
 *  leaves the user guessing what to do about it. */
export function flagHelp(f: QualityFlag): string {
  switch (f) {
    case 'low-res':
      return 'Small photos hide detail. A shot straight from your camera app usually works better.';
    case 'too-dark':
      return 'Turn on the lights or open the curtains, then retake this wall.';
    case 'too-bright':
      return 'Try again facing away from the window, or draw the curtains a little.';
    case 'blurry':
      return 'Hold still for a moment and retake — a sharp photo finds more furniture.';
    case 'ok':
      return 'Clear, bright and sharp enough to work with.';
  }
}

/** Whether this flag should read as reassurance or as a nudge. Returned as an
 *  intent, not a colour, so the badge picks its tokens at the call site — the
 *  old flagColor() shipped a raw hex into a token-driven codebase. */
export function flagTone(f: QualityFlag): 'good' | 'nudge' {
  return f === 'ok' ? 'good' : 'nudge';
}

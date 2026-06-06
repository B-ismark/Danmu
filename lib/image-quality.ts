'use client';

// Cheap client-side image quality scoring. No AI call.
// Returns brightness, sharpness (Laplacian variance), resolution. Used as a soft guardrail
// in the capture step so users get feedback before paying tokens on detection.

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

export function flagLabel(f: QualityFlag): string {
  switch (f) {
    case 'low-res':
      return 'LOW-RES';
    case 'too-dark':
      return 'DARK';
    case 'too-bright':
      return 'OVEREXPOSED';
    case 'blurry':
      return 'BLURRY';
    case 'ok':
      return 'OK';
  }
}

export function flagColor(f: QualityFlag): string {
  return f === 'ok' ? 'var(--success)' : '#C02618';
}

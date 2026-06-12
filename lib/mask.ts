'use client';

// Image utilities shared by detection + mesh cache: bbox crops, perceptual hash.

/** Crop a region from a blob using normalized [x,y,w,h]. Returns a PNG blob. */
export async function cropFromBbox(
  blob: Blob,
  box: [number, number, number, number],
  padding = 0.04,
): Promise<Blob> {
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = url;
    });
    const W = img.naturalWidth;
    const H = img.naturalHeight;
    const [x, y, w, h] = box;
    const sx = Math.max(0, (x - padding) * W);
    const sy = Math.max(0, (y - padding) * H);
    const sw = Math.min(W - sx, (w + padding * 2) * W);
    const sh = Math.min(H - sy, (h + padding * 2) * H);
    const c = document.createElement('canvas');
    c.width = Math.round(sw);
    c.height = Math.round(sh);
    c.getContext('2d')!.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
    return new Promise<Blob>((resolve) => c.toBlob((b) => resolve(b!), 'image/png'));
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Small, fast perceptual hash (dHash) of an image blob — used to key the local mesh
 *  cache. Two crops of the same wardrobe across rooms produce the same/near hash. */
export async function perceptualHash(blob: Blob, size = 9): Promise<string> {
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = url;
    });
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size - 1;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img, 0, 0, size, size - 1);
    const data = ctx.getImageData(0, 0, size, size - 1).data;
    const gray: number[] = [];
    for (let i = 0; i < data.length; i += 4) {
      gray.push(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
    }
    let bits = '';
    for (let row = 0; row < size - 1; row++) {
      for (let col = 0; col < size - 1; col++) {
        const left = gray[row * size + col];
        const right = gray[row * size + col + 1];
        bits += left < right ? '1' : '0';
      }
    }
    let hex = '';
    for (let i = 0; i < bits.length; i += 4) {
      hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
    }
    return hex;
  } finally {
    URL.revokeObjectURL(url);
  }
}


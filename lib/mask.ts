'use client';

// Build a preserve mask: white pixels = keep base photo, black = use generated.
// Input: locked detection bboxes in normalized 0..1 coords.
// Output: base64 PNG matching given canvas size.

export type LockBox = {
  /** [x, y, w, h] normalized 0..1 */
  box: [number, number, number, number];
};

export type EditOp = {
  /** [x, y, w, h] normalized 0..1 — original detection box */
  srcBox: [number, number, number, number];
  /** target box if the object was moved by the user. Undefined → not moved. */
  dstBox?: [number, number, number, number];
  /** user flagged as removed → only srcBox gets inpainted, no dst placement. */
  removed?: boolean;
  /** locked (preserved) — overrides every other flag; whole srcBox stays white. */
  locked?: boolean;
};

export function buildPreserveMask(
  locks: LockBox[],
  width: number,
  height: number,
  /** feather edges in px to blend transitions */
  feather = 12,
): string {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const ctx = c.getContext('2d')!;
  // black bg = generate everywhere by default
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, width, height);

  if (locks.length === 0) return c.toDataURL('image/png');

  // Soft white rectangles for each lock — feathered radial gradient inside box
  for (const { box } of locks) {
    const [x, y, w, h] = box;
    const px = x * width;
    const py = y * height;
    const pw = w * width;
    const ph = h * height;
    // outer hard rect
    ctx.fillStyle = '#fff';
    ctx.fillRect(px, py, pw, ph);
    // optional feather: shadow blur on edge to soften composite seams
    if (feather > 0) {
      ctx.save();
      ctx.shadowColor = '#fff';
      ctx.shadowBlur = feather;
      ctx.fillRect(px, py, pw, ph);
      ctx.restore();
    }
  }
  return c.toDataURL('image/png');
}

/** Build an edit mask for object-level operations.
 *
 *  Three semantic regions, encoded into a single grayscale channel because the
 *  Gemini multimodal endpoint takes one mask image:
 *    - white  (255)  preserve original photo pixel-faithfully
 *    - mid    (128)  hint to "place the named object here" — soft so the model still
 *                    integrates lighting/shadow with the surrounding scene
 *    - black  (0)    free to regenerate (background inpaint where object was, or
 *                    other free regions)
 *
 *  Order of paint:
 *    1. fill black (default = regenerate everywhere)
 *    2. paint white for every LOCKED + UNMOVED src box (preserved)
 *    3. paint black again for every src box of MOVED / REMOVED objects (forces inpaint)
 *    4. paint mid-gray for every dst box (placement hint)
 */
export function buildEditMask(
  ops: EditOp[],
  width: number,
  height: number,
  feather = 12,
): string {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, width, height);

  // Pass 1: preserve locked + unmoved as white
  for (const op of ops) {
    if (!op.locked || op.dstBox || op.removed) continue;
    paintRect(ctx, op.srcBox, width, height, '#fff', feather);
  }
  // Pass 2: explicit inpaint for moved/removed src regions (override any prior white)
  for (const op of ops) {
    if (op.dstBox || op.removed) {
      paintRect(ctx, op.srcBox, width, height, '#000', feather);
    }
  }
  // Pass 3: dst placement hint (mid-gray)
  for (const op of ops) {
    if (op.dstBox) {
      paintRect(ctx, op.dstBox, width, height, '#808080', feather);
    }
  }
  return c.toDataURL('image/png');
}

function paintRect(
  ctx: CanvasRenderingContext2D,
  box: [number, number, number, number],
  W: number,
  H: number,
  color: string,
  feather: number,
) {
  const [x, y, w, h] = box;
  const px = x * W;
  const py = y * H;
  const pw = w * W;
  const ph = h * H;
  ctx.fillStyle = color;
  ctx.fillRect(px, py, pw, ph);
  if (feather > 0) {
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = feather;
    ctx.fillRect(px, py, pw, ph);
    ctx.restore();
  }
}

/** Crop a region from a blob using normalized [x,y,w,h]. Returns a PNG blob.
 *  Used to send per-object reference images to Gemini for identity preservation. */
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

export async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onloadend = () => {
      const s = r.result as string;
      resolve(s);
    };
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

/** Downscale + JPEG-recompress a blob to keep its long edge ≤ maxEdge. Reduces tokens
 *  sent to Gemini multimodal calls. Preserves aspect ratio. */
export async function downscaleBlob(blob: Blob, maxEdge = 1280, quality = 0.9): Promise<Blob> {
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = url;
    });
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    const longEdge = Math.max(w, h);
    if (longEdge <= maxEdge) return blob;
    const r = maxEdge / longEdge;
    const tw = Math.round(w * r);
    const th = Math.round(h * r);
    const c = document.createElement('canvas');
    c.width = tw;
    c.height = th;
    c.getContext('2d')!.drawImage(img, 0, 0, tw, th);
    return new Promise<Blob>((resolve) => c.toBlob((b) => resolve(b!), 'image/jpeg', quality));
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function imageDimsFromBlob(blob: Blob): Promise<{ w: number; h: number }> {
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });
    return { w: img.naturalWidth, h: img.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}

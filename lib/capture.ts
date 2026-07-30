'use client';

import type { CaptureSlot } from './storage';
import { stripJpegMetadata } from './jpeg-strip';

// 4 walls only — floor + ceiling dropped (unnecessary for our pipeline).
//
// The ids stay n/e/s/w: they are the storage + geometry contract (CaptureSlot in
// lib/storage.ts, the wall order in lib/photo-geometry.ts, the slot tabs on the
// detect screen). The *labels* are deliberately not compass bearings any more.
// Nobody standing in their own living room knows which wall faces north; they
// know "the one with the window". The pipeline only needs four consecutive walls
// in clockwise order, so the absolute bearing was never information — it was a
// question the user couldn't answer.
export const CAPTURE_SLOTS: { id: CaptureSlot; label: string; turn: string; instruction: string }[] = [
  { id: 'n', label: 'Wall 1', turn: 'start anywhere', instruction: 'Any wall you like — frame it corner to corner.' },
  { id: 'e', label: 'Wall 2', turn: 'turn right', instruction: 'Turn a quarter-turn right and frame the next wall.' },
  { id: 's', label: 'Wall 3', turn: 'opposite the first', instruction: 'Keep turning — this is the wall facing Wall 1.' },
  { id: 'w', label: 'Wall 4', turn: 'turn right again', instruction: 'One last quarter-turn right for the final wall.' },
];

/** The shooting method the geometry step assumes (room centre, ~chest height,
 *  clockwise). It used to live only inside the detection prompt, so the user was
 *  never told how to take photos the pipeline could actually use. */
export const CAPTURE_METHOD =
  'Stand in the middle of the room, hold your phone at chest height, and turn right after each shot.';

export async function startCamera(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1440 } },
    audio: false,
  });
}

// ─── Photo normalisation ────────────────────────────────────────────────────
//
// Every photo entering the app is re-encoded to at most MAX_EDGE on its long
// side. Nothing downstream wants more: the local detector letterboxes to 640,
// lib/photo-geometry works in normalized coordinates, and lib/color-sample
// downsamples to a 24×24 grid.
//
// Uploads used to be stored and transmitted at their original resolution, and a
// photo straight off a phone is 3-5 MB. Four of those are 12-20 MB raw, which
// base64 inflates to 16-27 MB — past the inline-request ceiling on the detection
// endpoint. So the app's DEFAULT input path (the Upload tab) broke detection
// outright, and the error came back as an unclassifiable transport failure. The
// same untouched blobs also sat in IndexedDB, pushing at the storage quota.
//
// ~1600px keeps a wall legible while cutting a typical upload by an order of
// magnitude.
const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.9;

/** Raster formats the pipeline can actually measure. `image/*` also matches
 *  SVG, which has no pixels to sample: quality scoring and colour sampling both
 *  return noise for one, and it would then be uploaded as if it were a
 *  photograph. */
export const ACCEPTED_PHOTO_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'image/avif',
];

export function isAcceptedPhoto(file: File | Blob): boolean {
  const type = (file.type || '').toLowerCase();
  return ACCEPTED_PHOTO_TYPES.includes(type);
}

/** Normalise a photo for storage and for the one request that leaves the device:
 *  bounded resolution, and no metadata riding along.
 *
 *  The strip is not redundant with the re-encode. A canvas re-encode drops
 *  metadata as a side effect, but `reencode` deliberately returns some photos
 *  UNCHANGED — a JPEG already under the cap loses quality for nothing if it is
 *  re-encoded. Those are exactly the photos that kept their EXIF, GPS included,
 *  and were then uploaded during detection. Strip runs on the passthrough. */
export async function normalizePhoto(input: Blob): Promise<Blob> {
  const out = await reencode(input);
  // A re-encode already produced clean bytes; only a passthrough needs surgery.
  return out === input ? stripPhotoMetadata(input) : out;
}

/** Drop metadata segments in place. Falls back to the original blob whenever the
 *  bytes cannot be read or understood — see `stripJpegMetadata`. */
async function stripPhotoMetadata(input: Blob): Promise<Blob> {
  try {
    const bytes = new Uint8Array(await input.arrayBuffer());
    const out = stripJpegMetadata(bytes);
    if (out === bytes) return input;
    // Copied into a plain ArrayBuffer rather than handing the view straight to
    // Blob(): a Uint8Array's buffer is typed as possibly shared, which BlobPart
    // will not accept. The photos that reach here are under the size cap, so the
    // copy is cheaper than a cast that depends on where this branch is reached
    // from.
    const buf = new ArrayBuffer(out.byteLength);
    new Uint8Array(buf).set(out);
    return new Blob([buf], { type: input.type || 'image/jpeg' });
  } catch {
    return input;
  }
}

/** Re-encode to JPEG at no more than MAX_EDGE on the long edge. Returns the
 *  input unchanged when it cannot be decoded — a browser that refuses the format
 *  (HEIC on desktop Chrome, say) should still be able to store the file and let
 *  the later steps degrade, rather than lose the photo here. */
async function reencode(input: Blob): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(input);
  } catch {
    return input;
  }
  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    // Already small enough and already a JPEG — re-encoding would only lose data.
    if (scale === 1 && (input.type === 'image/jpeg' || input.type === 'image/jpg')) return input;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return input;
    ctx.drawImage(bitmap, 0, 0, w, h);
    const out = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY),
    );
    // Keep whichever is smaller: a flat wall can re-encode larger than a
    // well-compressed original.
    return out && out.size < input.size ? out : scale < 1 && out ? out : input;
  } finally {
    bitmap.close();
  }
}

export async function snapToBlob(video: HTMLVideoElement): Promise<Blob> {
  const scale = Math.min(1, MAX_EDGE / Math.max(video.videoWidth, video.videoHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
  canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b!), 'image/jpeg', JPEG_QUALITY));
}


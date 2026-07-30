// Remove identifying metadata from a JPEG without touching a single pixel.
//
// Why this exists: normalizePhoto re-encodes most photos through a canvas, which
// drops metadata as a side effect — but it deliberately passes a photo through
// UNCHANGED when it is already a JPEG under the size cap, because re-encoding
// would only lose quality. Those photos kept their EXIF, and EXIF from a phone
// routinely carries GPSLatitude / GPSLongitude. They were then stored and, during
// detection, uploaded. The app promises the wall photos as its only egress; it
// does not promise the coordinates of the user's home.
//
// Byte surgery rather than a re-encode, so the passthrough optimisation survives:
// the entropy-coded image data is copied verbatim and the result decodes to
// exactly the same pixels.
//
// ORDERING NOTE for the calibration work: EXIF also carries the focal length the
// geometry engine wants (and the compass bearing a daylight model would want).
// Read those values BEFORE calling this — once it has run they are gone.

/** Segments that carry metadata rather than image data.
 *  · APP1  — EXIF (camera, timestamps, GPS) and XMP, which also carries GPS
 *  · APP13 — Photoshop / IPTC records
 *  · COM   — free-text comment
 *  APP0 (JFIF density) and APP2 (ICC colour profile) are deliberately KEPT:
 *  neither identifies anyone, and dropping the profile would shift the colours a
 *  decorating app exists to get right. */
const STRIP_MARKERS = new Set([0xe1, 0xed, 0xfe]);

/** Markers that stand alone — no length field, no payload. */
const STANDALONE = new Set([0x01, 0xd0, 0xd1, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9]);

/**
 * Strip metadata segments from a JPEG.
 *
 * Returns the input array itself when there is nothing to remove, when the bytes
 * are not a JPEG (HEIC, PNG, WebP — `createImageBitmap` can refuse a format and
 * leave us holding the original), or when the structure does not parse. Refusing
 * to touch what we cannot read is the safe failure: a photo with metadata still
 * in it is a smaller problem than a photo we corrupted.
 */
export function stripJpegMetadata(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return bytes;

  // Half-open [start, end) byte ranges to keep, in order.
  const keep: Array<[number, number]> = [];
  let runStart = 0;
  let pos = 2;
  let stripped = 0;

  while (pos + 1 < bytes.length) {
    // A marker may be preceded by any number of 0xFF fill bytes.
    if (bytes[pos] !== 0xff) return bytes; // not where a marker should be
    let markerAt = pos;
    while (markerAt + 1 < bytes.length && bytes[markerAt + 1] === 0xff) markerAt++;
    const marker = bytes[markerAt + 1];

    if (STANDALONE.has(marker)) {
      pos = markerAt + 2;
      continue;
    }
    // Start of scan: everything from here on is entropy-coded image data (plus,
    // in a progressive file, further scans). Copy the remainder verbatim.
    if (marker === 0xda) break;

    if (markerAt + 3 >= bytes.length) return bytes; // truncated length field
    const len = (bytes[markerAt + 2] << 8) | bytes[markerAt + 3];
    const end = markerAt + 2 + len;
    if (len < 2 || end > bytes.length) return bytes; // malformed

    if (STRIP_MARKERS.has(marker)) {
      if (markerAt > runStart) keep.push([runStart, markerAt]);
      runStart = end;
      stripped += end - markerAt;
    }
    pos = end;
  }

  if (stripped === 0) return bytes;
  if (runStart < bytes.length) keep.push([runStart, bytes.length]);

  const out = new Uint8Array(bytes.length - stripped);
  let at = 0;
  for (const [from, to] of keep) {
    out.set(bytes.subarray(from, to), at);
    at += to - from;
  }
  return out;
}

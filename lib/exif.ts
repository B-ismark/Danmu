// Read the camera settings a photo carries about itself.
//
// The geometry engine's largest error term is that it GUESSES the camera. It
// assumes a 66° lens, a level phone, and a shooter exactly 1.5 m tall. A photo
// off a phone already knows the first of those, and a wall shot in a small room
// is very often taken on the ULTRAWIDE — around 106°, which read as 66° is out by
// a factor of two.
//
// What that factor actually costs is worth being precise about, because it is not
// uniform (see tests/photo-geometry.test.ts):
//   · wall-mounted items (TV, mirror, window, painting) are sized wrong in
//     proportion, because their distance is pinned to the wall rather than
//     derived, so the angular error lands entirely on the measurement;
//   · floor-standing items keep their SIZE — distance scales as 1/k and angular
//     size as k, so the lens divides out — but land in the wrong place, and once
//     the mis-scaled distance runs past the far wall the clamp breaks the
//     cancellation and they come out too small as well.
//
// Pure byte parsing — no dependency, no network, and no browser API, because
// browsers expose no EXIF reader at all. Runs in the node test environment.
//
// DELIBERATELY NOT READ: GPSLatitude / GPSLongitude. A phone writes the
// coordinates of the user's home into every photo taken there. Nothing in the app
// has a use for them today, and parsing them out of the file and into IndexedDB
// would only move the exposure rather than remove it. When the daylight work
// wants a location it should ask for one, with the consent conversation that
// deserves. `lib/jpeg-strip.ts` deletes them either way.

export type ExifData = {
  /** 35 mm-equivalent focal length in mm — the one that converts to a field of
   *  view without needing to know the sensor size. */
  focalLength35mm?: number;
  /** Physical focal length in mm. Useless on its own (sensor size unknown) but
   *  kept because it is what a camera that omits the 35 mm tag does write. */
  focalLengthMM?: number;
  /** 1..8; 90° steps and mirroring only — never a tilt. */
  orientation?: number;
  /** Compass bearing the lens faced, degrees clockwise from north. */
  bearingDeg?: number;
  /** True north vs magnetic, as recorded alongside the bearing. */
  bearingRef?: 'true' | 'magnetic';
  /** Shutter time, ms since epoch, from DateTimeOriginal.
   *
   *  Read for ONE purpose: putting a dropped set of photos back into the order
   *  they were shot in (`lib/capture-slots.ts`, the `time` rung). A file picker's
   *  order is whatever the OS felt like; the shutter knows. Never persisted and
   *  never sent — the same reason GPS is not read applies with less force to a
   *  timestamp, and the way to keep it having less force is to use the value and
   *  drop it.
   *
   *  EXIF stores local wall-clock time with no zone, so this is parsed AS IF UTC.
   *  That is exact for the only question asked of it — which of these two photos
   *  came first, both off the same phone in the same room — and wrong for any
   *  question about when. Do not display it. */
  shotAt?: number;
};

// TIFF tags we care about. IFD0 / ExifIFD / GPS IFD respectively.
const TAG_ORIENTATION = 0x0112;
const TAG_EXIF_IFD = 0x8769;
const TAG_GPS_IFD = 0x8825;
const TAG_FOCAL_LENGTH = 0x920a;
const TAG_FOCAL_35MM = 0xa405;
const TAG_DATE_TIME_ORIGINAL = 0x9003;
const TAG_GPS_DIR_REF = 0x0010;
const TAG_GPS_DIR = 0x0011;

/** Byte width of each TIFF value type, indexed by the type code. 0 = unknown. */
const TYPE_SIZE = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8];

/**
 * Pull the camera fields out of a JPEG's EXIF block.
 *
 * Returns null when the bytes are not a JPEG, carry no EXIF, or are malformed —
 * every field is optional and every caller has a fallback, so an unreadable photo
 * is a photo we calibrate the old way, not an error.
 */
export function readExifFromJpeg(bytes: Uint8Array): ExifData | null {
  const app1 = findExifApp1(bytes);
  if (!app1) return null;
  return parseTiff(bytes, app1.start, app1.end);
}

/** Byte range of the TIFF block inside the Exif APP1 segment. */
function findExifApp1(bytes: Uint8Array): { start: number; end: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let pos = 2;
  while (pos + 3 < bytes.length) {
    if (bytes[pos] !== 0xff) return null;
    let at = pos;
    while (at + 1 < bytes.length && bytes[at + 1] === 0xff) at++;
    const marker = bytes[at + 1];
    // Standalone markers carry no length; SOS means image data from here on.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      pos = at + 2;
      continue;
    }
    if (marker === 0xda) return null;
    if (at + 3 >= bytes.length) return null;
    const len = (bytes[at + 2] << 8) | bytes[at + 3];
    const end = at + 2 + len;
    if (len < 2 || end > bytes.length) return null;
    if (marker === 0xe1) {
      const p = at + 4;
      // "Exif\0\0" — APP1 also carries XMP, which starts with an XML namespace.
      if (
        p + 6 <= end &&
        bytes[p] === 0x45 && bytes[p + 1] === 0x78 && bytes[p + 2] === 0x69 &&
        bytes[p + 3] === 0x66 && bytes[p + 4] === 0x00 && bytes[p + 5] === 0x00
      ) {
        return { start: p + 6, end };
      }
    }
    pos = end;
  }
  return null;
}

/** Cursor over one TIFF block: knows the byte order and where offsets are
 *  measured from, and refuses to read outside the segment. */
type Tiff = { bytes: Uint8Array; base: number; end: number; le: boolean };

function u16(t: Tiff, at: number): number | null {
  if (at < t.base || at + 2 > t.end) return null;
  return t.le ? t.bytes[at] | (t.bytes[at + 1] << 8) : (t.bytes[at] << 8) | t.bytes[at + 1];
}

function u32(t: Tiff, at: number): number | null {
  if (at < t.base || at + 4 > t.end) return null;
  const b = t.bytes;
  return t.le
    ? (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0
    : ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;
}

function parseTiff(bytes: Uint8Array, base: number, end: number): ExifData | null {
  if (base + 8 > end) return null;
  const order = (bytes[base] << 8) | bytes[base + 1];
  if (order !== 0x4949 && order !== 0x4d4d) return null; // "II" | "MM"
  const t: Tiff = { bytes, base, end, le: order === 0x4949 };
  if (u16(t, base + 2) !== 42) return null; // the TIFF magic
  const ifd0 = u32(t, base + 4);
  if (ifd0 === null) return null;

  const out: ExifData = {};
  const entries0 = readIfd(t, base + ifd0);
  if (!entries0) return null;

  const orientation = scalarOf(t, entries0.get(TAG_ORIENTATION));
  if (orientation !== null && orientation >= 1 && orientation <= 8) out.orientation = orientation;

  // The interesting camera fields live one level down, behind a pointer.
  const exifPtr = scalarOf(t, entries0.get(TAG_EXIF_IFD));
  if (exifPtr !== null) {
    const exif = readIfd(t, base + exifPtr);
    if (exif) {
      const f35 = scalarOf(t, exif.get(TAG_FOCAL_35MM));
      if (f35 !== null && f35 > 0 && f35 < 2000) out.focalLength35mm = f35;
      const f = scalarOf(t, exif.get(TAG_FOCAL_LENGTH));
      if (f !== null && f > 0 && f < 2000) out.focalLengthMM = f;
      const shot = exifDateToMs(asciiStringOf(t, exif.get(TAG_DATE_TIME_ORIGINAL), 19));
      if (shot !== null) out.shotAt = shot;
    }
  }

  const gpsPtr = scalarOf(t, entries0.get(TAG_GPS_IFD));
  if (gpsPtr !== null) {
    const gps = readIfd(t, base + gpsPtr);
    if (gps) {
      const dir = scalarOf(t, gps.get(TAG_GPS_DIR));
      if (dir !== null && dir >= 0 && dir <= 360) out.bearingDeg = dir;
      const ref = asciiOf(t, gps.get(TAG_GPS_DIR_REF));
      if (ref === 'M') out.bearingRef = 'magnetic';
      else if (ref === 'T') out.bearingRef = 'true';
    }
  }

  return out;
}

type Entry = { type: number; count: number; at: number };

/** Tag → entry for one IFD. Bounded: a corrupt count cannot make this run long. */
function readIfd(t: Tiff, at: number): Map<number, Entry> | null {
  const count = u16(t, at);
  if (count === null || count > 512) return null;
  const map = new Map<number, Entry>();
  for (let i = 0; i < count; i++) {
    const e = at + 2 + i * 12;
    const tag = u16(t, e);
    const type = u16(t, e + 2);
    const n = u32(t, e + 4);
    if (tag === null || type === null || n === null) return map;
    const size = (TYPE_SIZE[type] ?? 0) * n;
    if (size === 0) continue;
    // Values of 4 bytes or fewer sit in the entry itself; larger ones are at an
    // offset from the start of the TIFF block.
    let valueAt = e + 8;
    if (size > 4) {
      const off = u32(t, e + 8);
      if (off === null) continue;
      valueAt = t.base + off;
    }
    map.set(tag, { type, count: n, at: valueAt });
  }
  return map;
}

/** First value of an entry as a number, whatever integer or rational type it
 *  was written as. Null for anything unreadable — including a rational with a
 *  zero denominator, which some cameras write for "unknown". */
function scalarOf(t: Tiff, e: Entry | undefined): number | null {
  if (!e) return null;
  switch (e.type) {
    case 1: // BYTE
      return e.at < t.end ? t.bytes[e.at] : null;
    case 3: // SHORT
      return u16(t, e.at);
    case 4: // LONG
      return u32(t, e.at);
    case 9: {
      // SLONG
      const v = u32(t, e.at);
      return v === null ? null : v | 0;
    }
    case 5:
    case 10: {
      // RATIONAL / SRATIONAL
      const num = u32(t, e.at);
      const den = u32(t, e.at + 4);
      if (num === null || den === null || den === 0) return null;
      const n = e.type === 10 ? num | 0 : num;
      const d = e.type === 10 ? den | 0 : den;
      return d === 0 ? null : n / d;
    }
    default:
      return null;
  }
}

/** First character of an ASCII entry — the GPS ref tags are all one letter. */
function asciiOf(t: Tiff, e: Entry | undefined): string | null {
  if (!e || e.at >= t.end) return null;
  const c = t.bytes[e.at];
  return c === 0 ? null : String.fromCharCode(c);
}

/** A whole ASCII entry, up to `max` characters and stopping at the terminator.
 *  Bounded by `t.end` as well as by `count`, because the count is a number out of
 *  the file and everything else in this parser treats those as hostile. */
function asciiStringOf(t: Tiff, e: Entry | undefined, max: number): string | null {
  if (!e || e.type !== 2) return null;
  const n = Math.min(e.count, max);
  let s = '';
  for (let i = 0; i < n; i++) {
    const at = e.at + i;
    if (at >= t.end) break;
    const c = t.bytes[at];
    if (c === 0) break;
    s += String.fromCharCode(c);
  }
  return s.length ? s : null;
}

/**
 * `YYYY:MM:DD HH:MM:SS` → ms since epoch, or null for anything else.
 *
 * Parsed by hand rather than handed to `Date` or a regex-and-`new Date()`: the
 * EXIF form is not ISO 8601, and what `Date.parse` does with a non-ISO string is
 * implementation-defined — the one thing a date parser must not be when its
 * output orders the user's walls. Read AS UTC, deliberately: the tag carries no
 * zone, and this value is only ever compared against another one from the same
 * camera in the same room.
 *
 * The blank-and-zero forms are real. A camera with no clock set writes
 * `0000:00:00 00:00:00`, and some write spaces; both must read as "no time"
 * rather than as the start of the epoch, which would sort them first.
 */
export function exifDateToMs(s: string | null): number | null {
  if (!s) return null;
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(s.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, se] = m.map(Number);
  if (y < 1970 || mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || se > 60) return null;
  const ms = Date.UTC(y, mo - 1, d, h, mi, se);
  // Date.UTC rolls a 31st of February forward into March rather than refusing it.
  // Round-tripping catches that, and costs one comparison.
  const back = new Date(ms);
  if (back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  return ms;
}

/** Half-diagonal of the 35 mm frame (36 × 24 mm), in mm. */
const HALF_DIAG_35 = Math.hypot(36, 24) / 2;

/**
 * Horizontal field of view from a 35 mm-equivalent focal length.
 *
 * The equivalence is defined on the DIAGONAL — that is what a crop factor is —
 * so the horizontal half-extent depends on the shape of the frame, not on a flat
 * 18 mm. For a 3:2 photo it works out to exactly 18 mm; for the 4:3 a phone
 * actually shoots it is 17.3, and for a portrait 3:4 it is 13.0. Feeding the
 * image's own aspect in also means portrait shots need no special case.
 *
 *     halfWidth = 21.63 · aspect / √(1 + aspect²)
 *     hFOV      = 2 · atan(halfWidth / f₃₅)
 *
 * A phone main camera reports ~26 mm (≈67° at 4:3) and an ultrawide ~13 mm
 * (≈106°) — that spread is why reading this beats assuming a single number.
 */
export function hfovFromFocal35(focal35mm: number, aspect: number): number | null {
  if (!(focal35mm > 0) || !(aspect > 0) || !Number.isFinite(aspect)) return null;
  const halfWidth = (HALF_DIAG_35 * aspect) / Math.hypot(1, aspect);
  const deg = (2 * Math.atan(halfWidth / focal35mm) * 180) / Math.PI;
  // Outside this band the tag is a transcription error, not a lens.
  return deg >= 20 && deg <= 150 ? deg : null;
}

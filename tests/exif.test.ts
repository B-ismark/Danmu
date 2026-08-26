import { describe, it, expect } from 'vitest';
import { readExifFromJpeg, hfovFromFocal35, exifDateToMs } from '@/lib/exif';

// ── Minimal EXIF writer, so the fixtures are readable rather than a blob of hex ─

type Tag = { tag: number; type: number; value: number | [number, number] | string };

const SHORT = 3;
const LONG = 4;
const RATIONAL = 5;
const ASCII = 2;

/** Build one IFD plus its overflow area. `base` is the offset of this IFD from
 *  the start of the TIFF block; values longer than 4 bytes go after the entries
 *  and are referenced by offset. */
function ifd(base: number, tags: Tag[], le: boolean, nextIfd = 0): number[] {
  const count = tags.length;
  const entriesEnd = 2 + count * 12 + 4;
  const out: number[] = [];
  const overflow: number[] = [];
  const w16 = (n: number) => (le ? [n & 0xff, (n >> 8) & 0xff] : [(n >> 8) & 0xff, n & 0xff]);
  const w32 = (n: number) =>
    le
      ? [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff]
      : [(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];

  out.push(...w16(count));
  for (const t of tags) {
    out.push(...w16(t.tag), ...w16(t.type));
    if (t.type === RATIONAL) {
      const [num, den] = t.value as [number, number];
      out.push(...w32(1));
      out.push(...w32(base + entriesEnd + overflow.length));
      overflow.push(...w32(num), ...w32(den));
    } else if (t.type === ASCII) {
      const s = t.value as string;
      const bytes = [...s].map((c) => c.charCodeAt(0));
      out.push(...w32(bytes.length + 1));
      if (bytes.length + 1 > 4) {
        // A date stamp is 19 characters plus its NUL, so it lives in the overflow
        // area like a rational does. The one-letter GPS refs still go inline, and
        // both paths need to work — the parser reads them the same way.
        out.push(...w32(base + entriesEnd + overflow.length));
        overflow.push(...bytes, 0);
      } else {
        while (bytes.length < 4) bytes.push(0);
        out.push(...bytes.slice(0, 4));
      }
    } else if (t.type === SHORT) {
      out.push(...w32(1), ...w16(t.value as number), 0, 0);
    } else {
      out.push(...w32(1), ...w32(t.value as number));
    }
  }
  out.push(...w32(nextIfd));
  return [...out, ...overflow];
}

/** A JPEG carrying one Exif APP1 segment with IFD0 → ExifIFD (+ optional GPS). */
function jpegWithExif(opts: {
  le?: boolean;
  orientation?: number;
  focal35?: number;
  focalMM?: [number, number];
  bearing?: [number, number];
  bearingRef?: string;
  shotAt?: string;
}): Uint8Array {
  const le = opts.le ?? true;
  const w32 = (n: number) =>
    le
      ? [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff]
      : [(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];

  // IFD0 sits at offset 8; size it first so the child IFDs can be placed after.
  const ifd0Tags: Tag[] = [];
  if (opts.orientation !== undefined) ifd0Tags.push({ tag: 0x0112, type: SHORT, value: opts.orientation });
  ifd0Tags.push({ tag: 0x8769, type: LONG, value: 0 }); // ExifIFD pointer, patched below
  const wantGps = opts.bearing !== undefined || opts.bearingRef !== undefined;
  if (wantGps) ifd0Tags.push({ tag: 0x8825, type: LONG, value: 0 });

  const ifd0Size = ifd(8, ifd0Tags, le).length;
  const exifAt = 8 + ifd0Size;

  const exifTags: Tag[] = [];
  if (opts.focal35 !== undefined) exifTags.push({ tag: 0xa405, type: SHORT, value: opts.focal35 });
  if (opts.focalMM !== undefined) exifTags.push({ tag: 0x920a, type: RATIONAL, value: opts.focalMM });
  if (opts.shotAt !== undefined) exifTags.push({ tag: 0x9003, type: ASCII, value: opts.shotAt });
  const exifBlock = ifd(exifAt, exifTags, le);
  const gpsAt = exifAt + exifBlock.length;

  const gpsTags: Tag[] = [];
  if (opts.bearingRef !== undefined) gpsTags.push({ tag: 0x0010, type: ASCII, value: opts.bearingRef });
  if (opts.bearing !== undefined) gpsTags.push({ tag: 0x0011, type: RATIONAL, value: opts.bearing });
  const gpsBlock = wantGps ? ifd(gpsAt, gpsTags, le) : [];

  // Re-emit IFD0 with the real child offsets.
  const patched: Tag[] = ifd0Tags.map((t) =>
    t.tag === 0x8769 ? { ...t, value: exifAt } : t.tag === 0x8825 ? { ...t, value: gpsAt } : t,
  );
  const tiff = [
    ...(le ? [0x49, 0x49] : [0x4d, 0x4d]),
    ...(le ? [42, 0] : [0, 42]),
    ...w32(8),
    ...ifd(8, patched, le),
    ...exifBlock,
    ...gpsBlock,
  ];

  const payload = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...tiff]; // "Exif\0\0" + TIFF
  const len = payload.length + 2;
  return new Uint8Array([
    0xff, 0xd8,
    0xff, 0xe1, (len >> 8) & 0xff, len & 0xff, ...payload,
    0xff, 0xda, 0x00, 0x08, 1, 1, 0, 0, 63, 0,
    0x9a, 0x3c,
    0xff, 0xd9,
  ]);
}

describe('readExifFromJpeg', () => {
  it('reads the 35 mm-equivalent focal length', () => {
    const exif = readExifFromJpeg(jpegWithExif({ focal35: 26 }))!;
    expect(exif.focalLength35mm).toBe(26);
  });

  it('reads big-endian (MM) files too', () => {
    // Byte order is per-file; plenty of cameras write Motorola order.
    const exif = readExifFromJpeg(jpegWithExif({ le: false, focal35: 13, orientation: 6 }))!;
    expect(exif.focalLength35mm).toBe(13);
    expect(exif.orientation).toBe(6);
  });

  it('reads a rational focal length and the compass bearing', () => {
    const exif = readExifFromJpeg(
      jpegWithExif({ focalMM: [2400, 100], bearing: [27050, 100], bearingRef: 'T' }),
    )!;
    expect(exif.focalLengthMM).toBeCloseTo(24, 6);
    expect(exif.bearingDeg).toBeCloseTo(270.5, 6);
    expect(exif.bearingRef).toBe('true');
  });

  it('reads the shutter time, from the overflow area a 19-character string needs', () => {
    const exif = readExifFromJpeg(jpegWithExif({ shotAt: '2026:08:26 09:41:07', focal35: 26 }))!;
    expect(exif.shotAt).toBe(Date.UTC(2026, 7, 26, 9, 41, 7));
    // Reading a string out of the overflow area must not disturb the tag beside it.
    expect(exif.focalLength35mm).toBe(26);
  });

  it('reads it in big-endian files too', () => {
    const exif = readExifFromJpeg(jpegWithExif({ le: false, shotAt: '2026:08:26 09:41:07' }))!;
    expect(exif.shotAt).toBe(Date.UTC(2026, 7, 26, 9, 41, 7));
  });

  it('orders two photos by their shutter times', () => {
    // The whole reason the tag is read: which of these was taken first.
    const a = readExifFromJpeg(jpegWithExif({ shotAt: '2026:08:26 09:41:07' }))!;
    const b = readExifFromJpeg(jpegWithExif({ shotAt: '2026:08:26 09:41:22' }))!;
    expect(b.shotAt! - a.shotAt!).toBe(15_000);
  });

  it('ignores it when the tag is absent', () => {
    expect(readExifFromJpeg(jpegWithExif({ focal35: 26 }))!.shotAt).toBeUndefined();
  });
});

describe('exifDateToMs', () => {
  it('parses the EXIF form, as UTC', () => {
    expect(exifDateToMs('2026:08:26 09:41:07')).toBe(Date.UTC(2026, 7, 26, 9, 41, 7));
  });

  it('refuses the forms a camera with no clock writes', () => {
    // Both of these are real, and both must read as "no time" rather than as the
    // start of the epoch — which would sort them to the front of the set.
    expect(exifDateToMs('0000:00:00 00:00:00')).toBeNull();
    expect(exifDateToMs('    :  :     :  :  ')).toBeNull();
    expect(exifDateToMs('')).toBeNull();
    expect(exifDateToMs(null)).toBeNull();
    expect(exifDateToMs('yesterday afternoon')).toBeNull();
  });

  it('refuses a date that does not exist rather than rolling it forward', () => {
    // `Date.UTC` turns the 31st of February into the 3rd of March without
    // complaint. A parser that accepts it is a parser that invents an ordering.
    expect(exifDateToMs('2026:02:31 10:00:00')).toBeNull();
    expect(exifDateToMs('2025:02:29 10:00:00')).toBeNull();
    expect(exifDateToMs('2024:02:29 10:00:00')).toBe(Date.UTC(2024, 1, 29, 10, 0, 0));
  });

  it('refuses an out-of-range field', () => {
    expect(exifDateToMs('2026:13:01 10:00:00')).toBeNull();
    expect(exifDateToMs('2026:08:26 24:00:00')).toBeNull();
    expect(exifDateToMs('2026:08:26 10:60:00')).toBeNull();
  });
});

describe('readExifFromJpeg, continued', () => {
  it('ignores a rational with a zero denominator', () => {
    // Some cameras write 0/0 for "unknown" rather than omitting the tag.
    const exif = readExifFromJpeg(jpegWithExif({ focalMM: [0, 0] }))!;
    expect(exif.focalLengthMM).toBeUndefined();
  });

  it('rejects a focal length that is not a lens', () => {
    expect(readExifFromJpeg(jpegWithExif({ focal35: 0 }))!.focalLength35mm).toBeUndefined();
  });

  it('returns null when there is no EXIF to read', () => {
    const plain = new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 4, 0x11, 0x22, 0xff, 0xd9]);
    expect(readExifFromJpeg(plain)).toBeNull();
    expect(readExifFromJpeg(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
  });

  it('survives a truncated or corrupt segment without throwing', () => {
    const good = jpegWithExif({ focal35: 26 });
    for (const cut of [10, 14, 20, 26, 32]) {
      expect(() => readExifFromJpeg(good.subarray(0, cut))).not.toThrow();
    }
    // A plausible header followed by nonsense.
    const junk = new Uint8Array(good);
    junk.fill(0xab, 14, junk.length - 4);
    expect(() => readExifFromJpeg(junk)).not.toThrow();
  });
});

describe('hfovFromFocal35', () => {
  it('is diagonal-based, so the frame shape matters', () => {
    // 3:2 is the 35 mm frame itself — half-width is exactly 18 mm there.
    expect(hfovFromFocal35(36, 3 / 2)!).toBeCloseTo((2 * Math.atan(18 / 36) * 180) / Math.PI, 6);
    // The 4:3 a phone actually shoots is narrower for the same lens.
    expect(hfovFromFocal35(26, 4 / 3)!).toBeLessThan(hfovFromFocal35(26, 3 / 2)!);
    // …and a portrait crop narrower still.
    expect(hfovFromFocal35(26, 3 / 4)!).toBeLessThan(hfovFromFocal35(26, 4 / 3)!);
  });

  it('separates a phone main camera from its ultrawide', () => {
    const main = hfovFromFocal35(26, 4 / 3)!;
    const ultra = hfovFromFocal35(13, 4 / 3)!;
    expect(main).toBeGreaterThan(60);
    expect(main).toBeLessThan(72);
    expect(ultra).toBeGreaterThan(100);
    expect(ultra).toBeLessThan(112);
  });

  it('refuses nonsense', () => {
    expect(hfovFromFocal35(0, 4 / 3)).toBeNull();
    expect(hfovFromFocal35(26, 0)).toBeNull();
    expect(hfovFromFocal35(26, NaN)).toBeNull();
    expect(hfovFromFocal35(2000, 4 / 3)).toBeNull(); // a telescope, not a phone
  });
});

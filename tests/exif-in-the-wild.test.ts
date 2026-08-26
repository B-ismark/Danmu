import { describe, it, expect } from 'vitest';
import { readExifFromJpeg } from '@/lib/exif';
import { placePhotos, SLOT_ORDER, type PhotoFacts } from '@/lib/capture-slots';

// What a real set of room photos actually carries, and what the ladder does with it.
//
// `lib/capture-slots.ts` describes a four-rung ladder — compass bearing, then EXIF
// shutter time, then arrival order, then the user — and presents the bearing as the
// good answer. This suite exists because the app was finally run against four real
// photographs of a real bedroom, and the bearing rung **never fired once**:
//
//   · Phone: Pixel 6 Pro. Its files had been through at least one share or export
//     step before reaching the desktop, and what survived was IFD0 with Make,
//     Model, dimensions, Orientation and DateTime, plus an ExifIFD holding three
//     entries — ExifVersion, DateTimeOriginal, LightSource. Big-endian.
//   · **No `GPSImgDirection`. No GPS IFD at all.** So no bearing, so no anchor.
//   · **No `FocalLength` and no `FocalLengthIn35mmFilm` either**, which is a
//     separate cost: `lib/photo-geometry.ts` falls back to an assumed 66° lens, and
//     that fallback is documented there as one of its three largest error terms. It
//     is not a bug and there is nothing to fix in the parser — the tags are simply
//     not in the file — but it means the assumed-lens path is the NORMAL path, not
//     the unlucky one.
//   · `DateTimeOriginal` present and correct on all four. The `time` rung carried
//     the whole set.
//
// The lesson is about which rung to trust, so these fixtures reproduce the *shape*
// of that set rather than its contents: an EXIF block stripped down to a shutter
// time, and a shooting pattern of one photo taken well before a burst of three.
// The real timestamps are deliberately not used — a photograph's clock says when
// somebody was standing in their bedroom, and this file needs the intervals, not
// the hour.

/** One IFD, big-endian, values over 4 bytes pushed into an overflow area. */
function ifd(base: number, tags: Array<{ tag: number; type: number; value: number | string }>): number[] {
  const w16 = (n: number) => [(n >> 8) & 0xff, n & 0xff];
  const w32 = (n: number) => [(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
  const entriesEnd = 2 + tags.length * 12 + 4;
  const out: number[] = [...w16(tags.length)];
  const overflow: number[] = [];
  for (const t of tags) {
    out.push(...w16(t.tag), ...w16(t.type));
    if (t.type === 2) {
      const bytes = [...(t.value as string)].map((c) => c.charCodeAt(0));
      out.push(...w32(bytes.length + 1), ...w32(base + entriesEnd + overflow.length));
      overflow.push(...bytes, 0);
    } else if (t.type === 3) {
      out.push(...w32(1), ...w16(t.value as number), 0, 0);
    } else {
      out.push(...w32(1), ...w32(t.value as number));
    }
  }
  out.push(...w32(0));
  return [...out, ...overflow];
}

/**
 * A JPEG shaped like the ones the app was actually handed: big-endian TIFF, an
 * IFD0 carrying only Orientation and the ExifIFD pointer, an ExifIFD carrying only
 * DateTimeOriginal, and no GPS IFD whatsoever.
 */
function strippedPhoneJpeg(shotAt: string): Uint8Array {
  const w32 = (n: number) => [(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
  const ifd0Size = ifd(8, [
    { tag: 0x0112, type: 3, value: 1 },
    { tag: 0x8769, type: 4, value: 0 },
  ]).length;
  const exifAt = 8 + ifd0Size;
  const tiff = [
    0x4d, 0x4d, 0x00, 0x2a, ...w32(8),
    ...ifd(8, [
      { tag: 0x0112, type: 3, value: 1 },
      { tag: 0x8769, type: 4, value: exifAt },
    ]),
    ...ifd(exifAt, [{ tag: 0x9003, type: 2, value: shotAt }]),
  ];
  const payload = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...tiff];
  const len = payload.length + 2;
  return new Uint8Array([
    0xff, 0xd8,
    0xff, 0xe1, (len >> 8) & 0xff, len & 0xff, ...payload,
    0xff, 0xda, 0x00, 0x08, 1, 1, 0, 0, 63, 0,
    0x9a, 0x3c,
    0xff, 0xd9,
  ]);
}

/** The pattern the real set was shot in: one wall, a pause, then three in a burst.
 *  Order here is the order the shutter fired, which is the answer under test. */
const SHUTTER = [
  '2026:03:04 09:02:11', // the first wall
  '2026:03:04 09:13:44', // …eleven minutes later, the other three back to back
  '2026:03:04 09:13:50',
  '2026:03:04 09:13:55',
];

const factsOf = (jpeg: Uint8Array): PhotoFacts => {
  const e = readExifFromJpeg(jpeg);
  return {
    ...(e?.bearingDeg !== undefined ? { bearingDeg: e.bearingDeg } : {}),
    ...(e?.shotAt !== undefined ? { shotAt: e.shotAt } : {}),
  };
};

describe('EXIF as phones in the wild actually write it', () => {
  it('finds the shutter time and, correctly, nothing else', () => {
    const exif = readExifFromJpeg(strippedPhoneJpeg(SHUTTER[0]))!;
    expect(exif.shotAt).toBe(Date.UTC(2026, 2, 4, 9, 2, 11));
    expect(exif.orientation).toBe(1);
    // Asserted as ABSENT, not merely unused. A parser that guessed a focal length
    // or a bearing would feed the geometry engine and the slot ladder a number
    // nobody measured, which is the one thing rule 2 exists to stop.
    expect(exif.focalLength35mm).toBeUndefined();
    expect(exif.focalLengthMM).toBeUndefined();
    expect(exif.bearingDeg).toBeUndefined();
    expect(exif.bearingRef).toBeUndefined();
  });

  it('names the walls off the shutter, in the order the walls were shot', () => {
    const facts = SHUTTER.map((t) => factsOf(strippedPhoneJpeg(t)));
    const res = placePhotos([], facts);
    expect(res.rejected).toEqual([]);
    // Photo i went to slot i: the batch arrived in shutter order and the cyclic
    // slot order is the order a person turning clockwise shoots in.
    expect(res.placed.map((p) => p.slot)).toEqual([...SLOT_ORDER]);
    // And the rung that answered is `time` for every one of them — the case the
    // real photos turned out to be. If a future change makes this say `order`, the
    // ladder has silently lost the only rung that works on a real phone.
    expect(res.placed.every((p) => p.by === 'time')).toBe(true);
    expect(res.placed.some((p) => p.clashedWith)).toBe(false);
  });

  it('recovers that order from a file picker that hands them over shuffled', () => {
    // Which is the whole point of reading the tag: a multi-select returns whatever
    // order the OS felt like, and a set filed by arrival would be rotated or
    // scrambled — every size then measured off the wrong wall (`wallDistance`
    // reads depth/2 for n/s and width/2 for e/w).
    const arrival = [2, 0, 3, 1];
    const facts = arrival.map((i) => factsOf(strippedPhoneJpeg(SHUTTER[i])));
    const res = placePhotos([], facts);
    // `index` is the position in the batch as handed in, so this maps each ARRIVAL
    // slot back to the photo that actually occupied it.
    const slotOf = new Map(res.placed.map((p) => [arrival[p.index], p.slot]));
    expect([0, 1, 2, 3].map((shot) => slotOf.get(shot))).toEqual([...SLOT_ORDER]);
  });

  it('falls to arrival order for the whole batch when one photo has no shutter time', () => {
    // All-or-nothing on purpose, and worth pinning because the alternative looks
    // reasonable: sort the timed ones and drop the untimed into the gaps. That
    // interleaving is where a wrong wall would come from — a photo with no time is
    // not "last", it is unknown, and giving it a position among sorted neighbours
    // states an order nothing measured. Arrival order is at least honest about
    // being arrival order, and it is what the live camera path already relies on.
    const facts: PhotoFacts[] = [
      factsOf(strippedPhoneJpeg(SHUTTER[3])),
      factsOf(strippedPhoneJpeg(SHUTTER[1])),
      {}, // metadata gone entirely — a screenshot, a re-encode, a strict share sheet
      factsOf(strippedPhoneJpeg(SHUTTER[0])),
    ];
    const res = placePhotos([], facts);
    expect(res.placed.map((p) => p.index)).toEqual([0, 1, 2, 3]);
    expect(res.placed.map((p) => p.slot)).toEqual([...SLOT_ORDER]);
    expect(res.placed.every((p) => p.by === 'order')).toBe(true);
  });
});

import { describe, it, expect } from 'vitest';
import { stripJpegMetadata } from '@/lib/jpeg-strip';

/** One JPEG segment: 0xFF, marker, big-endian length (counting itself), payload. */
function seg(marker: number, payload: number[]): number[] {
  const len = payload.length + 2;
  return [0xff, marker, (len >> 8) & 0xff, len & 0xff, ...payload];
}

const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

const SOI = [0xff, 0xd8];
const EOI = [0xff, 0xd9];
const APP0 = seg(0xe0, [...ascii('JFIF'), 0, 1, 2, 0, 0, 1, 0, 1, 0, 0]);
// Stands in for a real EXIF block; the GPS bytes are what this module exists for.
const APP1_EXIF = seg(0xe1, [...ascii('Exif'), 0, 0, ...ascii('II*'), 0, 8, 0, 0, 0, 0x42, 0x13]);
const APP2_ICC = seg(0xe2, [...ascii('ICC_PROFILE'), 0, 1, 1, 0, 0]);
const DQT = seg(0xdb, [0, 16, 11, 10]);
const SOS = seg(0xda, [1, 1, 0, 0, 63, 0]);
const SCAN = [0x9a, 0xff, 0x00, 0x3c, 0x7e];

function jpeg(...parts: number[][]): Uint8Array {
  return new Uint8Array(parts.flat());
}

describe('stripJpegMetadata', () => {
  it('removes EXIF and leaves the image data byte-identical', () => {
    const input = jpeg(SOI, APP0, APP1_EXIF, DQT, SOS, SCAN, EOI);
    const out = stripJpegMetadata(input);

    expect(out).not.toBe(input);
    expect(out.length).toBe(input.length - APP1_EXIF.length);
    // Exactly the removed segment's worth, and the file still frames correctly.
    expect([...out.subarray(0, 2)]).toEqual(SOI);
    expect([...out.subarray(-2)]).toEqual(EOI);
    // Everything from SOS onward survives untouched — same pixels, no re-encode.
    const tail = [...SOS, ...SCAN, ...EOI];
    expect([...out.subarray(out.length - tail.length)]).toEqual(tail);
    expect([...out]).toEqual([...SOI, ...APP0, ...DQT, ...tail]);
  });

  it('keeps JFIF density and the ICC colour profile', () => {
    // Neither identifies anyone, and dropping the profile would shift the colours
    // of an app whose whole job is getting a colour right.
    const input = jpeg(SOI, APP0, APP2_ICC, APP1_EXIF, DQT, SOS, SCAN, EOI);
    const out = stripJpegMetadata(input);
    expect([...out]).toEqual([...SOI, ...APP0, ...APP2_ICC, ...DQT, ...SOS, ...SCAN, ...EOI]);
  });

  it('removes IPTC and comment blocks as well', () => {
    const app13 = seg(0xed, ascii('Photoshop 3.0'));
    const com = seg(0xfe, ascii('taken at home'));
    const input = jpeg(SOI, com, APP0, app13, DQT, SOS, SCAN, EOI);
    expect([...stripJpegMetadata(input)]).toEqual([...SOI, ...APP0, ...DQT, ...SOS, ...SCAN, ...EOI]);
  });

  it('returns the same array when there is nothing to strip', () => {
    // Identity, not a copy — the caller uses it to skip rebuilding the Blob.
    const input = jpeg(SOI, APP0, DQT, SOS, SCAN, EOI);
    expect(stripJpegMetadata(input)).toBe(input);
  });

  it('leaves formats it does not understand alone', () => {
    // createImageBitmap can refuse HEIC, which leaves normalizePhoto holding the
    // original bytes. Corrupting them would be far worse than keeping metadata.
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    expect(stripJpegMetadata(png)).toBe(png);
    expect(stripJpegMetadata(new Uint8Array([0xff, 0xd8]))).toBeInstanceOf(Uint8Array);
  });

  it('refuses to touch a malformed file rather than mangling it', () => {
    // Length field runs past the end of the buffer.
    const bad = new Uint8Array([...SOI, 0xff, 0xe1, 0x7f, 0xff, 1, 2, 3]);
    expect(stripJpegMetadata(bad)).toBe(bad);
    // Not a marker where one must be.
    const notMarker = new Uint8Array([...SOI, 0x42, 0x42, 0x42, 0x42]);
    expect(stripJpegMetadata(notMarker)).toBe(notMarker);
  });

  it('handles fill bytes before a marker', () => {
    // 0xFF padding ahead of a marker is legal and must not derail the scan.
    const input = jpeg(SOI, [0xff, 0xff], APP1_EXIF, DQT, SOS, SCAN, EOI);
    const out = stripJpegMetadata(input);
    expect(out.length).toBe(input.length - APP1_EXIF.length);
    expect([...out.subarray(-(SOS.length + SCAN.length + EOI.length))]).toEqual([
      ...SOS,
      ...SCAN,
      ...EOI,
    ]);
  });
});

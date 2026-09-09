// The arithmetic behind `sampleBoxColor`, which had no test at all until it was
// split out of the canvas function that hid it.
//
// Every buffer here is a bare `Uint8ClampedArray` built in the test — the pattern
// `tests/vanishing-point.test.ts` uses for the same reason. No canvas, no jsdom,
// no `createImageBitmap` shim: the function under test takes numbers.

import { describe, expect, it } from 'vitest';
import { MIN_SAMPLES, TRIM, dominantColor, luma, medianHex, parseHex, rgbToHex } from '@/lib/color-reduce';

/** `n` opaque pixels of one colour. */
function solid(n: number, [r, g, b]: [number, number, number]): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i += 1) out.push(r, g, b, 255);
  return out;
}
const buf = (...runs: number[][]) => new Uint8ClampedArray(runs.flat());

const SAGE: [number, number, number] = [140, 160, 130];

describe('dominantColor', () => {
  it('returns the colour of a uniform region', () => {
    expect(dominantColor(buf(solid(64, SAGE)))).toBe('#8ca082');
  });

  it('rejects a region with too little in it', () => {
    // One under the floor, so the boundary itself is pinned rather than "small".
    expect(dominantColor(buf(solid(MIN_SAMPLES - 1, SAGE)))).toBeNull();
    expect(dominantColor(buf(solid(MIN_SAMPLES, SAGE)))).toBe('#8ca082');
  });

  it('skips transparent pixels rather than counting them as black', () => {
    const clear: number[] = [];
    for (let i = 0; i < 40; i += 1) clear.push(0, 0, 0, 0);
    // 40 transparent + 10 sage. If transparency were counted the median would be
    // black; the transparent run is also large enough to dominate a mean.
    expect(dominantColor(buf(clear, solid(10, SAGE)))).toBe('#8ca082');
  });

  it('returns null when everything usable was transparent', () => {
    const clear: number[] = [];
    for (let i = 0; i < 40; i += 1) clear.push(0, 0, 0, 0);
    expect(dominantColor(buf(clear))).toBeNull();
  });

  // ─── the trim, which is the whole reason this is not a mean ───────────────
  it('drops a specular highlight and a cast shadow', () => {
    // 80 sage, 8 blown-out white, 8 near-black: both extremes are ~9% of the
    // buffer, inside the 15% trim from each end.
    const withExtremes = buf(
      solid(80, SAGE),
      solid(8, [255, 255, 255]),
      solid(8, [4, 4, 6]),
    );
    expect(dominantColor(withExtremes)).toBe('#8ca082');
  });

  it('and the trim is doing that, not the median on its own', () => {
    // The assertion above passes with or without the trim, because those extremes
    // are symmetric in luma AND in every channel. The case that isolates the trim
    // is one where the luma order and a CHANNEL order disagree: a shadowed navy
    // curtain is the darkest thing in the frame and also the most blue, so
    // trimming the dark end removes the pixels holding the blue median up.
    //
    // 30 sage (luma 154) · 20 shadowed navy (luma 24) · 10 blown white (luma 250).
    // Trimmed, blue reads 130 — the wall. Untrimmed it reads 200 — the curtain.
    const navyShadow = buf(solid(30, SAGE), solid(20, [10, 10, 200]), solid(10, [250, 250, 250]));
    expect(dominantColor(navyShadow)).toBe('#8ca082');
    expect(dominantColor(navyShadow, { trim: 0 })).toBe('#8ca0c8');
  });

  it('keeps the whole set rather than trimming away a small sample', () => {
    // 10 samples, trim 0.15 → cut 1 from each end leaves 8, which is still a
    // median worth taking. Pinned so the fallback branch is not dead code.
    expect(dominantColor(buf(solid(10, SAGE)))).toBe('#8ca082');
    // With a trim that would leave under four, the set survives intact.
    expect(dominantColor(buf(solid(10, SAGE)), { trim: 0.45 })).toBe('#8ca082');
  });

  // ─── the mask, which is how furniture stays out of a wall's colour ────────
  it('skips masked pixels', () => {
    const mixed = buf(solid(32, SAGE), solid(32, [200, 60, 40]));
    const mask = new Uint8Array(64);
    for (let i = 32; i < 64; i += 1) mask[i] = 1;
    expect(dominantColor(mixed, { mask })).toBe('#8ca082');
    // …and without the mask the terracotta half moves the answer, so the
    // assertion above is about the mask and not about the median.
    expect(dominantColor(mixed)).not.toBe('#8ca082');
  });

  it('returns null when the mask leaves too little', () => {
    const mask = new Uint8Array(64).fill(1);
    mask[0] = 0;
    expect(dominantColor(buf(solid(64, SAGE)), { mask })).toBeNull();
  });

  it('takes the median per channel, so the answer can be a colour no pixel had', () => {
    // Documented rather than desirable, and pinned because "median colour" reads
    // as if it names one of the sampled pixels. Half the buffer is warm
    // (200,100,40), half cool (40,100,200) — equal counts, so each channel's
    // median lands on the HIGH side of its own tie: red from the warm half, blue
    // from the cool half, giving a magenta that is in neither.
    //
    // This is what the trim's pixel-wise ordering protects (which pixels are
    // dropped stays consistent across channels) and what it does NOT protect
    // (the median itself is still per channel). The distinction cost a wrong
    // comment in `color-reduce.ts` before this test was written.
    const runs: number[][] = [];
    for (let i = 0; i < 24; i += 1) runs.push(solid(1, [200, 100, 40]));
    for (let i = 0; i < 24; i += 1) runs.push(solid(1, [40, 100, 200]));
    expect(dominantColor(buf(...runs))).toBe('#c864c8');
  });
});

describe('the helpers it is built from', () => {
  it('rgbToHex clamps and rounds rather than emitting nonsense', () => {
    expect(rgbToHex(0, 0, 0)).toBe('#000000');
    expect(rgbToHex(255, 255, 255)).toBe('#ffffff');
    expect(rgbToHex(-20, 300, 127.6)).toBe('#00ff80');
    // Two digits always, or the string is not a colour.
    expect(rgbToHex(1, 2, 3)).toBe('#010203');
  });

  it('luma weights green heaviest, per Rec.709', () => {
    expect(luma(0, 255, 0)).toBeGreaterThan(luma(255, 0, 0));
    expect(luma(255, 0, 0)).toBeGreaterThan(luma(0, 0, 255));
    expect(luma(255, 255, 255)).toBeCloseTo(255, 6);
    expect(luma(0, 0, 0)).toBe(0);
  });

  it('exposes the two constants callers reason about', () => {
    expect(MIN_SAMPLES).toBeGreaterThanOrEqual(4);
    expect(TRIM).toBeGreaterThan(0);
    expect(TRIM).toBeLessThan(0.5);
  });
});

describe('medianHex — the one colour several walls share', () => {
  it('takes the per-channel median of already-reduced colours', () => {
    expect(medianHex(['#202020', '#404040', '#808080'])).toBe('#404040');
  });

  it('mixes channels independently, like dominantColor does', () => {
    expect(medianHex(['#ff0000', '#00ff00', '#0000ff'])).toBe('#000000');
  });

  it('does not apply the highlight trim', () => {
    // The trim is about pixels within one surface; these are already one answer
    // each. Applying it here would also refuse outright, since three samples is
    // under MIN_SAMPLES — which is exactly why this is not `dominantColor` over a
    // buffer built from the hexes.
    expect(medianHex(['#ffffff', '#8ca082', '#000000'])).toBe('#8ca082');
    expect(dominantColor(new Uint8ClampedArray([255, 255, 255, 255]))).toBeNull();
  });

  it('takes the upper middle on an even count, matching dominantColor', () => {
    expect(medianHex(['#101010', '#202020'])).toBe('#202020');
  });

  it('ignores entries that are not colours rather than failing the lot', () => {
    expect(medianHex(['not a colour', '#404040'])).toBe('#404040');
    expect(medianHex([])).toBeNull();
    expect(medianHex(['nope'])).toBeNull();
  });

  it('parseHex is strict, because nothing downstream validates a colour', () => {
    expect(parseHex('#8CA082')).toEqual([140, 160, 130]);
    expect(parseHex('  #8ca082  ')).toEqual([140, 160, 130]);
    expect(parseHex('#8ca')).toBeNull();
    expect(parseHex('8ca082')).toBeNull();
    expect(parseHex('#8ca08z')).toBeNull();
    expect(parseHex('')).toBeNull();
  });
});

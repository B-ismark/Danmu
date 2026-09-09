// The arithmetic behind `sampleBoxColor`, which had no test at all until it was
// split out of the canvas function that hid it.
//
// Every buffer here is a bare `Uint8ClampedArray` built in the test — the pattern
// `tests/vanishing-point.test.ts` uses for the same reason. No canvas, no jsdom,
// no `createImageBitmap` shim: the function under test takes numbers.

import { describe, expect, it } from 'vitest';
import {
  MIN_AFTER_TRIM,
  MIN_SAMPLES,
  TRIM,
  dominantColor,
  luma,
  medianHex,
  parseHex,
  rgbToHex,
} from '@/lib/color-reduce';

/** `n` opaque pixels of one colour. */
function solid(n: number, [r, g, b]: [number, number, number]): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i += 1) out.push(r, g, b, 255);
  return out;
}
const buf = (...runs: number[][]) => new Uint8ClampedArray(runs.flat());

const SAGE: [number, number, number] = [140, 160, 130];

/** Seeded PRNG — the same one `tests/clearance-field.test.ts` uses, for the same
 *  reason: a sweep that reports a number has to report the same one twice. */
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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
    // **This test was labelled "pinned so the fallback branch is not dead code"
    // and was not pinning it.** Both of its buffers were UNIFORM sage, whose
    // trimmed and untrimmed medians are equal by construction, so deleting the
    // fallback (`kept = idx.slice(cut, n - cut)`) left 19/19 green. Same defect
    // as a fixture that cannot express the thing it names — in the file whose
    // comments invoke mutation survival as the standard.
    //
    // Eight pixels with distinct lumas, arranged so the middle TWO have a
    // different per-channel median from the whole set. At trim 0.45 the cut is 3
    // from each end, which would leave 2 — under MIN_AFTER_TRIM — so the fallback
    // keeps everything and the answer is the whole set's median. Without the
    // fallback it is the two survivors' median, which is a different colour.
    const spread = buf(
      solid(1, [0, 0, 0]),
      solid(1, [30, 30, 200]),
      solid(1, [200, 30, 30]),
      solid(1, [90, 90, 90]),
      solid(1, [150, 150, 60]),
      solid(1, [30, 200, 30]),
      solid(1, [60, 200, 200]),
      solid(1, [250, 250, 250]),
    );
    expect(dominantColor(spread, { trim: 0.45 })).toBe('#5a965a');
    // The colour the two survivors alone would give, asserted so the fixture is
    // shown to be able to tell the two apart rather than assumed to.
    expect(dominantColor(buf(solid(1, [90, 90, 90]), solid(1, [150, 150, 60])), { minSamples: 2 })).toBe(
      '#96965a',
    );
    // And the ordinary case still holds: 10 samples at the default trim leaves 8,
    // which is a median worth taking.
    expect(dominantColor(buf(solid(10, SAGE)))).toBe('#8ca082');
    expect(MIN_AFTER_TRIM).toBeGreaterThanOrEqual(2);
  });

  it('the trim changes the answer for most real-shaped regions — measured here', () => {
    // The artifact for a claim `color-reduce.ts` makes. It used to cite "81.6% of
    // 200,000 buffers" from a throwaway script that no longer exists, which is the
    // thing `CLAUDE.md` forbids by name: a standing measurement nobody can
    // re-derive. This sweep re-derives it on every run and prints it, so the number
    // in the comment is checkable and a change to the reduction moves it.
    const rand = rng(20260909);
    const pick = (n: number) => Math.floor(rand() * n);
    let differ = 0;
    let worst = 0;
    const TRIALS = 3000;
    for (let t = 0; t < TRIALS; t += 1) {
      // 2–5 clustered colours, 8–128 samples: the shape a real sampled region has,
      // rather than uniform noise, which no trim could move.
      const populations = 2 + pick(4);
      const colours: Array<[number, number, number]> = [];
      for (let c = 0; c < populations; c += 1) {
        colours.push([pick(256), pick(256), pick(256)]);
      }
      const total = 8 + pick(121);
      const runs: number[][] = [];
      for (let i = 0; i < total; i += 1) {
        const base = colours[pick(populations)];
        // ±12 of cluster jitter, so a population is a cloud rather than one value.
        runs.push(solid(1, [base[0] + pick(25) - 12, base[1] + pick(25) - 12, base[2] + pick(25) - 12]));
      }
      const b = buf(...runs);
      const trimmed = dominantColor(b);
      const untrimmed = dominantColor(b, { trim: 0 });
      if (trimmed !== untrimmed) {
        differ += 1;
        const a = parseHex(trimmed!)!;
        const c = parseHex(untrimmed!)!;
        worst = Math.max(worst, ...a.map((v, i) => Math.abs(v - c[i])));
      }
    }
    const share = differ / TRIALS;
    console.log(
      `color trim · ${TRIALS} clustered buffers · differs in ${(share * 100).toFixed(1)}% · worst channel delta ${worst}`,
    );
    // A floor rather than the measured value: the point is that the step is
    // load-bearing, not that it is exactly 81.6% on this seed.
    expect(share).toBeGreaterThan(0.5);
    expect(worst).toBeGreaterThan(100);
  });

  it('refuses a mask of the wrong length instead of honouring its prefix', () => {
    // `maskForBoxes` takes the grid as a free parameter, so a caller whose grid
    // disagrees with the canvas's would otherwise get a confident colour sampled
    // through the wrong cells — the length requirement was documented and checked
    // nowhere.
    const b = buf(solid(64, SAGE));
    expect(dominantColor(b, { mask: new Uint8Array(64) })).toBe('#8ca082');
    expect(dominantColor(b, { mask: new Uint8Array(63) })).toBeNull();
    expect(dominantColor(b, { mask: new Uint8Array(65) })).toBeNull();
  });

  it('never returns a non-colour, whatever the options say', () => {
    // The declared return is `string | null`, and with the overrides its own
    // docblock invites it could return neither: `minSamples: 0` emptied the kept
    // set and the median read `undefined`, giving "#NaNNaNNaN" — which nothing on
    // the write path validates and which would have persisted into a room.
    // The empty buffer is the case that reached it: with `minSamples: 0` the
    // sample-count floor let n = 0 through, the kept set was empty, and the median
    // read `undefined`. A 64-pixel buffer cannot show it — the first version of
    // this test used one and the mutation of the clamp survived.
    expect(dominantColor(new Uint8ClampedArray(0), { minSamples: 0 })).toBeNull();
    const clear: number[] = [];
    for (let i = 0; i < 12; i += 1) clear.push(0, 0, 0, 0);
    expect(dominantColor(buf(clear), { minSamples: 0 })).toBeNull();
    const b = buf(solid(64, SAGE));
    for (const opts of [
      { minSamples: 0 },
      { minSamples: -5 },
      { trim: -0.4 },
      { trim: 0.5 },
      { trim: 0.9 },
      { minSamples: 0, trim: 0.5 },
    ]) {
      const got = dominantColor(b, opts);
      expect(got === null || parseHex(got) !== null, JSON.stringify(opts)).toBe(true);
    }
    // A negative trim used to turn `idx.slice(-k, n + k)` into a TAIL slice — the
    // highlight rejector becoming a highlight selector. Clamped at zero, it is
    // simply no trim.
    const withHighlight = buf(solid(30, SAGE), solid(20, [10, 10, 200]), solid(10, [250, 250, 250]));
    expect(dominantColor(withHighlight, { trim: -0.4 })).toBe(dominantColor(withHighlight, { trim: 0 }));
  });

  it('ignores a trailing partial pixel rather than sorting on NaN', () => {
    // A buffer whose length is not a multiple of 4 used to contribute a pixel of
    // `undefined` channels, whose luma is NaN — and a NaN comparator result is
    // treated as "equal", so the sort is inconsistent and the trim keeps a
    // different set.
    //
    // **The fixture was searched for rather than chosen.** A 64-pixel uniform
    // buffer plus two bytes gives the same answer either way, because one stray
    // sample cannot move a median of 65 identical ones — so the first version of
    // this test passed with the guard mutated away. Two populations of seven, with
    // the phantom's red between them, is a case where it changes the answer:
    // guarded the red median is 100, unguarded it is 10.
    const ragged = new Uint8ClampedArray([
      ...solid(7, [10, 250, 180]),
      ...solid(7, [100, 120, 60]),
      180,
      60,
    ]);
    expect(dominantColor(ragged)).toBe('#64fab4');
  });

  it('trims by LUMA, not by any one channel', () => {
    // What the pixel-wise ordering is FOR: the trim drops whole pixels chosen by
    // brightness, so "drop the highlights and the shadows" means the same thing in
    // every channel. Sorting by red instead would still be a trim, still drop 15%
    // from each end, and still pass every other assertion in this file — the
    // navy-curtain case above included, since there the red order and the luma
    // order happen to agree.
    //
    // Searched for, like the fixture above, and against THREE mutants rather than
    // one: sorting by red, sorting by green, and Rec.709 with the red and blue
    // weights transposed all give #fad2d2 here, where luma gives #fae6fa. Green
    // carries 0.7152 of luma, so a fixture that separates luma from red usually
    // does not separate it from green — the first version of this test caught red
    // only, and both of the others survived it.
    const fixture = buf(
      solid(40, [250, 210, 210]),
      solid(5, [80, 90, 90]),
      solid(5, [210, 0, 100]),
      solid(30, [110, 230, 250]),
    );
    expect(dominantColor(fixture)).toBe('#fae6fa');
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

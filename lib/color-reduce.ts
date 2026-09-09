// Reduce a grid of RGBA samples to one representative colour. PURE — no canvas,
// no Blob, no DOM.
//
// This is the half of `lib/color-sample.ts` that decides something, split out so it
// can be tested at all. The seam is the one `lib/photo-geometry.ts`'s
// `calibrateFromPhoto` draws for the vanishing-point maths, and it is drawn in the
// same place: at the **typed array**. A shell decodes and draws; everything
// downstream of `getImageData` takes numbers and is reachable from the node test
// environment.
//
// Worth saying why that matters here rather than treating it as tidiness.
// `sampleBoxColor` had no test — on the one path that spends the user's Gemini
// quota — because its arithmetic sat inside the same function as
// `createImageBitmap`. `lib/image-quality.ts` is the same shape and is untested
// for the same reason, thresholds and all. Nothing in `tests/` fakes
// `getImageData` or `createImageBitmap`, and `tests/helpers/setup.ts` declines to
// add any further global shims beyond the two it exists to install, so a reduction
// left inside the shell is a reduction nobody can check. (This said the file
// "explicitly declines to add global shims", which reads as if it had none.)

/** Rec.709 luma, the same weighting the sampler has always used. */
export const luma = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

export function rgbToHex(r: number, g: number, b: number): string {
  const h = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

/** Below this many usable samples there is nothing to take a median of, and a
 *  colour read off three pixels is noise wearing an answer's clothes. */
export const MIN_SAMPLES = 8;

/** Share of samples dropped from each end of the luma order. Specular highlights
 *  and cast shadows are both real pixels and neither is the colour of the thing:
 *  a window reflection in gloss paint reads white, the shadow behind a sofa reads
 *  near-black.
 *
 *  **The trim is load-bearing, and that is measured rather than assumed — because
 *  reasoning said the opposite.** The original justification was that "a mean
 *  would average them in", which is true of a mean and does not survive the switch
 *  to a median: trimming the same count off both ends of a sorted list leaves
 *  THAT list's median where it was, so the step looks inert. It is not, and the
 *  reason is the one the argument skipped — the trim orders by LUMA and the median
 *  is taken per CHANNEL, so it removes a contiguous slice of a different ordering.
 *  Over random multi-population buffers (2–5 clustered colours, 8–128 samples,
 *  the shape a real region has) the trimmed and untrimmed answers differ in the
 *  large majority of cases: **82.9% of 3,000 buffers, worst single-channel
 *  difference 215**, on the seed the test file carries.
 *
 *  **The artifact is `tests/color-reduce.test.ts`'s seeded sweep, which re-derives
 *  that pair on every run and prints it.** The figure quoted here was 81.6% over
 *  200,000 buffers, measured in a throwaway script that is gone — a standing claim
 *  nobody could reproduce, which is the thing `CLAUDE.md` forbids by name. The
 *  same file already had the better answer next door: `tests/color-tokens.test.ts`
 *  faced this and replaced its sampled claim with a live one.
 *
 *  Do not delete the trim, and do not re-derive it on paper:
 *  `tests/color-reduce.test.ts` also carries a deterministic case — a shadowed
 *  navy curtain, the darkest thing in the buffer in luma while carrying more blue
 *  than the wall it sits against — where trimming is the difference between
 *  reading the wall and reading the curtain. (It is not the highest BLUE in that
 *  buffer, which this comment used to claim: the blown highlight is, at 250. The
 *  mechanism was right and the stated fact was wrong.) */
export const TRIM = 0.15;

/** Below this many survivors the trim is skipped rather than applied, because a
 *  median of two is not a median. Independent of `MIN_SAMPLES`, which is about the
 *  buffer; this is about what the trim may leave. `Math.min` of the two is what
 *  actually gates it, so that a caller lowering `minSamples` for a test does not
 *  find the trim silently switched off. */
export const MIN_AFTER_TRIM = 4;

export type ReduceOptions = {
  /** Truthy at pixel index `i` means skip that pixel. Length must be exactly
   *  `rgba.length / 4` — a mask of any other length is REFUSED rather than
   *  honoured for its prefix, since a caller whose grid disagrees with the
   *  canvas's would otherwise get a confident colour sampled through the wrong
   *  cells. Used to exclude furniture from a wall sample; absent means take
   *  everything. */
  mask?: ArrayLike<number>;
  /** Overrides, for tests and for callers with a different noise budget. Both are
   *  clamped into a range where the reduction still has an answer: this function's
   *  declared return is `string | null`, and `minSamples: 0` or a negative `trim`
   *  used to be able to return `"#NaNNaNNaN"` — a non-colour, which nothing on the
   *  write path validates, and which would have persisted. */
  minSamples?: number;
  trim?: number;
};

/**
 * The dominant colour of an RGBA buffer as `#rrggbb`, or null when there is not
 * enough to be sure.
 *
 * Median rather than mean, per channel, after trimming both ends of the luma
 * order. Median beats mean at rejecting a stray pixel — a cushion logo, a glint —
 * and the trim removes the two failure modes that are *systematic* rather than
 * stray.
 *
 * Fully transparent pixels are skipped: a downscale that letterboxes, or a PNG
 * with a hole in it, would otherwise contribute black.
 */
export function dominantColor(rgba: ArrayLike<number>, opts: ReduceOptions = {}): string | null {
  const minSamples = Math.max(1, Math.floor(opts.minSamples ?? MIN_SAMPLES));
  // Up to just under a half from each end: at exactly a half the trim empties the
  // set, and below zero `idx.slice(-k, n + k)` turns the highlight REJECTOR into a
  // highlight SELECTOR — the option doing the opposite of its name.
  const trim = Math.min(0.49, Math.max(0, opts.trim ?? TRIM));
  const mask = opts.mask;
  const pixels = Math.floor(rgba.length / 4);
  if (mask && mask.length !== pixels) return null;

  // Parallel arrays rather than tuples: this runs over every pixel of a 24×24
  // grid per photo, and the tuple version allocated one array per pixel. `l` is
  // the luma, cached here rather than recomputed inside the sort's comparator —
  // which is what the first version did, at O(n log n) calls for an O(n) fact.
  const r: number[] = [];
  const g: number[] = [];
  const b: number[] = [];
  const l: number[] = [];

  // `i + 3 < rgba.length` rather than `i < rgba.length`: a buffer whose length is
  // not a multiple of 4 would otherwise contribute a pixel made of `undefined`
  // channels, whose luma is NaN, which makes the sort comparator inconsistent and
  // the answer arbitrary.
  for (let i = 0, p = 0; i + 3 < rgba.length; i += 4, p += 1) {
    if (mask && mask[p]) continue;
    if (rgba[i + 3] < 128) continue;
    r.push(rgba[i]);
    g.push(rgba[i + 1]);
    b.push(rgba[i + 2]);
    l.push(luma(rgba[i], rgba[i + 1], rgba[i + 2]));
  }
  const n = r.length;
  if (n < minSamples) return null;

  // Sort sample INDICES by luma rather than sorting the channels, so the TRIM
  // drops whole pixels: cutting the brightest 15% of reds and, separately, the
  // brightest 15% of greens would discard a different set per channel and the
  // trim would no longer mean "drop the highlights".
  //
  // The median below is still taken per channel over the survivors, so the answer
  // can be a colour that no single sampled pixel had. That is deliberate and is
  // what the sampler has always done — a per-channel median is the robust
  // estimator here — but it is worth stating, because "median colour" reads as if
  // it names one of the pixels.
  const idx = l.map((_, k) => k);
  idx.sort((a, c) => l[a] - l[c]);

  const cut = Math.floor(n * trim);
  // Keep the whole set when trimming would leave too little to be a median — see
  // `MIN_AFTER_TRIM`. (The comment here used to say this rule "reads from
  // `minSamples` rather than from a second literal", of a line that read
  // `Math.min(4, minSamples)`. Both halves were false: the rule is 4, not 8, and
  // the 4 was the second literal.)
  const kept = n - 2 * cut >= Math.min(MIN_AFTER_TRIM, minSamples) ? idx.slice(cut, n - cut) : idx;

  const medianOf = (ch: number[]) => {
    const vals = kept.map((k) => ch[k]).sort((a, c) => a - c);
    return vals[Math.floor(vals.length / 2)];
  };
  return rgbToHex(medianOf(r), medianOf(g), medianOf(b));
}

/** Parse `#rrggbb` into channels, or null. Deliberately strict: this reads values
 *  this module produced, and a lenient parser here would let a malformed colour
 *  reach the store where nothing validates one. */
export function parseHex(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) return null;
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

/**
 * The representative of several already-reduced colours, per channel.
 *
 * Used when a room's shape cannot say which wall each photo shows, so the four
 * walls get one colour between them. NOT `dominantColor` over a buffer built from
 * these: that would apply the highlight/shadow trim to four samples, and with
 * `MIN_SAMPLES` at 8 it would refuse outright. Different question, different
 * function — the trim is about pixels within one surface, and these are already
 * one answer each.
 *
 * An even count takes the upper of the two middles, matching `dominantColor`'s
 * `Math.floor(length / 2)` so the two never disagree about what a median is.
 */
export function medianHex(hexes: readonly string[]): string | null {
  const parsed = hexes.map(parseHex).filter((c): c is [number, number, number] => c !== null);
  if (parsed.length === 0) return null;
  const at = (ch: 0 | 1 | 2) => {
    const vals = parsed.map((c) => c[ch]).sort((a, b) => a - b);
    return vals[Math.floor(vals.length / 2)];
  };
  return rgbToHex(at(0), at(1), at(2));
}

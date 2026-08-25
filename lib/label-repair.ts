// Read clampDims backwards.
//
// Forward, everywhere else in the app: the detector says "bed", so clamp the size
// into a bed's range. The size is the suspect and the word is trusted.
//
// Backwards, here: the camera measured 1400 × 2300, and no bed is that shape, so
// the WORD is the suspect. Nothing about this is new machinery — the ranges in
// lib/dimension-ranges.ts and the anchors in lib/physics.ts already know
// everything needed. They have just never been asked this question.
//
// Two properties make it worth asking. On the on-device path the measurement is
// entirely untouched by AI: lib/local-detect.ts emits a label, a box and nothing
// else, so W and H are pure pinhole geometry judging a vocabulary the geometry did
// not supply. And the window exists — geoRefine writes measured dims into page
// state while the user reviews them, and clampDims does not run until the scene is
// built, so the evidence is still intact. **Clamping is what destroys it.** This
// runs after the measurement and before the clamp, or not at all.
//
// **Nothing here rewrites anything.** It reports, in the same spirit as
// lib/fit-check.ts and for the same reason: a silent re-label is the mistake
// CLAUDE.md rule 2 forbids one field over from where it forbids a silent resize.
// The caller shows the verdict and the user accepts it.

import { dimRangeFor } from './dimension-ranges';
import { geoRefine, type CalMap, type RoomDims } from './detect-refine';
import { anchorFor } from './physics';
import { CATEGORIES, type Category, type Shape } from './scene-spec';
import type { Detection } from './detection';

/** The axis names this module reasons about. Never depth — see `sizeFitsLabel`. */
export type SizeAxis = 'width' | 'height';

export type LabelCandidate = {
  category: Category;
  /** The detection as accepting this word would leave it: re-categorised AND
   *  re-measured. The category picks the anchor and the anchor picked the
   *  projection, so a repaired word that keeps the old measurement is measuring a
   *  curtain as though it stood on the floor. */
  detection: Detection;
  /** How comfortably the re-measurement sits inside this word's band — the
   *  tightest of the two axes, as a fraction of the band's own span, 0…0.5.
   *  Ordering only. It is not a probability and there is no prior behind it. */
  margin: number;
};

export type LabelVerdict =
  /** The measurement sits inside the band for the word the detector used. */
  | { status: 'ok' }
  /** Nothing was measured, so there is no evidence and no verdict. A slot with no
   *  calibration, or a ceiling anchor, which geoRefine does not measure at all. */
  | { status: 'unmeasured' }
  /** The measurement is outside the band for the word the detector used. */
  | {
      status: 'suspect';
      /** Which axes are out, for saying why without writing the sentence here. */
      failed: SizeAxis[];
      /** What the detector's own word allows, mm, as [min, max] per axis. */
      allowed: { width: [number, number]; height: [number, number] };
      /** What the camera measured, mm. `height` is ABSENT when the anchor could
       *  not observe it — a ceiling placement measures width only. A caller that
       *  prints a fallback there is printing a catalogue default as a
       *  measurement. */
      measured: { width: number; height?: number };
      /** Better words, most comfortable fit first, each already re-measured under
       *  its own anchor. **Empty is a real answer** — it means nothing in the
       *  vocabulary is that shape, so the finding is a flag with no repair. */
      candidates: LabelCandidate[];
    };

/** Does a measured W × H sit inside the band for this word?
 *
 *  **W and H only, never D.** Depth is not observable from one photo, so the D
 *  value is a derived default (`defaultDepthFor`) rather than a measurement.
 *  Testing it would compare an invented number against the range it was invented
 *  from — always in range after Phase 2, and before it, a false alarm on every
 *  thin wall piece the on-device detector found. This is also why
 *  `dimsWithinRange` is not used here despite being the obvious candidate: it
 *  tests all three axes. */
export function sizeFitsLabel(category: Category, shape: Shape, widthMM: number, heightMM: number): boolean {
  return failedAxes(category, shape, widthMM, heightMM).length === 0;
}

function failedAxes(category: Category, shape: Shape, widthMM: number, heightMM: number): SizeAxis[] {
  const r = dimRangeFor(category, shape);
  const out: SizeAxis[] = [];
  if (widthMM < r.min[0] || widthMM > r.max[0]) out.push('width');
  if (heightMM < r.min[2] || heightMM > r.max[2]) out.push('height');
  return out;
}

/** Which axes a measurement under this word's own anchor actually observed.
 *
 *  A ceiling placement sees WIDTH only: the bbox's vertical extent for something
 *  photographed from below is a foreshortened diameter, not a height (see
 *  `placeCeilingObject`), so the H that comes back is a catalogue default or the
 *  AI's own hint. Judging a word against either is judging the model's number
 *  against the model's word — they agree by construction, which is the whole
 *  reason this module exists. */
function measuredAxes(category: Category, shape: Shape): readonly SizeAxis[] {
  return anchorFor(category, shape) === 'ceiling' ? ['width'] : ['width', 'height'];
}

/** How far inside a band a value sits, as a fraction of the band's span. 0 is on a
 *  bound, 0.5 is dead centre, negative is outside. */
function axisMargin(v: number, lo: number, hi: number): number {
  const span = hi - lo;
  if (!(span > 0)) return 0;
  return Math.min(v - lo, hi - v) / span;
}

function sizeMargin(
  category: Category,
  shape: Shape,
  widthMM: number,
  heightMM: number,
  axes: readonly SizeAxis[] = ['width', 'height'],
): number {
  const r = dimRangeFor(category, shape);
  const w = axes.includes('width') ? axisMargin(widthMM, r.min[0], r.max[0]) : Infinity;
  const h = axes.includes('height') ? axisMargin(heightMM, r.min[2], r.max[2]) : Infinity;
  return Math.min(w, h);
}

/** Which categories could be this size, most comfortable fit first.
 *
 *  Judged on the CATEGORY band (`dimRangeFor(c, 'box')`, which resolves to the
 *  per-category entry) rather than on any one shape's, because a candidate has no
 *  shape yet — asking "could this be a bed" against `bed-single`'s narrower band
 *  would reject every double bed. The detector's own word is judged with its shape
 *  included, because that is what it actually said.
 *
 *  `'other'` is never a candidate. Its band is nearly the whole space, so it fits
 *  everything and tells the user nothing. */
export function categoriesFittingSize(widthMM: number, heightMM: number, exclude?: Category): Category[] {
  return CATEGORIES.filter((c) => c !== 'other' && c !== exclude && sizeFitsLabel(c, 'box', widthMM, heightMM)).sort(
    (a, b) => sizeMargin(b, 'box', widthMM, heightMM) - sizeMargin(a, 'box', widthMM, heightMM),
  );
}

/** Judge the word a detector used against the size the camera measured.
 *
 *  Safe to call on a detection that has already been through `geoRefine`: the
 *  measurement is derived from `box`, which nothing here changes, so re-running it
 *  reproduces the same numbers. That re-run is also how measurability is
 *  established — `geoRefine` returns its input unchanged when it cannot measure,
 *  so identity is the signal and no flag has to be threaded through page state or
 *  persisted alongside the detection.
 *
 *  Judging the AI's OWN dims against the AI's own word would prove nothing: one
 *  model produced both, so they agree by construction. Hence `unmeasured` rather
 *  than a guess. */
export function judgeLabel(d: Detection, cals: CalMap, room: RoomDims): LabelVerdict {
  const category = (d.category ?? 'other') as Category;
  const shape = (d.shape ?? 'box') as Shape;

  const measured = geoRefine(d, cals, room);
  if (measured === d || !measured.dimMM) return { status: 'unmeasured' };
  const widthMM = measured.dimMM[0];
  const heightMM = measured.dimMM[2];

  // Only the axes this anchor could see may accuse the word. For a ceiling item
  // that is width alone — enough for both ceiling rows of the benchmark (a hook
  // at 100 mm against a fan's 900 mm floor, a fan at 1200 mm against a lamp's
  // 800 mm ceiling), and honest about the rest.
  const axes = measuredAxes(category, shape);
  const failed = failedAxes(category, shape, widthMM, heightMM).filter((a) => axes.includes(a));
  if (failed.length === 0) return { status: 'ok' };

  const r = dimRangeFor(category, shape);
  const candidates: LabelCandidate[] = [];
  for (const c of categoriesFittingSize(widthMM, heightMM, category)) {
    // The shape goes with the word that is being replaced, so the candidate has
    // none and scene-spec's own refineShape picks one at build time. The depth
    // hint goes too: if the AI's word is wrong, its guess at that word's depth is
    // not evidence about a different word.
    const seed: Detection = { ...d, category: c, shape: undefined, dimMM: undefined };
    const trial = geoRefine(seed, cals, room);
    // This word cannot be measured at all under its own anchor — a ceiling
    // category, today. Offering it would mean offering an unmeasured repair for a
    // measured finding.
    if (trial === seed || !trial.dimMM) continue;
    // Re-measured, so check again: changing the word can change the projection,
    // and a candidate that only fitted the old measurement is not a repair. Same
    // axis restriction as above — a ceiling candidate is checked on width, because
    // width is what measuring it as a ceiling item produced. The pre-filter above
    // has already tested BOTH axes against the original measurement, so a fan is
    // only ever shortlisted for something whose real height was fan-plausible.
    const cAxes = measuredAxes(c, 'box');
    if (failedAxes(c, 'box', trial.dimMM[0], trial.dimMM[2]).some((a) => cAxes.includes(a))) continue;
    candidates.push({
      category: c,
      detection: trial,
      margin: sizeMargin(c, 'box', trial.dimMM[0], trial.dimMM[2], cAxes),
    });
  }
  candidates.sort((a, b) => b.margin - a.margin);

  return {
    status: 'suspect',
    failed,
    allowed: { width: [r.min[0], r.max[0]], height: [r.min[2], r.max[2]] },
    measured: { width: widthMM, ...(axes.includes('height') ? { height: heightMM } : {}) },
    candidates,
  };
}

/** One verdict per detection, in the same order. The review screen holds a
 *  parallel array rather than a field on `Detection`, because a verdict is about
 *  the current measurement and nothing should persist it — a re-detect recomputes
 *  it, and a stale one would accuse the wrong row. */
export function judgeLabels(dets: Detection[], cals: CalMap, room: RoomDims | null): LabelVerdict[] {
  if (!room) return dets.map(() => ({ status: 'unmeasured' }) as LabelVerdict);
  return dets.map((d) => judgeLabel(d, cals, room));
}

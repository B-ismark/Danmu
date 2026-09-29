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
import { cutAxes } from './photo-geometry';
import { CATEGORIES, PART_LIBRARY, refineShape, sceneShapeFor, type Category, type Shape } from './scene-spec';
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
  /** What to call it, when that is not the category's plain name: the Library's name
   *  for the kind it was measured as — "Double bed" — because a chip reading "Bed?"
   *  that builds a double bed says less than it does. Absent for the category's
   *  plain kind, whose name is the category's. */
  name?: string;
  /** How comfortably the re-measurement sits inside this word's band — the
   *  tightest of the two axes, as a fraction of the band's own span, 0…0.5.
   *  Ordering only. It is not a probability and there is no prior behind it. */
  margin: number;
};

export type LabelVerdict =
  /** The measurement sits inside the band for the word the detector used. */
  | { status: 'ok'; cut?: SizeAxis[] }
  /** Nothing was measured, so there is no evidence and no verdict. A slot with no
   *  calibration, a ceiling anchor, which geoRefine does not measure at all, or a
   *  box the photo's edge cut on every axis it could have judged. */
  | { status: 'unmeasured'; cut?: SizeAxis[] }
  /** The measurement is outside the band for the word the detector used. */
  | {
      status: 'suspect';
      /** Which axes are out, for saying why without writing the sentence here. */
      failed: SizeAxis[];
      /** What the detector's own word allows, mm, as [min, max] per axis. */
      allowed: { width: [number, number]; height: [number, number] };
      /** What the camera measured, mm. An axis is ABSENT when it was not observed —
       *  a ceiling placement measures width only, and an axis the photo's edge cut
       *  off is a typical size (`cut`). A caller that prints a fallback there is
       *  printing a catalogue default as a measurement. */
      measured: { width?: number; height?: number };
      /** Better words, most comfortable fit first, each already re-measured under
       *  its own anchor. **Empty is a real answer** — it means nothing in the
       *  vocabulary is that shape, so the finding is a flag with no repair. */
      candidates: LabelCandidate[];
      cut?: SizeAxis[];
    };
// `cut`, on every status: the axes the edge of the photo cut off, whose size is the
// kind's typical one grown from the edge the photo saw (`PieceFootprint.whole`) rather
// than a measurement. Absent when the box is whole — a row that says it was measured
// has to be able to say which part of it was not.

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
 *  reason this module exists.
 *
 *  **An axis the photo's edge cut off is the same case one step removed.** The
 *  placer grows it to the kind's typical size, so it comes back inside the band of
 *  whatever word asked — the catalogue judging the catalogue. Left in, it passed
 *  every cut piece on that axis, and before the growth it failed them the other way:
 *  the visible part of a wardrobe is "too small for a wardrobe" because it is part of
 *  one. Which axes a cut takes is `cutAxes`, the placers' own test. */
function measuredAxes(category: Category, shape: Shape, box: Detection['box']): SizeAxis[] {
  if (anchorFor(category, shape) === 'ceiling') return ['width'];
  const cut = cutOf(category, shape, box);
  return (['width', 'height'] as const).filter((a) => !cut.includes(a));
}

/** The axes of `box` the photo's edge cut, on the plane this word is measured on. A
 *  ceiling piece's box is read as one row of a disc and never grown. */
function cutOf(category: Category, shape: Shape, box: Detection['box']): SizeAxis[] {
  const anchor = anchorFor(category, shape);
  if (anchor === 'ceiling') return [];
  const cut = cutAxes(box, anchor === 'floor' ? 'floor' : 'wall');
  return (['width', 'height'] as const).filter((a) => cut[a]);
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
 *  would reject every double bed, and `candidatesFor` then measures it as whichever
 *  kind of bed it fits. The detector's own word is judged with its shape included,
 *  because that is what it actually said.
 *
 *  `'other'` is never a candidate. Its band is nearly the whole space, so it fits
 *  everything and tells the user nothing. */
export function categoriesFittingSize(
  widthMM: number,
  heightMM: number,
  exclude?: Category,
  axes: readonly SizeAxis[] = ['width', 'height'],
): Category[] {
  const fits = (c: Category) => !failedAxes(c, 'box', widthMM, heightMM).some((a) => axes.includes(a));
  return CATEGORIES.filter((c) => c !== 'other' && c !== exclude && fits(c)).sort(
    (a, b) => sizeMargin(b, 'box', widthMM, heightMM, axes) - sizeMargin(a, 'box', widthMM, heightMM, axes),
  );
}

type Kinds = {
  /** The category's plain kind (`refineShape(c, '')`) — what words naming no kind build. */
  plain: Shape;
  /** The Library's names for the plain kind, lowercased: "single bed", "floor lamp". */
  plainNames: string[];
  /** The other kinds, each under the Library name that makes the room build it. */
  variants: Array<{ shape: Shape; name: string }>;
};
const KINDS = new Map<Category, Kinds>();

/** The kinds a category's pieces come in: a bed is a single or a double bed, a lamp
 *  a floor, table or pendant lamp. Read off the Library, leaving out `box` and any
 *  row whose name would build something other than its own shape. */
function kindsOf(c: Category): Kinds {
  const known = KINDS.get(c);
  if (known) return known;
  const plain = refineShape(c, '');
  const k: Kinds = { plain, plainNames: [], variants: [] };
  const seen = new Set<Shape>([plain, 'box']);
  for (const p of PART_LIBRARY) {
    if (p.category !== c || sceneShapeFor(c, p.label, undefined) !== p.shape) continue;
    if (p.shape === plain) k.plainNames.push(p.label.toLowerCase());
    else if (!seen.has(p.shape)) {
      seen.add(p.shape);
      k.variants.push({ shape: p.shape, name: p.label });
    }
  }
  KINDS.set(c, k);
  return k;
}

/** Whether `label` names a kind of `c` — one of its keywords, or the plain kind by
 *  its Library name. The plain kind has no keyword, being what no keyword builds, so
 *  without the second half "single bed" read as a bed of no particular size. */
function namesAKind(c: Category, label: string): boolean {
  const k = kindsOf(c);
  const l = label.toLowerCase();
  return sceneShapeFor(c, label, undefined) !== k.plain || k.plainNames.some((n) => l.includes(n));
}

/** The first try when it is among `ts` — the words' own kind — else the most
 *  comfortable fit. */
function preferFirst<T extends { first: boolean; margin: number }>(ts: T[]): T | undefined {
  if (ts[0]?.first) return ts[0];
  return ts.reduce<T | undefined>((a, b) => (!a || b.margin > a.margin ? b : a), undefined);
}

/** Build a repair candidate for each of `categories`: re-categorised AND
 *  re-measured, with a margin, best fit first.
 *
 *  Extracted from `judgeLabel` when a second consumer appeared. `judgeLabel` asks
 *  which words the SIZE could be; `lib/label-suggest.ts` asks which words the user
 *  just TYPED could be. Both need the same three steps — seed, re-measure, score —
 *  and two copies of those is the drift `lib/layout-rules.ts` exists to prevent.
 *
 *  `requireFit` is the whole difference between the two callers, and it is a
 *  judgement rather than a detail. A size-driven candidate that does not fit its own
 *  band after re-measurement is not a repair, so `judgeLabel` drops it. A word the
 *  user typed is different: they said "fridge", and answering with silence is what
 *  leaves a bed on screen called Fridge. So the word-driven caller keeps it and lets
 *  the negative margin say so — `axisMargin` is already signed, which is why this
 *  needs no second field and no second sort.
 *
 *  What is NEVER optional is the re-measurement. The category picks the anchor and
 *  the anchor picked the projection, so a candidate that kept the old measurement
 *  would be measuring a curtain as though it stood on the floor. A word that cannot
 *  be measured under its own anchor is still dropped for both callers, because
 *  offering it would mean offering a repair with no evidence behind it either way. */
export function candidatesFor(
  d: Detection,
  categories: Category[],
  cals: CalMap,
  room: RoomDims,
  { requireFit = true }: { requireFit?: boolean } = {},
): LabelCandidate[] {
  const out: LabelCandidate[] = [];
  for (const c of categories) {
    // The detector's shape hint goes with the category being replaced, and so does
    // its depth hint: if the old word is wrong, its guess at that word's shape and
    // depth is not evidence about a different word. The candidate still needs A
    // shape, and it carries the one it is MEASURED as — the new category read
    // through the room's own rule, with the words the row already has, so a
    // "ceiling fan" offered as a lamp is measured as the pendant those words make
    // it. Leaving the field blank was the defect: the scan screen relabels an
    // accepted repair ("Lamp"), and the room resolves a blank shape from THAT word,
    // so the piece was measured on the ceiling and built as a floor lamp. Every
    // label the screen applies is its category's plain name or a variant's `name`,
    // neither of which outvotes the shape it came with (`sceneShapeFor`), so carrying
    // it here is what makes the two agree.
    const worded = sceneShapeFor(c, d.label, undefined);
    // Words that name no kind get the category's plain one, and that is the NARROWEST
    // of several more often than not: a single bed. Judged as that alone, a 1.5 m
    // "sofa" was never offered as a bed, and before the shape was carried at all it
    // was offered and then built as a single bed squeezed to 1.2 m. So when the words
    // say nothing, the other kinds are measured too, and the plain one stands unless
    // it misfits where another fits. Words that DO name a kind are the user's or the
    // detector's, and are not second-guessed here.
    const kinds = kindsOf(c);
    const own = { shape: worded, ...(worded === kinds.plain ? {} : { name: kinds.variants.find((v) => v.shape === worded)?.name }) };
    const tries = namesAKind(c, d.label) ? [own] : [own, ...kinds.variants];
    const trials: Array<LabelCandidate & { fits: boolean; first: boolean }> = [];
    for (const [n, t] of tries.entries()) {
      const seed: Detection = { ...d, category: c, shape: t.shape, dimMM: undefined };
      const trial = geoRefine(seed, cals, room);
      // This kind cannot be measured at all under its own anchor — a ceiling kind
      // with no ceiling in frame. Offering it would mean offering an unmeasured repair.
      if (trial === seed || !trial.dimMM) continue;
      // Re-measured, so check again: changing the word can change the projection, and
      // a candidate that only fitted the old measurement is not a repair. The axis
      // restriction matters — a ceiling candidate is checked on width, because width
      // is what measuring it as a ceiling item produced.
      // Judged as the shape it was measured as, for the reason `judgeLabel` is.
      const cAxes = measuredAxes(c, t.shape, d.box);
      const fits = !failedAxes(c, t.shape, trial.dimMM[0], trial.dimMM[2]).some((a) => cAxes.includes(a));
      trials.push({
        category: c,
        detection: trial,
        ...('name' in t && t.name ? { name: t.name } : {}),
        margin: sizeMargin(c, t.shape, trial.dimMM[0], trial.dimMM[2], cAxes),
        fits,
        first: n === 0,
      });
    }
    const fitting = trials.filter((t) => t.fits);
    const pick = fitting.length > 0 ? preferFirst(fitting) : requireFit ? undefined : preferFirst(trials);
    if (!pick) continue;
    const { fits: _fits, first: _first, ...cand } = pick;
    out.push(cand);
  }
  // Signed margin, so a candidate that does not fit its own band sorts below every
  // one that does, without needing to be flagged.
  out.sort((a, b) => b.margin - a.margin);
  return out;
}

/** The row accepting `cand` leaves in place of `row`, called `label`: the candidate's
 *  category, model and measurement, with the row's own colour.
 *
 *  Not simply `cand.detection`. A candidate is measured from the row as it was when
 *  the verdicts were worked out, and the scan screen works them out from a copy that
 *  deliberately ignores colour, so the photo's sampled colour landing does not
 *  re-run the checks. So a candidate can predate the colour, and accepting it wrote
 *  a colourless row over a coloured one — the piece went grey until the next sample
 *  painted it back. Colour is the one thing a candidate knows nothing new about: it
 *  is read off the photograph, not the word. */
export function acceptCandidate(row: Detection, cand: LabelCandidate, label: string): Detection {
  // The row's colour or none, never the candidate's: the candidate's is the same
  // row's from earlier, so the row's own is always the newer answer.
  const { color: _stale, ...measured } = cand.detection;
  return { ...measured, label, ...(row.color === undefined ? {} : { color: row.color }) };
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
  // The same shape `geoRefine` measures it as, so the range it is judged by is the
  // range of the thing that was measured.
  const shape = sceneShapeFor(category, d.label, d.shape);

  const measured = geoRefine(d, cals, room);
  if (measured === d || !measured.dimMM) return { status: 'unmeasured' };
  const widthMM = measured.dimMM[0];
  const heightMM = measured.dimMM[2];

  // Only the axes this anchor could see, and the photo did not cut, may accuse the
  // word. For a ceiling item that is width alone — enough for both ceiling rows of
  // the benchmark (a hook at 100 mm against a fan's 900 mm floor, a fan at 1200 mm
  // against a lamp's 800 mm ceiling), and honest about the rest.
  const axes = measuredAxes(category, shape, d.box);
  const cut = cutOf(category, shape, d.box);
  const cutNote = cut.length > 0 ? { cut } : {};
  if (axes.length === 0) return { status: 'unmeasured', ...cutNote };
  const failed = failedAxes(category, shape, widthMM, heightMM).filter((a) => axes.includes(a));
  if (failed.length === 0) return { status: 'ok', ...cutNote };

  const r = dimRangeFor(category, shape);
  const candidates = candidatesFor(d, categoriesFittingSize(widthMM, heightMM, category, axes), cals, room);

  return {
    status: 'suspect',
    failed,
    allowed: { width: [r.min[0], r.max[0]], height: [r.min[2], r.max[2]] },
    measured: {
      ...(axes.includes('width') ? { width: widthMM } : {}),
      ...(axes.includes('height') ? { height: heightMM } : {}),
    },
    candidates,
    ...cutNote,
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

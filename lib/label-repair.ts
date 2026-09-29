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
import { geoMeasure, measuredPlane, type CalMap, type RoomDims } from './detect-refine';
import { AS_READ, cutAxes, type ReadBound, type ReadBounds } from './photo-geometry';
import { CATEGORIES, PART_LIBRARY, refineShape, sceneShapeFor, type Category, type Shape } from './scene-spec';
import type { Detection } from './detection';
import { formatDim } from './units';
import type { DimUnit } from './store';

/** The axis names this module reasons about. Never depth — see `sizeFitsLabel`. */
export type SizeAxis = 'width' | 'height';

/** Where the truth can be, given reading `v` under bound `b`. */
function truthSpan(v: number, b: ReadBound): [number, number] {
  if (b.kind === 'upper') return [Math.min(b.floorMM, v), v];
  if (b.kind === 'lower') return [v, Math.max(b.ceilMM, v)];
  return [v, v];
}

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
   *  Ordering only. It is not a probability and there is no prior behind it.
   *  `-Infinity` when `unmeasured`: there is no margin, and it sorts last. */
  margin: number;
  /** Every axis this word is read on runs out of the photo, so the camera has no say
   *  in whether it fits — only ever offered for a word the user TYPED
   *  (`requireFit: false`). A caller says so rather than calling it a misfit. */
  unmeasured?: true;
};

export type LabelVerdict =
  /** The measurement sits inside the band for the word the detector used. */
  | { status: 'ok'; cut?: SizeAxis[]; bounded?: SizeAxis[] }
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
      /** What the camera measured, mm, as the [least, most] the piece can truly be —
       *  both ends the same number when the reading is a size, and apart on an axis
       *  in `bounded`. An axis is ABSENT when it was not observed — a ceiling
       *  placement measures width only, and an axis the photo's edge cut off is a
       *  typical size (`cut`). A caller that prints a fallback there is printing a
       *  catalogue default as a measurement, and one that prints only the reading on
       *  a bounded axis is printing a limit as a size. */
      measured: { width?: [number, number]; height?: [number, number] };
      /** Better words, most comfortable fit first, each already re-measured under
       *  its own anchor. **Empty is a real answer** — it means nothing in the
       *  vocabulary is that shape, so the finding is a flag with no repair. */
      candidates: LabelCandidate[];
      cut?: SizeAxis[];
      bounded?: SizeAxis[];
    };
// `cut`, on every status: the axes the edge of the photo cut off, and so not a
// measurement. Absent when the box is whole — a row that says it was measured has to
// be able to say which part of it was not. What the number on a cut axis IS differs by
// plane, and a reader must not treat the two alike. On a floor or wall piece it is the
// kind's typical size grown from the edge the photo saw (`PieceFootprint.whole`), so
// what was seen is a lower bound. On a CEILING piece nothing is grown: the width is
// read on a row the cut moved off the disc's centre, long or short, and bounds nothing
// either way (§ 49.11) — so "at least this big" is not a reading of it (§ 49.5).
//
// `bounded`, on `ok` and `suspect`: the axes the photo DID see whole but read as a limit
// rather than a size — a floor piece cut at its foot, read at the far end of where it
// could stand (`ReadBounds`). Never an axis in `cut`. Absent when every axis read is a
// size. A row that shows no note for it is telling the person a limit is a measurement,
// which is what the scan screen did for as long as only `cut` reached it.

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

function failedAxes(
  category: Category,
  shape: Shape,
  widthMM: number,
  heightMM: number,
  bound: ReadBounds = AS_READ,
): SizeAxis[] {
  const r = dimRangeFor(category, shape);
  const out: SizeAxis[] = [];
  if (outside(widthMM, r.min[0], r.max[0], bound.width)) out.push('width');
  if (outside(heightMM, r.min[2], r.max[2], bound.height)) out.push('height');
  return out;
}

/** Is `v` evidence that the piece is outside [lo, hi]? Only when nowhere the piece could
 *  truly be is inside it: a reading that is the most a piece can be shows it too small
 *  and, on its own, never too big (§ 49.10). */
function outside(v: number, lo: number, hi: number, b: ReadBound): boolean {
  const [a, z] = truthSpan(v, b);
  return z < lo || a > hi;
}

/** Which axes a measurement of this word actually observed, and which the photo's
 *  edge cut — on the plane the placer read it on (`measuredPlane`), which is not
 *  always its anchor's: a curtain whose shape resolves to the ceiling is measured on
 *  the wall, height and all.
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
 *  one. Which axes a cut takes is `cutAxes`, the placers' own test.
 *
 *  A ceiling piece is never grown, and its width is the one number it has, so ANY
 *  edge takes it: each moves the box's centre off the disc's, and `placeCeilingObject`
 *  reads its distance on that centre's row, so the width it takes there is neither the
 *  piece's nor a bound on it. A true 1200 mm fan comes back 1402 mm cut at the side,
 *  989 cut at the side 600 mm further on, and 1111 cut at the bottom
 *  (`tests/label-repair.test.ts`). Cut at the top — the usual case, a fan near a level
 *  lens — it comes back 1200, read from the three edges the photo saw (§ 49.13), and is
 *  still not judged: where no disc fits those edges the placer falls back on the
 *  centre's row, and it does not say which of the two it did. */
function readAxes(category: Category, shape: Shape, box: Detection['box']): { measured: SizeAxis[]; cut: SizeAxis[] } {
  const plane = measuredPlane(category, shape);
  const seen: readonly SizeAxis[] = plane === 'ceiling' ? ['width'] : ['width', 'height'];
  const c = cutAxes(box, plane);
  const cut = (['width', 'height'] as const).filter((a) => c[a]);
  return { measured: seen.filter((a) => !cut.includes(a)), cut };
}

/** How far inside a band a value sits, as a fraction of the band's span. 0 is on a
 *  bound, 0.5 is dead centre, negative is outside.
 *
 *  A bounded reading is scored where the truth would have to be for this word — the
 *  point nearest the reading that is both possible and in the band. A reading inside
 *  the band is that point, so it scores exactly as an exact one; one outside it that the
 *  piece could still be scores 0, on the edge, rather than the negative a misfit gets.
 *  That point is the reading clamped to the band, with no end of the possible span in
 *  it: the reading is always possible and the span is one interval around it, so when
 *  the two meet, the band's nearer end is inside the span. The first version clamped
 *  to the span's far end too, and no reading could reach it. */
function axisMargin(v: number, lo: number, hi: number, b: ReadBound = { kind: 'exact' }): number {
  const span = hi - lo;
  if (!(span > 0)) return 0;
  const t = outside(v, lo, hi, b) ? v : Math.min(Math.max(v, lo), hi);
  return Math.min(t - lo, hi - t) / span;
}

function sizeMargin(
  category: Category,
  shape: Shape,
  widthMM: number,
  heightMM: number,
  axes: readonly SizeAxis[] = ['width', 'height'],
  bound: ReadBounds = AS_READ,
): number {
  const r = dimRangeFor(category, shape);
  const w = axes.includes('width') ? axisMargin(widthMM, r.min[0], r.max[0], bound.width) : Infinity;
  const h = axes.includes('height') ? axisMargin(heightMM, r.min[2], r.max[2], bound.height) : Infinity;
  return Math.min(w, h);
}

/** How far a reading sits from a band as read, whatever its bound: the log of the
 *  factor it would have to move by, 0 inside, more negative further out — the tightest
 *  of the axes, as `sizeMargin` takes. Scale-free on purpose. Taken as a share of the
 *  band's span, like the margin, it made a WIDE band look near: a wardrobe read 2667
 *  tall sat behind a plant read 2756, 67 mm past the tallest wardrobe against 156 past
 *  the tallest plant, because a plant's band is 2.4 times as tall. */
function sizeStrain(category: Category, shape: Shape, widthMM: number, heightMM: number, axes: readonly SizeAxis[]): number {
  const r = dimRangeFor(category, shape);
  const off = (v: number, lo: number, hi: number) => -Math.abs(Math.log(v / Math.min(Math.max(v, lo), hi)));
  const w = axes.includes('width') ? off(widthMM, r.min[0], r.max[0]) : 0;
  const h = axes.includes('height') ? off(heightMM, r.min[2], r.max[2]) : 0;
  return Math.min(w, h);
}

/** Which categories could be this size, most comfortable fit first, ties to the band
 *  the reading sits nearer — `byFit`, the order `candidatesFor` gives the same words, so
 *  the two exported rankings of one question cannot disagree.
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
  bound: ReadBounds = AS_READ,
): Category[] {
  const fits = (c: Category) => !failedAxes(c, 'box', widthMM, heightMM, bound).some((a) => axes.includes(a));
  const rank = (c: Category): Ranked => ({
    margin: sizeMargin(c, 'box', widthMM, heightMM, axes, bound),
    strain: sizeStrain(c, 'box', widthMM, heightMM, axes),
  });
  return CATEGORIES.filter((c) => c !== 'other' && c !== exclude && fits(c))
    .map((c) => ({ c, ...rank(c) }))
    .sort(byFit)
    .map(({ c }) => c);
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

/** A candidate's place in the list: the more comfortable fit first, and between two
 *  the bound makes equally comfortable, the one its reading sits nearer as read.
 *
 *  The second key is what a bound costs the ordering. Every word a bounded reading
 *  could still be — outside its band on the side the truth may be — scores 0, on the
 *  band's edge, so a wardrobe read 2667 tall tied with every other tall word, and the
 *  list fell back on the catalogue's order: last of five, and the scan screen shows
 *  two. `strain` (`sizeStrain`) is not evidence against any of them, only which the
 *  reading is nearer, which is the most one photograph can say among words it cannot
 *  rule out. Measured on the foot-cut fixture in `tests/label-repair.test.ts`, the
 *  right word comes first for 56 of the 325 wrong words caught, from 37. */
type Ranked = { margin: number; strain: number };
function byFit(a: Ranked, b: Ranked): number {
  return b.margin - a.margin || b.strain - a.strain;
}

/** The first try when it is among `ts` — the words' own kind — else the most
 *  comfortable fit. */
function preferFirst<T extends Ranked & { first: boolean }>(ts: T[]): T | undefined {
  if (ts[0]?.first) return ts[0];
  return ts.reduce<T | undefined>((a, b) => (!a || byFit(b, a) < 0 ? b : a), undefined);
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
  const out: Array<LabelCandidate & { strain: number }> = [];
  // No lens, no measurement: `geoMeasure` hands every seed back and nothing is offered.
  if (!cals[d.slot]) return out;
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
    const trials: Array<LabelCandidate & { fits: boolean; first: boolean; strain: number }> = [];
    for (const [n, t] of tries.entries()) {
      const seed: Detection = { ...d, category: c, shape: t.shape, dimMM: undefined };
      // With the placer's own answer to which way that size can be wrong.
      const { row: trial, bounds: cBound } = geoMeasure(seed, cals, room);
      // This kind cannot be measured at all under its own anchor — a ceiling kind
      // with no ceiling in frame. Offering it would mean offering an unmeasured repair.
      if (trial === seed || !trial.dimMM) continue;
      // Re-measured, so check again: changing the word can change the projection, and
      // a candidate that only fitted the old measurement is not a repair. The axis
      // restriction matters — a ceiling candidate is checked on width, because width
      // is what measuring it as a ceiling item produced.
      // Judged as the shape it was measured as, for the reason `judgeLabel` is.
      const cAxes = readAxes(c, t.shape, d.box).measured;
      // Every axis this kind is read on runs out of the photo under ITS anchor — a
      // wall word's height takes the bottom cut a floor word's does not. Nothing was
      // measured, so nothing can fit: kept, it fitted vacuously and its margin was
      // Infinity, so the one repair with no evidence sorted first. Now it never fits,
      // which keeps it out of the judge's repairs; a word the user TYPED is still
      // offered, last and flagged, because the camera cannot object to it and dropping
      // it left a lamp called "ceiling fan" — a top-cut fan being the usual case,
      // since any edge takes a ceiling piece's width.
      if (cAxes.length === 0) {
        trials.push({
          category: c,
          detection: trial,
          ...('name' in t && t.name ? { name: t.name } : {}),
          margin: -Infinity,
          strain: -Infinity,
          unmeasured: true,
          fits: false,
          first: n === 0,
        });
        continue;
      }
      const fits = !failedAxes(c, t.shape, trial.dimMM[0], trial.dimMM[2], cBound).some((a) => cAxes.includes(a));
      trials.push({
        category: c,
        detection: trial,
        ...('name' in t && t.name ? { name: t.name } : {}),
        margin: sizeMargin(c, t.shape, trial.dimMM[0], trial.dimMM[2], cAxes, cBound),
        strain: sizeStrain(c, t.shape, trial.dimMM[0], trial.dimMM[2], cAxes),
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
  // one that does, without needing to be flagged; ties by `strain` (`byFit`).
  return out.sort(byFit).map(({ strain: _strain, ...cand }) => cand);
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

/** What the camera measured, as the words after "Measured": "1.20 × 0.45 m" when both
 *  are sizes, "up to about 2.56 m wide and about 1.50–2.67 m tall" once either is a
 *  limit. Ends that print the same number are one number — a span narrower than the
 *  unit shows is a size on screen. Worded per axis once either is a span: "up to 2.56 ×
 *  1.50–2.67" would leave the reader to work out what "up to" governs.
 *
 *  **"About", because the limit is only as good as the catalogue depth** it was read
 *  at (`ReadBounds`): a 2.0 m sofa shallower than a typical one, pushed against its
 *  wall, reads 1680, so a bare *up to 1.68 m* would state a ceiling the sofa is past.
 *  Here rather than in the page, because it is a displayed measurement's arithmetic,
 *  and the page is where no test can reach it. */
export function measuredPhrase(m: Extract<LabelVerdict, { status: 'suspect' }>['measured'], unit: DimUnit): string {
  const read = (span: [number, number] | undefined, word: string) =>
    span ? [{ lo: formatDim(span[0], unit), hi: formatDim(span[1], unit), zero: span[0] <= 0, word }] : [];
  const axes = [...read(m.width, 'wide'), ...read(m.height, 'tall')];
  if (axes.every((a) => a.lo === a.hi)) return `${axes.map((a) => a.hi).join(' × ')} ${unit}`;
  return axes
    .map((a) => `${a.lo === a.hi ? a.hi : a.zero ? `up to about ${a.hi}` : `about ${a.lo}–${a.hi}`} ${unit} ${a.word}`)
    .join(' and ');
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

  const { row: measured, bounds: bound } = geoMeasure(d, cals, room);
  if (measured === d || !measured.dimMM) return { status: 'unmeasured' };
  const widthMM = measured.dimMM[0];
  const heightMM = measured.dimMM[2];

  // Only the axes this anchor could see, and the photo did not cut, may accuse the
  // word. For a ceiling item that is width alone — enough for both ceiling rows of
  // the benchmark (a hook at 100 mm against a fan's 900 mm floor, a fan at 1200 mm
  // against a lamp's 800 mm ceiling), and honest about the rest.
  // And each only on the side its reading can speak for (`ReadBounds`, the placer's
  // own): a floor piece cut at its foot is read at the far end of where it could
  // stand, so its width may say "too small" and never "too big".
  const { measured: axes, cut } = readAxes(category, shape, d.box);
  const cutNote = cut.length > 0 ? { cut } : {};
  if (axes.length === 0) return { status: 'unmeasured', ...cutNote };
  const bounded = axes.filter((a) => bound[a].kind !== 'exact');
  const notes = { ...cutNote, ...(bounded.length > 0 ? { bounded } : {}) };
  const failed = failedAxes(category, shape, widthMM, heightMM, bound).filter((a) => axes.includes(a));
  if (failed.length === 0) return { status: 'ok', ...notes };

  const r = dimRangeFor(category, shape);
  const candidates = candidatesFor(d, categoriesFittingSize(widthMM, heightMM, category, axes, bound), cals, room);

  return {
    status: 'suspect',
    failed,
    allowed: { width: [r.min[0], r.max[0]], height: [r.min[2], r.max[2]] },
    measured: {
      ...(axes.includes('width') ? { width: truthSpan(widthMM, bound.width) } : {}),
      ...(axes.includes('height') ? { height: truthSpan(heightMM, bound.height) } : {}),
    },
    candidates,
    ...notes,
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

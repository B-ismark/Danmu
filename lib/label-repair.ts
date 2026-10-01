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
import { cutAxes, type ReadBounds } from './photo-geometry';
import { CATEGORIES, PART_LIBRARY, refineShape, sceneShapeFor, type Category, type Shape } from './scene-spec';
import type { Detection } from './detection';
import { formatDim, formatDimDown } from './units';
import { classSize } from './shape-search';
import type { DimUnit } from './store';

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
      /** What the camera measured, mm — the number the word was judged against. On an
       *  axis in `bounded` that is the reading at the distance the placer assumed, an
       *  estimate, and a caller says so (`measuredPhrase`). An axis is ABSENT when it
       *  was not observed — a ceiling placement measures width only, and an axis the
       *  photo's edge cut off is a typical size (`cut`) — unless it is in `atLeast`,
       *  where the number is the part the photo saw. A caller that prints a fallback
       *  where it is absent is printing a catalogue default as a measurement. */
      measured: { width?: number; height?: number };
      /** The axes in `measured` that are what the photo saw of a piece it cut, so a
       *  LOWER bound — read above this word's maximum, which is the one way a cut axis
       *  can accuse a word (§ 49.5). Always in `cut` and in `failed`, never in
       *  `bounded`: a caller prints them as "at least" (`measuredPhrase`). */
      atLeast?: SizeAxis[];
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
// what was seen is a lower bound — and it accuses a word only by being above that word's
// top (`atLeast`, § 49.5), unless the foot was cut too, which bounds what was seen both
// ways. On a CEILING piece nothing is grown: the width is
// read on a row the cut moved off the disc's centre, long or short, and bounds nothing
// either way (§ 49.11) — so "at least this big" is not a reading of it (§ 49.5).
//
// `bounded`, on `ok` and `suspect`: the axes the photo DID see whole but read at a
// distance it did not see — a floor piece cut at its foot, read as far back as it could
// stand (`ReadBounds`). Never an axis in `cut`. Absent when every axis read is a size.
// **Judged at that reading all the same**, the user's call (D8, § 49.10): its back on
// the wall is the assumption the placer makes, and taking it as evidence catches the
// wrong words a photo cut at the foot otherwise lets through, at the price of calling a
// correct piece that stands nearer the wrong size — left unticked, one tap from kept.
// A row that shows no note for it is telling the person an estimate is a measurement,
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

/** Which of a range's three axes each judged axis is. One map, because three readers
 *  index a band by axis and a second copy is how two of them come to disagree. */
const BAND = { width: 0, height: 2 } as const satisfies Record<SizeAxis, 0 | 1 | 2>;

function failedAxes(category: Category, shape: Shape, widthMM: number, heightMM: number): SizeAxis[] {
  const r = dimRangeFor(category, shape);
  const read = { width: widthMM, height: heightMM };
  return (['width', 'height'] as const).filter((a) => read[a] < r.min[BAND[a]] || read[a] > r.max[BAND[a]]);
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
function readAxes(
  category: Category,
  shape: Shape,
  box: Detection['box'],
  bounds: ReadBounds,
): { measured: SizeAxis[]; cut: SizeAxis[]; atLeast: SizeAxis[] } {
  const plane = measuredPlane(category, shape);
  const seen: readonly SizeAxis[] = plane === 'ceiling' ? ['width'] : ['width', 'height'];
  const c = cutAxes(box, plane);
  const cut = (['width', 'height'] as const).filter((a) => c[a]);
  // Which of those cut axes still say "at least this big" (§ 49.5). Not a ceiling
  // piece's, whose width the cut moves either way (above). Not on a piece the placer
  // read at a distance the photo did not show — a floor piece cut at its foot, read at
  // the far end of where it could stand: what it saw there is read large or small by
  // that distance, so it bounds nothing from below. Asked of the placer's own report
  // (`ReadBounds`), not of the box beside it, and asked of the whole piece, because the
  // distance is one number: any axis read at an assumed distance means all were. That
  // is also what keeps "at least" and "about" off one verdict.
  const assumed = bounds.width.kind !== 'exact' || bounds.height.kind !== 'exact';
  const atLeast = plane === 'ceiling' || assumed ? [] : cut;
  return { measured: seen.filter((a) => !cut.includes(a)), cut, atLeast };
}

/** The axes among `atLeast` read above this word's maximum. What the placer writes
 *  on a cut axis is the part the photo saw, grown to the kind's typical size where
 *  that is larger and there is room (`wholeAlong`), and the typical size is inside
 *  the band (`defaultAxisFor` clamps it there) — so a reading past the top can only
 *  be the seen part, and a piece is at least as big as the part of it the photo saw.
 *  The low side says nothing: short of the band is the typical size being short, or
 *  the wall's end stopping it. */
function overAxes(
  category: Category,
  shape: Shape,
  widthMM: number,
  heightMM: number,
  atLeast: readonly SizeAxis[],
): SizeAxis[] {
  const r = dimRangeFor(category, shape);
  const read = { width: widthMM, height: heightMM };
  return atLeast.filter((a) => read[a] > r.max[BAND[a]]);
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
  const read = { width: widthMM, height: heightMM };
  return Math.min(...axes.map((a) => axisMargin(read[a], r.min[BAND[a]], r.max[BAND[a]])), Infinity);
}

/** Which categories could be this size, most comfortable fit first — `byFit`, the
 *  order `candidatesFor` gives the same words, so the two exported rankings of one
 *  question cannot disagree.
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
  return CATEGORIES.filter((c) => c !== 'other' && c !== exclude && fits(c))
    .map((c) => ({ c, margin: sizeMargin(c, 'box', widthMM, heightMM, axes) }))
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
 *  row whose name would build something other than its own shape.
 *
 *  "Would build" is asked WITH the row's shape carried, because a candidate carries it
 *  (`LabelCandidate.detection.shape`) and a name that names no kind defers to a carried
 *  shape (`sceneShapeFor`). Asked without it, the Library's one "Bed" — a `bed-double`
 *  the Inspector resizes from a single to a king, since the four size rows merged —
 *  read as building the plain single, so it was left out and the bed kinds shrank to
 *  the single alone: a 1.56 m bed the photo called a sofa was never offered as a bed. */
function kindsOf(c: Category): Kinds {
  const known = KINDS.get(c);
  if (known) return known;
  const plain = refineShape(c, '');
  const k: Kinds = { plain, plainNames: [], variants: [] };
  const seen = new Set<Shape>([plain, 'box']);
  for (const p of PART_LIBRARY) {
    if (p.category !== c || sceneShapeFor(c, p.label, p.shape) !== p.shape) continue;
    if (p.shape === plain) k.plainNames.push(p.label.toLowerCase());
    else if (!seen.has(p.shape)) {
      seen.add(p.shape);
      k.variants.push({ shape: p.shape, name: p.label });
    }
  }
  KINDS.set(c, k);
  return k;
}

/** Whether `label` names a kind of `c` — one of its keywords, the plain kind by its
 *  Library name, or a size class ("single", "queen"). The plain kind has no keyword,
 *  being what no keyword builds, so without the last two "single bed" read as a bed of
 *  no particular size. The size words are the half that outlived the Library's rows:
 *  "single bed" was a row's name until the beds merged, and is a class word now. */
function namesAKind(c: Category, label: string): boolean {
  const k = kindsOf(c);
  const l = label.toLowerCase();
  return (
    sceneShapeFor(c, label, undefined) !== k.plain ||
    k.plainNames.some((n) => l.includes(n)) ||
    Object.keys(classSize(c, label)).length > 0
  );
}

/** A candidate's place in the list: the more comfortable fit first.
 *
 *  It had a second key while a bounded reading was judged on the side it could speak
 *  for: every word such a reading could still be scored 0, on its band's edge, and the
 *  tie went to the band the reading sat nearer. Judged at the reading (D8), a word that
 *  fits is inside its band, and that key was 0 for every one of them — measured on the
 *  foot-cut fixture in `tests/label-repair.test.ts`, it moved no candidate — so it is
 *  gone with the bound that needed it. */
type Ranked = { margin: number };
function byFit(a: Ranked, b: Ranked): number {
  return b.margin - a.margin;
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
  const out: LabelCandidate[] = [];
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
    const trials: Array<LabelCandidate & { fits: boolean; first: boolean }> = [];
    for (const [n, t] of tries.entries()) {
      const seed: Detection = { ...d, category: c, shape: t.shape, dimMM: undefined };
      const { row: trial, bounds } = geoMeasure(seed, cals, room);
      // This kind cannot be measured at all under its own anchor — a ceiling kind
      // with no ceiling in frame. Offering it would mean offering an unmeasured repair.
      if (trial === seed || !trial.dimMM) continue;
      // Re-measured, so check again: changing the word can change the projection, and
      // a candidate that only fitted the old measurement is not a repair. The axis
      // restriction matters — a ceiling candidate is checked on width, because width
      // is what measuring it as a ceiling item produced.
      // Judged as the shape it was measured as, for the reason `judgeLabel` is.
      const { measured: cAxes, atLeast } = readAxes(c, t.shape, d.box, bounds);
      // A cut axis under this kind's anchor that read past its top: the part the photo
      // saw is already too big for it (§ 49.5). It never fits, and it sorts by how far
      // past it is.
      const over = overAxes(c, t.shape, trial.dimMM[0], trial.dimMM[2], atLeast);
      // Every axis this kind is read on runs out of the photo under ITS anchor — a
      // wall word's height takes the bottom cut a floor word's does not. Nothing was
      // measured, so nothing can fit: kept, it fitted vacuously and its margin was
      // Infinity, so the one repair with no evidence sorted first. Now it never fits,
      // which keeps it out of the judge's repairs; a word the user TYPED is still
      // offered, last and flagged, because the camera cannot object to it and dropping
      // it left a lamp called "ceiling fan" — a top-cut fan being the usual case,
      // since any edge takes a ceiling piece's width.
      if (cAxes.length === 0 && over.length === 0) {
        trials.push({
          category: c,
          detection: trial,
          ...('name' in t && t.name ? { name: t.name } : {}),
          margin: -Infinity,
          unmeasured: true,
          fits: false,
          first: n === 0,
        });
        continue;
      }
      const fits = over.length === 0 && !failedAxes(c, t.shape, trial.dimMM[0], trial.dimMM[2]).some((a) => cAxes.includes(a));
      trials.push({
        category: c,
        detection: trial,
        ...('name' in t && t.name ? { name: t.name } : {}),
        margin: sizeMargin(c, t.shape, trial.dimMM[0], trial.dimMM[2], [...cAxes, ...over]),
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
  return out.sort(byFit);
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

/** What the camera measured, as the words after "Measured": "1.20 × 0.45 m", and
 *  "about 2.00 × 0.33 m" once either axis is `bounded` — read at a distance the photo did
 *  not show, so an estimate, and judged as one (D8). One axis names itself, "2.67 m
 *  tall", since a lone number after "Measured" could be either. Here rather than in the
 *  page, because it is a displayed measurement's arithmetic, and the page is where no
 *  test can reach it.
 *
 *  An axis in `atLeast` is the part of a cut piece the photo saw, so it says so: "at
 *  least 2.10 m wide", or "at least 1.00 × 1.78 m" when both are. Beside a size it
 *  names each axis — "1.20 m wide and at least 2.10 m tall" — because "at least"
 *  before a "×" would claim the other axis too. Never beside "about": `atLeast` and
 *  `bounded` are never on one verdict (`readAxes`). */
export function measuredPhrase(v: Extract<LabelVerdict, { status: 'suspect' }>, unit: DimUnit): string {
  const read = (['width', 'height'] as const).flatMap((a) => {
    const n = v.measured[a];
    return n === undefined ? [] : [{ a, n }];
  });
  const low = v.atLeast ?? [];
  // A lower bound rounds down, or the number printed after "at least" is more than was seen.
  const num = ({ a, n }: (typeof read)[number]) => (low.includes(a) ? formatDimDown : formatDim)(n, unit);
  const named = (r: (typeof read)[number]) => `${num(r)} ${unit} ${r.a === 'width' ? 'wide' : 'tall'}`;
  if (low.length > 0 && low.length < read.length) {
    return read.map((r) => `${low.includes(r.a) ? 'at least ' : ''}${named(r)}`).join(' and ');
  }
  const lead = low.length > 0 ? 'at least ' : v.bounded?.length ? 'about ' : '';
  if (read.length === 1) return `${lead}${named(read[0])}`;
  return `${lead}${read.map(num).join(' × ')} ${unit}`;
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
  // word both ways. For a ceiling item that is width alone — enough for both ceiling rows of
  // the benchmark (a hook at 100 mm against a fan's 900 mm floor, a fan at 1200 mm
  // against a lamp's 800 mm ceiling), and honest about the rest.
  // A floor piece cut at its foot is read at the far end of where it could stand and
  // judged there, its back on the wall taken as evidence (D8, see `bounded`).
  // A cut axis accuses on its high side alone: what the photo saw of the piece, already
  // past this word's top (§ 49.5, `overAxes`).
  const { measured: axes, cut, atLeast } = readAxes(category, shape, d.box, bound);
  const over = overAxes(category, shape, widthMM, heightMM, atLeast);
  const cutNote = cut.length > 0 ? { cut } : {};
  if (axes.length === 0 && over.length === 0) return { status: 'unmeasured', ...cutNote };
  const bounded = axes.filter((a) => bound[a].kind !== 'exact');
  const notes = { ...cutNote, ...(bounded.length > 0 ? { bounded } : {}) };
  const out = failedAxes(category, shape, widthMM, heightMM);
  const failed = (['width', 'height'] as const).filter((a) => (axes.includes(a) && out.includes(a)) || over.includes(a));
  if (failed.length === 0) return { status: 'ok', ...notes };

  const r = dimRangeFor(category, shape);
  const read = [...axes, ...over];
  // The words to try are asked on the both-ways axes alone. A lower bound read under
  // THIS word's anchor is no bound on another word's piece — a wall word reads a foot
  // the frame cut at the wall's distance, a floor word nearer — so each candidate is
  // held to what it saw under its own, in `candidatesFor`. Filtering here on this
  // word's reading took the right word off the chips: a wardrobe called a TV, read on
  // the TV's wall at 2813 mm, was ruled out as a wardrobe (§ 49.5).
  const candidates = candidatesFor(d, categoriesFittingSize(widthMM, heightMM, category, axes), cals, room);

  return {
    status: 'suspect',
    failed,
    allowed: { width: [r.min[0], r.max[0]], height: [r.min[2], r.max[2]] },
    measured: {
      ...(read.includes('width') ? { width: widthMM } : {}),
      ...(read.includes('height') ? { height: heightMM } : {}),
    },
    ...(over.length > 0 ? { atLeast: over } : {}),
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

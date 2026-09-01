// Local shape matching — text → catalog item, no AI. Replaces the old
// flash-lite "describe it / improve all" calls with deterministic token
// scoring over the part library + real-product presets, plus a dimension
// parser ("180cm", "1.2x0.6m", "1700mm tall") so explicit sizes in the text
// override the preset (clamped into the trustable range as always).

import { PART_LIBRARY, type LibraryItem, type Category, type Shape } from './scene-spec';
import { clampDims, type Dim3 } from './dimension-ranges';

// The one catalog. This used to be PART_LIBRARY plus a separate "Real sizes"
// sheet of manufacturer presets; everything in that sheet that was not already
// here under another name moved into PART_LIBRARY's own groups, and the sheet
// was deleted — two lists answering one question is how the answer drifts.
const ALL: LibraryItem[] = PART_LIBRARY;

// Common-language synonyms → catalog vocabulary. Keys are single tokens.
const SYNONYM: Record<string, string> = {
  couch: 'sofa',
  settee: 'sofa',
  loveseat: 'sofa',
  sectional: 'sofa',
  television: 'tv',
  telly: 'tv',
  screen: 'tv',
  refrigerator: 'fridge',
  freezer: 'fridge',
  closet: 'wardrobe',
  armoire: 'wardrobe',
  dresser: 'wardrobe',
  drawers: 'wardrobe',
  bookcase: 'bookshelf',
  shelving: 'bookshelf',
  shelves: 'bookshelf',
  carpet: 'rug',
  mat: 'rug',
  drape: 'curtain',
  drapes: 'curtain',
  artwork: 'painting',
  art: 'painting',
  picture: 'painting',
  poster: 'painting',
  recliner: 'armchair',
  workstation: 'desk',
  bedside: 'nightstand',
  pouf: 'ottoman',
  footstool: 'ottoman',
  plant: 'plant',
  monstera: 'plant',
  ficus: 'plant',
  palm: 'plant',
};

function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1)
    .map((t) => SYNONYM[t] ?? t);
}

/** The shortest query token allowed to match by containment.
 *
 *  Measured over the real query space rather than chosen: every substring of every
 *  hay token in the catalog (797 of them), asking how many admit more than ten
 *  items. At a floor of 2 that is 12 queries, at 3 it is exactly one — `ing`, the
 *  gerund tail, which reaches 14 — and at 4 it is none. Four is the smallest floor
 *  that admits no catch-all, and it is what lets `room`, `robe` and `wave` reach
 *  Bedroom, Wardrobe and Microwave. */
const CONTAINS_MIN = 4;

/** Weight for a containment match. Strictly under the prefix branch's 1.5 so a
 *  genuine prefix still outranks a tail: `stand` finds Nightstand, and still finds
 *  the `desk-standard` table first. */
const CONTAINS_SCORE = 1;

function scoreItem(qTokens: string[], item: LibraryItem): number {
  const hay = tokens(`${item.label} ${item.group} ${item.category} ${item.shape}`);
  let score = 0;
  for (const q of qTokens) {
    if (hay.includes(q)) score += 3;
    else if (hay.some((h) => h.startsWith(q) || q.startsWith(h))) score += 1.5;
    // Containment, and it is the compound's TAIL that this is really for. English
    // puts the head noun last — a nightstand is a stand, an armchair is a chair, a
    // bookshelf is a shelf — so the tail is the word naming what the thing IS, and
    // it was the one form neither of the branches above could reach. `stand` is not
    // equal to `nightstand`, neither starts with the other, so the item scored 0 and
    // `searchLibrary` filters to `s > 0`: it was not ranked low, it was absent.
    //
    // One direction only, query inside hay. The reverse (a hay token inside the
    // query) needs a floor on the HAY token instead, which is a different
    // measurement and one nothing here has taken — a 2-character `tv` would match
    // every query containing those two letters in a row.
    else if (q.length >= CONTAINS_MIN && hay.some((h) => h.includes(q))) score += CONTAINS_SCORE;
  }
  return score;
}

/** Top catalog matches for a freeform description. Empty when nothing scores. */
export function searchLibrary(query: string, limit = 5): LibraryItem[] {
  const q = tokens(query);
  if (q.length === 0) return [];
  return ALL.map((item) => ({ item, s: scoreItem(q, item) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((x) => x.item);
}

const UNIT_MM: Record<string, number> = { mm: 1, cm: 10, m: 1000 };

/** Pull explicit dimensions out of freeform text. Supports "120x60cm",
 *  "1.2m × 0.6m", "1700mm tall", "180 cm wide". Returns partial overrides. */
export function parseDims(text: string): { w?: number; d?: number; h?: number } {
  const t = text.toLowerCase();

  // W x D (x H) with one trailing unit: "120x60cm", "2.2 × 0.9 × 0.8 m"
  const multi = t.match(
    /(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)(?:\s*[x×]\s*(\d+(?:\.\d+)?))?\s*(mm|cm|m)\b/,
  );
  if (multi) {
    const u = UNIT_MM[multi[4]];
    return {
      w: Math.round(parseFloat(multi[1]) * u),
      d: Math.round(parseFloat(multi[2]) * u),
      h: multi[3] ? Math.round(parseFloat(multi[3]) * u) : undefined,
    };
  }

  // Single value + unit, axis from nearby wording.
  const single = t.match(/(\d+(?:\.\d+)?)\s*(mm|cm|m)\b/);
  if (single) {
    const v = Math.round(parseFloat(single[1]) * UNIT_MM[single[2]]);
    if (/tall|high|height/.test(t)) return { h: v };
    if (/deep|depth/.test(t)) return { d: v };
    return { w: v };
  }
  return {};
}

export type LocalMatch = {
  label: string;
  category: Category;
  shape: Shape;
  dimMM: Dim3;
};

/** Best catalog match with any explicit sizes from the text applied (then
 *  clamped). Null when the description matches nothing in the catalog. */
export function bestMatch(query: string): LocalMatch | null {
  const [item] = searchLibrary(query, 1);
  if (!item) return null;
  const o = parseDims(query);
  const dim: Dim3 = clampDims(item.category, item.shape, [
    o.w ?? item.dimMM[0],
    o.d ?? item.dimMM[1],
    o.h ?? item.dimMM[2],
  ]);
  return { label: item.label, category: item.category, shape: item.shape, dimMM: dim };
}

/** The vocabulary a size is spelled WITH, as opposed to the numbers in it.
 *
 *  Deliberately not a copy of `parseDims`' patterns. The question here is only
 *  whether the user typed any word that is about a PIECE, and answering it by
 *  re-listing the numeric forms would be a second source of truth for the harder
 *  half - the half that grows. This list is the units and the axis words, which is
 *  the smaller and far more stable surface; `parseDims` stays the only thing that
 *  reads a number. `by` is here although `parseDims` cannot read it, because
 *  "160 by 200cm" still names a size through the single-value branch. */
const SIZE_WORDS = /^(mm|cm|m|x|by|tall|high|height|deep|depth|wide|width)$/;

/** True when every WORD in the query is part of spelling a size - so the user has
 *  named a size and nothing else. */
function namesOnlySize(query: string): boolean {
  const words = query.toLowerCase().split(/[^a-z]+/).filter(Boolean);
  return words.length > 0 && words.every((w) => SIZE_WORDS.test(w));
}

/** Every catalog row a search box should show for `query`, best first.
 *
 *  Two passes, and the second is a fallback rather than a replacement.
 *
 *  `searchLibrary` is the one that folds synonyms — "couch" finds the sofas,
 *  "carpet" finds the rugs, "armoire" finds the wardrobes — and a substring match
 *  can never do that, which is why the picker's own `label.includes(q)` filter was
 *  the weaker half of a feature the app already had twice.
 *
 *  What the fallback is still FOR, now that `scoreItem` has a containment branch:
 *  the fragments too short to reach it. Scoring wants a whole token, a prefix
 *  relationship, or — at four characters and up — containment. Below four it has
 *  nothing, so "obe" scores zero while being a perfectly good substring of
 *  "Wardrobe", and ranking alone would empty the list halfway through typing a word
 *  it is about to find. The substring pass stays underneath it for those.
 *
 *  (This paragraph used to offer "ward" as the mid-word example that scores
 *  nothing. It was wrong before the containment branch existed and is worth keeping
 *  as a correction rather than a silent edit: `"wardrobe".startsWith("ward")` is the
 *  prefix branch, so "ward" has always scored 1.5. The test beside it knew that and
 *  used "obe"; the source comment did not, which is two accounts of one rule.)
 *
 *  Unlimited on purpose. `searchLibrary`'s default of 5 is right for a short
 *  suggestion list; a search box is showing you the catalog, and truncating it
 *  silently is the "no silent caps" problem — a list that stops at 5 reads as
 *  "that is all there is". */
export function rankLibrary(query: string): LibraryItem[] {
  const q = query.trim();
  if (!q) return ALL;
  const scored = searchLibrary(q, ALL.length);
  if (scored.length > 0) return scored;
  const lower = q.toLowerCase();
  const subs = ALL.filter(
    (i) => i.label.toLowerCase().includes(lower) || i.group.toLowerCase().includes(lower),
  );
  if (subs.length > 0) return subs;
  // Nothing matched - and there are two very different reasons for that.
  //
  // `160x200cm` scores nothing (no token is a word) and matches no substring, so the
  // grid went blank while the badge that shows the resolved size was armed: the one
  // state where the feature is on and there is nothing to use it on. Typing the size
  // first is invited by the very phrasing the feature is for. A bare size does not
  // NARROW the catalogue, it sizes it, so the whole catalogue is the honest answer
  // and every row shows what it would arrive at.
  //
  // A query carrying a real word that matched nothing - `zzqqxx`, or `160x200cm
  // sofaa` - is a failed search and stays empty. Showing the whole library there
  // would answer a typo with 60 rows.
  if (namesOnlySize(q) && queryNamesSize(q)) return ALL;
  return subs;
}

/** The size a picked catalog item should arrive at, given the words that found it.
 *
 *  This is what the deleted "Describe it" tab was actually worth. The tab promised
 *  to find models the library does not have, which this app cannot do — every
 *  piece is procedural and there is no mesh download path — but the dimension
 *  parser underneath it was real: type "queen bed 160x200cm" and the piece arrives
 *  at that size instead of the preset's. That belongs on the ordinary search box,
 *  where it is one field instead of a second tab claiming a second feature.
 *
 *  `clampDims` gates the result exactly as it does everywhere else. Rule 2's trust
 *  boundary does not move because the number came from a text box rather than from
 *  a model: an axis the words did not name keeps the preset, and one they did name
 *  is still only a request. */
export function sizeFromQuery(item: LibraryItem, query: string): Dim3 {
  return resolveQuerySize(item, query).dim;
}

/** One axis the words named, and what became of it. */
export type AxisRequest = {
  /** What the words asked for, in mm. */
  asked: number;
  /** What the range allows, in mm — `asked` when nothing was changed. */
  got: number;
};

/** `sizeFromQuery`, plus WHICH axes the range had to overrule.
 *
 *  Rule 2's second half is the reason this exists. `clampDims` correctly refuses a
 *  400 mm wardrobe — its narrowest single bay is 600 — but the search box used to
 *  render the clamped number as though it were the answer, so typing
 *  `wardrobe 40cm` showed `600×600×2200` and said nothing about the 400. The user
 *  reads that as the badge disagreeing with what they asked for, and they are
 *  right: a size was silently resized to fit, which is the one thing this repo
 *  says never to do.
 *
 *  It returns the pairs rather than a sentence because the sentence is the UI's to
 *  write and the numbers are not: a caller that hand-typed "600" beside a clamp it
 *  did not call is the hand-typed-measurement defect again. `overruled` is keyed by
 *  axis so a caller can mark the field rather than the whole badge.
 *
 *  Only axes the words NAMED can appear. An axis that kept its preset was never a
 *  request, so reporting it would be inventing a complaint on the user's behalf. */
export function resolveQuerySize(
  item: LibraryItem,
  query: string,
): { dim: Dim3; overruled: { w?: AxisRequest; d?: AxisRequest; h?: AxisRequest } } {
  const o = parseDims(query);
  const asked: Dim3 = [o.w ?? item.dimMM[0], o.d ?? item.dimMM[1], o.h ?? item.dimMM[2]];
  const dim = clampDims(item.category, item.shape, asked);
  const overruled: { w?: AxisRequest; d?: AxisRequest; h?: AxisRequest } = {};
  const named = [o.w, o.d, o.h] as const;
  const keys = ['w', 'd', 'h'] as const;
  for (let i = 0; i < 3; i++) {
    // `named[i] !== undefined` is the gate, not `asked[i] !== dim[i]`: an axis
    // that fell back to the preset can still be clamped (a catalog entry may sit
    // outside a range the shape narrowed later), and that is not the user being
    // overruled.
    if (named[i] !== undefined && asked[i] !== dim[i]) {
      overruled[keys[i]] = { asked: asked[i], got: dim[i] };
    }
  }
  return { dim, overruled };
}

/** The overruled axes as a sentence, or `null` when nothing was overruled.
 *
 *  Here rather than in the picker because it states NUMBERS, and a number stated
 *  beside a clamp the speaker did not call is the hand-typed-measurement defect
 *  this repo keeps finding. Every figure in it comes off the `AxisRequest` pairs.
 *
 *  Axis order is fixed w→d→h so two rows overruled on different axes read the same
 *  way round, and the axes are named in the words the Inspector uses to the user
 *  ('Width', 'Depth', 'Height') rather than as `w`/`d`/`h`. */
export function describeOverruled(o: {
  w?: AxisRequest;
  d?: AxisRequest;
  h?: AxisRequest;
}): string | null {
  const named: Array<[string, AxisRequest | undefined]> = [
    ['Width', o.w],
    ['Depth', o.d],
    ['Height', o.h],
  ];
  const parts = named
    .filter((e): e is [string, AxisRequest] => e[1] !== undefined)
    .map(([axis, r]) => `${axis.toLowerCase()} ${r.asked} mm is outside this shape's range, so it will be added at ${r.got} mm`);
  if (parts.length === 0) return null;
  return `The size you typed does not fit: ${parts.join('; ')}.`;
}
/** True when `query` named any size at all — the one thing a caller needs to know
 *  before deciding whether to SHOW a size it did not have to show. Kept beside
 *  `sizeFromQuery` rather than left to each caller to re-derive from `parseDims`,
 *  because "did the text name a size" and "what size does this item become" are
 *  two questions and only the second one is per-item. */
export function queryNamesSize(query: string): boolean {
  const o = parseDims(query);
  return o.w !== undefined || o.d !== undefined || o.h !== undefined;
}

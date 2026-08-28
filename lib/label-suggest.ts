// What to offer when the user RENAMES a detected piece.
//
// `renameDetection` on the review screen changes `d.label` and nothing else. The
// model comes from `d.category` — `buildSceneFromRoom` picks it, and only refines the
// *shape within that category* through `refineShape(cat, cleanLabel)` — so renaming a
// bed to "Fridge" leaves `category: 'bed'` and the studio opens with a bed called
// Fridge. Reported in exactly those words.
//
// A repair path already existed and could not help: `judgeLabel`'s candidate chips
// fire only when the MEASUREMENT disagrees with the detector's word
// (`verdict.status === 'suspect'`). Typing a new word is not a measurement
// disagreement, so nothing fired.
//
// So this asks the other question. `judgeLabel` asks *which words could this size
// be*; this asks *which words could the user's own words be*, and hands both through
// the same `candidatesFor` so the two cannot drift about what a candidate is.
//
// **It offers, it does not apply.** The rule is already written on the review screen —
// "a silent re-label is the same mistake as a silent resize" — and it is the same rule
// as rule 2's "when something does not fit, say so; never silently resize it". A
// rename is the user telling us what a thing IS; changing its measured size off the
// back of that without asking is the app deciding it knew better.

import { candidatesFor, type LabelCandidate } from './label-repair';
import type { CalMap, RoomDims } from './detect-refine';
import type { Detection } from './detection';
import { searchLibrary } from './shape-search';
import type { Category } from './scene-spec';

/** How many catalog rows a typed word is allowed to reach through. Deliberately
 *  larger than the number of chips a caller will show: several rows share a category
 *  ("Wardrobe" and a closet preset both land on `wardrobe`), so the distinct-category
 *  count after folding is a good deal smaller than the row count going in. */
const ROWS = 8;

/** The categories a typed word suggests, best-scored first, folded to distinct
 *  values and with the piece's current category dropped.
 *
 *  `searchLibrary` is the same token scorer the library search box uses, which is why
 *  "fridge" reaches the fridge (its `SYNONYM` table folds refrigerator and freezer)
 *  and a bare "thing" reaches nothing. Exported for its own test: the ranking and the
 *  re-measurement are separate questions and only the first one is cheap to assert. */
export function categoriesFromLabel(label: string, exclude?: Category): Category[] {
  const seen = new Set<Category>();
  const out: Category[] = [];
  for (const item of searchLibrary(label, ROWS)) {
    // 'other' is never worth offering — the same reason `categoriesFittingSize`
    // excludes it. Its band fits everything and its model is a neutral box, so
    // "use the Other model?" is an offer with nothing behind it.
    if (item.category === 'other' || item.category === exclude) continue;
    if (seen.has(item.category)) continue;
    seen.add(item.category);
    out.push(item.category);
  }
  return out;
}

/** Models worth offering for a piece the user has just renamed to `label`.
 *
 *  Empty when the words reach nothing in the catalog, or when they reach only the
 *  category the piece already has — which is the common case and the reason this
 *  returns a list rather than a boolean: renaming "sofa" to "big sofa" must offer
 *  nothing at all, or the screen nags on every keystroke that lands.
 *
 *  Ordering is by the re-measurement's own margin, so a word that also FITS what the
 *  camera measured is offered above one that does not, and one that does not is still
 *  offered — with a negative margin a caller can caveat. That asymmetry is deliberate:
 *  the user typed the word, and a screen that silently declines to act on it is the
 *  behaviour being fixed.
 *
 *  `room` may be null, in which case there is no calibration to re-measure against
 *  and there are no candidates. A suggestion whose measurement is a guess would be
 *  worse than none: accepting it writes a size. */
export function suggestFromLabel(
  d: Detection,
  label: string,
  cals: CalMap,
  room: RoomDims | null,
): LabelCandidate[] {
  if (!room) return [];
  const current = (d.category ?? 'other') as Category;
  const wanted = categoriesFromLabel(label, current);
  if (wanted.length === 0) return [];
  return candidatesFor(d, wanted, cals, room, { requireFit: false });
}

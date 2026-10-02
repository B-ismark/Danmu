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
import { sceneShapeFor, type Category, type Shape } from './scene-spec';

/** How many catalog rows a typed word is allowed to reach through. Larger than the
 *  number a caller shows, because rows sharing a model fold to one. */
const ROWS = 8;

/** Models worth offering for a piece the user is renaming to `label`, best first.
 *
 *  One entry per catalog MODEL the words reach, not per category. It was per
 *  category, with the piece's own category dropped, and that is why the list kept
 *  going quiet: a shelf renamed "Shoe rack", a bed renamed "Bunk", a lamp renamed
 *  "Pendant" all stay inside their category, so they offered nothing, and the piece
 *  kept its old model under its new name. Only the model the row already builds is
 *  left out, so renaming "sofa" to "big sofa" still offers nothing.
 *
 *  Each model is re-measured under its own anchor when the photo allows it. When it
 *  does not — no room yet, no lens for that photo, or the model's anchor is out of
 *  frame — the model is STILL offered, flagged `unmeasured`, with no size at all:
 *  accepting it builds the piece at the catalog's own size, through `clampDims`
 *  like every other piece. That is not a guess written as a measurement, and the
 *  alternative was silence, which is the behaviour being fixed.
 *
 *  Ordering is the search's, best match for the words first. */
export function suggestFromLabel(
  d: Detection,
  label: string,
  cals: CalMap,
  room: RoomDims | null,
): LabelCandidate[] {
  const current = sceneShapeFor((d.category ?? 'other') as Category, d.label, d.shape);
  const seen = new Set<Shape>([current]);
  const out: LabelCandidate[] = [];
  for (const item of searchLibrary(label, ROWS)) {
    if (seen.has(item.shape)) continue;
    seen.add(item.shape);
    // Measured as exactly this model, named as the Library names it.
    const measured = room
      ? candidatesFor({ ...d, label: item.label }, [item.category], cals, room, { requireFit: false, shape: item.shape })[0]
      : undefined;
    out.push(
      measured
        ? { ...measured, name: item.label }
        : {
            category: item.category,
            // No size: the catalog's, at build time. The position, if one was read,
            // stays — it is where the piece is, whatever it is called.
            detection: { ...d, label: item.label, category: item.category, shape: item.shape, dimMM: undefined },
            name: item.label,
            margin: -Infinity,
            unmeasured: true,
          },
    );
  }
  // In the search's own order, never re-sorted by fit: the list answers what was
  // TYPED, so "fri" puts the fridge first even where a weaker match fits the box
  // better. Fit is said beside each option instead.
  return out;
}

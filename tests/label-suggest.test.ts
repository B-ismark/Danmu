// What a rename offers, and what it must not.
//
// `renameDetection` changes `d.label` and nothing else, and the model comes off
// `d.category` — so renaming a bed to "Fridge" gave a bed called Fridge. The existing
// repair chips could not help: they fire only when the MEASUREMENT disagrees with the
// detector's word, and typing a word is not a measurement disagreement.

import { describe, expect, it } from 'vitest';
import { categoriesFromLabel, suggestFromLabel } from '@/lib/label-suggest';
import { candidatesFor } from '@/lib/label-repair';
import type { CameraCal } from '@/lib/photo-geometry';
import type { CalMap, RoomDims } from '@/lib/detect-refine';
import type { Detection } from '@/lib/detection';
import { PART_LIBRARY } from '@/lib/scene-spec';

const ROOM: RoomDims = { width: 6, depth: 4, height: 2.8 };
const CAL: CameraCal = { k: 1.2, aspect: 4 / 3 };
const CALS: CalMap = { n: CAL, e: CAL, w: CAL };
/** A floor-standing box in the lower middle of the frame — the same shape of box
 *  `label-repair`'s own fixtures use, so both files are measuring the same way. */
const FLOOR_BOX: Detection['box'] = [0.4, 0.55, 0.2, 0.3];

function det(p: Partial<Detection> & Pick<Detection, 'category' | 'slot'>): Detection {
  return { label: 'thing', conf: 0.9, box: FLOOR_BOX, ...p };
}

describe('categoriesFromLabel', () => {
  it('folds a synonym the label itself never contains', () => {
    // The whole point of going through `searchLibrary` rather than matching the word
    // against category names: no category is spelled "refrigerator".
    expect(categoriesFromLabel('refrigerator')).toContain('fridge');
    expect(categoriesFromLabel('couch')).toContain('sofa');
    expect(categoriesFromLabel('closet')).toContain('wardrobe');
  });

  it('drops the category the piece already has', () => {
    // Renaming "sofa" to "big comfy sofa" must offer nothing, or the screen nags on
    // every keystroke that happens to land on a real word.
    expect(categoriesFromLabel('big comfy sofa', 'sofa')).not.toContain('sofa');
  });

  it('never offers `other`', () => {
    // Its band fits everything and its model is a neutral box, so the offer carries no
    // information. Same reason `categoriesFittingSize` excludes it.
    //
    // "window" specifically, and the first version of this test did not use it. Words
    // like "thing" and "object" reach nothing in the catalog at all, so asserting
    // `other` is absent from an empty list proved nothing and the exclusion survived
    // being mutated away. `Window` is the one PART_LIBRARY row filed under `other`, so
    // it is the only word that can actually reach it.
    expect(categoriesFromLabel('window'), 'window is the row that reaches other').not.toContain('other');
    // The guard on the fixture: if that row is ever recategorised, this assertion goes
    // back to proving nothing and should say so rather than stay green.
    expect(
      PART_LIBRARY.some((i) => i.category === 'other'),
      'no library row is filed under `other` any more — this test no longer exercises the exclusion',
    ).toBe(true);
    // Worth knowing rather than fixing: because the exclusion is right, renaming a
    // piece to "window" offers nothing at all. The window is a SHAPE under `other`,
    // and `candidatesFor` drops the shape hint so `refineShape` can pick one from the
    // category — so offering `other` would hand back a neutral box, not a window.
    // Offering shapes as well as categories is a larger change than a rename hook.
    expect(categoriesFromLabel('window')).toEqual([]);
  });

  it('is empty for words the catalog has never heard of', () => {
    expect(categoriesFromLabel('zzqqxx')).toEqual([]);
    expect(categoriesFromLabel('')).toEqual([]);
  });

  it('returns each category once, however many rows reached it', () => {
    const out = categoriesFromLabel('table');
    expect(new Set(out).size).toBe(out.length);
  });
});

describe('suggestFromLabel', () => {
  it('offers the fridge model for a bed renamed Fridge — the reported case', () => {
    const bed = det({ category: 'bed', slot: 'n' });
    const out = suggestFromLabel(bed, 'Fridge', CALS, ROOM);
    expect(out.length, 'a renamed piece must be offered the model it was named for').toBeGreaterThan(0);
    expect(out.map((c) => c.category)).toContain('fridge');
  });

  it('re-measures rather than carrying the old size over', () => {
    // The category picks the anchor and the anchor picked the projection, so a
    // candidate that kept the old measurement is measuring the new word wrongly. The
    // candidate's `detection` is what accepting it writes, so this is the assertion
    // that stops a rename becoming a re-label with a stale size.
    const bed = det({ category: 'bed', slot: 'n' });
    const out = suggestFromLabel(bed, 'Fridge', CALS, ROOM);
    for (const c of out) {
      expect(c.detection.category, 'the candidate must carry its own category').toBe(c.category);
      expect(c.detection.dimMM, 'a candidate with no measurement must not be offered').toBeDefined();
      // The shape hint is deliberately dropped so `refineShape` picks one at build
      // time from the new category.
      expect(c.detection.shape).toBeUndefined();
    }
  });

  it('offers nothing when the words only reach the category it already is', () => {
    const sofa = det({ category: 'sofa', slot: 'n' });
    expect(suggestFromLabel(sofa, 'sofa', CALS, ROOM)).toEqual([]);
  });

  it('offers nothing for words the catalog does not know', () => {
    const bed = det({ category: 'bed', slot: 'n' });
    expect(suggestFromLabel(bed, 'zzqqxx', CALS, ROOM)).toEqual([]);
  });

  it('offers nothing with no room to measure against', () => {
    // Accepting a candidate writes a size, so a candidate whose size is a guess is
    // worse than no candidate. `null` room means no calibration ran.
    const bed = det({ category: 'bed', slot: 'n' });
    expect(suggestFromLabel(bed, 'Fridge', CALS, null)).toEqual([]);
  });

  it('offers nothing for a slot with no calibration', () => {
    // 's' is absent from CALS, so `geoRefine` returns its input and there is nothing
    // measured to offer.
    const bed = det({ category: 'bed', slot: 's' });
    expect(suggestFromLabel(bed, 'Fridge', CALS, ROOM)).toEqual([]);
  });

  it('ranks a candidate that fits the measurement above one that does not', () => {
    // The ordering is the whole of how the caveat is expressed: `axisMargin` is
    // signed, so a candidate outside its own band has a negative margin and lands
    // last. Asserted as an ordering property rather than against literal margins,
    // which are a scoring detail with no meaning on their own.
    const bed = det({ category: 'bed', slot: 'n' });
    const out = suggestFromLabel(bed, 'lamp fridge wardrobe', CALS, ROOM);
    expect(out.length).toBeGreaterThan(1);
    for (let i = 1; i < out.length; i++) {
      expect(out[i - 1].margin, `${out[i - 1].category} must not rank below ${out[i].category}`)
        .toBeGreaterThanOrEqual(out[i].margin);
    }
  });

  it('still offers a word whose measurement does not fit it', () => {
    // This is the difference from `judgeLabel`, and it is the point. The user typed
    // the word; answering with silence is what left a bed on screen called Fridge.
    // `requireFit: false` keeps it, and the negative margin is what tells the UI to
    // caveat it rather than hide it.
    // `fridge` deliberately, and it is the same word as the reported case above:
    // measured against this box a fridge does NOT fit its own band, so the strict
    // pass drops it. That is why the test above passes at all — it is the one that
    // fails if `requireFit: false` is ever turned back on — and this one says out
    // loud what that flag is doing rather than leaving it implied.
    const bed = det({ category: 'bed', slot: 'n' });
    const strict = candidatesFor(bed, ['fridge'], CALS, ROOM);
    const lenient = candidatesFor(bed, ['fridge'], CALS, ROOM, { requireFit: false });
    // If the strict pass already keeps it, this fixture proves nothing — say so
    // rather than passing vacuously.
    expect(
      strict.length === 0 && lenient.length === 1,
      `fixture no longer exercises requireFit (strict=${strict.length}, lenient=${lenient.length})`,
    ).toBe(true);
    expect(lenient[0].margin).toBeLessThan(0);
  });
});

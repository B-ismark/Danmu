// What a rename offers, and what it must not.
//
// `renameDetection` changes `d.label` and nothing else, and the model comes off
// `d.category` — so renaming a bed to "Fridge" gave a bed called Fridge. The existing
// repair chips could not help: they fire only when the MEASUREMENT disagrees with the
// detector's word, and typing a word is not a measurement disagreement.

import { describe, expect, it } from 'vitest';
import { suggestFromLabel } from '@/lib/label-suggest';
import { candidatesFor } from '@/lib/label-repair';
import { frameCuts, type CameraCal } from '@/lib/photo-geometry';
import type { CalMap, RoomDims } from '@/lib/detect-refine';
import type { Detection } from '@/lib/detection';
import { PART_LIBRARY, sceneShapeFor } from '@/lib/scene-spec';
import { footprintForLayout } from '@/lib/footprint';
import { bboxOfCeilingDiscInFrame } from './helpers/project';

const ROOM: RoomDims = { width: 6, depth: 4, height: 2.8, footprint: footprintForLayout('rect', 6, 4) };
const CAL: CameraCal = { k: 1.2, aspect: 4 / 3 };
const CALS: CalMap = { n: CAL, e: CAL, w: CAL };
/** A floor-standing box in the lower middle of the frame — the same shape of box
 *  `label-repair`'s own fixtures use, so both files are measuring the same way. */
const FLOOR_BOX: Detection['box'] = [0.4, 0.55, 0.2, 0.3];

function det(p: Partial<Detection> & Pick<Detection, 'category' | 'slot'>): Detection {
  return { label: 'thing', conf: 0.9, box: FLOOR_BOX, ...p };
}

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
      // Measured where the photo allows it; where it does not, no size at all, never
      // the old one.
      if (!c.unmeasured) expect(c.detection.dimMM).toBeDefined();
      expect(c.detection.dimMM).not.toBe(bed.dimMM);
      // The old category's shape hint is dropped, and the candidate carries the shape
      // the new category makes of the words just typed — or of the Library name it
      // was measured as, when those words name no kind — which is the one accepting
      // it builds.
      expect(c.detection.shape).toBe(sceneShapeFor(c.category, c.name ?? 'Fridge', c.detection.shape));
    }
  });

  it('measures the piece as what it was renamed to, not what it was called', () => {
    // A sofa-sized row, 1080 mm across, renamed "double bed". The row still carries
    // its old word, and the kind of bed a candidate is measured as is read from the
    // words — so measuring under "sofa" found no kind named and offered the plain
    // single bed, at a margin that called it a fit, to someone who had just typed
    // double. The typed words name the double, and the double is what is offered.
    const sofa = det({ category: 'sofa', slot: 'n', label: 'sofa', box: [0.275, 0.75, 0.45, 0.1] });
    const [bed, ...rest] = suggestFromLabel(sofa, 'double bed', CALS, ROOM);
    expect(rest).toEqual([]);
    expect(bed.category).toBe('bed');
    expect(bed.detection.shape).toBe('bed-double');
    expect(bed.name).toBe('Bed'); // the Library's one bed, which is a `bed-double`
    expect(bed.detection.dimMM?.[0]).toBe(1080);
    // It used to be caveated here, 1080 being narrower than the old double's 1350
    // floor. The Library's one bed is a `bed-double` that resizes down to a single, so
    // its band starts at 800 and a 1080 bed is a bed — drawn with one pillow, because
    // pillows follow the width (`sleepsTwo`), not the shape.
    expect(bed.margin).toBeGreaterThan(0);
  });

  it('offers nothing when the words only reach the category it already is', () => {
    const sofa = det({ category: 'sofa', slot: 'n' });
    expect(suggestFromLabel(sofa, 'sofa', CALS, ROOM)).toEqual([]);
  });

  it('offers nothing for words the catalog does not know', () => {
    const bed = det({ category: 'bed', slot: 'n' });
    expect(suggestFromLabel(bed, 'zzqqxx', CALS, ROOM)).toEqual([]);
  });

  it('still offers the model with no room to measure against, at the standard size', () => {
    // It used to offer nothing here, which is the "doesn't always suggest" report:
    // the list went quiet whenever the photo could not measure. A model with no size
    // is built at the catalog's own size through clampDims, which is not a guess.
    const bed = det({ category: 'bed', slot: 'n' });
    const [first] = suggestFromLabel(bed, 'Fridge', CALS, null);
    expect(first.category).toBe('fridge');
    expect(first.unmeasured).toBe(true);
    expect(first.detection.dimMM).toBeUndefined();
  });

  it('still offers the model for a photo with no calibration', () => {
    const bed = det({ category: 'bed', slot: 's' });
    const [first] = suggestFromLabel(bed, 'Fridge', CALS, ROOM);
    expect(first.category).toBe('fridge');
    expect(first.detection.dimMM).toBeUndefined();
  });

  it('offers another model of the SAME category', () => {
    // The screenshot case: a shelf renamed "Shoe rack". Both are `shelf`, so a
    // per-category list dropped it and the piece stayed a bookshelf.
    const shelf = det({ category: 'shelf', slot: 'n', label: 'Bookshelf' });
    const out = suggestFromLabel(shelf, 'Shoe rack', CALS, ROOM);
    expect(out[0]?.detection.shape).toBe('shoe-rack');
    expect(out[0]?.name).toBe('Shoe rack');
  });

  it('reaches every Library model by its own name', () => {
    // Swept, not sampled: choosing examples is how the per-category gap was missed.
    const bed = det({ category: 'bed', slot: 'n', label: 'Bed' });
    const own = sceneShapeFor('bed', 'Bed', undefined);
    const missed = PART_LIBRARY.filter((r) => r.shape !== own)
      .filter((r) => !suggestFromLabel(bed, r.label, CALS, ROOM).some((c) => c.detection.shape === r.shape))
      .map((r) => r.label);
    expect(missed).toEqual([]);
  });

  it('keeps the order of the words, not of the fit', () => {
    // "fri" means the fridge first, even where something else fits the box better.
    const bed = det({ category: 'bed', slot: 'n' });
    expect(suggestFromLabel(bed, 'fri', CALS, ROOM)[0]?.category).toBe('fridge');
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

  it('still offers a word the photo cut off on every axis it is read on, flagged', () => {
    // A ceiling fan near a level ultrawide runs off the top of the frame — the usual
    // case — and any edge takes a ceiling piece's width, its one axis. The detector
    // called it a lamp; the user types what it is. Before the fan's cut width stopped
    // counting as a measurement this offered the fan, as a misfit; dropping every
    // candidate with no measured axis then left a lamp called "ceiling fan".
    const deep: RoomDims = { width: 6, depth: 6, height: 2.8, footprint: footprintForLayout('rect', 6, 6) };
    const wide: CameraCal = { k: 2 * Math.tan(((106 / 2) * Math.PI) / 180), aspect: 4 / 3 };
    const box: Detection['box'] = bboxOfCeilingDiscInFrame('n', 0, -1.2, 1.2, wide, deep.height)!;
    const lamp = det({ label: 'lamp', category: 'lamp', slot: 'n', box });
    expect(frameCuts(box)).toEqual({ left: false, right: false, top: true, bottom: false });
    const out = suggestFromLabel(lamp, 'ceiling fan', { n: wide }, deep);
    expect([out[0].category, out[0].unmeasured, out[0].margin]).toEqual(['fan', true, -Infinity]);
    expect(out[0].detection.category).toBe('fan');
    // The judge's own repairs stay strict: a size the camera never saw proposes nothing.
    expect(candidatesFor(lamp, ['fan'], { n: wide }, deep)).toEqual([]);
  });

  it('ranks a word the photo cut off below one it measured', () => {
    // Same box, offered two words: the one read on the wall is measured, the ceiling
    // one is not, and "no margin" must never outrank a real one, fitting or not.
    const deep: RoomDims = { width: 6, depth: 6, height: 2.8, footprint: footprintForLayout('rect', 6, 6) };
    const wide: CameraCal = { k: 2 * Math.tan(((106 / 2) * Math.PI) / 180), aspect: 4 / 3 };
    const box: Detection['box'] = bboxOfCeilingDiscInFrame('n', 0, -1.2, 1.2, wide, deep.height)!;
    const lamp = det({ label: 'lamp', category: 'lamp', slot: 'n', box });
    const out = candidatesFor(lamp, ['fan', 'painting'], { n: wide }, deep, { requireFit: false });
    expect(out.map((c) => c.category)).toEqual(['painting', 'fan']);
    expect(out[0].unmeasured).toBeUndefined();
    expect(out[1].unmeasured).toBe(true);
  });
});

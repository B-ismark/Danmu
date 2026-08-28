import { describe, expect, it } from 'vitest';
import { PART_LIBRARY } from '@/lib/scene-spec';
import { resolveQuerySize, sizeFromQuery, describeOverruled } from '@/lib/shape-search';
import { dimRangeFor } from '@/lib/dimension-ranges';

const item = (label: string) => {
  const found = PART_LIBRARY.find((i) => i.label === label);
  if (!found) throw new Error(`no catalog entry ${label}`);
  return found;
};

/** Rule 2's second half, in the search box.
 *
 *  `clampDims` is right to refuse a 400 mm wardrobe — 600 mm is one bay, the
 *  narrowest a wardrobe gets. What was wrong is that the badge rendered the
 *  clamped 600 as though it were the answer, so `wardrobe 40cm` silently became
 *  a 600 mm wardrobe. "Say so — never silently resize it to fit."
 */
describe('resolveQuerySize', () => {
  it('still returns exactly what sizeFromQuery returns', () => {
    // The two must not drift: `sizeFromQuery` delegates, and this is the assertion
    // that keeps it delegating rather than growing a second clamp.
    for (const q of ['wardrobe 40cm', 'wardrobe 900mm', 'sofa 4m', 'bed 160x200cm', 'wardrobe']) {
      for (const label of ['Wardrobe', 'Sofa']) {
        expect(resolveQuerySize(item(label), q).dim).toEqual(sizeFromQuery(item(label), q));
      }
    }
  });

  it('reports the axis the range overruled, with both numbers', () => {
    const w = item('Wardrobe');
    const { dim, overruled } = resolveQuerySize(w, 'wardrobe 40cm');
    const min = dimRangeFor(w.category, w.shape).min[0];
    // Derived from the range, not typed: if the wardrobe's floor moves, this
    // assertion follows it instead of going stale.
    expect(dim[0]).toBe(min);
    expect(overruled.w).toEqual({ asked: 400, got: min });
    // The axes the words did NOT name are not complaints.
    expect(overruled.d).toBeUndefined();
    expect(overruled.h).toBeUndefined();
  });

  it('says nothing when the size fits', () => {
    const w = item('Wardrobe');
    const { overruled } = resolveQuerySize(w, 'wardrobe 900mm');
    expect(overruled).toEqual({});
    expect(describeOverruled(overruled)).toBeNull();
  });

  it('says nothing when the words named no size at all', () => {
    // The preset itself is never "overruled", even if a later range change would
    // clamp it — the user did not ask for it, so reporting it would invent a
    // complaint on their behalf.
    for (const label of ['Wardrobe', 'Sofa']) {
      expect(resolveQuerySize(item(label), 'wardrobe').overruled).toEqual({});
    }
  });

  /** The case no real catalog entry can express, and the one that separates
   *  "the words were overruled" from "the clamp changed something".
   *
   *  Every shipped preset sits inside its own range, so for real entries an
   *  unnamed axis is never clamped and the two readings agree — which means a
   *  test built only from the catalog CANNOT see the difference. It was written
   *  that way first and a mutation that dropped the `named[i] !== undefined`
   *  gate passed all six assertions. The gate is what stops the badge inventing
   *  a complaint about an axis the user never typed, so it needs an entry whose
   *  preset is out of range on an axis the query is silent about. */
  it('does not report an unnamed axis, even when the clamp moves it', () => {
    const w = item('Wardrobe');
    const range = dimRangeFor(w.category, w.shape);
    // Depth deliberately above its own maximum — a preset that a later range
    // narrowing left behind.
    const stale = { ...w, dimMM: [w.dimMM[0], range.max[1] + 100, w.dimMM[2]] as [number, number, number] };
    const { dim, overruled } = resolveQuerySize(stale, 'wardrobe 100cm');
    // The clamp DID move depth…
    expect(dim[1]).toBe(range.max[1]);
    expect(dim[1]).not.toBe(stale.dimMM[1]);
    // …and the user is not told they asked for something they did not ask for.
    expect(overruled.d).toBeUndefined();
    // The axis they DID name fits, so there is nothing to say at all.
    expect(overruled).toEqual({});
    expect(describeOverruled(overruled)).toBeNull();
  });

  it('names every axis it overruled, in w→d→h order', () => {
    const w = item('Wardrobe');
    // A query that misses on all three at once.
    const { overruled } = resolveQuerySize(w, 'wardrobe 10x10x10cm');
    expect(Object.keys(overruled).sort()).toEqual(['d', 'h', 'w']);
    const sentence = describeOverruled(overruled)!;
    expect(sentence).toContain('width');
    // Order is fixed so two rows read the same way round.
    expect(sentence.indexOf('width')).toBeLessThan(sentence.indexOf('depth'));
    expect(sentence.indexOf('depth')).toBeLessThan(sentence.indexOf('height'));
  });

  /** Every figure in the sentence must come off the pairs. A hand-typed number
   *  beside a clamp the speaker did not call is the defect this repo keeps
   *  finding, and the only way to catch it is to assert the numbers ARE the
   *  clamp's. */
  it('states the same numbers the clamp produced, for every catalog entry it can overrule', () => {
    let checked = 0;
    for (const entry of PART_LIBRARY) {
      // One millimetre on every axis: guaranteed below every real minimum, so
      // every entry that has a minimum at all is overruled on all three.
      const { dim, overruled } = resolveQuerySize(entry, 'x 1x1x1mm');
      const sentence = describeOverruled(overruled);
      if (!sentence) continue;
      checked++;
      for (const [i, key] of (['w', 'd', 'h'] as const).entries()) {
        const r = overruled[key];
        if (!r) continue;
        expect(r.asked).toBe(1);
        expect(r.got).toBe(dim[i]);
        // …and the number in the words is the number from the clamp.
        expect(sentence).toContain(`${r.got} mm`);
      }
    }
    // Assert the COUNT, or this loop passes over an empty catalog.
    expect(PART_LIBRARY.length).toBeGreaterThan(20);
    expect(checked).toBe(PART_LIBRARY.length);
  });
});

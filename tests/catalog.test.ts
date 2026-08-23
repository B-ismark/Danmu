import { describe, expect, it } from 'vitest';
import { PART_LIBRARY } from '@/lib/scene-spec';
import { dimsWithinRange } from '@/lib/dimension-ranges';

describe('PART_LIBRARY integrity', () => {
  it('every entry sits inside its own clampDims band', () => {
    // The picker clamps ON ADD, so an out-of-band catalog entry renders as
    // something other than what the user picked. This exact failure shipped
    // twice in the old preset sheet: dressers (960/780 mm tall) against the
    // wardrobe band's 1600 mm floor, and a queen bed outside the bed band.
    const offenders = PART_LIBRARY.filter((i) => !dimsWithinRange(i.category, i.shape, i.dimMM));
    expect(offenders.map((i) => `${i.label} · ${i.dimMM.join('×')}`)).toEqual([]);
  });

  it('labels are unique — the list is scanned, not read', () => {
    const labels = PART_LIBRARY.map((i) => i.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('no two entries offer the same shape at the same size', () => {
    // Size variants of one shape are how the picker overwhelmed people before;
    // resizing covers everything between the rungs.
    const keys = PART_LIBRARY.map((i) => `${i.shape}|${i.dimMM.join('x')}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
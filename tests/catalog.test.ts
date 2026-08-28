import { describe, expect, it } from 'vitest';
import { fanBlade, FAN_HUB_R, PART_LIBRARY } from '@/lib/scene-spec';
import { dimRangeFor, dimsWithinRange } from '@/lib/dimension-ranges';

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
describe('a ceiling fan sweeps the circle it declares', () => {
  // `FanGeo` drew its blade as `size: [r * 1.6]` at `position: [r * 0.6]`. A box of
  // length 1.6r centred at 0.6r runs from -0.2r to 1.4r, so the catalog's 1000 mm
  // fan swept 1.40 m - 40% over its own `dimMM` - and each blade also crossed
  // 100 mm out the far side of its own motor housing.
  //
  // Rule 2's corollary: `Draggable` scales by `storedDim / part.dimMM`, so a
  // renderer with its own idea of the size renders the wrong size at scale 1. And
  // the plan draws a fan straight off `dimMM` (`circle: true`), so the two tabs
  // disagreed by 40% about the same piece - visible without opening 3D at all.
  it('puts the blade tip on the radius, across the whole clamp range', () => {
    const r = dimRangeFor('fan', 'fan');
    for (let w = r.min[0]; w <= r.max[0]; w += 50) {
      const b = fanBlade(w);
      expect(b.tip, `${w} mm fan`).toBeCloseTo(w / 2000, 9);
      // Both ends: the blade must also START at the hub, not inside it and not
      // through it. A tip-only assertion passes for a blade of the right length in
      // the wrong place, which is the shape of the bug being fixed.
      expect(b.centre - b.length / 2, `${w} mm fan inner end`).toBeCloseTo(FAN_HUB_R, 9);
      expect(b.length).toBeGreaterThan(0);
    }
  });

  it('is the number the catalog entry and the plan already agree on', () => {
    expect(fanBlade(1000).tip * 2).toBeCloseTo(1.0, 9);
    // What it used to be, named rather than described.
    const old = { size: (1000 / 2000) * 1.6, at: (1000 / 2000) * 0.6 };
    expect(old.at + old.size / 2).toBeCloseTo(0.7, 9);
    // And the catalog fan really is 1000 mm, so the numbers above are its numbers.
    expect(PART_LIBRARY.find((p) => p.shape === 'fan')?.dimMM[0]).toBe(1000);
  });

  it('never returns a negative box, even below the hub', () => {
    // Unreachable through `clampDims`, whose fan range starts at 900 mm - but a
    // negative extent is a mesh three.js renders inside-out rather than refusing.
    expect(fanBlade(100).length).toBeGreaterThan(0);
    expect(fanBlade(0).length).toBeGreaterThan(0);
  });
});

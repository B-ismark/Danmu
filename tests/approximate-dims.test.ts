import { describe, expect, it } from 'vitest';
import { approximateDims, defaultDepthFor, PART_LIBRARY } from '@/lib/scene-spec';
import { clampDims } from '@/lib/dimension-ranges';

const lib = (shape: string) => PART_LIBRARY.find((r) => r.shape === shape)!.dimMM;

describe('approximateDims: a scanned piece is built at a catalogue-standard size', () => {
  it('no hint gives the Library default for the shape', () => {
    expect(approximateDims('sofa', 'sofa')).toEqual(clampDims('sofa', 'sofa', lib('sofa') as [number, number, number]));
    expect(approximateDims('curtain', 'curtain')).toEqual([1600, 80, 2200]);
    expect(approximateDims('other', 'window')).toEqual([1200, 60, 1200]);
  });

  it('a window is as thin as the Library window whatever depth the photo claims', () => {
    const [, d, h] = approximateDims('other', 'window', [1300, 190, 1100]);
    expect(d).toBe(60);
    expect(h).toBe(1200);
  });

  it('a curtain is never tiny and keeps its drop', () => {
    const [w, d, h] = approximateDims('curtain', 'curtain', [350, 40, 600]);
    expect(w).toBe(1600);
    expect(d).toBe(80);
    expect(h).toBe(2200);
    // and may widen a little
    expect(approximateDims('curtain', 'curtain', [1800, 80, 2000])[0]).toBe(1800);
    expect(approximateDims('curtain', 'curtain', [4800, 80, 2000])[0]).toBe(2000);
  });

  it('a wild sofa estimate lands at a realistic sofa', () => {
    const def = lib('sofa')[0];
    for (const w of [300, 3500, 9000]) {
      const [W, D, H] = approximateDims('sofa', 'sofa', [w, 2400, 150]);
      expect(W).toBeGreaterThanOrEqual(def * 0.75);
      expect(W).toBeLessThanOrEqual(def * 1.25);
      expect([D, H]).toEqual([lib('sofa')[1], lib('sofa')[2]]);
    }
    expect(approximateDims('sofa', 'sofa', [def * 1.1, 900, 800])[0]).toBe(Math.round(def * 1.1));
  });

  it('depth is the catalogue depth', () => {
    expect(approximateDims('sofa', 'sofa', [2000, 3000, 900])[1]).toBe(defaultDepthFor('sofa', 'sofa'));
  });

  it('a hint with an unusable width falls back to the default', () => {
    expect(approximateDims('sofa', 'sofa', [NaN, 900, 800])).toEqual(approximateDims('sofa', 'sofa'));
    expect(approximateDims('sofa', 'sofa', [0, 900, 800])).toEqual(approximateDims('sofa', 'sofa'));
  });

  it('a round piece stays round when nudged', () => {
    const [w, d] = approximateDims('fan', 'fan', [1200, 1200, 200]);
    expect(w).toBe(d);
  });

  it('an unrecognised object (generic box) has no standard, so its hint stands within range', () => {
    expect(approximateDims('other', 'box', [300, 120, 100])).toEqual([300, 120, 100]);
  });

  it('every library shape stays inside its own legal range at any hint', () => {
    for (const r of PART_LIBRARY) {
      for (const w of [1, 500, 100000]) {
        const dim = approximateDims(r.category, r.shape, [w, w, w]);
        expect(clampDims(r.category, r.shape, dim), `${r.shape} @ ${w}`).toEqual(dim);
      }
    }
  });
});

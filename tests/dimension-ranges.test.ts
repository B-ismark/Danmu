import { describe, it, expect } from 'vitest';
import { clampDims, dimRangeFor, dimsWithinRange } from '@/lib/dimension-ranges';

describe('dimRangeFor', () => {
  it('keeps electronics on a tight leash (fixed tier)', () => {
    expect(dimRangeFor('monitor', 'laptop').flex).toBe('fixed');
    expect(dimRangeFor('tv', 'tv').flex).toBe('fixed');
    expect(dimRangeFor('door', 'door').flex).toBe('fixed');
  });

  it('gives made-to-measure furniture creative room (flexible tier)', () => {
    expect(dimRangeFor('table', 'coffee-table').flex).toBe('flexible');
    expect(dimRangeFor('rug', 'rug').flex).toBe('flexible');
    expect(dimRangeFor('sofa', 'sofa').flex).toBe('flexible');
  });

  it('falls back to the category, then a wide default', () => {
    // box shape with a known category → category range.
    expect(dimRangeFor('bed', 'box').min[0]).toBeGreaterThan(1000);
    // unknown both ways → permissive fallback.
    expect(dimRangeFor('other', 'cylinder').flex).toBe('flexible');
  });
});

describe('clampDims', () => {
  it('blocks a laptop from scaling to desk width', () => {
    const d = clampDims('monitor', 'laptop', [1200, 240, 20]);
    expect(d[0]).toBeLessThanOrEqual(420);
  });

  it('lets a dining table stretch within its wide band', () => {
    const d = clampDims('desk', 'desk-standard', [2200, 1000, 760]);
    expect(d).toEqual([2200, 1000, 760]); // untouched — within range
  });

  it('collapses absurd AI estimates to credible sizes', () => {
    // "3.5m-wide fridge" → max credible fridge.
    const fridge = clampDims('fridge', 'fridge', [3500, 650, 1700]);
    expect(fridge[0]).toBeLessThanOrEqual(950);
    // "8cm sofa" → min credible sofa.
    const sofa = clampDims('sofa', 'sofa', [80, 950, 880]);
    expect(sofa[0]).toBeGreaterThanOrEqual(1200);
  });

  it('clamps each axis independently', () => {
    const d = clampDims('tv', 'tv', [10000, 1, 820]);
    expect(d[0]).toBe(2000);
    expect(d[1]).toBe(40);
    expect(d[2]).toBe(820);
  });
});

describe('dimsWithinRange', () => {
  it('agrees with clampDims', () => {
    // H is open-lid height: 220 mm is the catalog's own laptop.
    expect(dimsWithinRange('monitor', 'laptop', [340, 240, 220])).toBe(true);
    expect(dimsWithinRange('monitor', 'laptop', [1200, 240, 220])).toBe(false);
  });
});

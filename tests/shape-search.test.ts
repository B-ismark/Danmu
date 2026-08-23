import { describe, it, expect } from 'vitest';
import { searchLibrary, parseDims, bestMatch } from '@/lib/shape-search';

describe('searchLibrary', () => {
  it('finds the sofa via the synonym "couch"', () => {
    const [top] = searchLibrary('big comfy couch');
    expect(top).toBeDefined();
    expect(top.category).toBe('sofa');
  });

  it('finds the wardrobe via "closet"', () => {
    const [top] = searchLibrary('bedroom closet');
    expect(top.category).toBe('wardrobe');
  });

  it('surfaces a specific model by name', () => {
    const r = searchLibrary('french door');
    expect(r.some((i) => i.label.toLowerCase().includes('french door'))).toBe(true);
  });

  it('returns empty for gibberish', () => {
    expect(searchLibrary('zzqqxx')).toEqual([]);
  });
});

describe('parseDims', () => {
  it('parses W×D with one unit', () => {
    expect(parseDims('rug 120x60cm')).toEqual({ w: 1200, d: 600, h: undefined });
  });
  it('parses W×D×H in metres', () => {
    expect(parseDims('2.2 × 0.9 × 0.8 m sofa')).toEqual({ w: 2200, d: 900, h: 800 });
  });
  it('routes a single value to height when worded that way', () => {
    expect(parseDims('mirror 1700mm tall')).toEqual({ h: 1700 });
  });
  it('defaults a single value to width', () => {
    expect(parseDims('desk 140cm')).toEqual({ w: 1400 });
  });
  it('returns empty for no sizes', () => {
    expect(parseDims('a nice armchair')).toEqual({});
  });
});

describe('bestMatch', () => {
  it('applies explicit sizes, clamped into the trustable range', () => {
    const m = bestMatch('bookshelf 90cm');
    expect(m).not.toBeNull();
    expect(m!.shape).toBe('bookshelf');
    expect(m!.dimMM[0]).toBe(900);
  });

  it('clamps absurd sizes back into range', () => {
    const m = bestMatch('tv 9m');
    expect(m).not.toBeNull();
    expect(m!.dimMM[0]).toBeLessThanOrEqual(2000); // tv max width
  });

  it('null on no match', () => {
    expect(bestMatch('xyzzy')).toBeNull();
  });
});

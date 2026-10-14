import { describe, expect, it } from 'vitest';
import { SNAPSHOT_LONG_EDGE, snapshotPixelRatio } from '@/lib/snapshot';
import { sheetScale } from '@/lib/plan-export';

// The size of what a person saves, which used to be whatever the screen happened to
// hold. Literals on purpose: a ratio asserted against its own formula cannot fail.

describe('snapshotPixelRatio', () => {
  it('renders a laptop canvas at the export size, not the screen size', () => {
    // 1280 CSS px wide at 1x would have saved a 1280 px picture.
    expect(snapshotPixelRatio(1280, 800, 1, 16384)).toBe(2.5);
    expect(1280 * snapshotPixelRatio(1280, 800, 1, 16384)).toBe(SNAPSHOT_LONG_EDGE);
  });

  it('ignores a throttled ratio — a regressed frame is not what gets saved', () => {
    // AdaptiveDpr mid-orbit, or PerformanceMonitor pinned to 1x: same answer.
    expect(snapshotPixelRatio(1280, 800, 0.5, 16384)).toBe(2.5);
  });

  it('never lowers a screen that already beats the target', () => {
    expect(snapshotPixelRatio(2560, 1440, 2, 16384)).toBe(2);
  });

  it('measures the long edge, so a portrait phone canvas is not oversized', () => {
    expect(snapshotPixelRatio(400, 800, 3, 16384)).toBe(4);
  });

  it('stops at what the GPU can allocate', () => {
    expect(snapshotPixelRatio(1280, 800, 1, 2048)).toBe(1.6);
  });

  it('keeps the current ratio for a canvas with no size yet', () => {
    expect(snapshotPixelRatio(0, 0, 1.5, 16384)).toBe(1.5);
  });
});

describe('sheetScale', () => {
  it('draws an ordinary room at 4x', () => {
    expect(sheetScale(680, 900)).toBe(4);
  });

  it('shrinks a large sheet to what Safari will still encode, rather than failing', () => {
    // 2000 × 2400 at 4x is 76.8 MP; Safari's ceiling is 16,777,216.
    const k = sheetScale(2000, 2400);
    expect(k).toBeCloseTo(1.8698, 3);
    // The canvas is FLOORED, and that is what must fit — rounding up went over.
    expect(Math.floor(2000 * k) * Math.floor(2400 * k)).toBeLessThanOrEqual(16_777_216);
  });

  it('is floored, because rounding a side up can carry a capped sheet over', () => {
    // 1100 × 1122: both sides round UP at the area-capped scale.
    const k = sheetScale(1100, 1122);
    expect(Math.round(1100 * k) * Math.round(1122 * k)).toBeGreaterThan(16_777_216);
    expect(Math.floor(1100 * k) * Math.floor(1122 * k)).toBeLessThanOrEqual(16_777_216);
  });

  it('caps a long, thin sheet by its side', () => {
    expect(sheetScale(20000, 600)).toBe(1);
    expect(sheetScale(8192, 300)).toBe(2);
  });
});

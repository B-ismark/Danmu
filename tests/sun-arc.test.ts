import { describe, it, expect } from 'vitest';
import { LINE_BELOW, MAX_WIDTH, scrubHour, tAtX, trackFor, trackPath, trackPoint } from '@/lib/sun-arc';
import { isDaytime } from '@/lib/lighting-moods';

// The day's track over the canvas: a rainbow on a wide canvas, a flat slider on a
// narrow one, and in both the value read off x the way a slider's is.

const INSET = 23;

describe('the track', () => {
  it('is an arc on a wide canvas and a straight line on a narrow one', () => {
    expect(trackFor(900, INSET).sag).toBeGreaterThan(0);
    expect(trackFor(LINE_BELOW, INSET).sag).toBeGreaterThan(0);
    expect(trackFor(LINE_BELOW - 1, INSET).sag).toBe(0);
    // A phone's canvas.
    expect(trackFor(390 - 24, INSET).sag).toBe(0);
  });

  it('never grows past its cap, however wide the canvas', () => {
    expect(trackFor(3000, INSET).width).toBe(MAX_WIDTH);
    expect(trackFor(300, INSET).width).toBe(300);
  });

  it('keeps the handle whole at both ends: the ends sit an inset in from the box', () => {
    for (const w of [300, 520, 900]) {
      const tr = trackFor(w, INSET);
      expect(trackPoint(tr, 0)[0]).toBeCloseTo(INSET, 9);
      expect(trackPoint(tr, 1)[0]).toBeCloseTo(tr.width - INSET, 9);
    }
  });

  it('crowns in the middle and lets its two ends fall by exactly the sag', () => {
    const tr = trackFor(900, INSET);
    const [cx, cy] = trackPoint(tr, 0.5);
    expect(cx).toBeCloseTo(tr.width / 2, 9);
    expect(cy).toBeCloseTo(0, 9);
    expect(trackPoint(tr, 0)[1]).toBeCloseTo(tr.sag, 9);
    expect(trackPoint(tr, 1)[1]).toBeCloseTo(tr.sag, 9);
    // Symmetric, and never above the crown.
    for (let i = 0; i <= 20; i++) {
      const t = i / 20;
      expect(trackPoint(tr, t)[1]).toBeCloseTo(trackPoint(tr, 1 - t)[1], 9);
      expect(trackPoint(tr, t)[1]).toBeGreaterThanOrEqual(-1e-9);
    }
  });

  it('reads the value off x, and hands back the point it drew', () => {
    for (const w of [300, 900]) {
      const tr = trackFor(w, INSET);
      for (let i = 0; i <= 10; i++) {
        const t = i / 10;
        expect(tAtX(tr, trackPoint(tr, t)[0]), `${w} @ ${t}`).toBeCloseTo(t, 9);
      }
      // Past either end is that end.
      expect(tAtX(tr, -50)).toBe(0);
      expect(tAtX(tr, tr.width + 50)).toBe(1);
      // And the handle never leaves the track, whatever it is handed.
      expect(trackPoint(tr, -0.5)).toEqual(trackPoint(tr, 0));
      expect(trackPoint(tr, 1.5)).toEqual(trackPoint(tr, 1));
    }
  });

  it('draws the arc through the same points the handle rides', () => {
    // The SVG arc's radius is not something `trackPoint` hands out, so check it
    // the way the browser will read it: a circle through both ends and the crown.
    const tr = trackFor(900, INSET);
    const d = trackPath(tr);
    const m = d.match(/^M (\S+) (\S+) A (\S+) \S+ 0 0 1 (\S+) (\S+)$/);
    expect(m).not.toBeNull();
    const r = Number(m![3]);
    const cx = tr.width / 2;
    const cy = r; // centre is r below the crown (y down)
    for (const t of [0, 0.2, 0.5, 0.9, 1]) {
      const [x, y] = trackPoint(tr, t);
      expect(Math.hypot(x - cx, y - cy), `t=${t}`).toBeCloseTo(r, 6);
    }
    // And the flat one is a line.
    expect(trackPath(trackFor(300, INSET))).toMatch(/^M \S+ \S+ L \S+ \S+$/);
  });

  it('draws a piece of the arc that ends on the handle', () => {
    const tr = trackFor(900, INSET);
    const [hx, hy] = trackPoint(tr, 0.3);
    const m = trackPath(tr, 0, 0.3, 10).match(/(\S+) (\S+)$/)!;
    expect(Number(m[1])).toBeCloseTo(hx, 9);
    expect(Number(m[2])).toBeCloseTo(hy + 10, 9);
  });
});

describe('scrubbing the arc', () => {
  it('keeps a day scrub in the day and a night scrub in the night, ends included', () => {
    for (let i = 0; i <= 200; i++) {
      const t = i / 200;
      expect(isDaytime(scrubHour('day', t)), `day t=${t}`).toBe(true);
      expect(isDaytime(scrubHour('night', t)), `night t=${t}`).toBe(false);
    }
  });

  it('lands on five-minute steps', () => {
    for (const t of [0.013, 0.37, 0.5, 0.91]) {
      for (const half of ['day', 'night'] as const) {
        const m = scrubHour(half, t) * 60;
        expect(Math.abs(m - Math.round(m / 5) * 5), `${half} ${t}`).toBeLessThan(1e-6);
      }
    }
  });
});

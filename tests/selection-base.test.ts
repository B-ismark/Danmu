import { describe, it, expect } from 'vitest';
import { BASE_LIFT, BASE_THICKNESS, selectionBase } from '@/lib/selection-base';

// The translucent base under a selected piece. It is a cue about THIS piece, so it
// has to sit against the surface the piece is fixed to and show round every edge
// of it — never float, never hide behind it entirely, never swallow a neighbour.

describe('the selection base', () => {
  it('lies on the floor under a floor piece, a margin past its footprint on every side', () => {
    const sofa = selectionBase('floor', [2000, 900, 850]);
    expect(sofa.plane).toBe('floor');
    expect(sofa.at).toBe(BASE_LIFT);
    expect(sofa.size[0]).toBeCloseTo(2 + 2 * sofa.margin, 9);
    expect(sofa.size[1]).toBeCloseTo(0.9 + 2 * sofa.margin, 9);
    expect(sofa.margin).toBeGreaterThan(0);
    // A slab, not a box round it: well under the piece's own height.
    expect(sofa.thickness).toBe(BASE_THICKNESS);
    expect(sofa.at + sofa.thickness).toBeLessThan(0.85 / 10);
  });

  it('stands against the plaster behind a wall piece, sized by width and height', () => {
    const tv = selectionBase('wall-mid', [1200, 60, 700]);
    expect(tv.plane).toBe('wall');
    // Just in front of the piece's back face, never in its plane: the two coplanar
    // striped a selected TV seen from behind its cut-away wall.
    expect(tv.at).toBeCloseTo(-0.03 + BASE_LIFT, 9);
    expect(tv.at).toBeGreaterThan(-0.03);
    expect(tv.size[0]).toBeCloseTo(1.2 + 2 * tv.margin, 9);
    expect(tv.size[1]).toBeCloseTo(0.7 + 2 * tv.margin, 9);
    for (const a of ['wall-high', 'wall-low', 'wall-floor'] as const) expect(selectionBase(a, [500, 40, 500]).plane).toBe('wall');
  });

  it('stays inside a wall or ceiling piece, never through the face you look at', () => {
    for (const [anchor, dim] of [
      ['wall-mid', [600, 15, 900]],
      ['wall-mid', [800, 30, 600]],
      ['wall-high', [1200, 80, 700]],
      ['ceiling', [300, 10, 12]],
      ['ceiling', [1000, 1000, 400]],
    ] as const) {
      const b = selectionBase(anchor, [...dim]);
      const half = (b.plane === 'wall' ? dim[1] : dim[2]) / 2000;
      const [near, far] = b.plane === 'wall' ? [b.at, b.at + b.thickness] : [b.at - b.thickness, b.at];
      expect(near).toBeGreaterThan(-half);
      expect(far).toBeLessThan(half);
      expect(b.thickness).toBeGreaterThan(0);
    }
    expect(selectionBase('wall-mid', [1200, 80, 700]).thickness).toBe(BASE_THICKNESS);
  });

  it('sits up against the slab over a ceiling piece', () => {
    const fan = selectionBase('ceiling', [1000, 1000, 400]);
    expect(fan.plane).toBe('ceiling');
    // The piece is centred on its origin, so its top is h/2 — and the base stops
    // just short of it, for the same reason as the wall's.
    expect(fan.at).toBeCloseTo(0.2 - BASE_LIFT, 9);
    expect(fan.at).toBeLessThan(0.2);
  });

  it('keeps its margin in proportion: visible on a vase, not a moat round a bed', () => {
    const vase = selectionBase('floor', [120, 120, 300]);
    const bed = selectionBase('floor', [1800, 2100, 500]);
    expect(vase.margin).toBeGreaterThanOrEqual(0.02);
    expect(vase.margin).toBeLessThan(0.12 / 2);
    expect(bed.margin).toBeLessThanOrEqual(0.06);
    expect(bed.margin).toBeGreaterThan(vase.margin);
  });

  it('rounds its corners without the rounding eating a narrow side', () => {
    // A 20 mm shelf is the case that bites: its base is 60 mm across, so a
    // fixed 50 mm corner would be wider than the whole short side.
    for (const dim of [[120, 120, 300], [2000, 60, 800], [600, 20, 20], [3000, 3000, 10]] as const) {
      const b = selectionBase('floor', [...dim]);
      expect(b.radius).toBeGreaterThan(0);
      expect(b.radius * 2).toBeLessThanOrEqual(Math.min(...b.size) + 1e-9);
    }
  });
});

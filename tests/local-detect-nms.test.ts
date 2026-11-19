import { describe, expect, it } from 'vitest';
import { cutByTile, detectionBox, nms, tilesFor, type RawBox } from '../lib/local-detect';

function box(p: Partial<RawBox> = {}): RawBox {
  return {
    x: 0.5,
    y: 0.5,
    w: 0.2,
    h: 0.3,
    conf: 0.8,
    label: 'Couch',
    category: 'sofa',
    ...p,
  };
}

// The ensemble runs two models over five crops each, so every real object arrives
// as a handful of candidates. This step is what decides how many boxes the user
// actually sees, and it had no coverage.
describe('nms', () => {
  it('keeps the highest-confidence box of an overlapping set', () => {
    const kept = nms([
      box({ conf: 0.6 }),
      box({ conf: 0.91, label: 'Studio couch' }),
      box({ conf: 0.7 }),
    ]);
    expect(kept).toHaveLength(1);
    expect(kept[0].conf).toBeCloseTo(0.91);
  });

  it('keeps two objects that do not overlap', () => {
    const kept = nms([box({ x: 0.2 }), box({ x: 0.8 })]);
    expect(kept).toHaveLength(2);
  });

  it('drops a small box nested inside a larger one of the same kind', () => {
    // IoU alone leaves this pair alone — a tall crop of a monitor inside the whole
    // monitor scores under the threshold — which surfaced as stacked duplicates.
    const whole = box({ conf: 0.9, w: 0.4, h: 0.5, category: 'monitor', label: 'Computer monitor' });
    const crop = box({ conf: 0.5, w: 0.1, h: 0.12, category: 'monitor', label: 'Computer monitor' });
    expect(nms([whole, crop])).toHaveLength(1);
  });

  it('keeps a nested box of a DIFFERENT kind', () => {
    // A monitor standing on a desk is genuinely inside the desk's box.
    const desk = box({ conf: 0.9, w: 0.6, h: 0.5, category: 'desk', label: 'Desk' });
    const monitor = box({ conf: 0.5, w: 0.12, h: 0.15, category: 'monitor', label: 'Computer monitor' });
    expect(nms([desk, monitor])).toHaveLength(2);
  });

  it('caps how many boxes come out of one image', () => {
    const many = Array.from({ length: 40 }, (_, i) =>
      box({ x: 0.02 + i * 0.024, w: 0.01, h: 0.01, conf: 0.9 - i * 0.01 }),
    );
    expect(nms(many).length).toBeLessThanOrEqual(12);
  });

  it('is order-independent', () => {
    const set = [box({ conf: 0.4, x: 0.2 }), box({ conf: 0.95, x: 0.21 }), box({ conf: 0.6, x: 0.8 })];
    const a = nms(set).map((b) => b.conf).sort();
    const b = nms([...set].reverse()).map((b) => b.conf).sort();
    expect(a).toEqual(b);
  });
});

// Field test, four real rooms: both hotel doors and two curtains came out with
// their boxes ending at 0.64–0.65 of the photo height, which is the bottom edge of
// the upper tiles (0.5 + 15% overlap). The zoomed tile scored the door's top half
// above the whole frame's whole door, so the half won: the review photo outlined half
// a door and the geometry read it ~1.2 m tall (the built piece takes its height from
// the catalogue, so the damage was to the outline, the verdict and the confidence).
describe('a box cut by its tile', () => {
  const [whole, topLeft, topRight, bottomLeft] = tilesFor(4000, 3000);

  it('knows the inner edges of each tile, and that the whole frame has none', () => {
    expect(topLeft).toEqual({ ox: 0, oy: 0, cw: 2600, ch: 1950 });
    // Top of a door in the upper-left tile: runs to the tile's bottom edge, 0.65.
    expect(cutByTile({ x: 0.3, y: 0.4, w: 0.1, h: 0.5 }, topLeft, 4000, 3000)).toBe(true);
    // Same box, judged against the whole frame: nothing cut it.
    expect(cutByTile({ x: 0.3, y: 0.4, w: 0.1, h: 0.5 }, whole, 4000, 3000)).toBe(false);
    // A box that ends at the PHOTO's own edge is not cut by the tile.
    expect(cutByTile({ x: 0.3, y: 0.75, w: 0.1, h: 0.5 }, bottomLeft, 4000, 3000)).toBe(false);
    // …but one reaching the bottom-left tile's TOP inner edge (0.35) is.
    expect(cutByTile({ x: 0.3, y: 0.6, w: 0.1, h: 0.5 }, bottomLeft, 4000, 3000)).toBe(true);
    // A small box well inside the tile is whole.
    expect(cutByTile({ x: 0.3, y: 0.3, w: 0.1, h: 0.1 }, topLeft, 4000, 3000)).toBe(false);
    // Right inner edge of the upper-left tile, at 0.65 of the width.
    expect(cutByTile({ x: 0.6, y: 0.3, w: 0.1, h: 0.1 }, topLeft, 4000, 3000)).toBe(true);
    // Left inner edge of the upper-right tile, at 0.35.
    expect(cutByTile({ x: 0.4, y: 0.3, w: 0.1, h: 0.1 }, topRight, 4000, 3000)).toBe(true);
  });

  it('loses to the whole-frame box of the same door, even when more confident', () => {
    const wholeDoor = box({ x: 0.3, y: 0.55, w: 0.12, h: 0.7, conf: 0.6, category: 'door', label: 'Door' });
    const topHalf = box({ x: 0.3, y: 0.42, w: 0.12, h: 0.45, conf: 0.9, category: 'door', label: 'Door', cut: true });
    const kept = nms([topHalf, wholeDoor]);
    expect(kept).toHaveLength(1);
    expect(kept[0].h).toBeCloseTo(0.7, 12);
  });

  it('still survives where nothing whole overlaps it', () => {
    const onlyHalf = box({ x: 0.3, y: 0.42, w: 0.12, h: 0.45, conf: 0.9, category: 'door', label: 'Door', cut: true });
    const elsewhere = box({ x: 0.8, conf: 0.7 });
    expect(nms([onlyHalf, elsewhere])).toHaveLength(2);
  });
});

// A model regresses a box for a piece the frame cuts, and the box can run past the
// edge. The clamp this replaced set the near edge to the frame and kept the size,
// which moved the FAR edge by the overrun — and the far edge is the row the placers
// measure from (§ 49.15, measured in tests/photo-geometry.test.ts).
describe('detectionBox', () => {
  it('turns a centre and size into a corner and size, unchanged inside the frame', () => {
    const b = detectionBox(box({ x: 0.5, y: 0.5, w: 0.2, h: 0.3 }))!;
    expect(b[0]).toBeCloseTo(0.4, 12);
    expect(b[1]).toBeCloseTo(0.35, 12);
    expect(b[2]).toBe(0.2);
    expect(b[3]).toBe(0.3);
  });

  it('keeps the bottom row of a box that ran past the top where the model put it', () => {
    // Centre 0.2, height 0.5: the model's box spans −0.05 to 0.45.
    const b = detectionBox(box({ y: 0.2, h: 0.5 }))!;
    expect(b[1]).toBe(0);
    expect(b[1] + b[3]).toBeCloseTo(0.45, 12);
  });

  it('keeps the right edge of a box that ran past the left', () => {
    // Centre 0.1, width 0.4: −0.1 to 0.3.
    const b = detectionBox(box({ x: 0.1, w: 0.4 }))!;
    expect(b[0]).toBe(0);
    expect(b[0] + b[2]).toBeCloseTo(0.3, 12);
  });

  it('drops a box whose part in the picture is a sliver, however big the model drew it', () => {
    // 0.2 wide, but only 0.005 of it inside the right edge.
    expect(detectionBox(box({ x: 1.095, w: 0.2 }))).toBeNull();
    // …and a small box inside the frame, as before.
    expect(detectionBox(box({ w: 0.01 }))).toBeNull();
    expect(detectionBox(box({ w: 0.011 }))).not.toBeNull();
  });
});

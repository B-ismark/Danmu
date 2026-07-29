import { describe, expect, it } from 'vitest';
import { nms, type RawBox } from '../lib/local-detect';

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

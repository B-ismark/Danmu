// The plan's pointer mapping, at aspects that do not match the room's.
//
// This is the failure the old mapping had: it scaled each axis by its own ratio
// and applied no offset, which describes `preserveAspectRatio="none"`. The <svg>
// is `xMidYMid meet`. Right only where the two agree — a canvas whose aspect
// happens to equal the room's — and off by a scale AND an offset everywhere else.
// Which aspect the canvas has is decided by the rails, so the error moved every
// time a panel did.

import { describe, expect, it } from 'vitest';
import { clientDeltaToViewBox, clientToViewBox, letterbox } from '../lib/plan-view-transform';

/** A 4 × 3 m room: `bounds * SCALE + PAD * 2` with SCALE 100 and PAD 80. */
const BASE_W = 4 * 100 + 160;
const BASE_H = 3 * 100 + 160;

const rect = (width: number, height: number, left = 0, top = 0) => ({ left, top, width, height });

/** Forward: viewBox → client. The inverse of what `clientToViewBox` computes, so
 *  a round trip through both has to land back where it started. */
function project(r: { left: number; top: number; width: number; height: number }, x: number, y: number) {
  const { scale, offsetX, offsetY } = letterbox(r, BASE_W, BASE_H);
  return { clientX: r.left + offsetX + x * scale, clientY: r.top + offsetY + y * scale };
}

describe('letterbox', () => {
  it('fits by the tighter axis and centres the slack', () => {
    // 900 / 560 = 1.607 across, 600 / 460 = 1.304 down → height is the limit, so
    // the drawing is 730 × 600 and 170px of blank splits either side.
    const l = letterbox(rect(900, 600), BASE_W, BASE_H);
    expect(l.scale).toBeCloseTo(600 / BASE_H, 10);
    expect(l.offsetX).toBeCloseTo((900 - BASE_W * (600 / BASE_H)) / 2, 10);
    expect(l.offsetY).toBe(0);
  });

  it('leaves no slack when the aspects agree', () => {
    const l = letterbox(rect(BASE_W * 2, BASE_H * 2), BASE_W, BASE_H);
    expect(l.scale).toBe(2);
    expect(l.offsetX).toBe(0);
    expect(l.offsetY).toBe(0);
  });

  it('reports scale 0 for a degenerate element rather than NaN or Infinity', () => {
    // A collapsed rail, a hidden tab, the frame before layout. Every caller
    // multiplies a coordinate by this, and a NaN here is a part with no position
    // in a saved room.
    for (const r of [rect(0, 600), rect(900, 0), rect(0, 0)]) {
      const l = letterbox(r, BASE_W, BASE_H);
      expect(l.scale).toBe(0);
      expect(Number.isFinite(l.offsetX) && Number.isFinite(l.offsetY)).toBe(true);
    }
    expect(clientToViewBox(rect(0, 0), BASE_W, BASE_H, 40, 40)).toEqual({ x: 0, y: 0 });
    expect(clientDeltaToViewBox(rect(0, 0), BASE_W, BASE_H, 40, 40)).toEqual({ x: 0, y: 0 });
  });
});

describe('clientToViewBox', () => {
  // Wide, tall, and exactly matching. The middle one is the control: it is the
  // only shape at which the old mapping was correct.
  const shapes: [string, number, number][] = [
    ['wide canvas (rails collapsed)', 1200, 620],
    ['matching aspect', BASE_W * 1.5, BASE_H * 1.5],
    ['tall canvas (both rails open)', 520, 900],
  ];

  it.each(shapes)('maps the element centre to the viewBox centre — %s', (_label, w, h) => {
    const r = rect(w, h, 260, 104); // offset by a left rail and the top bar
    const p = clientToViewBox(r, BASE_W, BASE_H, r.left + w / 2, r.top + h / 2);
    expect(p.x).toBeCloseTo(BASE_W / 2, 6);
    expect(p.y).toBeCloseTo(BASE_H / 2, 6);
  });

  it.each(shapes)('round-trips against the forward projection — %s', (_label, w, h) => {
    const r = rect(w, h, 260, 104);
    for (const [x, y] of [
      [0, 0],
      [BASE_W, BASE_H],
      [BASE_W / 3, (BASE_H * 2) / 3],
    ]) {
      const c = project(r, x, y);
      const back = clientToViewBox(r, BASE_W, BASE_H, c.clientX, c.clientY);
      expect(back.x).toBeCloseTo(x, 6);
      expect(back.y).toBeCloseTo(y, 6);
    }
  });

  it('puts the letterboxed margin outside the viewBox', () => {
    // The blank strip beside the drawing is not part of the room, and the old
    // mapping claimed it was: it reported x = 0 at the element's left edge no
    // matter how much of that edge was empty.
    const r = rect(1200, 620);
    const left = clientToViewBox(r, BASE_W, BASE_H, 0, r.height / 2);
    expect(left.x).toBeLessThan(0);
    const right = clientToViewBox(r, BASE_W, BASE_H, r.width, r.height / 2);
    expect(right.x).toBeGreaterThan(BASE_W);
  });

  it('is uniform: a square of client pixels is a square of viewBox units', () => {
    // The old per-axis mapping stretched it, so a 45° drag left the pointer.
    const r = rect(900, 600);
    const d = clientDeltaToViewBox(r, BASE_W, BASE_H, 120, 120);
    expect(d.x).toBeCloseTo(d.y, 10);
  });

  it('differs from the per-axis mapping by a real margin at a real aspect', () => {
    // Guards the fix itself: if someone reverts to `baseW / rect.width` this stops
    // failing, and nothing else in the suite would notice.
    const r = rect(900, 600);
    const fixed = clientToViewBox(r, BASE_W, BASE_H, 800, 300);
    const naive = { x: 800 * (BASE_W / 900), y: 300 * (BASE_H / 600) };
    // ~50 viewBox units at SCALE 100, i.e. half a metre — measured near the wall,
    // which is where a piece is most often dragged and where the drift is worst.
    expect(Math.abs(fixed.x - naive.x)).toBeGreaterThan(40);
  });
});

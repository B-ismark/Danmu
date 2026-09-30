// The phone sheet's detents: where a released drag settles, and that the heights the
// drag settles on are the heights the stylesheet draws.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cycleSheet, FLICK, settleSheet, sheetHeights, TAP_PX } from '@/lib/sheet-detents';

// A 390 × 844 phone: 669px of stage between the app bar and the toolbar, measured in
// the running build, with the stylesheet's 55% and 56px.
const H = sheetHeights(669, 0.55, 56);

describe('sheetHeights', () => {
  it('reads the stage, the half share and the top gap', () => {
    expect(H[0]).toBe(0);
    expect(H[1]).toBeCloseTo(367.95, 2);
    expect(H[2]).toBe(613);
  });

  it('never puts the middle detent above the top one on a very short stage', () => {
    // 100px of stage: 55% is 55px, but the top gap leaves only 44.
    expect(sheetHeights(100, 0.55, 56)).toEqual([0, 44, 44]);
    expect(sheetHeights(40, 0.55, 56)).toEqual([0, 0, 0]);
  });
});

describe('settleSheet', () => {
  it('rests at the nearest detent when released slowly', () => {
    expect(settleSheet(10, 0, H)).toBe('closed');
    expect(settleSheet(183, 0, H)).toBe('closed');
    expect(settleSheet(185, 0, H)).toBe('half');
    expect(settleSheet(368, 0, H)).toBe('half');
    expect(settleSheet(490, 0, H)).toBe('half');
    expect(settleSheet(491, 0, H)).toBe('full');
    expect(settleSheet(613, 0, H)).toBe('full');
  });

  it('carries a flick one detent further in its direction', () => {
    // Just above half, flicked up: full, though half is nearer.
    expect(settleSheet(400, FLICK + 0.1, H)).toBe('full');
    // Just below half, flicked down: closed.
    expect(settleSheet(340, -(FLICK + 0.1), H)).toBe('closed');
    // Just above closed, flicked up: half.
    expect(settleSheet(40, FLICK + 0.1, H)).toBe('half');
  });

  it('does not count a release at exactly the flick speed as a flick', () => {
    expect(settleSheet(400, FLICK, H)).toBe('half');
    expect(settleSheet(340, -FLICK, H)).toBe('half');
  });

  it('never carries a flick back past the detent it was moving away from', () => {
    // Below half and flicked UP: the nearest is half, and the flick is toward it,
    // so it stays at half rather than jumping to full.
    expect(settleSheet(340, FLICK + 1, H)).toBe('half');
    // Above half and flicked DOWN: likewise.
    expect(settleSheet(400, -(FLICK + 1), H)).toBe('half');
  });

  it('stops at the ends, even when the height reported has overshot them', () => {
    expect(settleSheet(613, FLICK + 1, H)).toBe('full');
    expect(settleSheet(0, -(FLICK + 1), H)).toBe('closed');
    // The drag clamps the height it writes, but a rubber-band or a sub-pixel
    // rect can read a hair outside it — and a detent past the last is no detent.
    expect(settleSheet(640, FLICK + 1, H)).toBe('full');
    expect(settleSheet(-4, -(FLICK + 1), H)).toBe('closed');
  });

  it('settles a release exactly between two detents on the lower one', () => {
    // Covering less of the room is the forgiving answer when the finger is undecided.
    expect(settleSheet(100, 0, [0, 200, 400])).toBe('closed');
    expect(settleSheet(300, 0, [0, 200, 400])).toBe('half');
  });
});

describe('cycleSheet', () => {
  it('toggles the two open detents, and opens a closed sheet to full', () => {
    expect(cycleSheet('half')).toBe('full');
    expect(cycleSheet('full')).toBe('half');
    expect(cycleSheet('closed')).toBe('full');
  });

  it('lowers a sheet sized to its content, which has no second height to go to', () => {
    expect(cycleSheet('half', true)).toBe('closed');
    expect(cycleSheet('full', true)).toBe('closed');
  });
});

describe('a sheet sized to its content (View)', () => {
  // SheetShell hands the drag `[0, h, h]`, h being the sheet's height at the press.
  const FIT: [number, number, number] = [0, 240, 240];

  it('settles open or closed, never on a second open height', () => {
    expect(settleSheet(240, FLICK + 1, FIT)).toBe('half');
    expect(settleSheet(230, FLICK + 1, FIT)).toBe('half');
    expect(settleSheet(121, 0, FIT)).toBe('half');
    expect(settleSheet(119, 0, FIT)).toBe('closed');
    expect(settleSheet(200, -(FLICK + 1), FIT)).toBe('closed');
  });
});

describe('the stylesheet draws the heights the drag settles on', () => {
  const css = readFileSync('app/globals.css', 'utf8');
  const rule = (sel: string) => {
    const at = css.indexOf(`\n${sel} {`);
    expect(at, sel).toBeGreaterThan(-1);
    return css.slice(at, css.indexOf('}', at));
  };

  it('uses --sheet-half for the middle detent and --sheet-top-gap for the top one', () => {
    expect(rule('.sheet')).toMatch(/\bheight: var\(--sheet-half\);/);
    expect(rule('.sheet[data-snap="full"]')).toMatch(/height: calc\(100% - var\(--sheet-top-gap\)\)/);
  });

  it('draws a content-sized sheet at its content, under the same top gap', () => {
    const r = rule('.sheet[data-fit]');
    expect(r).toMatch(/height: auto;/);
    expect(r).toMatch(/max-height: calc\(100% - var\(--sheet-top-gap\)\)/);
    // After the `full` rule, so a sheet switched to View from a full Room still fits.
    expect(css.indexOf('\n.sheet[data-fit] {')).toBeGreaterThan(css.indexOf('\n.sheet[data-snap="full"] {'));
  });

  it('leaves the home indicator to the toolbar, not the sheet resting on it', () => {
    // The sheet ends at the toolbar's top edge, and the toolbar pads for the inset.
    // A second inset inside the sheet was ~34px of empty paper on an iPhone.
    expect(rule('.phone-toolbar')).toMatch(/env\(safe-area-inset-bottom\)/);
    expect(rule('.sheet__body')).not.toMatch(/env\(safe-area/);
  });

  it('declares --sheet-half as a percentage, which is what the drag parses', () => {
    expect(css).toMatch(/--sheet-half: \d+(\.\d+)?%;/);
  });

  it('holds the closed sheet under a stage that cannot be scrolled', () => {
    // The closed sheet waits just past the stage's bottom edge. `overflow: hidden`
    // clips it and is STILL a scroll container, so selecting a piece — which scrolls
    // its Room-list row into view — slid the whole stage up by the sheet's height
    // and left a blank band over the toolbar. `clip` is the one that cannot scroll.
    for (const sel of ['.sheet-shell', '.sheet-shell__stage']) {
      const r = rule(sel);
      expect(r, sel).toMatch(/overflow: clip;/);
      // `hidden` may stand before it as a fallback; never after it, where it wins.
      expect(r.lastIndexOf('overflow: hidden'), sel).toBeLessThan(r.indexOf('overflow: clip'));
    }
  });

  it('keeps the tap threshold under a finger’s jitter and above zero', () => {
    expect(TAP_PX).toBeGreaterThan(0);
    expect(TAP_PX).toBeLessThanOrEqual(10);
  });
});

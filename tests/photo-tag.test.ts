import { describe, expect, it } from 'vitest';
import { BOX_BORDER_PX, TAG_HEIGHT_PX, TAG_OVERLAP_PX, boxCss, tagCss, tagSpot } from '@/lib/photo-tag';
import { cssLength } from './helpers/css-length';

type Box = [number, number, number, number];
const LIFT = TAG_HEIGHT_PX - TAG_OVERLAP_PX;

/** The tag's rectangle in photo pixels, laid out as `PhotoEditor` lays it out: a row the
 *  photo's width, a spacer of basis `start` that is the only thing allowed to shrink,
 *  then the tag at its natural width, capped at the row. Everything resolves against the
 *  photo, which has no border or padding of its own — that is what makes this model the
 *  layout rather than an approximation of it. `scripts/photo-tag-probe.mjs` checks the
 *  same claims against a real browser.
 *
 *  The two lengths are read out of the CSS `tagCss` writes, not worked out again here:
 *  a model that repeats the arithmetic agrees with it by construction, so a wrong sign in
 *  the string would pass every sweep below. Only the flexbox is modelled. */
function laidOut(box: Box, W: number, H: number, natural: number) {
  const s = tagSpot(box, H);
  const css = tagCss(s);
  const start = cssLength(css.start, W);
  const width = Math.min(natural, W);
  const left = Math.min(start, W - width);
  const top = cssLength(css.top, H);
  return { ...s, start, left, right: left + width, top, bottom: top + TAG_HEIGHT_PX, width };
}

const PHOTOS: [number, number][] = [
  [328, 246], // a phone, portrait screen, landscape photo
  [328, 437], // a phone, portrait photo
  [720, 540],
  [1180, 885],
];
// Past both edges as well: the on-device finder clamps x and w but not their sum, and the
// cloud's boxes are not clamped at all.
const STEPS = [-0.1, 0, 0.02, 0.1, 0.3, 0.45, 0.5, 0.55, 0.7, 0.9, 0.97, 1.05];
const SIZES = [0.03, 0.1, 0.25, 0.5, 0.9];
// A short name, an ordinary one, and a typed one longer than any photo is wide.
const TAGS = [70, 150, 2000];

function* boxes(): Generator<Box> {
  for (const x of STEPS) for (const w of SIZES) for (const y of STEPS) for (const h of SIZES) yield [x, y, w, h];
}
const clamp = (n: number) => Math.min(1, Math.max(0, n));

describe('the photo tag', () => {
  it('stays on the photo on all four sides, for every box, photo and name', () => {
    let n = 0;
    for (const [W, H] of PHOTOS)
      for (const box of boxes())
        for (const t of TAGS) {
          const r = laidOut(box, W, H, t);
          const at = `${JSON.stringify(box)} in ${W}×${H}, ${t}px tag`;
          expect(r.left, at).toBeGreaterThanOrEqual(0);
          expect(r.right, at).toBeLessThanOrEqual(W + 1e-9);
          expect(r.top, at).toBeGreaterThanOrEqual(0);
          expect(r.bottom, at).toBeLessThanOrEqual(H + 1e-9);
          n++;
        }
    // The sweep is the assertion, so its size is pinned rather than floored.
    expect(n).toBe(43200);
  });

  it("starts at its box's left side, and slides only as far as the photo's edge", () => {
    let slid = 0;
    let flush = 0;
    for (const [W, H] of PHOTOS)
      for (const box of boxes())
        for (const t of TAGS) {
          const r = laidOut(box, W, H, t);
          const x0 = clamp(box[0]) * W;
          const at = `${JSON.stringify(box)} in ${W}×${H}, ${t}px tag`;
          if (r.start + r.width <= W) {
            // Where it fits it is exactly where it always was: flush with the box's
            // outer edge, so the tag's left side carries on the line of its border.
            expect(r.left, at).toBe(x0);
            flush++;
          } else {
            expect(r.right, at).toBeCloseTo(W, 9);
            slid++;
          }
          // Either way it spans the box's left side, so it reads as that box's tag.
          expect(r.left, at).toBeLessThanOrEqual(x0);
          expect(r.right, at).toBeGreaterThanOrEqual(x0);
        }
    expect([flush, slid]).toEqual([23400, 19800]);
  });

  it('sits above its box when there is room, else below, else inside — never over a short box', () => {
    const seen = { above: 0, below: 0, inside: 0 };
    for (const [W, H] of PHOTOS)
      for (const box of boxes()) {
        const r = laidOut(box, W, H, 150);
        const y0 = clamp(box[1]) * H;
        const y1 = Math.max(y0, clamp(box[1] + box[3]) * H);
        const at = `${JSON.stringify(box)} in ${W}×${H}`;
        seen[r.place]++;
        if (y0 >= LIFT) {
          expect(r.place, at).toBe('above');
          // Held at the foot for a box that starts there, so its overlap stays on the photo.
          expect(r.bottom, at).toBeCloseTo(Math.min(y0 + TAG_OVERLAP_PX, H), 9);
        } else if (y1 + LIFT <= H) {
          expect(r.place, at).toBe('below');
          // Held at 0 for a box wholly above the frame, which ends at the photo's top.
          expect(r.top, at).toBeCloseTo(Math.max(0, y1 - TAG_OVERLAP_PX), 9);
        } else {
          expect(r.place, at).toBe('inside');
          expect(r.top, at).toBeCloseTo(y0, 9);
        }
        // Above or below, the tag covers no more of its own box than the border it
        // overlaps, so a small box at the top keeps its outline and its press.
        if (r.place !== 'inside') {
          const covered = Math.max(0, Math.min(r.bottom, y1) - Math.max(r.top, y0));
          expect(covered, at).toBeLessThanOrEqual(TAG_OVERLAP_PX + 1e-9);
        }
      }
    expect(seen).toEqual({ above: 10500, below: 3720, inside: 180 });
  });

  it("needs exactly the tag's lift above the box to sit there", () => {
    // 0.125 × 208 is 26 px exactly, in binary as well as on paper.
    expect(LIFT).toBe(26);
    expect(tagSpot([0.2, 0.125, 0.2, 0.2], 208).place).toBe('above');
    expect(tagSpot([0.2, 0.12, 0.2, 0.2], 208).place).toBe('below');
    // …and below: 0.875 × 208 is 182, which leaves 26 px under it exactly.
    expect(tagSpot([0.2, 0, 0.2, 0.875], 208).place).toBe('below');
    expect(tagSpot([0.2, 0, 0.2, 0.88], 208).place).toBe('inside');
  });

  it('reads a box with no height as a line at its top', () => {
    expect(tagSpot([0.3, 0.05, 0.2, NaN], 246)).toEqual({ startPct: 30, place: 'below', topPct: 5, topPx: -2 });
  });

  it('sits above, held on the photo, until the photo has a height', () => {
    expect(tagSpot([0.2, 0.01, 0.2, 0.2], 0).place).toBe('above');
    expect(tagSpot([0.2, 0.01, 0.2, 0.2], 246).place).toBe('below');
    expect(tagCss(tagSpot([0.2, 0.01, 0.2, 0.2], 0)).top).toBe('clamp(0px, calc(1% - 26px), calc(100% - 28px))');
  });

  it('writes the CSS the component lays out with', () => {
    expect(tagCss(tagSpot([0.8, 0.4, 0.2, 0.25], 246))).toEqual({
      top: 'clamp(0px, calc(40% - 26px), calc(100% - 28px))',
      start: 'max(0px, 80%)',
    });
    expect(tagCss(tagSpot([0.1, 0, 0.4, 0.5], 246))).toEqual({
      top: 'clamp(0px, calc(50% - 2px), calc(100% - 28px))',
      start: 'max(0px, 10%)',
    });
    expect(tagCss(tagSpot([0.1, 0.02, 0.4, 0.97], 246))).toEqual({
      top: 'clamp(0px, calc(2% + 0px), calc(100% - 28px))',
      start: 'max(0px, 10%)',
    });
  });

  it('rounds its percentages, so a share like 0.07 does not write 7.000000000000001%', () => {
    expect(tagCss(tagSpot([0.07, 0.5, 0.2, 0.2], 246)).start).toBe('max(0px, 7%)');
  });

  it('holds a box that is not a number to the photo rather than writing NaN', () => {
    for (const box of [
      [NaN, NaN, NaN, NaN],
      [0.3, undefined, 0.2, 0.2],
      [Infinity, -Infinity, 0, 0],
    ] as number[][]) {
      const css = tagCss(tagSpot(box, 246));
      expect(`${css.top} ${css.start}`).not.toMatch(/NaN|Infinity|undefined/);
    }
  });
});

describe('the CSS reader these sweeps lay out with', () => {
  it('resolves what a browser would, and refuses what a browser would drop', () => {
    expect(cssLength('calc(40% - 26px)', 200)).toBe(54);
    expect(cssLength('max(0px, calc(10% - 30px))', 200)).toBe(0);
    expect(cssLength('min(100%, calc(100% - 3px))', 200)).toBe(197);
    expect(cssLength('clamp(0px, calc(1% - 26px), calc(100% - 28px))', 200)).toBe(0);
    expect(cssLength('clamp(0px, calc(99% + 0px), calc(100% - 28px))', 200)).toBe(172);
    expect(cssLength('clamp(0px, calc(50% + 0px), calc(100% - 28px))', 200)).toBe(100);
    for (const bad of ['calc(40%-26px)', 'calc(40% -26px)', 'calc(40%- 26px)', '40', '4em', 'calc(1%, 2%)', 'clamp(0px, 1%)', '1% 2%'])
      expect(() => cssLength(bad, 200), bad).toThrow();
  });
});

describe("a box's outline on the photo", () => {
  /** The outline's rectangle in photo pixels, resolved from the CSS it is handed. A
   *  border-box never draws narrower than its two borders, which is the whole reason a
   *  sliver needs holding in. */
  function drawn(box: Box, W: number, H: number, border: number) {
    const css = boxCss(box, border);
    const left = cssLength(css.left, W);
    const top = cssLength(css.top, H);
    const width = Math.max(cssLength(css.width, W), 2 * border);
    const height = Math.max(cssLength(css.height, H), 2 * border);
    return { left, top, right: left + width, bottom: top + height };
  }

  it('never reaches past the photo, whatever the box, for the outline and the highlight', () => {
    let n = 0;
    for (const [W, H] of PHOTOS)
      for (const box of boxes())
        for (const border of [BOX_BORDER_PX, 0]) {
          const r = drawn(box, W, H, border);
          const at = `${JSON.stringify(box)} in ${W}×${H}, ${border}px border`;
          expect(r.left, at).toBeGreaterThanOrEqual(0);
          expect(r.top, at).toBeGreaterThanOrEqual(0);
          expect(r.right, at).toBeLessThanOrEqual(W + 1e-9);
          expect(r.bottom, at).toBeLessThanOrEqual(H + 1e-9);
          n++;
        }
    expect(n).toBe(28800);
  });

  it('draws exactly the part of the box that is on the photo, where that is wider than its borders', () => {
    let exact = 0;
    for (const [W, H] of PHOTOS)
      for (const box of boxes()) {
        const r = drawn(box, W, H, BOX_BORDER_PX);
        const [x0, x1] = [clamp(box[0]) * W, clamp(box[0] + box[2]) * W];
        const [y0, y1] = [clamp(box[1]) * H, clamp(box[1] + box[3]) * H];
        if (x1 - x0 < 2 * BOX_BORDER_PX || y1 - y0 < 2 * BOX_BORDER_PX) continue;
        const at = `${JSON.stringify(box)} in ${W}×${H}`;
        expect([r.left, r.right, r.top, r.bottom].map((v) => Number(v.toFixed(6))), at).toEqual(
          [x0, x1, y0, y1].map((v) => Number(v.toFixed(6))),
        );
        exact++;
      }
    expect(exact).toBe(11236);
  });

  it('holds a sliver in by its two borders, and only when it has to', () => {
    expect(boxCss([0.8, 0.4, 0.2, 0.25], BOX_BORDER_PX)).toEqual({
      left: 'min(80%, calc(100% - 3px))',
      top: 'min(40%, calc(100% - 3px))',
      width: '20%',
      height: '25%',
    });
    // Wholly past the right edge: nothing of it is on the photo, and its two borders
    // sit just inside the frame rather than 3 px outside it.
    expect(boxCss([1.05, 0.3, 0.1, 0.12], BOX_BORDER_PX)).toEqual({
      left: 'min(100%, calc(100% - 3px))',
      top: 'min(30%, calc(100% - 3px))',
      width: '0%',
      height: '12%',
    });
    // The highlight is an outline, which takes no room, so it is not held in.
    expect(boxCss([0.9, -0.1, 0.3, 0.3], 0)).toEqual({ left: '90%', top: '0%', width: '10%', height: '20%' });
    // A box whose size came back negative is empty, not a negative length the browser drops.
    expect(boxCss([0.5, 0.5, -0.1, -0.2], 0)).toEqual({ left: '50%', top: '50%', width: '0%', height: '0%' });
  });

  it('draws nothing, rather than NaN, for a box that is not a number', () => {
    for (const box of [
      [NaN, NaN, NaN, NaN],
      [0.3, undefined, 0.2, 0.2],
      [Infinity, -Infinity, 0, 0],
    ] as number[][]) {
      const css = boxCss(box, BOX_BORDER_PX);
      expect(Object.values(css).join(' ')).not.toMatch(/NaN|Infinity|undefined/);
    }
  });
});

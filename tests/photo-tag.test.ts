import { describe, expect, it } from 'vitest';
import { TAG_BLEED_PX, TAG_HEIGHT_PX, TAG_OVERLAP_PX, tagCss, tagSpot } from '@/lib/photo-tag';

type Box = [number, number, number, number];
const LIFT = TAG_HEIGHT_PX - TAG_OVERLAP_PX;

/** The tag's rectangle in photo pixels, laid out as `PhotoEditor` lays it out: a row the
 *  photo's width, a spacer of basis `start` that is the only thing allowed to shrink,
 *  then the tag at its natural width, capped at the row. Everything resolves against the
 *  photo, which has no border or padding of its own — that is what makes this model the
 *  layout rather than an approximation of it. `scripts/photo-tag-probe.mjs` checks the
 *  same claims against a real browser. */
function laidOut(box: Box, W: number, H: number, natural: number) {
  const s = tagSpot(box, H);
  const start = Math.max(0, (s.startPct / 100) * W - TAG_BLEED_PX);
  const width = Math.min(natural, W);
  const left = Math.min(start, W - width);
  // CSS clamp(): the floor wins when the photo is shorter than the tag.
  const top = Math.max(0, Math.min((s.topPct / 100) * H + s.topPx, H - TAG_HEIGHT_PX));
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
            // Where it fits it is exactly where it always was: flush with the box.
            expect(r.left, at).toBe(Math.max(0, x0 - TAG_BLEED_PX));
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
      start: 'max(0px, calc(80% - 1px))',
    });
    expect(tagCss(tagSpot([0.1, 0, 0.4, 0.5], 246))).toEqual({
      top: 'clamp(0px, calc(50% - 2px), calc(100% - 28px))',
      start: 'max(0px, calc(10% - 1px))',
    });
    expect(tagCss(tagSpot([0.1, 0.02, 0.4, 0.97], 246))).toEqual({
      top: 'clamp(0px, calc(2% + 0px), calc(100% - 28px))',
      start: 'max(0px, calc(10% - 1px))',
    });
  });

  it('rounds its percentages, so a share like 0.07 does not write 7.000000000000001%', () => {
    expect(tagCss(tagSpot([0.07, 0.5, 0.2, 0.2], 246)).start).toBe('max(0px, calc(7% - 1px))');
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

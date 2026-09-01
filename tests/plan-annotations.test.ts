import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  DIM_BACKDROP_ABOVE,
  DIM_BACKDROP_BELOW,
  DIM_RULER_OFFSET,
  LABEL_HALF_H,
  LABEL_HALF_W,
  WALL_AXES,
  WALL_LABEL_OFFSET,
  annotationGap,
  dimRulerBand,
  wallLabelBand,
} from '@/lib/plan-annotations';

// § 30. The 2D plan writes a wall's NAME and the room's overall DIMENSION at the same
// distance outside the same line, and for a rectangle the north and east walls are two
// sides of the plan's own bounding box — so the two were measured from the same edge
// and one number decided whether they collided. They did, on an empty room, at every
// size, on the first plan anyone opens.
//
// Nothing could see it. jsdom has no layout, so `getBoundingClientRect` on an SVG text
// node is zeros and no component test can measure this; and by eye it does not look
// like an overlap, because each ruler number is painted on an opaque `--paper` backdrop
// drawn AFTER the labels, so it erases the middle of the word rather than sitting on
// top of it. It was found in a screenshot taken for something else.
//
// What IS checkable without a browser is the arithmetic, once the numbers being drawn
// and the numbers being checked are the same numbers — which is the whole reason
// `lib/plan-annotations.ts` exists rather than two literals in the renderer.

describe('the plan does not write two annotations in the same place', () => {
  it('the wall name and the dimension ruler clear each other on BOTH axes', () => {
    // The sweep is over `WALL_AXES` rather than the one axis that was looked at. The
    // first fix cleared north and left east overlapping by 4 units, because a label
    // reaches the ruler by its HEIGHT on a vertical normal and by its WIDTH on a
    // horizontal one, and a single half-extent hid the difference. Checking one axis
    // is what shipped that.
    expect([...WALL_AXES]).toEqual(['vertical-normal', 'horizontal-normal']);
    for (const axis of WALL_AXES) {
      const label = wallLabelBand(axis);
      const ruler = dimRulerBand();
      expect(
        annotationGap(axis),
        `${axis}: wall name occupies [${label.lo}, ${label.hi}] and the ruler ` +
          `[${ruler.lo}, ${ruler.hi}] units outside the wall. A negative gap is how deep ` +
          'they overlap, and it is what made "East wall" render as "Ea … wall".',
      ).toBeGreaterThan(0);
    }
  });

  it('and keeps a gap wide enough to be a decision rather than a near miss', () => {
    // Pre-fix (ruler at 18) the gaps are -7 and -22. Landing on +1 would be
    // "technically not overlapping" and would go back to overlapping on the first font
    // change. Pinned from BOTH sides: one-sided is the same defect as unpinned. The
    // upper bound is what stops the ruler drifting out of the padding.
    for (const axis of WALL_AXES) {
      expect(annotationGap(axis), axis).toBeGreaterThanOrEqual(6);
      expect(annotationGap(axis), axis).toBeLessThanOrEqual(45);
    }
    // The binding axis is east/west, and saying so here is what stops someone
    // "simplifying" the two half-extents back into one: the gap that matters is the
    // smaller one, and it is not the one a north-wall screenshot shows.
    expect(annotationGap('horizontal-normal')).toBeLessThan(annotationGap('vertical-normal'));
  });

  it('the ruler is OUTSIDE the wall name, not inside it', () => {
    // Which one moved is a design decision worth pinning, not an accident of two
    // numbers. The wall's name belongs nearest its wall and the room's overall size
    // outside that, and — the load-bearing half — `WALL_LABEL_OFFSET` applies to every
    // edge of every footprint including the interior edges of an L, T or U, while the
    // ruler only ever runs along the bounding box. Moving the label to fix a bounding
    // box problem would have moved it on six-edge rooms that never had one.
    for (const axis of WALL_AXES) {
      expect(dimRulerBand().lo, axis).toBeGreaterThan(wallLabelBand(axis).hi);
    }
  });

  it('and both stay inside the plan padding', () => {
    // `PAD` is the margin the plan is drawn with; an annotation past it is clipped or
    // lands on the toolbar. Read from the renderer rather than restated, so raising the
    // ruler without raising the padding is caught here.
    const src = readFileSync('components/studio/PlanView.tsx', 'utf8');
    const pad = Number(/^const PAD = (\d+);$/m.exec(src)![1]);
    expect(pad, 'PAD is no longer a plain literal in PlanView').toBeGreaterThan(0);
    expect(dimRulerBand().hi).toBeLessThan(pad);
    for (const axis of WALL_AXES) expect(wallLabelBand(axis).lo, axis).toBeGreaterThan(0);
  });

  it('is what the renderer actually draws, in both rulers', () => {
    // The two-sources-of-truth half. These constants are only worth having if
    // `PlanView` reads them, and a renderer that quietly went back to a literal would
    // leave every assertion above green while the plan overlapped again. The `18` and
    // the `26` are the exact values that were wrong.
    const src = readFileSync('components/studio/PlanView.tsx', 'utf8');
    expect(src).toContain("from '@/lib/plan-annotations'");
    expect(src).toContain('WALL_LABEL_OFFSET');
    expect(src).toContain('DIM_RULER_OFFSET');
    expect(src, 'a hard-coded ruler offset is back').not.toMatch(/y1=\{PAD - 18\}/);
    expect(src, 'a hard-coded wall label offset is back').not.toMatch(/Math\.(sin|cos)\(seg\.yaw\) \* 26/);
    // Both rulers, not just the one that was looked at: the top rule is drawn from
    // `PAD` and the right rule from `PAD + planW`, and only fixing the first would
    // leave "East wall" — the worse of the two — exactly as it was.
    expect(src).toContain('y1={PAD - DIM_RULER_OFFSET}');
    expect(src).toContain('x1={PAD + planW + DIM_RULER_OFFSET}');
  });

  it('the band arithmetic is the backdrop, not the text', () => {
    // The backdrop is what does the damage — it is opaque and it is painted after the
    // labels — so the ruler's band has to describe the rect, not the glyphs. If this
    // ever measured the text instead, the bands would clear while the paint still ate
    // the word.
    expect(dimRulerBand().hi - dimRulerBand().lo).toBe(DIM_BACKDROP_ABOVE + DIM_BACKDROP_BELOW);
    expect(dimRulerBand().hi - dimRulerBand().lo).toBe(15);
    expect(WALL_LABEL_OFFSET).toBe(26);
    expect(DIM_RULER_OFFSET).toBe(62);
  });

  it('and neither half-extent is free to shrink until the bands clear on paper only', () => {
    // Written because setting the label's half-extent to 2 passed every assertion
    // above. Each of them derives the label's band FROM that constant, so shrinking it
    // moves the band and the thing measuring the band together — the gap widens, the
    // ruler is still "outside the label", and the plan overlaps exactly as before. An
    // assertion that measures its own subject, which is the failure this repo names by
    // name, and it survived a first battery of five.
    //
    // So both are pinned against something outside the file. A browser reports the wall
    // name's box as ~11.8 plan units tall and the widest of them ("North wall",
    // "South wall") as ~42 wide, measured at three room sizes and scaled back out of
    // the fit. An UNDER-estimate is the only direction that silently re-opens the
    // defect, because it is the direction that makes the arithmetic look better than
    // the paint.
    expect(LABEL_HALF_H, 'the label is ~11.8 units tall; half of it is ~5.9').toBeGreaterThanOrEqual(6);
    expect(LABEL_HALF_H, 'padding a glyph box to this is guessing, not measuring').toBeLessThanOrEqual(9);
    expect(LABEL_HALF_W, '"North wall" is ~42 units wide; half of it is ~21').toBeGreaterThanOrEqual(21);
    expect(LABEL_HALF_W).toBeLessThanOrEqual(30);
    // And the asymmetry itself, which is the thing that was got wrong: a wall name is
    // far wider than it is tall, so the two are not interchangeable and a single
    // constant cannot stand in for both.
    expect(LABEL_HALF_W).toBeGreaterThan(2 * LABEL_HALF_H);
  });
});

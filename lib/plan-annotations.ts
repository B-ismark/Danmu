// Where the 2D plan's two outside-the-room annotations sit, and the arithmetic that
// keeps them off each other.
//
// ── Why this is a module and not two literals in the renderer ─────────────────
//
// `PlanView` draws a **wall name** ("North wall") a fixed distance along each edge's
// outward normal, and an **overall dimension ruler** ("3.00 m") a fixed distance
// outside the plan's bounding box. For a rectangle the north and east walls ARE two
// sides of that box, so the two annotations are measured outward from the same line
// and one number decides whether they collide.
//
// They did. The wall name sat at 26 and the ruler occupied 11–26, so the name was
// inside the ruler's band by construction — at every room size, on an empty room, and
// on the first plan anyone opens. It never looked like an overlap either, which is why
// nothing caught it by eye: each ruler number is painted on an opaque `--paper`
// backdrop drawn AFTER the labels, so it does not sit on top of the word, it **erases
// the middle of it**. "East wall" rendered as `Ea` — gap — `wall`, which reads as a
// font or a truncation bug rather than as two things in one place.
//
// The px overlap shrank as the room grew (61 px wide at 3.0 × 2.4, 32 px at
// 7.5 × 5.6), which looks like a small-room problem and is not: the whole plan scales
// to fit, so both texts shrink together and the collision is CONSTANT in the user
// units below.
//
// ── The half that a symmetric model gets wrong ────────────────────────────────
//
// A label's extent ALONG THE OUTWARD NORMAL is not one number. For the north and
// south walls the normal is vertical, so what reaches toward the ruler is the text's
// HEIGHT — about 12 units. For east and west it is the text's WIDTH, about 42. The
// first version of this file modelled one half-extent for both, moved the ruler far
// enough to clear the north wall, and left east overlapping by 4 units — measured in a
// browser, which is the only reason it was caught, because the arithmetic agreed with
// itself the whole time. It is the repo's own "verify in the asymmetric case", and a
// square room and a vertical-normal wall hide it identically.
//
// Nothing here is a design token. These are SVG user-space offsets in the plan's own
// coordinate system, not colours, spacing or type.

/** Half the height of a rendered wall name, in plan user units. A browser reports the
 *  box of 11-unit `--font-sans` text as ~11.8 units tall, measured at three room sizes
 *  and scaled back out of the fit. */
export const LABEL_HALF_H = 7;

/** Half the WIDTH of the widest wall name. "North wall" and "South wall" are the two
 *  longest strings `wallLabelFor` can produce (the non-compass branch is "Wall N",
 *  much shorter), and a browser gives them ~42 units. This is the number that decides
 *  where the ruler goes, because east and west reach toward it edge-on. */
export const LABEL_HALF_W = 22;

/** How far a wall's NAME sits outside its own edge, along that edge's outward normal.
 *  Applies to every edge of every footprint, including the interior edges of an L, T
 *  or U — which is why the fix moved the ruler and not this. */
export const WALL_LABEL_OFFSET = 26;

/** How far the overall dimension ruler's LINE sits outside the plan's bounding box.
 *
 *  Was 18, which put its backdrop across the wall names. The wall name belongs nearest
 *  its wall and the room's overall size outside it, so the ruler is what moved. Driven
 *  by the east/west case, not the north/south one. `PAD` is 80, so the ruler and its
 *  backdrop still sit inside the plan's margin. */
export const DIM_RULER_OFFSET = 62;

/** The ruler's opaque backdrop, relative to `DIM_RULER_OFFSET`: the rect is 15 units
 *  tall and hangs from 8 above the line to 7 below it. Its extent along the normal is
 *  the same for both rulers — the right-hand one is the same rect rotated 90°. These
 *  are the numbers `PlanView` draws with, kept here so the check is about what is
 *  drawn. */
export const DIM_BACKDROP_ABOVE = 8;
export const DIM_BACKDROP_BELOW = 7;

/** Which way a wall's outward normal points, which is what decides whether a label
 *  reaches the ruler by its height or by its width. */
export type WallAxis = 'vertical-normal' | 'horizontal-normal';

/** A closed interval of outward distance from the wall, in plan user units. */
export type Band = { readonly lo: number; readonly hi: number };

/** The band a wall name occupies, measured along that wall's outward normal.
 *
 *  `vertical-normal` is the north/south case (the label reaches by its height);
 *  `horizontal-normal` is east/west (it reaches by its width). */
export function wallLabelBand(axis: WallAxis): Band {
  const half = axis === 'vertical-normal' ? LABEL_HALF_H : LABEL_HALF_W;
  return { lo: WALL_LABEL_OFFSET - half, hi: WALL_LABEL_OFFSET + half };
}

/** The band the dimension ruler occupies, backdrop included — the backdrop is the part
 *  that does the damage, so it is what the band describes. */
export function dimRulerBand(): Band {
  return { lo: DIM_RULER_OFFSET - DIM_BACKDROP_ABOVE, hi: DIM_RULER_OFFSET + DIM_BACKDROP_BELOW };
}

/** How far apart the two bands are on one axis. Negative means they overlap, and the
 *  magnitude is how deep. A number rather than a boolean so a test can say how much
 *  room there is rather than only that there is some. */
export function annotationGap(axis: WallAxis): number {
  const a = wallLabelBand(axis);
  const b = dimRulerBand();
  return Math.max(a.lo, b.lo) - Math.min(a.hi, b.hi);
}

/** Every axis there is, so a sweep cannot quietly check one of them. */
export const WALL_AXES = ['vertical-normal', 'horizontal-normal'] as const;

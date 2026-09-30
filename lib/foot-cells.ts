/**
 * Plan outlines that are not one box.
 *
 * Every piece's footprint is an oriented box (`lib/geometry.ts` `Foot`), or the
 * ellipse inscribed in it when the piece is round. The L-shaped desk is neither: it
 * fills two sides of its box and leaves the third corner open, and treating that
 * corner as desk is what refused the desk a room corner it fits around — the wall's
 * corner sits in the notch, every gate saw the notch as wood, and the drag said
 * "it would stick out of the room" about a desk that did not touch the wall.
 *
 * So the outline is authored HERE, once, as rectangles in the piece's own frame, and
 * three readers take it from here: `footFromPart` (containment, collision, picking,
 * the solver's costs), `PlanView` (the outline it draws) and `DeskGeo` (the tabletop
 * it builds). The renderer used to carry its own `0.52` and `0.42` — the same numbers
 * in a TSX file no test could reach, which is CLAUDE.md rule 2's corollary about a
 * renderer with its own idea of the piece's size.
 *
 * Leaf module on purpose: `geometry.ts` imports it, and it imports nothing but a type.
 */
import type { Shape } from './scene-spec';

/** How much of the desk's depth the long arm takes, against the back (−Z) edge. */
export const ELL_ARM_DEPTH = 0.52;
/** How much of the width the return takes, at the right-hand (+X) end. */
export const ELL_RETURN_WIDTH = 0.42;

/** A rectangle in the piece's own frame, metres. +Z is the piece's front. */
export type LocalRect = { x0: number; x1: number; z0: number; z1: number };

/** The rectangles a piece's footprint is made of, or `undefined` when it is its
 *  whole box. Disjoint, and together they reach all four sides of the box — so the
 *  box is still the exact answer to "how far does this reach towards that wall",
 *  and only the questions about the OPEN corner change. */
export function footCellsLocal(shape: Shape | undefined, w: number, d: number): LocalRect[] | undefined {
  if (shape !== 'desk-l') return undefined;
  const armD = d * ELL_ARM_DEPTH;
  const armW = w * ELL_RETURN_WIDTH;
  return [
    // The long arm, full width, along the back.
    { x0: -w / 2, x1: w / 2, z0: -d / 2, z1: -d / 2 + armD },
    // The return, filling the depth the arm leaves, at the right-hand end.
    { x0: w / 2 - armW, x1: w / 2, z0: -d / 2 + armD, z1: d / 2 },
  ];
}

/** The same footprint as one closed outline in the piece's frame, for drawing.
 *  `undefined` when the piece is its whole box. */
export function footOutlineLocal(shape: Shape | undefined, w: number, d: number): Array<[number, number]> | undefined {
  if (shape !== 'desk-l') return undefined;
  const armD = d * ELL_ARM_DEPTH;
  const armW = w * ELL_RETURN_WIDTH;
  return [
    [-w / 2, -d / 2],
    [w / 2, -d / 2],
    [w / 2, d / 2],
    [w / 2 - armW, d / 2],
    [w / 2 - armW, -d / 2 + armD],
    [-w / 2, -d / 2 + armD],
  ];
}

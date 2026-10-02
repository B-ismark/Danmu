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
 * the solver's costs), `PlanView` (the outline it draws) and `deskForm` (the tabletop
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

/** What a dining table's legs are: 55 mm square, their outer faces 40 mm inside the
 *  top's edge. */
export const DINING_LEG = { size: 0.055, inset: 0.04 } as const;
/** A dining table's top, the ease stepped in under it, and the apron hung from the ease,
 *  in metres. Their sum is the knee room a tucked chair is measured against
 *  (`surfaceKneeMM`, `lib/layout-rules.ts`), so the rail a chair is stopped by is the
 *  rail on screen. */
export const DINING_TOP = { top: 0.028, ease: 0.01, apron: 0.077 } as const;
/** A desk's top, and how far under it its lowest hung part reaches — the pencil drawer
 *  and the cable tray both stop at `hang` — in metres. `hang` is the knee room the tuck
 *  rule measures a chair against (`surfaceKneeMM`, `lib/layout-rules.ts`). */
export const DESK_TOP = { top: 0.025, hang: 0.075 } as const;
/** A coffee table's lower shelf, as shares of the height: its underside is the knee
 *  room an ottoman or stool slid under it has. */
export const COFFEE_SHELF = { lo: 0.25, hi: 0.3 } as const;
/** A desk's floor-standing members: the left side panel's thickness and the share of
 *  the long arm's depth it covers, and the two right-hand legs' size and inset. */
export const DESK_POSTS = { panel: 0.018, panelDepth: 0.88, leg: 0.05, legInset: 0.04 } as const;

/**
 * What a surface stands on, as rectangles in its own frame (metres, +Z its front) —
 * the legs and panels a seat tucked under it must not pass through.
 *
 * Authored here for the reason the outline above is: two readers must agree on it.
 * `diningTableForm` and `deskForm` (`lib/hard-goods.ts`) build their legs from these rectangles, and
 * `tuckedAt` (`lib/layout-rules.ts`) refuses a tuck whose seat footprint reaches one —
 * so the leg the chair is stopped by is the leg on screen, not a second copy of its
 * position that drifts. `[]` for a surface with nothing to pass through, or none the
 * tuck rule has to know about.
 */
export function surfacePostsLocal(shape: Shape | undefined, dining: boolean, w: number, d: number): LocalRect[] {
  const box = (cx: number, cz: number, sx: number, sz: number): LocalRect => ({ x0: cx - sx / 2, x1: cx + sx / 2, z0: cz - sz / 2, z1: cz + sz / 2 });
  if (shape === 'desk-standard' && dining) {
    const { size, inset } = DINING_LEG;
    const lx = w / 2 - inset - size / 2;
    const lz = d / 2 - inset - size / 2;
    return [
      box(-lx, -lz, size, size),
      box(lx, -lz, size, size),
      box(-lx, lz, size, size),
      box(lx, lz, size, size),
    ];
  }
  if (shape === 'desk-standard' || shape === 'desk-l') {
    const { panel, panelDepth, leg, legInset } = DESK_POSTS;
    const armD = shape === 'desk-l' ? d * ELL_ARM_DEPTH : d;
    const armZ = -d / 2 + armD / 2;
    return [
      box(-w / 2 + panel / 2, armZ, panel, armD * panelDepth),
      box(w / 2 - legInset, -d / 2 + legInset, leg, leg),
      box(w / 2 - legInset, d / 2 - legInset, leg, leg),
    ];
  }
  return [];
}

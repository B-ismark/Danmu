// The translucent base drawn under a selected, hovered or carried piece
// (`components/three/Highlight.tsx`): its size and where it sits, in the piece's
// own frame, in metres. Kept here so it can be tested without a canvas.
//
// It replaced an outlined bounding box, drawn through every wall, plus a footprint
// line, and the drag's dimension lines on top of that. A box AROUND a piece is a
// statement about the maths (this is the volume collision tests); a plinth UNDER it
// is a statement about the piece — that one, there, standing here — and it is the
// one cue that means the same thing held still, hovered, carried, and refused.
//
// It sits against whatever the piece is fixed to: on the floor (or the shelf it
// stands on) for a floor piece, against the plaster behind a wall piece, and up
// against the slab for a ceiling one. The piece covers most of it; the margin that
// shows round the edge is the cue.

import type { Anchor } from './physics';

export type SelectionBase = {
  /** Which surface the base lies against. */
  plane: 'floor' | 'ceiling' | 'wall';
  /** Its two lengths in that plane: across × along the floor (x × z), or across ×
   *  up the wall (x × y). */
  size: [number, number];
  /** How thick it is, off that surface. */
  thickness: number;
  /** Its corners' radius, in plan. */
  radius: number;
  /** How far it reaches past the piece on every side. */
  margin: number;
  /** The coordinate of its face against the surface: y for floor and ceiling, z
   *  for a wall. The base runs from here toward the room by `thickness`. */
  at: number;
};

/** Thick enough to read as a slab from the default camera, thin enough that a
 *  sofa does not look stood in a tray. */
export const BASE_THICKNESS = 0.024;
/** Off the floor by this much, so its underside does not flicker against it. */
export const BASE_LIFT = 0.002;

/** What shows past the piece: about a twelfth of its smaller side, never less than
 *  a finger-width on screen at room scale, never so much a vase looks plated. */
function marginFor(a: number, b: number): number {
  return Math.min(0.06, Math.max(0.02, 0.08 * Math.min(a, b)));
}

/** The base for a piece of this anchor and REAL size (mm, `[w, d, h]`). The frame
 *  is the one a piece's geometry is authored in: a floor piece's origin is its
 *  foot, everything else is centred on its origin, and the front is +Z. */
export function selectionBase(anchor: Anchor, sizeMM: [number, number, number]): SelectionBase {
  const w = sizeMM[0] / 1000;
  const d = sizeMM[1] / 1000;
  const h = sizeMM[2] / 1000;
  const wall = anchor.startsWith('wall');
  const [a, b] = wall ? [w, h] : [w, d];
  const margin = marginFor(a, b);
  const size: [number, number] = [a + 2 * margin, b + 2 * margin];
  const radius = Math.min(0.05, Math.min(size[0], size[1]) / 4);
  if (wall) return { plane: 'wall', size, thickness: BASE_THICKNESS, radius, margin, at: -d / 2 };
  if (anchor === 'ceiling') return { plane: 'ceiling', size, thickness: BASE_THICKNESS, radius, margin, at: h / 2 };
  return { plane: 'floor', size, thickness: BASE_THICKNESS, radius, margin, at: BASE_LIFT };
}

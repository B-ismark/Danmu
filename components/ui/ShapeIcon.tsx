// The drawing for a piece's shape, set in a small rounded chip — the mark at the
// start of a row in every list that names pieces. Decoration: the row's own text
// names the piece, so the drawing is hidden from assistive tech.

import { SHAPE_GLYPHS } from './shape-glyphs';
import type { Shape } from '@/lib/scene-spec';

export function ShapeIcon({ shape, size = 18 }: { shape: Shape; size?: number }) {
  // A saved room can hold a shape this build no longer knows; it gets the plain box
  // the 3D draws for it rather than nothing.
  const g = SHAPE_GLYPHS[shape] ?? SHAPE_GLYPHS.box;
  return (
    <span className="shape-chip" aria-hidden="true" data-shape={shape}>
      <svg
        width={size}
        height={size}
        viewBox={g.viewBox}
        focusable="false"
        // Static markup from shape-glyphs.ts, never anything a room or a file supplies.
        dangerouslySetInnerHTML={{ __html: g.body }}
      />
    </span>
  );
}

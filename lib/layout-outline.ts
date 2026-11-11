// The layout picker's drawings, derived from `footprintForLayout` — the function that
// builds the room — so a thumbnail cannot drift from the footprint it stands for.
import { footprintForLayout, type LayoutId } from './footprint';
import { polygonArea } from './geometry';

/** The fixed drawing box (SVG units) every outline is fitted into. */
export const VIEW = { w: 240, h: 180, pad: 20 };

/** Footprint polygon → SVG path in the fixed viewBox, preserving aspect, plus the box
 *  it was drawn in (for the dimension lines) and its real floor area.
 *
 *  `fit` is the size the scale is taken from, and defaults to the room's own: the large
 *  preview fills its box. A row of thumbnails passes the LARGEST of them instead, so the
 *  drawings share one scale and a 7.5 × 5.6 m Open Plan, which is a plain rectangle,
 *  reads as bigger than the 6 × 4 m Rectangle rather than as a copy of it. */
export function planFor(layout: LayoutId, w: number, d: number, fit: { w: number; d: number } = { w, d }) {
  const poly = footprintForLayout(layout, w, d);
  const innerW = VIEW.w - VIEW.pad * 2;
  const innerH = VIEW.h - VIEW.pad * 2;
  const scale = Math.min(innerW / fit.w, innerH / fit.d);
  const box = { x: (VIEW.w - w * scale) / 2, y: (VIEW.h - d * scale) / 2, w: w * scale, h: d * scale };
  const path =
    poly
      .map(([x, z], i) => {
        const px = box.x + (x + w / 2) * scale;
        const pz = box.y + (z + d / 2) * scale;
        return `${i === 0 ? 'M' : 'L'}${px.toFixed(1)} ${pz.toFixed(1)}`;
      })
      .join(' ') + ' Z';
  return { path, box, area: polygonArea(poly) };
}

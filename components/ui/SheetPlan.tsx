'use client';

// The landing sheet's drawing: the starter room in plan, as it opens.
//
// It is not an illustration of a room. It is the room that "Open the starter room"
// makes, drawn from the same preset (`ROOM_PRESETS`) and furnished by the same
// `buildSceneFromRoom` the studio runs, so the drawing and the room behind the
// third option cannot disagree. The dimensions are derived from the preset and set
// in the user's own unit. They are never typed beside the drawing (CLAUDE.md rule 2:
// a displayed measurement is derived). The scale bar is one metre at the drawing's
// own scale.
//
// The labels are HTML laid over the SVG at percentages, not SVG <text>. The drawing
// scales with its column, and SVG text would scale with it, down to 6px on a phone.
// HTML text stays on the type scale whatever the drawing does.

import { useMemo, type CSSProperties } from 'react';
import { buildSceneFromRoom } from '@/lib/scene-spec';
import { footprintBounds, footprintForLayout } from '@/lib/footprint';
import { planPaintOrder } from '@/lib/plan-hit';
import { PRESET_HEIGHT, presetById, type PresetId } from '@/lib/room-presets';
import { formatDim } from '@/lib/units';
import { useSettings } from '@/lib/store';
import type { RoomData } from '@/lib/storage';

// The drawing's own coordinate box. The margin leaves room for the two dimension
// strings (top and left) and the scale bar (bottom).
const VW = 600;
const VH = 440;
const M = { top: 54, right: 24, bottom: 70, left: 64 };
/** Wall thickness drawn, in metres: a plan convention, not a property of the room. */
const WALL_M = 0.12;

export function SheetPlan({ preset = 'rect' }: { preset?: PresetId }) {
  const unit = useSettings((s) => s.dimUnit);
  const p = presetById(preset);

  const parts = useMemo(() => {
    const room: RoomData = {
      id: `sheet-${p.id}`,
      createdAt: 0,
      name: p.starter,
      layoutId: p.id,
      width: p.width,
      depth: p.depth,
      height: PRESET_HEIGHT,
    };
    // Biggest first, as the 2D Plan paints, so the rug lies under the table
    // rather than over it.
    return planPaintOrder(buildSceneFromRoom(room));
  }, [p]);

  // Fitted to the outline's own bounds, not to ±width/2, so a footprint that is not
  // centred on the origin still lands inside the sheet with its dimensions true.
  const poly = footprintForLayout(p.id, p.width, p.depth);
  const b = footprintBounds(poly);
  const W = b.width;
  const D = b.depth;
  const k = Math.min((VW - M.left - M.right) / W, (VH - M.top - M.bottom) / D);
  const x0 = M.left + (VW - M.left - M.right - W * k) / 2;
  const y0 = M.top;
  const px = (x: number) => x0 + (x - b.minX) * k;
  const pz = (z: number) => y0 + (z - b.minZ) * k;
  const points = poly.map(([x, z]) => `${px(x).toFixed(1)},${pz(z).toFixed(1)}`).join(' ');
  const perimeter = poly.reduce((sum, [x, z], i) => {
    const [nx, nz] = poly[(i + 1) % poly.length];
    return sum + Math.hypot(nx - x, nz - z) * k;
  }, 0);
  const right = px(b.maxX);
  const bottom = pz(b.maxZ);

  const dim = (m: number) => `${formatDim(m * 1000, unit)} ${unit}`;
  const at = (x: number, y: number): CSSProperties => ({ left: `${(x / VW) * 100}%`, top: `${(y / VH) * 100}%` });

  // Dimension lines sit off the wall face by a fixed gap, with architectural ticks
  // (short 45° strokes) at each end, the way a drawing marks where a measure stops.
  const gap = 22;
  const dimTop = y0 - gap;
  const dimLeft = x0 - gap;
  const tick = (x: number, y: number) => `M${x - 5},${y + 5} L${x + 5},${y - 5}`;
  const barY = bottom + 40;
  const barX = x0;

  const label = `Floor plan of the starter ${p.starter.toLowerCase()}: ${dim(W)} by ${dim(D)}, ${parts.length} pieces including its door and windows`;

  return (
    <div className="landing-plan">
      <svg viewBox={`0 0 ${VW} ${VH}`} role="img" aria-label={label} className="landing-plan__svg">
        {/* Floor, then walls, then furniture. A door or window rides the wall's inner
            face, which is where the wall's stroke is centred, so drawn after the walls
            it reads as an opening in them instead of vanishing under the line. */}
        <polygon className="landing-plan__floor" points={points} />
        <polygon
          className="landing-plan__walls"
          points={points}
          strokeWidth={WALL_M * k}
          // The draw-on animation dashes the outline by its own length. `pathLength`
          // would be simpler and Chromium ignores it for a CSS dasharray on a polygon.
          style={{ '--perimeter': perimeter.toFixed(1) } as CSSProperties}
        />
        <g className="landing-plan__parts">
          {parts.map((part) => {
            const w = (part.dimMM[0] / 1000) * k;
            const d = (part.dimMM[1] / 1000) * k;
            const rot = -(part.rot * 180) / Math.PI;
            return (
              <g key={part.id} transform={`translate(${px(part.pos[0]).toFixed(1)} ${pz(part.pos[2]).toFixed(1)}) rotate(${rot.toFixed(1)})`}>
                {part.circle ? <circle r={w / 2} /> : <rect x={-w / 2} y={-d / 2} width={w} height={d} />}
              </g>
            );
          })}
        </g>
        <g className="landing-plan__dims">
          <path d={`M${x0},${dimTop} H${right} ${tick(x0, dimTop)} ${tick(right, dimTop)} M${x0},${dimTop - 8} V${y0 - 6} M${right},${dimTop - 8} V${y0 - 6}`} />
          <path d={`M${dimLeft},${y0} V${bottom} ${tick(dimLeft, y0)} ${tick(dimLeft, bottom)} M${dimLeft - 8},${y0} H${x0 - 6} M${dimLeft - 8},${bottom} H${x0 - 6}`} />
          {/* Scale bar: one metre, split in half, at this drawing's scale. */}
          <rect x={barX} y={barY} width={k / 2} height={5} className="landing-plan__bar-fill" />
          <rect x={barX + k / 2} y={barY} width={k / 2} height={5} />
        </g>
      </svg>
      <span className="landing-plan__label landing-plan__label--top mono" style={at((x0 + right) / 2, dimTop)} aria-hidden="true">
        {dim(W)}
      </span>
      <span className="landing-plan__label landing-plan__label--left mono" style={at(dimLeft, (y0 + bottom) / 2)} aria-hidden="true">
        {dim(D)}
      </span>
      <span className="landing-plan__label landing-plan__label--bar mono" style={at(barX + k, barY + 2.5)} aria-hidden="true">
        {dim(1)}
      </span>
    </div>
  );
}

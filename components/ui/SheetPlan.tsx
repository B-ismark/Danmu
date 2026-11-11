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
import { footprintForLayout } from '@/lib/footprint';
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
    return buildSceneFromRoom(room);
  }, [p]);

  const W = p.width;
  const D = p.depth;
  const poly = footprintForLayout(p.id, W, D);
  const k = Math.min((VW - M.left - M.right) / W, (VH - M.top - M.bottom) / D);
  const x0 = M.left + (VW - M.left - M.right - W * k) / 2;
  const y0 = M.top;
  const px = (x: number) => x0 + (x + W / 2) * k;
  const pz = (z: number) => y0 + (z + D / 2) * k;
  const points = poly.map(([x, z]) => `${px(x).toFixed(1)},${pz(z).toFixed(1)}`).join(' ');
  const perimeter = poly.reduce((sum, [x, z], i) => {
    const [nx, nz] = poly[(i + 1) % poly.length];
    return sum + Math.hypot(nx - x, nz - z) * k;
  }, 0);
  const right = px(W / 2);
  const bottom = pz(D / 2);

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

  const label = `Floor plan of the starter ${p.starter.toLowerCase()}: ${dim(W)} by ${dim(D)}, ${parts.length} pieces of furniture`;

  return (
    <div className="landing-plan">
      <svg viewBox={`0 0 ${VW} ${VH}`} role="img" aria-label={label} className="landing-plan__svg">
        {/* Floor, then furniture, then the walls on top, so a piece that rides a
            wall (a window, a door) sits in the wall's line rather than under the floor. */}
        <polygon className="landing-plan__floor" points={points} />
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
        <polygon
          className="landing-plan__walls"
          points={points}
          strokeWidth={WALL_M * k}
          // The draw-on animation dashes the outline by its own length. `pathLength`
          // would be simpler and Chromium ignores it for a CSS dasharray on a polygon.
          style={{ '--perimeter': perimeter.toFixed(1) } as CSSProperties}
        />
        <g className="landing-plan__dims">
          <path d={`M${x0},${dimTop} H${right} ${tick(x0, dimTop)} ${tick(right, dimTop)} M${x0},${dimTop - 8} V${y0 - 6} M${right},${dimTop - 8} V${y0 - 6}`} />
          <path d={`M${dimLeft},${y0} V${bottom} ${tick(dimLeft, y0)} ${tick(dimLeft, bottom)} M${dimLeft - 8},${y0} H${x0 - 6} M${dimLeft - 8},${bottom} H${x0 - 6}`} />
          {/* Scale bar: one metre, split in half, at this drawing's scale. */}
          <rect x={barX} y={barY} width={k / 2} height={5} className="landing-plan__bar-fill" />
          <rect x={barX + k / 2} y={barY} width={k / 2} height={5} />
        </g>
      </svg>
      <span className="landing-plan__label landing-plan__label--top mono" style={at((x0 + right) / 2, dimTop)}>
        {dim(W)}
      </span>
      <span className="landing-plan__label landing-plan__label--left mono" style={at(dimLeft, (y0 + bottom) / 2)}>
        {dim(D)}
      </span>
      <span className="landing-plan__label landing-plan__label--bar mono" style={at(barX + k, barY + 2.5)} aria-hidden="true">
        {dim(1)}
      </span>
    </div>
  );
}

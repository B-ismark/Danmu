'use client';

// Live measurement guides — while a part is being dragged, draw dimension
// lines from its footprint to the nearest wall in all four world directions,
// labelled in the user's display unit, plus the part's own W×D size tag.
// Pure geometry (ray-to-footprint-boundary), recomputed per drag tick from the
// lightweight drag-live channel, so the rest of the scene never re-renders.

import { useMemo } from 'react';
import { Line, Html } from '@react-three/drei';
import { useScene } from '@/lib/scene-store';
import { useSettings, useStudio } from '@/lib/store';
import { useDragLive } from '@/lib/drag-live';
import { rayToBoundary, obbExtentAlong, obbFromPart } from '@/lib/geometry';
import { aabbExtents } from '@/lib/item-snap';
import { formatDim } from '@/lib/units';

const GUIDE_Y = 0.02;
const DIRS: Array<[number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

export function MeasureGuides() {
  const live = useDragLive((s) => s.live);
  const footprint = useScene((s) => s.room.footprint);
  const parts = useScene((s) => s.parts);
  const dimUnit = useSettings((s) => s.dimUnit);

  const guides = useMemo(() => {
    if (!live) return [];
    const obb = obbFromPart([live.x, live.y, live.z], live.rot, live.dimMM);
    // Effective transforms so gaps measure to where furniture ACTUALLY is.
    const { positions, rotations, dims } = useStudio.getState();
    const out: Array<{ from: [number, number, number]; to: [number, number, number]; label: string; toFurniture: boolean }> = [];
    for (const [dx, dz] of DIRS) {
      const ext = obbExtentAlong(obb, dx, dz);
      const wall = rayToBoundary(live.x, live.z, dx, dz, footprint);
      if (!Number.isFinite(wall)) continue;

      // Nearest furniture edge along this direction — walkway width beats
      // wall distance when something stands in between.
      let nearest = wall;
      let toFurniture = false;
      for (const o of parts) {
        if (o.id === live.partId || o.wallMounted || o.category === 'rug') continue;
        const op = positions[o.id] ?? o.pos;
        const orot = rotations[o.id] ?? o.rot;
        const odim = dims[o.id] ?? o.dimMM;
        const oe = aabbExtents(orot, odim);
        // Cross-axis corridor check: the neighbour must overlap the mover's
        // swept band for the gap to be a real walkway.
        const crossOverlap =
          dx !== 0
            ? Math.abs(live.z - op[2]) < obbExtentAlong(obb, 0, 1) + oe.ez
            : Math.abs(live.x - op[0]) < obbExtentAlong(obb, 1, 0) + oe.ex;
        if (!crossOverlap) continue;
        const along = dx !== 0 ? (op[0] - live.x) * dx : (op[2] - live.z) * dz;
        const nearEdge = along - (dx !== 0 ? oe.ex : oe.ez);
        if (along > 0 && nearEdge < nearest) {
          nearest = nearEdge;
          toFurniture = true;
        }
      }

      const gap = nearest - ext;
      if (gap < 0.005 || gap > 30) continue; // flush / outside
      const fx = live.x + dx * ext;
      const fz = live.z + dz * ext;
      out.push({
        from: [fx, GUIDE_Y, fz],
        to: [live.x + dx * nearest, GUIDE_Y, live.z + dz * nearest],
        label: formatDim(gap * 1000, dimUnit),
        toFurniture,
      });
    }
    return out;
  }, [live, footprint, parts, dimUnit]);

  if (!live) return null;

  const color = live.valid ? '#3E8FD8' : '#D2402E';

  return (
    <group userData={{ helper: true }}>
      {/* Item-to-item alignment guides — solid green when edges/centres lock. */}
      {(live.snapLines ?? []).map((s, i) => (
        <Line
          key={`snap-${i}`}
          points={
            s.axis === 'x'
              ? [[s.at, GUIDE_Y, s.span[0] - 0.15], [s.at, GUIDE_Y, s.span[1] + 0.15]]
              : [[s.span[0] - 0.15, GUIDE_Y, s.at], [s.span[1] + 0.15, GUIDE_Y, s.at]]
          }
          color={s.kind === 'center' ? '#27A06A' : '#1E9E54'}
          lineWidth={s.kind === 'center' ? 1.2 : 1.6}
          dashed={s.kind === 'center'}
          dashSize={0.08}
          gapSize={0.05}
          transparent
          opacity={0.95}
        />
      ))}
      {guides.map((g, i) => (
        <group key={i}>
          <Line points={[g.from, g.to]} color={color} lineWidth={1.2} dashed dashSize={0.06} gapSize={0.04} transparent opacity={0.9} />
          <Html
            position={[(g.from[0] + g.to[0]) / 2, GUIDE_Y + 0.02, (g.from[2] + g.to[2]) / 2]}
            center
            zIndexRange={[20, 0]}
            style={{ pointerEvents: 'none' }}
          >
            <div
              style={{
                fontFamily: 'var(--font-mono, monospace)',
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: '0.04em',
                color: '#fff',
                background: color,
                padding: '1px 5px',
                borderRadius: 3,
                whiteSpace: 'nowrap',
              }}
            >
              {g.label} {dimUnit}
            </div>
          </Html>
        </group>
      ))}

      {/* The part's own size tag floats over its top. */}
      <Html
        position={[live.x, live.y + (live.floor ? live.dimMM[2] / 1000 : live.dimMM[2] / 2000) + 0.18, live.z]}
        center
        zIndexRange={[20, 0]}
        style={{ pointerEvents: 'none' }}
      >
        <div
          style={{
            fontFamily: 'var(--font-mono, monospace)',
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '0.04em',
            color: live.valid ? '#1c1c1a' : '#fff',
            background: live.valid ? 'rgba(255,255,255,0.92)' : '#D2402E',
            border: `1px solid ${color}`,
            padding: '2px 7px',
            borderRadius: 3,
            whiteSpace: 'nowrap',
          }}
        >
          {formatDim(live.dimMM[0], dimUnit)} × {formatDim(live.dimMM[1], dimUnit)} {dimUnit}
          {!live.valid && ' · blocked'}
        </div>
      </Html>
    </group>
  );
}

'use client';

// Tiny top-down plan thumbnail rendered from cached scene parts.
// Used by workspace cards. Pure SVG — no react-three.

import { useEffect, useState } from 'react';
import { roomStore } from '@/lib/storage';
import type { ScenePart } from '@/lib/scene-spec';
import type { RoomData } from '@/lib/storage';

export function PlanThumb({ roomId }: { roomId: string }) {
  const [room, setRoom] = useState<RoomData | null>(null);
  const [parts, setParts] = useState<ScenePart[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await roomStore.loadRoom(roomId);
      const p = await roomStore.loadSceneParts<ScenePart[]>(roomId);
      if (cancelled) return;
      setRoom(r ?? null);
      setParts(p ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [roomId]);

  if (!room) {
    return (
      <div
        style={{
          aspectRatio: '4/3',
          background: 'var(--paper-2)',
          borderBottom: '1px solid var(--hairline)',
        }}
      />
    );
  }

  const W = room.width;
  const D = room.depth;
  const PAD = 12;
  const VW = 240;
  const VH = 180;
  const scale = Math.min((VW - PAD * 2) / W, (VH - PAD * 2) / D);
  const ox = (VW - W * scale) / 2;
  const oy = (VH - D * scale) / 2;

  return (
    <div style={{ position: 'relative', aspectRatio: `${VW}/${VH}`, background: 'var(--paper-2)', borderBottom: '1px solid var(--hairline)', overflow: 'hidden' }}>
      <svg viewBox={`0 0 ${VW} ${VH}`} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
        <defs>
          <pattern id={`thumbgrid-${roomId}`} width="8" height="8" patternUnits="userSpaceOnUse">
            <path d="M 8 0 L 0 0 0 8" fill="none" stroke="rgba(19,19,17,0.06)" strokeWidth="0.5" />
          </pattern>
        </defs>
        <rect width={VW} height={VH} fill="url(#thumbgrid-${roomId})" />
        <rect
          x={ox}
          y={oy}
          width={W * scale}
          height={D * scale}
          fill="var(--paper)"
          stroke="var(--ink)"
          strokeWidth="1.5"
        />
        {(parts ?? []).map((p) => {
          const px = ox + (p.pos[0] + W / 2) * scale;
          const py = oy + (p.pos[2] + D / 2) * scale;
          const wpx = (p.dimMM[0] / 1000) * scale;
          const dpx = (p.dimMM[1] / 1000) * scale;
          const color = p.locked ? '#2B6FD4' : '#E2613A';
          const fill = p.locked ? 'rgba(43,111,212,0.18)' : 'rgba(232,84,42,0.14)';
          const rotDeg = -(p.rot * 180) / Math.PI;
          return (
            <g key={p.id} transform={`translate(${px} ${py}) rotate(${rotDeg})`}>
              {p.circle ? (
                <circle r={Math.max(2, wpx / 2)} fill={fill} stroke={color} strokeWidth="0.8" />
              ) : (
                <rect
                  x={-wpx / 2}
                  y={-dpx / 2}
                  width={Math.max(2, wpx)}
                  height={Math.max(2, dpx)}
                  fill={fill}
                  stroke={color}
                  strokeWidth="0.8"
                  strokeDasharray={p.locked ? undefined : '2 1.5'}
                />
              )}
            </g>
          );
        })}
      </svg>
      {(!parts || parts.length === 0) && (
        <div
          className="ds-label"
          style={{
            position: 'absolute',
            inset: 0,
            display: 'grid',
            placeItems: 'center',
            color: 'var(--ink-3)',
            fontSize: 9,
          }}
        >
          No parts yet
        </div>
      )}
    </div>
  );
}

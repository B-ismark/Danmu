'use client';

// Tiny top-down plan thumbnail rendered from cached scene parts.
// Used by workspace cards. Pure SVG — no react-three.

import { useEffect, useState } from 'react';
import { roomStore } from '@/lib/storage';
import type { ScenePart } from '@/lib/scene-spec';
import type { RoomData } from '@/lib/storage';

// Viewport of the drawing, and therefore the card's picture height: a card is
// ~220–280px wide, so a 4:3 thumb spent ~200px of vertical on letterboxing and
// pushed the second row of rooms below the fold. 8:5 is short enough that two
// cards sit in one screen; the plan itself is still fitted, never cropped.
const VW = 240;
const VH = 150;
const PAD = 12;

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
    // Same box as the loaded state — a placeholder of a different height makes
    // every card jump when the plan arrives.
    return (
      <div
        style={{
          aspectRatio: `${VW}/${VH}`,
          background: 'var(--paper-2)',
          borderBottom: '1px solid var(--hairline)',
        }}
      />
    );
  }

  const W = room.width;
  const D = room.depth;
  const scale = Math.min((VW - PAD * 2) / W, (VH - PAD * 2) / D);
  const ox = (VW - W * scale) / 2;
  const oy = (VH - D * scale) / 2;

  // This SVG carries information (room proportions, how full the room is), so it
  // is an image with a description — not decoration a screen reader can skip.
  const count = parts?.length ?? 0;
  const label = `Floor plan — ${W.toFixed(1)} by ${D.toFixed(1)} metres, ${
    count === 0 ? 'nothing in it yet' : count === 1 ? '1 piece of furniture' : `${count} pieces of furniture`
  }`;

  return (
    <div style={{ position: 'relative', aspectRatio: `${VW}/${VH}`, background: 'var(--paper-2)', borderBottom: '1px solid var(--hairline)', overflow: 'hidden' }}>
      <svg
        role="img"
        aria-label={label}
        viewBox={`0 0 ${VW} ${VH}`}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
      >
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
          const color = p.locked ? 'var(--locked)' : 'var(--accent)';
          const fill = p.locked ? 'var(--locked-tint)' : 'var(--accent-tint)';
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
        // Speaks to someone decorating, not to the data model ("No parts yet").
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'grid',
            placeItems: 'center',
            color: 'var(--ink-3)',
            fontSize: 11,
            fontWeight: 600,
          }}
        >
          Empty room — open it to start
        </div>
      )}
    </div>
  );
}

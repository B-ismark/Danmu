'use client';

// Tiny top-down plan thumbnail rendered from cached scene parts.
// Used by workspace cards. Pure SVG — no react-three.

import { useEffect, useState } from 'react';
import { roomStore } from '@/lib/storage';
import { footprintBounds, footprintForLayout, type Footprint } from '@/lib/footprint';
import type { ScenePart } from '@/lib/scene-spec';
import { normalizeStoredParts } from '@/lib/scene-spec';
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
      // Re-derived, like the studio load path. A thumbnail drawing the mount flag one
      // way while the studio draws it the other is the two-plans-disagree shape again.
      setParts(p ? normalizeStoredParts(p) : null);
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

  // The room's actual SHAPE. This drew a `<rect>` from width and depth alone and never
  // read `layoutId` or `footprint` at all, so every saved room came back a rectangle on
  // its card — an L, a T and a U all looked like the same room, and furniture standing
  // in the quadrant an L cuts away looked like it was on the floor.
  //
  // `footprint` first because it is the override: it is written after independent wall
  // moves and the studio treats it as authoritative when present (see `RoomData`).
  // `layoutId` is the fallback and is always present, which is what makes this work for
  // the rooms nobody has dragged a wall in — that is nearly all of them, and it is why
  // reading only `footprint` would have looked like a fix and changed almost nothing.
  const poly: Footprint = (room.footprint as Footprint | undefined) ?? footprintForLayout(room.layoutId, W, D);

  // Fitted to the polygon's BOUNDS rather than to width × depth. Those agree for a
  // preset and stop agreeing the moment a wall is moved: a footprint can end up
  // off-centre, and `±W / 2` is then the wrong origin for the outline and for every
  // piece of furniture in it. Same reason `resolvePlacement` reads the bounds.
  const b = footprintBounds(poly);
  const spanX = Math.max(b.maxX - b.minX, 0.001);
  const spanZ = Math.max(b.maxZ - b.minZ, 0.001);
  const scale = Math.min((VW - PAD * 2) / spanX, (VH - PAD * 2) / spanZ);
  const ox = (VW - spanX * scale) / 2;
  const oy = (VH - spanZ * scale) / 2;
  /** Metres in the room's own frame → pixels in the thumbnail. One function, so the
   *  outline and the furniture cannot end up on different origins. */
  const px = (x: number) => ox + (x - b.minX) * scale;
  const pz = (z: number) => oy + (z - b.minZ) * scale;

  // This SVG carries information (room proportions, how full the room is), so it
  // is an image with a description — not decoration a screen reader can skip.
  const count = parts?.length ?? 0;
  // The shape is named when it is not a plain rectangle, because the two numbers
  // describe the bounding box and for an L or a U that is not the room. 'open' is a
  // rectangle in `footprintForLayout`, so it adds nothing and is absent here.
  const SHAPE_WORD: Partial<Record<RoomData['layoutId'], string>> = {
    l: 'L-shaped, ',
    t: 'T-shaped, ',
    u: 'U-shaped, ',
    custom: 'custom shape, ',
  };
  const label = `Floor plan — ${SHAPE_WORD[room.layoutId] ?? ''}${W.toFixed(1)} by ${D.toFixed(1)} metres, ${
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
        {/* The footprint, not a rectangle. `polygon` closes itself, so an L, a T and a
            U each draw their own notch and the card stops claiming every room is a
            box. */}
        <polygon
          points={poly.map(([x, z]) => `${px(x)},${pz(z)}`).join(' ')}
          fill="var(--paper)"
          stroke="var(--ink)"
          strokeWidth="1.5"
        />
        {(parts ?? []).map((p) => {
          const cx = px(p.pos[0]);
          const py = pz(p.pos[2]);
          const wpx = (p.dimMM[0] / 1000) * scale;
          const dpx = (p.dimMM[1] / 1000) * scale;
          const color = p.locked ? 'var(--locked)' : 'var(--accent)';
          const fill = p.locked ? 'var(--locked-tint)' : 'var(--accent-tint)';
          const rotDeg = -(p.rot * 180) / Math.PI;
          return (
            <g key={p.id} transform={`translate(${cx} ${py}) rotate(${rotDeg})`}>
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

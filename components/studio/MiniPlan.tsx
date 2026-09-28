'use client';

import { footprintBounds, type Footprint } from '@/lib/footprint';
import { ridesWall } from '@/lib/physics';
import type { ScenePart } from '@/lib/scene-spec';

/** The drawing's box in viewBox units: 84 wide and as deep as the room's
 *  proportions ask, never under 36. Exported for the ideas gallery's placeholders,
 *  so a thumbnail arriving in a card does not change the card's height. */
export function miniPlanBox(footprint: Footprint): { W: number; H: number } {
  const b = footprintBounds(footprint);
  const W = 84;
  return { W, H: Math.max(36, Math.round((W * b.depth) / Math.max(0.1, b.width))) };
}

/** Tiny top-down floor plan: the footprint outline and a rectangle per floor piece.
 *
 *  Two callers. The Layouts tab draws it at a fixed 84px beside each saved layout;
 *  the ideas gallery draws it FLUID, filling its card, which is why the drawing is
 *  a `viewBox` at 84 units and the strokes are non-scaling — a card three times as
 *  wide would otherwise draw its walls three times as heavy.
 *
 *  `moved`, when given, is what an idea changes: those pieces take the accent and
 *  everything else goes quiet, so four thumbnails side by side read as four
 *  different moves rather than four near-identical rooms. Without it every piece
 *  is drawn in its own colour, as the Layouts tab always has. */
export function MiniPlan({
  parts,
  footprint,
  width = 84,
  fluid = false,
  moved,
}: {
  parts: readonly ScenePart[];
  footprint: Footprint;
  width?: number;
  fluid?: boolean;
  moved?: ReadonlySet<string>;
}) {
  const b = footprintBounds(footprint);
  const { W, H } = miniPlanBox(footprint);
  const s = Math.min(W / b.width, H / b.depth);
  const px = (x: number) => (x - b.minX) * s + (W - b.width * s) / 2;
  const pz = (z: number) => (z - b.minZ) * s + (H - b.depth * s) / 2;
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width={fluid ? '100%' : width}
      height={fluid ? undefined : Math.round((width * H) / W)}
      aria-hidden="true"
      style={{
        display: 'block',
        flexShrink: 0,
        background: 'var(--paper)',
        border: '1px solid var(--hairline-strong)',
        borderRadius: 'var(--r-1)',
      }}
    >
      <polygon
        points={footprint.map(([x, z]) => `${px(x)},${pz(z)}`).join(' ')}
        fill="var(--paper-2)"
        stroke="var(--ink-3)"
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
      />
      {parts
        // `ridesWall`, like `lib/plan-export.ts`. Asking `wallMounted` here dropped the
        // ceiling family out of every layout thumbnail while the exported PNG listed it
        // with a number and a legend row — the same room, two plans, disagreeing about
        // whether a 1 m ceiling fan is in it.
        .filter((p) => !ridesWall(p.category, p.shape))
        // Rugs first and drawn as an outline: a rug lies UNDER the furniture on it,
        // and a filled one reads as the sofa and the rug overlapping, which is the
        // one thing an arrangement thumbnail must not appear to show.
        .sort((a, b) => Number(b.category === 'rug') - Number(a.category === 'rug'))
        .map((p) => {
          const w = (p.dimMM[0] / 1000) * s;
          const d = (p.dimMM[1] / 1000) * s;
          const lit = moved ? moved.has(p.id) : true;
          const rug = p.category === 'rug';
          return (
            <rect
              key={p.id}
              x={px(p.pos[0]) - w / 2}
              y={pz(p.pos[2]) - d / 2}
              width={w}
              height={d}
              transform={`rotate(${(-p.rot * 180) / Math.PI} ${px(p.pos[0])} ${pz(p.pos[2])})`}
              fill={rug ? 'none' : moved ? (lit ? 'var(--accent)' : 'var(--paper-3)') : (p.color ?? 'var(--accent)')}
              fillOpacity={moved ? (lit ? 0.75 : 1) : 0.55}
              stroke={rug && lit && moved ? 'var(--accent-text)' : lit ? 'var(--ink-2)' : 'var(--ink-4)'}
              strokeWidth={0.75}
              strokeDasharray={rug ? '2 1.5' : undefined}
              vectorEffect="non-scaling-stroke"
            />
          );
        })}
    </svg>
  );
}

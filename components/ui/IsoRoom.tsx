// A room drawn in isometric: floor, the two far walls, and a few blocks of
// furniture. An illustration, not a plan — nothing in it is measured, and it is
// hidden from assistive tech. The empty Rooms page shows it as its hero.
//
// Colours are the `--art-*` tokens, so the drawing follows the palette. Shading
// is a brightness filter on the two side faces rather than a second colour per
// piece, which is what keeps it to one token each.

import type { CSSProperties } from 'react';

export type IsoPiece = {
  /** Footprint in the room's own units, from the far corner. */
  x: number;
  y: number;
  w: number;
  d: number;
  /** Height; a `flat` piece (a rug) ignores it and draws its top only. */
  h: number;
  tone: 1 | 2 | 3 | 4 | 5;
  flat?: boolean;
};

export type IsoRoomSize = { w: number; d: number; h: number };

const VW = 560;
const VH = 420;
const MARGIN = 26;
const COS30 = 0.866;

/** `settle`: each piece drops into place in turn (`.iso-room__piece` in globals.css),
 *  for the screen that shows while a room is being built. */
export function IsoRoom({ room, pieces, settle = false }: { room: IsoRoomSize; pieces: IsoPiece[]; settle?: boolean }) {
  const { w: W, d: D, h: H } = room;
  const k = Math.min((VW - 2 * MARGIN) / ((W + D) * COS30), (VH - 2 * MARGIN) / ((W + D) * 0.5 + H));
  const ox = MARGIN + D * COS30 * k + (VW - 2 * MARGIN - (W + D) * COS30 * k) / 2;
  const oy = MARGIN + H * k + (VH - 2 * MARGIN - ((W + D) * 0.5 + H) * k) / 2;
  const P = (x: number, y: number, z: number) =>
    `${(ox + (x - y) * COS30 * k).toFixed(1)},${(oy + (x + y) * 0.5 * k - z * k).toFixed(1)}`;
  const pts = (...p: string[]) => p.join(' ');
  // Painter's order: the piece whose far-from-viewer corner is nearest the back
  // is drawn first, so nearer pieces overlap it.
  const sorted = [...pieces].sort((a, b) => a.x + a.w + a.y + a.d - (b.x + b.w + b.y + b.d));

  return (
    <svg viewBox={`0 0 ${VW} ${VH}`} aria-hidden="true" focusable="false" style={{ width: '100%', height: '100%', display: 'block' }}>
      <polygon points={pts(P(0, 0, 0), P(W, 0, 0), P(W, D, 0), P(0, D, 0))} fill="var(--art-floor)" />
      <polygon points={pts(P(0, 0, 0), P(W, 0, 0), P(W, 0, H), P(0, 0, H))} fill="var(--art-wall-n)" />
      <polygon points={pts(P(0, 0, 0), P(0, D, 0), P(0, D, H), P(0, 0, H))} fill="var(--art-wall-w)" />
      {sorted.map((p, i) => {
        const z1 = p.flat ? 1.5 : p.h;
        const x2 = p.x + p.w;
        const y2 = p.y + p.d;
        const fill = `var(--art-${p.tone})`;
        return (
          <g key={i} className={settle ? 'iso-room__piece' : undefined} style={settle ? ({ '--i': i } as CSSProperties) : undefined}>
            <polygon points={pts(P(p.x, p.y, z1), P(x2, p.y, z1), P(x2, y2, z1), P(p.x, y2, z1))} fill={fill} />
            {!p.flat && (
              <>
                <polygon points={pts(P(p.x, y2, 0), P(x2, y2, 0), P(x2, y2, z1), P(p.x, y2, z1))} fill={fill} style={{ filter: 'brightness(0.84)' }} />
                <polygon points={pts(P(x2, p.y, 0), P(x2, y2, 0), P(x2, y2, z1), P(x2, p.y, z1))} fill={fill} style={{ filter: 'brightness(0.68)' }} />
              </>
            )}
          </g>
        );
      })}
    </svg>
  );
}

/** The living room the empty Rooms page draws: a rug, a sofa on the far wall, a
 *  tall cabinet, a coffee table, an armchair, a floor lamp and a plant. */
export const HERO_ROOM: IsoRoomSize = { w: 420, d: 420, h: 280 };
export const HERO_PIECES: IsoPiece[] = [
  { x: 98, y: 147, w: 210, d: 147, h: 3, tone: 3, flat: true },
  { x: 84, y: 8, w: 196, d: 78, h: 56, tone: 1 },
  { x: 8, y: 126, w: 42, d: 134, h: 154, tone: 2 },
  { x: 147, y: 118, w: 101, d: 64, h: 31, tone: 2 },
  { x: 300, y: 210, w: 78, d: 78, h: 59, tone: 1 },
  { x: 17, y: 42, w: 20, d: 20, h: 133, tone: 4 },
  { x: 367, y: 25, w: 36, d: 36, h: 87, tone: 5 },
];

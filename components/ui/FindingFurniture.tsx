// The waiting picture on the scan review's "Finding your furniture" card: a few pieces of
// furniture drawn as outlines, one after another, with a magnifier moving to each as it
// is drawn, and each outline filling briefly with its own piece colour as it is "found".
//
// It is decoration and says nothing the screen does not already say: no count of what was
// found (nothing reports one while the work runs), no percentage, no time. Its lines name
// the steps the code really takes — look through the photos, outline what is there,
// measure it against the floor — and cycle on the same clock as the drawing, so they are
// CSS and not a timer that could drift from it. Reduced motion shows the finished drawing
// and one fixed line (globals.css, `.ff`).

import type { CSSProperties } from 'react';
import { pieceColor } from '@/lib/piece-colors';

type Piece = {
  name: string;
  /** Where the magnifier rests while this one is drawn, in the drawing's own units.
   *  The same numbers are the `ff-lens` keyframes in globals.css. */
  at: [number, number];
  /** The outline, and the closed silhouette that takes the tint. */
  line: string;
  body: string;
  /** The dashed box a finder would put round it. */
  box: [number, number, number, number];
};

// Every shape is a few hand-bent curves rather than a ruled box: the point is that someone
// is drawing the room, not that a CAD export is loading.
const PIECES: Piece[] = [
  {
    name: 'sofa',
    at: [66, 128],
    line: 'M16 134 Q15 112 36 111 H100 Q121 112 120 134 M10 150 Q10 138 24 138 H112 Q126 138 126 150 V166 H10 Z M22 166 V172 M114 166 V172',
    body: 'M10 150 Q10 138 24 138 H112 Q126 138 126 150 V166 H10 Z',
    box: [6, 106, 124, 68],
  },
  {
    name: 'side table',
    at: [150, 140],
    line: 'M138 130 Q150 126 162 130 M140 130 V172 M160 130 V172 M140 150 H160',
    body: 'M138 130 Q150 126 162 130 V136 H138 Z',
    box: [134, 122, 32, 52],
  },
  {
    name: 'armchair',
    at: [200, 130],
    line: 'M178 136 Q176 110 194 109 H206 Q224 110 222 136 M172 152 Q172 140 184 140 H216 Q228 140 228 152 V166 H172 Z M180 166 V172 M220 166 V172',
    body: 'M172 152 Q172 140 184 140 H216 Q228 140 228 152 V166 H172 Z',
    box: [168, 104, 64, 70],
  },
  {
    name: 'lamp',
    at: [252, 112],
    line: 'M242 66 H262 L268 92 H236 Z M252 92 V168 M240 170 Q252 164 264 170',
    body: 'M242 66 H262 L268 92 H236 Z',
    box: [232, 60, 40, 114],
  },
  {
    name: 'plant',
    at: [296, 134],
    line: 'M284 142 H304 L300 170 H288 Z M294 142 Q278 126 284 106 Q297 118 294 142 M294 142 Q293 114 298 96 Q309 118 294 142 M294 142 Q313 130 315 112 Q301 114 294 142',
    body: 'M284 142 H304 L300 170 H288 Z',
    box: [278, 92, 42, 82],
  },
];

/** What each beat says, in step with the drawing: one line per piece being looked for, then
 *  the measuring. The last is the one a reduced-motion reader is left with, so it is the
 *  one that is true of the whole step. */
const LINES = [
  'Looking for the sofa…',
  'Looking for a side table…',
  'Looking for an armchair…',
  'Looking for a lamp…',
  'Looking for a plant…',
  'Measuring against the floor…',
];

const vars = (v: Record<string, string | number>) => v as CSSProperties;

export function FindingFurniture({ photos }: { photos?: number }) {
  return (
    <div className="ff" data-beats={LINES.length}>
      <svg className="ff__art" viewBox="0 54 330 138" aria-hidden="true" focusable="false">
        {/* The room: a floor line, and a measuring line under it that only the last
            beat draws. */}
        <line className="ff__floor" x1="0" y1="174" x2="330" y2="174" />
        <line className="ff__ruler" x1="10" y1="184" x2="320" y2="184" pathLength={1} />
        {PIECES.map((p, i) => (
          <g key={p.name} className="ff__piece" style={vars({ '--i': i, '--piece': pieceColor(i) })}>
            <rect className="ff__box" x={p.box[0]} y={p.box[1]} width={p.box[2]} height={p.box[3]} rx="3" />
            <path className="ff__fill" d={p.body} />
            <path className="ff__line" d={p.line} pathLength={1} />
          </g>
        ))}
        {/* The magnifier rests at each piece as it is drawn. Moves by transform, so the
            ring is a fixed shape and the sweep costs no layout. */}
        <g className="ff__lens">
          <circle cx="0" cy="0" r="15" />
          <line x1="11" y1="11" x2="22" y2="22" />
        </g>
      </svg>
      <div className="ff__says">
        {LINES.map((text, i) => (
          <span key={text} className="ff__say" style={vars({ '--i': i })} aria-hidden="true">
            {text}
          </span>
        ))}
      </div>
      {photos !== undefined && photos > 0 && (
        <p className="ff__meta t-hint">
          {photos === 1 ? 'Reading your wall photo' : `Reading your ${photos} wall photos`}
        </p>
      )}
    </div>
  );
}

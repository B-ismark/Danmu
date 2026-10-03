'use client';

// The size tag over a piece while it is carried — its W × D in the user's unit
// and, on a refused frame, the reason — and nothing else.
//
// This file used to be `MeasureGuides`, and drew four dashed dimension lines from
// the footprint to the nearest wall or piece, each with a gap label, plus the
// green item-to-item alignment lines. On the room they read as streaks trailing
// the piece: nine lines and five labels round a sofa, redrawn every frame, all in
// a view whose point is to look at the room. The piece now says where it is with
// the translucent base under it (`Highlight`), which turns light red on a spot it
// cannot go, and the precise reading — gaps to the wall, alignment lines — is the
// 2D plan's, which draws them as a drawing and is the tab where "is that level
// with the wardrobe?" is being asked.
//
// Kept because a refusal must SAY something: "Nightstand will not fit" names the
// member of a set that is in trouble, which a red tint on the piece under the hand
// cannot (see `blockedBy` in `Draggable`).

import { Html } from '@react-three/drei';
import { useSettings } from '@/lib/store';
import { useDragLive } from '@/lib/drag-live';
import { SCENE } from '@/lib/scene-palette';
import { formatDim } from '@/lib/units';

export function DragTag() {
  const live = useDragLive((s) => s.live);
  const dimUnit = useSettings((s) => s.dimUnit);

  if (!live) return null;

  const color = live.valid ? SCENE.accentHover : SCENE.invalid;

  return (
    <group userData={{ helper: true }}>
      <Html
        position={[live.x, live.y + (live.floor ? live.dimMM[2] / 1000 : live.dimMM[2] / 2000) + 0.18, live.z]}
        center
        zIndexRange={[20, 0]}
        style={{ pointerEvents: 'none' }}
      >
        <div
          style={{
            fontFamily: 'var(--font-mono, monospace)',
            fontSize: 'var(--fs-caption)',
            fontWeight: 700,
            letterSpacing: '0.04em',
            // Tokens, not literals. This is a drei `Html` overlay — real DOM, which
            // CAN read custom properties (the same style object already does, two
            // lines up), so rule 4's "no hard-coded design values" applies in full
            // and the `lib/scene-palette.ts` exemption for the WebGL layer does not.
            // A hex here simply did not follow the theme, and no test can see it.
            //
            // The refusal ground is `--danger`, not `SCENE.invalid`: the two are the
            // same red in the light theme, but only the token follows night mode,
            // where `--on-accent` is DARK and would sit on the light theme's red at
            // about 3:1. The rim stays `SCENE.invalid`, the colour of the 3D slab.
            color: live.valid ? 'var(--ink)' : 'var(--on-accent)',
            background: live.valid ? 'var(--paper-0)' : 'var(--danger)',
            border: `1px solid ${color}`,
            padding: '2px 7px',
            borderRadius: 'var(--r-1)',
            // The measurements stay on one line; the reason a set refused is a
            // SENTENCE carrying a name the user typed (up to 80 chars), so it wraps
            // under them instead of running off both sides of a tag centred on the
            // piece. `100vw` rather than `100%`: the parent is a drei `Html` wrapper
            // sized to its own content, so a percentage would resolve against the
            // very width being bounded.
            maxWidth: 'min(240px, calc(100vw - 32px))',
            textAlign: 'center',
          }}
        >
          <span style={{ whiteSpace: 'nowrap' }}>
            {formatDim(live.dimMM[0], dimUnit)} × {formatDim(live.dimMM[1], dimUnit)} {dimUnit}
          </span>
          {!live.valid &&
            (live.blockedBy ? (
              <span style={{ display: 'block', overflowWrap: 'anywhere', fontWeight: 600 }}>
                {live.blockedBy} will not fit
              </span>
            ) : (
              <span style={{ whiteSpace: 'nowrap' }}> · blocked</span>
            ))}
        </div>
      </Html>
    </group>
  );
}

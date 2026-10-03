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
  if (!live) return null;
  return (
    <SizeTag
      position={[live.x, live.y + sizeTagLift(live.dimMM, live.floor), live.z]}
      dimMM={live.dimMM}
      valid={live.valid}
      blockedBy={live.blockedBy}
    />
  );
}

/** How far above a piece's origin its size tag floats: over the top of a piece that
 *  stands on the floor (its origin is its base), over the middle of one that hangs
 *  (its origin is its centre), and a hand's width more either way. */
export function sizeTagLift(dimMM: readonly [number, number, number], floor: boolean): number {
  return (floor ? dimMM[2] / 1000 : dimMM[2] / 2000) + 0.18;
}

/** The tag itself, wherever it is put. `DragTag` puts it over the piece being carried;
 *  the Library drag's ghost (`DropGhost`) puts it over the ghost — one tag for one
 *  reading, so the two gestures that bring a piece somewhere say its size the same
 *  way and refuse in the same colour. `position` is in whatever frame the caller
 *  mounts it in: the world for `DragTag`, the ghost's own group for the ghost, which
 *  is what lets the ghost move it without re-rendering it. */
export function SizeTag({
  position,
  dimMM,
  valid,
  blockedBy,
}: {
  position: [number, number, number];
  dimMM: readonly [number, number, number];
  valid: boolean;
  blockedBy?: string;
}) {
  const dimUnit = useSettings((s) => s.dimUnit);
  const color = valid ? SCENE.accentHover : SCENE.invalid;

  return (
    <group userData={{ helper: true }}>
      <Html
        position={position}
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
            color: valid ? 'var(--ink)' : 'var(--on-accent)',
            background: valid ? 'var(--paper-0)' : SCENE.invalid,
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
            {formatDim(dimMM[0], dimUnit)} × {formatDim(dimMM[1], dimUnit)} {dimUnit}
          </span>
          {!valid &&
            (blockedBy ? (
              <span style={{ display: 'block', overflowWrap: 'anywhere', fontWeight: 600 }}>
                {blockedBy} will not fit
              </span>
            ) : (
              <span style={{ whiteSpace: 'nowrap' }}> · blocked</span>
            ))}
        </div>
      </Html>
    </group>
  );
}

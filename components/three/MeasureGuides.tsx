'use client';

// Live measurement guides — while a part is being dragged, draw dimension
// lines from its footprint to the nearest wall in all four world directions,
// labelled in the user's display unit, plus the part's own W×D size tag.
// Pure geometry (ray-to-footprint-boundary), recomputed per drag tick from the
// lightweight drag-live channel, so the rest of the scene never re-renders.
//
// Every `points` array handed to drei's <Line> is built inside the memo below.
// That is load-bearing, not tidiness: <Line> keys its LineGeometry on the
// `points` identity, so an inline array literal meant a brand-new LineGeometry,
// setPositions() and GPU upload for up to nine lines on EVERY drag tick. Stable
// identities mean the geometry is only rebuilt when the resolved position
// actually changes.

import { useMemo } from 'react';
import { Line, Html } from '@react-three/drei';
import { useScene } from '@/lib/scene-store';
import { useRoomScene } from '@/lib/room-scene';
import { useSettings } from '@/lib/store';
import { useDragLive } from '@/lib/drag-live';
import { SCENE } from '@/lib/scene-palette';
import { rayToBoundary, obbExtentAlong, obbFromPart } from '@/lib/geometry';
import { aabbExtents, snapGuideEnds } from '@/lib/item-snap';
import { formatDim } from '@/lib/units';

const GUIDE_Y = 0.02;
const DIRS: Array<[number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
// Snapped-alignment greens live in lib/scene-palette beside the rest of the
// scene's colours — the 2D plan draws the same two guides from the same two
// values, and a literal here was the start of a second copy.
const SNAP_EDGE = SCENE.snapEdge;
const SNAP_CENTER = SCENE.snapCenter;

type Pt = [number, number, number];

export function MeasureGuides() {
  const live = useDragLive((s) => s.live);
  const footprint = useScene((s) => s.room.footprint);
  // Effective transforms, so gaps measure to where furniture ACTUALLY is.
  const parts = useRoomScene();
  const dimUnit = useSettings((s) => s.dimUnit);

  const { guides, snapGuides } = useMemo(() => {
    const empty = { guides: [] as Array<{ points: [Pt, Pt]; mid: Pt; label: string }>, snapGuides: [] as Array<{ points: [Pt, Pt]; center: boolean }> };
    if (!live) return empty;
    const obb = obbFromPart([live.x, live.y, live.z], live.rot, live.dimMM);
    const out: Array<{ points: [Pt, Pt]; mid: Pt; label: string }> = [];
    for (const [dx, dz] of DIRS) {
      const ext = obbExtentAlong(obb, dx, dz);
      const wall = rayToBoundary(live.x, live.z, dx, dz, footprint);
      if (!Number.isFinite(wall)) continue;

      // Nearest furniture edge along this direction — walkway width beats
      // wall distance when something stands in between.
      let nearest = wall;
      for (const o of parts) {
        if (o.id === live.partId || o.wallMounted || o.category === 'rug') continue;
        const op = o.pos;
        const oe = aabbExtents(o.rot, o.dimMM);
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
        }
      }

      const gap = nearest - ext;
      if (gap < 0.005 || gap > 30) continue; // flush / outside
      const from: Pt = [live.x + dx * ext, GUIDE_Y, live.z + dz * ext];
      const to: Pt = [live.x + dx * nearest, GUIDE_Y, live.z + dz * nearest];
      out.push({
        points: [from, to],
        mid: [(from[0] + to[0]) / 2, GUIDE_Y + 0.02, (from[2] + to[2]) / 2],
        label: formatDim(gap * 1000, dimUnit),
      });
    }

    // Ends from `lib/item-snap.ts`, not worked out here: the plan draws the same
    // guide, and the axis→span mapping is the part that is easy to transpose.
    const snaps = (live.snapLines ?? []).map((s) => {
      const { from, to } = snapGuideEnds(s);
      return {
        points: [
          [from[0], GUIDE_Y, from[1]],
          [to[0], GUIDE_Y, to[1]],
        ] as [Pt, Pt],
        center: s.kind === 'center',
      };
    });

    return { guides: out, snapGuides: snaps };
  }, [live, footprint, parts, dimUnit]);

  if (!live) return null;

  const color = live.valid ? SCENE.accentHover : SCENE.invalid;

  return (
    <group userData={{ helper: true }}>
      {/* Item-to-item alignment guides — solid green when edges/centres lock. */}
      {snapGuides.map((s, i) => (
        <Line
          key={`snap-${i}`}
          points={s.points}
          color={s.center ? SNAP_CENTER : SNAP_EDGE}
          lineWidth={s.center ? 1.2 : 1.6}
          dashed={s.center}
          dashSize={0.08}
          gapSize={0.05}
          transparent
          opacity={0.95}
        />
      ))}
      {guides.map((g, i) => (
        <group key={i}>
          <Line points={g.points} color={color} lineWidth={1.2} dashed dashSize={0.06} gapSize={0.04} transparent opacity={0.9} />
          <Html position={g.mid} center zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
            <div
              style={{
                fontFamily: 'var(--font-mono, monospace)',
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: '0.04em',
                color: 'var(--on-accent)',
                background: color,
                padding: '1px 5px',
                borderRadius: 'var(--r-1)',
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
            // Tokens, not literals. This is a drei `Html` overlay — real DOM, which
            // CAN read custom properties (the same style object already does, two
            // lines up), so rule 4's "no hard-coded design values" applies in full
            // and the `lib/scene-palette.ts` exemption for the WebGL layer does not.
            // A hex here simply did not follow the theme, and no test can see it.
            color: live.valid ? 'var(--ink)' : 'var(--on-accent)',
            background: live.valid ? 'var(--paper-0)' : SCENE.invalid,
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

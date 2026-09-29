'use client';

// The drawn half of `lib/wobble.ts`: an inner group that leans while its piece is
// carried and rocks upright when it is set down.
//
// It reads the OUTER group's position — the one `Draggable` moves — once a frame,
// turns the change into a velocity, and springs a lean toward what that velocity
// asks for. Only while some piece is being dragged: an undo, a re-scan or a wall
// move also moves pieces, instantly, and a room that shuddered on every Ctrl+Z
// would be telling you something happened that did not. When the drag ends the
// target falls to zero, and the underdamped spring IS the settle.
//
// Floor-standing pieces only. Their origin is their foot (`Highlight` draws the box
// at `h / 2` for exactly this reason), so a lean about the origin pivots on the
// floor. A wall piece leaning would swing its back through the plaster, and a
// ceiling piece's origin is its middle — so those two stay still, and are no less
// alive for it.
//
// Under `frameloop="demand"` a settling spring has to ask for its own frames, so it
// calls `invalidate` until it is at rest and then stops asking — an idle room is
// still an idle canvas. Under prefers-reduced-motion it never moves at all.

import { useRef, type MutableRefObject, type ReactNode } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Group } from 'three';
import { useStudio } from '@/lib/store';
import { WOBBLE, atRest, leanFor, stepSpring, type Spring } from '@/lib/wobble';
import { reducedMotion } from './Motion';

/** Gestures that are not a piece being carried. */
const NOT_A_PIECE = new Set(['__sun__', '__wall__']);

export function Wobble({
  targetRef,
  partId,
  enabled,
  children,
}: {
  targetRef: MutableRefObject<Group | null>;
  partId: string;
  /** False for wall and ceiling pieces, which stay still. */
  enabled: boolean;
  children: ReactNode;
}) {
  const inner = useRef<Group>(null);
  const invalidate = useThree((s) => s.invalidate);
  const st = useRef({
    prev: null as null | [number, number],
    vx: 0,
    vz: 0,
    ax: { x: 0, v: 0 } as Spring,
    az: { x: 0, v: 0 } as Spring,
    lift: { x: 0, v: 0 } as Spring,
  });

  useFrame((_, delta) => {
    const g = targetRef.current;
    const i = inner.current;
    if (!g || !i || !enabled || reducedMotion()) return;
    const s = st.current;
    const dt = Math.min(delta, 1 / 30);
    const dragging = useStudio.getState().draggingId;
    const carrying = dragging !== null && !NOT_A_PIECE.has(dragging);

    const x = g.position.x;
    const z = g.position.z;
    let vx = 0;
    let vz = 0;
    if (carrying && s.prev && dt > 0) {
      vx = (x - s.prev[0]) / dt;
      vz = (z - s.prev[1]) / dt;
    }
    s.prev = [x, z];
    const k = 1 - Math.exp(-WOBBLE.smoothing * dt);
    s.vx += (vx - s.vx) * k;
    s.vz += (vz - s.vz) * k;

    const lean = carrying ? leanFor(s.vx, s.vz, g.rotation.y) : { aboutX: 0, aboutZ: 0 };
    // The piece under the hand lifts; its company only leans.
    const liftTo = dragging === partId ? WOBBLE.lift : 0;

    // Settled: nothing to draw and nothing to ask for. Checked against the
    // TARGETS, not zero, so a piece held still mid-drag (lifted, not moving) and
    // every piece in the room that is not travelling all stop requesting frames —
    // otherwise holding the mouse still would repaint the room forever.
    if (
      atRest(s.ax, lean.aboutX) &&
      atRest(s.az, lean.aboutZ) &&
      atRest(s.lift, liftTo) &&
      Math.abs(s.vx) < 1e-3 &&
      Math.abs(s.vz) < 1e-3
    ) {
      const y = Math.max(0, liftTo);
      if (i.rotation.x !== lean.aboutX || i.rotation.z !== lean.aboutZ || i.position.y !== y) {
        s.ax = { x: lean.aboutX, v: 0 };
        s.az = { x: lean.aboutZ, v: 0 };
        s.lift = { x: liftTo, v: 0 };
        i.rotation.x = lean.aboutX;
        i.rotation.z = lean.aboutZ;
        i.position.y = y;
        invalidate();
      }
      return;
    }

    s.ax = stepSpring(s.ax, lean.aboutX, dt);
    s.az = stepSpring(s.az, lean.aboutZ, dt);
    // The lift is stiffer and nearly critically damped: a piece should come up
    // off the floor cleanly and set down with one small bump, not bounce.
    s.lift = stepSpring(s.lift, liftTo, dt, 260, 26);
    i.rotation.x = s.ax.x;
    i.rotation.z = s.az.x;
    i.position.y = Math.max(0, s.lift.x);
    invalidate();
  });

  return <group ref={inner}>{children}</group>;
}

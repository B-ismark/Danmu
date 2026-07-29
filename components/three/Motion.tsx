'use client';

// Subtle idle motion helpers — the fan blades, plant sway and pendant swing are
// the ONLY things in this scene that move without the user touching anything.
//
// The canvas runs frameloop="demand" (see Room.tsx): a frame is rendered only
// when something asks for one. React-driven changes invalidate automatically,
// but an imperative per-tick mutation like these does not — so every tick has to
// request the next frame itself. Calling invalidate() from inside a frame keeps
// the loop alive; when these unmount nobody asks and the canvas goes quiet,
// which is the entire point of on-demand rendering.
//
// Under prefers-reduced-motion the children render dead still. That is the
// accessible behaviour AND the reason those users get a genuinely idle canvas:
// no ticks, no invalidate, no repaint. (The CSS block in globals.css cannot
// reach JS-driven motion, so this check has to be explicit.)

import { useRef, type ReactNode } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Group } from 'three';

// Resolved once per session and cached at module scope — a motion preference
// does not change often enough to justify a matchMedia listener inside every
// animated part. Lazy so it is never touched during SSR.
let _reduced: boolean | null = null;
function reducedMotion(): boolean {
  if (_reduced === null) {
    _reduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
  }
  return _reduced;
}

// Cap the step so a long idle (or a backgrounded tab, where rAF stops) doesn't
// arrive as one huge delta and snap the fan a quarter turn.
const MAX_STEP = 0.1;

/** Continuous spin about Y (ceiling fan blades). */
export function Spin({ speed = 1, children }: { speed?: number; children: ReactNode }) {
  const ref = useRef<Group>(null);
  const invalidate = useThree((s) => s.invalidate);
  const still = reducedMotion();
  useFrame((_, dt) => {
    if (still || !ref.current) return;
    ref.current.rotation.y += Math.min(dt, MAX_STEP) * speed;
    invalidate();
  });
  return <group ref={ref}>{children}</group>;
}

/** Gentle oscillation about an axis (plant sway, pendant swing). Phase is
 *  seeded so multiple instances don't move in lockstep. */
export function Sway({
  amp = 0.04,
  speed = 1.1,
  axis = 'z',
  phase = 0,
  children,
}: {
  amp?: number;
  speed?: number;
  axis?: 'x' | 'z';
  phase?: number;
  children: ReactNode;
}) {
  const ref = useRef<Group>(null);
  const invalidate = useThree((s) => s.invalidate);
  const still = reducedMotion();
  useFrame((s) => {
    if (still || !ref.current) return;
    ref.current.rotation[axis] = Math.sin(s.clock.elapsedTime * speed + phase) * amp;
    invalidate();
  });
  return <group ref={ref}>{children}</group>;
}

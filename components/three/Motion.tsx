'use client';

// Subtle idle motion helpers — the fan blades, plant sway and pendant swing are
// the ONLY things in this scene that move without the user touching anything.
//
// The canvas runs frameloop="demand" (see Room.tsx): a frame is rendered only
// when something asks for one. React-driven changes invalidate automatically,
// but an imperative per-tick mutation like these does not — so something has to
// keep asking, or the animation stops dead after one frame. When these unmount
// nobody asks and the canvas goes quiet, which is the entire point of on-demand
// rendering.
//
// **That ask is CAPPED rather than made from inside the frame.** It used to be
// `invalidate()` at the end of each `useFrame`, which is self-perpetuating: the
// loop then runs at whatever the display can do, so a room with one ceiling fan
// paid a full N8AO + SMAA + shadow pass 144 times a second on a 144 Hz monitor —
// for a fan turning at 23 RPM. That is also why the tab you are LEAVING is hot
// when you switch to the plan, which was reported as the switch being slow.
//
// 60 Hz, and the number is chosen rather than tuned. It is the cadence this
// motion was written and looked at on, so capping there cannot make it look worse
// than it already does on an ordinary 60 Hz machine, while a 144 Hz or 240 Hz
// display stops paying two to four times over for the same animation. A lower cap
// is tempting and was rejected: nothing here aliases (the fan moves 2.3° per
// frame at 60 Hz against the ~45° Nyquist limit for a four-blade wheel, and the
// two Sway users oscillate with 7–9 second periods), but a 0.5 m blade tip
// travels ~20 mm per frame at 60 Hz and ~40 mm at 30, and judder on a spinning
// object is a look, not a measurement — so the safe direction is to cap at the
// familiar rate and not to invent a new one.
//
// Both animations are cadence-independent by construction, which is what makes
// the cap safe: `Spin` integrates `dt`, and `Sway` reads absolute elapsed time.
// Neither changes speed or phase when the frame rate does. And when something
// else is already driving the loop — an orbit drag, a piece being moved — frames
// arrive faster than 60 Hz and both stay correct.
//
// Under prefers-reduced-motion the children render dead still. That is the
// accessible behaviour AND the reason those users get a genuinely idle canvas:
// no ticks, no invalidate, no repaint. (The CSS block in globals.css cannot
// reach JS-driven motion, so this check has to be explicit.)

import { useEffect, useRef, type ReactNode } from 'react';
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

/** The ceiling on how often idle motion asks for a frame. See the note above. */
const MOTION_HZ = 60;

/** One timer per canvas, however many animated parts are mounted.
 *
 *  Keyed on the canvas's own `invalidate`, which is stable for the lifetime of a
 *  root, so every `Spin` and `Sway` in one scene shares a single interval and a
 *  single refcount. Per-instance timers would work — they all call the same
 *  function — but a room with a fan, a pendant and three plants would then run
 *  five timers to schedule one frame, and the first person to read that would
 *  reasonably assume it was five times the work. */
const tickers = new Map<() => void, { n: number; id: number }>();

function useMotionTick(invalidate: () => void, active: boolean): void {
  useEffect(() => {
    if (!active) return;
    let entry = tickers.get(invalidate);
    if (!entry) {
      entry = { n: 0, id: window.setInterval(invalidate, 1000 / MOTION_HZ) };
      tickers.set(invalidate, entry);
    }
    entry.n += 1;
    const mine = entry;
    return () => {
      mine.n -= 1;
      if (mine.n <= 0) {
        window.clearInterval(mine.id);
        tickers.delete(invalidate);
      }
    };
  }, [invalidate, active]);
}

/** Continuous spin about Y (ceiling fan blades). */
export function Spin({ speed = 1, children }: { speed?: number; children: ReactNode }) {
  const ref = useRef<Group>(null);
  const invalidate = useThree((s) => s.invalidate);
  const still = reducedMotion();
  useMotionTick(invalidate, !still);
  useFrame((_, dt) => {
    if (still || !ref.current) return;
    // Integrated from `dt`, so the fan turns at `speed` rad/s whatever the frame
    // rate is. Do NOT invalidate here — that is the uncapped loop this cap replaced.
    ref.current.rotation.y += Math.min(dt, MAX_STEP) * speed;
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
  useMotionTick(invalidate, !still);
  useFrame((s) => {
    if (still || !ref.current) return;
    // Absolute elapsed time, so the phase is a function of the clock and not of
    // how many frames have been drawn.
    ref.current.rotation[axis] = Math.sin(s.clock.elapsedTime * speed + phase) * amp;
  });
  return <group ref={ref}>{children}</group>;
}

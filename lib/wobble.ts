// The give in a piece you are carrying: it leans back against the way it is
// being moved, and when you let go it rocks upright and settles.
//
// Pure maths so it can be tested without a GPU; `components/three/Wobble.tsx`
// runs it once per frame. Two rules keep it on the right side of "alive" and away
// from "broken":
//
//   · **It is drawn, never stored.** The lean is a rotation on an inner group the
//     transform layers never see. Nothing here reaches `positions` / `rotations`,
//     collision, the plan or a saved file — a transform write is never free
//     (CLAUDE.md), and this one is not even written.
//   · **It is bounded.** At most `WOBBLE.maxTilt` whatever the pointer does, so a snap
//     that jumps a piece half a metre in one frame reads as a jolt and not a tip-over.
//
// The spring is underdamped on purpose — a damping ratio near 0.35 gives two or
// three visible rocks that die inside half a second, which is what "a bit of
// wobble" looks like. Critically damped would be tidy and lifeless.

import { worldToLocal } from './geometry';

export type Spring = { x: number; v: number };

export const WOBBLE = {
  /** rad/s² per rad of error. √k ≈ 12 rad/s, a rock of about half a second. */
  stiffness: 150,
  /** rad/s² per rad/s. ζ = c / 2√k ≈ 0.35. */
  damping: 8.5,
  /** Radians of lean per metre-per-second of travel. Walking pace (1 m/s) leans a
   *  piece about 5°. */
  gain: 0.09,
  /** The most it will ever lean: 7°. */
  maxTilt: (7 * Math.PI) / 180,
  /** How far a carried floor piece lifts off the floor, in metres — enough to read
   *  as "picked up", small enough that its shadow still touches it. */
  lift: 0.014,
  /** Low-pass on the measured velocity, per second. Pointer moves arrive in bursts;
   *  without this the lean shivers with them. */
  smoothing: 18,
} as const;

export const atRest = (s: Spring, target = 0) => Math.abs(s.x - target) < 1e-4 && Math.abs(s.v) < 1e-3;

/** Advance a damped spring toward `target` by `dt` seconds. Semi-implicit Euler in
 *  steps of at most 1/120 s, so a slow frame is several small steps and not one
 *  big one that overshoots into instability. */
export function stepSpring(s: Spring, target: number, dt: number, k: number = WOBBLE.stiffness, c: number = WOBBLE.damping): Spring {
  let { x, v } = s;
  let left = Math.max(0, dt);
  while (left > 0) {
    const h = Math.min(left, 1 / 120);
    v += (-k * (x - target) - c * v) * h;
    x += v * h;
    left -= h;
  }
  return { x, v };
}

const clamp = (x: number, m: number) => Math.max(-m, Math.min(m, x));

/** The lean for a velocity measured in the WORLD, for a piece turned `rotY`.
 *
 *  Returned as rotations about the piece's own X and Z axes, because that is the
 *  frame the inner group lives in. The top trails the motion: moving toward +Z
 *  tips the top toward −Z, a negative turn about X; moving toward +X tips it
 *  toward −X, a positive turn about Z. Getting either sign wrong makes a piece lean
 *  INTO its travel, which reads as being towed by the top — the test pins both. */
export function leanFor(vx: number, vz: number, rotY: number): { aboutX: number; aboutZ: number } {
  // Through `worldToLocal`, not written out: `lib/geometry.ts` has the repo's one
  // rotation convention, and a hand-rolled copy is the sign error that is invisible
  // at 0° and 180°.
  const [lx, lz] = worldToLocal(rotY, vx, vz);
  const m = WOBBLE.maxTilt;
  return { aboutX: clamp(-WOBBLE.gain * lz, m), aboutZ: clamp(WOBBLE.gain * lx, m) };
}

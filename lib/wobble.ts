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

/** The most the far edge of a piece may rise when it leans, in metres. A lean is
 *  an angle, so a fixed 7° lifts a 2.2 m sofa's far edge 270 mm and a chair's 60 mm;
 *  capping the RISE instead lets a big piece lean less, which is what weight looks
 *  like, while a small one keeps its full sway. */
export const MAX_RISE_M = 0.12;

/** The largest lean, in radians, for a footprint `extentM` long along the lean. */
export function tiltCap(extentM: number): number {
  if (!(extentM > 0)) return WOBBLE.maxTilt;
  return Math.min(WOBBLE.maxTilt, Math.asin(Math.min(1, MAX_RISE_M / extentM)));
}

/** Where the inner group must sit so a lean pivots on the footprint's LOW corner
 *  rather than its middle.
 *
 *  Leaning about the foot's centre sinks half the footprint into the floor — a
 *  2.2 m sofa at 7° put a corner 134 mm through it, far more than the 14 mm lift.
 *  A piece that tips rests on the edge going down, so that corner is held where it
 *  was and the rest rises. The rotation is three's default Euler order with no Y
 *  turn, `R = Rx · Rz`, applied to the corner `p`; the offset is `p − R·p`, so the
 *  corner maps back onto itself. Continuous through zero — at no lean the offset is
 *  zero whichever corner is chosen — so a settling rock that swaps sides does not
 *  jump. Exact under the outer group's scale as well: `S·(p − Rp + Rp) = S·p`.
 *
 *  `halfW` / `halfD` are the footprint's half-extents along the piece's own X / Z,
 *  in the inner group's units. */
export function pivotOffset(rx: number, rz: number, halfW: number, halfD: number): [number, number, number] {
  // The corner whose height goes most negative under the lean: see the y row below.
  const px = rz > 0 ? -halfW : rz < 0 ? halfW : 0;
  const pz = rx > 0 ? halfD : rx < 0 ? -halfD : 0;
  const cx = Math.cos(rx);
  const sx = Math.sin(rx);
  const cz = Math.cos(rz);
  const sz = Math.sin(rz);
  // R·p for p = (px, 0, pz): Rz first, then Rx.
  const rx0 = px * cz;
  const ry0 = px * sz * cx - pz * sx;
  const rz0 = px * sz * sx + pz * cx;
  return [px - rx0, -ry0, pz - rz0];
}

// How much light the room bounces around, on the quality where the room is closed.
//
// On 'high' the shell is a real enclosure (`components/three/RoomShell.tsx`): the
// walls and ceiling cast, and the key light gets in through the windows and
// nowhere else. That is right about DIRECT light and wrong about the room,
// because a real room is mostly lit by what the sunlit patch of floor and wall
// throws back — interreflection, which a rasteriser with a shadow map does not
// compute at all. Without it the interior was lit by the sky dome alone, and 'high'
// read far darker than 'fast', where the same key light passes straight through a
// ceiling that casts nothing: back wall 109 against 174 in the same mood.
//
// So the missing term is added back as what it physically is — soft, shadowless,
// warm-from-the-source light — and SIZED by what actually drives it: how much
// glass there is for the key light to come through, relative to the floor it has
// to fill. The textbook split-flux estimate of interreflected illuminance is
// proportional to glazing area over total surface area times ρ/(1−ρ); floor area
// stands in for the surface total (for a room of ordinary proportions the two
// differ by a near-constant factor, which `BOUNCE_GAIN` absorbs). Two consequences
// are the point rather than side effects:
//
//   · a room with NO window gets no bounce. It is lit by the sky term and its own
//     lamps, which is the honest picture of an interior room, and the Style panel
//     already says a sun mood has nothing to shine through;
//   · a glass-walled room does not get unbounded light: the ratio is capped where
//     a room is effectively all window (`MAX_GLAZING_RATIO`), past which more glass
//     adds direct light, not a brighter bounce.
//
// Fast is untouched: its key light already reaches everything directly, and
// adding a bounce there would count the same light twice.

import { isAperture } from './apertures';
import { polygonArea } from './geometry';
import type { Footprint } from './footprint';

/** Calibrated on the starter living room (6 × 4 m, two catalogue windows at
 *  1.2 × 1.2 m — a glazing-to-floor ratio of 0.12, inside the 10–20% band building
 *  codes ask of a habitable room), Day mood, SwiftShader, mean grey over the middle
 *  of the canvas: 'high' read 110 with no bounce against 'fast' at 152; gain 3 gives
 *  145 and gain 6 gives 162. 3 is the one that brings 'high' level with 'fast' and
 *  stops there, so the soft shadows are an addition rather than a darkening. A new
 *  number wants a new measurement. */
export const BOUNCE_GAIN = 3;
/** Beyond this share of glass per unit floor a room is a conservatory: more glass
 *  is more direct light, not more bounce. */
export const MAX_GLAZING_RATIO = 0.35;

/** Square metres of window — the parts that are holes in a wall, `window` only
 *  (a door is an opening, but light through a doorway comes from the next room,
 *  not the sky). `dimMM` is `[W, D, H]`. */
export function glazingArea(parts: ReadonlyArray<{ shape: string; wallMounted?: boolean; dimMM: readonly number[] }>): number {
  let a = 0;
  for (const p of parts) {
    if (p.shape !== 'window' || !isAperture(p)) continue;
    a += (p.dimMM[0] / 1000) * (p.dimMM[2] / 1000);
  }
  return a;
}

/** Intensity of the shadowless bounce term for a key light of `keyIntensity`.
 *  Zero for no key, no floor or no glass. */
export function bounceIntensity(keyIntensity: number, glazingM2: number, footprint: Footprint): number {
  const floor = polygonArea(footprint);
  if (!(keyIntensity > 0) || !(floor > 0) || !(glazingM2 > 0)) return 0;
  return keyIntensity * BOUNCE_GAIN * Math.min(glazingM2 / floor, MAX_GLAZING_RATIO);
}

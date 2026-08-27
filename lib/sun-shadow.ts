// Whether a piece may write into the sun's shadow map.
//
// The bug this answers: a TV mounted on the north wall cast a shadow across the
// floor when the sun was moved round to the south — that is, when the sun was on
// the far side of the wall the TV is bolted to. The sun cannot reach it, so the
// shadow is impossible.
//
// It happens because **walls only ever `receiveShadow`, never cast.** That is
// deliberate and load-bearing: the dollhouse view culls the near walls, and a
// wall that cast would drop the whole room into darkness the moment the camera
// came round. But it means the sun passes straight through the plaster, hits the
// back of the TV, and the TV — which does cast — puts a shadow on the floor of a
// room the light never entered.
//
// So the gate belongs on the piece, not on the wall. A wall-riding piece casts
// only when the sun is on the same side of that wall as the room is: its own
// front face.
//
// Three things this deliberately does NOT do:
//
//   · **`null` means "there is no key light at all", and nothing else.** It is
//     the answer for a sun angle at or below the horizon, where `Room` renders no
//     key light and `castShadow` cannot matter either way.
//
//     It used to also be the answer for the two studio moods, on the grounds that
//     their key light is a lighting rig rather than something standing outside the
//     building, so there was no wall between it and the furniture to reason about.
//     **That was wrong, and wrong in a measurable way**: the rig is realised at
//     `dist = max(12, extent * 1.6)`, twelve metres or more outside a six-metre
//     room, and `KEY_DIR · frontVector` is −0.390 for a piece on the south wall
//     and −0.488 on the east one. So the exemption did not model a rig; it left
//     this exact bug standing on half the walls, in `cool`, which carries the
//     brightest ambient of the set and is where a spurious shadow reads loudest.
//     The caller passes `moodKeyDirection` now, which answers for every mood.
//   · **It does not read the live object3D rotation.** Mid-drag the mesh's
//     `rotation.y` runs ahead of the store, so a per-frame dot product against it
//     would flip casting on and off across the sign change while the piece turns
//     — a flicker that is worse than the bug. The caller passes the *resolved*
//     rotation, which only changes when a drag commits.
//   · **It does not gate on `isWallMountedPart`.** That predicate is true for a
//     ceiling fan, which rides no wall and so has no wall to be behind. The
//     caller passes `ridesWall(category, shape)` — the same predicate
//     `lib/drag-resolve.ts` uses for the wall snap, so a piece is gated by
//     exactly the test that put it on the wall.
//
//   · **An opening is exempt, and this was a bug for one commit.** The paragraph
//     above used to claim `ridesWall` excused a door "whose leaf occluding the
//     key light is arguably right". It does not: `anchorFor('door')` is
//     `'wall-floor'`, so `ridesWall` is **true** for a door and the gate caught
//     it. Which mattered, because a door is exactly the place light DOES cross
//     the wall — as is a window, and a curtain hung over one. Gating them removed
//     the shadow that reads as light coming in through the doorway, on the one
//     wall a lighting study cares about. That failed in the quiet direction: a
//     shadow silently missing rather than one wrongly present.

import { frontVector } from './geometry';
import { APERTURE_SHAPES } from './apertures';
import type { Shape } from './scene-spec';

/** How close to parallel counts as parallel. See the note where it is used — this
 *  is here to absorb `Math.sin(Math.PI)`, not to model a grazing angle. */
const GRAZE = 1e-9;

/**
 * @param sunDir  unit vector from the room toward the light — `moodKeyDirection`,
 *                which answers for a studio mood as well as a sun. `null` only
 *                when there is no key light at all (a sun below the horizon)
 * @param rot     the piece's RESOLVED y-rotation, in radians
 * @param ridesWall whether this piece is snapped flat against a wall
 * @param shape   the piece's shape, to spot an opening — see `opensTheWall`
 *
 * One limitation worth stating rather than discovering. `castShadow` is a property
 * of the OBJECT, not of a light, so switching it off removes the piece from every
 * shadow map in the scene — including a spot lamp's, which does cast at
 * `quality: 'high'` (`PartLight.tsx`). So a shelf on a wall the sun is behind also
 * stops casting from the lamp standing next to it. Fixing that properly needs
 * per-light masking (layers, or two render passes), which is a real change to how
 * the scene is lit; this trade buys the common case — the sun is the only light in
 * most rooms and the only one whose direction the user can move — at the cost of
 * the uncommon one. Switching to a studio mood brings the lamp shadow back, which
 * is the tell if anyone reports it.
 */
/** Does this shape sit where light crosses the wall, rather than on solid plaster?
 *
 *  `APERTURE_SHAPES` (window, door) is shared with `lib/apertures.ts`, which needs
 *  the same list to cut the hole. `curtain` is added here and only here: it is not
 *  an opening — it cuts nothing — but it hangs over one, so the sun behind its wall
 *  is shining through the window it covers and onto its back. Its shadow is the
 *  most characteristic thing a low sun does in a room. */
function opensTheWall(shape: Shape): boolean {
  return APERTURE_SHAPES.has(shape) || shape === 'curtain';
}

export function castsSunShadow(
  sunDir: readonly [number, number, number] | null,
  rot: number,
  ridesWall: boolean,
  shape: Shape,
): boolean {
  // A piece standing on the floor is in the room with the light. Nothing to gate.
  if (!ridesWall) return true;
  // An opening, or the dressing on one: light crosses the wall here, so a sun
  // behind this wall still reaches the piece.
  if (opensTheWall(shape)) return true;
  // No key light at all — see the note above about what `null` does and does not
  // mean. Not reachable from a studio mood any more.
  if (!sunDir) return true;
  const [fx, fz] = frontVector(rot);
  // Only the horizontal part matters: the question is which SIDE of a vertical
  // wall the sun is on, and a wall's plane is vertical, so the sun's height
  // cannot move it from one side to the other.
  //
  // `> -GRAZE`, not `> 0`, and the epsilon is load-bearing rather than tidy.
  //
  // The DEFAULT mood is `day` at azimuth exactly 180, and the default bearing is
  // exactly 0 (`Home` on the dial sets exactly 0 too). `Math.sin(Math.PI)` is
  // 1.2246e-16, not 0, so in an axis-aligned room the horizontal dot against the
  // east and west walls came out as ±3e-17 — and `> 0` cheerfully reported one
  // wall lit and its mirror image dark. Two identical TVs on opposite walls, one
  // casting and one not, in the configuration every room opens in.
  //
  // The direction of the tie also had to change. The old comment claimed a sun
  // parallel to the wall "casts nothing worth drawing either way" — false for the
  // pieces this gate applies to, because a wall-rider is a box standing PROUD of
  // the wall, and a 58° sun running parallel to that wall throws a real shadow
  // along it and onto the floor. So the degenerate case falls toward casting.
  //
  // The epsilon exists to swallow float dust, not to model grazing: 1e-9 is nine
  // orders of magnitude above `sin(π)` and far below any angle a preset or the
  // dial can express (the dial is integer degrees).
  return sunDir[0] * fx + sunDir[2] * fz > -GRAZE;
}

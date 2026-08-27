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
//   · **It does not gate the studio moods.** `Room` renders a `KeyLight` for
//     those too, at a fixed three-quarter position, but that light is a lighting
//     rig rather than a thing standing outside the building — there is no wall
//     between it and the furniture to reason about. `sunDir` is `null` for a
//     studio mood, and null means "cast, as before".
//   · **It does not read the live object3D rotation.** Mid-drag the mesh's
//     `rotation.y` runs ahead of the store, so a per-frame dot product against it
//     would flip casting on and off across the sign change while the piece turns
//     — a flicker that is worse than the bug. The caller passes the *resolved*
//     rotation, which only changes when a drag commits.
//   · **It does not gate on `isWallMountedPart`.** That predicate is true for a
//     ceiling fan (which rides no wall, so there is no wall to be behind) and for
//     a door (whose leaf occluding the key light is arguably right — a door is a
//     hole in the wall, and the wall's own non-casting is what the hole is for).
//     The caller passes `ridesWall(category, shape)`, which is the same predicate
//     the wall-snap branch uses.

import { frontVector } from './geometry';

/**
 * @param sunDir  unit vector from the room toward the light, or `null` for a
 *                studio mood / a sun below the horizon (`moodSunDirection`)
 * @param rot     the piece's RESOLVED y-rotation, in radians
 * @param ridesWall whether this piece is snapped flat against a wall
 */
export function castsSunShadow(
  sunDir: readonly [number, number, number] | null,
  rot: number,
  ridesWall: boolean,
): boolean {
  // A piece standing on the floor is in the room with the light. Nothing to gate.
  if (!ridesWall) return true;
  // No solar key light — see the note above about the studio moods.
  if (!sunDir) return true;
  const [fx, fz] = frontVector(rot);
  // Only the horizontal part matters: the question is which SIDE of a vertical
  // wall the sun is on, and a wall's plane is vertical, so the sun's height
  // cannot move it from one side to the other.
  //
  // `> 0` rather than `>= 0`: at exactly zero the sun is travelling parallel to
  // the wall and grazes the piece, which casts nothing worth drawing either way.
  // Taking the false branch there means the degenerate case fails toward "no
  // impossible shadow", which is the direction this whole function exists for.
  return sunDir[0] * fx + sunDir[2] * fz > 0;
}

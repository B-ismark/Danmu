// How big the sun's shadow camera has to be for one room.
//
// This used to be four expressions inside `KeyLight` (`components/three/Room.tsx`)
// and it moved out for the reason rule 3 of CLAUDE.md gives: it is geometry, it has
// a handedness, and a wrong answer here is silent — the ortho shadow camera simply
// stops recording whatever falls outside it, and a caster that is not in the map
// casts nothing. There is no error and no failing render; there is a wall with
// sunlight coming through it.
//
// **What changed, and why the fit is a different shape now.** The room used to be
// open to the sky: walls only ever received shadow, the ceiling did not exist, and
// the frustum's job was to cover how far the tallest piece of furniture could throw
// a shadow across the floor — `tallest × throwPerMetre(dir)`, capped at six metres
// of run per metre of rise so that a sun a degree above the horizon did not demand
// a hundred-metre box. The room is a closed shell now (`components/three/RoomShell.tsx`):
// the walls cast, and there is a ceiling. So every caster AND every receiver in the
// sun's shadow map is inside the room's own box, and the frustum only has to contain
// that box.
//
// That is a strict improvement rather than a trade. The old fit spent most of its
// texels on empty floor OUTSIDE the house — for a 5.6 × 4.2 m room with a 2 m
// wardrobe and a low sun it asked for a 15.5 m box to cover a 7 m room — and
// `normalBias` is derived from the texel size the fit produces, so a box fitted to
// ground nothing was also loosening the bias that keeps the floor from shadowing
// itself.
//
// The one thing the new bound must get right is that the box is a BOX. A room's
// horizontal reach from its own centre is half its footprint diagonal, and that is
// all the old fit used; but a wall is `roomHeight` tall, and in the shadow camera's
// view a point `h` above the floor sits `h · cos(elevation)` off to one side of
// where its floor position projects. At a 58° sun that is 0.53 × the height and
// forgettable; at the 7° of Sunrise it is 0.99 × the height, so a 2.4 m wall reaches
// 2.38 m further across the map than its base does. Miss that term and the low-sun
// moods clip the tops of their own walls — which is exactly the mood, and exactly
// the wall, that the shell was added for.
//
// **The height goes on ONE axis, not both, and that is worth the arithmetic.** An
// ortho camera is bounded per axis, and the camera's basis is not arbitrary: three
// builds it from `up × z`, so the camera's x axis is always horizontal. Height
// therefore lands entirely on the camera's y, and the fit is
//
//     extent = max( halfDiag ,  halfDiag · sin(elevation) + boxHeight · cos(elevation) )
//
// rather than `halfDiag + boxHeight · cos(elevation)`. Both are azimuth-free — which
// is the property that stops the bearing dial re-allocating the depth target on
// every degree — but the first is a real fit and the second was a radius used as a
// per-axis bound. On a 12 × 9 m open plan at Sunrise the difference is 7.5 m against
// 10.5 m, which is the difference between a 1024² map and a 2048² one for a room
// that never needed the bigger one; on a 3 × 3 m bedroom it is 3.0 against 5.0,
// which is 2.8× the texel density on the floor someone is actually looking at.

/** Everything the key light's shadow needs, derived from the room and the light.
 *
 *  `far` and `normalBias` are in here rather than left to the caller because they
 *  are functions of `extent` and `mapSize`: three allocates the depth target once
 *  and reuses it forever, so a `mapSize` step that the bias does not follow halves
 *  the bias at exactly the room size that needs it most. That has happened here
 *  before. One object, one derivation. */
export type ShadowFit = {
  /** Half-width of the ortho shadow camera, metres. Quantised — see below. */
  extent: number;
  /** Depth-target edge. One step, not a continuum. */
  mapSize: number;
  /** How far along the light direction to stand the light. */
  dist: number;
  /** `shadow-camera-near`. In here rather than written at the light, because it is
   *  half of a relationship: `near` has to clear the room, and what "clear" means
   *  is `dist - extent`. Two of the three living in this file and the third in the
   *  renderer is how the pair stops agreeing. */
  near: number;
  /** `shadow-camera-far`. */
  far: number;
  /** `shadow-normalBias`, derived from this fit's own texel size. */
  normalBias: number;
};

/** Smallest box worth fitting. A footprint mid-edit can be degenerate, and an
 *  ortho camera with zero width renders an empty shadow map — which reads as
 *  "the sun is off" rather than as a bad number. */
const MIN_EXTENT = 2;

/** The shadow camera's near plane, metres. `MIN_EXTENT` is what keeps
 *  `dist - extent` above it for every room: 0.6 × 2 m against 0.5 m. */
const NEAR = 0.5;

/**
 * @param width  footprint bounding-box width, metres
 * @param depth  footprint bounding-box depth, metres
 * @param roomHeight  wall height, metres — a CASTER now, which is the whole point
 * @param tallestPartM  tallest piece of furniture, metres. Only matters when it is
 *   taller than the room: `lib/clearance.ts` reports a piece that does not fit and
 *   deliberately does not resize it, so it really does stick out through the
 *   ceiling and really does need to be in the map.
 * @param dir  unit vector from the room TOWARD the light
 */
export function shadowFit(
  width: number,
  depth: number,
  roomHeight: number,
  tallestPartM: number,
  dir: readonly [number, number, number],
): ShadowFit {
  // Half the footprint diagonal covers the room from any light azimuth: the
  // shadow camera is centred on the room and free to spin about it, so the
  // horizontal term cannot depend on which way the sun is.
  const halfDiag = Math.hypot(width, depth) / 2;
  const boxH = Math.max(roomHeight, tallestPartM, 0);
  // sin and cos of the light's elevation, straight off the unit vector — no angle
  // is reconstructed, so there is no `asin` to lose precision in and no degrees to
  // confuse with radians. Both are magnitudes, which is what makes the fit
  // sign-free: a sign error here would be invisible at the two azimuths that
  // happen to be axis-aligned, which is where every hand test lands.
  const sinEl = Math.abs(dir[1]);
  const cosEl = Math.hypot(dir[0], dir[2]);
  // The camera's x axis is horizontal (three builds it from `up × z`), so the box's
  // height cannot reach along it at all — half the diagonal is the whole bound.
  const acrossX = halfDiag;
  // The camera's y axis carries both: the horizontal spread foreshortened by the
  // sun's elevation, and the height at full strength as the sun approaches the
  // horizon.
  const acrossY = halfDiag * sinEl + boxH * cosEl;
  // Quantised to 0.5 m so that dragging a wall re-fits in steps rather than on
  // every tick: each change reallocates the depth target.
  return finish(Math.max(MIN_EXTENT, Math.ceil(Math.max(acrossX, acrossY) * 2) / 2));
}

function finish(extent: number): ShadowFit {
  const mapSize = extent > 8 ? 2048 : 1024;
  // Far enough out that the near plane clears the room from any direction:
  // `dist - extent` is 0.6 × extent, and `MIN_EXTENT` keeps that above `NEAR`.
  //
  // It used to be `max(12, extent * 1.6)`. The 12 was pinned by nothing and
  // explained by nothing — a mutation that deleted it broke no assertion, and the
  // constraint the comment beside it actually stated ("dist − extent >= 0.6 ×
  // extent") is satisfied by the 1.6 alone. A directional light does not attenuate
  // with distance, so standing it further out bought no light and no shadow; the
  // only thing it changed was `far`. Removed rather than given a test, because a
  // test around a constant nobody can justify only makes the constant harder to
  // remove next time.
  const dist = extent * 1.6;
  return {
    extent,
    mapSize,
    dist,
    near: NEAR,
    far: dist + extent + 2,
    // Two texels' worth. `normalBias` walks the shadow sample along the surface
    // normal in proportion to texel size, and it is what keeps the floor and the
    // walls — both lit at grazing angles — from shadowing themselves. It is also
    // what lets a wall CAST and still receive the sun coming through a window in
    // the wall opposite: caster and receiver are the same zero-thickness plane
    // there, so the comparison is a tie and the bias is the only thing that
    // breaks it.
    normalBias: ((2 * extent) / mapSize) * 2,
  };
}

// Photo geometry engine — deterministic position + size from a wall photo.
//
// The capture rig is standardised: camera at the ROOM CENTRE, CAM_HEIGHT off
// the floor, level, framing one wall straight-on (slots n/e/s/w). The user
// already entered the room's real W×D×H. That makes every photo a calibrated
// scene: a pinhole camera at a known pose looking at a wall at a known
// distance. From a 2D bounding box alone we can then compute, with no AI:
//
//   · the object's floor position — backproject the bbox bottom edge onto the
//     floor plane (y = 0), i.e. a floor homography
//   · its real width and height — angular size × distance
//
// Only depth (front-to-back) is unobservable from one photo, and clampDims guards
// it like everything else. But unobservable is not the same as irrelevant, and
// treating the two as the same thing is what put every floor piece half its own
// depth too close to the lens: the bbox's bottom edge is the corner NEAREST the
// camera, so a decode that ignores depth decodes the near face and calls it the
// centre. `placeFloorObject` therefore takes the depth as an INPUT — from the
// catalogue, never from the detector, because a number the AI guessed would
// otherwise move a position. A round footprint needs no such input at all: a
// circle's depth is its width, and the silhouette measures it.
//
// The one place height is unobservable too is a CEILING object — a fan seen from
// below projects as a disc, so its bbox has no thickness in it. See
// `placeCeilingObject`.
//
// World frame matches lib/detection.ts: origin = room-centre floor, +X East,
// +Y up, +Z toward the South wall. Slot cameras: n looks −Z, s +Z, e +X, w −X.

import type { CaptureSlot } from './storage';
import { footprintBounds, type Footprint } from './footprint';
import {
  calibrateFromSegments,
  detectSegments,
  toGrayscale,
  type VanishingCalibration,
} from './vanishing-point';

/** Camera height assumed when the photo and the user tell us nothing (metres).
 *  A real shooter is anywhere between about 1.2 and 1.75 m, and distance scales
 *  linearly with this number (∂d/∂h = d/h), so an assumed height is a ±17% error
 *  on every width and height derived from the photo. `CameraCal.height` carries a
 *  known one; this is only the floor. */
export const CAM_HEIGHT = 1.5;

/** Default horizontal FOV when nothing better is available — typical phone
 *  main camera (~66°). EXIF, then the wall-floor line, replace this. A wall shot
 *  in a small room is often taken on the ULTRAWIDE (~106°), which this under-reads
 *  by more than a factor of two: that mis-sizes wall-mounted items directly, and
 *  mis-PLACES floor-standing ones (their size survives, because distance scales as
 *  1/k and angular size as k — until the wall clamp breaks the cancellation). */
const DEFAULT_HFOV_DEG = 66;

export type CameraCal = {
  /** tan of half-hFOV × 2 — horizontal tangent span per normalized image unit:
   *  tanX(u) = (u − 0.5) · k */
  k: number;
  /** image aspect (width / height) — vertical tangent uses k / aspect. */
  aspect: number;
  /** Camera height off the floor in metres. Absent → CAM_HEIGHT. */
  height?: number;
  /** Camera tilt in radians, positive when the lens points DOWN. Absent → level.
   *  Handheld shots are routinely 5° off, which at 3 m under-reads distance by
   *  19% — the single largest error in this module when it is not known. */
  tiltRad?: number;
};

export function defaultCal(aspect: number): CameraCal {
  return { k: 2 * Math.tan(((DEFAULT_HFOV_DEG / 2) * Math.PI) / 180), aspect };
}

/** Build a calibration from a known horizontal field of view — the EXIF path.
 *  See `hfovFromFocal35` in lib/exif.ts for where the angle comes from. */
export function calFromHfov(hfovDeg: number, aspect: number, view?: CameraView): CameraCal {
  return { k: 2 * Math.tan(((hfovDeg / 2) * Math.PI) / 180), aspect, ...view };
}

/** What we know about where the camera was, as opposed to what lens it had. */
export type CameraView = { height?: number; tiltRad?: number };

const heightOf = (cal: CameraCal) => cal.height ?? CAM_HEIGHT;
const tiltOf = (cal: CameraCal) => cal.tiltRad ?? 0;

/** Distance from the room-centre camera to the framed wall. */
export function wallDistance(slot: CaptureSlot, room: { width: number; depth: number }): number {
  return slot === 'n' || slot === 's' ? room.depth / 2 : room.width / 2;
}

/** How wide the wall in this slot is — the other half of the same convention, so
 *  it lives beside it rather than in the screen that shows it. `slotToWorld` puts
 *  n and s across the room's width and e and w across its depth, and getting one
 *  of these two functions right while the other disagrees is a room measured off
 *  the wrong axis.
 *
 *  Read by `lib/capture-slots.ts` for the one check a person can make against
 *  their own photograph: a slot whose wall should be 5.6 m wide, holding a
 *  picture of a 4.2 m wall, is a set that wants rotating. */
export function wallSpan(slot: CaptureSlot, room: { width: number; depth: number }): number {
  return slot === 'n' || slot === 's' ? room.width : room.depth;
}

/**
 * The wall-floor line ties camera height, focal length and tilt together in one
 * equation — which means it can solve for ONE of them when the other two are
 * known.
 *
 * A ray leaving the camera at image row v has, after the tilt rotation, a
 * vertical component `b·cosθ − sinθ` and a forward component `b·sinθ + cosθ`
 * where `b = tanY(v)`. Requiring it to land on the floor at exactly the wall
 * distance D gives
 *
 *     b = (D·sinθ − H·cosθ) / (H·sinθ + D·cosθ)
 *
 * which reduces to the familiar `b = −H/D` for a level camera. `bAtFloorLine`
 * below is that expression; the two solvers each invert it for their unknown.
 */
function bAtFloorLine(height: number, d: number, tiltRad: number): number {
  const c = Math.cos(tiltRad);
  const s = Math.sin(tiltRad);
  const denom = height * s + d * c;
  return denom === 0 ? NaN : (d * s - height * c) / denom;
}

/**
 * Solve for FOCAL LENGTH, assuming a camera height. The original path, still the
 * fallback when the photo carries no lens information.
 *
 * Returns null when vFloor is implausible (≤ centre — the floor line must be in
 * the lower half of a level frame) or the answer is not a lens.
 */
export function calibrateFromFloorLine(
  vFloor: number,
  slot: CaptureSlot,
  room: { width: number; depth: number },
  aspect: number,
  view?: CameraView,
): CameraCal | null {
  if (vFloor <= 0.52 || vFloor >= 0.99) return null;
  const d = wallDistance(slot, room);
  const height = view?.height ?? CAM_HEIGHT;
  const tiltRad = view?.tiltRad ?? 0;
  const b = bAtFloorLine(height, d, tiltRad);
  if (!Number.isFinite(b)) return null;
  // b = (0.5 − vFloor)·k / aspect, and 0.5 − vFloor is negative here.
  const k = (b * aspect) / (0.5 - vFloor);
  if (!(k > 0)) return null;
  // Sanity: equivalent hFOV between 30° and 120°.
  const hfov = (2 * Math.atan(k / 2) * 180) / Math.PI;
  if (hfov < 30 || hfov > 120) return null;
  return { k, aspect, ...view };
}

/** Plausible band for a solved camera height, in metres. Outside it the floor
 *  line was not the floor line — a rug edge, a skirting shadow, a strip of
 *  sunlight — and the honest answer is "no measurement", not a confident wrong
 *  number. */
const MIN_SOLVED_HEIGHT = 0.8;
const MAX_SOLVED_HEIGHT = 2.2;

/**
 * The FORWARD (view-axis) component of the offset from the lens to a point on the
 * framed wall at height `y`. Positive means in front of the lens.
 *
 * This is `bAtFloorLine`'s own denominator, named and shared, because it is what
 * makes both of the projections below row-dependent under tilt: the lens rotates
 * about its right axis, so how far ahead a point on the wall is depends on how
 * high up the wall it is. `wallColumnsAtHeight` is the reason this had to be
 * pulled out — the lateral projection divides by it too, and the version that
 * did not was wrong under tilt while claiming to be exact.
 */
function forwardAtHeight(y: number, d: number, cal: CameraCal): number {
  const off = heightOf(cal) - y;
  const t = tiltOf(cal);
  return off * Math.sin(t) + d * Math.cos(t);
}

/**
 * The image row showing a point on the framed wall at height `y` above the floor,
 * as a normalized v (0 = top of frame). `d` is the distance from the lens to that
 * wall — `wallFrame(...).distance`, never `width / 2`.
 *
 * This is the FORWARD direction of the one equation `calibrateFromFloorLine` and
 * `heightFromFloorLine` each invert: those are handed a row and solve for a camera
 * term; this is handed the camera and returns the row. It reuses `bAtFloorLine`
 * rather than restating it, so there is one description of where a height lands on
 * screen and three readers of it — the alternative is the shape rule 3 of
 * `CLAUDE.md` warns about, two copies of one number drifting apart.
 *
 * `y = 0` is the wall-floor junction and `y = room.height` the wall-ceiling one,
 * so the two junctions are calls rather than cases. Taking a HEIGHT instead of a
 * surface name is what lets a caller ask for the row 150 mm above the skirting in
 * metres, rather than guessing a percentage of the frame.
 *
 * `bAtFloorLine` is written for a surface below the lens at vertical offset
 * `height`, so a point above the lens is the same expression with a negative
 * offset and no second formula is needed.
 *
 * **The row it returns is NOT clamped to the frame and may be negative or past 1**
 * — a level camera 1.5 m up, 2.8 m from the wall, on a 66° lens must look down
 * 28.2° to see the wall-floor junction while its frame reaches 26°, so that
 * junction sits below the bottom edge at v ≈ 1.15. That is an ordinary answer:
 * the wall runs past the edge of the picture.
 *
 * **The first version of this returned null for exactly that case, and the null
 * was a silent wrong answer waiting to happen.** It threw away WHICH edge the row
 * left by, and its docstring told a caller building a band to read null as "the
 * wall continues past this edge" — so a caller defaulted the top row to 0 and the
 * bottom to 1, and when BOTH rows left by the same edge (a 10 m room at the tilt
 * sensor's 45° limit; an 1.8 m ceiling at −30°) the band became the whole frame
 * and the sampler read floor as the wall colour, reporting success. A caller
 * cannot recover information the callee discarded, so the number crosses the
 * boundary intact and clamping is the caller's decision.
 *
 * Null now means only that there is no answer: the point is level with or behind
 * the lens (tilt far enough that the wall's top has passed the lens plane), where
 * the projection is not a row but a mirror image of one.
 */
export function wallRowAtHeight(y: number, d: number, cal: CameraCal): number | null {
  if (!(forwardAtHeight(y, d, cal) > 0)) return null;
  // Vertical offset from the lens down to the point, the convention
  // `bAtFloorLine` is written in: positive when the point is below the lens.
  const b = bAtFloorLine(heightOf(cal) - y, d, tiltOf(cal));
  if (!Number.isFinite(b)) return null;
  const v = 0.5 - (b * cal.aspect) / cal.k;
  return Number.isFinite(v) ? v : null;
}

/** Where the framed wall's two ends are, in metres, measured from the camera at
 *  the world origin: `distance` along the view axis, `left` and `right` along the
 *  lens's own right axis (so `left` is negative for a camera standing inside the
 *  room). */
export type WallFrame = { distance: number; left: number; right: number };

/**
 * The framed wall's geometry taken from the FOOTPRINT'S BOUNDS, which is the
 * contract `lib/scene-store.ts` states for `moveWall`: *"the room becomes
 * off-centre; width/depth are re-derived from the new bounding box and every
 * downstream consumer reads footprint bounds (not ±width/2)"*.
 *
 * `wallDistance` and `wallSpan` above are the ±half pair, and they are what the
 * placers still use. This is not a duplicate of them but the honest version, and
 * the difference is only visible in a room whose walls have been dragged: pull a
 * 1.5 × 5.0 room's east wall out by a metre and the north wall's midpoint moves to
 * x = +0.5 while `±width/2` still centres it on the lens. A sampler asking
 * "which columns of this photo are the north wall" then reads a sixth of the west
 * return wall and calls it north.
 *
 * The camera is at the world origin, which is the capture rig's premise rather
 * than an assumption of this function's (`slotToWorld` derives every placement
 * from the same origin). So a footprint that does not CONTAIN the origin is a
 * room the rig cannot describe, and this refuses it rather than returning a
 * negative distance that would project as a mirror image.
 */
export function wallFrame(slot: CaptureSlot, footprint: Footprint): WallFrame | null {
  if (footprint.length < 3) return null;
  // Every coordinate, not the bounds: `footprintBounds` compares with `<` and `>`,
  // which are both false against NaN, so a NaN vertex is silently SKIPPED and the
  // bounds come back finite and confident. `lib/dimension-ranges.ts` records NaN as
  // a live hazard on this path, and this is the shape it arrives in.
  for (const [x, z] of footprint) if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
  const { minX, maxX, minZ, maxZ } = footprintBounds(footprint);
  // Distance and lateral extent in the lens's own axes, from `slotToWorld`'s
  // convention: n looks −Z with image-right +X, s looks +Z with right −X, e looks
  // +X with right +Z, w looks −X with right −Z.
  const frame =
    slot === 'n'
      ? { distance: -minZ, left: minX, right: maxX }
      : slot === 's'
        ? { distance: maxZ, left: -maxX, right: -minX }
        : slot === 'e'
          ? { distance: maxX, left: minZ, right: maxZ }
          : { distance: -minX, left: -maxZ, right: -minZ };
  if (!(frame.distance > 0)) return null;
  if (!(frame.left < 0 && frame.right > 0)) return null;
  return frame;
}

/**
 * The image columns the framed wall's two ends occupy, at one height on it.
 *
 * The lateral companion to `wallRowAtHeight`, and the reason a wall sample does
 * not need a guessed horizontal margin: a point on the wall plane at lateral
 * offset `x` projects to `u = 0.5 + (x / forward) / k`, so the wall's own ends are
 * a computed pair. Outside them lie the RETURN walls, which are a different
 * colour under different light, and are exactly what a percentage margin would
 * have been protecting against by luck.
 *
 * **It takes a height because the answer depends on one.** The previous version
 * divided by the wall distance and its docstring claimed the ends sit at
 * `0.5 ± (span/2 / d) / k` exactly; that is true only on the row level with the
 * lens. Tilt rotates about the right axis, so `forward` grows as the row drops
 * (`forwardAtHeight`) and the wall's ends move inward with it — measured at 3.6%
 * of the sampled band on the return wall at 30° of tilt, and the docstring was
 * the worse half of that defect. A caller wanting columns valid over a whole band
 * intersects the answer at the band's two ends; `forwardAtHeight` is monotonic in
 * `y`, so the two ends bound the interior and no sweep is needed.
 *
 * NOT clamped to the frame, for `wallRowAtHeight`'s reason: in a small room the
 * wall is wider than the lens can see and both ends are legitimately off-screen,
 * and which side they left by is the caller's to use. Null when the row is level
 * with or behind the lens.
 */
export function wallColumnsAtHeight(
  y: number,
  wall: WallFrame,
  cal: CameraCal,
): { left: number; right: number } | null {
  const fwd = forwardAtHeight(y, wall.distance, cal);
  if (!(fwd > 0)) return null;
  const left = 0.5 + wall.left / fwd / cal.k;
  const right = 0.5 + wall.right / fwd / cal.k;
  if (!Number.isFinite(left) || !Number.isFinite(right)) return null;
  return { left, right };
}

/**
 * Solve for CAMERA HEIGHT, given a known lens.
 *
 * This is the same one equation as `calibrateFromFloorLine`, inverted for the
 * other unknown. When EXIF tells us the field of view, height stops being the
 * 1.5 m assumption that costs ±17% on every measurement and becomes something
 * the photo measured:
 *
 *     H = D · (sinθ − b·cosθ) / (b·sinθ + cosθ)
 */
export function heightFromFloorLine(
  vFloor: number,
  slot: CaptureSlot,
  room: { width: number; depth: number },
  cal: CameraCal,
): number | null {
  if (vFloor <= 0.5 || vFloor >= 0.99) return null;
  const d = wallDistance(slot, room);
  const b = ((0.5 - vFloor) * cal.k) / cal.aspect;
  const tiltRad = tiltOf(cal);
  const c = Math.cos(tiltRad);
  const s = Math.sin(tiltRad);
  const denom = b * s + c;
  if (denom === 0) return null;
  const height = (d * (s - b * c)) / denom;
  if (!Number.isFinite(height) || height < MIN_SOLVED_HEIGHT || height > MAX_SOLVED_HEIGHT) return null;
  return height;
}

const tanX = (u: number, cal: CameraCal) => (u - 0.5) * cal.k;
/** positive up */
const tanY = (v: number, cal: CameraCal) => ((0.5 - v) * cal.k) / cal.aspect;

/** Direction of the ray through a normalized image point, in world-aligned
 *  camera axes (right / up / forward) with the camera's tilt applied.
 *
 *  Tilting the lens down by θ rotates every ray about the camera's right axis:
 *  the forward axis itself acquires `up = −sinθ`, which is what makes a level
 *  camera's simple `distance = height / tanDown` wrong by 19% at 3 m for a very
 *  ordinary 5° of handheld droop. At θ = 0 this collapses to (tanX, tanY, 1) and
 *  every formula below reduces to the one it replaced. */
function ray(u: number, v: number, cal: CameraCal): { right: number; up: number; fwd: number } {
  const a = tanX(u, cal);
  const b = tanY(v, cal);
  const c = Math.cos(tiltOf(cal));
  const s = Math.sin(tiltOf(cal));
  return { right: a, up: b * c - s, fwd: b * s + c };
}

/** Map a camera-frame (forward, right) floor point into world XZ + facing yaw. */
function slotToWorld(
  slot: CaptureSlot,
  forward: number,
  right: number,
): { x: number; z: number; yaw: number } {
  switch (slot) {
    // Image LEFT = −X → right = +X; looking −Z. Wall items face +Z (yaw 0).
    case 'n':
      return { x: right, z: -forward, yaw: 0 };
    // Image LEFT = +X (mirrored) → right = −X; looking +Z. Face −Z (yaw π).
    case 's':
      return { x: -right, z: forward, yaw: Math.PI };
    // Image LEFT = −Z → right = +Z; looking +X. Face −X (yaw −π/2).
    case 'e':
      return { x: forward, z: right, yaw: -Math.PI / 2 };
    // Image LEFT = +Z → right = −Z; looking −X. Face +X (yaw +π/2).
    case 'w':
      return { x: -forward, z: -right, yaw: Math.PI / 2 };
  }
}

export type GeoPlacement = {
  /** world position — x/z centre; y = 0 floor anchor (floor), mount centre
   *  (wall), or the ceiling plane itself (ceiling — the surface intersected, not an
   *  estimate; the row of the bbox that is intersected is the MIDDLE one, and
   *  `placeCeilingObject` is where that matters). Downstream, `groundY` owns this
   *  axis outright. */
  position: { x: number; y: number; z: number };
  /** real size estimate in mm — [W, H]; depth is NOT observable from one photo. */
  widthMM: number;
  heightMM: number;
  /** facing-into-the-room yaw for wall-adjacent items. */
  yaw: number;
  /** Forward distance from the camera, in metres.
   *
   *  Not a confidence input, though it read as one for a while — the doc used to
   *  say "useful for confidence weighting" and PlanDetect's Phase 6 listed wiring
   *  it in. It was declined there and the reason belongs here: `lib/detect-confidence.ts`
   *  argues that the fix for an uncalibrated number is corroboration, not a second
   *  invented threshold, and "a detection more than X metres away is Y less certain"
   *  is exactly that second invented threshold.
   *
   *  What it IS for: the observable these placements are tested through. A caller
   *  reads `pos` and `dimMM`, but a test cannot tell a tilt-aware solve from a naive
   *  one by looking at a position — the distance is the term the calibration
   *  actually moves, so `tests/photo-geometry.test.ts` asserts on it directly
   *  (clamped to the wall, ratio against the assumed-height solve, and so on).
   *  `RoomTools`' `top.distance` is a different type; nothing reads this one at
   *  runtime, and that is correct rather than an oversight. */
  distance: number;
};

/** What a placer needs to know about a piece's PLAN shape: the axis one photograph
 *  cannot see, plus whether the footprint is a circle.
 *
 *  Read by BOTH `placeFloorObject` and `placeWallObject`, which is why it is not
 *  named for either. They use it for the same reason — a bbox edge is a corner of a
 *  solid, not a point on a plane — and differ only in what pins the depth axis: a
 *  floor piece's near face is measured from the bottom row, a wall piece's BACK is
 *  on the plaster at a distance the room already gives.
 *
 *  Both come from the catalogue — `defaultDepthFor` and `isRoundPart` — and never
 *  from the detector. That is rule 2's trust boundary rather than a preference:
 *  `depthM` moves the decoded POSITION, so taking it from the AI's depth guess
 *  would be an AI-decided placement. `lib/detect-refine.ts` reads both off the
 *  same `(category, shape)` pair, so the depth a piece is positioned by and the
 *  roundness it is inverted as cannot disagree — and it writes that same depth
 *  into `dimMM[1]`, so the piece is DRAWN with the number it was placed by and
 *  its near face lands where the photograph actually put it.
 *
 *  `depthM: 0` is a depthless card. Nothing in the app produces one — a card is
 *  not a piece of furniture — but it is what the older fixtures project, and it
 *  is the case in which every term below collapses to the pre-depth arithmetic.
 */
export type PieceFootprint = {
  /** Front-to-back depth in metres, along the view axis of the framing camera. */
  depthM: number;
  /** Circular in plan (`isRoundPart`). A cylinder's silhouette is its TANGENT
   *  span, not the projection of its bounding box, so it inverts differently —
   *  and inverting one as a box over-reads its depth and comes back ~55% NARROW,
   *  which is worse than the error being fixed. */
  round?: boolean;
};

/**
 * Lateral offset, width and height of a BOX footprint, given where its near face
 * is. Returns the centre's forward distance, not the near face's.
 *
 * Which corner each silhouette edge came from is `lateralSpan`'s question, below;
 * this function's own job is the two faces and the two heights to hand it. Exact —
 * checked to thirteen digits against a forward-projected box at 0°, ±5° and 12°.
 *
 * At `depthM: 0` and a level lens this is the arithmetic it replaces, to the last
 * bit. Under tilt it is deliberately NOT, because the old version read the width
 * off the bbox's own centre column while the edges came from the top corners — a
 * card 1.6 m wide read 90 mm out at 5°, which is why the tolerance in
 * `tests/photo-geometry.test.ts` that allowed it could be tightened to nothing.
 */
function floorFromBox(
  box: [number, number, number, number],
  near: number,
  depthM: number,
  cal: CameraCal,
): { d: number; right: number; widthM: number; heightM: number } | null {
  const [bx, by, bw] = box;
  const far = near + depthM;
  const top = ray(bx + bw / 2, by, cal);
  if (!(top.fwd > 0)) return null;

  // The topmost row is the NEAR top edge when the piece's top is above the lens
  // and the FAR one when it is below — and the sign of the top ray tells us which
  // without knowing the height first. Reading it always at the near face is what
  // made a nightstand ~130 mm too tall while a wardrobe came out right.
  const heightM = heightOf(cal) + ((top.up > 0 ? near : far) / top.fwd) * top.up;
  if (!(heightM > 0)) return null;

  const span = lateralSpan(box, [near, far], [0, heightM], cal);
  if (!span) return null;
  return { d: near + depthM / 2, right: span.right, widthM: span.widthM, heightM };
}

/**
 * The lateral offset and width of a box, given the two faces and the two heights
 * its eight corners occupy.
 *
 * Shared by the floor and wall placers because it is the same question for both: an
 * observed bbox edge is a CORNER, and which corner is decided by `zc` — the forward
 * distance after the tilt rotation, which depends on the corner's height as well as
 * its face. So an edge whose observed tangent is positive came from the corner with
 * the smallest `zc`, and a negative one from the largest. No search, no iteration.
 *
 * Extracted rather than copied. Two placers each holding their own version of this
 * is the shape of scar `lib/layout-rules.ts` and `lib/drag-convoy.ts` both carry —
 * one rule, three implementations, drifting apart in the direction nobody looks.
 */
function lateralSpan(
  box: [number, number, number, number],
  faces: [number, number],
  heights: [number, number],
  cal: CameraCal,
): { right: number; widthM: number } | null {
  const [bx, , bw] = box;
  const zc = faces.flatMap((f) => heights.map((y) => forwardAtHeight(y, f, cal)));
  const zMin = Math.min(...zc);
  const zMax = Math.max(...zc);
  // Arithmetic protection, and it does NOT fire — said plainly rather than left
  // looking tested. A negative `zc` would flip the sign of both silhouette edges
  // and hand back a mirrored piece in silence, so the guard is worth its line; but
  // swept over nine tilts from −60° to +60°, a dense grid of boxes and four depths
  // to 12 m, no input reaches it, and deleting it fails nothing. Documented instead
  // of given a test that would have to pretend.
  if (!(zMin > 0)) return null;

  const tanL = tanX(bx, cal);
  const tanR = tanX(bx + bw, cal);
  const left = tanL < 0 ? tanL * zMin : tanL * zMax;
  const right = tanR > 0 ? tanR * zMin : tanR * zMax;
  return { right: (left + right) / 2, widthM: right - left };
}

/**
 * Can the framed surface be the surface this piece is actually on?
 *
 * Two of the three placers do not measure the distance to their subject, they ASSUME
 * it — `placeWallObject` puts the piece on the framed wall's plane, `placeCeilingObject`
 * on the slab. The decoded lateral offset is a TEST of that assumption: an answer past the
 * framed wall's own ends says the ray left the room, which means the plane it was inverted
 * against was the wrong plane and every number taken off it — width, height, position — is
 * void rather than slightly off. Those ends come from the FOOTPRINT (`wallFrame`), never
 * from `wallSpan`: a bounding-box dimension describes the wall only in a room centred on
 * the lens, and reading it as the room's lateral extent is how the first version of this
 * refused a correctly measured print in a room whose wall had been dragged.
 *
 * **On an ultrawide, every ordinary room has picture beyond the ends of the wall it is
 * photographing**, and what is out there is the RETURN wall. The condition is
 * `wallSpan < 2·tan(hFOV/2) · wallDistance`, which at 106° is `< 2.654 × wallDistance`;
 * a square room sits at 2.0, so it is always exposed. Measured in a 7 × 6 room: a
 * 700 × 500 print on the north wall, its centre 800 mm from the north-east corner of a
 * 6 × 4 room, is wholly inside the east photo's frame and decodes as an east-wall piece
 * **764 mm past that wall's end, 893 mm wide and 803 mm tall — +28% and +61%**, larger
 * than the air conditioner that `placeWallObject`'s own docblock is written around.
 *
 * **Those figures are printed by `tests/photo-geometry.test.ts` on every green run, and
 * the ones this paragraph used to carry were not.** It said 960 × 711 at 769 mm, which
 * came from a scratch script that re-implemented the arithmetic in node rather than
 * calling the placer — careful measurement of the wrong subject. The height error is also
 * the LARGER of the two and went unmentioned for as long as the number was hand-carried.
 *
 * **What it does NOT do is remove the duplicate row, and that claim was written here
 * before it was measured.** The same print is in the north photo, correctly placed; the
 * two sightings are ~1.0 m apart against `painting`'s 0.35 m tier, so `dedupeDetections`
 * keeps both — and it keeps both AFTER the refusal too, since a refused detection has no
 * `position` and the merge declines to compare one that is missing. Measured through
 * `refineDetections`: two rows in, two rows out, before and after. What changes is that
 * the second row is UNMEASURED rather than mis-measured — catalogue size, arranged by
 * `placementForSlot` — which is `placeCeilingObject`'s "no better than before beats
 * confidently wrong", not a de-duplication. The row count is not this gate's to move.
 *
 * **REFUSED, not clamped**, for `placeCeilingObject`'s reason one axis over: clamping
 * leaves the piece a metre from the truth AND keeps a size read off the wrong plane, so
 * it stays a duplicate and stays wrong. Refusing costs the MEASUREMENT and not the
 * piece — `geoRefine` hands the detection back untouched, `placementForSlot` arranges
 * it at its catalogue size, and `lib/label-repair.ts` reads that same object identity as
 * "unmeasurable", so `judgeLabel` does not accuse it either.
 *
 * The CENTRE is what is tested, not the extent. "Wholly off the wall" is the looser
 * variant and it leaks — measured, after that variant survived a first round of mutation
 * with every assertion green: a 1400 × 500 curtain on the return wall, its far edge
 * 250 mm from the shared corner, is wide enough that its decoded near edge falls back
 * inside the framed wall while its centre does not, so the loose form accepts it as
 * **1815 × 942 at 2.86 m along a 2.0 m half-span** (+30% wide, +88% tall). A
 * piece genuinely straddling a corner has its centre inside and is kept, then pulled in
 * by `snapToWall`. The line ITSELF is a floating-point boundary — a centre computed at
 * exactly the half-span comes back as 2.0000000000000004 and is refused — and that is
 * recorded rather than tuned, because nothing real sits there: a piece centred on the
 * plaster is half buried in it, and the margins this catches are 600–800 mm. Which is
 * also why **flipping these two comparisons to strict is a mutant that SURVIVES**, and
 * saying so is cheaper than a test that would pin float noise: no fixture can put a
 * centre exactly on a bound, so the closed-vs-open end of this interval is not a
 * behaviour anything observes. The bound's SIDES are pinned — `Math.abs(right) <=
 * frame.right` survived until an off-centre fabrication past the short end was built.
 *
 * **`placeFloorObject` deliberately has no such gate**, and that is the whole shape of
 * this rule rather than an omission: it MEASURES its distance from the bottom row, so a
 * floor piece against the return wall is decoded correctly — which is why the harness's
 * cross-slot lamp merges to one row. Its lateral is an observation, and refusing an
 * observation is the mistake the two-clamp split in `placeFloorObject` exists to prevent.
 * A bound may falsify an assumption; it may not overrule a measurement.
 *
 * That exemption is a DECISION rather than a vacuous case, and adding the gate there is a
 * mutant that survives the suite — so it rests on a measured property instead. A floor
 * lateral is first-order invariant to the assumed lens (distance ∝ 1/k, tangent ∝ k, and
 * they cancel), with a ~2.8% residual from the one term that does not scale, the
 * catalogue depth. So the gate would be inert on a floor piece except within about 3% of
 * the wall's own end, where it would refuse a MEASUREMENT over a lens error — which is
 * exactly the trade the rule above forbids. `tests/photo-geometry.test.ts` holds both
 * halves: the invariance, and the direction the near-face clamp moves the answer when the
 * lens is under-read, which is inward.
 *
 * **The bound is the wall's REAL extent, from `wallFrame`, and the argument that used to
 * stand here for the ±half pair was wrong.** It said a gate must speak the same convention
 * as the assumption it falsifies, so that both would at least be wrong the same way. They
 * are not wrong the same way: drag a room's EAST wall out and the north wall's distance is
 * still exactly `depth/2` — the plane is right — while `wallSpan/2` no longer describes how
 * far that wall reaches. Only the bound was wrong, and the excuse described a case that was
 * not this one. Where the plane IS wrong too, the gate declines to fire; see below.
 *
 * **One limitation, stated rather than smoothed: this is only as good as the lens — and
 * both directions are measured, where every earlier version of this paragraph named only
 * the harmless one.** A wall piece's decoded offset is EXACTLY proportional to `cal.k`:
 * the distance is pinned to the wall and `lateralSpan`'s multipliers are room-derived, so
 * none of the cancellation `placeFloorObject` enjoys happens here. The threshold therefore
 * moves as `1/r` for `r = k_believed / k_true`, and the room never changes. Measured, and
 * printed by `tests/photo-geometry.test.ts` on every green run — the largest fraction of
 * the half-span still accepted, and what the same `r` did to the SIZE:
 *
 *     shot at   read as    r      last accepted   size wrong by
 *      100°       106°   1.114        0.85            +11%
 *       90°       106°   1.327        0.75            +32%
 *       80°       106°   1.582        0.60            +58%
 *       66°       106°   2.043        0.45           +104%
 *      106°        66°   0.489        1.00 (never)    −51%
 *
 * A cal assumed NARROWER than the truth never refuses: it under-reads every lateral,
 * pulling a fabrication inward where nothing can see it — the same print read at 66°
 * instead of 106° lands 2.27 m out, comfortably inside a 3.0 m half-span — but it cannot
 * touch a real piece. An over-read one refuses further in the wider the error, and 66°
 * mistaken for 106° costs the outer HALF of every wall.
 *
 * **The last column is what makes that defensible**, and it is an argument this gate could
 * not make until somebody measured instead of reasoning: width comes off the same tangents
 * at the same pinned distance, so an `r` that moves the threshold has already inflated the
 * size by the same factor. The piece refused at 0.45 of the wall would have come back 104%
 * too wide. So the over-read case discards a measurement that was already worthless —
 * which is not a bound overruling a measurement, the thing the floor exemption above
 * exists to prevent.
 */
function onFramedSurface(
  right: number,
  slot: CaptureSlot,
  room: { width: number; depth: number; footprint: Footprint },
): boolean {
  const frame = wallFrame(slot, room.footprint);
  // No frame is no answer, and no answer must not become a refusal: `wallFrame`
  // declines a polygon with fewer than three points, a NaN vertex, or one the lens
  // does not stand inside, and none of those tell us the piece is off the wall.
  if (!frame) return true;
  // And the bound may only speak where the PLANE it bounds is trustworthy. The two
  // disagree exactly when the framed wall — or the one opposite it — has been dragged,
  // and then `placeWallObject`'s assumed distance is wrong too: a north wall pulled
  // INWARD makes the decode over-read every lateral offset by `wallDistance / true`,
  // which clears even an honest bound and would refuse a correct measurement. So the
  // gate goes inert there and says why, rather than refusing on an input it cannot
  // check. § 44 is what closes it, by moving the distance to this same frame.
  //
  // Exact inequality rather than a tolerance, and that is not brittle: on any room
  // centred on the lens both sides are the same two divisions of the same numbers, so
  // they agree bit-for-bit — `tests/wall-sample.test.ts` pins that equivalence, and it
  // is what makes reading the frame here a NO-OP on every room the harness uses.
  if (frame.distance !== wallDistance(slot, room)) return true;
  // The wall's own ends, asymmetric, because a room is not obliged to be centred on
  // the lens: pull a 6 × 6 room's east wall out by a metre and the north wall reaches
  // x = +4 while ±half still says 3.5. Measured before this read the polygon: a
  // 700 × 500 print at x = 3.2 came back exactly 700 × 500 and the same print at
  // x = 3.52 — wholly inside the room, wholly inside the frame — was REFUSED. A gate
  // that discards a correct measurement is worse than the fabrication it was built to
  // catch, and it took an off-centre fixture to see it: `wallSpan/2` is a BOUNDING-BOX
  // dimension, and the sentence this docblock used to carry ("the room's lateral extent
  // from this camera IS `wallSpan`") was true only of a rectangle centred on the origin.
  return right >= frame.left && right <= frame.right;
}

/**
 * The same three answers for a ROUND footprint, where the diameter is recovered
 * rather than assumed — a circle's depth IS its width, so this branch needs no
 * catalogue number at all. Worth stating plainly: the two pieces with the worst
 * width errors under the old model, a floor lamp at +81% and a plant at +54%, are
 * the two the fix does not have to trust a default for.
 *
 * The bbox's edges are the circle's tangent lines, so they give the centre's
 * azimuth `α` and the half-tangent-angle `β` directly, and the near rim closes it:
 * `near = m·cos α − ρ` with `ρ = m·sin β`, hence `m = near / (cos α − sin β)`.
 * Exact at a level lens.
 *
 * **The one term here that is approximate, measured rather than assumed.** A
 * vertical tangent line's image column varies with row, and the row at which the
 * tangency actually falls is not the bbox's own top row, so under tilt `α` and `β`
 * are read a little off. Measured at 5°: a plant reads +9.8% (was +24%) and a tall
 * floor lamp +37% (was +73%) — exact level, roughly twice as good tilted. A
 * fixed-point refinement was tried and does not converge for a tall thin cylinder,
 * so it is not shipped on the strength of a guess; the residual is recorded in
 * `docs/what-is-still-open.md` instead.
 */
function floorFromRound(
  box: [number, number, number, number],
  near: number,
  cal: CameraCal,
): { d: number; right: number; widthM: number; heightM: number } | null {
  const [bx, by, bw, bh] = box;
  // Where a tangent line's column is extreme: at the piece's own top when the lens
  // tilts down, its base when the lens tilts up — whichever end `forwardAtHeight`
  // makes nearest.
  const vEdge = tiltOf(cal) > 0 ? by : by + bh;
  const eL = ray(bx, vEdge, cal);
  const eR = ray(bx + bw, vEdge, cal);
  if (!(eL.fwd > 0) || !(eR.fwd > 0)) return null;

  const alpha = (Math.atan2(eR.right, eR.fwd) + Math.atan2(eL.right, eL.fwd)) / 2;
  const beta = (Math.atan2(eR.right, eR.fwd) - Math.atan2(eL.right, eL.fwd)) / 2;
  // There is no `beta > 0` guard here, and there was one for a commit. A zero- or
  // negative-width bbox gives `beta <= 0`, hence `radius <= 0`, hence a width the
  // shared check at the bottom of `placeFloorObject` already refuses — so the guard
  // refused nothing that was not refused anyway, and mutation said so: deleting it
  // failed no test, including the one written for it. The behaviour is pinned in
  // `tests/photo-geometry.test.ts` where it belongs, on the answer rather than on the
  // line that was supposed to produce it.
  //
  // Not reachable, and the same note as `zMin` above applies. `den` is
  // `cos α − sin β`, which is ≤ 0 only when the lens is inside the circle — that
  // needs `α + β ≥ 90°`, i.e. a tangent leaving the frame's own half-angle. The
  // widest lens this app will accept is 150° from an EXIF focal length and 120° from
  // the floor-line solve, so `α + β ≤ 75°`. It guards a division, not a behaviour.
  const den = Math.cos(alpha) - Math.sin(beta);
  if (!(den > 1e-6)) return null;
  const m = near / den;
  const radius = m * Math.sin(beta);

  const top = ray(bx + bw / 2, by, cal);
  if (!(top.fwd > 0)) return null;
  const heightM = heightOf(cal) + ((top.up > 0 ? near : near + 2 * radius) / top.fwd) * top.up;
  if (!(heightM > 0)) return null;

  return { d: m * Math.cos(alpha), right: m * Math.sin(alpha), widthM: 2 * radius, heightM };
}

/**
 * Floor-standing object: backproject the bbox's bottom edge onto the floor to find
 * the piece's NEAR FACE, then solve the silhouette for where its centre is and how
 * big it is. box = [x, y, w, h] normalized 0..1, origin top-left.
 *
 * **The bottom row is the near face, and for as long as this function existed it
 * was decoded as the centre.** A floor point's image row is a function of its
 * forward distance ALONE — the lens rotates about its own right axis, so `tanX` is
 * untouched by tilt and two floor points at the same distance share a row to twelve
 * digits — which means the lowest row in a silhouette is the closest ground contact
 * the piece has. For a real box that is the corner nearest the lens; for a
 * fronto-parallel card it is the centre plane, and the two are the same thing. So
 * every floor piece was measured about half its own depth too close: an 850 mm sofa
 * by 425 mm, exactly.
 *
 * It was invisible for as long as the suite existed because the FIXTURE was a card
 * too — `bboxOfFloorObject` offsets along the wall axis only, so a 600 mm wardrobe
 * was a flat rectangle and the placer was exactly right about the thing it was
 * given. A 1e-9 baseline that holds because the fixture cannot express the defect
 * is the same failure as an assertion that cannot fail; `bboxOfFloorBox` and
 * `bboxOfFloorCylinder` in `tests/helpers/project.ts` are the fixtures that can.
 *
 * Every other term rode that same distance, so this is one model rather than a
 * patch on the position: the forward answer is `near + depth/2`, and width, lateral
 * offset and height come from `floorFromBox` or `floorFromRound` above.
 */
export function placeFloorObject(
  box: [number, number, number, number],
  slot: CaptureSlot,
  room: { width: number; depth: number },
  cal: CameraCal,
  foot: PieceFootprint,
): GeoPlacement | null {
  const [bx, by, bw, bh] = box;
  const height = heightOf(cal);
  const depthM = foot.depthM > 0 ? foot.depthM : 0;

  // Where the bottom edge's ray meets the floor plane.
  const bottom = ray(bx + bw / 2, by + bh, cal);
  if (bottom.up >= -0.02) return null; // at or above the horizon — not on the floor
  let near = (height / -bottom.up) * bottom.fwd;
  if (!(near > 0)) return null;

  // TWO clamps, against two different walls, because there are now two kinds of
  // wrong and only one of them is the photograph's fault.
  //
  // The NEAR FACE is measured, and a measured face cannot be beyond the plaster —
  // that is the clamp this function has always had, and it earns its keep on the
  // lens: an assumed-narrow lens over-reads distance, the clamp pulls it back, and
  // the width is re-derived with it so the two agree (see the `defaultCal` pair in
  // `tests/photo-geometry.test.ts`). Unchanged, and it is the only clamp that may
  // touch a measurement.
  const wallD = wallDistance(slot, room);
  near = Math.min(Math.max(near, 0.3), wallD);

  const solved = foot.round
    ? floorFromRound(box, near, cal)
    : floorFromBox(box, near, depthM, cal);
  if (!solved) return null;
  const { right, widthM, heightM } = solved;
  if (widthM <= 0.01 || heightM <= 0.01) return null;

  // The CENTRE is measurement plus assumption, so it gets its own bound: the
  // piece's back may reach the wall and no further. Half a round footprint's depth
  // is its own measured radius; a box's is the catalogue number.
  //
  // Keeping these apart is not tidiness. Folding the depth into the first clamp
  // instead — near ≤ wallD − depth, which is the obvious one line — makes a
  // catalogue depth 100 mm too generous shrink a MEASURED width: the sofa's 2.0 m
  // came back 1.925 m, exact position traded for an inexact size, an assumption
  // corrupting an observation. Measured, not reasoned: that is what the first
  // version of this did.
  const half = (foot.round ? widthM : depthM) / 2;
  const d = Math.min(solved.d, Math.max(0.3, wallD - half));

  const { x, z, yaw } = slotToWorld(slot, d, right);
  return {
    position: { x, y: 0, z },
    widthMM: Math.round(widthM * 1000),
    heightMM: Math.round(heightM * 1000),
    yaw,
    distance: d,
  };
}

/**
 * Wall-mounted object (TV, painting, window, AC…). Its BACK is on the framed wall
 * at the known wall distance, and its body projects into the room — so the plane
 * that casts the silhouette is `d − depth`, not `d`.
 *
 * **It used to put the piece's CENTRE on the plaster**, which is where a TV's back
 * goes, and that made the whole piece a little nearer the lens than the placer
 * thought. Every angular measurement was then read at the wrong plane and came back
 * large: at a level lens a 60 mm TV +4.1% wide, an 80 mm curtain +63 mm tall, and a
 * 220 mm air conditioner **+21.7% wide and +81 mm tall** — the last of which decodes
 * a correct 280 mm unit as 371 mm, outside `ac-unit`'s own 250–350 band, so
 * `judgeLabel` accused a correctly identified piece and the detect screen offered to
 * repair it. Like the floor case, the error GROWS with tilt: the curtain reaches
 * +15.5% at 12°.
 *
 * Same shape of defect as `placeFloorObject`'s near face, same fix, and the same
 * reason nobody saw it: the fixture. `boxFor` projected wall pieces as depthless
 * PANELS, and all three in the truth table are thin (30–80 mm), so wiring depth
 * through measured 5–23 mm and the finding read as minor. The catalogue's wall
 * shapes go to 220 mm (`ac-unit`) and 200 mm (`window`, which gets there by the
 * `other` category's 600 mm hitting its shape's clamp).
 *
 * **One thing to know before reading the position it returns.** The wall-normal
 * coordinate does not reach the rendered scene: `wallAffinity` is `must-wall` for
 * every wall anchor and that branch calls `snapToWall` unconditionally, which
 * recomputes x/z as `wall + inward normal × (depth/2 + gap)` and discards this
 * answer; `groundY` overwrites the height on the line before. So the scene was
 * already putting the piece's back on the plaster, by a downstream correction. What
 * this fix changes for the USER is the SIZE. The position is returned honestly
 * anyway, because `dedupeDetections` and `buildSceneFromRoom`'s in-room gate read
 * the raw value, and because a placer whose own answer needs a correction
 * downstream to be right is how the next reader is misled.
 *
 * **And the plane it assumes is not always the right plane.** An ultrawide frames more
 * than the wall it is pointed at, so a piece on the RETURN wall near the shared corner
 * is in shot, and reading it against the framed wall's plane fabricates both its offset
 * and its size — a 700 × 500 print 800 mm from the corner comes back **893 × 803 at
 * 764 mm past the wall's end** (+28% wide, +61% tall; measured and printed by
 * `tests/photo-geometry.test.ts`). `onFramedSurface` refuses that, which is why this
 * function can return null for a box that is perfectly in frame.
 */
export function placeWallObject(
  box: [number, number, number, number],
  slot: CaptureSlot,
  /** `footprint` is required because `onFramedSurface` bounds the decoded offset by the
   *  wall's REAL ends; width/depth still give the assumed plane, which is § 44's to move. */
  room: { width: number; depth: number; footprint: Footprint },
  cal: CameraCal,
  foot: PieceFootprint,
): GeoPlacement | null {
  const [bx, by, bw, bh] = box;
  const d = wallDistance(slot, room);
  const uC = bx + bw / 2;
  const height = heightOf(cal);
  // The near face may not reach the lens. Belt and braces rather than a behaviour:
  // the deepest wall-anchored shape is 300 mm and `ROOM_SIDE_M` floors a wall at
  // 0.5 m away, so `d − depth` is at least 0.2 m and this never bites. Kept because
  // a negative near face would mirror the piece in silence.
  const depthM = Math.min(foot.depthM > 0 ? foot.depthM : 0, Math.max(0, d - 0.3));
  const near = d - depthM;

  const rTop = ray(uC, by, cal);
  const rBottom = ray(uC, by + bh, cal);
  if (!(rTop.fwd > 0) || !(rBottom.fwd > 0)) return null;

  // Which face each row came from, and it is observable rather than assumed. A point
  // ABOVE the lens climbs the frame as it gets nearer, so the topmost row is the
  // near face's top edge; a point below does the opposite. The bottom row takes the
  // opposite choice on the same test. Reading both at the plaster is the old bug.
  const yTop = height + ((rTop.up > 0 ? near : d) / rTop.fwd) * rTop.up;
  const yBottom = height + ((rBottom.up > 0 ? d : near) / rBottom.fwd) * rBottom.up;
  const heightM = yTop - yBottom;

  const span = lateralSpan(box, [near, d], [yBottom, yTop], cal);
  if (!span) return null;
  const { right, widthM } = span;
  if (widthM <= 0.01 || heightM <= 0.01) return null;
  // A piece whose centre decodes past the ends of the framed wall is not on the framed
  // wall — it is on the RETURN wall, which an ultrawide sees in every ordinary room. See
  // `onFramedSurface`: refused rather than clamped, and it is the SIZE that was wrong.
  if (!onFramedSurface(right, slot, room)) return null;

  // The body's centre: its back is on the plaster, so it sits half a depth in.
  const { x, z, yaw } = slotToWorld(slot, d - depthM / 2, right);
  return {
    position: { x, y: (yTop + yBottom) / 2, z },
    widthMM: Math.round(widthM * 1000),
    heightMM: Math.round(heightM * 1000),
    yaw,
    distance: d - depthM / 2,
  };
}

/** A ceiling placement carries NO height — see `placeCeilingObject`. Modelled as
 *  an `Omit` rather than a `heightMM` of 0 or null so that nothing downstream can
 *  read a measurement which was never taken. */
export type GeoCeilingPlacement = Omit<GeoPlacement, 'heightMM'>;

/**
 * Ceiling-mounted object (fan, pendant): it lies ON the ceiling plane at a known
 * HEIGHT above the camera, which makes it the mirror of `placeWallObject` — that
 * one knows the plane's distance, this one knows its rise — rather than of
 * `placeFloorObject`.
 *
 * **The MIDDLE bbox row is what gets intersected, not an edge, and that is the
 * whole accuracy of this function.** A floor object is a vertical thing whose
 * bottom edge is at one distance, so backprojecting that edge is right. A ceiling
 * fan is a horizontal PLATE seen obliquely: its image spans a range of distances,
 * with the top of the bbox being its NEAREST edge. Intersecting the top row
 * measures the near edge and then applies the disc's full angular width at that
 * shorter distance — for a 1.2 m fan 2.5 m away, 0.94 m, a 22% under-read that is
 * further from the truth than the catalogue default it was supposed to improve on.
 * The centre row lands within a few percent.
 *
 * **Width only, and the reason is geometric rather than lazy.** That same plate
 * has no thickness in its bbox: the vertical extent is the foreshortened diameter.
 * Deriving H from it manufactures a fan 1200 mm tall, which `clampDims` then
 * squashes to 450 — a fake measurement followed by a silent resize, both halves of
 * what CLAUDE.md rule 2 forbids, in one function. Height stays with the catalogue.
 *
 * **A level camera in a normal room does not see the ceiling at all**, and this
 * refuses every such shot rather than pretending. At 66° hFOV on 4:3 the vertical
 * half-angle is ~24°, so from 1.5 m the ceiling of a 2.8 m room first enters frame
 * 2.9 m away — beyond the wall being photographed. It is the same fact
 * `calibrateFromFloorLine` runs into at the other end of the frame. What DOES see a
 * ceiling: an ultrawide (~106°, in frame from 1.3 m out), a camera tilted up, or a
 * tall room. So this earns its keep on real phone captures and on the arbitrary
 * uploads the capture rig is heading toward, not on the nominal rig.
 *
 * Which is why an intersection PAST the far wall is refused rather than clamped to
 * it, the one place this deliberately departs from `placeFloorObject`. The floor is
 * visible right up to the wall, so a foot landing slightly beyond it is measurement
 * error and clamping recovers it. The ceiling of a level 66° shot is not in frame at
 * all — so a high pixel there is WALL, and clamping it onto the ceiling plane
 * measures a picture frame as an undersized ceiling fan — the width comes out at
 * the wall distance rather than the true one, so it is wrong by whatever the clamp
 * moved. Refusing hands the detection
 * back untouched, which is exactly the behaviour that existed before this function
 * did. Being no better than before beats being confidently wrong.
 *
 * **That paragraph described one axis and read as though it described both.** The gate
 * it justifies bounded the wall-normal distance only, so a ray could reach the slab
 * INSIDE the framed wall and still be outside the room sideways — measured, a 300 mm
 * vent high on the north wall 770 mm from the north-east corner sits wholly inside the
 * east photo's frame, intersects the slab at 2.56 m against a 3.0 m bound — INSIDE it, so
 * the gate above never sees it — lands 571 mm outside the room, and is read 386 mm wide
 * against a true 300. (Those are the 6 × 4 room the tests use; the same case in a 7 × 6
 * room is 3.30 m against 3.5, 643 mm out and 401 mm wide, which is what this note used to
 * quote while the fixture beside it measured the other room.) Same argument, same answer:
 * `onFramedSurface` refuses it. A refusal that covers one of two axes is not half a
 * refusal, it is a gate whose docstring certifies the hole.
 */
export function placeCeilingObject(
  box: [number, number, number, number],
  slot: CaptureSlot,
  room: { width: number; depth: number; height: number; footprint: Footprint },
  cal: CameraCal,
): GeoCeilingPlacement | null {
  const [bx, by, bw, bh] = box;
  const uC = bx + bw / 2;
  const rise = room.height - heightOf(cal);
  if (!(rise > 0.05)) return null; // camera at or above the slab — not a room

  // The one row that is read. `bh` is used ONLY to find its centre — no height is
  // derived from it, which is the point of the whole function.
  const mid = ray(uC, by + bh / 2, cal);
  if (mid.up <= 0.02) return null; // at or below the horizon — not on the ceiling
  const t = rise / mid.up; // along the ray
  const d = t * mid.fwd; // forward distance from the camera
  if (!(d > 0)) return null;

  // Nothing on this room's ceiling is beyond the wall being photographed, so a ray
  // that only reaches the ceiling plane out there never touched the ceiling at all.
  // REFUSED, not clamped — see the note above.
  if (d > wallDistance(slot, room)) return null;

  const right = t * mid.right;
  // And nothing on this room's ceiling is outside its walls SIDEWAYS either, which is
  // the half of that refusal this function shipped without. Same fixture shape, same
  // arithmetic: a 300 mm vent high on the north wall 770 mm from the north-east corner
  // is wholly in the east photo's frame, intersects the slab 2.56 m out — INSIDE the
  // 3.0 m gate above, so that one never sees it — 571 mm outside the room laterally, and
  // is read 386 mm wide against a true 300. Printed by `tests/photo-geometry.test.ts`,
  // in the room those fixtures actually use. See `onFramedSurface`.
  if (!onFramedSurface(right, slot, room)) return null;
  const widthM = t * (tanX(bx + bw, cal) - tanX(bx, cal));
  if (widthM <= 0.01) return null;

  const { x, z, yaw } = slotToWorld(slot, d, right);
  return {
    // y is the ceiling plane itself: unlike the other two placers this is not an
    // estimate, it is the surface that was intersected. `groundY` still owns the
    // axis downstream and hangs the part just under the slab.
    position: { x, y: room.height, z },
    widthMM: Math.round(widthM * 1000),
    yaw,
    distance: d,
  };
}

/** Aspect ratio (width / height) of an image blob. Browser only. */
export async function imageAspect(blob: Blob): Promise<number> {
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = url;
    });
    return img.naturalWidth / Math.max(1, img.naturalHeight);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Read the lens and the tilt out of a photo's own geometry — the vanishing-point
 * path, for the photos EXIF cannot help with. Browser only; the maths it wraps is
 * pure and tested in `lib/vanishing-point.ts`.
 *
 * Runs at the image's own resolution rather than a thumbnail, and that is not an
 * oversight: the same synthetic room calibrates to 78.0° at 1600 px, 77.8° at
 * 1200, and is correctly REFUSED at 800, because the edge fragments get too short
 * for their angles to mean anything. `normalizePhoto` caps the long edge at
 * 1600 px, so what arrives here is already the resolution this was measured at.
 */
export async function calibrateFromPhoto(blob: Blob): Promise<VanishingCalibration | null> {
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = url;
    });
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    if (w < 2 || h < 2) return null;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, w, h);
    const gray = toGrayscale(ctx.getImageData(0, 0, w, h).data, w, h);
    return calibrateFromSegments(detectSegments(gray, w, h), w, h);
  } catch {
    // An undecodable photo is a photo we calibrate some other way, not a crash.
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Find the wall-floor boundary row in a photo for calibration. Looks for the
 * strongest horizontal luminance edge in the lower band of the image. Cheap
 * (small canvas), deterministic, and honest about failure: returns null when
 * no row is clearly dominant (occluded floor line, busy rug, low contrast).
 * Runs only in the browser.
 */
export async function findFloorLine(blob: Blob): Promise<number | null> {
  const SAMPLE_W = 160;
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = url;
    });
    const aspect = img.naturalWidth / img.naturalHeight;
    const w = SAMPLE_W;
    const h = Math.max(60, Math.round(SAMPLE_W / aspect));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;
    const lum = (i: number) => 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];

    // Per-row edge energy: mean |row − previous row| luminance difference.
    const lo = Math.floor(h * 0.55);
    const hi = Math.floor(h * 0.97);
    let bestRow = -1;
    let bestE = 0;
    let sumE = 0;
    let n = 0;
    for (let y = lo; y < hi; y++) {
      let e = 0;
      for (let x = 0; x < w; x++) {
        e += Math.abs(lum((y * w + x) * 4) - lum(((y - 1) * w + x) * 4));
      }
      e /= w;
      sumE += e;
      n++;
      if (e > bestE) {
        bestE = e;
        bestRow = y;
      }
    }
    const meanE = sumE / Math.max(1, n);
    // Dominance gate — the floor line must clearly beat the band's noise floor.
    if (bestRow < 0 || bestE < meanE * 2.2 || bestE < 6) return null;
    return bestRow / h;
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

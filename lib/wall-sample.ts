// Which part of a wall photo is WALL, and which wall it paints. PURE — no canvas,
// no Blob, no DOM, so all of it is reachable from the node test environment.
//
// The browser half lives in `lib/wall-colors.ts`, which decodes a capture and
// hands the pixels to `lib/color-reduce.ts`. Same seam as `calibrateFromPhoto` →
// `lib/vanishing-point.ts`, and drawn here for the same reason: everything below
// that decides anything is testable, and `lib/color-sample.ts` had no test at all
// for as long as its arithmetic lived inside its `createImageBitmap` call.
//
// WHY NOT `findFloorLine`. The obvious way to find the wall is to look for the
// wall-floor line in the pixels, and `lib/photo-geometry.ts` already has a
// function for it. It is the wrong tool here: it is a luminance heuristic with no
// pure core and no test, it needs `bestE >= 2.2 * meanE` to answer at all, and
// when the junction is oblique in frame it LOSES the answer rather than biasing
// it. The room's own numbers already say where the wall is — `wallRowAtHeight`
// and `wallColumnsAtHeight` are that, in closed form — so there is nothing here
// to detect.
//
// **Except the lens, which is the one term the room cannot supply**, and the first
// version of this file waved that away: it read an unknown lens as the 66° phone
// main and said a wrong lens was forgiving here. On a photo taken on the ultrawide
// — the normal case in a small room, and the case with no EXIF focal length in it —
// a third of what it sampled was floor and ceiling. `WIDEST_HFOV_DEG` is the answer:
// the error is one-sided, so an assumed lens is assumed WIDE, which shrinks the
// band onto real wall instead of spilling it off both ends.

import type { CaptureSlot } from './storage';
import { SLOT_ORDER } from './capture-slots';
import { medianHex } from './color-reduce';
import { wallOutwardNormal, type Footprint } from './footprint';
import {
  CAM_HEIGHT,
  wallColumnsAtHeight,
  wallFrame,
  wallRowAtHeight,
  type CameraCal,
} from './photo-geometry';

/** Skirting boards, and whatever is stacked against them. Real rooms have 70–150 mm
 *  of painted timber at the bottom of every wall, in a different colour from the
 *  wall about as often as not. Metres, off the floor. */
export const SKIRTING_M = 0.18;

/** Coving, picture rails and the shadow a ceiling casts into the corner. Metres,
 *  down from the ceiling. Larger than the skirting allowance because the corner
 *  shadow reaches further than the moulding does. */
export const COVING_M = 0.22;

/** Below this much clear wall between the two allowances there is nothing worth
 *  sampling, and the honest answer is to refuse rather than to sample the coving.
 *  Metres. A 1.8 m ceiling — `ROOM_HEIGHT_M.min`, the lowest this app accepts —
 *  still clears it. (This said `ROOM_SIDE_M` and named the wrong constant: that
 *  one is a room's width and depth, 1–50 m.) */
export const MIN_WALL_M = 0.5;

/** Fraction of the wall's on-screen WIDTH trimmed from each end. Unlike the
 *  vertical allowances this one is not a physical length: `wallColumnsAtHeight`
 *  computes where the return walls begin, and this only guards the last few pixels
 *  of resampling bleed at that boundary.
 *
 *  It used to be doing more than that without saying so, which is why the wording
 *  is narrow now: the columns were computed at the wall distance alone, so they
 *  were a few percent too wide under tilt and further out again in an off-centre
 *  room, and this 4% was quietly absorbing both. Both are computed now, and a trim
 *  that is only a trim can stay small. */
export const EDGE_TRIM = 0.04;

/** How much of the frame the band must cover, in each direction, to be a reading
 *  of a wall rather than of whatever happens to sit at one height in it. Fraction
 *  of the frame's own height and width.
 *
 *  This is the check that was missing: `MIN_WALL_M` asks whether the ROOM has
 *  clear wall, which is not the same question as whether that wall is visible.
 *  A camera 5 m from the wall at 40° of tilt gave a band 1.7% of the frame tall —
 *  accepted, resampled up into the 24×24 grid, so `MIN_SAMPLES` never noticed and
 *  the answer was a confident colour read off a sliver. */
export const MIN_BAND_FRAC = 0.05;

/** Whether the lens is known or assumed, which changes how the band is drawn.
 *  `measured` means EXIF gave a focal length for this photo. */
export type LensSource = 'measured' | 'assumed';

/** The lens the band assumes when the photo does not say. Degrees of horizontal
 *  field of view.
 *
 *  **Not the typical lens — the widest one, and the asymmetry is the whole
 *  argument.** A row's distance from the frame centre scales as `1/k`, so
 *  assuming a NARROWER lens than the real one pushes both junctions further out
 *  than they really are and the band spills onto floor and ceiling; assuming a
 *  wider one pulls them in and the band is a smaller piece of real wall. One
 *  failure is a wrong colour reported as a right one, the other is less wall
 *  sampled. So the unknown case takes the wide end.
 *
 *  What this replaces: the 66° phone-main default. Measured on a 5.6 × 4.2 × 2.5 m
 *  room, level camera at 1.5 m, photographed on a 106° ultrawide and read as 66° —
 *  the band ran v 0.119…1.000 where the true junctions are 0.261 and 0.859, so
 *  **32.1% of what was sampled was floor and ceiling**. `CLAUDE.md` records that
 *  not one of the four real phone photos this repo was tested against carried a
 *  focal length, and `lib/photo-geometry.ts` records that a wall in a small room is
 *  often shot on the ultrawide, so that was the NORMAL path, not an edge case.
 *
 *  120° rather than the 106° of a typical phone ultrawide, for margin. The
 *  guarantee is one-sided and ends here: a lens wider than this re-opens the
 *  defect in proportion. */
export const WIDEST_HFOV_DEG = 120;

/** The camera to draw the band with: the photo's own when EXIF measured it, the
 *  widest plausible lens when it did not. Never narrower than the caller's, so a
 *  measured ultrawide is left alone either way. */
export function bandCal(cal: CameraCal, lens: LensSource): CameraCal {
  if (lens === 'measured') return cal;
  const widest = 2 * Math.tan(((WIDEST_HFOV_DEG / 2) * Math.PI) / 180);
  return cal.k >= widest ? cal : { ...cal, k: widest };
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** A normalized [x, y, w, h] region of a photo, the shape `sampleRegionColor` takes. */
export type Region = [number, number, number, number];

/**
 * The part of this photo that is wall: inside the wall's own on-screen ends,
 * between the skirting and the coving.
 *
 * Every bound is derived from the room's own geometry and the camera, never from a
 * percentage of the frame — the vertical pair through `wallRowAtHeight`, the
 * horizontal pair through `wallColumnsAtHeight`, and both from `wallFrame`, which
 * reads the footprint's BOUNDS rather than ±width/2 so that a room whose walls
 * have been dragged is still measured from where its walls are.
 *
 * A bound past the edge of the picture is CLAMPED to that edge, and the clamp is
 * safe only because of the refusal under it: when both bounds leave by the same
 * edge the clamped band is empty, and `MIN_BAND_FRAC` refuses it. That pair is
 * the fix for the worst defect this file has had — the previous version was handed
 * nulls it could not tell apart, defaulted the top to 0 and the bottom to 1, and
 * so answered "the whole frame is wall" for a camera tilted far enough that the
 * wall had left the picture upward. It reported success and returned the colour of
 * the floor.
 *
 * Returns null when there is not enough clear wall to be worth reading, when the
 * camera's pose is not one a room can be photographed from, or when the band that
 * survives is too small on screen. That is the rule 2 posture — say so rather than
 * sample something else and call it the wall colour.
 *
 * `lens` is not optional and not inferable: it says whether the photo's own focal
 * length is behind `cal`, and an assumed lens is widened to `WIDEST_HFOV_DEG`
 * before anything is derived from it, because the error is one-sided. The
 * paragraph this replaces claimed "a wrong lens is forgiving here, and the
 * allowances absorb that". It was the justification for skipping the calibration
 * ladder and it was false by a third of the band; see `WIDEST_HFOV_DEG`.
 */
export function wallRegion(
  slot: CaptureSlot,
  footprint: Footprint,
  ceilingM: number,
  cal: CameraCal,
  lens: LensSource,
): Region | null {
  if (!(ceilingM > 0) || !Number.isFinite(ceilingM)) return null;
  const clearTop = ceilingM - COVING_M;
  if (clearTop - SKIRTING_M < MIN_WALL_M) return null;

  const wall = wallFrame(slot, footprint);
  if (!wall) return null;

  const view = bandCal(cal, lens);
  // A lens under the ceiling is the rig's premise; above it the room is being
  // photographed from inside the slab. `placeCeilingObject` refuses the mirror
  // case, and the two limits do not overlap on their own — `pose.heightM` reaches
  // 2.2 m and `ROOM_HEIGHT_M.min` is 1.8 — so it has to be said here.
  const camH = view.height ?? CAM_HEIGHT;
  if (!(camH > 0 && camH < ceilingM)) return null;

  const topV = wallRowAtHeight(clearTop, wall.distance, view);
  const bottomV = wallRowAtHeight(SKIRTING_M, wall.distance, view);
  if (topV === null || bottomV === null) return null;
  const top = clamp01(topV);
  const bottom = clamp01(bottomV);
  if (!(bottom - top >= MIN_BAND_FRAC)) return null;

  // The columns valid over the WHOLE band, which is the intersection of the two
  // rows' answers: `forwardAtHeight` is monotonic in height, so the band's ends
  // bound its interior and there is nothing between them to check.
  const atTop = wallColumnsAtHeight(clearTop, wall, view);
  const atBottom = wallColumnsAtHeight(SKIRTING_M, wall, view);
  if (!atTop || !atBottom) return null;
  const left = clamp01(Math.max(atTop.left, atBottom.left));
  const right = clamp01(Math.min(atTop.right, atBottom.right));
  const w = right - left;
  const trim = w * EDGE_TRIM;
  const width = w - 2 * trim;
  if (!(width >= MIN_BAND_FRAC)) return null;

  return [left + trim, top, width, bottom - top];
}

/**
 * Which grid cells of a sampled region fall on known furniture.
 *
 * `boxes` are normalized `[x, y, w, h]` in the whole photo's frame — the same
 * convention detections use — and `grid` is the side of the square the region is
 * resampled into (`SAMPLE_GRID`). Returns null when nothing is masked, so a caller
 * can skip passing one at all.
 *
 * A cell is tested at its CENTRE. Testing its corners would mask any cell a box
 * merely grazes, and at 24×24 over a wall band that is a large share of them; a
 * sofa's own box is generous already.
 */
export function maskForBoxes(region: Region, boxes: readonly Region[], grid: number): Uint8Array | null {
  if (boxes.length === 0 || grid <= 0) return null;
  const [rx, ry, rw, rh] = region;
  const mask = new Uint8Array(grid * grid);
  let any = false;
  for (let row = 0; row < grid; row += 1) {
    const y = ry + ((row + 0.5) / grid) * rh;
    for (let col = 0; col < grid; col += 1) {
      const x = rx + ((col + 0.5) / grid) * rw;
      for (const [bx, by, bw, bh] of boxes) {
        if (x >= bx && x <= bx + bw && y >= by && y <= by + bh) {
          mask[row * grid + col] = 1;
          any = true;
          break;
        }
      }
    }
  }
  return any ? mask : null;
}

/** How much of the region may be masked before the sample stops being a sample of
 *  the wall. Past this the honest answer is that the furniture is in the way. */
export const MAX_MASKED = 0.7;

/** Whether enough of the region survives the mask to mean anything. */
export function maskLeavesEnough(mask: Uint8Array | null, grid: number): boolean {
  if (!mask) return true;
  let blocked = 0;
  for (let i = 0; i < mask.length; i += 1) if (mask[i]) blocked += 1;
  return blocked / (grid * grid) <= MAX_MASKED;
}

/** The direction each capture slot's wall faces, OUTWARD, in the world axes
 *  `lib/photo-geometry.ts` uses (+X east, +Z south). This is `slotToWorld`'s view
 *  direction: slot `n` is photographed looking −Z, so its wall's outward normal is
 *  −Z as well. */
const SLOT_OUTWARD: Record<CaptureSlot, readonly [number, number]> = {
  n: [0, -1],
  e: [1, 0],
  s: [0, 1],
  w: [-1, 0],
};

/** How closely an edge's outward normal must match a slot's direction to be that
 *  slot's wall. `cos 20°` — a room whose walls have been dragged a little out of
 *  square still maps, and anything more crooked is refused rather than guessed.
 *
 *  The 20° is also doing structural work, not just tolerance: two slot directions
 *  are 90° apart, so an edge within 20° of one is at least 70° from the other
 *  three. **One edge can therefore never match two slots**, which is why the loop
 *  below takes the first match rather than searching for a best one and then
 *  worrying about ties. Anything under 45° here keeps that property; loosening it
 *  past 45° would not, and would need the tie handling back. */
const MATCH_DOT = Math.cos((20 * Math.PI) / 180);

/**
 * Which wall index each capture slot paints, or null when this room cannot say.
 *
 * `wallColors` is keyed by the index of the wall in `wallSegments(footprint)`,
 * which is what `RoomShell` paints. **Derived from the polygon's own winding
 * rather than from `layoutId`**, for the reason rule 3 of `CLAUDE.md` gives about
 * `wallOutwardNormal`: the shape is the authority, and a `rect` whose walls have
 * been dragged is `layoutId: 'custom'` while still being four walls facing four
 * ways.
 *
 * It asks for a BIJECTION — every wall claims one slot, every slot gets one wall —
 * and there is deliberately **no edge-count guard**. A `length !== 4` check was
 * here and is gone: it is implied for every polygon with more than four edges
 * (there are only four slots, so some edge must match nothing or duplicate a
 * claim), and for a triangle the completeness check below is what actually
 * catches it. Removing the count check broke no assertion, which is how it was
 * found — a guard nothing can fail is the same defect as a check nothing can fail,
 * and the fix is to assert the real invariant rather than a proxy for it.
 *
 * Three refusals, all reachable:
 *
 * · **An edge matching no slot.** Covers the `l`/`t`/`u` presets (6/8/8 edges, so
 *   the length guard takes them first), a room turned too far off the axes, and a
 *   ZERO-LENGTH edge, whose normal `wallOutwardNormal` reports as `[0, 0]` — dot
 *   zero against everything, so it matches nothing and the room is refused.
 *   That last one matters beyond tidiness: `wallSegments` SKIPS a degenerate edge,
 *   so the painted index would shift off the polygon index and every wall after it
 *   would take its neighbour's colour. It is also what keeps `setAllWallColors`,
 *   which counts polygon vertices, agreeing with the renderer, which counts
 *   segments.
 *   **There was an explicit degeneracy check here and it is deleted, not moved:**
 *   with four vertices a zero-length edge leaves three real walls, so some slot
 *   was always going to find nothing. Four separate mutations of this function
 *   survived the first version of its test suite because the checks were implied
 *   by each other — the guard that cannot fail is the same defect as the check
 *   that cannot fail.
 * · **Two edges claiming one slot.** Measured rather than assumed reachable: of
 *   500,000 random quadrilaterals, 23,045 hit it and **13,559 of those were simple
 *   (non-self-intersecting)** — so an ordinary dragged room can get here, and
 *   `tests/wall-sample.test.ts` carries one of them.
 * The closing `every` is **not** a third runtime refusal, and saying so is the
 * point: it cannot fire. For a slot to be left unclaimed while no edge matched
 * nothing and none duplicated, the polygon would need fewer than four edges all
 * axis-aligned in distinct directions, and no closed polygon has three. It earns
 * its place as the check that makes the cast from `Partial` SOUND — the type
 * narrowing is the job — and it is written as an assertion rather than a cast so
 * that a future change to the matching logic cannot quietly hand a caller a record
 * with missing keys. Mutating it away breaks nothing today; that is expected, and
 * is the reason for this paragraph rather than for a test pretending otherwise.
 */
export function slotWallIndices(footprint: Footprint): Record<CaptureSlot, number> | null {
  const out: Partial<Record<CaptureSlot, number>> = {};
  for (let i = 0; i < footprint.length; i += 1) {
    const [nx, nz] = wallOutwardNormal(footprint, i);
    const slot = SLOT_ORDER.find((s) => nx * SLOT_OUTWARD[s][0] + nz * SLOT_OUTWARD[s][1] > MATCH_DOT);
    if (!slot) return null;
    if (out[slot] !== undefined) return null;
    out[slot] = i;
  }
  return SLOT_ORDER.every((s) => out[s] !== undefined) ? (out as Record<CaptureSlot, number>) : null;
}

/** Why a photo produced no colour. Each one is said out loud rather than dropped:
 *  a sample that quietly covered three walls of four looks like a bug. */
export type SkipReason =
  /** The room leaves too little clear wall between skirting and coving. */
  | 'no-wall'
  /** Furniture covers most of the wall in this photo. */
  | 'blocked'
  /** The pixels could not be read — an undecodable blob, a decode failure. */
  | 'unreadable';

export type Skipped = { slot: CaptureSlot; reason: SkipReason };

export type WallColorProposal = {
  /** Wall index → colour, when the room's shape can say which wall each photo is. */
  perWall: Record<number, string>;
  /** One colour for every wall, when it cannot. Never set at the same time as
   *  `perWall` carrying anything. */
  allWalls: string | null;
  skipped: Skipped[];
  /** Whether known furniture was excluded. False means the room had no detection
   *  boxes to hand — a scene opened from a file carries none — so the answer leans
   *  on the wall band and the median alone. Said out loud for the same reason as
   *  `skipped`. */
  usedBoxes: boolean;
};

/**
 * Turn per-photo colours into what to paint. **Pure, and here rather than in the
 * browser shell on purpose:** this is the decision that can be wrong in the way
 * that matters — painting the wrong wall — while decoding a JPEG can only fail
 * loudly. The shell above it does I/O and nothing else.
 *
 * When the footprint cannot be mapped to four slots the offer collapses to one
 * colour for every wall. That is a different answer rather than a worse one: an
 * L-shaped room has no four-wall mapping, and four guesses would be the wrong wall
 * three times.
 */
export function wallColorProposal(
  found: ReadonlyArray<{ slot: CaptureSlot; hex: string }>,
  skipped: Skipped[],
  footprint: Footprint,
  usedBoxes: boolean,
): WallColorProposal {
  const base = { skipped, usedBoxes };
  if (found.length === 0) return { perWall: {}, allWalls: null, ...base };

  const indices = slotWallIndices(footprint);
  if (!indices) return { perWall: {}, allWalls: medianHex(found.map((f) => f.hex)), ...base };

  const perWall: Record<number, string> = {};
  for (const { slot, hex } of found) {
    const index = indices[slot];
    // Cannot fire today, and that is stated rather than tested: `slotWallIndices`
    // produces these as its own loop index over this same polygon, so they are in
    // range by construction. Kept because this is the BOUNDARY — nothing on the
    // write path validates a wall index, and an unrenderable `wallColors[7]` is
    // exactly what a stale index produced once before (the long note in
    // `lib/history.ts`). So it guards a future change to the matcher, not a
    // present bug.
    //
    // Second one of these in this file, after the `every` in `slotWallIndices`.
    // The rule both follow: an assertion that cannot fire is fine when it is the
    // thing making a cast or a write sound, and is decoration when it is standing
    // in for a runtime case — and the way to tell is to mutate it and see whether
    // any honest test could have caught it. Neither of these could; both say so.
    if (index >= 0 && index < footprint.length) perWall[index] = hex;
  }
  return { perWall, allWalls: null, ...base };
}

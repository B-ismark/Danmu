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
// and `wallColumns` are that, in closed form — so there is nothing here to
// detect.

import type { CaptureSlot } from './storage';
import { SLOT_ORDER } from './capture-slots';
import { wallOutwardNormal, type Footprint } from './footprint';
import { wallColumns, wallRowAtHeight, type CameraCal } from './photo-geometry';

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
 *  Metres. A 1.8 m ceiling — the floor of `ROOM_SIDE_M`'s range — still clears it. */
export const MIN_WALL_M = 0.5;

/** Fraction of the wall's on-screen WIDTH trimmed from each end. Unlike the
 *  vertical allowances this one is not a physical length: `wallColumns` already
 *  puts the return walls outside the region, and this only guards the last few
 *  pixels of resampling bleed at that boundary. */
export const EDGE_TRIM = 0.04;

/** A normalized [x, y, w, h] region of a photo, the shape `sampleRegionColor` takes. */
export type Region = [number, number, number, number];

/**
 * The part of this photo that is wall: inside the wall's own on-screen ends,
 * between the skirting and the coving.
 *
 * Every bound is derived from the room's dimensions and the camera, never from a
 * percentage of the frame — the vertical pair through `wallRowAtHeight`, the
 * horizontal pair through `wallColumns`. A row or column the frame does not reach
 * is clamped to the frame edge, which is not a fallback but the truth: the wall
 * continues past the edge of the picture.
 *
 * Returns null when there is not enough clear wall to be worth reading. That is
 * the rule 2 posture — say so rather than sample something else and call it the
 * wall colour.
 *
 * A wrong lens is forgiving here, and it is worth saying why, because rule 2 is
 * otherwise strict about calibration error: `k` only makes the region slightly
 * too tall or too wide, the allowances absorb that, and a colour is not a
 * dimension — nothing downstream measures anything from it.
 */
export function wallRegion(
  slot: CaptureSlot,
  room: { width: number; depth: number; height: number },
  cal: CameraCal,
): Region | null {
  if (!(room.height > 0)) return null;
  const clearTop = room.height - COVING_M;
  if (clearTop - SKIRTING_M < MIN_WALL_M) return null;

  // Null = beyond the frame, so the wall reaches that edge.
  const top = wallRowAtHeight(clearTop, slot, room, cal) ?? 0;
  const bottom = wallRowAtHeight(SKIRTING_M, slot, room, cal) ?? 1;
  if (!(bottom > top)) return null;

  const { left, right } = wallColumns(slot, room, cal);
  const w = right - left;
  if (!(w > 0)) return null;
  const trim = w * EDGE_TRIM;
  const x = left + trim;
  const width = w - 2 * trim;
  if (!(width > 0)) return null;

  return [x, top, width, bottom - top];
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

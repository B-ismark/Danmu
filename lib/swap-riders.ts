// What happens to the things standing on a piece when that piece is swapped.
//
// A monitor and a laptop on a coffee table; the table is swapped for a bigger desk, or
// for a small side table. Before this, the swap re-grounded the TABLE and left its
// company alone: the height pass (`lib/rider-height.ts`) lifted a rider to the new top
// only while it was still over it, so on a smaller top the monitor stayed at the old
// height in mid-air, and wherever the swap moved or turned the table (containment, a
// quarter turn, the nearest clear floor) everything on it was left behind.
//
// The rule now, per rider, in the order a person would clear a table — biggest first:
//
//   1. It travels WITH the table: the same spot in the table's own frame, turned with it.
//   2. If it is not wholly on the new top there, or it lands on another rider, it slides
//      to the nearest spot that is — the arrangement is kept where it can be and
//      re-flowed where it cannot.
//   3. If no spot on the top holds it, it goes on the floor, at the nearest clear spot
//      beside where it was (`placeArrival`, the search a swapped-in piece makes), and
//      the caller SAYS so: rule 2 is "say so, never silently resize it to fit", and a
//      monitor quietly put on the floor is the silent version of that.
//
// What rides a rider (a cup on a tray) goes wherever the rider goes, rigidly.
//
// Pure: the store writes are `swapPartModel`'s.

import { footArea, footFromPart, footIntersectionArea, footOverlap, localToWorld, TOUCH_M, worldToLocal, type Foot } from './geometry';
import { isFloorStanding, MOUNT_PAD, verticalExtent } from './physics';
import { placeArrival } from './duplicate-place';
import type { Footprint } from './footprint';
import type { ScenePart } from './scene-spec';

/** Finest grid step for the search over a top, metres: a rider slid in ends within a
 *  couple of centimetres of the edge it was pushed from. */
const STEP_M = 0.02;
/** Most grid points one search may try. A 3 × 2 m top at 20 mm is 15 000 of them, each a
 *  polygon clip, per rider — measured at 200 ms a rider that fits nowhere, seconds for a
 *  crowded banquet table. Past this the step coarsens instead. */
const MAX_CANDIDATES = 2500;

export type RiderMove = { id: string; pos: [number, number, number]; rot?: number };

export type RiderPlan = {
  moves: RiderMove[];
  /** Direct riders that are still on the new top, to be linked to it. */
  seated: string[];
  /** Direct riders that did not fit and went to the floor. */
  grounded: string[];
  /** Of those, the ones that found no clear floor nearby either: they stand where they
   *  were put, touching something, and the caller says so rather than "moved". */
  crowded: string[];
};

/** Can anything stand on this piece? The same skips the support probe makes
 *  (`topSurface` in `lib/physics.ts`): a wall or ceiling piece, a rug and a bed hold
 *  nothing up. */
export function holdsThings(p: Pick<ScenePart, 'category' | 'shape' | 'wallMounted'>): boolean {
  return !p.wallMounted && isFloorStanding(p.category, p.shape) && p.category !== 'rug' && p.category !== 'bed';
}

const footOf = (p: Pick<ScenePart, 'pos' | 'rot' | 'dimMM' | 'circle' | 'shape'>, x = p.pos[0], z = p.pos[2], rot = p.rot): Foot =>
  footFromPart([x, 0, z], rot, p.dimMM, p.circle, p.shape);

/** Wholly on the top — not the support probe's half share, which is the bar for "is it
 *  held up" and would leave a monitor hanging half off a side table. */
function whollyOn(f: Foot, top: Foot): boolean {
  // Measured as the foot's overlap with a square that holds it whole, not `footArea`: a
  // round foot's area is the exact circle while a clip against a rectangle works on the
  // polygon drawn for it, 0.6% smaller, so a lamp dead centre on a wide top read as
  // hanging off and no round piece ever stayed on a swapped table. (Its overlap with
  // ITSELF is no use either: circle against circle is answered exactly.)
  const r = Math.hypot(f.hw, f.hd) + 1;
  const a = footIntersectionArea(f, { cx: f.cx, cz: f.cz, hw: r, hd: r, rot: 0 });
  return a > 0 && footIntersectionArea(f, top) >= a * (1 - 1e-6);
}

/**
 * Where everything standing on `before` goes once it is replaced by `after`.
 *
 * @param before   the piece as it stood, at its effective transform.
 * @param after    the new piece where the swap put it — new kind, size, spot and turn.
 * @param riders   every piece riding `before`, however many levels up, at its
 *                 effective transform (`ridersOf`).
 * @param relation child id -> support id, covering every rider.
 * @param world    everything else in the room — not `before`/`after`, not the riders.
 */
export function reseatRiders(
  before: ScenePart,
  after: ScenePart,
  riders: ScenePart[],
  relation: Readonly<Record<string, string>>,
  world: ScenePart[],
  footprint: Footprint | undefined,
  roomHeight: number,
): RiderPlan {
  const plan: RiderPlan = { moves: [], seated: [], grounded: [], crowded: [] };
  const byId = new Map(riders.map((r) => [r.id, r]));
  const direct = riders
    .filter((r) => relation[r.id] === before.id && isFloorStanding(r.category, r.shape))
    .sort((a, b) => footArea(footOf(b)) - footArea(footOf(a)));
  if (direct.length === 0) return plan;

  const turn = after.rot - before.rot;
  const canHold = holdsThings(after);
  const top = verticalExtent(after.category, after.shape, after.dimMM, after.pos[1])[1];
  const topFoot = footOf(after);
  const seatedFeet: Foot[] = [];
  const groundedParts: ScenePart[] = [];
  const landed = new Map<string, { pos: [number, number, number]; rot: number }>();

  // The polygon tests are the cost of the search, so two feet whose bounding circles are
  // apart are passed without one — most of a crowded top, for any one candidate.
  const reach = (f: Foot) => Math.hypot(f.hw, f.hd);
  const near = (f: Foot, s: Foot) => Math.hypot(f.cx - s.cx, f.cz - s.cz) < reach(f) + reach(s) + TOUCH_M;
  const free = (f: Foot) =>
    seatedFeet.every((s) => !near(f, s) || !footOverlap(f, s, -TOUCH_M)) && whollyOn(f, topFoot);
  const topArea = footArea(topFoot);
  let usedArea = 0;
  // A rider whose top would be through the ceiling does not go up there: the height pass
  // would clamp it down INTO the piece (a lamp on a nightstand swapped for a wardrobe
  // ended 320 mm inside it). The same cap `deriveRiderYs` clamps to.
  const cap = roomHeight - MOUNT_PAD;

  for (const r of direct) {
    // 1. Carried: the same spot in the table's own frame.
    const [lx, lz] = worldToLocal(before.rot, r.pos[0] - before.pos[0], r.pos[2] - before.pos[2]);
    const [wx, wz] = localToWorld(after.rot, lx, lz);
    const cx = after.pos[0] + wx;
    const cz = after.pos[2] + wz;
    const rot = r.rot + turn;

    // 2. The nearest spot on the top that holds it whole and clear of the others.
    let spot: [number, number] | null = null;
    const rFoot = footOf(r);
    const rArea = footArea(rFoot);
    // Quick refusals before any search: no room under the ceiling, more area than the
    // top has left, or wider than the top along either of its sides at this turn.
    const relRot = rot - after.rot;
    const ex = (Math.abs(Math.cos(relRot)) * r.dimMM[0] + Math.abs(Math.sin(relRot)) * r.dimMM[1]) / 2000;
    const ez = (Math.abs(Math.sin(relRot)) * r.dimMM[0] + Math.abs(Math.cos(relRot)) * r.dimMM[1]) / 2000;
    const mayFit =
      canHold
      && top + r.dimMM[2] / 1000 <= cap
      && usedArea + rArea <= topArea * (1 + 1e-9)
      && ex <= after.dimMM[0] / 2000 + 1e-9
      && ez <= after.dimMM[1] / 2000 + 1e-9;
    if (mayFit) {
      if (free(footOf(r, cx, cz, rot))) spot = [cx, cz];
      else {
        const hw = after.dimMM[0] / 2000;
        const hd = after.dimMM[1] / 2000;
        const step = Math.max(STEP_M, Math.sqrt((4 * hw * hd) / MAX_CANDIDATES));
        const [plx, plz] = worldToLocal(after.rot, cx - after.pos[0], cz - after.pos[2]);
        const candidates: Array<[number, number, number]> = [];
        // Centred on the top rather than started at an edge, so a rider exactly as wide
        // as the top still finds the one spot that holds it.
        const nx = Math.floor(hw / step);
        const nz = Math.floor(hd / step);
        for (let i = -nx; i <= nx; i++) {
          for (let j = -nz; j <= nz; j++) {
            const gx = i * step;
            const gz = j * step;
            candidates.push([gx, gz, (gx - plx) ** 2 + (gz - plz) ** 2]);
          }
        }
        candidates.sort((a, b) => a[2] - b[2]);
        for (const [gx, gz] of candidates) {
          const [ox, oz] = localToWorld(after.rot, gx, gz);
          const x = after.pos[0] + ox;
          const z = after.pos[2] + oz;
          if (free(footOf(r, x, z, rot))) {
            spot = [x, z];
            break;
          }
        }
      }
    }

    if (spot) {
      seatedFeet.push(footOf(r, spot[0], spot[1], rot));
      usedArea += rArea;
      landed.set(r.id, { pos: [spot[0], top, spot[1]], rot });
      plan.seated.push(r.id);
      continue;
    }

    // 3. The floor, at the nearest clear spot to where it would have been.
    let pos: [number, number, number] = [cx, 0, cz];
    let floorRot = rot;
    if (footprint) {
      const arriving: ScenePart = { ...r, pos, rot, groupId: undefined };
      const arrival = placeArrival(arriving, [...world, after, ...groundedParts], footprint, roomHeight);
      pos = [arrival.spot.pos[0], 0, arrival.spot.pos[2]];
      floorRot = arrival.spot.rot;
      if (!arrival.clear) plan.crowded.push(r.id);
    } else {
      // No room outline to search: beside the table along its own width, not under it.
      const [ox, oz] = localToWorld(after.rot, after.dimMM[0] / 2000 + Math.max(r.dimMM[0], r.dimMM[1]) / 2000 + TOUCH_M, 0);
      pos = [after.pos[0] + ox, 0, after.pos[2] + oz];
    }
    groundedParts.push({ ...r, pos, rot: floorRot });
    landed.set(r.id, { pos, rot: floorRot });
    plan.grounded.push(r.id);
  }

  // What rides a rider goes with it, rigidly, about the rider it is (eventually) on.
  const rootOf = (id: string): string | null => {
    let cur = id;
    for (let i = 0; i < riders.length + 1; i++) {
      const parent = relation[cur];
      if (parent === undefined) return null;
      if (parent === before.id) return cur;
      cur = parent;
    }
    return null;
  };

  // A write is never free (`lib/transforms.ts` pins an override against a re-detect), so
  // a piece that ends exactly where it stood gets none.
  const same = (a: readonly number[], b: readonly number[]) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
  for (const r of direct) {
    const to = landed.get(r.id)!;
    const rotChanged = to.rot !== r.rot;
    if (!rotChanged && same(to.pos, r.pos)) continue;
    plan.moves.push(rotChanged ? { id: r.id, pos: to.pos, rot: to.rot } : { id: r.id, pos: to.pos });
  }
  for (const d of riders) {
    if (relation[d.id] === before.id) continue;
    const rootId = rootOf(d.id);
    const root = rootId ? byId.get(rootId) : undefined;
    const to = rootId ? landed.get(rootId) : undefined;
    if (!root || !to) continue;
    const [lx, lz] = worldToLocal(root.rot, d.pos[0] - root.pos[0], d.pos[2] - root.pos[2]);
    const [wx, wz] = localToWorld(to.rot, lx, lz);
    const rot = d.rot + (to.rot - root.rot);
    const pos: [number, number, number] = [to.pos[0] + wx, d.pos[1] - root.pos[1] + to.pos[1], to.pos[2] + wz];
    if (rot === d.rot && same(pos, d.pos)) continue;
    plan.moves.push(rot !== d.rot ? { id: d.id, pos, rot } : { id: d.id, pos });
  }
  return plan;
}

// A sofa a few degrees off square, and what Fix hands back.
//
// The user's third Suggest observation: turn the sofa a little, press Fix, and it can
// come back facing away from its television. In the T it did on 5 seeds in 12. The
// sofa 10° off pokes through its wall, so Fix has to move it, and nearly every answer
// the search finds puts it somewhere else: the one it cannot reach by itself is the
// room as it stands with the sofa turned straight, because the tidy after the pick
// squares only what the search moved. So that arrangement is offered to the finalists
// as a candidate of its own (§ H.6.6 in `docs/what-is-still-open.md`).
//
// Measured over twelve seeds of the `t` preset at 6 × 5 m, on the commit before:
//
//     sofa turned     facing away from the TV   more than 30° off it
//        −10°                  3                        5
//        +10°                  0                        4
//
// and 0 / 0 after, both rows. The fix reaches every preset at its own size; the L at
// 6 × 4.7 with the sofa turned −6° is pinned too, since it came back facing away before.
// A 20° sofa is not reached and is not meant to be: beyond `SNAP_TOL` an angle is a
// choice, and a candidate that squared anything up to 45° was built and measured — it
// squared an armchair turned 25° with nothing else wrong in the room on 12 of 12 seeds,
// where Fix leaves it alone on 9.

import { describe, expect, it } from 'vitest';
import { defaultScene, type ScenePart } from '@/lib/scene-spec';
import { footprintForLayout, type Footprint } from '@/lib/footprint';
import { isWorthOffering, lockedForSolve, solveLayout } from '@/lib/layout-solve';
import { applyPlacements, lockedForShuffle, shuffleRoom } from '@/lib/layout-shuffle';
import { FACING_HALF_ANGLE } from '@/lib/layout-ideas';
import { frontVector } from '@/lib/geometry';
import type { LayoutId } from '@/lib/storage';

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const DEG = Math.PI / 180;
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const offSquare = (r: number) => {
  const q = Math.PI / 2;
  return Math.abs(wrap(r - Math.round(r / q) * q));
};

function room(id: LayoutId, w: number, d: number) {
  return { parts: defaultScene(id, w, d), footprint: footprintForLayout(id, w, d) as Footprint };
}

/** One piece turned by `deg`, as a hand rotation leaves it: an override, so `placed`. */
function turned(parts: ScenePart[], pick: (p: ScenePart) => boolean, deg: number) {
  const target = parts.find(pick)!;
  return { parts: parts.map((p) => (p.id === target.id ? { ...p, rot: wrap(p.rot + deg * DEG) } : p)), id: target.id };
}

/** What `useSuggest` in `RoomTools` does with a Fix press: solve, offer only a real gain,
 *  write the moved pieces. Null when Fix would say there is nothing to do. */
function fix(parts: ScenePart[], footprint: Footprint, seed: number, placed: Set<string>) {
  const result = solveLayout(parts, footprint, lockedForSolve(parts, {}, null), { seed, mode: 'arrange', placed });
  if (result.moved.length === 0 || !isWorthOffering(result.before, result.after)) return null;
  return applyPlacements(parts, result);
}

/** The angle between a piece's front and the direction to another piece, 0…π. */
function facing(p: ScenePart, target: ScenePart): number {
  const [fx, fz] = frontVector(p.rot);
  const dx = target.pos[0] - p.pos[0];
  const dz = target.pos[2] - p.pos[2];
  return Math.acos(Math.max(-1, Math.min(1, (fx * dx + fz * dz) / (Math.hypot(dx, dz) || 1))));
}

const isSofa = (p: ScenePart) => p.category === 'sofa';
const isTv = (p: ScenePart) => p.category === 'tv' || p.shape === 'tv';

describe('Fix on a sofa a few degrees off square', () => {
  // The T at 6 × 5 is the room the observation was measured in; the L at its own preset
  // size is the row where the sofa came back facing away at only 6°.
  const cases: [LayoutId, number, number, number][] = [['t', 6, 5, -10], ['t', 6, 5, 10], ['l', 6, 4.7, -6]];
  for (const [layout, w, d, deg] of cases) {
    it(`${layout} ${w} × ${d}, sofa turned ${deg}°: every seed faces the television`, () => {
      const { parts: base, footprint } = room(layout, w, d);
      const { parts, id } = turned(base, isSofa, deg);
      const tv = parts.find(isTv)!;
      const start = parts.find((p) => p.id === id)!;
      let applied = 0;
      let notFacing = 0;
      let inPlace = 0;
      for (const seed of SEEDS) {
        const out = fix(parts, footprint, seed, new Set([id]));
        if (!out) continue;
        applied++;
        const sofa = out.find((p) => p.id === id)!;
        if (facing(sofa, tv) > FACING_HALF_ANGLE) notFacing++;
        if (Math.hypot(sofa.pos[0] - start.pos[0], sofa.pos[2] - start.pos[2]) < 1e-9 && offSquare(sofa.rot) < 1e-6) inPlace++;
      }
      // Fix acts on every seed, and on every seed the answer is the sofa squared where it
      // stood. Before, in the T: 11 / 12 acted at −10°, and 0 and 1 of them squared it in
      // place. In the L: 11 acted, none in place, 3 left crooked and 1 facing away.
      expect({ applied, notFacing, inPlace }).toEqual({ applied: 12, notFacing: 0, inPlace: 12 });
    });
  }

  it('an armchair turned 25° with nothing else wrong is left alone as often as before', () => {
    const { parts: base, footprint } = room('l', 6, 5);
    const { parts, id } = turned(base, (p) => p.shape === 'chair-armchair', 25);
    let untouchedSeeds = 0;
    let squared = 0;
    for (const seed of SEEDS) {
      const out = fix(parts, footprint, seed, new Set([id]));
      if (!out) {
        untouchedSeeds++;
        continue;
      }
      if (offSquare(out.find((p) => p.id === id)!.rot) < DEG) squared++;
    }
    // Identical on the commit before. The candidate squares only within `SNAP_TOL`, so a
    // 25° chair is outside it; the three seeds that do act are the search's own answers.
    expect({ untouchedSeeds, squared }).toEqual({ untouchedSeeds: 9, squared: 3 });
  });

  for (const id of ['t', 'l'] as LayoutId[]) {
    it(`${id} 6 × 5 as authored: the candidate changes nothing`, () => {
      const { parts, footprint } = room(id, 6, 5);
      let none = 0;
      for (const seed of SEEDS) if (!fix(parts, footprint, seed, new Set())) none++;
      // Nothing is off square, so the candidate is the room itself and is not offered.
      // Identical on the commit before, both rooms: the T's two seeds that act are the
      // search's own.
      expect(none).toBe(id === 't' ? 10 : 12);
    });
  }

  it('Ideas never hands back the room it was given with the sofa squared in place', () => {
    const { parts: base, footprint } = room('t', 6, 5);
    const { parts, id } = turned(base, isSofa, -10);
    const start = parts.find((p) => p.id === id)!;
    let n = 0;
    let inPlace = 0;
    for (const attempt of [1, 2, 3]) {
      const out = shuffleRoom(parts, { footprint, height: 2.4 }, lockedForShuffle(parts, {}), { attempt });
      for (const idea of out?.ideas ?? []) {
        n++;
        const sofa = applyPlacements(parts, idea).find((p) => p.id === id)!;
        if (Math.hypot(sofa.pos[0] - start.pos[0], sofa.pos[2] - start.pos[2]) < 1e-9 && offSquare(sofa.rot) < 1e-6) inPlace++;
      }
    }
    // A shuffle is not meant to hand back the room it was given. 9 ideas and none of them
    // this, the same as on the commit before. With the candidate offered to a shuffle as
    // well, this room gets 1 idea: measured, and the reason the shuffle is left out.
    expect({ n, inPlace }).toEqual({ n: 9, inPlace: 0 });
  });
});

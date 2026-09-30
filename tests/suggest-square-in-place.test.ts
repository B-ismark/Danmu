// A sofa a few degrees off square, and what Fix hands back.
//
// Turn the sofa a little, press Fix, and it could come back facing away from its
// television: in the T at 6 × 5 with the sofa at −10° it did on 3 seeds in 12, and came
// back more than 30° off it on 5. The sofa pokes through its wall, so Fix has to act,
// and every answer the search finds moves it, because the tidy after the pick squares
// only what the search moved. So the room as it stands, with its faults squared out, is
// rated beside the finalists (`squareFaults`, § H.6.6 in `docs/what-is-still-open.md`).
//
// The first tests are the observation. The table after them holds the rules that decide
// which pieces that candidate turns, each on a room where the rule changes the answer.
// A 20° sofa is not reached and is not meant to be: past `SNAP_TOL` an angle is a choice.

import { describe, expect, it } from 'vitest';
import { defaultScene, type ScenePart } from '@/lib/scene-spec';
import { footprintForLayout, type Footprint } from '@/lib/footprint';
import { bestCandidate, isWorthOffering, lockedForSolve, solveLayout, type Candidate } from '@/lib/layout-solve';
import { applyPlacements, lockedForShuffle, shuffleRoom } from '@/lib/layout-shuffle';
import { FACING_HALF_ANGLE } from '@/lib/layout-ideas';
import { frontVector, localToWorld } from '@/lib/geometry';
import { turnInPlace } from '@/lib/drag-resolve';
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

/** One piece turned by `deg` the way the rotate handle and the arrow keys turn it
 *  (`turnInPlace`), so `placed`. That turn clamps the piece into the room's bounding box
 *  and keeps the clamp even when the frame is illegal, so a sofa backing onto a wall the
 *  box does not have, as in the T and the L, is left through the plaster. */
function turned(parts: ScenePart[], pick: (p: ScenePart) => boolean, deg: number, footprint: Footprint) {
  const target = parts.find(pick)!;
  const r = turnInPlace({
    part: target,
    at: target.pos,
    rot: wrap(target.rot + deg * DEG),
    dim: target.dimMM,
    parts,
    footprint,
    roomHeight: 2.4,
  });
  return { parts: parts.map((p) => (p.id === target.id ? { ...p, pos: r.pos, rot: r.rot } : p)), id: target.id };
}

/** What `useSuggest` in `RoomTools` does with a Fix press: solve, offer only a real gain,
 *  write the moved pieces. Null when Fix would say there is nothing to do. */
function fix(parts: ScenePart[], footprint: Footprint, seed: number, placed: Set<string>) {
  const result = solveLayout(parts, footprint, lockedForSolve(parts, {}, null), { seed, mode: 'arrange', placed });
  if (result.moved.length === 0 || !isWorthOffering(result.before, result.after)) return null;
  return applyPlacements(parts, result);
}

/** A Fix solve with the ranking watched: what it was handed, and what the search kept. */
function watched(parts: ScenePart[], footprint: Footprint, seed: number, placed: Set<string>, mode: 'arrange' | 'refit' = 'arrange') {
  let rated: readonly Candidate[] = [];
  const result = solveLayout(parts, footprint, lockedForSolve(parts, {}, null), {
    seed,
    mode,
    placed,
    pick: (c) => ((rated = c), bestCandidate(c)),
  });
  return { result, rated };
}

/** The angle between a piece's front and the direction to another piece, 0…π. */
function facing(p: ScenePart, target: ScenePart): number {
  const [fx, fz] = frontVector(p.rot);
  const dx = target.pos[0] - p.pos[0];
  const dz = target.pos[2] - p.pos[2];
  return Math.acos(Math.max(-1, Math.min(1, (fx * dx + fz * dz) / (Math.hypot(dx, dz) || 1))));
}

/** The pieces the candidate turned, or null when there is none. It is built from the room
 *  as it stands, not from the search, so a short search is enough to see it. A piece that
 *  is not square where it stood is marked, since the candidate only ever squares in place. */
function squaredIn(parts: ScenePart[], footprint: Footprint, placed: Set<string>): string[] | null {
  let rated: readonly Candidate[] = [];
  const result = solveLayout(parts, footprint, lockedForSolve(parts, {}, null), {
    seed: 1,
    steps: 40,
    mode: 'arrange',
    placed,
    pick: (c) => ((rated = c), bestCandidate(c)),
  });
  if (rated.length === result.finalists.length) return null;
  const cand = rated[rated.length - 1].placements;
  return parts.flatMap((p, i) => {
    const q = cand[i];
    const stays = Math.hypot(q.x - p.pos[0], q.z - p.pos[2]) < 1e-9;
    if (stays && Math.abs(wrap(q.yaw - p.rot)) < 1e-9) return [];
    return [stays && offSquare(q.yaw) < 1e-6 ? p.id : `${p.id} (moved or crooked)`];
  });
}

const isSofa = (p: ScenePart) => p.category === 'sofa';
const isTv = (p: ScenePart) => p.shape === 'tv';

describe('Fix on a sofa a few degrees off square', () => {
  // The T at 6 × 5 is the room the observation was measured in; the L at its own preset
  // size is the row where the sofa came back facing away at only 6°.
  const cases: [LayoutId, number, number, number][] = [['t', 6, 5, -10], ['t', 6, 5, 10], ['l', 6, 4.7, -6]];
  for (const [layout, w, d, deg] of cases) {
    it(`${layout} ${w} × ${d}, sofa turned ${deg}°: every seed faces the television`, () => {
      const { parts: base, footprint } = room(layout, w, d);
      const { parts, id } = turned(base, isSofa, deg, footprint);
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

  it('a piece angled on purpose keeps its angle: only the sofa through its wall is turned', () => {
    // Dining chair 3 turned 8°, inside `SNAP_TOL`, standing clear of everything, and not
    // placed, so squaring it costs almost nothing and tidies the room: the one chair the
    // candidate would take if a turn did not have to clear a fault.
    const { parts: base, footprint } = room('t', 6, 5);
    const sofa = turned(base, isSofa, -10, footprint);
    const { parts, id: chairId } = turned(sofa.parts, (p) => p.id === 'chair-3', 8, footprint);
    const { result, rated } = watched(parts, footprint, 1, new Set([sofa.id]));
    // One candidate beside the search's own finalists, not among them: `finalists` is still
    // exactly what the search kept. Put through the pool, it evicted a better finalist.
    expect(rated.length).toBe(result.finalists.length + 1);
    expect(rated.slice(0, -1).map((c) => c.placements)).toEqual(result.finalists.map((f) => f.placements));
    const i = (pid: string) => parts.findIndex((p) => p.id === pid);
    const cand = rated[rated.length - 1].placements;
    const chair = parts[i(chairId)];
    expect({ x: cand[i(chairId)].x, z: cand[i(chairId)].z, yaw: cand[i(chairId)].yaw }).toEqual({ x: chair.pos[0], z: chair.pos[2], yaw: chair.rot });
    const s = parts[i(sofa.id)];
    expect(Math.hypot(cand[i(sofa.id)].x - s.pos[0], cand[i(sofa.id)].z - s.pos[2])).toBeLessThan(1e-9);
    expect(offSquare(cand[i(sofa.id)].yaw)).toBeLessThan(1e-6);
    // Priced the way a finalist is: its stranded floor counted into the total it is ranked by.
    const { navCost, cost, total } = rated[rated.length - 1];
    expect(navCost).toBeGreaterThan(0);
    expect(total).toBeCloseTo(cost + navCost, 9);
  });

  // Each row turns pieces of a preset by hand (so they are `placed`) and names what the
  // candidate squares. Every row is one where its rule changes that answer.
  const rules: [string, LayoutId, number, number, [string, number][], string[] | null][] = [
    // Squaring the dining table clears its `access` and buys less than `KEEP_EPS`, the slack
    // `pruneMoves` spends putting moves back, so picked, it would be turned crooked again.
    ['a turn that buys less than the tidy keeps is not offered', 't', 6, 5, [['table-2', -8]], null],
    // Squaring the sofa clears the wall and raises the crooked table's `access`: a swap,
    // which is the search's to price. Squaring the table alone buys too little.
    ['a turn that raises another fault is not offered', 't', 6, 5, [['sofa-1', -10], ['table-2', -8]], null],
    // The same two turns at 5.5 × 4.7: the sofa first raises the table's `access`, the
    // table squared clears it, and on the second pass the sofa's turn is clean.
    ['squaring one piece can let another be squared', 't', 5.5, 4.7, [['sofa-1', -10], ['table-2', -8]], ['sofa-1', 'table-2']],
    // The sofa back at the angle the preset gives it strands one more cell of floor. The
    // candidate does not ask; the cell is priced when it is rated, as every answer's is.
    ['navigation is not asked', 't', 6, 5, [['sofa-1', 5]], ['sofa-1']],
    // 2.5° is inside `TURN_EPSILON`, so `moved` would not count the turn.
    ['a turn too small to count as a move is not tried', 't', 6, 5, [['sofa-1', -2.5]], null],
  ];
  for (const [name, layout, w, d, turns, expected] of rules) {
    it(`${name} (${layout} ${w} × ${d}, ${turns.map(([id, deg]) => `${id} ${deg}°`).join(', ')})`, () => {
      const { parts: base, footprint } = room(layout, w, d);
      const parts = turns.reduce((acc, [id, deg]) => turned(acc, (p) => p.id === id, deg, footprint).parts, base);
      expect(squaredIn(parts, footprint, new Set(turns.map(([id]) => id)))).toEqual(expected);
    });
  }

  it('a locked piece is not turned, however crooked', () => {
    const { parts: base, footprint } = room('t', 6, 5);
    const { parts, id } = turned(base, isSofa, -10, footprint);
    const locked = parts.map((p) => (p.id === id ? { ...p, locked: true } : p));
    expect(squaredIn(locked, footprint, new Set([id]))).toBeNull();
  });

  it('in the Rectangle the turn itself pushes the sofa back inside, so nothing is squared', () => {
    // Every wall of a rectangle is an edge of its bounding box, so the clamp in the turn
    // brings the sofa off the wall and the room has no fault for the candidate to clear.
    const { parts: base, footprint } = room('rect', 6, 4);
    const start = base.find(isSofa)!;
    const { parts, id } = turned(base, isSofa, -10, footprint);
    const sofa = parts.find((p) => p.id === id)!;
    expect(Math.hypot(sofa.pos[0] - start.pos[0], sofa.pos[2] - start.pos[2])).toBeGreaterThan(0.1);
    expect(squaredIn(parts, footprint, new Set([id]))).toBeNull();
  });

  it('a refit is never offered the candidate', () => {
    // A refit answers a room that changed under the furniture: the smallest change back to
    // a legal room, weighed by how far things move. Same room, same turn, no candidate.
    const { parts: base, footprint } = room('t', 6, 5);
    const { parts, id } = turned(base, isSofa, -10, footprint);
    const { result, rated } = watched(parts, footprint, 1, new Set([id]), 'refit');
    expect(result.breakdownBefore.outside).toBeGreaterThan(1);
    expect(rated.length).toBe(result.finalists.length);
  });

  it('a merged set is squared as one, about its lead', () => {
    // The sofa and coffee table merged, and the pair turned 10° about the sofa. Squared
    // back, both are where they were authored. The table comes first in the list, so the
    // set is turned about its lead and not about whichever member the loop meets first:
    // turned about the table, both land 209 mm off. At −10° the turn about the table is
    // refused anyway, so that angle cannot tell the two apart.
    const { parts: authored, footprint } = room('t', 6, 5);
    const lead = authored.find(isSofa)!;
    const table = authored.find((p) => p.shape === 'coffee-table')!;
    const base = [table, ...authored.filter((p) => p.id !== table.id)];
    const turn = 10 * DEG;
    const parts = base.map((p): ScenePart => {
      if (p.id !== lead.id && p.id !== table.id) return p;
      const [ox, oz] = localToWorld(turn, p.pos[0] - lead.pos[0], p.pos[2] - lead.pos[2]);
      return { ...p, groupId: 'g', pos: [lead.pos[0] + ox, p.pos[1], lead.pos[2] + oz], rot: wrap(p.rot + turn) };
    });
    const { result, rated } = watched(parts, footprint, 1, new Set([lead.id, table.id]));
    expect(rated.length).toBe(result.finalists.length + 1);
    const cand = rated[rated.length - 1].placements;
    for (const authored of [lead, table]) {
      const c = cand[parts.findIndex((p) => p.id === authored.id)];
      expect(c.x, authored.id).toBeCloseTo(authored.pos[0], 9);
      expect(c.z, authored.id).toBeCloseTo(authored.pos[2], 9);
      expect(offSquare(c.yaw), authored.id).toBeLessThan(1e-6);
    }
  });

  it('a sofa turned 20° is past `SNAP_TOL`, so the candidate leaves it to the search', () => {
    // Beyond `SNAP_TOL` an angle is a choice. In the T the 20° sofa pokes through its wall
    // as the 10° one does, so a wider window would square it here; this pins the window.
    const { parts: base, footprint } = room('t', 6, 5);
    const { parts, id } = turned(base, isSofa, -20, footprint);
    const { result, rated } = watched(parts, footprint, 1, new Set([id]));
    expect(result.breakdownBefore.outside).toBeGreaterThan(1);
    expect(rated.length).toBe(result.finalists.length);
  });

  for (const id of ['t', 'l'] as LayoutId[]) {
    it(`${id} 6 × 5 as authored: no candidate, and Fix acts as it did`, () => {
      const { parts, footprint } = room(id, 6, 5);
      let none = 0;
      let candidates = 0;
      for (const seed of SEEDS) {
        const { result, rated } = watched(parts, footprint, seed, new Set());
        if (result.moved.length === 0 || !isWorthOffering(result.before, result.after)) none++;
        candidates += rated.length - result.finalists.length;
      }
      // Nothing in either room is at fault, so nothing is turned, the L's armchair included:
      // it is authored 8° off square, inside `SNAP_TOL`. Identical on the commit before, both
      // rooms: the T's two seeds that act are the search's own.
      expect({ none, candidates }).toEqual({ none: id === 't' ? 10 : 12, candidates: 0 });
    });
  }

  it('Ideas never hands back the room it was given with the sofa squared in place', () => {
    const { parts: base, footprint } = room('t', 6, 5);
    const { parts, id } = turned(base, isSofa, -10, footprint);
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

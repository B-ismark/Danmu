// What the room-report gate in `shuffleRoom` can actually reject, measured.
//
// ── Why this file exists ──────────────────────────────────────────────────────
//
// `shuffleRoom` runs two gates. `isCleanShuffle` asks the cost function;
// `newRoomFindings` asks `analyzeRoom`. The second is described in
// `lib/layout-shuffle.ts` as "what makes that zero a guarantee rather than a
// measurement" — and **deleting it leaves every test in
// `tests/layout-shuffle.test.ts` green**, including the 300-second sweep. That is
// this repo's own "a check that cannot fail", one level up: the sweep measures the
// solver and reports it as though it had measured the gate.
//
// Measured before any of this was written, so the file answers a fact rather than a
// suspicion: **816 candidates across thirteen room configurations — five presets and
// four adversarial dining rooms built specifically to provoke it, six attempts each
// — and the gate rejected nothing at all.** Not "rarely". Never.
//
// ── And it is structural, not luck ────────────────────────────────────────────
//
// Three rules in `lib/clearance.ts` reach the severity `newRoomFindings` filters on
// (`severity === 'error' || rule === 'clash'`): `door`, `clash` and `tall`.
//
//   · `door` is in `HARD_TERMS`, so `isCleanShuffle` has already refused it.
//   · `tall` is a fact about a piece's SIZE. A shuffle moves and turns, so it
//     appears identically before and after and the gate's own diff cancels it.
//   · `clash` is the one the gate was written for — and #68 closed the gap. Both
//     modules now read `TUCKED_CLASH_SHARE` for a pair that shares floor by design,
//     and `isCleanShuffle` requires `overlap === 0` exactly, so a candidate that
//     even reaches the gate cannot hold a pair past that bar.
//
// The second test pins that last sentence as an **iff**, which is the part that can
// rot: it goes red the moment either module moves its threshold, and its message
// says what that means for the gate. The rest pin the gate's own wiring, which is
// real code and worth keeping working whether or not it currently fires.
//
// **The recommendation is NOT to delete the gate.** These two modules have drifted
// apart once already, which is why it was written. What was wrong was the claim that
// a test covered it; this file replaces the claim with a measurement.

import { describe, it, expect } from 'vitest';
import { analyzeRoom } from '@/lib/clearance';
import { costBreakdown, prepare, DEFAULT_WEIGHTS, type Placement } from '@/lib/layout-score';
import { isCleanShuffle, newRoomFindings, applyPlacements } from '@/lib/layout-shuffle';
import { lockedForSolve, movableFor, type SolveResult } from '@/lib/layout-solve';
import { defaultScene, type ScenePart } from '@/lib/scene-spec';
import { footprintForLayout } from '@/lib/footprint';
import { sharesFloor, roleOf } from '@/lib/layout-rules';

const CEILING = 2.4;
const FOOTPRINT = footprintForLayout('rect', 6, 5);
const ROOM = { footprint: FOOTPRINT, height: CEILING };

const BASE = defaultScene('open', 8, 6);
const DESK = BASE.find((p) => p.shape === 'desk-standard')!;
const CHAIR = BASE.find((p) => p.shape === 'chair-dining')!;
const DOOR = BASE.find((p) => p.shape === 'door')!;

/** Desk at the origin, one chair `cz` metres from its centre along +Z. Small `cz`
 *  means deeply buried. The desk is 850 mm deep and the chair 520, so the chair is
 *  fully clear at cz ≥ 0.685 and fully inside at cz ≤ 0.165. */
function diningPair(cz: number): ScenePart[] {
  return [
    { ...DOOR, pos: [0, DOOR.pos[1], -2.5] as [number, number, number] },
    { ...DESK, id: 'table-1', pos: [0, DESK.pos[1], 0] as [number, number, number], rot: 0 },
    { ...CHAIR, id: 'chair-1', pos: [0, CHAIR.pos[1], cz] as [number, number, number], rot: Math.PI },
  ];
}

function placementsOf(parts: ScenePart[]): Placement[] {
  return parts.map((p) => ({ x: p.pos[0], z: p.pos[2], yaw: p.rot }));
}

function modelFor(parts: ScenePart[]) {
  const locked = lockedForSolve(parts, {}, null);
  return prepare({
    parts,
    movable: movableFor(parts, locked),
    footprint: FOOTPRINT,
    origin: placementsOf(parts),
  });
}

/** The solver's `overlap` term for exactly the arrangement handed in. */
function solverOverlap(parts: ScenePart[]): number {
  return costBreakdown(modelFor(parts), placementsOf(parts), DEFAULT_WEIGHTS).overlap;
}

/** Does `analyzeRoom` call this arrangement a clash? */
function reportsClash(parts: ScenePart[]): boolean {
  return analyzeRoom(parts, ROOM).issues.some((f) => f.rule === 'clash');
}

/** A `SolveResult` saying "here are the placements, every piece moved". Built by
 *  hand rather than solved for, because the whole difficulty is that the solver will
 *  not produce the arrangement the gate is supposed to catch. */
function resultFor(from: ScenePart[], to: ScenePart[]): SolveResult {
  const model = modelFor(from);
  const before = costBreakdown(model, placementsOf(from), DEFAULT_WEIGHTS);
  const after = costBreakdown(model, placementsOf(to), DEFAULT_WEIGHTS);
  return {
    placements: placementsOf(to),
    before: before.total,
    after: after.total,
    breakdownBefore: before,
    breakdownAfter: after,
    moved: from.map((_, i) => i),
    moves: [],
    finalists: [],
  };
}

describe('the two modules agree about a tucked pair, which is why the gate is quiet', () => {
  it('a desk and a dining chair are a sharesFloor pair — the premise of everything below', () => {
    expect(sharesFloor(roleOf(DESK), roleOf(CHAIR))).toBe(true);
  });

  it('reports a clash EXACTLY where the solver starts charging overlap', () => {
    // Walked in 10 mm steps through the whole transition rather than sampled at a
    // few chosen depths. Choosing the samples is how the first version of half the
    // assertions in this repo missed the defect they were guarding.
    const rows: Array<{ cz: number; overlap: number; clash: boolean }> = [];
    for (let i = 70; i >= 10; i--) {
      const cz = i / 100;
      const parts = diningPair(cz);
      rows.push({ cz, overlap: solverOverlap(parts), clash: reportsClash(parts) });
    }

    // The fixture has to cross the line in both directions, or the comparison below
    // is vacuous — the same floor `layout-shuffle.test.ts` puts under its offer count.
    expect(rows.some((r) => r.clash), 'the chair must end up clashing somewhere').toBe(true);
    expect(rows.some((r) => !r.clash), 'and must start out clear').toBe(true);

    const disagree = rows.filter((r) => (r.overlap > 0) !== r.clash);
    expect(
      disagree.map((r) => `cz=${r.cz} overlap=${r.overlap.toFixed(3)} clash=${r.clash}`),
      'The solver and the room report disagree about a tucked pair at these depths. ' +
        'That gap is what `newRoomFindings` in lib/layout-shuffle.ts exists to catch, ' +
        'and while it is empty that gate cannot fire on a clash. If this has gone red, ' +
        'the gate has real work to do again — check it is still wired into shuffleRoom.',
    ).toEqual([]);
  });

  it('so no arrangement passes the cheap gate and is then refused by the room report', () => {
    // Both gates, in the order `shuffleRoom` runs them, over the same sweep. Nothing
    // may sit between them.
    const from = diningPair(0.9);
    let cheapPassed = 0;
    for (let i = 70; i >= 10; i--) {
      const result = resultFor(from, diningPair(i / 100));
      if (!isCleanShuffle(result)) continue;
      cheapPassed++;
      expect(
        newRoomFindings(from, ROOM, result).map((f) => `${f.rule}:${f.partIds.join(',')}`),
        `cz=${(i / 100).toFixed(2)} passed isCleanShuffle and was then rejected by the room report`,
      ).toEqual([]);
    }
    expect(cheapPassed, 'the sweep must actually reach the second gate').toBeGreaterThan(0);
  });
});

describe('newRoomFindings itself — the gate works, it is simply never handed anything', () => {
  it('rejects an arrangement that introduces a clash', () => {
    const from = diningPair(0.9);
    const to = diningPair(0.1);
    expect(newRoomFindings(from, ROOM, resultFor(from, to)).map((f) => f.rule)).toContain('clash');
  });

  it('does NOT blame a shuffle for a clash the room already had', () => {
    // The before/after diff, which is the half a naive "does the new room have
    // findings" gate gets wrong: a room that arrives broken is not this button's to
    // answer for.
    const from = diningPair(0.1);
    const to = diningPair(0.12);
    expect(reportsClash(from), 'the fixture must start out already clashing').toBe(true);
    expect(newRoomFindings(from, ROOM, resultFor(from, to))).toEqual([]);
  });

  it('sees the arrangement through applyPlacements, not the parts it was handed', () => {
    // If `applyPlacements` were dropped and `analyzeRoom` ran on `parts` twice,
    // before and after would be identical and the gate would return [] for
    // everything — indistinguishable from "the gate is fine" by every other test in
    // this file.
    const from = diningPair(0.9);
    const applied = applyPlacements(from, resultFor(from, diningPair(0.1)));
    expect(applied[2].pos[2]).toBeCloseTo(0.1, 5);
    expect(reportsClash(applied)).toBe(true);
    expect(reportsClash(from)).toBe(false);
  });
});

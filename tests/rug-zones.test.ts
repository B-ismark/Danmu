// Where a rug goes, per group — and what it stays out from under.
//
// `rug-group` used to be a `near` band: the rug's centre within 0.8 m of the anchor's.
// That band is satisfied by a rug half under a sofa's BACK and by one entirely under a
// bed's head with both nightstands standing on it, so the solver was free to hand back
// either. The rules below are the three a designer would name, and the fixtures are
// chosen so the OLD band scored the wrong answer as zero — a test that the old code
// also passed would prove nothing about the change.

import { describe, expect, it } from 'vitest';
import { RUG_UNDER_SEAT_M, relationFor, rugKeepsOff, rugTarget } from '@/lib/layout-rules';
import { costBreakdown, prepare, relationDistance, type Placement } from '@/lib/layout-score';
import { solveLayout } from '@/lib/layout-solve';
import { defaultScene, type ScenePart } from '@/lib/scene-spec';
import { footprintForLayout } from '@/lib/footprint';
import { offeredHeight, offeredSizes } from './helpers/offered-sizes';

const P = (p: Partial<ScenePart> & Pick<ScenePart, 'id' | 'category' | 'shape' | 'dimMM'>): ScenePart =>
  ({ name: p.id, pos: [0, 0, 0], rot: 0, locked: false, ...p }) as ScenePart;

const RUG = P({ id: 'rug', category: 'rug', shape: 'rug', dimMM: [2400, 1600, 5] });
const SOFA = P({ id: 'sofa', category: 'sofa', shape: 'sofa', dimMM: [2200, 900, 850] });
const BED = P({ id: 'bed', category: 'bed', shape: 'bed-double', dimMM: [1600, 2000, 500] });
const TABLE = P({ id: 'table', category: 'table', shape: 'desk-standard', dimMM: [900, 1500, 750] });
const foot = (p: ScenePart, x = 0, z = 0, rot = 0) => ({ cx: x, cz: z, rot, hw: p.dimMM[0] / 2000, hd: p.dimMM[1] / 2000 });
const halfTurn = (a: number, b: number) => Math.abs(Math.sin(a - b)) < 1e-9;

describe('rugTarget — the three rules', () => {
  it('seating: the near edge runs RUG_UNDER_SEAT_M under the front, and the rug runs out into the room', () => {
    const t = rugTarget(1.2, 0.8, foot(SOFA), 'seat');
    const sofaFront = 0.45;
    // The rug's near edge, measured along the sofa's front (+z at rot 0).
    expect(t.z - 0.8).toBeCloseTo(sofaFront - RUG_UNDER_SEAT_M, 9);
    // Front legs on (they sit ~0.05–0.15 m in from the front face)…
    expect(t.z - 0.8).toBeLessThan(sofaFront - 0.15);
    // …back legs off (they sit that far in from the BACK face, at z ≈ −0.35).
    expect(t.z - 0.8).toBeGreaterThan(-0.45 + 0.15);
    expect(t.x).toBeCloseTo(0, 9);
    expect(halfTurn(t.yaw, 0)).toBe(true);
  });

  it('seating: follows the sofa round — a sofa facing +x puts the rug off +x', () => {
    const t = rugTarget(1.2, 0.8, foot(SOFA, 1, 2, Math.PI / 2), 'seat');
    expect(t.x).toBeCloseTo(1 + 0.45 - RUG_UNDER_SEAT_M + 0.8, 9);
    expect(t.z).toBeCloseTo(2, 9);
    expect(halfTurn(t.yaw, Math.PI / 2)).toBe(true);
  });

  it('seating: a rug drawn long-side-deep is turned so its long side runs along the sofa', () => {
    const t = rugTarget(0.8, 1.2, foot(SOFA), 'seat');
    expect(halfTurn(t.yaw, Math.PI / 2)).toBe(true);
    // …and its reach along the front is still its SHORT half.
    expect(t.z).toBeCloseTo(0.45 - RUG_UNDER_SEAT_M + 0.8, 9);
  });

  it('bed: under the lower two-thirds, so the nightstands at the head are on bare floor', () => {
    // Bed at the origin, head at −z (its back), foot at +z.
    const t = rugTarget(1.2, 0.8, foot(BED), 'bed');
    const head = -1.0;
    const rugHeadEdge = t.z - 0.8;
    expect(rugHeadEdge).toBeCloseTo(head + 2 / 3, 9);
    // A 450 mm nightstand touching the head, beside the bed: z −1.0 … −0.55.
    expect(rugHeadEdge).toBeGreaterThan(-0.55);
    // Across the bed: the rug's long side is the one that runs side to side.
    expect(halfTurn(t.yaw, 0)).toBe(true);
    // And it shows past the foot, where feet land.
    expect(t.z + 0.8).toBeGreaterThan(1.0);
  });

  it('dining: centred, long side down the table', () => {
    const t = rugTarget(1.2, 0.8, foot(TABLE, 3, -1), 'table');
    expect(t.x).toBeCloseTo(3, 9);
    expect(t.z).toBeCloseTo(-1, 9);
    // The table is long on its own z, so the 2.4 m side of the rug turns to match.
    expect(halfTurn(t.yaw, Math.PI / 2)).toBe(true);
  });
});

describe('the scorer reads it', () => {
  function relationCostAt(rug: Placement, anchor: ScenePart, at: Placement) {
    const parts = [anchor, RUG];
    const m = prepare({ parts, movable: [false, true], footprint: footprintForLayout('rect', 8, 8) });
    return costBreakdown(m, [at, rug]).relation;
  }

  it('a rug under the sofa BACK scored zero on the old band, and costs now', () => {
    const at = { x: 0, z: 0, yaw: 0 };
    // Centre 0.6 m behind the sofa's centre: inside the old 0–0.8 m, back legs and all.
    const behind = relationCostAt({ x: 0, z: -0.6, yaw: 0 }, SOFA, at);
    const right = relationCostAt({ x: 0, z: 0.45 - RUG_UNDER_SEAT_M + 0.8, yaw: 0 }, SOFA, at);
    expect(right).toBe(0);
    expect(behind).toBeGreaterThan(0);
  });

  it('a rug square to its group costs nothing for the turn; one at 30° does', () => {
    const at = { x: 0, z: 0, yaw: 0 };
    const z = 0.45 - RUG_UNDER_SEAT_M + 0.8;
    expect(relationCostAt({ x: 0, z, yaw: Math.PI }, SOFA, at)).toBe(0); // a half turn is the same rug
    expect(relationCostAt({ x: 0, z, yaw: Math.PI / 6 }, SOFA, at)).toBeGreaterThan(0);
  });

  it('the band is measured to the target, not between centres', () => {
    const parts = [SOFA, RUG];
    const rel = relationFor(RUG, SOFA)!;
    expect(rel.kind).toBe('under');
    expect(rel.fit).toBe('seat');
    const feet = [
      { ...foot(SOFA), circle: false },
      { ...foot(RUG, 0, 0.45 - RUG_UNDER_SEAT_M + 0.8), circle: false },
    ];
    expect(relationDistance(feet, 1, 0, rel)).toBeCloseTo(0, 9);
    void parts;
  });
});

describe('what a rug stays out from under', () => {
  const WARDROBE = P({ id: 'wardrobe', category: 'wardrobe', shape: 'wardrobe', dimMM: [1600, 600, 2100] });
  const DESK = P({ id: 'desk', category: 'desk', shape: 'desk-l', dimMM: [1400, 700, 750] });
  const OFFICE = P({ id: 'office', category: 'chair', shape: 'chair-office', dimMM: [600, 600, 1100] });
  const DINING = P({ id: 'dining', category: 'chair', shape: 'chair-dining', dimMM: [450, 480, 900] });

  it('storage always; a desk only when something rolls at it', () => {
    expect(rugKeepsOff(WARDROBE, [WARDROBE])).toBe(true);
    expect(rugKeepsOff(DESK, [DESK])).toBe(false);
    expect(rugKeepsOff(DESK, [DESK, DINING])).toBe(false);
    expect(rugKeepsOff(DESK, [DESK, OFFICE])).toBe(true);
    expect(rugKeepsOff(SOFA, [SOFA])).toBe(false);
  });

  it('a wardrobe on the rug costs relation; beside it costs nothing', () => {
    const parts = [WARDROBE, RUG];
    const m = prepare({ parts, movable: [false, true], footprint: footprintForLayout('rect', 8, 8) });
    const w = { x: 0, z: 0, yaw: 0 };
    expect(costBreakdown(m, [w, { x: 0, z: 0, yaw: 0 }]).relation).toBeGreaterThan(0);
    expect(costBreakdown(m, [w, { x: 0, z: 2, yaw: 0 }]).relation).toBe(0);
  });

  it('the door swing is on the list', () => {
    // A rect room with a door on its west wall, and the rug laid in front of it.
    const room = defaultScene('rect', 6, 4, { footprint: footprintForLayout('rect', 6, 4) });
    const door = room.find((p) => p.category === 'door')!;
    const parts = [door, RUG];
    const m = prepare({ parts, movable: [false, true], footprint: footprintForLayout('rect', 6, 4) });
    const d = { x: door.pos[0], z: door.pos[2], yaw: door.rot };
    // Straight in front of the door, 0.6 m in.
    const inSwing = { x: door.pos[0] + 0.6 * Math.sin(door.rot), z: door.pos[2] + 0.6 * Math.cos(door.rot), yaw: 0 };
    expect(costBreakdown(m, [d, inSwing]).relation).toBeGreaterThan(0);
    expect(costBreakdown(m, [d, { x: 0, z: 0, yaw: 0 }]).relation).toBe(0);
  });
});

describe('end to end', () => {
  const strayRoom = () => {
    const footprint = footprintForLayout('rect', 6, 5);
    const sofa = { ...SOFA, pos: [0, 0, 1.8] as [number, number, number], rot: Math.PI };
    const rug = { ...RUG, pos: [2.2, 0, -1.6] as [number, number, number], rot: 0.5 };
    const t = rugTarget(1.2, 0.8, foot(sofa, sofa.pos[0], sofa.pos[2], sofa.rot), 'seat');
    return { footprint, parts: [sofa, rug], t };
  };

  it('with nothing anchoring it, the solver lays a stray rug where the rule puts it, squared up', () => {
    // `shuffle` mode: no inertia, so where the rug ends up is the rule's answer alone.
    const { footprint, parts, t } = strayRoom();
    const got = solveLayout(parts, footprint, [true, false], { seed: 1, mode: 'shuffle' }).placements[1];
    expect(Math.hypot(got.x - t.x, got.z - t.z)).toBeLessThanOrEqual(0.2 + 1e-6);
    expect(Math.abs(Math.sin(got.yaw - t.yaw))).toBeLessThan(0.05);
  });

  it('Fix brings it most of the way and stops where moving further costs more than it buys', () => {
    // Every relation is a soft band (`bandCost` is e²) against a linear `inertia`, so
    // under Fix a piece stops where the two slopes meet: 2e × 0.5 × 10 = 1.5 puts that
    // 0.15 m past the band's 0.2 — ~0.35 m off the spot, from 3.4 m off. The same
    // arithmetic governs a nightstand and a coffee table; a rug is not special here,
    // and the pin is so that a change to either slope is a decision, not a drift.
    const { footprint, parts, t } = strayRoom();
    const got = solveLayout(parts, footprint, [true, false], { seed: 1 }).placements[1];
    const off = Math.hypot(got.x - t.x, got.z - t.z);
    expect(off).toBeLessThan(0.45);
    expect(Math.hypot(2.2 - t.x, -1.6 - t.z)).toBeGreaterThan(3); // it had a long way to come
    expect(Math.abs(Math.sin(got.yaw - t.yaw))).toBeLessThan(0.05);
  });

  it('every starter room with a rug has it where the rule puts it', () => {
    let rugs = 0;
    for (const o of offeredSizes()) {
      const footprint = footprintForLayout(o.id, o.width, o.depth);
      const parts = defaultScene(o.id, o.width, o.depth, { footprint, height: offeredHeight() });
      const ri = parts.findIndex((p) => p.category === 'rug');
      if (ri < 0) continue; // no rug is a valid answer
      rugs++;
      const si = parts.findIndex((p) => p.category === 'sofa');
      const rug = parts[ri];
      const sofa = parts[si];
      const t = rugTarget(rug.dimMM[0] / 2000, rug.dimMM[1] / 2000, foot(sofa, sofa.pos[0], sofa.pos[2], sofa.rot), 'seat');
      expect(Math.hypot(rug.pos[0] - t.x, rug.pos[2] - t.z), `${o.id}: rug off its spot`).toBeLessThan(0.01);
      expect(Math.abs(Math.sin(rug.rot - t.yaw)), `${o.id}: rug not square to the sofa`).toBeLessThan(1e-6);
    }
    // Not vacuous: the starter living rooms do carry rugs.
    expect(rugs).toBeGreaterThanOrEqual(4);
  });
});

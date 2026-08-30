import { describe, expect, it } from 'vitest';
import { settleParts } from '../lib/layout-settle';
import { footprintForLayout, pointInFootprint, type Footprint } from '../lib/footprint';
import { footArea, footFromPart, footInsidePoly, footIntersectionArea, outsideShare } from '../lib/geometry';
import type { ScenePart } from '../lib/scene-spec';

const RECT: Footprint = footprintForLayout('rect', 6, 4);

let n = 0;
function part(p: Partial<ScenePart> & Pick<ScenePart, 'category' | 'shape' | 'dimMM' | 'pos'>): ScenePart {
  return { id: `${p.category}-${++n}`, name: p.category, rot: 0, locked: false, ...p } as ScenePart;
}

const foot = (p: ScenePart) => footFromPart(p.pos, p.rot, p.dimMM, p.circle);
const outside = (p: ScenePart, poly: Footprint = RECT) => outsideShare(foot(p), poly, 9);
const shared = (a: ScenePart, b: ScenePart) =>
  footIntersectionArea(foot(a), foot(b)) / Math.min(footArea(foot(a)), footArea(foot(b)));

const sofa = (pos: [number, number, number], rot = 0) =>
  part({ category: 'sofa', shape: 'sofa', dimMM: [2200, 950, 880], pos, rot });

describe('settleParts · inside the room', () => {
  it('sees an overhang the sampled share forgives', () => {
    // `outsideShare`'s outermost samples sit 10% in from the edges, so a 2.2 m sofa
    // 100 mm over the wall reads as 0.000 outside on a 5×5 grid. Settling used that
    // as its acceptance test and stopped early; the seed used it as its placement
    // gate and seated a coffee table 20 mm inside the plaster.
    const s = sofa([2.55, 0, 0], Math.PI / 2);
    expect(outsideShare(foot(s), RECT, 5)).toBe(0);
    expect(footInsidePoly(foot(s), RECT)).toBe(false);
    const [settled] = settleParts([s], RECT);
    expect(footInsidePoly(foot(settled), RECT)).toBe(true);
  });

  it('pulls a piece whose footprint hangs over a wall back in', () => {
    // Centre 150 mm inside the east wall: the CENTRE clamp every previous pass used
    // called this in-room, and half the sofa was in the garden.
    const s = sofa([2.85, 0, 0], Math.PI / 2);
    expect(outside(s)).toBeGreaterThan(0);
    const [settled] = settleParts([s], RECT);
    expect(outside(settled)).toBe(0);
    // …and it moved no further than it had to: still against that wall.
    expect(settled.pos[0]).toBeGreaterThan(2.4);
  });

  it('recovers a piece placed entirely outside the room', () => {
    const [settled] = settleParts([sofa([12, 0, 9])], RECT);
    expect(outside(settled)).toBe(0);
  });

  it('pulls a piece out of the void of an L', () => {
    // The exact failure the starter scene shipped: an armchair in the quadrant the
    // L cuts away.
    const poly = footprintForLayout('l', 6, 4.7);
    const chair = part({ category: 'chair', shape: 'chair-armchair', dimMM: [800, 800, 900], pos: [2.1, 0, 1.45] });
    expect(outside(chair, poly)).toBeGreaterThan(0);
    const [settled] = settleParts([chair], poly);
    expect(outside(settled, poly)).toBe(0);
  });

  it('leaves a piece that is already in alone', () => {
    const s = sofa([0, 0, 1.4], Math.PI);
    const [settled] = settleParts([s], RECT);
    expect(settled.pos).toEqual(s.pos);
  });

  it('never moves a wall-mounted piece off its wall', () => {
    const tv = part({ category: 'tv', shape: 'tv', dimMM: [1450, 60, 820], pos: [0, 1.4, -1.97], wallMounted: true });
    const [settled] = settleParts([tv], RECT);
    expect(settled.pos).toEqual(tv.pos);
  });

  it('does not resize anything', () => {
    const s = sofa([12, 0, 9]);
    const [settled] = settleParts([s], RECT);
    expect(settled.dimMM).toEqual([2200, 950, 880]);
  });

  it('leaves the caller’s parts untouched', () => {
    const s = sofa([12, 0, 9]);
    settleParts([s], RECT);
    expect(s.pos).toEqual([12, 0, 9]);
  });
});

describe('settleParts · out of each other', () => {
  it('separates two pieces in the same place', () => {
    // Two detections of one sofa, or a bed and a wardrobe the AI both put on the
    // north wall. The detect → scene path resolved nothing between parts.
    const bed = part({ category: 'bed', shape: 'bed-double', dimMM: [1600, 2000, 600], pos: [0, 0, -1.1] });
    const wardrobe = part({ category: 'wardrobe', shape: 'wardrobe', dimMM: [2000, 600, 2100], pos: [0.3, 0, -1.3] });
    expect(shared(bed, wardrobe)).toBeGreaterThan(0.5);
    const [a, b] = settleParts([bed, wardrobe], RECT);
    expect(shared(a, b)).toBeLessThan(0.02);
    expect(outside(a)).toBe(0);
    expect(outside(b)).toBe(0);
  });

  it('moves the smaller piece and leaves the anchor where it was', () => {
    const s = sofa([0, 0, 1.4], Math.PI);
    const stand = part({ category: 'nightstand', shape: 'nightstand', dimMM: [450, 400, 550], pos: [0, 0, 1.4] });
    const [settledSofa, settledStand] = settleParts([s, stand], RECT);
    expect(settledSofa.pos).toEqual(s.pos);
    expect(settledStand.pos).not.toEqual(stand.pos);
  });

  it('lets a chair stay tucked under the table it belongs to', () => {
    const table = part({ category: 'table', shape: 'desk-standard', dimMM: [1500, 850, 750], pos: [0, 0, 0] });
    const chair = part({ category: 'chair', shape: 'chair-dining', dimMM: [480, 520, 850], pos: [0, 0, 0.55], rot: Math.PI });
    const [, settled] = settleParts([table, chair], RECT);
    expect(settled.pos).toEqual(chair.pos);
  });

  it('leaves a rug under the furniture it anchors', () => {
    const s = sofa([0, 0, 1.4], Math.PI);
    const rug = part({ category: 'rug', shape: 'rug', dimMM: [2400, 1600, 5], pos: [0, 0, 0.8] });
    const [, settled] = settleParts([s, rug], RECT);
    expect(settled.pos).toEqual(rug.pos);
  });

  it('respects a frozen piece', () => {
    const a = sofa([0, 0, 0]);
    const b = part({ category: 'nightstand', shape: 'nightstand', dimMM: [450, 400, 550], pos: [0, 0, 0] });
    const [, settled] = settleParts([a, b], RECT, { frozen: new Set([b.id]) });
    expect(settled.pos).toEqual(b.pos);
  });

  it('leaves a piece put when the room has nowhere to put it', () => {
    // A 6 m room with a 2.2 m sofa across every metre of it: there is no free spot,
    // and inventing one is worse than reporting the clash.
    const poly = footprintForLayout('rect', 2.4, 1.2);
    const a = sofa([0, 0, 0]);
    const b = sofa([0.1, 0, 0]);
    const settled = settleParts([a, b], poly);
    expect(settled).toHaveLength(2);
    expect(settled.every((p) => Number.isFinite(p.pos[0]) && Number.isFinite(p.pos[2]))).toBe(true);
  });
});

describe('settleParts brings the ceiling family back inside too', () => {
  // `movable` gated on `wallMounted`, which is true for a fan and a pendant, so the one
  // pass that would pull them back into the room skipped them. A piece IN a wall is
  // exempt for a real reason — its footprint sits on the boundary and a containment push
  // would drag it off the plaster — and the ceiling family is not in a wall. Same
  // exemption, same fix, as `carryAttached` in `lib/wall-move.ts`.
  const L = footprintForLayout('l', 6, 5);

  /** A point in the quadrant an L cuts away, so "inside the bounding box" and "inside
   *  the room" disagree — which is the only place this can be observed. */
  function inTheVoid(poly: Footprint): [number, number] {
    let best: [number, number] | null = null;
    for (let x = -2.8; x <= 2.8; x += 0.1) {
      for (let z = -2.3; z <= 2.3; z += 0.1) {
        if (!pointInFootprint(x, z, poly)) best = best ?? [x, z];
      }
    }
    if (!best) throw new Error('the L fixture has no cut-away quadrant');
    return best;
  }

  it('pulls a ceiling fan out of the void of an L', () => {
    const [vx, vz] = inTheVoid(L);
    // `wallMounted: true` is not decoration on this fixture, it IS the fixture. Without
    // it the test passes against the defect: `!p.wallMounted` is true for a part that
    // simply omits the field, so an unflagged fan was movable all along and the
    // assertion measured nothing. Every builder sets it — `CATEGORY_DEFAULTS.fan`, and
    // `isWallMountedPart` derives it — so a fan in the app always carries it.
    const fan = part({ category: 'fan', shape: 'fan', dimMM: [1000, 1000, 200], pos: [vx, 2.4, vz], circle: true, wallMounted: true });
    // The fixture has to start outside, or the assertion below is vacuous.
    expect(footInsidePoly(footFromPart(fan.pos, fan.rot, fan.dimMM, fan.circle), L as never), 'fixture must start outside').toBe(false);

    const [settled] = settleParts([fan], L);
    expect(
      footInsidePoly(footFromPart(settled.pos, settled.rot, settled.dimMM, settled.circle), L as never),
      `fan ended at (${settled.pos[0].toFixed(2)}, ${settled.pos[2].toFixed(2)})`,
    ).toBe(true);
    // Its HEIGHT is not this pass's business — it still hangs where it hung.
    expect(settled.pos[1]).toBeCloseTo(2.4, 9);
  });

  it('and still leaves a piece that rides a wall exactly where it is', () => {
    // The control. Without it, "the ceiling family is now contained" is indistinguishable
    // from "the exemption was deleted", which would drag every door and window off its
    // own wall — the reason the exemption exists.
    const RECT = footprintForLayout('rect', 6, 4);
    // Same reason: the flag has to be on it, or the control is testing an unflagged
    // part and the exemption it exists to protect is never reached.
    const door = part({ category: 'door', shape: 'door', dimMM: [900, 50, 2100], pos: [0, 1.05, -2], wallMounted: true });
    const [settled] = settleParts([door], RECT);
    expect(settled.pos[0]).toBeCloseTo(0, 9);
    expect(settled.pos[2]).toBeCloseTo(-2, 9);
  });
});

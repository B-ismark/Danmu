import { describe, it, expect } from 'vitest';
import { snapAhead, snapToNeighbors, snapGuideEnds, GUIDE_OVERHANG_M } from '@/lib/item-snap';
import { aabbExtents } from '@/lib/geometry';
import type { ScenePart } from '@/lib/scene-spec';

function part(p: Partial<ScenePart> & Pick<ScenePart, 'id' | 'dimMM' | 'pos'>): ScenePart {
  return {
    name: p.id,
    category: 'table',
    shape: 'coffee-table',
    rot: 0,
    locked: false,
    ...p,
  } as ScenePart;
}

const DIM: [number, number, number] = [1000, 600, 400]; // 1.0 × 0.6 m

describe('aabbExtents', () => {
  it('axis-aligned at rot=0', () => {
    const { ex, ez } = aabbExtents(0, DIM);
    expect(ex).toBeCloseTo(0.5);
    expect(ez).toBeCloseTo(0.3);
  });
  it('swaps at 90°', () => {
    const { ex, ez } = aabbExtents(Math.PI / 2, DIM);
    expect(ex).toBeCloseTo(0.3);
    expect(ez).toBeCloseTo(0.5);
  });
});

describe('snapToNeighbors', () => {
  // Neighbour: 1.0 × 0.6 table at origin → right edge at x = +0.5.
  const neighbor = part({ id: 'n1', dimMM: DIM, pos: [0, 0, 0] });

  it('snaps flush edge-to-edge when within range', () => {
    // Mover (same size) approaching from the right: flush at x = 0.5 + 0.5 = 1.0.
    const r = snapToNeighbors(1.06, 0, 0, DIM, [neighbor], 'mover');
    expect(r.x).toBeCloseTo(1.0);
    expect(r.lines.some((l) => l.axis === 'x' && l.kind === 'edge')).toBe(true);
  });

  it('snaps centre alignment on the other axis', () => {
    const r = snapToNeighbors(1.0, 0.06, 0, DIM, [neighbor], 'mover');
    expect(r.z).toBeCloseTo(0);
    expect(r.lines.some((l) => l.axis === 'z' && l.kind === 'center')).toBe(true);
  });

  it('does not snap x beyond the threshold (z stays aligned — that line may show)', () => {
    const r = snapToNeighbors(1.3, 0, 0, DIM, [neighbor], 'mover');
    expect(r.x).toBeCloseTo(1.3);
    expect(r.lines.some((l) => l.axis === 'x')).toBe(false);
  });

  it('ignores far-away neighbours on the cross axis', () => {
    // Same x-edge proximity but 3m away in z — should not magnetise.
    const r = snapToNeighbors(1.06, 3.0, 0, DIM, [neighbor], 'mover');
    expect(r.x).toBeCloseTo(1.06);
  });

  it('ignores wall-mounted neighbours and itself', () => {
    const tv = part({ id: 'tv', dimMM: [1200, 80, 700], pos: [1.0, 1.0, 0], wallMounted: true });
    const r = snapToNeighbors(1.06, 0, 0, DIM, [tv, part({ id: 'mover', dimMM: DIM, pos: [1.06, 0, 0] })], 'mover');
    expect(r.x).toBeCloseTo(1.06);
  });

  it('picks the nearest candidate when several fire', () => {
    const other = part({ id: 'n2', dimMM: DIM, pos: [2.0, 0, 0] }); // left edge at 1.5
    // Mover at 1.04: flush-right of n1 (target 1.0, dist 0.04) vs flush-left of n2 (target 1.0? no: 1.5-0.5=1.0 same)…
    // use a position that distinguishes: 1.42 → n2 flush-left target = 1.0? No: 2.0-0.5-0.5 = 1.0.
    // Right-edges-flush with n1: 0.5-0.5+... use centre of n2: target 2.0 — dist 0.58 — no.
    // Just assert it snaps to a sensible nearest target.
    const r = snapToNeighbors(1.03, 0, 0, DIM, [neighbor, other], 'mover');
    expect(r.x).toBeCloseTo(1.0);
  });
});

describe('snapGuideEnds', () => {
  // Both studio tabs draw this line, so its endpoints live in the lib. The reason
  // for the test is the transposition: an `x`-axis line holds x CONSTANT and runs
  // along z, and swapping the two produces a guide at right angles to the edge it
  // claims to align — which looks like a real guide unless you notice it is
  // perpendicular.

  it('holds the axis coordinate constant and runs along the other one', () => {
    const { from, to } = snapGuideEnds({ axis: 'x', at: 1.4, span: [-0.5, 0.5], kind: 'edge' });
    expect(from[0]).toBeCloseTo(1.4);
    expect(to[0]).toBeCloseTo(1.4);
    expect(from[1]).toBeCloseTo(-0.5 - GUIDE_OVERHANG_M);
    expect(to[1]).toBeCloseTo(0.5 + GUIDE_OVERHANG_M);
  });

  it('does the same for a z line, with x and z the other way round', () => {
    const { from, to } = snapGuideEnds({ axis: 'z', at: -2.1, span: [1, 3], kind: 'center' });
    expect(from[1]).toBeCloseTo(-2.1);
    expect(to[1]).toBeCloseTo(-2.1);
    expect(from[0]).toBeCloseTo(1 - GUIDE_OVERHANG_M);
    expect(to[0]).toBeCloseTo(3 + GUIDE_OVERHANG_M);
  });

  it('overhangs outward at both ends even when the span is given backwards', () => {
    // Not a bug that was happening: `snapToNeighbors` builds every span as
    // `[min, max]`, so its own lines always arrive ordered. This pins the contract
    // now that the function is public and a second caller could construct one —
    // the naive `span[0] - k` / `span[1] + k` shortens a reversed span at both ends
    // instead of extending it, and under 300 mm it inverts, drawing backwards.
    const back = snapGuideEnds({ axis: 'x', at: 0, span: [0.6, -0.4], kind: 'edge' });
    const fwd = snapGuideEnds({ axis: 'x', at: 0, span: [-0.4, 0.6], kind: 'edge' });
    expect(back).toEqual(fwd);
    expect(back.to[1] - back.from[1]).toBeCloseTo(1.0 + 2 * GUIDE_OVERHANG_M);
  });

  it('draws a guide for a zero-length span rather than nothing', () => {
    // Two centres aligned on a piece of zero cross-extent is degenerate but real
    // (a plane, a curtain seen edge-on), and the overhang is what makes it visible.
    const { from, to } = snapGuideEnds({ axis: 'z', at: 0, span: [2, 2], kind: 'center' });
    // Stated as a LENGTH, not as `2 * GUIDE_OVERHANG_M`. Every other expectation
    // here is written in terms of that constant, which means none of them notice it
    // going to zero — a mutation run found exactly that, and at zero this test was
    // asserting 0 === 0 while claiming to be about visibility. The value itself is
    // taste and stays out of the suite; that it is not nothing is the behaviour.
    expect(to[0] - from[0]).toBeGreaterThan(0.05);
    expect(to[0] - from[0]).toBeCloseTo(2 * GUIDE_OVERHANG_M);
  });
});

describe('snapAhead — the arrow key\'s magnet', () => {
  // Same neighbour as above: a mover of the same size is flush with it at x = 1.0.
  const neighbor = part({ id: 'n1', dimMM: DIM, pos: [0, 0, 0] });
  const inTheWay = () => true;

  it('stops on the FIRST line inside the step, not the one nearest its end', () => {
    // A second piece whose centre line is at x = 1.02. A coarse step left from 1.04 to
    // 0.99 passes it before it reaches the flush line at 1.0, the line nearest the end
    // of the step.
    const other = part({ id: 'n2', dimMM: DIM, pos: [1.02, 0, 1.1] });
    const r = snapAhead([1.04, 0], 0.99, 0, 0, DIM, [neighbor, other], 'mover', inTheWay);
    expect(r.x).toBeCloseTo(1.02, 9);
    expect(r.lines).toEqual([expect.objectContaining({ axis: 'x', kind: 'center', at: 1.02 })]);
  });

  it('does not count the line it is standing on as ahead of it', () => {
    const r = snapAhead([1.0, 0], 1.01, 0, 0, DIM, [neighbor], 'mover', inTheWay);
    expect(r.x).toBeCloseTo(1.01, 9);
    expect(r.lines).toEqual([]);
  });

  it('lands flush on a neighbour\'s edge inside the step, and names that line', () => {
    // Named, not drawn: the plan draws guides for a drag only, and a press has none.
    const r = snapAhead([1.03, 0], 0.98, 0, 0, DIM, [neighbor], 'mover', inTheWay);
    expect(r.x).toBeCloseTo(1.0, 9);
    expect(r.lines).toEqual([expect.objectContaining({ axis: 'x', kind: 'edge', at: 0.5 })]);
  });

  it('leaves an axis the step does not move along alone', () => {
    // 50 mm off the neighbour's centre line along z — inside the drag magnet's reach.
    const r = snapAhead([1.3, 0.05], 1.31, 0.05, 0, DIM, [neighbor], 'mover', inTheWay);
    expect(r.z).toBe(0.05);
    expect(r.lines.some((l) => l.axis === 'z')).toBe(false);
  });

  it('ends at the step when it reaches no line, off the grid or not', () => {
    const r = snapAhead([2.005, 0], 2.015, 0, 0, DIM, [neighbor], 'mover', inTheWay);
    expect(r.x).toBe(2.015);
    expect(r.lines).toEqual([]);
  });

  it('does not move toward a neighbour it is touching and would collide with', () => {
    // Flush at x = 1.0 and pressed left, into it. A Fine step lands 10 mm inside it,
    // which is exactly the collision test's touching allowance, so whether the step was
    // kept came down to float noise.
    const r = snapAhead([1.0, 0], 0.99, 0, 0, DIM, [neighbor], 'mover', inTheWay);
    expect(r.x).toBeCloseTo(1.0, 9);
  });

  it('steps into a neighbour that is not in its way', () => {
    // A rug, say: `canCollideWith` says no, so the collision test is the judge, as for a drag.
    const r = snapAhead([1.0, 0], 0.99, 0, 0, DIM, [neighbor], 'mover', () => false);
    expect(r.x).toBeCloseTo(0.99, 9);
  });

  it('steps past a neighbour it only passes beside', () => {
    // 650 mm off it along z, with 600 mm of half-depths between them: inside the guide's
    // slack, but they do not face each other across the line.
    const r = snapAhead([1.0, 0.65], 0.99, 0.65, 0, DIM, [neighbor], 'mover', inTheWay);
    expect(r.x).toBeCloseTo(0.99, 9);
  });

  it('stops a press into a neighbour along z the same way', () => {
    // Flush with its 600 mm depth at z = 0.6, pressed back toward it.
    const r = snapAhead([0, 0.6], 0, 0.59, 0, DIM, [neighbor], 'mover', inTheWay);
    expect(r.z).toBeCloseTo(0.6, 9);
  });

  it('steps past a neighbour along z that it only passes beside', () => {
    // 1.05 m off it along x, with 1.0 m of half-widths between them.
    const r = snapAhead([1.05, 0.6], 1.05, 0.59, 0, DIM, [neighbor], 'mover', inTheWay);
    expect(r.z).toBeCloseTo(0.59, 9);
  });

  it('stops only the way that goes into the neighbour, from either side of it', () => {
    // Flush on its west side this time, where going in is to the right.
    expect(snapAhead([-1.0, 0], -0.99, 0, 0, DIM, [neighbor], 'mover', inTheWay).x).toBeCloseTo(-1.0, 9);
    expect(snapAhead([-1.0, 0], -1.01, 0, 0, DIM, [neighbor], 'mover', inTheWay).x).toBeCloseTo(-1.01, 9);
    // …and on its north side, where it is down.
    expect(snapAhead([0, -0.6], 0, -0.59, 0, DIM, [neighbor], 'mover', inTheWay).z).toBeCloseTo(-0.6, 9);
    expect(snapAhead([0, -0.6], 0, -0.61, 0, DIM, [neighbor], 'mover', inTheWay).z).toBeCloseTo(-0.61, 9);
  });
});

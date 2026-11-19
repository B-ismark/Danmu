// @vitest-environment jsdom
//
// Split, step and join through the actions a person presses — `splitWallAt`, a
// drag (`wallAttachments` … `moveWallCarrying` … `endWallGesture`), `joinWallWithNext`
// — and then Suggest and Try a fix on the room that made. The geometry is
// `tests/wall-reshape.test.ts`; this file is the wiring: the selected wall follows
// its wall through a renumbering, colours stay on their walls, a step dragged back
// to nothing goes, and the arranging code still answers in the new shape.

import { beforeEach, describe, expect, it } from 'vitest';
import { endWallGesture, joinWallWithNext, moveWallCarrying, splitWallAt, wallAttachments } from '@/lib/wall-actions';
import { useScene } from '@/lib/scene-store';
import { useStudio } from '@/lib/store';
import { footprintForLayout, offsetWall, splitWall, type Footprint } from '@/lib/footprint';
import { defaultScene } from '@/lib/scene-spec';
import { footFromPart, footInsidePoly } from '@/lib/geometry';
import { lockedForSolve, solveLayout } from '@/lib/layout-solve';
import { applyPlacements } from '@/lib/layout-shuffle';
import { analyzeRoom } from '@/lib/clearance';

function setRect(w = 6, d = 4) {
  useScene.setState({
    room: { width: w, depth: d, height: 2.5, layoutId: 'rect', footprint: footprintForLayout('rect', w, d), wallColors: {} },
    parts: [],
    ready: true,
  });
  useStudio.setState({ positions: {}, rotations: {}, dims: {}, selectedWall: null });
}

function fp(): Footprint {
  return useScene.getState().room.footprint;
}

function square(poly: Footprint): boolean {
  return poly.every((a, i) => {
    const b = poly[(i + 1) % poly.length];
    return Math.abs(b[0] - a[0]) < 1e-9 || Math.abs(b[1] - a[1]) < 1e-9;
  });
}

beforeEach(() => setRect());

describe('split, drag, join', () => {
  it('a drag of the second half grows a step, and the selection stays on the wall being dragged', () => {
    useScene.getState().setWallColor(0, '#336699');
    expect(splitWallAt(0, 0.5)).toBe(true);
    expect(fp()).toHaveLength(5);
    // Both halves keep the paint.
    expect(useScene.getState().room.wallColors).toMatchObject({ 0: '#336699', 1: '#336699' });

    useStudio.getState().setSelectedWall(1);
    const ids = wallAttachments(1);
    // Ten frames of a drag, handing back the index that was pressed every time,
    // which is what the plan does.
    for (let k = 0; k < 10; k++) expect(moveWallCarrying(1, 0.08, ids)).toBeCloseTo(0.08, 9);
    expect(fp()).toHaveLength(6);
    expect(square(fp())).toBe(true);
    const sel = useStudio.getState().selectedWall!;
    // The selected wall is the one that moved: it sits 0.8 m out from where it was.
    const before = splitWall(footprintForLayout('rect', 6, 4), 0, 0.5)!.footprint;
    const movedMid = [(fp()[sel][0] + fp()[(sel + 1) % 6][0]) / 2, (fp()[sel][1] + fp()[(sel + 1) % 6][1]) / 2];
    const wasMid = [(before[1][0] + before[2][0]) / 2, (before[1][1] + before[2][1]) / 2];
    expect(Math.hypot(movedMid[0] - wasMid[0], movedMid[1] - wasMid[1])).toBeCloseTo(0.8, 9);
    // The colour stayed on the halves, and the step took it too.
    const colours = useScene.getState().room.wallColors;
    expect(Object.values(colours).filter((c) => c === '#336699')).toHaveLength(3);
    endWallGesture();
    expect(fp()).toHaveLength(6);
  });

  it('a step dragged back to nothing is taken out when the drag ends, and the split stays', () => {
    splitWallAt(0, 0.5);
    useStudio.getState().setSelectedWall(1);
    const ids = wallAttachments(1);
    moveWallCarrying(1, 0.5, ids);
    moveWallCarrying(1, -0.5, ids);
    expect(fp()).toHaveLength(6);
    endWallGesture();
    expect(fp()).toHaveLength(5);
    expect(useStudio.getState().selectedWall).toBe(1);
  });

  it('an arrow-key nudge out and back in leaves the split wall, not a sliver', () => {
    splitWallAt(0, 0.5);
    useStudio.getState().setSelectedWall(0);
    moveWallCarrying(0, 0.1);
    const after = useStudio.getState().selectedWall!;
    moveWallCarrying(after, -0.1);
    expect(fp()).toHaveLength(5);
    expect(useStudio.getState().selectedWall).toBe(0);
  });

  it('joining puts the room back', () => {
    splitWallAt(2, 0.3);
    expect(joinWallWithNext(2)).toBe(true);
    expect(fp()).toEqual(footprintForLayout('rect', 6, 4));
    expect(joinWallWithNext(0)).toBe(false);
  });

  it('undo-safe: every write leaves an outline with no wall of no length', () => {
    splitWallAt(0, 0.5);
    const ids = wallAttachments(0);
    // Out, back through where it started (the step passes through zero), and in.
    for (const d of [0.3, 0.3, -0.6, -0.4]) moveWallCarrying(0, d, ids);
    endWallGesture();
    const poly = fp();
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      expect(Math.hypot(b[0] - a[0], b[1] - a[1])).toBeGreaterThan(1e-4);
    }
  });
});

describe('Suggest and Try a fix in a room no preset makes', () => {
  // The rect 6 x 4's own furniture, in that room reshaped two ways: (a) one wall
  // split and its half pushed out into a bay, (b) an L dragged square, leaving two
  // corners in a straight line.
  const shapes: Array<[string, Footprint]> = [];
  {
    // Built through the real action path once, outside the tests, so the bay is
    // exactly what a person's drag makes.
    setRect();
    splitWallAt(2, 0.5);
    const ids = wallAttachments(3);
    moveWallCarrying(3, 1, ids);
    endWallGesture();
    shapes.push(['bay', fp()]);
    const l: Footprint = [[-3, -2], [3, -2], [3, 0], [0, 0], [0, 2], [-3, 2]];
    shapes.push(['L dragged square', offsetWall(l, 2, 2)]);
  }

  for (const [name, poly] of shapes) {
    it(`${name}: Suggest stands every piece inside the walls`, () => {
      expect(square(poly)).toBe(true);
      const parts = defaultScene('rect', 6, 4);
      const locked = lockedForSolve(parts, {}, null);
      const out = applyPlacements(parts, solveLayout(parts, poly, locked, { seed: 1, steps: 1500, mode: 'arrange' }));
      const outside = out.filter((p) => !p.wallMounted && !footInsidePoly(footFromPart(p.pos, p.rot, p.dimMM), poly));
      expect(outside.map((p) => p.id)).toEqual([]);
      expect(() => analyzeRoom(out, { footprint: poly, height: 2.5 })).not.toThrow();
    });

    it(`${name}: Try a fix runs and keeps every piece inside`, () => {
      const parts = defaultScene('rect', 6, 4);
      const locked = lockedForSolve(parts, {}, null);
      const out = applyPlacements(parts, solveLayout(parts, poly, locked, { seed: 2, steps: 1500, mode: 'refit' }));
      const outside = out.filter((p) => !p.wallMounted && !footInsidePoly(footFromPart(p.pos, p.rot, p.dimMM), poly));
      expect(outside.map((p) => p.id)).toEqual([]);
      const report = analyzeRoom(out, { footprint: poly, height: 2.5 });
      expect(Array.isArray(report.issues)).toBe(true);
    });
  }
});

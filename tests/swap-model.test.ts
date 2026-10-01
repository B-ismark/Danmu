// @vitest-environment jsdom
//
// The model swap left the Inspector for `lib/swap-model.ts` so the right-click menu
// could offer it too. What it owed there it owes here: the new model is re-grounded
// for its own size and mount, keeps the spot, drops stale overrides, and stands on
// whatever it lands on. jsdom because the real stores are driven.

import { describe, expect, it } from 'vitest';
import { swapPartModel } from '@/lib/swap-model';
import { useScene } from '@/lib/scene-store';
import { useStudio } from '@/lib/store';
import { footprintForLayout } from '@/lib/footprint';
import type { LibraryItem, ScenePart } from '@/lib/scene-spec';

function part(over: Partial<ScenePart> & { id: string }): ScenePart {
  return { category: 'other', name: over.id, shape: 'box', pos: [0, 0, 0], rot: 0, dimMM: [1000, 600, 800], locked: false, ...over };
}

const table = part({ id: 'table', category: 'table', shape: 'coffee-table', pos: [0, 0, 0], dimMM: [1200, 800, 750] });
const vase = part({ id: 'vase', category: 'plant', shape: 'plant', pos: [0, 0.75, 0], dimMM: [150, 150, 300] });

function setRoom() {
  useScene.setState({
    room: { width: 6, depth: 6, height: 2.5, layoutId: 'rect', footprint: footprintForLayout('rect', 6, 6), wallColors: {} },
    parts: [table, vase],
    ready: true,
  });
  useStudio.setState({ positions: { vase: [0.1, 0.75, 0.1] }, rotations: { vase: 1 }, dims: { vase: [200, 200, 400] }, parentIds: { vase: 'table' } });
}

const lamp: LibraryItem = { label: 'Table lamp', group: 'Lighting', category: 'lamp', shape: 'lamp-table', dimMM: [300, 300, 500] };

describe('changing the model', () => {
  it('keeps the spot, names the piece and stands it on the table it was on', () => {
    setRoom();
    swapPartModel('vase', lamp);
    const s = useStudio.getState();
    const p = useScene.getState().parts.find((q) => q.id === 'vase')!;
    expect(p).toMatchObject({ name: 'Table lamp', category: 'lamp', shape: 'lamp-table', dimMM: [300, 300, 500] });
    expect(s.positions.vase?.[0]).toBeCloseTo(0.1, 9);
    expect(s.positions.vase?.[2]).toBeCloseTo(0.1, 9);
    expect(s.positions.vase?.[1]).toBeCloseTo(0.75, 3);
    expect(s.parentIds.vase).toBe('table');
    // The old turn and size are gone with the old model.
    expect(s.rotations.vase).toBeUndefined();
    expect(s.dims.vase).toBeUndefined();
  });

  it('a size the search named wins over the library size', () => {
    setRoom();
    swapPartModel('vase', lamp, [250, 250, 600]);
    expect(useScene.getState().parts.find((q) => q.id === 'vase')!.dimMM).toEqual([250, 250, 600]);
  });

  it('a wall piece goes on the wall, not on the table', () => {
    setRoom();
    swapPartModel('vase', { label: 'Framed print', group: 'Decor', category: 'painting', shape: 'painting', dimMM: [600, 30, 400] });
    const s = useStudio.getState();
    expect(s.parentIds.vase).toBeUndefined();
    expect(useScene.getState().parts.find((q) => q.id === 'vase')!.wallMounted).toBe(true);
    expect(s.positions.vase?.[1]).toBeGreaterThan(0.75);
  });

  // Reported 2026-10-01: a print on a wall, swapped for curtains from the plan tab,
  // came back turned across the wall and half through it. The swap kept the print's
  // centre — 15 mm off the plaster, where a curtain's centre wants 145 — and dropped
  // the turn that faced the print into the room.
  it('a wall piece swapped for another hangs flat on the same wall, facing in', () => {
    const W = 6;
    // On the EAST wall (x = +3), faced into the room by a drag: authored rot 0, override
    // −90°, so the drop of the override is the half of the defect a north wall hides.
    const print = part({ id: 'print', category: 'painting', shape: 'painting', pos: [0, 1.4, 0], rot: 0, dimMM: [600, 30, 400], wallMounted: true });
    useScene.setState({
      room: { width: W, depth: W, height: 2.5, layoutId: 'rect', footprint: footprintForLayout('rect', W, W), wallColors: {} },
      parts: [print],
      ready: true,
    });
    useStudio.setState({ positions: { print: [W / 2 - 0.015 - 0.005, 1.4, 0.4] }, rotations: { print: -Math.PI / 2 }, dims: {}, parentIds: {} });
    swapPartModel('print', { label: 'Curtain', group: 'Decor', category: 'curtain', shape: 'curtain', dimMM: [1600, 80, 2200] });
    const s = useStudio.getState();
    const [x, , z] = s.positions.print!;
    // Turned to face west, into the room — the print's own turn, not the authored 0.
    expect(Math.sin(s.rotations.print!)).toBeCloseTo(-1, 9);
    expect(Math.cos(s.rotations.print!)).toBeCloseTo(0, 9);
    // Its back clear of the plaster, by the curtain's own standoff.
    const back = x + 0.08 / 2;
    expect(back).toBeLessThan(W / 2);
    expect(W / 2 - back).toBeGreaterThan(0.08);
    // Still where along the wall the print was.
    expect(z).toBeCloseTo(0.4, 9);
  });

  it('a wall piece already square to its wall writes no turn of its own', () => {
    // A transform write is never free: re-writing the authored turn still creates an
    // override a re-detect cannot touch.
    const W = 6;
    const print = part({ id: 'print', category: 'painting', shape: 'painting', pos: [0, 1.4, -W / 2 + 0.02], rot: 0, dimMM: [600, 30, 400], wallMounted: true });
    useScene.setState({
      room: { width: W, depth: W, height: 2.5, layoutId: 'rect', footprint: footprintForLayout('rect', W, W), wallColors: {} },
      parts: [print],
      ready: true,
    });
    useStudio.setState({ positions: {}, rotations: {}, dims: {}, parentIds: {} });
    swapPartModel('print', { label: 'Curtain', group: 'Decor', category: 'curtain', shape: 'curtain', dimMM: [1600, 80, 2200] });
    const s = useStudio.getState();
    expect(s.rotations.print).toBeUndefined();
    expect(s.positions.print![2]).toBeGreaterThan(-W / 2 + 0.08 / 2 + 0.08);
  });

  it('does nothing for a piece that is gone', () => {
    setRoom();
    const before = useScene.getState().parts;
    swapPartModel('nope', lamp);
    expect(useScene.getState().parts).toBe(before);
  });
});

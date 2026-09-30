// @vitest-environment jsdom
//
// The push through the real wall action. `tests/wall-push.test.ts` holds the
// geometry pure; what only the stores can show is the GESTURE: a drag resolves the
// push from pointer-down, so pulling the wall back out puts a pushed piece back
// where it stood — without inventing a position override it never had — and a wall
// that stops says which piece stopped it.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { moveWallCarrying, wallAttachments } from '@/lib/wall-actions';
import { useScene } from '@/lib/scene-store';
import { useStudio } from '@/lib/store';
import { ANNOUNCE_EVENT } from '@/lib/announce';
import { footprintForLayout } from '@/lib/footprint';
import type { ScenePart } from '@/lib/scene-spec';

// 6 × 6; wall 0 is the North wall, and `delta < 0` brings it in.
const sofa: ScenePart = {
  id: 'sofa', name: 'Sofa', category: 'sofa', shape: 'sofa', pos: [0, 0, 0], rot: 0, dimMM: [2000, 900, 800], locked: false,
};

function setRoom(parts: ScenePart[] = [sofa]) {
  useScene.setState({
    room: { width: 6, depth: 6, height: 2.5, layoutId: 'rect', footprint: footprintForLayout('rect', 6, 6), wallColors: {} },
    parts,
    ready: true,
  });
  useStudio.setState({ positions: {}, rotations: {}, dims: {}, parentIds: {} });
}

let heard: string[] = [];
const onAnnounce = (e: Event) => heard.push((e as CustomEvent<string>).detail ?? '');
beforeEach(() => {
  heard = [];
  window.addEventListener(ANNOUNCE_EVENT, onAnnounce);
});
afterEach(() => window.removeEventListener(ANNOUNCE_EVENT, onAnnounce));

describe('dragging a wall into a sofa', () => {
  it('pushes it, and puts it back when the wall is drawn out again', () => {
    setRoom();
    const ids = wallAttachments(0);
    // In 3 m over several frames, as a drag does.
    for (let i = 0; i < 6; i++) moveWallCarrying(0, -0.5, ids);
    expect(useStudio.getState().positions.sofa?.[2]).toBeCloseTo(0.45, 9);
    // Back out a little: the sofa comes back with it…
    moveWallCarrying(0, 0.25, ids);
    expect(useStudio.getState().positions.sofa?.[2]).toBeCloseTo(0.2, 9);
    // …and once the wall is short of it again, it stands where it began.
    moveWallCarrying(0, 0.5, ids);
    // It never had an override; it does not keep one.
    expect(useStudio.getState().positions.sofa).toBeUndefined();
  });

  it('a nudge pushes too', () => {
    // Near face 0.75 m off the wall: past the carry's reach, inside the nudge's.
    setRoom([{ ...sofa, pos: [0, 0, -1.8] }]);
    moveWallCarrying(0, -1.0);
    expect(useStudio.getState().positions.sofa?.[2]).toBeCloseTo(-1.55, 9);
  });

  it('stops the wall at a locked piece and says so', () => {
    setRoom([{ ...sofa, locked: true }]);
    const ids = wallAttachments(0);
    const applied = moveWallCarrying(0, -3, ids);
    expect(applied).toBeCloseTo(-2.55, 6);
    expect(useStudio.getState().positions.sofa).toBeUndefined();
    expect(heard).toEqual(['That wall stops here: the Sofa is locked.']);
  });

  it('stops where the stack meets the far wall, naming the piece out of room', () => {
    // Two pieces one behind the other need 1.8 m of the room's depth. The room's own
    // floor asks only for the deeper of them (0.9 m), so the push is what stops it.
    const table: ScenePart = { ...sofa, id: 'table', name: 'Table', category: 'table', shape: 'coffee-table', pos: [0, 0, 1.5], dimMM: [1000, 900, 450] };
    setRoom([sofa, table]);
    const ids = wallAttachments(0);
    const applied = moveWallCarrying(0, -5, ids);
    expect(-applied).toBeGreaterThan(4.19);
    expect(-applied).toBeLessThan(4.205);
    expect(useStudio.getState().positions.table?.[2]).toBeGreaterThan(2.54);
    expect(heard).toEqual(['That wall stops here: the Table has no more room to move.']);
  });
});

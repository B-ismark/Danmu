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
import { footFromPart, footInsidePoly } from '@/lib/geometry';
import { defaultScene, type ScenePart } from '@/lib/scene-spec';
import { ridesWall } from '@/lib/physics';
import { resolveParts } from '@/lib/transforms';

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

  it('stops the wall at a piece hung on the far wall, and says it cannot leave it', () => {
    // A bed 2 m deep, and a TV low on the South wall across from it: the bed reaches
    // the TV when the wall is 3.94 m in, before the room's own floor of 2 m.
    const bed: ScenePart = { ...sofa, id: 'bed', name: 'Bed', category: 'bed', shape: 'bed-double', dimMM: [1600, 2000, 600] };
    const tv: ScenePart = {
      ...sofa, id: 'tv', name: 'TV', category: 'tv', shape: 'tv', wallMounted: true, rot: Math.PI, pos: [0, 0.6, 3 - 0.03], dimMM: [1400, 60, 800],
    };
    setRoom([bed, tv]);
    const ids = wallAttachments(0);
    const applied = moveWallCarrying(0, -4.5, ids);
    expect(-applied).toBeCloseTo(3.94, 2);
    expect(heard).toEqual(["That wall stops here: the TV can't leave its wall."]);
  });

  it('parks a rug it carries on the far wall, and keeps it there on the way back', () => {
    // 200 mm off the North wall, so the drag CARRIES it; its far edge meets the
    // South wall 4.4 m in, and the wall reaches it 200 mm later.
    // Placed there by hand, as a rug usually is: the override is what a drag that
    // wrongly "returns" it would put back, over the carry's answer.
    const rug: ScenePart = { ...sofa, id: 'rug', name: 'Rug', category: 'rug', shape: 'rug', pos: [0, 0, 0], dimMM: [2000, 1400, 10] };
    setRoom([rug]);
    useStudio.setState({ positions: { rug: [0, 0, -2.1] } });
    const ids = wallAttachments(0);
    expect(ids).toEqual(['rug']);
    for (let i = 0; i < 10; i++) moveWallCarrying(0, -0.5, ids);
    expect(useScene.getState().room.depth).toBeCloseTo(1.4, 2);
    expect(useStudio.getState().positions.rug?.[2]).toBeCloseTo(2.3, 2);
    // In a rectangle the room's size floor says it first; the L sweep below is where
    // only the push can.
    expect(heard.at(-1)).toContain('Rug');
    // Drawn back out, it rides the wall it is on again. The push that parked it is
    // not a push to undo: putting it back where the drag began would throw it the
    // whole room's length away from the wall carrying it.
    moveWallCarrying(0, 0.3, ids);
    expect(useStudio.getState().positions.rug?.[2]).toBeCloseTo(2.0, 2);
  });

  it('a nudge between frames ends the drag it interrupted', () => {
    setRoom();
    const ids = wallAttachments(0);
    moveWallCarrying(0, -3, ids);
    expect(useStudio.getState().positions.sofa?.[2]).toBeCloseTo(0.45, 9);
    // Back out half a metre by the arrow key: the sofa is against the wall now, so
    // the wall takes it back with it.
    moveWallCarrying(0, 0.5);
    expect(useStudio.getState().positions.sofa?.[2]).toBeCloseTo(-0.05, 9);
    // In 0.1 again with the old drag's ids: pushed 0.1 from where it stands. A frame
    // resolved from where that drag began would take the sofa from its first place
    // with the wall 3.1 m in, and put it at 0.55.
    moveWallCarrying(0, -0.1, ids);
    expect(useStudio.getState().positions.sofa?.[2]).toBeCloseTo(0.05, 9);
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

describe('every wall of every starter room, dragged all the way in', () => {
  // Swept rather than sampled: the rug that walked out through the L's TV wall was
  // CARRIED, not pushed, and only that one wall of the four presets reached it.
  it('leaves nothing it moved outside the room, and says what stopped it', () => {
    const presets = [['rect', 5, 4], ['l', 6, 4.7], ['t', 5.5, 4.7], ['u', 6, 4.7]] as const;
    const escaped: string[] = [];
    const silent: string[] = [];
    let walls = 0;
    let rugStop = '';
    for (const [layoutId, width, depth] of presets) {
      const start = footprintForLayout(layoutId, width, depth);
      for (let w = 0; w < start.length; w++) {
        walls++;
        const parts = defaultScene(layoutId, width, depth);
        useScene.setState({ room: { width, depth, height: 2.6, layoutId, footprint: start, wallColors: {} }, parts, ready: true });
        useStudio.setState({ positions: {}, rotations: {}, dims: {}, parentIds: {} });
        heard = [];
        const ids = wallAttachments(w);
        // Five metres in 5 cm frames: every preset's every wall stops before that.
        for (let i = 0; i < 100; i++) moveWallCarrying(w, -0.05, ids);
        if (heard.length === 0) silent.push(`${layoutId} ${w}`);
        if (layoutId === 'l' && w === 0) rugStop = heard[heard.length - 1];
        const end = useScene.getState().room.footprint;
        const now = resolveParts(parts, useStudio.getState());
        now.forEach((p, k) => {
          // What rides a wall sits ON the boundary; the rest must stay inside, to a
          // hair: `footInsidePoly` has no tolerance, and a piece pushed flush is ON
          // the plaster.
          if (ridesWall(p.category, p.shape)) return;
          const was = footFromPart(parts[k].pos, parts[k].rot, parts[k].dimMM, parts[k].circle, parts[k].shape);
          const f = footFromPart(p.pos, p.rot, p.dimMM, p.circle, p.shape);
          if (footInsidePoly(was, start) && !footInsidePoly({ ...f, hw: f.hw - 0.003, hd: f.hd - 0.003 }, end)) escaped.push(`${layoutId} ${w} ${p.id}`);
        });
      }
    }
    expect(walls).toBe(26);
    expect(escaped).toEqual([]);
    expect(silent).toEqual([]);
    expect(rugStop).toBe('That wall stops here: the Area rug has no more room to move.');
  });
});

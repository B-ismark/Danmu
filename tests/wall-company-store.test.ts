// @vitest-environment jsdom
//
// The wall actions hand the studio's `parentIds` to the carry. `lib/wall-move.ts`
// is tested pure in `wall-company.test.ts`; what that file cannot see is a caller
// passing `{}` — every relation "rests on" silently gone, and the lamp left in the
// air over a table its wall took away. jsdom because the real stores are driven.

import { describe, expect, it } from 'vitest';
import { moveWallCarrying, wallAttachments } from '@/lib/wall-actions';
import { useScene } from '@/lib/scene-store';
import { useStudio } from '@/lib/store';
import { footprintForLayout } from '@/lib/footprint';
import { recarryForResize } from '@/lib/transforms';
import { WALL_GAP } from '@/lib/layout-rules';
import type { ScenePart } from '@/lib/scene-spec';

function part(over: Partial<ScenePart> & { id: string }): ScenePart {
  return { category: 'other', name: over.id, shape: 'box', pos: [0, 0, 0], rot: 0, dimMM: [1000, 600, 800], locked: false, ...over };
}

// 6 × 6: wall 0 is the North wall, z = -3. A deep table against it and a lamp on
// its far edge, out of the wall's own reach — only resting on the table brings it.
const table = part({ id: 'table', pos: [0, 0, -3 + WALL_GAP + 0.7], dimMM: [1200, 1400, 750] });
const lamp = part({ id: 'lamp', category: 'lamp', shape: 'lamp-table', pos: [0, 0.75, -3 + WALL_GAP + 1.3], dimMM: [200, 200, 400] });

function setRoom() {
  useScene.setState({
    room: { width: 6, depth: 6, height: 2.5, layoutId: 'rect', footprint: footprintForLayout('rect', 6, 6), wallColors: {} },
    parts: [table, lamp],
    ready: true,
  });
  useStudio.setState({ positions: {}, rotations: {}, dims: {}, parentIds: { lamp: 'table' } });
}

describe('the wall actions carry what rests on a carried piece', () => {
  it('a drag (attachments taken at pointer-down) brings the lamp', () => {
    setRoom();
    const ids = wallAttachments(0);
    expect(ids).toEqual(['table', 'lamp']);
    expect(moveWallCarrying(0, 0.5, ids)).toBeCloseTo(0.5, 9);
    expect(useStudio.getState().positions.lamp?.[2]).toBeCloseTo(lamp.pos[2] - 0.5, 9);
  });

  it('a one-shot nudge (attachment resolved fresh) brings it too', () => {
    setRoom();
    moveWallCarrying(0, 0.5);
    expect(useStudio.getState().positions.table?.[2]).toBeCloseTo(table.pos[2] - 0.5, 9);
    expect(useStudio.getState().positions.lamp?.[2]).toBeCloseTo(lamp.pos[2] - 0.5, 9);
  });

  it('a typed resize brings it', () => {
    const before = footprintForLayout('rect', 6, 6);
    const after = footprintForLayout('rect', 6, 7);
    const { authored } = recarryForResize([table, lamp], {}, before, after, { lamp: 'table' });
    expect(authored.map((a) => a.id)).toEqual(['table', 'lamp']);
  });
});

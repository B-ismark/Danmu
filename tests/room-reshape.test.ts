// Changing a room's shape on the way to its photos (`lib/room-reshape.ts`): what moves
// with the shape, what stays, and when the shape is someone's work and not offered.
import { describe, expect, it } from 'vitest';
import { canReshape, isPresetOutline, reshapeRoom } from '@/lib/room-reshape';
import { footprintForLayout } from '@/lib/footprint';
import { ROOM_PRESETS, PRESET_HEIGHT } from '@/lib/room-presets';
import type { RoomData } from '@/lib/storage';

const box = { layoutId: 'rect' as const, width: 6, depth: 4 };
const fresh = (over: Partial<RoomData> = {}): RoomData => ({
  id: 'r',
  createdAt: 1,
  name: 'Living room',
  layoutId: 'rect',
  width: 6,
  depth: 4,
  height: PRESET_HEIGHT,
  roughSize: true,
  ...over,
});

describe('canReshape', () => {
  it('offers the change on a room that is still the picker’s answer', () => {
    for (const p of ROOM_PRESETS) expect(canReshape({ ...box, layoutId: p.id }, false), p.id).toBe(true);
  });
  it('does not on a room with furniture arranged for its walls', () => {
    expect(canReshape(box, true)).toBe(false);
  });
  it('does not on a room whose walls were dragged', () => {
    // The east wall pushed out 0.5 m.
    expect(canReshape({ ...box, footprint: [[-3, -2], [3.5, -2], [3.5, 2], [-3, 2]] }, false)).toBe(false);
    // An empty polygon is no outline, so it is not someone's work.
    expect(canReshape({ ...box, footprint: [] }, false)).toBe(true);
  });
  it('does on a room the studio saved its own outline back into', () => {
    // RoomSync writes `footprint` on every shell save (paint, floor), so a stored
    // polygon equal to the preset's own is not a moved wall.
    for (const p of ROOM_PRESETS) {
      const own = footprintForLayout(p.id, 5.2, 4.1);
      const room = { layoutId: p.id, width: 5.2, depth: 4.1, footprint: own.map(([x, z]) => [x, z] as [number, number]) };
      expect(isPresetOutline(room), p.id).toBe(true);
      expect(canReshape(room, false), p.id).toBe(true);
    }
    // The preset's polygon at a DIFFERENT size is a moved wall.
    expect(isPresetOutline({ ...box, footprint: footprintForLayout('rect', 6, 4.5) })).toBe(false);
  });
  it('does not on a shape that is not a preset, or no shape at all', () => {
    expect(canReshape({ ...box, layoutId: 'custom' }, false)).toBe(false);
    expect(canReshape({ ...box, layoutId: undefined }, false)).toBe(false);
  });
});

describe('reshapeRoom', () => {
  it('takes the new shape, and its typical size while the size is still a guess', () => {
    const out = reshapeRoom(fresh(), 'l');
    const l = ROOM_PRESETS.find((p) => p.id === 'l')!;
    expect(out.layoutId).toBe('l');
    expect([out.width, out.depth, out.height]).toEqual([l.width, l.depth, PRESET_HEIGHT]);
    expect(out.roughSize).toBe(true);
  });

  it('keeps a size the person typed', () => {
    const out = reshapeRoom(fresh({ roughSize: undefined, width: 5.1, depth: 3.9, height: 2.5 }), 'u');
    expect([out.width, out.depth, out.height]).toEqual([5.1, 3.9, 2.5]);
    expect(out.roughSize).toBeUndefined();
  });

  it('renames a room still called after its old shape, and keeps a chosen name', () => {
    expect(reshapeRoom(fresh(), 't').name).toBe('Living + dining');
    expect(reshapeRoom(fresh({ name: 'Ama’s room' }), 't').name).toBe('Ama’s room');
  });

  it('clears what was measured or keyed on the old outline, and touches nothing else', () => {
    const scan = [{ id: 0, label: 'bed', conf: 0.9, locked: true, box: [0, 0, 1, 1] as [number, number, number, number] }];
    const before = fresh({
      wallColors: { 0: '#abcdef' },
      footprint: [[0, 0], [1, 0], [1, 1]],
      detectedObjects: scan,
      floor: { kind: 'planks' },
    });
    const out = reshapeRoom(before, 'open');
    expect(out.footprint).toBeUndefined();
    // Measured from the old walls, and keyed by the old edges.
    expect(out.detectedObjects).toBeUndefined();
    expect(out.wallColors).toBeUndefined();
    expect(out.floor).toEqual({ kind: 'planks' });
    expect(out.id).toBe('r');
    // Pure: the record handed in is not changed.
    expect(before.layoutId).toBe('rect');
    expect(before.footprint).toHaveLength(3);
    expect(before.detectedObjects).toHaveLength(1);
  });
});

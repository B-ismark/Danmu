// Changing a room's shape on the way to its photos (`lib/room-reshape.ts`): what moves
// with the shape, what stays, and when the shape is someone's work and not offered.
import { describe, expect, it } from 'vitest';
import { canReshape, reshapeRoom } from '@/lib/room-reshape';
import { ROOM_PRESETS, PRESET_HEIGHT } from '@/lib/room-presets';
import type { RoomData } from '@/lib/storage';

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
    for (const p of ROOM_PRESETS) expect(canReshape({ layoutId: p.id }, false), p.id).toBe(true);
  });
  it('does not on a room with furniture arranged for its walls', () => {
    expect(canReshape({ layoutId: 'rect' }, true)).toBe(false);
  });
  it('does not on a room whose walls were dragged', () => {
    expect(canReshape({ layoutId: 'rect', footprint: [[-3, -2], [3, -2], [3, 2], [-3, 2]] }, false)).toBe(false);
    // An empty polygon is no outline, so it is not someone's work.
    expect(canReshape({ layoutId: 'rect', footprint: [] }, false)).toBe(true);
  });
  it('does not on a shape that is not a preset, or no shape at all', () => {
    expect(canReshape({ layoutId: 'custom' }, false)).toBe(false);
    expect(canReshape({ layoutId: undefined }, false)).toBe(false);
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

  it('carries no footprint, and touches nothing else', () => {
    const before = fresh({ wallColors: { 0: '#abcdef' }, footprint: [[0, 0], [1, 0], [1, 1]] });
    const out = reshapeRoom(before, 'open');
    expect(out.footprint).toBeUndefined();
    expect(out.wallColors).toEqual({ 0: '#abcdef' });
    expect(out.id).toBe('r');
    // Pure: the record handed in is not changed.
    expect(before.layoutId).toBe('rect');
    expect(before.footprint).toHaveLength(3);
  });
});

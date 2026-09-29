// The empty Inspector's "This room" card. The number worth a test is the floor area,
// because the obvious spelling (`width × depth`) is the bounding box's, and an L, T
// or U is not its bounding box. The literals are the presets' own polygons at 5 × 4 m,
// pinned rather than recomputed here, so a change to either `roomFacts` or a preset's
// outline shows up as a number that moved.
import { describe, expect, it } from 'vitest';
import { roomFacts } from '@/lib/room-facts';
import { footprintForLayout, type LayoutId } from '@/lib/footprint';

// The live store always carries the polygon (`RoomShape.footprint` is required), so the
// fixture does too, built by the same function the store builds it with.
const room = (
  layoutId: LayoutId,
  extra: { footprint?: Array<[number, number]>; roughSize?: true; width?: number; depth?: number } = {},
) => ({
  width: extra.width ?? 5,
  depth: extra.depth ?? 4,
  layoutId,
  footprint: extra.footprint ?? footprintForLayout(layoutId, 5, 4),
  roughSize: extra.roughSize,
});

describe('roomFacts', () => {
  it('reports the floor the walls enclose, not the bounding box', () => {
    expect(roomFacts(room('rect'), 0).areaM2).toBeCloseTo(20, 9);
    expect(roomFacts(room('open'), 0).areaM2).toBeCloseTo(20, 9);
    // Each of these would read 20 m² off `width × depth`.
    expect(roomFacts(room('l'), 0).areaM2).toBeCloseTo(16.472, 9);
    expect(roomFacts(room('t'), 0).areaM2).toBeCloseTo(13.84, 9);
    expect(roomFacts(room('u'), 0).areaM2).toBeCloseTo(15.6, 9);
  });

  it("a drawn footprint wins over the preset's outline", () => {
    // A drawn L, 3 × 2 m overall, with its box saying 3 × 2 as the store's would. A box
    // that disagreed with its own outline was a room no screen can make, and it proved
    // only that the area is not `width × depth` of a DIFFERENT box. The rectangle this
    // box describes would read 6 m²; the L encloses 4.5.
    const drawn: Array<[number, number]> = [[-1.5, -1], [1.5, -1], [1.5, 0], [0, 0], [0, 1], [-1.5, 1]];
    expect(roomFacts(room('custom', { footprint: drawn, width: 3, depth: 2 }), 0).areaM2).toBeCloseTo(4.5, 9);
  });

  it('gives the overall size in millimetres for formatDim, and the piece count as handed', () => {
    const f = roomFacts(room('l'), 12);
    expect(f.widthMM).toBe(5000);
    expect(f.depthMM).toBe(4000);
    expect(f.pieces).toBe(12);
  });

  it('marks a room still at its typical size as rough, and only that room', () => {
    expect(roomFacts(room('rect', { roughSize: true }), 0).rough).toBe(true);
    expect(roomFacts(room('rect'), 0).rough).toBe(false);
  });
});

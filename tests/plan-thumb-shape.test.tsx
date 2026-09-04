// @vitest-environment jsdom
//
// The workspace card's floor plan drew a `<rect>` from `room.width` and `room.depth`
// and never read `layoutId` or `footprint` at all, so an L, a T and a U all came back
// looking like the same rectangular room. Reported by the user: *"Room previews should
// be room shape accurate, they all look like rectangular rooms atm."*
//
// Two things make the assertion below the honest one rather than "does it render":
//
//   · The polygon is counted, not compared to a string. `footprintForLayout('l', …)`
//     returns SIX vertices and a rectangle returns four, and that difference is the
//     whole defect. Pinning the exact coordinates would fail the day anyone tweaks a
//     preset's proportions, which is not this.
//   · A room with NO stored `footprint` is the case that matters. That field is only
//     written after a wall has been dragged, so a fix that read only `footprint` would
//     have looked right in a diff and changed nothing for almost every room. The L room
//     here has `footprint: undefined` on purpose, and the T room supplies one to cover
//     the override.
//
// What it does NOT prove: that the shape reads correctly at 240 × 150 with furniture
// on top of it, or that the card looks deliberate. `docs/visual-check.md` owns that.
import 'fake-indexeddb/auto';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { footprintForLayout } from '@/lib/footprint';
import type { RoomData } from '@/lib/storage';

vi.mock('next/navigation', async () => (await import('./helpers/mount')).navigationMock(null));

const { roomStore } = await import('@/lib/storage');
const { PlanThumb } = await import('@/components/studio/PlanThumb');

function room(id: string, layoutId: RoomData['layoutId'], w: number, d: number, footprint?: Array<[number, number]>): RoomData {
  return {
    id, createdAt: 1, name: `${layoutId} room`, layoutId,
    width: w, depth: d, height: 2.7,
    ...(footprint ? { footprint } : {}),
  } as RoomData;
}

/** The room outline the card drew, as its vertex count. `role="img"` is on the svg, so
 *  the polygon is reached through the DOM rather than a query — there is deliberately no
 *  test id on it, and adding one would be a hook that exists only for this file. */
async function outlineVertices(): Promise<number> {
  const svg = await waitFor(() => {
    const el = screen.getByRole('img');
    if (!el.querySelector('polygon')) throw new Error('no outline yet');
    return el;
  });
  const pts = svg.querySelector('polygon')!.getAttribute('points') ?? '';
  return pts.trim().split(/\s+/).filter(Boolean).length;
}

beforeEach(() => cleanup());

describe('the workspace card draws the room it has, not a rectangle', () => {
  it('gives an L room its six corners, from layoutId alone', async () => {
    // No `footprint` field: this is the ordinary case, a preset room nobody has
    // dragged a wall in, and it is the case the old code could never get right.
    await roomStore.saveRoom(room('l-room', 'l', 6, 4));
    render(<PlanThumb roomId="l-room" />);
    expect(await outlineVertices()).toBe(footprintForLayout('l', 6, 4).length);
    expect(await outlineVertices()).toBe(6);
  });

  it('honours a stored footprint over the shape its layoutId implies', async () => {
    // The override path. `footprint` is what wall moves write, and it wins.
    //
    // The stored polygon has to DIFFER from the layout-derived one or this proves
    // nothing. The first version of this test stored exactly
    // `footprintForLayout('t', …)` on a room whose `layoutId` was already `'t'`, so
    // honouring the override and ignoring it produced the same eight vertices — a
    // mutation that deleted the override outright survived, which is how it was found.
    // Five vertices against a T's eight cannot be confused for each other.
    const five: Array<[number, number]> = [[-2, -2], [2, -2], [2, 1], [0, 2], [-2, 2]];
    expect(five.length).not.toBe(footprintForLayout('t', 5.5, 4.7).length);
    await roomStore.saveRoom(room('t-room', 't', 5.5, 4.7, five));
    render(<PlanThumb roomId="t-room" />);
    expect(await outlineVertices()).toBe(5);
  });

  it('still draws a plain rectangle with four corners', async () => {
    // The negative control. Without it every assertion above passes for a component
    // that draws some fixed non-rectangular shape for every room there is.
    await roomStore.saveRoom(room('rect-room', 'rect', 6, 4));
    render(<PlanThumb roomId="rect-room" />);
    expect(await outlineVertices()).toBe(4);
  });

  it('says the shape out loud for a screen reader, and only when there is one to say', async () => {
    await roomStore.saveRoom(room('u-room', 'u', 6, 5));
    render(<PlanThumb roomId="u-room" />);
    await waitFor(() => expect(screen.getByRole('img').getAttribute('aria-label')).toMatch(/U-shaped/));
    // …and a rectangle does not get a word for being one, because the two numbers
    // already say it. 'open' is a rectangle in `footprintForLayout` and is treated the
    // same way for the same reason.
    cleanup();
    await roomStore.saveRoom(room('rect-room-2', 'rect', 6, 4));
    render(<PlanThumb roomId="rect-room-2" />);
    await waitFor(() => {
      const label = screen.getByRole('img').getAttribute('aria-label') ?? '';
      expect(label).toMatch(/6\.0 by 4\.0 metres/);
      expect(label).not.toMatch(/shaped|custom shape/);
    });
  });

  it('fits an off-centre footprint without pushing it out of the picture', async () => {
    // A wall dragged outward leaves a polygon whose bounds are not ±W/2, and the old
    // code's origin was exactly that. Every vertex must land inside the 240 × 150
    // viewBox; the old arithmetic would put this room's right-hand wall past the edge.
    //
    // Off-centre on BOTH axes. The first version shifted x only and left z symmetric
    // at ±2, so the z mapping was never asked an asymmetric question — a mutation that
    // reverted it to `z + D / 2` survived. An origin, like a sign, is invisible in the
    // symmetric case; that is this repo's own rule and this file had broken it.
    const shifted: Array<[number, number]> = [[-1, 1], [7, 1], [7, 6], [-1, 6]];
    await roomStore.saveRoom(room('shifted-room', 'custom', 8, 5, shifted));
    render(<PlanThumb roomId="shifted-room" />);
    const svg = await waitFor(() => {
      const el = screen.getByRole('img');
      if (!el.querySelector('polygon')) throw new Error('no outline yet');
      return el;
    });
    const pts = (svg.querySelector('polygon')!.getAttribute('points') ?? '')
      .trim().split(/\s+/).map((pair) => pair.split(',').map(Number));
    expect(pts).toHaveLength(4);
    for (const [x, y] of pts) {
      expect(x, `x=${x} outside the 240-wide viewBox`).toBeGreaterThanOrEqual(0);
      expect(x, `x=${x} outside the 240-wide viewBox`).toBeLessThanOrEqual(240);
      expect(y, `y=${y} outside the 150-tall viewBox`).toBeGreaterThanOrEqual(0);
      expect(y, `y=${y} outside the 150-tall viewBox`).toBeLessThanOrEqual(150);
    }
  });
});

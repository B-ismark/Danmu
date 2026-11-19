// A person shapes the room beyond the presets: split a wall, drag one half, and
// the room grows a square step; drag a wall past where its neighbour runs out,
// and the neighbour comes out the other side.
//
// Every outline here is checked against rules written out in this file —
// squareness by the edge directions, area by the shoelace sum — never by asking
// `lib/footprint.ts` to grade its own answer.

import { describe, expect, it } from 'vitest';
import {
  footprintForLayout,
  joinWalls,
  offsetWall,
  prepareWallMove,
  remapWallRecord,
  splitWall,
  tidyFootprint,
  wallsInLine,
  wallTravel,
  type Footprint,
} from '@/lib/footprint';
import { roomBays } from '@/lib/room-bays';

function area(poly: Footprint): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, z1] = poly[i];
    const [x2, z2] = poly[(i + 1) % poly.length];
    s += x1 * z2 - x2 * z1;
  }
  return Math.abs(s / 2);
}

/** Every wall runs along x or along z — nothing slanted. */
function square(poly: Footprint): boolean {
  return poly.every((a, i) => {
    const b = poly[(i + 1) % poly.length];
    return Math.abs(b[0] - a[0]) < 1e-9 || Math.abs(b[1] - a[1]) < 1e-9;
  });
}

/** The move a drag makes: prepare, then offset the wall where it now is. */
function drag(poly: Footprint, index: number, delta: number): { poly: Footprint; index: number } {
  const prep = prepareWallMove(poly, index);
  const at = prep.map[index];
  return { poly: offsetWall(prep.footprint, at, delta), index: at };
}

const RECT = footprintForLayout('rect', 6, 4);

describe('splitting a wall', () => {
  it('cuts it in two at the point asked, leaving the room the same shape', () => {
    const r = splitWall(RECT, 0, 0.25)!;
    expect(r.footprint).toHaveLength(5);
    expect(area(r.footprint)).toBeCloseTo(area(RECT), 9);
    const a = RECT[0];
    const b = RECT[1];
    expect(r.footprint[1][0]).toBeCloseTo(a[0] + (b[0] - a[0]) * 0.25, 9);
    expect(r.footprint[1][1]).toBeCloseTo(a[1] + (b[1] - a[1]) * 0.25, 9);
    expect(wallsInLine(r.footprint, 0, 1)).toBe(true);
    // Old wall 0 is new wall 0; the walls after it move up one; the new half was
    // made from wall 0.
    expect(r.map).toEqual([0, 2, 3, 4]);
    expect(r.from).toEqual([0, 0, 1, 2, 3]);
  });

  it('refuses a cut at or beyond an end', () => {
    expect(splitWall(RECT, 0, 0)).toBeNull();
    expect(splitWall(RECT, 0, 1)).toBeNull();
    expect(splitWall(RECT, 0, 1e-9)).toBeNull();
    expect(splitWall(RECT, 9, 0.5)).toBeNull();
  });

  it('carries a painted wall into both halves', () => {
    const r = splitWall(RECT, 2, 0.5)!;
    expect(remapWallRecord({ 2: '#abc', 3: '#def' }, r)).toEqual({ 2: '#abc', 3: '#abc', 4: '#def' });
  });
});

describe('dragging half a wall grows a step, never a slant', () => {
  it('pushes one half out and the other half stays where it was', () => {
    // The screenshot: drag one half of a split wall and its neighbour slanted.
    const split = splitWall(RECT, 0, 0.5)!.footprint;
    for (const delta of [0.8, -0.8]) {
      for (const half of [0, 1]) {
        const { poly, index } = drag(split, half, delta);
        expect(square(poly), `half ${half} by ${delta}`).toBe(true);
        expect(poly).toHaveLength(6);
        expect(area(poly)).toBeCloseTo(area(RECT) + delta * 3, 9);
        // The other half did not move.
        const other = split[half === 0 ? 1 : 0];
        expect(poly.some((p) => Math.abs(p[0] - other[0]) < 1e-9 && Math.abs(p[1] - other[1]) < 1e-9)).toBe(true);
        expect(wallTravel(prepareWallMove(split, half).footprint, index, delta)).toEqual({ travel: delta, fault: null });
      }
    }
  });

  it('grows steps at both ends of a middle third', () => {
    const thirds = splitWall(splitWall(RECT, 0, 1 / 3)!.footprint, 1, 0.5)!.footprint;
    const { poly } = drag(thirds, 1, 1);
    expect(poly).toHaveLength(8);
    expect(square(poly)).toBe(true);
    expect(area(poly)).toBeCloseTo(area(RECT) + 2, 9);
  });

  it('works on the last wall, where the corner it doubles is corner 0', () => {
    const n = RECT.length;
    const split = splitWall(RECT, n - 1, 0.5)!.footprint;
    const last = split.length - 1;
    const prep = prepareWallMove(split, last);
    // The wall's end is corner 0, so doubling it moves every wall up one.
    expect(prep.map[last]).toBe(last + 1);
    const { poly } = drag(split, last, 0.5);
    expect(square(poly)).toBe(true);
    expect(area(poly)).toBeCloseTo(area(RECT) + 0.5 * 2, 9);
  });

  it('does nothing to a wall whose neighbours turn a corner', () => {
    const prep = prepareWallMove(RECT, 1);
    expect(prep.footprint).toBe(RECT);
    expect(prep.map).toEqual([0, 1, 2, 3]);
  });
});

describe('a wall can go past where its neighbour runs out', () => {
  it("drags an L's inner wall through the corner and out the other side", () => {
    const l = footprintForLayout('l', 6, 5);
    // Find the wall whose push-in shortens a neighbour to nothing: an inner wall.
    let found = false;
    for (let i = 0; i < l.length && !found; i++) {
      for (const delta of [-1, 1]) {
        const lenAfter = (p: Footprint, k: number) => Math.hypot(p[(k + 1) % p.length][0] - p[k][0], p[(k + 1) % p.length][1] - p[k][1]);
        const n = l.length;
        const before = lenAfter(l, (i + 1) % n);
        // Travel the whole neighbour and a metre more.
        const full = before + 1;
        const moved = offsetWall(l, i, delta * full);
        if (Math.abs(lenAfter(moved, (i + 1) % n) - 1) > 1e-9) continue;
        const t = wallTravel(l, i, delta * full);
        if (t.fault !== null) continue;
        // The neighbour went through zero and came out a metre the other way —
        // the old rule stopped it at 60 cm long. Still square, still a room.
        expect(square(moved)).toBe(true);
        expect(area(moved)).toBeGreaterThan(0);
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
  });

  it('still stops a wall 60 cm short of the wall it faces', () => {
    // A rectangle's east wall pushed in toward the west wall: they face each
    // other the whole way, so the gap binds.
    const t = wallTravel(RECT, 1, -10);
    expect(t.fault).toBe('close');
  });
});

describe('tidying', () => {
  it('takes out a step dragged back to nothing and keeps the split', () => {
    const split = splitWall(RECT, 0, 0.5)!.footprint;
    const out = drag(split, 1, 0.7);
    const back = offsetWall(out.poly, out.index, -0.7);
    const t = tidyFootprint(back);
    expect(t.footprint).toHaveLength(5);
    expect(area(t.footprint)).toBeCloseTo(area(RECT), 9);
    expect(square(t.footprint)).toBe(true);
    // Only the zero-length step went.
    expect(t.map.filter((m) => m < 0)).toHaveLength(1);
  });

  it('leaves a room with no zero-length walls as the very same object', () => {
    expect(tidyFootprint(RECT).footprint).toBe(RECT);
  });

  it('joins two halves back into one wall', () => {
    const split = splitWall(RECT, 1, 0.4)!;
    const j = joinWalls(split.footprint, 1)!;
    expect(j.footprint).toEqual(RECT);
    expect(remapWallRecord(remapWallRecord({ 1: '#123' }, split), j)).toEqual({ 1: '#123' });
    expect(joinWalls(RECT, 0)).toBeNull();
  });

  it('the joined wall keeps its own paint, wherever the seam falls', () => {
    // Halves painted differently, then "Join with the next wall" from the first:
    // the result wears the first half's colour, mid-outline and across corner 0.
    const mid = splitWall(RECT, 1, 0.5)!.footprint;
    expect(remapWallRecord({ 1: '#first', 2: '#second' }, joinWalls(mid, 1)!)).toEqual({ 1: '#first' });
    const n = RECT.length;
    const cut = splitWall(RECT, n - 1, 0.5)!.footprint;
    const wrap: Footprint = [cut[n], ...cut.slice(0, n)];
    expect(remapWallRecord({ [n]: '#first', 0: '#second' }, joinWalls(wrap, n)!)).toEqual({ [n - 1]: '#first' });
  });

  it('joins across corner 0', () => {
    // Rotate a split outline so the cut IS corner 0: the two halves are then the
    // last wall and wall 0.
    const n = RECT.length;
    const cut = splitWall(RECT, n - 1, 0.5)!.footprint;
    const split: Footprint = [cut[n], ...cut.slice(0, n)];
    expect(wallsInLine(split, n, 0)).toBe(true);
    const j = joinWalls(split, n)!;
    expect(remapWallRecord({ [n]: '#a', 0: '#a', 1: '#b' }, j)).toEqual({ [n - 1]: '#a', 0: '#b' });
    expect(j.footprint).toHaveLength(4);
    expect(area(j.footprint)).toBeCloseTo(area(RECT), 9);
  });
});

describe('a reshaped room is still a room to the arranging code', () => {
  it('a split that changes nothing gives the same bays as the plain room', () => {
    const split = splitWall(splitWall(RECT, 0, 0.3)!.footprint, 3, 0.6)!.footprint;
    expect(roomBays(split)).toEqual(roomBays(RECT));
  });

  it('an L dragged square has the same bays as the rectangle it became', () => {
    // The L's inner corner pulled out until it is a rectangle with two extra
    // corners standing in a straight line.
    const l: Footprint = [[-3, -2.5], [3, -2.5], [3, 0], [0, 0], [0, 2.5], [-3, 2.5]];
    const moved = offsetWall(l, 2, 2.5); // the inner wall out to the south wall line
    const rect: Footprint = [[-3, -2.5], [3, -2.5], [3, 2.5], [-3, 2.5]];
    expect(area(moved)).toBeCloseTo(area(rect), 9);
    expect(roomBays(tidyFootprint(moved).footprint)).toEqual(roomBays(rect));
  });
});

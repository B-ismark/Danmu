import { describe, it, expect } from 'vitest';
import { snapToWall } from '@/lib/physics';
import type { Footprint } from '@/lib/footprint';

const RECT: Footprint = [
  [-3, -2],
  [3, -2],
  [3, 2],
  [-3, 2],
];

// L-room: notch cut out of the x>1, z>0 quadrant.
const L: Footprint = [
  [-3, -2],
  [3, -2],
  [3, 0],
  [1, 0],
  [1, 2],
  [-3, 2],
];

const TV: [number, number, number] = [1450, 60, 820];

describe('snapToWall (footprint-edge exact)', () => {
  it('snaps to the nearest rectangular wall, facing the room', () => {
    const s = snapToWall([0.4, 1.3, -1.5], TV, RECT);
    expect(s.z).toBeCloseTo(-2 + 0.03 + 0.02, 2); // wall + depth/2 + gap
    expect(s.x).toBeCloseTo(0.4);
    expect(s.rot).toBeCloseTo(0); // facing +Z into the room
  });

  it('snaps to an INNER wall of an L room (the old rect version pushed through it)', () => {
    // Item in the wing near the inner x=1 edge.
    const s = snapToWall([0.7, 0, 1.0], TV, L);
    expect(s.x).toBeCloseTo(1 - 0.05, 2); // flush on the inside of the inner wall
    expect(s.z).toBeCloseTo(1.0);
    expect(s.rot).toBeCloseTo(-Math.PI / 2, 1); // facing -X into the wing
  });

  it('keeps the part inset by half its depth', () => {
    const deep: [number, number, number] = [600, 650, 1700]; // fridge
    const s = snapToWall([-2.5, 0, 0], deep, RECT);
    expect(s.x).toBeCloseTo(-3 + 0.325 + 0.02, 2);
  });
});

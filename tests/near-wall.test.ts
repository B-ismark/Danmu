import { describe, expect, it } from 'vitest';
import { cutAwayHides, cutAwayWithWall } from '@/lib/near-wall';

// A 6 × 4 room centred on the origin. A window on the SOUTH wall (z = +2) faces
// north into the room, which is rot = π (front = (sin π, cos π) = (0, −1)).
const SOUTH_WINDOW: [number, number, number] = [0.5, 1.4, 2 - 0.05];
const FACING_NORTH = Math.PI;
const DEPTH = 0.1;

describe('cutAwayWithWall', () => {
  it('goes when the camera is outside its wall — the dollhouse view from the south', () => {
    expect(cutAwayWithWall([0, 6, 8], SOUTH_WINDOW, FACING_NORTH, DEPTH)).toBe(true);
  });

  it('stays when the camera is inside the room looking at it', () => {
    expect(cutAwayWithWall([0, 1.6, 0], SOUTH_WINDOW, FACING_NORTH, DEPTH)).toBe(false);
  });

  it('stays when the camera is outside a DIFFERENT wall', () => {
    // From the north the south wall is the far wall, and it is drawn.
    expect(cutAwayWithWall([0, 6, -8], SOUTH_WINDOW, FACING_NORTH, DEPTH)).toBe(false);
    // From the east, likewise — the east wall goes, this one stays.
    expect(cutAwayWithWall([9, 6, 0], SOUTH_WINDOW, FACING_NORTH, DEPTH)).toBe(false);
  });

  it('measures from the piece BACK, which is where the wall is', () => {
    // A camera between the plaster (z = 2.0) and the piece's centre (z = 1.95) is
    // outside the piece's centre plane but still inside the room.
    expect(cutAwayWithWall([0, 1.6, 1.99], SOUTH_WINDOW, FACING_NORTH, DEPTH)).toBe(false);
    expect(cutAwayWithWall([0, 1.6, 2.01], SOUTH_WINDOW, FACING_NORTH, DEPTH)).toBe(true);
  });

  it('follows the rotation convention on the side walls, where a sign error hides', () => {
    // East wall (x = +3), facing west into the room: front = (−1, 0), rot = −π/2.
    const east: [number, number, number] = [3 - 0.05, 1.4, 0];
    expect(cutAwayWithWall([9, 6, 0], east, -Math.PI / 2, DEPTH)).toBe(true);
    expect(cutAwayWithWall([-9, 6, 0], east, -Math.PI / 2, DEPTH)).toBe(false);
  });
});

// The user, 2026-09-30: keep a selected piece visible on the cut-away wall — "but
// obviously, you shouldn't be able to select it if you hadn't selected it and now
// it's not visible". So held changes the answer only where the wall has gone.
describe('cutAwayHides', () => {
  const OUTSIDE: [number, number, number] = [0, 6, 8];
  const INSIDE: [number, number, number] = [0, 1.6, 0];

  it('keeps a held piece in view on the wall the camera looks through', () => {
    expect(cutAwayHides(OUTSIDE, SOUTH_WINDOW, FACING_NORTH, DEPTH, true)).toBe(false);
  });

  it('still hides a piece nobody is holding, so it cannot be picked from behind its wall', () => {
    expect(cutAwayHides(OUTSIDE, SOUTH_WINDOW, FACING_NORTH, DEPTH, false)).toBe(true);
  });

  it('changes nothing where the wall is drawn', () => {
    for (const held of [true, false]) {
      expect(cutAwayHides(INSIDE, SOUTH_WINDOW, FACING_NORTH, DEPTH, held)).toBe(false);
    }
  });
});

// The component asks the held question, not the bare wall one — otherwise the rule
// above holds in a function nobody calls.
describe('CutAway', () => {
  it('asks cutAwayHides and is handed the selection', async () => {
    const { readFileSync } = await import('node:fs');
    const cut = readFileSync('components/three/CutAway.tsx', 'utf8');
    expect(cut).toContain('cutAwayHides(');
    expect(cut).not.toMatch(/cutAwayWithWall\(/);
    const drag = readFileSync('components/three/Draggable.tsx', 'utf8');
    expect(drag).toMatch(/<CutAway[\s\S]*?held=\{inSelection \|\| isDraggingThis\}/);
  });
});

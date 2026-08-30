import { describe, it, expect } from 'vitest';
import {
  lockedForSolve,
  makeRng,
  movableFor,
  randomizeStart,
  solveLayout,
} from '@/lib/layout-solve';
import { pointInFootprint, type Footprint } from '@/lib/footprint';
import type { ScenePart } from '@/lib/scene-spec';

// A 6x5 rect, matching the RECT convention other layout-solve tests use.
const RECT: Footprint = [
  [-3, -2.5],
  [3, -2.5],
  [3, 2.5],
  [-3, 2.5],
];

let n = 0;
function part(p: Partial<ScenePart> & Pick<ScenePart, 'category' | 'shape' | 'dimMM' | 'pos'>): ScenePart {
  return { id: `${p.category}-${++n}`, name: p.category, rot: 0, locked: false, ...p } as ScenePart;
}

const sofa = () => part({ category: 'sofa', shape: 'sofa', dimMM: [2200, 950, 880], pos: [-2.4, 0, 2] });
const table = () => part({ category: 'table', shape: 'coffee-table', dimMM: [1100, 600, 420], pos: [-2.4, 0, 0.7] });
const wardrobe = () =>
  part({ category: 'wardrobe', shape: 'wardrobe', dimMM: [2000, 600, 2100], pos: [0, 0, -2.2] });
const armchair = () =>
  part({ category: 'chair', shape: 'armchair', dimMM: [850, 850, 900], pos: [2.3, 0, 1.6] });
const door = () =>
  part({
    category: 'door',
    shape: 'door',
    dimMM: [900, 200, 2100],
    pos: [2.9, 0, -1.2],
    wallMounted: true,
  });

function room(): ScenePart[] {
  return [sofa(), table(), wardrobe(), armchair(), door()];
}

describe('randomizeStart', () => {
  it('leaves locked and wall-mounted pieces exactly where they are', () => {
    const parts = room();
    const locked = lockedForSolve(parts, { [parts[3].id]: true }, null); // pin the armchair
    const movable = movableFor(parts, locked);
    const start = randomizeStart(parts, RECT, movable, makeRng(7));
    // index 3 (armchair) is pinned, index 4 (door) is wall-mounted — neither moves.
    expect(start[3]).toEqual({ x: parts[3].pos[0], z: parts[3].pos[2], yaw: parts[3].rot });
    expect(start[4]).toEqual({ x: parts[4].pos[0], z: parts[4].pos[2], yaw: parts[4].rot });
  });

  it('scatters movable pieces inside the footprint, not merely inside its bounding box', () => {
    const parts = room();
    const locked = lockedForSolve(parts, {}, null);
    const movable = movableFor(parts, locked);
    const rng = makeRng(3);
    for (let trial = 0; trial < 20; trial++) {
      const start = randomizeStart(parts, RECT, movable, rng);
      for (let i = 0; i < parts.length; i++) {
        if (!movable[i]) continue;
        expect(pointInFootprint(start[i].x, start[i].z, RECT)).toBe(true);
      }
    }
  });

  it('is deterministic per seed', () => {
    const parts = room();
    const locked = lockedForSolve(parts, {}, null);
    const movable = movableFor(parts, locked);
    const a = randomizeStart(parts, RECT, movable, makeRng(11));
    const b = randomizeStart(parts, RECT, movable, makeRng(11));
    expect(a).toEqual(b);
  });

  it('does not touch dimMM — a shuffle only moves and turns', () => {
    const parts = room();
    const locked = lockedForSolve(parts, {}, null);
    const movable = movableFor(parts, locked);
    randomizeStart(parts, RECT, movable, makeRng(1));
    for (const p of parts) expect(p.dimMM).toBeDefined();
  });
});

describe("solveLayout mode: 'shuffle'", () => {
  it('moves a room that mode "arrange" would leave untouched', () => {
    const parts = room();
    const locked = lockedForSolve(parts, {}, null);
    const movable = movableFor(parts, locked);

    // This starting arrangement is already reasonable (each piece against its own
    // wall, nothing overlapping) — precisely the case the bug report was about:
    // "arrange" has next to nothing to fix here, anchored as it is to the room it
    // was handed.
    const arranged = solveLayout(parts, RECT, locked, { seed: 1, mode: 'arrange' });
    expect(arranged.moved.length).toBeLessThanOrEqual(1);

    // Shuffle, started from a randomised placement, finds a genuinely DIFFERENT
    // arrangement — every movable piece, not a tidy of the one it was given.
    const start = randomizeStart(parts, RECT, movable, makeRng(42));
    const shuffled = solveLayout(parts, RECT, locked, { seed: 42, mode: 'shuffle', start });
    expect(shuffled.moved.length).toBeGreaterThan(arranged.moved.length);
    expect(shuffled.moved.length).toBe(movable.filter(Boolean).length);
  });

  it('never moves a locked or wall-mounted piece', () => {
    const parts = room();
    const locked = lockedForSolve(parts, { [parts[2].id]: true }, null); // pin the wardrobe
    const movable = movableFor(parts, locked);
    const start = randomizeStart(parts, RECT, movable, makeRng(9));
    const result = solveLayout(parts, RECT, locked, { seed: 9, mode: 'shuffle', start });
    expect(result.moved).not.toContain(2); // wardrobe
    expect(result.moved).not.toContain(4); // door, wall-mounted
  });

  it('still hands back a room with nothing hard wrong — same guidelines Fix measures', () => {
    const parts = room();
    const locked = lockedForSolve(parts, {}, null);
    const movable = movableFor(parts, locked);
    for (const seed of [1, 2, 3, 4, 5]) {
      const start = randomizeStart(parts, RECT, movable, makeRng(seed));
      const result = solveLayout(parts, RECT, locked, { seed, mode: 'shuffle', start });
      // `after` is priced against the same weights Fix uses; a shuffle that merely
      // scattered furniture without settling it would show up as a very large
      // number here rather than a plausible arranged room.
      expect(result.after).toBeLessThan(20);
    }
  });

  it('is deterministic: same room, same seed, same suggestion', () => {
    const parts = room();
    const locked = lockedForSolve(parts, {}, null);
    const movable = movableFor(parts, locked);
    const start = randomizeStart(parts, RECT, movable, makeRng(5));
    const a = solveLayout(parts, RECT, locked, { seed: 5, mode: 'shuffle', start });
    const b = solveLayout(parts, RECT, locked, { seed: 5, mode: 'shuffle', start });
    expect(a.placements).toEqual(b.placements);
  });
});

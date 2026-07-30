import { describe, it, expect } from 'vitest';
import { scoreLayout, DEFAULT_WEIGHTS, type LayoutContext, type Placement } from '@/lib/layout-score';
import { solveLayout } from '@/lib/layout-solve';
import type { ScenePart } from '@/lib/scene-spec';
import type { Footprint } from '@/lib/footprint';

const RECT: Footprint = [
  [-3, -2],
  [3, -2],
  [3, 2],
  [-3, 2],
];

let n = 0;
function part(p: Partial<ScenePart> & Pick<ScenePart, 'category' | 'shape' | 'dimMM' | 'pos'>): ScenePart {
  return { id: `${p.category}-${++n}`, name: p.category, rot: 0, locked: false, ...p } as ScenePart;
}

const at = (parts: ScenePart[]): Placement[] =>
  parts.map((p) => ({ x: p.pos[0], z: p.pos[2], yaw: p.rot }));

function ctxOf(parts: ScenePart[], locked: boolean[] = []): LayoutContext {
  return { parts, movable: parts.map((_, i) => !locked[i]), footprint: RECT };
}

const sofa = () => part({ category: 'sofa', shape: 'sofa', dimMM: [2200, 950, 880], pos: [0, 0, 0] });
const table = () => part({ category: 'table', shape: 'coffee-table', dimMM: [1100, 600, 420], pos: [0, 0, 0] });
const wardrobe = () => part({ category: 'wardrobe', shape: 'wardrobe', dimMM: [2000, 600, 2100], pos: [0, 0, 0] });

describe('scoreLayout', () => {
  it('costs two pieces in the same place more than anything else', () => {
    const parts = [sofa(), wardrobe()];
    const ctx = ctxOf(parts);
    const apart = scoreLayout(ctx, [
      { x: -2, z: 1.4, yaw: 0 },
      { x: 2, z: -1.6, yaw: 0 },
    ]);
    const same = scoreLayout(ctx, [
      { x: 0, z: 0, yaw: 0 },
      { x: 0, z: 0, yaw: 0 },
    ]);
    expect(same).toBeGreaterThan(apart * 10);
  });

  it('costs a piece hanging out of the room', () => {
    const parts = [sofa()];
    const ctx = ctxOf(parts);
    const inside = scoreLayout(ctx, [{ x: 0, z: 1.4, yaw: 0 }]);
    const half = scoreLayout(ctx, [{ x: 3, z: 1.4, yaw: 0 }]);
    expect(half).toBeGreaterThan(inside + DEFAULT_WEIGHTS.outside * 0.3);
  });

  it('prefers a wardrobe against a wall, facing into the room', () => {
    const parts = [wardrobe()];
    const ctx = ctxOf(parts);
    // North wall is at z = −2 and its inward normal points to +z, so yaw 0 faces
    // in. Compare against the same spot turned to face the plaster.
    const facingIn = scoreLayout(ctx, [{ x: 0, z: -1.7, yaw: 0 }]);
    const facingWall = scoreLayout(ctx, [{ x: 0, z: -1.7, yaw: Math.PI }]);
    const marooned = scoreLayout(ctx, [{ x: 0, z: 0, yaw: 0 }]);
    expect(facingIn).toBeLessThan(facingWall);
    expect(facingIn).toBeLessThan(marooned);
  });

  it('prefers a table nearer the middle than jammed against a wall', () => {
    const parts = [table()];
    const ctx = ctxOf(parts);
    expect(scoreLayout(ctx, [{ x: 0, z: 0, yaw: 0 }])).toBeLessThan(
      scoreLayout(ctx, [{ x: 0, z: -1.6, yaw: 0 }]),
    );
  });

  it('does not fine a chair for being tucked under a table', () => {
    const t = table();
    const chair = part({ category: 'chair', shape: 'chair-dining', dimMM: [450, 450, 850], pos: [0, 0, 0] });
    const ctx = ctxOf([t, chair]);
    const tucked = scoreLayout(ctx, [
      { x: 0, z: 0, yaw: 0 },
      { x: 0, z: 0.35, yaw: Math.PI },
    ]);
    // Which it certainly would be if the overlap term applied: the same overlap
    // between two pieces that do NOT tuck is orders of magnitude dearer.
    const w = wardrobe();
    const clash = scoreLayout(ctxOf([t, w]), [
      { x: 0, z: 0, yaw: 0 },
      { x: 0, z: 0.35, yaw: Math.PI },
    ]);
    expect(clash).toBeGreaterThan(tucked * 5);
  });

  it('costs a gap you cannot walk through, and not a flush one', () => {
    const a = sofa();
    const b = wardrobe();
    const ctx = ctxOf([a, b]);
    // Wardrobe back at z −2, front at −1.4. Sofa at z −1.1 is flush; at −0.9 it
    // leaves 20 cm, which is the pinch.
    const flush = scoreLayout(ctx, [
      { x: 0, z: -0.925, yaw: 0 },
      { x: 0, z: -1.7, yaw: 0 },
    ]);
    const pinched = scoreLayout(ctx, [
      { x: 0, z: -0.7, yaw: 0 },
      { x: 0, z: -1.7, yaw: 0 },
    ]);
    expect(pinched).toBeGreaterThan(flush);
  });

  it('wants seating to face the television, at a sensible distance', () => {
    const tv = part({ category: 'tv', shape: 'tv', dimMM: [1450, 60, 820], pos: [0, 1.3, -1.95], wallMounted: true });
    const s = sofa();
    const ctx = ctxOf([tv, s]);
    const facing = scoreLayout(ctx, [
      { x: 0, z: -1.95, yaw: 0 },
      { x: 0, z: 1.2, yaw: Math.PI },
    ]);
    const backTurned = scoreLayout(ctx, [
      { x: 0, z: -1.95, yaw: 0 },
      { x: 0, z: 1.2, yaw: 0 },
    ]);
    expect(facing).toBeLessThan(backTurned);
  });
});

describe('solveLayout', () => {
  /** A deliberately bad room: everything piled in one corner. */
  function messyRoom() {
    return [
      part({ category: 'sofa', shape: 'sofa', dimMM: [2200, 950, 880], pos: [-1.8, 0, -1.3], rot: 0.4 }),
      part({ category: 'wardrobe', shape: 'wardrobe', dimMM: [2000, 600, 2100], pos: [-1.4, 0, -1.0], rot: 1.1 }),
      part({ category: 'table', shape: 'coffee-table', dimMM: [1100, 600, 420], pos: [-1.6, 0, -1.5], rot: 0.2 }),
      part({ category: 'shelf', shape: 'bookshelf', dimMM: [900, 350, 1800], pos: [-1.2, 0, -1.6], rot: 0.9 }),
    ];
  }

  it('improves the arrangement it was given', () => {
    const parts = messyRoom();
    const r = solveLayout(parts, RECT, parts.map(() => false), { seed: 3, steps: 2500 });
    expect(r.after).toBeLessThan(r.before);
    // A pile of four pieces in one corner is nearly all overlap cost, so the
    // improvement should be dramatic rather than marginal.
    expect(r.after).toBeLessThan(r.before * 0.5);
    expect(r.moved.length).toBeGreaterThan(0);
  });

  it('is deterministic', () => {
    const a = solveLayout(messyRoom(), RECT, [false, false, false, false], { seed: 11, steps: 1200 });
    const b = solveLayout(messyRoom(), RECT, [false, false, false, false], { seed: 11, steps: 1200 });
    expect(b.placements).toEqual(a.placements);
    expect(b.after).toBe(a.after);
  });

  it('gives a different arrangement for a different seed', () => {
    const a = solveLayout(messyRoom(), RECT, [false, false, false, false], { seed: 1, steps: 1200 });
    const b = solveLayout(messyRoom(), RECT, [false, false, false, false], { seed: 2, steps: 1200 });
    expect(b.placements).not.toEqual(a.placements);
  });

  it('never touches a locked piece', () => {
    const parts = messyRoom();
    const locked = [true, false, false, false];
    const r = solveLayout(parts, RECT, locked, { seed: 5, steps: 1200 });
    expect(r.placements[0]).toEqual({ x: parts[0].pos[0], z: parts[0].pos[2], yaw: parts[0].rot });
    expect(r.moved).not.toContain(0);
  });

  it('never touches a wall-mounted piece', () => {
    const parts = [
      part({ category: 'tv', shape: 'tv', dimMM: [1450, 60, 820], pos: [0, 1.3, -1.95], wallMounted: true }),
      ...messyRoom(),
    ];
    const r = solveLayout(parts, RECT, parts.map(() => false), { seed: 7, steps: 1200 });
    expect(r.placements[0]).toEqual({ x: 0, z: -1.95, yaw: 0 });
  });

  it('never changes a dimension', () => {
    // The invariant that keeps this inside the trust boundary. The result carries
    // positions and yaws and has no field a size could travel in — this asserts
    // the input objects are not mutated either.
    const parts = messyRoom();
    const before = parts.map((p) => [...p.dimMM]);
    solveLayout(parts, RECT, parts.map(() => false), { seed: 9, steps: 800 });
    expect(parts.map((p) => [...p.dimMM])).toEqual(before);
  });

  it('leaves a room with nothing movable alone', () => {
    const parts = messyRoom();
    const r = solveLayout(parts, RECT, parts.map(() => true), { seed: 4, steps: 800 });
    expect(r.moved).toEqual([]);
    expect(r.after).toBe(r.before);
    expect(r.placements).toEqual(at(parts));
  });

  it('pulls furniture out of a wall it was overlapping', () => {
    const parts = [
      part({ category: 'sofa', shape: 'sofa', dimMM: [2200, 950, 880], pos: [2.8, 0, 0], rot: 0 }),
    ];
    const r = solveLayout(parts, RECT, [false], { seed: 2, steps: 2000 });
    const p = r.placements[0];
    // Half a 2.2 m sofa is 1.1 m, so its centre cannot be past 1.9 m from the
    // middle on x without hanging out of a 6 m room.
    expect(Math.abs(p.x)).toBeLessThan(2.6);
  });
});

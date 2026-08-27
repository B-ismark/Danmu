import { describe, it, expect } from 'vitest';
import { wallApertures, skirtingRuns, isAperture } from '@/lib/apertures';
import { wallSegments, type Footprint } from '@/lib/footprint';
import type { ScenePart } from '@/lib/scene-spec';

const RECT: Footprint = [
  [-3, -2],
  [3, -2],
  [3, 2],
  [-3, 2],
];
const H = 2.8;
const WALLS = wallSegments(RECT);

let n = 0;
function part(over: Partial<ScenePart> & Pick<ScenePart, 'shape' | 'dimMM' | 'pos'>): ScenePart {
  return {
    id: `p${++n}`,
    name: over.shape,
    category: 'other',
    rot: 0,
    locked: false,
    wallMounted: true,
    ...over,
  } as ScenePart;
}

/** A 1400 x 1200 window on the north wall (edge 0), sill at 800 mm. */
const window0 = () =>
  part({ shape: 'window', dimMM: [1400, 80, 1200], pos: [1.2, 1.4, -1.95] });

/** A 900 x 2100 door on the east wall (edge 1), standing on the floor. */
const door1 = () => part({ shape: 'door', dimMM: [900, 50, 2100], pos: [2.95, 1.07, 1.0] });

describe('wallApertures', () => {
  it('puts the opening on the wall the part is against', () => {
    const map = wallApertures([window0(), door1()], RECT, WALLS, H);
    expect([...map.keys()].sort()).toEqual([0, 1]);
    expect(map.get(0)).toHaveLength(1);
    expect(map.get(1)).toHaveLength(1);
  });

  it('measures across the wall from its middle, in the right direction', () => {
    // The bug this pins: getting the wall's tangent backwards mirrors every
    // opening about the middle of its wall, which is invisible to look at on a
    // centred window and wrong for every other one.
    const right = wallApertures([window0()], RECT, WALLS, H).get(0)![0];
    expect(right.x0).toBeCloseTo(0.5, 9);
    expect(right.x1).toBeCloseTo(1.9, 9);

    const mirrored = part({ shape: 'window', dimMM: [1400, 80, 1200], pos: [-1.2, 1.4, -1.95] });
    const left = wallApertures([mirrored], RECT, WALLS, H).get(0)![0];
    expect(left.x0).toBeCloseTo(-1.9, 9);
    expect(left.x1).toBeCloseTo(-0.5, 9);
  });

  it('works on a wall whose local axis is not the world X axis', () => {
    // Edge 1 runs along Z, so its tangent is (0, 1) — a different code path in
    // practice, and the one an X-only test would let through broken.
    const a = wallApertures([door1()], RECT, WALLS, H).get(1)![0];
    expect(a.x0).toBeCloseTo(0.55, 9);
    expect(a.x1).toBeCloseTo(1.45, 9);
  });

  it('places the opening vertically where the part is', () => {
    const w = wallApertures([window0()], RECT, WALLS, H).get(0)![0];
    // Centre-anchored at 1.4 m in a 2.8 m room: dead centre of the wall.
    expect(w.y0).toBeCloseTo(-0.6, 9);
    expect(w.y1).toBeCloseTo(0.6, 9);
    expect(w.floorY).toBeCloseTo(0.8, 9);
  });

  it('keeps a floor-standing door’s opening just inside the wall outline', () => {
    // A door reaches the floor and the wall starts at the floor, so the hole edge
    // would be coincident with the outline — the degenerate case for Earcut. The
    // OPENING is clamped by the margin; the door part keeps its real 2100 mm.
    const d = wallApertures([door1()], RECT, WALLS, H).get(1)![0];
    expect(d.y0).toBeCloseTo(-H / 2 + 0.02, 9);
    expect(d.floorY).toBeCloseTo(0.02, 9);
    expect(d.y1).toBeCloseTo(0.72, 9);
  });

  it('clamps an opening wider than its wall instead of overflowing it', () => {
    const huge = part({ shape: 'window', dimMM: [8000, 80, 1200], pos: [0, 1.4, -1.95] });
    const a = wallApertures([huge], RECT, WALLS, H).get(0)![0];
    expect(a.x0).toBeCloseTo(-2.98, 9);
    expect(a.x1).toBeCloseTo(2.98, 9);
  });

  it('ignores anything that is not a hole in a wall', () => {
    const painting = part({ shape: 'painting', dimMM: [800, 30, 600], pos: [0, 1.6, -1.95] });
    const curtain = part({ shape: 'curtain', dimMM: [1600, 80, 2200], pos: [0, 1.4, -1.95] });
    const freeStanding = part({ shape: 'window', dimMM: [1400, 80, 1200], pos: [0, 1.4, 0], wallMounted: false });
    expect(wallApertures([painting, curtain, freeStanding], RECT, WALLS, H).size).toBe(0);
  });

  it('drops an opening too small to be one', () => {
    const sliver = part({ shape: 'window', dimMM: [40, 80, 1200], pos: [0, 1.4, -1.95] });
    expect(wallApertures([sliver], RECT, WALLS, H).size).toBe(0);
  });
});

describe('skirtingRuns', () => {
  it('leaves the wall whole when nothing reaches the floor', () => {
    const w = wallApertures([window0()], RECT, WALLS, H).get(0)!;
    expect(skirtingRuns(6, w, 0.1)).toEqual([[-3, 3]]);
  });

  it('breaks at a doorway and keeps the total length honest', () => {
    const d = wallApertures([door1()], RECT, WALLS, H).get(1)!;
    const runs = skirtingRuns(4, d, 0.1);
    expect(runs).toHaveLength(2);
    expect(runs[0][1]).toBeCloseTo(0.55, 9);
    expect(runs[1][0]).toBeCloseTo(1.45, 9);
    const total = runs.reduce((s, [a, b]) => s + (b - a), 0);
    expect(total).toBeCloseTo(4 - 0.9, 9);
  });

  it('handles two doorways, and overlapping ones, without emitting slivers', () => {
    const a = { partId: 'a', x0: -1, x1: 0, y0: -1.38, y1: 0.72, floorY: 0.02 };
    const b = { partId: 'b', x0: -0.5, x1: 1, y0: -1.38, y1: 0.72, floorY: 0.02 };
    const runs = skirtingRuns(4, [b, a], 0.1);
    // Merged into one gap from -1 to 1 — not three runs with a zero-width one
    // between the overlapping pair.
    expect(runs).toEqual([
      [-2, -1],
      [1, 2],
    ]);
  });

  it('leaves the margin stubs a wall-wide opening cannot eat', () => {
    // An opening is always clamped 2 cm inside the outline, so the skirting either
    // side of it is real skirting rather than a rounding artefact — 2 cm is above
    // the sliver filter on purpose.
    const wide = { partId: 'a', x0: -1.98, x1: 1.98, y0: -1.38, y1: 0.72, floorY: 0.02 };
    expect(skirtingRuns(4, [wide], 0.1)).toEqual([
      [-2, -1.98],
      [1.98, 2],
    ]);
  });

  it('returns nothing when a cut genuinely covers the whole wall', () => {
    const full = { partId: 'a', x0: -2, x1: 2, y0: -1.38, y1: 0.72, floorY: 0.02 };
    expect(skirtingRuns(4, [full], 0.1)).toEqual([]);
  });
});

// `isAperture` is small and it carries a load it did not used to. Since the walls
// became shadow casters (`components/three/RoomShell.tsx`) an opening is the only
// way the sun gets into the room, so this predicate decides both where the wall is
// cut and — through the Style panel's hint — whether the app tells someone their
// sun mood has nothing to shine through. Those two must not be able to disagree,
// which is why it is a function and not an exported Set for each caller to test.
describe('what counts as an opening', () => {
  const p = (shape: string, wallMounted?: boolean) => ({ shape, wallMounted });

  it('accepts a window or a door that is actually on a wall', () => {
    expect(isAperture(p('window', true))).toBe(true);
    expect(isAperture(p('door', true))).toBe(true);
  });

  it('refuses a window or a door that is not', () => {
    // The half a copied Set would lose. A door dragged off its wall and left lying
    // on the floor cuts no hole — `wallApertures` would place it against whichever
    // wall it is nearest and open a doorway in the wrong plaster — and it is not
    // sunlight coming in either.
    expect(isAperture(p('door', false))).toBe(false);
    expect(isAperture(p('door'))).toBe(false);
    expect(isAperture(p('window'))).toBe(false);
  });

  it('refuses the things that hang on a wall rather than open it', () => {
    // A curtain is the interesting one: it belongs to an opening and is not one.
    // It cuts nothing, so a room whose only "window" is a curtain still has no way
    // in for the sun — which is the honest answer and the one the hint gives.
    for (const shape of ['curtain', 'tv', 'painting', 'mirror', 'shelf', 'ac']) {
      expect(isAperture(p(shape, true)), shape).toBe(false);
    }
  });
});

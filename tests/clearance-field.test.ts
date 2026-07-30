import { describe, it, expect } from 'vitest';
import {
  buildClearanceField,
  cellAt,
  cellCentre,
  componentAreas,
  fieldRuns,
  freeShareOf,
  gapTolerance,
  largestFreeCircle,
  pairGaps,
  rasterizeCoverage,
  FREE_CELL,
  WALL_OWNER,
  WALK_RADIUS,
  FIELD_CELL,
} from '@/lib/clearance-field';
import { analyzeRoom, freeFloorFraction } from '@/lib/clearance';
import { obbGap, type OBB, type Poly } from '@/lib/geometry';
import type { ScenePart } from '@/lib/scene-spec';
import type { Footprint } from '@/lib/footprint';

const RECT: Footprint = [
  [-3, -2],
  [3, -2],
  [3, 2],
  [-3, 2],
];
const L_ROOM: Footprint = [
  [-3, -2],
  [3, -2],
  [3, 0],
  [1, 0],
  [1, 2],
  [-3, 2],
];

function box(cx: number, cz: number, w: number, d: number, rot = 0): OBB {
  return { cx, cz, hw: w / 2, hd: d / 2, rot };
}

/** Seeded PRNG — a flaky geometry test is worse than no geometry test. */
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let n = 0;
function part(p: Partial<ScenePart> & Pick<ScenePart, 'category' | 'shape' | 'dimMM' | 'pos'>): ScenePart {
  return { id: `${p.category}-${++n}`, name: p.category, rot: 0, locked: false, ...p } as ScenePart;
}

describe('rasterizeCoverage', () => {
  it('pads by one cell so the walls exist as seeds', () => {
    // A rectangular room fills its own bounding box exactly, so without the pad
    // ring there is no cell outside the polygon anywhere and the distance
    // transform has nothing to measure the walls from.
    const r = rasterizeCoverage([], RECT)!;
    expect(r.cover[0]).toBe(WALL_OWNER);
    expect(r.cover[r.nx * r.nz - 1]).toBe(WALL_OWNER);
    // …and the interior lattice is unchanged, so the coverage numbers are the
    // ones freeFloorFraction always produced.
    const first = cellCentre(r, r.nx + 1);
    expect(first[0]).toBeCloseTo(-3 + FIELD_CELL / 2, 12);
    expect(first[1]).toBeCloseTo(-2 + FIELD_CELL / 2, 12);
  });

  it('agrees with freeFloorFraction', () => {
    const parts = [box(0, 0, 1.4, 0.7), box(0.9, 0.4, 1.2, 0.6, 0.7)];
    const r = rasterizeCoverage(parts, L_ROOM)!;
    expect(freeShareOf(r)).toBeCloseTo(freeFloorFraction(parts, L_ROOM), 12);
  });

  it('claims a cell for exactly one part', () => {
    const r = rasterizeCoverage([box(0, 0, 1, 1), box(0, 0, 1, 1)], RECT)!;
    const one = rasterizeCoverage([box(0, 0, 1, 1)], RECT)!;
    expect(r.freeCount).toBe(one.freeCount);
  });
});

describe('the distance transform', () => {
  // The EDT is exact by construction, so the check is against brute force rather
  // than against a tolerance: for every free cell, the distance to the nearest
  // seed CELL CENTRE must match, and the reported clearance is that minus the
  // half-cell that separates a seed centre from the surface it stands for.
  it('matches brute-force nearest-obstacle on a small grid', () => {
    const small: Poly = [
      [-1, -0.8],
      [1, -0.8],
      [1, 0.8],
      [-1, 0.8],
    ];
    const f = buildClearanceField([box(0.2, 0.1, 0.5, 0.3, 0.4)], small)!;
    const seeds: Array<[number, number]> = [];
    for (let i = 0; i < f.cover.length; i++) {
      if (f.cover[i] !== FREE_CELL) seeds.push(cellCentre(f, i));
    }
    expect(seeds.length).toBeGreaterThan(0);
    let checked = 0;
    for (let i = 0; i < f.cover.length; i++) {
      if (f.cover[i] !== FREE_CELL) continue;
      const [x, z] = cellCentre(f, i);
      let best = Infinity;
      for (const [sx, sz] of seeds) best = Math.min(best, Math.hypot(x - sx, z - sz));
      expect(f.clearance[i]).toBeCloseTo(Math.max(0, best - f.cell / 2), 6);
      checked++;
    }
    expect(checked).toBeGreaterThan(400);
  });

  it('measures the distance to a wall, not just to furniture', () => {
    const f = buildClearanceField([], RECT)!;
    // Dead centre of a 6 × 4 m room: the nearest wall is 2 m away.
    const at = cellAt(f, 0.025, 0.025);
    expect(f.clearance[at]).toBeCloseTo(2 - 0.025, 2);
    expect(f.nearest[at]).toBe(WALL_OWNER);
  });

  it('names WHICH obstacle is nearest, not just how far', () => {
    const f = buildClearanceField([box(-2, 0, 1, 1), box(2, 0, 1, 1)], RECT)!;
    expect(f.nearest[cellAt(f, -1.2, 0.025)]).toBe(0);
    expect(f.nearest[cellAt(f, 1.2, 0.025)]).toBe(1);
    // Between them the wall is closer than either box.
    expect(f.nearest[cellAt(f, 0.025, 1.8)]).toBe(WALL_OWNER);
  });
});

describe('pairGaps', () => {
  // gapTolerance is a claim about accuracy, and a claim about accuracy that
  // nothing checks drifts. This is the test that holds it: whatever the rotation,
  // the reading is inside the band the module promises, and the worst case is
  // reported so a future tightening of the constant fails here rather than
  // silently turning the room report into a generator of imaginary warnings.
  it('agrees with obbGap inside the tolerance it advertises, at any rotation', () => {
    const rand = rng(20260731);
    let worst = 0;
    let cases = 0;
    for (let iter = 0; iter < 60; iter++) {
      const a = box(-2 + rand() * 1.5, -1.5 + rand() * 3, 0.4 + rand(), 0.4 + rand(), rand() * Math.PI);
      const b = box(0.5 + rand() * 1.5, -1.5 + rand() * 3, 0.4 + rand(), 0.4 + rand(), rand() * Math.PI);
      const truth = obbGap(a, b);
      // Touching has no free cell to read, and too far apart means a third thing
      // (the wall) owns the space between them.
      if (truth <= 0.1 || truth > 2) continue;
      const f = buildClearanceField([a, b], RECT)!;
      const got = pairGaps(f).get('0:1');
      expect(got).toBeDefined();
      const err = Math.abs(got! - truth);
      expect(err).toBeLessThanOrEqual(gapTolerance(f));
      worst = Math.max(worst, err / f.cell);
      cases++;
    }
    expect(cases).toBeGreaterThan(15);
    // Documented as 1.5 cells with nothing to spare; if this drops a lot the
    // constant can be tightened, and if it rises the constant is a lie.
    expect(worst).toBeGreaterThan(1);
    expect(worst).toBeLessThanOrEqual(1.5);
  });

  it('is exact face-to-face, where the medial axis is square to the raster', () => {
    const a = box(-1.2, 0, 1.2, 0.6);
    const b = box(1.2, 0, 1.2, 0.6);
    const f = buildClearanceField([a, b], RECT)!;
    // Float32 field, so "exact" is exact to single precision.
    expect(pairGaps(f).get('0:1')!).toBeCloseTo(obbGap(a, b), 6);
  });

  it('reads a gap against the WALL, which obbGap cannot express', () => {
    // The sofa's back is 32.5 cm off the north wall — a number no part-vs-part
    // loop can produce, because one side of it is not a part.
    const sofa = box(0, -1.2, 2.2, 0.95);
    const f = buildClearanceField([sofa], RECT)!;
    const gap = pairGaps(f).get(`${WALL_OWNER}:0`);
    expect(gap).toBeDefined();
    expect(Math.abs(gap! - 0.325)).toBeLessThanOrEqual(f.cell);
  });

  it('reports touching pieces as touching, not as a walkway', () => {
    // The medial axis between two flush pieces is anchored at the contact point,
    // where the disc has no room at all — so the minimum over it is ~0 rather
    // than the width of the axis out in the open.
    const wardrobe = box(0, -1.7, 2.0, 0.6);
    const sofa = box(0, -0.925, 2.2, 0.95);
    const f = buildClearanceField([wardrobe, sofa], RECT)!;
    expect(pairGaps(f).get('0:1')!).toBeLessThan(0.12);
  });
});

describe('walkable components', () => {
  /** Two slabs across the room with `gap` metres between them. */
  function split(gap: number): OBB[] {
    const half = (6 - gap) / 2;
    return [box(-3 + half / 2, 0, half, 0.6), box(3 - half / 2, 0, half, 0.6)];
  }

  it('joins the room through a 700 mm gap', () => {
    const f = buildClearanceField(split(0.7), RECT)!;
    expect(f.componentCount).toBe(1);
  });

  it('splits the room at a 500 mm gap', () => {
    // Half of 500 mm is 250 mm, under the 300 mm a person needs, so the two
    // halves of the floor stop being one place.
    const f = buildClearanceField(split(0.5), RECT)!;
    expect(f.componentCount).toBe(2);
    const areas = componentAreas(f);
    expect(areas.every((a) => a > 1)).toBe(true);
  });

  it('never marks a cell walkable below the standing radius', () => {
    const f = buildClearanceField([box(0, 0, 2, 2)], RECT)!;
    for (let i = 0; i < f.component.length; i++) {
      if (f.component[i] >= 0) expect(f.clearance[i]).toBeGreaterThanOrEqual(WALK_RADIUS);
    }
  });
});

describe('largestFreeCircle', () => {
  it('finds the middle of an empty room', () => {
    const c = largestFreeCircle(buildClearanceField([], RECT)!)!;
    // 6 × 4 m: the biggest inscribed circle has a 2 m radius, centred on the
    // long axis. Only the radius is unique — the centre is anywhere on it.
    expect(c.r).toBeCloseTo(2, 1);
    expect(Math.abs(c.z)).toBeLessThan(0.1);
  });

  it('shrinks as the room fills up', () => {
    const empty = largestFreeCircle(buildClearanceField([], RECT)!)!;
    const full = largestFreeCircle(buildClearanceField([box(0, 0, 4, 2.4)], RECT)!)!;
    expect(full.r).toBeLessThan(empty.r);
  });
});

describe('analyzeRoom circulation rules', () => {
  const ROOM = { footprint: RECT, height: 2.8 };

  /** A room cut in two by furniture, with the door on the north side. */
  function severed() {
    const door = part({ category: 'door', shape: 'door', dimMM: [900, 50, 2100], pos: [0, 0, -1.95], wallMounted: true });
    const left = part({ category: 'wardrobe', shape: 'wardrobe', dimMM: [2800, 600, 2100], pos: [-1.6, 0, 0] });
    const right = part({ category: 'wardrobe', shape: 'wardrobe', dimMM: [2800, 600, 2100], pos: [1.6, 0, 0] });
    const chair = part({ category: 'chair', shape: 'chair-dining', dimMM: [500, 500, 850], pos: [0, 0, 1.5] });
    return { door, left, right, chair };
  }

  it('says so when a piece has no route to the door', () => {
    const { door, left, right, chair } = severed();
    const { issues } = analyzeRoom([door, left, right, chair], ROOM);
    const hit = issues.find((i) => i.id === 'reach');
    expect(hit).toBeDefined();
    expect(hit!.partIds).toContain(chair.id);
    // …and the pinch that caused it is reported too, in its own terms.
    expect(issues.find((i) => i.id.startsWith('walk-'))).toBeDefined();
  });

  it('measures the floor that got cut off', () => {
    const { door, left, right, chair } = severed();
    const hit = analyzeRoom([door, left, right, chair], ROOM).issues.find((i) => i.id === 'cut-off');
    expect(hit).toBeDefined();
    // South half is 6 × 1.7 m; the walkable part of it is a fair slice of that.
    expect(hit!.detail).toMatch(/\d\.\d m²/);
  });

  it('stays silent without a door to reason from', () => {
    // Which side someone comes in from is not knowable, so "unreachable" is not
    // either. Silence beats a guess.
    const { left, right, chair } = severed();
    const { issues } = analyzeRoom([left, right, chair], ROOM);
    expect(issues.find((i) => i.id === 'reach')).toBeUndefined();
    expect(issues.find((i) => i.id === 'cut-off')).toBeUndefined();
  });

  it('stays silent in an ordinary room', () => {
    const door = part({ category: 'door', shape: 'door', dimMM: [900, 50, 2100], pos: [0, 0, -1.95], wallMounted: true });
    const sofa = part({ category: 'sofa', shape: 'sofa', dimMM: [2200, 950, 880], pos: [0, 0, 1.4] });
    const table = part({ category: 'table', shape: 'coffee-table', dimMM: [1100, 600, 420], pos: [0, 0, 0.2] });
    const { issues } = analyzeRoom([door, sofa, table], ROOM);
    expect(issues.find((i) => i.id === 'reach')).toBeUndefined();
  });

  it('reports turning space only when asked' , () => {
    // A 2.0 × 1.6 m room cannot take a 1500 mm turning circle anywhere.
    const tight: Footprint = [
      [-1, -0.8],
      [1, -0.8],
      [1, 0.8],
      [-1, 0.8],
    ];
    const room = { footprint: tight, height: 2.4 };
    const bed = part({ category: 'bed', shape: 'bed-single', dimMM: [900, 1900, 600], pos: [-0.5, 0, 0] });
    expect(analyzeRoom([bed], room).issues.find((i) => i.id === 'turning')).toBeUndefined();
    const hit = analyzeRoom([bed], room, { accessibility: true }).issues.find((i) => i.id === 'turning');
    expect(hit).toBeDefined();
    expect(hit!.detail).toContain('150 cm');
  });

  it('passes a room that does have turning space', () => {
    const { issues } = analyzeRoom([], ROOM, { accessibility: true });
    expect(issues.find((i) => i.id === 'turning')).toBeUndefined();
  });

  it('hands the field back for the plan to draw', () => {
    const report = analyzeRoom([], ROOM);
    expect(report.field).not.toBeNull();
    expect(report.field!.nx).toBeGreaterThan(100);
  });
});

describe('fieldRuns', () => {
  it('collapses a room into far fewer runs than cells', () => {
    const f = buildClearanceField([box(0, 0, 1.4, 0.7)], RECT)!;
    const runs = fieldRuns(f, (at) => (f.component[at] >= 0 ? 0 : -1));
    const walkableCells = f.component.reduce((n, id) => n + (id >= 0 ? 1 : 0), 0);
    expect(walkableCells).toBeGreaterThan(5000);
    // One or two runs per row, not one node per cell — this is the whole reason
    // the overlay can be SVG that reads the design tokens.
    expect(runs.length).toBeLessThan(f.nz * 3);
    // …and they cover exactly the classified cells, no more and no less.
    const covered = runs.reduce((sum, r) => sum + Math.round(r.w / f.cell), 0);
    expect(covered).toBe(walkableCells);
  });

  it('splits a run where the state changes', () => {
    const f = buildClearanceField([box(0, 0, 0.5, 4)], RECT)!;
    // A slab down the middle: every row through it has walkable floor on both
    // sides and nothing in between.
    const runs = fieldRuns(f, (at) => (f.component[at] >= 0 ? f.component[at] : -1));
    expect(f.componentCount).toBe(2);
    const states = new Set(runs.map((r) => r.state));
    expect(states).toEqual(new Set([0, 1]));
  });

  it('gives up rather than emitting a node per cell', () => {
    const f = buildClearanceField([], RECT)!;
    // Alternating cells make every single cell its own run — the pathological
    // case the cap exists for.
    expect(fieldRuns(f, (at) => (at % 2 === 0 ? 0 : -1), 100)).toEqual([]);
  });
});

describe('cost', () => {
  it('stays inside a frame budget on the largest room the app can build', () => {
    // MAX_ROOM is 40 m. analyzeRoom runs on every committed edit, so this is the
    // canary for an accidental O(cells x parts) regression rather than a
    // benchmark — the measured figure is ~40 ms and the bar is deliberately
    // loose enough not to flake on a busy machine.
    //
    // BEST of three, not one. A single sample measures whatever else the machine
    // was doing during that slice: with eight busy cores this took 1604 ms — a
    // 40x stall on a 40 ms body, failing a 1500 ms bar that has an enormous
    // margin. Taking the best sample measures what the machine CAN do, which is
    // the question a ceiling is asking. A real O(cells x parts) regression is
    // slow in all three.
    const big: Footprint = [
      [-20, -20],
      [20, -20],
      [20, 20],
      [-20, 20],
    ];
    const parts: OBB[] = [];
    for (let i = 0; i < 30; i++) {
      parts.push(box(-18 + (i % 6) * 7, -18 + Math.floor(i / 6) * 8, 1.8, 0.9, i * 0.31));
    }
    let best = Infinity;
    let f!: ReturnType<typeof buildClearanceField>;
    for (let run = 0; run < 3; run++) {
      const t0 = performance.now();
      f = buildClearanceField(parts, big)!;
      pairGaps(f!);
      best = Math.min(best, performance.now() - t0);
    }
    expect(f!.componentCount).toBeGreaterThanOrEqual(1);
    expect(best).toBeLessThan(1500);
  });
});

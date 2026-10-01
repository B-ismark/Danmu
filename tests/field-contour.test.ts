import { describe, expect, it } from 'vitest';
import { fieldContours, loopArea, roundedPath, simplifyLoop, SIMPLIFY_CELLS, type ContourGrid } from '../lib/field-contour';

const grid = (nx: number, nz: number, cell = 0.05): ContourGrid => ({ cell, minX: 0, minZ: 0, nx, nz });
const fromRows = (rows: string[]) => {
  const g = grid(rows[0].length, rows.length);
  return { g, inside: (at: number) => rows[Math.floor(at / g.nx)][at % g.nx] === '#' };
};

describe('fieldContours', () => {
  it('outlines a block of cells on its cell edges, losing only a half-cell chamfer per corner', () => {
    const g = grid(10, 6);
    const inside = (at: number) => {
      const i = at % 10, j = Math.floor(at / 10);
      return i >= 2 && i < 8 && j >= 1 && j < 5; // 6 × 4 cells
    };
    const loops = fieldContours(g, inside);
    expect(loops).toHaveLength(1);
    const c = g.cell;
    // 24 cells, minus four corner triangles of c²/8.
    expect(Math.abs(loopArea(loops[0]))).toBeCloseTo(24 * c * c - 4 * (c * c) / 8, 9);
    const xs = loops[0].map((p) => p[0]);
    const zs = loops[0].map((p) => p[1]);
    expect(Math.min(...xs)).toBeCloseTo(2 * c, 9);
    expect(Math.max(...xs)).toBeCloseTo(8 * c, 9);
    expect(Math.min(...zs)).toBeCloseTo(1 * c, 9);
    expect(Math.max(...zs)).toBeCloseTo(5 * c, 9);
  });

  it('gives a region with a hole two loops, which evenodd draws as the region', () => {
    const { g, inside } = fromRows(['#####', '#...#', '#...#', '#####']);
    const loops = fieldContours(g, inside);
    expect(loops).toHaveLength(2);
    const areas = loops.map((l) => Math.abs(loopArea(l))).sort((a, b) => a - b);
    expect(areas[0]).toBeLessThan(areas[1]);
  });

  it('keeps two cells that touch only at a corner apart, and a region on the grid edge closed', () => {
    const { g, inside } = fromRows(['#.', '.#']);
    expect(fieldContours(g, inside)).toHaveLength(2);
    const all = fromRows(['##', '##']);
    expect(fieldContours(all.g, all.inside)).toHaveLength(1);
  });

  it('draws nothing for an empty field', () => {
    expect(fieldContours(grid(4, 4), () => false)).toEqual([]);
  });
});

/** The furthest any raw point sits from the simplified outline. */
const gap = (raw: Array<[number, number]>, s: Array<[number, number]>) => {
  let worst = 0;
  for (const p of raw) {
    let best = Infinity;
    for (let i = 0; i < s.length; i++) {
      const a = s[i], b = s[(i + 1) % s.length];
      const dx = b[0] - a[0], dz = b[1] - a[1];
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (dx * dx + dz * dz)));
      best = Math.min(best, Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz));
    }
    worst = Math.max(worst, best);
  }
  return worst;
};

describe('simplifyLoop', () => {
  it('reduces a block to its corners', () => {
    const g = grid(40, 30);
    const loops = fieldContours(g, (at) => {
      const i = at % 40, j = Math.floor(at / 40);
      return i >= 5 && i < 35 && j >= 5 && j < 25;
    });
    const raw = loops[0];
    const s = simplifyLoop(raw, SIMPLIFY_CELLS * g.cell);
    expect(raw.length).toBeGreaterThan(80);
    expect(s.length).toBeLessThanOrEqual(8);
    // Not the area to 1%: a chord may cut a half-cell chamfer, so an edge can sit
    // half a cell (2.5 cm) in. What is promised is the distance, below.
    expect(gap(raw, s)).toBeLessThanOrEqual(SIMPLIFY_CELLS * g.cell + 1e-9);
  });

  it('flattens a shallow staircase into one edge', () => {
    // A 1-in-4 slope: the stair-steps a run-per-row overlay drew as a saw blade.
    const rows = Array.from({ length: 8 }, (_, j) => '#'.repeat(4 + j * 4).padEnd(40, '.'));
    const { g, inside } = fromRows(rows);
    const raw = fieldContours(g, inside)[0];
    const s = simplifyLoop(raw, SIMPLIFY_CELLS * g.cell);
    expect(s.length).toBeLessThanOrEqual(6);
    expect(gap(raw, s)).toBeLessThanOrEqual(SIMPLIFY_CELLS * g.cell + 1e-9);
  });
});

describe('roundedPath', () => {
  const square: Array<[number, number]> = [[0, 0], [1, 0], [1, 1], [0, 1]];

  it('rounds each corner by the radius, not by a share of the edge', () => {
    const d = roundedPath([square], 0.1, (x, z) => [x * 100, z * 100]);
    // Each corner starts 10 units (0.1 m) before the vertex and curves through it.
    expect(d.startsWith('M0 10 Q0 0 10 0')).toBe(true);
    expect(d).toContain('L90 0 Q100 0 100 10');
    expect(d.trim().endsWith('Z')).toBe(true);
  });

  it('caps the radius at half the shorter edge', () => {
    const thin: Array<[number, number]> = [[0, 0], [1, 0], [1, 0.04], [0, 0.04]];
    const d = roundedPath([thin], 0.1, (x, z) => [x * 100, z * 100]);
    // Both legs of a corner take the same cut, or the curve would not be tangent.
    expect(d.startsWith('M0 2 Q0 0 2 0')).toBe(true);
  });

  it('joins several loops into one path', () => {
    const d = roundedPath([square, square], 0.1, (x, z) => [x, z]);
    expect(d.match(/M/g)).toHaveLength(2);
    expect(d.match(/Z/g)).toHaveLength(2);
  });
});

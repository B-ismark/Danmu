// What the radiator and the side table DRAW, read against the forms they are drawn from.
//
// `hard-goods.test.ts` holds `radiatorForm` and `sideTableForm` to the objects they
// describe; nothing there can see the renderer, which is where both forms are turned into
// something else. The radiator's columns leave `HardParts` for two instanced sets — a
// post or a strut becomes a scaled, turned unit tube, a ball a scaled unit sphere — and
// that conversion is hand-written arithmetic in a TSX file, rule 2's warning exactly. The
// side table is authored on a square of its width and stretched to its depth by a group
// scale, which every size the catalogue seeds (450 × 450) is blind to.
//
// The walk (`tests/helpers/geometry-walk.ts`) assumes `RoundInstances`' unit meshes are a
// cylinder and a sphere of diameter 1 — so the last test reads that off the source, since
// a walk that trusts the assumption cannot test it.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/store', () => ({
  useStudio: (sel: (s: unknown) => unknown) =>
    sel({ dims: {}, openState: new Proxy({}, { get: () => 0 }), hidden: {}, quality: 'high' }),
}));
// `SURFACE.*` builds canvas textures on read; a material carries no geometry.
vi.mock('@/components/three/materials', () => ({
  SURFACE: new Proxy({}, { get: () => ({}) }),
  PHYSICAL_SURFACES: ['fabric'],
}));

import { PartGeometry } from '@/components/three/DynamicPart';
import { partExtent, radiatorForm } from '@/lib/hard-goods';
import { dimRangeFor } from '@/lib/dimension-ranges';
import type { ScenePart } from '@/lib/scene-spec';
import { horizontalBounds, walk, type Prim } from './helpers/geometry-walk';

const partAt = (shape: string, category: string, dimMM: [number, number, number]): ScenePart =>
  ({ id: `probe-${shape}`, name: shape, shape, category, dimMM, pos: [0, 0, 0], rot: 0, color: '#b07a52' }) as unknown as ScenePart;

const drawn = (part: ScenePart) => {
  const rep = walk(PartGeometry({ part, locked: false }));
  expect({ ...rep.unhandled, ...rep.threw }).toEqual({});
  return rep.prims;
};

const bounds = (p: Prim) => {
  const b = horizontalBounds([p]);
  return [b.x0, p.y[0], b.z0, b.x1, p.y[1], b.z1];
};

/** Half a millimetre: a 16-sided tube reads at most r·(1 − cos(π/16)) ≈ 0.27 mm inside a
 *  14 mm one, and every defect worth catching here moves a bound by millimetres. */
const TOL = 0.0005;

describe('the radiator, drawn', () => {
  const band = dimRangeFor('fridge', 'radiator');
  const sizes: Array<[number, number, number]> = [
    [band.min[0], band.min[1], band.min[2]],
    [800, 120, 580],
    [band.max[0], band.max[1], band.max[2]],
  ];

  it('draws every column part where and as large as the form puts it, as one instanced tube or sphere each', () => {
    for (const dim of sizes) {
      const at = dim.join('x');
      const { columns } = radiatorForm(dim);
      const prims = drawn(partAt('radiator', 'fridge', dim)).filter((p) => p.kind === 'RoundInstances');
      // Exactly one drawn round per column part: nothing dropped, nothing doubled.
      expect(prims.length, at).toBe(columns.length);
      const left = prims.map(bounds);
      for (const part of columns) {
        const e = partExtent(part);
        const want = [...e.lo, ...e.hi];
        const i = left.findIndex((b) => b.every((v, k) => Math.abs(v - want[k]) < TOL));
        expect(i, `${at} ${part.key} drawn at its extent`).toBeGreaterThanOrEqual(0);
        left.splice(i, 1);
      }
    }
  });
});

describe('the side table, drawn', () => {
  it('is stretched from the square it is authored on to its own depth', () => {
    const band = dimRangeFor('table', 'side-table');
    for (const dim of [[600, 400, 550], [400, 700, 600], [band.min[0], band.max[1], band.min[2]]] as Array<[number, number, number]>) {
      const at = dim.join('x');
      const b = horizontalBounds(drawn(partAt('side-table', 'table', dim)));
      expect(b.x1 - b.x0, `${at} width`).toBeCloseTo(dim[0] / 1000, 6);
      expect(b.z1 - b.z0, `${at} depth`).toBeCloseTo(dim[1] / 1000, 6);
    }
  });
});

// The oval mirror and the air purifier are authored on a circle of the width and stretched
// by a group scale — the mirror to its height, the purifier to its depth — so the same
// blindness applies: at a square Library size the stretch is the identity.
describe('the oval mirror and the air purifier, drawn', () => {
  const extent = (prims: ReturnType<typeof drawn>) => {
    const b = horizontalBounds(prims);
    return { w: b.x1 - b.x0, d: b.z1 - b.z0, y0: Math.min(...prims.map((p) => p.y[0])), y1: Math.max(...prims.map((p) => p.y[1])) };
  };

  it('the oval mirror is stretched from its circle to its own height', () => {
    const band = dimRangeFor('mirror', 'mirror-oval');
    for (const dim of [[600, 30, 1100], [band.min[0], 30, band.max[2]], [band.max[0], 30, band.min[2]]] as Array<[number, number, number]>) {
      const at = dim.join('x');
      const e = extent(drawn(partAt('mirror-oval', 'mirror', dim)));
      expect(e.w, `${at} width`).toBeCloseTo(dim[0] / 1000, 6);
      expect(e.d, `${at} depth`).toBeCloseTo(dim[1] / 1000, 6);
      // Centred on its origin, as every wall piece is.
      expect(e.y0, `${at} foot`).toBeCloseTo(-dim[2] / 2000, 6);
      expect(e.y1, `${at} head`).toBeCloseTo(dim[2] / 2000, 6);
    }
  });

  it('the air purifier is stretched from its circle to its own depth', () => {
    const band = dimRangeFor('fridge', 'air-purifier');
    for (const dim of [[300, 300, 620], [band.min[0], band.max[1], band.min[2]], [band.max[0], band.min[1], band.max[2]]] as Array<[number, number, number]>) {
      const at = dim.join('x');
      const e = extent(drawn(partAt('air-purifier', 'fridge', dim)));
      expect(e.w, `${at} width`).toBeCloseTo(dim[0] / 1000, 6);
      expect(e.d, `${at} depth`).toBeCloseTo(dim[1] / 1000, 6);
      expect(e.y0, `${at} foot`).toBeCloseTo(0, 6);
      expect(e.y1, `${at} top`).toBeCloseTo(dim[2] / 1000, 6);
    }
  });
});

describe("RoundInstances' unit meshes", () => {
  it('are the diameter-1 cylinder and sphere the walk measures them as', () => {
    const src = readFileSync(join(process.cwd(), 'components/three/Box.tsx'), 'utf8');
    const body = src.slice(src.indexOf('export function RoundInstances'));
    const fn = body.slice(0, body.indexOf('\n}\n'));
    expect(fn).toMatch(/<cylinderGeometry args=\{\[0\.5, 0\.5, 1, \d+\]\} \/>/);
    expect(fn).toMatch(/<sphereGeometry args=\{\[0\.5, \d+, \d+\]\} \/>/);
  });
});

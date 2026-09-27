// Is every piece of furniture ONE object? A rendered shape is a pile of primitives
// (a top, four legs, a shelf), and nothing held them to each other: a table top
// sitting 13 mm above its own legs, or a shelf hanging between the legs without
// reaching them, draws without an error and reads as a model that floats. This walks
// every shape's rendered geometry at its min / library / max size and asks two
// questions a person asks at a glance:
//
//   · CONNECTED — do the primitives form one touching cluster? Two primitives touch
//     when their vertical ranges meet and their floor projections meet, each within
//     `TOUCH`. Floor projections are compared as axis-aligned boxes, which can only
//     call a gap closed, never open one — so a reported gap is a real gap.
//   · GROUNDED — does a floor-standing piece reach the floor?
//
// When this was first run it found 181 floats across 19 shapes — a coffee table top
// 13 mm above its legs, dining-chair backs with nothing under them, desk side panels
// stopping 90 mm short, an armchair hovering 44 mm over its legs, shoe-rack slats held
// by nothing, air-purifier rings 42 mm into the floor. Every one was fixed at the
// model, none by loosening this file, and the assertion is now that there are none.

import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/store', () => ({
  useStudio: (sel: (s: unknown) => unknown) => sel({ dims: {}, openState: {}, hidden: {}, quality: 'high' }),
}));
vi.mock('@/components/three/materials', () => ({
  SURFACE: new Proxy({}, { get: () => ({}) }),
  PHYSICAL_SURFACES: ['fabric'],
}));

import { PartGeometry } from '@/components/three/DynamicPart';
import { SHAPES, PART_LIBRARY, type Shape, type ScenePart, type Category } from '@/lib/scene-spec';
import { dimRangeFor } from '@/lib/dimension-ranges';
import { anchorFor } from '@/lib/physics';
import { walk, type Prim } from './helpers/geometry-walk';

/** Two primitives this close count as touching, metres. 3 mm is the reveal real
 *  joinery leaves round a door and the offset a screen or decal plane needs to stay
 *  clear of z-fighting; at three metres it subtends 0.06°, which nobody sees. The
 *  floats this test was written against were 5–118 mm. */
const TOUCH = 0.003;

const categoryOf = (shape: Shape): Category => PART_LIBRARY.find((l) => l.shape === shape)?.category ?? 'other';
const libDim = (shape: Shape) => PART_LIBRARY.find((l) => l.shape === shape)?.dimMM as [number, number, number] | undefined;

const partAt = (shape: Shape, dimMM: [number, number, number], category: Category = categoryOf(shape)): ScenePart =>
  ({ id: `probe-${shape}`, name: shape, shape, category, dimMM, pos: [0, 0, 0], rot: 0, color: '#b07a52' }) as unknown as ScenePart;

type Box3 = { x: [number, number]; z: [number, number]; y: [number, number] };
const box = (p: Prim): Box3 => {
  const xs = p.pts.map((q) => q[0]);
  const zs = p.pts.map((q) => q[1]);
  return { x: [Math.min(...xs), Math.max(...xs)], z: [Math.min(...zs), Math.max(...zs)], y: p.y };
};
const gap1 = (a: [number, number], b: [number, number]) => Math.max(a[0] - b[1], b[0] - a[1], 0);
const touch = (a: Box3, b: Box3) => gap1(a.x, b.x) <= TOUCH && gap1(a.z, b.z) <= TOUCH && gap1(a.y, b.y) <= TOUCH;

/** Clusters of mutually touching primitives, largest first, as index lists. */
function clusters(bs: Box3[]): number[][] {
  const seen = new Array(bs.length).fill(false);
  const out: number[][] = [];
  for (let i = 0; i < bs.length; i++) {
    if (seen[i]) continue;
    const stack = [i];
    const c: number[] = [];
    seen[i] = true;
    while (stack.length) {
      const k = stack.pop()!;
      c.push(k);
      for (let j = 0; j < bs.length; j++) if (!seen[j] && touch(bs[k], bs[j])) { seen[j] = true; stack.push(j); }
    }
    out.push(c);
  }
  return out.sort((a, b) => b.length - a.length);
}

/** The nearest distance from any primitive in `c` to any primitive outside it, mm. */
function nearestGapMM(bs: Box3[], c: number[]): number {
  let g = Infinity;
  const inC = new Set(c);
  for (const i of c) for (let j = 0; j < bs.length; j++) {
    if (inC.has(j)) continue;
    g = Math.min(g, Math.max(gap1(bs[i].x, bs[j].x), gap1(bs[i].z, bs[j].z), gap1(bs[i].y, bs[j].y)));
  }
  return Math.round(g * 1000);
}

type Finding = { shape: Shape; size: string; what: string };

function inspect(shape: Shape, size: string, dim: [number, number, number], category?: Category): Finding[] {
  const rep = walk(PartGeometry({ part: partAt(shape, dim, category), locked: false }));
  const bs = rep.prims.map(box);
  const found: Finding[] = [];
  if (bs.length === 0) return found;
  const cs = clusters(bs);
  for (const c of cs.slice(1)) {
    const kinds = [...new Set(c.map((i) => rep.prims[i].kind))].join('+');
    found.push({ shape, size, what: `${c.length} ${kinds} detached, ${nearestGapMM(bs, c)} mm from the rest` });
  }
  if (anchorFor(categoryOf(shape), shape) === 'floor') {
    const low = Math.min(...bs.map((b) => b.y[0]));
    if (Math.abs(low) > TOUCH) found.push({ shape, size, what: `lowest point ${Math.round(low * 1000)} mm off the floor` });
  }
  return found;
}

const findings: Finding[] = [];
for (const shape of SHAPES) {
  const lib = libDim(shape);
  if (!lib) continue;
  const r = dimRangeFor(categoryOf(shape), shape);
  const sizes: Array<[string, [number, number, number]]> = [['lib', lib]];
  sizes.push(['min', [...r.min] as [number, number, number]]);
  sizes.push(['max', [...r.max] as [number, number, number]]);
  for (const [s, d] of sizes) findings.push(...inspect(shape, s, d));
}
// The one shape drawn two ways: `desk-standard` with category `table` is a dining
// table (`roleOf`), and the library entry is the desk. Walked at the desk range's
// sizes that still read as a dining table — the min is too small to sit at.
const DINING: Array<[string, [number, number, number]]> = [
  ['seed', [1500, 850, 750]],
  ['min', [900, 700, 700]],
  ['max', [...dimRangeFor('desk', 'desk-standard').max] as [number, number, number]],
];
for (const [s, d] of DINING) findings.push(...inspect('desk-standard', `dining ${s}`, d, 'table'));

describe('every model is one grounded object', () => {
  it('draws a dining table as a table and a desk as a desk', () => {
    // Floor contacts tell them apart: four legs, against the desk's side panel and
    // two legs. A scanned "table" was drawn as a desk before the role branch.
    const onFloor = (category: Category) =>
      walk(PartGeometry({ part: partAt('desk-standard', [1500, 850, 750], category), locked: false })).prims.filter(
        (p) => Math.abs(p.y[0]) < TOUCH,
      ).length;
    expect(onFloor('table')).toBe(4);
    expect(onFloor('desk')).toBe(3);
  });

  it('walks every library shape completely', () => {
    const shapes = SHAPES.filter((sh) => libDim(sh));
    expect(shapes.length).toBeGreaterThanOrEqual(40);
    for (const sh of shapes) {
      const rep = walk(PartGeometry({ part: partAt(sh, libDim(sh)!), locked: false }));
      expect({ sh, unhandled: rep.unhandled, threw: rep.threw }).toEqual({ sh, unhandled: {}, threw: {} });
    }
  });

  it('has no detached part and nothing below or above the floor it stands on', () => {
    if (findings.length) {
      console.log(`\nmodel integrity — ${findings.length} findings`);
      for (const f of findings) console.log(`  ${f.shape.padEnd(16)} ${f.size.padEnd(4)} ${f.what}`);
    }
    expect(findings).toEqual([]);
  });
});

// Does a floor-standing piece's drawing reach the height it declares?
//
// Everything that stacks, lands or clears reads a floor piece as `[y, y + dimMM[2]]`
// (`verticalExtent`), so a drawing that stops short of that leaves whatever is set on
// it floating, and one that overshoots pokes through whatever is above it. The only
// statement of what a shape draws is its TSX renderer, which is where CLAUDE.md rule 2
// says arithmetic hides from every gate: the ottoman's welt stopped at 0.9 h for as
// long as the ottoman existed, and a tray set on a 420 mm one stood 42 mm above it.
//
// `tests/helpers/geometry-walk.ts` reaches the renderer by calling it. The sweep is
// every floor-anchored shape in `SHAPES`, at the bottom, catalogue and top of its
// height range, and what it pins is the LIST of shapes that miss — a literal, not a
// count, so a new miss fails and so does a fixed one that nobody took off the list.
//
// A `//` header rather than a docblock — see `tests/layout-pick.test.ts`.

import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/store', () => ({
  useStudio: (sel: (s: unknown) => unknown) =>
    sel({ dims: {}, openState: new Proxy({}, { get: () => 0 }), hidden: {}, quality: 'high' }),
}));
// A material carries no geometry; see `tests/footprint-fidelity.test.tsx` for why the
// presets cannot be spread here.
vi.mock('@/components/three/materials', () => ({
  SURFACE: new Proxy({}, { get: () => ({}) }),
  PHYSICAL_SURFACES: ['fabric'],
}));

import { PartGeometry } from '@/components/three/DynamicPart';
import { SHAPES, PART_LIBRARY, type Category, type ScenePart, type Shape } from '@/lib/scene-spec';
import { dimRangeFor } from '@/lib/dimension-ranges';
import { anchorFor } from '@/lib/physics';
import { walk } from './helpers/geometry-walk';

/** How far a drawn top may sit from the declared one, mm. A desk's top is drawn 0.5 mm
 *  proud of it, which is a bevel, not a defect. */
const TOLERANCE_MM = 1;

const categoryOf = (shape: Shape): Category => PART_LIBRARY.find((l) => l.shape === shape)?.category ?? 'other';

function drawnTopMM(shape: Shape, category: Category, dimMM: [number, number, number]): number {
  const part = { id: 'p', name: shape, shape, category, dimMM, pos: [0, 0, 0], rot: 0, color: '#b07a52' } as unknown as ScenePart;
  const rep = walk(PartGeometry({ part, locked: false }));
  expect(Object.keys(rep.unhandled), `${shape}: unhandled`).toEqual([]);
  expect(Object.keys(rep.threw), `${shape}: threw`).toEqual([]);
  return Math.max(...rep.prims.map((p) => p.y[1])) * 1000;
}

/** Pairs drawn a second way that the Library's own category never reaches. The one
 *  there is: `PartGeometry` draws a `desk-standard` as a dining table, apron and all,
 *  when `roleOf` reads it as one, which the Library's desk-category entry never is and
 *  a room's `table` — the starter rooms', a scan's, the Library's own-size add — is. */
const ALSO: Array<[Shape, Category]> = [['desk-standard', 'table']];

const rows = [
  ...SHAPES.filter((shape) => anchorFor(categoryOf(shape), shape) === 'floor').map((shape): [Shape, Category] => [shape, categoryOf(shape)]),
  ...ALSO,
].map(([shape, category]) => {
  const range = dimRangeFor(category, shape);
  const lib = PART_LIBRARY.find((l) => l.shape === shape)?.dimMM ?? range.min;
  const heights = [range.min[2], lib[2], range.max[2]];
  const worst = Math.max(...heights.map((h) => Math.abs(drawnTopMM(shape, category, [lib[0], lib[1], h]) - h)));
  return { shape, worst };
});

describe('a floor piece is drawn to the height it declares', () => {
  it('the sweep has a fixed denominator', () => {
    // Every floor-anchored shape, none skipped, and the dining table. A shape that draws
    // nothing would throw on `Math.max()` of nothing rather than pass.
    expect(rows.length).toBe(37); // 37 with the clothes rail
  });

  it('the ottoman reaches its own height', () => {
    const r = dimRangeFor('ottoman', 'ottoman');
    for (const h of [r.min[2], 420, r.max[2]]) {
      expect(Math.abs(drawnTopMM('ottoman', 'ottoman', [550, 400, h]) - h)).toBeLessThan(TOLERANCE_MM);
    }
  });

  it('these, and only these, miss it', () => {
    // Why each one misses (`docs/what-is-still-open.md` § H.6.4 has the numbers):
    //   rug, plane        drawn at a fixed thickness whatever the height says.
    //   bed-single/double the headboard is 1.4 h, deliberately (`lib/scene-spec.ts`,
    //                     beside the bed's size range): the height is the mattress top.
    //   monitor           the screen's top is 0.96 h + 10 mm, up to 14 mm short.
    // `air-purifier` was here (a 14 mm control disc stood on its top) and is retired:
    // `airPurifierForm` sets the dial into the top, which is its declared height. So was
    // `laptop` (`h` was the lid's LENGTH, tilted back from a 20 mm hinge, 7 mm over):
    // `laptopForm` solves the lid's length for the open height.
    // None is a seat or a surface a seat tucks under.
    const misses = rows.filter((r) => r.worst > TOLERANCE_MM).map((r) => r.shape);
    expect(misses).toEqual(['rug', 'bed-single', 'bed-double', 'monitor', 'plane']);
  });
});

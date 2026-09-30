import { describe, it, expect } from 'vitest';
import { groupScaleForDim, isParametric, type ScenePart } from '@/lib/scene-spec';
import { renderBaseDim } from '@/lib/transforms';

// Three lines of arithmetic that lived inside `components/three/Draggable.tsx`,
// hand-written three times, where nothing could reach them. That is the `fanBlade`
// scar, and it produced the same kind of defect: `commit()` computed the size to
// store as "AUTHORED dim x live group scale", which is right for a shape that wears
// its resize as a scale and wrong for one that rebuilds its geometry — those sit at
// scale 1, so the answer came back as the authored size no matter what the user had
// done, and was written straight over the override. Resize a wardrobe, then merely
// MOVE it, and the width went home.

const AUTHORED: [number, number, number] = [1200, 600, 2000];
const RESIZED: [number, number, number] = [1800, 600, 2000];

const piece = (id: string, shape: ScenePart['shape']): ScenePart =>
  ({ id, name: id, category: 'wardrobe', shape, rot: 0, locked: false, dimMM: AUTHORED, pos: [0, 0, 0] }) as ScenePart;

/** The user has widened it; nothing else about it has been touched. */
const widened = { dims: { wide: RESIZED } };

describe('renderBaseDim — what a group is drawn at with scale 1', () => {
  it('a parametric shape is drawn at its EFFECTIVE size', () => {
    expect(isParametric('wardrobe')).toBe(true);
    expect(renderBaseDim(piece('wide', 'wardrobe'), widened)).toEqual(RESIZED);
  });

  it('everything else is drawn at its authored size and scaled to suit', () => {
    expect(isParametric('coffee-table')).toBe(false);
    expect(renderBaseDim(piece('wide', 'coffee-table'), widened)).toEqual(AUTHORED);
  });

  it('an untouched piece of either kind is drawn at its authored size', () => {
    expect(renderBaseDim(piece('other', 'wardrobe'), widened)).toEqual(AUTHORED);
    expect(renderBaseDim(piece('other', 'coffee-table'), widened)).toEqual(AUTHORED);
  });

  it('so a stretch from a parametric piece starts at scale 1', () => {
    // A stretch draws its size live as `groupScaleForDim(base, dim)`. The group of a
    // parametric piece sits at scale 1 with the resize in its geometry, so its base
    // must be the EFFECTIVE size — the authored one would scale an 1800 mm wardrobe
    // by 1.5 on the first frame of any pull, before the pointer had moved.
    const base = renderBaseDim(piece('wide', 'wardrobe'), widened);
    expect(groupScaleForDim(base, RESIZED)).toEqual([1, 1, 1]);
  });

  it('and one on a SCALED shape starts at the scale it already wears', () => {
    // The other half: a non-parametric piece carries its resize as the group scale,
    // so its base must stay authored or the resize would be applied twice.
    const base = renderBaseDim(piece('wide', 'coffee-table'), widened);
    expect(groupScaleForDim(base, RESIZED)).toEqual([1.5, 1, 1]);
  });
});

describe('the mm -> three.js axis mapping', () => {
  it('crosses depth and height', () => {
    // A `dimMM` is [width, DEPTH, HEIGHT]; a three.js scale is (x, y = up, z). The
    // fixture is deliberately asymmetric on all three axes — on a cube, or on
    // anything with two equal sides, a swapped mapping is invisible.
    const base: [number, number, number] = [1000, 500, 2000];
    const dim: [number, number, number] = [2000, 1500, 4000];
    expect(groupScaleForDim(base, dim)).toEqual([2, 2, 3]);
  });
});

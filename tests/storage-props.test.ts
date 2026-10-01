// The things drawn ON two storage pieces — shoes on a shoe rack, clothes on a rail —
// and the doors on a fridge, held to the outline the plan draws for the piece.
//
// The rule this file exists for is rule 2's first corollary: a renderer's geometry is
// authored at `part.dimMM`, so a prop that hangs past it is a piece drawn larger in 3D
// than on the plan. That arithmetic lives in `scene-spec.ts` (`shoeRow`, `clothesRail`,
// `fridgeDoors`) rather than in a TSX renderer precisely so it can be swept here — at
// the band's ends and the Library size, over several ids, because a seeded prop that
// fits one id is not evidence it fits the next.

import { describe, it, expect } from 'vitest';
import {
  shoeRow,
  SHOE_TIER_TILT,
  clothesRail,
  fridgeDoors,
  FRENCH_DOOR_MM,
  refineShape,
  moduleCount,
  MODULE_RANGE,
  PART_LIBRARY,
  type Category,
  type Shape,
} from '../lib/scene-spec';
import { clampDims, dimRangeFor } from '../lib/dimension-ranges';
import { DECOR } from '../lib/scene-palette';
import { sleepsTwo } from '../lib/layout-rules';

const IDS = ['a', 'rack-1', 'p_7f3c', 'lib-shoe', 'zz-99', 'x'];
const EPS = 1e-9;

function libraryDim(shape: Shape): [number, number, number] {
  const row = PART_LIBRARY.find((p) => p.shape === shape);
  if (!row) throw new Error(`no Library row for ${shape}`);
  return row.dimMM as [number, number, number];
}

const band = (category: Category, shape: Shape) => dimRangeFor(category, shape);

describe('shoeRow — the shoes stay on the rack', () => {
  const r = band('shelf', 'shoe-rack');
  const SIZES: Array<[string, number[]]> = [
    ['min', r.min],
    ['library', libraryDim('shoe-rack')],
    ['max', r.max],
    ['short and wide', [r.max[0], r.min[1], r.min[2]]],
    ['tall and narrow', [r.min[0], r.max[1], r.max[2]]],
  ];

  for (const [name, dim] of SIZES) {
    for (const id of IDS) {
      it(`${name} ${dim.join('×')} · ${id}: every shoe is inside the rack the plan draws`, () => {
        const [w, d, h] = dim.map((v) => v / 1000);
        const tiers = moduleCount(h, MODULE_RANGE['shoe-rack']!);
        const gap = h / tiers;
        const c = Math.cos(SHOE_TIER_TILT);
        const s = Math.sin(SHOE_TIER_TILT);
        const boxes = shoeRow({ id, dimMM: dim });
        for (const b of boxes) {
          expect(b.tier).toBeGreaterThanOrEqual(0);
          expect(b.tier).toBeLessThan(tiers);
          // Between the side rails' inner faces (30 mm in, 20 mm thick).
          expect(Math.abs(b.pos[0]) + b.size[0] / 2).toBeLessThanOrEqual(w / 2 - 0.04 + EPS);
          expect(Math.abs(b.pos[2]) + b.size[2] / 2).toBeLessThanOrEqual(d / 2 + EPS);
          // The tier group: rotated by −tilt about x, then lifted to (t + ½)·gap.
          for (const dy of [-1, 1]) {
            for (const dz of [-1, 1]) {
              const y = b.pos[1] + (dy * b.size[1]) / 2;
              const z = b.pos[2] + (dz * b.size[2]) / 2;
              const worldY = (b.tier + 0.5) * gap + y * c + z * s;
              expect(worldY).toBeGreaterThanOrEqual(-EPS);
              expect(worldY).toBeLessThanOrEqual(h + EPS);
            }
          }
          // (The top tier's `rise` allowance in `shoeRow` is spare rather than binding:
          // the tall box is the heel, which stands behind the tilt's pivot and so is
          // lowered by the lean, not raised. Removing it survives this sweep honestly.)
          // Not through the tier above: its slats' underside, in this tier's frame.
          if (b.tier < tiers - 1) expect(b.pos[1] + b.size[1] / 2).toBeLessThan(gap * c - 0.006);
        }
        // Every sole stands ON the slats (12 mm boards, so their top is 6 mm up).
        for (const b of boxes.filter((x) => x.sole)) expect(b.pos[1] - b.size[1] / 2).toBeCloseTo(0.006, 9);
      });
    }
  }

  it('is seeded by the part id: the same rack keeps its shoes, two racks differ', () => {
    const dim = libraryDim('shoe-rack');
    expect(shoeRow({ id: 'a', dimMM: dim })).toEqual(shoeRow({ id: 'a', dimMM: dim }));
    const sigs = new Set(IDS.map((id) => JSON.stringify(shoeRow({ id, dimMM: dim }))));
    expect(sigs.size).toBe(IDS.length);
  });

  it('leaves some slots empty and fills most of them', () => {
    // Six boxes per pair: sole, heel and toe for each shoe.
    const dim = libraryDim('shoe-rack');
    const counts = IDS.map((id) => shoeRow({ id, dimMM: dim }).length / 6);
    const full = Math.max(...IDS.map((id) => new Set(shoeRow({ id, dimMM: dim }).map((b) => `${b.tier}:${b.pos[0].toFixed(4)}`)).size / 2));
    for (const n of counts) {
      expect(n).toBeGreaterThan(0);
      expect(Number.isInteger(n)).toBe(true);
    }
    // Not every rack is wall to wall: across six ids at least one has a gap.
    const slotsPerRack = (() => {
      const [w, , h] = dim.map((v) => v / 1000);
      const len = Math.min(0.28, dim[1] / 1000 - 0.04);
      const pitch = len * 0.34 * 2 + 0.012 + 0.035;
      return Math.floor((w - 0.1) / pitch) * moduleCount(h, MODULE_RANGE['shoe-rack']!);
    })();
    expect(Math.min(...counts)).toBeLessThan(slotsPerRack);
    expect(full).toBeLessThanOrEqual(slotsPerRack);
  });

  it('draws boots on a tall rack, cut to the headroom each tier has', () => {
    // A boot's shaft is clipped to its tier's room rather than drawn through the slats
    // above — the per-box sweep holds the "not through"; this holds that the clip is
    // not so tight a boot never appears at all.
    const tallest = (dim: readonly number[]) =>
      Math.max(0, ...IDS.flatMap((id) => shoeRow({ id, dimMM: dim }).filter((b) => !b.sole).map((b) => b.pos[1] + b.size[1] / 2 - 0.006)));
    expect(tallest(r.max)).toBeGreaterThan(0.1);
    expect(tallest(libraryDim('shoe-rack'))).toBeGreaterThan(0.1);
  });

  it('returns nothing for a rack too small to hold a shoe, rather than a shoe through it', () => {
    expect(shoeRow({ id: 'a', dimMM: [250, 300, 900] })).toEqual([]);
    expect(shoeRow({ id: 'a', dimMM: [800, 150, 900] })).toEqual([]);
  });

  it('pairs every shoe colour with a sole colour, because the renderer indexes both by one length', () => {
    // ShoeRackGeo reads `(sole ? DECOR.sole : DECOR.shoe)[tone % DECOR.shoe.length]`.
    expect(DECOR.sole.length).toBe(DECOR.shoe.length);
  });
});

describe('clothesRail — the frame finishes at the outline, the clothes hang inside it', () => {
  const r = band('wardrobe', 'clothes-rack');
  const SIZES: Array<[string, number[]]> = [
    ['min', r.min],
    ['library', libraryDim('clothes-rack')],
    ['max', r.max],
    ['low and wide', [r.max[0], r.min[1], r.min[2]]],
    ['tall and narrow', [r.min[0], r.max[1], r.max[2]]],
  ];

  for (const [name, dim] of SIZES) {
    for (const id of IDS) {
      it(`${name} ${dim.join('×')} · ${id}`, () => {
        const [w, d, h] = dim.map((v) => v / 1000);
        const rail = clothesRail({ id, dimMM: dim });
        const { pipe, flange, postX, footY, topY, lowY, garments } = rail;
        // The flanges finish at the width and the depth; the top bar's crown is the height.
        expect(postX + flange).toBeCloseTo(w / 2, 9);
        expect(2 * flange).toBeLessThanOrEqual(d + EPS);
        expect(topY + pipe).toBeCloseTo(h, 9);
        // The foot pipe sits on its flange, the lower bar clears the foot pipe, the top
        // bar clears the lower bar.
        expect(footY - pipe).toBeCloseTo(flange, 9);
        expect(lowY - pipe).toBeGreaterThan(footY + pipe);
        expect(topY - pipe).toBeGreaterThan(lowY + pipe);
        let prevRight = -Infinity;
        for (const g of garments) {
          // between the uprights, never through one
          expect(g.x - g.thick / 2).toBeGreaterThanOrEqual(-postX + pipe - EPS);
          expect(g.x + g.thick / 2).toBeLessThanOrEqual(postX - pipe + EPS);
          // never through each other
          expect(g.x - g.thick / 2).toBeGreaterThanOrEqual(prevRight - EPS);
          prevRight = g.x + g.thick / 2;
          // inside the depth, hung below the bar, ending above the lower bar
          expect(g.width / 2).toBeLessThanOrEqual(d / 2 + EPS);
          expect(g.top).toBeLessThan(topY - pipe);
          expect(g.top - g.length).toBeGreaterThan(lowY + pipe);
          expect(g.length).toBeGreaterThan(0.15);
          expect(g.tone).toBeGreaterThanOrEqual(0);
        }
      });
    }
  }

  it('hangs clothes on the Library rail, the same ones each time', () => {
    const dim = libraryDim('clothes-rack');
    for (const id of IDS) {
      expect(clothesRail({ id, dimMM: dim }).garments.length).toBeGreaterThan(5);
      expect(clothesRail({ id, dimMM: dim })).toEqual(clothesRail({ id, dimMM: dim }));
    }
    const sigs = new Set(IDS.map((id) => JSON.stringify(clothesRail({ id, dimMM: dim }).garments)));
    expect(sigs.size).toBe(IDS.length);
  });

  it('a wider rail gains garments rather than wider ones', () => {
    for (const id of IDS) {
      const narrow = clothesRail({ id, dimMM: [r.min[0], 450, 1600] }).garments;
      const wide = clothesRail({ id, dimMM: [r.max[0], 450, 1600] }).garments;
      expect(wide.length).toBeGreaterThan(narrow.length);
      expect(Math.max(...wide.map((g) => g.thick))).toBeLessThanOrEqual(0.06);
    }
  });
});

describe('fridgeDoors — the doors follow the width, not the shape', () => {
  it('turns into a French door at 800 mm and not a millimetre before', () => {
    expect(FRENCH_DOOR_MM).toBe(800);
    expect(fridgeDoors(799)).toBe(1);
    expect(fridgeDoors(800)).toBe(2);
  });

  it('can reach both from the one Library fridge', () => {
    // One fridge is offered because one fridge resizes into the other; if its band
    // stopped short of 800 the French door would be a picture nobody could draw.
    const fridges = PART_LIBRARY.filter((p) => p.category === 'fridge' && p.shape === 'fridge');
    expect(fridges).toHaveLength(1);
    const f = band('fridge', 'fridge');
    expect(fridgeDoors(f.min[0])).toBe(1);
    expect(fridgeDoors(f.max[0])).toBe(2);
    expect(fridgeDoors(fridges[0].dimMM[0])).toBe(1);
  });
});

describe('refineShape — what a detector calls a clothes rail', () => {
  const RAIL = ['clothes rail', 'clothes rack', 'clothing rack', 'garment rack', 'garment rail', 'hanging rail', 'coat stand', 'clothes horse', 'Black pipe CLOTHES RAIL'];
  for (const cat of ['wardrobe', 'shelf'] as const) {
    for (const label of RAIL) {
      it(`${cat} · "${label}" → clothes-rack`, () => expect(refineShape(cat, label)).toBe('clothes-rack'));
    }
  }

  it('leaves a bare rack, a towel rail and a cabinet where they were', () => {
    expect(refineShape('shelf', 'rack')).toBe('bookshelf');
    expect(refineShape('shelf', 'shoe rack')).toBe('shoe-rack');
    expect(refineShape('shelf', 'towel rail')).toBe('bookshelf');
    expect(refineShape('shelf', 'closet')).toBe('wardrobe');
    expect(refineShape('wardrobe', 'wardrobe')).toBe('wardrobe');
    expect(refineShape('wardrobe', 'chest of drawers')).toBe('wardrobe');
    expect(refineShape('wardrobe', 'dresser')).toBe('wardrobe');
  });
});

describe('a room saved with the retired single bed still opens', () => {
  it('keeps bed-single a shape that clamps, refines and draws as one pillow', () => {
    const single: [number, number, number] = [900, 2000, 600];
    expect(clampDims('bed', 'bed-single', single)).toEqual(single);
    expect(refineShape('bed', 'single bed')).toBe('bed-single');
    expect(sleepsTwo({ dimMM: single })).toBe(false);
    // Off the Library is not off the vocabulary: a saved `bed-single` is not a dropped one.
    expect(PART_LIBRARY.some((p) => p.shape === 'bed-single')).toBe(false);
  });

  it('draws the one Library bed with two pillows, and with one when narrowed to a single', () => {
    const bed = PART_LIBRARY.find((p) => p.category === 'bed')!;
    expect(sleepsTwo(bed)).toBe(true);
    expect(sleepsTwo({ dimMM: clampDims('bed', bed.shape, [900, 2000, 600]) })).toBe(false);
  });
});

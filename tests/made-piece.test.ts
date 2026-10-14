import { describe, expect, it } from 'vitest';
import { explodeMade, fitMadeDims, layoutMade, MAX_MODULES, packMade, readMadeSpec, tileCount, type PackInput } from '../lib/made-piece';

// A two-seat workstation bay: one 1400 mm worktop on two drawer pedestals.
const bay = (rot = 0, at: [number, number] = [0, 0]): PackInput[] => {
  const place = (lx: number, lz: number): [number, number] => [
    at[0] + lx * Math.cos(rot) + lz * Math.sin(rot),
    at[1] - lx * Math.sin(rot) + lz * Math.cos(rot),
  ];
  const top = place(0, 0);
  const left = place(-0.5, 0.05);
  const right = place(0.5, 0.05);
  return [
    { shape: 'box', category: 'desk', pos: [top[0], 0.7, top[1]], rot, dimMM: [1400, 700, 30] },
    { shape: 'box', category: 'other', pos: [left[0], 0, left[1]], rot, dimMM: [400, 600, 700], color: '#aabbcc' },
    { shape: 'box', category: 'other', pos: [right[0], 0, right[1]], rot, dimMM: [400, 600, 700] },
  ];
};

describe('packMade', () => {
  it('derives the size from the blocks, never from a typed number', () => {
    const packed = packMade(bay())!;
    expect(packed.spec.sizeMM).toEqual([1400, 700, 730]);
    expect(packed.pos[1]).toBe(0);
    expect(packed.spec.blocks).toHaveLength(3);
    expect(packed.spec.blocks[1].color).toBe('#aabbcc');
  });

  it('packs a build assembled at an angle in its own frame, not its world box', () => {
    const rot = Math.PI / 5;
    const packed = packMade(bay(rot, [2, -1]))!;
    expect(packed.rot).toBeCloseTo(rot);
    expect(packed.spec.sizeMM).toEqual([1400, 700, 730]);
    expect(packed.pos[0]).toBeCloseTo(2, 6);
    expect(packed.pos[2]).toBeCloseTo(-1, 6);
    for (const b of packed.spec.blocks) expect(b.rot).toBe(0);
  });

  it('returns null for nothing', () => {
    expect(packMade([])).toBeNull();
  });
});

describe('explodeMade is packMade undone', () => {
  for (const rot of [0, Math.PI / 2, 2.4, -1.1]) {
    it(`round-trips every block at ${rot.toFixed(2)} rad`, () => {
      const parts = bay(rot, [1.5, 0.75]);
      const packed = packMade(parts)!;
      const back = explodeMade(
        { id: 'p', name: 'Bench', pos: packed.pos, rot: packed.rot, dimMM: packed.spec.sizeMM },
        packed.spec,
      );
      expect(back).toHaveLength(parts.length);
      back.forEach((b, i) => {
        expect(b.id).toBe(`p~${i}`);
        expect(b.dimMM).toEqual(parts[i].dimMM);
        for (let k = 0; k < 3; k++) expect(b.pos[k]).toBeCloseTo(parts[i].pos[k], 3);
        expect(Math.cos(b.rot - parts[i].rot)).toBeCloseTo(1, 6);
      });
    });
  }
});

describe('modular resize repeats the unit instead of stretching it', () => {
  const spec = { ...packMade(bay())!.spec, modular: true };

  it('snaps a width to whole modules, so the size shown is the size drawn', () => {
    expect(fitMadeDims(spec, [2600, 700, 730])).toEqual([2800, 700, 730]);
    expect(fitMadeDims(spec, [300, 700, 730])).toEqual([1400, 700, 730]);
  });

  it('draws two bays side by side at double width, each block at its own size', () => {
    const blocks = layoutMade(spec, [2800, 700, 730]);
    expect(blocks).toHaveLength(6);
    const tops = blocks.filter((b) => b.category === 'desk');
    expect(tops.map((b) => b.dimMM[0])).toEqual([1400, 1400]);
    expect(tops.map((b) => b.pos[0])).toEqual([-0.7, 0.7]);
  });

  it('caps the module count', () => {
    expect(tileCount(100, 1e9)).toBe(MAX_MODULES);
    expect(tileCount(0, 500)).toBe(1);
    expect(tileCount(400, Number.NaN)).toBe(1);
  });

  it('stretches a non-modular piece through its blocks dimensions, not a mesh scale', () => {
    const plain = packMade(bay())!.spec;
    const blocks = layoutMade(plain, [2800, 700, 730]);
    expect(blocks).toHaveLength(3);
    expect(blocks[0].dimMM[0]).toBe(2800);
    expect(blocks[1].pos[0]).toBeCloseTo(-1.0);
  });

  it('puts the width scale on a quarter-turned block’s depth', () => {
    const turned: PackInput[] = [
      { shape: 'box', category: 'desk', pos: [0, 0.7, 0], rot: 0, dimMM: [1400, 700, 30] },
      { shape: 'box', category: 'other', pos: [0.5, 0, 0], rot: Math.PI / 2, dimMM: [600, 400, 700] },
    ];
    const s = packMade(turned)!.spec;
    const [, side] = layoutMade(s, [s.sizeMM[0] * 2, s.sizeMM[1], s.sizeMM[2]]);
    expect(side.dimMM).toEqual([600, 800, 700]);
  });
});

describe('readMadeSpec — a saved piece is a hint with a filename', () => {
  it('drops unknown shapes and non-finite blocks, clamps sizes, and says how many it dropped', () => {
    const got = readMadeSpec({
      blocks: [
        { shape: 'box', category: 'desk', pos: [0, 0.7, 0], rot: 0, dimMM: [1400, 700, 30], color: '#ABCDEF' },
        { shape: 'teleporter', category: 'other', pos: [0, 0, 0], rot: 0, dimMM: [1, 1, 1] },
        { shape: 'box', category: 'other', pos: [Infinity, 0, 0], rot: 0, dimMM: [400, 600, 700] },
        { shape: 'box', category: 'other', pos: [0, 0, 0], rot: 0, dimMM: [400, 600, 1e9] },
      ],
      sizeMM: [1, 1, 1],
      modular: true,
    })!;
    expect(got.dropped).toBe(2);
    expect(got.spec.blocks).toHaveLength(2);
    expect(got.spec.blocks[0].color).toBe('#abcdef');
    expect(got.spec.blocks[1].dimMM[2]).toBeLessThan(1e9);
    expect(got.spec.modular).toBe(true);
    // The stored size was a lie; the derived one wins.
    expect(got.spec.sizeMM).not.toEqual([1, 1, 1]);
    expect(got.spec.sizeMM[0]).toBe(1400);
  });

  it('re-centres in the piece frame without turning anything', () => {
    const got = readMadeSpec({
      blocks: [{ shape: 'box', category: 'other', pos: [1, 0.2, 1], rot: 0.5, dimMM: [400, 400, 400] }],
    })!;
    expect(got.spec.blocks[0].pos).toEqual([0, 0, 0]);
    expect(got.spec.blocks[0].rot).toBeCloseTo(0.5);
  });

  it('keeps a block style only where that block owns the option, and only in vocabulary', () => {
    const got = readMadeSpec({
      blocks: [
        { shape: 'worktop', category: 'desk', pos: [0, 0, 0], rot: 0, dimMM: [1400, 700, 740], blockStyle: { ends: 'panel', band: 'glass' } },
        { shape: 'screen', category: 'other', pos: [0, 0, 0.4], rot: 0, dimMM: [1400, 30, 1200], blockStyle: { band: 'neon' } },
        { shape: 'box', category: 'other', pos: [0, 0, 0], rot: 0, dimMM: [400, 400, 400], blockStyle: { ends: 'legs' } },
      ],
    })!;
    expect(got.spec.blocks[0].blockStyle).toEqual({ ends: 'panel' });
    expect(got.spec.blocks[1].blockStyle).toBeUndefined();
    expect(got.spec.blocks[2].blockStyle).toBeUndefined();
  });

  it('refuses nothing usable', () => {
    expect(readMadeSpec(null)).toBeNull();
    expect(readMadeSpec({ blocks: 'x' })).toBeNull();
    expect(readMadeSpec({ blocks: [{ shape: 'nope' }] })).toBeNull();
  });
});

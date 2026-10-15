import { describe, expect, it } from 'vitest';
import { buildSceneFile, parseSceneFile, sceneFileJson } from '../lib/scene-file';
import type { RoomData, Transforms } from '../lib/storage';
import type { ScenePart } from '../lib/scene-spec';
import { clampDims, dimRangeFor } from '../lib/dimension-ranges';
import { seeksSurface } from '../lib/physics';
import { explodeMade, fitMadeDims, fitPartDims, layoutMade, MAX_MODULES, packMade, readMadeSpec, tileCount, type PackInput } from '../lib/made-piece';

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

  it('stores a modular piece at whole copies and leaves every other part alone', () => {
    expect(fitPartDims({ made: spec }, [2600, 700, 730])).toEqual([2800, 700, 730]);
    expect(fitPartDims({}, [2600, 700, 730])).toEqual([2600, 700, 730]);
  });

  it('caps the module count', () => {
    expect(tileCount(100, 1e9)).toBe(MAX_MODULES);
    expect(tileCount(0, 500)).toBe(1);
    expect(tileCount(400, Number.NaN)).toBe(1);
  });

  it('stretches a non-modular piece through its blocks dimensions, not a mesh scale', () => {
    const plain = packMade(bay())!.spec;
    const blocks = layoutMade(plain, [2100, 700, 730]);
    expect(blocks).toHaveLength(3);
    expect(blocks[0].dimMM[0]).toBe(2100);
    expect(blocks[1].pos[0]).toBeCloseTo(-0.75);
  });

  it('puts the width scale on a quarter-turned block’s depth', () => {
    const turned: PackInput[] = [
      { shape: 'box', category: 'desk', pos: [0, 0.7, 0], rot: 0, dimMM: [1400, 700, 30] },
      { shape: 'box', category: 'other', pos: [0.5, 0, 0], rot: Math.PI / 2, dimMM: [600, 400, 700] },
    ];
    const s = packMade(turned)!.spec;
    const [, side] = layoutMade(s, [s.sizeMM[0] * 1.5, s.sizeMM[1], s.sizeMM[2]]);
    expect(side.dimMM).toEqual([600, 600, 700]);
  });
});

// Rule 2 inside a made piece: no block is ever drawn — or taken apart into — a size
// `clampDims` would refuse it. Found in review: two 1400 mm worktops widened to 12 m came
// apart as two 6 m worktops against a 3 m maximum.
describe('a made piece never sizes a block past its own range', () => {
  const twoTops = packMade([
    { shape: 'worktop', category: 'desk', pos: [-0.7, 0, 0], rot: 0, dimMM: [1400, 700, 740] },
    { shape: 'worktop', category: 'desk', pos: [0.7, 0, 0], rot: 0, dimMM: [1400, 700, 740] },
  ])!.spec;

  it('stops widening where a block reaches its maximum', () => {
    const fitted = fitMadeDims(twoTops, [12000, 700, 740]);
    expect(fitted[0]).toBe(6000);
    for (const b of layoutMade(twoTops, [12000, 700, 740])) {
      expect(b.dimMM).toEqual(clampDims(b.category, b.shape, b.dimMM));
    }
  });

  it('takes apart into blocks inside their range', () => {
    const piece = { id: 'p', name: 'P', pos: [0, 0, 0] as [number, number, number], rot: 0, dimMM: [12000, 700, 740] as [number, number, number] };
    for (const b of explodeMade(piece, twoTops)) expect(b.dimMM[0]).toBe(3000);
  });

  it('stops shrinking at a block minimum too', () => {
    expect(fitMadeDims(twoTops, [100, 700, 740])[0]).toBe(twoTops.sizeMM[0] * (dimRangeFor('desk', 'worktop').min[0] / 1400));
  });

  it('never rounds a modular width past the made range', () => {
    const unit = { ...twoTops, sizeMM: [1400, 700, 740] as [number, number, number], modular: true };
    // 12 m / 1.4 m rounds to nine copies — 12.6 m. Eight is the most that fits.
    expect(fitMadeDims(unit, [12000, 700, 740])[0]).toBe(8 * 1400);
    expect(fitMadeDims(unit, [12000, 700, 740])[0]).toBeLessThanOrEqual(dimRangeFor('other', 'made').max[0]);
  });
});

describe('readMadeSpec — a saved piece is a hint with a filename', () => {
  it('refuses what packing would: a piece inside a piece, or one that hangs', () => {
    const ok = { shape: 'drawer-unit', category: 'shelf', pos: [0, 0, 0], rot: 0, dimMM: [400, 500, 600] };
    const out = readMadeSpec({
      blocks: [
        ok,
        { ...ok, shape: 'tv', category: 'tv', dimMM: [1200, 60, 700] },
        { ...ok, shape: 'made', category: 'other' },
      ],
    })!;
    expect(out.spec.blocks.map((b) => b.shape)).toEqual(['drawer-unit']);
    expect(out.dropped).toBe(2);
  });

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

describe('a room file carries a made piece', () => {
  const ROOM: RoomData = {
    id: 'room-1', createdAt: 1_700_000_000_000, name: 'Studio', layoutId: 'rect', width: 5, depth: 4, height: 2.6,
  };
  const NONE: Transforms = { positions: {}, rotations: {}, dims: {} };
  // Real blocks, so every size is inside its own band and the read changes nothing.
  const packed = packMade([
    { shape: 'worktop', category: 'desk', pos: [0, 0, 0], rot: 0, dimMM: [1400, 700, 740], blockStyle: { ends: 'none' } },
    { shape: 'drawer-unit', category: 'shelf', pos: [-0.45, 0, 0.05], rot: 0, dimMM: [400, 500, 600], color: '#aabbcc' },
    { shape: 'drawer-unit', category: 'shelf', pos: [0.45, 0, 0.05], rot: 0, dimMM: [400, 500, 600] },
  ])!;
  const piece: ScenePart = {
    id: 'bench', name: 'Bench', category: 'desk', shape: 'made', pos: packed.pos, rot: packed.rot,
    dimMM: packed.spec.sizeMM, locked: false, made: packed.spec,
  };
  const raw = (parts: unknown[]) =>
    JSON.stringify({
      format: 'danmu.scene', version: 1, exportedAt: 1,
      room: { name: 'R', layoutId: 'rect', width: 5, depth: 4, height: 2.6 },
      parts,
    });

  it('writes the blocks and reads them back unchanged', () => {
    const out = parseSceneFile(sceneFileJson(buildSceneFile(ROOM, [piece], NONE, 1)));
    if (!out.ok) throw new Error(out.error);
    expect(out.dropped).toEqual([]);
    expect(out.file.parts[0].shape).toBe('made');
    expect(out.file.parts[0].made).toEqual(packed.spec);
  });

  it('opens a made piece with no readable blocks as a plain box, and says so', () => {
    const out = parseSceneFile(raw([{ ...piece, made: { blocks: [{ shape: 'nope' }] } }]));
    if (!out.ok) throw new Error(out.error);
    expect(out.file.parts[0].shape).toBe('box');
    expect(out.file.parts[0].made).toBeUndefined();
    expect(out.dropped.join(' ')).toMatch(/plain box/);
  });

  it('names how many blocks it left out', () => {
    const blocks = [...packed.spec.blocks, { shape: 'teleporter', category: 'other', pos: [0, 0, 0], rot: 0, dimMM: [1, 1, 1] }];
    const out = parseSceneFile(raw([{ ...piece, made: { ...packed.spec, blocks } }]));
    if (!out.ok) throw new Error(out.error);
    expect(out.file.parts[0].made?.blocks).toHaveLength(3);
    expect(out.dropped.join(' ')).toMatch(/1 block /);
  });

  it('opens an unreadable piece as a box inside a box’s own limits', () => {
    const out = parseSceneFile(raw([{ ...piece, dimMM: [9000, 5000, 900], made: { blocks: [] } }]));
    if (!out.ok) throw new Error(out.error);
    const p = out.file.parts[0];
    expect(p.shape).toBe('box');
    expect(p.dimMM).toEqual(clampDims(p.category, 'box', [9000, 5000, 900]));
  });

  it('opens a modular piece at whole copies, whatever width the file says', () => {
    const modular = { ...packed.spec, modular: true };
    const out = parseSceneFile(raw([{ ...piece, made: modular, dimMM: [2000, ...packed.spec.sizeMM.slice(1)] }]));
    if (!out.ok) throw new Error(out.error);
    expect(out.file.parts[0].dimMM[0]).toBe(packed.spec.sizeMM[0]);
  });

  it('ignores a made field on any other shape', () => {
    const out = parseSceneFile(raw([{ ...piece, shape: 'box', made: packed.spec }]));
    if (!out.ok) throw new Error(out.error);
    expect(out.file.parts[0].made).toBeUndefined();
  });
});

// A made piece is filed under `other`, which is tabletop-prone — so a saved 750 mm bench
// added over a desk used to be stood ON the desk like a lamp.
describe('a made piece stands on the floor', () => {
  it('does not seek a surface, where an ornament of its category and size would', () => {
    expect(seeksSurface('other', 'box', [1200, 600, 750])).toBe(true);
    expect(seeksSurface('other', 'made', [1200, 600, 750])).toBe(false);
  });
});

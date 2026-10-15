import { describe, expect, it } from 'vitest';
import { madeSpecAsShown, packRefusal, planPack, planTakeApart } from '@/lib/made-actions';
import type { ScenePart } from '@/lib/scene-spec';

const part = (id: string, p: Partial<ScenePart> & Pick<ScenePart, 'shape' | 'category' | 'dimMM'>): ScenePart => ({
  id, name: id, pos: [0, 0, 0], rot: 0, locked: false, ...p,
});
const top = part('top', { shape: 'worktop', category: 'desk', dimMM: [1400, 700, 740], color: '#112233' });
const left = part('l', { shape: 'drawer-unit', category: 'shelf', dimMM: [400, 500, 600], pos: [-0.45, 0, 0.05] });
const right = part('r', { shape: 'drawer-unit', category: 'shelf', dimMM: [400, 500, 600], pos: [0.45, 0, 0.05] });
const tv = part('tv', { shape: 'tv', category: 'tv', dimMM: [1200, 60, 700], pos: [0, 1.4, -1], wallMounted: true });

describe('what can become a piece', () => {
  it('needs two pieces, or one made piece', () => {
    expect(packRefusal([top])).toMatch(/two or more/);
    expect(packRefusal([top, left])).toBeNull();
  });

  it('refuses anything hung on a wall, and names it', () => {
    expect(packRefusal([top, tv])).toMatch(/“tv”/);
  });
});

describe('planPack', () => {
  it('swaps the blocks for one made piece standing where they stood', () => {
    const plan = planPack([top, left, right], {}, 'Bench', false, 'made-1')!;
    expect(plan.remove).toEqual(['top', 'l', 'r']);
    expect(plan.add).toHaveLength(1);
    const piece = plan.add[0];
    expect(piece.shape).toBe('made');
    expect(piece.name).toBe('Bench');
    expect(piece.dimMM).toEqual([1400, 700, 740]);
    expect(piece.made!.blocks).toHaveLength(3);
    expect(plan.select).toEqual(['made-1']);
  });

  it('hands what rode a block to the piece, and drops edges among the blocks', () => {
    const plan = planPack([top, left, right], { lamp: 'top', l: 'top' }, 'Bench', false, 'made-1')!;
    expect(plan.reparent).toEqual({ lamp: 'made-1' });
  });

  it('opens a made piece in the selection rather than nesting it', () => {
    const inner = planPack([top, left], {}, 'Half', false, 'made-1')!.add[0];
    const plan = planPack([inner, right], {}, 'Whole', false, 'made-2')!;
    expect(plan.add[0].made!.blocks.map((b) => b.shape)).toEqual(['worktop', 'drawer-unit', 'drawer-unit']);
  });

  it('keeps modular when asked', () => {
    expect(planPack([top, left], {}, 'Bay', true)!.add[0].made!.modular).toBe(true);
  });
});

describe('planTakeApart is planPack undone', () => {
  it('puts every block back where it was, grouped and selected', () => {
    const piece = planPack([top, left, right], {}, 'Bench', false, 'made-1')!.add[0];
    const plan = planTakeApart(piece, { lamp: 'made-1', other: 'sofa' }, 'grp-1')!;
    expect(plan.remove).toEqual(['made-1']);
    expect(plan.add.map((b) => b.shape)).toEqual(['worktop', 'drawer-unit', 'drawer-unit']);
    plan.add.forEach((b, i) => {
      const was = [top, left, right][i];
      for (let k = 0; k < 3; k++) expect(b.pos[k]).toBeCloseTo(was.pos[k], 3);
      expect(b.dimMM).toEqual(was.dimMM);
      expect(b.groupId).toBe('grp-1');
    });
    expect(plan.add[0].color).toBe('#112233');
    expect(plan.reparent).toEqual({ lamp: null });
    expect(plan.select).toEqual(plan.add.map((b) => b.id));
  });

  it('paints every block in a colour chosen for the whole piece', () => {
    const piece = { ...planPack([top, left], {}, 'Bench', false, 'made-1')!.add[0], color: '#445566' };
    expect(planTakeApart(piece, {})!.add.every((b) => b.color === '#445566')).toBe(true);
  });

  it('does nothing to a part that is not a made piece', () => {
    expect(planTakeApart(top, {})).toBeNull();
  });
});

describe('madeSpecAsShown saves what the room shows', () => {
  const spec = planPack([top, left, right], {}, 'Desk', false)!.add[0].made!;
  const mk = (extra: Partial<ScenePart>) => ({ dimMM: spec.sizeMM, made: spec, ...extra });

  it('is the authored spec when nothing was changed', () => {
    const out = madeSpecAsShown(mk({}), false)!;
    expect(out.sizeMM).toEqual(spec.sizeMM);
    expect(out.blocks.map((b) => b.dimMM)).toEqual(spec.blocks.map((b) => b.dimMM));
  });

  it('carries a size override and a colour override', () => {
    const [w, d, h] = spec.sizeMM;
    const out = madeSpecAsShown(mk({ dimMM: [w * 1.25, d, h], color: '#abcdef' }), false)!;
    expect(out.sizeMM).toEqual([w * 1.25, d, h]);
    expect(out.blocks.every((b) => b.color === '#abcdef')).toBe(true);
    expect(out.blocks[0].dimMM[0]).toBeGreaterThan(spec.blocks[0].dimMM[0]);
  });

  it('keeps a modular piece at its unit width, scaling depth and height only', () => {
    const modular = { ...spec, modular: true as const };
    const [w, d, h] = spec.sizeMM;
    const out = madeSpecAsShown({ dimMM: [w * 3, d * 1.1, h], made: modular }, true)!;
    expect(out.sizeMM).toEqual([w, d * 1.1, h]);
    expect(out.blocks).toHaveLength(spec.blocks.length);
    expect(out.modular).toBe(true);
  });

  it('saves every copy of a modular piece saved whole, each block at its own width', () => {
    const modular = { ...spec, modular: true as const };
    const [w, d, h] = spec.sizeMM;
    const out = madeSpecAsShown({ dimMM: [w * 3, d, h], made: modular }, false)!;
    expect(out.sizeMM).toEqual([w * 3, d, h]);
    expect(out.blocks).toHaveLength(spec.blocks.length * 3);
    expect(out.blocks.map((b) => b.dimMM)).toEqual([...spec.blocks, ...spec.blocks, ...spec.blocks].map((b) => b.dimMM));
  });

  it('saves the size the room draws, not an override past what the blocks allow', () => {
    const [w, d, h] = spec.sizeMM;
    // A drawer unit stops at 600 mm wide, so a 400 mm one bounds the piece at 1.5×.
    const out = madeSpecAsShown(mk({ dimMM: [w * 2, d, h] }), false)!;
    expect(out.sizeMM).toEqual([w * 1.5, d, h]);
  });
});

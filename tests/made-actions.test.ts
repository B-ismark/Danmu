import { describe, expect, it } from 'vitest';
import { packRefusal, planPack, planTakeApart } from '@/lib/made-actions';
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

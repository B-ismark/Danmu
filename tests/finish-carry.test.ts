// A finish someone chose has to survive every path that hands a piece to a different
// model or a different container: a model swap, packing blocks into a made piece,
// taking it apart, and saving it to the shelf. Colour already did; each of these
// paths dropped the finish while keeping the colour, which is the asymmetry a person
// sees. And a finish the new model has no surface for must NOT ride along invisibly.

import { describe, expect, it } from 'vitest';
import { useScene } from '@/lib/scene-store';
import { explodeMade, packMade, readMadeSpec } from '@/lib/made-piece';
import { madeSpecAsShown, planPack } from '@/lib/made-actions';
import { finishAxes, resolvePartFinish } from '@/lib/part-finish';
import type { ScenePart } from '@/lib/scene-spec';

const part = (over: Partial<ScenePart>): ScenePart =>
  ({ id: 'p', name: 'Piece', shape: 'worktop', category: 'desk', dimMM: [1200, 600, 30], pos: [0, 0.72, 0], rot: 0, locked: false, ...over }) as ScenePart;

describe('a model swap', () => {
  it('drops the velvet a bookshelf cannot show and keeps the paint it can', () => {
    useScene.setState({ parts: [part({ id: 'a', shape: 'sofa', category: 'sofa', dimMM: [2000, 850, 800], pos: [0, 0, 0], fabricFinish: 'velvet', woodFinish: 'painted' })] });
    useScene.getState().updatePart('a', { shape: 'bookshelf', category: 'shelf' });
    const p = useScene.getState().parts[0];
    expect(p.fabricFinish).toBeUndefined();
    expect(p.woodFinish).toBe('painted');
  });

  it('a patch that does not change the model leaves finishes alone', () => {
    useScene.setState({ parts: [part({ id: 'a', shape: 'sofa', category: 'sofa', fabricFinish: 'velvet' })] });
    useScene.getState().updatePart('a', { name: 'Couch' });
    expect(useScene.getState().parts[0].fabricFinish).toBe('velvet');
  });
});

describe('made pieces', () => {
  const top = part({ id: 't', shape: 'worktop', category: 'desk', dimMM: [1200, 600, 30], pos: [0, 0.72, 0], woodFinish: 'lacquered' });
  const drawers = part({ id: 'd', shape: 'drawer-unit', category: 'desk', dimMM: [400, 550, 700], pos: [-0.35, 0, 0], woodFinish: 'lacquered' });

  it('packing keeps each block finish, and the piece reads as what it is drawn in', () => {
    const plan = planPack([top, drawers], {}, 'Desk', false, 'made-x');
    const piece = plan!.add[0];
    expect(piece.made!.blocks.every((b) => b.woodFinish === 'lacquered')).toBe(true);
    expect(finishAxes(piece).wood).toBe(true);
    expect(resolvePartFinish(piece).wood).toBe('lacquered');
  });

  it('blocks that disagree read as the default until the piece is given one', () => {
    const plan = planPack([top, { ...drawers, woodFinish: 'painted' }], {}, 'Desk', false, 'made-x');
    expect(resolvePartFinish(plan!.add[0]).wood).toBe('natural');
  });

  it('taking it apart hands the finish back to each block', () => {
    const packed = packMade([top, drawers])!;
    const blocks = explodeMade({ id: 'm', name: 'Desk', pos: packed.pos, rot: packed.rot, dimMM: packed.spec.sizeMM }, packed.spec);
    expect(blocks.map((b) => b.woodFinish)).toEqual(['lacquered', 'lacquered']);
  });

  it('a finish chosen for the whole piece is what it saves to the shelf as', () => {
    const packed = packMade([top, drawers])!;
    const spec = madeSpecAsShown({ dimMM: packed.spec.sizeMM, made: packed.spec, woodFinish: 'painted' }, false)!;
    expect(spec.blocks.map((b) => b.woodFinish)).toEqual(['painted', 'painted']);
    // …and survives the shelf's reader.
    expect(readMadeSpec(JSON.parse(JSON.stringify(spec)))!.spec.blocks.map((b) => b.woodFinish)).toEqual(['painted', 'painted']);
  });

  it('a block keeps only a finish its shape can show, through the reader too', () => {
    const packed = packMade([{ ...top, fabricFinish: 'velvet' }])!;
    expect(packed.spec.blocks[0].fabricFinish).toBeUndefined();
    const raw = { ...packed.spec, blocks: [{ ...packed.spec.blocks[0], fabricFinish: 'velvet', woodFinish: 'gilded' }] };
    const read = readMadeSpec(raw)!.spec.blocks[0];
    expect(read.fabricFinish).toBeUndefined();
    expect(read.woodFinish).toBeUndefined();
  });
});

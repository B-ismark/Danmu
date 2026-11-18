// A piece's wood and fabric finish (`lib/part-finish.ts`, applied by
// `components/three/part-finish.tsx`). Three questions, each with a history:
//
//   · WHICH pieces get a control is read off what each one DRAWS, by walking every
//     shape's rendered tree and collecting the surfaces it asks for. Both directions
//     fail: a shape that draws wood with no Wood control is a finish the user cannot
//     reach, and a Wood control on a shape that draws none does nothing — which is the
//     exact defect that had a Finish row deleted from the Inspector once (Design.md,
//     "it changed nothing a person could see").
//   · Every option must be VISIBLY different from the default, measured on the numbers
//     the renderer is handed, not argued. The table prints on every green run.
//   · No finish chosen is no change: the same preset, the same roughness, no provider.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/store', () => ({
  useStudio: (sel: (s: unknown) => unknown) => sel({ dims: {}, openState: {}, hidden: {}, quality: 'high' }),
}));
// A STABLE mock: each preset is one object that names itself, so the walk can say which
// preset an instanced set was handed. The geometry tests' `new Proxy(… () => ({}))`
// returns a fresh anonymous object per read, which is right for them and blind here.
vi.mock('@/components/three/materials', () => {
  const made: Record<string, object> = {};
  return {
    SURFACE: new Proxy({}, { get: (_t, k) => (made[String(k)] ??= { __key: String(k) }) }),
    PHYSICAL_SURFACES: ['fabric', 'velvet', 'boucle'],
  };
});

import { PartGeometry } from '@/components/three/DynamicPart';
import { finishChoice, finishedSurface } from '@/components/three/part-finish';
import { SHAPES, PART_LIBRARY, type Shape, type ScenePart, type Category } from '@/lib/scene-spec';
import { dimRangeFor } from '@/lib/dimension-ranges';
import {
  FABRIC_FINISHES,
  FABRIC_SHAPES,
  WOOD_FINISHES,
  WOOD_SHAPES,
  finishAxes,
  finishesFor,
  readPartFinishes,
  resolvePartFinish,
} from '@/lib/part-finish';
import { walk } from './helpers/geometry-walk';
import { buildSceneFile, parseSceneFile, sceneFileJson } from '@/lib/scene-file';
import type { RoomData } from '@/lib/storage';

const categoryOf = (shape: Shape): Category => PART_LIBRARY.find((l) => l.shape === shape)?.category ?? 'other';

const partAt = (shape: Shape, dimMM: [number, number, number]): ScenePart =>
  ({ id: `probe-${shape}`, name: shape, shape, category: categoryOf(shape), dimMM, pos: [0, 0, 0], rot: 0, color: '#b07a52' }) as unknown as ScenePart;

/** Every surface a shape draws, over its smallest, Library and largest size — a
 *  renderer may add a part (a frame, a cushion) only past some width. */
function surfacesOf(shape: Shape): Set<string> {
  const r = dimRangeFor(categoryOf(shape), shape);
  const lib = PART_LIBRARY.find((l) => l.shape === shape)?.dimMM as [number, number, number] | undefined;
  const out = new Set<string>();
  for (const dim of [r.min, lib, r.max]) {
    if (!dim) continue;
    const rep = walk(PartGeometry({ part: partAt(shape, dim as [number, number, number]), locked: false }));
    expect(rep.threw, `${shape} threw`).toEqual({});
    expect(rep.unhandled, `${shape} unhandled`).toEqual({});
    for (const s of rep.surfaces) out.add(s);
  }
  return out;
}

// `made` is excluded: it draws nothing of its own, and `finishAxes` answers for it from
// its blocks (tested below).
const WALKED = SHAPES.filter((s) => s !== 'made');
const DRAWN = new Map(WALKED.map((s) => [s, surfacesOf(s)] as const));
const derived = (keys: string[]) => WALKED.filter((s) => keys.some((k) => DRAWN.get(s)!.has(k))).sort();

describe('which pieces get a finish control', () => {
  it('Wood is offered exactly on the shapes that draw wood', () => {
    expect([...WOOD_SHAPES].sort()).toEqual(derived(['wood', 'woodSatin']));
  });

  it('Fabric is offered exactly on the shapes that draw fabric', () => {
    expect([...FABRIC_SHAPES].sort()).toEqual(derived(['fabric']));
  });

  it('a made piece gets whatever its blocks have', () => {
    const made = (shapes: Shape[]) =>
      finishAxes({ shape: 'made', made: { blocks: shapes.map((shape) => ({ shape })) } } as unknown as ScenePart);
    expect(made(['box'])).toEqual({ wood: false, fabric: false });
    expect(made(['box', 'coffee-table'])).toEqual({ wood: true, fabric: false });
    expect(made(['seat-pad', 'stool'])).toEqual({ wood: true, fabric: true });
  });

  it('the walk can see a finished piece through its provider', () => {
    const part = { ...partAt('sofa', PART_LIBRARY.find((l) => l.shape === 'sofa')!.dimMM as [number, number, number]), fabricFinish: 'velvet' } as ScenePart;
    const rep = walk(PartGeometry({ part, locked: false }));
    expect(rep.descended.Context).toBe(1);
    expect(rep.prims.length).toBeGreaterThan(0);
    expect(rep.unhandled).toEqual({});
  });
});

describe('absent is unchanged', () => {
  it('no choice → no provider, and every surface is the one asked for', () => {
    expect(finishChoice(undefined, undefined)).toBeUndefined();
    for (const k of ['wood', 'woodSatin', 'fabric', 'metal'] as const) {
      expect(finishedSurface(k, undefined)).toEqual({ key: k, owns: false });
      expect(finishedSurface(k, { wood: 'natural', fabric: 'linen' })).toEqual({ key: k, owns: false });
    }
  });

  it('a finish replaces only its own material', () => {
    const f = { wood: 'lacquered', fabric: 'velvet' } as const;
    expect(finishedSurface('wood', f)).toEqual({ key: 'woodLacquer', owns: true });
    expect(finishedSurface('woodSatin', f)).toEqual({ key: 'woodLacquer', owns: true });
    expect(finishedSurface('fabric', f)).toEqual({ key: 'velvet', owns: true });
    expect(finishedSurface('metal', f)).toEqual({ key: 'metal', owns: false });
    expect(finishedSurface('fabric', { wood: 'painted' })).toEqual({ key: 'fabric', owns: false });
  });

  it('one context value per combination, so a re-render does not re-provide', () => {
    expect(finishChoice('painted', undefined)).toBe(finishChoice('painted', undefined));
    expect(finishChoice('painted', 'boucle')).not.toBe(finishChoice('painted', undefined));
  });

  it('resolves to Natural and Linen', () => {
    expect(resolvePartFinish({})).toEqual({ wood: 'natural', fabric: 'linen' });
  });
});

describe('reading from a file', () => {
  it('keeps what is on the list and says what it dropped', () => {
    const dropped: string[] = [];
    expect(readPartFinishes({ woodFinish: 'painted', fabricFinish: 'boucle' }, { wood: true, fabric: true }, 'Sofa', dropped)).toEqual({
      woodFinish: 'painted',
      fabricFinish: 'boucle',
    });
    expect(dropped).toEqual([]);
    expect(readPartFinishes({ woodFinish: 'gilded', fabricFinish: 7 }, { wood: true, fabric: true }, 'Sofa', dropped)).toEqual({});
    expect(dropped).toHaveLength(2);
    expect(dropped[0]).toMatch(/Sofa.*wood/);
  });

  it('absent says nothing', () => {
    const dropped: string[] = [];
    expect(readPartFinishes({}, { wood: true, fabric: true }, 'Sofa', dropped)).toEqual({});
    expect(dropped).toEqual([]);
  });

  it('drops, and says, a finish the piece has no surface for', () => {
    const dropped: string[] = [];
    expect(readPartFinishes({ woodFinish: 'lacquered', fabricFinish: 'velvet' }, finishAxes({ shape: 'tv' }), 'TV', dropped)).toEqual({});
    expect(dropped).toHaveLength(2);
    expect(dropped.join(' ')).toMatch(/TV has no wood/);
    expect(dropped.join(' ')).toMatch(/TV has no upholstery/);
  });

  it('a room file drops an off-surface finish and keeps an on-surface one', () => {
    const room: RoomData = { id: 'r', createdAt: 1, name: 'Den', layoutId: 'rect', width: 4, depth: 3, height: 2.6 };
    const parts = [
      { id: 't', name: 'TV', shape: 'tv', category: 'tv', dimMM: [1200, 80, 700], pos: [0, 1, 0], rot: 0, woodFinish: 'lacquered' },
      { id: 's', name: 'Sofa', shape: 'sofa', category: 'sofa', dimMM: [2000, 850, 800], pos: [1, 0, 0], rot: 0, fabricFinish: 'velvet' },
    ];
    const out = parseSceneFile(sceneFileJson(buildSceneFile(room, parts as never, { positions: {}, rotations: {}, dims: {} }, 2)));
    if (!out.ok) throw new Error(out.error);
    expect(out.file.parts.find((p) => p.name === 'TV')?.woodFinish).toBeUndefined();
    expect(out.file.parts.find((p) => p.name === 'Sofa')?.fabricFinish).toBe('velvet');
    expect(out.dropped.join(' ')).toMatch(/TV has no wood/);
  });
});

describe('a finish across a change of model', () => {
  it('keeps only the surfaces the new model has', () => {
    expect(finishesFor({ shape: 'bookshelf' }, { woodFinish: 'painted', fabricFinish: 'velvet' })).toEqual({ woodFinish: 'painted' });
    expect(finishesFor({ shape: 'chair-armchair' }, { woodFinish: 'painted', fabricFinish: 'velvet' })).toEqual({
      woodFinish: 'painted',
      fabricFinish: 'velvet',
    });
    expect(finishesFor({ shape: 'tv' }, { woodFinish: 'painted', fabricFinish: 'velvet' })).toEqual({});
  });
});

// Two holes the derivation above cannot see, because it asks which surfaces a shape
// draws, not whether each wooden surface goes through a finishable preset.
describe('the finish reaches every board', () => {
  const src = readFileSync(join(process.cwd(), 'components/three/DynamicPart.tsx'), 'utf8');

  it('no wood-coloured surface is drawn with an inline material the finish cannot see', () => {
    // `finishedPreset` matches presets by identity, so `surface={{ roughness }}` beside
    // a wood colour stays matte under Lacquered — how a shoe rack's 40 slats ignored the
    // finish its posts took. The hangers are the one exemption: a clothes rack has no
    // wood control (its wood is the hangers, which nobody would call the rack's finish).
    const inline = [...src.matchAll(/color=\{(\w*[wW]ood\w*)\}\s+surface=\{\{/g)].map((m) => m[1]);
    expect(inline).toEqual(['hangerWood']);
    expect(FABRIC_SHAPES.has('clothes-rack') && !WOOD_SHAPES.has('clothes-rack')).toBe(true);
  });

  it('choosing a first finish does not remount the piece', () => {
    // A provider rendered only when a finish exists flips the root's element type, and
    // React remounts every mesh: shadows flagged once by `ShadowCaster` were lost.
    expect(src).not.toMatch(/\?\s*<PartFinishContext/);
  });
});

describe('the vocabularies', () => {
  it('the vocabularies are the ones the options read', () => {
    expect(WOOD_FINISHES[0]).toBe('natural');
    expect(FABRIC_FINISHES[0]).toBe('linen');
  });
});

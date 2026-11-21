// A curtain can be drawn across its window or folded up, tied back at each end of the
// rod. Open is a different CLOTH, not a different box: the piece keeps its size, so it
// still hangs, collides and re-hangs over a resized window exactly as before, and only
// what is drawn inside that box changes. This holds the three things that make it so —
// the open cloth stays inside the curtain's box, it really does clear the window between
// the stacks, and the choice survives a room file.
import { describe, expect, it } from 'vitest';
import { curtainCloth, CURTAIN_STACK_SHARE, type SoftMeshData } from '@/lib/soft-goods';
import { moduleCount, MODULE_RANGE, PART_LIBRARY, type ScenePart } from '@/lib/scene-spec';
import { buildSceneFile, parseSceneFile, sceneFileJson, sceneFileToRoom } from '@/lib/scene-file';
import type { RoomData, Transforms } from '@/lib/storage';

const PLEAT = MODULE_RANGE.curtain!;
const xs = (m: SoftMeshData) => m.positions.filter((_, i) => i % 3 === 0);
const zs = (m: SoftMeshData) => m.positions.filter((_, i) => i % 3 === 2);

describe('an open curtain', () => {
  const sizes: Array<[number, number, number]> = [
    [1600, 80, 2200],
    [800, 50, 1400],
    [3200, 120, 2600],
  ];
  for (const dim of sizes) {
    it(`stays inside its own box and leaves the window clear · ${dim.join('×')}`, () => {
      const [w, d] = [dim[0] / 1000, dim[1] / 1000];
      const open = curtainCloth(dim, moduleCount(w, PLEAT), true);
      const x = xs(open);
      const z = zs(open);
      expect(Math.min(...x)).toBeCloseTo(-w / 2, 9);
      expect(Math.max(...x)).toBeCloseTo(w / 2, 9);
      expect(Math.min(...z)).toBeGreaterThanOrEqual(-d / 2);
      expect(Math.max(...z)).toBeLessThanOrEqual(d / 2);
      // Nothing between the two stacks: the middle of the rod is open window.
      const inner = w / 2 - w * CURTAIN_STACK_SHARE;
      expect(x.every((v) => Math.abs(v) >= inner - 1e-9)).toBe(true);
      // Folded, not flattened: the stacks have real depth.
      expect(Math.max(...z) - Math.min(...z)).toBeGreaterThan(d * 0.5);
    });
  }

  it('is a different mesh from the drawn one, and each is memoised', () => {
    const drawn = curtainCloth([1600, 80, 2200], 9);
    const open = curtainCloth([1600, 80, 2200], 9, true);
    expect(open).not.toBe(drawn);
    expect(curtainCloth([1600, 80, 2200], 9, true)).toBe(open);
    expect(curtainCloth([1600, 80, 2200], 9, false)).toBe(drawn);
  });
});

describe('a room file carries whether a curtain is open', () => {
  const ROOM: RoomData = {
    id: 'room-1', createdAt: 1_700_000_000_000, name: 'Studio', layoutId: 'rect', width: 5, depth: 4, height: 2.6,
  };
  const NONE: Transforms = { positions: {}, rotations: {}, dims: {} };
  const row = PART_LIBRARY.find((r) => r.shape === 'curtain')!;
  const curtain = (over: Partial<ScenePart> = {}): ScenePart => ({
    id: 'curtain-1', category: row.category, name: row.label, shape: 'curtain',
    pos: [0, 1.2, -1.9], rot: 0, dimMM: row.dimMM, locked: false, ...over,
  });

  it('writes it and reads it back', () => {
    const out = parseSceneFile(sceneFileJson(buildSceneFile(ROOM, [curtain({ curtainOpen: true })], NONE, 1)));
    if (!out.ok) throw new Error(out.error);
    expect(out.dropped).toEqual([]);
    expect(sceneFileToRoom(out.file).parts[0].curtainOpen).toBe(true);
  });

  it('a drawn curtain stores nothing', () => {
    const text = sceneFileJson(buildSceneFile(ROOM, [curtain()], NONE, 1));
    expect(text).not.toContain('curtainOpen');
  });

  it('refuses it on a piece that is not a curtain, and says so', () => {
    const text = sceneFileJson(buildSceneFile(ROOM, [curtain()], NONE, 1)).replace(
      '"shape": "curtain"',
      '"shape": "sofa", "curtainOpen": true',
    );
    const out = parseSceneFile(text);
    if (!out.ok) throw new Error(out.error);
    expect(out.file.parts[0].curtainOpen).toBeUndefined();
    expect(out.dropped.some((s) => /curtainOpen/.test(s))).toBe(true);
  });
});

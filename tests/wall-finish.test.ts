// The walls' finish (`lib/wall-finish.ts`, drawn by `wallFinishFields` in
// `lib/textures.ts`): every finish tiles without a seam, the joints a person picks a
// colour for are actually there to see, the default is the plaster the room always had,
// and the choice survives a save, a room file and a reopen.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_WALLS, WALL_KINDS, WALL_SPEC, readWallFinish, resolveWalls, type WallKind } from '@/lib/wall-finish';
import { plasterFields, wallFinishFields, type Field, type SurfaceFields } from '@/lib/textures';
import { buildSceneFile, parseSceneFile, sceneFileJson } from '@/lib/scene-file';
import type { RoomData } from '@/lib/storage';

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

function sd(f: Field): number {
  let m = 0;
  for (const v of f.data) m += v;
  m /= f.data.length;
  let q = 0;
  for (const v of f.data) q += (v - m) ** 2;
  return Math.sqrt(q / f.data.length);
}

/** Wrap step against the largest step inside the tile, as `floor-finish.test.ts`. */
function seamRatio(f: Field, axis: 'u' | 'v'): number {
  const s = f.size;
  const at = (a: number, k: number) => (axis === 'u' ? f.data[k * s + a] : f.data[a * s + k]);
  const step = (a: number, b: number) => {
    let t = 0;
    for (let k = 0; k < s; k++) t += Math.abs(at(a, k) - at(b, k));
    return t / s;
  };
  let inner = 0;
  for (let a = 0; a < s - 1; a++) inner = Math.max(inner, step(a, a + 1));
  return step(s - 1, 0) / inner;
}

const memo = new Map<string, SurfaceFields>();
const fieldsOf = (kind: WallKind, grout: 'match' | 'dark' = 'match') => {
  const k = `${kind}:${grout}`;
  let f = memo.get(k);
  if (!f) memo.set(k, (f = wallFinishFields(kind, grout)));
  return f;
};

describe('every wall finish', () => {
  for (const kind of WALL_KINDS) {
    it(`${kind}: tiles without a seam`, () => {
      const f = fieldsOf(kind);
      for (const axis of ['u', 'v'] as const) {
        expect(seamRatio(f.height, axis), `${kind} height ${axis}`).toBeLessThanOrEqual(1);
        expect(seamRatio(f.tone, axis), `${kind} tone ${axis}`).toBeLessThanOrEqual(1);
      }
    });
  }

  it('plaster is the plaster the walls always had', () => {
    expect(resolveWalls(undefined)).toEqual({ kind: 'plaster', grout: 'match' });
    expect(DEFAULT_WALLS.kind).toBe('plaster');
    const a = wallFinishFields('plaster', 'match');
    const b = plasterFields();
    expect(a.tileM).toBe(b.tileM);
    expect(Array.from(a.height.data.slice(0, 64))).toEqual(Array.from(b.height.data.slice(0, 64)));
    // And the shell draws plaster at the roughness and relief the walls had before.
    expect(WALL_SPEC.plaster.roughness).toBe(0.96);
    expect(WALL_SPEC.plaster.relief).toBe(0.5);
  });

  it('brick and tile have joints you can see, and contrast makes them darker', () => {
    for (const kind of WALL_KINDS.filter((k) => WALL_SPEC[k].joints)) {
      const match = fieldsOf(kind, 'match');
      const dark = fieldsOf(kind, 'dark');
      // The relief of a joint is the pattern, matching mortar or not.
      expect(sd(match.height), `${kind} relief`).toBeGreaterThan(0.08);
      expect(sd(dark.tone), `${kind} contrast`).toBeGreaterThan(sd(match.tone) * 1.5);
    }
  });

  it('only the kinds with joints name them', () => {
    for (const k of WALL_KINDS) expect(WALL_SPEC[k].joints, k).toBe(WALL_SPEC[k].jointLabel !== null);
  });

  it('every finish reads differently from plaster', () => {
    // A finish that looks like the default is a choice that does nothing.
    const plaster = fieldsOf('plaster');
    for (const kind of WALL_KINDS.filter((k) => k !== 'plaster' && k !== 'paint')) {
      const f = fieldsOf(kind);
      const differs = Math.max(sd(f.tone) / sd(plaster.tone), sd(f.height) / sd(plaster.height));
      expect(differs, kind).toBeGreaterThan(1.5);
    }
    // Smooth paint is the one meant to be QUIETER than plaster.
    expect(sd(fieldsOf('paint').height)).toBeLessThan(sd(plaster.height));
  });
});

describe('reading a wall finish', () => {
  it('absent is no finish and no complaint', () => {
    const dropped: string[] = [];
    expect(readWallFinish(undefined, dropped)).toBeNull();
    expect(dropped).toEqual([]);
  });

  it('keeps a good one', () => {
    expect(readWallFinish({ kind: 'brick', grout: 'dark' })).toEqual({ kind: 'brick', grout: 'dark' });
  });

  it('refuses an unknown finish, and says so', () => {
    const dropped: string[] = [];
    expect(readWallFinish({ kind: 'wallpaper' }, dropped)).toBeNull();
    expect(dropped[0]).toMatch(/walls/);
  });

  it('drops a bad grout and keeps the finish, saying so', () => {
    const dropped: string[] = [];
    expect(readWallFinish({ kind: 'tile', grout: 'pink' }, dropped)).toEqual({ kind: 'tile' });
    expect(dropped[0]).toMatch(/grout/);
  });

  it('leaves out grout on a finish that has no joints, and says so', () => {
    // The editor never writes one there, so a file that has it was not made by this
    // app as it stands: lossy, never silent.
    const dropped: string[] = [];
    expect(readWallFinish({ kind: 'limewash', grout: 'dark' }, dropped)).toEqual({ kind: 'limewash' });
    expect(dropped[0]).toMatch(/limewash walls have no joints/);
  });
});

describe('the walls travel', () => {
  const ROOM: RoomData = { id: 'r', createdAt: 1, name: 'Hall', layoutId: 'rect', width: 4, depth: 3, height: 2.6 };

  it('through a room file and back', () => {
    const walls = { kind: 'brick' as const, grout: 'dark' as const };
    const out = parseSceneFile(sceneFileJson(buildSceneFile({ ...ROOM, walls }, [], { positions: {}, rotations: {}, dims: {} }, 2)));
    if (!out.ok) throw new Error(out.error);
    expect(out.file.room.walls).toEqual(walls);
    expect(out.dropped).toEqual([]);
  });

  it('is absent from a file for a room nobody chose a finish in', () => {
    const json = sceneFileJson(buildSceneFile(ROOM, [], { positions: {}, rotations: {}, dims: {} }, 2));
    expect(json).not.toContain('"walls"');
  });

  it('is saved with the room shell, loaded with it, and drawn from it', () => {
    expect(src('components/studio/RoomSync.tsx')).toMatch(/walls: room\.walls,/);
    expect(src('components/studio/SceneFile.tsx')).toMatch(/walls: room\.walls,/);
    expect(src('lib/scene-store.ts')).toMatch(/readWallFinish\(room\.walls\)/);
    const shell = src('components/three/RoomShell.tsx');
    expect(shell).toMatch(/wallFinishMaps\(chosenWalls\.kind, chosenWalls\.grout\)/);
    expect(shell).toMatch(/roughness=\{wallSpec\.roughness\}[^>]*\{\.\.\.wallMaps\}/);
  });

  it('a piece finish travels through a room file too', () => {
    // A dining chair: substantially wood AND fabric, so both rows are its to carry.
    const part = { id: 'a', name: 'Chair', shape: 'chair-dining', category: 'chair', dimMM: [450, 500, 900], pos: [0, 0, 0], rot: 0, woodFinish: 'lacquered', fabricFinish: 'velvet' };
    const out = parseSceneFile(
      sceneFileJson(buildSceneFile(ROOM, [part] as never, { positions: {}, rotations: {}, dims: {} }, 2)),
    );
    if (!out.ok) throw new Error(out.error);
    expect(out.dropped).toEqual([]);
    expect(out.file.parts[0]).toMatchObject({ woodFinish: 'lacquered', fabricFinish: 'velvet' });
  });
});

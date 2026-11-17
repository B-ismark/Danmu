import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FLOOR,
  FLOOR_KINDS,
  FLOOR_SPEC,
  readFloorFinish,
  resolveFloor,
  type FloorKind,
  type Grout,
} from '@/lib/floor-finish';
import { floorFinishFields, herringboneBlock, herringboneFields, plankFields, stoneFields, tileFields, type Field, type SurfaceFields } from '@/lib/textures';
import { buildSceneFile, parseSceneFile, sceneFileJson } from '@/lib/scene-file';
import type { RoomData } from '@/lib/storage';

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

function stats(f: Field) {
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  for (const v of f.data) {
    min = Math.min(min, v);
    max = Math.max(max, v);
    sum += v;
  }
  const mean = sum / f.data.length;
  let sq = 0;
  for (const v of f.data) sq += (v - mean) ** 2;
  return { min, max, mean, sd: Math.sqrt(sq / f.data.length) };
}

/** Wrap step against the largest step inside the tile — see `surface-textures.test.ts`. */
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

/** Generated once per argument list: a full-resolution stone is ~0.4 s, and three
 *  describes below ask for the same ones. */
const memo = new Map<string, SurfaceFields>();
function once(key: string, make: () => SurfaceFields): SurfaceFields {
  let f = memo.get(key);
  if (!f) memo.set(key, (f = make()));
  return f;
}
const tileAt = (mm: number, g: Grout, size?: number) => once(`tile:${mm}:${g}:${size}`, () => tileFields(mm, g, size));
const stoneAt = (mm: number, g: Grout) => once(`stone:${mm}:${g}`, () => stoneFields(mm, g));

/** Every combination the panel can ask for. */
function combos(): Array<{ kind: FloorKind; sizeMM: number | null; grout: Grout }> {
  const out: Array<{ kind: FloorKind; sizeMM: number | null; grout: Grout }> = [];
  for (const kind of FLOOR_KINDS) {
    const spec = FLOOR_SPEC[kind];
    const sizes = spec.sizes.length > 0 ? spec.sizes.map((s) => s.mm) : [null];
    const grouts: Grout[] = spec.grout ? ['match', 'dark'] : ['match'];
    for (const sizeMM of sizes) for (const grout of grouts) out.push({ kind, sizeMM, grout });
  }
  return out;
}

describe('the default floor is the floor every earlier room had', () => {
  it('is 200 mm planks in the old board tone', () => {
    expect(resolveFloor(undefined)).toEqual({ kind: 'planks', color: '#E6E1D6', sizeMM: 200, grout: 'match' });
    expect(resolveFloor(DEFAULT_FLOOR)).toEqual(resolveFloor(undefined));
  });

  it('draws the same planks it always drew', () => {
    const f = plankFields(200, 64);
    expect(f.tileM).toBe(2.4);
  });
});

describe('the catalogue of floors', () => {
  for (const kind of FLOOR_KINDS) {
    const spec = FLOOR_SPEC[kind];
    it(`${kind}: its default size is one it offers, and it has sizes iff it names what they measure`, () => {
      expect(spec.sizeOf === null).toBe(spec.sizes.length === 0);
      expect(spec.defaultSizeMM === null).toBe(spec.sizes.length === 0);
      if (spec.defaultSizeMM !== null) expect(spec.sizes.map((s) => s.mm)).toContain(spec.defaultSizeMM);
    });
    it(`${kind}: six swatches at most, so they and the mixer are one row of seven`, () => {
      expect(spec.swatches.length).toBeGreaterThan(0);
      expect(spec.swatches.length).toBeLessThanOrEqual(6);
      for (const s of spec.swatches) expect(s.hex).toMatch(/^#[0-9A-F]{6}$/i);
      expect(new Set(spec.swatches.map((s) => s.hex.toLowerCase())).size).toBe(spec.swatches.length);
    });
  }
});

describe('herringbone', () => {
  it('covers the plane exactly once, and the fast lookup finds the block that does', () => {
    const n = 5;
    // Brute force over every (A, B) that could reach the sample window.
    const owners = (px: number, py: number) => {
      const hits: string[] = [];
      for (let A = -40; A < 40; A++)
        for (let B = -10; B < 10; B++) {
          const ox = A + B * n;
          const oy = A - B * n;
          if (px >= ox && px < ox + n && py >= oy && py < oy + 1) hits.push(`${A},${B},h`);
          if (px >= ox && px < ox + 1 && py >= oy + 1 && py < oy + n + 1) hits.push(`${A},${B},v`);
        }
      return hits;
    };
    for (let i = 0; i < 600; i++) {
      // A deterministic scatter over a window several blocks wide.
      const px = ((i * 7.31) % 23) - 11.5;
      const py = ((i * 3.77) % 19) - 9.5;
      const all = owners(px, py);
      expect(all).toHaveLength(1);
      const b = herringboneBlock(px, py, n);
      expect(b).not.toBeNull();
      expect(`${b!.A},${b!.B},${b!.vertical ? 'v' : 'h'}`).toBe(all[0]);
    }
  });

  it('runs its blocks five times as long as wide, at the width chosen', () => {
    // m staircases of √2·n block widths, at least two.
    for (const w of [70, 90, 120]) {
      const f = herringboneFields(w, 32);
      const staircases = f.tileM / ((5 * Math.SQRT2 * w) / 1000);
      expect(staircases).toBeCloseTo(Math.round(staircases), 9);
      expect(Math.round(staircases)).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('every floor the panel can ask for', () => {
  // Low resolution where it does not matter: these are questions of layout and tiling.
  // Stone is the exception — at a quarter of its texels a 3 mm joint is thinner than
  // one, so two slabs' veins meet head-on across the wrap and read as the seam they
  // would be if the joint really were missing.
  for (const c of combos()) {
    const name = `${c.kind}${c.sizeMM ? ` ${c.sizeMM} mm` : ''}${FLOOR_SPEC[c.kind].grout ? `, ${c.grout} grout` : ''}`;
    it(`${name}: keeps the colour, tiles without a seam, and repeats a whole number of modules`, () => {
      const f: SurfaceFields =
        c.kind === 'tile' ? tileAt(c.sizeMM!, c.grout, 256)
        : c.kind === 'stone' ? stoneAt(c.sizeMM!, c.grout)
        : c.kind === 'planks' ? plankFields(c.sizeMM!, 128)
        : c.kind === 'herringbone' ? herringboneFields(c.sizeMM!, 128)
        : floorFinishFields(c.kind, c.sizeMM, c.grout);
      const s = stats(f.tone);
      expect(s.max).toBeLessThanOrEqual(1);
      expect(s.min).toBeGreaterThan(0.45);
      expect(s.mean).toBeGreaterThan(0.75);
      for (const axis of ['u', 'v'] as const) {
        expect(seamRatio(f.height, axis)).toBeLessThanOrEqual(1);
        expect(seamRatio(f.tone, axis)).toBeLessThanOrEqual(1);
      }
      if (c.kind === 'planks' || c.kind === 'tile' || c.kind === 'stone') {
        const modules = (f.tileM * 1000) / c.sizeMM!;
        expect(modules).toBeCloseTo(Math.round(modules), 9);
      }
    });
  }
});

describe('a joint you can see', () => {
  // Floors at ~70% of what each measured when tuned against the rendered room.
  // A contrasting grout must actually reach dark — the defect this pins is a 3 mm
  // joint on large tile drawn at 3.5 mm a texel, which came out at 0.76 of its tile.
  it('contrasting grout reaches near its full darkness on every tile and slab size', () => {
    for (const mm of FLOOR_SPEC.tile.sizes.map((s) => s.mm)) expect(stats(tileAt(mm, 'dark').tone).min).toBeLessThan(0.6);
    for (const mm of FLOOR_SPEC.stone.sizes.map((s) => s.mm)) expect(stats(stoneAt(mm, 'dark').tone).min).toBeLessThan(0.62);
  });

  it('each material varies enough to read at its default', () => {
    const SD: Record<FloorKind, number> = { planks: 0.05, herringbone: 0.055, tile: 0.013, stone: 0.017, concrete: 0.017, carpet: 0.016 };
    for (const kind of FLOOR_KINDS) {
      const r = resolveFloor({ kind });
      const f =
        kind === 'tile' ? tileAt(r.sizeMM!, r.grout)
        : kind === 'stone' ? stoneAt(r.sizeMM!, r.grout)
        : floorFinishFields(kind, r.sizeMM, r.grout);
      expect(stats(f.tone).sd, kind).toBeGreaterThan(SD[kind]);
    }
  });

  it('glaze is glossier than its grout', () => {
    const f = tileAt(300, 'match');
    const s = f.rough.size;
    // Texel 0 sits on a joint; the middle of the first tile does not.
    const mid = Math.round(s / 4 / 2); // four 300 mm tiles per 1.2 m repeat
    expect(f.rough.data[mid * s + mid]).toBeLessThan(0.5);
    expect(f.rough.data[0]).toBeGreaterThan(0.8);
  });
});

describe('readFloorFinish — a floor from bytes someone else wrote', () => {
  it('absent is no floor and no complaint', () => {
    const dropped: string[] = [];
    expect(readFloorFinish(undefined, dropped)).toBeNull();
    expect(dropped).toEqual([]);
  });

  it('keeps a good one as it is', () => {
    const dropped: string[] = [];
    expect(readFloorFinish({ kind: 'tile', color: '#D08A62', sizeMM: 200, grout: 'dark' }, dropped)).toEqual({
      kind: 'tile',
      color: '#D08A62',
      sizeMM: 200,
      grout: 'dark',
    });
    expect(dropped).toEqual([]);
  });

  it('refuses an unknown material, and says so', () => {
    const dropped: string[] = [];
    expect(readFloorFinish({ kind: 'lava' }, dropped)).toBeNull();
    expect(readFloorFinish('planks', dropped)).toBeNull();
    expect(dropped).toHaveLength(2);
  });

  it('snaps an odd size to the nearest standard one, and says so', () => {
    const dropped: string[] = [];
    expect(readFloorFinish({ kind: 'planks', sizeMM: 37 }, dropped)).toEqual({ kind: 'planks', sizeMM: 120 });
    expect(dropped).toHaveLength(1);
  });

  it('drops a bad colour or grout, and says so, keeping the rest', () => {
    const dropped: string[] = [];
    expect(readFloorFinish({ kind: 'stone', color: 'red', grout: 'pink', sizeMM: 800 }, dropped)).toEqual({ kind: 'stone', sizeMM: 800 });
    expect(dropped).toHaveLength(2);
  });

  it('ignores grout and size on a material that has neither', () => {
    expect(readFloorFinish({ kind: 'carpet', sizeMM: 300, grout: 'dark' })).toEqual({ kind: 'carpet' });
    expect(resolveFloor({ kind: 'planks', grout: 'dark' }).grout).toBe('match');
  });
});

describe('the floor travels', () => {
  const ROOM: RoomData = { id: 'r', createdAt: 1, name: 'Hall', layoutId: 'rect', width: 4, depth: 3, height: 2.6 };

  it('through a room file and back', () => {
    const floor = { kind: 'herringbone' as const, color: '#CC9C66', sizeMM: 70 };
    const out = parseSceneFile(sceneFileJson(buildSceneFile({ ...ROOM, floor }, [], { positions: {}, rotations: {}, dims: {} }, 2)));
    if (!out.ok) throw new Error(out.error);
    expect(out.file.room.floor).toEqual(floor);
    expect(out.dropped).toEqual([]);
  });

  it('is absent from a file for a room nobody chose a floor in', () => {
    const json = sceneFileJson(buildSceneFile(ROOM, [], { positions: {}, rotations: {}, dims: {} }, 2));
    expect(json).not.toContain('"floor"');
  });

  it('is saved with the room shell, loaded with it, and drawn from it', () => {
    // Each of these is one line, and without any one of them the choice reaches nothing:
    // the save forgets it, the open ignores it, or the floor never asks.
    expect(src('components/studio/RoomSync.tsx')).toMatch(/floor: room\.floor,/);
    expect(src('components/studio/SceneFile.tsx')).toMatch(/floor: room\.floor,/);
    expect(src('lib/scene-store.ts')).toMatch(/readFloorFinish\(room\.floor\)/);
    expect(src('components/three/RoomShell.tsx')).toMatch(/floorFinishMaps\(floor\.kind, floor\.sizeMM, floor\.grout\)/);
    expect(src('components/three/RoomShell.tsx')).toMatch(/color=\{floor\.color\}/);
  });
});

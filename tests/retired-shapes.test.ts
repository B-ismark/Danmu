// The pendant lamp (`lamp-pendant`) was retired into the flush ceiling light
// (`lamp-ceiling`). Rooms and scene files written before that still name the old shape,
// and the vocabulary check drops a part whose shape it does not know — so without the
// migration every old room's light would vanish on its next open. These hold the four
// ways an old pendant comes back: a stored scene part, a scene file, a detection's shape
// hint, and the user's own overrides of a piece whose size just changed under them.
//
// A `//` header rather than a docblock — see `tests/layout-pick.test.ts`.

import { describe, expect, it } from 'vitest';
import {
  buildSceneFromRoom,
  migrateRetiredOverrides,
  migrateRetiredPart,
  normalizeStoredParts,
  partsOnOpen,
  retiredOverridesFor,
  retiredShapeFor,
  type ScenePart,
} from '@/lib/scene-spec';
import { migrateLayout, migrateRoom, ROOM_SCHEMA_VERSION, type LayoutVariant, type RoomData, type Transforms } from '@/lib/storage';
import { parseSceneFile, SCENE_FILE_FORMAT, SCENE_FILE_VERSION } from '@/lib/scene-file';
import { groundY, MOUNT_PAD, verticalExtent } from '@/lib/physics';
import { roleOf } from '@/lib/layout-rules';

const H = 2.8;
/** Where the Library pendant hung: 350 × 350 × 400, top `MOUNT_PAD` under a 2.8 m slab. */
const PENDANT_Y = H - MOUNT_PAD - 0.2;
/** …and where the Library ceiling light sits flush in the same room. */
const FLUSH_Y = H - MOUNT_PAD - 0.04;

/** A part exactly as an old build stored it — the shape is not in today's union, which is
 *  the whole point, so it goes through `unknown`. */
function oldPendant(over: Record<string, unknown> = {}): ScenePart {
  return {
    id: 'lamp-1',
    category: 'lamp',
    name: 'Pendant lamp',
    shape: 'lamp-pendant',
    pos: [0.4, PENDANT_Y, -0.6],
    rot: 0,
    dimMM: [350, 350, 400],
    locked: false,
    wallMounted: true,
    ...over,
  } as unknown as ScenePart;
}

const ROOM: RoomData = { id: 'r', createdAt: 1, name: 'R', layoutId: 'rect', width: 5, depth: 4, height: H };

describe('retiredShapeFor', () => {
  it('maps the pendant to the ceiling light and nothing else to anything', () => {
    expect(retiredShapeFor('lamp-pendant')).toBe('lamp-ceiling');
    expect(retiredShapeFor('lamp-ceiling')).toBeNull();
    expect(retiredShapeFor('sofa')).toBeNull();
    // A prototype key must not read as a retired shape.
    expect(retiredShapeFor('toString')).toBeNull();
    expect(retiredShapeFor(undefined)).toBeNull();
  });
});

describe('a stored pendant part comes back as the ceiling light', () => {
  it('takes the new shape, the new name and a flush disc’s size, keeping its width', () => {
    const p = migrateRetiredPart(oldPendant());
    expect(p.shape).toBe('lamp-ceiling');
    expect(p.name).toBe('Ceiling light');
    expect(p.dimMM).toEqual([350, 350, 80]);
    expect(p.id, 'the same piece, so every override still finds it').toBe('lamp-1');
  });

  it('keeps its TOP where the pendant’s was — flush, not a hand-span under the slab', () => {
    const p = migrateRetiredPart(oldPendant());
    expect(p.pos[0]).toBe(0.4);
    expect(p.pos[2]).toBe(-0.6);
    expect(p.pos[1]).toBeCloseTo(FLUSH_Y, 9);
    expect(p.pos[1]).toBeCloseTo(groundY('lamp', 'lamp-ceiling', p.dimMM, H), 9);
    expect(verticalExtent('lamp', 'lamp-ceiling', p.dimMM, p.pos[1])[1]).toBeCloseTo(H - MOUNT_PAD, 9);
  });

  it('keeps a name the user typed, and clamps a width past the new band', () => {
    const p = migrateRetiredPart(oldPendant({ name: 'Kitchen light', dimMM: [900, 600, 500] }));
    expect(p.name).toBe('Kitchen light');
    expect(p.dimMM).toEqual([800, 800, 80]);
  });

  it('is idempotent, and leaves every other part as the same object', () => {
    const once = migrateRetiredPart(oldPendant());
    expect(migrateRetiredPart(once)).toBe(once);
    const sofa = { ...oldPendant(), shape: 'sofa', category: 'sofa' } as unknown as ScenePart;
    expect(migrateRetiredPart(sofa)).toBe(sofa);
  });

  it('happens on every read of a saved scene, mount and roundness derived after it', () => {
    const [p] = normalizeStoredParts([oldPendant({ wallMounted: false, circle: undefined })]);
    expect(p.shape).toBe('lamp-ceiling');
    expect(p.wallMounted).toBe(true);
    expect(p.circle).toBe(true);
    const opened = partsOnOpen(ROOM, [oldPendant()]);
    expect(opened.map((x) => x.shape)).toEqual(['lamp-ceiling']);
  });
});

describe('a scene file naming the pendant imports it rather than dropping it', () => {
  it('reads the part as the ceiling light, at a flush height, and reports nothing lost', () => {
    const raw = JSON.stringify({
      format: SCENE_FILE_FORMAT,
      version: SCENE_FILE_VERSION,
      exportedAt: 1,
      room: { name: 'R', layoutId: 'rect', width: 5, depth: 4, height: H },
      parts: [{ ...oldPendant(), name: 'Pendant lamp' }],
    });
    const out = parseSceneFile(raw);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.dropped).toEqual([]);
    expect(out.file.parts).toHaveLength(1);
    const [p] = out.file.parts;
    expect(p.shape).toBe('lamp-ceiling');
    expect(p.name).toBe('Ceiling light');
    expect(p.dimMM).toEqual([350, 350, 80]);
    expect(p.pos[1]).toBeCloseTo(FLUSH_Y, 9);
  });
});

describe('a detection whose shape hint names the pendant', () => {
  it('is rewritten to the ceiling light on read, whatever the record’s version', () => {
    for (const version of [undefined, 1, 2, ROOM_SCHEMA_VERSION]) {
      const rec: RoomData = {
        ...ROOM,
        version,
        detectedObjects: [
          { id: 1, label: 'light', conf: 0.9, locked: true, box: [0.4, 0, 0.1, 0.1], category: 'lamp', shape: 'lamp-pendant' },
          { id: 2, label: 'sofa', conf: 0.9, locked: true, box: [0.1, 0.6, 0.4, 0.3], category: 'sofa', shape: 'sofa' },
        ],
      };
      const back = migrateRoom(rec);
      expect(back.detectedObjects?.map((d) => d.shape), `version ${version}`).toEqual(['lamp-ceiling', 'sofa']);
    }
    expect(ROOM_SCHEMA_VERSION).toBe(3);
  });
});

describe('the overrides a user gave the old pendant', () => {
  const t = (over: Partial<Transforms> = {}): Transforms => ({ positions: {}, rotations: {}, dims: {}, ...over });

  it('reads which pieces were pendants off the raw saved scene, before it is migrated', () => {
    const r = retiredOverridesFor([oldPendant(), { id: 'sofa-1', shape: 'sofa' }], [], ROOM_SCHEMA_VERSION);
    expect(r).toEqual([{ id: 'lamp-1', oldDim: [350, 350, 400], newDim: [350, 350, 80] }]);
  });

  it('with no saved scene, takes every built ceiling light of a pre-3 room as a pendant', () => {
    const built = buildSceneFromRoom({ ...ROOM, layoutId: 't' });
    const lights = built.filter((p) => p.shape === 'lamp-ceiling');
    expect(lights.length, 'the T seeds one').toBe(1);
    expect(retiredOverridesFor(undefined, built, 2).map((r) => r.id)).toEqual(lights.map((p) => p.id));
    expect(retiredOverridesFor(undefined, built, undefined), 'a record from before versions').toHaveLength(1);
    expect(retiredOverridesFor(undefined, built, 3), 'a v3 room never had a pendant').toEqual([]);
  });

  it('lifts a moved pendant’s position to a flush disc, and does it once', () => {
    const retired = retiredOverridesFor([oldPendant()], [], 2);
    const before = t({ positions: { 'lamp-1': [1.1, PENDANT_Y, 0.3], 'sofa-1': [0, 0, 0] } });
    const after = migrateRetiredOverrides(before, retired, H);
    expect(after.positions['lamp-1'][0]).toBe(1.1);
    expect(after.positions['lamp-1'][1]).toBeCloseTo(FLUSH_Y, 9);
    expect(after.positions['lamp-1'][2]).toBe(0.3);
    expect(after.positions['sofa-1']).toBe(before.positions['sofa-1']);
    // A second pass — a write-back that never landed, or the raw scene read again — is a
    // no-op, because the cap is the flush height and the first pass already reached it.
    expect(migrateRetiredOverrides(after, retired, H)).toBe(after);
  });

  it('migrates a resized pendant’s size too, measuring the lift from the user’s size', () => {
    const retired = retiredOverridesFor([oldPendant()], [], 2);
    const userY = H - MOUNT_PAD - 0.25; // a 500 mm drop the user stretched it to
    const after = migrateRetiredOverrides(
      t({ positions: { 'lamp-1': [0, userY, 0] }, dims: { 'lamp-1': [500, 450, 500] } }),
      retired,
      H,
    );
    expect(after.dims['lamp-1']).toEqual([500, 500, 80]);
    expect(after.positions['lamp-1'][1]).toBeCloseTo(H - MOUNT_PAD - 0.04, 9);
  });

  it('keeps the top without a room height, and returns the same object when nothing is owed', () => {
    const retired = retiredOverridesFor([oldPendant()], [], 2);
    const after = migrateRetiredOverrides(t({ positions: { 'lamp-1': [0, PENDANT_Y, 0] } }), retired);
    expect(after.positions['lamp-1'][1]).toBeCloseTo(FLUSH_Y, 9);
    const untouched = t({ positions: { 'sofa-1': [0, 0, 0] } });
    expect(migrateRetiredOverrides(untouched, retired, H)).toBe(untouched);
    expect(migrateRetiredOverrides(untouched, [], H)).toBe(untouched);
  });
});

describe('a saved layout holding the pendant', () => {
  it('comes back with the part and its override migrated together', () => {
    const v: LayoutVariant = {
      id: 'l-1',
      name: 'Layout A',
      createdAt: 1,
      parts: [oldPendant()],
      transforms: { positions: { 'lamp-1': [0, PENDANT_Y, 0] }, rotations: {}, dims: {} },
    };
    const back = migrateLayout(v);
    const [p] = back.parts as ScenePart[];
    expect(p.shape).toBe('lamp-ceiling');
    expect(back.transforms.positions['lamp-1'][1]).toBeCloseTo(FLUSH_Y, 9);
    expect(migrateLayout(back), 'idempotent').toBe(back);
  });
});

describe('the starter light', () => {
  it('is the flush ceiling light, centred over the dining table, its top at the slab', () => {
    for (const layoutId of ['t', 'open'] as const) {
      const parts = buildSceneFromRoom({ ...ROOM, layoutId, width: 6, depth: 5 });
      const light = parts.find((p) => p.shape === 'lamp-ceiling');
      const table = parts.find((p) => roleOf(p) === 'dining-table');
      expect(light, layoutId).toBeDefined();
      expect(table, layoutId).toBeDefined();
      if (!light || !table) continue;
      expect(light.name).toBe('Ceiling light');
      expect(light.pos[0], `${layoutId}: over the table in x`).toBeCloseTo(table.pos[0], 6);
      expect(light.pos[2], `${layoutId}: and in z`).toBeCloseTo(table.pos[2], 6);
      expect(verticalExtent('lamp', 'lamp-ceiling', light.dimMM, light.pos[1])[1]).toBeCloseTo(H - MOUNT_PAD, 9);
    }
  });
});

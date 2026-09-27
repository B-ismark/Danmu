// @vitest-environment jsdom
//
// A fresh scan reaches the studio, and whatever the room was before is kept as a
// layout. `RoomSync` prefers a saved scene over the detections forever, so without
// `adoptFreshScan` a new scan of any room someone had touched was saved and never
// shown. Real IndexedDB (fake-indexeddb) for the reason `storage.test.ts` gives:
// what matters is which keys are there afterwards.

import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { clear } from 'idb-keyval';
import { roomStore, type RoomData } from '@/lib/storage';
import { adoptFreshScan, BEFORE_RESCAN } from '@/lib/rescan';
import { buildSceneFromRoom } from '@/lib/scene-spec';

type Saved = NonNullable<RoomData['detectedObjects']>[number];

const det = (uid: string, category: string, x: number): Saved => ({
  id: 0,
  uid,
  label: `${category}__slot:n`,
  conf: 0.9,
  source: 'local',
  locked: true,
  box: [0.1, 0.1, 0.4, 0.4],
  category,
  dimMM: category === 'sofa' ? [2000, 900, 850] : [800, 800, 750],
  position: { x, y: 0, z: 0 },
});

function room(over: Partial<RoomData> = {}): RoomData {
  return { id: 'r1', createdAt: 1, name: 'Den', layoutId: 'rect', width: 5, depth: 4, height: 2.6, ...over };
}

const NEW = [det('new-1', 'table', 0.5)];

beforeEach(async () => {
  await clear();
});

describe('adoptFreshScan', () => {
  it('a room with a saved scene: the new scan wins, and the old scene becomes a layout', async () => {
    const r = room({ detectedObjects: [det('old-1', 'sofa', -1)] });
    await roomStore.saveRoom(r);
    const oldScene = [{ id: 'old-1', name: 'Sofa' }, { id: 'lib-1', name: 'Plant' }];
    const oldT = { positions: { 'old-1': [1, 0, 1] as [number, number, number] }, rotations: {}, dims: {} };
    await roomStore.saveSceneParts(r.id, oldScene);
    await roomStore.saveTransforms(r.id, oldT);

    const kept = await adoptFreshScan(r, NEW, 42);

    // What the studio loads next: the new list, and no snapshot to overrule it.
    expect((await roomStore.loadRoom(r.id))?.detectedObjects).toEqual(NEW);
    expect(await roomStore.loadSceneParts(r.id)).toBeUndefined();
    expect(await roomStore.loadTransforms(r.id)).toBeUndefined();
    // …and nothing the user made is gone: both layers, exactly.
    expect(kept?.name).toBe(BEFORE_RESCAN);
    const layouts = await roomStore.listLayouts(r.id);
    expect(layouts).toHaveLength(1);
    expect(layouts[0].parts).toEqual(oldScene);
    expect(layouts[0].transforms).toEqual(oldT);
  });

  it('a scanned room with moves but no snapshot keeps the old detections, rebuilt', async () => {
    const r = room({ detectedObjects: [det('old-1', 'sofa', -1)] });
    await roomStore.saveRoom(r);
    const t = { positions: { 'old-1': [0.3, 0, 0.2] as [number, number, number] }, rotations: {}, dims: {} };
    await roomStore.saveTransforms(r.id, t);

    await adoptFreshScan(r, NEW, 7);

    const [layout] = await roomStore.listLayouts(r.id);
    expect(layout.parts).toEqual(buildSceneFromRoom(r));
    expect(layout.transforms).toEqual(t);
  });

  it('a re-scan of a room nobody edited still keeps the previous scan, so it can be compared', async () => {
    const r = room({ detectedObjects: [det('old-1', 'sofa', -1)] });
    await roomStore.saveRoom(r);
    const kept = await adoptFreshScan(r, NEW);
    expect(kept?.parts).toEqual(buildSceneFromRoom(r));
  });

  it('a first scan of an untouched room keeps nothing, because there was nothing', async () => {
    const r = room();
    await roomStore.saveRoom(r);
    expect(await adoptFreshScan(r, NEW)).toBeNull();
    expect(await roomStore.listLayouts(r.id)).toEqual([]);
    expect((await roomStore.loadRoom(r.id))?.detectedObjects).toEqual(NEW);
  });

  it('a first scan of a room the studio had already arranged still reaches the studio', async () => {
    // Opened as a starter room, edited (so a scene was saved), then **Detect furniture**.
    const r = room();
    await roomStore.saveRoom(r);
    await roomStore.saveSceneParts(r.id, [{ id: 'sofa-1' }]);
    const kept = await adoptFreshScan(r, NEW);
    expect(kept).not.toBeNull();
    expect(await roomStore.loadSceneParts(r.id)).toBeUndefined();
  });
});

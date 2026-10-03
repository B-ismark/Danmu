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
import { adoptEditedList, adoptFreshScan, applyListEdits, BEFORE_RESCAN, listEditSentence } from '@/lib/rescan';
import { buildSceneFromRoom, type ScenePart } from '@/lib/scene-spec';
import { fromRecords, toRecord } from '@/lib/detection-record';

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

// The cached list: the screen shows the rows the room was already built from, and the
// person ticks, unticks, deletes, adds or re-words some of them. A room the studio has
// arranged loads its saved scene over the list, so without `applyListEdits` none of
// that reached the room while the button promised "Continue with N pieces".
// The screen reads the room, then the person may still rename it in another tab or
// the studio's debounced save may land, before the list is written. Written over the
// copy it read, that change was put back.
describe('the list is written into the room as it is stored', () => {
  const LIST = [det('bed-a', 'bed', -1)];

  it.each([
    ['a fresh scan', (r: RoomData) => adoptFreshScan(r, NEW)],
    ['an edited list', (r: RoomData) => adoptEditedList(r, [{ ...LIST[0], locked: false }])],
  ] as const)('%s keeps a name given since the room was read', async (_what, adopt) => {
    const r = room({ detectedObjects: LIST });
    await roomStore.saveRoom(r);
    await roomStore.saveSceneParts(r.id, buildSceneFromRoom(r));
    await roomStore.renameRoom(r.id, 'Study');
    await adopt(r);
    const stored = await roomStore.loadRoom(r.id);
    expect(stored?.name).toBe('Study');
    expect(stored?.detectedObjects).not.toEqual(LIST);
  });

  it.each([
    ['a fresh scan', (r: RoomData) => adoptFreshScan(r, NEW)],
    ['an edited list', (r: RoomData) => adoptEditedList(r, [{ ...LIST[0], locked: false }])],
  ] as const)('%s of a room deleted meanwhile brings nothing back', async (_what, adopt) => {
    const r = room({ detectedObjects: LIST });
    await roomStore.saveSceneParts(r.id, buildSceneFromRoom(r));
    expect(await adopt(r)).toBeNull();
    expect(await roomStore.loadRoom(r.id)).toBeUndefined();
    expect(await roomStore.listRooms()).toEqual([]);
  });
});

describe('applyListEdits', () => {
  const LIST = [det('bed-a', 'bed', -1), det('bed-b', 'bed', 1), { ...det('sofa-a', 'sofa', 0), locked: false }];
  const R = room({ detectedObjects: LIST });
  // What the studio saved: the two kept beds, one recoloured, plus a plant from the
  // library that no row knows about.
  const built = buildSceneFromRoom(R);
  const recoloured = { ...built[0], color: '#123456' };
  const plant = { ...built[1], id: 'lib-plant', name: 'Plant' };
  const SCENE: ScenePart[] = [recoloured, built[1], plant];
  const ids = (parts: ScenePart[] | undefined) => parts?.map((p) => p.id);

  it('an unticked row takes its piece out, and only its piece', () => {
    const edit = applyListEdits(SCENE, R, [LIST[0], { ...LIST[1], locked: false }, LIST[2]]);
    expect(ids(edit?.parts)).toEqual(['bed-a', 'lib-plant']);
    // The survivors are the saved pieces themselves, recolour and all — not rebuilds.
    expect(edit?.parts[0]).toBe(recoloured);
    expect(edit?.parts[1]).toBe(plant);
    expect(edit).toMatchObject({ removed: 1, added: 0, updated: 0 });
  });

  it('a deleted row takes its piece out', () => {
    expect(ids(applyListEdits(SCENE, R, [LIST[0], LIST[2]])?.parts)).toEqual(['bed-a', 'lib-plant']);
  });

  it('a newly kept row puts in the piece the studio would have built', () => {
    const next = [LIST[0], LIST[1], { ...LIST[2], locked: true }];
    const edit = applyListEdits(SCENE, R, next);
    const sofa = buildSceneFromRoom({ ...R, detectedObjects: next }).find((p) => p.id === 'sofa-a');
    expect(ids(edit?.parts)).toEqual(['bed-a', 'bed-b', 'lib-plant', 'sofa-a']);
    expect(edit?.parts[3]).toEqual(sofa);
    expect(edit).toMatchObject({ removed: 0, added: 1, updated: 0 });
  });

  it('a row drawn by hand and kept goes in too', () => {
    const edit = applyListEdits(SCENE, R, [...LIST, det('drawn', 'table', 0.4)]);
    expect(ids(edit?.parts)).toEqual(['bed-a', 'bed-b', 'lib-plant', 'drawn']);
  });

  it('a kept row with new details is rebuilt from them', () => {
    const next = [{ ...LIST[0], category: 'sofa', label: 'sofa__slot:n' }, LIST[1], LIST[2]];
    const edit = applyListEdits(SCENE, R, next);
    const part = edit?.parts.find((p) => p.id === 'bed-a');
    expect(part?.category).toBe('sofa');
    expect(edit).toMatchObject({ removed: 0, added: 0, updated: 1 });
  });

  // Rebuilt where it stood, not appended: the studio's list is in the order the
  // person has been looking at, and a re-worded row should not jump to the bottom.
  it('a rebuilt piece keeps its place in the room', () => {
    const edit = applyListEdits(SCENE, R, [LIST[0], { ...LIST[1], yaw: 1.2 }, LIST[2]]);
    expect(ids(edit?.parts)).toEqual(['bed-a', 'bed-b', 'lib-plant']);
    expect(edit?.parts[1].rot).not.toBe(built[1].rot);
  });

  describe('a rebuilt piece keeps what the studio did to it', () => {
    const decor = [{ id: 'd1', kind: 'vase', x: 0, z: 0 }] as ScenePart['decor'];
    const light = { lumens: 800, kelvin: 2700 } as ScenePart['light'];
    const dressed: ScenePart = {
      ...recoloured,
      name: 'Guest bed',
      groupId: 'g1',
      decor,
      light,
    };
    const scene = [dressed, built[1], plant];
    const rebuild = (change: Partial<(typeof LIST)[0]>) =>
      applyListEdits(scene, R, [{ ...LIST[0], ...change }, LIST[1], LIST[2]])?.parts.find((p) => p.id === 'bed-a');

    it('the same model re-measured keeps all of it, name included', () => {
      const part = rebuild({ yaw: 1.2 });
      expect(part).toMatchObject({ color: '#123456', groupId: 'g1', name: 'Guest bed' });
      expect(part?.decor).toBe(decor);
      expect(part?.light).toBe(light);
      expect(part?.rot).not.toBe(dressed.rot);
    });

    it('new words for the same model are its new name, and the rest stays', () => {
      const part = rebuild({ label: 'my bed__slot:n' });
      expect(part?.shape).toBe(dressed.shape);
      expect(part).toMatchObject({ name: 'my bed', color: '#123456', groupId: 'g1' });
      expect(part?.decor).toBe(decor);
    });

    it('a different model keeps its colour and set, and not what belonged to the old model', () => {
      const part = rebuild({ category: 'sofa', label: 'sofa__slot:n' });
      expect(part).toMatchObject({ category: 'sofa', name: 'sofa', color: '#123456', groupId: 'g1' });
      expect(part?.decor).toBeUndefined();
      expect(part?.light).toBeUndefined();
    });

    // A photo no longer colours its piece, so a colour on a piece is the studio's, and
    // a row that carries an old sampled one (a record from before) builds without it.
    it('an old row colour is not built, and a studio colour survives a rebuild', () => {
      const photo = [{ ...LIST[0], color: '#aa0000' }, LIST[1], LIST[2]];
      const r = room({ detectedObjects: photo });
      const [bed] = buildSceneFromRoom(r);
      expect(bed.color, 'a saved detection colour is ignored').toBeUndefined();
      const chosen = { ...bed, color: '#00aa00' };
      const edit = applyListEdits([chosen], r, [{ ...photo[0], yaw: 1.2 }, LIST[1], LIST[2]]);
      expect(edit?.parts[0].color).toBe('#00aa00');
      const reset = applyListEdits([bed], r, [{ ...photo[0], yaw: 1.2 }, LIST[1], LIST[2]]);
      expect(reset?.parts[0].color).toBeUndefined();
    });
  });

  // Each field that shapes the piece, changed on its own.
  it.each([
    ['label', { label: 'bunk bed__slot:n' }],
    ['wall', { label: 'bed__slot:e' }],
    ['category', { category: 'sofa' }],
    ['box', { box: [0.2, 0.1, 0.4, 0.4] }],
    ['size', { dimMM: [1400, 2000, 500] }],
    ['position', { position: { x: -0.5, y: 0, z: 0.4 } }],
    ['heading', { yaw: 1.2 }],
    ['shape', { shape: 'bed-double' }],
  ] as const)('a kept row with a new %s is rebuilt', (_what, change) => {
    const edit = applyListEdits(SCENE, R, [{ ...LIST[0], ...change } as typeof LIST[0], LIST[1], LIST[2]]);
    expect(edit).toMatchObject({ removed: 0, added: 0, updated: 1 });
  });

  // How a row was found, where it sits in the list, and a stale colour on an old record
  // are not edits. Counting them would rebuild the recoloured
  // bed every time someone opened the list to look at it.
  it('a list that is only looked at changes nothing', () => {
    const looked = LIST.map((r, i) => ({ ...r, id: i + 7, conf: 0.5, source: 'cloud', color: '#abcdef' }));
    expect(applyListEdits(SCENE, R, looked)).toBeNull();
  });

  // The screen re-saves every row through `toRecord`, which writes an old row in the
  // current form: its wall in the label, a missing category as `other`, a uid where
  // there was an ordinal. Same rows, so nothing is rebuilt.
  it('an old list re-saved by the screen changes nothing', () => {
    const old: Saved[] = [
      { id: 0, label: 'bed', conf: 0.9, locked: true, box: [0.1, 0.1, 0.4, 0.4], category: 'bed', dimMM: [800, 2000, 500], position: { x: -1, y: 0, z: 0 } },
      { id: 1, label: 'thing', conf: 0.9, locked: true, box: [0.5, 0.1, 0.3, 0.3], dimMM: [600, 600, 600], position: { x: 1, y: 0, z: 0 } },
    ];
    const r = room({ detectedObjects: old });
    const resaved = fromRecords(old).map((d, i) => toRecord(d, i, true, () => 'minted'));
    expect(resaved.map((x) => x.label), 'fixture: re-saving rewrites the rows').toEqual(['bed__slot:n', 'thing__slot:n']);
    expect(resaved[1].category).toBe('other');
    expect(applyListEdits(buildSceneFromRoom(r), r, resaved)).toBeNull();
  });

  // The studio is allowed to disagree with the list. A detected piece deleted there
  // stays deleted while its row is untouched, and unticking that row now changes no
  // piece at all.
  it('leaves a piece the studio deleted where the studio left it', () => {
    const withoutB = [recoloured, plant];
    expect(applyListEdits(withoutB, R, LIST)).toBeNull();
    expect(applyListEdits(withoutB, R, [LIST[0], { ...LIST[1], locked: false }, LIST[2]])).toBeNull();
  });

  // Changed in the list after the studio deleted it. The change is about what the
  // piece is; the delete was about whether it is in the room, and a new word for it
  // is not a request to put it back — that is what ticking a row is.
  it('a changed row whose piece the studio deleted stays out', () => {
    expect(applyListEdits([recoloured, plant], R, [LIST[0], { ...LIST[1], yaw: 1.2 }, LIST[2]])).toBeNull();
    expect(applyListEdits([recoloured, plant], R, [LIST[0], { ...LIST[1], label: 'bunk bed__slot:n' }, LIST[2]])).toBeNull();
    // Alongside a real edit, it is still not counted or built.
    const edit = applyListEdits([recoloured, plant], R, [{ ...LIST[0], yaw: 1.2 }, { ...LIST[1], yaw: 1.2 }, LIST[2]]);
    expect(ids(edit?.parts)).toEqual(['bed-a', 'lib-plant']);
    expect(edit).toMatchObject({ removed: 0, added: 0, updated: 1 });
  });

  // A scene can hold a piece for a row that is not kept — saved by a build from before
  // ticks meant anything, open in another tab. Ticking the row must not put in a second
  // piece under the same id.
  it('never puts in a second piece under an id the scene already has', () => {
    const sofa = buildSceneFromRoom({ ...R, detectedObjects: [{ ...LIST[2], locked: true }] })[0];
    const edit = applyListEdits([...SCENE, sofa], R, [LIST[0], LIST[1], { ...LIST[2], locked: true }]);
    expect((ids(edit?.parts) ?? []).filter((id) => id === 'sofa-a')).toHaveLength(1);
  });

  it('an emptied list takes out every row piece and puts in no starter furniture', () => {
    const edit = applyListEdits(SCENE, R, []);
    expect(ids(edit?.parts)).toEqual(['lib-plant']);
    expect(edit).toMatchObject({ removed: 2, added: 0 });
  });
});

describe('adoptEditedList', () => {
  const LIST = [det('bed-a', 'bed', -1), det('bed-b', 'bed', 1)];

  it('carries the edit into a saved scene, and keeps every move', async () => {
    const r = room({ detectedObjects: LIST });
    await roomStore.saveRoom(r);
    await roomStore.saveSceneParts(r.id, buildSceneFromRoom(r));
    const t = { positions: { 'bed-a': [0.2, 0, 0.3] as [number, number, number] }, rotations: {}, dims: {} };
    await roomStore.saveTransforms(r.id, t);

    const next = [LIST[0], { ...LIST[1], locked: false }];
    const edit = await adoptEditedList(r, next);

    expect(edit).toMatchObject({ removed: 1 });
    expect((await roomStore.loadRoom(r.id))?.detectedObjects).toEqual(next);
    expect((await roomStore.loadSceneParts<ScenePart[]>(r.id))?.map((p) => p.id)).toEqual(['bed-a']);
    // Not a re-scan: the arrangement is edited, not replaced, so nothing is kept aside.
    expect(await roomStore.loadTransforms(r.id)).toEqual(t);
    expect(await roomStore.listLayouts(r.id)).toEqual([]);
  });

  it('a room with no saved scene only needs the list, which it is built from', async () => {
    const r = room({ detectedObjects: LIST });
    await roomStore.saveRoom(r);
    // One unticked and one drawn: a scene written here would hold only the drawn piece.
    const next = [LIST[0], { ...LIST[1], locked: false }, det('drawn', 'table', 0.4)];
    expect(await adoptEditedList(r, next)).toBeNull();
    expect((await roomStore.loadRoom(r.id))?.detectedObjects).toEqual(next);
    expect(await roomStore.loadSceneParts(r.id)).toBeUndefined();
  });
});

describe('listEditSentence', () => {
  it.each([
    [{ removed: 1, added: 0, updated: 0 }, '1 piece taken out. Everything else is as you left it.'],
    [{ removed: 0, added: 2, updated: 0 }, '2 pieces added. Everything else is as you left it.'],
    [{ removed: 1, added: 2, updated: 0 }, '1 piece taken out and 2 added. Everything else is as you left it.'],
    [
      { removed: 2, added: 1, updated: 1 },
      '2 pieces taken out, 1 added and 1 updated. Everything else is as you left it.',
    ],
    [{ removed: 0, added: 0, updated: 3 }, '3 pieces updated. Everything else is as you left it.'],
  ])('%j', (edit, said) => {
    expect(listEditSentence(edit)).toBe(said);
  });
});

// @vitest-environment jsdom
//
// The persistence layer had no tests at all, which is how a hand-written read and
// a hand-written write drifted apart and silently dropped the geometry pass. These
// cover the contracts that are easy to break from a distance: the delete/restore
// key ordering (there is no transaction across keys — idb-keyval is a single
// store, so ORDER is the only safety property available), the version stamp, and
// the summary derivation the workspace grid reads.
//
// jsdom + fake-indexeddb rather than a mock of idb-keyval: the ordering guarantees
// are about a real key-value store's observable intermediate states, and a mock
// would just re-assert the implementation back at itself.

import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { clear, keys, set } from 'idb-keyval';
import { roomStore, ROOM_SCHEMA_VERSION, type RoomData } from '@/lib/storage';

function room(id: string, over: Partial<RoomData> = {}): RoomData {
  return {
    id,
    createdAt: 1_700_000_000_000,
    name: `Room ${id}`,
    layoutId: 'rect',
    width: 6,
    depth: 4,
    height: 2.8,
    ...over,
  };
}

beforeEach(async () => {
  await clear();
});

describe('saveRoom / loadRoom', () => {
  it('round-trips a room and stamps the schema version', async () => {
    await roomStore.saveRoom(room('a'));
    const back = await roomStore.loadRoom('a');
    expect(back?.name).toBe('Room a');
    expect(back?.width).toBe(6);
    // Stamped on write, not expected from the caller — nothing constructs a
    // RoomData with a version, so if this came from the argument it would be
    // undefined on every record and the field would be useless the day it is
    // first needed.
    expect(back?.version).toBe(ROOM_SCHEMA_VERSION);
  });

  it('keeps the version stamp through a rename', async () => {
    await roomStore.saveRoom(room('a'));
    await roomStore.renameRoom('a', 'Kitchen');
    const back = await roomStore.loadRoom('a');
    expect(back?.name).toBe('Kitchen');
    expect(back?.version).toBe(ROOM_SCHEMA_VERSION);
  });

  it('ignores a rename for a room that is not there', async () => {
    await roomStore.renameRoom('ghost', 'Nope');
    expect(await roomStore.loadRoom('ghost')).toBeUndefined();
    expect((await keys()).length).toBe(0);
  });
});

describe('listRooms', () => {
  it('derives the summary the workspace grid renders', async () => {
    await roomStore.saveRoom(room('a', { detectedObjects: [] }));
    await roomStore.saveCapture('a', { slot: 'n', blob: new Blob(['x']), takenAt: 1 });
    await roomStore.saveCapture('a', { slot: 'e', blob: new Blob(['y']), takenAt: 2 });
    await roomStore.saveTransforms('a', {
      positions: { 'sofa-1': [0, 0, 0], 'bed-1': [1, 0, 1] },
      rotations: {},
      dims: {},
    });

    const [summary] = await roomStore.listRooms();
    expect(summary.id).toBe('a');
    expect(summary.captureCount).toBe(2);
    expect(summary.itemCount).toBe(2);
    // An empty detectedObjects array is NOT "detected" — the detect screen writes
    // one when a run finds nothing, and the grid badge should not claim otherwise.
    expect(summary.detected).toBe(false);
  });

  it('reports a room with no edit record as last touched when it was created', async () => {
    // Written the way a pre-`touched` build wrote it: meta only, no touch key.
    await set('room:old:meta', room('old', { createdAt: 123 }));
    const [summary] = await roomStore.listRooms();
    expect(summary.updatedAt).toBe(123);
  });

  it('sorts most-recently-touched first', async () => {
    await roomStore.saveRoom(room('a'));
    await roomStore.saveRoom(room('b'));
    await roomStore.saveRoom(room('c'));
    // Touch 'a' last.
    await roomStore.renameRoom('a', 'Newest');
    const ids = (await roomStore.listRooms()).map((r) => r.id);
    expect(ids[0]).toBe('a');
  });

  it('skips a room whose meta is gone but whose other keys linger', async () => {
    await roomStore.saveRoom(room('a'));
    await roomStore.saveCapture('orphan', { slot: 'n', blob: new Blob(['x']), takenAt: 1 });
    const ids = (await roomStore.listRooms()).map((r) => r.id);
    expect(ids).toEqual(['a']);
  });
});

describe('clearRoom / restoreRoom ordering', () => {
  it('round-trips every key through the trash', async () => {
    await roomStore.saveRoom(room('a'));
    await roomStore.saveCapture('a', { slot: 'n', blob: new Blob(['x']), takenAt: 1 });
    await roomStore.saveTransforms('a', { positions: { 'sofa-1': [0, 0, 0] }, rotations: {}, dims: {} });

    const token = await roomStore.clearRoom('a');
    expect(await roomStore.loadRoom('a')).toBeUndefined();
    expect(await roomStore.listRooms()).toHaveLength(0);

    expect(await roomStore.restoreRoom(token)).toBe(true);
    expect((await roomStore.loadRoom('a'))?.name).toBe('Room a');
    expect(await roomStore.loadCaptures('a')).toHaveLength(1);
    expect((await roomStore.listRooms())[0].itemCount).toBe(1);
  });

  // The `meta`-first / `meta`-last WRITE ORDER is in tests/storage-ordering.test.ts.
  // It cannot be observed from here: IndexedDB returns keys in sort order, not
  // insertion order, and `room:a:meta` sorts before `room:a:transforms` whichever
  // way round they were written — so an assertion over `keys()` would pass no
  // matter what the implementation did.

  it('refuses to restore over a live room instead of overwriting it', async () => {
    await roomStore.saveRoom(room('a', { name: 'Original' }));
    const token = await roomStore.clearRoom('a');
    // The id is reused before the undo is pressed.
    await roomStore.saveRoom(room('a', { name: 'Replacement' }));

    expect(await roomStore.restoreRoom(token)).toBe(false);
    expect((await roomStore.loadRoom('a'))?.name).toBe('Replacement');
  });

  it('reports false for a token with nothing behind it', async () => {
    expect(await roomStore.restoreRoom({ roomId: 'nope', deletedAt: 1 })).toBe(false);
  });

  it('leaves other rooms alone', async () => {
    await roomStore.saveRoom(room('a'));
    await roomStore.saveRoom(room('b'));
    await roomStore.clearRoom('a');
    const ids = (await roomStore.listRooms()).map((r) => r.id);
    expect(ids).toEqual(['b']);
  });
});

describe('purgeTrash', () => {
  it('drops expired trash and keeps the rest', async () => {
    await roomStore.saveRoom(room('old'));
    await roomStore.saveRoom(room('new'));
    const stale = await roomStore.clearRoom('old');
    const fresh = await roomStore.clearRoom('new');

    // Nothing is old enough yet.
    await roomStore.purgeTrash();
    expect(await roomStore.restoreRoom(stale)).toBe(true);

    // Re-trash it, then purge with a zero TTL: everything is expired.
    await roomStore.clearRoom('old');
    await roomStore.purgeTrash(0);
    expect(await roomStore.restoreRoom(stale)).toBe(false);
    expect(await roomStore.restoreRoom(fresh)).toBe(false);
  });
});

describe('destroyRoom', () => {
  it('erases without leaving anything recoverable', async () => {
    await roomStore.saveRoom(room('a'));
    await roomStore.saveCapture('a', { slot: 'n', blob: new Blob(['x']), takenAt: 1 });
    await roomStore.destroyRoom('a');

    expect(await roomStore.loadRoom('a')).toBeUndefined();
    const left = (await keys()).filter(
      (key) => typeof key === 'string' && (key.includes('room:a:') || key.startsWith('trash:')),
    );
    expect(left).toEqual([]);
  });
});

describe('captures', () => {
  it('replaces a slot rather than accumulating, and deletes cleanly', async () => {
    await roomStore.saveRoom(room('a'));
    await roomStore.saveCapture('a', { slot: 'n', blob: new Blob(['first']), takenAt: 1 });
    await roomStore.saveCapture('a', { slot: 'n', blob: new Blob(['second']), takenAt: 2 });
    expect(await roomStore.loadCaptures('a')).toHaveLength(1);

    await roomStore.deleteCapture('a', 'n');
    expect(await roomStore.loadCaptures('a')).toHaveLength(0);
    // The room itself survives losing its photos.
    expect(await roomStore.loadRoom('a')).toBeDefined();
  });

  it('does not leak captures between rooms', async () => {
    await roomStore.saveRoom(room('a'));
    await roomStore.saveRoom(room('b'));
    await roomStore.saveCapture('a', { slot: 'n', blob: new Blob(['x']), takenAt: 1 });
    await roomStore.saveCapture('b', { slot: 'n', blob: new Blob(['y']), takenAt: 1 });
    expect(await roomStore.loadCaptures('a')).toHaveLength(1);
    expect(await roomStore.loadCaptures('b')).toHaveLength(1);
  });
});

describe('layouts', () => {
  it('lists saved variants oldest-first and deletes one', async () => {
    await roomStore.saveRoom(room('a'));
    const variant = (id: string, createdAt: number) => ({
      id,
      name: id,
      createdAt,
      parts: [],
      transforms: { positions: {}, rotations: {}, dims: {} },
    });
    await roomStore.saveLayout('a', variant('second', 200));
    await roomStore.saveLayout('a', variant('first', 100));

    expect((await roomStore.listLayouts('a')).map((v) => v.id)).toEqual(['first', 'second']);

    await roomStore.deleteLayout('a', 'first');
    expect((await roomStore.listLayouts('a')).map((v) => v.id)).toEqual(['second']);
  });
});

describe('the `uid` field on detections', () => {
  it('survives a save/load round trip', async () => {
    // The reason it exists: it becomes the ScenePart id, so a transform stays
    // attached to the same furniture across a re-detect. A codec that dropped it
    // would look fine until the second detect run.
    await roomStore.saveRoom(
      room('a', {
        detectedObjects: [
          {
            id: 0,
            uid: 'stable-key-1',
            label: 'sofa__slot:n',
            conf: 0.9,
            locked: true,
            box: [0.1, 0.2, 0.3, 0.4],
            category: 'sofa',
          },
        ],
      }),
    );
    const back = await roomStore.loadRoom('a');
    expect(back?.detectedObjects?.[0].uid).toBe('stable-key-1');
    expect(back?.detectedObjects?.[0].locked).toBe(true);
  });
});

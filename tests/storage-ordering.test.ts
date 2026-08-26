// The one safety property a soft delete has here, and the only way to observe it.
//
// idb-keyval is a single store with no transaction across keys, so a tab closed
// halfway through a multi-key delete leaves whatever it had already done. The
// workspace grid keys off `room:{id}:meta`, so the ORDER of the writes is what
// decides whether an interruption is invisible or leaves a room that lists in the
// grid and opens completely empty:
//
//   clearRoom   — meta goes FIRST. Worst case: orphaned payload keys, invisible,
//                 swept by the next purge.
//   restoreRoom — meta comes LAST. The room only reappears once it is whole.
//
// This cannot be checked against a real store: IndexedDB returns keys in sort
// order, and `room:a:meta` sorts before `room:a:transforms` either way round. So
// the store is mocked purely to record the call sequence — the assertions are
// about the order lib/storage.ts issues its operations in, which is exactly the
// thing that was got backwards once already while writing it up.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const store = new Map<string, unknown>();
/** Every operation, in the order lib/storage.ts issued it. */
let log: string[] = [];

vi.mock('idb-keyval', () => ({
  set: (key: string, value: unknown) => {
    log.push(`set ${key}`);
    store.set(key, value);
    return Promise.resolve();
  },
  get: (key: string) => {
    log.push(`get ${key}`);
    return Promise.resolve(store.get(key));
  },
  del: (key: string) => {
    log.push(`del ${key}`);
    store.delete(key);
    return Promise.resolve();
  },
  keys: () => Promise.resolve([...store.keys()]),
}));

const { roomStore } = await import('@/lib/storage');

const ROOM = {
  id: 'a',
  createdAt: 1,
  name: 'Room a',
  layoutId: 'rect' as const,
  width: 6,
  depth: 4,
  height: 2.8,
};

/** Index of the first logged operation matching `re`, or -1. */
const firstAt = (re: RegExp) => log.findIndex((entry) => re.test(entry));
/** Index of the last logged operation matching `re`, or -1. */
const lastAt = (re: RegExp) => log.reduce((best, entry, i) => (re.test(entry) ? i : best), -1);

async function seedRoom() {
  await roomStore.saveRoom(ROOM);
  await roomStore.saveTransforms('a', {
    positions: { 'sofa-1': [0, 0, 0] },
    rotations: {},
    dims: {},
  });
  await roomStore.saveCapture('a', { slot: 'n', blob: new Blob(['x']), takenAt: 1 });
  await roomStore.saveSceneParts('a', []);
  log = [];
}

beforeEach(() => {
  store.clear();
  log = [];
});

describe('clearRoom write order', () => {
  it('retires `meta` before it touches any other key', async () => {
    await seedRoom();
    await roomStore.clearRoom('a');

    const metaGone = firstAt(/^del room:a:meta$/);
    expect(metaGone).toBeGreaterThanOrEqual(0);

    // Nothing else may be deleted before meta is.
    const otherDeletes = log
      .map((entry, i) => ({ entry, i }))
      .filter(({ entry }) => /^del room:a:/.test(entry) && !/meta$/.test(entry));
    expect(otherDeletes.length).toBeGreaterThan(0);
    for (const { entry, i } of otherDeletes) {
      expect(i, `${entry} was deleted before room:a:meta`).toBeGreaterThan(metaGone);
    }
  });

  it('parks meta in the trash before deleting it, so an interruption loses nothing', async () => {
    await seedRoom();
    await roomStore.clearRoom('a');
    const parked = firstAt(/^set trash:\d+:room:a:meta$/);
    const removed = firstAt(/^del room:a:meta$/);
    expect(parked).toBeGreaterThanOrEqual(0);
    expect(removed).toBeGreaterThan(parked);
  });
});

describe('restoreRoom write order', () => {
  it('writes `meta` after every other key it restores', async () => {
    await seedRoom();
    const token = await roomStore.clearRoom('a');
    log = [];
    expect(await roomStore.restoreRoom(token)).toBe(true);

    const metaBack = lastAt(/^set room:a:meta$/);
    expect(metaBack).toBeGreaterThanOrEqual(0);

    const otherWrites = log
      .map((entry, i) => ({ entry, i }))
      .filter(({ entry }) => /^set room:a:/.test(entry) && !/meta$/.test(entry));
    expect(otherWrites.length).toBeGreaterThan(0);
    for (const { entry, i } of otherWrites) {
      expect(i, `${entry} was restored after room:a:meta`).toBeLessThan(metaBack);
    }
  });

  it('checks for a live room before writing anything at all', async () => {
    await seedRoom();
    const token = await roomStore.clearRoom('a');
    await roomStore.saveRoom({ ...ROOM, name: 'Replacement' });
    log = [];

    expect(await roomStore.restoreRoom(token)).toBe(false);
    // Refused, so nothing may have been written or deleted.
    expect(log.filter((entry) => /^(set|del) /.test(entry))).toEqual([]);
  });
});

describe('destroyRoom write order', () => {
  it('follows the same rule as clearRoom', async () => {
    await seedRoom();
    await roomStore.destroyRoom('a');

    const metaGone = firstAt(/^del room:a:meta$/);
    expect(metaGone).toBeGreaterThanOrEqual(0);
    // And nothing is parked in the trash — this is the irreversible path.
    expect(log.some((entry) => entry.startsWith('set trash:'))).toBe(false);
    for (const [i, entry] of log.entries()) {
      if (/^del room:a:/.test(entry) && !/meta$/.test(entry)) {
        expect(i, `${entry} was deleted before room:a:meta`).toBeGreaterThan(metaGone);
      }
    }
  });
});

describe('importScene write order', () => {
  const ROOM_IN = { name: 'Opened room', layoutId: 'rect' as const, width: 5, depth: 4, height: 2.6 };
  const EMPTY = { positions: {}, rotations: {}, dims: {} };

  it('writes `meta` last, so a half-finished import is invisible rather than empty', async () => {
    // Same property as restoreRoom, for the same reason: an import is several keys
    // with no transaction across them, and `listRooms` decides a room exists by its
    // meta. Furniture first means an interrupted import leaves orphaned payload
    // keys, not a room that lists in the workspace and opens with nothing in it.
    const id = await roomStore.importScene(ROOM_IN, [{ id: 'sofa-1' }], EMPTY);

    const metaWrite = lastAt(new RegExp(`^set room:${id}:meta$`));
    expect(metaWrite).toBeGreaterThanOrEqual(0);

    // `touched` is excluded: it is the updatedAt stamp every mutation in the store
    // ends with, not payload. Landing after meta costs at most a missing timestamp
    // on a room that is otherwise whole, and `saveRoom` orders it the same way.
    const payloadWrites = log
      .map((entry, i) => ({ entry, i }))
      .filter(
        ({ entry }) =>
          new RegExp(`^set room:${id}:`).test(entry) && !/(meta|touched)$/.test(entry),
      );
    expect(payloadWrites.map((w) => w.entry)).toContain(`set room:${id}:scene`);
    expect(payloadWrites.map((w) => w.entry)).toContain(`set room:${id}:transforms`);
    for (const { entry, i } of payloadWrites) {
      expect(i, `${entry} was written after room:${id}:meta`).toBeLessThan(metaWrite);
    }
  });

  it('mints a fresh id, so opening a file cannot overwrite the room it came from', async () => {
    await roomStore.saveRoom(ROOM);
    const a = await roomStore.importScene(ROOM_IN, [], EMPTY);
    const b = await roomStore.importScene(ROOM_IN, [], EMPTY);
    expect(a).not.toBe(b);
    expect(a).not.toBe('a');
    // The pre-existing room is untouched by either import.
    expect(await roomStore.loadRoom('a')).toMatchObject({ name: 'Room a' });
  });
});

describe('reslotCaptures write order', () => {
  it('writes every photo to its new wall before vacating any old one', async () => {
    // The asymmetry that decides which way round this goes: a vacated key that
    // outlives its write is a duplicate photo the next reload shows twice, and
    // the user can delete it. A deleted key whose write never landed is a
    // photograph that is gone. Interrupt this halfway and only one of those is
    // recoverable, so every `set` precedes every `del`.
    await roomStore.saveRoom(ROOM);
    await roomStore.saveCapture('a', { slot: 'n', blob: new Blob(['one']), takenAt: 1 });
    await roomStore.saveCapture('a', { slot: 'e', blob: new Blob(['two']), takenAt: 2 });
    log = [];

    await roomStore.reslotCaptures('a', { n: 's', e: 'w' });

    const lastWrite = lastAt(/^set room:a:cap:/);
    const firstDelete = firstAt(/^del room:a:cap:/);
    expect(lastWrite).toBeGreaterThanOrEqual(0);
    expect(firstDelete).toBeGreaterThan(lastWrite);
  });
});

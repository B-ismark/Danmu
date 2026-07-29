// @vitest-environment jsdom
//
// Its own file because it has to replace idb-keyval wholesale, and the rest of the
// storage suite deliberately runs against a real (fake-indexeddb) store.
//
// What is under test is the eight-line wrapper in lib/storage.ts: when the browser
// refuses a write for space, it fires `danmu:storage-full` (which StorageToast
// listens for) AND re-throws. Both halves matter — swallowing the error would make
// a failed save look successful, and not firing the event would make a full disk
// silent.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const store = new Map<string, unknown>();
let failNextSet: Error | null = null;

vi.mock('idb-keyval', () => ({
  set: (key: string, value: unknown) => {
    if (failNextSet) {
      const e = failNextSet;
      failNextSet = null;
      return Promise.reject(e);
    }
    store.set(key, value);
    return Promise.resolve();
  },
  get: (key: string) => Promise.resolve(store.get(key)),
  del: (key: string) => {
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

beforeEach(() => {
  store.clear();
  failNextSet = null;
});

function quotaError(name: string, message = 'out of space') {
  const e = new Error(message);
  e.name = name;
  return e;
}

describe('the storage-full wrapper', () => {
  it('announces a QuotaExceededError and still rejects', async () => {
    const seen: string[] = [];
    const onFull = (e: Event) => seen.push(String((e as CustomEvent).detail));
    window.addEventListener('danmu:storage-full', onFull);

    failNextSet = quotaError('QuotaExceededError');
    await expect(roomStore.saveRoom(ROOM)).rejects.toThrow('out of space');
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain('out of space');

    window.removeEventListener('danmu:storage-full', onFull);
  });

  it('also catches the message-only form, where the name is not the DOM one', async () => {
    // Safari has reported this as a plain error whose message merely mentions the
    // quota, which is why the wrapper tests both.
    const seen: string[] = [];
    const onFull = () => seen.push('x');
    window.addEventListener('danmu:storage-full', onFull);

    failNextSet = quotaError('Error', 'The quota has been exceeded.');
    await expect(roomStore.saveRoom(ROOM)).rejects.toThrow(/quota/i);
    expect(seen).toHaveLength(1);

    window.removeEventListener('danmu:storage-full', onFull);
  });

  it('does not announce an unrelated failure, but still rejects', async () => {
    const seen: string[] = [];
    const onFull = () => seen.push('x');
    window.addEventListener('danmu:storage-full', onFull);

    failNextSet = quotaError('InvalidStateError', 'database is closed');
    await expect(roomStore.saveRoom(ROOM)).rejects.toThrow('database is closed');
    expect(seen).toHaveLength(0);

    window.removeEventListener('danmu:storage-full', onFull);
  });
});

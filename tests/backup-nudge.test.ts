// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  afterFileSaved,
  afterSave,
  keepOnly,
  pruneNudges,
  BACKUP_NUDGE_AFTER_SAVES,
  noteFileSaved,
  noteRoomSaved,
  requestPersistentStorage,
} from '@/lib/backup-nudge';

describe('afterSave', () => {
  it('offers exactly once, on the threshold save, and never again', () => {
    let state = {};
    const offers: number[] = [];
    for (let i = 1; i <= 50; i++) {
      const r = afterSave(state, 'a', 20);
      state = r.state;
      if (r.offer) offers.push(i);
    }
    expect(offers).toEqual([20]);
  });

  it('counts rooms apart', () => {
    let s = afterSave({}, 'a', 2).state;
    const b = afterSave(s, 'b', 2);
    expect(b.offer).toBe(false);
    s = b.state;
    expect(afterSave(s, 'a', 2).offer).toBe(true);
    expect(afterSave(s, 'b', 2).offer).toBe(true);
  });

  it('is twenty saves by default', () => {
    expect(BACKUP_NUDGE_AFTER_SAVES).toBe(20);
  });
});

describe('afterFileSaved', () => {
  it('closes the question before the threshold is reached', () => {
    let state = afterFileSaved({}, 'a');
    let offered = false;
    for (let i = 0; i < 40; i++) {
      const r = afterSave(state, 'a', 20);
      state = r.state;
      offered ||= r.offer;
    }
    expect(offered).toBe(false);
  });
});

describe('keepOnly', () => {
  it('drops the rooms that are gone and keeps the rest as they were', () => {
    const state = { a: { saves: 3 }, b: { saves: 20, done: true as const }, c: { saves: 1 } };
    expect(keepOnly(state, new Set(['b', 'c']))).toEqual({ b: { saves: 20, done: true }, c: { saves: 1 } });
    expect(keepOnly(state, new Set())).toEqual({});
  });
});

describe('the localStorage half', () => {
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('persists the count across calls', () => {
    const offers = Array.from({ length: 25 }, () => noteRoomSaved('r'));
    expect(offers.indexOf(true)).toBe(19);
    expect(offers.filter(Boolean)).toHaveLength(1);
  });

  it('a saved file stops the offer', () => {
    noteFileSaved('r');
    expect(Array.from({ length: 25 }, () => noteRoomSaved('r')).some(Boolean)).toBe(false);
  });

  it('prunes a deleted room, so its count starts again', () => {
    for (let i = 0; i < 10; i++) noteRoomSaved('gone');
    noteRoomSaved('kept');
    pruneNudges(new Set(['kept']));
    const stored = JSON.parse(localStorage.getItem('danmu:backup-nudge')!);
    expect(Object.keys(stored)).toEqual(['kept']);
  });

  it('reads a corrupt record as empty rather than throwing', () => {
    localStorage.setItem('danmu:backup-nudge', '{not json');
    expect(noteRoomSaved('r')).toBe(false);
    localStorage.setItem('danmu:backup-nudge', JSON.stringify({ r: { saves: 'x' } }));
    expect(noteRoomSaved('r')).toBe(false);
  });

  it('survives storage that throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(() => noteRoomSaved('r')).not.toThrow();
    expect(() => noteFileSaved('r')).not.toThrow();
  });
});

describe('requestPersistentStorage', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('asks only when not already persistent', async () => {
    const persist = vi.fn(async () => true);
    vi.stubGlobal('navigator', { storage: { persisted: async () => true, persist } });
    expect(await requestPersistentStorage()).toBe(true);
    expect(persist).not.toHaveBeenCalled();
  });

  it('asks, and reports the answer', async () => {
    const persist = vi.fn(async () => false);
    vi.stubGlobal('navigator', { storage: { persisted: async () => false, persist } });
    expect(await requestPersistentStorage()).toBe(false);
    expect(persist).toHaveBeenCalledOnce();
  });

  it('is null where the browser has no such API, and never throws', async () => {
    vi.stubGlobal('navigator', {});
    expect(await requestPersistentStorage()).toBeNull();
    vi.stubGlobal('navigator', { storage: { persist: async () => { throw new Error('no'); } } });
    expect(await requestPersistentStorage()).toBeNull();
  });
});

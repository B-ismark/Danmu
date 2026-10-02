import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MODEL_DIGESTS, MODEL_FILE, NAMES_FILE, WORLD_FILE } from '@/lib/model-verify';
import { writeCachedModel } from '@/lib/model-cache';

const REMOTE = 'https://huggingface.co/DearthAI/danmu-detector/resolve/main/';
const SIZE: Record<string, number> = { [NAMES_FILE]: 20_000, [MODEL_FILE]: 14_222_876, [WORLD_FILE]: 50_434_902 };

function fakeCaches() {
  const kept = new Map<string, Response>();
  const cache = {
    match: async (u: string) => kept.get(u)?.clone(),
    put: async (u: string, r: Response) => void kept.set(u, r),
    delete: async (u: string) => kept.delete(u),
  };
  return { open: async () => cache, delete: async () => (kept.clear(), true) };
}

describe('detectorStatus', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('caches', fakeCaches());
    // The local export is absent; the mirror answers every HEAD with the file's size.
    vi.stubGlobal('fetch', async (url: string) => {
      if (url.startsWith('/models/')) return new Response(null, { status: 404 });
      const file = url.slice(REMOTE.length);
      return new Response(null, { status: 200, headers: { 'content-length': String(SIZE[file]) } });
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('owes the whole pack when nothing is kept, and counts each pack its own files', async () => {
    const { detectorStatus } = await import('@/lib/local-detect');
    const full = await detectorStatus('full');
    const basic = await detectorStatus('basic');
    expect(full).toEqual({ owed: SIZE[NAMES_FILE] + SIZE[MODEL_FILE] + SIZE[WORLD_FILE], update: false, kept: 0, size: full.owed, unreachable: false });
    expect(basic.owed).toBe(SIZE[NAMES_FILE] + SIZE[MODEL_FILE]);
  });

  it('owes nothing for a pack kept at this version, and calls an older copy an update', async () => {
    for (const f of [NAMES_FILE, MODEL_FILE]) await writeCachedModel(REMOTE + f, new ArrayBuffer(1), MODEL_DIGESTS[f]);
    await writeCachedModel(REMOTE + WORLD_FILE, new ArrayBuffer(1), 'sha256-an-older-model');
    const { detectorStatus } = await import('@/lib/local-detect');
    expect(await detectorStatus('basic')).toMatchObject({ owed: 0, update: false });
    expect(await detectorStatus('full')).toMatchObject({ owed: SIZE[WORLD_FILE], update: true });
  });

  it('says when the mirror cannot be reached, rather than that nothing is owed', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('offline');
    });
    const { detectorStatus } = await import('@/lib/local-detect');
    expect(await detectorStatus('full')).toMatchObject({ owed: 0, unreachable: true });
  });
});

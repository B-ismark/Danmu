import { afterEach, describe, expect, it, vi } from 'vitest';
import { dropCachedModel, hasCachedModel, megabytes, readCachedModel, writeCachedModel } from '@/lib/model-cache';

/** A Cache Storage that keeps bytes in a map, enough to hold the module to its contract. */
function fakeCaches() {
  const kept = new Map<string, ArrayBuffer>();
  const cache = {
    match: async (url: string) => (kept.has(url) ? new Response(kept.get(url)!) : undefined),
    put: async (url: string, res: Response) => void kept.set(url, await res.arrayBuffer()),
    delete: async (url: string) => kept.delete(url),
  };
  return { kept, caches: { open: async () => cache } };
}

describe('model-cache', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('keeps bytes, reads them back, and forgets them when dropped', async () => {
    const f = fakeCaches();
    vi.stubGlobal('caches', f.caches);
    const url = 'https://example.test/m.onnx';
    expect(await hasCachedModel(url)).toBe(false);
    expect(await readCachedModel(url)).toBeNull();
    await writeCachedModel(url, new Uint8Array([1, 2, 3]).buffer);
    expect(await hasCachedModel(url)).toBe(true);
    expect([...new Uint8Array((await readCachedModel(url))!)]).toEqual([1, 2, 3]);
    await dropCachedModel(url);
    expect(await hasCachedModel(url)).toBe(false);
  });

  it('is a quiet no-op where Cache Storage is missing or throws', async () => {
    vi.stubGlobal('caches', undefined);
    expect(await readCachedModel('u')).toBeNull();
    expect(await hasCachedModel('u')).toBe(false);
    await expect(writeCachedModel('u', new ArrayBuffer(1))).resolves.toBeUndefined();
    vi.stubGlobal('caches', { open: async () => { throw new Error('blocked'); } });
    expect(await readCachedModel('u')).toBeNull();
    await expect(dropCachedModel('u')).resolves.toBeUndefined();
  });

  it('says sizes in whole megabytes and never zero', () => {
    expect(megabytes(64_657_778)).toBe('65 MB');
    expect(megabytes(14_222_876)).toBe('14 MB');
    expect(megabytes(10)).toBe('1 MB');
  });
});

describe('the service worker', () => {
  it('keeps the detector cache across deployments, under the same name the page writes', async () => {
    const { readFileSync } = await import('node:fs');
    const sw = readFileSync('public/sw.js', 'utf8');
    const page = readFileSync('lib/model-cache.ts', 'utf8');
    const name = /const CACHE = '([^']+)'/.exec(page)![1];
    expect(sw).toContain(`const MODELS = '${name}'`);
    expect(sw).toMatch(/const KEEP = \[[^\]]*\bMODELS\b[^\]]*\]/);
  });
});

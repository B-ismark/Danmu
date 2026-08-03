// What public/sw.js actually does, driven as behaviour.
//
// A caching service worker is the one piece of this app that can serve a user
// something other than what the server said — and it fails in the quietest
// possible way, by handing back bytes that used to be right. Reading it is not
// enough, so it runs here in a small ServiceWorkerGlobalScope
// (tests/helpers/sw-harness.ts) with a network that can be told to fail.
//
// The three properties that matter, in order of what they cost if wrong:
//   1. It never caches or intercepts anything cross-origin. The app's only egress
//      is the user's own Gemini key over their own data; a cache is storage, and
//      storing that is not this worker's business.
//   2. An offline reload serves the page the user was on, not the home page.
//   3. Hashed assets come from the cache; anything mutable is asked for first.

import { describe, expect, it } from 'vitest';
import { asset, loadServiceWorker, navigation, ORIGIN } from './helpers/sw-harness';

const CHUNK = '/_next/static/chunks/788-868926e9decf14b8.js';

async function installed() {
  const sw = loadServiceWorker();
  await sw.install();
  await sw.activate();
  sw.calls.length = 0;
  return sw;
}

describe('cross-origin traffic is not the worker’s business', () => {
  // Each of these is a host the CSP allows for a reason, and none of them should
  // ever end up in a Cache Storage bucket on the user's disk.
  const foreign = [
    'https://generativelanguage.googleapis.com/v1beta/models:generateContent',
    'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/ort.min.js',
    'https://huggingface.co/model/resolve/main/weights.onnx',
  ];

  it.each(foreign)('declines to handle %s', async (url) => {
    const sw = await installed();
    const answered = await sw.fetch(new Request(url));
    // Not "answers with the network response" — does not answer at all.
    expect(answered).toBeNull();
    expect(sw.calls).toHaveLength(0);
  });

  it('stores nothing for them', async () => {
    const sw = await installed();
    for (const url of foreign) await sw.fetch(new Request(url));
    const stored = (await Promise.all([...sw.cacheStorage.caches.values()].map((c) => c.urls()))).flat();
    expect(stored.filter((u) => !u.startsWith(ORIGIN))).toEqual([]);
  });
});

describe('requests it deliberately keeps out of', () => {
  it('ignores a non-GET', async () => {
    const sw = await installed();
    expect(await sw.fetch(new Request(new URL('/', ORIGIN), { method: 'POST' }))).toBeNull();
  });

  it('ignores a range request, which wants a slice and not a whole cached body', async () => {
    const sw = await installed();
    const req = new Request(new URL('/big.bin', ORIGIN), { headers: { range: 'bytes=0-99' } });
    expect(await sw.fetch(req)).toBeNull();
  });
});

describe('install', () => {
  it('precaches the fixed routes, bypassing the HTTP cache', async () => {
    const sw = loadServiceWorker();
    await sw.install();
    const shell = await sw.cacheStorage.open('danmu-shell-v1');
    expect(shell.urls()).toEqual([`${ORIGIN}/`, `${ORIGIN}/onboarding/welcome`, `${ORIGIN}/settings`, `${ORIGIN}/workspace`]);
    // `cache: 'reload'` — an install must not adopt a stale HTTP-cached copy.
    expect(sw.calls.every((c) => c.cacheMode === 'reload')).toBe(true);
  });

  it('still caches the rest when one route 404s', async () => {
    // The reason precaching is a Promise.all of individual puts and not addAll:
    // addAll rejects atomically, so one bad URL would leave nothing cached and the
    // worker would look installed while being useless.
    const sw = loadServiceWorker();
    sw.setNetwork(async (req) =>
      req.url.endsWith('/settings') ? new Response('nope', { status: 404 }) : new Response('ok', { status: 200 }),
    );
    await sw.install();
    const shell = await sw.cacheStorage.open('danmu-shell-v1');
    expect(shell.urls()).toContain(`${ORIGIN}/`);
    expect(shell.urls()).not.toContain(`${ORIGIN}/settings`);
  });

  it('survives a network that is down at install time', async () => {
    const sw = loadServiceWorker();
    sw.goOffline();
    await expect(sw.install()).resolves.toBeUndefined();
  });
});

describe('activate', () => {
  it('deletes caches from an older version and keeps both of this one', async () => {
    const sw = loadServiceWorker();
    // A previous deployment's pair, plus something that is not ours at all.
    await sw.cacheStorage.open('danmu-shell-v0');
    await sw.cacheStorage.open('danmu-assets-v0');
    await sw.cacheStorage.open('something-else-entirely');
    // …and the current pair, as a worker that had already served assets would have.
    await sw.cacheStorage.open('danmu-assets-v1');
    await sw.install();
    await sw.activate();
    expect((await sw.cacheStorage.keys()).sort()).toEqual(['danmu-assets-v1', 'danmu-shell-v1']);
  });

  it('leaves the assets cache to be created on first use, not at install', async () => {
    // Not a bug, and worth pinning so it is not "fixed": an empty cache bucket
    // buys nothing, and `activate` keeps the name whenever it does show up.
    const sw = loadServiceWorker();
    await sw.install();
    await sw.activate();
    expect(await sw.cacheStorage.keys()).toEqual(['danmu-shell-v1']);

    sw.setNetwork(async () => new Response('chunk', { status: 200 }));
    await sw.fetch(asset(CHUNK));
    expect((await sw.cacheStorage.keys()).sort()).toEqual(['danmu-assets-v1', 'danmu-shell-v1']);
  });

  it('claims open pages so the first load is controlled', async () => {
    const sw = loadServiceWorker();
    await sw.activate();
    expect(sw.claimed()).toBe(true);
  });
});

describe('hashed assets are cache-first', () => {
  it('goes to the network once, then never again', async () => {
    const sw = await installed();
    sw.setNetwork(async () => new Response('chunk', { status: 200 }));

    const first = await sw.fetch(asset(CHUNK));
    expect(await first!.text()).toBe('chunk');
    expect(sw.calls).toHaveLength(1);

    const second = await sw.fetch(asset(CHUNK));
    expect(await second!.text()).toBe('chunk');
    // The point of the whole strategy: a content-hashed URL is never re-fetched.
    expect(sw.calls).toHaveLength(1);
  });

  it('serves a hashed asset offline once it has been seen', async () => {
    const sw = await installed();
    sw.setNetwork(async () => new Response('chunk', { status: 200 }));
    await sw.fetch(asset(CHUNK));
    sw.goOffline();
    const res = await sw.fetch(asset(CHUNK));
    expect(await res!.text()).toBe('chunk');
  });

  it('keeps the cache write alive with waitUntil, not as a dangling promise', async () => {
    // A worker is killed once the promise given to respondWith settles. A bare
    // `cache.put(...)` is not part of that promise, so the response is returned,
    // the worker is terminated, and the write is silently dropped — a cache that
    // appears to work and then does not. Nothing else observes this.
    const sw = await installed();
    sw.setNetwork(async () => new Response('chunk', { status: 200 }));
    await sw.fetch(asset(CHUNK));
    expect(sw.extendedOnLastFetch()).toBe(1);

    // …and not on a cache hit, where there is nothing to write.
    await sw.fetch(asset(CHUNK));
    expect(sw.extendedOnLastFetch()).toBe(0);
  });

  it('matches the immutable prefix on the path, not anywhere in the URL', async () => {
    // `url.includes('/_next/static/')` would treat this as immutable and cache it
    // permanently, on the strength of a query string mentioning the prefix.
    const sw = await installed();
    sw.setNetwork(async () => new Response('not really static', { status: 200 }));
    const sneaky = asset('/api-ish?next=/_next/static/chunks/x.js');
    await sw.fetch(sneaky);
    const assets = await sw.cacheStorage.open('danmu-assets-v1');
    // It is still same-origin, so it is cached — but as mutable, network-first.
    // The proof it took the other branch: a second fetch goes to the network again.
    const before = sw.calls.length;
    await sw.fetch(sneaky);
    expect(sw.calls.length).toBe(before + 1);
    expect(assets.urls()).toHaveLength(1);
  });

  it('does not cache a failed asset response', async () => {
    const sw = await installed();
    sw.setNetwork(async () => new Response('boom', { status: 500 }));
    await sw.fetch(asset(CHUNK));
    const assets = await sw.cacheStorage.open('danmu-assets-v1');
    expect(assets.urls()).toEqual([]);
  });
});

describe('navigation', () => {
  it('prefers the network while it is there', async () => {
    const sw = await installed();
    sw.setNetwork(async () => new Response('fresh page', { status: 200 }));
    const res = await sw.fetch(navigation('/workspace'));
    expect(await res!.text()).toBe('fresh page');
    expect(sw.calls).toHaveLength(1);
  });

  it('offline, serves the page the user was actually on', async () => {
    // The failure this exists to prevent: reloading /room/<id>/model offline and
    // being dropped on the home page, which reads as "my room is gone".
    const room = '/room/8f2c/model';
    const sw = await installed();
    sw.setNetwork(async () => new Response('the studio', { status: 200 }));
    await sw.fetch(navigation(room));

    sw.goOffline();
    const res = await sw.fetch(navigation(room));
    expect(await res!.text()).toBe('the studio');
  });

  it('offline on a page never visited, falls back to the landing page', async () => {
    const sw = await installed();
    sw.goOffline();
    const res = await sw.fetch(navigation('/room/never-opened/plan'));
    expect(res!.ok).toBe(true);
    // Precached '/' — the app loads and can read its own IndexedDB, which is
    // where the rooms are. Better than the browser's dinosaur.
    expect(await res!.text()).toBe('ok');
  });

  it('offline with nothing cached at all resolves to an error, not a hang', async () => {
    const sw = loadServiceWorker();
    sw.goOffline();
    await sw.install(); // every precache fails
    const res = await sw.fetch(navigation('/'));
    expect(res).not.toBeNull();
    expect(res!.type).toBe('error');
  });
});

// Danmu's service worker — the one thing standing between "your rooms are safe
// offline" and "you can open the app offline".
//
// The app was already offline-*tolerant*: pull the network out mid-session and the
// geometry engine, the solver, the room report and IndexedDB all keep working,
// because none of them fetch anything. What failed was a *reload* — the browser
// had nowhere to get the document and chunks from, so it showed its own
// "No internet" page for an app that needed none.
//
// ── Why there is no build-time precache manifest ────────────────────────────
//
// The honest limit of this worker: **the first visit has to be online.** A
// precache list would have to name Next's content-hashed chunks
// (`/_next/static/chunks/788-868926e9decf14b8.js`), which a hand-written file in
// public/ cannot know — the names change every build. Generating one means a
// postbuild step writing into public/, which is snapshotted at build time on the
// hosts this app is meant for, so it would work locally and silently ship an
// empty list.
//
// So assets are cached on first use instead. After one online visit the app opens
// offline; before it, it cannot. That is a real limitation, stated here rather
// than discovered.
//
// ── What is deliberately never cached ──────────────────────────────────────
//
// Cross-origin requests are passed straight through and never stored: Gemini
// (the user's own key, their data), the ONNX Runtime CDN, and the detector
// weights. A cache is storage, and storage of someone else's room photos or a
// response to an authenticated call is not this worker's business. The origin
// check is the first thing `fetch` does.

const VERSION = 'v1';
const SHELL = `danmu-shell-${VERSION}`;
const ASSETS = `danmu-assets-${VERSION}`;
const KEEP = [SHELL, ASSETS];

// The routes that exist at fixed URLs, so they can be had up front. The studio
// lives under /room/<uuid>/, which is per-room and cached when visited.
const PRECACHE = ['/', '/workspace', '/onboarding/welcome', '/settings'];

// Content-hashed and immutable — a URL match here is always the right bytes.
// Compared against the *pathname*: `url.includes()` would also match a query
// string that merely mentioned the prefix, and hand a caller a permanently
// cached response for a URL that was never immutable at all.
const IMMUTABLE = '/_next/static/';

self.addEventListener('install', (event) => {
  // `reload` so an install never adopts whatever the HTTP cache happens to hold.
  // Individually, not as one addAll: addAll rejects atomically, so a single 404
  // would leave the whole shell uncached and the worker useless.
  event.waitUntil(
    caches.open(SHELL).then(async (cache) => {
      await Promise.all(
        PRECACHE.map((url) =>
          fetch(new Request(url, { cache: 'reload' }))
            .then((res) => (res.ok ? cache.put(url, res) : undefined))
            .catch(() => undefined),
        ),
      );
    }),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => !KEEP.includes(n)).map((n) => caches.delete(n)));
      await self.clients.claim();
    })(),
  );
});

// Deliberately no `skipWaiting()`. A new deployment's chunks do not match the old
// document, and taking over a live tab mid-session is how you serve a half-updated
// app to someone in the middle of arranging a room. The new worker waits for the
// next load, which is the boring, correct behaviour.

// Both strategies take the *event*, not just the request, so a cache write can be
// handed to `event.waitUntil`. A service worker is killed once the promise given to
// `respondWith` settles, and a bare `cache.put(...)` is not part of that promise —
// so the response is returned, the worker is terminated, and the write is silently
// dropped. It looks like a cache that works and then does not.

/** Cache-first: for bytes whose URL already identifies them exactly. */
async function immutable(event) {
  const request = event.request;
  const cache = await caches.open(ASSETS);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) event.waitUntil(cache.put(request, res.clone()));
  return res;
}

/** Network-first, cache as a fallback: for anything whose content can change. */
async function fresh(event, cacheName) {
  const request = event.request;
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(request);
    // Only 200s, and never an opaque response — an opaque (no-cors cross-origin)
    // body has no readable status, so caching one stores a blank that later reads
    // as a hit. Tested against `opaque` rather than *for* `basic`: a same-origin
    // fetch is `basic` in a browser but not in every runtime this is exercised in,
    // and a check that silently never caches is worse than no check. The origin
    // guard in `fetch` is what actually keeps cross-origin out.
    if (res.ok && res.type !== 'opaque') event.waitUntil(cache.put(request, res.clone()));
    return res;
  } catch (err) {
    const hit = await cache.match(request);
    if (hit) return hit;
    throw err;
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Never touch anything but plain GETs, and never anything off this origin.
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // A range request wants a slice; serving it a whole cached body is a bug.
  if (request.headers.has('range')) return;

  if (url.pathname.startsWith(IMMUTABLE)) {
    event.respondWith(immutable(event));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      // `fresh` has already tried this exact URL in the cache — that is what makes
      // a reload of /room/<id>/model come back as that room rather than the home
      // page. So by the time this catch runs, the page genuinely was never
      // visited, and the precached landing page is the only thing left. (An
      // earlier version re-tried `cache.match(request)` here, which read as if
      // this were where per-URL fallback happened; it was dead code, and a
      // mutation test proved it by deleting it with nothing going red.)
      fresh(event, SHELL).catch(async () => {
        const cache = await caches.open(SHELL);
        return (await cache.match('/')) ?? Response.error();
      }),
    );
    return;
  }

  // Everything else same-origin: the manifest, the icon, and Next's RSC payloads
  // for client-side navigation. Fresh when possible so a deploy is picked up,
  // cached so an offline client-side navigation still resolves.
  event.respondWith(fresh(event, ASSETS).catch(() => Response.error()));
});

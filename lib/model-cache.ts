// The detector's weights, kept after the first download.
//
// The mirror serves both models with `cache-control: no-store` (measured 2026-10-02:
// 14.2 MB and 50.4 MB), so the browser kept nothing and every scan in a new page
// downloaded ~65 MB again. On mobile data that is the most expensive thing this app
// does, by two orders of magnitude.
//
// So the verified bytes go into Cache Storage, under this origin. That is not the
// service worker's "never cache cross-origin" rule being bent: the worker must not
// store responses to calls made with a user's key over their photos, and these are
// public model files fetched with no credentials. Nothing about the user is in them.
//
// A cached copy is VERIFIED again on every read (the caller's digest check runs on
// whatever this returns), so a damaged or tampered entry is refused exactly like a
// bad download, and then replaced. Every call is inside a try: Cache Storage is
// absent in some private windows and throws where site data is blocked, and the only
// cost of that is downloading again.

const CACHE = 'danmu-detector-v1';

function store(): CacheStorage | null {
  try {
    return typeof caches === 'undefined' ? null : caches;
  } catch {
    return null;
  }
}

/** The bytes kept for `url`, or null. */
export async function readCachedModel(url: string): Promise<ArrayBuffer | null> {
  try {
    const c = store();
    if (!c) return null;
    const hit = await (await c.open(CACHE)).match(url);
    return hit ? await hit.arrayBuffer() : null;
  } catch {
    return null;
  }
}

/** Whether `url` is kept, without reading 50 MB to find out. */
export async function hasCachedModel(url: string): Promise<boolean> {
  try {
    const c = store();
    if (!c) return false;
    return (await (await c.open(CACHE)).match(url)) !== undefined;
  } catch {
    return false;
  }
}

/** Keep verified bytes for `url`. Call only after the digest check passed. */
export async function writeCachedModel(url: string, buf: ArrayBuffer): Promise<void> {
  try {
    const c = store();
    if (!c) return;
    await (await c.open(CACHE)).put(url, new Response(buf, { headers: { 'content-type': 'application/octet-stream' } }));
  } catch {
    // Full or blocked: the next scan downloads again, which is today's behaviour.
  }
}

/** Drop a kept copy that failed verification, so the next read fetches fresh. */
export async function dropCachedModel(url: string): Promise<void> {
  try {
    const c = store();
    if (!c) return;
    await (await c.open(CACHE)).delete(url);
  } catch {
    // Nothing to do.
  }
}

/** Megabytes, as a person reads them: whole numbers, never "0". */
export function megabytes(bytes: number): string {
  return `${Math.max(1, Math.round(bytes / 1e6))} MB`;
}

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

/** The header a kept copy carries its digest in, written when it was verified. */
const DIGEST_HEADER = 'x-danmu-digest';

/** Whether `url` is kept and is the version `digest` names, without reading 50 MB to
 *  find out: `stale` is a copy verified against a different pin, which is what an app
 *  update that ships a new model looks like from here. A copy with no recorded digest
 *  (kept before this header existed) reads as stale, so it is offered as an update
 *  rather than trusted unread. The read itself still verifies the bytes. */
export async function keptState(url: string, digest: string | undefined): Promise<'kept' | 'stale' | 'missing'> {
  try {
    const c = store();
    if (!c) return 'missing';
    const hit = await (await c.open(CACHE)).match(url);
    if (!hit) return 'missing';
    return digest !== undefined && hit.headers.get(DIGEST_HEADER) === digest ? 'kept' : 'stale';
  } catch {
    return 'missing';
  }
}

/** Keep verified bytes for `url`, labelled with the digest they were checked against.
 *  Call only after that check passed. */
export async function writeCachedModel(url: string, buf: ArrayBuffer, digest: string | undefined): Promise<void> {
  try {
    const c = store();
    if (!c) return;
    const headers: Record<string, string> = { 'content-type': 'application/octet-stream' };
    if (digest) headers[DIGEST_HEADER] = digest;
    await (await c.open(CACHE)).put(url, new Response(buf, { headers }));
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

/** Remove every kept file: Settings' "Remove". */
export async function clearCachedModels(): Promise<void> {
  try {
    const c = store();
    if (!c) return;
    await c.delete(CACHE);
  } catch {
    // Nothing to do.
  }
}

/** Megabytes, as a person reads them: whole numbers, never "0". */
export function megabytes(bytes: number): string {
  return `${Math.max(1, Math.round(bytes / 1e6))} MB`;
}

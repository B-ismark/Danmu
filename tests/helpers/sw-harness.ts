// A ServiceWorkerGlobalScope small enough to run public/sw.js in, so its caching
// strategy can be tested as behaviour instead of read and hoped about.
//
// Why the file is loaded as source rather than imported: a service worker is not a
// module and is never bundled — it is raw bytes served from public/ so it can claim
// a '/' scope. `new Function` with the worker's globals as parameters runs it in
// this realm, which keeps Node's real Request/Response usable (a `vm` context would
// give the script its own, and passing objects across realms breaks in ways that
// have nothing to do with what is under test).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const ORIGIN = 'https://danmu.test';

type Listener = (event: unknown) => void;

/**
 * What the worker actually reads off a request: `url`, `method`, `mode` and
 * `headers`. Navigations have to be modelled rather than constructed, because
 * Node's `Request` rejects `mode: 'navigate'` outright — the browser sets it, no
 * script may. Everything else uses a real Request.
 */
export type RequestLike = {
  url: string;
  method: string;
  mode: string;
  headers: Headers;
  cache?: string;
};

type AnyRequest = Request | RequestLike;

/**
 * The `Request` the worker sees. A service worker resolves a relative URL against
 * its own scope — `new Request('/')` is legal in one and throws in Node — so the
 * scope is supplied here rather than the worker being written around the gap.
 */
class ScopedRequest extends Request {
  constructor(input: RequestInfo | URL, init?: RequestInit) {
    super(typeof input === 'string' ? new URL(input, ORIGIN) : input, init);
  }
}

class FakeCache {
  readonly store = new Map<string, Response>();

  private key(req: AnyRequest | string): string {
    return typeof req === 'string' ? new URL(req, ORIGIN).href : req.url;
  }

  async put(req: AnyRequest | string, res: Response) {
    this.store.set(this.key(req), res);
  }

  async match(req: AnyRequest | string): Promise<Response | undefined> {
    return this.store.get(this.key(req));
  }

  /** Test-side view: which URLs ended up in here. */
  urls(): string[] {
    return [...this.store.keys()].sort();
  }
}

class FakeCacheStorage {
  readonly caches = new Map<string, FakeCache>();

  async open(name: string): Promise<FakeCache> {
    let c = this.caches.get(name);
    if (!c) {
      c = new FakeCache();
      this.caches.set(name, c);
    }
    return c;
  }

  async keys(): Promise<string[]> {
    return [...this.caches.keys()];
  }

  async delete(name: string): Promise<boolean> {
    return this.caches.delete(name);
  }
}

export type FetchCall = { url: string; cacheMode?: string };

export type Harness = {
  cacheStorage: FakeCacheStorage;
  /** Every request the worker actually put on the network. */
  calls: FetchCall[];
  /** Swap in the network's behaviour for the next calls. */
  setNetwork: (fn: (req: AnyRequest) => Promise<Response>) => void;
  /** Cut the network off entirely, the way an offline reload does. */
  goOffline: () => void;
  install: () => Promise<void>;
  activate: () => Promise<void>;
  /**
   * Drive one fetch. Resolves to the Response the worker chose to answer with, or
   * `null` when the worker declined to handle the request at all — which is a
   * meaningfully different outcome from answering, and the only way to assert that
   * cross-origin traffic is passed through untouched.
   */
  fetch: (req: AnyRequest) => Promise<Response | null>;
  claimed: () => boolean;
  /**
   * How many promises the worker handed to `event.waitUntil` during the last
   * fetch. A cache write that is not registered there does not survive the worker
   * being terminated, and nothing else can observe the difference.
   */
  extendedOnLastFetch: () => number;
};

export function loadServiceWorker(): Harness {
  const source = readFileSync(join(process.cwd(), 'public', 'sw.js'), 'utf8');

  const listeners = new Map<string, Listener[]>();
  const cacheStorage = new FakeCacheStorage();
  const calls: FetchCall[] = [];
  let claimed = false;
  let extendedOnLastFetch = 0;

  let network: (req: AnyRequest) => Promise<Response> = async () => new Response('ok', { status: 200 });

  const fakeFetch = async (input: AnyRequest | string): Promise<Response> => {
    const req = typeof input === 'string' ? new ScopedRequest(input) : input;
    calls.push({ url: req.url, cacheMode: (req as Request).cache });
    return network(req);
  };

  const self = {
    addEventListener(type: string, fn: Listener) {
      const list = listeners.get(type) ?? [];
      list.push(fn);
      listeners.set(type, list);
    },
    location: { origin: ORIGIN },
    clients: {
      async claim() {
        claimed = true;
      },
    },
  };

  // The worker's globals, supplied as parameters. `Request`/`Response`/`URL` are
  // Node's own — real enough that `clone()`, `ok` and `type` behave.
  const run = new Function('self', 'caches', 'fetch', 'Request', 'Response', 'URL', source);
  run(self, cacheStorage, fakeFetch, ScopedRequest, Response, URL);

  async function dispatchExtendable(type: 'install' | 'activate') {
    const waits: Promise<unknown>[] = [];
    const event = { waitUntil: (p: Promise<unknown>) => void waits.push(p) };
    for (const fn of listeners.get(type) ?? []) fn(event);
    await Promise.all(waits);
  }

  return {
    cacheStorage,
    calls,
    setNetwork: (fn) => {
      network = fn;
    },
    goOffline: () => {
      network = async () => {
        throw new TypeError('Failed to fetch');
      };
    },
    install: () => dispatchExtendable('install'),
    activate: () => dispatchExtendable('activate'),
    claimed: () => claimed,
    extendedOnLastFetch: () => extendedOnLastFetch,
    async fetch(req: AnyRequest) {
      let answered: Promise<Response> | null = null;
      // A real FetchEvent has waitUntil, and the worker uses it to keep cache
      // writes alive past the response. Awaiting them here is not politeness: it
      // is what makes "was it cached?" a deterministic question instead of a race
      // the assertion happens to win.
      const extended: Promise<unknown>[] = [];
      const event = {
        request: req,
        respondWith(p: Promise<Response>) {
          answered = p;
        },
        waitUntil(p: Promise<unknown>) {
          extended.push(p);
        },
      };
      for (const fn of listeners.get('fetch') ?? []) fn(event);
      // `null` means the worker never called respondWith — the browser would go to
      // the network itself, and the worker is not in the path.
      if (answered === null) return null;
      const res = await answered;
      extendedOnLastFetch = extended.length;
      await Promise.all(extended);
      return res;
    },
  };
}

/**
 * A request the browser would label a navigation — a reload, or following a link.
 * Modelled rather than constructed; see RequestLike above.
 */
export function navigation(path: string): RequestLike {
  return { url: new URL(path, ORIGIN).href, method: 'GET', mode: 'navigate', headers: new Headers() };
}

/** A subresource: a chunk, a font, the manifest. A real Request. */
export function asset(path: string): Request {
  return new ScopedRequest(path);
}

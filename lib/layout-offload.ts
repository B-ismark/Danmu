// The page's side of the arranging worker: send a solve, get a promise back.
//
// Three rules, each of which is a way this could have been wrong quietly.
//
// · **The answer is the same one the main thread would give.** The worker runs
//   the same pure functions on a structured clone of the same arguments, and the
//   solver is deterministic per seed, so moving it changes when the answer
//   arrives and nothing about what it is. `tests/layout-offload.test.ts` holds the
//   fallback path to the direct call.
// · **No worker is a slower path, never a broken one.** The node test
//   environment, SSR and any browser without module workers fall back to running
//   the call inline. A worker that fails to load or crashes is retired and the
//   request that hit it is re-run inline, so a bad chunk costs one frozen press,
//   not a Fix button that never answers.
// · **One worker, reused.** Preparing the engine is the expensive half of a first
//   press; a worker per press would pay it every time. Requests are tagged, so a
//   late reply can never be read as the answer to a different question.

import { solveLayout, type SolveResult } from './layout-solve';
import { shuffleRoom, type ShuffleOutcome } from './layout-shuffle';
import type { LayoutRequest, LayoutResponse, ShuffleArgs, SolveArgs } from './layout-worker-protocol';

type Pending = { resolve: (value: never) => void; reject: (err: Error) => void; fallback: () => unknown };

let worker: Worker | null = null;
/** Set once a worker has failed. After that every request runs inline: a worker
 *  that could not load once will not load on the next press either. */
let retired = false;
let nextId = 1;
const pending = new Map<number, Pending>();

function retire(reason: unknown): void {
  retired = true;
  worker?.terminate();
  worker = null;
  if (typeof console !== 'undefined') console.warn('Arranging worker unavailable; running inline.', reason);
  // Whatever was in flight never gets an answer from that worker, so each one is
  // answered inline instead — the promise its button is waiting on still settles.
  for (const [id, p] of pending) {
    pending.delete(id);
    try {
      p.resolve(p.fallback() as never);
    } catch (err) {
      p.reject(err instanceof Error ? err : new Error(String(err)));
    }
  }
}

function getWorker(): Worker | null {
  if (retired || typeof Worker === 'undefined') return null;
  if (worker) return worker;
  try {
    // The `new URL(…, import.meta.url)` form is what the bundler recognises as a
    // worker entry and emits as its own same-origin chunk — `worker-src 'self'`
    // in `next.config.mjs` already allows it.
    worker = new Worker(new URL('./layout.worker.ts', import.meta.url), { type: 'module' });
  } catch (err) {
    retire(err);
    return null;
  }
  worker.onmessage = (e: MessageEvent<LayoutResponse>) => {
    const msg = e.data;
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    if (msg.ok) p.resolve(msg.value as never);
    else p.reject(new Error(msg.error));
  };
  // A load failure or an uncaught error inside the worker. `messageerror` is a
  // reply that could not be deserialised. Either way this worker is done.
  worker.onerror = (e) => retire(e.message || e);
  worker.onmessageerror = (e) => retire(e);
  return worker;
}

function send<T>(req: LayoutRequest, fallback: () => T): Promise<T> {
  const w = getWorker();
  if (!w) {
    try {
      return Promise.resolve(fallback());
    } catch (err) {
      return Promise.reject(err);
    }
  }
  return new Promise<T>((resolve, reject) => {
    pending.set(req.id, { resolve: resolve as (v: never) => void, reject, fallback });
    try {
      w.postMessage(req);
    } catch {
      // A `DataCloneError`: the request itself cannot cross. The protocol types
      // exist to make this unreachable, and inline is still the right answer.
      pending.delete(req.id);
      try {
        resolve(fallback());
      } catch (inner) {
        reject(inner instanceof Error ? inner : new Error(String(inner)));
      }
    }
  });
}

/** `solveLayout`, off the main thread where there is one to leave. */
export function solveOffThread(args: SolveArgs): Promise<SolveResult> {
  return send({ id: nextId++, kind: 'solve', args }, () =>
    solveLayout(args.parts, args.footprint, args.locked, args.opts),
  );
}

/** `shuffleRoom`, off the main thread where there is one to leave. */
export function shuffleOffThread(args: ShuffleArgs): Promise<ShuffleOutcome | null> {
  return send({ id: nextId++, kind: 'shuffle', args }, () =>
    shuffleRoom(args.parts, args.room, args.locked, args.opts),
  );
}

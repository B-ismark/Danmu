// The arranging engine, off the main thread.
//
// `solveLayout` and `shuffleRoom` are pure and synchronous, and a furnished room
// costs them seconds — twelve independent solves for one Shuffle press. On the
// main thread that was seconds of a frozen window: no orbit, no hover, a spinner
// that could only be seen because `useBusyAction` yields one paint before the
// freeze. Here the page keeps drawing while the search runs.
//
// This file does nothing but dispatch. Every decision stays in `lib/layout-*.ts`,
// where the tests reach it; `layout-offload.ts` owns the page's side, including
// the synchronous fallback that the node test environment and any browser
// without module workers take.

import { solveLayout } from './layout-solve';
import { shuffleRoom } from './layout-shuffle';
import type { LayoutRequest, LayoutResponse } from './layout-worker-protocol';

// `self` is typed as a Window under the DOM lib this project compiles with, so it
// is narrowed to the two members a dedicated worker actually uses.
const scope = self as unknown as {
  onmessage: ((e: MessageEvent<LayoutRequest>) => void) | null;
  postMessage(message: LayoutResponse): void;
};

scope.onmessage = (e) => {
  const req = e.data;
  try {
    if (req.kind === 'solve') {
      const { parts, footprint, locked, opts } = req.args;
      scope.postMessage({ id: req.id, kind: 'solve', ok: true, value: solveLayout(parts, footprint, locked, opts) });
    } else {
      const { parts, room, locked, opts } = req.args;
      scope.postMessage({ id: req.id, kind: 'shuffle', ok: true, value: shuffleRoom(parts, room, locked, opts) });
    }
  } catch (err) {
    // Reported, not swallowed: the page re-raises it, so a solver crash still
    // reaches the console and `window.onerror` the way it did on the main thread.
    scope.postMessage({ id: req.id, ok: false, error: err instanceof Error ? (err.stack ?? err.message) : String(err) });
  }
};

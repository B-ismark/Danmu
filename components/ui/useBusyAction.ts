'use client';

// One owner for "this button is working". Holds the flag, yields so the flag can
// be SEEN (see `lib/after-paint.ts` — the yield is the whole point and it was
// missing at two of the three call sites), refuses a second press while the first
// is still running, and clears the flag even when the work throws.
//
// Re-entry is refused HERE rather than by `disabled` alone, because `disabled` is
// exactly the thing that cannot be trusted during the gap: between the press and
// the paint the button is still live, and a double-click on a three-second solve
// used to queue two of them.
//
// The work may be synchronous or async. Both go through the same yield, so a
// caller never has to know which kind it has — and a synchronous solve, which is
// the case that actually freezes the window, is the one that needs it most.

import { useCallback, useRef, useState } from 'react';
import { afterPaint } from '@/lib/after-paint';

/** Re-raise on a fresh task rather than out of the frame callback.
 *
 *  The flag has to clear before the error escapes, or a solver that throws leaves
 *  a permanently disabled button with no way back short of a reload — which is a
 *  worse failure than the crash itself, and a silent one. Throwing from inside
 *  the callback abandons the state update that clears it. Swallowing is not the
 *  alternative: a real crash in the solver must still reach `window.onerror` and
 *  the console, so it is deferred, not discarded. */
function rethrow(err: unknown): void {
  setTimeout(() => {
    throw err;
  }, 0);
}

export function useBusyAction(): [boolean, (work: () => void | Promise<void>) => void] {
  const [busy, setBusy] = useState(false);
  // Not derived from `busy`: the state has not re-rendered yet at the moment the
  // second press arrives, so reading the flag would let it through.
  const running = useRef(false);

  const run = useCallback((work: () => void | Promise<void>) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    afterPaint(() => {
      const done = () => {
        running.current = false;
        setBusy(false);
      };
      let result: void | Promise<void>;
      try {
        result = work();
      } catch (err) {
        done();
        rethrow(err);
        return;
      }
      if (result && typeof (result as Promise<void>).then === 'function') {
        (result as Promise<void>).then(done, (err) => {
          done();
          rethrow(err);
        });
        return;
      }
      done();
    });
  }, []);

  return [busy, run];
}

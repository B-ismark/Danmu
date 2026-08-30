// Let a busy state reach the screen before blocking the thread on it.
//
// The defect this exists to stop is invisible and this codebase shipped it three
// times. `setBusy(true)` followed by seconds of synchronous work in the SAME tick
// renders nothing: React flushes the state change, but the browser never gets a
// frame to paint it in, and `setBusy(false)` has already run by the time it does.
// So the button never disables, the "Trying…" label never appears, and the whole
// window locks up with no tell at all — which reads as a crash, not as work.
//
// `SuggestButton` and `TryFixButton` both had the flag and neither had the yield;
// `FitCheck` had the yield written out inline. That is the same rule as
// `drag-resolve.ts`: the step that makes the pipeline correct must live IN the
// pipeline, or the next call site will be written without it. There is one owner
// now and the components hold no scheduling of their own.
//
// TWO frames, not one. A `requestAnimationFrame` callback runs BEFORE the paint of
// the frame it is registered for, so work scheduled in the first frame still
// blocks the very paint it is waiting for — the yield would be decoration, in
// exactly the way the flag it protects already was. The second callback runs at
// the start of the next frame, which is after the first frame has been presented.
//
// `setTimeout(…, 0)` is the fallback and NOT the primary. A macrotask is only
// guaranteed to run after the current task, not after a paint, so it is a
// coincidence that happens to work rather than an ordering the platform promises.
// It is here for the environments with no rAF at all — SSR, the node test
// environment, a jsdom without `pretendToBeVisual` — where there is no paint to
// wait for and the only thing that matters is not running synchronously.

/** Run `fn` once, after the browser has had a chance to paint what is already
 *  queued. Never runs synchronously. */
export function afterPaint(fn: () => void): void {
  const raf = typeof globalThis.requestAnimationFrame === 'function' ? globalThis.requestAnimationFrame : null;
  if (!raf) {
    setTimeout(fn, 0);
    return;
  }
  raf(() => raf(fn));
}

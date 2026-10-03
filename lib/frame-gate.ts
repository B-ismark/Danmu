// At most once a frame, and at once when it has not run this frame.
//
// The usual throttle for an event that fires faster than the screen — cancel the last
// `requestAnimationFrame`, schedule a new one, do the work there — is a TRAILING one:
// every event's work waits for the next frame, and what that work changes waits for
// the frame after that to be drawn. The Library drag's ghost was built that way, and a
// ghost that is always a frame behind the pointer is what "laggy and out of sync" was
// describing. This one is leading: the first event of a frame runs now, so its result
// is drawn in the very next frame; any more in the same frame collapse into one run,
// with the LATEST arguments, on the next frame — so the last position is never lost
// and the work is still bounded to once a frame however fast the events come.

export type FrameGate<A extends unknown[]> = {
  /** Run now if nothing has run this frame, otherwise once on the next frame with the
   *  newest arguments. */
  call: (...args: A) => void;
  /** Forget a pending run — the drag left, or dropped. */
  cancel: () => void;
};

export function frameGate<A extends unknown[]>(
  run: (...args: A) => void,
  raf: (cb: () => void) => number = (cb) => requestAnimationFrame(cb),
  caf: (id: number) => void = (id) => cancelAnimationFrame(id),
): FrameGate<A> {
  let frame: number | null = null;
  let pending: A | null = null;
  function tick() {
    frame = null;
    if (!pending) return;
    const args = pending;
    pending = null;
    run(...args);
    // That run was this frame's; one more event before the next frame waits for it.
    frame = raf(tick);
  }
  return {
    call(...args) {
      if (frame !== null) {
        pending = args;
        return;
      }
      run(...args);
      frame = raf(tick);
    },
    cancel() {
      if (frame !== null) caf(frame);
      frame = null;
      pending = null;
    },
  };
}

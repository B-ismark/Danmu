// When the 3D view may be uncovered: after a frame has actually been DRAWN, not
// merely begun.
//
// The canvas veil used to lift on the first `useFrame` call, which runs BEFORE that
// frame renders. So when the render itself threw — the n8ao 2.0.1 crash did, on every
// frame at 'high' — the veil had already gone and the user was left on a dark, empty
// canvas, while hover still found the pieces (raycasting needs no render). And R3F's
// loop does not catch: a frame that throws never schedules the next one, so nothing
// short of a remount ever paints again. A blank canvas with no words is the one thing
// the veil exists to prevent.
//
// So a frame counts once the browser has moved on past it without an uncaught error.
// If one did fall in it, the loop is nudged; a loop that is alive draws again and is
// re-checked, and one that is dead stays silent for `GRACE_MS` and is reported, so the
// veil can say the room could not be drawn and offer a way forward. Pure, with the
// browser handed in, so the rule is testable without WebGL.
//
// The loop can fail the other way too, and that is the one actually seen: n8ao 2.0.1
// threw from INSIDE a frame callback that R3F kept calling, ~60 times a second, so the
// loop was alive and every frame of it broken. So `STRIKES` frames in a row that each
// ended in an error are a failure as well — one stray error from elsewhere on the page
// is not, because the next clean frame lifts the veil.

/** How long a nudged loop has to produce another frame before it is called dead. */
export const GRACE_MS = 1200;
/** Broken frames in a row that make a failure of a loop that keeps running. */
export const STRIKES = 3;

export type FrameWatchHost = {
  drawn(): void;
  failed(): void;
  /** Ask the render loop for another frame (`invalidate`). */
  nudge(): void;
  /** Run after the current frame (`requestAnimationFrame`). */
  next(f: () => void): void;
  later(f: () => void, ms: number): void;
};

export function firstFrameWatch(h: FrameWatchHost) {
  let errors = 0;
  let frames = 0;
  let done = false;
  let strikes = 0;
  return {
    /** An uncaught error reached the window. */
    error() {
      errors++;
    },
    /** A frame is starting (`useFrame`). */
    frame() {
      if (done) return;
      frames++;
      const e0 = errors;
      const f0 = frames;
      h.next(() => {
        if (done) return;
        if (errors === e0) {
          done = true;
          h.drawn();
          return;
        }
        if (++strikes >= STRIKES) {
          done = true;
          h.failed();
          return;
        }
        h.nudge();
        h.later(() => {
          if (done || frames !== f0) return;
          done = true;
          h.failed();
        }, GRACE_MS);
      });
    },
  };
}

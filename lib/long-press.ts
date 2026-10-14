// Press-and-hold, as a decision rather than a handler.
//
// The Library marks a run of rows with Shift-click, and a touch screen has no Shift,
// so a finger held on a row marks it instead. Which presses ARM the timer, when it
// fires, what cancels it, and — the part a handler gets wrong — whether the click
// that ends the gesture may also add the piece, are all answered here so a test can
// reach them without a browser. Same reason `lib/drag-click.ts` and
// `lib/photo-drop.ts` sit outside their components.
//
// Touch only. A mouse already has Shift-click, and arming on a mouse would make a
// slow click on a DRAGGABLE row (a drag starts from a held press) mark it as well.

export const LONG_PRESS_MS = 450;
/** Movement that turns a hold into a scroll or a drag, in client pixels. */
export const LONG_PRESS_SLOP_PX = 8;

/** Whether a press may arm at all. */
export function armsLongPress(pointerType: string, enabled: boolean): boolean {
  return enabled && pointerType === 'touch';
}

/** Whether a finger has travelled far enough that this is no longer a hold. */
export function movedPastSlop(dx: number, dy: number, slop = LONG_PRESS_SLOP_PX): boolean {
  return Math.hypot(dx, dy) > slop;
}

export type LongPress = {
  /** A pointer went down. Re-arms (and forgets any earlier fired hold). */
  down(x: number, y: number, pointerType: string): void;
  /** The pointer moved; cancels the hold past the slop. */
  move(x: number, y: number): void;
  /** Pointer up, cancel or leave before the timer: not a hold. */
  cancel(): void;
  /** True ONCE for the click that follows a hold that fired — that click must not
   *  also add the piece. Cleared by the next `down`, so a hold whose click never
   *  arrives cannot eat a later, unrelated tap. */
  consumeClick(): boolean;
};

export function createLongPress(
  onFire: () => void,
  opts: {
    enabled: () => boolean;
    ms?: number;
    slop?: number;
    setTimer?: (fn: () => void, ms: number) => unknown;
    clearTimer?: (t: unknown) => void;
  },
): LongPress {
  const ms = opts.ms ?? LONG_PRESS_MS;
  const slop = opts.slop ?? LONG_PRESS_SLOP_PX;
  const setTimer = opts.setTimer ?? ((fn, t) => setTimeout(fn, t));
  const clearTimer = opts.clearTimer ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>));
  let timer: unknown = null;
  let fired = false;
  let sx = 0;
  let sy = 0;

  const stop = () => {
    if (timer !== null) clearTimer(timer);
    timer = null;
  };

  return {
    down(x, y, pointerType) {
      stop();
      fired = false;
      if (!armsLongPress(pointerType, opts.enabled())) return;
      sx = x;
      sy = y;
      timer = setTimer(() => {
        timer = null;
        fired = true;
        onFire();
      }, ms);
    },
    move(x, y) {
      if (timer !== null && movedPastSlop(x - sx, y - sy, slop)) stop();
    },
    cancel: stop,
    consumeClick() {
      const was = fired;
      fired = false;
      return was;
    },
  };
}

// Client pixels → the plan's viewBox coordinates.
//
// `PlanView`'s <svg> is `preserveAspectRatio="xMidYMid meet"`, which is SVG's
// default and the only one that keeps a metre square square. Under `meet` the
// drawing is scaled UNIFORMLY by whichever axis runs out first and then CENTRED
// in whatever is left over, so a client point maps back through one scale and two
// offsets.
//
// The version this replaces mapped each axis by its own ratio and no offset:
//
//     x = (clientX - rect.left) * (baseW / rect.width)
//
// which is the mapping for `preserveAspectRatio="none"` — a stretched drawing we
// deliberately do not draw. It is right only when the element's aspect happens to
// equal the room's, and wrong by both a scale factor and a letterbox offset the
// rest of the time: a 4 × 3 m room (a 440 × 340 viewBox) inside a 900 × 600 canvas
// came out 14% off with the pointer 62 px adrift. That is a *responsiveness* bug
// rather than a plan bug, because the canvas's aspect is exactly what changes when
// a rail is resized or collapsed — so the error moved as the panels moved.
//
// Pure, and here rather than in the component, so the three aspects that matter
// can be asserted in the node test environment. jsdom implements neither
// `getScreenCTM` (the browser's own answer to this) nor SVG layout, so the
// component cannot be the place this is verified.

/** The part of a DOMRect this needs. Accepting the four fields rather than a
 *  DOMRect keeps it constructible in a test. */
export type ViewRect = { left: number; top: number; width: number; height: number };

export type Letterbox = {
  /** viewBox units → client px. Zero for a degenerate element. */
  scale: number;
  /** Blank client px to the left of the drawing, from `xMid`. */
  offsetX: number;
  /** Blank client px above the drawing, from `yMid`. */
  offsetY: number;
};

/** How a `viewBox` of `baseW × baseH` lands inside `rect` under `xMidYMid meet`. */
export function letterbox(rect: { width: number; height: number }, baseW: number, baseH: number): Letterbox {
  // A zero-area element (first paint, a collapsed rail, a hidden tab) would give
  // scale 0 or NaN, and every caller multiplies a position by it — so the guard
  // belongs here, once, rather than at each call site. A NaN reaching `setPosition`
  // is a part with no coordinates in a saved room.
  if (!(rect.width > 0) || !(rect.height > 0) || !(baseW > 0) || !(baseH > 0)) {
    return { scale: 0, offsetX: 0, offsetY: 0 };
  }
  const scale = Math.min(rect.width / baseW, rect.height / baseH);
  return {
    scale,
    offsetX: (rect.width - baseW * scale) / 2,
    offsetY: (rect.height - baseH * scale) / 2,
  };
}

/** A client point in the plan's viewBox coordinates. */
export function clientToViewBox(
  rect: ViewRect,
  baseW: number,
  baseH: number,
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  const { scale, offsetX, offsetY } = letterbox(rect, baseW, baseH);
  if (scale === 0) return { x: 0, y: 0 };
  return {
    x: (clientX - rect.left - offsetX) / scale,
    y: (clientY - rect.top - offsetY) / scale,
  };
}

/** A client *movement* in viewBox units. Both axes divide by the same scale —
 *  which is the whole point: the old per-axis version turned a 45° drag into some
 *  other angle, so a pan tracked the pointer at the wrong rate in one axis. */
export function clientDeltaToViewBox(
  rect: { width: number; height: number },
  baseW: number,
  baseH: number,
  dx: number,
  dy: number,
): { x: number; y: number } {
  const { scale } = letterbox(rect, baseW, baseH);
  if (scale === 0) return { x: 0, y: 0 };
  return { x: dx / scale, y: dy / scale };
}

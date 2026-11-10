// Where the toast host stands when a floating card owns the top-right of the canvas.
//
// The toast host is fixed top-right, and the Library card is docked top-right of the
// canvas, so on a ~1280px window the two share the same corner and the answer to
// "did that fit?" printed on top of the very list the press came from. The card
// publishes its own left edge as `--toast-inset-right` on the root and the host reads
// it; no panel state is copied into the toast module. Measured rather than assumed,
// because the rails are draggable and the card's width is capped against the canvas.

export const TOAST_INSET_VAR = '--toast-inset-right';
/** The host's own resting right margin, and the gap kept between host and card. */
export const TOAST_EDGE_PX = 16;
/** Least width the host may be squeezed to; past that it stays over the card (it is
 *  above it in z) rather than collapsing to a sliver. */
export const TOAST_MIN_PX = 200;

/** Right offset for a toast host that must clear a card whose left edge is `cardLeft`. */
export function toastInsetFor(cardLeft: number, viewportW: number): number {
  const wanted = viewportW - cardLeft + TOAST_EDGE_PX;
  const cap = viewportW - TOAST_MIN_PX - TOAST_EDGE_PX;
  return Math.max(TOAST_EDGE_PX, Math.min(wanted, cap));
}

/** Publish the inset for `el`, keep it fresh, and return the cleanup. */
export function publishToastInset(el: HTMLElement): () => void {
  const root = document.documentElement;
  const update = () => {
    const r = el.getBoundingClientRect();
    root.style.setProperty(TOAST_INSET_VAR, `${toastInsetFor(r.left, window.innerWidth)}px`);
  };
  update();
  window.addEventListener('resize', update);
  const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
  ro?.observe(el);
  if (el.parentElement) ro?.observe(el.parentElement);
  return () => {
    window.removeEventListener('resize', update);
    ro?.disconnect();
    root.style.removeProperty(TOAST_INSET_VAR);
  };
}

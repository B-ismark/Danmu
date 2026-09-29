'use client';

// How every top-bar popover lets go: a press outside it, or Esc.
//
// Three menus carried this word for word (Export, the phone's More, and View),
// which is three places for the one subtle line to drift — the
// `stopImmediatePropagation`. Capture listeners on the SAME node (window) still
// run after a plain `stopPropagation`, so without it one Esc closed this menu and
// the help card together, and then reached the studio's "deselect" binding too.

import { useEffect, useRef, type RefObject } from 'react';

export function usePopoverDismiss(
  open: boolean,
  close: () => void,
  wrapRef: RefObject<HTMLElement | null>,
  triggerRef: RefObject<HTMLElement | null>,
) {
  // Read through a ref: every caller hands a fresh `() => setOpen(false)` each
  // render, and depending on it would re-add two window listeners per render.
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!open) return;
    const close = () => closeRef.current();
    function onDown(e: PointerEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) close();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      e.stopPropagation();
      close();
      triggerRef.current?.focus();
    }
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open, wrapRef, triggerRef]);
}

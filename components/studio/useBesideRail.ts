'use client';

import { useEffect, useState, type RefObject } from 'react';

/** Where a floating card beside the left rail goes, measured and kept true through
 *  resize and scroll.
 *
 *  Two cards open from the rail's room tools — the room panel and the ideas gallery —
 *  and they take turns in the same spot, so they share the arithmetic rather than
 *  each keeping a copy. Placed to the RIGHT of the anchor rather than over it, so the
 *  room the card is about stays visible.
 *
 *  The width is measured, not declared, because `left` is computed from it: a CSS
 *  `min()` in the style and a constant here would be two answers to one question,
 *  and the constant is the one that would be wrong. Clamped at both edges — at the
 *  narrowest windows a card that is only right-clamped hangs off the left.
 *
 *  `fullWidth` is the phone: there is no room beside a sheet, so the card spans the
 *  screen inside the page gutters. `tall` is how much height the card wants kept on
 *  screen below its top, so a tall card rises rather than running off the bottom. */
export function useBesideRail(
  anchorRef: RefObject<HTMLElement | null>,
  open: boolean,
  { width: wanted, tall = 200, fullWidth = false }: { width: number; tall?: number; fullWidth?: boolean },
): { left: number; top: number; width: number } {
  const [pos, setPos] = useState({ left: 0, top: 0, width: wanted });
  useEffect(() => {
    if (!open) return;
    function place() {
      const r = anchorRef.current?.getBoundingClientRect();
      if (!r) return;
      const room = window.innerWidth - 24;
      const width = fullWidth ? room : Math.min(wanted, room);
      const left = fullWidth ? 12 : Math.max(12, Math.min(r.right + 10, window.innerWidth - width - 12));
      const top = Math.max(12, Math.min(r.top, window.innerHeight - tall));
      setPos({ left, top, width });
    }
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, anchorRef, wanted, tall, fullWidth]);
  return pos;
}

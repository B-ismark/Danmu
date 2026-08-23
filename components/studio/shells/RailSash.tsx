'use client';

// The divider between a rail and the room — a real widget, not a CSS cursor.
//
// APG's Window Splitter pattern, because that is what this is: `role="separator"`
// with a value, focusable, arrows nudge it, Home/End take it to either extreme,
// and **Enter collapses the pane and restores it** — the same action the rail's
// own chevron performs, so the two cannot disagree about what "closed" means.
// VS Code's sash is 4px and its issue tracker carries a standing complaint that
// this is too small to grab, so the hit area here is 10px and only the middle 1px
// is ever painted.
//
// Three things are deliberate:
//
// · The drag writes a CSS custom property on the shell element inside a rAF and
//   sets NO React state. A `setState` per pointermove re-renders the piece tree,
//   the inspector and the R3F tree ~60×/second while the user is trying to judge
//   a panel width. The store is written once, on release.
// · The floor and ceiling come from tokens (`--rail-*-min`, `--rail-max-share`),
//   never from literals here. A number copied into a pointer handler is a floor
//   that stops moving when the stylesheet's does.
// · Everything visual lives in `.rail-sash` in globals.css. Hover and
//   focus-visible are the states that matter for something you have to find with
//   a pointer, and an inline style object cannot express either.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';
import { useStudio } from '@/lib/store';
import type { RailSide } from './shell-parts';

/** How far past the floor a drag has to go before it means "close this". */
const SNAP_PAST_FLOOR = 24;
/** One arrow press. Shift makes it 1px, for the last bit of a fussy adjustment. */
const STEP = 16;

const WIDTH_PROP: Record<RailSide, string> = { left: '--sash-left', right: '--sash-right' };
const FLOOR_TOKEN: Record<RailSide, string> = { left: '--rail-left-min', right: '--rail-right-min' };

type Metrics = { width: number; floor: number; ceiling: number };

function tokenPx(el: Element, name: string): number {
  const n = Number.parseFloat(getComputedStyle(el).getPropertyValue(name));
  return Number.isFinite(n) ? n : 0;
}

export function RailSash({
  side,
  shellRef,
  railRef,
  railId,
  open,
  onToggle,
}: {
  side: RailSide;
  /** Carries `--sash-left` / `--sash-right`; the grid reads them as its columns. */
  shellRef: RefObject<HTMLDivElement | null>;
  /** The rail being sized. Measured rather than tracked: its real width is the
   *  one the user sees, clamp and all. */
  railRef: RefObject<HTMLElement | null>;
  railId: string;
  open: boolean;
  onToggle: () => void;
}) {
  const setRailWidth = useStudio((s) => s.setRailWidth);
  const [dragging, setDragging] = useState(false);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  // Floor and ceiling are captured at pointer-down, not read per move: reading
  // them live would force a layout on every pointermove, and reading them from
  // `metrics` would trust a value the ResizeObserver is deliberately not updating
  // mid-drag. Neither can change during a drag anyway — the ceiling is a share of
  // a window nobody is resizing while dragging a divider inside it.
  const drag = useRef<{
    startX: number;
    startW: number;
    floor: number;
    ceiling: number;
    pending: number;
    collapse: boolean;
    raf: number;
  } | null>(null);

  /** Measured, not remembered — and read outside render, because these are all
   *  layout questions. The ceiling is derived from the same share the stylesheet
   *  clamps with, so `aria-valuemax` and the CSS cannot disagree; Infinity when
   *  the token is missing, since an invented bound is worse than none. */
  const measure = useCallback((): Metrics | null => {
    const shell = shellRef.current;
    const rail = railRef.current;
    if (!shell || !rail) return null;
    const share = Number.parseFloat(getComputedStyle(shell).getPropertyValue('--rail-max-share'));
    return {
      width: rail.getBoundingClientRect().width,
      floor: tokenPx(shell, FLOOR_TOKEN[side]),
      ceiling: Number.isFinite(share) && share > 0 ? share * window.innerWidth : Number.POSITIVE_INFINITY,
    };
  }, [railRef, shellRef, side]);

  const sync = useCallback(() => setMetrics(measure()), [measure]);

  // The rail's width answers to the window (the token carries a `vw` term), to
  // the collapse toggle and to this drag, so observing the element is the only
  // way to keep `aria-valuenow` honest. Callbacks are ignored mid-drag: they fire
  // every frame, and re-rendering per frame is precisely what the rAF write
  // exists to avoid.
  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    sync();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      if (drag.current) return;
      sync();
    });
    ro.observe(rail);
    // The ceiling is a share of the window, which no element resize reports.
    window.addEventListener('resize', sync);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', sync);
    };
  }, [railRef, sync]);

  useEffect(
    () => () => {
      if (drag.current?.raf) cancelAnimationFrame(drag.current.raf);
    },
    [],
  );

  function paint() {
    const d = drag.current;
    if (!d) return;
    d.raf = 0;
    // A pending collapse previews itself at the closed width, so releasing is not
    // a surprise.
    shellRef.current?.style.setProperty(WIDTH_PROP[side], d.collapse ? 'var(--rail-closed)' : `${d.pending}px`);
  }

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (!open || e.button !== 0) return;
    const m = measure();
    if (!m) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = {
      startX: e.clientX,
      startW: m.width,
      floor: m.floor,
      ceiling: m.ceiling,
      pending: m.width,
      collapse: false,
      raf: 0,
    };
    setDragging(true);
  }

  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d) return;
    // The left rail grows as the pointer moves right; the right rail is mirrored.
    const delta = side === 'left' ? e.clientX - d.startX : d.startX - e.clientX;
    const raw = d.startW + delta;
    d.collapse = raw < d.floor - SNAP_PAST_FLOOR;
    d.pending = Math.max(d.floor, Math.min(d.ceiling, raw));
    if (!d.raf) d.raf = requestAnimationFrame(paint);
  }

  function onPointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d) return;
    if (d.raf) cancelAnimationFrame(d.raf);
    drag.current = null;
    setDragging(false);
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    if (d.collapse) {
      // Hand the width back to the token, so reopening starts from the design's
      // number rather than the sliver the drag ended on. Then close.
      shellRef.current?.style.removeProperty(WIDTH_PROP[side]);
      setRailWidth(side, null);
      onToggle();
      return;
    }
    setRailWidth(side, d.pending);
    sync();
  }

  function onKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    // Enter is the pattern's collapse/restore, and the one key that still means
    // something on a rail that is already closed.
    if (e.key === 'Enter') {
      e.preventDefault();
      onToggle();
      return;
    }
    if (!open) return;
    const m = measure();
    if (!m) return;
    const step = e.shiftKey ? 1 : STEP;
    const grow = side === 'left' ? 'ArrowRight' : 'ArrowLeft';
    const shrink = side === 'left' ? 'ArrowLeft' : 'ArrowRight';
    let next: number;
    if (e.key === grow) next = m.width + step;
    else if (e.key === shrink) next = m.width - step;
    else if (e.key === 'Home') next = m.floor;
    else if (e.key === 'End') next = Number.isFinite(m.ceiling) ? m.ceiling : m.width;
    else return;
    e.preventDefault();
    setRailWidth(side, Math.max(m.floor, Math.min(m.ceiling, next)));
  }

  function reset() {
    shellRef.current?.style.removeProperty(WIDTH_PROP[side]);
    setRailWidth(side, null);
  }

  const now = metrics ? Math.round(metrics.width) : null;
  const max = metrics && Number.isFinite(metrics.ceiling) ? Math.round(metrics.ceiling) : null;

  return (
    <div
      role="separator"
      tabIndex={0}
      aria-orientation="vertical"
      aria-label={`Resize the ${side} panel`}
      aria-controls={railId}
      // Only claimed once measured. A separator advertising a range it has not
      // read yet is worse than one that has no value on it for a frame.
      aria-valuenow={now ?? undefined}
      aria-valuemin={metrics ? Math.round(metrics.floor) : undefined}
      aria-valuemax={max ?? undefined}
      aria-valuetext={now != null ? `${now} pixels` : undefined}
      title="Drag to resize · double-click to reset · Enter to collapse"
      className={`rail-sash rail-sash--${side}${dragging ? ' is-dragging' : ''}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
      onDoubleClick={reset}
    >
      {/* The only painted pixel. A span rather than a border so hover, focus and
          drag can each colour it without moving anything. */}
      <span aria-hidden="true" />
    </div>
  );
}

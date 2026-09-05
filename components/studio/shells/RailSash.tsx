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
  //
  // Two SHAPES rather than one shape with a flag, and that is not tidiness: the
  // gesture that opens a closed rail has no width, no floor and no ceiling to seed
  // from, because the open width cannot be read until React has re-rendered. The
  // first version carried the flag and seeded `startW: 0, floor: 0, ceiling: 0`,
  // which are four numbers nothing may read — and `ceiling: 0` in particular would
  // clamp a committed width to 0px, below the rail's own token floor, if anything
  // ever did. `tests/reflow.test.ts`'s `not.toMatch(/floor = \d/)` guard exists to
  // catch exactly that and could not see them, because it matches assignment syntax
  // and those were object properties. A union makes them unwritable instead.
  const drag = useRef<
    | { kind: 'opening'; startX: number; raf: number }
    | {
        kind: 'sizing';
        startX: number;
        startW: number;
        floor: number;
        ceiling: number;
        pending: number;
        collapse: boolean;
        raf: number;
      }
    | null
  >(null);

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

  /** Tells `DockedShell` to leave `--sash-*` alone while this gesture paints it.
   *  A dataset flag rather than React state on purpose: it has to be readable from
   *  inside a layout effect on the parent, and it must not cause a render — a render
   *  per pointermove is exactly what the rAF write exists to avoid. */
  const markDragging = useCallback(
    (on: boolean) => {
      const el = shellRef.current;
      if (!el) return;
      if (on) el.dataset.sashDragging = '1';
      else delete el.dataset.sashDragging;
    },
    [shellRef],
  );

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
      // Unmounting mid-drag would otherwise leave the shell marked and `DockedShell`
      // would stop restoring `--sash-*` for the rest of the session.
      markDragging(false);
    },
    [markDragging],
  );

  function paint() {
    const d = drag.current;
    if (!d || d.kind !== 'sizing') return;
    d.raf = 0;
    // A pending collapse previews itself at the closed width, so releasing is not
    // a surprise.
    shellRef.current?.style.setProperty(WIDTH_PROP[side], d.collapse ? 'var(--rail-closed)' : `${d.pending}px`);
  }

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    if (!open) {
      // A closed rail normally ignores pointer drags (the early-return below). Letting
      // the user pull a collapsed sash open is the requested behaviour: open it to the
      // token default — `toggleRail` clears any stored width on open — and turn this
      // gesture into a drag. Once open, the grid column tracks --sash-left and paint()
      // can drive it, so the rest of this handler's logic applies. The open width
      // cannot be read synchronously (React re-renders next), so this gesture carries
      // no width at all until the first move measures one.
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      markDragging(true);
      onToggle();
      drag.current = { kind: 'opening', startX: e.clientX, raf: 0 };
      setDragging(true);
      return;
    }
    const m = measure();
    if (!m) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    markDragging(true);
    drag.current = {
      kind: 'sizing',
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
    if (d.kind === 'opening') {
      // First move after opening a closed rail: the DOM now reflects the open width,
      // so measure it and promote the gesture to a sizing one, seeded from the current
      // pointer. Resetting startX means the rail holds its freshly opened width until
      // the user actually moves, rather than leaping by the travel during the open.
      //
      // **`if (m)` is not the guard this needs, and that was the defect.** A move
      // dispatched before the open has laid out measures the CLOSED rail — 37px, a
      // number, so `if (m)` passes — and seeds `startW` at 37 against a floor of 228.
      // Every later move then computes `collapse = 37 + delta < floor - SNAP_PAST_FLOOR`,
      // which is true unless the user has already dragged the width of the rail
      // rightward, so the release closes the rail the press just opened. A width below
      // the floor is not a width this rail can have; refuse it and stay opening.
      const m = measure();
      if (m && m.width >= m.floor) {
        drag.current = {
          kind: 'sizing',
          startX: e.clientX,
          startW: m.width,
          floor: m.floor,
          ceiling: m.ceiling,
          pending: m.width,
          collapse: false,
          raf: d.raf,
        };
      }
      return;
    }
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
    // Cleared BEFORE the store writes below, because `DockedShell` restores
    // `--sash-*` after the render they cause and must not skip that pass.
    markDragging(false);
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    if (d.kind === 'opening') {
      // Opened a closed rail and released without moving. **Commit nothing.** The
      // rail is already open at its token default and there is no width here worth
      // storing — the first version committed the measured one, and that measurement
      // is the RENDERED token, so at the 1024–1279px step it was `--rail-left-tight`
      // 208px, which `DockedShell` then renders as `clamp(--rail-left-min, 208px, …)`
      // = 228px. A press that moved nothing widened the rail 20px on release (28px on
      // the right), and — worse — made `railLeftW` a number for good: `railWidth`
      // never takes its compact arm again for that rail, the value persists through
      // `STUDIO_PREFS`, and the whole compact step is gone. A stored width is a fact
      // about a DRAG, and this gesture was not one.
      sync();
      return;
    }
    if (d.collapse) {
      // Hand the width back to the token, so reopening starts from the design's
      // number rather than the sliver the drag ended on. Then close. The property
      // itself is `DockedShell`'s to restore — see the note there on why removing it
      // here could not be undone.
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

  // Double-click. Only the store is written: `DockedShell` rewrites `--sash-*` after
  // every render, so the token default is back on the next paint. This used to
  // `removeProperty` first, and on a rail that had never been dragged that was a
  // one-gesture way to stack the whole studio vertically — see the note in
  // `DockedShell` for the mechanism.
  function reset() {
    setRailWidth(side, null);
  }

  // A closed rail has no range to report. It measures `--rail-closed` (37px),
  // which sits BELOW `aria-valuemin`, so claiming the trio there describes an
  // impossible slider — and the sash stays mounted while closed on purpose, since
  // Enter is what restores it. `aria-expanded` on the rail's own toggle is what
  // carries "closed"; a separator with no value is the honest alternative to one
  // with a wrong value.
  const shown = open ? metrics : null;
  const now = shown ? Math.round(shown.width) : null;
  const max = shown && Number.isFinite(shown.ceiling) ? Math.round(shown.ceiling) : null;

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
      aria-valuemin={shown ? Math.round(shown.floor) : undefined}
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

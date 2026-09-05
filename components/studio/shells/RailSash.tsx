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
/** One arrow press. Shift makes it 1px, for the last bit of a fussy adjustment —
 *  **except from below the drag floor, where there is no 1px to be had.** At the
 *  compact step the rail renders 208px against a 228px floor and the only widths it
 *  can be stored at start at 228, so the first grow press of any size lands on 228 and
 *  the fine step only means what it says from there on. That is the token system's
 *  answer rather than a bug in this constant: see the reachable-widths note in
 *  `onPointerMove`. */
const STEP = 16;

const WIDTH_PROP: Record<RailSide, string> = { left: '--sash-left', right: '--sash-right' };
const FLOOR_TOKEN: Record<RailSide, string> = { left: '--rail-left-min', right: '--rail-right-min' };
/** The width a SHUT rail measures — just the reopen toggle. */
const CLOSED_TOKEN = '--rail-closed';

type Metrics = { width: number; floor: number; ceiling: number; closed: number };

/** The narrowest this rail can be right now: its drag floor, unless it is ALREADY
 *  narrower, which between 1024 and 1279px it is by design — `globals.css` renders
 *  `--rail-*-tight` there, deliberately below `--rail-*-min`, because the floor is
 *  what a DRAG may reach and the tight token is what the reflowed default ships at.
 *
 *  **One function because `Home` and `aria-valuemin` must be the same number**, and
 *  they were two: `Home` read `min(floor, width)` and the attribute read
 *  `min(floor, tight)`. Reading the tight token is wrong above the compact step —
 *  the tight tokens sit on bare `:root`, so at 1600px the left rail advertised a
 *  minimum of 208 when nothing can take it below 228, and ArrowLeft went silently
 *  dead with 20px of advertised travel still on the dial. The RENDERED width answers
 *  it at every step without reading a second token, which is also why nothing in this
 *  file reads `--rail-*-tight` any more. */
function narrowest(m: Metrics): number {
  return Math.min(m.floor, m.width);
}

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
  onRestoreWidths,
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
  /** Re-applies BOTH `--sash-*` variables from the store, the same call the shell's
   *  layout effect makes. Needed because that effect only runs on a render, and the
   *  gestures that must undo a painted preview are exactly the ones that write no
   *  store — a press that resized nothing, and a double-click on a rail whose stored
   *  width is already `null`. Writing the resolved value back is what `removeProperty`
   *  was reaching for and could not do: React never learns a property was removed. */
  onRestoreWidths: () => void;
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
        /** Whether any pointermove has been seen. A release that never moved is a
         *  CLICK, and a click is not a width. */
        moved: boolean;
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
      // What the rail measures while it is SHUT. Not the same question as the floor,
      // and conflating the two is a defect a browser found: between 1024 and 1279px
      // the rail renders `--rail-*-tight` (208px left), which is deliberately BELOW
      // `--rail-left-min` (228px). A guard that refused any measurement under the
      // floor therefore refused the real open width for the whole compact step, and
      // the drag-a-closed-sash-open gesture never started.
      closed: tokenPx(shell, CLOSED_TOKEN),
      // (`narrowest()` above is the width the rail is ever OPEN at, which is not the
      // same as the narrowest a drag may produce. `aria-valuenow` has to sit inside the
      // published range and the compact step renders 208px against a 228px floor, so
      // publishing
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
    // `open` is a dependency, not decoration. While the rail is shut `metrics.width` is
    // the CLOSED width — `--rail-closed`, 37px — and `shown` starts publishing again the
    // instant `open` flips, so Enter or the chevron put `aria-valuenow=37` against an
    // `aria-valuemin` of 208 or 228 for the render after the toggle. That is the same
    // impossible-slider defect the compact step had, through the other door: neither
    // toggle path calls `sync`, and the ResizeObserver only closes it a frame later and
    // only in a browser that has one. Re-measuring on the flip closes it in the render
    // that opens the rail.
  }, [railRef, sync, open]);

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
      // the user pull a collapsed sash open is the requested behaviour: open it to
      // whatever width the shell resolves — `toggleRail` opens and closes and does NOT
      // clear a stored width; three comments in this branch claimed it did, and
      // `lib/store.ts` carries the reason it deliberately does not — and turn this
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
      moved: false,
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
      // rightward, so the release closes the rail the press just opened.
      //
      // The guard is "is this still the SHUT width", **not** "is this below the
      // floor", and the difference is not pedantry: the first version compared against
      // `m.floor`, and between 1024 and 1279px the rail renders `--rail-left-tight` at
      // 208px against a `--rail-left-min` of 228px — legitimately below its own floor,
      // by design. That guard refused every measurement for the whole compact step, so
      // the gesture never became a sizing one and dragging a closed sash open stopped
      // working at exactly the widths it was written for. A browser found that; no
      // jsdom test could, because jsdom resolves neither token.
      const m = measure();
      if (m && m.width > m.closed + 1) {
        drag.current = {
          kind: 'sizing',
          startX: e.clientX,
          startW: m.width,
          floor: m.floor,
          ceiling: m.ceiling,
          pending: m.width,
          collapse: false,
          raf: d.raf,
          // This move only re-seeded the gesture; it did not size anything.
          moved: false,
        };
      }
      return;
    }
    // The left rail grows as the pointer moves right; the right rail is mirrored.
    const delta = side === 'left' ? e.clientX - d.startX : d.startX - e.clientX;
    if (delta !== 0) d.moved = true;
    const raw = d.startW + delta;
    // Measured from wherever this rail actually STARTED, not from its drag floor. At
    // the compact step the right rail is born at `--rail-right-tight` 248px against a
    // floor of 276px, so `raw < floor - SNAP_PAST_FLOOR` was already TRUE at zero
    // delta: the first pointermove in any direction armed the close, and a press that
    // moved straight down shut the Inspector. The left rail is the same shape 4px in.
    // A collapse means the user pulled this divider meaningfully narrower than where
    // it was, and a rail that opens below its own floor has not been pulled anywhere.
    // The floor THIS gesture may reach, which is the drag floor unless the rail
    // started below it. Read by the collapse test and by the width alike, because they
    // are the same question asked twice.
    const gestureFloor = Math.min(d.floor, d.startW);
    d.collapse = raw < gestureFloor - SNAP_PAST_FLOOR;
    const want = Math.max(gestureFloor, Math.min(d.ceiling, raw));
    // **The widths this rail can actually BE are its token width and the closed
    // interval `[floor, ceiling]` — nothing in between.** `DockedShell` renders a
    // stored width as `clamp(var(--rail-side-min), Npx, var(--rail-max))`, so any
    // number below the drag floor comes back AS the drag floor. At the compact step
    // the right rail is born at `--rail-right-tight` 248px against a floor of 276px,
    // and the branch that fixed the keyboard left this line clamping straight up to
    // the floor: pull the divider 2px TOWARD the Inspector and it committed 276 —
    // 28px WIDER, stored, and the compact step gone for that rail for good. Every
    // delta in [-24, +28) landed on exactly 276, so there was no narrowing gesture in
    // that band at all. The keyboard's rule is "a key that asked for less must never
    // deliver more"; this is the same rule on the other input, and it is expressed as
    // the set of reachable widths rather than as a second guard, so the PREVIEW cannot
    // show a size the release is going to refuse.
    d.pending = want < d.floor ? d.startW : want;
    // Nothing is painted until the pointer has actually travelled. `pending` is
    // clamped UP to the drag floor, so a zero-delta move at the compact step painted
    // `228px` over a 208px rail — a 20px jump on a press that resized nothing, and one
    // the release could not take back, because a release that commits nothing writes
    // no store and no store write means no render for the layout effect to ride.
    if (!d.moved) return;
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
      onRestoreWidths();
      sync();
      return;
    }
    if (!d.moved) {
      // Tested BEFORE the collapse branch, and the order is load-bearing rather than
      // tidy: `d.collapse` can be armed by a pointermove that travelled zero pixels —
      // see the note where it is computed — and it used to be read first, which left
      // this guard unreachable on the one path that closed a rail by accident.
      //
      // A press and a release at the same x is a CLICK, and a click is not a width.
      // Committing `d.pending` here stores the RENDERED width, which between 1024 and
      // 1279px is `--rail-left-tight` at 208px — and `DockedShell` renders a stored
      // number as `clamp(var(--rail-left-min), 208px, …)` = 228px. So clicking the
      // divider widened the rail 20px and pinned it out of the compact step for good,
      // exactly as the closed-rail release did. Same defect, the other door: the
      // closed one was found by reading and this one by a browser, because a
      // double-click on the sash fires two of these before `reset()` and the probe
      // measured 228px where it expected 208.
      //
      // Storing nothing is only half of it. A pointermove that moved zero pixels still
      // used to paint, and a release that writes no store causes no render, so the
      // preview stayed on the element for the session. The paint is gated now AND the
      // variables are put back from the store here, because either alone leaves a door.
      onRestoreWidths();
      sync();
      return;
    }
    if (d.collapse) {
      // Hand the width back to the token, so reopening starts from the design's
      // number rather than the sliver the drag ended on. Then close. The property
      // itself is restored through the shell rather than removed — see the note there
      // on why removing it could not be undone.
      setRailWidth(side, null);
      onRestoreWidths();
      onToggle();
      return;
    }
    if (d.pending < d.floor) {
      // The gesture never reached a width this rail can hold. `pending` is `startW`
      // here by construction — see the note where it is computed — and storing it
      // would render as the drag floor, which is the widen-by-narrowing defect this
      // branch exists to remove. Nothing is stored; the rail keeps its token.
      onRestoreWidths();
      sync();
      return;
    }
    setRailWidth(side, d.pending);
    // Every gesture that ENDS re-asserts the store's value on the element, this one
    // included — the rule is "when no drag is live, the DOM says what the store says",
    // and each branch above is an instance of it rather than its own special case.
    // The commit path is the one that pins the rule, because it is the one whose hole
    // is reachable: `paint()` writes a RAW `228px`, while the shell renders a stored
    // width as `clamp(var(--rail-left-min), 228px, var(--rail-max))`. Drag a rail to a
    // width it is already stored at and zustand compares the two equal, so no render
    // follows and the raw value stays — a width no longer bounded by `--rail-max`,
    // which is the one thing that keeps the room when the window gets smaller.
    onRestoreWidths();
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
    // The narrowest this rail can be, which is its drag floor UNLESS it is already
    // narrower — the compact step renders it below that floor by design, and `Home`
    // meaning "smallest" must never be the key that makes it bigger.
    else if (e.key === 'Home') next = narrowest(m);
    else if (e.key === 'End') next = Number.isFinite(m.ceiling) ? m.ceiling : m.width;
    else return;
    e.preventDefault();
    const clamped = Math.max(m.floor, Math.min(m.ceiling, next));
    // A key that asked for LESS must never deliver more. Between 1024 and 1279px the
    // rail renders 208px against a 228px floor, so clamping a shrink up to the floor
    // turned one ArrowLeft into a 20px WIDEN, stored: `railLeftW` becomes 228 and the
    // compact step never applies to that rail again. `Home` did it too.
    //
    // **An earlier version of this comment said that unlike the pointer paths this one
    // persists. That was false and it scoped a search:** the commit at the end of
    // `onPointerUp` calls the same `setRailWidth`, so a 2px narrowing DRAG persisted
    // 228 (left) and 276 (right) identically, and the comment claiming otherwise is
    // why the branch shipped with the keyboard fixed and the pointer raw. The pointer
    // half is the reachable-widths rule in `onPointerMove`.
    //
    // Refusing is the honest answer and it is not silent: `aria-valuemin` is the
    // rendered width when the rail is under its floor, so a screen reader says the
    // rail is already at its minimum — the two fixes are one fix.
    if (clamped > m.width && next <= m.width) return;
    setRailWidth(side, clamped);
  }

  // Double-click. Only the store is written: `DockedShell` rewrites `--sash-*` after
  // every render, so the token default is back on the next paint. This used to
  // `removeProperty` first, and on a rail that had never been dragged that was a
  // one-gesture way to stack the whole studio vertically — see the note in
  // `DockedShell` for the mechanism.
  function reset() {
    setRailWidth(side, null);
    // …and put the variables back by hand, because writing `null` over a width that
    // is ALREADY `null` is not a change zustand publishes, so no render follows and
    // the layout effect never runs. That is reachable: a press that resized nothing
    // leaves a painted preview and stores nothing, and the double-click meant to undo
    // it then had nothing to trigger. `main` appeared not to have this problem only
    // because its click-commit bug guaranteed a stored number for the `null` to differ
    // from — two defects holding each other up.
    onRestoreWidths();
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
      // The DRAG floor is 228px (left) and the rail renders 208px for the whole
      // compact step, so publishing the floor here put `aria-valuenow` BELOW
      // `aria-valuemin` on both rails across that whole band — an impossible slider,
      // which is the thing the comment above says this file refuses to publish.
      // `narrowest()` is the same number `Home` moves to, deliberately, and it makes
      // `valuemin <= valuenow` true by construction rather than by assertion — so a
      // test that only checks the ordering is checking nothing. What is worth pinning
      // is the VALUE: 208 at the compact step, the floor above it.
      aria-valuemin={shown ? Math.round(narrowest(shown)) : undefined}
      aria-valuemax={max ?? undefined}
      aria-valuetext={now != null ? `${now} pixels` : undefined}
      // The affordance a CLOSED sash offers is not the one an open sash offers, and
      // it used to advertise the open one either way: "drag to resize" on a strip
      // there is nothing to resize, and "Enter to collapse" on something already
      // collapsed. Both gestures do open it, so both are named.
      title={
        open
          ? 'Drag to resize · double-click to reset · Enter to collapse'
          : 'Drag or press to open · Enter to open'
      }
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

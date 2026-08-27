'use client';

// A label that appears on hover, for a control whose glyph is the whole label.
//
// Two reasons this is not the native `title` attribute, which is what the rest of
// the app uses as a belt-and-braces second copy of an `aria-label`:
//
//   · The native one is drawn by the OS, in the system font, after ~1s, in a
//     colour nothing here controls. On a row of icon-only buttons — where the
//     tooltip is the ONLY way to read the control — that is not a hint, it is the
//     label, and a label should look like the rest of the app.
//   · It never appears on keyboard focus. A control whose name is only in a
//     `title` is unreadable to anyone tabbing through, which is exactly the
//     population that cannot hover.
//
// **It is `position: fixed` and measured, not absolute.** Every consumer so far
// lives in `.rail`, which is `overflow: hidden`, so an absolutely-positioned
// bubble is clipped at the rail's edge — the failure `ui/Select.tsx` and
// `RoomTools.tsx` both hit and both fixed the same way. `--z-popover` puts it over
// its neighbours, and the position is recomputed on open rather than tracked,
// because a tooltip that survives a scroll is a tooltip pointing at nothing.
//
// The accessible name still comes from the trigger's own `aria-label`. This adds
// `aria-hidden` decoration on top: announcing the bubble as well would say the
// name twice, and `aria-describedby` would make it a description, which it is not
// — it IS the name.

import { useCallback, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** Gap between the trigger and the bubble. */
const OFFSET = 8;
/** Keeps the bubble off the viewport edges. */
const MARGIN = 8;
/** Widest the bubble may be. Beyond this it wraps — see the clamp in `open`. */
const CAP = 240;

export function Tooltip({
  label,
  children,
  placement = 'top',
}: {
  /** The visible name. Usually a PREFIX of the trigger's `aria-label` rather than
   *  the whole of it: `LightingPicker` shows "Sunrise" here while its accessible
   *  name is "Sunrise — Low sun from the east", because the bubble is a name and
   *  the extra clause is orientation a screen-reader user cannot get from the
   *  glyph. Keep this the short one; it is read at a glance, next to four others. */
  label: string;
  /** One focusable, hoverable element. */
  children: ReactNode;
  placement?: 'top' | 'bottom';
}) {
  const wrapRef = useRef<HTMLSpanElement>(null);
  const [box, setBox] = useState<{
    left: number;
    top: number;
    place: 'top' | 'bottom';
    /** The cap actually applied, so the style and the clamp read one number. */
    width: number;
  } | null>(null);

  // Set on pointer-down and cleared when the pointer leaves or focus goes. Without
  // it, `onPointerDown={close}` was defeated one event later: pressing a button
  // dispatches pointerdown → mousedown → **focus** as separate native events, so
  // React committed the close and then `onFocus` reopened the bubble over the
  // control that had just been pressed — the exact annoyance that handler exists to
  // prevent, and visible on every click of a lighting chip.
  const pressedRef = useRef(false);

  const open = useCallback(() => {
    if (pressedRef.current) return;
    const el = wrapRef.current?.firstElementChild ?? wrapRef.current;
    const r = el?.getBoundingClientRect();
    if (!r) return;
    // Measured against the viewport because the bubble is `fixed`. Height is not
    // known before paint, so `place` is decided from the space available and the
    // transform does the rest — which also means one number, not a re-measure.
    const place = placement === 'top' && r.top < 44 ? 'bottom' : placement;
    // Clamp the bubble's BOX inside the viewport, not its centre. Clamping the
    // centre to `[MARGIN, innerWidth - MARGIN]` and then translating by -50% left
    // half the bubble outside that range: at 360px wide, a trigger 20px from the
    // left edge with a 200px label put the first third of the word off-screen — and
    // with `nowrap` and `position: fixed` there is no wrap, no ellipsis and no
    // scrollbar to say so, on the one control whose bubble IS its label.
    //
    // `half` is derived from the same cap the bubble is styled with, so the two
    // cannot drift; on a viewport narrower than the cap the range collapses and the
    // bubble centres itself, which is the right answer when it cannot fit beside
    // its trigger anyway.
    const width = Math.min(CAP, window.innerWidth - 2 * MARGIN);
    const half = width / 2;
    const centre = r.left + r.width / 2;
    setBox({
      left: Math.min(Math.max(MARGIN + half, centre), window.innerWidth - MARGIN - half),
      top: place === 'top' ? r.top - OFFSET : r.bottom + OFFSET,
      place,
      width,
    });
  }, [placement]);

  const close = useCallback(() => setBox(null), []);
  /** A press: dismiss, and stay dismissed until the pointer or focus leaves. */
  const press = useCallback(() => {
    pressedRef.current = true;
    setBox(null);
  }, []);
  /** Leaving re-arms it. Both handlers clear the flag, because a control can be
   *  left by the pointer or by Tab and either one ends the press. */
  const leave = useCallback(() => {
    pressedRef.current = false;
    setBox(null);
  }, []);

  return (
    <span
      ref={wrapRef}
      style={{ display: 'inline-flex', minWidth: 0 }}
      onPointerEnter={open}
      onPointerLeave={leave}
      // Focus and blur CAPTURE, so the bubble opens for the real focus target
      // inside rather than needing the wrapper itself to be focusable. `focus`
      // does not bubble; `focusin` would, but React's synthetic `onFocus` already
      // captures, and using it keeps this a plain React tree.
      onFocus={open}
      onBlur={leave}
      // A pointer-down means the control is being used, and a bubble left hanging
      // over the thing you just pressed is the most common tooltip annoyance. It
      // has to latch — see `pressedRef` — because the focus that follows would
      // otherwise reopen it in the same tick.
      onPointerDown={press}
      // Escape dismisses it without moving focus — the one thing a keyboard user
      // has no other way to do once it is open.
      onKeyDown={(e) => {
        if (e.key === 'Escape' && box) {
          e.stopPropagation();
          close();
        }
      }}
    >
      {children}
      {/* Portalled to `document.body` rather than rendered here, and that is not
          cosmetic. `.rail` carries `container-type: inline-size`, which applies
          layout containment — and a layout-contained element acts as the containing
          block for its `position: fixed` descendants. If that holds in the shipping
          browsers, a bubble rendered inside the rail would resolve its viewport
          coordinates against the RAIL's origin and land nowhere near its trigger.
          Rather than depend on which way that resolves, the bubble leaves the
          subtree entirely: `document.body` is outside every container, so the
          measured `fixed` coordinates mean what they say. `ui/Select.tsx` and
          `RoomTools.tsx` have the same exposure and have not been moved — see
          `docs/visual-check.md`. */}
      {box && createPortal(
        <span
          role="tooltip"
          // Decoration: the trigger's own `aria-label` is the accessible name, so
          // announcing this too would repeat it.
          aria-hidden="true"
          style={{
            position: 'fixed',
            left: box.left,
            top: box.top,
            transform: `translate(-50%, ${box.place === 'top' ? '-100%' : '0'})`,
            zIndex: 'var(--z-popover)',
            pointerEvents: 'none',
            background: 'var(--ink)',
            color: 'var(--on-ink)',
            borderRadius: 'var(--r-1)',
            padding: '4px 8px',
            fontSize: 11.5,
            fontWeight: 600,
            fontFamily: 'var(--font-sans)',
            lineHeight: 1.3,
            // Wraps inside the cap rather than running off the edge. `anywhere`
            // because a part name is user-typed and need not contain a space.
            maxWidth: box.width,
            whiteSpace: 'normal',
            overflowWrap: 'anywhere',
            textAlign: 'center',
            boxShadow: 'var(--shadow-lift)',
          }}
        >
          {label}
        </span>,
        document.body,
      )}
    </span>
  );
}

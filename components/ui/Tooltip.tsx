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

import { useCallback, useId, useRef, useState, type ReactNode } from 'react';

/** Gap between the trigger and the bubble. */
const OFFSET = 8;
/** Keeps the bubble off the viewport edges. */
const MARGIN = 8;

export function Tooltip({
  label,
  children,
  placement = 'top',
}: {
  /** The text. Should be the same string as the trigger's `aria-label`. */
  label: string;
  /** One focusable, hoverable element. */
  children: ReactNode;
  placement?: 'top' | 'bottom';
}) {
  const id = useId();
  const wrapRef = useRef<HTMLSpanElement>(null);
  const [box, setBox] = useState<{ left: number; top: number; place: 'top' | 'bottom' } | null>(null);

  const open = useCallback(() => {
    const el = wrapRef.current?.firstElementChild ?? wrapRef.current;
    const r = el?.getBoundingClientRect();
    if (!r) return;
    // Measured against the viewport because the bubble is `fixed`. Height is not
    // known before paint, so `place` is decided from the space available and the
    // transform does the rest — which also means one number, not a re-measure.
    const place = placement === 'top' && r.top < 44 ? 'bottom' : placement;
    setBox({
      left: Math.min(Math.max(MARGIN, r.left + r.width / 2), window.innerWidth - MARGIN),
      top: place === 'top' ? r.top - OFFSET : r.bottom + OFFSET,
      place,
    });
  }, [placement]);

  const close = useCallback(() => setBox(null), []);

  return (
    <span
      ref={wrapRef}
      style={{ display: 'inline-flex', minWidth: 0 }}
      onPointerEnter={open}
      onPointerLeave={close}
      // Focus and blur CAPTURE, so the bubble opens for the real focus target
      // inside rather than needing the wrapper itself to be focusable. `focus`
      // does not bubble; `focusin` would, but React's synthetic `onFocus` already
      // captures, and using it keeps this a plain React tree.
      onFocus={open}
      onBlur={close}
      // A pointer-down means the control is being used, and a bubble left hanging
      // over the thing you just pressed is the most common tooltip annoyance.
      onPointerDown={close}
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
      {box && (
        <span
          id={id}
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
            whiteSpace: 'nowrap',
            boxShadow: 'var(--shadow-lift)',
          }}
        >
          {label}
        </span>
      )}
    </span>
  );
}

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

import { useCallback, useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';

/** Gap between the trigger and the bubble. */
const OFFSET = 8;
/** Keeps the bubble off the viewport edges. */
const MARGIN = 8;
/** Widest the bubble may be. Beyond this it wraps — see the clamp in `open`. */
const CAP = 240;

type BubbleBox = {
  left: number;
  top: number;
  place: 'top' | 'bottom';
  /** The cap actually applied, so the style and the clamp read one number. */
  width: number;
};

/** Where a bubble goes for a trigger at `r`: `position: fixed` coordinates, kept
 *  inside the viewport. Shared by `Tooltip` and `InfoTip` so the two bubbles land
 *  by one rule. */
function placeBubble(r: DOMRect, placement: 'top' | 'bottom'): BubbleBox {
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
  return {
    left: Math.min(Math.max(MARGIN + half, centre), window.innerWidth - MARGIN - half),
    top: place === 'top' ? r.top - OFFSET : r.bottom + OFFSET,
    place,
    width,
  };
}

/** The bubble's look, one definition for both kinds. */
function bubbleStyle(box: BubbleBox): CSSProperties {
  return {
    position: 'fixed',
    left: box.left,
    top: box.top,
    transform: `translate(-50%, ${box.place === 'top' ? '-100%' : '0'})`,
    zIndex: 'var(--z-popover)',
    background: 'var(--ink)',
    color: 'var(--on-ink)',
    borderRadius: 'var(--r-1)',
    padding: '4px 8px',
    fontSize: 'var(--fs-caption)',
    fontWeight: 600,
    fontFamily: 'var(--font-sans)',
    lineHeight: 1.3,
    // Wraps inside the cap rather than running off the edge. `anywhere`
    // because a part name is user-typed and need not contain a space.
    maxWidth: box.width,
    whiteSpace: 'normal',
    overflowWrap: 'anywhere',
    boxShadow: 'var(--shadow-lift)',
  };
}

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
  const [box, setBox] = useState<BubbleBox | null>(null);

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
    setBox(placeBubble(r, placement));
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
          style={{ ...bubbleStyle(box), pointerEvents: 'none', textAlign: 'center' }}
        >
          {label}
        </span>,
        document.body,
      )}
    </span>
  );
}

/** An info button that opens an explanation in the same bubble as `Tooltip`.
 *
 *  A different control from `Tooltip`, not a variant of it. A tooltip names the
 *  control it sits on and dismisses on press, which is right for a name and wrong
 *  here: on a touch screen the press IS the only way to open it, so `Tooltip`'s
 *  press latch would flash the bubble and close it in the same gesture. This one
 *  opens on hover and focus like a tooltip, and a press PINS it (a toggletip), so a
 *  tap opens it, a second tap, Escape, or a press anywhere else closes it.
 *
 *  The bubble is real content, not decoration: it is the trigger's description
 *  (`aria-describedby`) while open, and the trigger's own name says what it is
 *  about ("About sun direction"). */
export function InfoTip({
  label,
  children,
  placement = 'top',
}: {
  /** The button's accessible name, e.g. "About sun direction". */
  label: string;
  /** The explanation. Plain text or inline elements. */
  children: ReactNode;
  placement?: 'top' | 'bottom';
}) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const id = useId();
  const [hover, setHover] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [box, setBox] = useState<BubbleBox | null>(null);
  const shown = hover || pinned;

  // Measured when it opens, like `Tooltip`: a bubble that survives a scroll is a
  // bubble pointing at nothing, so a scroll or a resize closes it instead.
  useEffect(() => {
    if (!shown) {
      setBox(null);
      return;
    }
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setBox(placeBubble(r, placement));
    const shut = () => {
      setHover(false);
      setPinned(false);
    };
    const outside = (e: PointerEvent) => {
      if (!btnRef.current?.contains(e.target as Node)) shut();
    };
    window.addEventListener('scroll', shut, true);
    window.addEventListener('resize', shut);
    document.addEventListener('pointerdown', outside);
    return () => {
      window.removeEventListener('scroll', shut, true);
      window.removeEventListener('resize', shut);
      document.removeEventListener('pointerdown', outside);
    };
  }, [shown, placement]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className="icon-btn"
        aria-label={label}
        aria-expanded={shown}
        aria-describedby={box ? id : undefined}
        onPointerEnter={(e) => e.pointerType === 'mouse' && setHover(true)}
        onPointerLeave={(e) => e.pointerType === 'mouse' && setHover(false)}
        // Keyboard focus opens it like a hover. A tap focuses the button too, and
        // counting that would leave the bubble open after the second tap closed it.
        onFocus={(e) => e.currentTarget.matches(':focus-visible') && setHover(true)}
        onBlur={() => {
          setHover(false);
          setPinned(false);
        }}
        onClick={() => setPinned((p) => !p)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && shown) {
            e.stopPropagation();
            setHover(false);
            setPinned(false);
          }
        }}
        style={{ width: 24, height: 24, borderRadius: 'var(--r-full)', color: 'var(--ink-3)', flexShrink: 0 }}
      >
        <Icon name="info" size={14} />
      </button>
      {box && createPortal(
        <span
          id={id}
          role="tooltip"
          style={{ ...bubbleStyle(box), textAlign: 'left', fontWeight: 500, padding: '6px 10px', lineHeight: 1.4 }}
        >
          {children}
        </span>,
        document.body,
      )}
    </>
  );
}

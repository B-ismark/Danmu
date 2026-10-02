'use client';

// A measurement input with our own stepper.
//
// The native spinner is suppressed app-wide (globals.css): it is platform chrome
// — grey arrows in a system blue on hover — sitting in fields that are otherwise
// ours. This puts the affordance back in the design system's terms: a two-chevron
// column inside the field's right edge, tokenised, that repeats while held.
//
// The chevrons are aria-hidden and out of the tab order on purpose. The input is
// already a spinbutton to assistive tech and Up/Down step it, so exposing two
// more stops per field would add twelve tab stops across the two editors that
// use this, for a control keyboard users already have.
//
// Nor do they take focus when pressed: a press leaves it where it was. A pressed
// button takes focus by default, and these took it out of the field onto a button
// assistive tech is told is not there — after which Up and Down stepped nothing,
// because the field they step no longer had focus. Putting focus IN the field
// instead, as a native spinner does, was tried and dropped: the studio's shortcuts
// stand down while an input has focus (`KeyboardShortcuts.tsx`), so undo stopped
// undoing the step just taken; and on a touch laptop, where the arrows show, a tap
// focusing a decimal field can bring up the on-screen keyboard.
//
// The one exception is a press made while ANOTHER field is being typed in. Left
// there, focus stayed in the width while its depth's arrow was pressed, so the next
// Up stepped the width. Both costs above are already paid by then — the shortcuts
// are off and the keyboard is up — so the focus follows the press, as it would
// into a native spinner.
//
// On a touch screen the chevrons step aside (`.num-field` in globals.css) and the
// field grows to 44px. A 16 × 14 arrow is not a target a finger can hit, and on a
// phone `inputMode="decimal"` brings up the number pad, which is how a phone asks
// for a number: Material's text fields and Apple's forms both do it that way.
//
// The repeat is a timer that reads the clock, and applies at most MAX_CATCH_UP
// steps per tick. Neither half is optional. A plain 60ms interval drifts badly
// when each step re-renders an inspector panel and a 3D scene — on a software
// renderer it delivered a fifth of its nominal rate. Deriving the count from
// elapsed time fixes the rate but, on its own, turns a starved tick into one
// 27-step leap at release. The cap keeps a slow host feeling slow instead of
// feeling broken.

import { useEffect, useRef, type CSSProperties, type PointerEvent } from 'react';
import { steppedValue } from '@/lib/units';
import { Icon } from './Icon';

/** Room either side of the digits: the stepper column on the right, a gap on the left. */
const PAD_LEFT = 8;
const PAD_RIGHT = 20;

/** The narrowest a NumberField can be and still show every one of `values` whole:
 *  the digits in the mono face (0.6em a character — Geist Mono's advance, measured
 *  at 8.0px for 13.5px type), the padding either side and the two 1px borders. For a
 *  row of fields (`.fields-row`), which drops a field to the next line rather than
 *  cut a number short — at the laptop's 1024px step three room fields got 51px each
 *  and "6.00" read "6.0", which an input does not report as overflow. */
export function fieldMinWidth(values: string[]): string {
  const chars = Math.max(1, ...values.map((v) => v.length));
  return `calc(${chars} * 0.6 * var(--field-fs) + ${PAD_LEFT + PAD_RIGHT + 2}px)`;
}

/** The two arrows. One list, so a change to how an arrow answers a press is made
 *  once rather than to each arrow in turn. */
const ARROWS = [
  { dir: 1, title: 'Increase', icon: 'chevron-up' },
  { dir: -1, title: 'Decrease', icon: 'chevron-down' },
] as const;

/** Focus a person is typing into: a text-entry input, a textarea, editable text. A
 *  checkbox or a slider is focusable without bringing up a keyboard, so it is not. */
const UNTYPED = new Set(['checkbox', 'radio', 'range', 'color', 'file', 'button', 'submit', 'reset', 'image']);
function isTypedInto(el: Element | null): boolean {
  if (el instanceof HTMLInputElement) return !UNTYPED.has(el.type);
  return el instanceof HTMLTextAreaElement || (el instanceof HTMLElement && el.isContentEditable);
}

const HOLD_DELAY = 380;
const HOLD_EVERY = 60;
const MAX_CATCH_UP = 3;

export function NumberField({
  value,
  onChange,
  step,
  min = 0,
  max,
  height = 34,
  ariaInvalid,
  ariaLabel,
  style,
  onFocus,
  onBlur,
}: {
  value: string;
  onChange: (v: string) => void;
  /** Entering and leaving the box — a caller holds its draft as typed in between,
   *  and tidies it into display form on the way out. */
  onFocus?: () => void;
  onBlur?: () => void;
  step: number;
  min?: number;
  max?: number;
  height?: number;
  ariaInvalid?: boolean;
  ariaLabel?: string;
  style?: CSSProperties;
}) {
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // The latest value, so a repeat that started three steps ago still counts from
  // where the field actually is.
  const latest = useRef(value);
  latest.current = value;
  // …and the latest onChange. The callers rebuild this closure every render over
  // their own local state; a repeat that kept the one captured when the press
  // started would hand every tick the same stale array to patch, so the field
  // would take one step and then sit there however long you held it.
  const emit = useRef(onChange);
  emit.current = onChange;

  const stop = () => {
    if (timer.current !== null) clearInterval(timer.current);
    timer.current = null;
  };
  useEffect(() => stop, []);

  function bump(steps: number) {
    if (steps === 0) return;
    // `lib/units.ts`, not here: this is arithmetic over bounds that module
    // produces, and while it lived in the component nothing could test it.
    const out = steppedValue(latest.current, steps, min, max, step);
    // Keep the ref in step with the value we just asked for: the next tick can
    // arrive before the parent has re-rendered with it.
    latest.current = out;
    emit.current(out);
  }

  function hold(dir: 1 | -1) {
    stop();
    bump(dir);
    const start = performance.now();
    let applied = 0;
    timer.current = setInterval(() => {
      const since = performance.now() - start - HOLD_DELAY;
      if (since <= 0) return;
      const owed = Math.floor(since / HOLD_EVERY) - applied;
      if (owed <= 0) return;
      // Forgive whatever the cap won't pay. Carrying the debt would pin `owed`
      // at the cap for the rest of the hold, turning a 16-steps-per-second
      // control into a 50-steps-per-second one that overshoots by miles.
      applied += owed;
      bump(dir * Math.min(MAX_CATCH_UP, owed));
    }, HOLD_EVERY);
  }

  function press(e: PointerEvent<HTMLButtonElement>, dir: 1 | -1) {
    // The primary button only. A right-click stepped the value and started the
    // repeat, and the context menu it opens can take the pointerup that stops it.
    if (e.button !== 0) return;
    // Capture, so a pointer that drifts off a 16px target mid-hold keeps
    // stepping and still ends on pointerup.
    e.currentTarget.setPointerCapture(e.pointerId);
    const was = document.activeElement;
    if (was !== inputRef.current && isTypedInto(was)) inputRef.current?.focus({ preventScroll: true });
    hold(dir);
  }

  const chevron: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: (height - 6) / 2,
    width: 16,
    padding: 0,
    border: 'none',
    background: 'transparent',
    color: 'var(--ink-3)',
    cursor: 'pointer',
  };

  return (
    <div className="num-field" style={{ position: 'relative', display: 'flex' }}>
      <input
        ref={inputRef}
        type="number"
        inputMode="decimal"
        value={value}
        step={step}
        min={min}
        max={max}
        aria-invalid={ariaInvalid || undefined}
        aria-label={ariaLabel}
        onChange={(e) => onChange(e.target.value)}
        onFocus={onFocus}
        onBlur={onBlur}
        className="field"
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--field-fs)',
          fontWeight: 600,
          height,
          // room for the stepper column, so long values never run under it
          padding: `0 ${PAD_RIGHT}px 0 ${PAD_LEFT}px`,
          ...style,
        }}
      />
      <div
        aria-hidden
        // Laid out in globals.css, not inline: an inline `display` would beat the
        // touch-screen rule that hides the column.
        className="num-field__steps"
      >
        {ARROWS.map(({ dir, title, icon }) => (
          <button
            key={dir}
            type="button"
            tabIndex={-1}
            title={title}
            style={chevron}
            // The focus a press would move is the mouse-down's to move, not the
            // pointer-down's, so that is the default to cancel.
            onMouseDown={(e) => e.preventDefault()}
            onPointerDown={(e) => press(e, dir)}
            onPointerUp={stop}
            onPointerCancel={stop}
            // A capture that ends without a pointerup reaching the arrow ends the
            // hold too, rather than leaving the repeat running on its own.
            onLostPointerCapture={stop}
          >
            <Icon name={icon} size={11} />
          </button>
        ))}
      </div>
    </div>
  );
}

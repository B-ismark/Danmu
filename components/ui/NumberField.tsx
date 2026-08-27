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
// The repeat is a timer that reads the clock, and applies at most MAX_CATCH_UP
// steps per tick. Neither half is optional. A plain 60ms interval drifts badly
// when each step re-renders an inspector panel and a 3D scene — on a software
// renderer it delivered a fifth of its nominal rate. Deriving the count from
// elapsed time fixes the rate but, on its own, turns a starved tick into one
// 27-step leap at release. The cap keeps a slow host feeling slow instead of
// feeling broken.

import { useEffect, useRef, type CSSProperties } from 'react';
import { decimalsOf } from '@/lib/units';
import { Icon } from './Icon';

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
}: {
  value: string;
  onChange: (v: string) => void;
  step: number;
  min?: number;
  max?: number;
  height?: number;
  ariaInvalid?: boolean;
  ariaLabel?: string;
  style?: CSSProperties;
}) {
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
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
    const n = Number(latest.current);
    const base = Number.isFinite(n) ? n : min;
    let next = base + steps * step;
    if (max !== undefined) next = Math.min(max, next);
    next = Math.max(min, next);
    const out = next.toFixed(decimalsOf(step));
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
    <div style={{ position: 'relative', display: 'flex' }}>
      <input
        type="number"
        inputMode="decimal"
        value={value}
        step={step}
        min={min}
        max={max}
        aria-invalid={ariaInvalid || undefined}
        aria-label={ariaLabel}
        onChange={(e) => onChange(e.target.value)}
        className="field"
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 13,
          fontWeight: 600,
          height,
          // room for the stepper column, so long values never run under it
          padding: '0 20px 0 8px',
          ...style,
        }}
      />
      <div
        aria-hidden
        style={{
          position: 'absolute',
          right: 3,
          top: 3,
          bottom: 3,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
        }}
      >
        <button
          type="button"
          tabIndex={-1}
          title="Increase"
          style={chevron}
          onPointerDown={(e) => {
            // Capture, so a pointer that drifts off a 16px target mid-hold keeps
            // stepping and still ends on pointerup.
            e.currentTarget.setPointerCapture(e.pointerId);
            hold(1);
          }}
          onPointerUp={stop}
          onPointerCancel={stop}
        >
          <Icon name="chevron-up" size={11} />
        </button>
        <button
          type="button"
          tabIndex={-1}
          title="Decrease"
          style={chevron}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            hold(-1);
          }}
          onPointerUp={stop}
          onPointerCancel={stop}
        >
          <Icon name="chevron-down" size={11} />
        </button>
      </div>
    </div>
  );
}

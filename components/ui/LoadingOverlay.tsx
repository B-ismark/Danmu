'use client';

// Blocking progress overlay for long async work: a calm card over a scrim with
// a plain status line. Three things here are contracts, not decoration.
//
// 1. No rotating tips. The card used to cycle usage tips and a privacy line
//    ("Your photos and designs stay on your device") under a "Tip" heading, and
//    its status line cycled flavour phrases ending in "Almost ready", which is a
//    duration claim (see 3). The caller's `description` and `note` are the only
//    copy; where the work happens is said by the screen that started it.
// 2. It blocks the whole page, so it behaves like a dialog: focus moves in, Tab
//    stays in, Esc cancels when the caller can cancel. Without `onCancel` the
//    only way out of a slow operation is a hard reload.
// 3. No duration claims. We don't know how long a download or a round-trip
//    takes, so the copy never says "a moment" or "10-20 seconds".

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Dot } from './primitives';
import { Icon } from './Icon';

// After this long, offer the way out rather than let someone keep waiting on a
// download that may never land.
const SLOW_MS = 18000;

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function LoadingOverlay({
  title,
  step,
  totalSteps,
  description,
  note,
  onCancel,
  cancelLabel = 'Stop',
  art,
}: {
  title: string;
  step?: number;
  totalSteps?: number;
  description?: string;
  /** One line about what this operation does, e.g. that it uploads. */
  note?: string;
  /** Strongly recommended: without it this overlay has no exit. */
  onCancel?: () => void;
  cancelLabel?: string;
  /** A picture to wait with, above the title. Decoration: it must be `aria-hidden`
   *  itself and say nothing the title does not. */
  art?: ReactNode;
}) {
  const pct = step !== undefined && totalSteps ? Math.min(100, (step / totalSteps) * 100) : null;
  const hasBar = pct !== null;
  const [t, setT] = useState(0);
  const [slow, setSlow] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    // CSS handles declarative animation under prefers-reduced-motion; a JS
    // ticker has to opt out for itself. The scan dot is pure movement, so it stops.
    const still =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

    const timers: ReturnType<typeof setInterval>[] = [];
    if (!still && hasBar) timers.push(setInterval(() => setT((v) => v + 1), 80));
    const slowTimer = setTimeout(() => setSlow(true), SLOW_MS);
    return () => {
      timers.forEach(clearInterval);
      clearTimeout(slowTimer);
    };
  }, [hasBar]);

  // Focus management, same shape as the Modal primitive: this covers the page,
  // so a keyboard user must land inside it and get their place back after.
  useEffect(() => {
    returnTo.current = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && onCancel) {
        onCancel();
        return;
      }
      if (e.key !== 'Tab') return;
      const card = cardRef.current;
      if (!card) return;
      const items = Array.from(card.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null,
      );
      if (!items.length) {
        e.preventDefault();
        card.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === card)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    const card = cardRef.current;
    if (card && !card.contains(document.activeElement)) card.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      returnTo.current?.focus?.();
    };
  }, [onCancel]);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--scrim)',
        display: 'grid',
        placeItems: 'center',
        padding: 20,
        zIndex: 'var(--z-overlay)',
        pointerEvents: 'auto',
      }}
    >
      <div
        ref={cardRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="loading-overlay-title"
        aria-busy="true"
        style={{
          width: 'min(520px, 92vw)',
          background: 'var(--paper)',
          border: '1px solid var(--hairline)',
          borderRadius: 'var(--r-card)',
          padding: 28,
          boxShadow: 'var(--shadow-lift)',
          position: 'relative',
          overflow: 'hidden',
          outline: 'none',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            flexWrap: 'wrap',
            rowGap: 8,
            marginBottom: 16,
          }}
        >
          {/* The pulse lives on this span, not on Dot: styled-jsx can only scope
              a class onto elements this component renders itself. The animation
              used to be an inline `animation: pulse …` referring to a hashed
              keyframe name, so it never ran at all. */}
          <span className="lo-pulse" style={{ display: 'inline-flex' }} aria-hidden="true">
            <Dot color="var(--accent)" size={7} />
          </span>
          {/* Hidden from the live region: the dialog's title already names the work. */}
          <span
            aria-hidden="true"
            style={{ fontSize: 'var(--fs-small)', letterSpacing: '0.01em', color: 'var(--accent-text)', fontWeight: 700 }}
          >
            Working…
          </span>
          <div style={{ flex: 1, minWidth: 0 }} />
          {onCancel && (
            <button
              onClick={onCancel}
              className="ds-btn ds-btn--sm"
              style={{ padding: '0 12px' }}
            >
              <Icon name="x" size={12} />
              {cancelLabel}
            </button>
          )}
        </div>

        {art}

        <h2
          id="loading-overlay-title"
          style={{ fontSize: 'var(--fs-title)', fontWeight: 600, marginBottom: 8, letterSpacing: '-0.015em' }}
        >
          {title}
        </h2>

        {/* One polite live region for the parts that actually change meaning. */}
        <div role="status" aria-live="polite">
          {description && (
            <p className="t-small" style={{ lineHeight: 1.55, margin: '0 0 12px' }}>
              {description}
            </p>
          )}
          {slow && onCancel && (
            <p className="t-small" style={{ lineHeight: 1.55, margin: '0 0 12px' }}>
              Still working. You can stop without losing anything.
            </p>
          )}
        </div>

        {note && (
          <p
            className="t-small"
            style={{
              lineHeight: 1.5,
              background: 'var(--paper-2)',
              border: '1px solid var(--hairline)',
              borderRadius: 'var(--r-2)',
              padding: '9px 11px',
              margin: '0 0 14px',
            }}
          >
            {note}
          </p>
        )}

        {pct !== null && (
          <div>
            <div
              style={{
                height: 4,
                background: 'var(--paper-3)',
                borderRadius: 'var(--r-full)',
                position: 'relative',
                marginBottom: 6,
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  bottom: 0,
                  width: '100%',
                  transform: `scaleX(${Math.max(0, Math.min(1, pct / 100))})`,
                  transformOrigin: 'left',
                  background: 'var(--accent)',
                  borderRadius: 'var(--r-full)',
                  transition: 'transform var(--dur-slow) var(--ease-out)',
                }}
              />
              {/* moving scan dot */}
              <div
                style={{
                  position: 'absolute',
                  left: `${(t * 1.5) % 100}%`,
                  top: -2,
                  width: 8,
                  height: 8,
                  background: 'var(--accent)',
                  borderRadius: '50%',
                  opacity: 0.5,
                }}
              />
            </div>
            <div
              className="mono"
              style={{ fontSize: 'var(--fs-micro)', color: 'var(--ink-3)', letterSpacing: '0.08em', display: 'flex', justifyContent: 'space-between' }}
            >
              <span>
                Step {step} of {totalSteps}
              </span>
              <span>{Math.round(pct)}%</span>
            </div>
          </div>
        )}
      </div>

      {/* Kept in styled-jsx but driven by classes on elements this component
          renders, so the hashed keyframe names actually resolve. The global
          prefers-reduced-motion block in globals.css governs it. */}
      <style jsx>{`
        .lo-pulse {
          animation: lo-pulse 1.4s ease-in-out infinite;
        }
        @keyframes lo-pulse {
          0%,
          100% {
            opacity: 1;
            transform: scale(1);
          }
          50% {
            opacity: 0.4;
            transform: scale(0.8);
          }
        }
      `}</style>
    </div>
  );
}

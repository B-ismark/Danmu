'use client';

// Blocking progress overlay for long async work: a calm card over a scrim with
// rotating flavour text. Three things here are contracts, not decoration.
//
// 1. `local` — the tip rotation used to include "Your photos and designs stay on
//    your device" unconditionally, while this same overlay was mounted over an
//    upload of the user's room photos. A privacy promise can only be shown when
//    the caller states the work really is on-device, so the tip now lives behind
//    this flag and `note` carries the truth for the other case.
// 2. It blocks the whole page, so it behaves like a dialog: focus moves in, Tab
//    stays in, Esc cancels when the caller can cancel. Without `onCancel` the
//    only way out of a slow operation is a hard reload.
// 3. No duration claims. We don't know how long a download or a round-trip
//    takes, so the copy never says "a moment" or "10-20 seconds".

import { useEffect, useRef, useState } from 'react';
import { Dot } from './primitives';
import { Icon } from './Icon';

// Studio tips — true wherever the work is happening.
const TIPS = [
  'Lock a piece and Danmu keeps it exactly as it is.',
  'Right-click and drag any piece to spin it around.',
  'Recolour anything in the inspector — the room updates live.',
  'Try the material swatches to switch wood, fabric, or metal finishes.',
  'Press W / R / S to Move, Rotate, or Scale the selected piece.',
  'One-tap a style theme to redecorate the whole room at once.',
  'Toggle day or evening light to see your room in a different mood.',
  'Drag new furniture in from the Library to fill out the space.',
];

// Only ever added to the rotation when the caller passes `local` — see note 1.
const ON_DEVICE_TIP = 'Your photos and designs stay on your device.';

const HUDS = [
  'Tidying up',
  'Fluffing cushions',
  'Opening the curtains',
  'Adjusting the light',
  'Styling the shelves',
  'Setting the mood',
  'Almost ready',
];

// Flavour text rotates slower than reading speed. The old 700ms HUD cadence
// read as a flicker, not as progress.
const HUD_MS = 3400;
const TIP_MS = 6000;
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
  local = false,
  onCancel,
  cancelLabel = 'Stop',
}: {
  title: string;
  step?: number;
  totalSteps?: number;
  description?: string;
  /** One honest line about what this operation does — e.g. that it uploads. */
  note?: string;
  /** True ONLY when the wrapped work runs entirely on the user's device. */
  local?: boolean;
  /** Strongly recommended: without it this overlay has no exit. */
  onCancel?: () => void;
  cancelLabel?: string;
}) {
  const pct = step !== undefined && totalSteps ? Math.min(100, (step / totalSteps) * 100) : null;
  const hasBar = pct !== null;
  const tips = local ? [...TIPS, ON_DEVICE_TIP] : TIPS;
  const [tipIdx, setTipIdx] = useState(() => Math.floor(Math.random() * TIPS.length));
  const [hudIdx, setHudIdx] = useState(0);
  const [t, setT] = useState(0);
  const [slow, setSlow] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    // CSS handles declarative animation under prefers-reduced-motion; a JS
    // ticker has to opt out for itself. Tips keep rotating (they're content);
    // the HUD phrases and the scan dot are pure movement, so they stop.
    const still =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

    const timers: ReturnType<typeof setInterval>[] = [];
    timers.push(setInterval(() => setTipIdx((i) => i + 1), TIP_MS));
    if (!still) timers.push(setInterval(() => setHudIdx((i) => (i + 1) % HUDS.length), HUD_MS));
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
          {/* Decorative flavour: hidden from the live region so a screen reader
              isn't read a new word every few seconds. */}
          <span
            aria-hidden="true"
            style={{ fontSize: 12, letterSpacing: '0.01em', color: 'var(--accent-text)', fontWeight: 700 }}
          >
            {HUDS[hudIdx]}…
          </span>
          <div style={{ flex: 1, minWidth: 0 }} />
          {onCancel && (
            <button
              onClick={onCancel}
              className="ds-btn"
              style={{ height: 30, fontSize: 12, padding: '0 12px' }}
            >
              <Icon name="x" size={12} />
              {cancelLabel}
            </button>
          )}
        </div>

        <h2
          id="loading-overlay-title"
          style={{ fontSize: 22, fontWeight: 600, marginBottom: 8, letterSpacing: '-0.015em' }}
        >
          {title}
        </h2>

        {/* One polite live region for the parts that actually change meaning. */}
        <div role="status" aria-live="polite">
          {description && (
            <p style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.55, margin: '0 0 12px' }}>
              {description}
            </p>
          )}
          {slow && onCancel && (
            <p style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.55, margin: '0 0 12px' }}>
              Still going. You can stop whenever you like — nothing you&rsquo;ve done is lost.
            </p>
          )}
        </div>

        {note && (
          <p
            style={{
              fontSize: 12,
              color: 'var(--ink-2)',
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
                  transition: 'transform 0.3s',
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
              style={{ fontSize: 10, color: 'var(--ink-3)', letterSpacing: '0.08em', display: 'flex', justifyContent: 'space-between' }}
            >
              <span>
                Step {step} of {totalSteps}
              </span>
              <span>{Math.round(pct)}%</span>
            </div>
          </div>
        )}

        {/* rotating tip */}
        <div
          style={{
            marginTop: 22,
            paddingTop: 14,
            borderTop: '1px solid var(--hairline)',
            minHeight: 48,
          }}
        >
          <div className="ds-label" style={{ marginBottom: 6 }}>
            Tip
          </div>
          <div key={tipIdx} className="lo-tip" style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.5 }}>
            {tips[tipIdx % tips.length]}
          </div>
        </div>
      </div>

      {/* Kept in styled-jsx but driven by classes on elements this component
          renders, so the hashed keyframe names actually resolve. The global
          prefers-reduced-motion block in globals.css governs both. */}
      <style jsx>{`
        .lo-pulse {
          animation: lo-pulse 1.4s ease-in-out infinite;
        }
        .lo-tip {
          animation: lo-tip-fade 0.4s ease-out;
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
        @keyframes lo-tip-fade {
          from {
            opacity: 0;
            transform: translateY(4px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </div>
  );
}

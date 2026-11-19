'use client';

// Blocking progress card for long async work: a calm card over a scrim. Four things
// here are contracts, not decoration.
//
// 1. It says WHAT is happening, visibly. The card used to hide its title for screen
//    readers only and show a pulsing "Working…" beside the Stop button, so a person
//    saw a picture and the word "working" and had to guess which step they were on —
//    and on the scan screen a download question sat under it, unanswerable. The
//    title names the step ("Getting the furniture finder", "Finding your
//    furniture"), the description says how far it has got.
// 2. No rotating tips and no flavour lines. The caller's `description` and `note` are
//    the only copy; where the work happens is said by the screen that started it.
// 3. It blocks the whole page, so it behaves like a dialog: focus moves in, Tab
//    stays in, Esc cancels when the caller can cancel. Without `onCancel` the
//    only way out of a slow operation is a hard reload.
// 4. No duration claims. We don't know how long a download or a round-trip
//    takes, so the copy never says "a moment" or "10-20 seconds". A bar is shown
//    only when the work is countable (`progress`), and it shows the real fraction.

import { useEffect, useRef, type ReactNode } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function LoadingOverlay({
  title,
  description,
  progress,
  note,
  onCancel,
  cancelLabel = 'Stop',
  actions,
  art,
}: {
  title: string;
  /** One line under the title about how far it has got. Read out politely. */
  description?: string;
  /** A determinate bar, 0–1, for work that can be counted (a download). */
  progress?: number;
  /** One line about what this operation does, e.g. that it uploads. */
  note?: string;
  /** Strongly recommended: without it this overlay has no exit. */
  onCancel?: () => void;
  cancelLabel?: string;
  /** In place of the Stop button, when the card is asking rather than working: the
   *  question's own answers. The card is then not busy. */
  actions?: ReactNode;
  /** A picture to wait with, above the title. Decoration: it must be `aria-hidden`
   *  itself and say nothing the title does not. */
  art?: ReactNode;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  const asking = actions != null;

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

  const pct = progress == null ? null : Math.max(0, Math.min(1, progress));
  return (
    <div className="lo-scrim">
      <div
        ref={cardRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="loading-overlay-title"
        aria-busy={!asking}
        className="lo-card"
      >
        {/* The step first, then how far it has got, then the picture: what a person
            looks at the card to find out is what it is doing. */}
        <h2 id="loading-overlay-title" className="lo-card__title">
          {title}
        </h2>
        {/* One polite live region for the parts that actually change meaning. */}
        <div role="status" aria-live="polite" className="lo-card__status">
          {description && <p className="lo-card__desc">{description}</p>}
        </div>
        {art}
        {pct !== null && (
          <div
            className="lo-card__bar"
            role="progressbar"
            aria-label={title}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(pct * 100)}
          >
            <span style={{ transform: `scaleX(${pct})` }} />
          </div>
        )}
        {note && <p className="lo-card__note">{note}</p>}
        <div className="lo-card__actions">
          {asking
            ? actions
            : onCancel && (
                <button onClick={onCancel} className="ds-btn ds-btn--sm ds-btn--ghost">
                  {cancelLabel}
                </button>
              )}
        </div>
      </div>
    </div>
  );
}

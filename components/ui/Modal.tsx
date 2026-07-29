'use client';

import { useEffect, useRef, type ReactNode } from 'react';

// One modal shell for the whole app. Owns the scrim, the card, click-outside
// and Esc-to-close, focus-on-open, and the dialog a11y roles — so every modal
// (Confirm, Add furniture, Swap model, Regenerate…) stays identical and
// accessible instead of re-implementing the same overlay five times.
export function Modal({
  onClose,
  labelledBy,
  width = 440,
  zIndex = 'var(--z-modal)' as number | string,
  blur = false,
  closeOnBackdrop = true,
  bodyPadding = '20px 24px',
  footer,
  children,
}: {
  onClose: () => void;
  /** id of the title element, for aria-labelledby */
  labelledBy?: string;
  width?: number;
  /** accepts a --z-* token string; defaults to the modal layer */
  zIndex?: number | string;
  blur?: boolean;
  closeOnBackdrop?: boolean;
  bodyPadding?: string;
  /** optional actions rendered in the tinted footer bar */
  footer?: ReactNode;
  children: ReactNode;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  // Whatever had focus before the dialog opened, so it can be given back on
  // close. Without this, dismissing a modal drops focus to the top of the
  // document and a keyboard user loses their place entirely.
  const returnTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    returnTo.current = document.activeElement as HTMLElement | null;

    const FOCUSABLE =
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      // Trap Tab inside the dialog. A modal the keyboard can walk out of is
      // still showing its scrim over content the user is now editing blind.
      if (e.key !== 'Tab') return;
      const card = cardRef.current;
      if (!card) return;
      const items = Array.from(card.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null || el === card,
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
    // Move focus into the dialog so Esc/Tab land here — but DON'T steal it from
    // an autoFocus'd field already inside the modal (a search box / textarea).
    // React applies child autoFocus at commit, before this passive effect runs,
    // so at this point activeElement is already that field when one exists.
    const card = cardRef.current;
    if (card && !card.contains(document.activeElement)) card.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      returnTo.current?.focus?.();
    };
  }, [onClose]);

  return (
    <div
      onClick={closeOnBackdrop ? onClose : undefined}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--scrim)',
        display: 'grid',
        placeItems: 'center',
        zIndex,
        padding: 20,
        ...(blur ? { backdropFilter: 'blur(2px)' } : null),
      }}
    >
      <div
        ref={cardRef}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        style={{
          width: `min(${width}px, 92vw)`,
          background: 'var(--paper)',
          border: '1px solid var(--hairline)',
          borderRadius: 'var(--r-card)',
          boxShadow: 'var(--shadow-lift)',
          overflow: 'hidden',
          outline: 'none',
        }}
      >
        <div style={{ padding: bodyPadding }}>{children}</div>
        {footer && (
          <div
            style={{
              padding: '14px 24px',
              background: 'var(--paper-2)',
              borderTop: '1px solid var(--hairline)',
              display: 'flex',
              gap: 8,
            }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

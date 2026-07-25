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
  zIndex = 100,
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
  zIndex?: number;
  blur?: boolean;
  closeOnBackdrop?: boolean;
  bodyPadding?: string;
  /** optional actions rendered in the tinted footer bar */
  footer?: ReactNode;
  children: ReactNode;
}) {
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    // Move focus into the dialog so Esc/Tab land here, not on the page behind.
    cardRef.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
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

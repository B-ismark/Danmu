'use client';

// Route-segment error boundary. Without this (and global-error below) Next's
// dev overlay throws "missing required error components" on any runtime crash.
import { useEffect } from 'react';

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // The console is where the stack and digest belong. This screen is read by
    // someone rearranging a sofa, not by whoever wrote the component — printing
    // `error.message` at them named a problem they cannot act on and hid the two
    // actions that actually recover.
    console.error(error);
  }, [error]);

  return (
    <div style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 40 }}>
      <div
        style={{
          maxWidth: 'var(--measure-card)',
          width: '100%',
          border: '1px solid var(--hairline-strong)',
          background: 'var(--paper)',
          // Softness is the whole premise of this design system; the one card
          // that appears when things go wrong should not be the sharp one.
          borderRadius: 'var(--r-card)',
          overflow: 'hidden',
        }}
      >
        <div style={{ height: 4, background: 'var(--danger)' }} />
        <div style={{ padding: '22px 24px' }}>
          <div className="ds-kicker" style={{ color: 'var(--danger-text)', marginBottom: 6 }}>Hiccup</div>
          <h1 style={{ fontSize: 'var(--fs-title)', marginBottom: 8 }}>This screen stopped drawing</h1>
          <p className="t-body" style={{ lineHeight: 1.55, margin: 0 }}>
            Your rooms are saved in this browser. If Try again does not help, go back to your rooms and
            reopen this one.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, padding: '14px 24px', background: 'var(--paper-2)', borderTop: '1px solid var(--hairline)' }}>
          {/* '/' is the rooms page — the first screen, with or without rooms. */}
          <button className="ds-btn ds-btn--lg" style={{ flex: 1, justifyContent: 'center' }} onClick={() => (window.location.href = '/')}>
            Back to your rooms
          </button>
          <button className="ds-btn ds-btn--lg ds-btn--primary" style={{ flex: 1, justifyContent: 'center' }} onClick={() => reset()}>
            Try again
          </button>
        </div>
      </div>
    </div>
  );
}

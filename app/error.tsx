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
          maxWidth: 480,
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
          <h1 style={{ fontSize: 22, marginBottom: 8 }}>This screen stopped drawing</h1>
          <p style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.55, margin: 0 }}>
            Your rooms are safe — they live in this browser, not on this screen. Try again to redraw
            it. If it keeps happening, go back to your rooms and reopen the one you were working on.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, padding: '14px 24px', background: 'var(--paper-2)', borderTop: '1px solid var(--hairline)' }}>
          {/* '/' rather than '/workspace': the root router already sends you to
              your rooms, or to onboarding if you have none. */}
          <button className="ds-btn" style={{ height: 40, fontSize: 13, flex: 1, justifyContent: 'center' }} onClick={() => (window.location.href = '/')}>
            Back to your rooms
          </button>
          <button className="ds-btn ds-btn--primary" style={{ height: 40, fontSize: 13, flex: 1, justifyContent: 'center' }} onClick={() => reset()}>
            Try again
          </button>
        </div>
      </div>
    </div>
  );
}

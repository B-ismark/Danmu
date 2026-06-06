'use client';

// Route-segment error boundary. Without this (and global-error below) Next's
// dev overlay throws "missing required error components" on any runtime crash.
import { useEffect } from 'react';

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Surface to the console so the real stack is recoverable in dev.
    console.error(error);
  }, [error]);

  return (
    <div style={{ height: '100vh', display: 'grid', placeItems: 'center', padding: 40 }}>
      <div style={{ maxWidth: 480, width: '100%', border: '1px solid var(--hairline-strong)', background: 'var(--paper)' }}>
        <div style={{ height: 4, background: 'var(--danger)' }} />
        <div style={{ padding: '22px 24px' }}>
          <div className="ds-kicker" style={{ color: 'var(--danger)', marginBottom: 6 }}>Something broke</div>
          <div style={{ fontSize: 22, fontWeight: 600, marginBottom: 8 }}>This screen hit an error</div>
          <p style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5 }}>
            {error.message || 'Unexpected runtime error.'}
            {error.digest ? ` (ref ${error.digest})` : ''}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, padding: '14px 24px', background: 'var(--paper-2)', borderTop: '1px solid var(--hairline)' }}>
          <button className="ds-btn" style={{ height: 32, fontSize: 12, flex: 1, justifyContent: 'center' }} onClick={() => (window.location.href = '/')}>
            Go home
          </button>
          <button className="ds-btn ds-btn--primary" style={{ height: 32, fontSize: 12, flex: 1, justifyContent: 'center' }} onClick={() => reset()}>
            Try again
          </button>
        </div>
      </div>
    </div>
  );
}

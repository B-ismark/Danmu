'use client';

// Root error boundary — catches crashes in the root layout itself. Must render
// its own <html>/<body>. Next requires this to exist for the production error UI.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif', background: '#FAFAF7', color: '#2A2520' }}>
        <div style={{ height: '100vh', display: 'grid', placeItems: 'center', padding: 40 }}>
          <div style={{ maxWidth: 440, textAlign: 'center' }}>
            <div style={{ fontSize: 13, letterSpacing: '0.04em', color: '#C02618', marginBottom: 8 }}>Application error</div>
            <h1 style={{ fontSize: 24, margin: '0 0 12px' }}>Danmu crashed on load</h1>
            <p style={{ fontSize: 14, lineHeight: 1.5, color: '#6B6358', marginBottom: 20 }}>
              {error.message || 'Unexpected error in the root layout.'}
            </p>
            <button
              onClick={() => reset()}
              style={{ padding: '10px 20px', borderRadius: 10, border: 'none', background: '#E2613A', color: '#fff', fontSize: 14, cursor: 'pointer' }}
            >
              Reload
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}

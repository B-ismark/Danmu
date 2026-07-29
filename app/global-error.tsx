'use client';

// Root error boundary — catches crashes in the root layout itself. Must render
// its own <html>/<body>. Next requires this to exist for the production error UI.
//
// The palette below is hard-coded ON PURPOSE and is the one place in the app
// where that is correct: this component *replaces* the root layout, so
// globals.css (and therefore every --token) may never have loaded. The literals
// must be kept in sync with app/globals.css by hand — they had already drifted
// once (#FAFAF7 / #6B6358 / #C02618 were from an earlier palette).
import { useEffect } from 'react';

const PAPER = '#FBF8F2'; // --paper
const INK = '#2A2520'; // --ink
const INK_2 = '#5A5147'; // --ink-2
const DANGER = '#C8472A'; // --danger
const ACCENT_INK = '#C24A22'; // --accent-ink — 4.73:1 with white

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  // Same rule as the route-level boundary: the stack goes to the console, the
  // screen gets plain language and a way out.
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif', background: PAPER, color: INK }}>
        <div style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 40 }}>
          <div style={{ maxWidth: 440, textAlign: 'center' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: DANGER, marginBottom: 8 }}>Hiccup</div>
            <h1 style={{ fontSize: 24, margin: '0 0 12px' }}>Danmu didn’t finish loading</h1>
            <p style={{ fontSize: 14, lineHeight: 1.55, color: INK_2, marginBottom: 20 }}>
              Nothing was lost — your rooms are saved in this browser. Reload to start it up again.
            </p>
            <button
              onClick={() => reset()}
              style={{ padding: '12px 22px', borderRadius: 16, border: 'none', background: ACCENT_INK, color: '#FFFFFF', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}
            >
              Reload Danmu
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}

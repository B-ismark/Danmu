'use client';

// Studio is desktop-first (1280+). On narrower viewports show a polite gate
// instead of letting users wrestle with collapsed panels.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Icon } from '@/components/ui/Icon';
import { DanmuMark } from '@/components/ui/primitives';

const MIN_WIDTH = 1024;

export function NarrowViewportBanner() {
  const [narrow, setNarrow] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${MIN_WIDTH - 1}px)`);
    const update = () => setNarrow(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  if (!narrow || dismissed) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--paper)',
        zIndex: 90,
        display: 'flex',
        flexDirection: 'column',
        padding: 24,
        overflow: 'auto',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingBottom: 24, borderBottom: '1px solid var(--hairline)' }}>
        <DanmuMark size={12} />
        <span className="ds-label">Studio · Desktop</span>
      </div>
      <div style={{ flex: 1, display: 'grid', placeItems: 'center', padding: '40px 0', maxWidth: 460, margin: '0 auto', textAlign: 'center' }}>
        <div>
          <div className="ds-kicker" style={{ fontSize: 10, marginBottom: 12 }}>
            Needs a wider viewport
          </div>
          <div style={{ fontSize: 32, fontWeight: 600, letterSpacing: '-0.02em', marginBottom: 12 }}>
            Studio runs on desktop.
          </div>
          <p style={{ fontSize: 14, color: 'var(--ink-2)', lineHeight: 1.55, marginBottom: 24 }}>
            The 3D viewer, parts tree and inspector need at least <b>{MIN_WIDTH}px</b> to be usable. Open Danmu on a
            laptop or external monitor.
          </p>
          <p style={{ fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.55, marginBottom: 28 }}>
            Capture is mobile-friendly — you can shoot photos here, then continue editing on a larger screen.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Link href="/onboarding/capture" className="ds-btn ds-btn--primary" style={{ height: 44, justifyContent: 'center', fontSize: 14 }}>
              <Icon name="camera" size={14} />
              Continue capture on this device
            </Link>
            <Link href="/workspace" className="ds-btn" style={{ height: 40, justifyContent: 'center', fontSize: 13 }}>
              <Icon name="arrow-left" size={12} /> Back to rooms
            </Link>
            <button
              onClick={() => setDismissed(true)}
              className="ds-btn ds-btn--ghost"
              style={{ height: 32, justifyContent: 'center', fontSize: 11, color: 'var(--ink-3)' }}
            >
              Continue anyway · UI may break
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

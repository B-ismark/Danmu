'use client';

// Banner shown when the loaded scene came from the default catalog (no detections
// run for this room). Encourages user to capture photos for a real layout.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { roomStore } from '@/lib/storage';
import { Icon } from '@/components/ui/Icon';

export function DemoBanner() {
  const { roomId } = useParams<{ roomId: string }>();
  const [demo, setDemo] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!roomId) return;
    (async () => {
      const room = await roomStore.loadRoom(roomId);
      const caps = await roomStore.loadCaptures(roomId);
      const hasDetections = !!(room?.detectedObjects && room.detectedObjects.length > 0);
      const hasCaptures = caps.length > 0;
      setDemo(!hasDetections && !hasCaptures);
    })();
  }, [roomId]);

  if (!demo || dismissed) return null;

  return (
    <div
      style={{
        position: 'absolute',
        top: 12,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 25,
        // Cap to the viewport so the pill never clips its dismiss button off the
        // edge on a narrow studio pane; content wraps instead of overflowing.
        maxWidth: 'min(560px, calc(100vw - 32px))',
        background: 'var(--accent)',
        color: '#fff',
        padding: '10px 14px 10px 16px',
        borderRadius: 'var(--r-2)',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        fontFamily: 'var(--font-sans)',
        fontSize: 13,
        fontWeight: 500,
        lineHeight: 1.35,
        boxShadow: 'var(--shadow-lift)',
      }}
    >
      <Icon name="camera" size={15} color="#fff" style={{ flexShrink: 0 }} />
      <span style={{ minWidth: 0 }}>
        Sample room — capture your walls for an accurate layout.{' '}
        <Link
          href="/onboarding/capture"
          style={{
            fontWeight: 700,
            color: '#fff',
            textDecoration: 'underline',
            textUnderlineOffset: 3,
            whiteSpace: 'nowrap',
          }}
        >
          Capture now →
        </Link>
      </span>
      <button
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
        style={{ flexShrink: 0, display: 'flex', background: 'transparent', border: 'none', color: '#fff', cursor: 'pointer', padding: 2, opacity: 0.8 }}
      >
        <Icon name="x" size={13} color="#fff" />
      </button>
    </div>
  );
}

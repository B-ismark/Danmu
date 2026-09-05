'use client';

// Shown when the room the studio loaded is the starter scene — no photos taken,
// nothing detected. Two things changed here:
//
//  1. It is a strip in the room layout, not a floating pill over the canvas. It
//     used to be centred at the top of the 3D viewport at ~560px wide, which put
//     it directly on top of the Move / Scale / Rotate / Snap toolbar at top-left
//     — so the one session where the banner appears was the one session where
//     the primary toolbar could not be clicked.
//  2. The copy is an invitation, not a shortfall. This is the first sentence the
//     product says to a new user, and "Sample room — capture your walls for an
//     accurate layout" told them what they had not done yet. The room is theirs;
//     the useful next move is to drag something in it.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { roomStore } from '@/lib/storage';
import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/primitives';

export function DemoBanner() {
  const { roomId } = useParams<{ roomId: string }>();
  const [demo, setDemo] = useState(false);
  // Start hidden until storage is checked, so a previously-dismissed banner
  // never flashes on mount.
  const [dismissed, setDismissed] = useState(true);

  const storageKey = roomId ? `danmu-demo-dismissed-${roomId}` : '';

  useEffect(() => {
    if (!roomId) return;
    setDismissed(localStorage.getItem(`danmu-demo-dismissed-${roomId}`) === '1');
    (async () => {
      const room = await roomStore.loadRoom(roomId);
      const caps = await roomStore.loadCaptures(roomId);
      const hasDetections = !!(room?.detectedObjects && room.detectedObjects.length > 0);
      const hasCaptures = caps.length > 0;
      setDemo(!hasDetections && !hasCaptures);
    })();
  }, [roomId]);

  // Persist the dismissal so it stays gone across tab switches and reloads.
  function dismiss() {
    setDismissed(true);
    if (storageKey) localStorage.setItem(storageKey, '1');
  }

  if (!demo || dismissed) return null;

  return (
    <div
      role="region"
      aria-label="Getting started"
      style={{
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '4px 12px',
        padding: '9px 16px',
        // A tint, not the flat accent: white on --accent is 3.0:1, and --accent
        // is a fill token. --accent-text on --accent-tint measures 4.85:1.
        background: 'var(--accent-tint)',
        borderBottom: '1px solid var(--hairline)',
        color: 'var(--accent-text)',
        fontFamily: 'var(--font-sans)',
        fontSize: 13,
        fontWeight: 600,
        lineHeight: 1.4,
      }}
    >
      <Icon name="sparkles" size={15} style={{ flexShrink: 0 }} />
      <span style={{ minWidth: 0, flex: 1 }}>
        This room is yours to rearrange — drag a piece to move it, click a wall to paint it.{' '}
        <Link
          href="/onboarding/capture"
          style={{
            fontWeight: 700,
            color: 'var(--accent-text)',
            textDecoration: 'underline',
            textUnderlineOffset: 3,
          }}
        >
          Rather use your own room? Photograph it
        </Link>
      </span>
      <IconButton
        icon="x"
        label="Hide the getting-started tip"
        onClick={dismiss}
        size={26}
        iconSize={13}
        style={{ color: 'var(--accent-text)', flexShrink: 0 }}
      />
    </div>
  );
}

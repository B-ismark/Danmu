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
        // NO `marginBottom`, and the absence is a decision rather than an omission.
        // A pass added `marginBottom: 8` with the reason "push the toolbar down so
        // the banner does not overlap it at narrow widths", and that overlap cannot
        // happen: this is a `flexShrink: 0` child in the document flow of the column
        // in `app/room/[roomId]/layout.tsx`, and the canvas toolbars are
        // `position: absolute` INSIDE the canvas, which begins below this strip —
        // §1 of this file's header and the JSX comment above say so, and that is the
        // whole reason the old floating pill was replaced by a strip. What the margin
        // did do is detach the `borderBottom` below from what it divides: tint, then
        // a hairline, then 8px of bare `--paper`, which is the exact relationship
        // `globals.css` records three separate user reports of being read as a stray
        // horizontal scrollbar. It also cost 8px of canvas in the one session this
        // banner appears. Reverted 2026-09-05; do not re-add it without a width at
        // which the overlap has actually been seen.
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

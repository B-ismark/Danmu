'use client';

// Top-bar chrome for secondary pages that aren't part of the main studio layout
// (compare, render, spec, share). Always offers a back-to-studio + room switcher.

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { DanmuMark } from '@/components/ui/primitives';
import { roomStore, type RoomData } from '@/lib/storage';
import { Icon } from '@/components/ui/Icon';

export function SecondaryNav({
  eyebrow,
  title,
  rightSlot,
}: {
  eyebrow: string;
  title?: string;
  rightSlot?: React.ReactNode;
}) {
  const { roomId } = useParams<{ roomId: string }>();
  const [room, setRoom] = useState<RoomData | null>(null);

  useEffect(() => {
    if (!roomId) return;
    roomStore.loadRoom(roomId).then((r) => setRoom(r ?? null));
  }, [roomId]);

  return (
    <div
      style={{
        height: 56,
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '0 20px',
        borderBottom: '1px solid var(--hairline)',
        background: 'var(--paper)',
        flexShrink: 0,
      }}
    >
      <Link href="/workspace" style={{ display: 'flex', alignItems: 'center' }} aria-label="Workspace">
        <DanmuMark size={12} />
      </Link>
      <div style={{ width: 1, height: 18, background: 'var(--hairline)' }} />
      <Link
        href={`/room/${roomId}/model`}
        className="ds-btn ds-btn--ghost"
        style={{ height: 28, padding: '0 8px', fontSize: 12 }}
      >
        <Icon name="arrow-left" size={12} />
        Studio
      </Link>
      <div style={{ width: 1, height: 18, background: 'var(--hairline)' }} />
      <span className="ds-label">{eyebrow}</span>
      {room && (
        <>
          <span style={{ fontSize: 13, fontWeight: 500 }}>{room.name}</span>
          {title && (
            <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>
              · {title}
            </span>
          )}
        </>
      )}
      <div style={{ flex: 1 }} />
      {rightSlot}
    </div>
  );
}

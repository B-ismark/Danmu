'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { DanmuMark, EditableText } from '@/components/ui/primitives';
import { toast } from '@/components/ui/StorageToast';
import { roomStore } from '@/lib/storage';
import type { ReactNode } from 'react';

export function TopBar({
  right,
  centerSlot,
}: {
  roomName?: string;
  right?: ReactNode;
  centerSlot?: ReactNode;
}) {
  const { roomId } = useParams<{ roomId: string }>();
  const [name, setName] = useState('Living Room');
  const [savedHint, setSavedHint] = useState(false);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!roomId) return;
    roomStore.loadRoom(roomId).then((r) => {
      if (r) setName(r.name);
    });
  }, [roomId]);

  useEffect(() => () => {
    if (hintTimer.current) clearTimeout(hintTimer.current);
  }, []);

  async function commitName(next: string) {
    const trimmed = next.trim();
    if (!trimmed || !roomId) return;
    setName(trimmed);
    const r = await roomStore.loadRoom(roomId);
    if (r) {
      await roomStore.saveRoom({ ...r, name: trimmed });
      flashSaved();
    }
  }

  function flashSaved() {
    setSavedHint(true);
    if (hintTimer.current) clearTimeout(hintTimer.current);
    hintTimer.current = setTimeout(() => setSavedHint(false), 1800);
  }

  return (
    <div
      style={{
        height: 48,
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '0 16px',
        borderBottom: '1px solid var(--hairline)',
        background: 'var(--paper)',
        flexShrink: 0,
      }}
    >
      <Link href="/workspace" style={{ display: 'flex' }}>
        <DanmuMark size={12} />
      </Link>
      <div style={{ width: 1, height: 18, background: 'var(--hairline)' }} />
      <span className="ds-label">Project</span>
      {/* Renaming is a real control now: reachable by keyboard, announced, and
          it reverts a blank name instead of appearing to ignore it. */}
      <EditableText
        value={name}
        label="Room name"
        onCommit={commitName}
        onReject={() =>
          toast({ title: 'Room kept its name', message: 'A room needs a name, so the old one stayed.' })
        }
        style={{ fontSize: 13, fontWeight: 500 }}
        inputStyle={{ fontSize: 13, fontWeight: 500, height: 28, minWidth: 200, maxWidth: 280 }}
      />
      {/* Save state says a word. A bare 6px dot claimed something it could not
          explain — and it is announced, because a silent colour change is not
          feedback for anyone using a screen reader. */}
      <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11 }}>
        <span
          aria-hidden="true"
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: savedHint ? 'var(--success)' : 'var(--ink-3)',
            opacity: savedHint ? 1 : 0.5,
            transition: 'background 0.2s, opacity 0.2s',
            flexShrink: 0,
          }}
        />
        <span style={{ color: savedHint ? 'var(--success-text)' : 'var(--ink-3)', fontWeight: 600, whiteSpace: 'nowrap' }}>
          {savedHint ? 'Saved' : 'Saves as you go'}
        </span>
      </span>
      <span className="sr-only" role="status" aria-live="polite">
        {savedHint ? 'Room saved' : ''}
      </span>
      {centerSlot}
      <div style={{ flex: 1 }} />
      {right}
    </div>
  );
}

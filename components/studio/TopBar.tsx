'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { DanmuMark } from '@/components/ui/primitives';
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
  const [editing, setEditing] = useState(false);
  const [savedHint, setSavedHint] = useState(false);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!roomId) return;
    roomStore.loadRoom(roomId).then((r) => {
      if (r) setName(r.name);
    });
  }, [roomId]);

  async function commitName(next: string) {
    setEditing(false);
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
      {editing ? (
        <input
          autoFocus
          defaultValue={name}
          onBlur={(e) => commitName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') setEditing(false);
          }}
          style={{
            fontSize: 13,
            fontWeight: 500,
            padding: '2px 6px',
            border: '1px solid var(--accent)',
            borderRadius: 2,
            background: 'var(--paper)',
            color: 'var(--ink)',
            outline: 'none',
            fontFamily: 'var(--font-sans)',
            minWidth: 200,
          }}
        />
      ) : (
        <span
          onClick={() => setEditing(true)}
          title="Click to rename"
          style={{
            fontSize: 13,
            fontWeight: 500,
            padding: '2px 6px',
            cursor: 'text',
            borderRadius: 2,
          }}
        >
          {name}
        </span>
      )}
      <span
        title={savedHint ? 'Saved' : 'Auto-saving on'}
        style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11 }}
      >
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: savedHint ? 'var(--success)' : 'var(--ink-3)',
            opacity: savedHint ? 1 : 0.5,
            transition: 'background 0.2s, opacity 0.2s',
          }}
        />
        {savedHint && <span style={{ color: 'var(--success)' }}>Saved</span>}
      </span>
      {centerSlot}
      <div style={{ flex: 1 }} />
      {right}
    </div>
  );
}

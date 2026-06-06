'use client';

// Dropdown that lists all saved rooms; lets user jump between them without
// returning to /workspace. Lives in the studio TopBar.

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { roomStore, type RoomSummary } from '@/lib/storage';
import { useRoom } from '@/lib/store';
import { Icon } from '@/components/ui/Icon';

export function RoomSwitcher() {
  const router = useRouter();
  const { roomId: currentId } = useParams<{ roomId: string }>();
  const setRoomId = useRoom((s) => s.setRoomId);
  const [open, setOpen] = useState(false);
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    roomStore.listRooms().then(setRooms);
  }, [open]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const current = rooms.find((r) => r.id === currentId);

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Switch room"
        title="Switch room"
        className="ds-btn"
        style={{ height: 28, padding: '0 8px', fontSize: 12 }}
      >
        <Icon name="layers" size={12} />
        <Icon name="chevron-down" size={11} />
      </button>
      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            right: 0,
            zIndex: 60,
            minWidth: 280,
            maxHeight: 360,
            overflow: 'auto',
            background: 'var(--paper)',
            border: '1px solid var(--ink)',
            boxShadow: '0 12px 30px rgba(0,0,0,0.18)',
          }}
        >
          <div
            className="ds-label"
            style={{
              padding: '10px 12px',
              fontSize: 9,
              color: 'var(--ink-3)',
              borderBottom: '1px solid var(--hairline)',
            }}
          >
            Switch room · <span className="mono">{rooms.length}</span>
          </div>
          {rooms.length === 0 && (
            <div style={{ padding: '14px 12px', fontSize: 12, color: 'var(--ink-3)' }}>No rooms yet.</div>
          )}
          {rooms.map((r) => {
            const isCurrent = r.id === currentId;
            return (
              <button
                key={r.id}
                onClick={() => {
                  setRoomId(r.id);
                  setOpen(false);
                  router.push(`/room/${r.id}/model`);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  width: '100%',
                  padding: '10px 12px',
                  background: isCurrent ? 'var(--accent-tint)' : 'transparent',
                  border: 'none',
                  borderLeft: isCurrent ? '2px solid var(--accent)' : '2px solid transparent',
                  cursor: 'pointer',
                  textAlign: 'left',
                  gap: 8,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>{r.name}</div>
                  <div style={{ fontSize: 9.5, color: 'var(--ink-3)' }}>
                    <span className="mono" style={{ letterSpacing: '0.06em' }}>{r.id.slice(0, 8).toUpperCase()}</span> · <span className="mono">{r.itemCount}</span> edited
                  </div>
                </div>
                {isCurrent && (
                  <span className="ds-label" style={{ fontSize: 9, color: 'var(--accent)' }}>
                    Here
                  </span>
                )}
              </button>
            );
          })}
          <div style={{ borderTop: '1px solid var(--hairline)' }}>
            <button
              onClick={() => {
                setOpen(false);
                router.push('/workspace');
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                width: '100%',
                padding: '10px 12px',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                fontSize: 12,
                color: 'var(--ink-2)',
                textAlign: 'left',
              }}
            >
              <Icon name="layers" size={11} /> All rooms…
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

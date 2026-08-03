'use client';

// Dropdown that lists all saved rooms; lets user jump between them without
// returning to /workspace. Lives in the studio TopBar.

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { roomStore, type RoomSummary } from '@/lib/storage';
import { useRoom } from '@/lib/store';
import { Icon } from '@/components/ui/Icon';
import { isTypingOrDialog } from './KeyboardShortcuts';

export function RoomSwitcher() {
  const router = useRouter();
  const { roomId: currentId } = useParams<{ roomId: string }>();
  const setRoomId = useRoom((s) => s.setRoomId);
  const [open, setOpen] = useState(false);
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    roomStore.listRooms().then(setRooms);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    // Esc closes and returns focus to the trigger. Before this the only exits
    // were re-clicking the button or clicking somewhere harmless.
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      if (isTypingOrDialog(e.target)) return;
      e.stopPropagation();
      setOpen(false);
      btnRef.current?.focus();
    }
    document.addEventListener('mousedown', onClick);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onClick);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button
        ref={btnRef}
        onClick={() => setOpen((v) => !v)}
        aria-label="Switch room"
        aria-expanded={open}
        title="Switch room"
        className="ds-btn"
        style={{ height: 28, padding: '0 8px', fontSize: 12 }}
      >
        <Icon name="layers" size={12} />
        <Icon name="chevron-down" size={11} />
      </button>
      {open && (
        <div
          className="popover"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            right: 0,
            zIndex: 'var(--z-popover)',
            minWidth: 280,
            maxHeight: 360,
            overflow: 'auto',
          }}
        >
          <div
            className="ds-label"
            style={{
              padding: '10px 12px',
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
                aria-current={isCurrent ? 'true' : undefined}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  width: '100%',
                  padding: '10px 12px',
                  background: isCurrent ? 'var(--accent-tint)' : 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  textAlign: 'left',
                  gap: 8,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>{r.name}</div>
                  <div style={{ fontSize: 10.5, color: 'var(--ink-3)' }}>
                    <span className="mono">{r.itemCount}</span> {r.itemCount === 1 ? 'piece' : 'pieces'}
                  </div>
                </div>
                {isCurrent && (
                  <span className="ds-label" style={{ color: 'var(--accent-text)' }}>
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

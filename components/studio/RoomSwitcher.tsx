'use client';

// Dropdown that lists all saved rooms; lets user jump between them without
// returning to the rooms page. Lives in the studio TopBar.

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { roomStore, type RoomSummary } from '@/lib/storage';
import { useRoom } from '@/lib/store';
import { Icon } from '@/components/ui/Icon';
import { Tooltip } from '@/components/ui/Tooltip';
import { isTypingOrDialog } from './KeyboardShortcuts';

export function RoomSwitcher() {
  const router = useRouter();
  const { roomId: currentId } = useParams<{ roomId: string }>();
  const setRoomId = useRoom((s) => s.setRoomId);
  const [open, setOpen] = useState(false);
  // Null until the first read: "No rooms yet" said during the read was false, in a
  // menu opened from inside a room.
  const [rooms, setRooms] = useState<RoomSummary[] | null>(null);
  const [unreadable, setUnreadable] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    roomStore
      .listRooms()
      .then((rs) => {
        setRooms(rs);
        setUnreadable(false);
      })
      // Not "No rooms yet", which would be false, and not a spinner forever.
      .catch(() => {
        setRooms([]);
        setUnreadable(true);
      });
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
      <Tooltip label="Switch room" placement="bottom">
        <button
          ref={btnRef}
          onClick={() => setOpen((v) => !v)}
          aria-label="Switch room"
          aria-expanded={open}
          className="ds-btn ds-btn--xs"
          style={{ padding: '0 8px', fontSize: 'var(--fs-small)' }}
        >
          <Icon name="layers" size={12} />
          <Icon name="chevron-down" size={11} />
        </button>
      </Tooltip>
      {open && (
        <div
          className="popover"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            right: 0,
            zIndex: 'var(--z-popover)',
            // Both bounds are capped against the window, and the floor has to be:
            // in CSS `min-width` beats `max-width`, so a bare `minWidth: 280`
            // would have won the conflict and spilled anyway on the narrowest
            // viewport — the ceiling alone is half a rule.
            minWidth: 'min(280px, calc(100vw - 32px))',
            // Room names are user text, and a long one widened this panel
            // leftward out of the window, since `right: 0` pins the one edge it
            // cannot grow past.
            maxWidth: 'min(360px, calc(100vw - 32px))',
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
            Switch room{rooms && (
              <>
                {' · '}
                <span className="mono">{rooms.length}</span>
              </>
            )}
          </div>
          {rooms === null && (
            <div role="status" style={{ padding: '8px 12px', display: 'grid', gap: 6 }}>
              <span className="sr-only">Loading your rooms</span>
              <div className="ds-skeleton ds-skeleton--row" aria-hidden="true" />
              <div className="ds-skeleton ds-skeleton--row" aria-hidden="true" />
            </div>
          )}
          {rooms?.length === 0 && (
            <div className="t-meta" style={{ padding: '14px 12px' }}>
              {unreadable ? 'Your rooms could not be read.' : 'No rooms yet.'}
            </div>
          )}
          {rooms?.map((r) => {
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
                  {/* One line, ellipsised. A room called by a whole sentence used
                      to wrap to four lines and make the rows different heights —
                      or, if it was one long unbroken word, spill past the panel. */}
                  <div
                    title={r.name}
                    className="truncate"
                    style={{
                      fontSize: 'var(--fs-body)',
                      fontWeight: 500,
                      color: 'var(--ink)',
                    }}
                  >
                    {r.name}
                  </div>
                  <div className="t-micro">
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
                router.push('/');
              }}
              className="t-small"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                width: '100%',
                padding: '10px 12px',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
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

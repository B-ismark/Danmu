'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRoom } from '@/lib/store';
import { roomStore, type RoomSummary } from '@/lib/storage';
import { DanmuMark } from '@/components/ui/primitives';
import { Icon } from '@/components/ui/Icon';
import { useConfirm } from '@/components/ui/Confirm';
import { PlanThumb } from '@/components/studio/PlanThumb';

export default function WorkspacePage() {
  const router = useRouter();
  const setRoomId = useRoom((s) => s.setRoomId);
  const confirm = useConfirm();
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [loading, setLoading] = useState(true);

  async function reload() {
    setLoading(true);
    const rs = await roomStore.listRooms();
    setRooms(rs);
    setLoading(false);
  }

  useEffect(() => {
    reload();
  }, []);

  function open(id: string) {
    setRoomId(id);
    router.push(`/room/${id}/model`);
  }

  async function remove(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    const ok = await confirm({
      title: 'Delete this room?',
      body: 'All captures, detections, edits and renders for this room will be permanently removed.',
      confirmLabel: 'Delete room',
      danger: true,
    });
    if (!ok) return;
    await roomStore.clearRoom(id);
    reload();
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--paper)', display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          height: 56,
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          padding: '0 24px',
          borderBottom: '1px solid var(--hairline)',
        }}
      >
        <DanmuMark size={12} />
        <div style={{ width: 1, height: 18, background: 'var(--hairline)' }} />
        <span className="ds-label">Workspace</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Your rooms</span>
        <div style={{ flex: 1 }} />
        <Link href="/settings" className="ds-btn" style={{ height: 32, fontSize: 12 }}>
          <Icon name="settings" size={12} />
          Settings
        </Link>
        <Link href="/onboarding/layout-pick" className="ds-btn ds-btn--primary" style={{ height: 32, fontSize: 12 }}>
          <Icon name="plus" size={12} />
          New Room
        </Link>
      </div>

      <div style={{ flex: 1, position: 'relative', padding: 32, background: 'var(--paper-2)' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          {loading ? (
            <div
              style={{
                textAlign: 'center',
                padding: 60,
                color: 'var(--ink-3)',
                fontSize: 13,
              }}
            >
              Loading rooms…
            </div>
          ) : rooms.length === 0 ? (
            <EmptyState />
          ) : (
            <>
              <div className="ds-kicker" style={{ color: 'var(--accent)', marginBottom: 16 }}>
                ↘ <span className="mono">{rooms.length}</span> room{rooms.length === 1 ? '' : 's'}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
                {rooms.map((r) => (
                  <RoomCard
                    key={r.id}
                    room={r}
                    onOpen={() => open(r.id)}
                    onDelete={(e) => remove(r.id, e)}
                    onRename={async (name) => {
                      await roomStore.renameRoom(r.id, name);
                      reload();
                    }}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function RoomCard({
  room,
  onOpen,
  onDelete,
  onRename,
}: {
  room: RoomSummary;
  onOpen: () => void;
  onDelete: (e: React.MouseEvent) => void;
  onRename: (name: string) => void | Promise<void>;
}) {
  const date = new Date(room.updatedAt);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(room.name);
  function commit() {
    const t = draft.trim();
    if (t && t !== room.name) onRename(t);
    setEditing(false);
  }
  return (
    <div
      onClick={onOpen}
      className="ds-card"
      style={{
        cursor: 'pointer',
        position: 'relative',
        transition: 'box-shadow 0.15s, transform 0.12s',
        overflow: 'hidden',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.boxShadow = 'var(--shadow-lift)';
        e.currentTarget.style.transform = 'translateY(-2px)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow = 'var(--shadow-soft)';
        e.currentTarget.style.transform = 'none';
      }}
    >
      <PlanThumb roomId={room.id} />
      <div style={{ padding: 16 }}>
      {editing ? (
        <input
          autoFocus
          value={draft}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            else if (e.key === 'Escape') {
              setDraft(room.name);
              setEditing(false);
            }
          }}
          style={{
            fontSize: 17,
            fontWeight: 600,
            letterSpacing: '-0.01em',
            marginBottom: 4,
            padding: '2px 4px',
            border: '1px solid var(--accent)',
            borderRadius: 2,
            outline: 'none',
            width: '100%',
            fontFamily: 'var(--font-sans)',
            background: 'var(--paper)',
            color: 'var(--ink)',
          }}
        />
      ) : (
        <div
          onClick={(e) => {
            e.stopPropagation();
            setDraft(room.name);
            setEditing(true);
          }}
          title="Click to rename"
          style={{ fontSize: 17, fontWeight: 600, letterSpacing: '-0.01em', marginBottom: 4, cursor: 'text' }}
        >
          {room.name}
        </div>
      )}
      <div style={{ fontSize: 10.5, color: 'var(--ink-3)', marginBottom: 8 }}>
        <span className="mono">{date.toLocaleDateString()}</span> · <span className="mono">{room.itemCount}</span> edited
      </div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
        {!room.detected && room.captureCount > 0 && room.captureCount < 4 && (
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              padding: '2px 9px',
              borderRadius: 'var(--r-full)',
              border: '1px solid var(--warn)',
              color: 'var(--warn)',
              background: 'rgba(122,76,0,0.08)',
            }}
          >
            ↻ Resume · <span className="mono">{room.captureCount}/4</span> walls
          </span>
        )}
        {!room.detected && room.captureCount === 4 && (
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              padding: '2px 9px',
              borderRadius: 'var(--r-full)',
              border: '1px solid var(--accent)',
              color: 'var(--accent)',
              background: 'var(--accent-tint)',
            }}
          >
            ↺ Run detect
          </span>
        )}
        {room.renderCount > 0 && (
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              padding: '2px 9px',
              borderRadius: 'var(--r-full)',
              border: '1px solid var(--accent)',
              color: 'var(--accent)',
              background: 'var(--accent-tint)',
            }}
          >
            <span className="mono">{room.renderCount}</span> render{room.renderCount === 1 ? '' : 's'}
          </span>
        )}
        {room.pinnedRenderCount > 0 && (
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              padding: '2px 9px',
              borderRadius: 'var(--r-full)',
              background: 'var(--accent)',
              color: '#fff',
            }}
          >
            ★ <span className="mono">{room.pinnedRenderCount}</span> pinned
          </span>
        )}
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onOpen();
          }}
          className="ds-btn ds-btn--primary"
          style={{ flex: 1, height: 30, fontSize: 12, justifyContent: 'center' }}
        >
          <Icon name="cube" size={11} />
          Open
        </button>
        <button
          onClick={onDelete}
          aria-label="Delete room"
          title="Delete room"
          className="ds-btn"
          style={{ height: 30, width: 34, padding: 0, justifyContent: 'center', color: 'var(--danger)', borderColor: 'var(--hairline-strong)' }}
        >
          <Icon name="trash" size={14} />
        </button>
      </div>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div style={{ textAlign: 'center', padding: 80, maxWidth: 600, marginInline: 'auto' }}>
      <div className="ds-kicker" style={{ color: 'var(--accent)', marginBottom: 12 }}>
        ↘ Workspace ready
      </div>
      <div style={{ fontSize: 38, fontWeight: 600, letterSpacing: '-0.02em', marginBottom: 10 }}>
        Scan your first room.
      </div>
      <p style={{ fontSize: 14, color: 'var(--ink-2)', lineHeight: 1.55, marginBottom: 28 }}>
        Pick a footprint, capture 4 wall photos, re-imagine the space — while preserving everything you already own.
      </p>
      <Link href="/onboarding/layout-pick" className="ds-btn ds-btn--primary" style={{ height: 40, padding: '0 20px', fontSize: 14 }}>
        <Icon name="plus" size={13} />
        Create your first room
      </Link>
    </div>
  );
}

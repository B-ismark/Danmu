'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRoom } from '@/lib/store';
import { roomStore, type RoomSummary } from '@/lib/storage';
import { useMediaQuery } from '@/lib/use-media-query';
import {
  RECENCY_GROUPS,
  editedLabel,
  recencyBucket,
  startOfToday,
  type RecencyGroupId,
} from '@/lib/dates';
import { DanmuMark, EditableText, IconButton, Pill } from '@/components/ui/primitives';
import { Icon } from '@/components/ui/Icon';
import { useConfirmDeleteRooms } from '@/components/ui/Confirm';
import { toast } from '@/components/ui/StorageToast';
import { PlanThumb } from '@/components/studio/PlanThumb';
import { ImportSceneButton } from '@/components/studio/SceneFile';

// Recency grouping and the "Edited …" label live in lib/dates, alongside the
// units formatter — this screen used to hand-roll both, while the saved-layouts
// panel formatted the same kind of fact a third way.
//
// Two things here are decided in JS rather than CSS — the card's hover lift (a
// :hover rule can't reach an inline style object, so the global
// prefers-reduced-motion block can't neutralise it) and whether hover-revealed
// actions should just stay visible (a touch device never hovers, and an
// invisible-but-tappable delete button is worse than a visible one). Neither
// needs `ready`: guessing "no" for one paint costs nothing either way.
type GroupId = RecencyGroupId;

export default function WorkspacePage() {
  const router = useRouter();
  const roomId = useRoom((s) => s.roomId);
  const setRoomId = useRoom((s) => s.setRoomId);
  const confirmDelete = useConfirmDeleteRooms();
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const noHover = useMediaQuery('(hover: none)');
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  // Only ever flips true. The old `loading` flag was re-raised by every delete,
  // so a cleanup session replaced the whole grid with "Loading rooms…" once per
  // deletion — the list vanished under the user thirty times in a row.
  const [booted, setBooted] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const filterRef = useRef<HTMLInputElement>(null);

  const reload = useCallback(async () => {
    const rs = await roomStore.listRooms();
    setRooms(rs);
    setBooted(true);
    // Drop selections for rooms that no longer exist.
    setSelected((prev) => prev.filter((id) => rs.some((r) => r.id === id)));
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  // KeyboardShortcuts only mounts inside the studio layout, so Cmd/Ctrl+, was
  // dead on the screen users actually land on. `/` focuses the filter.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if ((e.metaKey || e.ctrlKey) && e.key === ',') {
        e.preventDefault();
        router.push('/settings');
        return;
      }
      if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        filterRef.current?.focus();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [router]);

  const today = startOfToday();

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rooms;
    return rooms.filter((r) => r.name.toLowerCase().includes(q));
  }, [rooms, query]);

  const grouped = useMemo(() => {
    const map = new Map<GroupId, RoomSummary[]>();
    for (const r of matches) {
      const b = recencyBucket(r.updatedAt, today);
      const list = map.get(b);
      if (list) list.push(r);
      else map.set(b, [r]);
    }
    return RECENCY_GROUPS.map((g) => ({ ...g, rooms: map.get(g.id) ?? [] })).filter((g) => g.rooms.length > 0);
  }, [matches, today]);

  function openRoom(id: string) {
    setRoomId(id);
  }

  /** Soft-delete one or more rooms and offer the reversal. clearRoom moves keys
   *  to trash rather than erasing them, so "Undo" is real and not a promise we
   *  can't keep. */
  async function removeRooms(targets: RoomSummary[]) {
    if (!targets.length) return;
    const ok = await confirmDelete(targets.map((r) => r.name));
    if (!ok) return;
    // Deleted together rather than one after another — a bulk delete of thirty
    // rooms was thirty serialised trips through the whole key list.
    const tokens = await Promise.all(targets.map((t) => roomStore.clearRoom(t.id)));
    if (roomId && targets.some((t) => t.id === roomId)) setRoomId(null);
    setSelected([]);
    await reload();
    toast({
      title:
        targets.length === 1 ? `“${targets[0].name}” deleted` : `${targets.length} rooms deleted`,
      message: 'Recoverable for 30 days.',
      action: {
        label: 'Undo',
        onClick: async () => {
          await Promise.all(tokens.map((token) => roomStore.restoreRoom(token)));
          await reload();
          toast({
            tone: 'success',
            title: targets.length === 1 ? 'Room restored' : `${targets.length} rooms restored`,
          });
        },
      },
      ttl: 14000,
    });
  }

  const selectedRooms = rooms.filter((r) => selected.includes(r.id));

  return (
    <div style={{ minHeight: '100vh', background: 'var(--paper)', display: 'flex', flexDirection: 'column' }}>
      <div className="chrome-bar">
        <DanmuMark size={12} />
        <div style={{ width: 1, height: 18, background: 'var(--hairline)' }} />
        <span className="ds-label">Workspace</span>
        <div className="chrome-bar__spacer" />
        <Link href="/settings" className="ds-btn" style={{ height: 32, fontSize: 12 }}>
          <Icon name="settings" size={12} />
          Settings
        </Link>
        {/* Import belongs here rather than in a room: it makes a new room, so the
            workspace is both where it lands and where you can see it land. */}
        <ImportSceneButton />
        <Link href="/onboarding/layout-pick" className="ds-btn ds-btn--primary" style={{ height: 32, fontSize: 12 }}>
          <Icon name="plus" size={12} />
          New Room
        </Link>
      </div>

      <div style={{ flex: 1, position: 'relative', background: 'var(--paper-2)' }}>
        <div className="page-pad" style={{ maxWidth: 1100, margin: '0 auto' }}>
          {!booted ? (
            <div style={{ textAlign: 'center', padding: 60, color: 'var(--ink-3)', fontSize: 13 }}>
              Loading rooms…
            </div>
          ) : rooms.length === 0 ? (
            <EmptyState />
          ) : (
            <>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'flex-end',
                  justifyContent: 'space-between',
                  gap: 16,
                  flexWrap: 'wrap',
                  marginBottom: 18,
                }}
              >
                <div>
                  {/* The route had no heading element, so it had no document
                      outline and the display serif never rendered on it. */}
                  <h1 style={{ fontSize: 30, letterSpacing: '-0.02em', marginBottom: 4 }}>Your rooms</h1>
                  <div style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>
                    <span className="mono">{rooms.length}</span> room{rooms.length === 1 ? '' : 's'}, newest edit
                    first
                  </div>
                </div>
                <div style={{ flex: '0 1 280px', minWidth: 180 }}>
                  <label htmlFor="room-filter" className="sr-only">
                    Filter rooms by name
                  </label>
                  <input
                    id="room-filter"
                    ref={filterRef}
                    className="field"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') setQuery('');
                    }}
                    placeholder="Filter rooms — press /"
                    autoComplete="off"
                  />
                </div>
              </div>

              {selected.length > 0 && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    flexWrap: 'wrap',
                    marginBottom: 16,
                    padding: '10px 12px',
                    background: 'var(--paper)',
                    border: '1px solid var(--edge)',
                    borderRadius: 'var(--r-3)',
                  }}
                >
                  <span style={{ fontSize: 12.5, fontWeight: 700 }}>
                    <span className="mono">{selected.length}</span> selected
                  </span>
                  <div style={{ flex: 1 }} />
                  <button onClick={() => setSelected([])} className="ds-btn" style={{ height: 30, fontSize: 12 }}>
                    Clear selection
                  </button>
                  <button
                    onClick={() => removeRooms(selectedRooms)}
                    className="ds-btn"
                    style={{ height: 30, fontSize: 12, color: 'var(--danger-text)', borderColor: 'var(--danger)' }}
                  >
                    <Icon name="trash" size={12} />
                    Delete selected
                  </button>
                </div>
              )}

              {matches.length === 0 ? (
                <div
                  style={{
                    textAlign: 'center',
                    padding: '56px 24px',
                    background: 'var(--paper)',
                    border: '1px solid var(--hairline)',
                    borderRadius: 'var(--r-card)',
                  }}
                >
                  <div style={{ fontSize: 17, fontWeight: 600, marginBottom: 6 }}>
                    No room is called “{query.trim()}”.
                  </div>
                  <p style={{ fontSize: 13, color: 'var(--ink-2)', margin: '0 0 16px' }}>
                    You have {rooms.length} room{rooms.length === 1 ? '' : 's'} — try a shorter word, or clear the
                    filter.
                  </p>
                  <button onClick={() => setQuery('')} className="ds-btn" style={{ height: 32, fontSize: 12 }}>
                    <Icon name="x" size={11} />
                    Clear filter
                  </button>
                </div>
              ) : (
                grouped.map((g) => (
                  <section key={g.id} style={{ marginBottom: 26 }}>
                    <h2 className="ds-label" style={{ marginBottom: 10 }}>
                      {g.label} · <span className="mono">{g.rooms.length}</span>
                    </h2>
                    <div className="auto-grid auto-grid--cards">
                      {g.rooms.map((r) => (
                        <RoomCard
                          key={r.id}
                          room={r}
                          today={today}
                          reducedMotion={reducedMotion}
                          alwaysShowActions={noHover}
                          selected={selected.includes(r.id)}
                          onToggleSelect={() =>
                            setSelected((prev) =>
                              prev.includes(r.id) ? prev.filter((id) => id !== r.id) : [...prev, r.id],
                            )
                          }
                          onOpen={() => openRoom(r.id)}
                          onDelete={() => removeRooms([r])}
                          onRename={async (name) => {
                            await roomStore.renameRoom(r.id, name);
                            await reload();
                            // Renaming used to be completely silent, so there was
                            // no way to tell a saved rename from a rejected one.
                            toast({ tone: 'success', title: `Renamed to “${name}”`, ttl: 4000 });
                          }}
                        />
                      ))}
                    </div>
                  </section>
                ))
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function RoomCard({
  room,
  today,
  reducedMotion,
  alwaysShowActions,
  selected,
  onToggleSelect,
  onOpen,
  onDelete,
  onRename,
}: {
  room: RoomSummary;
  today: number;
  reducedMotion: boolean;
  /** touch device: nothing ever hovers, so the actions have to stay put */
  alwaysShowActions: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  onOpen: () => void;
  onDelete: () => void;
  onRename: (name: string) => void | Promise<void>;
}) {
  const [hover, setHover] = useState(false);
  const [focused, setFocused] = useState(false);
  // Secondary actions reveal on hover *or* keyboard focus, and stay out while
  // the card is idle: a permanent trash button 6px from Open meant tabbing 40
  // rooms passed 40 permanent-delete controls at the same weight as the primary
  // one. (The CSS .row-action rule needs a .list-row ancestor, which a card is
  // not — hence the same behaviour in state here.)
  const revealed = hover || focused || selected || alwaysShowActions;
  const lift = hover && !reducedMotion;
  const href = `/room/${room.id}/model`;

  return (
    <div
      className="ds-card"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        transition: 'box-shadow .15s, transform .12s',
        transform: lift ? 'translateY(-2px)' : 'none',
        boxShadow: [
          selected ? 'inset 0 0 0 2px var(--accent-text)' : '',
          lift ? 'var(--shadow-lift)' : 'var(--shadow-soft)',
        ]
          .filter(Boolean)
          .join(', '),
      }}
    >
      {/* A real <a>, not a div onClick: that restores keyboard focus, Enter,
          middle-click and Cmd-click for free. The plan drawing is the open
          target because it is the only reliable recognition cue on this screen. */}
      <Link
        href={href}
        onClick={onOpen}
        className="card-link"
        aria-label={`Open ${room.name}`}
        style={{ display: 'block' }}
      >
        <PlanThumb roomId={room.id} />
      </Link>

      <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 7 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
          <EditableText
            value={room.name}
            onCommit={onRename}
            label="Room name"
            // A pasted 400-character name had nothing stopping it.
            maxLength={60}
            style={{ fontSize: 15, fontWeight: 600, letterSpacing: '-0.01em', flex: 1, minWidth: 0 }}
            inputStyle={{ fontSize: 14, fontWeight: 600, flex: 1, minWidth: 0 }}
          />
          <div
            style={{
              display: 'flex',
              gap: 2,
              opacity: revealed ? 1 : 0,
              // A transparent destructive button must not be clickable. Keyboard
              // focus is unaffected by pointer-events, and landing on it flips
              // `revealed` anyway.
              pointerEvents: revealed ? 'auto' : 'none',
              transition: 'opacity .15s',
            }}
          >
            <IconButton
              icon="check"
              label={selected ? `Deselect ${room.name}` : `Select ${room.name}`}
              active={selected}
              onClick={onToggleSelect}
              size={30}
              iconSize={14}
            />
            <IconButton
              icon="trash"
              label={`Delete ${room.name}`}
              tone="danger"
              onClick={onDelete}
              size={30}
              iconSize={14}
            />
          </div>
        </div>

        <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>
          {editedLabel(room.updatedAt, today)} · <span className="mono">{room.itemCount}</span>{' '}
          {room.itemCount === 1 ? 'piece' : 'pieces'}
        </div>

        {!room.detected && room.captureCount > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {room.captureCount < 4 ? (
              <Pill tone="warn">
                Resume · <span className="mono">{room.captureCount}/4</span> walls
              </Pill>
            ) : (
              <Pill tone="accent">Detect furniture</Pill>
            )}
          </div>
        )}

        <Link
          href={href}
          onClick={onOpen}
          className="ds-btn ds-btn--primary"
          style={{ height: 32, fontSize: 12, justifyContent: 'center' }}
        >
          <Icon name="cube" size={11} />
          Open
        </Link>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div style={{ textAlign: 'center', padding: '80px 8px', maxWidth: 600, marginInline: 'auto' }}>
      <div className="ds-kicker" style={{ marginBottom: 12 }}>
        Ready when you are
      </div>
      <h1 style={{ fontSize: 38, letterSpacing: '-0.02em', marginBottom: 10 }}>Decorate your first room.</h1>
      <p style={{ fontSize: 14, color: 'var(--ink-2)', lineHeight: 1.55, marginBottom: 28 }}>
        Pick a footprint and start arranging furniture in real 3D — move, recolour, restyle, and relight
        every piece. No account, no upload. Capturing your real room is optional.
      </p>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
        <Link href="/onboarding/layout-pick" className="ds-btn ds-btn--accent" style={{ height: 40, padding: '0 20px', fontSize: 14 }}>
          {/* inherits the button's own --on-accent foreground */}
          <Icon name="plus" size={13} />
          Create your first room
        </Link>
        {/* Someone arriving from a shared file has no room to resume, so the empty
            state is exactly where they need this. */}
        <ImportSceneButton size="large" />
      </div>
    </div>
  );
}

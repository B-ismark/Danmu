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
import { EditableText, IconButton, Pill, Spinner } from '@/components/ui/primitives';
import { Icon } from '@/components/ui/Icon';
import { useConfirmDeleteRooms } from '@/components/ui/Confirm';
import { DocShell } from '@/components/ui/DocShell';
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

export default function RoomsPage() {
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
  // The list could not be read at all — a private window, blocked site data. This
  // is the first screen, so a read that throws must still leave a way to start.
  const [unreadable, setUnreadable] = useState(false);
  const roomsShown = useRef(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  // Select mode is its own state, not `selected.length > 0`: "Select" opens it with
  // nothing picked yet, and unpicking the last room must not throw the bar away
  // under the pointer that is about to pick the next one.
  const [selecting, setSelecting] = useState(false);
  const filterRef = useRef<HTMLInputElement>(null);

  const reload = useCallback(async () => {
    let rs: RoomSummary[];
    try {
      rs = await roomStore.listRooms();
    } catch {
      setUnreadable(true);
      setBooted(true);
      // A re-read after a delete or an undo: the cards on screen are now the
      // list as it was, so say so rather than leave them looking current.
      if (roomsShown.current) {
        toast({
          tone: 'danger',
          title: 'Your rooms could not be re-read',
          message: 'Reload the page to see the current list.',
        });
      }
      return;
    }
    setUnreadable(false);
    roomsShown.current = rs.length > 0;
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
      // A checkbox is not a text field: Esc from the select-all box still leaves.
      const typing =
        !!t && ((t.tagName === 'INPUT' && (t as HTMLInputElement).type !== 'checkbox') || t.tagName === 'TEXTAREA' || t.isContentEditable);
      if (typing) return;
      if (e.key === 'Escape') {
        setSelected([]);
        setSelecting(false);
        return;
      }
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
    setSelecting(false);
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
  // Select all reads the rooms on screen, so a filter narrows it to what you can see.
  const shownPicked = matches.filter((r) => selected.includes(r.id)).length;
  const allShown = matches.length > 0 && shownPicked === matches.length;

  function toggleRoom(id: string) {
    setSelecting(true);
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  return (
    <DocShell
      // This IS the root, so the trail is one hop. It still replaces the
      // `ds-label "Workspace"` that sat beside an h1 reading "Your rooms".
      trail={[{ label: 'Rooms' }]}
      actions={
        <>
          <Link href="/settings" className="ds-btn ds-btn--sm">
            <Icon name="settings" size={12} />
            Settings
          </Link>
          {/* While the list is empty the EmptyState below owns BOTH of these
              calls to action, at 40px in the middle of the page, and the bar carries
              navigation only. Repeating them up here is the one-primary rule's exact
              failure case — two claims to the main action — and the same argument
              applies to Import: offering it twice on one screen is how neither
              placement gets learned.

              Import lives on the rooms page rather than in a room because it MAKES a
              room, so this is both where it lands and where you see it land. */}
          {rooms.length > 0 && (
            <>
              <ImportSceneButton />
              <Link href="/onboarding/layout-pick" className="ds-btn ds-btn--sm ds-btn--primary">
                <Icon name="plus" size={12} />
                New Room
              </Link>
            </>
          )}
        </>
      }
    >
      <div style={{ position: 'relative' }}>
        <div>
          {!booted ? (
            <div className="veil" role="status" style={{ padding: 60, background: 'transparent' }}>
              <span className="veil__say">
                <Spinner size={14} /> Loading your rooms…
              </span>
            </div>
          ) : rooms.length === 0 ? (
            <EmptyState unreadable={unreadable} />
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
                  <h1 style={{ fontSize: 'var(--fs-display)', letterSpacing: '-0.02em', marginBottom: 4 }}>Your rooms</h1>
                  <div className="t-small">
                    <span className="mono">{rooms.length}</span> room{rooms.length === 1 ? '' : 's'}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: '0 1 360px', minWidth: 0, flexWrap: 'wrap' }}>
                  <div style={{ flex: '1 1 180px', minWidth: 0 }}>
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
                      placeholder="Filter rooms (press /)"
                      autoComplete="off"
                    />
                  </div>
                  {!selecting && (
                    <button onClick={() => setSelecting(true)} className="ds-btn ds-btn--sm">
                      Select
                    </button>
                  )}
                </div>
              </div>

              {selecting && (
                <div className="room-selbar" role="toolbar" aria-label="Selected rooms">
                  <SelectAllBox
                    checked={allShown}
                    mixed={shownPicked > 0 && !allShown}
                    onChange={() =>
                      setSelected((prev) =>
                        allShown
                          ? prev.filter((id) => !matches.some((r) => r.id === id))
                          : [...new Set([...prev, ...matches.map((r) => r.id)])],
                      )
                    }
                  />
                  <span style={{ fontSize: 'var(--fs-small)', fontWeight: 700 }}>
                    {selected.length > 0 ? (
                      <>
                        <span className="mono">{selected.length}</span> selected
                      </>
                    ) : (
                      'Select rooms'
                    )}
                  </span>
                  <div style={{ flex: 1 }} />
                  <button
                    onClick={() => {
                      setSelected([]);
                      setSelecting(false);
                    }}
                    className="ds-btn ds-btn--sm ds-btn--ghost"
                  >
                    Done
                  </button>
                  <button
                    onClick={() => removeRooms(selectedRooms)}
                    disabled={selected.length === 0}
                    className="ds-btn ds-btn--sm ds-btn--danger-line"
                  >
                    <Icon name="trash" size={12} />
                    {selected.length > 1 ? (
                      <>
                        Delete <span className="mono">{selected.length}</span> rooms
                      </>
                    ) : (
                      'Delete'
                    )}
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
                  <div style={{ fontSize: 'var(--fs-lead)', fontWeight: 600, marginBottom: 6 }}>
                    No room is called “{query.trim()}”.
                  </div>
                  <p className="t-body" style={{ margin: '0 0 16px' }}>
                    You have {rooms.length} room{rooms.length === 1 ? '' : 's'}.
                  </p>
                  <button onClick={() => setQuery('')} className="ds-btn ds-btn--sm">
                    <Icon name="x" size={11} />
                    Clear filter
                  </button>
                </div>
              ) : (
                grouped.map((g, gi) => (
                  <section key={g.id} style={{ marginBottom: 26 }}>
                    <h2 className="ds-label" style={{ marginBottom: 10 }}>
                      {g.label} · <span className="mono">{g.rooms.length}</span>
                    </h2>
                    <div className="auto-grid auto-grid--cards">
                      {/* Making a room is the thing this page exists for, and the
                          only control for it sat in the far corner of the bar — a
                          diagonal across the whole viewport from where the eye
                          starts. It joins the grid instead, in the first group,
                          where a new room would land anyway.

                          Deliberately NOT a second `--primary`: the bar's "New
                          Room" is this page's one primary (see EmptyState), so
                          this is the quiet empty slot beside the rooms that
                          exist, not a competing claim to the same action.

                          Hidden while the filter is on. A filtered grid is a set
                          of search results, and "create" is not one of them. */}
                      {gi === 0 && query.trim() === '' && <NewRoomCard receded={selecting} />}
                      {g.rooms.map((r) => (
                        <RoomCard
                          key={r.id}
                          room={r}
                          today={today}
                          reducedMotion={reducedMotion}
                          alwaysShowActions={noHover}
                          selected={selected.includes(r.id)}
                          selecting={selecting}
                          onToggleSelect={() => toggleRoom(r.id)}
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
    </DocShell>
  );
}

/** The empty slot in the room grid — "start another one", where the rooms are.
 *
 *  A tile rather than a card: dashed `--edge` (interactive, so not a
 *  `--hairline`) and no `.ds-card` fill, so it reads as the space a room would
 *  go in rather than as a room that has lost its drawing. It stretches to the
 *  row's height on its own — grid items default to `stretch` — which is why it
 *  carries no height of its own to drift out of step with `RoomCard`. */
function NewRoomCard({ receded }: { receded: boolean }) {
  const [hover, setHover] = useState(false);
  return (
    <Link
      // While rooms are being picked it steps back: it is not a room, so it cannot
      // be selected, and a click that made a room in the middle of a cleanup would
      // be the wrong click. `inert` takes it out of the tab order and the pointer.
      inert={receded}
      aria-hidden={receded || undefined}
      href="/onboarding/layout-pick"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        // The cards it sits beside are a thumbnail plus three rows of text, so
        // an empty tile with nothing in it would collapse to its own content.
        minHeight: 200,
        padding: 16,
        textAlign: 'center',
        borderRadius: 'var(--r-card)',
        border: '1.5px dashed var(--edge)',
        background: hover ? 'var(--accent-tint)' : 'transparent',
        borderColor: hover ? 'var(--accent-text)' : 'var(--edge)',
        color: hover ? 'var(--accent-text)' : 'var(--ink-2)',
        opacity: receded ? 0.4 : 1,
        transition: 'background var(--dur-base) var(--ease-out), border-color var(--dur-base) var(--ease-out), color var(--dur-base) var(--ease-out), opacity var(--dur-base) var(--ease-out)',
      }}
    >
      <span
        style={{
          display: 'grid',
          placeItems: 'center',
          width: 38,
          height: 38,
          borderRadius: '50%',
          border: '1.5px dashed currentColor',
        }}
      >
        <Icon name="plus" size={16} />
      </span>
      <span style={{ fontSize: 'var(--fs-body)', fontWeight: 600, letterSpacing: '-0.01em' }}>New room</span>
      <span style={{ fontSize: 'var(--fs-caption)', color: hover ? 'var(--accent-text)' : 'var(--ink-3)' }}>
        Pick a footprint to start
      </span>
    </Link>
  );
}

function RoomCard({
  room,
  today,
  reducedMotion,
  alwaysShowActions,
  selected,
  selecting,
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
  /** select mode: every card shows its tick, and the drawing picks rather than opens */
  selecting: boolean;
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
  // one. (The CSS .row-actions rule needs a .list-row ancestor, which a card is
  // not — hence the same behaviour in state here.)
  const revealed = hover || focused || selected || alwaysShowActions;
  const tickShown = revealed || selecting;
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
        transition: 'box-shadow var(--dur-base) var(--ease-out), transform var(--dur-quick) var(--ease-out)',
        transform: lift ? 'translateY(-2px)' : 'none',
        // An outline, not an inset shadow: an inset shadow is painted UNDER the card's
        // children, so the plan drawing covered the ring along the whole top edge.
        outline: selected ? '2px solid var(--accent-text)' : 'none',
        outlineOffset: -2,
        boxShadow: lift ? 'var(--shadow-lift)' : 'var(--shadow-soft)',
      }}
    >
      {/* A real <a>, not a div onClick: that restores keyboard focus, Enter,
          middle-click and Cmd-click for free. The plan drawing is the open
          target because it is the only reliable recognition cue on this screen. */}
      {/* The tick sits on the drawing's corner, where a picked room is seen first.
          In select mode it shows on every card, so what is and is not picked can be
          read across the whole grid without hovering each one. */}
      <button
        type="button"
        onClick={onToggleSelect}
        aria-pressed={selected}
        aria-label={selected ? `Deselect ${room.name}` : `Select ${room.name}`}
        className="icon-btn room-tick"
        style={{
          opacity: tickShown ? 1 : 0,
          // Same reason as the actions below: invisible must mean unclickable.
          pointerEvents: tickShown ? 'auto' : 'none',
          transition: 'opacity var(--dur-base) var(--ease-out)',
        }}
      >
        <Icon name="check" size={14} />
      </button>
      {selecting ? (
        // Picking, not opening: in select mode the drawing is the biggest target on
        // the card, and opening a room out from under a half-made selection would
        // throw the selection away.
        <button
          type="button"
          onClick={onToggleSelect}
          aria-pressed={selected}
          aria-label={selected ? `Deselect ${room.name}` : `Select ${room.name}`}
          className="card-link"
          tabIndex={-1}
          style={{ display: 'block', position: 'relative', width: '100%', padding: 0, border: 0, background: 'none', cursor: 'pointer' }}
        >
          <PlanThumb roomId={room.id} />
          {selected && <span className="room-thumb-wash" aria-hidden="true" />}
        </button>
      ) : (
        <Link
          href={href}
          onClick={onOpen}
          className="card-link"
          aria-label={`Open ${room.name}`}
          style={{ display: 'block', position: 'relative' }}
        >
          <PlanThumb roomId={room.id} />
          {selected && <span className="room-thumb-wash" aria-hidden="true" />}
        </Link>
      )}

      <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 7 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
          <EditableText
            value={room.name}
            onCommit={onRename}
            label="Room name"
            // A pasted 400-character name had nothing stopping it.
            maxLength={60}
            style={{ fontSize: 'var(--fs-lead)', fontWeight: 600, letterSpacing: '-0.01em', flex: 1, minWidth: 0 }}
            inputStyle={{ fontSize: 'var(--fs-body)', fontWeight: 600, flex: 1, minWidth: 0 }}
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
              transition: 'opacity var(--dur-base) var(--ease-out)',
            }}
          >
            {/* Hidden in select mode: the bar's Delete acts on the selection, and a
                second delete per card beside it would be two answers to one question. */}
            {!selecting && <IconButton
              icon="trash"
              label={`Delete ${room.name}`}
              tone="danger"
              onClick={onDelete}
              size={30}
              iconSize={14}
            />}
          </div>
        </div>

        <div className="t-hint">
          {editedLabel(room.updatedAt, today)} · <span className="mono">{room.itemCount}</span>{' '}
          {room.itemCount === 1 ? 'piece' : 'pieces'}
        </div>

        {!room.detected && room.captureCount > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {/* These used to be readouts, which left a half-captured room with no way
                back to the screen they name: the card's one link goes to the studio,
                and nothing else on this page points at /onboarding/*. They are links
                now, and they carry `onOpen` for the same reason the card body does —
                both onboarding screens read the room from `useRoom`, not from the
                URL, so an href alone lands on "Pick a room shape first". */}
            {room.captureCount < 4 ? (
              <Link
                href="/onboarding/capture"
                onClick={onOpen}
                aria-label={`Add the remaining wall photos for ${room.name}`}
                style={{ textDecoration: 'none' }}
              >
                <Pill tone="warn">
                  Resume · <span className="mono">{room.captureCount}/4</span> walls
                </Pill>
              </Link>
            ) : (
              <Link
                href="/onboarding/detect"
                onClick={onOpen}
                aria-label={`Find the furniture in ${room.name}'s photos`}
                style={{ textDecoration: 'none' }}
              >
                <Pill tone="accent">Detect furniture</Pill>
              </Link>
            )}
          </div>
        )}

        {/* Plain: this repeats once per card, and the page's primary is the one
            "New Room" in the bar. The thumbnail above is the other open target. */}
        <Link
          href={href}
          onClick={onOpen}
          className="ds-btn ds-btn--sm"
          style={{ justifyContent: 'center' }}
        >
          <Icon name="cube" size={11} />
          Open
        </Link>
      </div>
    </div>
  );
}

function EmptyState({ unreadable }: { unreadable: boolean }) {
  // A list that could not be read is not an empty one. "No rooms yet" over it
  // would be a false empty state, and "Create your first room" a dead end: a
  // browser that will not open its storage will not save a new room either.
  if (unreadable) {
    return (
      <div style={{ textAlign: 'center', padding: '80px 8px', maxWidth: 'var(--measure-text)', marginInline: 'auto' }}>
        <div className="ds-kicker" style={{ marginBottom: 12 }}>
          Storage unavailable
        </div>
        <h1 style={{ fontSize: 'var(--fs-hero)', letterSpacing: '-0.02em', marginBottom: 10 }}>
          Your rooms can&apos;t be opened here.
        </h1>
        <p className="t-body" style={{ lineHeight: 1.55, marginBottom: 28 }}>
          This browser isn&apos;t letting Danmu use its storage, which is where your rooms are kept. A private
          window or blocked site data can do this. Rooms can&apos;t be saved until it is allowed.
        </p>
        <button
          onClick={() => window.location.reload()}
          className="ds-btn ds-btn--lg ds-btn--primary"
          style={{ padding: '0 20px' }}
        >
          <Icon name="refresh" size={13} />
          Try again
        </button>
      </div>
    );
  }
  return (
    <div style={{ textAlign: 'center', padding: '80px 8px', maxWidth: 'var(--measure-text)', marginInline: 'auto' }}>
      <div className="ds-kicker" style={{ marginBottom: 12 }}>
        No rooms yet
      </div>
      <h1 style={{ fontSize: 'var(--fs-hero)', letterSpacing: '-0.02em', marginBottom: 28 }}>Decorate your first room.</h1>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
        {/* --primary, not --accent. This is the page you are reading, not a step in
            the onboarding flow, and the bar hides its own "New Room" in this state,
            so there is exactly one. The pairing this replaces — an ink "New Room" in
            the bar beside a terracotta "Create your first room" here, both pointing
            at /onboarding/layout-pick — is the case the rule in globals.css cites. */}
        <Link href="/onboarding/layout-pick" className="ds-btn ds-btn--lg ds-btn--primary" style={{ padding: '0 20px' }}>
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

/** The bar's select-all box. A native checkbox, so its three states are announced
 *  for free; `indeterminate` has no attribute and is set on the element. */
function SelectAllBox({ checked, mixed, onChange }: { checked: boolean; mixed: boolean; onChange: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = mixed;
  }, [mixed]);
  return (
    <input ref={ref} type="checkbox" checked={checked} onChange={onChange} aria-label="Select all rooms shown" />
  );
}

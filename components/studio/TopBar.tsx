'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { DanmuMark, EditableText } from '@/components/ui/primitives';
import { toast } from '@/components/ui/StorageToast';
import { roomStore } from '@/lib/storage';
import type { CSSProperties, ReactNode } from 'react';
import { Icon } from '@/components/ui/Icon';
import { usePhoneStudio } from './NarrowViewportBanner';

export function TopBar({
  right,
  centerSlot,
  phoneEnd,
}: {
  roomName?: string;
  right?: ReactNode;
  centerSlot?: ReactNode;
  /** What ends the bar on a phone, in place of `right` — the More menu. */
  phoneEnd?: ReactNode;
}) {
  const phone = usePhoneStudio();
  const { roomId } = useParams<{ roomId: string }>();
  // Null until the room's own name is read. It used to start as "Living Room", so
  // every room was called that for a moment, and a quick rename could race it.
  const [name, setName] = useState<string | null>(null);
  const [savedHint, setSavedHint] = useState(false);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!roomId) return;
    // A room that is not there, or storage that cannot be read, still gets a name
    // to show: "Room", the Export menu's fallback too, rather than a loading gap
    // that never fills.
    roomStore
      .loadRoom(roomId)
      .then((r) => setName(r?.name ?? 'Room'))
      .catch(() => setName('Room'));
  }, [roomId]);

  useEffect(() => () => {
    if (hintTimer.current) clearTimeout(hintTimer.current);
  }, []);

  async function commitName(next: string) {
    const trimmed = next.trim();
    if (!trimmed || !roomId) return;
    setName(trimmed);
    // The name alone, in one transaction: copying the record it read would put back
    // whatever the studio saved in between — a size, or a cleared rough-size note.
    if (await roomStore.renameRoom(roomId, trimmed)) flashSaved();
  }

  function flashSaved() {
    setSavedHint(true);
    if (hintTimer.current) clearTimeout(hintTimer.current);
    hintTimer.current = setTimeout(() => setSavedHint(false), 1800);
  }

  const nameField = (style: CSSProperties) =>
    name === null ? (
      // The same height the name will take, so the bar does not jump when it lands.
      <span style={{ ...style, display: 'inline-block', height: 28 }} aria-busy="true">
        <span className="sr-only">Loading the room’s name</span>
      </span>
    ) : (
    <EditableText
      value={name}
      label="Room name"
      onCommit={commitName}
      onReject={() =>
        toast({ title: 'Room kept its name', message: 'A room needs a name, so the old one stayed.' })
      }
      style={style}
      inputStyle={{ fontSize: 'var(--field-fs)', fontWeight: 500, height: 28, width: 'min(280px, 100%)' }}
    />
    );
  const savedStatus = (
    <span className="sr-only" role="status" aria-live="polite">
      {savedHint ? 'Room saved' : ''}
    </span>
  );

  // A phone gets ONE row — Apple's compact navigation bar, Material's small top app
  // bar — not the laptop's bar wrapped into three. Back (which is also the way to
  // another room), the name, the view switch, and More for everything used less.
  // No wordmark: the HIG's toolbar guidance is not to title a screen with the app's
  // name, and on a phone that name cost the room's.
  if (phone) {
    return (
      <header className="app-bar">
        <Link href="/" className="icon-btn app-bar__btn" aria-label="Back to your rooms" title="Your rooms">
          <Icon name="chevron-left" size={22} />
        </Link>
        {nameField({ fontSize: 'var(--fs-body)', fontWeight: 700, minWidth: 0, flex: '1 1 auto' })}
        {savedStatus}
        {centerSlot}
        {phoneEnd}
      </header>
    );
  }

  return (
    // The same `.chrome-bar` as onboarding and DocShell, in its `--tight` 48px
    // size. It used to be a hand-rolled `height: 48` flex row that could not
    // wrap, holding ~900px of nowrap content — a logo, a breadcrumb, a room name
    // of unknown length, a save hint, two tabs and three controls — so on
    // anything under about a 950px window it simply overflowed sideways. Nothing
    // in it could shrink either: flex items default to `min-width: auto`, so the
    // `flex: 1` spacer collapsed to nothing and then the row spilled.
    <div className="chrome-bar chrome-bar--tight">
      <Link href="/" aria-label="Danmu: back to your rooms" style={{ display: 'flex' }}>
        <DanmuMark size={12} />
      </Link>
      <div aria-hidden="true" style={{ width: 1, height: 18, background: 'var(--hairline)', flexShrink: 0 }} />
      {/* A path, not a field label. `ds-label "Project"` spent its width saying
          what the editable name beside it already made obvious, and left the room
          with no route back except the logo. "Rooms" is that route, stated — and
          it stays at every width, because it is the way out. The room NAME is
          what gives ground instead. */}
      <nav
        aria-label="Breadcrumb"
        style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flexShrink: 0 }}
      >
        <Link
          href="/"
          style={{ fontSize: 'var(--fs-small)', fontWeight: 600, color: 'var(--ink-3)', textDecoration: 'none', whiteSpace: 'nowrap' }}
        >
          Rooms
        </Link>
        <span aria-hidden="true" style={{ color: 'var(--ink-4)', fontSize: 'var(--fs-small)' }}>/</span>
      </nav>
      {/* Renaming is a real control now: reachable by keyboard, announced, and
          it reverts a blank name instead of appearing to ignore it.
          This is the item in the bar that gives ground: `.editable` already
          ellipsises, and `minWidth: 0` is what lets it — a flex item's automatic
          minimum is its own content, so without this a room called by a whole
          sentence pushed the bar wider than the window instead of shortening. The
          full name stays in the tooltip, in the accessible name, and in the field
          the moment you press it. */}
      {nameField({ fontSize: 'var(--fs-body)', fontWeight: 500, minWidth: 0 })}
      {/* Save state says a word. A bare 6px dot claimed something it could not
          explain — and it is announced, because a silent colour change is not
          feedback for anyone using a screen reader. */}
      <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 'var(--fs-caption)', flexShrink: 0 }}>
        <span
          aria-hidden="true"
          title={savedHint ? 'Room saved' : 'Saves as you go'}
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: savedHint ? 'var(--success)' : 'var(--ink-3)',
            opacity: savedHint ? 1 : 0.5,
            transition: 'background var(--dur-base) var(--ease-out), opacity var(--dur-base) var(--ease-out)',
            flexShrink: 0,
          }}
        />
        {/* Two spans, not one ternary: the transient "Saved" is feedback and
            always shows, while the idle sentence is reassurance and steps aside
            on a small laptop rather than costing the canvas a second bar row. */}
        {savedHint ? (
          <span style={{ color: 'var(--success-text)', fontWeight: 600, whiteSpace: 'nowrap' }}>Saved</span>
        ) : (
          <span className="bar-idle-words" style={{ color: 'var(--ink-3)', fontWeight: 600, whiteSpace: 'nowrap' }}>
            Saves as you go
          </span>
        )}
      </span>
      {savedStatus}
      {centerSlot}
      {/* `margin-left: auto`, not a `flex: 1` spacer. A spacer stays on row one
          when the bar wraps, which left these three hanging off the left edge of
          row two; this keeps them together and against the trailing edge on
          whichever row they land on. */}
      {right != null && <div className="chrome-bar__end">{right}</div>}
    </div>
  );
}

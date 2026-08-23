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
    // The same `.chrome-bar` as onboarding and DocShell, in its `--tight` 48px
    // size. It used to be a hand-rolled `height: 48` flex row that could not
    // wrap, holding ~900px of nowrap content — a logo, a breadcrumb, a room name
    // of unknown length, a save hint, two tabs and three controls — so on
    // anything under about a 950px window it simply overflowed sideways. Nothing
    // in it could shrink either: flex items default to `min-width: auto`, so the
    // `flex: 1` spacer collapsed to nothing and then the row spilled.
    <div className="chrome-bar chrome-bar--tight">
      <Link href="/workspace" aria-label="Danmu — back to your rooms" style={{ display: 'flex' }}>
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
          href="/workspace"
          style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-3)', textDecoration: 'none', whiteSpace: 'nowrap' }}
        >
          Rooms
        </Link>
        <span aria-hidden="true" style={{ color: 'var(--ink-4)', fontSize: 12 }}>/</span>
      </nav>
      {/* Renaming is a real control now: reachable by keyboard, announced, and
          it reverts a blank name instead of appearing to ignore it.
          This is the item in the bar that gives ground: `.editable` already
          ellipsises, and `minWidth: 0` is what lets it — a flex item's automatic
          minimum is its own content, so without this a room called by a whole
          sentence pushed the bar wider than the window instead of shortening. The
          full name stays in the tooltip, in the accessible name, and in the field
          the moment you press it. */}
      <EditableText
        value={name}
        label="Room name"
        onCommit={commitName}
        onReject={() =>
          toast({ title: 'Room kept its name', message: 'A room needs a name, so the old one stayed.' })
        }
        style={{ fontSize: 13, fontWeight: 500, minWidth: 0 }}
        // A 200px floor on the input is what forced the bar past the window on a
        // narrow screen mid-rename; it can have up to 280 and no more than it has.
        inputStyle={{ fontSize: 13, fontWeight: 500, height: 28, width: 'min(280px, 100%)' }}
      />
      {/* Save state says a word. A bare 6px dot claimed something it could not
          explain — and it is announced, because a silent colour change is not
          feedback for anyone using a screen reader. */}
      <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, flexShrink: 0 }}>
        <span
          aria-hidden="true"
          title={savedHint ? 'Room saved' : 'Saves as you go'}
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
      <span className="sr-only" role="status" aria-live="polite">
        {savedHint ? 'Room saved' : ''}
      </span>
      {centerSlot}
      {/* `margin-left: auto`, not a `flex: 1` spacer. A spacer stays on row one
          when the bar wraps, which left these three hanging off the left edge of
          row two; this keeps them together and against the trailing edge on
          whichever row they land on. */}
      {right != null && <div className="chrome-bar__end">{right}</div>}
    </div>
  );
}

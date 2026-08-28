'use client';

// What every candidate shell shares, so the four differ only in the thing under
// test: how width is handed out between the room and the two rails.
//
// If a prototype needed its own copy of the rail's contents or its own collapse
// control, the comparison would stop being about layout — the drift between the
// copies would be in the measurements too. Same argument as `StudioShell` itself
// existing: two copies of a layout is two places for it to drift.

import type { ReactNode } from 'react';
import { useStudio } from '@/lib/store';
import { Icon } from '@/components/ui/Icon';
import { PartTree } from '../PartTree';
import { Inspector } from '../Inspector';
import { RoomActions } from '../RoomActions';
import { SelectionHeader } from '../SelectionHeader';
import { RoomHealthDot } from '../RoomTools';

export type RailSide = 'left' | 'right';

/** Both rails' open state and the one action that changes it. */
export function useRails() {
  const leftOpen = useStudio((s) => s.railLeftOpen);
  const rightOpen = useStudio((s) => s.railRightOpen);
  const toggleRail = useStudio((s) => s.toggleRail);
  return { leftOpen, rightOpen, toggleRail };
}

/**
 * The collapse control, in the rail's own top corner — where Spline puts its
 * panel toggles. It stays mounted when the rail is closed; otherwise the only way
 * back would be a keyboard shortcut nobody has been told about.
 */
export function RailToggle({
  side,
  open,
  onToggle,
}: {
  side: RailSide;
  open: boolean;
  onToggle: () => void;
}) {
  const pointsAway =
    side === 'left' ? (open ? 'chevron-left' : 'chevron-right') : open ? 'chevron-right' : 'chevron-left';
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: side === 'left' ? 'flex-end' : 'flex-start',
        padding: 6,
        borderBottom: open ? '1px solid var(--hairline)' : 0,
        flexShrink: 0,
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-label={open ? `Hide the ${side} panel` : `Show the ${side} panel`}
        title={open ? 'Hide this panel' : 'Show this panel'}
        className="icon-btn"
        style={{ width: 24, height: 24, color: 'var(--ink-3)' }}
      >
        <Icon name={pointsAway} size={13} />
      </button>
    </div>
  );
}

/** The piece tree, or — when the rail is shut — the one thing that must not be
 *  hidden with it. That state being always visible is the whole reason it moved
 *  out of a canvas dock. */
export function LeftRailBody({ open }: { open: boolean }): ReactNode {
  return open ? (
    <PartTree />
  ) : (
    <div style={{ padding: '8px 0' }}>
      <RoomHealthDot />
    </div>
  );
}

/** The selection's banner above the panel that acts on it. It used to float on
 *  the canvas's bottom edge, answering what this panel answers.
 *
 *  It ends with the room-level actions — add a piece, put every piece back.
 *  Those were the LEFT rail's pinned footer, which is the bottom-left corner of
 *  the window: the furthest point on screen from a hand editing a piece, and
 *  diagonally opposite the panel above. Pinned the same way it was, by being the
 *  last non-growing child of the rail's flex column — `.rail` is already
 *  `display: flex; flex-direction: column; height: 100%`, so this needs no
 *  absolute positioning in a container that clips. */
export function RightRailBody({ open }: { open: boolean }): ReactNode {
  if (!open) return null;
  return (
    <>
      <SelectionHeader />
      <Inspector />
      <RoomActions />
    </>
  );
}

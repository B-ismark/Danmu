'use client';

// What every candidate shell shares, so the four differ only in the thing under
// test: how width is handed out between the room and the two rails.
//
// If a prototype needed its own copy of the rail's contents or its own collapse
// control, the comparison would stop being about layout — the drift between the
// copies would be in the measurements too. Same argument as `StudioShell` itself
// existing: two copies of a layout is two places for it to drift.

import { useState, type ReactNode } from 'react';
import { useStudio } from '@/lib/store';
import { Icon } from '@/components/ui/Icon';
import { PartTree } from '../PartTree';
import { Inspector } from '../Inspector';
import { RailSection } from '../RailSection';
import { RailFooter } from '../RailFooter';
import { SelectionHeader } from '../SelectionHeader';
import { RoomHealthDot } from '../RoomTools';
import { ViewOptions } from '../ViewOptions';

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
 *  It ends with the rail's action row — delete the selected piece, add a piece,
 *  put every piece back. Add and the revert were the LEFT rail's pinned footer,
 *  the bottom-left corner of the window: the furthest point on screen from a hand
 *  editing a piece, and diagonally opposite the panel above. Delete came from the
 *  foot of the Inspector itself, which is a SCROLLING box — so it is pinned now
 *  rather than merely low down, and the rail has one `--paper-2` band at its foot
 *  where it had two. Pinned by being the
 *  last non-growing child of the rail's flex column — `.rail` is already
 *  `display: flex; flex-direction: column; height: 100%`, so this needs no
 *  absolute positioning in a container that clips. */
export function RightRailBody({ open }: { open: boolean }): ReactNode {
  if (!open) return null;
  return (
    <>
      <SelectionHeader />
      {/* The Inspector and the View section share ONE scroll region, and the footer
          stays pinned below it — the same shape the left rail has had all along.

          Before this they were two siblings of `.rail` directly, and only one of them
          could give: `RailSection` is `flex: 0 0 auto` when it is not `grow`, and
          `.rail-footer` is `flex-shrink: 0`. Measured in a browser at a 1100 × 520
          window, the right rail is 427px and its children were 37 + 94 + 277 + 56 =
          464, so the pinned footer painted **37px past the rail's own bottom edge**;
          at 420px tall it was 137px. `.rail` sets no `overflow`, so there was no clip,
          no scrollbar and no error — the vertical twin of the horizontal spill
          `globals.css` already records.

          One scroll box rather than a height cap on the View section, because a cap
          is a number that has to be re-derived every time either panel grows. */}
      <div style={{ flex: '1 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
        <Inspector />
        <ViewSection />
      </div>
      <RailFooter />
    </>
  );
}

/** The View panel (Floor grid / Decor / Quality), which used to be the LEFT
 *  rail's own section. It lives between the Inspector and the pinned footer so
 *  that, with nothing selected, it sits directly on top of Add, and with a piece
 *  or a wall selected it sits underneath the panel's last section (Exact size /
 *  the wall's height). Open by default rather than matching the left rail's old
 *  `view: false`: the controls are the useful half of the no-selection state,
 *  and the disclosure still exists for the tall-selection case. */
function ViewSection() {
  const [open, setOpen] = useState(true);
  return (
    <RailSection title="View" open={open} onToggle={() => setOpen((v) => !v)} divider={false}>
      <ViewOptions />
    </RailSection>
  );
}

'use client';

// What every candidate shell shares, so the four differ only in the thing under
// test: how width is handed out between the room and the two rails.
//
// If a prototype needed its own copy of the rail's contents or its own collapse
// control, the comparison would stop being about layout — the drift between the
// copies would be in the measurements too. Same argument as `StudioShell` itself
// existing: two copies of a layout is two places for it to drift.

import { type ReactNode } from 'react';
import { useStudio } from '@/lib/store';
import { useScene } from '@/lib/scene-store';
import { useRailIntent, type LeftSection } from '@/lib/rail-intent';
import { CATEGORY_ICON, Icon, type IconName } from '@/components/ui/Icon';
import { Tooltip } from '@/components/ui/Tooltip';
import { PartTree } from '../PartTree';
import { Inspector } from '../Inspector';
import { RailFooter } from '../RailFooter';
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
        // Centred over the icon strip when shut, so the chevron lines up with the
        // icons under it rather than hugging one edge of a 44px column.
        justifyContent: !open ? 'center' : side === 'left' ? 'flex-end' : 'flex-start',
        padding: 6,
        // Always: a shut rail is no longer empty below this row (see the strips).
        borderBottom: '1px solid var(--hairline)',
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

/** The piece tree, or, when the rail is shut, its icon strip. */
export function LeftRailBody({ open }: { open: boolean }): ReactNode {
  return open ? <PartTree /> : <LeftRailStrip />;
}

// ─── Collapsed rails ─────────────────────────────────────────────────────────
//
// A shut rail used to be a tall empty pill with a chevron at the top: the room
// gained 37px and the panel told you nothing about what was in it. The pattern
// every tool people know settles on for this is an ICON STRIP rather than an empty
// band: VS Code's activity bar, Material's collapsed navigation rail ("it should
// not be hidden"), Figma's and JetBrains' tool-window stripes. So a shut rail keeps
// one icon per thing it holds, and each icon is a way back in that lands where it
// names. Style opens the rail on Style, not on wherever it was left.
//
// Every icon carries its name as an `aria-label`, and a SIDE tooltip on hover or
// focus. A bubble above or below would sit on the next icon down, which is the one
// the pointer is travelling to.

function StripButton({
  icon,
  label,
  tip,
  side,
  onClick,
  badge,
  expanded,
  active = false,
}: {
  icon: IconName;
  /** The accessible name — a sentence where the glyph needs one. */
  label: string;
  /** The bubble: the short name, read at a glance. */
  tip: string;
  side: RailSide;
  onClick: () => void;
  badge?: ReactNode;
  expanded?: boolean;
  active?: boolean;
}) {
  return (
    <Tooltip label={tip} placement={side === 'left' ? 'right' : 'left'}>
      <button
        type="button"
        className={`icon-btn rail-strip__btn${active ? ' is-active' : ''}`}
        aria-label={label}
        aria-expanded={expanded}
        onClick={onClick}
      >
        <Icon name={icon} size={16} />
        {badge != null && <span className="rail-strip__badge mono" aria-hidden="true">{badge}</span>}
      </button>
    </Tooltip>
  );
}

/** The left rail shut: Room, Style and Catalog, then the room's health. The dot is
 *  the one thing that must not be hidden with the rail, and it is the reason the
 *  report moved out of a canvas dock in the first place. */
function LeftRailStrip() {
  const toggleRail = useStudio((s) => s.toggleRail);
  const askLeft = useRailIntent((s) => s.askLeft);
  const count = useScene((s) => s.parts.length);
  const openAt = (section: LeftSection) => {
    askLeft(section);
    toggleRail('left');
  };
  return (
    <nav className="rail-strip" aria-label="Room panel">
      <StripButton icon="ruler" tip="Room" label="Open the room's size and walls" side="left" onClick={() => openAt('room')} />
      <StripButton icon="palette" tip="Style" label="Open the room's style and light" side="left" onClick={() => openAt('style')} />
      <StripButton
        icon="list"
        tip={`Catalog · ${count} ${count === 1 ? 'piece' : 'pieces'}`}
        label={`Open the catalog, ${count} ${count === 1 ? 'piece' : 'pieces'} in this room`}
        side="left"
        onClick={() => openAt('pieces')}
        badge={count > 0 ? (count > 99 ? '99+' : count) : undefined}
      />
      <span className="rail-strip__rule" aria-hidden="true" />
      <RoomHealthDot />
    </nav>
  );
}

/** The right rail shut: what is selected, if anything, and Add. Add is here because
 *  it is the one action the right rail's footer offers whatever is selected; the
 *  Library it opens floats over the canvas and needs no open rail. */
function RightRailStrip() {
  const toggleRail = useStudio((s) => s.toggleRail);
  const catalogOpen = useStudio((s) => s.catalogOpen);
  const setCatalogOpen = useStudio((s) => s.setCatalogOpen);
  const selectedId = useStudio((s) => s.selectedPartId);
  const selectedWall = useStudio((s) => s.selectedWall);
  const count = useStudio((s) => s.selection.length);
  const part = useScene((s) => (selectedId ? s.parts.find((p) => p.id === selectedId) : undefined));

  // The selection, drawn as a lit icon: the panel it would open is about it.
  const sel: { icon: IconName; name: string } | null =
    count > 1
      ? { icon: 'layers', name: `${count} selected pieces` }
      : part
        ? { icon: CATEGORY_ICON[part.category] ?? 'cube', name: part.name }
        : selectedWall != null
          ? { icon: 'ruler', name: `Wall ${selectedWall + 1}` }
          : null;

  return (
    <nav className="rail-strip" aria-label="Details panel">
      {sel && (
        <StripButton
          icon={sel.icon}
          tip={`Edit ${sel.name}`}
          label={`Open the details panel for ${sel.name}`}
          side="right"
          onClick={() => toggleRail('right')}
          badge={count > 1 ? count : undefined}
          active
        />
      )}
      <StripButton
        icon="plus"
        tip="Add a piece"
        label="Add a piece to the room"
        side="right"
        onClick={() => setCatalogOpen(!catalogOpen)}
        expanded={catalogOpen}
      />
    </nav>
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
  if (!open) return <RightRailStrip />;
  return (
    <>
      <SelectionHeader />
      {/* The Inspector owns ONE scroll region, and the footer stays pinned below
          it — the same shape the left rail has had all along. (It shared that box
          with a View section until View moved to the top bar's gear; see
          `ViewMenu`. The reasoning below is why it is a box at all.)

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
      </div>
      <RailFooter />
    </>
  );
}

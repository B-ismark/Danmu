'use client';

// A collapsible rail section with a count in its header.
//
// The rail already had `.section` / `.section-head` / `.section-title` /
// `.section-meta` — the shape was right, it just could not close, so everything
// the rail knew was always on screen at once and the piece list got whatever
// height was left over. Drafted's rail is the same idea finished: each section
// states what it holds ("Main Floor · 19 Rooms", "Added Constraints · 2/3
// Enabled") and closes when you are not using it.
//
// The header is a real <button> controlling a region, so this is operable and
// announced rather than being a div that happens to toggle.

import { useId, type ReactNode } from 'react';
import { Icon } from '@/components/ui/Icon';

export function RailSection({
  title,
  meta,
  open,
  onToggle,
  children,
  /** Let the body take the leftover rail height and scroll inside itself. */
  grow = false,
}: {
  title: string;
  /** The count or state this section is responsible for. Derived, never typed. */
  meta?: ReactNode;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
  grow?: boolean;
}) {
  const id = useId();
  return (
    <div
      style={{
        borderBottom: '1px solid var(--hairline)',
        // A grown section owns the leftover space, but only while it is open —
        // a collapsed one must not hold a column of empty rail.
        flex: grow && open ? '1 1 auto' : '0 0 auto',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
      }}
    >
      {/* Box model in `.rail-section-head`, not inline: an inline padding is one
          the rail's container queries cannot narrow, and this header is the left
          rail's whole vocabulary. */}
      <button type="button" onClick={onToggle} aria-expanded={open} aria-controls={id} className="rail-section-head">
        <Icon name={open ? 'chevron-down' : 'chevron-right'} size={12} />
        {/* `flex: 1` sizes the BOX; without `minWidth: 0` this span refuses to go
            below its text and pushes the meta out through the rail's
            `overflow: hidden` instead — no scrollbar, no ellipsis, no clue. The
            title is the designated shrinker because the meta is the derived half
            (a count, a theme name) and clipping a number is worse than clipping a
            word you can still recognise from its first letters. */}
        <span
          className="section-title"
          style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        >
          {title}
        </span>
        {meta != null && (
          <span className="section-meta" style={{ flexShrink: 0, whiteSpace: 'nowrap' }}>
            {meta}
          </span>
        )}
      </button>

      {open && (
        <div
          id={id}
          className="rail-section-body"
          style={grow ? { flex: '1 1 auto', display: 'flex', flexDirection: 'column' } : undefined}
        >
          {children}
        </div>
      )}
    </div>
  );
}

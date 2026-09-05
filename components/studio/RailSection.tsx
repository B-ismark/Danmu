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
//
// **The header is a ROW containing that button, not the button itself**, and the
// difference is the `action` slot. A control belonging to the section rather than
// to the disclosure — Room's Re-scan — cannot be a child of the toggle: nesting
// interactive content inside a <button> is invalid HTML and a `jsx-a11y` failure,
// which at `--max-warnings 0` is a red build rather than a warning nobody reads.
// So `.rail-section-head` is the padded flex row (and stays that class, because
// the 240px container query and `tests/reflow.test.ts` both name it), the
// disclosure is `.rail-section-toggle` inside it with no padding of its own, and
// the action sits beside the toggle as a sibling.

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
  action,
  /** Paint the section's bottom hairline. The rail's pinned footer already separates
   *  the last section with its `--paper-2` tone, and a hairline directly above that
   *  band is the defect globals.css documents as reading like a stray scrollbar — so
   *  the section that sits immediately above the footer passes `false` here. */
  divider = true,
}: {
  title: string;
  /** The count or state this section is responsible for. Derived, never typed. */
  meta?: ReactNode;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
  grow?: boolean;
  /** ONE control for the section as a whole, trailing in the header and outside
   *  the disclosure button — see the note above. It stays on screen while the
   *  section is closed, which is the point: it is about the section, not about
   *  what the section is currently showing. */
  action?: ReactNode;
  divider?: boolean;
}) {
  const id = useId();
  return (
    <div
      style={{
        borderBottom: divider ? '1px solid var(--hairline)' : 'none',
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
      <div className="rail-section-head">
        <button type="button" onClick={onToggle} aria-expanded={open} aria-controls={id} className="rail-section-toggle">
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
        {action}
      </div>

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

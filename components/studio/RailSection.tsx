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
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={id}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          width: '100%',
          padding: '11px 16px',
          background: 'transparent',
          border: 0,
          cursor: 'pointer',
          textAlign: 'left',
          font: 'inherit',
        }}
      >
        <Icon name={open ? 'chevron-down' : 'chevron-right'} size={12} />
        <span className="section-title" style={{ flex: 1 }}>
          {title}
        </span>
        {meta != null && <span className="section-meta">{meta}</span>}
      </button>

      {open && (
        <div
          id={id}
          style={{
            padding: '0 16px 14px',
            minHeight: 0,
            ...(grow ? { flex: '1 1 auto', display: 'flex', flexDirection: 'column' } : {}),
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

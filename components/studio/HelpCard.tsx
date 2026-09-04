'use client';

// The parts a help panel is built from — the card, its groups, its lines, its
// keycaps. Both studio tabs' help is assembled out of these, so the two describe
// the same app in the same chrome; only the content differs, and it lives in
// `StudioHelp.tsx` for both rather than in either page.
//
// The chip that OPENS the card is not here. It used to be — a `HelpToggle` that
// bundled chip and card together for the canvas's bottom-left corner — and
// `StudioHelp` replaced it by moving help into the top bar and anchoring the coach
// marks under the same "?". The bundled version stayed behind unused for a while
// afterwards, which is the only reason to mention it: help is one surface, and a
// second control that opens the same card in a different corner is not a spare, it
// is a fork.

import { type ReactNode } from 'react';
import { IconButton } from '@/components/ui/primitives';

export function HelpCard({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div
      className="ds-card"
      role="note"
      // A scroll box needs to be focusable or a keyboard-only user cannot scroll it.
      // Firefox focuses an overflow container on its own; Chrome and Edge do not, so
      // without this the card is simply unreachable below its own fold in the two
      // browsers most people use — and a Firefox check would pass and call it done.
      // Measured on the plan card: 950px of content in a 420px box, ONE focusable
      // descendant, and it is the Close button in the sticky header.
      tabIndex={0}
      style={{
        padding: 0,
        boxShadow: 'var(--shadow-lift)',
        maxHeight: 'min(420px, 60vh)',
        overflow: 'auto',
        // Capped against the window as well as stated: this card is placed by
        // whoever renders it, and none of those slots can promise it 320px.
        width: 'min(320px, calc(100vw - 32px))',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 10px 10px 14px',
          borderBottom: '1px solid var(--hairline)',
          position: 'sticky',
          top: 0,
          background: 'var(--paper)',
          // Its own rung on the scale rather than a bare 1 — this header lifts over
          // the rows scrolling under it inside this card's own scroll box.
          zIndex: 'var(--z-sticky-local)',
        }}
      >
        <span style={{ fontSize: 12.5, fontWeight: 700, flex: 1 }}>{title}</span>
        <IconButton icon="x" label="Close help" onClick={onClose} size={24} iconSize={12} />
      </div>
      {children}
    </div>
  );
}

export function HelpGroup({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <div style={{ padding: '10px 14px 12px', borderBottom: '1px solid var(--hairline-soft)' }}>
      <div className="ds-label" style={{ marginBottom: 6 }}>
        {title}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>{children}</div>
      {note && <div style={{ fontSize: 11, color: 'var(--ink-3)', lineHeight: 1.45, marginTop: 7 }}>{note}</div>}
    </div>
  );
}

export function HelpLine({ children }: { children: ReactNode }) {
  return <div style={{ fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.5 }}>{children}</div>;
}

// Keycaps in the sans face, not mono: a keycap is a real convention, but this
// product's monospace is reserved for numerals and measurements.
export function Kb({ children }: { children: ReactNode }) {
  return (
    <kbd
      style={{
        fontFamily: 'var(--font-sans)',
        fontSize: 10.5,
        fontWeight: 700,
        color: 'var(--ink)',
        padding: '1px 5px',
        background: 'var(--paper-2)',
        border: '1px solid var(--hairline-strong)',
        borderRadius: 'var(--r-1)',
        marginRight: 3,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </kbd>
  );
}

'use client';

// How the studio explains itself — one component, both tabs.
//
// The 3D view had this: a single "How this works" chip in the bottom-left corner
// that opens a card, closes on Esc, and gives the focus back to the chip it came
// from. The 2D plan instead nailed a permanent four-line paragraph to the
// bottom-right corner of the drawing, where it covered the room and could not be
// dismissed — a different answer to the same question, on the tab where it got in
// the way most.
//
// The content differs per tab, because the two are genuinely driven differently.
// The chrome does not.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/primitives';
import { isTypingOrDialog } from './KeyboardShortcuts';

/** The chip and the card it opens, as one control. Anchor it with a positioned
 *  parent; it fills that parent's width up to the card's own. */
export function HelpToggle({ children, label = 'How this works' }: { children: ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);

  // Esc closes it, and the key must not also reach the canvas underneath — the
  // studio's global handler reads Esc as "deselect", and one press doing both is
  // two things the user did not ask for.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape' || isTypingOrDialog(e.target)) return;
      e.stopPropagation();
      setOpen(false);
      btnRef.current?.focus();
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open]);

  return (
    <>
      {open && (
        <HelpCard
          title={label}
          onClose={() => {
            setOpen(false);
            btnRef.current?.focus();
          }}
        >
          {children}
        </HelpCard>
      )}
      {/* A question mark rather than the sentence. The label is still the
          accessible name and the tooltip — it just stops taking 150px of a corner
          the drawing wants, on a control that gets pressed once. */}
      <button
        ref={btnRef}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={label}
        title={label}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 30,
          height: 30,
          borderRadius: 'var(--r-full)',
          cursor: 'pointer',
          border: `1px solid ${open ? 'var(--accent-text)' : 'var(--edge)'}`,
          background: open ? 'var(--accent-tint)' : 'var(--paper)',
          color: open ? 'var(--accent-text)' : 'var(--ink-2)',
          boxShadow: 'var(--shadow-soft)',
        }}
      >
        <Icon name="help" size={15} />
      </button>
    </>
  );
}

export function HelpCard({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div
      className="ds-card"
      role="note"
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

'use client';

// The 3D tab's one canvas widget — where you are standing, in the corner every
// 3D tool puts that control.
//
// It replaces a four-chip segmented row (Front / Top / Iso / Free) that spelled
// the presets out in text inside the bottom-right dock. The dock is gone; a
// compact 2×2 of glyphs says the same thing in a quarter of the width and reads
// as native to a 3D tool rather than as a row of tabs that wandered onto the
// canvas.
//
// The four destinations are unchanged — they are still exactly `CameraRig`'s
// PRESETS, addressed through `useStudio.viewPreset`, so this is a new control
// over old behaviour and nothing about the camera moved.

import type { ReactNode } from 'react';
import { useStudio } from '@/lib/store';

type Preset = 'front' | 'top' | 'iso' | 'free';

const CELLS: Array<{ value: Preset; label: string; glyph: ReactNode }> = [
  {
    value: 'top',
    label: 'Look down from above',
    // A plan square: the room seen from directly overhead.
    glyph: (
      <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
        <rect x="3.5" y="3.5" width="9" height="9" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
      </svg>
    ),
  },
  {
    value: 'front',
    // An elevation: one wall, straight on.
    label: 'Look straight at the front wall',
    glyph: (
      <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
        <rect x="3.5" y="5" width="9" height="7" rx="1" fill="none" stroke="currentColor" strokeWidth="1.4" />
        <line x1="3.5" y1="12" x2="12.5" y2="12" stroke="currentColor" strokeWidth="1.8" />
      </svg>
    ),
  },
  {
    value: 'iso',
    // A corner-on box: two faces and a top.
    label: 'Look from the corner',
    glyph: (
      <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
        <path d="M8 2.6 13.4 5.6v4.8L8 13.4 2.6 10.4V5.6Z" fill="none" stroke="currentColor" strokeWidth="1.3" />
        <path d="M8 2.6v4.3m0 0 5.4-1.3M8 6.9 2.6 5.6" fill="none" stroke="currentColor" strokeWidth="1.1" />
      </svg>
    ),
  },
  {
    value: 'free',
    // An orbit ring: the camera is yours again.
    label: 'Move the camera yourself',
    glyph: (
      <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
        <circle cx="8" cy="8" r="4.6" fill="none" stroke="currentColor" strokeWidth="1.4" />
        <ellipse cx="8" cy="8" rx="4.6" ry="1.9" fill="none" stroke="currentColor" strokeWidth="1.1" />
      </svg>
    ),
  },
];

export function ViewGizmo() {
  const view = useStudio((s) => s.viewPreset);
  const setView = useStudio((s) => s.setView);

  return (
    <div
      role="group"
      aria-label="Camera"
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(2, 28px)',
        gap: 2,
        padding: 3,
        background: 'var(--paper)',
        border: '1px solid var(--edge)',
        borderRadius: 'var(--r-2)',
        boxShadow: 'var(--shadow-soft)',
      }}
    >
      {CELLS.map((c) => {
        const on = view === c.value;
        return (
          <button
            key={c.value}
            type="button"
            onClick={() => setView(c.value)}
            aria-pressed={on}
            aria-label={c.label}
            title={c.label}
            style={{
              width: 28,
              height: 28,
              display: 'grid',
              placeItems: 'center',
              cursor: 'pointer',
              border: 0,
              borderRadius: 'var(--r-1)',
              background: on ? 'var(--accent-tint)' : 'transparent',
              color: on ? 'var(--accent-text)' : 'var(--ink-2)',
            }}
          >
            {c.glyph}
          </button>
        );
      })}
    </div>
  );
}

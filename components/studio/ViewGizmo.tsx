'use client';

// The 3D tab's one canvas widget — where you are standing, in the corner every
// 3D tool puts that control.
//
// Three words in one pill: Corner, Front, Top. On a phone, or wherever the canvas is too
// narrow to hold them, the same three buttons fall back to their glyphs at 40px (the
// `.gizmo` container query). 'free' is not a button: it is the state the camera enters
// when the user orbits it (`CameraRig`), and in it none of the three is pressed.
//
// The destinations are still exactly `CameraRig`'s PRESETS, addressed through
// `useStudio.viewPreset`.

import type { ReactNode } from 'react';
import { useStudio } from '@/lib/store';
import { usePhoneStudio } from './NarrowViewportBanner';

type Preset = 'front' | 'top' | 'iso';

const CELLS: Array<{ value: Preset; word: string; label: string; glyph: ReactNode }> = [
  {
    value: 'iso',
    word: 'Corner',
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
    value: 'front',
    word: 'Front',
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
    value: 'top',
    word: 'Top',
    label: 'Look down from above',
    // A plan square: the room seen from directly overhead.
    glyph: (
      <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
        <rect x="3.5" y="3.5" width="9" height="9" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
      </svg>
    ),
  },
];

export function ViewGizmo() {
  const view = useStudio((s) => s.viewPreset);
  const setView = useStudio((s) => s.setView);
  // Under a thumb the cells are 40px glyphs; on a laptop they are words.
  const phone = usePhoneStudio();

  return (
    <div
      role="group"
      aria-label="Camera"
      // Surface in globals.css (`.gizmo`), so the laptop's glass can replace it.
      className={phone ? 'gizmo gizmo--glyphs' : 'gizmo'}
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
            className="gizmo__btn"
            data-on={on ? '' : undefined}
          >
            <span className="gizmo__word">{c.word}</span>
            <span className="gizmo__glyph">{c.glyph}</span>
          </button>
        );
      })}
    </div>
  );
}

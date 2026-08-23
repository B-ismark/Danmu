'use client';

// Prototype 2 — the panels adapt and the user does nothing.
//
// Two changes, no new gestures:
//
// · A ladder instead of a boolean. Between 1024 and 1279px the rails drop to
//   their floors and the room takes the difference (~110px at 1024). Above that
//   nothing moves. This is a *width* decision only — it never writes the user's
//   collapse preference, which is the trap an auto-collapse falls into: the
//   preference is what they want at full width, and second-guessing it means
//   fighting a persisted choice every time the window crosses a threshold.
//
// · `rail--elastic` makes each rail a query container, so the controls inside
//   answer to the rail's own width rather than the viewport's. That is what makes
//   the floors honest: a floor is only a width the design allows if the contents
//   still lay out there. Media queries cannot ask this question — a rail is 260px
//   whether the window is 1024px or 3440px, and `@media (max-width: 720px)` on a
//   label/control row is answering about the wrong box entirely.

import type { ReactNode } from 'react';
import { useStudioLayout } from '../NarrowViewportBanner';
import { DockedShell } from './DockedShell';

export function ElasticShell({ surface }: { surface: ReactNode }) {
  const { layout } = useStudioLayout();
  return (
    <DockedShell
      surface={surface}
      stacked={layout === 'stacked'}
      widths={layout === 'compact' ? 'tight' : 'token'}
      railModifier="rail--elastic"
    />
  );
}

'use client';

// The studio's fallback gate — and it is now genuinely a fallback.
//
// The old version blocked at `max-width: 1023px`. Browser zoom shrinks the
// CSS-pixel viewport, so 200% on a 1280px laptop reports 640px: a low-vision
// user exercising an explicit WCAG AA allowance was told "Studio runs on
// desktop" and had to opt out through a warning, every single reload. It also
// let iPad Pro landscape — exactly 1024px — walk straight into a pointer-only UI.
//
// So the gate asks two much narrower questions instead of one about width:
//   · is this a touch-only pointer (no hover, coarse)? That is the real
//     limitation, and it catches the iPad case width never could.
//   · is the viewport under the reflow floor (400px)? Far below any zoom level
//     a laptop can reach.
// Everything between that floor and full width now *reflows* — see
// `useStackedStudio`, which both studio pages read.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Icon } from '@/components/ui/Icon';
import { Modal } from '@/components/ui/Modal';
import { useMediaQuery, useMediaQueryState } from '@/lib/use-media-query';

/** Below this the studio cannot lay out at all. Chosen to sit under WCAG 1.4.10's
 *  320px reflow target plus chrome, and far under any browser-zoom viewport. */
const MIN_WIDTH = 400;
/** At or below this the rails stack under the canvas instead of flanking it. */
const STACK_WIDTH = 1023;
/** At or below this there is room for three columns but not three comfortable
 *  ones: 1024px with both rails at their token widths leaves the room less width
 *  than the panels beside it. A step between "stack everything" and "full
 *  width", which one boolean cannot express — tldraw carries a 0–7 ladder for
 *  the same reason. */
const COMPACT_WIDTH = 1279;
const DISMISS_KEY = 'danmu-studio-gate-dismissed';

/** Whether the studio should stack its rails under the canvas rather than sit in
 *  three fixed columns. Exported from here so the reflow threshold and the gate's
 *  thresholds can never drift apart.
 *
 *  Returns `ready` as well as `stacked`, because this decides a whole layout AND
 *  the DOM order of three children. Reporting `false` on the first render meant a
 *  narrow viewport painted the 260px / 1fr / 320px shell and then re-ordered and
 *  re-flowed to the stacked one — a layout shift on exactly the devices least able
 *  to absorb it. Callers hold their shell back until this is true. */
export function useStackedStudio(): { stacked: boolean; ready: boolean } {
  const { layout, ready } = useStudioLayout();
  return { stacked: layout === 'stacked', ready };
}

/** The three steps, as a name, so `DockedShell` can take one as a prop rather
 *  than restate the union and drift from it. */
export type StudioLayout = 'wide' | 'compact' | 'stacked';

/** How much room the studio has, as three steps rather than one boolean.
 *
 *  `wide`    — rails at their token widths, which is what they were sized for.
 *  `compact` — rails at `--rail-*-tight`. The room gets the difference (~94px).
 *  `stacked` — rails below the room; see `useStackedStudio`.
 *
 *  Derived here, beside the thresholds, so a consumer can never introduce a
 *  fourth number for the same decision. */
export function useStudioLayout(): { layout: StudioLayout; ready: boolean } {
  const stack = useMediaQueryState(`(max-width: ${STACK_WIDTH}px)`);
  const compact = useMediaQueryState(`(max-width: ${COMPACT_WIDTH}px)`);
  return {
    layout: stack.matches ? 'stacked' : compact.matches ? 'compact' : 'wide',
    // Both, or a first paint can be told "not stacked" by one query while the
    // other has not answered — which is the layout shift `ready` exists to stop.
    ready: stack.ready && compact.ready,
  };
}

export function NarrowViewportBanner() {
  const touch = useMediaQuery('(hover: none) and (pointer: coarse)');
  const narrow = useMediaQuery(`(max-width: ${MIN_WIDTH - 1}px)`);
  const reason: 'touch' | 'narrow' | null = touch ? 'touch' : narrow ? 'narrow' : null;
  // Start dismissed so a previously-dismissed gate never flashes before
  // localStorage has been read.
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    setDismissed(localStorage.getItem(DISMISS_KEY) === '1');
  }, []);

  if (!reason || dismissed) return null;

  // Esc / backdrop-less close dismisses for this session only. Choosing to open
  // the studio anyway is a decision worth remembering; pressing Escape is not.
  return (
    <Modal
      onClose={() => setDismissed(true)}
      labelledBy="studio-gate-title"
      width={470}
      closeOnBackdrop={false}
      footer={
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}>
          <Link
            href="/onboarding/capture"
            className="ds-btn ds-btn--primary"
            style={{ height: 42, justifyContent: 'center', fontSize: 14 }}
          >
            <Icon name="camera" size={14} />
            Photograph the room here
          </Link>
          <div style={{ display: 'flex', gap: 8 }}>
            <Link
              href="/workspace"
              className="ds-btn"
              style={{ flex: 1, height: 38, justifyContent: 'center', fontSize: 13 }}
            >
              <Icon name="arrow-left" size={12} /> All rooms
            </Link>
            <button
              onClick={() => {
                localStorage.setItem(DISMISS_KEY, '1');
                setDismissed(true);
              }}
              className="ds-btn"
              style={{ flex: 1, height: 38, justifyContent: 'center', fontSize: 13 }}
            >
              Open it anyway
            </button>
          </div>
        </div>
      }
    >
      <h1 id="studio-gate-title" style={{ fontSize: 24, lineHeight: 1.15, marginBottom: 10 }}>
        {reason === 'touch' ? 'The studio wants a mouse or trackpad.' : 'This window is too narrow to lay out.'}
      </h1>
      <p style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.55, margin: '0 0 10px' }}>
        {reason === 'touch'
          ? 'Decorating means dragging furniture a centimetre at a time, nudging walls and scrubbing dimensions — all of which need a pointer that can hover. On a phone or tablet those gestures fight you.'
          : `The parts list, the room and the inspector need at least ${MIN_WIDTH}px of width between them. Widen the window, or zoom out a step.`}
      </p>
      <p style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.55, margin: 0 }}>
        Photographing the room <b>is</b> built for this device, though — shoot your walls here and the room will be
        waiting when you open Danmu on a laptop.
      </p>
      <p style={{ fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.5, margin: '10px 0 0' }}>
        Opening it anyway works, and it is remembered — some panels will just be cramped.
      </p>
    </Modal>
  );
}

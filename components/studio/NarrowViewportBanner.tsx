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

/** Below this the studio cannot lay out at all. Chosen to sit under WCAG 1.4.10's
 *  320px reflow target plus chrome, and far under any browser-zoom viewport. */
const MIN_WIDTH = 400;
/** At or below this the rails stack under the canvas instead of flanking it. */
const STACK_WIDTH = 1023;
const DISMISS_KEY = 'danmu-studio-gate-dismissed';

/** True when the studio should stack its rails under the canvas rather than sit
 *  in three fixed columns. Exported from here so the reflow threshold and the
 *  gate's thresholds can never drift apart. */
export function useStackedStudio(): boolean {
  const [stacked, setStacked] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${STACK_WIDTH}px)`);
    const update = () => setStacked(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return stacked;
}

export function NarrowViewportBanner() {
  const [reason, setReason] = useState<'touch' | 'narrow' | null>(null);
  // Start dismissed so a previously-dismissed gate never flashes before
  // localStorage has been read.
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    setDismissed(localStorage.getItem(DISMISS_KEY) === '1');
    const touch = window.matchMedia('(hover: none) and (pointer: coarse)');
    const narrow = window.matchMedia(`(max-width: ${MIN_WIDTH - 1}px)`);
    const update = () => setReason(touch.matches ? 'touch' : narrow.matches ? 'narrow' : null);
    update();
    touch.addEventListener('change', update);
    narrow.addEventListener('change', update);
    return () => {
      touch.removeEventListener('change', update);
      narrow.removeEventListener('change', update);
    };
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

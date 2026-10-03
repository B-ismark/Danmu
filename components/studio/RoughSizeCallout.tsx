'use client';

// "These are typical sizes" — the callout beside the Room section's size fields while
// a room still stands at its shape's typical size (`RoomData.roughSize`).
//
// It used to be an inline note inside the section, which put a paragraph between the
// section's header and the boxes it was talking about. It floats now, to the right of
// the Width / Depth / Height fields, and it can be sent away.
//
// WHY A PORTAL AND `position: fixed`: `.rail` is `overflow: hidden` AND a size
// container (`container-type: inline-size`), and layout containment makes it the
// containing block of a fixed descendant — so a card rendered inside the rail is
// clipped to it however it is positioned. It is rendered into `document.body` and
// MEASURED against the anchor (`[data-room-dims]`, the fields row), like `ui/Select`.
// It re-measures on resize, on any scroll (capture, so the rail's own scroll box
// counts) and when the anchor's box changes, and it renders nothing while the anchor
// is not visible: the rail or the Room section collapsed, or scrolled out of the rail.
//
// Dismissal is for the session and per room: a module-level set, not storage. A
// reload is a new session and the note is true again, which is the point of it.
// Typing a size, or "These are right", clears `roughSize` and takes it away anyway.
//
// On a phone there is no room beside the rail (the rail is a sheet), so it is a card
// at the top of the screen instead, same content and the same ✕.
//
// A non-modal `role="note"` with a label: nothing here asks for an answer, and focus
// is never moved onto it. Escape closes it while focus is inside it.

import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { useParams } from 'next/navigation';
import { useScene } from '@/lib/scene-store';
import { Icon } from '@/components/ui/Icon';
import { usePhoneStudio } from './NarrowViewportBanner';

const dismissed = new Set<string>();
const listeners = new Set<() => void>();
function dismissRoughCallout(roomId: string) {
  dismissed.add(roomId);
  listeners.forEach((l) => l());
}
function subscribe(l: () => void) {
  listeners.add(l);
  return () => void listeners.delete(l);
}

/** Gap between the card's pointer tip and the fields. */
const GAP = 12;

type Spot = { left: number; top: number } | null;

function measure(anchor: Element | null): Spot {
  if (!anchor) return null;
  const r = anchor.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return null;
  // Clip against the rail: a row scrolled out of its box has a rect and no pixels.
  const rail = anchor.closest('.rail-scroll, .rail');
  const clip = rail ? rail.getBoundingClientRect() : null;
  const top = Math.max(0, clip ? clip.top : 0);
  const bottom = Math.min(window.innerHeight, clip ? clip.bottom : window.innerHeight);
  if (r.bottom <= top || r.top >= bottom) return null;
  const left = (clip ? Math.max(r.right, clip.right) : r.right) + GAP;
  if (left > window.innerWidth - 120) return null;
  const mid = Math.min(Math.max(r.top + r.height / 2, top + 24), bottom - 24);
  return { left, top: mid };
}

export function RoughSizeCallout() {
  const { roomId } = useParams<{ roomId: string }>();
  const rough = useScene((s) => s.room.roughSize === true);
  const hydrated = useScene((s) => s.hydratedRoomId === roomId);
  const confirmSize = useScene((s) => s.confirmSize);
  const phone = usePhoneStudio();
  const gone = useSyncExternalStore(subscribe, () => dismissed.has(roomId), () => false);
  const [spot, setSpot] = useState<Spot>(null);
  const [mounted, setMounted] = useState(false);

  const show = rough && hydrated && !gone && !!roomId;

  useEffect(() => setMounted(true), []);

  useLayoutEffect(() => {
    if (!show || phone) return;
    const anchor = document.querySelector('[data-room-dims]');
    const update = () => setSpot(measure(anchor));
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    if (anchor && ro) {
      ro.observe(anchor);
      const rail = anchor.closest('.rail');
      if (rail) ro.observe(rail);
    }
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
      ro?.disconnect();
    };
  }, [show, phone]);

  if (!show || !mounted) return null;
  if (!phone && !spot) return null;

  return createPortal(
    <div
      className={`rough-callout${phone ? ' rough-callout--phone' : ''}`}
      style={phone || !spot ? undefined : { left: spot.left, top: spot.top }}
      role="note"
      aria-label="About this room's sizes"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          dismissRoughCallout(roomId);
        }
      }}
    >
      {!phone && <span className="rough-callout__arrow" aria-hidden="true" />}
      <button
        type="button"
        className="icon-btn rough-callout__close"
        aria-label="Dismiss"
        onClick={() => dismissRoughCallout(roomId)}
      >
        <Icon name="x" size={14} />
      </button>
      <p className="rough-callout__title">
        <Icon name="info" size={14} /> These are typical sizes
      </p>
      <p className="rough-callout__text">Measure your room and type the real width, depth and height.</p>
      <button type="button" className="ds-btn ds-btn--primary ds-btn--sm rough-callout__confirm" onClick={confirmSize}>
        These are right
      </button>
    </div>,
    document.body,
  );
}

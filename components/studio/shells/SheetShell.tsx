'use client';

// The studio on a phone or a tablet: the room fills the screen, and the two rails
// become one bottom sheet with a tab each.
//
// This replaces the stacked layout, which put the rails UNDER the room as page
// content: the room got a fixed ~55% of the height, and reaching the Inspector meant
// scrolling the whole studio — the canvas included — out of view. A sheet is the
// shape phones already teach (maps, music, photos): the room keeps the screen, and
// the panels rise over it only when asked.
//
// Docked, not floating, is still the rule on a laptop — see `DockedShell` for why
// (the piece you are placing is the thing that hides under a floating panel). A
// sheet is not an exception to that rule so much as the version of it a small
// screen can afford: at REST it covers nothing, because its resting height is a row
// of the grid, not an overlay. It overlays only while open, which is when you are
// working in it rather than in the room.
//
// **Selecting a piece switches the tab and does not open the sheet.** Tapping a
// piece on a phone is also how you start dragging it; a sheet that rose on every tap
// would cover the room at exactly the moment the room is the thing in use. The tab's
// label takes the piece's name instead, so the selection is visible at rest.

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { useStudio } from '@/lib/store';
import { useScene } from '@/lib/scene-store';
import { LeftRailBody, RightRailBody } from './shell-parts';

export type SheetSnap = 'peek' | 'half' | 'full';
type SheetTab = 'room' | 'details';

/** A drag shorter than this is a tap on the handle, not a resize. */
const TAP_PX = 6;

/** Where a released drag settles: the nearest resting height, with a flick
 *  (fast enough to mean it) carrying one step further in its direction. Pure, so
 *  the rule is testable without a pointer. `heights` are the three resting heights
 *  in px, in `peek, half, full` order. */
export function settleSheet(heightPx: number, velocityPxPerMs: number, heights: [number, number, number]): SheetSnap {
  const order: SheetSnap[] = ['peek', 'half', 'full'];
  let nearest = 0;
  for (let i = 1; i < 3; i++) if (Math.abs(heights[i] - heightPx) < Math.abs(heights[nearest] - heightPx)) nearest = i;
  // Upward is a NEGATIVE clientY delta, so a positive `velocity` here means rising.
  const FLICK = 0.5;
  if (velocityPxPerMs > FLICK && heightPx > heights[nearest]) nearest = Math.min(2, nearest + 1);
  if (velocityPxPerMs < -FLICK && heightPx < heights[nearest]) nearest = Math.max(0, nearest - 1);
  return order[nearest];
}

export function SheetShell({ surface }: { surface: ReactNode }) {
  const [snap, setSnap] = useState<SheetSnap>('peek');
  const [tab, setTab] = useState<SheetTab>('room');
  const sheetRef = useRef<HTMLElement>(null);
  const drag = useRef<{ y: number; h: number; t: number; lastY: number; lastT: number; moved: boolean } | null>(null);

  const selectedPartId = useStudio((s) => s.selectedPartId);
  const selectionCount = useStudio((s) => s.selection.length);
  const selectedWall = useStudio((s) => s.selectedWall);
  const selectedName = useScene((s) => s.parts.find((p) => p.id === selectedPartId)?.name);

  const hasSelection = selectedPartId != null || selectedWall != null;
  const detailsLabel =
    selectionCount > 1
      ? `${selectionCount} selected`
      : selectedName ?? (selectedWall != null ? `Wall ${selectedWall + 1}` : 'Details');

  // A new selection points the sheet at what acts on it. Keyed on the ids, not on
  // "anything selected", so picking a second piece while Room is showing switches too.
  useEffect(() => {
    if (hasSelection) setTab('details');
  }, [selectedPartId, selectedWall, hasSelection]);

  // Escape lowers the sheet — but only when focus is inside it, so Escape in the
  // room keeps meaning what the studio's shortcuts say it means.
  useEffect(() => {
    const el = sheetRef.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && snap !== 'peek' && !e.defaultPrevented) {
        e.stopPropagation();
        setSnap('peek');
      }
    };
    el.addEventListener('keydown', onKey);
    return () => el.removeEventListener('keydown', onKey);
  }, [snap]);

  const restingHeights = (): [number, number, number] => {
    const el = sheetRef.current;
    const shell = el?.parentElement;
    if (!el || !shell) return [0, 0, 0];
    const css = getComputedStyle(shell);
    const px = (name: string) => parseFloat(css.getPropertyValue(name)) || 0;
    const total = shell.clientHeight;
    return [px('--sheet-peek'), total * 0.55, total - px('--sheet-top-gap')];
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    // The tabs inside the bar are buttons; a press on one is a press, not a drag.
    if ((e.target as HTMLElement).closest('[role="tab"]')) return;
    const el = sheetRef.current;
    if (!el) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const now = performance.now();
    drag.current = { y: e.clientY, h: el.getBoundingClientRect().height, t: now, lastY: e.clientY, lastT: now, moved: false };
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const el = sheetRef.current;
    if (!d || !el) return;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.abs(dy) < TAP_PX) return;
    d.moved = true;
    const [peek, , full] = restingHeights();
    const h = Math.min(full, Math.max(peek, d.h - dy));
    el.dataset.dragging = '1';
    el.style.height = `${h}px`;
    d.lastY = e.clientY;
    d.lastT = performance.now();
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const el = sheetRef.current;
    drag.current = null;
    if (!d || !el) return;
    if (!d.moved) {
      // A tap on the handle: open a resting sheet, lower an open one.
      setSnap(snap === 'peek' ? 'half' : 'peek');
      return;
    }
    const dt = Math.max(1, performance.now() - d.lastT);
    // Rising is a negative clientY step; flip it so positive means "up".
    const velocity = -(e.clientY - d.lastY) / dt;
    const next = settleSheet(el.getBoundingClientRect().height, velocity, restingHeights());
    delete el.dataset.dragging;
    el.style.height = '';
    setSnap(next);
  };

  const choose = (t: SheetTab) => {
    setTab(t);
    if (snap === 'peek') setSnap('half');
  };

  const open = snap !== 'peek';

  return (
    <div className="sheet-shell">
      <div className="sheet-shell__room">{surface}</div>
      <section
        ref={sheetRef}
        className="sheet"
        data-snap={snap}
        aria-label="Studio panels"
      >
        <div
          className="sheet__bar"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <button
            type="button"
            className="sheet__handle"
            aria-expanded={open}
            aria-controls="studio-sheet-body"
            aria-label={open ? 'Lower the panel' : 'Raise the panel'}
            // The bar's own pointer handlers already turn a tap into a toggle; a
            // click here is the keyboard's Enter / Space, which has no pointer.
            onClick={(e) => {
              if (e.detail === 0) setSnap(open ? 'peek' : 'half');
            }}
          >
            <span aria-hidden="true" />
          </button>
          <div className="sheet__tabs" role="tablist" aria-label="Panel">
            <button
              type="button"
              role="tab"
              id="studio-sheet-tab-room"
              aria-selected={tab === 'room'}
              aria-controls="studio-sheet-body"
              className="sheet__tab"
              onClick={() => choose('room')}
            >
              <span className="truncate">Room</span>
            </button>
            <button
              type="button"
              role="tab"
              id="studio-sheet-tab-details"
              aria-selected={tab === 'details'}
              aria-controls="studio-sheet-body"
              className="sheet__tab"
              onClick={() => choose('details')}
            >
              {hasSelection && <span className="sheet__tab-dot" aria-hidden="true" />}
              <span className="truncate">{detailsLabel}</span>
            </button>
          </div>
        </div>
        {/* Both bodies stay mounted, as they do on a laptop: the catalog's search
            and a half-typed dimension survive switching tabs. `hidden` rather than
            unmounting, and the whole body is inert at rest so a keyboard cannot
            tab into a panel nobody can see. */}
        <div
          id="studio-sheet-body"
          className="sheet__body"
          role="tabpanel"
          aria-labelledby={tab === 'room' ? 'studio-sheet-tab-room' : 'studio-sheet-tab-details'}
          inert={!open}
        >
          <div className="rail sheet__rail" hidden={tab !== 'room'}>
            <LeftRailBody open />
          </div>
          <div className="rail sheet__rail" hidden={tab !== 'details'}>
            <RightRailBody open />
          </div>
        </div>
      </section>
    </div>
  );
}

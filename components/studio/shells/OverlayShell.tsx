'use client';

// Prototype 3 — the canvas never resizes.
//
// The room fills the whole work surface and the rails float on top of it, so
// opening, closing or animating a panel changes no box the canvas can see: no
// grid reflow, no `setSize`, no re-render of the R3F tree, nothing for the
// ResizeObserver to report. It is the smoothest of the three by construction,
// and that is the only claim it makes cheaply.
//
// What it costs is occlusion, and this is built to measure that rather than to
// assume it away. Figma shipped exactly this shape in the UI3 beta and reverted
// to fixed panels for the full rollout; the open question is whether a room you
// are arranging furniture inside behaves like a canvas of rectangles. Two things
// stand in the way and are handled here rather than hidden:
//
// · The canvas chrome would sit under the panels. The shell publishes how much of
//   each edge is covered as `--canvas-inset-*`, and `CanvasChrome` offsets its
//   slots by it — so the tool cluster centres on the room you can see, not on the
//   element.
// · A drop under a panel would raycast into a room you cannot see. Not solved
//   here: it is one of the things the comparison is FOR, and papering over it
//   would hide the cost being measured.

import { useEffect, type CSSProperties, type ReactNode } from 'react';
import { useStudio } from '@/lib/store';
import { LeftRailBody, RailToggle, RightRailBody, useRails } from './shell-parts';
import { isTypingOrDialog } from '../KeyboardShortcuts';
import { RAIL_ID } from './DockedShell';

/** Inset from the work surface's edges. Enough to read as floating without
 *  spending real canvas on a margin. */
const GAP = 8;

export function OverlayShell({ surface, stacked }: { surface: ReactNode; stacked: boolean }) {
  const { leftOpen, rightOpen, toggleRail } = useRails();

  // Figma's Minimise-UI key. Self-contained rather than added to the studio's
  // global shortcut table, because this shell is a candidate and not a feature
  // yet — if it wins, the binding moves to KeyboardShortcuts with the rest.
  useEffect(() => {
    if (stacked) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== '\\' || !e.shiftKey || isTypingOrDialog(e.target)) return;
      e.preventDefault();
      const s = useStudio.getState();
      const hiding = s.railLeftOpen || s.railRightOpen;
      if (s.railLeftOpen === hiding) s.toggleRail('left');
      if (s.railRightOpen === hiding) s.toggleRail('right');
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [stacked]);

  // Stacked stays stacked. A floating panel over a 55dvh room on a narrow window
  // would cover the thing it is describing, and there is no width to float in.
  if (stacked) {
    return (
      <div
        className="split"
        style={{
          gridTemplateColumns: '1fr',
          gridTemplateRows: 'minmax(300px, 55dvh) auto auto',
          height: '100%',
          overflow: 'auto',
        }}
      >
        {[
          surface,
          <aside key="tree" id={RAIL_ID.left} className="rail rail--left" style={STACKED_RAIL}>
            <LeftRailBody open />
          </aside>,
          <aside key="inspector" id={RAIL_ID.right} className="rail rail--right" style={STACKED_RAIL}>
            <RightRailBody open />
          </aside>,
        ]}
      </div>
    );
  }

  const floating = (side: 'left' | 'right', open: boolean) =>
    ({
      position: 'absolute',
      top: GAP,
      bottom: GAP,
      [side]: GAP,
      // `.rail` declares `height: 100%`, which here resolves against the whole
      // shell and then gets offset by `top`, so the panel overshoots the bottom by
      // exactly GAP and has its lower corners clipped away. Let top/bottom decide
      // the height instead.
      height: 'auto',
      // Out of flow, so a width change here cannot touch the canvas — which is
      // the claim this prototype exists to demonstrate.
      //
      // It is NOT animated, though, and that is the same argument taken one step
      // further: a 180ms width transition on this element relayouts everything
      // inside it — the whole Inspector — once per frame for the duration. The
      // canvas would be untouched and the panel would stutter, which is a worse
      // outcome than snapping and an actively misleading thing to measure. The
      // compositor-only alternative (`transform: translateX`) is out for a
      // different reason: it carries the collapsed rail's room-health dot off
      // screen with it, and that dot staying visible is the whole reason the
      // closed rail is 37px rather than nothing.
      width: open ? `var(--rail-${side})` : 'var(--rail-closed)',
      background: 'var(--paper)',
      // A panel floating over a photograph-like surface needs a perceivable
      // boundary, and it is interactive: `--edge`, not a hairline.
      border: '1px solid var(--edge)',
      borderRadius: 'var(--r-card)',
      boxShadow: 'var(--shadow-lift)',
      overflow: 'hidden',
      // From the scale, like every other layer: docked chrome that may overlap
      // canvas UI. Cast because React types `zIndex` as a number and every
      // z-index in this app is a token.
      zIndex: 'var(--z-panel)',
      minHeight: 0,
    }) as CSSProperties;

  return (
    <div
      style={
        {
          position: 'relative',
          height: '100%',
          display: 'grid',
          gridTemplateColumns: '1fr',
          gridTemplateRows: '1fr',
          // Clip the panels' rounded corners and anything they animate past.
          overflow: 'hidden',
          // How much of each edge is covered. Inherited by the page's <main>, so
          // CanvasChrome's slots can stay clear of the panels without knowing
          // which shell they are in. `calc` rather than a measured number: the
          // widths are tokens, and this has to follow them.
          '--canvas-inset-left': leftOpen ? `calc(var(--rail-left) + ${GAP}px)` : `calc(var(--rail-closed) + ${GAP}px)`,
          '--canvas-inset-right': rightOpen
            ? `calc(var(--rail-right) + ${GAP}px)`
            : `calc(var(--rail-closed) + ${GAP}px)`,
        } as CSSProperties
      }
    >
      {surface}
      <aside id={RAIL_ID.left} className="rail rail--left" style={floating('left', leftOpen)}>
        <RailToggle side="left" open={leftOpen} onToggle={() => toggleRail('left')} />
        <LeftRailBody open={leftOpen} />
      </aside>
      <aside id={RAIL_ID.right} className="rail rail--right" style={floating('right', rightOpen)}>
        <RailToggle side="right" open={rightOpen} onToggle={() => toggleRail('right')} />
        <RightRailBody open={rightOpen} />
      </aside>
    </div>
  );
}

const STACKED_RAIL: CSSProperties = {
  minHeight: 0,
  height: 'auto',
  maxHeight: '60dvh',
  borderLeft: 0,
  borderRight: 0,
  borderTop: '1px solid var(--hairline)',
};

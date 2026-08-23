'use client';

// WHERE chrome sits on a work surface — for both room tabs, from one file.
//
// The studio reached seven floating clusters once, was consolidated to four, and
// four is still three more than either tool this was measured against. Drafted
// puts a cluster top-left and view controls top-right; Spline puts tools
// top-centre and keeps exactly one thing in a bottom corner (its axis gizmo).
// Neither uses bottom-left, bottom-centre, or bottom-right for anything else.
// Danmu used all of them, on both tabs, with each tab choosing differently.
//
// So there are now three slots and no others:
//
//   TOOLS  top-centre  — what you do TO the room. Per tab.
//   VIEW   top-right   — how you look at it, plus undo/redo. Per tab.
//   AIDE   bottom-right— at most ONE thing: an orientation gizmo, or a legend
//                        that only exists while the shading it explains is on.
//
// Bottom-left and bottom-centre are deliberately empty. Help moved to the top
// bar (it is pressed about once per user, and it was holding a corner for that);
// the selection bar folded into the Inspector, which already answers "what is
// selected". If you are reaching for a fourth slot, the answer is a rail.

import type { ReactNode } from 'react';

// Every slot carries `.canvas-chrome`, which makes the cluster itself
// transparent to the pointer and hands pointer events back to its children. The
// gaps in a cluster are not controls, and while they were part of a solid box a
// press that landed between two buttons was swallowed — no selection change, no
// drag, no clue why.
const BASE = {
  position: 'absolute' as const,
  zIndex: 'var(--z-canvas-ui)',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
};

// How much of each edge something else is covering. Zero unless a shell says
// otherwise, so the docked layouts — where a rail takes its own column and
// covers nothing — are unaffected. `OverlayShell` sets them to its panel widths,
// which is what keeps the tool cluster centred on the room you can SEE rather
// than on an element two panels are sitting on top of.
const INSET_L = 'var(--canvas-inset-left, 0px)';
const INSET_R = 'var(--canvas-inset-right, 0px)';
/** The gap between a cluster and its edge. */
const EDGE = 12;

/** Top-centre: what you do to the room. */
export function CanvasTools({ children }: { children: ReactNode }) {
  return (
    <div
      className="canvas-chrome"
      style={{
        ...BASE,
        top: EDGE,
        // The centre of the *visible* canvas: shifted by half the difference
        // between what is covered on each side.
        left: `calc(50% + (${INSET_L} - ${INSET_R}) / 2)`,
        transform: 'translateX(-50%)',
        flexWrap: 'wrap',
        justifyContent: 'center',
        maxWidth: `calc(100% - ${INSET_L} - ${INSET_R} - ${EDGE * 2}px)`,
      }}
    >
      {children}
    </div>
  );
}

/** Top-right: how you look at it. Undo/redo lives here, the way Drafted groups it. */
export function CanvasView({ children }: { children: ReactNode }) {
  return (
    <div
      className="canvas-chrome"
      style={{
        ...BASE,
        top: EDGE,
        right: `calc(${EDGE}px + ${INSET_R})`,
        flexWrap: 'wrap',
        justifyContent: 'flex-end',
      }}
    >
      {children}
    </div>
  );
}

/**
 * Bottom-right: the one aide. `--z-canvas-hint` so a panel can never bury it —
 * this is the slot the help corner used to defend, and the reason it needed to.
 */
export function CanvasAide({ children }: { children: ReactNode }) {
  return (
    <div
      className="canvas-chrome"
      style={{
        ...BASE,
        bottom: EDGE,
        right: `calc(${EDGE}px + ${INSET_R})`,
        zIndex: 'var(--z-canvas-hint)',
        maxWidth: `min(320px, calc(100% - ${INSET_L} - ${INSET_R} - ${EDGE * 2}px))`,
      }}
    >
      {children}
    </div>
  );
}

/** A hairline between two groups inside one cluster. */
export function ChromeDivider() {
  return <span aria-hidden="true" style={{ width: 1, height: 20, background: 'var(--hairline-strong)' }} />;
}

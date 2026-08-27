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

import { useEffect, useRef, type ReactNode } from 'react';

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

// How much of each edge something else is covering, so a cluster centres on the
// room you can SEE rather than on an element something is sitting on top of.
//
// Nothing writes these today: the docked shell gives each rail its own grid
// column, so no rail covers any part of the canvas, and both resolve to their
// `0px` fallback. They were written for the overlay shell that was compared here
// and rejected. Kept because they are the correct shape for the next thing that
// covers a canvas edge (an immersive mode, a floating panel) and because the
// fallback makes them free — but do not read them as live plumbing.
const INSET_L = 'var(--canvas-inset-left, 0px)';
const INSET_R = 'var(--canvas-inset-right, 0px)';
/** The gap between a cluster and its edge. */
const EDGE = 12;

// ── Why the tool cluster has to know how wide the view cluster is ───────────
//
// Both sit at `top: EDGE`, and nothing made them aware of each other. That was
// survivable only while TOOLS was a shrink-to-fit box capped at half the canvas
// (see the note in `CanvasTools`); once it correctly spanned the visible canvas,
// its row reached the right edge and ran straight under undo/redo — "Snap · Fine"
// with two arrows printed on top of it at a 456px canvas.
//
// A fixed reserve cannot work, because the right-hand cluster is not one size: the
// 3D tab puts undo/redo there (~58px) and the 2D tab puts undo/redo AND the whole
// zoom / rotate / fit toolbar there (~450px). Reserving the larger would waste
// 450px of the 3D tab's row; reserving the smaller would still collide on the 2D
// tab. So it is measured, once, by the cluster that knows.
//
// It is taken off ONE side, not both. Symmetric was the first attempt — it keeps
// the tools centred on the room, which is the nicer property — and it collapsed
// the 2D tab outright: two × 450 exceeds an 836px span, `left` crossed `right`,
// the box resolved to zero width, and the "Comfort zones" chip printed itself over
// the zoom toolbar with nothing to constrain it. Reserving one side cannot do that,
// and being centred in the space that is actually FREE is arguably the more honest
// centre anyway.
//
// The floor is the other half of that lesson: a reserve wider than the canvas would
// re-create the collapse from the other direction, so it is capped at the span
// minus `MIN_TOOLS`. Past that point the two clusters do overlap — but only on a
// canvas narrower than the 2D tab's own toolbar, which is well inside the width
// where the app puts up its own "this window is too narrow" gate.
//
// Published as a CSS custom property on the shared parent rather than through React
// state, so a resize repaints without re-rendering the tool cluster, the R3F canvas,
// or anything else in the studio. `--canvas-inset-*` already works this way, and
// `CanvasChrome` is where that pattern lives.
const RESERVE = 'var(--canvas-reserve-right, 0px)';

/** The narrowest the tool cluster may be squeezed to before it stops yielding to
 *  the view cluster. Two controls and a gap — below this it is not a row of tools,
 *  it is a stack, and the wrap handles that better than a sliver would. */
const MIN_TOOLS = 240;

/** Publishes its own width so `CanvasTools` can stay out from under it.
 *
 *  On the element's parent, not on itself: a custom property set on an element is
 *  read by that element and its descendants, and `CanvasTools` is a SIBLING. The
 *  parent is the canvas `<main>`, which both clusters are children of. */
function usePublishedWidth(prop: string) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    const parent = el?.parentElement;
    if (!el || !parent) return;

    const publish = () => {
      // `Math.ceil`, because a fractional reserve can leave a sub-pixel of the
      // two clusters touching — which is exactly the state this exists to end.
      parent.style.setProperty(prop, `${Math.ceil(el.getBoundingClientRect().width)}px`);
    };
    publish();

    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(publish);
    ro.observe(el);
    return () => {
      ro.disconnect();
      // Removed rather than zeroed: a stale reserve would keep a gutter open for a
      // cluster that is no longer on the page (the tabs render different ones).
      parent.style.removeProperty(prop);
    };
  }, [prop]);

  return ref;
}

/** Top-centre: what you do to the room. */
export function CanvasTools({ children }: { children: ReactNode }) {
  return (
    <div
      className="canvas-chrome"
      style={{
        ...BASE,
        top: EDGE,
        // Spans the visible canvas and centres its contents inside that span,
        // rather than being a shrink-to-fit box nudged to the middle.
        //
        // It WAS the latter — `left: calc(50% + …)` with `translateX(-50%)` — and
        // that quietly halved it. For an absolutely positioned box with `left`
        // set and `right: auto`, the width available to shrink-to-fit is what
        // remains to the RIGHT of `left`; the transform moves the painted result
        // back but cannot give the layout the other half. So the cluster could
        // never exceed half the canvas: on an 860px canvas it was capped at 430px
        // and wrapped its last control onto a second row with 400px going spare,
        // at every window size, forever.
        //
        // Two offsets instead of an offset plus a transform. The width is then the
        // span itself, `justifyContent: center` does the centring, and the insets
        // still measure from what is actually VISIBLE if anything ever covers an
        // edge (see the note on the pair above — nothing does today).
        // `maxWidth` is gone because the span is already the bound.
        //
        left: `calc(${EDGE}px + ${INSET_L})`,
        right: `calc(${EDGE}px + ${INSET_R})`,
        // Keeping clear of the view cluster as PADDING inside the full span, not as
        // a second offset — see the note on `RESERVE`. Padding cannot make the box
        // cross itself the way an opposing offset can, so the collapse that took
        // out the 2D tab is not expressible here. Content centres in what is left.
        //
        // The percentage resolves against the canvas, which is the containing
        // block — a few px wider than the span, and the difference is the edge
        // gutter, which is not worth a second variable.
        paddingRight: `max(0px, min(${RESERVE}, calc(100% - ${MIN_TOOLS}px)))`,
        flexWrap: 'wrap',
        justifyContent: 'center',
      }}
    >
      {children}
    </div>
  );
}

/** Top-right: how you look at it. Undo/redo lives here, the way Drafted groups it. */
export function CanvasView({ children }: { children: ReactNode }) {
  // Reports its width so the centred tool cluster can keep out from under it.
  const ref = usePublishedWidth('--canvas-reserve-right');
  return (
    <div
      ref={ref}
      className="canvas-chrome"
      style={{
        ...BASE,
        top: EDGE,
        right: `calc(${EDGE}px + ${INSET_R})`,
        flexWrap: 'wrap',
        justifyContent: 'flex-end',
        // It already said `wrap` and could never use it: a shrink-to-fit box
        // anchored by one offset has no width to be too narrow for. So on the 2D
        // tab — where this cluster is undo/redo AND the whole zoom / rotate / fit
        // toolbar, about 450px — it stayed one long row and left the centred tool
        // cluster nothing to have, which is what the reserve then had to cap.
        //
        // A ceiling turns the wrap on exactly when it is needed: never on the 3D
        // tab (58px of undo/redo), never on a wide 2D canvas, and on a cramped one
        // it folds into two shorter rows so both clusters fit side by side instead
        // of one printing over the other. Wrapping DOWN is free here — the slot
        // below is deliberately empty.
        maxWidth: `calc(100% - ${EDGE * 2}px - ${INSET_L} - ${INSET_R} - ${MIN_TOOLS}px)`,
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

/** A hairline between two groups inside one cluster. `flexShrink: 0` because a
 *  1px rule that can be squeezed to nothing is a rule that vanishes on exactly
 *  the narrow canvas where knowing which group is which matters most. */
export function ChromeDivider() {
  return (
    <span aria-hidden="true" style={{ width: 1, height: 20, flexShrink: 0, background: 'var(--hairline-strong)' }} />
  );
}

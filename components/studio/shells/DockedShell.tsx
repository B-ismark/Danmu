'use client';

// Rails beside the room — the one shell both studio tabs stand in.
//
// Docked, not floating. That was an open question for one round: three shells
// were built and compared here, in the real studio over a real room, because the
// only honest comparison is the same WebGL context and the same Inspector
// contents differing solely in how width is handed out. The outcome, and why the
// other two files are gone:
//
// · `OverlayShell` (full-bleed canvas, rails floating over it) lost on occlusion,
//   which is the same verdict Figma reached: they shipped floating panels in the
//   UI3 beta and reverted to fixed-but-resizable for the full rollout. A room you
//   are arranging furniture inside makes occlusion worse than an infinite plane
//   does, not better — the piece being placed is the thing that hides under the
//   Inspector.
// · `ElasticShell` won and was folded into this file. Its two behaviours are now
//   unconditional: the `compact` step below, and `container-type` on `.rail` so a
//   rail's contents answer to the rail.
//
// The sash survives alongside it, because the two answer different widths.
// Elastic only acts between 1024 and 1279px — above that the rails are already at
// their token widths and nothing inside them is cramped — and at 1440px the rails
// still cost ~40% of the window. A drag is the only thing that reaches that, and
// the container queries are what make a dragged-narrow rail safe rather than
// silently clipped.

import { type CSSProperties, type ReactNode, useLayoutEffect, useRef } from 'react';
import { useStudio } from '@/lib/store';
import type { StudioLayout } from '../NarrowViewportBanner';
import { RailSash } from './RailSash';
import { LeftRailBody, RailToggle, RightRailBody, useRails } from './shell-parts';

export const RAIL_ID = { left: 'studio-rail-left', right: 'studio-rail-right' } as const;

export function DockedShell({ surface, layout }: { surface: ReactNode; layout: StudioLayout }) {
  const { leftOpen, rightOpen, toggleRail } = useRails();
  // Subscribed so that a width written from ANYWHERE re-renders this shell — the
  // layout effect below carries no dependency array and runs after every render, so
  // the subscription is what turns a store write into a DOM write. The values are
  // deliberately not read for the write itself; see `applySashWidths`. Deleting
  // either line leaves a shell that paints the right thing on mount and never
  // updates, which is why `tests/rail-sash-gestures.test.tsx` writes a width from
  // outside the component and asserts the variable follows.
  useStudio((s) => s.railLeftW);
  useStudio((s) => s.railRightW);

  const shellRef = useRef<HTMLDivElement>(null);
  const leftRef = useRef<HTMLElement>(null);
  const rightRef = useRef<HTMLElement>(null);

  const stacked = layout === 'stacked';

  // Three sources, in priority order, and the order is the whole design:
  //
  // 1. What the user dragged. A preference always outranks a default — the same
  //    reason this shell never auto-collapses a rail. But rendered INSIDE the
  //    token's bounds, never instead of them: a 520px rail dragged on a monitor is
  //    still a ceiling and not a promise when the same browser profile opens a
  //    laptop, and `--rail-max` is a share of the window, so the room keeps most
  //    of it whatever was dragged.
  // 2. `--rail-*-tight`, between 1024 and 1279px. Three columns fit there but not
  //    three comfortable ones, and this frees ~94px for the room. Only honest
  //    because the rail's contents reflow at that width — that is what the
  //    `@container rail` block in globals.css is for, and lowering these tokens
  //    without checking that block is how a rail starts clipping in silence.
  // 3. The token's own `clamp()`. What a wide window gets.
  const railWidth = (stored: number | null, side: 'left' | 'right') => {
    if (stored != null) {
      return `clamp(var(--rail-${side}-min), ${stored}px, var(--rail-max))`;
    }
    return layout === 'compact' ? `var(--rail-${side}-tight)` : `var(--rail-${side})`;
  };

  /** Write both variables from the store. The layout effect below is one caller and
   *  `RailSash` is the other, because that effect runs on a RENDER and the gestures
   *  that have to undo a painted preview are exactly the ones that change no state:
   *  a press that resized nothing, and a double-click on a rail whose stored width is
   *  already `null`. One function so the expression cannot be written twice.
   *
   *  **`getState()` rather than this render's values, and that is the whole reason the
   *  subscriptions above read nothing.** `RailSash` calls this in the same handler as
   *  `setRailWidth`, one line later — so a closure over the subscribed values would
   *  write the PRE-drag width every time, and be correct only because the store change
   *  schedules a render whose layout effect runs before the browser paints. That is an
   *  invariant nobody stated and no test in this repo can see: `sashVar()` reads the
   *  final value of `el.style` after `act()` has flushed everything, so swapping those
   *  two lines, or demoting the effect below to `useEffect`, leaves the suite green.
   *  Reading at call time removes the dependency rather than documenting it. */
  const applySashWidths = () => {
    const el = shellRef.current;
    if (!el || stacked) return;
    const { railLeftW, railRightW } = useStudio.getState();
    el.style.setProperty('--sash-left', railWidth(railLeftW, 'left'));
    el.style.setProperty('--sash-right', railWidth(railRightW, 'right'));
  };

  const shell = (
    stacked
      ? {
          gridTemplateColumns: '1fr',
          // dvh, matching the `100dvh` wrapper these rows are measured inside.
          gridTemplateRows: 'minmax(300px, 55dvh) auto auto',
          height: '100%',
          overflow: 'auto',
        }
      : {
          // `--sash-left` / `--sash-right` are NOT set here — see the layout effect
          // below, which writes them to the DOM after every render.
          gridTemplateColumns: [
            leftOpen ? 'var(--sash-left)' : 'var(--rail-closed)',
            '1fr',
            rightOpen ? 'var(--sash-right)' : 'var(--rail-closed)',
          ].join(' '),
          height: '100%',
        }
  ) as CSSProperties;

  // The two sash variables are written to the DOM after every render rather than
  // carried in the style object above, and that is a correctness fix rather than a
  // preference.
  //
  // `RailSash` used to hand a width back to its token with
  // `style.removeProperty('--sash-left')`. React never learns about that:
  // `setValueForStyles` writes a key only when the value it last RENDERED differs
  // from the new one, so removing a property React believes it already set is
  // invisible to that comparison and is never restored. On a rail whose stored width
  // was already `null` — a press that resizes nothing reaches that state, and
  // `toggleRail` does NOT clear a stored width, which three comments in this branch
  // claimed and `lib/store.ts` explains at length that it deliberately does not — the
  // accompanying `setRailWidth(side, null)` changed nothing either, so the property
  // simply stayed gone. The next open then resolved
  // `grid-template-columns: var(--sash-left) 1fr var(--rail-right)` against a
  // variable defined nowhere else in the app: invalid at computed-value time, which
  // for `grid-template-columns` means `none`, which auto-places the left rail, the
  // canvas and the right rail one per ROW. Double-clicking the sash to reset it took
  // the same path and could not repair it, because that was another
  // remove-then-write-the-same-null.
  //
  // Writing unconditionally after every render makes the DOM the source of truth
  // instead of React's memory of it, so no caller can put the shell into a state
  // React declines to fix. The skip is for a live drag only: `RailSash` paints a px
  // preview straight onto this element every frame, and a render that happened to
  // land mid-gesture would otherwise snap that preview back to the token.
  useLayoutEffect(() => {
    if (shellRef.current?.dataset.sashDragging === '1') return;
    applySashWidths();
  });

  const railStyle: CSSProperties = stacked
    ? {
        minHeight: 0,
        height: 'auto',
        maxHeight: '60dvh',
        borderLeft: 0,
        borderRight: 0,
        borderTop: '1px solid var(--hairline)',
      }
    : // `relative` so the sash can straddle this rail's own border.
      { minHeight: 0, position: 'relative' };

  // Collapsed rails keep their <aside> and their toggle, so the control that
  // reopens one is always where the rail was — and a stacked layout never
  // collapses, because there the rails are content rather than chrome.
  const showLeft = stacked || leftOpen;
  const showRight = stacked || rightOpen;

  const tree = (
    <aside key="tree" id={RAIL_ID.left} ref={leftRef} className="rail rail--left" style={railStyle}>
      {!stacked && <RailToggle side="left" open={leftOpen} onToggle={() => toggleRail('left')} />}
      <LeftRailBody open={showLeft} />
      {!stacked && (
        <RailSash
          side="left"
          shellRef={shellRef}
          railRef={leftRef}
          railId={RAIL_ID.left}
          open={leftOpen}
          onToggle={() => toggleRail('left')}
          onRestoreWidths={applySashWidths}
        />
      )}
    </aside>
  );

  const inspector = (
    <aside key="inspector" id={RAIL_ID.right} ref={rightRef} className="rail rail--right" style={railStyle}>
      {!stacked && <RailToggle side="right" open={rightOpen} onToggle={() => toggleRail('right')} />}
      <RightRailBody open={showRight} />
      {!stacked && (
        <RailSash
          side="right"
          shellRef={shellRef}
          railRef={rightRef}
          railId={RAIL_ID.right}
          open={rightOpen}
          onToggle={() => toggleRail('right')}
          onRestoreWidths={applySashWidths}
        />
      )}
    </aside>
  );

  return (
    // `.split` only — NOT `.split--stack`, which capture and detect use to reflow
    // in pure CSS. Carrying it here meant two thresholds for one decision (720px
    // in the stylesheet, 1023px in `useStudioLayout`) and two row templates, and
    // the CSS one describes two children while this shell has three.
    <div className="split" ref={shellRef} style={shell}>
      {stacked ? [surface, tree, inspector] : [tree, surface, inspector]}
    </div>
  );
}

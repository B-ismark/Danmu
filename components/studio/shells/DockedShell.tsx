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

import { type CSSProperties, type ReactNode, useRef } from 'react';
import { useStudio } from '@/lib/store';
import type { StudioLayout } from '../NarrowViewportBanner';
import { RailSash } from './RailSash';
import { LeftRailBody, RailToggle, RightRailBody, useRails } from './shell-parts';

export const RAIL_ID = { left: 'studio-rail-left', right: 'studio-rail-right' } as const;

export function DockedShell({ surface, layout }: { surface: ReactNode; layout: StudioLayout }) {
  const { leftOpen, rightOpen, toggleRail } = useRails();
  const storedLeft = useStudio((s) => s.railLeftW);
  const storedRight = useStudio((s) => s.railRightW);

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
          '--sash-left': railWidth(storedLeft, 'left'),
          '--sash-right': railWidth(storedRight, 'right'),
          gridTemplateColumns: [
            leftOpen ? 'var(--sash-left)' : 'var(--rail-closed)',
            '1fr',
            rightOpen ? 'var(--sash-right)' : 'var(--rail-closed)',
          ].join(' '),
          height: '100%',
        }
  ) as CSSProperties;

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

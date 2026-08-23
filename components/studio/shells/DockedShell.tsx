'use client';

// Rails beside the room — the arrangement that ships today, and the one two of
// the three prototypes are variations on.
//
// Parametrised rather than copied. "Current" and "Sash" differ by whether the
// dividers can be dragged; "Elastic" differs by which widths the rails start
// from and whether their contents query their own box. Three files repeating this
// grid would be three places for it to drift, which is the reason `StudioShell`
// exists at all.
//
// Docked, not floating: Figma shipped floating panels in the UI3 beta and
// reverted to fixed-but-resizable for the full rollout. `OverlayShell` is the
// prototype that tests whether that verdict holds for a room you are arranging
// furniture inside.

import { type CSSProperties, type ReactNode, useRef } from 'react';
import { useStudio } from '@/lib/store';
import { LeftRailBody, RailToggle, RightRailBody, useRails } from './shell-parts';
import { RailSash } from './RailSash';

export const RAIL_ID = { left: 'studio-rail-left', right: 'studio-rail-right' } as const;

/** Where a rail's width comes from.
 *  · `token`  — the stylesheet's `clamp()`. What ships today.
 *  · `stored` — what the user last dragged to, still inside that clamp.
 *  · `tight`  — `--rail-*-tight`, for a viewport with three columns but not three
 *               comfortable ones. Only honest if the rail's contents reflow at
 *               that width, which is what the container queries behind
 *               `rail--elastic` are for — so nothing but Elastic may ask for it. */
export type RailWidths = 'token' | 'stored' | 'tight';

export function DockedShell({
  surface,
  stacked,
  /** Draggable dividers. */
  sash = false,
  widths = 'token',
  /** An extra class on both rails — how `ElasticShell` turns them into query
   *  containers without a second copy of this grid. */
  railModifier,
}: {
  surface: ReactNode;
  stacked: boolean;
  sash?: boolean;
  widths?: RailWidths;
  railModifier?: string;
}) {
  const { leftOpen, rightOpen, toggleRail } = useRails();
  const storedLeft = useStudio((s) => s.railLeftW);
  const storedRight = useStudio((s) => s.railRightW);

  const shellRef = useRef<HTMLDivElement>(null);
  const leftRef = useRef<HTMLElement>(null);
  const rightRef = useRef<HTMLElement>(null);

  // A remembered width is rendered INSIDE the token's bounds, never instead of
  // them: a 520px rail dragged on a monitor is still a ceiling and not a promise
  // when the same browser profile opens a laptop. `--rail-max` is a share of the
  // window, so the room keeps most of it whatever was dragged.
  const railWidth = (stored: number | null, side: 'left' | 'right') => {
    if (widths === 'tight') return `var(--rail-${side}-tight)`;
    if (widths === 'stored' && stored != null) {
      return `clamp(var(--rail-${side}-min), ${stored}px, var(--rail-max))`;
    }
    return `var(--rail-${side})`;
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
  const sashable = sash && !stacked;

  const tree = (
    <aside key="tree" id={RAIL_ID.left} ref={leftRef} className={`rail rail--left${railModifier ? ` ${railModifier}` : ''}`} style={railStyle}>
      {!stacked && <RailToggle side="left" open={leftOpen} onToggle={() => toggleRail('left')} />}
      <LeftRailBody open={showLeft} />
      {sashable && (
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
    <aside
      key="inspector"
      id={RAIL_ID.right}
      ref={rightRef}
      className={`rail rail--right${railModifier ? ` ${railModifier}` : ''}`}
      style={railStyle}
    >
      {!stacked && <RailToggle side="right" open={rightOpen} onToggle={() => toggleRail('right')} />}
      <RightRailBody open={showRight} />
      {sashable && (
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
    // in the stylesheet, 1023px in `useStackedStudio`) and two row templates, and
    // the CSS one describes two children while this shell has three.
    <div className="split" ref={shellRef} style={shell}>
      {stacked ? [surface, tree, inspector] : [tree, surface, inspector]}
    </div>
  );
}

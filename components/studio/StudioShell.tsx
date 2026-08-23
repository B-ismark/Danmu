'use client';

// The one shell both room tabs stand in.
//
// `/room/[id]/model` and `/room/[id]/plan` each declared their own copy of this:
// the same three-column grid, the same stacked fallback, the same two rails in
// the same order, the same `ready` gate — byte-identical apart from the loading
// sentence. Two copies of a layout is two places for it to drift, and the tabs
// had already drifted everywhere else (see the chrome each one floats over its
// canvas). Anything that changes how the studio is *framed* now changes here,
// once, and both tabs move together.
//
// What stays with the pages: what goes ON the canvas. That is genuinely
// different between a 3D room and a 2D drawing, and pretending otherwise would
// be the opposite mistake.

import { Fragment, type CSSProperties, type ReactNode } from 'react';
import { useStudio } from '@/lib/store';
import { Icon } from '@/components/ui/Icon';
import { PartTree } from './PartTree';
import { Inspector } from './Inspector';
import { SelectionHeader } from './SelectionHeader';
import { RoomHealthDot } from './RoomTools';
import { useStackedStudio } from './NarrowViewportBanner';

export function StudioShell({
  children,
  loadingLabel,
}: {
  /** The work surface — the 3D canvas or the plan drawing, with its own chrome. */
  children: ReactNode;
  /** Spoken while the shell decides its own shape. Names the thing being built. */
  loadingLabel: string;
}) {
  // Below ~1024px the rails stack under the work surface instead of squeezing it
  // to nothing. Done in JS rather than CSS because the surface has to come FIRST
  // in the stacked order and a media query cannot reorder an inline-styled grid.
  //
  // `ready` gates the first paint: without it a narrow viewport lays out the
  // three-column shell, then re-orders and re-flows once matchMedia answers.
  const { stacked, ready } = useStackedStudio();
  // Both references let their panels close, and this app has more reason to: the
  // 3D view IS the product, and two fixed rails spend 45% of a 1280px laptop on
  // chrome. Stacked layouts ignore this — there the rails are below the room, not
  // beside it, so closing them only hides content that is already out of the way.
  const leftOpen = useStudio((s) => s.railLeftOpen);
  const rightOpen = useStudio((s) => s.railRightOpen);
  const toggleRail = useStudio((s) => s.toggleRail);

  if (!ready) {
    return (
      <div style={{ height: '100%', display: 'grid', placeItems: 'center', background: 'var(--paper-2)' }}>
        <span role="status" style={{ fontSize: 13, color: 'var(--ink-3)' }}>
          {loadingLabel}
        </span>
      </div>
    );
  }

  const shell: CSSProperties = stacked
    ? {
        gridTemplateColumns: '1fr',
        gridTemplateRows: 'minmax(300px, 55vh) auto auto',
        height: '100%',
        overflow: 'auto',
      }
    : {
        gridTemplateColumns: [
          leftOpen ? 'var(--rail-left)' : 'var(--rail-closed)',
          '1fr',
          rightOpen ? 'var(--rail-right)' : 'var(--rail-closed)',
        ].join(' '),
        height: '100%',
      };

  const railStyle: CSSProperties = stacked
    ? {
        minHeight: 0,
        height: 'auto',
        maxHeight: '60vh',
        borderLeft: 0,
        borderRight: 0,
        borderTop: '1px solid var(--hairline)',
      }
    : { minHeight: 0 };

  // Collapsed rails keep their <aside> and their toggle, so the control that
  // reopens one is always where the rail was — and a stacked layout never
  // collapses, because there the rails are content rather than chrome.
  const showLeft = stacked || leftOpen;
  const showRight = stacked || rightOpen;

  const tree = (
    <aside key="tree" className="rail rail--left" style={railStyle}>
      {!stacked && <RailToggle side="left" open={leftOpen} onToggle={() => toggleRail('left')} />}
      {showLeft ? (
        <PartTree />
      ) : (
        // Closing this rail must not hide the room's state — that state being
        // always visible is the whole reason it moved out of a canvas dock.
        <div style={{ padding: '8px 0' }}>
          <RoomHealthDot />
        </div>
      )}
    </aside>
  );

  const inspector = (
    <aside key="inspector" className="rail rail--right" style={railStyle}>
      {!stacked && <RailToggle side="right" open={rightOpen} onToggle={() => toggleRail('right')} />}
      {showRight && (
        <>
          {/* The selection's banner, above the panel that acts on it. It used to
              float on the canvas's bottom edge, answering what this panel answers. */}
          <SelectionHeader />
          <Inspector />
        </>
      )}
    </aside>
  );

  // A keyed Fragment, not a wrapper div: the caller's <main> must stay the direct
  // grid item, and the keys are what stop React re-mounting a WebGL canvas every
  // time the viewport crosses the stacking threshold. A `display: contents` div
  // would also work and is one more thing to be wrong about.
  const surface = <Fragment key="surface">{children}</Fragment>;

  return (
    // `.split` only — NOT `.split--stack`, which capture and detect use to reflow
    // in pure CSS. Carrying it here meant two thresholds for one decision (720px
    // in the stylesheet, 1023px in `useStackedStudio`) and two row templates, and
    // the CSS one describes two children while this shell has three. `stacked`
    // above is the single answer.
    <div className="split" style={shell}>
      {stacked ? [surface, tree, inspector] : [tree, surface, inspector]}
    </div>
  );
}

/**
 * The collapse control, in the rail's own top corner — where Spline puts its
 * panel toggles. It stays mounted when the rail is closed; otherwise the only way
 * back would be a keyboard shortcut nobody has been told about.
 */
function RailToggle({ side, open, onToggle }: { side: 'left' | 'right'; open: boolean; onToggle: () => void }) {
  const pointsAway = side === 'left' ? (open ? 'chevron-left' : 'chevron-right') : open ? 'chevron-right' : 'chevron-left';
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: side === 'left' ? 'flex-end' : 'flex-start',
        padding: 6,
        borderBottom: open ? '1px solid var(--hairline)' : 0,
        flexShrink: 0,
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-label={open ? `Hide the ${side} panel` : `Show the ${side} panel`}
        title={open ? 'Hide this panel' : 'Show this panel'}
        className="icon-btn"
        style={{ width: 24, height: 24, color: 'var(--ink-3)' }}
      >
        <Icon name={pointsAway} size={13} />
      </button>
    </div>
  );
}

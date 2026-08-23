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
//
// It now also *chooses* the framing, between what ships and three candidates —
// see `shell-variant.ts` for why the switch is here (in the real studio, over the
// real room) rather than in three mock routes. In a production build there is one
// shell and this is a straight call to `DockedShell`.

import { Fragment, type ReactNode } from 'react';
import { useStackedStudio } from './NarrowViewportBanner';
import { useShellVariant } from './shell-variant';
import { DockedShell } from './shells/DockedShell';
import { ElasticShell } from './shells/ElasticShell';
import { OverlayShell } from './shells/OverlayShell';

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
  // Held behind the same gate, and for a sharper version of the same reason:
  // painting the control shell and then swapping would re-mount the WebGL canvas
  // and spoil the frame timings this comparison exists to collect.
  const { variant, ready: variantReady } = useShellVariant();

  if (!ready || !variantReady) {
    return (
      <div style={{ height: '100%', display: 'grid', placeItems: 'center', background: 'var(--paper-2)' }}>
        <span role="status" style={{ fontSize: 13, color: 'var(--ink-3)' }}>
          {loadingLabel}
        </span>
      </div>
    );
  }

  // A keyed Fragment, not a wrapper div: the caller's <main> must stay the direct
  // grid item, and the key is what stops React re-mounting a WebGL canvas every
  // time the viewport crosses the stacking threshold and the children are
  // reordered. A `display: contents` div would also work and is one more thing to
  // be wrong about.
  const surface = <Fragment key="surface">{children}</Fragment>;

  switch (variant) {
    case 'sash':
      return <DockedShell surface={surface} stacked={stacked} sash widths="stored" />;
    case 'elastic':
      return <ElasticShell surface={surface} />;
    case 'overlay':
      return <OverlayShell surface={surface} stacked={stacked} />;
    default:
      return <DockedShell surface={surface} stacked={stacked} />;
  }
}

'use client';

// The 2D tab's chrome. It used to live inside PlanView.tsx — 1,072 lines of
// drawing code that also owned a help card, a zoom toolbar and a legend — while
// the 3D tab's chrome lived in its page. That split in ownership is why the two
// tabs' chrome drifted: nobody comparing them was ever looking at both.
//
// The plan's half of the help card was the last of that split, and it outlived the
// sentence above by long enough to lose a whole group: it sat here while the 3D half
// sat in `StudioHelp.tsx`, and nobody comparing them noticed the plan card never told
// anyone what the Catalog and the Library were. Both halves live in `StudioHelp.tsx`
// now. What stays here is chrome you can point at on the drawing — the zoom toolbar
// and the legend.

import type { RefObject } from 'react';
import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/primitives';
import { MAX_ZOOM, MIN_ZOOM, type PlanViewHandle } from './PlanView';
import { usePhoneStudio } from './NarrowViewportBanner';

/** Zoom, page rotation, fit — driven through PlanView's handle. */
export function PlanViewControls({
  api,
  zoom,
  rot,
  dimUnit,
  unitName,
}: {
  api: RefObject<PlanViewHandle | null>;
  zoom: number;
  rot: number;
  /** The unit's short form, as the readout prints it — `m`, `cm`, `ft`. */
  dimUnit: string;
  /** Its full name, for the tooltip. */
  unitName: string;
}) {
  const phone = usePhoneStudio();
  const deg = (((rot * 180) / Math.PI) % 360).toFixed(0);
  // None on a phone. Pinch zooms and a finger pans, which is how every map on it already
  // works, and a box of seven small controls stacked in two columns
  // over the drawing cost more of the room than it gave back.
  if (phone) return null;
  return (
    // `flexWrap`, because this row is about 450px of zoom, rotation and fit and
    // the 2D canvas is not always 450px wide. It was one `.toolbar`, which is
    // `overflow: hidden` (it clips its segment fills to the rounded corners), so without a wrap the
    // last controls were simply cut off at the border — no scrollbar, no ellipsis,
    // and the Fit button unreachable with nothing on screen saying why. Folding
    // into two short rows costs a little height in the one slot that has height to
    // spare: the canvas's bottom-left and bottom-centre are deliberately empty.
    //
    // It folds as two GROUPS, never control by control: zoom, and turn + fit. Wrapping
    // one control at a time left "Fit" alone on a third row at the laptop's 1024px
    // step, with a hairline divider stranded at the end of the row above it.
    //
    // And the two groups are handed straight to `CanvasView`, which wraps, rather
    // than boxed together: a wrapper made both one flex item, so on a cramped canvas
    // the pair dropped below undo/redo as a block and then folded again inside it —
    // three rows stepping down the corner where two would do. As siblings of
    // undo/redo, zoom stays on its row and only the turn pill moves down. Each group
    // names itself, which a wrapper's one label did for both.
    //
    // Each is a `.chrome-pill` (globals.css): one capsule, quiet round buttons inside
    // it, and the readouts on a fixed width so + and − never shift as the number
    // grows a digit. It replaced a box of outlined circles inside an outlined box —
    // two boundaries per control.
    <>
      <div className="chrome-pill" role="group" aria-label="Zoom">
        {/* Disabled at the bounds. The handle clamps silently, so without this the
            buttons stay pressable at max/min and appear broken. */}
        <IconButton
          icon="minus"
          label="Zoom out"
          onClick={() => api.current?.zoomOut()}
          disabled={zoom <= MIN_ZOOM + 0.001}
          size={30}
          iconSize={15}
        />
        {/* One readout, not two. The old top-left chip said "To scale in mm" beside
            a percentage while this toolbar showed the percentage again. The unit is
            the claim worth making — it is what someone measuring would rely on.
            The SHORT form: "centimeters (cm) · 100%" was the widest thing in the
            row, and on a phone it was cut off by the toolbar's own edge. */}
        <span className="chrome-pill__readout chrome-pill__readout--zoom" title={`Drawn to scale. Every dimension is in ${unitName}.`}>
          {dimUnit} · {(zoom * 100).toFixed(0)}%
        </span>
        <IconButton
          icon="plus"
          label="Zoom in"
          onClick={() => api.current?.zoomIn()}
          disabled={zoom >= MAX_ZOOM - 0.001}
          size={30}
          iconSize={15}
        />
      </div>
      <div className="chrome-pill" role="group" aria-label="Turn and fit">
        <IconButton
          icon="rotate-ccw"
          label="Turn the page left"
          onClick={() => api.current?.rotateLeft()}
          size={30}
          iconSize={14}
        />
        <span className="chrome-pill__readout chrome-pill__readout--deg">{deg}°</span>
        <IconButton
          icon="rotate-cw"
          label="Turn the page right"
          onClick={() => api.current?.rotateRight()}
          size={30}
          iconSize={14}
        />
        <span aria-hidden="true" className="chrome-pill__rule" />
        <button type="button" onClick={() => api.current?.fit()} title="Back to the default view" className="chrome-pill__text">
          <Icon name="fit" size={12} />
          Fit
        </button>
      </div>
    </>
  );
}

/**
 * The key for the comfort shading, and ONLY while that shading is on — it
 * describes colours that are otherwise not on screen. This is the 2D tab's one
 * bottom-right aide, in the slot the 3D tab gives its orientation gizmo.
 */
export function ComfortLegend({ hasCutOff }: { hasCutOff: boolean }) {
  return (
    // A key, not a control, so it wears the floating-chrome container (`.chrome-legend`)
    // rather than `.popover`'s `--edge`: nothing in it can be pressed.
    <div
      className="chrome-legend"
      style={{
        padding: '7px 12px',
        fontSize: 'var(--fs-caption)',
        color: 'var(--ink-3)',
        lineHeight: 1.45,
        display: 'flex',
        flexDirection: 'column',
        gap: 3,
      }}
    >
      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <Swatch fill="var(--accent-2-tint)" dashed />
        Room each piece needs to be used
      </span>
      {hasCutOff && (
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--warn-text)' }}>
          <Swatch fill="var(--warn-tint)" />
          No route from the door to here
        </span>
      )}
    </div>
  );
}

function Swatch({ fill, dashed }: { fill: string; dashed?: boolean }) {
  return (
    <span
      aria-hidden="true"
      style={{
        width: 14,
        height: 10,
        flexShrink: 0,
        background: fill,
        border: dashed ? '1px dashed var(--accent-2)' : '1px solid var(--edge)',
        borderRadius: 2,
      }}
    />
  );
}

'use client';

// The 2D tab's chrome. It used to live inside PlanView.tsx — 1,072 lines of
// drawing code that also owned a help card, a zoom toolbar and a legend — while
// the 3D tab's chrome lived in its page. That split in ownership is why the two
// tabs' chrome drifted: nobody comparing them was ever looking at both.

import type { RefObject } from 'react';
import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/primitives';
import { HelpGroup, HelpLine, Kb } from './HelpCard';
import { MAX_ZOOM, MIN_ZOOM, type PlanViewHandle } from './PlanView';

/** Zoom, page rotation, fit — driven through PlanView's handle. */
export function PlanViewControls({
  api,
  zoom,
  rot,
  dimUnit,
}: {
  api: RefObject<PlanViewHandle | null>;
  zoom: number;
  rot: number;
  dimUnit: string;
}) {
  const deg = (((rot * 180) / Math.PI) % 360).toFixed(0);
  return (
    <div className="toolbar" role="group" aria-label="Plan view" style={{ gap: 6, padding: 4 }}>
      {/* Disabled at the bounds. The handle clamps silently, so without this the
          buttons stay pressable at max/min and appear broken. */}
      <IconButton
        icon="minus"
        label="Zoom out"
        onClick={() => api.current?.zoomOut()}
        disabled={zoom <= MIN_ZOOM + 0.001}
        variant="outline"
        size={28}
        iconSize={15}
      />
      {/* One readout, not two. The old top-left chip said "To scale in mm" beside
          a percentage while this toolbar showed the percentage again. The unit is
          the claim worth making — it is what someone measuring would rely on. */}
      <span
        className="mono"
        title={`Drawn to scale. Every dimension is in ${dimUnit}.`}
        style={{
          fontSize: 10,
          color: 'var(--ink-3)',
          letterSpacing: '0.06em',
          display: 'flex',
          alignItems: 'center',
          padding: '0 8px',
          whiteSpace: 'nowrap',
        }}
      >
        {dimUnit} · {(zoom * 100).toFixed(0)}%
      </span>
      <IconButton
        icon="plus"
        label="Zoom in"
        onClick={() => api.current?.zoomIn()}
        disabled={zoom >= MAX_ZOOM - 0.001}
        variant="outline"
        size={28}
        iconSize={15}
      />
      <span aria-hidden="true" style={{ width: 1, background: 'var(--hairline)' }} />
      <IconButton
        icon="rotate-ccw"
        label="Turn the page left"
        onClick={() => api.current?.rotateLeft()}
        variant="outline"
        size={28}
        iconSize={14}
      />
      <span
        className="mono"
        style={{
          fontSize: 10,
          color: 'var(--ink-3)',
          letterSpacing: '0.06em',
          display: 'flex',
          alignItems: 'center',
          padding: '0 6px',
        }}
      >
        {deg}°
      </span>
      <IconButton
        icon="rotate-cw"
        label="Turn the page right"
        onClick={() => api.current?.rotateRight()}
        variant="outline"
        size={28}
        iconSize={14}
      />
      <span aria-hidden="true" style={{ width: 1, background: 'var(--hairline)' }} />
      <button
        onClick={() => api.current?.fit()}
        title="Back to the default view"
        className="ds-btn"
        style={{ height: 28, fontSize: 11, padding: '0 9px', gap: 5 }}
      >
        <Icon name="fit" size={12} />
        Fit
      </button>
    </div>
  );
}

/**
 * The key for the comfort shading, and ONLY while that shading is on — it
 * describes colours that are otherwise not on screen. This is the 2D tab's one
 * bottom-right aide, in the slot the 3D tab gives its orientation gizmo.
 */
export function ComfortLegend({ hasCutOff }: { hasCutOff: boolean }) {
  return (
    <div
      className="popover"
      style={{
        padding: '7px 10px',
        fontSize: 11,
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

/** The plan tab's half of the shortcut card. The 3D tab's half lives with it. */
export function planHelp() {
  return (
    <>
      <HelpGroup title="Moving furniture">
        <HelpLine>Drag a piece to move it. It stops against whatever is in the way, and tints red if it cannot go there.</HelpLine>
        <HelpLine>Drag the handle on a selected piece to turn it.</HelpLine>
        <HelpLine>Click a wall to paint it, or drag it to make the room bigger or smaller.</HelpLine>
      </HelpGroup>
      <HelpGroup title="Getting around">
        <HelpLine>
          Pinch or scroll to zoom. Two fingers, Shift-drag, or hold <Kb>Space</Kb> and drag, to pan.
        </HelpLine>
        <HelpLine>Right-click a piece — or the plan — for what you can do to it.</HelpLine>
        <HelpLine>Alt-drag turns the page — the drawing, not the furniture.</HelpLine>
      </HelpGroup>
      <HelpGroup title="Keys" note="Click the drawing first — these stay quiet while you are using a panel.">
        <HelpLine>
          <Kb>↑</Kb>
          <Kb>↓</Kb>
          <Kb>←</Kb>
          <Kb>→</Kb> nudge whatever is focused · hold <Kb>Shift</Kb> to turn it
        </HelpLine>
        <HelpLine>
          <Kb>Tab</Kb> steps through the pieces and the walls · <Kb>Esc</Kb> deselects
        </HelpLine>
      </HelpGroup>
    </>
  );
}

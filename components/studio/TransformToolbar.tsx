'use client';

// Mode toggle in the canvas's top-centre cluster: Move (W) · Scale (S) ·
// Rotate (R), plus the snap cycle. The room layout positions it; this owns the
// look. Boundaries use --edge rather than a decorative hairline because this
// floats over a 3D scene, where a 1.1:1 border is simply invisible.
//
// ── Why this returns a Fragment ─────────────────────────────────────────────
//
// It used to wrap its two groups in an `inline-flex` div of its own, and that div
// is what broke the cluster on a narrow canvas. `CanvasTools` already wraps and
// already spaces its children; the extra div presented BOTH groups to it as one
// unwrappable item, so instead of the snap pill dropping to a second row it was
// squeezed — and a squeezed pill with a bare text node in it wrapped `Snap ·
// Coarse` onto two lines inside a `height: 30` box, printing the second line out
// through the bottom of its own border.
//
// So the two failure modes CLAUDE.md names met in one control: a container that
// could not reflow, and an element with no `overflow` of its own spilling instead.
// Both are fixed by the same idea — the row that already knows how to wrap is the
// row that should decide, so these are its direct children now. Nothing here sets
// a gap; the cluster's is the only one.

import { Fragment } from 'react';
import { useStudio } from '@/lib/store';
import { usePhoneStudio } from './NarrowViewportBanner';
import { Icon } from '@/components/ui/Icon';
import type { IconName } from '@/components/ui/Icon';

// `does` spells out the axis a mode actually works on. It used to be a second
// readout floating at the bottom-left of the canvas; it belongs on the control
// that sets it.
const MODES: Array<{ id: 'translate' | 'rotate' | 'scale'; label: string; key: string; does: string; icon: IconName }> = [
  { id: 'translate', label: 'Move', key: 'W', does: 'slide it along the floor', icon: 'arrow-up-right' },
  { id: 'scale', label: 'Scale', key: 'S', does: 'resize it evenly', icon: 'ruler' },
  { id: 'rotate', label: 'Rotate', key: 'R', does: 'spin it in place', icon: 'refresh' },
];

export const SNAPS: Array<{ id: 'off' | 'fine' | 'coarse'; label: string; sub: string }> = [
  { id: 'off', label: 'Free', sub: 'no snap' },
  { id: 'fine', label: 'Fine', sub: '10mm · 15°' },
  { id: 'coarse', label: 'Coarse', sub: '50mm · 45°' },
];

const SNAP_ORDER: Array<'off' | 'fine' | 'coarse'> = ['off', 'fine', 'coarse'];

export function TransformToolbar() {
  const mode = useStudio((s) => s.transformMode);
  const setMode = useStudio((s) => s.setTransformMode);
  const snapMode = useStudio((s) => s.snapMode);
  const setSnapMode = useStudio((s) => s.setSnapMode);
  const selected = useStudio((s) => s.selectedPartId);
  // A phone keeps this row to one line and thumb-sized: the three modes at 40px, and
  // Snap in the app bar's More menu, where the set-once settings live (HIG's toolbar
  // guidance for a compact width). Here it wrapped to a second row of its own.
  const phone = usePhoneStudio();

  return (
    <Fragment>
      {/* A segmented `.chrome-pill` (`.chrome-seg`, globals.css): the chosen mode is
          a dark capsule, the others are quiet words, and no rules between them. */}
      <div className="chrome-pill chrome-seg" role="group" aria-label="What dragging does">
        {MODES.map((m) => {
          const active = mode === m.id;
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => setMode(m.id)}
              aria-pressed={active}
              aria-label={`${m.label}: dragging will ${m.does} (${m.key})`}
              title={
                selected
                  ? `${m.label} (${m.key}) · Dragging will ${m.does}`
                  : `${m.label} (${m.key}) · Dragging will ${m.does}. Applies to the next piece you select.`
              }
              // Dimmed by token, not by opacity, until a piece is selected: a
              // 0.6-alpha --ink-2 drops under 4.5:1, and this row is 12px type.
              //
              // The pill clips (`.chrome-seg` is `overflow: hidden`), so once the row
              // is narrower than three labelled buttons SOMETHING gets cut. Letting
              // the buttons shrink chooses what: the icon and the keycap hold their
              // size and the word gives ground with an ellipsis, which still says
              // which mode is which. A flex item's automatic minimum is its own
              // content, so without `minWidth: 0` none of them shrink.
              className={`chrome-seg__btn${selected ? ' is-live' : ''}`}
              style={{ height: phone ? 40 : 30, minWidth: 0 }}
            >
              {/* The icon identifies the mode once the word has been cut, so it
                  is the part that never shrinks — same reasoning as `Segmented`. */}
              <span style={{ display: 'flex', flexShrink: 0 }}>
                <Icon name={m.icon} size={12} />
              </span>
              {/* Its own overflow, because `minWidth: 0` above sizes the BOX and
                  nothing else: a bare text node in a flex row would be free to
                  wrap onto a second line inside a 30px-tall button. */}
              <span className="truncate" style={{ minWidth: 0 }}>
                {m.label}
              </span>
              {/* A keyboard hint, so it is the FIRST thing to go when the row runs
                  short (`.kbd-hint`): on a phone there is no W key to press, and it
                  was the keycap that cut "Scale" to "Sc…". */}
              <kbd
                className="kbd-hint"
                style={{
                  fontFamily: 'var(--font-sans)',
                  fontSize: 'var(--fs-micro)',
                  fontWeight: 700,
                  padding: '1px 4px',
                  marginLeft: 2,
                  flexShrink: 0,
                  borderRadius: 'var(--r-1)',
                  // On the dark active button the keycap flips to a paper chip —
                  // a translucent white border was both a hard-coded colour and
                  // barely visible.
                  background: active ? 'var(--paper)' : 'var(--paper-3)',
                  color: 'var(--ink)',
                }}
              >
                {m.key}
              </kbd>
            </button>
          );
        })}
      </div>

      {!phone && <SnapCycleButton snapMode={snapMode} setSnapMode={setSnapMode} />}
    </Fragment>
  );
}

// Single button that cycles Free → Fine → Coarse. Replaces the 3-chip group to
// reclaim toolbar width. Shows the active label + its step; click advances.
function SnapCycleButton({
  snapMode,
  setSnapMode,
}: {
  snapMode: 'off' | 'fine' | 'coarse';
  setSnapMode: (m: 'off' | 'fine' | 'coarse') => void;
}) {
  const cur = SNAPS.find((s) => s.id === snapMode)!;
  const active = snapMode !== 'off';
  const next = SNAPS.find((s) => s.id === SNAP_ORDER[(SNAP_ORDER.indexOf(snapMode) + 1) % SNAP_ORDER.length])!;
  return (
    // Never squeezed: one short phrase at a fixed height with fully rounded ends has
    // no graceful narrow form, so the honest reflow is to take a whole row — which,
    // with the cluster wrapping, is what `flexShrink: 0` buys. `Snap · Coarse`
    // wrapping to a second line inside a 30px box is what this replaced.
    <div className="chrome-pill" style={{ flexShrink: 0 }}>
      <button
        type="button"
        onClick={() => setSnapMode(next.id)}
        aria-label={`Snap: ${cur.label}, ${cur.sub}. Activate for ${next.label}.`}
        title={`Snap · ${cur.label} (${cur.sub}) · Next: ${next.label}`}
        className={`chrome-pill__text${active ? ' is-on' : ''}`}
        style={{ whiteSpace: 'nowrap' }}
      >
        <span
          aria-hidden="true"
          style={{
            width: 6,
            height: 6,
            flexShrink: 0,
            borderRadius: '50%',
            background: active ? 'var(--accent)' : 'var(--ink-4)',
          }}
        />
        {/* An element, not a bare text node: a text node is an anonymous flex item,
            which nothing can address — no `nowrap`, no `overflow`, no min-width. */}
        <span>Snap · {cur.label}</span>
      </button>
    </div>
  );
}

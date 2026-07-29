'use client';

// Mode toggle at the top-left of the canvas: Move (W) · Scale (S) · Rotate (R),
// plus the snap cycle. The room layout positions it; this owns the look.
// Boundaries use --edge rather than a decorative hairline because this floats
// over a 3D scene, where a 1.1:1 border is simply invisible.

import { useStudio } from '@/lib/store';
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

const SNAPS: Array<{ id: 'off' | 'fine' | 'coarse'; label: string; sub: string }> = [
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

  return (
    <div style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
      <div className="toolbar" role="group" aria-label="What dragging does" style={{ borderColor: 'var(--edge)' }}>
        {MODES.map((m, i) => {
          const active = mode === m.id;
          return (
            <button
              key={m.id}
              onClick={() => setMode(m.id)}
              aria-pressed={active}
              aria-label={`${m.label} — dragging will ${m.does} (${m.key})`}
              title={
                selected
                  ? `${m.label} (${m.key}) — dragging will ${m.does}`
                  : `${m.label} (${m.key}) — ${m.does}; applies to the next piece you select`
              }
              style={{
                height: 30,
                padding: '0 12px',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                background: active ? 'var(--ink)' : 'transparent',
                // Dimmed by token, not by opacity: a 0.6-alpha --ink-2 drops
                // under 4.5:1, and this row is 12px type.
                color: active ? 'var(--paper)' : selected ? 'var(--ink-2)' : 'var(--ink-3)',
                border: 'none',
                borderLeft: i > 0 ? '1px solid var(--hairline-strong)' : 'none',
                fontFamily: 'var(--font-sans)',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              <Icon name={m.icon} size={12} />
              <span>{m.label}</span>
              <kbd
                style={{
                  fontFamily: 'var(--font-sans)',
                  fontSize: 9.5,
                  fontWeight: 700,
                  padding: '1px 4px',
                  marginLeft: 2,
                  borderRadius: 'var(--r-1)',
                  // On the dark active button the keycap flips to a paper chip —
                  // a translucent white border was both a hard-coded colour and
                  // barely visible.
                  background: active ? 'var(--paper)' : 'var(--paper-2)',
                  color: 'var(--ink)',
                }}
              >
                {m.key}
              </kbd>
            </button>
          );
        })}
      </div>

      <SnapCycleButton snapMode={snapMode} setSnapMode={setSnapMode} />
    </div>
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
    <button
      onClick={() => setSnapMode(next.id)}
      aria-label={`Snap: ${cur.label}, ${cur.sub}. Activate for ${next.label}.`}
      title={`Snap · ${cur.label} (${cur.sub}) — click for ${next.label}`}
      style={{
        height: 30,
        padding: '0 12px',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 7,
        background: active ? 'var(--accent-tint)' : 'var(--paper)',
        border: `1px solid ${active ? 'var(--accent-text)' : 'var(--edge)'}`,
        borderRadius: 'var(--r-3)',
        boxShadow: 'var(--shadow-soft)',
        cursor: 'pointer',
        fontFamily: 'var(--font-sans)',
        fontSize: 12,
        fontWeight: 700,
        color: active ? 'var(--accent-text)' : 'var(--ink-2)',
      }}
    >
      <span
        aria-hidden="true"
        style={{ width: 6, height: 6, borderRadius: '50%', background: active ? 'var(--accent)' : 'var(--ink-4)' }}
      />
      Snap · {cur.label}
    </button>
  );
}

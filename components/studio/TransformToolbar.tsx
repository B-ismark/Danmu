'use client';

// Maya-style mode toggle: Move (W) · Rotate (E) · Scale (R)
// Sits at top-left of canvas. Clear icon + label + keybinding.

import { useStudio } from '@/lib/store';
import { Icon } from '@/components/ui/Icon';
import type { IconName } from '@/components/ui/Icon';

const MODES: Array<{ id: 'translate' | 'rotate' | 'scale'; label: string; key: string; icon: IconName }> = [
  { id: 'translate', label: 'Move', key: 'W', icon: 'arrow-up-right' },
  { id: 'scale', label: 'Scale', key: 'S', icon: 'ruler' },
  { id: 'rotate', label: 'Rotate', key: 'R', icon: 'refresh' },
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
      <div className="toolbar">
        {MODES.map((m, i) => (
          <button
            key={m.id}
            onClick={() => setMode(m.id)}
            aria-label={`${m.label} (${m.key})`}
            title={`${m.label} (${m.key})`}
            style={{
              height: 30,
              padding: '0 12px',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              background: mode === m.id ? 'var(--ink)' : 'transparent',
              color: mode === m.id ? 'var(--paper)' : 'var(--ink-2)',
              border: 'none',
              borderLeft: i > 0 ? '1px solid var(--hairline-strong)' : 'none',
              fontFamily: 'var(--font-sans)',
              fontSize: 12,
              cursor: 'pointer',
              opacity: !selected ? 0.6 : 1,
            }}
          >
            <Icon name={m.icon} size={12} color={mode === m.id ? 'var(--paper)' : 'var(--ink-2)'} />
            <span>{m.label}</span>
            <kbd
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 9,
                padding: '1px 4px',
                border: `1px solid ${mode === m.id ? 'rgba(255,255,255,0.4)' : 'var(--hairline-strong)'}`,
                borderRadius: 2,
                opacity: 0.85,
                marginLeft: 2,
              }}
            >
              {m.key}
            </kbd>
          </button>
        ))}
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
  function cycle() {
    const next = SNAP_ORDER[(SNAP_ORDER.indexOf(snapMode) + 1) % SNAP_ORDER.length];
    setSnapMode(next);
  }
  return (
    <button
      onClick={cycle}
      title={`Snap · ${cur.label} (${cur.sub}) — click to cycle`}
      style={{
        height: 30,
        padding: '0 12px',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 7,
        background: 'var(--paper)',
        border: `1px solid ${active ? 'var(--accent)' : 'var(--hairline-strong)'}`,
        borderRadius: 4,
        boxShadow: '0 2px 6px rgba(0,0,0,0.06)',
        cursor: 'pointer',
        fontFamily: 'var(--font-sans)',
        fontSize: 12,
        fontWeight: 600,
        color: active ? 'var(--accent)' : 'var(--ink-3)',
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: active ? 'var(--accent)' : 'var(--hairline-strong)' }} />
      Snap · {cur.label}
    </button>
  );
}

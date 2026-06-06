'use client';

import { useStudio } from '@/lib/store';
import { Dot } from '@/components/ui/primitives';

const PRESETS = [
  { id: 'front', label: 'FRONT' },
  { id: 'top', label: 'TOP' },
  { id: 'iso', label: 'ISO' },
  { id: 'free', label: 'FREE' },
] as const;

export function ViewPresetChips() {
  const view = useStudio((s) => s.viewPreset);
  const setView = useStudio((s) => s.setView);
  const showGrid = useStudio((s) => s.showGrid);
  const toggleGrid = useStudio((s) => s.toggleGrid);
  return (
    <div style={{ position: 'absolute', bottom: 12, right: 12, display: 'flex', gap: 6 }}>
      <button
        onClick={toggleGrid}
        title="Toggle floor grid"
        className={`ds-chip ${showGrid ? 'ds-chip--accent' : ''}`}
        style={{ cursor: 'pointer', height: 26, fontWeight: 500, border: 0, background: showGrid ? 'var(--accent-tint)' : 'var(--paper)' }}
      >
        {showGrid && <Dot color="var(--accent)" size={5} />}
        GRID
      </button>
      {PRESETS.map((p) => (
        <button
          key={p.id}
          onClick={() => setView(p.id)}
          className={`ds-chip ${view === p.id ? 'ds-chip--accent' : ''}`}
          style={{ cursor: 'pointer', height: 26, fontWeight: 500, border: 0, background: view === p.id ? 'var(--accent-tint)' : 'var(--paper)' }}
        >
          {view === p.id && <Dot color="var(--accent)" size={5} />}
          {p.label}
        </button>
      ))}
    </div>
  );
}

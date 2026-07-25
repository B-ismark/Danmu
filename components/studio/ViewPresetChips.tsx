'use client';

import { useStudio } from '@/lib/store';
import { Dot, Segmented } from '@/components/ui/primitives';

const PRESETS = [
  { value: 'front', label: 'Front' },
  { value: 'top', label: 'Top' },
  { value: 'iso', label: 'Iso' },
  { value: 'free', label: 'Free' },
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
        aria-pressed={showGrid}
        className={`ds-chip ${showGrid ? 'ds-chip--accent' : ''}`}
        style={{ cursor: 'pointer', height: 26, fontWeight: 500, border: 0, background: showGrid ? 'var(--accent-tint)' : 'var(--paper)' }}
      >
        {showGrid && <Dot color="var(--accent)" size={5} />}
        Grid
      </button>
      <Segmented
        ariaLabel="View"
        value={view}
        onChange={setView}
        options={PRESETS.map((p) => ({ value: p.value, label: p.label }))}
        size={26}
      />
    </div>
  );
}

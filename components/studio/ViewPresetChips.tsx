'use client';

// Camera presets — where you stand, and nothing else.
//
// The floor-grid toggle used to ride along here, which made this row two
// unrelated things wearing the same clothes: three of the four buttons moved the
// camera and the fourth changed what the floor looked like. The grid is a display
// setting and lives with the other display settings, in the Look popover. This
// row is now one idea, and it no longer positions itself — the dock does.

import { useStudio } from '@/lib/store';
import { Segmented } from '@/components/ui/primitives';

const PRESETS = [
  { value: 'front', label: 'Front' },
  { value: 'top', label: 'Top' },
  { value: 'iso', label: 'Iso' },
  { value: 'free', label: 'Free' },
] as const;

export function ViewPresetChips() {
  const view = useStudio((s) => s.viewPreset);
  const setView = useStudio((s) => s.setView);
  return (
    <Segmented
      ariaLabel="Camera"
      value={view}
      onChange={setView}
      options={PRESETS.map((p) => ({ value: p.value, label: p.label }))}
      size={30}
    />
  );
}

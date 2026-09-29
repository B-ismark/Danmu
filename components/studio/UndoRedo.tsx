'use client';

import { playSound } from '@/lib/sound';
import { useHistory, applySnapshot } from '@/lib/history';
import { IconButton } from '@/components/ui/primitives';
import { usePhoneStudio } from './NarrowViewportBanner';

export function UndoRedo() {
  const canUndo = useHistory((s) => s.past.length >= 2);
  const canRedo = useHistory((s) => s.future.length > 0);
  // Level with the mode buttons beside it, which grow to 40 on a phone.
  const size = usePhoneStudio() ? 40 : 30;

  // A `.chrome-pill` like every other cluster over the room: two round buttons in
  // one capsule, and no rule between them — the gap is the separation.
  return (
    <div className="chrome-pill" role="group" aria-label="Edit history">
      <IconButton
        icon="arrow-left"
        label="Undo"
        title="Undo (Ctrl+Z)"
        onClick={() => {
          const snap = useHistory.getState().undo();
          if (snap) {
            applySnapshot(snap);
            playSound('undo');
          }
        }}
        disabled={!canUndo}
        size={size}
        iconSize={14}
      />
      <IconButton
        icon="arrow-right"
        label="Redo"
        title="Redo (Ctrl+Shift+Z)"
        onClick={() => {
          const snap = useHistory.getState().redo();
          if (snap) {
            applySnapshot(snap);
            playSound('redo');
          }
        }}
        disabled={!canRedo}
        size={size}
        iconSize={14}
      />
    </div>
  );
}

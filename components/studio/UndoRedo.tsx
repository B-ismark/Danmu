'use client';

import { useHistory, applySnapshot } from '@/lib/history';
import { IconButton } from '@/components/ui/primitives';

export function UndoRedo() {
  const canUndo = useHistory((s) => s.past.length >= 2);
  const canRedo = useHistory((s) => s.future.length > 0);

  return (
    <div className="toolbar" role="group" aria-label="Edit history">
      <IconButton
        icon="arrow-left"
        label="Undo"
        title="Undo (Ctrl+Z)"
        onClick={() => {
          const snap = useHistory.getState().undo();
          if (snap) applySnapshot(snap);
        }}
        disabled={!canUndo}
        size={28}
        iconSize={12}
        style={{ borderRight: '1px solid var(--hairline-strong)' }}
      />
      <IconButton
        icon="arrow-right"
        label="Redo"
        title="Redo (Ctrl+Shift+Z)"
        onClick={() => {
          const snap = useHistory.getState().redo();
          if (snap) applySnapshot(snap);
        }}
        disabled={!canRedo}
        size={28}
        iconSize={12}
      />
    </div>
  );
}

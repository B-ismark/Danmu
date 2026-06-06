'use client';

import { useHistory, applySnapshot } from '@/lib/history';
import { Icon } from '@/components/ui/Icon';

export function UndoRedo() {
  const canUndo = useHistory((s) => s.past.length >= 2);
  const canRedo = useHistory((s) => s.future.length > 0);

  return (
    <div style={{ display: 'flex', border: '1px solid var(--hairline-strong)' }}>
      <button
        onClick={() => {
          const snap = useHistory.getState().undo();
          if (snap) applySnapshot(snap);
        }}
        disabled={!canUndo}
        title="Undo (Ctrl+Z)"
        aria-label="Undo"
        style={btnStyle(canUndo, true)}
      >
        <Icon name="arrow-left" size={12} color={canUndo ? 'var(--ink)' : 'var(--ink-4)'} />
      </button>
      <button
        onClick={() => {
          const snap = useHistory.getState().redo();
          if (snap) applySnapshot(snap);
        }}
        disabled={!canRedo}
        title="Redo (Ctrl+Shift+Z)"
        aria-label="Redo"
        style={btnStyle(canRedo, false)}
      >
        <Icon name="arrow-right" size={12} color={canRedo ? 'var(--ink)' : 'var(--ink-4)'} />
      </button>
    </div>
  );
}

function btnStyle(enabled: boolean, isFirst: boolean): React.CSSProperties {
  return {
    height: 28,
    width: 32,
    background: enabled ? 'var(--paper)' : 'var(--paper-2)',
    border: 'none',
    borderRight: isFirst ? '1px solid var(--hairline-strong)' : 'none',
    cursor: enabled ? 'pointer' : 'not-allowed',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    opacity: enabled ? 1 : 0.5,
  };
}

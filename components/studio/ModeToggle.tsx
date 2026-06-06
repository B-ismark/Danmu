'use client';

import { useStudio } from '@/lib/store';

export function ModeToggle() {
  const mode = useStudio((s) => s.renderMode);
  const setMode = useStudio((s) => s.setMode);
  return (
    <div style={{ display: 'flex', border: '1px solid var(--hairline-strong)' }}>
      {(
        [
          { id: 'construction', label: 'Construction' },
          { id: 'finish', label: 'Finish' },
        ] as const
      ).map((m) => (
        <button
          key={m.id}
          onClick={() => setMode(m.id)}
          style={{
            height: 28,
            padding: '0 12px',
            background: mode === m.id ? 'var(--ink)' : 'transparent',
            color: mode === m.id ? 'var(--paper)' : 'var(--ink-2)',
            border: 'none',
            fontSize: 10,
            cursor: 'pointer',
          }}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}

'use client';

import { useMemo, useState } from 'react';
import { useScene } from '@/lib/scene-store';
import { useStudio } from '@/lib/store';
import { searchLibrary, parseDims } from '@/lib/shape-search';
import { clampDims } from '@/lib/dimension-ranges';
import type { LibraryItem, ScenePart } from '@/lib/scene-spec';
import { Icon } from '@/components/ui/Icon';
import { Modal } from '@/components/ui/Modal';

// "Improve" a part: describe what it really is, pick the closest catalog
// model. Local token matching (lib/shape-search) — no AI, instant. Explicit
// sizes in the text ("1200mm tall") carry into the new dims, clamped.
export function RegenerateModal({
  partId,
  part,
  onClose,
}: {
  partId: string;
  part: ScenePart;
  onClose: () => void;
}) {
  const updatePart = useScene((s) => s.updatePart);
  const resetTransforms = useStudio((s) => s.resetTransforms);
  const [prompt, setPrompt] = useState(part.name);

  const matches = useMemo(() => searchLibrary(prompt, 6), [prompt]);

  function apply(item: LibraryItem) {
    const o = parseDims(prompt);
    const dimMM = clampDims(item.category, item.shape, [
      o.w ?? item.dimMM[0],
      o.d ?? item.dimMM[1],
      o.h ?? item.dimMM[2],
    ]);
    updatePart(partId, { shape: item.shape, category: item.category, name: item.label, dimMM });
    // Clear stale dim/scale overrides so the new dimMM applies cleanly.
    resetTransforms(partId);
    onClose();
  }

  return (
    <Modal
      onClose={onClose}
      labelledBy="swap-model-title"
      width={520}
      footer={
        <button onClick={onClose} className="ds-btn" style={{ flex: 1, height: 36, fontSize: 13, justifyContent: 'center' }}>
          Cancel
        </button>
      }
    >
      <div className="ds-kicker" style={{ marginBottom: 6 }}>Swap model</div>
      <div id="swap-model-title" style={{ fontSize: 22, fontWeight: 600, marginBottom: 6, letterSpacing: '-0.01em' }}>{part.name}</div>
      <p style={{ fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.5, margin: '0 0 14px' }}>
        Describe what this piece really is — sizes you include (&quot;1200mm tall&quot;) carry over.
      </p>

      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder='e.g. "office chair, high back, ~1200mm tall"'
        autoFocus
        style={{
          width: '100%',
          minHeight: 56,
          border: '1px solid var(--hairline-strong)',
          borderRadius: 'var(--r-2)',
          padding: 10,
          fontFamily: 'var(--font-sans)',
          fontSize: 13,
          background: 'var(--paper)',
          color: 'var(--ink)',
          resize: 'vertical',
          outline: 'none',
          marginBottom: 12,
        }}
        onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--accent)')}
        onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--hairline-strong)')}
      />

      {matches.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 240, overflow: 'auto' }}>
          {matches.map((m) => (
            <button
              key={m.label}
              onClick={() => apply(m)}
              className="ds-btn"
              style={{ height: 34, fontSize: 12, justifyContent: 'space-between', paddingLeft: 10 }}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <Icon name="swap" size={11} />
                {m.label}
              </span>
              <span className="mono" style={{ fontSize: 9, color: 'var(--ink-3)' }}>
                {m.dimMM[0]}×{m.dimMM[1]}×{m.dimMM[2]}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div style={{ fontSize: 12, color: 'var(--ink-3)', padding: '8px 0' }}>
          No catalog match — try other words ("wardrobe", "bookshelf", "armchair"…).
        </div>
      )}
    </Modal>
  );
}

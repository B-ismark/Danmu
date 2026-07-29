'use client';

import { useMemo, useState } from 'react';
import { searchLibrary, parseDims } from '@/lib/shape-search';
import { clampDims } from '@/lib/dimension-ranges';
import type { LibraryItem, ScenePart } from '@/lib/scene-spec';
import { Icon } from '@/components/ui/Icon';
import { Modal } from '@/components/ui/Modal';
import { LibraryPicker } from './LibraryPicker';
import { PickerTabs, DescribeField, type PickerTab } from './AddPartButton';

// The ONE way to change which model a piece uses. It used to be two buttons
// side by side — "Swap model" (browse the catalog) and "AI refine" (describe it)
// — which were the same feature twice over, and the second claimed an AI that
// does not exist here: matching is local token search (lib/shape-search),
// instant and offline. Same Catalog | Describe it pair as the Add flow.
//
// The swap itself is handed back to the caller (`onSwap`), because re-grounding
// the piece for its new dimensions and mount type is physics the Inspector
// already owns — doing it twice is how a swapped-in mirror ended up sunk into
// the floor. Sizes named in the description ("1200mm tall") carry over, clamped.
export function SwapModelModal({
  part,
  onClose,
  onSwap,
}: {
  part: ScenePart;
  onClose: () => void;
  /** apply the swap; `dimMM` overrides the library item's own size when the
   *  description named one. Caller re-grounds and clears stale transforms. */
  onSwap: (item: LibraryItem, dimMM?: [number, number, number]) => void;
}) {
  const [tab, setTab] = useState<PickerTab>('library');
  const [prompt, setPrompt] = useState(part.name);

  const matches = useMemo(() => searchLibrary(prompt, 6), [prompt]);

  function applyDescribed(item: LibraryItem) {
    const o = parseDims(prompt);
    const dimMM = clampDims(item.category, item.shape, [
      o.w ?? item.dimMM[0],
      o.d ?? item.dimMM[1],
      o.h ?? item.dimMM[2],
    ]);
    onSwap(item, dimMM);
  }

  return (
    <Modal
      onClose={onClose}
      labelledBy="swap-model-title"
      width={520}
      bodyPadding="20px 24px 12px"
      footer={
        <button onClick={onClose} className="ds-btn" style={{ flex: 1, height: 36, fontSize: 13, justifyContent: 'center' }}>
          Cancel
        </button>
      }
    >
      <div className="ds-kicker" style={{ marginBottom: 6, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <Icon name="swap" size={13} /> Change the model
      </div>
      <div id="swap-model-title" style={{ fontSize: 22, fontWeight: 600, marginBottom: 6, letterSpacing: '-0.01em' }}>
        {part.name}
      </div>
      <p style={{ fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.5, margin: '0 0 14px' }}>
        Pick a closer model. It stays where it is and keeps its colour and finish.
      </p>

      <PickerTabs tab={tab} onChange={setTab} style={{ marginBottom: 14 }} />

      {tab === 'library' ? (
        <LibraryPicker onPick={(item) => onSwap(item)} />
      ) : (
        <>
          <p style={{ fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.5, margin: '0 0 12px' }}>
            Describe what this piece really is — sizes you include (&quot;1200mm tall&quot;) carry over.
          </p>
          <DescribeField
            value={prompt}
            onChange={setPrompt}
            label="Describe this piece"
            placeholder='e.g. "office chair, high back, ~1200mm tall"'
          />
          {matches.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 240, overflow: 'auto' }}>
              {matches.map((m) => (
                <button
                  key={m.label}
                  onClick={() => applyDescribed(m)}
                  className="ds-btn"
                  style={{ height: 34, fontSize: 12, justifyContent: 'space-between', paddingLeft: 10 }}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <Icon name="swap" size={11} />
                    {m.label}
                  </span>
                  <span className="mono" style={{ fontSize: 9.5, color: 'var(--ink-3)' }}>
                    {m.dimMM[0]}×{m.dimMM[1]}×{m.dimMM[2]}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: 12, color: 'var(--ink-3)', padding: '8px 0', lineHeight: 1.5 }}>
              Nothing matches those words — try &quot;wardrobe&quot;, &quot;bookshelf&quot; or
              &quot;armchair&quot;, or browse the Catalog tab.
            </div>
          )}
        </>
      )}
    </Modal>
  );
}

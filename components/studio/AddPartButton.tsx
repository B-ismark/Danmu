'use client';

import { useMemo, useState } from 'react';
import { v4 as uuid } from 'uuid';
import { useScene } from '@/lib/scene-store';
import { useStudio } from '@/lib/store';
import { searchLibrary, parseDims } from '@/lib/shape-search';
import { clampDims } from '@/lib/dimension-ranges';
import { placeNewPart, type LibraryItem, type ScenePart } from '@/lib/scene-spec';
import { Icon } from '@/components/ui/Icon';
import { Modal } from '@/components/ui/Modal';
import { LibraryPicker } from './LibraryPicker';

// One button → opens modal → pick from the catalog, or describe a piece in
// words. Matching is local token search (lib/shape-search) — no AI, instant,
// and explicit sizes in the text ("180cm wide") carry into the spawned part.

export function AddPartButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="ds-btn"
        style={{
          width: '100%',
          height: 32,
          fontSize: 12,
          justifyContent: 'center',
          background: 'var(--accent-tint)',
          // --accent as type on --accent-tint measures 2.89:1; --accent-text is
          // the accent-coloured ink that clears 4.5:1 on the same tint.
          borderColor: 'var(--accent-text)',
          color: 'var(--accent-text)',
        }}
      >
        <Icon name="plus" size={12} />
        Add furniture
      </button>
      {open && <AddPartModal onClose={() => setOpen(false)} />}
    </>
  );
}

export type PickerTab = 'library' | 'describe';

/** Catalog | Describe it — the two ways into every model picker in the studio.
 *  Shared so the Add flow and the Swap flow can never drift into looking like
 *  two different features. */
export function PickerTabs({
  tab,
  onChange,
  style,
}: {
  tab: PickerTab;
  onChange: (t: PickerTab) => void;
  style?: React.CSSProperties;
}) {
  return (
    <div
      role="group"
      aria-label="How to find a model"
      style={{ display: 'inline-flex', border: '1px solid var(--edge)', borderRadius: 'var(--r-2)', overflow: 'hidden', ...style }}
    >
      {(['library', 'describe'] as const).map((t, i) => (
        <button
          key={t}
          onClick={() => onChange(t)}
          aria-pressed={tab === t}
          style={{
            height: 30,
            padding: '0 16px',
            border: 'none',
            borderLeft: i > 0 ? '1px solid var(--edge)' : 'none',
            background: tab === t ? 'var(--ink)' : 'transparent',
            color: tab === t ? 'var(--on-ink)' : 'var(--ink-2)',
            fontSize: 12,
            fontWeight: 600,
            fontFamily: 'var(--font-sans)',
            cursor: 'pointer',
          }}
        >
          {t === 'library' ? 'Catalog' : 'Describe it'}
        </button>
      ))}
    </div>
  );
}

/** The description box shared by the Add and Swap flows. A placeholder is not a
 *  label, so the real one is always attached. */
export function DescribeField({
  value,
  onChange,
  label,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  placeholder: string;
}) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={label}
      placeholder={placeholder}
      autoFocus
      className="field"
      style={{
        minHeight: 56,
        height: 'auto',
        padding: 10,
        fontFamily: 'var(--font-sans)',
        fontSize: 13,
        lineHeight: 1.4,
        resize: 'vertical',
        marginBottom: 12,
      }}
    />
  );
}

function AddPartModal({ onClose }: { onClose: () => void }) {
  const addPart = useScene((s) => s.addPart);
  const setSelected = useStudio((s) => s.setSelected);
  const [tab, setTab] = useState<PickerTab>('library');
  const [prompt, setPrompt] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Live local matches — recomputed as the user types. No network involved.
  const matches = useMemo(() => searchLibrary(prompt, 5), [prompt]);

  // Shared spawn — gravity applied so wall-hung items mount at height, others
  // rest on the surface/floor. Used by both the library and the prompt path.
  function spawn(category: ScenePart['category'], shape: ScenePart['shape'], dimMM: [number, number, number], name: string) {
    const id = `${category}-${uuid().slice(0, 6)}`;
    const { room, parts } = useScene.getState();
    const { pos, wallMounted } = placeNewPart(category, shape, dimMM, room, parts);
    addPart({ id, category, name, shape, pos, rot: 0, dimMM, locked: false, wallMounted });
    setSelected(id);
    onClose();
  }

  function addFromLibrary(item: LibraryItem) {
    spawn(item.category, item.shape, [...item.dimMM], item.label);
  }

  // Spawn a match with any explicit sizes from the description applied
  // ("queen bed 160x200cm" → those dims, clamped into the trustable range).
  function addMatch(item: LibraryItem) {
    const o = parseDims(prompt);
    const dim = clampDims(item.category, item.shape, [
      o.w ?? item.dimMM[0],
      o.d ?? item.dimMM[1],
      o.h ?? item.dimMM[2],
    ]);
    spawn(item.category, item.shape, dim, item.label);
  }

  function go() {
    if (matches.length === 0) {
      setError('Nothing in the catalog matches that — try other words, or pick from the Catalog tab.');
      return;
    }
    addMatch(matches[0]);
  }

  return (
    <Modal
      onClose={onClose}
      labelledBy="add-part-title"
      width={520}
      bodyPadding="20px 24px 12px"
      footer={
        <>
          <button onClick={onClose} className="ds-btn" style={{ flex: 1, height: 36, fontSize: 13, justifyContent: 'center' }}>
            {tab === 'library' ? 'Close' : 'Cancel'}
          </button>
          {tab === 'describe' && (
            <button
              onClick={go}
              disabled={matches.length === 0}
              className="ds-btn ds-btn--primary"
              style={{ flex: 1, height: 36, fontSize: 13, justifyContent: 'center' }}
            >
              <Icon name="plus" size={12} />
              Add best match
            </button>
          )}
        </>
      }
    >
      <div id="add-part-title" className="ds-kicker" style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
        <Icon name="plus" size={13} /> Add furniture
      </div>

      {/* Two ways in: pick from the catalog, or describe a piece in words. */}
      <PickerTabs tab={tab} onChange={(t) => { setTab(t); setError(null); }} style={{ marginBottom: 14 }} />

      {tab === 'library' ? (
        <LibraryPicker onPick={addFromLibrary} />
      ) : (
        <>
          <p style={{ fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.5, margin: '0 0 12px' }}>
            Type what you want — sizes included (&quot;180cm wide&quot;) carry into the piece.
          </p>
          <DescribeField
            value={prompt}
            onChange={(v) => { setPrompt(v); setError(null); }}
            label="Describe the piece you want"
            placeholder='e.g. "tall mirror 1700mm" or "queen bed 160x200cm"'
          />
          {matches.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {matches.map((m) => (
                <button
                  key={m.label}
                  onClick={() => addMatch(m)}
                  className="ds-btn"
                  style={{ height: 34, fontSize: 12, justifyContent: 'space-between', paddingLeft: 10 }}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <Icon name="plus" size={11} />
                    {m.label}
                  </span>
                  <span className="mono" style={{ fontSize: 9.5, color: 'var(--ink-3)' }}>
                    {m.dimMM[0]}×{m.dimMM[1]}×{m.dimMM[2]}
                  </span>
                </button>
              ))}
            </div>
          )}
          {prompt.trim().length > 1 && matches.length === 0 && (
            <div style={{ fontSize: 12, color: 'var(--ink-3)', padding: '8px 0', lineHeight: 1.5 }}>
              Nothing matches yet — keep typing, or browse the Catalog tab.
            </div>
          )}
        </>
      )}

      {error && (
        <div
          style={{
            marginTop: 12,
            padding: 10,
            background: 'var(--danger-tint)',
            border: '1px solid var(--danger)',
            borderRadius: 'var(--r-1)',
            // --danger-text, not --danger: this is 12px type sitting on the tint.
            color: 'var(--danger-text)',
            fontSize: 12,
            lineHeight: 1.45,
          }}
        >
          {error}
        </div>
      )}
    </Modal>
  );
}

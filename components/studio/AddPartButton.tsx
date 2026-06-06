'use client';

import { useRef, useState } from 'react';
import { v4 as uuid } from 'uuid';
import { useScene } from '@/lib/scene-store';
import { useStudio, useSettings } from '@/lib/store';
import { regenerateShape, blobToBase64Raw } from '@/lib/regenerate';
import { placeNewPart, type LibraryItem, type ScenePart } from '@/lib/scene-spec';
import { Icon } from '@/components/ui/Icon';
import { LibraryPicker } from './LibraryPicker';

// One button → opens modal → user describes (or uploads image) → Gemini picks
// shape from catalog → new ScenePart spawned at room center floor.

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
          borderColor: 'var(--accent)',
          color: 'var(--accent)',
        }}
      >
        <Icon name="plus" size={12} />
        Add furniture
      </button>
      {open && <AddPartModal onClose={() => setOpen(false)} />}
    </>
  );
}

function AddPartModal({ onClose }: { onClose: () => void }) {
  const apiKey = useSettings((s) => s.apiKey);
  const addPart = useScene((s) => s.addPart);
  const setSelected = useStudio((s) => s.setSelected);
  const [tab, setTab] = useState<'library' | 'describe'>('library');
  const [prompt, setPrompt] = useState('');
  const [refFile, setRefFile] = useState<File | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

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

  async function go() {
    if (!prompt.trim() && !refFile) {
      setError('Add a description or upload a reference image.');
      return;
    }
    setRunning(true);
    setError(null);
    try {
      const ref = refFile ? await blobToBase64Raw(refFile) : undefined;
      // Seed Gemini with a generic placeholder so it picks the right shape from scratch.
      const seed: ScenePart = {
        id: 'new',
        category: 'other',
        name: prompt.split(/\s+/).slice(0, 3).join(' ') || 'New item',
        shape: 'box',
        pos: [0, 0, 0],
        rot: 0,
        dimMM: [600, 600, 800],
        locked: false,
      };
      const result = await regenerateShape(apiKey, seed, prompt, ref);
      spawn(result.category, result.shape, result.dimMM, result.name);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Add failed.');
      setRunning(false);
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(19,19,17,0.55)',
        display: 'grid',
        placeItems: 'center',
        zIndex: 100,
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(520px, 92vw)',
          background: 'var(--paper)',
          border: '1px solid var(--ink)',
          boxShadow: '0 30px 80px rgba(0,0,0,0.4)',
        }}
      >
        <div style={{ height: 4, background: 'var(--accent)' }} />
        <div style={{ padding: '20px 24px 12px' }}>
          <div className="ds-kicker" style={{ marginBottom: 10 }}>＋ Add furniture</div>

          {/* Two ways in: pick from the catalog, or describe a piece in words. */}
          <div style={{ display: 'inline-flex', border: '1px solid var(--hairline-strong)', borderRadius: 'var(--r-2)', overflow: 'hidden', marginBottom: 14 }}>
            {(['library', 'describe'] as const).map((t, i) => (
              <button
                key={t}
                onClick={() => { setTab(t); setError(null); }}
                style={{
                  height: 30,
                  padding: '0 16px',
                  border: 'none',
                  borderLeft: i > 0 ? '1px solid var(--hairline-strong)' : 'none',
                  background: tab === t ? 'var(--ink)' : 'transparent',
                  color: tab === t ? 'var(--paper)' : 'var(--ink-2)',
                  fontSize: 12,
                  fontFamily: 'var(--font-sans)',
                  cursor: 'pointer',
                }}
              >
                {t === 'library' ? 'Catalog' : 'Describe it'}
              </button>
            ))}
          </div>

          {tab === 'library' ? (
            <LibraryPicker onPick={addFromLibrary} />
          ) : (
            <>
              <p style={{ fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.5, margin: '0 0 12px' }}>
                Type what you want and we&apos;ll add the closest match — optionally with a reference photo.
              </p>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder='e.g. "tall floor mirror with wooden frame, 1700mm" or "queen bed with white linen"'
                style={{
                  width: '100%',
                  minHeight: 72,
                  border: '1px solid var(--hairline-strong)',
                  borderRadius: 2,
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
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={(e) => setRefFile(e.target.files?.[0] ?? null)}
              />
              <button
                onClick={() => fileRef.current?.click()}
                className="ds-btn"
                style={{ height: 36, fontSize: 12, width: '100%', justifyContent: 'flex-start' }}
              >
                <Icon name="image" size={12} />
                {refFile ? refFile.name : 'Upload reference image (optional)'}
              </button>
            </>
          )}

          {error && (
            <div
              style={{
                marginTop: 12,
                padding: 10,
                background: 'rgba(192,38,24,0.06)',
                border: '1px solid var(--danger)',
                color: 'var(--danger)',
                fontSize: 12,
              }}
            >
              {error}
            </div>
          )}
        </div>
        <div
          style={{
            padding: '14px 24px',
            background: 'var(--paper-2)',
            borderTop: '1px solid var(--hairline)',
            display: 'flex',
            gap: 8,
          }}
        >
          <button onClick={onClose} className="ds-btn" style={{ flex: 1, height: 36, fontSize: 13, justifyContent: 'center' }}>
            {tab === 'library' ? 'Close' : 'Cancel'}
          </button>
          {tab === 'describe' && (
            <button
              onClick={go}
              disabled={running}
              className="ds-btn ds-btn--primary"
              style={{ flex: 1, height: 36, fontSize: 13, justifyContent: 'center' }}
            >
              <Icon name="plus" size={12} />
              {running ? 'Adding…' : 'Add to scene'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

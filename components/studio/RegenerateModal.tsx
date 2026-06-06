'use client';

import { useRef, useState } from 'react';
import { useScene } from '@/lib/scene-store';
import { useSettings, useStudio } from '@/lib/store';
import { regenerateShape, blobToBase64Raw } from '@/lib/regenerate';
import type { ScenePart } from '@/lib/scene-spec';
import { Icon } from '@/components/ui/Icon';

export function RegenerateModal({
  partId,
  part,
  onClose,
}: {
  partId: string;
  part: ScenePart;
  onClose: () => void;
}) {
  const apiKey = useSettings((s) => s.apiKey);
  const updatePart = useScene((s) => s.updatePart);
  const resetTransforms = useStudio((s) => s.resetTransforms);
  const [prompt, setPrompt] = useState('');
  const [refFile, setRefFile] = useState<File | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function go() {
    if (!prompt.trim() && !refFile) {
      setError('Add a description or upload a reference image.');
      return;
    }
    setRunning(true);
    setError(null);
    try {
      const ref = refFile ? await blobToBase64Raw(refFile) : undefined;
      const result = await regenerateShape(apiKey, part, prompt, ref);
      updatePart(partId, {
        shape: result.shape,
        category: result.category,
        name: result.name,
        dimMM: result.dimMM,
      });
      // Clear stale dim/scale overrides so the new dimMM applies cleanly.
      resetTransforms(partId);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Regeneration failed.');
    } finally {
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
        <div style={{ padding: '20px 24px' }}>
          <div className="ds-kicker" style={{ marginBottom: 6 }}>↻ AI refine</div>
          <div style={{ fontSize: 22, fontWeight: 600, marginBottom: 6, letterSpacing: '-0.01em' }}>{part.name}</div>
          <p style={{ fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.5, margin: '0 0 14px' }}>
            Describe what you want OR drop a reference image. Gemini picks the closest 3D primitive from our catalog and
            refines its dimensions.
          </p>

          <label className="ds-label" style={{ display: 'block', marginBottom: 6 }}>
            Description
          </label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder='e.g. "executive leather office chair with high back and armrests, ~1200mm tall"'
            style={{
              width: '100%',
              minHeight: 80,
              border: '1px solid var(--hairline-strong)',
              borderRadius: 2,
              padding: 10,
              fontFamily: 'var(--font-sans)',
              fontSize: 13,
              background: 'var(--paper)',
              color: 'var(--ink)',
              resize: 'vertical',
              outline: 'none',
              marginBottom: 14,
            }}
            onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--accent)')}
            onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--hairline-strong)')}
          />

          <label className="ds-label" style={{ display: 'block', marginBottom: 6 }}>
            Reference image (optional)
          </label>
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
            {refFile ? refFile.name : 'Upload reference image'}
          </button>

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
            Cancel
          </button>
          <button
            onClick={go}
            disabled={running}
            className="ds-btn ds-btn--primary"
            style={{ flex: 1, height: 36, fontSize: 13, justifyContent: 'center' }}
          >
            <Icon name="sparkles" size={12} />
            {running ? 'Generating…' : 'Regenerate'}
          </button>
        </div>
      </div>
    </div>
  );
}

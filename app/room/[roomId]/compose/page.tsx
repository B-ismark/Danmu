'use client';

import { useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useCompose } from '@/lib/store';
import { Icon } from '@/components/ui/Icon';
import { STYLES, BUDGET_TIERS, tierFor } from '@/lib/prompt';

// A swatch per style so the picker reads visually, not as a list of words.
const STYLE_SWATCH: Record<string, [string, string, string]> = {
  'warm-min': ['#E8DCC8', '#C9A87C', '#6F5436'],
  'afro-mod': ['#D98E5A', '#B5482E', '#2E2A26'],
  coastal: ['#DCE4E2', '#A9C4C0', '#7C9C8E'],
  studio: ['#D8D6D2', '#9A9893', '#3A3934'],
  heritage: ['#C99A5B', '#8A4B2A', '#3E2417'],
};

export default function ComposePage() {
  const router = useRouter();
  const { roomId } = useParams<{ roomId: string }>();
  const { styleId, budget, variants, setStyle, setBudget, setVariants, setRenderModel } = useCompose();

  // Preview runs silently on the cheapest path. No model choice surfaced.
  useEffect(() => {
    setRenderModel('hf');
  }, [setRenderModel]);

  const tier = tierFor(budget);

  return (
    <div style={{ height: '100%', overflow: 'auto', display: 'grid', placeItems: 'start center' }}>
      <div style={{ width: '100%', maxWidth: 760, padding: '40px 28px 64px' }}>
        <div className="ds-kicker" style={{ marginBottom: 10 }}>Preview</div>
        <h1 style={{ fontSize: 34, margin: '0 0 8px' }}>See your room come to life.</h1>
        <p style={{ fontSize: 15, color: 'var(--ink-2)', lineHeight: 1.55, margin: '0 0 32px', maxWidth: 540 }}>
          Pick a look and we&apos;ll turn your 3D layout into a warm, photo-real picture — same furniture,
          same arrangement, real materials and light.
        </p>

        {/* Style picker */}
        <div className="ds-label" style={{ marginBottom: 12 }}>Choose a style</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 12, marginBottom: 36 }}>
          {Object.entries(STYLES).map(([id, s]) => {
            const sel = styleId === id;
            const sw = STYLE_SWATCH[id] ?? ['#ddd', '#bbb', '#999'];
            return (
              <button
                key={id}
                onClick={() => setStyle(id as keyof typeof STYLES)}
                className="ds-card"
                style={{
                  padding: 0,
                  overflow: 'hidden',
                  cursor: 'pointer',
                  textAlign: 'left',
                  border: sel ? '2px solid var(--accent)' : '1px solid var(--hairline)',
                  boxShadow: sel ? 'var(--shadow-lift)' : 'var(--shadow-soft)',
                  transform: sel ? 'translateY(-2px)' : 'none',
                  transition: 'transform .12s, box-shadow .15s, border-color .15s',
                }}
              >
                <div style={{ display: 'flex', height: 56 }}>
                  {sw.map((c) => (
                    <div key={c} style={{ flex: 1, background: c }} />
                  ))}
                </div>
                <div style={{ padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 6 }}>
                  {sel && <Icon name="check" size={12} color="var(--accent)" />}
                  <span style={{ fontSize: 13.5, fontWeight: 700, color: sel ? 'var(--accent)' : 'var(--ink)' }}>
                    {s.label}
                  </span>
                </div>
              </button>
            );
          })}
        </div>

        {/* Finish level */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
          <span className="ds-label">Finish level</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent)' }}>{tier.label}</span>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          value={budget}
          onChange={(e) => setBudget(Number(e.target.value))}
          style={{ width: '100%', accentColor: 'var(--accent)', cursor: 'pointer' }}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, marginBottom: 36, fontSize: 11, fontWeight: 700, color: 'var(--ink-3)' }}>
          {BUDGET_TIERS.map((t) => (
            <span key={t.label}>{t.label}</span>
          ))}
        </div>

        {/* How many looks */}
        <div className="ds-label" style={{ marginBottom: 10 }}>How many looks</div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 40 }}>
          {[1, 2, 3, 4].map((n) => (
            <button
              key={n}
              onClick={() => setVariants(n)}
              className="ds-card"
              style={{
                width: 52,
                height: 44,
                display: 'grid',
                placeItems: 'center',
                cursor: 'pointer',
                fontSize: 16,
                fontWeight: 700,
                border: variants === n ? '2px solid var(--accent)' : '1px solid var(--hairline)',
                color: variants === n ? 'var(--accent)' : 'var(--ink-2)',
                background: variants === n ? 'var(--accent-tint)' : 'var(--paper)',
              }}
            >
              {n}
            </button>
          ))}
        </div>

        <button
          className="ds-btn ds-btn--accent"
          style={{ height: 52, fontSize: 16, padding: '0 28px' }}
          onClick={() => router.push(`/room/${roomId}/render`)}
        >
          <Icon name="image" size={16} color="#fff" />
          Generate preview
        </button>
        <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 12 }}>
          Takes around half a minute. Your 3D layout stays exactly as you built it.
        </div>
      </div>
    </div>
  );
}

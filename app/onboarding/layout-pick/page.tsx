'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { v4 as uuid } from 'uuid';
import { useRoom } from '@/lib/store';
import { roomStore } from '@/lib/storage';
import { Icon } from '@/components/ui/Icon';
import { DanmuMark, StepHeader } from '@/components/ui/primitives';

const LAYOUTS = [
  { id: 'rect' as const, name: 'Rectangle', area: '24 m²', width: 6.0, depth: 4.0, starter: 'Living room', path: 'M20 20 L220 20 L220 140 L20 140 Z' },
  { id: 'l' as const, name: 'L-Shape', area: '28 m²', width: 6.0, depth: 4.7, starter: 'Living + reading nook', path: 'M20 20 L220 20 L220 90 L130 90 L130 160 L20 160 Z' },
  { id: 't' as const, name: 'T-Shape', area: '26 m²', width: 5.5, depth: 4.7, starter: 'Living + dining', path: 'M60 20 L180 20 L180 80 L220 80 L220 140 L180 140 L180 170 L60 170 L60 140 L20 140 L20 80 L60 80 Z' },
  { id: 'u' as const, name: 'U-Shape', area: '30 m²', width: 6.0, depth: 5.0, starter: 'Bedroom', path: 'M20 20 L80 20 L80 95 L160 95 L160 20 L220 20 L220 160 L20 160 Z' },
  { id: 'open' as const, name: 'Open Plan', area: '42 m²', width: 7.5, depth: 5.6, starter: 'Living + dining loft', path: 'M20 20 L220 20 L220 170 L20 170 Z' },
];
const HEIGHT = 2.8;

export default function LayoutPickPage() {
  const router = useRouter();
  const setRoomId = useRoom((s) => s.setRoomId);
  const [sel, setSel] = useState<(typeof LAYOUTS)[number]['id']>('rect');
  const [saving, setSaving] = useState<null | 'model' | 'capture'>(null);

  const layout = LAYOUTS.find((l) => l.id === sel)!;

  // One save path for both CTAs — no duplicated persistence logic to drift.
  async function createRoom(dest: 'model' | 'capture') {
    if (saving) return;
    setSaving(dest);
    const id = uuid();
    await roomStore.saveRoom({
      id,
      name: 'My Room',
      createdAt: Date.now(),
      layoutId: sel,
      width: layout.width,
      depth: layout.depth,
      height: HEIGHT,
    });
    setRoomId(id);
    router.push(dest === 'model' ? `/room/${id}/model` : '/onboarding/capture');
  }

  return (
    <div
      style={{
        position: 'relative',
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        background:
          'radial-gradient(1100px 560px at 12% -12%, var(--accent-tint), transparent 60%),' +
          'radial-gradient(900px 520px at 108% 116%, var(--accent-2-tint), transparent 55%),' +
          'var(--paper)',
      }}
    >
      <Topbar step="02 / 04" onBack={() => router.back()} />

      <div style={{ flex: 1, display: 'grid', placeItems: 'center', padding: '40px 24px' }}>
        <div
          style={{
            width: '100%',
            maxWidth: 1100,
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))',
            gap: 32,
            alignItems: 'start',
          }}
        >
          {/* INTRO + PICKER */}
          <div>
            <StepHeader
              step={2}
              total={4}
              title="Pick your room's footprint."
              subtitle="Becomes the 1:1 grid your 3D room is built on — start decorating right away, or capture your real room first. Custom shapes coming soon."
            />
            <div role="radiogroup" aria-label="Room footprint" style={{ marginTop: 24, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {LAYOUTS.map((l) => {
                const active = sel === l.id;
                return (
                  <button
                    key={l.id}
                    role="radio"
                    aria-checked={active}
                    aria-label={`${l.name}, ${l.area}, starts as a ${l.starter.toLowerCase()}`}
                    onClick={() => setSel(l.id)}
                    style={{
                      border: `2px solid ${active ? 'var(--accent)' : 'var(--hairline-strong)'}`,
                      background: active ? 'var(--accent-tint)' : 'var(--paper)',
                      borderRadius: 'var(--r-3)',
                      padding: '14px 14px 12px',
                      cursor: 'pointer',
                      textAlign: 'left',
                      minHeight: 122,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8,
                      transition: 'border-color .12s, background .12s',
                    }}
                  >
                    <svg viewBox="0 0 240 180" style={{ width: '100%', height: 60 }} aria-hidden="true">
                      <path
                        d={l.path}
                        fill={active ? 'var(--accent)' : 'var(--ink-4)'}
                        fillOpacity={active ? 0.25 : 0.4}
                        stroke={active ? 'var(--accent)' : 'var(--ink-2)'}
                        strokeWidth="2"
                      />
                    </svg>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                      <span style={{ fontSize: 13.5, fontWeight: 700, color: active ? 'var(--accent)' : 'var(--ink)' }}>{l.name}</span>
                      <span className="mono" style={{ fontSize: 10, color: 'var(--ink-2)' }}>{l.area}</span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--ink-2)' }}>Starts as a {l.starter.toLowerCase()}</div>
                  </button>
                );
              })}
            </div>

            <button
              onClick={() => createRoom('model')}
              disabled={saving !== null}
              className="ds-btn ds-btn--accent"
              style={{ marginTop: 24, height: 48, fontSize: 14, justifyContent: 'center', width: '100%' }}
            >
              {saving === 'model' ? 'Creating your room…' : (<>Start decorating · {layout.starter.toLowerCase()}<Icon name="arrow-right" size={14} color="#fff" /></>)}
            </button>
            <button
              onClick={() => createRoom('capture')}
              disabled={saving !== null}
              className="ds-btn ds-btn--ghost"
              style={{ marginTop: 8, height: 44, fontSize: 12.5, justifyContent: 'center', width: '100%', color: 'var(--ink-2)' }}
            >
              <Icon name="camera" size={13} />
              {saving === 'capture' ? 'Creating your room…' : 'Capture my real room first (optional)'}
            </button>
          </div>

          {/* PREVIEW */}
          <div
            style={{
              border: '1px solid var(--hairline-strong)',
              background: 'var(--paper)',
              borderRadius: 'var(--r-card)',
              padding: 24,
              minHeight: 360,
              position: 'relative',
              boxShadow: 'var(--shadow-soft)',
            }}
          >
            <div className="ds-label" style={{ color: 'var(--ink-2)', marginBottom: 18 }}>
              Footprint preview · <span className="mono" style={{ color: 'var(--ink)' }}>{layout.width.toFixed(1)} × {layout.depth.toFixed(1)} m</span> · {layout.starter}
            </div>
            <div className="ds-crosshair-bg" style={{ aspectRatio: '4/3', position: 'relative', borderRadius: 'var(--r-2)', overflow: 'hidden' }}>
              <svg viewBox="0 0 240 180" style={{ width: '100%', height: '100%', display: 'block' }} role="img" aria-label={`${layout.name} footprint, ${layout.width.toFixed(1)} by ${layout.depth.toFixed(1)} metres`}>
                <path
                  d={layout.path}
                  fill="var(--accent-tint)"
                  stroke="var(--accent)"
                  strokeWidth="1.5"
                />
                <g fontFamily="var(--font-mono)" fontSize="8" fill="var(--accent)">
                  <line x1="20" y1="10" x2="220" y2="10" stroke="var(--accent)" strokeWidth="0.8" />
                  <rect x="102" y="4" width="40" height="12" fill="var(--paper)" />
                  <text x="122" y="12" textAnchor="middle">{(layout.width * 1000).toFixed(0)} mm</text>
                </g>
              </svg>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Topbar({ step, onBack }: { step: string; onBack: () => void }) {
  return (
    <div
      style={{
        height: 56,
        padding: '0 24px',
        borderBottom: '1px solid var(--hairline)',
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        background: 'var(--paper)',
      }}
    >
      <button onClick={onBack} className="ds-btn ds-btn--ghost" style={{ height: 40, padding: '0 10px' }}>
        <Icon name="chevron-left" size={14} />
        <span style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>Back</span>
      </button>
      <div style={{ width: 1, height: 18, background: 'var(--hairline)' }} />
      <DanmuMark size={12} />
      <div style={{ flex: 1 }} />
      <span className="ds-label">{step}</span>
    </div>
  );
}

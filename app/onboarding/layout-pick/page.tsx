'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { v4 as uuid } from 'uuid';
import { useRoom } from '@/lib/store';
import { roomStore } from '@/lib/storage';
import { Icon } from '@/components/ui/Icon';
import { DanmuMark, StepHeader, CornerRegs } from '@/components/ui/primitives';

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

  const layout = LAYOUTS.find((l) => l.id === sel)!;

  async function next() {
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
    router.push('/onboarding/capture');
  }

  return (
    <div
      className="ds-grid-bg"
      style={{ position: 'relative', minHeight: '100vh', display: 'flex', flexDirection: 'column' }}
    >
      <CornerRegs color="var(--ink-3)" inset={20} size={14} />

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
          {/* INTRO */}
          <div>
            <StepHeader
              step={2}
              total={4}
              title="Pick your room's footprint."
              subtitle="Becomes the 1:1 grid every render is anchored to. Custom shapes coming soon."
            />
            <div style={{ marginTop: 24, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {LAYOUTS.map((l) => (
                <button
                  key={l.id}
                  onClick={() => setSel(l.id)}
                  style={{
                    border: sel === l.id ? '2px solid var(--accent)' : '1px solid var(--hairline-strong)',
                    background: sel === l.id ? 'var(--accent-tint)' : 'var(--paper)',
                    padding: '14px 14px 12px',
                    cursor: 'pointer',
                    textAlign: 'left',
                    minHeight: 120,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                  }}
                >
                  <svg viewBox="0 0 240 180" style={{ width: '100%', height: 60 }}>
                    <path
                      d={l.path}
                      fill={sel === l.id ? 'var(--accent)' : 'var(--ink-4)'}
                      fillOpacity={sel === l.id ? 0.25 : 0.4}
                      stroke={sel === l.id ? 'var(--accent)' : 'var(--ink-2)'}
                      strokeWidth="2"
                    />
                  </svg>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <span style={{ fontSize: 13, fontWeight: 500, color: sel === l.id ? 'var(--accent)' : 'var(--ink)' }}>{l.name}</span>
                    <span className="mono" style={{ fontSize: 9, color: 'var(--ink-3)' }}>{l.area}</span>
                  </div>
                  <div style={{ fontSize: 10.5, color: 'var(--ink-3)' }}>Starts as a {l.starter.toLowerCase()}</div>
                </button>
              ))}
            </div>
            <button onClick={next} className="ds-btn ds-btn--primary" style={{ marginTop: 24, height: 48, fontSize: 14, justifyContent: 'center', width: '100%' }}>
              Capture room
              <Icon name="camera" size={14} />
            </button>
            <button
              onClick={async () => {
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
                router.push(`/room/${id}/model`);
              }}
              className="ds-btn ds-btn--ghost"
              style={{ marginTop: 8, height: 36, fontSize: 12, justifyContent: 'center', width: '100%' }}
            >
              Skip · start decorating with a {layout.starter.toLowerCase()}
              <Icon name="arrow-right" size={12} />
            </button>
          </div>

          {/* PREVIEW */}
          <div
            style={{
              border: '1px solid var(--hairline-strong)',
              background: 'var(--paper)',
              padding: 24,
              minHeight: 360,
              position: 'relative',
            }}
          >
            <div className="ds-label" style={{ fontSize: 9, color: 'var(--ink-3)', marginBottom: 18 }}>
              ↘ Footprint preview · <span className="mono">{layout.width.toFixed(1)} × {layout.depth.toFixed(1)} m</span> · {layout.starter}
            </div>
            <div className="ds-crosshair-bg" style={{ aspectRatio: '4/3', position: 'relative' }}>
              <CornerRegs color="var(--ink-3)" inset={4} size={8} />
              <svg viewBox="0 0 240 180" style={{ width: '100%', height: '100%', display: 'block' }}>
                <path
                  d={LAYOUTS.find((l) => l.id === sel)!.path}
                  fill="var(--accent-tint)"
                  stroke="var(--accent)"
                  strokeWidth="1.5"
                />
                <g fontFamily="var(--font-mono)" fontSize="8" fill="var(--accent)">
                  <line x1="20" y1="10" x2="220" y2="10" stroke="var(--accent)" strokeWidth="0.8" />
                  <rect x="104" y="4" width="36" height="12" fill="var(--paper)" />
                  <text x="122" y="12" textAnchor="middle">{(layout.width * 1000).toFixed(0)}</text>
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
      <button onClick={onBack} className="ds-btn ds-btn--ghost" style={{ height: 32, padding: '0 8px' }}>
        <Icon name="chevron-left" size={14} />
        <span style={{ fontSize: 12, color: 'var(--ink-2)' }}>Back</span>
      </button>
      <div style={{ width: 1, height: 18, background: 'var(--hairline)' }} />
      <DanmuMark size={12} />
      <div style={{ flex: 1 }} />
      <span className="ds-label">{step}</span>
    </div>
  );
}

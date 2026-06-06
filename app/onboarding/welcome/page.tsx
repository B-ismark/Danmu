'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSettings } from '@/lib/store';
import { Icon } from '@/components/ui/Icon';
import { DanmuMark, CornerRegs } from '@/components/ui/primitives';

export default function WelcomePage() {
  const router = useRouter();
  const apiKey = useSettings((s) => s.apiKey);
  const setApiKey = useSettings((s) => s.setApiKey);
  const [show, setShow] = useState(false);
  const valid = apiKey.trim().length > 20;

  return (
    <div
      className="ds-grid-bg"
      style={{
        position: 'relative',
        minHeight: '100vh',
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr)',
        placeItems: 'center',
        padding: '40px 24px',
        fontFamily: 'var(--font-sans)',
        color: 'var(--ink)',
      }}
    >
      <CornerRegs color="var(--ink)" inset={20} size={14} />

      <div style={{ position: 'absolute', top: 24, left: 24, display: 'flex', alignItems: 'center', gap: 12 }}>
        <DanmuMark size={14} />
        <div style={{ width: 1, height: 16, background: 'var(--hairline)' }} />
        <span className="ds-label">v0.1 · Beta</span>
      </div>

      <div
        style={{
          width: '100%',
          maxWidth: 1080,
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
          gap: 48,
          alignItems: 'center',
        }}
      >
        {/* HERO */}
        <div>
          <span className="ds-kicker">Interior · Decoration studio</span>
          <h1
            style={{
              fontSize: 'clamp(36px, 5vw, 56px)',
              lineHeight: 1.05,
              letterSpacing: '-0.035em',
              fontWeight: 500,
              margin: '14px 0 16px',
            }}
          >
            Redesign a room
            <br />
            without lying
            <br />
            to yourself.
          </h1>
          <p style={{ fontSize: 15, color: 'var(--ink-2)', lineHeight: 1.6, margin: 0, maxWidth: 480 }}>
            Snap your room, rebuild it in 3D, then redecorate freely — move, recolour, and restyle every piece.
            Walls stay where they are. You bring the imagination.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 28, maxWidth: 480 }}>
            <Stat label="Your data" value="100%" unit="private" />
            <Stat label="In the cloud" value="0 MB" unit="stored" />
            <Stat label="Furniture" value="30+" unit="pieces" />
            <Stat label="Restyle in" value="1 tap" unit="themes" />
          </div>
        </div>

        {/* KEY ENTRY */}
        <div
          style={{
            border: '1px solid var(--hairline-strong)',
            background: 'var(--paper)',
            padding: 28,
            position: 'relative',
            boxShadow: '0 12px 48px rgba(19,19,17,0.05)',
          }}
        >
          <div
            style={{
              position: 'absolute',
              top: -10,
              left: 16,
              background: 'var(--paper)',
              padding: '0 8px',
            }}
          >
            <span className="ds-label" style={{ color: 'var(--ink)' }}>Required · Your access key</span>
          </div>

          <div style={{ position: 'relative', marginTop: 8 }}>
            <input
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="AIza••••••••••••••••••••"
              type={show ? 'text' : 'password'}
              className="ds-input"
              style={{ paddingRight: 40, height: 44 }}
            />
            <button
              onClick={() => setShow((s) => !s)}
              aria-label={show ? 'hide' : 'show'}
              style={{
                position: 'absolute',
                right: 8,
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                width: 32,
                height: 32,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--ink-3)',
              }}
            >
              <Icon name={show ? 'eye-off' : 'eye'} size={16} />
            </button>
          </div>

          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginTop: 12,
              fontSize: 11,
            }}
          >
            <span style={{ color: 'var(--ink-3)' }}>Local only · never uploaded</span>
            <span style={{ color: valid ? 'var(--success)' : 'var(--ink-4)' }}>
              {valid ? '● Ready' : '○ Waiting'}
            </span>
          </div>

          <div style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <button
              disabled={!valid}
              onClick={() => router.push('/onboarding/layout-pick')}
              className="ds-btn ds-btn--primary"
              style={{ height: 52, justifyContent: 'center', fontSize: 14 }}
            >
              Start a new room
              <Icon name="arrow-right" size={15} />
            </button>
            <a
              href="https://aistudio.google.com/app/apikey"
              target="_blank"
              rel="noreferrer"
              className="ds-btn ds-btn--ghost"
              style={{ height: 38, justifyContent: 'center', fontSize: 12, color: 'var(--ink-2)' }}
            >
              How to get a free key →
            </a>
          </div>

          <p style={{ fontSize: 11, color: 'var(--ink-3)', lineHeight: 1.6, marginTop: 18, marginBottom: 0 }}>
            Your key stays on this device while you use Danmu — it&apos;s never uploaded to us.
          </p>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div style={{ border: '1px solid var(--hairline)', padding: '12px 14px', background: 'var(--paper)' }}>
      <div className="ds-label" style={{ fontSize: 9 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginTop: 6 }}>
        <span className="mono" style={{ fontSize: 18, color: 'var(--ink)', fontWeight: 500 }}>{value}</span>
        <span className="mono" style={{ fontSize: 9, color: 'var(--ink-3)', letterSpacing: '0.04em' }}>{unit}</span>
      </div>
    </div>
  );
}

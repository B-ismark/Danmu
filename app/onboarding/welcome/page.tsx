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
  const [keyOpen, setKeyOpen] = useState(false);
  const hasKey = apiKey.trim().length > 20;

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
            Decorate any room.
            <br />
            In real 3D.
            <br />
            No account needed.
          </h1>
          <p style={{ fontSize: 15, color: 'var(--ink-2)', lineHeight: 1.6, margin: 0, maxWidth: 480 }}>
            Pick a room shape, drop in furniture, then move, recolour, restyle, and relight every piece —
            live, in your browser. Everything stays on your device. An optional AI step can turn your
            layout into a photo when you want one.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 28, maxWidth: 480 }}>
            <Stat label="Your data" value="100%" unit="on-device" />
            <Stat label="Account" value="None" unit="required" />
            <Stat label="Furniture" value="30+" unit="pieces" />
            <Stat label="Restyle in" value="1 tap" unit="themes" />
          </div>
        </div>

        {/* START */}
        <div
          style={{
            border: '1px solid var(--hairline-strong)',
            background: 'var(--paper)',
            padding: 28,
            position: 'relative',
            boxShadow: '0 12px 48px rgba(19,19,17,0.05)',
            borderRadius: 'var(--r-card)',
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
            <span className="ds-label" style={{ color: 'var(--ink)' }}>Start here</span>
          </div>

          <h2 style={{ fontSize: 20, margin: '6px 0 6px' }}>Build your first room</h2>
          <p style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.55, margin: '0 0 22px' }}>
            Free, instant, and right in the browser. No sign-up, no upload, no key needed to start.
          </p>

          <button
            onClick={() => router.push('/onboarding/layout-pick')}
            className="ds-btn ds-btn--accent"
            style={{ height: 52, justifyContent: 'center', fontSize: 15, width: '100%' }}
          >
            Start decorating
            <Icon name="arrow-right" size={15} color="#fff" />
          </button>

          {/* Optional AI key — collapsed by default. AI is a bonus, not a gate. */}
          <div style={{ marginTop: 18, borderTop: '1px solid var(--hairline)', paddingTop: 16 }}>
            <button
              onClick={() => setKeyOpen((o) => !o)}
              className="ds-btn ds-btn--ghost"
              style={{ height: 32, fontSize: 12, padding: 0, color: 'var(--ink-2)', width: '100%', justifyContent: 'space-between' }}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <Icon name="sparkles" size={13} />
                {hasKey ? 'AI furniture detection · key added' : 'Add an AI key for furniture detection (optional)'}
              </span>
              <Icon name={keyOpen ? 'chevron-up' : 'chevron-down'} size={14} />
            </button>

            {keyOpen && (
              <div style={{ marginTop: 12 }}>
                <div style={{ position: 'relative' }}>
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
                    marginTop: 10,
                    fontSize: 11,
                  }}
                >
                  <span style={{ color: 'var(--ink-3)' }}>Local only · never uploaded</span>
                  <span style={{ color: hasKey ? 'var(--success)' : 'var(--ink-4)' }}>
                    {hasKey ? '● Saved' : '○ Optional'}
                  </span>
                </div>
                <a
                  href="https://aistudio.google.com/app/apikey"
                  target="_blank"
                  rel="noreferrer"
                  className="ds-btn ds-btn--ghost"
                  style={{ height: 34, justifyContent: 'center', fontSize: 12, color: 'var(--ink-2)', marginTop: 8 }}
                >
                  How to get a free key →
                </a>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div style={{ border: '1px solid var(--hairline)', padding: '12px 14px', background: 'var(--paper)', borderRadius: 'var(--r-2)' }}>
      <div className="ds-label" style={{ fontSize: 9 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginTop: 6 }}>
        <span className="mono" style={{ fontSize: 18, color: 'var(--ink)', fontWeight: 500 }}>{value}</span>
        <span className="mono" style={{ fontSize: 9, color: 'var(--ink-3)', letterSpacing: '0.04em' }}>{unit}</span>
      </div>
    </div>
  );
}

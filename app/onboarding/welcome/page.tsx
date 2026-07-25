'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSettings } from '@/lib/store';
import { Icon, type IconName } from '@/components/ui/Icon';
import { DanmuMark, IconButton } from '@/components/ui/primitives';

export default function WelcomePage() {
  const router = useRouter();
  const apiKey = useSettings((s) => s.apiKey);
  const setApiKey = useSettings((s) => s.setApiKey);
  const [show, setShow] = useState(false);
  const [keyOpen, setKeyOpen] = useState(false);

  // Format-only check — synchronous, no network. Live validation lives in
  // Settings; here we only reassure that the key *looks* like a Gemini key
  // (they start "AIza" and run ~39 chars). Detection proves it later.
  const trimmed = apiKey.trim();
  const looksValid = /^AIza[A-Za-z0-9_-]{30,}$/.test(trimmed);
  const keyState: 'empty' | 'check' | 'valid' =
    trimmed.length === 0 ? 'empty' : looksValid ? 'valid' : 'check';

  return (
    <div
      style={{
        position: 'relative',
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        padding: '40px 24px',
        fontFamily: 'var(--font-sans)',
        color: 'var(--ink)',
        background:
          'radial-gradient(1100px 560px at 12% -12%, var(--accent-tint), transparent 60%),' +
          'radial-gradient(900px 520px at 108% 116%, var(--accent-2-tint), transparent 55%),' +
          'var(--paper)',
      }}
    >
      <div style={{ position: 'absolute', top: 26, left: 28 }}>
        <DanmuMark size={15} />
      </div>

      <div
        style={{
          width: '100%',
          maxWidth: 1060,
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
          gap: 44,
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
          <p style={{ fontSize: 15, color: 'var(--ink-2)', lineHeight: 1.6, margin: 0, maxWidth: 470 }}>
            Pick a room shape, drop in furniture, then move, recolour, restyle, and relight every
            piece — live, in your browser. Everything stays on your device. Point your camera at a
            real room and an optional AI step spots the furniture for you.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 26, maxWidth: 470 }}>
            <Feature
              icon="sofa"
              tint="var(--accent-tint)"
              color="var(--accent)"
              title="Arrange in real 3D"
              desc="Move, rotate and place 30+ pieces at true room scale."
            />
            <Feature
              icon="leaf"
              tint="var(--accent-2-tint)"
              color="var(--accent-2)"
              title="Restyle & relight"
              desc="Recolour any piece and switch whole palettes in a tap."
            />
            <Feature
              icon="lock"
              tint="var(--paper-2)"
              color="var(--ink-2)"
              title="Private by default"
              desc="No account, no uploads — nothing leaves your device."
            />
          </div>
        </div>

        {/* START + PREVIEW */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div
            style={{
              border: '1px solid var(--hairline-strong)',
              background: 'var(--paper)',
              padding: 28,
              position: 'relative',
              boxShadow: 'var(--shadow-lift)',
              borderRadius: 'var(--r-card)',
            }}
          >
            <div style={{ position: 'absolute', top: -10, left: 18, background: 'var(--paper)', padding: '0 8px' }}>
              <span className="ds-label" style={{ color: 'var(--accent)' }}>Start here</span>
            </div>

            <h2 style={{ fontSize: 20, margin: '6px 0 6px' }}>Build your first room</h2>
            <p style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.55, margin: '0 0 22px' }}>
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
            <div style={{ marginTop: 18, borderTop: '1px solid var(--hairline)', paddingTop: 14 }}>
              <button
                onClick={() => setKeyOpen((o) => !o)}
                aria-expanded={keyOpen}
                className="ds-btn ds-btn--ghost"
                style={{ height: 44, fontSize: 12.5, padding: '0 6px', color: 'var(--ink-2)', width: '100%', justifyContent: 'space-between' }}
              >
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <Icon name="sparkles" size={13} color={keyState === 'valid' ? 'var(--accent-2)' : 'var(--ink-3)'} />
                  {keyState === 'valid' ? 'AI furniture detection · key added' : 'Add an AI key for furniture detection (optional)'}
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
                      aria-label="Google Gemini API key (optional)"
                      className="ds-input"
                      style={{ paddingRight: 44, height: 44 }}
                    />
                    <IconButton
                      icon={show ? 'eye-off' : 'eye'}
                      label={show ? 'Hide API key' : 'Show API key'}
                      onClick={() => setShow((s) => !s)}
                      size={40}
                      iconSize={16}
                      style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)' }}
                    />
                  </div>

                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginTop: 10,
                      fontSize: 12,
                    }}
                  >
                    <span style={{ color: 'var(--ink-2)' }}>Local only · never uploaded</span>
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 5,
                        fontWeight: 700,
                        color:
                          keyState === 'valid' ? 'var(--success)'
                          : keyState === 'check' ? 'var(--warn)'
                          : 'var(--ink-3)',
                      }}
                    >
                      {keyState === 'valid' ? 'Looks good'
                        : keyState === 'check' ? 'Check the format'
                        : 'Optional'}
                    </span>
                  </div>

                  <p style={{ fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.5, margin: '10px 0 0' }}>
                    Add it now or later in Settings — either way you can start decorating.
                  </p>

                  <a
                    href="https://aistudio.google.com/app/apikey"
                    target="_blank"
                    rel="noreferrer"
                    className="ds-btn ds-btn--ghost"
                    style={{ height: 44, justifyContent: 'center', fontSize: 12.5, color: 'var(--ink-2)', marginTop: 6 }}
                  >
                    How to get a free key →
                  </a>
                </div>
              )}
            </div>
          </div>

          <RoomVignette />
        </div>
      </div>
    </div>
  );
}

function Feature({
  icon,
  tint,
  color,
  title,
  desc,
}: {
  icon: IconName;
  tint: string;
  color: string;
  title: string;
  desc: string;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '10px 0' }}>
      <div
        style={{
          flexShrink: 0,
          width: 34,
          height: 34,
          borderRadius: 'var(--r-2)',
          background: tint,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color,
        }}
      >
        <Icon name={icon} size={17} color={color} />
      </div>
      <div>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)', lineHeight: 1.3 }}>{title}</div>
        <div style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.45, marginTop: 1 }}>{desc}</div>
      </div>
    </div>
  );
}

/* Zero-asset, on-brand preview of the thing you're about to build. Pure inline
   SVG (no image, no AI, no 3D boot) in the room palette — a warm room framed
   like a window into the studio. */
function RoomVignette() {
  return (
    <div
      style={{
        borderRadius: 'var(--r-card)',
        overflow: 'hidden',
        border: '1px solid var(--hairline)',
        boxShadow: 'var(--shadow-soft)',
        background: 'var(--paper-2)',
      }}
    >
      <svg viewBox="0 0 320 210" width="100%" height="100%" role="img" aria-label="Preview of a cozy furnished room" style={{ display: 'block' }}>
        {/* wall + floor */}
        <rect x="0" y="0" width="320" height="150" fill="var(--paper-2)" />
        <rect x="0" y="146" width="320" height="64" fill="var(--paper-3)" />

        {/* window with warm sage light */}
        <rect x="198" y="26" width="82" height="70" rx="10" fill="var(--accent-2-tint)" stroke="var(--hairline-strong)" strokeWidth="2" />
        <line x1="239" y1="26" x2="239" y2="96" stroke="var(--hairline-strong)" strokeWidth="2" />
        <line x1="198" y1="61" x2="280" y2="61" stroke="var(--hairline-strong)" strokeWidth="2" />

        {/* framed wall art */}
        <rect x="44" y="36" width="40" height="50" rx="6" fill="var(--paper)" stroke="var(--hairline-strong)" strokeWidth="2" />
        <circle cx="64" cy="55" r="8" fill="var(--accent)" opacity="0.55" />
        <rect x="52" y="68" width="24" height="12" rx="3" fill="var(--accent-2)" opacity="0.55" />

        {/* rug */}
        <ellipse cx="160" cy="176" rx="106" ry="20" fill="var(--accent-2-tint)" />

        {/* floor lamp */}
        <rect x="42" y="150" width="18" height="4" rx="2" fill="var(--ink-3)" />
        <rect x="49.5" y="96" width="3" height="56" fill="var(--ink-3)" />
        <path d="M40 96 h22 l-5 -16 h-12 z" fill="var(--accent)" opacity="0.9" />

        {/* sofa */}
        <rect x="104" y="112" width="112" height="30" rx="12" fill="var(--accent)" />
        <rect x="100" y="118" width="20" height="40" rx="9" fill="var(--accent)" />
        <rect x="200" y="118" width="20" height="40" rx="9" fill="var(--accent)" />
        <rect x="112" y="132" width="96" height="26" rx="10" fill="var(--accent)" />
        <rect x="120" y="130" width="42" height="22" rx="8" fill="var(--paper)" opacity="0.85" />
        <rect x="166" y="130" width="42" height="22" rx="8" fill="var(--paper)" opacity="0.85" />
        <rect x="116" y="156" width="6" height="10" rx="2" fill="var(--ink-3)" />
        <rect x="198" y="156" width="6" height="10" rx="2" fill="var(--ink-3)" />

        {/* potted plant */}
        <path d="M236 150 h28 l-4 20 h-20 z" fill="var(--accent)" opacity="0.8" />
        <path d="M250 150 c-2 -20 -14 -24 -20 -30 c12 0 20 8 20 22 z" fill="var(--accent-2)" />
        <path d="M250 150 c2 -22 14 -26 22 -32 c-12 -1 -22 8 -22 24 z" fill="var(--accent-2)" opacity="0.85" />
        <path d="M250 150 c0 -16 0 -30 0 -40 c4 6 6 20 4 40 z" fill="var(--accent-2)" opacity="0.7" />
      </svg>
    </div>
  );
}

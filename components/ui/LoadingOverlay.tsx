'use client';

// Animated CAD-themed loader with rotating tips. Used during long async ops
// to keep users engaged without misclicks. Carousels through facts every 4s.

import { useEffect, useState } from 'react';
import { Dot } from './primitives';

const TIPS = [
  '↳ Lock a piece you want to keep — it stays exactly as-is in every preview.',
  '↳ Right-click and drag any piece to spin it around.',
  '↳ Recolour anything in the inspector — the room updates live.',
  '↳ Try the material swatches to switch wood, fabric, or metal finishes.',
  '↳ Press W / R / S to Move, Rotate, or Scale the selected piece.',
  '↳ One-tap a style theme to redecorate the whole room at once.',
  '↳ Toggle day or evening light to see your room in a different mood.',
  '↳ Your photos and designs stay on your device.',
  '↳ Drag new furniture in from the catalog to fill out the space.',
];

const HUDS = [
  'Tidying up',
  'Fluffing cushions',
  'Opening the curtains',
  'Adjusting the light',
  'Styling the shelves',
  'Setting the mood',
  'Almost ready',
];

export function LoadingOverlay({
  title,
  step,
  totalSteps,
  description,
  onCancel,
}: {
  title: string;
  step?: number;
  totalSteps?: number;
  description?: string;
  /** When provided, replaces "DO NOT CLOSE" with a clickable escape hatch. */
  onCancel?: () => void;
}) {
  const pct = step !== undefined && totalSteps ? Math.min(100, (step / totalSteps) * 100) : null;
  const [tipIdx, setTipIdx] = useState(() => Math.floor(Math.random() * TIPS.length));
  const [hudIdx, setHudIdx] = useState(0);
  const [t, setT] = useState(0);

  useEffect(() => {
    const tipTimer = setInterval(() => setTipIdx((i) => (i + 1) % TIPS.length), 4000);
    const hudTimer = setInterval(() => setHudIdx((i) => (i + 1) % HUDS.length), 700);
    const tickTimer = setInterval(() => setT((v) => v + 1), 80);
    return () => {
      clearInterval(tipTimer);
      clearInterval(hudTimer);
      clearInterval(tickTimer);
    };
  }, []);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(19,19,17,0.65)',
        display: 'grid',
        placeItems: 'center',
        zIndex: 80,
        pointerEvents: 'auto',
        backdropFilter: 'blur(2px)',
      }}
    >
      <div
        style={{
          width: 'min(520px, 92vw)',
          background: 'var(--paper)',
          border: '1px solid var(--ink)',
          padding: 28,
          boxShadow: '0 30px 80px rgba(0,0,0,0.45)',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* animated CAD scanner */}
        <Scanner t={t} />

        <div
          style={{
            position: 'relative',
            zIndex: 2,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            marginBottom: 16,
          }}
        >
          <Dot color="var(--accent)" size={7} style={{ animation: 'pulse 1.4s ease-in-out infinite' }} />
          <span
            style={{ fontSize: 12, letterSpacing: '0.01em', color: 'var(--accent)', fontWeight: 700 }}
          >
            {HUDS[hudIdx]}…
          </span>
          <div style={{ flex: 1 }} />
          {onCancel ? (
            <button
              onClick={onCancel}
              className="mono"
              style={{
                fontSize: 10,
                letterSpacing: '0.1em',
                color: 'var(--ink-2)',
                background: 'transparent',
                border: '1px solid var(--hairline-strong)',
                borderRadius: 6,
                padding: '3px 9px',
                cursor: 'pointer',
              }}
            >
              CANCEL
            </button>
          ) : (
            <span className="mono" style={{ fontSize: 10, letterSpacing: '0.1em', color: 'var(--ink-3)' }}>
              DO NOT CLOSE
            </span>
          )}
        </div>

        <div style={{ position: 'relative', zIndex: 2, fontSize: 22, fontWeight: 600, marginBottom: 8, letterSpacing: '-0.015em' }}>
          {title}
        </div>
        {description && (
          <p style={{ position: 'relative', zIndex: 2, fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.55, margin: '0 0 18px' }}>
            {description}
          </p>
        )}

        {pct !== null && (
          <div style={{ position: 'relative', zIndex: 2 }}>
            <div
              style={{
                height: 4,
                background: 'var(--paper-3)',
                position: 'relative',
                marginBottom: 6,
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  bottom: 0,
                  width: `${pct}%`,
                  background: 'var(--accent)',
                  transition: 'width 0.3s',
                }}
              />
              {/* moving scan dot */}
              <div
                style={{
                  position: 'absolute',
                  left: `${(t * 1.5) % 100}%`,
                  top: -2,
                  width: 8,
                  height: 8,
                  background: 'var(--accent)',
                  borderRadius: '50%',
                  opacity: 0.5,
                }}
              />
            </div>
            <div
              className="mono"
              style={{ fontSize: 10, color: 'var(--ink-3)', letterSpacing: '0.08em', display: 'flex', justifyContent: 'space-between' }}
            >
              <span>STEP {step} / {totalSteps}</span>
              <span>{Math.round(pct)}%</span>
            </div>
          </div>
        )}

        {/* rotating tip */}
        <div
          style={{
            position: 'relative',
            zIndex: 2,
            marginTop: 22,
            paddingTop: 14,
            borderTop: '1px dashed var(--hairline)',
            minHeight: 48,
          }}
        >
          <div className="mono" style={{ fontSize: 9, letterSpacing: '0.18em', color: 'var(--accent)', marginBottom: 6 }}>
            DID YOU KNOW
          </div>
          <div
            key={tipIdx}
            style={{
              fontSize: 12.5,
              color: 'var(--ink-2)',
              lineHeight: 1.5,
              animation: 'tipFade 0.4s ease-out',
            }}
          >
            {TIPS[tipIdx]}
          </div>
        </div>
      </div>

      <style jsx>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(0.8); }
        }
        @keyframes tipFade {
          from { opacity: 0; transform: translateY(4px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

function Scanner({ t }: { t: number }) {
  // Animated grid + scanner line + corner blueprints — gives the modal that "AI is working" feel.
  const scanY = (t * 4) % 240;
  return (
    <svg
      viewBox="0 0 520 240"
      preserveAspectRatio="none"
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        opacity: 0.5,
        pointerEvents: 'none',
      }}
    >
      <defs>
        <pattern id="loadgrid" width="20" height="20" patternUnits="userSpaceOnUse">
          <path d="M 20 0 L 0 0 0 20" fill="none" stroke="var(--hairline)" strokeWidth="0.5" />
        </pattern>
        <linearGradient id="scanline" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="rgba(232,84,42,0)" />
          <stop offset="0.5" stopColor="rgba(232,84,42,0.4)" />
          <stop offset="1" stopColor="rgba(232,84,42,0)" />
        </linearGradient>
      </defs>
      <rect width="520" height="240" fill="url(#loadgrid)" />
      <rect x="0" y={scanY} width="520" height="14" fill="url(#scanline)" />
      <line x1="0" y1={scanY + 7} x2="520" y2={scanY + 7} stroke="var(--accent)" strokeWidth="0.5" strokeDasharray="4 4" />
      {/* corner blueprints */}
      {[
        [10, 10],
        [510, 10, true, false],
        [10, 230, false, true],
        [510, 230, true, true],
      ].map((c, i) => {
        const [x, y, fx, fy] = c as [number, number, boolean?, boolean?];
        return (
          <g key={i}>
            <line x1={x} y1={y} x2={x + (fx ? -10 : 10)} y2={y} stroke="var(--accent)" strokeWidth="1" />
            <line x1={x} y1={y} x2={x} y2={y + (fy ? -10 : 10)} stroke="var(--accent)" strokeWidth="1" />
          </g>
        );
      })}
      {/* roving point markers */}
      {[0.2, 0.5, 0.8].map((p, i) => {
        const x = (t * 2 + i * 80) % 520;
        return <circle key={i} cx={x} cy={p * 240} r="2" fill="var(--accent)" opacity="0.4" />;
      })}
    </svg>
  );
}

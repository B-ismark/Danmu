'use client';

// Calm progress overlay with rotating tips. Used during long async ops to keep
// users engaged without misclicks. Carousels through tips every 4s.

import { useEffect, useState } from 'react';
import { Dot } from './primitives';

const TIPS = [
  'Lock a piece you want to keep — it stays exactly as-is in every preview.',
  'Right-click and drag any piece to spin it around.',
  'Recolour anything in the inspector — the room updates live.',
  'Try the material swatches to switch wood, fabric, or metal finishes.',
  'Press W / R / S to Move, Rotate, or Scale the selected piece.',
  'One-tap a style theme to redecorate the whole room at once.',
  'Toggle day or evening light to see your room in a different mood.',
  'Your photos and designs stay on your device.',
  'Drag new furniture in from the catalog to fill out the space.',
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
  /** When provided, replaces the "please wait" hint with a Cancel button. */
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
        background: 'var(--scrim)',
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
          border: '1px solid var(--hairline)',
          borderRadius: 'var(--r-card)',
          padding: 28,
          boxShadow: 'var(--shadow-lift)',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
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
              className="ds-btn ds-btn--ghost"
              style={{ height: 26, fontSize: 12, padding: '0 12px' }}
            >
              Cancel
            </button>
          ) : (
            <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>
              This only takes a moment
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
                borderRadius: 'var(--r-full)',
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
                  width: '100%',
                  transform: `scaleX(${Math.max(0, Math.min(1, pct / 100))})`,
                  transformOrigin: 'left',
                  background: 'var(--accent)',
                  borderRadius: 'var(--r-full)',
                  transition: 'transform 0.3s',
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
            borderTop: '1px solid var(--hairline)',
            minHeight: 48,
          }}
        >
          <div className="ds-kicker" style={{ marginBottom: 6 }}>
            Tip
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

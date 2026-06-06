'use client';

// Compact quota readout. Click → expanded breakdown.
// Color codes when remaining headroom is low.

import { useEffect, useRef, useState } from 'react';
import { useQuota, quotaLimit, type ModelKey } from '@/lib/quota';

const LABEL: Record<ModelKey, string> = {
  flash: 'Flash · detect',
  'flash-lite': 'Flash-Lite · refine',
  'flash-image': 'Image · render',
};

export function QuotaPill() {
  const counts = useQuota((s) => s.counts);
  const day = useQuota((s) => s.day);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  // Worst remaining headroom across the three pools
  const flashLeft = quotaLimit('flash') - counts.flash;
  const liteLeft = quotaLimit('flash-lite') - counts['flash-lite'];
  const imgLeft = quotaLimit('flash-image') - counts['flash-image'];
  const worstFrac = Math.min(
    flashLeft / quotaLimit('flash'),
    liteLeft / quotaLimit('flash-lite'),
    imgLeft / quotaLimit('flash-image'),
  );
  const tone =
    worstFrac < 0.1 ? 'var(--danger)' : worstFrac < 0.3 ? 'var(--warn)' : 'var(--ink-3)';

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        title="Today's free-tier API quota usage"
        style={{
          height: 28,
          padding: '0 10px',
          background: 'var(--paper)',
          border: '1px solid var(--hairline-strong)',
          borderColor: tone === 'var(--ink-3)' ? 'var(--hairline-strong)' : tone,
          color: tone,
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          letterSpacing: '0.08em',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: tone,
          }}
        />
        {Math.min(flashLeft, liteLeft, imgLeft)}
      </button>
      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            right: 0,
            zIndex: 70,
            minWidth: 280,
            background: 'var(--paper)',
            border: '1px solid var(--ink)',
            boxShadow: '0 12px 30px rgba(0,0,0,0.18)',
            padding: 14,
          }}
        >
          <div className="ds-label" style={{ marginBottom: 10 }}>
            Free-tier quota · <span className="mono">{day}</span>
          </div>
          {(Object.keys(counts) as ModelKey[]).map((k) => {
            const used = counts[k];
            const limit = quotaLimit(k);
            const pct = (used / limit) * 100;
            const lineTone = used / limit >= 0.9 ? 'var(--danger)' : used / limit >= 0.7 ? 'var(--warn)' : 'var(--ink-2)';
            return (
              <div key={k} style={{ marginBottom: 10 }}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: 11,
                    color: 'var(--ink)',
                    marginBottom: 4,
                  }}
                >
                  <span>{LABEL[k]}</span>
                  <span className="mono" style={{ fontSize: 10, color: lineTone, letterSpacing: '0.06em' }}>
                    {used} / {limit}
                  </span>
                </div>
                <div style={{ height: 4, background: 'var(--paper-3)', position: 'relative' }}>
                  <div
                    style={{
                      position: 'absolute',
                      left: 0,
                      top: 0,
                      bottom: 0,
                      width: `${Math.min(100, pct)}%`,
                      background: lineTone,
                    }}
                  />
                </div>
              </div>
            );
          })}
          <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 8, lineHeight: 1.5 }}>
            ↳ Resets at Pacific midnight · local estimate — Google&apos;s count is authoritative
          </div>
        </div>
      )}
    </div>
  );
}

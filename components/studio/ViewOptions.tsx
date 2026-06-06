'use client';

// Single top-right "View" popover that consolidates what used to be a row of
// overlapping chips: lighting mood, decor toggle, render quality, and the
// re-scan action. One button → tidy panel. Keeps the canvas top uncluttered.

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useStudio, type Lighting } from '@/lib/store';
import { roomStore } from '@/lib/storage';
import { Icon } from '@/components/ui/Icon';

const MOODS: Array<{ id: Lighting; label: string; glyph: string }> = [
  { id: 'day', label: 'Day', glyph: '☀' },
  { id: 'evening', label: 'Evening', glyph: '🌙' },
  { id: 'cool', label: 'Cool', glyph: '☁' },
];

export function ViewOptions() {
  const { roomId } = useParams<{ roomId: string }>();
  const lighting = useStudio((s) => s.lighting);
  const setLighting = useStudio((s) => s.setLighting);
  const dressed = useStudio((s) => s.dressed);
  const toggleDressed = useStudio((s) => s.toggleDressed);
  const quality = useStudio((s) => s.quality);
  const setQuality = useStudio((s) => s.setQuality);
  const [open, setOpen] = useState(false);
  const [hasCaps, setHasCaps] = useState(false);
  const [detected, setDetected] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!roomId) return;
    (async () => {
      const caps = await roomStore.loadCaptures(roomId);
      const room = await roomStore.loadRoom(roomId);
      setHasCaps(caps.length > 0);
      setDetected(!!(room?.detectedObjects && room.detectedObjects.length > 0));
    })();
  }, [roomId]);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const hi = quality === 'high';

  return (
    <div ref={wrap} style={{ position: 'absolute', top: 12, right: 12, zIndex: 26 }}>
      <button
        onClick={() => setOpen((v) => !v)}
        className={`ds-chip ${open ? 'ds-chip--accent' : ''}`}
        style={{ cursor: 'pointer', height: 30, fontWeight: 700, background: open ? 'var(--accent-tint)' : 'var(--paper)' }}
      >
        <Icon name="settings" size={13} />
        View
      </button>

      {open && (
        <div className="ds-card" style={{ position: 'absolute', top: 'calc(100% + 8px)', right: 0, width: 230, padding: 14, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Group label="Lighting">
            <Seg
              options={MOODS.map((m) => ({ id: m.id, label: `${m.glyph} ${m.label}` }))}
              value={lighting}
              onChange={(v) => setLighting(v as Lighting)}
            />
          </Group>

          <Group label="Decor">
            <Seg
              options={[{ id: 'on', label: 'On' }, { id: 'off', label: 'Off' }]}
              value={dressed ? 'on' : 'off'}
              onChange={(v) => { if ((v === 'on') !== dressed) toggleDressed(); }}
            />
          </Group>

          <Group label="Quality">
            <Seg
              options={[{ id: 'high', label: 'High' }, { id: 'low', label: 'Fast' }]}
              value={hi ? 'high' : 'low'}
              onChange={(v) => setQuality(v === 'high' ? 'high' : 'low')}
            />
            <div style={{ fontSize: 10.5, color: 'var(--ink-3)', marginTop: 5, lineHeight: 1.4 }}>
              High adds soft shadows + textured surfaces.
            </div>
          </Group>

          {hasCaps && (
            <>
              <div style={{ height: 1, background: 'var(--hairline)' }} />
              <Link
                href="/onboarding/detect"
                className="ds-btn"
                style={{ height: 32, fontSize: 12, justifyContent: 'center' }}
                title={detected ? 'Re-scan your photos for furniture' : 'Scan your photos for furniture'}
              >
                <Icon name="refresh" size={12} />
                {detected ? 'Re-scan room' : 'Scan room'}
              </Link>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="ds-label" style={{ display: 'block', marginBottom: 6 }}>{label}</span>
      {children}
    </div>
  );
}

function Seg({
  options,
  value,
  onChange,
}: {
  options: Array<{ id: string; label: string }>;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div style={{ display: 'flex', gap: 4, background: 'var(--paper-2)', borderRadius: 'var(--r-2)', padding: 3 }}>
      {options.map((o) => {
        const on = value === o.id;
        return (
          <button
            key={o.id}
            onClick={() => onChange(o.id)}
            style={{
              flex: 1,
              height: 28,
              border: 'none',
              borderRadius: 'var(--r-1)',
              cursor: 'pointer',
              fontFamily: 'var(--font-sans)',
              fontSize: 11.5,
              fontWeight: 700,
              background: on ? 'var(--paper)' : 'transparent',
              color: on ? 'var(--accent)' : 'var(--ink-3)',
              boxShadow: on ? 'var(--shadow-soft)' : 'none',
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

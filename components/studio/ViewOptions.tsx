'use client';

// The "View" popover: lighting mood, decor toggle, render quality, re-scan.
//
// It no longer positions itself. It used to float alone at the top-right of the
// canvas, which made it one of seven separate clusters over a single 3D view —
// and lighting/quality belong next to the camera presets and the room checks, not
// in a corner of their own. The parent (RoomTools' row) places it now; this
// component only owns the button and the panel that hangs off it.

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useStudio, type Lighting } from '@/lib/store';
import { roomStore } from '@/lib/storage';
import { Icon } from '@/components/ui/Icon';
import { Segmented } from '@/components/ui/primitives';
import { isTypingOrDialog } from './KeyboardShortcuts';

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
  const btn = useRef<HTMLButtonElement>(null);

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
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    }
    // Esc closes and hands focus back to the trigger. Without it the only ways
    // out were clicking the button again or clicking somewhere harmless.
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      if (isTypingOrDialog(e.target)) return;
      e.stopPropagation();
      setOpen(false);
      btn.current?.focus();
    }
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  const hi = quality === 'high';

  return (
    <div ref={wrap} style={{ position: 'relative' }}>
      <button
        ref={btn}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="ds-btn"
        title="Lighting, decor and render quality"
        style={{
          height: 30,
          fontSize: 11,
          gap: 6,
          background: open ? 'var(--accent-tint)' : 'var(--paper)',
          borderColor: open ? 'var(--accent-text)' : 'var(--edge)',
          color: open ? 'var(--accent-text)' : 'var(--ink-2)',
          boxShadow: 'var(--shadow-soft)',
        }}
      >
        <Icon name="settings" size={12} />
        View
      </button>

      {open && (
        <div
          className="ds-card"
          style={{
            position: 'absolute',
            // Opens upward now that the button lives near the bottom edge.
            bottom: 'calc(100% + 8px)',
            right: 0,
            zIndex: 'var(--z-popover)',
            width: 230,
            padding: 14,
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
            boxShadow: 'var(--shadow-lift)',
          }}
        >
          <Group label="Lighting">
            <Segmented
              ariaLabel="Lighting"
              options={MOODS.map((m) => ({ value: m.id, label: `${m.glyph} ${m.label}` }))}
              value={lighting}
              onChange={setLighting}
            />
          </Group>

          <Group label="Decor">
            <Segmented
              ariaLabel="Decor"
              options={[{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }]}
              value={dressed ? 'on' : 'off'}
              onChange={(v) => { if ((v === 'on') !== dressed) toggleDressed(); }}
            />
          </Group>

          <Group label="Quality">
            <Segmented
              ariaLabel="Quality"
              options={[{ value: 'high', label: 'High' }, { value: 'low', label: 'Fast' }]}
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

'use client';

// Edit room shell dimensions (W × D × H). Live updates 3D + 2D.
// Uses the user's selected dim unit. Writes back to IDB on commit.

import { useEffect, useRef, useState } from 'react';
import { useScene } from '@/lib/scene-store';
import { useSettings } from '@/lib/store';
import { fromMM, toMM, stepFor, precisionFor } from '@/lib/units';
import { roomStore } from '@/lib/storage';
import { useParams } from 'next/navigation';
import { Icon } from '@/components/ui/Icon';

export function RoomDimsEditor() {
  const { roomId } = useParams<{ roomId: string }>();
  const room = useScene((s) => s.room);
  const setRoom = useScene((s) => s.setRoom);
  const dimUnit = useSettings((s) => s.dimUnit);
  const prec = precisionFor(dimUnit);
  const step = stepFor(dimUnit);

  const [local, setLocal] = useState<[string, string, string]>(() => [
    fromMM(room.width * 1000, dimUnit).toFixed(prec),
    fromMM(room.depth * 1000, dimUnit).toFixed(prec),
    fromMM(room.height * 1000, dimUnit).toFixed(prec),
  ]);

  useEffect(() => {
    setLocal([
      fromMM(room.width * 1000, dimUnit).toFixed(prec),
      fromMM(room.depth * 1000, dimUnit).toFixed(prec),
      fromMM(room.height * 1000, dimUnit).toFixed(prec),
    ]);
  }, [room.width, room.depth, room.height, dimUnit, prec]);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function commit(idx: 0 | 1 | 2, raw: string) {
    const next = [...local] as [string, string, string];
    next[idx] = raw;
    setLocal(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const m = next.map((s) => toMM(parseFloat(s), dimUnit) / 1000);
      if (m.some((n) => Number.isNaN(n) || n < 1 || n > 50)) return;
      const r = { width: m[0], depth: m[1], height: m[2] };
      setRoom(r);
      if (roomId) {
        const existing = await roomStore.loadRoom(roomId);
        if (existing) await roomStore.saveRoom({ ...existing, ...r });
      }
    }, 200);
  }

  const labels: ['W', 'D', 'H'] = ['W', 'D', 'H'];

  // Collapsed by default — the top bar already shows the room dims, and the
  // shell is edited rarely. Header doubles as the toggle and shows a live
  // summary so the value stays glanceable without expanding.
  const [open, setOpen] = useState(false);
  const summary = local.join(' × ');

  return (
    <div style={{ padding: open ? '14px 16px' : '12px 16px', borderBottom: '1px solid var(--hairline)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: open ? 10 : 0, gap: 8 }}>
        <button
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            background: 'transparent',
            border: 'none',
            padding: 0,
            cursor: 'pointer',
            flex: 1,
            textAlign: 'left',
          }}
        >
          <span style={{ display: 'flex', color: 'var(--ink-3)', transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}>
            <Icon name="chevron-right" size={14} />
          </span>
          <span className="section-title" style={{ color: 'var(--ink)' }}>Room shell</span>
          {!open && (
            <span className="mono" style={{ fontSize: 11, color: 'var(--ink-3)', letterSpacing: '0.04em' }}>
              {summary} {dimUnit}
            </span>
          )}
        </button>
      </div>
      {open && (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
        {labels.map((axis, i) => (
          <label key={axis} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span className="mono" style={{ fontSize: 10, color: 'var(--ink)', letterSpacing: '0.1em', fontWeight: 600 }}>
              {axis}
            </span>
            <input
              type="number"
              min={0.5}
              step={step}
              value={local[i]}
              onChange={(e) => commit(i as 0 | 1 | 2, e.target.value)}
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 13,
                fontWeight: 600,
                padding: '6px 8px',
                border: '1px solid var(--hairline-strong)',
                borderRadius: 'var(--r-1)',
                background: 'var(--paper)',
                color: 'var(--ink)',
                outline: 'none',
                width: '100%',
              }}
              onFocus={(e) => (e.target.style.borderColor = 'var(--accent)')}
              onBlur={(e) => (e.target.style.borderColor = 'var(--hairline-strong)')}
            />
          </label>
        ))}
      </div>
      )}
    </div>
  );
}

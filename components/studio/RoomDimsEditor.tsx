'use client';

// Edit room shell dimensions (W × D × H). Live updates 3D + 2D.
// Uses the user's selected dim unit. Writes back to IDB on commit.

import { useEffect, useRef, useState } from 'react';
import { useScene } from '@/lib/scene-store';
import { useSettings } from '@/lib/store';
import { fromMM, toMM, stepFor, precisionFor } from '@/lib/units';
import { ROOM_SIDE_M } from '@/lib/dimension-ranges';
import { roomStore } from '@/lib/storage';
import { useParams } from 'next/navigation';
import { Icon } from '@/components/ui/Icon';
import { NumberField } from '@/components/ui/NumberField';

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
  // An out-of-range entry used to be a silent no-op — the number stayed on
  // screen and the room simply didn't change. Say what the limit is instead.
  const [rangeError, setRangeError] = useState(false);

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
      if (m.some((n) => Number.isNaN(n) || n < ROOM_SIDE_M.min || n > ROOM_SIDE_M.max)) {
        setRangeError(true);
        return;
      }
      setRangeError(false);
      const r = { width: m[0], depth: m[1], height: m[2] };
      setRoom(r);
      if (roomId) {
        const existing = await roomStore.loadRoom(roomId);
        if (existing) await roomStore.saveRoom({ ...existing, ...r });
      }
    }, 200);
  }

  const labels: ['Width', 'Depth', 'Height'] = ['Width', 'Depth', 'Height'];

  // Collapsed by default — the shell is set once during onboarding and edited
  // rarely, while the left rail's real job is the furniture. The header doubles
  // as the toggle and carries a live summary, so the size stays glanceable
  // without opening anything (nothing else in the studio shows it).
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
      <>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
          {labels.map((axis, i) => (
            <label key={axis} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 11, color: 'var(--ink-2)', fontWeight: 600 }}>{axis}</span>
              {/* .field owns the boundary and the focus ring — the old inline
                  outline:none + onFocus/onBlur border swap fought it. The
                  stepper is ours; the native one is suppressed app-wide. */}
              <NumberField
                min={0.5}
                step={step}
                value={local[i]}
                onChange={(v) => commit(i as 0 | 1 | 2, v)}
                ariaInvalid={rangeError}
                height={32}
              />
            </label>
          ))}
        </div>
        <div style={{ fontSize: 11, marginTop: 6, lineHeight: 1.4, color: rangeError ? 'var(--danger-text)' : 'var(--ink-3)' }}>
          {rangeError
            ? `That is outside ${ROOM_SIDE_M.min}–${ROOM_SIDE_M.max} m — enter a size in that range and the room will follow.`
            : `Sizes in ${dimUnit}. Anything from ${ROOM_SIDE_M.min} to ${ROOM_SIDE_M.max} m a side.`}
        </div>
      </>
      )}
    </div>
  );
}

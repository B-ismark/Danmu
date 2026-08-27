'use client';

// Edit room shell dimensions (W × D × H). Live updates 3D + 2D.
// Uses the user's selected dim unit. Writes back to IDB on commit.

import { useEffect, useRef, useState } from 'react';
import { useScene } from '@/lib/scene-store';
import { useSettings, useStudio } from '@/lib/store';
import { fromMM, toMM, stepFor, precisionFor } from '@/lib/units';
import { roomAxisRange, roomAxisWithin, type RoomAxis } from '@/lib/dimension-ranges';
import { regradeForNewCeiling } from '@/lib/transforms';
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
  //
  // It holds the AXIS rather than a boolean, because the three axes no longer
  // share one range and a message naming the wrong one is worse than no message.
  const [rangeError, setRangeError] = useState<RoomAxis | null>(null);

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
      // Only the axis being edited is judged. Judging all three refused a width
      // edit on account of a ceiling typed before this rule existed — and named
      // the side range in the message while doing it.
      const axis = AXES[idx];
      if (!roomAxisWithin(axis, m[idx])) {
        setRangeError(axis);
        return;
      }
      setRangeError(null);
      const r = { width: m[0], depth: m[1], height: m[2] };
      const oldHeight = useScene.getState().room.height;
      setRoom(r);
      // The ceiling moved, so the pieces whose height is measured from it move
      // with it — a fan hung under a 1.75 m ceiling was left at 1.60 m when the
      // room grew to 2.80 m, and read as a fan that will not stay up. Both
      // layers, because both persist; the rule for which pieces follow is
      // `heightForNewCeiling`'s. One `setParts` rather than a write per piece:
      // `RoomSync` saves on every `parts` identity change.
      if (r.height !== oldHeight) {
        const { parts, setParts } = useScene.getState();
        const studio = useStudio.getState();
        const { authored, overridden } = regradeForNewCeiling(parts, studio, oldHeight, r.height);
        if (authored.length > 0) {
          const byId = new Map(authored.map((a) => [a.id, a.y]));
          setParts(
            parts.map((p) => {
              const y = byId.get(p.id);
              return y === undefined ? p : { ...p, pos: [p.pos[0], y, p.pos[2]] as [number, number, number] };
            }),
          );
        }
        for (const b of overridden) {
          const ov = studio.positions[b.id];
          if (ov) studio.setPosition(b.id, [ov[0], b.y, ov[2]]);
        }
      }
      if (roomId) {
        const existing = await roomStore.loadRoom(roomId);
        if (existing) await roomStore.saveRoom({ ...existing, ...r });
      }
    }, 200);
  }

  const labels: ['Width', 'Depth', 'Height'] = ['Width', 'Depth', 'Height'];
  // The same three, as the range rule names them. Paired by index with `labels`
  // and with `local`, which is what `commit` indexes into.
  const AXES: readonly [RoomAxis, RoomAxis, RoomAxis] = ['width', 'depth', 'height'];

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
              {/* The stepper's own bounds come off the same rule as the commit
                  check and the sentence below it — a hand-typed 0.5 here let the
                  arrows walk the room somewhere the commit would then refuse. */}
              <NumberField
                min={roomAxisRange(AXES[i]).min}
                max={roomAxisRange(AXES[i]).max}
                step={step}
                value={local[i]}
                onChange={(v) => commit(i as 0 | 1 | 2, v)}
                ariaInvalid={rangeError === AXES[i]}
                height={32}
              />
            </label>
          ))}
        </div>
        <div style={{ fontSize: 11, marginTop: 6, lineHeight: 1.4, color: rangeError ? 'var(--danger-text)' : 'var(--ink-3)' }}>
          {rangeError
            ? `That ${rangeError} is outside ${roomAxisRange(rangeError).min}–${roomAxisRange(rangeError).max} m — enter one in that range and the room will follow.`
            : `Sizes in ${dimUnit}. ${roomAxisRange('width').min}–${roomAxisRange('width').max} m a side, ${roomAxisRange('height').min}–${roomAxisRange('height').max} m tall.`}
        </div>
      </>
      )}
    </div>
  );
}

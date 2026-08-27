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

  // No disclosure of its own any more. This was a collapsible "Room shell" header
  // sitting INSIDE the rail's collapsible "Room" section — two locks on one door,
  // which is the objection `ViewOptions` already records against a popover inside
  // a `RailSection`, and it cost a click to reach the fields plus a chevron and a
  // title that repeated what the section above already said.
  //
  // Its collapsed summary went with it. That existed only because this was
  // collapsed, and the Room section's own `meta` is where a collapsed state
  // belongs — one summary, in the header that does the collapsing. (That meta was
  // also the one printing `0.0×0.0m`: it divided metres by 1000.)
  return (
    // `--hairline`, not `--edge`: a decorative divider between two groups in the
    // rail, not the boundary of anything interactive.
    <div style={{ paddingBottom: 14, marginBottom: 4, borderBottom: '1px solid var(--hairline)' }}>
      <span className="ds-label" style={{ display: 'block', marginBottom: 8 }}>Room dimensions</span>
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
            // Was "Sizes in {unit}. Anything from 1 to 50 m a side." Trimmed
            // because the range only matters once you are outside it, which is
            // what the error branch above is for.
            //
            // The unit stays a literal `m`: `ROOM_SIDE_M` is metres by name and
            // by value, so interpolating `dimUnit` here would label 1–50 as
            // centimetres or feet for anyone who has changed the setting. Shorter
            // copy is not worth a wrong number — rule 2, and it would have been
            // invisible to everyone left on metres.
            : `${ROOM_SIDE_M.min}–${ROOM_SIDE_M.max} m a side.`}
        </div>
    </div>
  );
}

'use client';

// Edit room shell dimensions (W × D × H). Live updates 3D + 2D.
// Uses the user's selected dim unit. Writes back to IDB on commit.

import { useEffect, useRef, useState } from 'react';
import { useScene } from '@/lib/scene-store';
import { useSettings, useStudio } from '@/lib/store';
import { boundToUnit, fromMM, toMM, stepFor, precisionFor } from '@/lib/units';
import { roomAxisRange, roomAxisWithin, type RoomAxis } from '@/lib/dimension-ranges';
import { regradeForNewCeiling } from '@/lib/transforms';
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

  // One derivation for the arrows' limits and for the sentence that names them.
  // Written twice, they disagree the moment a unit is not metres.
  const bound = (axis: RoomAxis, side: 'min' | 'max') =>
    boundToUnit(roomAxisRange(axis)[side] * 1000, dimUnit, side);

  const labels: ['Width', 'Depth', 'Height'] = ['Width', 'Depth', 'Height'];
  // The same three, as the range rule names them. Paired by index with `labels`
  // and with `local`, which is what `commit` indexes into.
  const AXES: readonly [RoomAxis, RoomAxis, RoomAxis] = ['width', 'depth', 'height'];

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
              {/* The stepper's own bounds come off the same rule as the commit
                  check and the sentence below it — a hand-typed 0.5 here let the
                  arrows walk the room somewhere the commit would then refuse.
                  IN THE FIELD'S OWN UNIT, which is the half that was still wrong:
                  the rule is in metres and `value` is in `dimUnit`, so a 5 m room
                  showed `500.0` cm against a max of `50` and one press of the up
                  chevron clamped it to 50 cm. `boundToUnit` converts and rounds
                  inward, so the arrows cannot reach a number the commit refuses —
                  in either direction, in any of the five units. */}
              <NumberField
                min={bound(AXES[i], 'min')}
                max={bound(AXES[i], 'max')}
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
            ? `That ${rangeError} is outside ${bound(rangeError, 'min')}–${bound(rangeError, 'max')} ${dimUnit} — enter one in that range and the room will follow.`
            // Was "Sizes in {unit}. Anything from 1 to 50 m a side." Trimmed
            // because the range only matters once you are outside it, which is
            // what the error branch above is for.
            //
            // IN THE USER'S UNIT, and it has to be. The literal `m` here was
            // defended on the grounds that `ROOM_SIDE_M` / `ROOM_HEIGHT_M` are
            // metres by name and by value — true, and beside the point: the field
            // above shows `500.0` to someone working in centimetres, so "1–50 m"
            // told them a range in a unit they were not typing in. `boundToUnit`
            // is what makes both correct at once, and the numbers here are the
            // SAME call the arrows are bounded by, so the sentence cannot name a
            // range the stepper will not reach.
            : `${bound('width', 'min')}–${bound('width', 'max')} ${dimUnit} a side, ${bound('height', 'min')}–${bound('height', 'max')} ${dimUnit} tall.`}
        </div>
    </div>
  );
}

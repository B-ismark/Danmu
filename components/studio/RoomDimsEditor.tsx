'use client';

// Edit room shell dimensions (W × D × H). Live updates 3D + 2D.
// Uses the user's selected dim unit. Writes back to IDB on commit.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useScene } from '@/lib/scene-store';
import { useSettings, useStudio } from '@/lib/store';
import { boundsToUnit, formatDim, fromMM, toMM, stepFor, precisionFor } from '@/lib/units';
import { applyRoomEdits, roomAxisRange, ROOM_AXES, ROOM_SIDE_EPS, type RoomAxis, type RoomRejection } from '@/lib/dimension-ranges';
import { floorRefusal, roomFloors, type FloorAxis } from '@/lib/room-floor';
import { currentRoomScene, useRoomScene } from '@/lib/room-scene';
import { recarryForResize, regradeForNewCeiling } from '@/lib/transforms';
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
  // WHICH rule refused, so the sentence can name the piece in the way rather than
  // restating the arrows' own limits. A boolean beside `rangeError` would be a
  // second thing to keep in step with it; both are set and cleared together below.
  const [errorBy, setErrorBy] = useState<RoomRejection | null>(null);

  // How small the furniture will let each side get. RESOLVED parts — a piece the
  // user has resized carries its new size in the `useStudio` override, and
  // measuring `useScene.parts` would answer about a piece nobody can see.
  //
  // Memoised on the two things it reads because it runs on every render of a rail
  // that re-renders on every drag: `roomFloors` is O(parts) with two trig calls
  // apiece, which is nothing on its own and is not free once per frame.
  const parts = useRoomScene();
  const floors = useMemo(
    () => roomFloors(parts, { width: room.width, depth: room.depth }),
    [parts, room.width, room.depth],
  );

  // Which fields have been typed in since the last commit fired. The debounce
  // coalesces a fast width-then-depth into one write, so the batch is a set and
  // not merely the last index — but it is also the whole of what gets judged and
  // the whole of what gets written. Judging one axis and writing three is what
  // let a refused number reach the store on the NEXT edit to a different field;
  // `applyRoomEdits` is where that now cannot happen, and why the untouched axes
  // in `commit` come off the live room rather than out of `next`.
  //
  // Declared above the resync effect because that effect clears it.
  const edited = useRef(new Set<RoomAxis>());

  useEffect(() => {
    setLocal([
      fromMM(room.width * 1000, dimUnit).toFixed(prec),
      fromMM(room.depth * 1000, dimUnit).toFixed(prec),
      fromMM(room.height * 1000, dimUnit).toFixed(prec),
    ]);
    // This resync has just overwritten whatever the user had typed, so it owns
    // retiring what that typing left behind. It did not, and the message outlived
    // its subject: clear the Height box, the batch is refused and `rangeError`
    // says so — then change the unit in Settings (or drag a wall, or undo) and
    // this effect rewrites Height to the room's real value while the sentence
    // underneath still reads "That height is outside 1.8-12 m" and `aria-invalid`
    // sits on a field showing a legal number. It cleared only on the next
    // keystroke anywhere. `dimUnit` and `prec` are in these deps, so a unit change
    // is the cheapest way to see it, and changing units while a field is refused
    // is not an exotic thing to do. Found by danmu-cd in review.
    edited.current.clear();
    setRangeError(null);
    setErrorBy(null);
  }, [room.width, room.depth, room.height, dimUnit, prec]);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function commit(idx: 0 | 1 | 2, raw: string) {
    const next = [...local] as [string, string, string];
    next[idx] = raw;
    setLocal(next);
    edited.current.add(ROOM_AXES[idx]);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const batch: Partial<Record<RoomAxis, number>> = {};
      for (const axis of edited.current) {
        batch[axis] = toMM(parseFloat(next[ROOM_AXES.indexOf(axis)]), dimUnit) / 1000;
      }
      const base = useScene.getState().room;
      // Recomputed here rather than read off the render's `floors` memo, and that
      // is not tidiness: this runs 200 ms after the last keystroke, and a wall
      // drag or a resize inside that window would leave the closure holding a
      // floor for a room that has since changed shape. The memo above is for the
      // arrows, which re-render; the commit reads the live scene.
      const live = roomFloors(currentRoomScene(), { width: base.width, depth: base.depth });
      const { room: r, rejected, rejectedBy, pending } = applyRoomEdits(
        { width: base.width, depth: base.depth, height: base.height },
        batch,
        { width: live.width.metres, depth: live.depth.metres },
      );
      // What to keep holding is the rule's answer, not this component's — see
      // `applyRoomEdits`. A refusal hands the whole batch back so the form
      // retries atomically as well as committing atomically; the first version
      // cleared the set before the check and silently dropped the good edits
      // beside the bad one. The consequence is deliberate: while a field holds an
      // illegal value every later commit re-includes it and is refused again, so
      // no other field lands until it is fixed — which is what the message on
      // screen is already telling the user to do.
      edited.current = new Set(Object.keys(pending) as RoomAxis[]);
      if (rejected) {
        setRangeError(rejected);
        setErrorBy(rejectedBy);
        return;
      }
      setRangeError(null);
      setErrorBy(null);
      const oldHeight = base.height;
      const beforeFp = useScene.getState().room.footprint;
      setRoom(r);

      // Width or depth moved the walls, so everything standing against them comes
      // too. This was missing entirely: the ceiling regrade below has been here
      // since a fan was left hanging at 1.60 m in a 2.80 m room, and the two floor
      // axes carried NOTHING — so shrinking a room walked the wall straight through
      // the sofa and left it outside the shell. One axis of three.
      //
      // `setRoom` rebuilds the polygon through `footprintForLayout` rather than
      // nudging one edge, so there is no single wall and no single delta to hand
      // `carryAttached`; `carryForResize` reads the displacement of every wall off
      // the two footprints instead. Same rules underneath — only the dragged wall's
      // own pieces, and never make containment worse.
      const afterFp = useScene.getState().room.footprint;
      if (afterFp !== beforeFp) {
        const { parts, setParts } = useScene.getState();
        const studio = useStudio.getState();
        const { authored, overridden } = recarryForResize(parts, studio, beforeFp, afterFp);
        if (authored.length > 0) {
          // Identity preserved for a part that did not move, like the regrade
          // below: `RoomSync` saves on every `parts` identity change, and a piece
          // rebuilt unchanged is a write nobody asked for.
          const byId = new Map(authored.map((a) => [a.id, a.pos]));
          setParts(
            parts.map((p) => {
              const pos = byId.get(p.id);
              return pos === undefined ? p : { ...p, pos };
            }),
          );
        }
        for (const b of overridden) studio.setPosition(b.id, b.pos);
      }
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
  //
  // The two floor axes take the FURNITURE floor rather than the static minimum,
  // which is what makes the stop a bound and not merely a refusal: the arrows
  // cannot walk the room somewhere the commit will then reject, in either
  // direction and in any of the five units. A ceiling keeps `ROOM_HEIGHT_M` — a
  // piece taller than the ceiling keeps its height and `lib/clearance.ts` reports
  // it, which is a different answer from this one.
  const bounds = (axis: RoomAxis) => {
    const r = roomAxisRange(axis);
    const min = axis === 'height' ? r.min : floors[axis].metres;
    return boundsToUnit(min * 1000, r.max * 1000, dimUnit);
  };

  // Paired by index with `ROOM_AXES` — the rule's own order — and so with
  // `local`, which is what `commit` indexes into. The axis names used to be a
  // second copy of that tuple sitting here; the rule owns it now, because a
  // component that keeps its own order can put it back in a different one.
  const labels: ['Width', 'Depth', 'Height'] = ['Width', 'Depth', 'Height'];

  // The furniture refusal, in the user's unit. `applyRoomEdits` only reports
  // `'floor'` while the stop is above the static minimum, and a stop above the
  // static minimum came from a piece — so this branch always has one to name and
  // the fallback below is unreachable rather than a hidden second message. It is
  // there because the type cannot say that and a thrown `!` would be worse.
  function floorMessage(axis: RoomAxis): string {
    if (axis === 'height') return '';
    const { stop } = floors[axis as FloorAxis];
    if (!stop) return '';
    return floorRefusal(
      stop,
      axis as FloorAxis,
      `${formatDim(stop.metres * 1000, dimUnit)} ${dimUnit}`,
      // The piece fits the room it is in — which is what decides whether the
      // sentence may say the room "will not go narrower than that". When it does
      // not fit, the floor is pinned to the current side and naming that as what
      // the piece needs would be a false number.
      //
      // `ROOM_SIDE_EPS`, because a room walked here by dragging a wall sits a
      // rounding error under its own stop: a bare `<=` calls a 2.4 m piece too big
      // for a 2.4 m room and prints "already does not fit" at exactly the size the
      // user just achieved. Same tolerance as `lib/wall-actions.ts`, from the same
      // constant, since it is the same question about the same number.
      stop.metres <= (axis === 'width' ? room.width : room.depth) + ROOM_SIDE_EPS,
    );
  }

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
                  chevron clamped it to 50 cm. `boundsToUnit` converts and rounds
                  inward, so the arrows cannot reach a number the commit refuses —
                  in either direction, in any of the five units. */}
              <NumberField
                min={bounds(ROOM_AXES[i]).min}
                max={bounds(ROOM_AXES[i]).max}
                step={step}
                value={local[i]}
                onChange={(v) => commit(i as 0 | 1 | 2, v)}
                ariaInvalid={rangeError === ROOM_AXES[i]}
                height={32}
              />
            </label>
          ))}
        </div>
        <div style={{ fontSize: 11, marginTop: 6, lineHeight: 1.4, color: rangeError ? 'var(--danger-text)' : 'var(--ink-3)' }}>
          {rangeError && errorBy === 'floor'
            ? floorMessage(rangeError)
            : rangeError
            ? `That ${rangeError} is outside ${bounds(rangeError).min}–${bounds(rangeError).max} ${dimUnit} — enter one in that range and the room will follow.`
            // Was "Sizes in {unit}. Anything from 1 to 50 m a side." Trimmed
            // because the range only matters once you are outside it, which is
            // what the error branch above is for.
            //
            // IN THE USER'S UNIT, and it has to be. The literal `m` here was
            // defended on the grounds that `ROOM_SIDE_M` / `ROOM_HEIGHT_M` are
            // metres by name and by value — true, and beside the point: the field
            // above shows `500.0` to someone working in centimetres, so "1–50 m"
            // told them a range in a unit they were not typing in. `boundsToUnit`
            // is what makes both correct at once, and the numbers here are the
            // SAME call the arrows are bounded by, so the sentence cannot name a
            // range the stepper will not reach.
            : `${bounds('width').min}–${bounds('width').max} ${dimUnit} a side, ${bounds('height').min}–${bounds('height').max} ${dimUnit} tall.`}
        </div>
    </div>
  );
}

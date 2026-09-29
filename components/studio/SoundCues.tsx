'use client';

// The studio's ears. Listens to the stores and plays what `lib/sound-cues.ts`
// decides, plus the one continuous sound — the glide — which needs timing and so
// cannot be a pure diff.
//
// Mounted once per room (beside `KeyboardShortcuts`), so both tabs hear the same
// thing for the same change. Renders nothing.
//
// Three rules about WHEN, each learned from a review of the first version:
//   · **One action, one sound.** Actions write the stores in several `set` calls
//     — adding a piece is `addPart` then `setSelected`, a theme is the parts, then
//     the lighting, then the hour — and a cue per write played "place" and then
//     "select". So cues are collected over the synchronous run that caused them
//     (one microtask) and `cueFor` is asked once, about the whole of it, which is
//     the diff its `PRIORITY` was written for.
//   · **Only what a person did.** A cue needs a press, a key or a wheel in the
//     last few seconds. Writes nobody asked for at that moment — a wall colour
//     read off a photo finishing late, a settle after the room opened — are not
//     the user doing anything, and a context woken outside a gesture is one
//     Safari refuses anyway.
//   · **Each moving thing keeps its own clock.** A glide's speed is distance over
//     the time since THAT source's last sample; one shared timestamp let a second
//     source sampled in the same frame read as a full-level rush.

import { useEffect } from 'react';
import { SUN_DRAG_ID, WALL_DRAG_ID, useStudio } from '@/lib/store';
import { useScene } from '@/lib/scene-store';
import { useHistory } from '@/lib/history';
import { useDragLive } from '@/lib/drag-live';
import { cueFor, hourDelta, sizeOf, speedOf, type CueWorld } from '@/lib/sound-cues';
import { glide, glideStop, playSound } from '@/lib/sound';
import { sunAt } from '@/lib/lighting-moods';

/** Writes that land this soon after a drag ends are the drag's commit. */
const AFTER_DRAG_MS = 350;
/** A room that has just appeared is still settling — pieces dropped onto their
 *  supports, maps loaded — and none of that is the user doing anything. */
const SETTLE_MS = 900;
/** How long after a press or a key a change still counts as its answer. Long
 *  enough for Suggest, which solves off the main thread and can take seconds. */
const INPUT_WINDOW_MS = 6000;
/** A clock scrub moving one hour a second sounds like a brisk walk. */
const HOUR_AS_METRES = 1.2;

function read(): CueWorld {
  const t = useStudio.getState();
  const s = useScene.getState();
  return {
    room: s.hydratedRoomId,
    parts: s.parts,
    wallColors: s.room.wallColors,
    footprint: s.room.footprint,
    roomSize: { width: s.room.width, depth: s.room.depth, height: s.room.height },
    bearingDeg: s.room.site?.bearingDeg,
    positions: t.positions,
    rotations: t.rotations,
    dims: t.dims,
    lighting: t.lighting,
    hour: t.hour,
    selectedPartId: t.selectedPartId,
    hidden: t.hidden,
    pinned: t.pinned,
    dragging: t.draggingId,
    restoring: useHistory.getState().suspended,
  };
}

/** How far the outline moved, as the largest distance any corner travelled. */
function footprintTravel(a: unknown, b: unknown): number {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return 0;
  let most = 0;
  for (let i = 0; i < a.length; i++) {
    const [px, pz] = a[i] as [number, number];
    const [qx, qz] = b[i] as [number, number];
    most = Math.max(most, Math.hypot(qx - px, qz - pz));
  }
  return most;
}

export function SoundCues() {
  useEffect(() => {
    /** The world as of the last write — what the glides diff against. */
    let prev = read();
    /** The world before the batch of writes now pending — what the cue diffs against. */
    let batchBase: CueWorld | null = null;
    let dragEndedAt = -Infinity;
    let roomAt = performance.now();
    let inputAt = -Infinity;
    /** A wall drag that has moved, so its release knocks. */
    let wallMoved = false;
    /** The 3D drag channel's last frame, for its glide and its detents. */
    let live = useDragLive.getState().live;
    const clocks = { piece: 0, wall: 0, sun: 0, live: 0 };

    /** Milliseconds since `source` was last sampled, and restart its clock. */
    const since = (source: keyof typeof clocks, now: number) => {
      const dt = now - clocks[source];
      clocks[source] = now;
      return dt;
    };

    const flush = () => {
      const base = batchBase;
      batchBase = null;
      if (!base) return;
      const next = read();
      const now = performance.now();
      if (now - roomAt < SETTLE_MS || now - inputAt > INPUT_WINDOW_MS) return;
      const cue = cueFor(base, next, { afterDrag: now - dragEndedAt < AFTER_DRAG_MS });
      if (cue) playSound(cue.name, cue.opts);
    };

    const onChange = () => {
      const next = read();
      const now = performance.now();
      if (next.room !== prev.room) roomAt = now;

      // ── The drag lifecycle and its glide ──
      if (prev.dragging !== next.dragging) {
        if (prev.dragging !== null) {
          dragEndedAt = now;
          glideStop();
          // A wall is the one drag no gesture sets down audibly itself.
          if (prev.dragging === WALL_DRAG_ID && wallMoved) playSound('drop', { size: 1 });
        }
        wallMoved = false;
        for (const k of Object.keys(clocks) as Array<keyof typeof clocks>) clocks[k] = now;
      }
      const d = next.dragging;
      if (d !== null && d === prev.dragging && !next.restoring) {
        if (d === WALL_DRAG_ID) {
          const dist = footprintTravel(prev.footprint, next.footprint);
          if (dist > 0) {
            wallMoved = true;
            glide(speedOf(dist, since('wall', now)), { size: 1, brightness: 0.1 });
          }
        } else if (d !== SUN_DRAG_ID) {
          // The plan writes a dragged piece's position every frame; the 3D tab
          // animates its own mesh and is heard through the live channel below.
          const a = prev.positions[d];
          const b = next.positions[d];
          if (a && b && a !== b) {
            const part = next.parts.find((p) => p.id === d);
            glide(speedOf(Math.hypot(b[0] - a[0], b[2] - a[2]), since('piece', now)), { size: sizeOf(part?.dimMM) });
          }
        }
      }
      // The day, scrubbed: air that brightens as the sun climbs and goes dark and
      // soft at night. Any small change counts — the arc, the track, a key — and a
      // jump to a named time is a chime instead. Not an undo putting the hour back.
      if (next.lighting === 'daylight' && prev.lighting === 'daylight' && !next.restoring && next.room === prev.room) {
        const dh = hourDelta(prev.hour, next.hour);
        if (dh !== 0 && Math.abs(dh) < 1.5) {
          const el = sunAt(next.hour).elevationDeg;
          glide(speedOf(Math.abs(dh) * HOUR_AS_METRES, since('sun', now)), {
            size: 0.2,
            brightness: el > 0 ? 0.25 + (0.75 * el) / 60 : 0.05,
          });
        }
      }

      if (batchBase === null) {
        batchBase = prev;
        queueMicrotask(flush);
      }
      // An undo's own writes land inside the same batch as the flag that marks
      // them; the base must carry the flag too, or the batch reads as an edit.
      if (next.restoring) batchBase = { ...batchBase, restoring: true };
      prev = next;
    };

    // The 3D tab's drag never writes the store per frame, so it is heard from the
    // live channel: its speed as glide, its twist and stretch as detents.
    const onLive = () => {
      const l = useDragLive.getState().live;
      const was = live;
      live = l;
      const now = performance.now();
      if (!l || !was || l.partId !== was.partId) {
        clocks.live = now;
        return;
      }
      const dt = since('live', now);
      const moved = Math.hypot(l.x - was.x, l.z - was.z);
      if (moved > 0) glide(speedOf(moved, dt), { size: sizeOf(l.dimMM) });
      const step = Math.PI / 12;
      if (Math.round(l.rot / step) !== Math.round(was.rot / step)) playSound('turn');
      const la = Math.max(...was.dimMM);
      const lb = Math.max(...l.dimMM);
      if (Math.round(la / 50) !== Math.round(lb / 50)) playSound('stretch', { brightness: lb >= la ? 1 : 0 });
    };

    const onInput = () => {
      inputAt = performance.now();
    };
    const opts = { capture: true, passive: true } as const;
    window.addEventListener('pointerdown', onInput, opts);
    window.addEventListener('keydown', onInput, opts);
    window.addEventListener('wheel', onInput, opts);

    const unsubs = [useStudio.subscribe(onChange), useScene.subscribe(onChange), useDragLive.subscribe(onLive)];
    return () => {
      for (const u of unsubs) u();
      window.removeEventListener('pointerdown', onInput, opts);
      window.removeEventListener('keydown', onInput, opts);
      window.removeEventListener('wheel', onInput, opts);
      glideStop();
    };
  }, []);
  return null;
}

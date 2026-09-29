'use client';

// The studio's ears. Listens to the stores and plays what `lib/sound-cues.ts`
// decides, plus the one continuous sound — the glide — which needs timing and so
// cannot be a pure diff.
//
// Mounted once per room (beside `KeyboardShortcuts`), so both tabs hear the same
// thing for the same change. Renders nothing.

import { useEffect } from 'react';
import { useStudio } from '@/lib/store';
import { useScene } from '@/lib/scene-store';
import { useHistory } from '@/lib/history';
import { useDragLive } from '@/lib/drag-live';
import { cueFor, hourDelta, sizeOf, speedOf, type CueWorld } from '@/lib/sound-cues';
import { glide, glideStop, playSound } from '@/lib/sound';
import { sunAt } from '@/lib/lighting-moods';

const SUN = '__sun__';
const WALL = '__wall__';
/** Writes that land this soon after a drag ends are the drag's commit. */
const AFTER_DRAG_MS = 350;
/** A room that has just appeared is still settling — pieces dropped onto their
 *  supports, maps loaded — and none of that is the user doing anything. */
const SETTLE_MS = 900;
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
    let prev = read();
    let dragEndedAt = -Infinity;
    let roomAt = performance.now();
    let lastSample = performance.now();
    /** A wall drag that has moved, so its release knocks. */
    let wallMoved = false;
    /** The 3D drag channel's last frame, for its glide and its detents. */
    let live = useDragLive.getState().live;

    const sampleDt = () => {
      const now = performance.now();
      const dt = now - lastSample;
      lastSample = now;
      return dt;
    };

    const onChange = () => {
      const next = read();
      const now = performance.now();
      if (next.room !== prev.room) roomAt = now;
      if (now - roomAt < SETTLE_MS) {
        prev = next;
        return;
      }

      // ── The drag lifecycle and its glide ──
      if (prev.dragging !== next.dragging) {
        if (prev.dragging !== null) {
          dragEndedAt = now;
          glideStop();
          // A wall is the one drag no gesture sets down audibly itself.
          if (prev.dragging === WALL && wallMoved) playSound('drop', { size: 1 });
        }
        wallMoved = false;
        lastSample = now;
      }
      const d = next.dragging;
      if (d !== null && d === prev.dragging) {
        if (d === WALL) {
          const dist = footprintTravel(prev.footprint, next.footprint);
          if (dist > 0) {
            wallMoved = true;
            glide(speedOf(dist, sampleDt()), { size: 1, brightness: 0.1 });
          }
        } else if (d !== SUN) {
          // The plan writes a dragged piece's position every frame; the 3D tab
          // animates its own mesh and is heard through the live channel below.
          const a = prev.positions[d];
          const b = next.positions[d];
          if (a && b && a !== b) {
            const part = next.parts.find((p) => p.id === d);
            glide(speedOf(Math.hypot(b[0] - a[0], b[2] - a[2]), sampleDt()), { size: sizeOf(part?.dimMM) });
          }
        }
      }
      // The day, scrubbed: air that brightens as the sun climbs and goes dark and
      // soft at night. Any small change counts — the arc, the track, a key — and a
      // jump to a named time is a chime instead.
      if (next.lighting === 'daylight' && prev.lighting === 'daylight') {
        const dh = hourDelta(prev.hour, next.hour);
        if (dh !== 0 && Math.abs(dh) < 1.5) {
          const el = sunAt(next.hour).elevationDeg;
          glide(speedOf(Math.abs(dh) * HOUR_AS_METRES, sampleDt()), {
            size: 0.2,
            brightness: el > 0 ? 0.25 + (0.75 * el) / 60 : 0.05,
          });
        }
      }

      const cue = cueFor(prev, next, { afterDrag: now - dragEndedAt < AFTER_DRAG_MS });
      if (cue) playSound(cue.name, cue.opts);
      prev = next;
    };

    // The 3D tab's drag never writes the store per frame, so it is heard from the
    // live channel: its speed as glide, its twist and stretch as detents.
    const onLive = () => {
      const l = useDragLive.getState().live;
      const was = live;
      live = l;
      if (!l || !was || l.partId !== was.partId) return;
      const dt = sampleDt();
      const moved = Math.hypot(l.x - was.x, l.z - was.z);
      if (moved > 0) glide(speedOf(moved, dt), { size: sizeOf(l.dimMM) });
      const step = Math.PI / 12;
      if (Math.round(l.rot / step) !== Math.round(was.rot / step)) playSound('turn');
      const la = Math.max(...was.dimMM);
      const lb = Math.max(...l.dimMM);
      if (Math.round(la / 50) !== Math.round(lb / 50)) playSound('stretch', { brightness: lb >= la ? 1 : 0 });
    };

    const unsubs = [useStudio.subscribe(onChange), useScene.subscribe(onChange), useDragLive.subscribe(onLive)];
    return () => {
      for (const u of unsubs) u();
      glideStop();
    };
  }, []);
  return null;
}

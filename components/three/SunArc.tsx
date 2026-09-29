'use client';

// The day, drawn over the room: a dashed arc the sun travels along, and the sun
// (or, after dark, the moon) sitting on it where the clock says, with the time
// beside it. Grab it and drag it along the arc to scrub the day.
//
// It is in the SCENE rather than laid over the canvas in screen space, and that
// is the point of it: the arc is the real path the key light takes round this
// room, turned by the room's bearing, so orbiting the camera shows which wall the
// morning comes through without a sentence having to say so. It replaced the Sun
// direction dial in the rail, which told you the same thing as a dot on a circle
// in a drawer you had to open.
//
// Everything about where the sun IS comes from `lib/lighting-moods.ts` — the same
// `sunAt` / `moonAt` the key light is aimed with — so the marker and the light
// cannot disagree. This file only draws that answer and turns a drag back into an
// hour.
//
// Interaction contract:
//   · the marker is a real slider (role, value text, arrow keys), because a drag
//     is a pointer gesture and this is a control for a fact;
//   · a drag holds `draggingId` for its length (`SUN_DRAG_ID`), which is what
//     stops the camera orbiting under it and what makes the undo stack record the
//     whole scrub as ONE step rather than one per pointer move;
//   · by day the marker is the sun and a drag moves through the day; by night it
//     is the moon and a drag moves through the night. The two share one arc, so
//     crossing between them is the rail's Morning / Night stops, not a drag past
//     the horizon — a gesture whose meaning flips at an invisible point is one
//     nobody can learn.

import { useMemo, useRef } from 'react';
import { Html, Line } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { Vector3 } from 'three';
import { useStudio } from '@/lib/store';
import { useScene } from '@/lib/scene-store';
import { footprintBounds } from '@/lib/footprint';
import {
  DEFAULT_BEARING_DEG,
  formatClock,
  hourOnDayArc,
  hourOnNightArc,
  isDaytime,
  lightingAt,
  moonAt,
  sunAt,
  type SkyAngle,
} from '@/lib/lighting-moods';
import { SCENE } from '@/lib/scene-palette';
import { playSound } from '@/lib/sound';
import { Icon } from '@/components/ui/Icon';

/** The `draggingId` a sun scrub holds. A sentinel like `'__wall__'`: nothing is a
 *  part with this id, and `gestureOwnedByOther` treats it like any other owner. */
export const SUN_DRAG_ID = '__sun__';

/** How many points the arc is drawn with, and hit-tested against. 96 over a
 *  13½-hour day is one every ~8½ minutes, finer than the 5-minute rounding a drag
 *  lands on, so the rounding and not the sampling decides where it stops. */
const SAMPLES = 96;

/** A direction on the sky that does NOT refuse the horizon. `sunDirection` returns
 *  null at or below 0° on purpose — a light cannot shine up through the floor — but
 *  a path can be drawn there, and the arc's two ends are exactly at 0°. Same axes:
 *  +X east, +Z south, bearing rotating the whole sky. */
function skyPoint(a: SkyAngle, bearingDeg: number, r: number, c: [number, number]): [number, number, number] {
  const alt = (a.elevationDeg * Math.PI) / 180;
  const az = ((a.azimuthDeg - bearingDeg) * Math.PI) / 180;
  const h = Math.cos(alt);
  return [c[0] + r * h * Math.sin(az), r * Math.sin(alt), c[1] - r * h * Math.cos(az)];
}

/** Relative luminance of a `#rrggbb`, good enough to decide ink-or-paper. */
function isDark(hex: string): boolean {
  const n = parseInt(hex.slice(1), 16);
  const lum = 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
  return lum < 128;
}

const _v = new Vector3();

export function SunArc() {
  const lighting = useStudio((s) => s.lighting);
  const hour = useStudio((s) => s.hour);
  const setHour = useStudio((s) => s.setHour);
  const setLighting = useStudio((s) => s.setLighting);
  const setDragging = useStudio((s) => s.setDragging);
  const footprint = useScene((s) => s.room.footprint);
  const bearingDeg = useScene((s) => s.room.site?.bearingDeg) ?? DEFAULT_BEARING_DEG;
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);

  const overcast = lighting === 'overcast';
  const day = isDaytime(hour);

  // Centred on the room and clear of it: half its long side, plus a margin that
  // keeps the path outside the walls at every bearing. The room's centre rather
  // than the origin, because a wall dragged out leaves the footprint off-centre.
  const b = footprintBounds(footprint);
  const center: [number, number] = [b.cx, b.cz];
  const radius = Math.max(b.width, b.depth) * 0.62 + 1.4;

  // The arc, and the hour at each of its points. One list for both the drawing and
  // the drag's hit test, so the handle cannot be dragged to a place the dashes are not.
  const arc = useMemo(() => {
    const pts: Array<[number, number, number]> = [];
    for (let i = 0; i <= SAMPLES; i++) {
      const t = i / SAMPLES;
      pts.push(skyPoint(sunAt(hourOnDayArc(t)), bearingDeg, radius, center));
    }
    return pts;
    // `center` is rebuilt every render from `b`; its two numbers are the dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bearingDeg, radius, b.cx, b.cz]);

  const body = day ? sunAt(hour) : moonAt(hour);
  const marker = skyPoint(body, bearingDeg, radius, center);
  const light = lightingAt(lighting, hour, bearingDeg);
  const dark = isDark(light.bg);

  /** Nearest point on the arc to a pointer, in SCREEN space — the space the
   *  gesture happens in. Returns its fraction along the arc. */
  function tAtPointer(clientX: number, clientY: number): number {
    const rect = gl.domElement.getBoundingClientRect();
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i <= SAMPLES; i++) {
      _v.set(...arc[i]).project(camera);
      const x = rect.left + ((_v.x + 1) / 2) * rect.width;
      const y = rect.top + ((1 - _v.y) / 2) * rect.height;
      const d = (x - clientX) ** 2 + (y - clientY) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best / SAMPLES;
  }

  /** Whole hours already sounded this drag, so each is ticked once. */
  const lastTick = useRef<number | null>(null);
  /** Which half of the clock the drag started in, fixed for the gesture. */
  const phase = useRef<'day' | 'night'>('day');

  function scrubTo(clientX: number, clientY: number) {
    const t = tAtPointer(clientX, clientY);
    const raw = phase.current === 'day' ? hourOnDayArc(t) : hourOnNightArc(t);
    // Five-minute steps: a clock that reads 17:33 then 17:34 as the hand trembles
    // is noise, and nothing about furniture turns on a minute.
    const h = Math.round(raw * 12) / 12;
    setHour(h);
    const whole = Math.floor(h);
    if (lastTick.current !== whole) {
      lastTick.current = whole;
      playSound('tick', { brightness: phase.current === 'day' ? sunAt(h).elevationDeg / 60 : 0 });
    }
  }

  const step = (dh: number) => {
    setHour(hour + dh);
    playSound('tick', { brightness: day ? body.elevationDeg / 60 : 0 });
  };

  const ink = dark ? SCENE.sunPathOnDark : SCENE.sunPathOnLight;

  return (
    // `helper`: a saved picture is of the room, not of the controls drawn over it.
    <group userData={{ helper: true }}>
      <Line
        points={arc}
        color={ink}
        lineWidth={1.25}
        dashed
        dashSize={0.12}
        gapSize={0.1}
        transparent
        opacity={overcast ? 0.18 : 0.42}
        depthWrite={false}
        // Never under the room: the arc is a control, and a control hidden behind
        // the wall it is about is one you cannot reach.
        depthTest={false}
        renderOrder={10}
        raycast={() => null}
      />
      <Html position={marker} center zIndexRange={[25, 0]}>
        <div
          className={`sun-arc${overcast ? ' sun-arc--muted' : ''}${day ? '' : ' sun-arc--night'}`}
          role="slider"
          tabIndex={0}
          aria-label="Time of day"
          aria-valuemin={0}
          aria-valuemax={24}
          aria-valuenow={Math.round(hour * 100) / 100}
          aria-valuetext={`${formatClock(hour)}${overcast ? ', overcast' : day ? '' : ', night'}`}
          onPointerDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            e.currentTarget.setPointerCapture(e.pointerId);
            phase.current = day ? 'day' : 'night';
            lastTick.current = Math.floor(hour);
            // Grabbing the sun is asking for the sun: an overcast room goes back to
            // daylight rather than sitting there refusing the gesture.
            if (overcast) setLighting('daylight');
            setDragging(SUN_DRAG_ID);
            playSound('pick');
          }}
          onPointerMove={(e) => {
            if (useStudio.getState().draggingId !== SUN_DRAG_ID) return;
            scrubTo(e.clientX, e.clientY);
          }}
          onPointerUp={(e) => {
            if (useStudio.getState().draggingId !== SUN_DRAG_ID) return;
            e.currentTarget.releasePointerCapture(e.pointerId);
            setDragging(null);
            playSound('drop', { size: 0.2 });
          }}
          onPointerCancel={() => {
            if (useStudio.getState().draggingId === SUN_DRAG_ID) setDragging(null);
          }}
          // Arrows move a quarter of an hour, Shift a whole one; Page a named stop's
          // worth. Home and End are the declared ends, for the reason `RailSash`
          // honours them: the role is a promise about the keys.
          onKeyDown={(e) => {
            const q = e.shiftKey ? 1 : 0.25;
            if (e.key === 'ArrowRight' || e.key === 'ArrowUp') step(q);
            else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') step(-q);
            else if (e.key === 'PageUp') step(3);
            else if (e.key === 'PageDown') step(-3);
            else if (e.key === 'Home') setHour(0);
            else if (e.key === 'End') setHour(23.99);
            else return;
            e.preventDefault();
            if (overcast) setLighting('daylight');
          }}
        >
          <span className="sun-arc__body" aria-hidden>
            <Icon name={overcast ? 'cloud' : day ? 'sun' : 'moon'} size={18} />
          </span>
          <span className="sun-arc__time mono">{formatClock(hour)}</span>
        </div>
      </Html>
    </group>
  );
}

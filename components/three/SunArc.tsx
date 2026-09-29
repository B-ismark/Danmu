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
//     nobody can learn;
//   · it gives way to the furniture. The room is what people come to arrange and
//     the sun is a setting on it, so the arc must never be the thing under a hand
//     that reached for a piece: it rides ABOVE the walls (see `sunArcShape`), vanishes
//     while anything else is being carried, and quietens while a piece is selected.

import { useMemo, useRef, useState } from 'react';
import { Html, Line } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { Vector3, type Camera, type Object3D } from 'three';
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
} from '@/lib/lighting-moods';
import { SCENE } from '@/lib/scene-palette';
import { skyPoint, sunArcShape } from '@/lib/sun-arc';
import { playSound } from '@/lib/sound';
import { Icon } from '@/components/ui/Icon';

/** The `draggingId` a sun scrub holds. A sentinel like `'__wall__'`: nothing is a
 *  part with this id, and `gestureOwnedByOther` treats it like any other owner. */
export const SUN_DRAG_ID = '__sun__';

/** How many points the arc is drawn with, and hit-tested against. 96 over a
 *  13½-hour day is one every ~8½ minutes, finer than the 5-minute rounding a drag
 *  lands on, so the rounding and not the sampling decides where it stops. */
const SAMPLES = 96;

/** Relative luminance of a `#rrggbb`, good enough to decide ink-or-paper. */
function isDark(hex: string): boolean {
  const n = parseInt(hex.slice(1), 16);
  const lum = 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
  return lum < 128;
}

const _v = new Vector3();

/** Room the pill needs from each edge of the canvas, in CSS pixels: half its
 *  width beside it, the floating toolbar above it, the view gizmo's row below. */
const FRAME = { x: 56, top: 76, bottom: 28 };

/** drei's own placement, then held inside the canvas. The arc's two ends run
 *  toward the camera and leave the frame at sunrise and sunset — and any part of it
 *  can, once the view is orbited — and a handle that leaves the canvas is a control
 *  that has gone. Pinned to the edge it still says where the sun is, the way a map
 *  pins an off-screen marker. Measured: 06:40 in a 5 × 4 m room at the default view
 *  put the whole pill past the right edge. */
function keepInFrame(el: Object3D, camera: Camera, size: { width: number; height: number }): number[] {
  _p.setFromMatrixPosition(el.matrixWorld).project(camera);
  const x = (_p.x + 1) * (size.width / 2);
  const y = (1 - _p.y) * (size.height / 2);
  const clamp = (v: number, lo: number, hi: number) => (hi < lo ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, v)));
  return [clamp(x, FRAME.x, size.width - FRAME.x), clamp(y, FRAME.top, size.height - FRAME.bottom)];
}
const _p = new Vector3();

export function SunArc() {
  const lighting = useStudio((s) => s.lighting);
  const hour = useStudio((s) => s.hour);
  const setHour = useStudio((s) => s.setHour);
  const setLighting = useStudio((s) => s.setLighting);
  const setDragging = useStudio((s) => s.setDragging);
  const footprint = useScene((s) => s.room.footprint);
  const roomHeight = useScene((s) => s.room.height);
  const bearingDeg = useScene((s) => s.room.site?.bearingDeg) ?? DEFAULT_BEARING_DEG;
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);

  const overcast = lighting === 'overcast';
  const day = isDaytime(hour);

  // A halo, not a dome — see `sunArcShape` for why it sits on the eaves.
  const b = footprintBounds(footprint);
  const { center, radius } = sunArcShape(b, roomHeight);

  // Giving way. Anything else being carried — a piece, a wall — and the sun is not
  // there at all, so it can neither catch the pointer nor draw over the size tags.
  // A piece selected and the sun quietens to a hint; reaching for it (hover,
  // focus, a drag) brings it back.
  const otherGesture = useStudio((s) => s.draggingId !== null && s.draggingId !== SUN_DRAG_ID);
  const pieceInHand = useStudio((s) => s.selection.length > 0 || s.selectedWall !== null);
  const [reached, setReached] = useState(false);

  // The arc, and the hour at each of its points. One list for both the drawing and
  // the drag's hit test, so the handle cannot be dragged to a place the dashes are not.
  //
  // WHICH path is the half of the clock being shown: the sun's by day, the moon's
  // lower one by night. The first version always drew the sun's, and the moon —
  // which peaks at 38° against the sun's 60° — rode visibly off the dashes all
  // night. While the sun is being carried the half is the one the gesture started
  // in, so a drag that reaches sunset exactly (19:30, the arc's own end) does not
  // swap paths, and jump the handle to the other horizon, under the hand.
  /** Which half of the clock the drag started in, fixed for the gesture. */
  const phase = useRef<'day' | 'night'>('day');
  const carrying = useStudio((s) => s.draggingId === SUN_DRAG_ID);
  const half: 'day' | 'night' = carrying ? phase.current : day ? 'day' : 'night';
  const arc = useMemo(() => {
    const pts: Array<[number, number, number]> = [];
    for (let i = 0; i <= SAMPLES; i++) {
      const t = i / SAMPLES;
      const a = half === 'day' ? sunAt(hourOnDayArc(t)) : moonAt(hourOnNightArc(t));
      pts.push(skyPoint(a, bearingDeg, radius, center));
    }
    return pts;
    // `center` is rebuilt every render from `b`; its two numbers are the dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [half, bearingDeg, radius.across, radius.up, radius.base, b.cx, b.cz]);

  const body = half === 'day' ? sunAt(hour) : moonAt(hour);
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


  function scrubTo(clientX: number, clientY: number) {
    const t = tAtPointer(clientX, clientY);
    const raw = phase.current === 'day' ? hourOnDayArc(t) : hourOnNightArc(t);
    // Five-minute steps: a clock that reads 17:33 then 17:34 as the hand trembles
    // is noise, and nothing about furniture turns on a minute.
    const h = Math.round(raw * 12) / 12;
    // The hour's detent, the air under the scrub and the dawn and dusk cues are
    // `SoundCues`' — they follow the clock whatever moves it.
    setHour(h);
  }

  const step = (dh: number) => {
    setHour(hour + dh);
    playSound('tick', { brightness: day ? body.elevationDeg / 60 : 0 });
  };

  const ink = dark ? SCENE.sunPathOnDark : SCENE.sunPathOnLight;
  const engaged = carrying || reached;
  const quiet = pieceInHand && !engaged;
  // At rest the dashes are a hint of the path; reaching for the sun draws it out.
  // Pale dashes on a night sky read about twice as loud as dark ones by day — the
  // first night frame looked scored across the room — so the dark case is softer.
  const strength = (overcast ? 0.4 : engaged ? 1 : quiet ? 0.3 : 0.5) * (dark && !engaged ? 0.65 : 1);

  return (
    // `helper`: a saved picture is of the room, not of the controls drawn over it.
    <group userData={{ helper: true }} visible={!otherGesture}>
      {/* Drawn twice. Once THROUGH everything, faint — the arc is a control, and a
          control hidden behind the wall it is about is one you cannot find — and
          once depth-tested at full strength, so the stretch in front of the room is
          clear and the stretch behind a wall is a ghost of it. One pass at one
          strength read as a construction line scored across the plaster. */}
      <Line
        points={arc}
        color={ink}
        lineWidth={1.25}
        dashed
        dashSize={0.12}
        gapSize={0.1}
        transparent
        opacity={0.2 * strength}
        depthWrite={false}
        depthTest={false}
        renderOrder={10}
        raycast={() => null}
      />
      <Line
        points={arc}
        color={ink}
        lineWidth={1.25}
        dashed
        dashSize={0.12}
        gapSize={0.1}
        transparent
        opacity={0.55 * strength}
        depthWrite={false}
        renderOrder={11}
        raycast={() => null}
      />
      {/* Under the canvas's own floating panels (`--z-canvas-ui`, 20): pinned to an
          edge, the handle slides beneath the toolbar and the view buttons rather
          than over them. It was 25, and sat on top. */}
      <Html position={marker} center zIndexRange={[15, 0]} calculatePosition={keepInFrame}>
        <div
          className={`sun-arc${overcast ? ' sun-arc--muted' : ''}${half === 'day' ? '' : ' sun-arc--night'}${
            quiet ? ' sun-arc--quiet' : ''
          }${otherGesture ? ' sun-arc--away' : ''}`}
          aria-hidden={otherGesture || undefined}
          onPointerEnter={() => setReached(true)}
          onPointerLeave={() => setReached(false)}
          onFocus={() => setReached(true)}
          onBlur={() => setReached(false)}
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
            <Icon name={overcast ? 'cloud' : half === 'day' ? 'sun' : 'moon'} size={18} />
          </span>
          <span className="sun-arc__time mono">{formatClock(hour)}</span>
        </div>
      </Html>
    </group>
  );
}

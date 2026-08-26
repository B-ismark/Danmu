'use client';

// Which way the room faces, as a dial you point.
//
// This is what survived the sun panel. There used to be a "Where the room is"
// section carrying a latitude, a longitude, a "Use my location" button, a
// Compass button, a solar-elevation arc, a twelve-month strip and a "Now" pin —
// four facts and two device permissions in service of a solar position accurate
// to a hundredth of a degree. `lib/solar.ts`'s header has the argument for why
// that went; the short version is that nobody arranging furniture can check it,
// and the repo already refuses precision the sun cannot use.
//
// The bearing is the one part that stayed, for a reason that is not sentiment:
// it is the only one of those inputs whose effect is visible at furniture scale.
// Latitude and date change how HIGH the sun gets; the bearing changes WHICH WALL
// the light comes through, and that is a question about this room.
// `lib/storage.ts` has always called it "a property of the room, not of the
// device", so it now sits in the rail's Room section beside the room's other
// properties rather than inside a lighting mood — the four sun angles in
// `Room`'s mood table all rotate with it.
//
// The Compass button did NOT stay, and it was measurably dead rather than merely
// doubtful: its own help text read "On a phone: aim its top edge at the wall at
// the top of the plan and tap Compass", while `NarrowViewportBanner` matches
// `(hover: none) and (pointer: coarse)` and shows phone users a go-away modal.
// A control whose instructions describe a device the studio refuses is not a
// feature. `lib/bearings.ts` (was `lib/compass.ts`) kept the circular-mean maths —
// `lib/capture-slots.ts` needs it to average EXIF photo bearings — and lost only
// the sensor read.

import { useCallback, useRef } from 'react';
import { useScene } from '@/lib/scene-store';
import { useStudio } from '@/lib/store';
import { LIGHTING } from '@/lib/lighting-moods';
import { Icon } from '@/components/ui/Icon';

/** Eight points, because sixteen would be precision the sentence around it does
 *  not have. */
const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];

/** "south-west" for 213°. */
function compassName(deg: number): string {
  return COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}

/** The bearing a room with no site yet is drawn at: square to the compass.
 *
 *  Zero is honest here in a way the old default latitude never was — "nobody has
 *  said which way this room faces" and "the plan's top edge really is north"
 *  produce the same picture, and the dial shows the number it is using either
 *  way. `Room` falls back to the same value. */
const DEFAULT_BEARING_DEG = 0;

export function NorthDial() {
  const site = useScene((s) => s.room.site);
  const setSite = useScene((s) => s.setSite);
  const bearingDeg = site?.bearingDeg ?? DEFAULT_BEARING_DEG;
  // Where the light is coming from, in the current mood — null in the three
  // studio looks, which have no direction to show. This is the whole reason the
  // mood table moved out of `Room.tsx` into `lib/lighting-moods.ts`: the dial and
  // the key light must read the same row, and a rail component cannot import a
  // module that pulls in React Three Fiber.
  const lighting = useStudio((s) => s.lighting);
  const sunAzimuthDeg = LIGHTING[lighting].sun?.azimuthDeg ?? null;

  // Read through `getState` rather than closing over `site`: the dial writes on
  // every pointer move, and a stale closure would spread one frame's bearing over
  // whatever the rest of the site was when this render happened.
  const onChange = useCallback(
    (deg: number) => {
      setSite({ ...useScene.getState().room.site, bearingDeg: deg });
    },
    [setSite],
  );

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
      <Dial bearingDeg={bearingDeg} sunAzimuthDeg={sunAzimuthDeg} onChange={onChange} />
      {/* `minWidth: 0` on the text and `flexShrink: 0` on the dial: the dial is a
          fixed 76px of SVG and the sentence is the part that should reflow, which
          is the opposite of what a flex row does by default. */}
      <div style={{ flex: 1, minWidth: 0, fontSize: 10.5, color: 'var(--ink-3)', lineHeight: 1.4 }}>
        Drag to point at north — the room stays put and the compass turns around
        it.
        {/* Only claimed while there IS a sun on the rim. In a studio mood the
            sentence would be pointing at nothing. */}
        {sunAzimuthDeg !== null && ' The dot is where this mood’s light comes from.'}
      </div>
    </div>
  );
}

/** A real slider (role, value, arrow keys) because pointing by dragging is a
 *  mouse gesture and this is the only control for the fact.
 *
 *  A compass bearing typed into a box is a number about the world; this is the
 *  same number as a picture of the room, with north on the rim. */
function Dial({
  bearingDeg,
  sunAzimuthDeg,
  onChange,
}: {
  bearingDeg: number;
  /** Null in a studio mood, which has no direction. */
  sunAzimuthDeg: number | null;
  onChange: (deg: number) => void;
}) {
  const ref = useRef<SVGSVGElement>(null);
  const R = 34;
  const C = 38;

  /** Screen angle (clockwise from straight up) → a point in the dial. */
  const pt = (deg: number, r: number): [number, number] => {
    const a = (deg * Math.PI) / 180;
    return [C + r * Math.sin(a), C - r * Math.cos(a)];
  };

  // The plan is fixed and the compass turns around it, which is what someone
  // holding a phone in a room actually does. North therefore sits at MINUS the
  // bearing: a room whose north edge faces east has true north to its left.
  const northAt = -bearingDeg;
  // The sun sits at its own bearing MINUS the room's, for the same reason north
  // does: the compass turns, the room does not. So a southern sun in a room whose
  // north edge faces east appears on the room's west side — which is exactly the
  // rotation `sunDirection` applies to the key light, and the point of drawing it
  // here is that the two are visibly the same answer.
  const sunAt = sunAzimuthDeg === null ? null : sunAzimuthDeg - bearingDeg;

  const point = useCallback(
    (clientX: number, clientY: number) => {
      const box = ref.current?.getBoundingClientRect();
      if (!box) return;
      const dx = clientX - (box.left + box.width / 2);
      const dy = clientY - (box.top + box.height / 2);
      if (Math.abs(dx) < 2 && Math.abs(dy) < 2) return;
      const screenDeg = (Math.atan2(dx, -dy) * 180) / Math.PI;
      onChange(Math.round((((-screenDeg) % 360) + 360) % 360));
    },
    [onChange],
  );

  const [nx, ny] = pt(northAt, R - 7);

  return (
    <div style={{ flexShrink: 0, textAlign: 'center' }}>
      <svg
        ref={ref}
        width={C * 2}
        height={C * 2}
        role="slider"
        tabIndex={0}
        aria-label="Which way the room faces"
        aria-valuemin={0}
        aria-valuemax={359}
        aria-valuenow={Math.round(bearingDeg)}
        // What the number IS: the compass bearing the plan's top edge faces. It
        // used to be read out as "north is N degrees from the top of the plan",
        // which is the same figure with the rotation running the other way —
        // north sits at MINUS the bearing, which is why the needle is drawn at
        // `-bearingDeg`.
        aria-valuetext={'The top of the plan faces ' + Math.round(bearingDeg) + ' degrees, ' + compassName(bearingDeg)}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          point(e.clientX, e.clientY);
        }}
        onPointerMove={(e) => {
          if (e.buttons === 1) point(e.clientX, e.clientY);
        }}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 15 : 5;
          if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
            e.preventDefault();
            onChange((bearingDeg - step + 360) % 360);
          } else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
            e.preventDefault();
            onChange((bearingDeg + step) % 360);
          }
        }}
        style={{ cursor: 'grab', touchAction: 'none', borderRadius: '50%', outlineOffset: 2 }}
      >
        <circle cx={C} cy={C} r={R} fill="var(--paper-2)" stroke="var(--edge)" strokeWidth={1} />
        {/* The room itself, square to the panel — the thing the compass is about. */}
        <rect x={C - 9} y={C - 7} width={18} height={14} rx={2} fill="var(--paper)" stroke="var(--ink-3)" strokeWidth={1} />
        {[0, 90, 180, 270].map((d) => {
          const [x1, y1] = pt(d, R - 2);
          const [x2, y2] = pt(d, R - 5);
          return <line key={d} x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--hairline-strong)" strokeWidth={1} />;
        })}
        {/* North needle. */}
        <line x1={C} y1={C} x2={nx} y2={ny} stroke="var(--ink)" strokeWidth={2} strokeLinecap="round" />
        <circle cx={nx} cy={ny} r={7} fill="var(--ink)" />
        <text
          x={nx}
          y={ny + 3.2}
          textAnchor="middle"
          fontFamily="var(--font-sans)"
          fontSize="9"
          fontWeight="700"
          fill="var(--paper)"
        >
          N
        </text>
        {/* Where this mood's light comes from. `--accent` because it is the one
            thing on the dial that is not structure, and it is `aria-hidden` only
            in the sense that the whole SVG speaks through `aria-valuetext` — see
            the note there. */}
        {sunAt !== null &&
          (() => {
            const [sx, sy] = pt(sunAt, R - 10);
            return <circle cx={sx} cy={sy} r={5} fill="var(--accent)" stroke="var(--accent-text)" strokeWidth={1.5} />;
          })()}
      </svg>
      <div style={{ fontSize: 10, color: 'var(--ink-3)', marginTop: 2 }}>
        <Icon name="compass" size={9} style={{ display: 'inline-block', verticalAlign: '-1px', marginRight: 3 }} />
        <span className="mono">{Math.round(bearingDeg)}°</span>
      </div>
    </div>
  );
}

'use client';

// The day, over the canvas: a rainbow of dashes the sun rides along, with the
// time under it. Grab the sun, or press anywhere on the arc, and drag to scrub the
// day. On a narrow canvas — a phone, or a desktop one with the Library open — the
// same track lies flat and is a plain slider.
//
// It sits in the canvas's top-centre slot, under the tool row (see `CanvasDay` in
// `CanvasChrome`), and it does NOT move with the camera. It used to: the arc was the
// sun's real path round the room, drawn in 3D, and a control that moves every time
// the view does is one you have to find again — pinned to the frame's edge at dawn,
// under the toolbar at noon, and on a phone wandering across the furniture. The
// light still comes from the real direction, so orbiting still shows which wall the
// morning comes through; the control just stays where the hand left it.
//
// Where the handle sits is `lib/sun-arc.ts`; what the hour MEANS for the light is
// `lib/lighting-moods.ts`. This file draws the one and turns a drag into the other.
//
// Interaction contract:
//   · the sun is a real slider (role, value text, arrow keys), because a drag is a
//     pointer gesture and this is a control for a fact;
//   · a drag holds `draggingId` for its length (`SUN_DRAG_ID`), which stops the
//     camera orbiting under it and makes the undo stack record the whole scrub as
//     ONE step rather than one per pointer move;
//   · by day the handle is the sun and the arc is the day; by night it is the moon
//     and the arc is the night. Crossing between them is the rail's Morning / Night
//     stops or the arrow keys, not a drag past the horizon — a gesture whose meaning
//     flips at an invisible point is one nobody can learn;
//   · it gives way to the furniture: gone while anything else is carried, quieter
//     while a piece is selected, back the moment you reach for it;
//   · at rest it is FOLDED: the sun (or the moon, or the cloud) alone at the arc's
//     crown, no arc and no clock. Reaching for it opens it — the pointer coming near
//     (a ring round the disc, wider than the disc), keyboard focus, or on a touch
//     screen a first tap, which opens and does nothing else, because a drag from the
//     crown would start the day at noon wherever the clock stood. The ring exists only
//     while folded: open, the sky under the arc is the room's to orbit, as it always
//     was. It folds again when the mouse leaves the arc's box, on a press anywhere
//     else, and when the keyboard leaves it — and never while the keyboard is still
//     on it, or the arrows would move a clock nobody can see. A finger lifting off
//     the glass is not leaving, so a touch drag does not fold it under the thumb.

import { useEffect, useRef, useState, type MouseEvent, type PointerEvent } from 'react';
import { SUN_DRAG_ID, useStudio } from '@/lib/store';
import { useScene } from '@/lib/scene-store';
import {
  DEFAULT_BEARING_DEG,
  dayFraction,
  formatClock,
  isDaytime,
  lightingAt,
  nightFraction,
  sunAt,
} from '@/lib/lighting-moods';
import { scrubHour, tAtX, trackFor, trackPath, trackPoint } from '@/lib/sun-arc';
import { playSound } from '@/lib/sound';
import { Icon } from '@/components/ui/Icon';

/** The handle's disc and the glow ring round it, in px. The track's ends are kept
 *  this far in, and its crown this far down, so the sun is whole at every hour. */
const DISC = 34;
const GLOW = 6;
const INSET = DISC / 2 + GLOW;
/** The time pill under the disc, and a breath above it. */
const PILL = 26;
/** The ring round the folded disc that counts as near, in px. */
const REACH = 64;
/** How far outside the arc's box the mouse may stray and still be on it, in px. */
const SLACK = 12;
/** How long the mouse may be off the control before it folds, in ms. */
const FOLD_DELAY_MS = 280;

/** Relative luminance of a `#rrggbb`, good enough to decide ink-or-paper. */
function isDark(hex: string): boolean {
  const n = parseInt(hex.slice(1), 16);
  const lum = 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
  return lum < 128;
}

export function SunArc() {
  const lighting = useStudio((s) => s.lighting);
  const hour = useStudio((s) => s.hour);
  const setHour = useStudio((s) => s.setHour);
  const setLighting = useStudio((s) => s.setLighting);
  const setDragging = useStudio((s) => s.setDragging);
  const bearingDeg = useScene((s) => s.room.site?.bearingDeg) ?? DEFAULT_BEARING_DEG;

  const overcast = lighting === 'overcast';
  const day = isDaytime(hour);

  // Giving way. Anything else being carried — a piece, a wall — and the sun is not
  // there at all, so it can neither catch the pointer nor sit over the size tags.
  // A piece selected and it quietens; reaching for it (hover, focus, a drag) brings
  // it back.
  const otherGesture = useStudio((s) => s.draggingId !== null && s.draggingId !== SUN_DRAG_ID);
  const pieceInHand = useStudio((s) => s.selection.length > 0 || s.selectedWall !== null);
  /** Reached for by a pointer: the mouse is over the arc's box, or a finger opened it. */
  const [near, setNear] = useState(false);
  /** The keyboard is on the sun. Apart from `near`, so neither can fold the other's. */
  const [focused, setFocused] = useState(false);
  /** Leaving the disc for the arc crosses a gap of sky, so the fold waits a breath. */
  const foldTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdOpen = () => {
    if (foldTimer.current) clearTimeout(foldTimer.current);
    foldTimer.current = null;
    setNear(true);
  };
  const foldSoon = () => {
    if (foldTimer.current) clearTimeout(foldTimer.current);
    foldTimer.current = setTimeout(() => {
      foldTimer.current = null;
      setNear(false);
    }, FOLD_DELAY_MS);
  };
  useEffect(() => () => {
    if (foldTimer.current) clearTimeout(foldTimer.current);
  }, []);

  /** Which half of the clock the drag started in, fixed for the gesture: a drag
   *  that reaches sunset exactly must not swap to the night's arc under the hand. */
  const phase = useRef<'day' | 'night'>('day');
  // THIS control's gesture, not merely "the clock is being scrubbed": the rail's day
  // track holds the same `draggingId` for its own drags.
  const [carrying, setCarrying] = useState(false);
  /** The gesture in flight: where it started, so Esc can put it back, and whether
   *  it has moved, so a click on the sun is not heard or treated as a scrub. */
  const gesture = useRef<{
    pointerId: number;
    target: Element;
    hour: number;
    lighting: typeof lighting;
    moved: boolean;
  } | null>(null);
  const half: 'day' | 'night' = carrying ? phase.current : day ? 'day' : 'night';

  // The width the track may have, measured: the slot is the canvas minus whatever
  // is docked on the right, and it decides between the arc and the flat slider.
  const slotRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState(0);
  useEffect(() => {
    const el = slotRef.current;
    if (!el) return;
    const measure = () => setAvailable(el.getBoundingClientRect().width);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const track = trackFor(available, INSET);

  const open = carrying || near || focused;
  const t = Math.min(1, Math.max(0, half === 'day' ? dayFraction(hour) : nightFraction(hour)));
  const [hx, hy] = trackPoint(track, t);
  // Folded, the sun waits at the crown: the one point of the track that is the same
  // whatever the hour, so the folded control never wanders.
  const [cx, cy] = trackPoint(track, 0.5);
  const [px, py] = open ? [hx, hy] : [cx, cy];
  const light = lightingAt(lighting, hour, bearingDeg);
  const dark = isDark(light.bg);

  function tAt(clientX: number): number {
    const box = boxRef.current?.getBoundingClientRect();
    return box ? tAtX(track, clientX - box.left) : t;
  }

  function begin(e: PointerEvent, jump: boolean) {
    // The primary button only. A right-press used to start a scrub, play the pick,
    // switch an overcast room to daylight — and then open the scene's menu for
    // whatever piece sat behind the handle.
    if (e.button !== 0 || gesture.current) return;
    e.preventDefault();
    e.stopPropagation();
    // A press on the folded sun opens it and is spent: the disc stands at the crown,
    // not at the hour, so a scrub from here would jump the day to noon.
    if (!open) {
      holdOpen();
      return;
    }
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    phase.current = day ? 'day' : 'night';
    // The gesture's flag first, so every write below lands inside ONE undo step
    // rather than the lighting switch being scheduled as its own.
    setDragging(SUN_DRAG_ID);
    setCarrying(true);
    gesture.current = { pointerId: e.pointerId, target, hour, lighting, moved: false };
    // A press on the track is a slider's press: the sun comes to it.
    if (jump) move(e);
  }

  function move(e: PointerEvent) {
    const g = gesture.current;
    if (!g || g.pointerId !== e.pointerId) return;
    if (!g.moved) {
      g.moved = true;
      // Grabbing the sun and MOVING it is asking for the sun: an overcast room goes
      // back to daylight rather than refusing the gesture. A plain click is not
      // asking, and changes nothing.
      if (overcast) setLighting('daylight');
      playSound('pick');
    }
    // The hour's detent, the air under the scrub and the dawn and dusk cues are
    // `SoundCues`' — they follow the clock whatever moves it.
    setHour(scrubHour(phase.current, tAt(e.clientX)));
  }

  function endGesture(heard: boolean) {
    const g = gesture.current;
    if (!g) return;
    gesture.current = null;
    setCarrying(false);
    if (g.target.hasPointerCapture?.(g.pointerId)) g.target.releasePointerCapture(g.pointerId);
    if (useStudio.getState().draggingId === SUN_DRAG_ID) setDragging(null);
    if (heard && g.moved) playSound('drop', { size: 0.2 });
  }

  // Esc mid-scrub puts the day back where the gesture found it, as it does for a
  // piece; captured on the window so it is the first thing to see the key and
  // nothing else also acts on it.
  useEffect(() => {
    if (!carrying) return;
    const onKey = (e: KeyboardEvent) => {
      const g = gesture.current;
      if (e.key !== 'Escape' || !g) return;
      e.preventDefault();
      e.stopPropagation();
      setHour(g.hour);
      setLighting(g.lighting);
      g.moved = false;
      endGesture(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carrying]);
  // Open to a pointer, it watches where the mouse goes: anywhere inside the arc's box
  // keeps it, sky included, without the sky catching a single press; out of the box it
  // folds a breath later. A press anywhere else folds it at once — the only way off it
  // a finger has.
  useEffect(() => {
    if (!near) return;
    const onMove = (e: globalThis.PointerEvent) => {
      if (e.pointerType !== 'mouse' || gesture.current) return;
      const r = boxRef.current?.getBoundingClientRect();
      const inside = !!r && e.clientX >= r.left - SLACK && e.clientX <= r.right + SLACK && e.clientY >= r.top - SLACK && e.clientY <= r.bottom + SLACK;
      if (inside) holdOpen();
      else if (!foldTimer.current) foldSoon();
    };
    const onDown = (e: globalThis.PointerEvent) => {
      if (slotRef.current?.contains(e.target as Node)) return;
      if (foldTimer.current) clearTimeout(foldTimer.current);
      foldTimer.current = null;
      setNear(false);
    };
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerdown', onDown, true);
    return () => {
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerdown', onDown, true);
    };
  }, [near]);
  // Unmounted mid-scrub (the tab switched, the room closed): `draggingId` must not
  // be left holding the sun, which would freeze the camera and the undo stack.
  useEffect(
    () => () => {
      if (gesture.current && useStudio.getState().draggingId === SUN_DRAG_ID) useStudio.getState().setDragging(null);
    },
    [],
  );

  const step = (dh: number) => {
    // Overcast is switched off by `onKeyDown`, and `SoundCues` answers that change
    // with its own chime; a tick on top of it would be two sounds for one key.
    setHour(hour + dh);
    if (!overcast) playSound('tick', { brightness: day ? sunAt(hour).elevationDeg / 60 : 0 });
  };

  const engaged = open;
  const quiet = pieceInHand && !engaged;
  const height = INSET + track.sag + DISC / 2 + PILL;
  // Arriving opens it. Leaving is the window's `pointermove` above, measured against
  // the arc's box rather than these elements: a finger or a pen lifting off the glass
  // reports a leave too, and the gap of sky between the disc and the arc is not away.
  const reach = { onPointerEnter: holdOpen };
  const gestureHandlers = {
    onPointerMove: move,
    onPointerUp: () => endGesture(true),
    onPointerCancel: () => endGesture(false),
    // The canvas answers clicks and menus from the last press it saw; the sun's
    // presses are its own.
    onClick: (e: MouseEvent) => e.stopPropagation(),
    onDoubleClick: (e: MouseEvent) => e.stopPropagation(),
    onContextMenu: (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
    },
  };

  const cls = [
    'sun-day',
    track.sag === 0 && 'sun-day--flat',
    dark && 'sun-day--on-dark',
    overcast && 'sun-day--muted',
    half === 'night' && 'sun-day--night',
    engaged && 'sun-day--engaged',
    !open && 'sun-day--folded',
    carrying && 'sun-day--carrying',
    quiet && 'sun-day--quiet',
    otherGesture && 'sun-day--away',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div ref={slotRef} className={cls} aria-hidden={otherGesture || undefined}>
      {available > 0 && (
        <div ref={boxRef} className="sun-day__box" style={{ width: track.width, height }}>
          <svg className="sun-day__svg" width={track.width} height={height} aria-hidden>
            <path className="sun-day__path" d={trackPath(track, 0, 1, INSET)} />
            {t > 0 && <path className="sun-day__travelled" d={trackPath(track, 0, t, INSET)} />}
            {/* The press target: the arc, fattened to a finger's width and
                invisible. Pointer events on the stroke only, so the sky inside the
                rainbow is still the room's to orbit. */}
            <path
              className="sun-day__hit"
              d={trackPath(track, 0, 1, INSET)}
              onPointerDown={(e) => begin(e, true)}
              {...gestureHandlers}
              {...reach}
            />
          </svg>
          {/* Near enough to open it: a ring round the folded disc, wider than the disc,
              so the arc opens as the pointer arrives rather than on contact. Folded
              only — open, it would sit on the sky the room orbits in. */}
          {!open && (
            <div
              className="sun-day__reach"
              aria-hidden
              style={{ left: cx - REACH / 2, top: INSET + cy - REACH / 2 }}
              onPointerDown={(e) => begin(e, false)}
              {...reach}
            />
          )}
          <div
            className="sun-day__handle"
            style={{ transform: `translate(${px - DISC / 2}px, ${INSET + py - DISC / 2}px)` }}
            role="slider"
            tabIndex={0}
            aria-label="Time of day"
            aria-valuemin={0}
            aria-valuemax={24}
            aria-valuenow={Math.round(hour * 100) / 100}
            aria-valuetext={`${formatClock(hour)}${overcast ? ', overcast' : day ? '' : ', night'}`}
            onPointerDown={(e) => begin(e, false)}
            {...gestureHandlers}
            {...reach}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            // Arrows move a quarter of an hour, Shift a whole one; Page a named
            // stop's worth. Home and End are the declared ends: the role is a
            // promise about the keys.
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
              // Not also a camera pan: `CameraRig`'s arrow keys listen on the window.
              e.stopPropagation();
              if (overcast) setLighting('daylight');
            }}
          >
            <span className="sun-day__body" aria-hidden>
              <Icon name={overcast ? 'cloud' : half === 'day' ? 'sun' : 'moon'} size={18} />
            </span>
            <span className="sun-day__time mono">{formatClock(hour)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

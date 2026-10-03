'use client';

// The day, over the canvas: a strip painted as the sky it scrubs, with the sun — or
// the moon — riding it in a pill beside the time. Grab the pill, or press anywhere on
// the strip, and drag to scrub the day.
//
// It sits in the canvas's top-centre slot, under the tool row (see `CanvasDay` in
// `CanvasChrome`), and it does NOT move with the camera: a control that moves every
// time the view does is one you have to find again. The light still comes from the
// real direction, so orbiting still shows which wall the morning comes through.
//
// Where the handle sits and how the strip is painted is `lib/day-strip.ts`; what the
// hour MEANS for the light is `lib/lighting-moods.ts`. This file draws the one and
// turns a drag into the other.
//
// Interaction contract:
//   · the pill is a real slider (role, value text, arrow keys), because a drag is a
//     pointer gesture and this is a control for a fact;
//   · a drag holds `draggingId` for its length (`SUN_DRAG_ID`), which stops the
//     camera orbiting under it and makes the undo stack record the whole scrub as
//     ONE step rather than one per pointer move;
//   · the strip is the WHOLE clock, so a drag can cross the horizon — and the place
//     it crosses is painted peach and rose on the strip, which is what makes that learnable.
//     The rainbow this replaced split the clock into a day half and a night half
//     because its horizon was invisible. Crossing morphs the sun into the moon (or
//     back) under the hand, and `SoundCues` answers with the dawn or dusk phrase;
//   · it gives way to the furniture: gone while anything else is carried, quieter
//     while a piece is selected, back the moment you reach for it;
//   · at rest it is FOLDED: the pill alone, centred, the strip drawn in behind it.
//     Reaching for it opens it — the pointer coming near (a ring round the pill,
//     wider than the pill), keyboard focus, or on a touch screen a first tap, which
//     opens and does nothing else, because the folded pill stands at the centre,
//     not at the hour, and a drag from there would start the day at noon. It folds
//     again when the mouse leaves the strip's box, on a press anywhere else, and when
//     the keyboard leaves it — and never while the keyboard is still on it, or the
//     arrows would move a clock nobody can see. A finger lifting off the glass is not
//     leaving, so a touch drag does not fold it under the thumb.

import { useEffect, useId, useRef, useState, type FocusEvent, type MouseEvent, type PointerEvent } from 'react';
import { SUN_DRAG_ID, useStudio } from '@/lib/store';
import { useScene } from '@/lib/scene-store';
import { DEFAULT_BEARING_DEG, compassName, formatClock, isDaytime, lightingAt, sunAt, turnedBearing } from '@/lib/lighting-moods';
import { isAperture } from '@/lib/apertures';
import { hourT, scrubHour, skyGradient, stripFor, stripX, tAtX } from '@/lib/day-strip';
import { playSound } from '@/lib/sound';
import { Icon } from '@/components/ui/Icon';
import { DAY_ROW_H } from './CanvasChrome';

/** The pill's width and height, in px: a glyph and a five-character clock. */
const PILL_W = 86;
const PILL_H = DAY_ROW_H;
/** The strip's ends are kept this far in, so the pill is whole at midnight. */
const INSET = PILL_W / 2;
/** How far round the folded pill counts as near, in px. */
const REACH = 22;
/** How far outside the strip's box the mouse may stray and still be on it, in px. */
const SLACK = 12;
/** How long the mouse may be off the control before it folds, in ms. */
const FOLD_DELAY_MS = 280;

/** Relative luminance of a `#rrggbb`, good enough to decide ink-or-paper. */
function isDark(hex: string): boolean {
  const n = parseInt(hex.slice(1), 16);
  const lum = 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
  return lum < 128;
}

/** One glyph that is the sun by day and the moon by night, and moves between them
 *  rather than swapping: the rays draw in and turn away, the disc swells, and a
 *  shadow slides across it to carve the crescent. Every part is in the drawing at
 *  every hour, so CSS can animate the change (`.celestial` in globals.css). */
function Celestial({ night }: { night: boolean }) {
  const mask = `celestial-${useId().replace(/:/g, '')}`;
  return (
    <svg className={`celestial${night ? ' celestial--night' : ''}`} viewBox="0 0 24 24" width="20" height="20" aria-hidden>
      <defs>
        <mask id={mask}>
          <rect width="24" height="24" fill="white" />
          <circle className="celestial__bite" cx="16.5" cy="8" r="6.5" fill="black" />
        </mask>
      </defs>
      <g className="celestial__rays" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        {Array.from({ length: 8 }, (_, i) => {
          const a = (i * Math.PI) / 4;
          const [s, c] = [Math.sin(a), Math.cos(a)];
          return <line key={i} x1={12 + 8 * c} y1={12 + 8 * s} x2={12 + 10.5 * c} y2={12 + 10.5 * s} />;
        })}
      </g>
      <g mask={`url(#${mask})`}>
        <circle className="celestial__disc" cx="12" cy="12" r="5" fill="currentColor" />
      </g>
    </svg>
  );
}

export function DayStrip() {
  const lighting = useStudio((s) => s.lighting);
  const hour = useStudio((s) => s.hour);
  const setHour = useStudio((s) => s.setHour);
  const setLighting = useStudio((s) => s.setLighting);
  const setDragging = useStudio((s) => s.setDragging);
  const bearingDeg = useScene((s) => s.room.site?.bearingDeg) ?? DEFAULT_BEARING_DEG;
  const setSite = useScene((s) => s.setSite);
  // Whether the sun has anything to shine through. The room is a closed shell, so a
  // sealed room is lit by sky and lamps alone (`components/three/RoomShell.tsx`);
  // said here, beside the control that raises the question, rather than leaving
  // someone to wonder why moving the sun does nothing. The predicate is
  // `lib/apertures.ts`'s, so the sentence cannot disagree with the holes it cuts.
  const sunHasNoWayIn = useScene((s) => lighting === 'daylight' && !s.parts.some(isAperture));

  const overcast = lighting === 'overcast';
  const day = isDaytime(hour);

  // Giving way. Anything else being carried — a piece, a wall — and the day is not
  // there at all, so it can neither catch the pointer nor sit over the size tags.
  // A piece selected and it quietens; reaching for it (hover, focus, a drag) brings
  // it back.
  const otherGesture = useStudio((s) => s.draggingId !== null && s.draggingId !== SUN_DRAG_ID);
  const pieceInHand = useStudio((s) => s.selection.length > 0 || s.selectedWall !== null);
  /** Reached for by a pointer: the mouse is over the strip's box, or a finger opened it. */
  const [near, setNear] = useState(false);
  /** The keyboard is on the pill. Apart from `near`, so neither can fold the other's. */
  const [focused, setFocused] = useState(false);
  /** Leaving the pill for the strip can cross a sliver of canvas, so the fold waits a breath. */
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

  // THIS control's gesture, not merely "the clock is being scrubbed": the rail's day
  // track holds the same `draggingId` for its own drags.
  const [carrying, setCarrying] = useState(false);
  /** The gesture in flight: where it started, so Esc can put it back, and whether
   *  it has moved, so a click on the pill is not heard or treated as a scrub. */
  const gesture = useRef<{
    pointerId: number;
    target: Element;
    hour: number;
    lighting: typeof lighting;
    moved: boolean;
  } | null>(null);

  // The width the strip may have, measured: the slot is the canvas minus whatever is
  // docked on the right.
  const slotRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const extrasRef = useRef<HTMLDivElement>(null);
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
  const strip = stripFor(available, INSET);
  // The strip collapsing mid-drag (the slot measured 0) unmounts the box that holds the
  // capture; end the gesture rather than rely on the browser reporting it.
  useEffect(() => {
    if (available === 0 && gesture.current) endGesture(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [available]);

  const open = carrying || near || focused;
  // Focus moving from the slider into the extras row (or between its buttons) is still
  // focus on the strip: folding on every blur removed the row before Tab could land in
  // it, so the keyboard could never reach Overcast or the turn buttons.
  const leave = (e: FocusEvent) => {
    const to = e.relatedTarget as Node | null;
    if (to && slotRef.current?.contains(to)) return;
    setFocused(false);
  };
  // Folded, the pill waits at the centre: the one place that is the same whatever the
  // hour, so the folded control never wanders.
  const px = open ? stripX(strip, hourT(hour)) : strip.width / 2;
  const light = lightingAt(lighting, hour, bearingDeg);
  const dark = isDark(light.bg);

  function tAt(clientX: number): number {
    const box = boxRef.current?.getBoundingClientRect();
    return box ? tAtX(strip, clientX - box.left) : hourT(hour);
  }

  function begin(e: PointerEvent, jump: boolean) {
    // The primary button only. A right-press used to start a scrub, play the pick,
    // switch an overcast room to daylight — and then open the scene's menu for
    // whatever piece sat behind the handle.
    if (e.button !== 0 || gesture.current) return;
    e.preventDefault();
    e.stopPropagation();
    // A press on the folded pill opens it and is spent: it stands at the centre, not
    // at the hour, so a scrub from here would jump the day to noon.
    if (!open) {
      holdOpen();
      return;
    }
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    // The gesture's flag first, so every write below lands inside ONE undo step
    // rather than the lighting switch being scheduled as its own.
    setDragging(SUN_DRAG_ID);
    setCarrying(true);
    gesture.current = { pointerId: e.pointerId, target, hour, lighting, moved: false };
    // A press on the strip is a slider's press: the pill comes to it.
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
    // The hour's detent, the air under the scrub and the dawn and dusk phrases are
    // `SoundCues`' — they follow the clock whatever moves it.
    setHour(scrubHour(tAt(e.clientX)));
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
  // Open to a pointer, it watches where the mouse goes: anywhere inside the strip's
  // box keeps it; out of the box it folds a breath later. A press anywhere else folds
  // it at once — the only way off it a finger has.
  useEffect(() => {
    if (!near) return;
    const onMove = (e: globalThis.PointerEvent) => {
      if (e.pointerType !== 'mouse' || gesture.current) return;
      const within = (el: HTMLElement | null) => {
        const r = el?.getBoundingClientRect();
        return !!r && e.clientX >= r.left - SLACK && e.clientX <= r.right + SLACK && e.clientY >= r.top - SLACK && e.clientY <= r.bottom + SLACK;
      };
      const inside = within(boxRef.current) || within(extrasRef.current);
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
    // Clamped to the clock's ends, not wrapped: the pill at 23:59 pressing right would
    // otherwise teleport across the whole strip, playing a dawn phrase for a nudge.
    setHour(Math.min(23.99, Math.max(0, hour + dh)));
    if (!overcast) playSound('tick', { brightness: day ? sunAt(hour).elevationDeg / 60 : 0 });
  };

  const quiet = pieceInHand && !open;
  // Arriving opens it. Leaving is the window's `pointermove` above, measured against
  // the strip's box rather than these elements: a finger or a pen lifting off the
  // glass reports a leave too.
  // A finger does not hover: its "enter" arrives with the press itself, so honouring it
  // opened the pill an event before `begin` looked, and the first touch started a scrub
  // from the folded pill's centre — the jump to noon the first-tap rule exists to stop.
  const reach = { onPointerEnter: (e: PointerEvent) => { if (e.pointerType !== 'touch') holdOpen(); } };
  const gestureHandlers = {
    onPointerMove: move,
    onPointerUp: () => endGesture(true),
    onPointerCancel: () => endGesture(false),
    // Capture taken away with no up or cancel — the element unmounted under the hand, the
    // page lost the pointer — would leave `SUN_DRAG_ID` held: a frozen camera and one
    // undo step that never closes. A normal release lands here too, finding it done.
    onLostPointerCapture: () => endGesture(false),
    // The canvas answers clicks and menus from the last press it saw; the day's
    // presses are its own.
    onClick: (e: MouseEvent) => e.stopPropagation(),
    onDoubleClick: (e: MouseEvent) => e.stopPropagation(),
    onContextMenu: (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
    },
  };

  const cls = [
    'day-strip',
    dark && 'day-strip--on-dark',
    overcast && 'day-strip--muted',
    !day && 'day-strip--night',
    open ? 'day-strip--open' : 'day-strip--folded',
    carrying && 'day-strip--carrying',
    quiet && 'day-strip--quiet',
    otherGesture && 'day-strip--away',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div ref={slotRef} className={cls} aria-hidden={otherGesture || undefined}>
      {available > 0 && (
        <div ref={boxRef} className="day-strip__box" style={{ width: strip.width, height: PILL_H }}>
          {/* The sky. Folded, it is drawn in to the pill's own width behind it, so
              opening reads as the strip growing out of the pill. */}
          <div
            className="day-strip__sky"
            aria-hidden
            style={{
              background: skyGradient(),
              clipPath: open ? 'inset(0 0 round 999px)' : `inset(0 calc(50% - ${PILL_W / 2}px) round 999px)`,
            }}
          />
          {/* The press target: the whole strip, open only — folded, the canvas
              either side of the pill is the room's. */}
          <div className="day-strip__hit" aria-hidden onPointerDown={(e) => begin(e, true)} {...gestureHandlers} {...reach} />
          {!open && (
            <div
              className="day-strip__reach"
              aria-hidden
              style={{ left: strip.width / 2 - PILL_W / 2 - REACH, top: -REACH, width: PILL_W + REACH * 2, height: PILL_H + REACH * 2 }}
              onPointerDown={(e) => begin(e, false)}
              {...reach}
            />
          )}
          <div
            className="day-strip__handle"
            style={{ width: PILL_W, height: PILL_H, transform: `translateX(${px - PILL_W / 2}px)` }}
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
            onBlur={leave}
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
            <span className="day-strip__glyph" aria-hidden>
              {overcast ? <Icon name="cloud" size={18} /> : <Celestial night={!day} />}
            </span>
            <span className="day-strip__time mono">{formatClock(hour)}</span>
          </div>
          {/* What the strip cannot say by position: flat light, which way the room
              faces (the one input the sun still takes from the user — it changes WHICH
              WALL the light comes through), and why the sun might do nothing. Under
              the strip, in the same box of attention: the mouse may travel to it and
              the keyboard may tab to it without the strip folding away. */}
          {open && (
            <div
              ref={extrasRef}
              className="day-strip__extras"
              onPointerEnter={(e) => { if (e.pointerType !== 'touch') holdOpen(); }}
              onFocus={() => setFocused(true)}
              onBlur={leave}
            >
              <div className="day-strip__tools">
                <button
                  type="button"
                  className="day-strip__tool"
                  aria-pressed={overcast}
                  onClick={() => setLighting(overcast ? 'daylight' : 'overcast')}
                >
                  <Icon name="cloud" size={13} />
                  <span>Overcast</span>
                </button>
                <span className="day-strip__facing">
                  <button type="button" className="icon-btn" aria-label="Turn the room anticlockwise" onClick={() => setSite({ ...useScene.getState().room.site, bearingDeg: turnedBearing(bearingDeg, -1) })}>
                    <Icon name="rotate-ccw" size={12} />
                  </button>
                  <span className="t-micro" aria-live="polite" title="Which way the top of the plan faces">Plan top faces {compassName(bearingDeg)}</span>
                  <button type="button" className="icon-btn" aria-label="Turn the room clockwise" onClick={() => setSite({ ...useScene.getState().room.site, bearingDeg: turnedBearing(bearingDeg, 1) })}>
                    <Icon name="rotate-cw" size={12} />
                  </button>
                </span>
              </div>
              {sunHasNoWayIn && (
                <p className="t-micro day-strip__hint">No window or door, so no sunlight gets in. Add one from the Library.</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

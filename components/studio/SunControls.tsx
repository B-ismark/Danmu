'use client';

// The sun mood's controls — date, time and where the room is.
//
// This used to be two bare `<input type="range">`s ("Time · 15:00" over 0…1425,
// "Date · 21 Mar" over 1…365) and three numeric boxes labelled Lat / Lon /
// Facing. Every one of those asks the user to convert: a number of minutes into a
// time of day, a day-of-year into a season, and a compass bearing into "which way
// my window points". The information was all there and none of it was legible.
//
// It is the same three facts, said the way the room says everything else:
//
//   · **The day, drawn.** The sun's altitude across 24 hours as a curve, with
//     night shaded and sunrise/sunset marked — computed from `lib/solar`, so the
//     graph is the same arithmetic that lights the scene. Scrubbing is dragging
//     along it. Presets (Now, Sunrise, Noon, Golden hour, Sunset) are the times
//     someone actually wants, and they are REAL times for this place and date, not
//     fixed clock hours.
//   · **The date, as months.** A sun path shifts slowly through a month and a lot
//     through a year, so twelve buttons carry every meaningful answer and a
//     365-step slider carried mostly noise.
//   · **North, as a compass.** The bearing is now a dial you point, with the room
//     drawn in the middle and the sun shown where it actually is relative to it.
//
// Nothing here is derived from a photo. EXIF carries GPS coordinates and
// `normalizePhoto` deliberately strips them before a photo is even stored, so the
// place is asked for openly or it is the default — and the default is on screen
// rather than hidden.
//
// Asked for openly means the device may answer, on a press: `lib/geolocate.ts`
// fills the coordinates (coarsened to ~11 km) and `lib/compass.ts` reads the
// bearing off the phone's magnetometer. Between them, the three facts nobody knows
// about their own living room — latitude, longitude, and which way it points — stop
// being a quiz. Both stay editable afterwards, and neither is ever asked for
// automatically: an unprompted permission dialog is the fastest way to be denied
// one permanently.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStudio } from '@/lib/store';
import { useScene } from '@/lib/scene-store';
import { sunPosition, localInstant, daysInYear } from '@/lib/solar';
import { requestLocation, geoFailureMessage } from '@/lib/geolocate';
import { readCompass, compassFailureMessage, SHAKY_SPREAD_DEG } from '@/lib/compass';
import type { Site } from '@/lib/storage';
import { NumberField } from '@/components/ui/NumberField';
import { Icon } from '@/components/ui/Icon';

/** Where the sun is asked about before the room has a site. Mirrors Room.tsx —
 *  the panel has to show the same numbers the scene is lit by, or the fields read
 *  as blank while the room is plainly lit from somewhere. */
const DEFAULT_SITE = { lat: 40, lon: 0, bearingDeg: 0 };

/** Minutes between samples of the day's sun path. 10 draws a smooth curve at this
 *  size (145 evaluations, memoised per date + place) and puts sunrise within ten
 *  minutes before the bisection below refines it to one. */
const SAMPLE_STEP = 10;

/** The graph's own coordinate space, NOT a pixel width — the `<svg>` is
 *  `width: 100%`. It was both at once for a while, because the popover this used
 *  to live in had a content box of exactly 272px, and that coincidence is what
 *  made a fixed `viewBox` look like it was doing something. The rail it lives in
 *  now is narrower and clamps, so the two numbers have come apart; see the
 *  `preserveAspectRatio` note at the `<svg>`. */
const GRAPH_W = 272;
const GRAPH_H = 64;
/** Baseline of the horizon inside the graph. Above it is daylight, below it is a
 *  shallow well — the sun goes to -60° at night and drawing that to scale would
 *  spend three quarters of the box on something with nothing in it. */
const HORIZON_Y = 44;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];

function clockLabel(minutes: number): string {
  const m = Math.max(0, Math.min(1439, Math.round(minutes)));
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** "south-west" for 213°. Eight points, because sixteen would be precision the
 *  sentence around it does not have. */
function compassName(deg: number): string {
  return COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}

function monthOfYearDay(dayOfYear: number, year: number): number {
  const d = new Date(year, 0, 1);
  d.setDate(dayOfYear);
  return d.getMonth();
}

/** Day-of-year for the middle of a month — the date a month button means. */
function midMonthDay(month: number, year: number): number {
  const d = new Date(year, month, 15);
  const jan1 = new Date(year, 0, 1);
  return Math.round((d.getTime() - jan1.getTime()) / 86400000) + 1;
}

function dateLabel(dayOfYear: number, year: number): string {
  const d = new Date(year, 0, 1);
  d.setDate(dayOfYear);
  return d.toLocaleDateString(undefined, { month: 'long', day: 'numeric' });
}

type DayPath = {
  /** altitude in degrees, one per SAMPLE_STEP minutes from 00:00 to 24:00 */
  alt: number[];
  sunrise: number | null;
  sunset: number | null;
  /** minute of the day's highest sun — solar noon, which is not 12:00 */
  noon: number;
  maxAlt: number;
};

/** The whole day at once: altitude samples, the two horizon crossings, and the
 *  peak. Everything the graph draws and every preset the chips offer comes from
 *  this one pass, so the picture and the buttons can never disagree. */
function computeDayPath(dayOfYear: number, lat: number, lon: number, year: number): DayPath {
  const alt: number[] = [];
  for (let m = 0; m <= 1440; m += SAMPLE_STEP) {
    alt.push(sunPosition(localInstant(dayOfYear, m, year), lat, lon).altitudeDeg);
  }

  const altAt = (m: number) => sunPosition(localInstant(dayOfYear, m, year), lat, lon).altitudeDeg;

  /** Bisect a bracketed horizon crossing down to the minute. */
  function refine(loMin: number, hiMin: number): number {
    let lo = loMin;
    let hi = hiMin;
    const rising = altAt(lo) < 0;
    while (hi - lo > 1) {
      const mid = Math.round((lo + hi) / 2);
      const up = altAt(mid) > 0;
      if (up === rising) hi = mid;
      else lo = mid;
    }
    return hi;
  }

  let sunrise: number | null = null;
  let sunset: number | null = null;
  for (let i = 0; i < alt.length - 1; i++) {
    const a = alt[i];
    const b = alt[i + 1];
    if (a <= 0 && b > 0 && sunrise === null) sunrise = refine(i * SAMPLE_STEP, (i + 1) * SAMPLE_STEP);
    if (a > 0 && b <= 0) sunset = refine(i * SAMPLE_STEP, (i + 1) * SAMPLE_STEP);
  }

  let peak = 0;
  for (let i = 1; i < alt.length; i++) if (alt[i] > alt[peak]) peak = i;
  // Refine the peak against the minute, not the ten-minute grid: "Noon" is the
  // one preset a user will compare against a clock.
  let noon = peak * SAMPLE_STEP;
  let maxAlt = alt[peak];
  for (let m = Math.max(0, noon - SAMPLE_STEP); m <= Math.min(1439, noon + SAMPLE_STEP); m++) {
    const a = altAt(m);
    if (a > maxAlt) {
      maxAlt = a;
      noon = m;
    }
  }

  return { alt, sunrise, sunset, noon, maxAlt };
}

const x = (minutes: number) => (minutes / 1440) * GRAPH_W;
const y = (altDeg: number) =>
  altDeg >= 0
    ? HORIZON_Y - (Math.min(90, altDeg) / 90) * (HORIZON_Y - 4)
    : HORIZON_Y + Math.min(GRAPH_H - HORIZON_Y - 2, (-altDeg / 90) * 56);

export function SunControls() {
  const sunMinutes = useStudio((s) => s.sunMinutes);
  const setSunMinutes = useStudio((s) => s.setSunMinutes);
  const sunDayOfYear = useStudio((s) => s.sunDayOfYear);
  const setSunDayOfYear = useStudio((s) => s.setSunDayOfYear);
  const sunLive = useStudio((s) => s.sunLive);
  const setSunLive = useStudio((s) => s.setSunLive);
  const site = useScene((s) => s.room.site);
  const setSite = useScene((s) => s.setSite);
  const s = site ?? DEFAULT_SITE;

  // One year for the whole panel: `localInstant` defaults to the current one, and
  // a label built against a different year than the light is the exact bug
  // lib/solar's calendar bridge exists to prevent.
  const year = new Date().getFullYear();
  const day = Math.min(daysInYear(year), sunDayOfYear);

  const path = useMemo(() => computeDayPath(day, s.lat, s.lon, year), [day, s.lat, s.lon, year]);
  const pos = useMemo(
    () => sunPosition(localInstant(day, sunMinutes, year), s.lat, s.lon),
    [day, sunMinutes, s.lat, s.lon, year],
  );
  const up = pos.altitudeDeg > 0;

  const month = monthOfYearDay(day, year);

  // The device can answer two of the three facts below — where it is and which way
  // it is pointing. Both are permission prompts, both report into one status line,
  // and `alive` guards both: this panel lives in a popover that closes on a click
  // anywhere else, and a permission dialog is exactly when someone clicks elsewhere,
  // so the request routinely outlives the component.
  const [busy, setBusy] = useState<'geo' | 'compass' | null>(null);
  const [note, setNote] = useState<{ text: string; bad: boolean } | null>(null);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  /** Merge one field into the site as it is NOW, not as it was when the button was
   *  pressed.
   *
   *  Both reads below sit behind an await that can last many seconds — a first-time
   *  permission dialog, or 1.4s of sampling — and the panel stays live throughout.
   *  Spreading the `s` captured at press time meant tapping "Use my location", then
   *  aiming the dial while the dialog was open, then allowing it: the fix landed
   *  carrying the OLD bearing and silently threw the new one away. */
  const patchSite = useCallback((patch: Partial<Site>) => {
    setSite({ ...(useScene.getState().room.site ?? DEFAULT_SITE), ...patch });
  }, [setSite]);

  const locate = useCallback(async () => {
    setBusy('geo');
    setNote(null);
    const r = await requestLocation();
    if (!alive.current) return;
    setBusy(null);
    if (!r.ok) {
      setNote({ text: geoFailureMessage(r.failure), bad: true });
      return;
    }
    patchSite({ lat: r.lat, lon: r.lon });
    setNote({ text: 'From your device, rounded to about 11 km — all the sun needs.', bad: false });
  }, [patchSite]);

  const readBearing = useCallback(async () => {
    setBusy('compass');
    setNote({ text: 'Hold the phone level, top edge at the plan’s top wall…', bad: false });
    // Called with no await before it: iOS ties its motion permission to the tap.
    const r = await readCompass();
    if (!alive.current) return;
    setBusy(null);
    if (!r.ok) {
      setNote({ text: compassFailureMessage(r.failure), bad: true });
      return;
    }
    patchSite({ bearingDeg: r.bearingDeg });
    // The uncertainty is reported, not hidden: a bearing read beside a radiator is
    // tens of degrees out and looks exactly like a good one on the dial.
    //
    // Both terms count, and the worse one decides. Jitter alone misses the case that
    // matters most — a phone can sit perfectly still and be steadily wrong near
    // metal, which is precisely what iOS's own accuracy figure is reporting when it
    // gives one.
    const uncertainty = Math.max(r.spreadDeg, r.accuracyDeg ?? 0);
    const shaky = uncertainty > SHAKY_SPREAD_DEG;
    setNote({
      text: shaky
        ? `Set to ${r.bearingDeg}°, but the reading is only good to ±${uncertainty}° — move away from metal and try again.`
        : `Set to ${r.bearingDeg}° from your compass (±${uncertainty}°).`,
      bad: shaky,
    });
  }, [patchSite]);

  // Real events for this place and date, not clock hours dressed up as them. In
  // the polar cases there is no sunrise to offer, so the row says what it can.
  const presets: Array<{ label: string; minutes: number; title: string }> = [];
  if (path.sunrise !== null) presets.push({ label: 'Sunrise', minutes: path.sunrise, title: `Sun-up · ${clockLabel(path.sunrise)}` });
  presets.push({ label: 'Noon', minutes: path.noon, title: `The sun's highest point today · ${clockLabel(path.noon)}` });
  if (path.sunset !== null) {
    presets.push({ label: 'Golden', minutes: Math.max(0, path.sunset - 50), title: `Low, warm light before sunset · ${clockLabel(Math.max(0, path.sunset - 50))}` });
    presets.push({ label: 'Sunset', minutes: path.sunset, title: `Sun-down · ${clockLabel(path.sunset)}` });
  }

  return (
    <div>
      {/* Reading line first: the answer, then the controls that change it. */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
        <span className="mono" style={{ fontSize: 19, fontWeight: 700, color: 'var(--ink)', letterSpacing: '-0.02em' }}>
          {clockLabel(sunMinutes)}
        </span>
        <span style={{ fontSize: 11, color: up ? 'var(--ink-2)' : 'var(--warn-text)', lineHeight: 1.3, flex: 1 }}>
          {up ? (
            <>
              <span className="mono">{Math.round(pos.altitudeDeg)}°</span> up, in the {compassName(pos.azimuthDeg)}
            </>
          ) : (
            <>below the horizon — sky light only</>
          )}
        </span>
        {/* Pins the moment to the device clock and keeps it there — the answer to
            "what does this room look like right now". Scrubbing anything below
            unpins it, which the store enforces rather than this panel. */}
        <button
          type="button"
          onClick={() => setSunLive(!sunLive)}
          aria-pressed={sunLive}
          className={`ds-chip${sunLive ? ' ds-chip--accent' : ''}`}
          title={
            sunLive
              ? 'Following your device clock — scrub or pick a month to stop'
              : 'Show the sun as it is right now, and keep following the clock'
          }
          style={{
            cursor: 'pointer',
            height: 24,
            fontSize: 10.5,
            fontWeight: 700,
            padding: '0 8px',
            gap: 4,
            borderColor: sunLive ? 'var(--accent-text)' : 'var(--edge)',
            background: sunLive ? 'var(--accent-tint)' : 'var(--paper)',
          }}
        >
          <Icon name="clock" size={11} />
          Now
        </button>
      </div>

      <DayGraph path={path} minutes={sunMinutes} onChange={setSunMinutes} />

      <div style={{ display: 'flex', gap: 4, marginTop: 8, flexWrap: 'wrap' }}>
        {presets.map((p) => {
          // "On" within a couple of minutes: the chip sets a computed instant, and
          // demanding an exact match would leave it looking inert right after a click.
          const on = Math.abs(sunMinutes - p.minutes) <= 2;
          return (
            <button
              key={p.label}
              onClick={() => setSunMinutes(p.minutes)}
              aria-pressed={on}
              title={p.title}
              className={`ds-chip${on ? ' ds-chip--accent' : ''}`}
              style={{
                cursor: 'pointer',
                height: 24,
                fontSize: 10.5,
                fontWeight: 700,
                padding: '0 8px',
                borderColor: on ? 'var(--accent-text)' : 'var(--edge)',
                background: on ? 'var(--accent-tint)' : 'var(--paper)',
              }}
            >
              {p.label}
            </button>
          );
        })}
        {path.sunrise === null && path.sunset === null && (
          <span style={{ fontSize: 10.5, color: 'var(--warn-text)', lineHeight: 1.4 }}>
            {path.maxAlt > 0 ? 'The sun never sets here on this date.' : 'The sun never rises here on this date.'}
          </span>
        )}
      </div>

      <div style={{ height: 1, background: 'var(--hairline)', margin: '12px 0 10px' }} />

      <div className="ds-label" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <span>Date</span>
        <span style={{ fontWeight: 600, color: 'var(--ink-2)' }}>{dateLabel(day, year)}</span>
      </div>
      <div role="group" aria-label="Month" style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 2 }}>
        {MONTHS.map((label, i) => {
          const on = i === month;
          return (
            <button
              key={label}
              onClick={() => setSunDayOfYear(midMonthDay(i, year))}
              aria-pressed={on}
              aria-label={label}
              title={`Mid-${label}`}
              style={{
                height: 26,
                minWidth: 0,
                padding: 0,
                borderRadius: 'var(--r-1)',
                border: `1px solid ${on ? 'var(--accent-text)' : 'transparent'}`,
                background: on ? 'var(--accent-tint)' : 'var(--paper-2)',
                color: on ? 'var(--accent-text)' : 'var(--ink-2)',
                fontFamily: 'var(--font-sans)',
                fontSize: 10,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              {label[0]}
            </button>
          );
        })}
      </div>

      <div style={{ height: 1, background: 'var(--hairline)', margin: '12px 0 10px' }} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span className="ds-label" style={{ flex: 1 }}>Where the room is</span>
        {/* Opt-in, on a press, never on mount: a permission prompt nobody asked for
            is the fastest way to be permanently denied one. The bearing is left
            alone — a fix says where the room is, not which way it points, and
            overwriting a dial the user has already aimed would be a guess. */}
        <button
          type="button"
          onClick={locate}
          disabled={busy !== null}
          className="ds-chip"
          title="Fill in latitude and longitude from your device, rounded to about 11 km"
          style={{
            cursor: busy ? 'progress' : 'pointer',
            height: 24,
            fontSize: 10.5,
            fontWeight: 700,
            padding: '0 8px',
            gap: 4,
            background: 'var(--paper)',
            opacity: busy ? 0.6 : 1,
          }}
        >
          <Icon name="crosshair" size={11} />
          {busy === 'geo' ? 'Locating…' : 'Use my location'}
        </button>
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        {/* The compass button sits under the dial it writes to, not up in the header
            with the location one: they fill in different halves of this row, and a
            control belongs next to the thing it changes. */}
        <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5 }}>
          <CompassDial
            bearingDeg={s.bearingDeg}
            sunAzimuthDeg={pos.azimuthDeg}
            sunUp={up}
            onChange={(bearingDeg) => setSite({ ...s, bearingDeg })}
          />
          <button
            type="button"
            onClick={readBearing}
            disabled={busy !== null}
            className="ds-chip"
            title="Hold the phone level, point its top edge at the wall drawn at the top of the plan, then tap"
            style={{
              cursor: busy ? 'progress' : 'pointer',
              height: 22,
              width: '100%',
              justifyContent: 'center',
              fontSize: 10,
              fontWeight: 700,
              padding: '0 6px',
              gap: 3,
              background: 'var(--paper)',
              opacity: busy ? 0.6 : 1,
            }}
          >
            <Icon name="compass" size={10} />
            {busy === 'compass' ? 'Hold…' : 'Compass'}
          </button>
        </div>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {/* 0.1°, matching what `coarsen` stores. At 0.5 the field's own chevrons
              stepped by 0.5 from a 0.1-grained value while the browser's Up/Down
              snapped to the nearest 0.5 first — two steppers on one field giving
              different answers. 0.1 is also the resolution that means something
              here: finer is precision the sun cannot use. */}
          <Field label="Latitude" value={s.lat} min={-90} max={90} step={0.1} onChange={(lat) => setSite({ ...s, lat })} />
          <Field label="Longitude" value={s.lon} min={-180} max={180} step={0.1} onChange={(lon) => setSite({ ...s, lon })} />
          {/* Both device readings report themselves here rather than in a toast: each
              is a statement about the controls directly beside it, including the two
              things a filled-in field cannot show — that a coordinate was
              deliberately rounded, and how much a bearing wandered while it was
              being read.

              The default text has to carry the compass gesture, because someone has
              to know what to aim before they press anything. */}
          <div
            role="status"
            style={{
              fontSize: 10,
              color: note?.bad ? 'var(--warn-text)' : 'var(--ink-3)',
              lineHeight: 1.4,
            }}
          >
            {note?.text ??
              'Drag the dial to point at north — the room stays put, the compass turns around it. On a phone: aim its top edge at the wall at the top of the plan and tap Compass.'}
          </div>
        </div>
      </div>
    </div>
  );
}

/** The day's sun path, with a range input laid over it.
 *
 *  The native input is not decoration: it is the whole keyboard and screen-reader
 *  story for scrubbing — arrows, Home/End, a spoken value — and painting a graph
 *  under a transparent track keeps that for free. Anything hand-rolled here would
 *  have to reimplement it and would end up mouse-only, which is how the panel got
 *  its two unlabelled sliders in the first place. */
function DayGraph({
  path,
  minutes,
  onChange,
}: {
  path: DayPath;
  minutes: number;
  onChange: (m: number) => void;
}) {
  const curve = path.alt
    .map((a, i) => `${i === 0 ? 'M' : 'L'}${x(i * SAMPLE_STEP).toFixed(1)},${y(a).toFixed(1)}`)
    .join(' ');
  // Daylight is drawn from the RUNS of above-horizon samples, not from a
  // sunrise/sunset pair. Above the polar circles a summer day can be up at
  // midnight, dip under for an hour and come back, so "night is the two ends and
  // day is between them" is false there: the fill joined the 00:00 run to the
  // 23:00 one straight through the middle, and the two night rectangles shaded
  // most of a day the sun never left. Runs are true at every latitude.
  const runs: Array<Array<{ m: number; a: number }>> = [];
  let run: Array<{ m: number; a: number }> = [];
  path.alt.forEach((a, i) => {
    if (a > 0) run.push({ m: i * SAMPLE_STEP, a });
    else if (run.length) {
      runs.push(run);
      run = [];
    }
  });
  if (run.length) runs.push(run);

  const markX = x(minutes);
  const markY = y(path.alt[Math.round(minutes / SAMPLE_STEP)] ?? 0);

  return (
    <div style={{ position: 'relative' }}>
      <svg
        viewBox={`0 0 ${GRAPH_W} ${GRAPH_H}`}
        width="100%"
        aria-hidden="true"
        // The height FOLLOWS the width, via aspect-ratio, rather than being
        // pinned at GRAPH_H. Pinned, the default `xMidYMid meet` letterboxed the
        // drawing in any container narrower than GRAPH_W: the element's own
        // `--paper-2` showed above and below the night rect's `--paper-3` as two
        // mismatched grey bands, which is exactly what the move out of a 272px
        // popover into a rail that clamps produced.
        // `preserveAspectRatio="none"` would also fill the box, and is wrong —
        // it scales the axes independently, so the "sun right now" marker
        // becomes an ellipse and the vertical rules render thinner than the
        // horizontal ones. A smaller graph beats a distorted one.
        style={{
          display: 'block',
          height: 'auto',
          aspectRatio: `${GRAPH_W} / ${GRAPH_H}`,
          borderRadius: 'var(--r-2)',
          background: 'var(--paper-2)',
        }}
      >
        {/* Night is the floor and daylight is painted over it, rather than night
            being two rectangles at the ends. The day band is opaque `--paper-2`
            under the tint, because the tint is translucent and would otherwise
            read as muddy night rather than as day. */}
        <rect x={0} y={0} width={GRAPH_W} height={GRAPH_H} fill="var(--paper-3)" />
        {runs.map((r) => (
          <rect
            key={`band-${r[0].m}`}
            x={x(r[0].m)}
            y={0}
            width={Math.max(0.5, x(r[r.length - 1].m) - x(r[0].m))}
            height={GRAPH_H}
            fill="var(--paper-2)"
          />
        ))}
        {runs.map((r) => (
          <path
            key={`fill-${r[0].m}`}
            d={
              `M${x(r[0].m).toFixed(1)},${HORIZON_Y} ` +
              r.map((p) => `L${x(p.m).toFixed(1)},${y(p.a).toFixed(1)}`).join(' ') +
              ` L${x(r[r.length - 1].m).toFixed(1)},${HORIZON_Y} Z`
            }
            fill="var(--accent-tint-strong)"
          />
        ))}
        <line x1={0} y1={HORIZON_Y} x2={GRAPH_W} y2={HORIZON_Y} stroke="var(--hairline-strong)" strokeWidth={1} />
        {/* Midday gridline — the only clock reference the drawing needs. */}
        <line x1={x(720)} y1={4} x2={x(720)} y2={GRAPH_H - 4} stroke="var(--hairline)" strokeWidth={1} strokeDasharray="2 3" />
        <path d={curve} fill="none" stroke="var(--accent)" strokeWidth={1.5} strokeLinejoin="round" />
        <line x1={markX} y1={2} x2={markX} y2={GRAPH_H - 2} stroke="var(--ink-2)" strokeWidth={1} />
        <circle cx={markX} cy={markY} r={4} fill={markY <= HORIZON_Y ? 'var(--accent)' : 'var(--ink-4)'} stroke="var(--paper)" strokeWidth={1.5} />
      </svg>

      <input
        type="range"
        className="sun-scrub"
        min={0}
        max={1439}
        step={5}
        value={minutes}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label="Time of day"
        aria-valuetext={clockLabel(minutes)}
        style={{ position: 'absolute', left: 0, right: 0, bottom: -4, width: '100%' }}
      />

      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10, fontSize: 10, color: 'var(--ink-3)' }}>
        <span className="mono">{path.sunrise === null ? '—' : clockLabel(path.sunrise)} ↑</span>
        <span>{path.maxAlt > 0 ? `${Math.round(path.maxAlt)}° at ${clockLabel(path.noon)}` : 'sun stays down'}</span>
        <span className="mono">↓ {path.sunset === null ? '—' : clockLabel(path.sunset)}</span>
      </div>
    </div>
  );
}

/** Which way the room's north edge faces, as a dial you point.
 *
 *  A compass bearing typed into a box is a number about the world; this is the
 *  same number as a picture of the room, with north on the rim and the sun where
 *  it currently is. It is a real slider (role, value, arrow keys) because pointing
 *  by dragging is a mouse gesture and this is the only control for the fact. */
function CompassDial({
  bearingDeg,
  sunAzimuthDeg,
  sunUp,
  onChange,
}: {
  bearingDeg: number;
  sunAzimuthDeg: number;
  sunUp: boolean;
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
  const sunAt = sunAzimuthDeg - bearingDeg;

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
  const [sx, sy] = pt(sunAt, R - 10);

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
        // What the number IS: the compass bearing the plan's top edge faces. It used
        // to be read out as "north is N degrees from the top of the plan", which is
        // the same figure with the rotation running the other way — north sits at
        // MINUS the bearing, which is why the needle is drawn at `-bearingDeg`.
        aria-valuetext={`The top of the plan faces ${Math.round(bearingDeg)} degrees, ${compassName(bearingDeg)}`}
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
        {/* The sun, where it is right now relative to the room. */}
        <circle cx={sx} cy={sy} r={5} fill={sunUp ? 'var(--accent)' : 'var(--paper)'} stroke={sunUp ? 'var(--accent-text)' : 'var(--ink-4)'} strokeWidth={1.5} />
      </svg>
      <div style={{ fontSize: 10, color: 'var(--ink-3)', marginTop: 2 }}>
        <Icon name="compass" size={9} style={{ display: 'inline-block', verticalAlign: '-1px', marginRight: 3 }} />
        <span className="mono">{Math.round(bearingDeg)}°</span>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10.5, color: 'var(--ink-3)' }}>
      <span style={{ width: 58, flexShrink: 0 }}>{label}</span>
      {/* NumberField's `style` lands on the input, not on its positioned wrapper,
          so the flexing is done here — otherwise a number input sits at its
          intrinsic width and pushes out of a 272px panel. */}
      <span style={{ flex: 1, minWidth: 0 }}>
        <NumberField
          value={String(value)}
          step={step}
          min={min}
          max={max}
          height={26}
          ariaLabel={label}
          onChange={(v) => {
            const n = Number(v);
            if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n)));
          }}
          style={{ width: '100%' }}
        />
      </span>
    </label>
  );
}

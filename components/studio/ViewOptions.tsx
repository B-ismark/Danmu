'use client';

// The "View" popover: lighting mood, decor toggle, render quality, re-scan.
//
// It no longer positions itself. It used to float alone at the top-right of the
// canvas, which made it one of seven separate clusters over a single 3D view —
// and lighting/quality belong next to the camera presets and the room checks, not
// in a corner of their own. The parent (RoomTools' row) places it now; this
// component only owns the button and the panel that hangs off it.

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useStudio, type Lighting } from '@/lib/store';
import { useScene } from '@/lib/scene-store';
import { roomStore } from '@/lib/storage';
import { sunPosition } from '@/lib/solar';
import { Icon, type IconName } from '@/components/ui/Icon';
import { NumberField } from '@/components/ui/NumberField';
import { Segmented } from '@/components/ui/primitives';
import { isTypingOrDialog } from './KeyboardShortcuts';

// Lucide, not emoji. The emoji versions rendered in the system's colour font —
// a red sun and a yellow moon in a panel that is otherwise warm neutrals — at
// sizes and baselines nothing here controls. They also lived inside the label
// string, so the space between glyph and word was a line-break opportunity and
// every segment wrapped onto two lines inside a 30px-tall control.
const MOODS: Array<{ id: Lighting; label: string; icon: IconName }> = [
  { id: 'day', label: 'Day', icon: 'sun' },
  { id: 'evening', label: 'Evening', icon: 'moon' },
  { id: 'cool', label: 'Cool', icon: 'cloud' },
  // The other three are studio moods — a look. This one is a measurement: the
  // sun's real position for this room's latitude, on this date, at this time.
  { id: 'sun', label: 'Sun', icon: 'compass' },
];

/** Where the sun is asked about before the room has a site. Mirrors Room.tsx —
 *  the panel has to show the same numbers the scene is lit by, or the fields read
 *  as blank while the room is plainly lit from somewhere. */
const DEFAULT_SITE = { lat: 40, lon: 0, bearingDeg: 0 };

function clockLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Day-of-year → "5 Mar". 2001 is a non-leap year, so 1…365 maps exactly. */
function dateLabel(dayOfYear: number): string {
  const d = new Date(2001, 0, 1);
  d.setDate(dayOfYear);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function ViewOptions() {
  const { roomId } = useParams<{ roomId: string }>();
  const lighting = useStudio((s) => s.lighting);
  const setLighting = useStudio((s) => s.setLighting);
  const dressed = useStudio((s) => s.dressed);
  const toggleDressed = useStudio((s) => s.toggleDressed);
  const quality = useStudio((s) => s.quality);
  const setQuality = useStudio((s) => s.setQuality);
  const [open, setOpen] = useState(false);
  const [hasCaps, setHasCaps] = useState(false);
  const [detected, setDetected] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!roomId) return;
    (async () => {
      const caps = await roomStore.loadCaptures(roomId);
      const room = await roomStore.loadRoom(roomId);
      setHasCaps(caps.length > 0);
      setDetected(!!(room?.detectedObjects && room.detectedObjects.length > 0));
    })();
  }, [roomId]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    }
    // Esc closes and hands focus back to the trigger. Without it the only ways
    // out were clicking the button again or clicking somewhere harmless.
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      if (isTypingOrDialog(e.target)) return;
      e.stopPropagation();
      setOpen(false);
      btn.current?.focus();
    }
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  const hi = quality === 'high';

  return (
    <div ref={wrap} style={{ position: 'relative' }}>
      <button
        ref={btn}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="ds-btn"
        title="Lighting, decor and render quality"
        style={{
          height: 30,
          fontSize: 11,
          gap: 6,
          background: open ? 'var(--accent-tint)' : 'var(--paper)',
          borderColor: open ? 'var(--accent-text)' : 'var(--edge)',
          color: open ? 'var(--accent-text)' : 'var(--ink-2)',
          boxShadow: 'var(--shadow-soft)',
        }}
      >
        <Icon name="settings" size={12} />
        View
      </button>

      {open && (
        <div
          className="ds-card"
          style={{
            position: 'absolute',
            // Opens upward now that the button lives near the bottom edge.
            bottom: 'calc(100% + 8px)',
            right: 0,
            zIndex: 'var(--z-popover)',
            // Wide enough for four lighting segments to hold icon + label on one
            // line without the track clipping the last of them.
            width: 300,
            padding: 14,
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
            boxShadow: 'var(--shadow-lift)',
          }}
        >
          <Group label="Lighting">
            <Segmented
              ariaLabel="Lighting"
              options={MOODS.map((m) => ({ value: m.id, label: m.label, icon: m.icon }))}
              value={lighting}
              onChange={setLighting}
              stretch
            />
          </Group>

          {lighting === 'sun' && <SunControls />}

          <Group label="Decor">
            <Segmented
              ariaLabel="Decor"
              options={[{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }]}
              value={dressed ? 'on' : 'off'}
              onChange={(v) => { if ((v === 'on') !== dressed) toggleDressed(); }}
            />
          </Group>

          <Group label="Quality">
            <Segmented
              ariaLabel="Quality"
              options={[{ value: 'high', label: 'High' }, { value: 'low', label: 'Fast' }]}
              value={hi ? 'high' : 'low'}
              onChange={(v) => setQuality(v === 'high' ? 'high' : 'low')}
            />
            <div style={{ fontSize: 10.5, color: 'var(--ink-3)', marginTop: 5, lineHeight: 1.4 }}>
              High adds soft shadows + textured surfaces.
            </div>
          </Group>

          {hasCaps && (
            <>
              <div style={{ height: 1, background: 'var(--hairline)' }} />
              <Link
                href="/onboarding/detect"
                className="ds-btn"
                style={{ height: 32, fontSize: 12, justifyContent: 'center' }}
                title={detected ? 'Re-scan your photos for furniture' : 'Scan your photos for furniture'}
              >
                <Icon name="refresh" size={12} />
                {detected ? 'Re-scan room' : 'Scan room'}
              </Link>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Date, time and place for the sun mood.
 *
 *  The sliders are the feature, not decoration: a sun path is only worth having if
 *  you can scrub an afternoon and watch the light cross the floor. Latitude and
 *  the room's compass bearing live ON THE ROOM (a flat and a holiday cottage do
 *  not share a latitude); the moment being shown lives in device prefs, because it
 *  is a question you are asking rather than a fact about the room.
 *
 *  Nothing here is derived from a photo. EXIF carries GPS coordinates and
 *  `lib/exif.ts` deliberately does not read them, so this is typed in or it is the
 *  default — and the default is on screen rather than hidden. */
function SunControls() {
  const sunMinutes = useStudio((s) => s.sunMinutes);
  const setSunMinutes = useStudio((s) => s.setSunMinutes);
  const sunDayOfYear = useStudio((s) => s.sunDayOfYear);
  const setSunDayOfYear = useStudio((s) => s.setSunDayOfYear);
  const site = useScene((s) => s.room.site);
  const setSite = useScene((s) => s.setSite);
  const s = site ?? DEFAULT_SITE;

  // The same instant Room.tsx lights the scene with, so the readout cannot
  // disagree with what is on screen.
  const when = new Date(new Date().getFullYear(), 0, 1);
  when.setDate(sunDayOfYear);
  when.setHours(Math.floor(sunMinutes / 60), sunMinutes % 60, 0, 0);
  const pos = sunPosition(when.getTime(), s.lat, s.lon);
  const up = pos.altitudeDeg > 0;

  return (
    <Group label="Sun">
      <Row>
        <Slider
          label={`Time · ${clockLabel(sunMinutes)}`}
          min={0}
          max={1425}
          step={15}
          value={sunMinutes}
          onChange={setSunMinutes}
        />
      </Row>
      <Row>
        <Slider
          label={`Date · ${dateLabel(sunDayOfYear)}`}
          min={1}
          max={365}
          step={1}
          value={sunDayOfYear}
          onChange={setSunDayOfYear}
        />
      </Row>

      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
        <Field
          label="Lat"
          value={s.lat}
          min={-90}
          max={90}
          step={0.5}
          onChange={(lat) => setSite({ ...s, lat })}
        />
        <Field
          label="Lon"
          value={s.lon}
          min={-180}
          max={180}
          step={0.5}
          onChange={(lon) => setSite({ ...s, lon })}
        />
        <Field
          label="Facing"
          value={s.bearingDeg}
          min={0}
          max={359}
          step={5}
          onChange={(bearingDeg) => setSite({ ...s, bearingDeg })}
        />
      </div>

      <div
        style={{
          fontSize: 10.5,
          color: up ? 'var(--ink-3)' : 'var(--warn-text)',
          marginTop: 7,
          lineHeight: 1.45,
        }}
      >
        {up ? (
          <>
            Sun <span className="mono">{Math.round(pos.altitudeDeg)}°</span> up, bearing{' '}
            <span className="mono">{Math.round(pos.azimuthDeg)}°</span>. “Facing” is the compass
            bearing of the plan’s north edge.
          </>
        ) : (
          <>The sun is below the horizon at this time — the room is lit by sky only.</>
        )}
      </div>
    </Group>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div style={{ marginTop: 6 }}>{children}</div>;
}

function Slider({
  label,
  min,
  max,
  step,
  value,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label style={{ display: 'block', fontSize: 10.5, color: 'var(--ink-2)' }}>
      {label}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ width: '100%', accentColor: 'var(--accent)', marginTop: 3 }}
      />
    </label>
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
    <label style={{ flex: 1, minWidth: 0, fontSize: 10.5, color: 'var(--ink-3)' }}>
      {label}
      <NumberField
        value={String(value)}
        step={step}
        min={min}
        max={max}
        height={28}
        ariaLabel={label}
        onChange={(v) => {
          const n = Number(v);
          if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n)));
        }}
        style={{ marginTop: 3 }}
      />
    </label>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="ds-label" style={{ display: 'block', marginBottom: 6 }}>{label}</span>
      {children}
    </div>
  );
}

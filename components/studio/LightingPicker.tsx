'use client';

// The daylight control in the rail's Style section: four named times of day and
// Overcast as one row of glyphs, a 24-hour track under them, and which way the
// room faces.
//
// The BIG control for the day is the sun on its arc over the room
// (`components/three/SunArc.tsx`) — that is where you drag the day through. This
// is its companion for the moments you want by name, for keyboard and
// screen-reader use through native controls, and for the one fact the arc cannot
// set, the room's bearing.
//
// **Dropping the words does not drop the labels.** Each glyph keeps its
// `aria-label`, and the name a sighted user cannot read off the glyph comes back
// on hover AND on keyboard focus through `ui/Tooltip`. Five is still the ceiling
// on the row, for the reason it always was: the tight rail holds five 32px
// targets exactly, and `sun`, `sun-medium` and `sun-dim` read as one icon at 14px.

import { SUN_DRAG_ID, useStudio } from '@/lib/store';
import { useScene } from '@/lib/scene-store';
import {
  DEFAULT_BEARING_DEG,
  TIME_STOPS,
  formatClock,
  isDaytime,
  type TimeStopId,
} from '@/lib/lighting-moods';
import { playSound } from '@/lib/sound';
import { Icon, type IconName } from '@/components/ui/Icon';
import { Tooltip } from '@/components/ui/Tooltip';

// A `Record` keyed by the stop ids, so a stop added to `TIME_STOPS` is a compile
// error here rather than a stop with no glyph.
const STOP_UI: Record<TimeStopId, { hint: string; icon: IconName }> = {
  morning: { hint: 'Low sun from the east', icon: 'sunrise' },
  midday: { hint: 'High sun from the south', icon: 'sun' },
  evening: { hint: 'Low gold sun from the west', icon: 'sunset' },
  night: { hint: 'Moonlight, lit by the lamps', icon: 'moon' },
};

/** Eight points, because sixteen would be precision the sentence around it does
 *  not have. Takes a TRUE bearing, clockwise from north. */
const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
export function compassName(deg: number): string {
  return COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}

export function LightingPicker() {
  const lighting = useStudio((s) => s.lighting);
  const setLighting = useStudio((s) => s.setLighting);
  const hour = useStudio((s) => s.hour);
  const setHour = useStudio((s) => s.setHour);
  const site = useScene((s) => s.room.site);
  const setSite = useScene((s) => s.setSite);
  const bearingDeg = site?.bearingDeg ?? DEFAULT_BEARING_DEG;
  const overcast = lighting === 'overcast';

  /** Turn the room an eighth. Snaps to the nearest compass point first, so a
   *  bearing a photo supplied (213°) steps to 225° and then by whole points. */
  const turn = (dir: 1 | -1) => {
    const onPoint = bearingDeg % 45 === 0;
    const next = onPoint ? bearingDeg + 45 * dir : (dir > 0 ? Math.ceil(bearingDeg / 45) : Math.floor(bearingDeg / 45)) * 45;
    // Read through `getState` rather than closing over `site`, so a fast double
    // press cannot spread one render's site over the rest.
    setSite({ ...useScene.getState().room.site, bearingDeg: ((next % 360) + 360) % 360 });
  };

  const glyphs: Array<{ id: string; label: string; hint: string; icon: IconName; active: boolean; pick: () => void }> = [
    ...TIME_STOPS.map((t) => ({
      id: t.id,
      label: `${t.label} · ${formatClock(t.hour)}`,
      hint: STOP_UI[t.id].hint,
      icon: STOP_UI[t.id].icon,
      active: !overcast && Math.abs(hour - t.hour) < 0.05,
      pick: () => {
        setLighting('daylight');
        setHour(t.hour);
        // A named time always chimes, even one a few minutes off — `SoundCues` only
        // hears a JUMP as one, and a press is a press. Same name, so the two
        // de-duplicate rather than stack.
        playSound('chime');
      },
    })),
    {
      id: 'overcast',
      label: 'Overcast',
      hint: 'Flat light, no sun',
      icon: 'cloud',
      active: overcast,
      pick: () => setLighting('overcast'),
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
      {/* `flex` with `wrap`, not a grid: five 32px targets need 176px and the tight
          rail affords 176px of content, so this fits on one row everywhere the
          studio runs. `wrap` is the honest fallback for browser zoom. */}
      <div role="group" aria-label="Time of day" style={{ display: 'flex', flexWrap: 'wrap', gap: 4, minWidth: 0 }}>
        {glyphs.map((m) => (
          <Tooltip key={m.id} label={m.label}>
            <button
              type="button"
              onClick={m.pick}
              aria-pressed={m.active}
              aria-label={`${m.label}: ${m.hint}`}
              style={{
                width: 32,
                height: 32,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                borderRadius: 'var(--r-2)',
                // `--edge` and not a hairline: this is interactive.
                border: `1px solid ${m.active ? 'var(--accent)' : 'var(--edge)'}`,
                background: m.active ? 'var(--accent-tint)' : 'var(--paper)',
                color: m.active ? 'var(--accent-text)' : 'var(--ink-2)',
                cursor: 'pointer',
                padding: 0,
              }}
            >
              <Icon name={m.icon} size={15} />
            </button>
          </Tooltip>
        ))}
      </div>

      {/* The whole day as a track. A native range, so arrows, Page and Home/End
          are the platform's own and a screen reader announces the clock. */}
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <span className="sr-only">Time of day</span>
        <Icon name={isDaytime(hour) ? 'sun' : 'moon'} size={13} />
        <input
          type="range"
          className="day-track"
          min={0}
          // One step short of midnight: 24:00 IS 00:00, and a track whose two ends
          // are the same moment has a stop that says nothing new.
          max={24 - 1 / 12}
          step={1 / 12}
          value={hour}
          // A pull along the track is one gesture, so it is one undo step — the
          // same claim the sun's own handle makes, released wherever the finger
          // lifts (a range does not capture, so the release may land elsewhere).
          // Arrows and Page keys stay one step each, which is what they are.
          onPointerDown={(e) => {
            if (e.button !== 0 || useStudio.getState().draggingId) return;
            useStudio.getState().setDragging(SUN_DRAG_ID);
            const release = () => {
              window.removeEventListener('pointerup', release, true);
              window.removeEventListener('pointercancel', release, true);
              if (useStudio.getState().draggingId === SUN_DRAG_ID) useStudio.getState().setDragging(null);
            };
            window.addEventListener('pointerup', release, true);
            window.addEventListener('pointercancel', release, true);
          }}
          aria-valuetext={formatClock(hour)}
          onChange={(e) => {
            if (overcast) setLighting('daylight');
            setHour(Number(e.target.value));
          }}
          style={{ flex: 1, minWidth: 0 }}
        />
        <span className="mono t-micro" style={{ minWidth: 34, textAlign: 'right', color: overcast ? 'var(--ink-3)' : 'var(--ink)' }}>
          {formatClock(hour)}
        </span>
      </label>

      {/* Which way the room faces — the one input the sun still takes from the
          user, because it is the only one whose effect is visible at furniture
          scale: it changes WHICH WALL the light comes through. It was the Sun
          direction dial in the Room section; the arc over the room now shows the
          answer, so what is left here is the setting, one compass point a press. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
        <span className="t-micro" style={{ flexShrink: 0 }}>Plan top faces</span>
        <button type="button" className="icon-btn" aria-label="Turn the room anticlockwise" onClick={() => turn(-1)} style={{ width: 26, height: 26 }}>
          <Icon name="rotate-ccw" size={12} />
        </button>
        <span
          className="t-micro"
          aria-live="polite"
          style={{ flex: 1, minWidth: 0, textAlign: 'center', color: 'var(--ink)', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        >
          {compassName(bearingDeg)}
        </span>
        <button type="button" className="icon-btn" aria-label="Turn the room clockwise" onClick={() => turn(1)} style={{ width: 26, height: 26 }}>
          <Icon name="rotate-cw" size={12} />
        </button>
      </div>
    </div>
  );
}

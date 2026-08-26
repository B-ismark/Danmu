'use client';

// Everything about how the room LOOKS, in one place.
//
// It used to float alone at the top-right of the canvas — one of seven separate
// clusters over a single 3D view. It has since absorbed two strays: the floor
// grid was a chip of its own down in the corner (a display toggle sitting apart
// from the other display toggle), and a "Re-scan room" link that duplicated a
// control belonging elsewhere, because it is about what is IN the room rather
// than how it is lit. (That control now lives in the rail's Room section; this
// panel is not it.) Three groups, in the order someone reaches for them:
// Lighting, Display, Quality.
//
// It is now the body of the rail's "View" section, and NOT a popover. That was
// half-finished for a while: the header claimed it "no longer positions
// anything" while the code still hung a `position: absolute; width: 300` card
// off a "Look" button. Two things were wrong with that, and both were visible:
//
//   · The rail is 260px with 16px of padding, so a 300px panel opening to
//     `right: 0` reached ~56px past the rail's own edge — into PartTree's
//     `overflow: hidden` scroll box, which cut it off down the left. Both
//     `ui/Select.tsx` and `RoomTools.tsx` had already hit this and fixed it by
//     going `position: fixed` and measuring; a third copy of that machinery is
//     the wrong answer here, because —
//   · `RailSection` is already a disclosure. A button that opens a panel, inside
//     a header that opens a section, is two locks on one door.
//
// So the groups render inline and the section header is the only disclosure.
//
// Inlining exposed a second fault the popover had been hiding badly rather than
// avoiding. Even at 300px the Lighting set was broken: `stretch` split 272px of
// content four ways, so "Evening" got 68px for 82px of word, and a segment with
// no `overflow` of its own does not clip — it prints over the segments either
// side. In a ~200px rail one row is hopeless, so it passes `wrap` instead, which
// is as many across as fit and however many rows that takes.
//
// The set is seven now, not four — three studio looks plus four sun angles,
// which is what replaced the old "Sun" mood and the panel of latitude,
// longitude, date and clock fields that hung below it. Nothing about the
// reflow changed: `wrap` was already the answer to "the labels want more room
// than the rail has", and it does not care how many labels there are.

import { type ReactNode } from 'react';
import { useStudio, LIGHTINGS, type Lighting } from '@/lib/store';
import { type IconName } from '@/components/ui/Icon';
import { Segmented, Toggle } from '@/components/ui/primitives';

// Lucide, not emoji. The emoji versions rendered in the system's colour font —
// a red sun and a yellow moon in a panel that is otherwise warm neutrals — at
// sizes and baselines nothing here controls. They also lived inside the label
// string, so the space between glyph and word was a line-break opportunity and
// every segment wrapped onto two lines inside a 30px-tall control.
// A `Record` keyed by the union, not a hand-kept array: it is what makes a mood
// added to `LIGHTINGS` a compile error here rather than a mood with no way to
// reach it. The order comes from `LIGHTINGS` itself for the same reason — three
// studio looks, then the four sun angles, low to high and round the room.
const MOODS: Record<Lighting, { label: string; icon: IconName }> = {
  day: { label: 'Day', icon: 'sun' },
  evening: { label: 'Evening', icon: 'moon' },
  cool: { label: 'Cool', icon: 'cloud' },
  // The four below are sun angles rather than looks — each a fixed azimuth and
  // elevation in `Room`'s mood table. They replaced a single "Sun" mood that
  // wanted a latitude, a longitude, a date and a clock first, and then answered
  // with a solar position nobody in the room could check. These are the four
  // moments that apparatus was for: which wall the light comes through is still
  // the room's own bearing, on the dial in the Room section.
  sunrise: { label: 'Sunrise', icon: 'sunrise' },
  noon: { label: 'Noon', icon: 'sun-medium' },
  golden: { label: 'Golden', icon: 'sun-dim' },
  sunset: { label: 'Sunset', icon: 'sunset' },
};

export function ViewOptions() {
  const lighting = useStudio((s) => s.lighting);
  const setLighting = useStudio((s) => s.setLighting);
  const dressed = useStudio((s) => s.dressed);
  const toggleDressed = useStudio((s) => s.toggleDressed);
  const showGrid = useStudio((s) => s.showGrid);
  const toggleGrid = useStudio((s) => s.toggleGrid);
  const quality = useStudio((s) => s.quality);
  const setQuality = useStudio((s) => s.setQuality);

  const hi = quality === 'high';

  return (
    // No width and no min-width: the section it sits in is the one that decides
    // how much room there is, and every control below is happy to be told.
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
      <Group label="Lighting">
        <Segmented
          ariaLabel="Lighting"
          // Order from `LIGHTINGS`, labels from `MOODS`. Mapping over the
          // vocabulary rather than over a list of its own is what keeps this
          // control from silently offering six of seven moods.
          options={LIGHTINGS.map((id) => ({ value: id, label: MOODS[id].label, icon: MOODS[id].icon }))}
          value={lighting}
          onChange={setLighting}
          wrap
          // "Evening" and "Sunrise" tie as the widest label; below this the grid
          // drops a column rather than clipping one.
          minItem={88}
        />
      </Group>

      <div style={{ height: 1, background: 'var(--hairline)' }} />

      <Group label="Display">
        <SwitchRow
          label="Floor grid"
          hint="A metre grid under the furniture"
          on={showGrid}
          onToggle={toggleGrid}
        />
        <SwitchRow
          label="Decor"
          hint="Books, plants and props on surfaces"
          on={dressed}
          onToggle={toggleDressed}
        />
      </Group>

      <div style={{ height: 1, background: 'var(--hairline)' }} />

      <Group label="Quality">
        <Segmented
          ariaLabel="Quality"
          options={[{ value: 'high', label: 'High' }, { value: 'low', label: 'Fast' }]}
          value={hi ? 'high' : 'low'}
          onChange={(v) => setQuality(v === 'high' ? 'high' : 'low')}
          stretch
        />
        <div style={{ fontSize: 10.5, color: 'var(--ink-3)', marginTop: 5, lineHeight: 1.4 }}>
          High adds soft shadows + textured surfaces.
        </div>
      </Group>
    </div>
  );
}

/** A named on/off with a line of explanation. Two of these replaced two On/Off
 *  segmented tracks that said nothing about what they did. */
function SwitchRow({
  label,
  hint,
  on,
  onToggle,
}: {
  label: string;
  hint: string;
  on: boolean;
  onToggle: () => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 0' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)' }}>{label}</div>
        <div style={{ fontSize: 10.5, color: 'var(--ink-3)', lineHeight: 1.35 }}>{hint}</div>
      </div>
      <Toggle on={on} onClick={onToggle} label={label} />
    </div>
  );
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <span className="ds-label" style={{ display: 'block', marginBottom: 6 }}>{label}</span>
      {children}
    </div>
  );
}

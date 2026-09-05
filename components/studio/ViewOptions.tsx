'use client';

// Everything about how the room LOOKS, in one place.
//
// It used to float alone at the top-right of the canvas — one of seven separate
// clusters over a single 3D view. It has since absorbed two strays: the floor
// grid was a chip of its own down in the corner (a display toggle sitting apart
// from the other display toggle), and a "Re-scan room" link that duplicated a
// control belonging elsewhere, because it is about what is IN the room rather
// than how it is lit. (That control now lives in the rail's Room section; this
// panel is not it.) Two groups, in the order someone reaches for them: Display,
// Quality.
//
// **Lighting has left.** It is in the Style section now, as `LightingPicker`.
// Style already held the one-tap theme chips, and a theme SETS a lighting mood
// (`lib/themes.ts`) — so the two controls were one question ("how should this
// room look?") asked in two different drawers, and the answer to one silently
// moved the other. What is left here is genuinely about the VIEW rather than the
// room: whether the grid and the props are drawn, and how hard the renderer
// works. Nothing in this file changes what a screenshot of the room would show
// to someone else.
//
// It is now the body of the RIGHT rail's "View" section, and NOT a popover. The
// section moved out of the left rail because the two rails divide the work between
// them: the left one is what is IN the room, the right one is how it LOOKS, and the
// three values below are three answers to the second question. (An earlier note
// here said it belonged on the right because it is "about the selected piece as much
// as the room". It is not — this file reads `showGrid`, `dressed` and `quality` and
// never touches `selectedPartId`, as the paragraph twenty lines above already says.)
// That was
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
// side. That control has moved, but the lesson belongs to whatever goes in a rail
// next: `stretch` divides one row evenly and only helps while the row is wide
// enough for every label, so a set of words in a rail wants `wrap`. The Quality
// pair below is still `stretch`, and correctly — two five-letter words fit any
// width this app runs at.

import { type ReactNode } from 'react';
import { useStudio } from '@/lib/store';
import { Segmented, Toggle } from '@/components/ui/primitives';

export function ViewOptions() {
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

'use client';

// The lighting moods, as five glyphs on one row.
//
// It was a `Segmented` of `icon + word` pairs. Seven of those needed two rows of
// a 260px rail even after the labels were merged down to five, and it sat in the
// View section while the theme swatches sat in Style — two controls that answer
// the same question ("how should this room look?") in two different drawers. Both
// now live in Style, and this one is built to match the swatch row beside it: one
// line of round-cornered targets, no wrapping, no words.
//
// **Dropping the words does not drop the labels.** Each button keeps its
// `aria-label`, and the name a sighted user cannot read off the glyph comes back
// on hover AND on keyboard focus through `ui/Tooltip` — see that file for why the
// native `title` was not enough for a control whose glyph IS its whole label.
//
// The icons therefore have to carry the distinction on their own, which is the
// real constraint on how many moods this control can hold. Five is comfortable
// (sun, moon, cloud, sunrise, sunset are five different silhouettes); the seven
// it replaced were not, because `sun`, `sun-medium` and `sun-dim` differ only in
// the length of their rays and read as one icon at 14px. That is a reason to keep
// the set small, not a reason to add a sixth glyph.

import { useStudio, LIGHTINGS, type Lighting } from '@/lib/store';
import { Icon, type IconName } from '@/components/ui/Icon';
import { Tooltip } from '@/components/ui/Tooltip';

// A `Record` keyed by the union, so a mood added to `LIGHTINGS` is a compile
// error here rather than a mood with no way to reach it. Order comes from
// `LIGHTINGS` itself, for the same reason.
const MOODS: Record<Lighting, { label: string; hint: string; icon: IconName }> = {
  day: { label: 'Day', hint: 'Overhead sun, from the south', icon: 'sun' },
  evening: { label: 'Evening', hint: 'Dim — lets the lamps do the work', icon: 'moon' },
  cool: { label: 'Cool', hint: 'Flat overcast, no direction', icon: 'cloud' },
  sunrise: { label: 'Sunrise', hint: 'Low sun from the east', icon: 'sunrise' },
  sunset: { label: 'Sunset', hint: 'Low sun from the west', icon: 'sunset' },
};

export function LightingPicker() {
  const lighting = useStudio((s) => s.lighting);
  const setLighting = useStudio((s) => s.setLighting);

  return (
    // `flex` with `wrap`, not a grid: five 32px targets need 176px and the tight
    // rail affords 176px of content, so this fits on one row everywhere the studio
    // runs. `wrap` is the honest fallback rather than a promise it never needs —
    // browser zoom reaches widths no media query names, and a wrapped second row
    // of icons is still usable where a clipped one is not.
    <div
      role="group"
      aria-label="Lighting"
      style={{ display: 'flex', flexWrap: 'wrap', gap: 4, minWidth: 0 }}
    >
      {LIGHTINGS.map((id) => {
        const m = MOODS[id];
        const active = lighting === id;
        return (
          <Tooltip key={id} label={m.label}>
            <button
              type="button"
              onClick={() => setLighting(id)}
              aria-pressed={active}
              // The name, and the only one — there is no visible text to fall
              // back on. The hint rides along because the glyph cannot say
              // "from the east", which is the part that actually distinguishes
              // Sunrise from Sunset.
              aria-label={`${m.label} — ${m.hint}`}
              style={{
                width: 32,
                height: 32,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                borderRadius: 'var(--r-2)',
                // `--edge` and not a hairline: this is interactive.
                border: `1px solid ${active ? 'var(--accent)' : 'var(--edge)'}`,
                background: active ? 'var(--accent-tint)' : 'var(--paper)',
                color: active ? 'var(--accent-text)' : 'var(--ink-2)',
                cursor: 'pointer',
                padding: 0,
              }}
            >
              <Icon name={m.icon} size={15} />
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}

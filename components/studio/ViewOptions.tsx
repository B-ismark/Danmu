'use client';

// The "View" popover — one place for everything about how the room LOOKS.
//
// It no longer positions itself. It used to float alone at the top-right of the
// canvas, which made it one of seven separate clusters over a single 3D view; the
// dock at the bottom-right places it now, next to the camera presets it belongs
// with, and this component only owns the button and the panel that hangs off it.
//
// It has since absorbed two strays. The floor grid was a chip of its own down in
// the corner — a display toggle sitting apart from the other display toggle — and
// the "Re-scan room" link was a second copy of the top bar's Rescan, which is
// about what is IN the room rather than how it is lit. Three groups now, in the
// order someone reaches for them: Lighting, Display, Quality.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useStudio, type Lighting } from '@/lib/store';
import { Icon, type IconName } from '@/components/ui/Icon';
import { Segmented, Toggle } from '@/components/ui/primitives';
import { SunControls } from './SunControls';
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

export function ViewOptions() {
  const lighting = useStudio((s) => s.lighting);
  const setLighting = useStudio((s) => s.setLighting);
  const dressed = useStudio((s) => s.dressed);
  const toggleDressed = useStudio((s) => s.toggleDressed);
  const showGrid = useStudio((s) => s.showGrid);
  const toggleGrid = useStudio((s) => s.toggleGrid);
  const quality = useStudio((s) => s.quality);
  const setQuality = useStudio((s) => s.setQuality);
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);

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
        title="Lighting, floor grid, decor and render quality"
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
        <Icon name="sun" size={12} />
        Look
      </button>

      {open && (
        <div
          className="ds-card"
          style={{
            position: 'absolute',
            // Opens upward: the button lives on the bottom edge of the canvas.
            bottom: 'calc(100% + 8px)',
            right: 0,
            zIndex: 'var(--z-popover)',
            // Wide enough for four lighting segments to hold icon + label on one
            // line without the track clipping the last of them.
            width: 300,
            maxHeight: 'min(560px, 72vh)',
            overflow: 'auto',
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
            {lighting === 'sun' && (
              <div style={{ marginTop: 12 }}>
                <SunControls />
              </div>
            )}
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
        </div>
      )}
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

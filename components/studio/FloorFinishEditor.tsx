'use client';

// The Floor section's body: material, then the size a fitter would name, then grout
// (tile and stone), then colour. Everything here is a choice from a short list — see
// `lib/floor-finish.ts` for why the sizes are not a free number — and the 3D room is
// the preview, so nothing here tries to draw a second one.

import { useRef, useState } from 'react';
import { useScene } from '@/lib/scene-store';
import { useSettings, type DimUnit } from '@/lib/store';
import { formatLength } from '@/lib/units';
import { FLOOR_KINDS, FLOOR_SPEC, resolveFloor, withKind, type FloorKind, type Grout } from '@/lib/floor-finish';
import { Segmented } from '@/components/ui/primitives';
import { Select } from '@/components/ui/Select';
import { ColorPicker } from '@/components/ui/ColorPicker';
import { Icon } from '@/components/ui/Icon';
import { FinishStatus } from './FinishStatus';

/** The collapsed row's summary: what the floor is, in the words the panel uses. */
export function floorSummary(floor: ReturnType<typeof resolveFloor>): string {
  const spec = FLOOR_SPEC[floor.kind];
  const swatch = spec.swatches.find((s) => s.hex.toLowerCase() === floor.color.toLowerCase());
  return swatch ? `${swatch.name} ${spec.label.toLowerCase()}` : spec.label;
}

export function FloorFinishEditor() {
  const chosen = useScene((s) => s.room.floor);
  const setFloor = useScene((s) => s.setFloor);
  const unit = useSettings((s) => s.dimUnit);
  const [mixing, setMixing] = useState(false);
  const mixRef = useRef<HTMLButtonElement>(null);
  const floor = resolveFloor(chosen);
  const spec = FLOOR_SPEC[floor.kind];
  const base = chosen ?? { kind: floor.kind };
  const named = spec.swatches.some((s) => s.hex.toLowerCase() === floor.color.toLowerCase());
  const size = spec.sizes.find((s) => s.mm === floor.sizeMM);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
      <Field label="Material">
        {/* A dropdown, not a grid of six buttons: the choice is one word and the room
            itself is the preview, so the list only needs to be there while choosing. */}
        <Select<FloorKind>
          ariaLabel="Floor material"
          options={FLOOR_KINDS.map((k) => ({ value: k, label: FLOOR_SPEC[k].label }))}
          value={floor.kind}
          onChange={(k) => {
            setMixing(false);
            if (k !== floor.kind) setFloor(withKind(k));
          }}
        />
        <div className="t-hint" style={{ marginTop: 6 }}>{spec.note}</div>
      </Field>

      {spec.sizeOf && size && (
        <Field label={spec.sizeOf}>
          <Select<string>
            ariaLabel={spec.sizeOf}
            options={spec.sizes.map((s) => ({ value: String(s.mm), label: s.name, hint: measure(floor.kind, s.mm, unit) }))}
            value={String(size.mm)}
            onChange={(mm) => setFloor({ ...base, kind: floor.kind, sizeMM: Number(mm) })}
          />
          {/* The measure is derived from the same number the texture is drawn at, in
              the user's own unit, never typed beside it. */}
          <div className="t-hint" style={{ marginTop: 6 }}>{measure(floor.kind, size.mm, unit)}</div>
        </Field>
      )}

      {spec.grout && (
        <Field label="Grout">
          <Segmented<Grout>
            ariaLabel="Grout"
            stretch
            options={[
              { value: 'match', label: 'Matching' },
              { value: 'dark', label: 'Contrast' },
            ]}
            value={floor.grout}
            onChange={(g) => setFloor({ ...base, kind: floor.kind, grout: g })}
          />
        </Field>
      )}

      <Field label="Colour">
        {/* Esc closes the mixer from anywhere in it, the "+" included, and hands focus
            back to the "+" so the keyboard is not left inside a picker that is gone. */}
        <div
          onKeyDown={(e) => {
            if (!mixing || e.key !== 'Escape') return;
            e.stopPropagation();
            setMixing(false);
            mixRef.current?.focus();
          }}
        >
          <div
            role="group"
            aria-label="Floor colour swatches"
            // Not the Inspector's swatch-row class: its fold is measured against the RIGHT
            // rail. Here seven fluid cells share the left rail's width — a swatch is
            // `width: 100%` up to 30px, so at the tight 208px rail they shrink to
            // ~20px rather than wrap the mixer onto a row of its own.
            style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, justifyItems: 'center' }}
          >
            {spec.swatches.map((s) => {
              const on = floor.color.toLowerCase() === s.hex.toLowerCase();
              return (
                <button
                  key={s.hex}
                  onClick={() => setFloor({ ...base, kind: floor.kind, color: s.hex })}
                  title={s.name}
                  aria-label={s.name}
                  aria-pressed={on}
                  className={`swatch${on ? ' is-selected' : ''}`}
                  style={{ backgroundColor: s.hex }}
                />
              );
            })}
            <button
              ref={mixRef}
              onClick={() => setMixing((o) => !o)}
              aria-expanded={mixing}
              aria-label={named ? 'Mix a custom floor colour' : `Custom floor colour ${floor.color.toUpperCase()} — mix another`}
              title={named ? 'Mix a custom colour' : `Custom · ${floor.color.toUpperCase()}`}
              className={`swatch swatch--mix${named ? '' : ' is-selected is-custom'}`}
              style={named ? undefined : { backgroundColor: floor.color }}
            >
              <Icon name="plus" size={14} />
            </button>
          </div>
          {/* Inline, under the swatches — a rail section's body never floats
              (CLAUDE.md rule 4). As a popover it hung past the rail's bottom edge and
              over the sections below it, with its hex field cut off. */}
          {mixing && (
            <div style={{ marginTop: 8 }}>
              <ColorPicker value={floor.color} onChange={(hex) => setFloor({ ...base, kind: floor.kind, color: hex })} />
            </div>
          )}
        </div>
      </Field>

      <FinishStatus channel="floor" saying="Laying the new floor…" done="Floor laid" />

      {/* Offered only when it would change something: picking the default planks and
          their first swatch stores a floor, and a reset that resets nothing is noise. */}
      {chosen && JSON.stringify(floor) !== JSON.stringify(resolveFloor(undefined)) && (
        <button
          onClick={() => {
            setMixing(false);
            setFloor(undefined);
          }}
          className="ds-btn ds-btn--xs ds-btn--ghost"
          title="Back to the pale oak planks the room started with"
          style={{ alignSelf: 'flex-start', padding: '0 8px', fontWeight: 600, color: 'var(--accent-text)', gap: 4 }}
        >
          <Icon name="refresh" size={11} /> Default floor
        </button>
      )}
    </div>
  );
}

/** What a size means on the floor, in the user's unit — one sentence for the list's
 *  trailing note and the line under it, so the two cannot disagree. */
function measure(kind: FloorKind, mm: number, unit: DimUnit): string {
  if (kind === 'herringbone') return `${formatLength(mm, unit)} × ${formatLength(mm * 5, unit)} blocks`;
  if (kind === 'planks') return `${formatLength(mm, unit)} wide boards`;
  return `${formatLength(mm, unit)} square`;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ minWidth: 0 }}>
      <span className="section-title" style={{ marginBottom: 6, display: 'block' }}>{label}</span>
      {children}
    </div>
  );
}

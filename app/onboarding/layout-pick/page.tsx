'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { v4 as uuid } from 'uuid';
import { useRoom } from '@/lib/store';
import { roomStore } from '@/lib/storage';
import { footprintForLayout, type LayoutId } from '@/lib/footprint';
import { polygonArea } from '@/lib/geometry';
import { Icon } from '@/components/ui/Icon';
import { StepHeader } from '@/components/ui/primitives';
import { DocShell } from '@/components/ui/DocShell';

const PRESETS = [
  { id: 'rect' as const, name: 'Rectangle', width: 6.0, depth: 4.0, starter: 'Living room' },
  { id: 'l' as const, name: 'L-Shape', width: 6.0, depth: 4.7, starter: 'Living + reading nook' },
  { id: 't' as const, name: 'T-Shape', width: 5.5, depth: 4.7, starter: 'Living + dining' },
  { id: 'u' as const, name: 'U-Shape', width: 6.0, depth: 5.0, starter: 'Bedroom' },
  { id: 'open' as const, name: 'Open Plan', width: 7.5, depth: 5.6, starter: 'Living + dining loft' },
];
const HEIGHT = 2.8;

// The drawing and the area label are both DERIVED from footprintForLayout — the
// same function that builds the room. Hand-authored versions of each had drifted:
//
//   · The T-Shape path drew a plus/cross (arms both sides, narrowed top bar)
//     while the footprint is a full-width north bar with one south stem. The
//     shape you recognised was not the shape you got.
//   · Every `area` string was the bounding box, so the presets that cut a
//     quadrant or a notch overstated their floor — L by 21%, U by 28%, T by 45%.
//     The figure is also inside each option's aria-label, so it was the number a
//     screen-reader user chose on. On a product whose promise is trustworthy
//     dimensions, a stale hand-typed area is the wrong thing to be wrong about.
const VIEW = { w: 240, h: 180, pad: 20 };

/** Footprint polygon → SVG path in the fixed 240×180 viewBox, preserving aspect. */
function pathFor(layout: LayoutId, w: number, d: number): string {
  const poly = footprintForLayout(layout, w, d);
  const innerW = VIEW.w - VIEW.pad * 2;
  const innerH = VIEW.h - VIEW.pad * 2;
  const scale = Math.min(innerW / w, innerH / d);
  const ox = (VIEW.w - w * scale) / 2;
  const oz = (VIEW.h - d * scale) / 2;
  return (
    poly
      .map(([x, z], i) => {
        const px = ox + (x + w / 2) * scale;
        const pz = oz + (z + d / 2) * scale;
        return `${i === 0 ? 'M' : 'L'}${px.toFixed(1)} ${pz.toFixed(1)}`;
      })
      .join(' ') + ' Z'
  );
}

const LAYOUTS = PRESETS.map((p) => ({
  ...p,
  path: pathFor(p.id, p.width, p.depth),
  area: `${polygonArea(footprintForLayout(p.id, p.width, p.depth)).toFixed(1)} m²`,
}));

export default function LayoutPickPage() {
  const router = useRouter();
  const setRoomId = useRoom((s) => s.setRoomId);
  const [sel, setSel] = useState<(typeof LAYOUTS)[number]['id']>('rect');
  const [saving, setSaving] = useState<null | 'model' | 'capture'>(null);
  const [error, setError] = useState<string | null>(null);
  // Roving tabindex needs the DOM nodes: arrow keys move focus, not just state.
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const layout = LAYOUTS.find((l) => l.id === sel)!;

  // One save path for both CTAs — no duplicated persistence logic to drift.
  async function createRoom(dest: 'model' | 'capture') {
    if (saving) return;
    setSaving(dest);
    setError(null);
    const id = uuid();
    try {
      await roomStore.saveRoom({
        id,
        // Named after the preset it started from. Every room used to be called
        // "My Room", which turned the workspace into a grid of identical cards.
        name: layout.starter,
        createdAt: Date.now(),
        layoutId: sel,
        width: layout.width,
        depth: layout.depth,
        height: HEIGHT,
      });
    } catch {
      // Storage can genuinely refuse (private windows, full disk). Say so and
      // hand the button back rather than sitting in "Creating…" forever.
      setSaving(null);
      setError("This browser wouldn't save the room. Free up some space, or try a normal (non-private) window.");
      return;
    }
    setRoomId(id);
    router.push(dest === 'model' ? `/room/${id}/model` : '/onboarding/capture');
  }

  // A radiogroup promises arrow-key navigation; without this it only had Tab.
  function onOptionKeyDown(e: React.KeyboardEvent, i: number) {
    const last = LAYOUTS.length - 1;
    let next = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = i === last ? 0 : i + 1;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = i === 0 ? last : i - 1;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = last;
    if (next < 0) return;
    e.preventDefault();
    setSel(LAYOUTS[next].id);
    optionRefs.current[next]?.focus();
  }

  return (
    <DocShell
      variant="hero"
      trail={[{ label: 'Rooms', href: '/workspace' }, { label: 'New room' }]}
      // Kept as history, not folded into the breadcrumb: arriving here from
      // Welcome and arriving from the workspace are different journeys, and Back
      // is the only control that honours both. The breadcrumb offers the fixed
      // destination alongside it.
      back={<BackButton onBack={() => router.back()} />}
    >
      <div className="page-pad" style={{ display: 'grid', placeItems: 'center' }}>
        {/* .auto-grid--wide collapses to one column on a phone; the old
            minmax(380px, 1fr) forced a track wider than the viewport. */}
        <div className="auto-grid auto-grid--wide" style={{ width: '100%', gap: 32, alignItems: 'start' }}>
          {/* INTRO + PICKER */}
          <div>
            <StepHeader
              kicker="Pick a shape"
              title="Which footprint is closest to your room?"
              subtitle="It becomes the 1:1 floor your 3D room is built on. Start decorating right away, or photograph your real room first — either way you can move the walls later."
            />
            <div role="radiogroup" aria-label="Room footprint" style={{ marginTop: 24, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {LAYOUTS.map((l, i) => {
                const active = sel === l.id;
                return (
                  <button
                    key={l.id}
                    ref={(el) => {
                      optionRefs.current[i] = el;
                    }}
                    role="radio"
                    aria-checked={active}
                    aria-label={`${l.name}, ${l.area} of floor, starts as a ${l.starter.toLowerCase()}`}
                    // Roving tabindex: one stop for the whole group, arrows move
                    // within it — the standard radiogroup keyboard contract.
                    tabIndex={active ? 0 : -1}
                    onKeyDown={(e) => onOptionKeyDown(e, i)}
                    onClick={() => setSel(l.id)}
                    style={{
                      border: `2px solid ${active ? 'var(--accent)' : 'var(--edge)'}`,
                      background: active ? 'var(--accent-tint)' : 'var(--paper)',
                      borderRadius: 'var(--r-3)',
                      padding: '14px 14px 12px',
                      cursor: 'pointer',
                      textAlign: 'left',
                      minHeight: 122,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8,
                      transition: 'border-color .12s, background .12s',
                    }}
                  >
                    <svg viewBox="0 0 240 180" style={{ width: '100%', height: 60 }} aria-hidden="true">
                      <path
                        d={l.path}
                        fill={active ? 'var(--accent)' : 'var(--ink-4)'}
                        fillOpacity={active ? 0.25 : 0.4}
                        stroke={active ? 'var(--accent)' : 'var(--ink-2)'}
                        strokeWidth="2"
                      />
                    </svg>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                      <span style={{ fontSize: 13.5, fontWeight: 700, color: active ? 'var(--accent-text)' : 'var(--ink)' }}>{l.name}</span>
                      <span className="mono" style={{ fontSize: 10, color: 'var(--ink-2)' }}>{l.area}</span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--ink-2)' }}>Starts as a {l.starter.toLowerCase()}</div>
                  </button>
                );
              })}
            </div>

            {error && (
              <p
                role="status"
                aria-live="polite"
                style={{
                  margin: '16px 0 0',
                  padding: '10px 12px',
                  borderRadius: 'var(--r-2)',
                  background: 'var(--danger-tint)',
                  color: 'var(--danger-text)',
                  fontSize: 12.5,
                  lineHeight: 1.45,
                }}
              >
                {error}
              </p>
            )}

            <button
              onClick={() => createRoom('model')}
              disabled={saving !== null}
              className="ds-btn ds-btn--accent"
              style={{ marginTop: 24, height: 48, fontSize: 14, justifyContent: 'center', width: '100%' }}
            >
              {saving === 'model' ? 'Creating your room…' : (<>Start decorating · {layout.starter.toLowerCase()}<Icon name="arrow-right" size={14} color="var(--on-accent)" /></>)}
            </button>
            <button
              onClick={() => createRoom('capture')}
              disabled={saving !== null}
              className="ds-btn ds-btn--ghost"
              style={{ marginTop: 8, height: 44, fontSize: 12.5, justifyContent: 'center', width: '100%', color: 'var(--ink-2)' }}
            >
              <Icon name="camera" size={13} />
              {saving === 'capture' ? 'Creating your room…' : 'Photograph my real room first (optional)'}
            </button>
          </div>

          {/* PREVIEW */}
          <div
            style={{
              border: '1px solid var(--hairline)',
              background: 'var(--paper)',
              borderRadius: 'var(--r-card)',
              padding: 24,
              minHeight: 360,
              position: 'relative',
              boxShadow: 'var(--shadow-soft)',
            }}
          >
            <div className="ds-label" style={{ color: 'var(--ink-2)', marginBottom: 18 }}>
              Footprint preview · <span className="mono" style={{ color: 'var(--ink)' }}>{layout.width.toFixed(1)} × {layout.depth.toFixed(1)} m</span> · <span className="mono" style={{ color: 'var(--ink)' }}>{layout.area}</span> · {layout.starter}
            </div>
            <div className="ds-crosshair-bg" style={{ aspectRatio: '4/3', position: 'relative', borderRadius: 'var(--r-2)', overflow: 'hidden' }}>
              <svg viewBox="0 0 240 180" style={{ width: '100%', height: '100%', display: 'block' }} role="img" aria-label={`${layout.name} footprint, ${layout.width.toFixed(1)} by ${layout.depth.toFixed(1)} metres, ${layout.area} of floor`}>
                <path
                  d={layout.path}
                  fill="var(--accent-tint)"
                  stroke="var(--accent)"
                  strokeWidth="1.5"
                />
                <g fontFamily="var(--font-mono)" fontSize="8" fill="var(--accent-text)">
                  <line x1="20" y1="10" x2="220" y2="10" stroke="var(--accent)" strokeWidth="0.8" />
                  <rect x="102" y="4" width="40" height="12" fill="var(--paper)" />
                  <text x="122" y="12" textAnchor="middle">{(layout.width * 1000).toFixed(0)} mm</text>
                </g>
              </svg>
            </div>
          </div>
        </div>
      </div>
    </DocShell>
  );
}

// Just the button. The bar around it, the mark and the divider are DocShell's.
// No step counter: the primary CTA on this screen goes straight to the studio,
// so "02 / 04" was promising a sequence most people never walk.
function BackButton({ onBack }: { onBack: () => void }) {
  return (
    <button onClick={onBack} className="ds-btn ds-btn--ghost" style={{ height: 40, padding: '0 10px' }}>
      <Icon name="chevron-left" size={14} />
      <span style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>Back</span>
    </button>
  );
}

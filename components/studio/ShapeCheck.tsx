'use client';

// The room's shape, kept in view on the photos screen and checked once more before the
// scan (`lib/room-reshape.ts` says why the shape is the most expensive answer a person
// gives here). Two pieces:
//
//   · `ShapeLine` — "Your room: L-Shape · Change", under the screen's title, so the shape
//     is never something decided two screens ago and out of sight.
//   · `ShapeCheckDialog` — what Continue opens: the plan with each photo pinned to the
//     wall it will be measured as, "Does this look like your room?", and the shapes to
//     swap to without leaving. A photo pinned to a wall that is plainly not the wall in
//     it is the one mismatch a person can see at a glance, which is the point of drawing
//     it rather than asking in words.

import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Icon } from '@/components/ui/Icon';
import { ROOM_PRESETS, type PresetId } from '@/lib/room-presets';
import { planFor } from '@/lib/layout-outline';
import { framedWall } from '@/lib/capture-plan';
import { SLOT_ORDER } from '@/lib/capture-slots';
import { CAPTURE_SLOTS } from '@/lib/capture';
import type { CaptureSlot, LayoutId } from '@/lib/storage';

const labelOf = (id: CaptureSlot) => CAPTURE_SLOTS.find((s) => s.id === id)!.label;

export function shapeName(layoutId: LayoutId | string | undefined): string {
  return ROOM_PRESETS.find((p) => p.id === layoutId)?.name ?? 'Custom shape';
}

/** "Your room: Rectangle · Change". Without `onChange` the shape is shown and not
 *  offered — the room's walls or furniture were already shaped by hand. */
export function ShapeLine({ layoutId, onChange, why }: { layoutId: LayoutId | string | undefined; onChange?: () => void; why?: string }) {
  return (
    <p className="shape-line t-small">
      <span>
        Your room: <b>{shapeName(layoutId)}</b>
      </span>
      {onChange ? (
        <button type="button" className="ds-btn ds-btn--sm ds-btn--ghost shape-line__change" onClick={onChange}>
          Change
        </button>
      ) : (
        why && <span className="t-hint">· {why}</span>
      )}
    </p>
  );
}

type Mode = 'confirm' | 'change';

export function ShapeCheckDialog({
  initial,
  layoutId,
  footprint,
  photos,
  reshapable,
  why,
  onConfirm,
  onChangeShape,
  onClose,
}: {
  /** 'change' when opened from the Change button: straight to the shapes. */
  initial: Mode;
  layoutId: LayoutId | string | undefined;
  footprint: [number, number][];
  /** Each wall's photo, as an object URL. */
  photos: Partial<Record<CaptureSlot, string>>;
  reshapable: boolean;
  /** Why the shape cannot be changed here, said in its place. */
  why?: string;
  onConfirm: () => void;
  onChangeShape: (to: PresetId) => Promise<void> | void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<Mode>(initial);
  const [busy, setBusy] = useState(false);
  const name = shapeName(layoutId);
  // A photo on a wall that, from the middle of this outline, is not straight ahead —
  // the U's first view — cannot be measured. Said here by name, because it is also
  // the commonest sign that the outline is not the room's.
  const unpinned = SLOT_ORDER.filter((s) => photos[s] && !framedWall(s, footprint));

  async function pick(to: PresetId) {
    if (busy) return;
    if (to === layoutId) {
      // Choosing the shape it already is: back to the check, nothing written.
      if (initial === 'confirm') setMode('confirm');
      else onClose();
      return;
    }
    setBusy(true);
    try {
      await onChangeShape(to);
    } finally {
      setBusy(false);
    }
    // From the check, back to the check with the new outline drawn; from Change, done.
    if (initial === 'confirm') setMode('confirm');
    else onClose();
  }

  if (mode === 'change') {
    const fit = { w: Math.max(...ROOM_PRESETS.map((p) => p.width)), d: Math.max(...ROOM_PRESETS.map((p) => p.depth)) };
    return (
      <Modal
        onClose={initial === 'confirm' ? () => setMode('confirm') : onClose}
        labelledBy="shape-check-title"
        width={560}
        blur
      >
        <h2 id="shape-check-title" className="t-title" style={{ margin: '0 0 6px' }}>
          What shape is your room&rsquo;s floor?
        </h2>
        <p className="t-body" style={{ margin: '0 0 16px', lineHeight: 1.5 }}>
          Most bedrooms are plain rectangles. Pick an L, T or U only if a corner sticks into the room or a nook juts
          out of it. Your photos stay where they are.
        </p>
        <div role="radiogroup" aria-label="Room shape" className="shape-options shape-options--compact">
          {ROOM_PRESETS.map((p) => {
            const active = p.id === layoutId;
            return (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={busy}
                className="shape-option"
                data-active={active || undefined}
                onClick={() => pick(p.id)}
              >
                <span className="shape-option__thumb" aria-hidden="true">
                  <svg viewBox="0 0 240 180">
                    <path
                      d={planFor(p.id, p.width, p.depth, fit).path}
                      fill={active ? 'var(--accent-tint)' : 'var(--paper)'}
                      stroke={active ? 'var(--accent)' : 'var(--ink-2)'}
                      strokeWidth="2"
                      vectorEffect="non-scaling-stroke"
                    />
                  </svg>
                </span>
                <span className="shape-option__name">{p.name}</span>
              </button>
            );
          })}
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      onClose={onClose}
      labelledBy="shape-check-title"
      width={520}
      blur
      footer={
        <>
          <button type="button" className="ds-btn" style={{ flex: 1, justifyContent: 'center' }} onClick={onClose}>
            Back to photos
          </button>
          <button
            type="button"
            className="ds-btn ds-btn--accent"
            style={{ flex: 1, justifyContent: 'center' }}
            onClick={onConfirm}
            autoFocus
          >
            Yes, find the furniture
            <Icon name="arrow-right" size={13} color="var(--on-accent)" />
          </button>
        </>
      }
    >
      <h2 id="shape-check-title" className="t-title" style={{ margin: '0 0 6px' }}>
        Does this look like your room?
      </h2>
      <p className="t-body" style={{ margin: '0 0 14px', lineHeight: 1.5 }}>
        Your room drawn as <b>{name}</b>, seen from above, with each photo on the wall it will be measured as. If
        the outline is wrong, every size will be too.
      </p>
      <PinnedPlan footprint={footprint} photos={photos} name={name} />
      {unpinned.length > 0 && (
        <p className="t-small" style={{ margin: '10px 0 0', lineHeight: 1.5 }}>
          {unpinned.map(labelOf).join(' and ')}: from the middle of this outline there is no wall straight
          ahead, so {unpinned.length > 1 ? 'those photos' : 'that photo'} cannot be measured. If your photo shows a
          wall, the shape is probably different.
        </p>
      )}
      <div className="shape-check__change">
        {reshapable ? (
          <button type="button" className="ds-btn ds-btn--sm" onClick={() => setMode('change')}>
            <Icon name="edit" size={12} />
            Change the shape
          </button>
        ) : (
          why && <p className="t-small" style={{ margin: 0 }}>{why}</p>
        )}
      </div>
    </Modal>
  );
}

/** The outline with each photo pinned just inside its wall, numbered as on the
 *  photos screen. Drawn in plan metres, north up, fitted to its box. */
function PinnedPlan({ footprint, photos, name }: { footprint: [number, number][]; photos: Partial<Record<CaptureSlot, string>>; name: string }) {
  const xs = footprint.map((p) => p[0]);
  const zs = footprint.map((p) => p[1]);
  const pad = 0.4;
  const minX = Math.min(...xs) - pad;
  const minZ = Math.min(...zs) - pad;
  const w = Math.max(...xs) - minX + pad;
  const h = Math.max(...zs) - minZ + pad;
  // A thumbnail a fifth of the room's longer side, which in every preset leaves the
  // four clear of each other and of the middle.
  const t = Math.max(w, h) * 0.2;
  const pins = SLOT_ORDER.flatMap((slot) => {
    const url = photos[slot];
    const seg = url ? framedWall(slot, footprint) : null;
    if (!url || !seg) return [];
    const mx = (seg[0][0] + seg[1][0]) / 2;
    const mz = (seg[0][1] + seg[1][1]) / 2;
    const len = Math.hypot(mx, mz) || 1;
    // Pulled toward the stander, so the picture sits in the room against its wall.
    const cx = mx - (mx / len) * t * 0.62;
    const cz = mz - (mz / len) * t * 0.62;
    return [{ slot, url, seg, cx, cz }];
  });
  const placed = pins.map((p) => labelOf(p.slot)).join(', ');
  return (
    <svg
      className="shape-check__plan"
      viewBox={`${minX} ${minZ} ${w} ${h}`}
      role="img"
      aria-label={`Your room as ${name}, from above${placed ? `, with photos on ${placed}` : ''}.`}
    >
      <defs>
        {pins.map((p) => (
          <clipPath key={p.slot} id={`pin-${p.slot}`}>
            <rect x={p.cx - t / 2} y={p.cz - t / 2} width={t} height={t} rx={t * 0.12} />
          </clipPath>
        ))}
      </defs>
      <polygon
        points={footprint.map(([x, z]) => `${x},${z}`).join(' ')}
        fill="var(--paper)"
        stroke="var(--ink-2)"
        strokeWidth={2}
        vectorEffect="non-scaling-stroke"
        strokeLinejoin="round"
      />
      {pins.map((p) => (
        <g key={p.slot}>
          <line
            x1={p.seg[0][0]}
            y1={p.seg[0][1]}
            x2={p.seg[1][0]}
            y2={p.seg[1][1]}
            stroke="var(--accent)"
            strokeWidth={4}
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
          <image
            href={p.url}
            x={p.cx - t / 2}
            y={p.cz - t / 2}
            width={t}
            height={t}
            preserveAspectRatio="xMidYMid slice"
            clipPath={`url(#pin-${p.slot})`}
          />
          <rect
            x={p.cx - t / 2}
            y={p.cz - t / 2}
            width={t}
            height={t}
            rx={t * 0.12}
            fill="none"
            stroke="var(--paper)"
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
          />
          <circle cx={p.cx - t / 2} cy={p.cz - t / 2} r={t * 0.17} fill="var(--ink)" />
          <text
            x={p.cx - t / 2}
            y={p.cz - t / 2}
            fontSize={t * 0.2}
            textAnchor="middle"
            dominantBaseline="central"
            fill="var(--on-ink)"
            fontWeight={700}
          >
            {SLOT_ORDER.indexOf(p.slot) + 1}
          </text>
        </g>
      ))}
      <circle cx={0} cy={0} r={t * 0.08} fill="var(--ink)" />
    </svg>
  );
}

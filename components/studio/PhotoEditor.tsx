'use client';

// Direct-manipulation editor over a captured photo.
// Shows detection bboxes as rectangles: activating one toggles "keep", X removes
// it, and in "add" mode dragging on the photo draws a new box (the manual,
// zero-AI detection path — the geometry engine turns the box into real position
// and dimensions).
//
// Boxes are NOT movable: there is no handler for dragging an existing box, only
// for drawing a new one. Any caller-side hint copy must say so.
//
// All coordinates are normalized 0..1 in image space — the same convention used
// by the detection pipeline. The element is responsive to its container.

import { useRef, useState } from 'react';
import type { Detection } from '@/lib/detection';
import { Icon } from '@/components/ui/Icon';

export type PhotoEditorItem = {
  index: number;
  d: Detection;
  locked: boolean;
};

type Mode = 'select' | 'add';

export function PhotoEditor({
  imageUrl,
  items,
  mode,
  slotLabel,
  onToggleLock,
  onDelete,
  onAddBox,
}: {
  imageUrl: string;
  items: PhotoEditorItem[];
  mode: Mode;
  /** which wall this photo is, e.g. "Wall 2" — names the image for screen readers */
  slotLabel?: string;
  onToggleLock: (i: number) => void;
  onDelete: (i: number) => void;
  onAddBox: (box: [number, number, number, number]) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);

  function localPct(e: React.PointerEvent): { x: number; y: number } {
    const rect = ref.current!.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)),
    };
  }

  function onPointerDown(e: React.PointerEvent) {
    if (mode !== 'add') return;
    const p = localPct(e);
    setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
    ref.current?.setPointerCapture?.(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!drag) return;
    const p = localPct(e);
    setDrag({ ...drag, x1: p.x, y1: p.y });
  }

  function onPointerUp() {
    if (!drag) return;
    const x = Math.min(drag.x0, drag.x1);
    const y = Math.min(drag.y0, drag.y1);
    const w = Math.abs(drag.x1 - drag.x0);
    const h = Math.abs(drag.y1 - drag.y0);
    if (w > 0.02 && h > 0.02) onAddBox([x, y, w, h]);
    setDrag(null);
  }

  return (
    <div
      ref={ref}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
      style={{
        position: 'relative',
        width: '100%',
        // Tokenised: the old near-black #0A0A08 made this read like an annotation
        // tool rather than part of a warm decorating app.
        background: 'var(--ink)',
        cursor: mode === 'add' ? 'crosshair' : 'default',
        userSelect: 'none',
        touchAction: 'none',
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={imageUrl}
        alt={
          slotLabel
            ? `Your photo of ${slotLabel}, with found furniture outlined`
            : 'Your room photo, with found furniture outlined'
        }
        style={{ width: '100%', height: '100%', objectFit: 'contain' }}
        draggable={false}
      />

      {items.map((item) => (
        <ItemOverlay
          key={item.index}
          item={item}
          mode={mode}
          onToggleLock={() => onToggleLock(item.index)}
          onDelete={() => onDelete(item.index)}
        />
      ))}

      {drag && (
        <div
          style={{
            position: 'absolute',
            left: `${Math.min(drag.x0, drag.x1) * 100}%`,
            top: `${Math.min(drag.y0, drag.y1) * 100}%`,
            width: `${Math.abs(drag.x1 - drag.x0) * 100}%`,
            height: `${Math.abs(drag.y1 - drag.y0) * 100}%`,
            border: '2px dashed var(--accent)',
            background: 'var(--accent-tint-strong)',
            pointerEvents: 'none',
          }}
        />
      )}
    </div>
  );
}

function ItemOverlay({
  item,
  mode,
  onToggleLock,
  onDelete,
}: {
  item: PhotoEditorItem;
  mode: Mode;
  onToggleLock: () => void;
  onDelete: () => void;
}) {
  const { d, locked } = item;
  const [sx, sy, sw, sh] = d.box;
  const [hoverX, setHoverX] = useState(false);
  // Fill tokens, not the plain hues: --accent is 3.5:1 with white, so 10px label
  // copy on it fails. --accent-ink (4.73:1) and --locked (6.97:1) do not.
  const fill = locked ? 'var(--locked)' : 'var(--accent-ink)';
  const cleanLabel = d.label.replace(/__slot:[nesw]$/, '');
  // While drawing, boxes step aside entirely: a half-interactive overlay under a
  // crosshair was ambiguous for the mouse and unreachable for the keyboard.
  const drawing = mode === 'add';

  return (
    <div
      style={{
        position: 'absolute',
        left: `${sx * 100}%`,
        top: `${sy * 100}%`,
        width: `${sw * 100}%`,
        height: `${sh * 100}%`,
        border: `1.5px ${locked ? 'solid' : 'dashed'} ${fill}`,
        background: locked ? 'var(--locked-tint)' : 'var(--accent-tint)',
        pointerEvents: 'none',
      }}
    >
      {/* A real toggle rather than a <div onClick>: keyboard reachable, and its
          state is announced instead of being carried by border style alone. */}
      <button
        type="button"
        disabled={drawing}
        aria-pressed={locked}
        aria-label={`${cleanLabel}, ${(d.conf * 100).toFixed(0)} percent confident. ${locked ? 'Kept' : 'Not kept'}. Activate to ${locked ? 'stop keeping' : 'keep'} it.`}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onToggleLock();
        }}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          background: 'transparent',
          border: 0,
          padding: 0,
          cursor: 'pointer',
          pointerEvents: drawing ? 'none' : 'auto',
        }}
      />

      <div
        style={{
          position: 'absolute',
          top: -26,
          left: -1,
          padding: '2px 4px 2px 7px',
          background: fill,
          color: 'var(--on-accent)',
          fontFamily: 'var(--font-sans)',
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: '0.03em',
          borderRadius: 'var(--r-1)',
          whiteSpace: 'nowrap',
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          pointerEvents: 'auto',
        }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {locked && <Icon name="lock" size={9} color="var(--on-accent)" />}
        <span style={{ textTransform: 'capitalize' }}>{cleanLabel}</span>
        <span className="mono" style={{ opacity: 0.8 }}>· {(d.conf * 100).toFixed(0)}%</span>
        <button
          type="button"
          title={`Remove ${cleanLabel}`}
          aria-label={`Remove ${cleanLabel}`}
          onMouseEnter={() => setHoverX(true)}
          onMouseLeave={() => setHoverX(false)}
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          style={{
            // 24px is the WCAG 2.5.8 floor; this control was 16px.
            width: 24,
            height: 24,
            background: hoverX ? 'var(--scrim-photo)' : 'transparent',
            border: '1px solid transparent',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            borderRadius: 'var(--r-1)',
            padding: 0,
          }}
        >
          <Icon name="x" size={12} color="var(--on-accent)" />
        </button>
      </div>
    </div>
  );
}

'use client';

// Direct-manipulation editor over a captured photo.
// Shows detection bboxes as rectangles: click toggles lock, X deletes, and in
// "add" mode dragging draws a new box (the manual, zero-AI detection path —
// the geometry engine turns the box into real position + dimensions).
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
  onToggleLock,
  onDelete,
  onAddBox,
}: {
  imageUrl: string;
  items: PhotoEditorItem[];
  mode: Mode;
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
        background: '#0A0A08',
        cursor: mode === 'add' ? 'crosshair' : 'default',
        userSelect: 'none',
        touchAction: 'none',
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={imageUrl}
        alt="wall"
        style={{ width: '100%', height: '100%', objectFit: 'contain' }}
        draggable={false}
      />

      {items.map((item) => (
        <ItemOverlay
          key={item.index}
          item={item}
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
            background: 'rgba(232,84,42,0.15)',
            pointerEvents: 'none',
          }}
        />
      )}
    </div>
  );
}

function ItemOverlay({
  item,
  onToggleLock,
  onDelete,
}: {
  item: PhotoEditorItem;
  onToggleLock: () => void;
  onDelete: () => void;
}) {
  const { d, locked } = item;
  const [sx, sy, sw, sh] = d.box;
  const color = locked ? '#2B6FD4' : '#E2613A';
  const cleanLabel = d.label.replace(/__slot:[nesw]$/, '').toUpperCase();

  return (
    <div
      style={{
        position: 'absolute',
        left: `${sx * 100}%`,
        top: `${sy * 100}%`,
        width: `${sw * 100}%`,
        height: `${sh * 100}%`,
        border: `1.5px ${locked ? 'solid' : 'dashed'} ${color}`,
        background: locked ? 'rgba(43,111,212,0.12)' : 'rgba(232,84,42,0.08)',
        cursor: 'pointer',
      }}
      onClick={(e) => {
        e.stopPropagation();
        onToggleLock();
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: -22,
          left: -1,
          padding: '3px 6px',
          background: color,
          color: '#fff',
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          letterSpacing: '0.05em',
          whiteSpace: 'nowrap',
          display: 'flex',
          alignItems: 'center',
          gap: 4,
        }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {locked && <Icon name="lock" size={9} color="#fff" />}
        <span>{cleanLabel}</span>
        <span style={{ opacity: 0.75 }}>· {(d.conf * 100).toFixed(0)}%</span>
        <button
          title="Delete detection"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          style={{
            background: 'rgba(255,255,255,0.18)',
            border: 'none',
            color: '#fff',
            width: 16,
            height: 16,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            borderRadius: 2,
            padding: 0,
          }}
        >
          <Icon name="x" size={9} color="#fff" />
        </button>
      </div>
    </div>
  );
}

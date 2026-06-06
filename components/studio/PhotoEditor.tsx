'use client';

// Direct-manipulation editor over a captured photo.
// Shows detection bboxes as draggable rectangles. Drag a bbox → produces dstBox
// (target placement after render). Right-click / X button toggles "removed".
// Click locks / unlocks. Optional "Make 3D" button per item delegates to a
// callback so the host page can run the image-to-3D pipeline.
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
  onSetDstBox,
  onClearDstBox,
  onToggleRemoved,
  onAddBox,
  onMake3d,
  meshAvailable,
  meshPending,
}: {
  imageUrl: string;
  items: PhotoEditorItem[];
  mode: Mode;
  onToggleLock: (i: number) => void;
  onDelete: (i: number) => void;
  onSetDstBox: (i: number, dst: [number, number, number, number]) => void;
  onClearDstBox: (i: number) => void;
  onToggleRemoved: (i: number) => void;
  onAddBox: (box: [number, number, number, number]) => void;
  onMake3d?: (i: number) => void;
  meshAvailable?: (i: number) => boolean;
  meshPending?: (i: number) => boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<
    | { kind: 'add'; x0: number; y0: number; x1: number; y1: number }
    | { kind: 'move'; idx: number; ox: number; oy: number; dx: number; dy: number; w: number; h: number }
    | null
  >(null);

  function localPct(e: React.PointerEvent): { x: number; y: number } {
    const rect = ref.current!.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)),
    };
  }

  function capture(e: React.PointerEvent) {
    // Capture on the root so pointermove still fires even when the child
    // box switches to pointer-events:none mid-drag.
    ref.current?.setPointerCapture?.(e.pointerId);
  }

  function onPointerDown(e: React.PointerEvent) {
    if (mode !== 'add') return;
    const p = localPct(e);
    setDrag({ kind: 'add', x0: p.x, y0: p.y, x1: p.x, y1: p.y });
    capture(e);
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!drag) return;
    const p = localPct(e);
    if (drag.kind === 'add') {
      setDrag({ ...drag, x1: p.x, y1: p.y });
    } else {
      setDrag({ ...drag, dx: p.x, dy: p.y });
    }
  }

  function onPointerUp() {
    if (!drag) return;
    if (drag.kind === 'add') {
      const x = Math.min(drag.x0, drag.x1);
      const y = Math.min(drag.y0, drag.y1);
      const w = Math.abs(drag.x1 - drag.x0);
      const h = Math.abs(drag.y1 - drag.y0);
      if (w > 0.02 && h > 0.02) onAddBox([x, y, w, h]);
    } else {
      const nx = Math.max(0, Math.min(1 - drag.w, drag.dx - drag.ox));
      const ny = Math.max(0, Math.min(1 - drag.h, drag.dy - drag.oy));
      // Ignore micro-movements (treat as click, not drag) so a simple tap to
      // lock/unlock doesn't accidentally produce a near-identical dstBox.
      const srcX = drag.dx - drag.ox;
      const srcY = drag.dy - drag.oy;
      const drift = Math.hypot(nx - srcX, ny - srcY);
      if (drift > 0.012) onSetDstBox(drag.idx, [nx, ny, drag.w, drag.h]);
    }
    setDrag(null);
  }

  function startMove(e: React.PointerEvent, item: PhotoEditorItem) {
    if (mode !== 'select') return;
    e.stopPropagation();
    const p = localPct(e);
    // anchor at current dst if present, else src
    const cur = item.d.dstBox ?? item.d.box;
    setDrag({
      kind: 'move',
      idx: item.index,
      ox: p.x - cur[0],
      oy: p.y - cur[1],
      dx: p.x,
      dy: p.y,
      w: cur[2],
      h: cur[3],
    });
    capture(e);
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
        height: '100%',
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
          drag={drag && drag.kind === 'move' && drag.idx === item.index ? drag : null}
          onToggleLock={() => onToggleLock(item.index)}
          onDelete={() => onDelete(item.index)}
          onClearDst={() => onClearDstBox(item.index)}
          onToggleRemoved={() => onToggleRemoved(item.index)}
          onPointerDown={(e) => startMove(e, item)}
          onMake3d={onMake3d ? () => onMake3d(item.index) : undefined}
          meshAvailable={meshAvailable?.(item.index) ?? false}
          meshPending={meshPending?.(item.index) ?? false}
        />
      ))}

      {drag && drag.kind === 'add' && (
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
  drag,
  onToggleLock,
  onDelete,
  onClearDst,
  onToggleRemoved,
  onPointerDown,
  onMake3d,
  meshAvailable,
  meshPending,
}: {
  item: PhotoEditorItem;
  drag: { kind: 'move'; ox: number; oy: number; dx: number; dy: number; w: number; h: number } | null;
  onToggleLock: () => void;
  onDelete: () => void;
  onClearDst: () => void;
  onToggleRemoved: () => void;
  onPointerDown: (e: React.PointerEvent) => void;
  onMake3d?: () => void;
  meshAvailable: boolean;
  meshPending: boolean;
}) {
  const { d, locked } = item;
  const removed = !!d.removed;
  const [sx, sy, sw, sh] = d.box;

  // Live drag preview overrides persisted dstBox until pointerUp commits it.
  const dst = drag
    ? [Math.max(0, Math.min(1 - drag.w, drag.dx - drag.ox)), Math.max(0, Math.min(1 - drag.h, drag.dy - drag.oy)), drag.w, drag.h]
    : d.dstBox;

  const srcColor = removed ? '#888' : locked ? '#2B6FD4' : '#E2613A';
  const dstColor = '#2E7D4F';
  const cleanLabel = d.label.replace(/__slot:[nesw]$/, '').toUpperCase();

  return (
    <>
      {/* Src bbox — original position */}
      <div
        style={{
          position: 'absolute',
          left: `${sx * 100}%`,
          top: `${sy * 100}%`,
          width: `${sw * 100}%`,
          height: `${sh * 100}%`,
          border: `1.5px ${removed ? 'dotted' : locked ? 'solid' : 'dashed'} ${srcColor}`,
          background: removed
            ? 'rgba(136,136,136,0.10)'
            : locked
              ? 'rgba(43,111,212,0.12)'
              : 'rgba(232,84,42,0.08)',
          opacity: removed ? 0.55 : 1,
          pointerEvents: dst ? 'none' : 'auto',
          cursor: dst ? 'default' : 'move',
        }}
        onPointerDown={dst ? undefined : onPointerDown}
        onClick={(e) => {
          e.stopPropagation();
          if (!dst && !removed) onToggleLock();
        }}
      >
        {!dst && (
          <ItemLabel
            color={srcColor}
            label={cleanLabel}
            conf={d.conf}
            locked={locked}
            removed={removed}
            onDelete={onDelete}
            onToggleRemoved={onToggleRemoved}
            onMake3d={onMake3d}
            meshAvailable={meshAvailable}
            meshPending={meshPending}
          />
        )}
        {dst && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'grid',
              placeItems: 'center',
              fontFamily: 'var(--font-mono)',
              fontSize: 9,
              color: srcColor,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              opacity: 0.7,
            }}
          >
            was here
          </div>
        )}
      </div>

      {/* Dst bbox — target position after AI render */}
      {dst && !removed && (
        <div
          onPointerDown={onPointerDown}
          style={{
            position: 'absolute',
            left: `${dst[0] * 100}%`,
            top: `${dst[1] * 100}%`,
            width: `${dst[2] * 100}%`,
            height: `${dst[3] * 100}%`,
            border: `2px solid ${dstColor}`,
            background: 'rgba(46,125,79,0.18)',
            cursor: 'move',
            boxShadow: '0 0 0 1px rgba(0,0,0,0.25)',
          }}
        >
          <ItemLabel
            color={dstColor}
            label={cleanLabel}
            conf={d.conf}
            locked={locked}
            removed={false}
            onDelete={onDelete}
            onToggleRemoved={onToggleRemoved}
            onClearDst={onClearDst}
            onMake3d={onMake3d}
            meshAvailable={meshAvailable}
            meshPending={meshPending}
          />
        </div>
      )}
    </>
  );
}

function ItemLabel({
  color,
  label,
  conf,
  locked,
  removed,
  onDelete,
  onToggleRemoved,
  onClearDst,
  onMake3d,
  meshAvailable,
  meshPending,
}: {
  color: string;
  label: string;
  conf: number;
  locked: boolean;
  removed: boolean;
  onDelete: () => void;
  onToggleRemoved: () => void;
  onClearDst?: () => void;
  onMake3d?: () => void;
  meshAvailable: boolean;
  meshPending: boolean;
}) {
  return (
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
      <span style={{ textDecoration: removed ? 'line-through' : 'none' }}>{label}</span>
      <span style={{ opacity: 0.75 }}>· {(conf * 100).toFixed(0)}%</span>
      {meshAvailable && <span title="3D mesh cached" style={{ marginLeft: 4 }}>◆</span>}
      {meshPending && <span title="Generating 3D…" style={{ marginLeft: 4 }}>◌</span>}
      {onMake3d && !meshAvailable && !meshPending && (
        <button
          title="Make 3D model"
          onClick={(e) => {
            e.stopPropagation();
            onMake3d();
          }}
          style={iconBtn}
        >
          3D
        </button>
      )}
      {onClearDst && (
        <button
          title="Cancel move"
          onClick={(e) => {
            e.stopPropagation();
            onClearDst();
          }}
          style={iconBtn}
        >
          <Icon name="refresh" size={9} color="#fff" />
        </button>
      )}
      <button
        title={removed ? 'Restore' : 'Remove from render'}
        onClick={(e) => {
          e.stopPropagation();
          onToggleRemoved();
        }}
        style={iconBtn}
      >
        <Icon name={removed ? 'plus' : 'minus'} size={9} color="#fff" />
      </button>
      <button
        title="Delete detection"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        style={iconBtn}
      >
        <Icon name="x" size={9} color="#fff" />
      </button>
    </div>
  );
}

const iconBtn: React.CSSProperties = {
  background: 'rgba(0,0,0,0.3)',
  border: 'none',
  color: '#fff',
  height: 14,
  minWidth: 14,
  padding: '0 4px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  fontFamily: 'var(--font-mono)',
  fontSize: 9,
};

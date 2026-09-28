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

import { Fragment, useEffect, useRef, useState } from 'react';
import type { Detection } from '@/lib/detection';
import { Icon } from '@/components/ui/Icon';
import { BOX_BORDER_PX, TAG_HEIGHT_PX, boxCss, tagCss, tagSpot } from '@/lib/photo-tag';

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
  // The photo's drawn height, for "is there room above this box for its tag" — a
  // length in pixels, where the box's top is a share of the photo (`lib/photo-tag.ts`).
  // 0 until the image has laid out, which keeps every tag above its box meanwhile.
  const [photoH, setPhotoH] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => setPhotoH(e.contentRect.height));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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
        // The tags are raised over the boxes, and that stays in here: the page's own
        // layers over the photo still paint over all of it, as they do by their order.
        isolation: 'isolate',
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

      {/* One piece at a time, its box and then its tag, so Tab reads each piece's keep
          toggle and then its Remove. The tags are raised over every box instead of
          coming after them all, which is what keeps a box's press area off another
          piece's X. */}
      {items.map((item) => (
        <Fragment key={item.index}>
          <ItemBox item={item} mode={mode} onToggleLock={() => onToggleLock(item.index)} />
          <ItemTag item={item} mode={mode} photoH={photoH} onDelete={() => onDelete(item.index)} />
        </Fragment>
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
            zIndex: 'var(--z-photo-raised)',
          }}
        />
      )}
    </div>
  );
}

/** A box's fill and label, shared by its outline and its tag. Fill tokens, not the
 *  plain hues: --accent is 3.5:1 with white, so 10px label copy on it fails.
 *  --accent-ink (4.73:1) and --locked (6.97:1) do not. */
function look({ d, locked }: PhotoEditorItem) {
  return {
    fill: locked ? 'var(--locked)' : 'var(--accent-ink)',
    cleanLabel: d.label.replace(/__slot:[nesw]$/, ''),
  };
}

function ItemBox({
  item,
  mode,
  onToggleLock,
}: {
  item: PhotoEditorItem;
  mode: Mode;
  onToggleLock: () => void;
}) {
  const { d, locked } = item;
  const { fill, cleanLabel } = look(item);
  // While drawing, boxes step aside entirely: a half-interactive overlay under a
  // crosshair was ambiguous for the mouse and unreachable for the keyboard.
  const drawing = mode === 'add';

  return (
    <div
      style={{
        position: 'absolute',
        // Only the part of the box that is on the photo. The on-device finder keeps x and
        // w in 0..1 but not their sum, and the cloud's boxes are not clamped at all, so a
        // box can run past the frame — and one that did scrolled the whole review sideways.
        ...boxCss(d.box, BOX_BORDER_PX),
        border: `${BOX_BORDER_PX}px ${locked ? 'solid' : 'dashed'} ${fill}`,
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
    </div>
  );
}

/** The box's tag, laid out across the whole photo (`lib/photo-tag.ts`): a row as wide as
 *  the photo, a spacer that puts the tag at the box's left side and shrinks when the tag
 *  would otherwise run past the right edge, then the tag, never wider than the row. */
function ItemTag({
  item,
  mode,
  photoH,
  onDelete,
}: {
  item: PhotoEditorItem;
  mode: Mode;
  photoH: number;
  onDelete: () => void;
}) {
  const { d, locked } = item;
  const [hoverX, setHoverX] = useState(false);
  const { fill, cleanLabel } = look(item);
  const drawing = mode === 'add';
  const css = tagCss(tagSpot(d.box, photoH));

  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        top: css.top,
        height: TAG_HEIGHT_PX,
        display: 'flex',
        pointerEvents: 'none',
        zIndex: 'var(--z-photo-raised)',
      }}
    >
      <div style={{ flex: `0 1 ${css.start}` }} />
      <div
        style={{
          flex: '0 0 auto',
          maxWidth: '100%',
          height: TAG_HEIGHT_PX,
          padding: '2px 4px 2px 7px',
          background: fill,
          color: 'var(--on-accent)',
          fontFamily: 'var(--font-sans)',
          fontSize: 'var(--fs-micro)',
          fontWeight: 700,
          letterSpacing: '0.03em',
          borderRadius: 'var(--r-1)',
          whiteSpace: 'nowrap',
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          // Like the boxes, the tag steps aside while a new box is being drawn: it sits on
          // the photo now, so a press on it has to be able to start one. Its X does not.
          pointerEvents: drawing ? 'none' : 'auto',
        }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {locked && <Icon name="check" size={9} color="var(--on-accent)" />}
        <span
          style={{
            textTransform: 'capitalize',
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {cleanLabel}
        </span>
        <span className="mono" style={{ opacity: 0.8, flexShrink: 0 }}>
          · {(d.conf * 100).toFixed(0)}%
        </span>
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
            // 24px is the WCAG 2.5.8 floor; this control was 16px. It is the tag's height
            // less its padding, so the two cannot drift apart.
            width: TAG_HEIGHT_PX - 4,
            height: TAG_HEIGHT_PX - 4,
            background: hoverX ? 'var(--scrim-photo)' : 'transparent',
            border: '1px solid transparent',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            borderRadius: 'var(--r-1)',
            padding: 0,
            flexShrink: 0,
            // Pressable while drawing too, as it always was: taking out a wrong piece is
            // part of adding the right ones, and a press here removes rather than draws
            // (the tag's own pointer-down stops it reaching the photo).
            pointerEvents: 'auto',
          }}
        >
          <Icon name="x" size={12} color="var(--on-accent)" />
        </button>
      </div>
    </div>
  );
}

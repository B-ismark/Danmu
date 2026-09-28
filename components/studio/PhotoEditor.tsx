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

import { Children, Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Detection } from '@/lib/detection';
import { Icon } from '@/components/ui/Icon';
import { BOX_BORDER_PX, TAG_HEIGHT_PX, TAG_PAD_Y_PX, TAG_X_PX, boxCss, tagCss, tagSpot } from '@/lib/photo-tag';

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
  maxPhotoHeight,
  onToggleLock,
  onDelete,
  onAddBox,
  children,
}: {
  imageUrl: string;
  items: PhotoEditorItem[];
  mode: Mode;
  /** which wall this photo is, e.g. "Wall 2" — names the image for screen readers */
  slotLabel?: string;
  /** The tallest the photo may be drawn, as a CSS length. The frame narrows to keep
   *  the photo's shape, so the boxes, which are shares of the frame, stay on the
   *  furniture at any size. */
  maxPhotoHeight?: string;
  onToggleLock: (i: number) => void;
  onDelete: (i: number) => void;
  onAddBox: (box: [number, number, number, number]) => void;
  /** The page's own layers over the photo, in the same 0..1 space as the boxes and
   *  painted over all of them. Inside the frame, so they cannot drift off it. */
  children?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  // The photo's drawn height, for "is there room above this box for its tag" — a
  // length in pixels, where the box's top is a share of the photo (`lib/photo-tag.ts`).
  // 0 until the image has laid out, which keeps every tag above its box meanwhile.
  const [photoH, setPhotoH] = useState(0);
  // The photo's own width over height, once it has loaded, keyed by its URL so the
  // next wall's photo is not sized by the last one's shape.
  const [shape, setShape] = useState<{ url: string; ratio: number } | null>(null);
  const ratio = shape?.url === imageUrl ? shape.ratio : null;
  // Until then the frame cannot know its width, and drawn at the column's the photo
  // runs past the cap: on a slowed phone, a wall switch drew the next photo 437px
  // tall for two frames under a 180px cap, and the pinned strip jumped with it. So a
  // capped frame waits at the cap's height, empty, and the photo arrives at its size.
  const waiting = ratio === null && !!maxPhotoHeight;
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
        // As wide as the photo is at its tallest, when there is a tallest: the photo
        // fills the frame's width and the frame is its exact size, so a height limit
        // narrows both rather than letterboxing the photo inside a frame the boxes are
        // measured against. Stated as a width, not left to the photo, so a small photo
        // is still drawn up to the column rather than at its own few hundred pixels.
        width: ratio && maxPhotoHeight ? `min(100%, calc(${maxPhotoHeight} * ${ratio}))` : '100%',
        ...(waiting ? { height: maxPhotoHeight, overflow: 'hidden', visibility: 'hidden' } : {}),
        // Tokenised: the old near-black #0A0A08 made this read like an annotation
        // tool rather than part of a warm decorating app.
        background: 'var(--ink)',
        cursor: mode === 'add' ? 'crosshair' : 'default',
        userSelect: 'none',
        // Only while drawing does a finger belong to the photo. Otherwise a swipe on
        // it is a scroll: on a phone the photo is half the screen, and a page that a
        // swipe on half the screen cannot move reads as a page that is stuck.
        touchAction: mode === 'add' ? 'none' : 'manipulation',
        // The tags are raised over the boxes, and that stays in here: the page's own
        // layers (`children`) are raised to the same level after them, so they paint
        // over all of it.
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
        // The frame's width at the photo's own height (Preflight makes an image a
        // block with `height: auto`), so the two are one box and the boxes land on
        // the furniture.
        style={{ width: '100%' }}
        onLoad={(e) => {
          const { naturalWidth: w, naturalHeight: h } = e.currentTarget;
          if (w > 0 && h > 0) setShape({ url: imageUrl, ratio: w / h });
        }}
        // A photo that will not decode has no shape to wait for, and a frame left
        // waiting would hide that there is anything wrong with it.
        onError={() => setShape({ url: imageUrl, ratio: 4 / 3 })}
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

      {/* Only when a layer has something in it: the page hands over a list of
          conditionals, which is truthy with every one of them false. */}
      {Children.toArray(children).length > 0 && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            pointerEvents: 'none',
            // Level with the tags and after them, so it paints over them as it did when
            // it lay outside this frame.
            zIndex: 'var(--z-photo-raised)',
          }}
        >
          {children}
        </div>
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
          padding: `${TAG_PAD_Y_PX}px 4px ${TAG_PAD_Y_PX}px 7px`,
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
          className="sentence-case"
          style={{
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
            // The WCAG 2.5.8 floor, filling the tag's height inside its padding: the
            // height is built from the two (`lib/photo-tag.ts`).
            width: TAG_X_PX,
            height: TAG_X_PX,
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

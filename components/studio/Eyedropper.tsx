'use client';

// The eyedropper's two visible halves: what a pick DOES (`pickColor`, called by every
// click that could be one — a piece and the room shell in 3D, a piece, a wall and the
// floor on the plan) and the pill that says the mode is on.
//
// The rules about WHICH colour live in `lib/eyedropper.ts`; this file is only the
// part that needs a toast and the clipboard, which `lib/` does not reach.

import { useStudio } from '@/lib/store';
import { useScene } from '@/lib/scene-store';
import { useEffect, useState } from 'react';
import { applyColor, colorName, currentColorTarget, hoverSource, setPickingColor, trueColorOf, usePickHover, type ColorSource, type ColorTarget } from '@/lib/eyedropper';
import { toast } from '@/components/ui/StorageToast';
import { Icon } from '@/components/ui/Icon';
import { focusStudioSurface } from './KeyboardShortcuts';

function targetName(t: ColorTarget): string {
  switch (t.kind) {
    case 'floor':
      return 'the floor';
    case 'wall':
      return `wall ${t.index + 1}`;
    case 'parts': {
      if (t.ids.length > 1) return `${t.ids.length} pieces`;
      const p = useScene.getState().parts.find((x) => x.id === t.ids[0]);
      return p?.name ?? 'the piece';
    }
    case 'none':
      return '';
  }
}

/** The click that picks. Always ends the mode — one pick per press of I, as in Figma. */
export function pickColor(source: ColorSource): void {
  setPickingColor(false);
  const { parts, room } = useScene.getState();
  const hex = trueColorOf(source, parts, room);
  if (!hex) return;
  const shown = colorName(hex) ?? hex.toUpperCase();
  const target = currentColorTarget();
  if (applyColor(target, hex) > 0) {
    toast({ tone: 'success', title: `${shown} → ${targetName(target)}`, ttl: 3000 });
    return;
  }
  // Nothing selected, so nowhere to paint: keep the colour on the clipboard for the
  // next swatch field it is pasted into. A clipboard refusal still leaves the hex on
  // screen, which is the value either way.
  // The HEX, even for a named colour: a name pastes into no colour field.
  const code = hex.toUpperCase();
  void navigator.clipboard?.writeText(code).catch(() => {});
  toast({ title: `Copied ${shown === code ? code : `${shown} · ${code}`}`, ttl: 3000 });
}

/** The sampler: a small card riding the pointer — the colour under it, its hex, and
 *  "Click to sample". The big square is the surface's OWN colour, not a magnified
 *  patch of pixels: a loupe would show exactly the lit colour this tool refuses to
 *  pick. On touch there is no pointer at rest, so it sits bottom centre with the one
 *  way out a phone has. */
export function EyedropperHint() {
  const on = useStudio((s) => s.pickingColor);
  const hoveredPartId = useStudio((s) => s.hoveredPartId);
  const surface = usePickHover((s) => s.source);
  const parts = useScene((s) => s.parts);
  const room = useScene((s) => s.room);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!on) return;
    function onMove(e: PointerEvent) {
      if (e.pointerType === 'touch') return;
      setPos({ x: e.clientX, y: e.clientY });
    }
    window.addEventListener('pointermove', onMove);
    return () => window.removeEventListener('pointermove', onMove);
  }, [on]);

  if (!on) return null;
  const source = hoverSource(hoveredPartId, surface);
  const hex = source ? trueColorOf(source, parts, room) : null;
  const name = hex ? colorName(hex) : null;
  const shown = name ?? (hex ? hex.toUpperCase() : '—');
  const follows = pos !== null;
  const W = 196;
  const style = follows
    ? {
        position: 'fixed' as const,
        left: Math.min(pos.x + 18, window.innerWidth - W - 8),
        top: Math.min(pos.y + 18, window.innerHeight - 72),
      }
    : undefined;

  return (
    <div className={`sampler${follows ? '' : ' sampler--docked'}`} style={style} role="status" aria-label={`Colour picker${hex ? `, ${shown}` : ''}`}>
      <span className="sampler__well" style={hex ? { background: hex } : undefined} aria-hidden="true">
        <span className="sampler__reticle" />
      </span>
      <span className="sampler__text">
        <span className="sampler__hex">
          <span className="sampler__dot" style={hex ? { background: hex } : undefined} aria-hidden="true" />
          {/* A name in the UI face, a hex in mono — the face says which it is. */}
          <span className={name ? undefined : 'mono'}>{shown}</span>
        </span>
        <span className="sampler__say">
          <Icon name="pipette" size={12} />
          {follows ? 'Click to sample' : 'Tap to sample'}
        </span>
      </span>
      {!follows && (
        <button
          type="button"
          className="sampler__close"
          aria-label="Cancel"
          onClick={() => {
            setPickingColor(false);
            focusStudioSurface();
          }}
        >
          <Icon name="x" size={14} />
        </button>
      )}
    </div>
  );
}

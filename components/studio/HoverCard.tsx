'use client';

import { useEffect, useRef, useState } from 'react';
import { useStudio } from '@/lib/store';
import { useRoomPart } from '@/lib/room-scene';

// Just the name: the Inspector is where a piece's shelf, size and origin live, and a
// card that follows the pointer should be a label, not a second panel.
export function HoverCard() {
  const hoveredId = useStudio((s) => s.hoveredPartId);
  const selectedId = useStudio((s) => s.selectedPartId);
  const part = useRoomPart(hoveredId);
  const [pos, setPos] = useState({ x: 0, y: 0 });

  // The pointer is tracked for the whole studio session, but a card is only on
  // screen while something is hovered. Latest position lives in a ref (no
  // re-render); state is written only when a card is actually showing, so idle
  // orbiting and dragging cost zero React work.
  const live = useRef(false);
  const latest = useRef({ x: 0, y: 0 });
  const showing = !!hoveredId && hoveredId !== selectedId;
  live.current = showing;

  useEffect(() => {
    function onMove(e: MouseEvent) {
      latest.current = { x: e.clientX, y: e.clientY };
      if (live.current) setPos(latest.current);
    }
    window.addEventListener('pointermove', onMove);
    return () => window.removeEventListener('pointermove', onMove);
  }, []);

  // Sync once when a hover starts, so the card opens at the pointer instead of
  // wherever it was last written.
  useEffect(() => {
    if (showing) setPos(latest.current);
  }, [showing, hoveredId]);

  if (!showing || !part) return null;

  const left = Math.min(pos.x + 14, (typeof window !== 'undefined' ? window.innerWidth : 1440) - 200);
  const top = Math.min(pos.y - 10, (typeof window !== 'undefined' ? window.innerHeight : 900) - 50);
  return (
    <div
      className="truncate sentence-case"
      style={{
        position: 'fixed',
        left,
        top,
        zIndex: 'var(--z-popover)',
        maxWidth: 180,
        padding: '4px 10px',
        background: 'var(--paper)',
        border: '1px solid var(--hairline)',
        borderRadius: 'var(--r-2)',
        boxShadow: 'var(--shadow-lift)',
        fontSize: 'var(--fs-small)',
        fontWeight: 600,
        color: 'var(--ink)',
        pointerEvents: 'none',
      }}
    >
      {/* Falls back to the category word for a name that is only whitespace (a scene
          file can carry one) — a blank bubble is worse. */}
      {part.name.trim() || part.category}
    </div>
  );
}

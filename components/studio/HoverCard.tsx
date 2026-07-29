'use client';

import { useEffect, useRef, useState } from 'react';
import { useStudio, useSettings } from '@/lib/store';
import { useRoomPart } from '@/lib/room-scene';
import { formatDim } from '@/lib/units';
import { Pill } from '@/components/ui/primitives';
import type { CaptureSlot } from '@/lib/storage';

// Which wall photo a detected piece came from, in the words a decorator uses.
// The slot letters (n/e/s/w) are storage keys, not vocabulary.
const SLOT_WALL: Record<CaptureSlot, string> = {
  n: 'north wall',
  e: 'east wall',
  s: 'south wall',
  w: 'west wall',
};

export function HoverCard() {
  const hoveredId = useStudio((s) => s.hoveredPartId);
  const selectedId = useStudio((s) => s.selectedPartId);
  const part = useRoomPart(hoveredId);
  const dimUnit = useSettings((s) => s.dimUnit);
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

  const left = Math.min(pos.x + 14, (typeof window !== 'undefined' ? window.innerWidth : 1440) - 240);
  const top = Math.min(pos.y - 10, (typeof window !== 'undefined' ? window.innerHeight : 900) - 140);
  const dimDisplay = part.dimMM.map((mm) => formatDim(mm, dimUnit)).join(' × ') + ' ' + dimUnit;

  return (
    <div
      style={{
        position: 'fixed',
        left,
        top,
        zIndex: 'var(--z-popover)',
        width: 220,
        background: 'var(--paper)',
        border: '1px solid var(--hairline)',
        borderRadius: 'var(--r-2)',
        boxShadow: 'var(--shadow-lift)',
        overflow: 'hidden',
        pointerEvents: 'none',
      }}
    >
      {/* Single identity — the name. The category eyebrow used to sit above it,
          but name+category are near-duplicates ("Door" / "door") and could even
          conflict after a swap, so we show just the one label. */}
      <div
        style={{
          padding: '6px 10px',
          borderBottom: '1px solid var(--hairline)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          justifyContent: 'space-between',
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 600, textTransform: 'capitalize', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {part.name || part.category}
        </span>
        {part.locked && <Pill tone="locked" style={{ flexShrink: 0 }}>Locked</Pill>}
      </div>
      <div style={{ padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <Row label="Size" value={dimDisplay} mono />
        {/* Where it came from, not how sure the detector was: a confidence
            percentage is telemetry, and nothing the user can act on. */}
        {part.fromDetection && (
          <Row label="From" value={`Your ${SLOT_WALL[part.fromDetection.slot]} photo`} />
        )}
      </div>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '44px 1fr', gap: 6, fontSize: 11 }}>
      <span style={{ fontSize: 10.5, color: 'var(--ink-3)', fontWeight: 700 }}>{label}</span>
      <span className={mono ? 'mono' : undefined} style={{ fontSize: 11, color: 'var(--ink-2)' }}>
        {value}
      </span>
    </div>
  );
}

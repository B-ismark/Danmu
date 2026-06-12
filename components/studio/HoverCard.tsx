'use client';

import { useEffect, useState } from 'react';
import { useStudio, useSettings } from '@/lib/store';
import { useRoomPart } from '@/lib/room-scene';
import { formatDim } from '@/lib/units';

export function HoverCard() {
  const hoveredId = useStudio((s) => s.hoveredPartId);
  const selectedId = useStudio((s) => s.selectedPartId);
  const part = useRoomPart(hoveredId);
  const dimUnit = useSettings((s) => s.dimUnit);
  const [pos, setPos] = useState({ x: 0, y: 0 });

  useEffect(() => {
    function onMove(e: MouseEvent) {
      setPos({ x: e.clientX, y: e.clientY });
    }
    window.addEventListener('pointermove', onMove);
    return () => window.removeEventListener('pointermove', onMove);
  }, []);

  if (!hoveredId || hoveredId === selectedId || !part) return null;

  const left = Math.min(pos.x + 14, (typeof window !== 'undefined' ? window.innerWidth : 1440) - 240);
  const top = Math.min(pos.y - 10, (typeof window !== 'undefined' ? window.innerHeight : 900) - 140);
  const dimDisplay = part.dimMM.map((mm) => formatDim(mm, dimUnit)).join(' × ') + ' ' + dimUnit;

  return (
    <div
      style={{
        position: 'fixed',
        left,
        top,
        zIndex: 50,
        width: 220,
        background: 'var(--paper)',
        border: '1px solid var(--ink)',
        boxShadow: '0 4px 14px rgba(0,0,0,0.10)',
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
        <span
          className="ds-label"
          style={{
            flexShrink: 0,
            fontSize: 9,
            color: part.locked ? 'var(--locked)' : 'var(--accent)',
            padding: '1px 5px',
            border: `1px solid ${part.locked ? 'var(--locked)' : 'var(--accent)'}`,
          }}
        >
          {part.locked ? 'Locked' : 'New build'}
        </span>
      </div>
      <div style={{ padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <Row label="Dims" value={dimDisplay} mono />
        {part.fromDetection && (
          <Row label="Detect" value={`${part.fromDetection.slot} · ${(part.fromDetection.conf * 100).toFixed(0)}%`} mono />
        )}
      </div>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '60px 1fr', gap: 4, fontSize: 11 }}>
      <span className="ds-label" style={{ fontSize: 9 }}>{label}</span>
      <span className={mono ? 'mono' : undefined} style={{ fontSize: 10.5, color: 'var(--ink-2)' }}>
        {value}
      </span>
    </div>
  );
}

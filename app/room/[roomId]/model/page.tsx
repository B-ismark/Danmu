'use client';

import dynamic from 'next/dynamic';
import { useState } from 'react';
import { useStudio } from '@/lib/store';
import { CornerRegs } from '@/components/ui/primitives';
import { ViewPresetChips } from '@/components/studio/ViewPresetChips';
import { ViewOptions } from '@/components/studio/ViewOptions';
import { CatalogPanel } from '@/components/studio/CatalogPanel';
import { SelectionBar } from '@/components/studio/SelectionBar';
import { HoverCard } from '@/components/studio/HoverCard';
import { Inspector } from '@/components/studio/Inspector';
import { PartTree } from '@/components/studio/PartTree';
import { TransformToolbar } from '@/components/studio/TransformToolbar';
import { DemoBanner } from '@/components/studio/DemoBanner';
import { Icon } from '@/components/ui/Icon';

const Room = dynamic(() => import('@/components/three/Room').then((m) => m.Room), {
  ssr: false,
  loading: () => (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'grid',
        placeItems: 'center',
        color: 'var(--ink-3)',
        fontSize: 13,
      }}
    >
      Loading 3D engine…
    </div>
  ),
});

export default function ModelPage() {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr 320px', height: '100%' }}>
      <aside className="rail rail--left" style={{ minHeight: 0 }}>
        <PartTree />
      </aside>

      <main style={{ position: 'relative', overflow: 'hidden' }} className="ds-grid-bg">
        <CornerRegs color="var(--ink-3)" inset={10} size={10} />
        <Room />

        <div style={{ position: 'absolute', top: 12, left: 12 }}>
          <TransformToolbar />
        </div>

        <HoverCard />
        <HintPill />
        <CatalogPanel />
        <ViewOptions />
        <ViewPresetChips />
        <SelectionBar />
        <DemoBanner />
      </main>

      <aside className="rail rail--right" style={{ minHeight: 0 }}>
        <Inspector />
      </aside>
    </div>
  );
}

// Compact help affordance. Replaces the old always-on legend bar (which
// duplicated the TransformToolbar buttons and the left-rail instructions).
// Collapsed: a small "?" plus the active-mode dot when a part is selected.
// Hover or focus reveals the full shortcut card.
function HintPill() {
  const selected = useStudio((s) => s.selectedPartId);
  const mode = useStudio((s) => s.transformMode);
  const [open, setOpen] = useState(false);
  const verb = mode === 'translate' ? 'Move along floor' : mode === 'rotate' ? 'Rotate around Y' : 'Scale on all axes';

  return (
    <div
      style={{ position: 'absolute', bottom: 12, left: 12 }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      {open && (
        <div
          style={{
            position: 'absolute',
            bottom: 'calc(100% + 6px)',
            left: 0,
            background: 'var(--paper)',
            border: '1px solid var(--ink)',
            padding: '10px 14px',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            fontSize: 12,
            color: 'var(--ink-2)',
            boxShadow: '0 2px 10px rgba(0,0,0,0.1)',
            whiteSpace: 'nowrap',
          }}
        >
          <div><Kb>W</Kb>Move <Kb>S</Kb>Scale <Kb>R</Kb>Rotate</div>
          <div><Kb>F</Kb>Frame <Kb>V</Kb>Hide <Kb>Esc</Kb>Deselect</div>
          <div style={{ paddingTop: 4, borderTop: '1px solid var(--hairline)' }}>
            <Kb>↑↓←→</Kb>Pan <Kb>Q</Kb><Kb>E</Kb>Rotate
          </div>
          <div style={{ color: 'var(--ink-3)', fontSize: 11 }}>
            Left-drag orbit · right-drag pan · scroll zoom
          </div>
          <div style={{ color: 'var(--ink-3)', fontSize: 11 }}>
            Double-click a wardrobe or nightstand to open it
          </div>
          <div style={{ color: 'var(--ink-3)', fontSize: 11 }}>
            Click a wall to paint it or drag it to resize the room
          </div>
          <div style={{ color: 'var(--ink-3)', fontSize: 11 }}>
            Shift-click to multi-select · then Merge to move as one
          </div>
        </div>
      )}
      <button
        aria-label="Keyboard shortcuts"
        onClick={() => setOpen((v) => !v)}
        style={{
          height: 26,
          padding: selected ? '0 10px' : 0,
          width: selected ? 'auto' : 26,
          background: 'var(--paper)',
          border: '1px solid var(--hairline-strong)',
          borderRadius: 4,
          boxShadow: '0 2px 6px rgba(0,0,0,0.06)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          cursor: 'pointer',
          fontSize: 12,
        }}
      >
        {selected ? (
          <span style={{ color: 'var(--accent)', fontWeight: 500 }}>● {verb}</span>
        ) : (
          <span style={{ color: 'var(--ink-3)', fontFamily: 'var(--font-mono)' }}>?</span>
        )}
      </button>
    </div>
  );
}

function Kb({ children }: { children: React.ReactNode }) {
  return (
    <kbd
      style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 10,
        padding: '1px 5px',
        border: '1px solid var(--hairline-strong)',
        borderRadius: 2,
        marginRight: 4,
      }}
    >
      {children}
    </kbd>
  );
}

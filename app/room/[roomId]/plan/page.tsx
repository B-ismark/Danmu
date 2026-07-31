'use client';

import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { useParams } from 'next/navigation';
import { PartTree } from '@/components/studio/PartTree';
import { Inspector } from '@/components/studio/Inspector';
import { PlanView } from '@/components/studio/PlanView';
import { CatalogPanel, STUDIO_CANVAS_ID } from '@/components/studio/CatalogPanel';
import { useStackedStudio } from '@/components/studio/NarrowViewportBanner';
import { Icon } from '@/components/ui/Icon';
import { useScene } from '@/lib/scene-store';
import { useStudio, useSettings } from '@/lib/store';
import { exportPlanPng } from '@/lib/plan-export';
import { roomStore } from '@/lib/storage';
import { UNIT_OPTIONS } from '@/lib/units';
import type { ScenePart } from '@/lib/scene-spec';

export default function PlanPage() {
  const dimUnit = useSettings((s) => s.dimUnit);
  // See the note in the 3D page: `ready` keeps the first paint from using the
  // wrong shell and then reflowing.
  const { stacked, ready } = useStackedStudio();
  const { roomId } = useParams<{ roomId: string }>();
  const [roomName, setRoomName] = useState('Floor plan');
  // Live from PlanView, which owns the zoom. The old chip hard-coded "1:50 · cm"
  // while the drawing labelled millimetres, rendered at 100 px/m, and zoomed
  // 0.4×–4× — three false claims on the one screen someone might measure from.
  const [zoom, setZoom] = useState(1);
  const [comfort, setComfort] = useState(true);
  const catalogOpen = useStudio((s) => s.catalogOpen);

  useEffect(() => {
    if (!roomId) return;
    roomStore.loadRoom(roomId).then((r) => {
      if (r?.name) setRoomName(r.name);
    });
  }, [roomId]);

  const onViewChange = useCallback((v: { zoom: number }) => setZoom(v.zoom), []);

  const unitName = UNIT_OPTIONS.find((u) => u.id === dimUnit)?.label ?? dimUnit;

  function exportPlan() {
    const { parts, room } = useScene.getState();
    const { positions, rotations, dims } = useStudio.getState();
    const effParts: ScenePart[] = parts.map((p) => ({
      ...p,
      pos: positions[p.id] ?? p.pos,
      rot: rotations[p.id] ?? p.rot,
      dimMM: dims[p.id] ?? p.dimMM,
    }));
    exportPlanPng(effParts, room, dimUnit, roomName);
  }

  const shell: CSSProperties = stacked
    ? {
        gridTemplateColumns: '1fr',
        gridTemplateRows: 'minmax(300px, 55vh) auto auto',
        height: '100%',
        overflow: 'auto',
      }
    : { gridTemplateColumns: '260px 1fr 320px', height: '100%' };

  const railStyle: CSSProperties = stacked
    ? {
        minHeight: 0,
        height: 'auto',
        maxHeight: '60vh',
        borderLeft: 0,
        borderRight: 0,
        borderTop: '1px solid var(--hairline)',
      }
    : { minHeight: 0 };

  const tree = (
    <aside key="tree" className="rail rail--left" style={railStyle}>
      <PartTree />
    </aside>
  );

  const inspector = (
    <aside key="inspector" className="rail rail--right" style={railStyle}>
      <Inspector />
    </aside>
  );

  const plan = (
    <main
      key="plan"
      id={STUDIO_CANVAS_ID}
      style={{ position: 'relative', overflow: 'hidden', minHeight: stacked ? 300 : 0 }}
      className="ds-grid-bg"
    >
      <h1 className="sr-only">Your room as a floor plan</h1>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 40,
        }}
      >
        <PlanView onViewChange={onViewChange} showComfort={comfort} />
      </div>

      <div
        style={{
          position: 'absolute',
          top: 12,
          left: 12,
          display: 'flex',
          gap: 6,
          flexWrap: 'wrap',
          zIndex: 'var(--z-canvas-ui)',
        }}
      >
        {/* Says only what is true: the drawing is to scale, its numbers are in
            the unit Settings owns, and the magnification is whatever the user
            has zoomed to. No printed ratio — the SVG scales to fit its pane, so
            no fixed 1:n could survive a window resize. */}
        <span className="ds-chip" title={`Drawn to scale. Every dimension is in ${unitName.toLowerCase()}.`}>
          <Icon name="ruler" size={10} />
          To scale in <span className="mono">{dimUnit}</span> · <span className="mono">{Math.round(zoom * 100)}%</span>
        </span>
        <button
          onClick={() => setComfort((v) => !v)}
          aria-pressed={comfort}
          className={`ds-chip ${comfort ? 'ds-chip--accent' : ''}`}
          title="Shade the floor a person needs to walk, open a door, and get into bed"
          style={{
            cursor: 'pointer',
            fontWeight: 700,
            borderColor: comfort ? 'var(--accent-text)' : 'var(--edge)',
            background: comfort ? 'var(--accent-tint)' : 'var(--paper)',
          }}
        >
          <Icon name="crosshair" size={10} />
          Comfort zones
        </button>
      </div>

      {/* The same catalog the 3D tab uses, opened by the same rail button. Its
          rows are not draggable here — nothing on this page catches a drop — so
          it offers click-to-drop-in-the-centre instead of pretending otherwise. */}
      {catalogOpen && <CatalogPanel bottomGap={100} />}

      <div style={{ position: 'absolute', top: 12, right: 12, zIndex: 'var(--z-canvas-ui)' }}>
        <button
          onClick={exportPlan}
          className="ds-btn"
          title="Download a to-scale floor plan PNG"
          style={{ height: 30, fontSize: 11, borderColor: 'var(--edge)' }}
        >
          <Icon name="image" size={12} />
          Export plan
        </button>
      </div>
    </main>
  );

  if (!ready) {
    return (
      <div style={{ height: '100%', display: 'grid', placeItems: 'center', background: 'var(--paper-2)' }}>
        <span role="status" style={{ fontSize: 13, color: 'var(--ink-3)' }}>
          Drawing your floor plan…
        </span>
      </div>
    );
  }

  return (
    <div className="split split--stack" style={shell}>
      {stacked ? [plan, tree, inspector] : [tree, plan, inspector]}
    </div>
  );
}

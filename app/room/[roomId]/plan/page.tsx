'use client';

import { CornerRegs } from '@/components/ui/primitives';
import { PartTree } from '@/components/studio/PartTree';
import { Inspector } from '@/components/studio/Inspector';
import { PlanView } from '@/components/studio/PlanView';
import { Icon } from '@/components/ui/Icon';
import { useScene } from '@/lib/scene-store';
import { useStudio, useSettings } from '@/lib/store';
import { exportPlanPng } from '@/lib/plan-export';
import type { ScenePart } from '@/lib/scene-spec';

export default function PlanPage() {
  const dimUnit = useSettings((s) => s.dimUnit);

  function exportPlan() {
    const { parts, room } = useScene.getState();
    const { positions, rotations, dims } = useStudio.getState();
    const effParts: ScenePart[] = parts.map((p) => ({
      ...p,
      pos: positions[p.id] ?? p.pos,
      rot: rotations[p.id] ?? p.rot,
      dimMM: dims[p.id] ?? p.dimMM,
    }));
    exportPlanPng(effParts, room, dimUnit);
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr 320px', height: '100%' }}>
      <aside style={{ borderRight: '1px solid var(--hairline)', minHeight: 0 }}>
        <PartTree />
      </aside>

      <main style={{ position: 'relative', overflow: 'hidden' }} className="ds-grid-bg">
        <CornerRegs color="var(--ink-3)" inset={10} size={10} />
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
          <PlanView />
        </div>

        <div style={{ position: 'absolute', top: 12, left: 12, display: 'flex', gap: 6 }}>
          <span className="ds-chip">
            <Icon name="ruler" size={10} />
            1:50 · CM
          </span>
          <span className="ds-chip ds-chip--accent">PLAN</span>
        </div>

        <div style={{ position: 'absolute', top: 12, right: 12 }}>
          <button
            onClick={exportPlan}
            className="ds-btn"
            title="Download a to-scale floor plan PNG with dimensions and a furniture legend"
            style={{ height: 30, fontSize: 11, gap: 6, background: 'var(--paper)', boxShadow: '0 2px 6px rgba(0,0,0,0.06)' }}
          >
            <Icon name="image" size={12} />
            Export plan
          </button>
        </div>
      </main>

      <aside style={{ borderLeft: '1px solid var(--hairline)', minHeight: 0 }}>
        <Inspector />
      </aside>
    </div>
  );
}

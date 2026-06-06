'use client';

import { CornerRegs } from '@/components/ui/primitives';
import { PartTree } from '@/components/studio/PartTree';
import { Inspector } from '@/components/studio/Inspector';
import { PlanView } from '@/components/studio/PlanView';
import { Icon } from '@/components/ui/Icon';

export default function PlanPage() {
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
      </main>

      <aside style={{ borderLeft: '1px solid var(--hairline)', minHeight: 0 }}>
        <Inspector />
      </aside>
    </div>
  );
}

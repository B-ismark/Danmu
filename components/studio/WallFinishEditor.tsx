'use client';

// The Walls section's body: what every wall in the room is finished in, and — for brick
// and tile — the joints. Colour is NOT here: each wall keeps its own paint (select a wall
// to change it), and the finish multiplies it, so a pale wall over brick is painted
// brick. That split, and why the finish is one for the room, is `lib/wall-finish.ts`.

import { useScene } from '@/lib/scene-store';
import { WALL_KINDS, WALL_SPEC, resolveWalls, type WallKind } from '@/lib/wall-finish';
import type { Grout } from '@/lib/floor-finish';
import { Segmented } from '@/components/ui/primitives';
import { Icon } from '@/components/ui/Icon';
import { FinishStatus } from './FinishStatus';

/** The collapsed row's summary. */
export function wallsSummary(walls: ReturnType<typeof resolveWalls>): string {
  return WALL_SPEC[walls.kind].label;
}

export function WallFinishEditor() {
  const chosen = useScene((s) => s.room.walls);
  const setWalls = useScene((s) => s.setWalls);
  const walls = resolveWalls(chosen);
  const spec = WALL_SPEC[walls.kind];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
      <div style={{ minWidth: 0 }}>
        <span className="section-title" style={{ marginBottom: 6, display: 'block' }}>Finish</span>
        <Segmented<WallKind>
          ariaLabel="Wall finish"
          wrap
          minItem={76}
          options={WALL_KINDS.map((k) => ({ value: k, label: WALL_SPEC[k].label }))}
          value={walls.kind}
          onChange={(k) => {
            if (k !== walls.kind) setWalls(k === 'plaster' ? undefined : { kind: k });
          }}
        />
        <div className="t-hint" style={{ marginTop: 6 }}>
          {spec.note} Each wall keeps its own paint colour.
        </div>
      </div>

      {spec.joints && spec.jointLabel && (
        <div style={{ minWidth: 0 }}>
          <span className="section-title" style={{ marginBottom: 6, display: 'block' }}>{spec.jointLabel}</span>
          <Segmented<Grout>
            ariaLabel={spec.jointLabel}
            stretch
            options={[
              { value: 'match', label: 'Matching' },
              { value: 'dark', label: 'Contrast' },
            ]}
            value={walls.grout}
            onChange={(g) => setWalls({ kind: walls.kind, grout: g })}
          />
        </div>
      )}

      <FinishStatus channel="wall" saying="Finishing the walls…" />

      {chosen && (
        <button
          onClick={() => setWalls(undefined)}
          className="ds-btn ds-btn--xs ds-btn--ghost"
          title="Back to the painted plaster the room started with"
          style={{ alignSelf: 'flex-start', padding: '0 8px', fontWeight: 600, color: 'var(--accent-text)', gap: 4 }}
        >
          <Icon name="refresh" size={11} /> Plain plaster
        </button>
      )}
    </div>
  );
}

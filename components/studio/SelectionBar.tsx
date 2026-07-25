'use client';

// Floating action bar for multi-selection. Shift-click parts to build a
// selection, then Merge them into a group that moves as one. A merged group is
// selected whole on click; Ungroup splits it again.

import { useStudio } from '@/lib/store';
import { useScene } from '@/lib/scene-store';
import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/primitives';

export function SelectionBar() {
  const selection = useStudio((s) => s.selection);
  const primaryId = useStudio((s) => s.selectedPartId);
  const parts = useScene((s) => s.parts);
  const groupParts = useScene((s) => s.groupParts);
  const ungroupParts = useScene((s) => s.ungroupParts);
  const setSelection = useStudio((s) => s.setSelection);
  const setSelected = useStudio((s) => s.setSelected);

  const primary = parts.find((p) => p.id === primaryId);
  const grouped = !!primary?.groupId;
  const groupMembers = grouped ? parts.filter((p) => p.groupId === primary!.groupId).map((p) => p.id) : [];

  if (selection.length < 2 && !grouped) return null;

  return (
    <div
      className="ds-card"
      style={{
        position: 'absolute',
        bottom: 14,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 26,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 10px 8px 14px',
      }}
    >
      <span style={{ fontSize: 12.5, fontWeight: 700 }}>
        {grouped ? `Group · ${groupMembers.length} items` : `${selection.length} selected`}
      </span>
      <div style={{ display: 'flex', gap: 6 }}>
        {grouped ? (
          <button
            onClick={() => {
              ungroupParts(groupMembers);
              setSelected(primaryId);
            }}
            className="ds-btn"
            style={{ height: 30, fontSize: 12 }}
          >
            <Icon name="swap" size={12} /> Ungroup
          </button>
        ) : (
          <button
            onClick={() => groupParts(selection)}
            className="ds-btn ds-btn--accent"
            style={{ height: 30, fontSize: 12 }}
          >
            <Icon name="layers" size={12} /> Merge {selection.length}
          </button>
        )}
        <IconButton
          icon="x"
          label="Clear selection"
          onClick={() => setSelected(null)}
          size={30}
          iconSize={13}
        />
      </div>
    </div>
  );
}

'use client';

// Floating action bar for selection. It appears as soon as ONE piece is
// selected, because the shift-click gesture that builds a multi-selection was
// otherwise undiscoverable: the bar used to require two items, i.e. it only
// taught you the gesture after you had already guessed it. With one item it
// prompts; with two or more it merges; on a merged group it ungroups.

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
  const setSelected = useStudio((s) => s.setSelected);

  const primary = parts.find((p) => p.id === primaryId);
  const grouped = !!primary?.groupId;
  const groupMembers = grouped ? parts.filter((p) => p.groupId === primary!.groupId).map((p) => p.id) : [];

  if (selection.length === 0 && !grouped) return null;

  const canMerge = selection.length >= 2;

  return (
    <div
      className="ds-card"
      // A pill, not a banner. It shares the bottom band with the help corner and
      // the room dock, and at its old width — "Shift-click another piece to merge
      // them" spelled out in full — a one-item selection reached across the canvas
      // and covered the dock it was centred between.
      style={{
        position: 'absolute',
        bottom: 12,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 'var(--z-canvas-ui)',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '5px 6px 5px 12px',
        borderRadius: 'var(--r-full)',
        maxWidth: 'calc(100% - 28px)',
      }}
    >
      <span style={{ fontSize: 12.5, fontWeight: 700, whiteSpace: 'nowrap' }}>
        {grouped ? `Group · ${groupMembers.length}` : `${selection.length} selected`}
      </span>
      {!grouped && !canMerge && (
        // The gesture still has to be taught — it is the only route to a merge —
        // but four words and a tooltip carry it in a third of the width.
        <span
          title="Hold Shift and click a second piece, then Merge, and they move as one"
          style={{ fontSize: 12, color: 'var(--ink-2)', whiteSpace: 'nowrap' }}
        >
          Shift-click to merge
        </span>
      )}
      <div style={{ display: 'flex', gap: 4 }}>
        {grouped ? (
          <button
            onClick={() => {
              ungroupParts(groupMembers);
              setSelected(primaryId);
            }}
            className="ds-btn"
            style={{ height: 28, fontSize: 12 }}
          >
            <Icon name="swap" size={12} /> Ungroup
          </button>
        ) : (
          canMerge && (
            <button
              onClick={() => groupParts(selection)}
              className="ds-btn ds-btn--accent"
              title="These pieces will move as one"
              style={{ height: 28, fontSize: 12 }}
            >
              <Icon name="layers" size={12} /> Merge {selection.length}
            </button>
          )
        )}
        <IconButton
          icon="x"
          label="Clear selection"
          onClick={() => setSelected(null)}
          size={28}
          iconSize={13}
        />
      </div>
    </div>
  );
}

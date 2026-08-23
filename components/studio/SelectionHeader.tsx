'use client';

// The selection's own header, at the top of the Inspector.
//
// It used to be a floating pill centred on the canvas's bottom edge — a second
// surface answering the question the Inspector already exists to answer, in the
// one slot both references leave empty. Folding it in deletes a surface rather
// than moving one, and the merge gesture it teaches now sits directly above the
// panel that acts on the result.
//
// `ds-btn--accent` is deliberately NOT used here: this is a studio panel, not an
// onboarding flow-advance. See the rule beside the variants in globals.css.

import { useStudio } from '@/lib/store';
import { useScene } from '@/lib/scene-store';
import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/primitives';

export function SelectionHeader() {
  const selection = useStudio((s) => s.selection);
  const primaryId = useStudio((s) => s.selectedPartId);
  const parts = useScene((s) => s.parts);
  const groupParts = useScene((s) => s.groupParts);
  const ungroupParts = useScene((s) => s.ungroupParts);
  const setSelected = useStudio((s) => s.setSelected);

  const primary = parts.find((p) => p.id === primaryId);
  const grouped = !!primary?.groupId;
  const groupMembers = grouped ? parts.filter((p) => p.groupId === primary!.groupId).map((p) => p.id) : [];

  // One selected piece is the Inspector's normal state and needs no banner; this
  // appears when the selection is a SET, or a group, which is what the Inspector
  // alone cannot describe.
  const canMerge = selection.length >= 2;
  if (!grouped && !canMerge) return null;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        flexWrap: 'wrap',
        padding: '10px 16px',
        borderBottom: '1px solid var(--hairline)',
        background: 'var(--accent-tint)',
      }}
    >
      <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--accent-text)', whiteSpace: 'nowrap' }}>
        {grouped ? `Group · ${groupMembers.length}` : `${selection.length} selected`}
      </span>
      <span style={{ flex: 1 }} />
      {grouped ? (
        <button
          onClick={() => {
            ungroupParts(groupMembers);
            setSelected(primaryId);
          }}
          className="ds-btn"
          style={{ height: 26, fontSize: 11.5 }}
        >
          <Icon name="swap" size={11} /> Ungroup
        </button>
      ) : (
        <button
          onClick={() => groupParts(selection)}
          className="ds-btn"
          title="These pieces will move as one"
          style={{ height: 26, fontSize: 11.5 }}
        >
          <Icon name="layers" size={11} /> Merge {selection.length}
        </button>
      )}
      <IconButton icon="x" label="Clear selection" onClick={() => setSelected(null)} size={26} iconSize={12} />
    </div>
  );
}

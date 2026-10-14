'use client';

// The selection's own header, at the top of the Inspector.
//
// It used to be a floating pill centred on the canvas's bottom edge — a second
// surface answering the question the Inspector already exists to answer, in the
// one slot both references leave empty. Folding it in deletes a surface rather
// than moving one, and the grouping gesture it teaches now sits directly above the
// panel that acts on the result.
//
// It is also where blocks become a piece and a piece becomes blocks again
// (`lib/made-actions.ts`): "Save as piece" on a set, "Take apart" on a made piece.
// Both live here because both are about WHAT IS SELECTED as a whole, which is the
// question this header answers and the Inspector below it does not.
//
// `ds-btn--accent` is deliberately NOT used here: this is a studio panel, not an
// onboarding flow-advance. See the rule beside the variants in globals.css.

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useStudio } from '@/lib/store';
import { useScene } from '@/lib/scene-store';
import { currentRoomScene } from '@/lib/room-scene';
import { packIntoPiece, packPreview, packRefusal, takeApart } from '@/lib/made-actions';
import { piecesStore } from '@/lib/storage';
import type { MadeSpec } from '@/lib/made-piece';
import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/primitives';
import { toast } from '@/components/ui/StorageToast';
import { SavePieceDialog } from './SavePieceDialog';

type Saving = { spec: MadeSpec; ids: string[]; name: string; madeId?: string };

export function SelectionHeader() {
  const selection = useStudio((s) => s.selection);
  const primaryId = useStudio((s) => s.selectedPartId);
  const parts = useScene((s) => s.parts);
  const groupParts = useScene((s) => s.groupParts);
  const ungroupParts = useScene((s) => s.ungroupParts);
  const updatePart = useScene((s) => s.updatePart);
  const setSelected = useStudio((s) => s.setSelected);
  const [saving, setSaving] = useState<Saving | null>(null);

  const primary = parts.find((p) => p.id === primaryId);
  const grouped = !!primary?.groupId;
  const groupMembers = grouped ? parts.filter((p) => p.groupId === primary!.groupId).map((p) => p.id) : [];
  const made = primary?.shape === 'made' && primary.made ? primary : null;

  // One selected piece is the Inspector's normal state and needs no banner; this
  // appears when the selection is a SET, or a group, which is what the Inspector
  // alone cannot describe — or a made piece, which is a set folded into one.
  const canGroup = selection.length >= 2;
  if (!grouped && !canGroup && !made) return null;

  // The set a save would pack: the selection, or the whole group a click picked up.
  const setIds = canGroup ? selection : groupMembers;

  const startSave = () => {
    if (made && !canGroup && !grouped) {
      setSaving({ spec: made.made!, ids: [made.id], name: made.name, madeId: made.id });
      return;
    }
    const want = new Set(setIds);
    const chosen = currentRoomScene().filter((p) => want.has(p.id));
    const spec = packPreview(chosen);
    if (!spec) {
      toast({ title: packRefusal(chosen) ?? 'Those pieces could not be saved as one.', ttl: 6000 });
      return;
    }
    setSaving({ spec, ids: setIds, name: 'My piece' });
  };

  const finishSave = (name: string, modular: boolean) => {
    const s = saving;
    setSaving(null);
    if (!s) return;
    let spec: MadeSpec;
    if (s.madeId) {
      spec = { ...s.spec, modular: modular || undefined };
      if (!spec.modular) delete spec.modular;
      updatePart(s.madeId, { name, made: spec });
    } else {
      const out = packIntoPiece(s.ids, name, modular);
      if ('refused' in out) {
        toast({ title: out.refused, ttl: 6000 });
        return;
      }
      spec = out.made!;
    }
    piecesStore.save(name, spec).then(
      () => toast({ tone: 'success', title: `“${name}” is in My pieces`, ttl: 5000 }),
      () => toast({ tone: 'danger', title: 'The piece could not be saved to My pieces', message: 'It is still in this room.' }),
    );
  };

  const label = made && !canGroup && !grouped
    ? `${made.made!.blocks.length} ${made.made!.blocks.length === 1 ? 'block' : 'blocks'}`
    : grouped
      ? `Group · ${groupMembers.length}`
      : `${selection.length} selected`;

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
      <span style={{ fontSize: 'var(--fs-small)', fontWeight: 700, color: 'var(--accent-text)', whiteSpace: 'nowrap' }}>
        {label}
      </span>
      <span style={{ flex: 1 }} />
      {made && !canGroup && !grouped ? (
        <button
          onClick={() => takeApart(made.id)}
          className="ds-btn ds-btn--xs"
          title="Turn this piece back into its blocks, to change it."
        >
          <Icon name="ungroup" size={11} /> Take apart
        </button>
      ) : grouped ? (
        <button
          onClick={() => {
            ungroupParts(groupMembers);
            setSelected(primaryId);
          }}
          className="ds-btn ds-btn--xs"
        >
          <Icon name="ungroup" size={11} /> Ungroup
        </button>
      ) : (
        <button
          onClick={() => groupParts(selection)}
          className="ds-btn ds-btn--xs"
          title="Keep these pieces together. One click then selects the whole set."
        >
          <Icon name="layers" size={11} /> Group {selection.length}
        </button>
      )}
      <button
        onClick={startSave}
        className="ds-btn ds-btn--xs"
        title={
          made && !canGroup && !grouped
            ? 'Keep a copy of this piece in My pieces, to add to any room.'
            : 'Make these one piece, and keep it in My pieces to add to any room.'
        }
      >
        <Icon name="heart" size={11} /> {made && !canGroup && !grouped ? 'Save' : 'Save as piece'}
      </button>
      <IconButton icon="x" label="Clear selection" onClick={() => setSelected(null)} size={26} iconSize={12} />
      {/* Portalled: the rail is glass, and a `backdrop-filter` makes it the containing
          block for anything `position: fixed` inside it — the scrim would cover the rail
          and nothing else. */}
      {saving &&
        createPortal(
          <SavePieceDialog
            spec={saving.spec}
            defaultName={saving.name}
            onSave={finishSave}
            onClose={() => setSaving(null)}
          />,
          document.body,
        )}
    </div>
  );
}

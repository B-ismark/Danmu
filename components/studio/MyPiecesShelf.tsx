'use client';

// "My pieces" — what the user built from blocks and saved, at the top of the Library.
//
// It sits INSIDE the Library rather than beside it because adding a saved piece is
// adding a piece: one list of things you can put in the room, one search box over all
// of it. The shelf answers the same query the catalogue rows do, by name, and goes away
// entirely when nothing on it matches — an empty heading is a promise with nothing
// behind it.
//
// Rows are click-to-add only. A drag into the room would need the drop handlers to
// read and re-check a block list off the drag payload, which is a second door for an
// unchecked spec; the click path takes the spec straight from `piecesStore`, which has
// already read it the defensive way (`readMadeSpec`).

import { useEffect, useState } from 'react';
import { piecesStore, type MyPiece } from '@/lib/storage';
import { Icon } from '@/components/ui/Icon';
import { ShapeIcon } from '@/components/ui/ShapeIcon';
import { IconButton } from '@/components/ui/primitives';
import { toast } from '@/components/ui/StorageToast';

/** The saved pieces, kept current with every save and removal in this tab. */
export function useMyPieces(enabled: boolean): MyPiece[] {
  const [pieces, setPieces] = useState<MyPiece[]>([]);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    const load = () => {
      piecesStore.list().then(
        (list) => live && setPieces(list),
        () => live && setPieces([]),
      );
    };
    load();
    window.addEventListener('danmu:pieces-changed', load);
    return () => {
      live = false;
      window.removeEventListener('danmu:pieces-changed', load);
    };
  }, [enabled]);
  return pieces;
}

/** Saved pieces whose name holds every word of the query. */
export function matchMyPieces(pieces: readonly MyPiece[], query: string): MyPiece[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...pieces];
  return pieces.filter((p) => {
    const name = p.name.toLowerCase();
    return words.every((w) => name.includes(w));
  });
}

function forget(piece: MyPiece) {
  piecesStore.remove(piece.id).then(
    () =>
      toast({
        title: `“${piece.name}” removed from My pieces`,
        message: 'Copies already in a room stay where they are.',
        // The same id, so it comes back in the place it had.
        action: { label: 'Undo', onClick: () => void piecesStore.save(piece.name, piece.made, piece.id) },
        ttl: 8000,
      }),
    () => toast({ tone: 'danger', title: `“${piece.name}” could not be removed`, ttl: 6000 }),
  );
}

export function MyPiecesShelf({ pieces, onPick }: { pieces: readonly MyPiece[]; onPick: (piece: MyPiece, byPointer: boolean) => void }) {
  if (pieces.length === 0) return null;
  return (
    <div>
      <div
        className="ds-label"
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 'var(--z-sticky-local)',
          fontSize: 'var(--fs-micro)',
          padding: '2px 0 6px',
          background: 'var(--paper)',
          display: 'flex',
          justifyContent: 'space-between',
        }}
      >
        <span>My pieces</span>
        <span style={{ fontWeight: 600 }}>{pieces.length}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {pieces.map((piece) => {
          const [w, d, h] = piece.made.sizeMM;
          const count = piece.made.blocks.length;
          return (
            <div key={piece.id} style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
              <button
                type="button"
                className="ds-btn ds-btn--sm pick-row"
                onClick={(e) => onPick(piece, e.detail > 0)}
                title={`${w} × ${d} × ${h} mm · ${count} ${count === 1 ? 'block' : 'blocks'}${piece.made.modular ? ' · repeats when widened' : ''}`}
                style={{ flex: 1, minWidth: 0, justifyContent: 'flex-start', paddingLeft: 3, cursor: 'pointer' }}
              >
                <ShapeIcon shape="made" />
                <span className="truncate" style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                  {piece.name}
                </span>
                {piece.made.modular && (
                  <span title="Repeats when widened" style={{ display: 'inline-flex', flexShrink: 0, color: 'var(--ink-3)' }}>
                    <Icon name="layers" size={11} />
                  </span>
                )}
              </button>
              <IconButton
                icon="trash"
                label={`Remove “${piece.name}” from My pieces`}
                onClick={() => forget(piece)}
                size={28}
                iconSize={13}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

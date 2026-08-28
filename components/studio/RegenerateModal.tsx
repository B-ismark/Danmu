'use client';

import { useState } from 'react';
import type { LibraryItem, ScenePart } from '@/lib/scene-spec';
import { Icon } from '@/components/ui/Icon';
import { Modal } from '@/components/ui/Modal';
import { LibraryPicker } from './LibraryPicker';

// The ONE way to change which model a piece uses. It used to be two buttons
// side by side — "Swap model" (browse the catalog) and "AI refine" (describe it)
// — which were the same feature twice over, and the second claimed an AI that
// does not exist here: matching is local token search (lib/shape-search),
// instant and offline.
//
// That pair then became a Catalog | Describe it tab pair, which was the same
// mistake one layer in: a tab reads as a second way of finding something, and
// there is no second set of models to find. Every piece here is procedural and
// there is no mesh download path (rule 1), so "describe it" could only ever
// return a library row — which is what the library list already returns.
//
// The tab is gone and the part of it that was real went with it rather than
// being deleted: `LibraryPicker`'s search box is `rankLibrary` now, so it folds
// the same synonyms the describe box did ("office chair" finds the chairs), and
// it reads sizes out of what you type the same way, so "1200mm tall" still
// carries into the swap. `sizeFromQuery` is where that lives, and it clamps.
//
// The swap itself is handed back to the caller (`onSwap`), because re-grounding
// the piece for its new dimensions and mount type is physics the Inspector
// already owns — doing it twice is how a swapped-in mirror ended up sunk into
// the floor.
export function SwapModelModal({
  part,
  onClose,
  onSwap,
}: {
  part: ScenePart;
  onClose: () => void;
  /** apply the swap. The item's `dimMM` already carries any size the search words
   *  named, clamped into that piece's own range — `LibraryPicker` resolves it
   *  before handing the item over. Caller re-grounds and clears stale transforms. */
  onSwap: (item: LibraryItem, dimMM?: [number, number, number]) => void;
}) {
  // Seeded with the piece's current name, which is what the description box used
  // to be seeded with and is the reason this is stateful at all: opening the modal
  // on a piece called "office chair" should already be showing office chairs.
  const [query] = useState(part.name);

  return (
    <Modal
      onClose={onClose}
      labelledBy="swap-model-title"
      width={520}
      bodyPadding="20px 24px 12px"
      footer={
        <button onClick={onClose} className="ds-btn" style={{ flex: 1, height: 36, fontSize: 13, justifyContent: 'center' }}>
          Cancel
        </button>
      }
    >
      <div className="ds-kicker" style={{ marginBottom: 6, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <Icon name="swap" size={13} /> Change the model
      </div>
      <div id="swap-model-title" style={{ fontSize: 22, fontWeight: 600, marginBottom: 6, letterSpacing: '-0.01em' }}>
        {part.name}
      </div>
      <p style={{ fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.5, margin: '0 0 14px' }}>
        Pick a closer model. It stays where it is and keeps its colour and finish, and a
        size you type in the search (&quot;1200mm tall&quot;) carries over.
      </p>

      {/* `draggable` off: this sits in a dialog over the room, so a dragged row has
          nothing that can catch it, and a drag that cannot land is worse than no
          drag at all. No `onPickMany` either — swapping one piece for a SET is not
          a thing, and offering the Shift gesture here would lead nowhere. */}
      <LibraryPicker onPick={(item) => onSwap(item, item.dimMM)} initialQuery={query} maxHeight={320} />
    </Modal>
  );
}

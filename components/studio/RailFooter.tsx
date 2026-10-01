'use client';

// The right rail's pinned action row: finish with whatever is selected — delete
// the piece, or stop editing the wall — add a piece, start the room over.
//
// It was TWO bands, stacked. The Inspector ended with its own `--paper-2` strip
// holding a full-width "Delete from scene" (and the WALL panel an identical one
// holding "Done", which is the same defect in the state nobody reported);
// `RoomActions` sat immediately below it
// in a second `--paper-2` strip with the same `12px 16px` padding, holding Add
// plus the revert. Same tone, same padding, one under the other — which reads as
// one footer that has wrapped, and spends two rows of the narrowest column on
// screen saying what one row says.
//
// The Inspector's strip also carried `border-top: 1px solid var(--hairline)`, and
// that is the OTHER HALF of the line three separate reports called a horizontal
// scrollbar. Deleting it from `.rail-footer` left an identical rule one element
// up — same 1px, same `--hairline`, over the same `--paper-2`, directly under the
// same outlined button. A fix that moves a defect one element up is not a fix,
// and the only reason it read as one is that the two bands were indistinguishable
// on screen, which is the whole reason they are now a single band.
//
// Two consequences, both decisions rather than fallout:
//
//   · Delete is PINNED now. The Inspector is `overflow: auto` and its footer sat
//     inside it behind a `flex: 1` spacer, so the spacer pushed the button to the
//     bottom only while the panel FIT. On a tall selection — a sofa with colour,
//     surface and exact-size sections open — the delete button scrolled out of
//     the rail entirely.
//   · The labels are "Delete" and "Add", and WIDTH is the reason rather than
//     taste. `.ds-btn` is `padding: 0 16px` with an 8px icon gap and
//     `white-space: nowrap`; the right rail floors at `--rail-right-min`, the
//     footer spends 32px of that on its own padding, and the 32px revert square
//     plus two 8px gaps take 48 more. "Delete from scene" and "Add a piece"
//     together ask for more than what is left, so a three-up row would have
//     ellipsised BOTH labels at the app's NARROWEST SHIPPING rail rather than at
//     some unusual size — the fixed half of that sum is asserted in
//     `tests/reflow.test.ts`, derived from the same two files. "Add" is also
//     already what the canvas trigger says, so the pair of triggers now agree.
//
// Each label gets its own `<span>` to ellipsise in, which is the opt-out
// `.ds-btn`'s own comment in `globals.css` names: a bare label beside an icon is
// an anonymous flex item that no per-site rule can address, and `nowrap` sends
// the overflow out through the border rather than into an ellipsis. `flex: 1 1 0`
// with `minWidth: 0` on the wrapper is the other half — it sizes the BOX and lets
// it go below its own text; either half alone does nothing.
//
// The selection slot holds ONE control because the two selections are mutually
// exclusive by construction — `setSelected` clears `selectedWall` and
// `setSelectedWall` clears the part selection (`lib/store.ts`). So this is three
// controls at its widest, never four, and that is a property of the store rather
// than a hope about the UI.
//
// Scope: two of the three are about the ROOM and one is about the SELECTION,
// which is why this is `RailFooter` and not `RoomActions`. A file named for a set
// it no longer holds is the scar CLAUDE.md rule 1 describes.
//
// "Start over" puts the room back the way it first opened — the scan's furniture,
// or the starter arrangement. It used to be "Put everything back", which did less
// than it said: it dropped the move / turn / size overrides and left every piece
// added since, every recolour and every hidden piece where it was. What the start
// IS lives in `lib/room-start.ts`; this file asks whether there is anything to
// undo and does the writes. Its read of the override maps has no fallback, which is
// the case `lib/transforms.ts` allows: "has anything been overridden", not "what
// is this piece's transform".

import { usePhoneStudio } from './NarrowViewportBanner';
import { useMemo } from 'react';
import { useStudio } from '@/lib/store';
import { useScene } from '@/lib/scene-store';
import { hasEditsSinceStart, startingParts } from '@/lib/room-start';
import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/primitives';
import { Tooltip } from '@/components/ui/Tooltip';
import { useConfirm } from '@/components/ui/Confirm';
import { toast } from '@/components/ui/StorageToast';
import { AddPiecesButton } from './CatalogPanel';
import { removeParts, selectedIds } from './KeyboardShortcuts';

/** The label's own box, so it can ellipsise inside a `nowrap` pill. */
const LABEL = { overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 } as const;

export function RailFooter() {
  const selectedId = useStudio((s) => s.selectedPartId);
  const selectedWall = useStudio((s) => s.selectedWall);
  const setSelectedWall = useStudio((s) => s.setSelectedWall);
  const positions = useStudio((s) => s.positions);
  const rotations = useStudio((s) => s.rotations);
  const dims = useStudio((s) => s.dims);
  const hidden = useStudio((s) => s.hidden);
  const parts = useScene((s) => s.parts);
  const room = useScene((s) => s.room);
  const startSource = useScene((s) => s.startSource);
  // Rebuilt only when the room or what it was opened from changes — a drag writes
  // `positions`, not either of these — so a drag frame pays only for the compare.
  const start = useMemo(() => startingParts(startSource, room), [startSource, room]);
  const canStartOver = hasEditsSinceStart(parts, start, { positions, rotations, dims, hidden });
  // The NAME, not the parts array: subscribing to the list re-runs this on every
  // scene write, and all the footer needs is whether the selected id still names
  // a piece — plus the name itself, because "Delete" alone is a fine visible
  // label beside the panel that says what is selected and a useless accessible
  // one for a reader that arrives at the button on its own.
  const selectedName = useScene((s) =>
    selectedId ? s.parts.find((p) => p.id === selectedId)?.name ?? null : null,
  );
  // How many pieces the button will actually take, which is not always one. A
  // merged set is selected whole, so the accessible name has to say so — a button
  // that reads "Delete Bed" and removes three pieces is the defect this fixes
  // wearing a label. Subscribed to the COUNT rather than the array for the same
  // reason `selectedName` is: the footer re-runs on every scene write otherwise.
  const selectedCount = useStudio((s) => s.selection.length);
  const deleteLabel =
    selectedCount > 1
      ? `Delete ${selectedCount} selected pieces from the scene`
      : `Delete ${selectedName} from the scene`;
  const confirm = useConfirm();
  const phone = usePhoneStudio();

  // With Add moved to the toolbar, a phone's footer can have nothing to hold; an
  // empty tinted strip at the bottom of a sheet reads as a broken bar.
  if (phone && selectedWall === null && selectedName == null && !canStartOver) return null;

  return (
    <div className="rail-footer">
      {selectedWall !== null ? (
        <div style={{ minWidth: 0 }}>
          <button
            onClick={() => setSelectedWall(null)}
            className="ds-btn ds-btn--sm"
            title="Finish with this wall"
          >
            <Icon name="x" size={12} />
            <span style={LABEL}>Done</span>
          </button>
        </div>
      ) : selectedName != null ? (
        <div style={{ minWidth: 0 }}>
          {/* No confirm — pressing a button labelled Delete is a decision, and the
              shared path answers with an Undo toast rather than a dialog (see
              `removeParts`). Backspace is the one delete gesture that asks first,
              because it is the one that can be a typing reflex; see
              `deleteSelection`.

              `selectedIds()`, NOT `[selectedId]`. This button used to delete the
              primary id alone, so deleting a merged bed-and-two-nightstands from
              here removed the bed and silently left the nightstands — the button
              named one piece, the user meant the set, and the set is what every
              other surface deletes. `selectedPartId` is the piece a click LANDED
              on; the selection is what is selected, and a merged set is selected
              whole (`selectionForPick`). Anything acting on "what is selected"
              wants the latter. */}
          <button
            onClick={() => removeParts(selectedIds())}
            className="ds-btn ds-btn--sm"
            title={deleteLabel}
            aria-label={deleteLabel}
            style={{
              color: 'var(--danger)',
              borderColor: 'var(--danger)',
            }}
          >
            <Icon name="trash" size={12} />
            <span style={LABEL}>Delete</span>
          </button>
        </div>
      ) : null}
      {/* Each button as wide as its label, the way a dialog's actions sit: the
          destructive one leading, the one that adds trailing. Stretched halves read
          as a segmented control, and a lone "Add" spanning a 320px rail is a bar,
          not a button. */}
      {/* A phone's Add is its toolbar's primary action, one row below this. */}
      {!phone && (
        <div style={{ minWidth: 0, marginLeft: 'auto' }}>
          <AddPiecesButton />
        </div>
      )}
      {canStartOver && (
        <Tooltip label="Start over">
          <IconButton
            icon="rotate-ccw"
            label="Start over: put the room back the way it first opened"
            variant="outline"
            size={32}
            onClick={async () => {
              const ok = await confirm({
                title: 'Start over?',
                body: 'The room goes back to how it first opened: pieces you added are removed, and every move, size and colour is undone. The walls stay.',
                confirmLabel: 'Start over',
                danger: true,
              });
              if (ok) startOver(start);
            }}
          />
        </Tooltip>
      )}
    </div>
  );
}

/** Put the room back to `start`, with an Undo that brings back exactly what was
 *  there. Pieces, the move / turn / size overrides, what rides on what, what is
 *  hidden, and the selection — a selected piece the start does not have would leave
 *  the Inspector open on nothing. Locks stay: a lock is a promise about a piece, not
 *  an edit to it, and the start's pieces carry the same ids. The walls and their
 *  paint stay, which the confirm says. */
function startOver(start: ReturnType<typeof startingParts>) {
  const scene = useScene.getState();
  const studio = useStudio.getState();
  const before = {
    parts: scene.parts,
    positions: studio.positions,
    rotations: studio.rotations,
    dims: studio.dims,
    parentIds: studio.parentIds,
    hidden: studio.hidden,
    selection: studio.selection,
    selectedPartId: studio.selectedPartId,
  };
  scene.setParts(start);
  studio.resetTransforms();
  studio.setHiddenMap({});
  studio.setSelected(null);
  toast({
    title: 'The room is back to how it started',
    ttl: 6000,
    action: {
      label: 'Undo',
      onClick: () => {
        useScene.getState().setParts(before.parts);
        useStudio.setState({
          positions: before.positions,
          rotations: before.rotations,
          dims: before.dims,
          parentIds: before.parentIds,
          hidden: before.hidden,
          selection: before.selection,
          selectedPartId: before.selectedPartId,
          selectedWall: null,
        });
      },
    },
  });
}

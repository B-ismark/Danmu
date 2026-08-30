'use client';

// The right rail's pinned action row: finish with whatever is selected — delete
// the piece, or stop editing the wall — add a piece, put every piece back.
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
// `hasAnyOverride` lives here rather than in `PartTree` because this is now its
// only consumer. It is a raw read of the three override maps with no fallback,
// which is exactly the case `lib/transforms.ts` allows: the question is "has
// anything been overridden", not "what is this piece's transform".

import { useStudio } from '@/lib/store';
import { useScene } from '@/lib/scene-store';
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
  const resetTransforms = useStudio((s) => s.resetTransforms);
  const hasAnyOverride = useStudio(
    (s) =>
      Object.keys(s.positions).length > 0 ||
      Object.keys(s.rotations).length > 0 ||
      Object.keys(s.dims).length > 0,
  );
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

  return (
    <div className="rail-footer">
      {selectedWall !== null ? (
        <div style={{ flex: 1, minWidth: 0 }}>
          <button
            onClick={() => setSelectedWall(null)}
            className="ds-btn"
            title="Finish with this wall"
            style={{ width: '100%', height: 32, fontSize: 12, justifyContent: 'center' }}
          >
            <Icon name="x" size={12} />
            <span style={LABEL}>Done</span>
          </button>
        </div>
      ) : selectedName != null ? (
        <div style={{ flex: 1, minWidth: 0 }}>
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
            className="ds-btn"
            title={deleteLabel}
            aria-label={deleteLabel}
            style={{
              width: '100%',
              height: 32,
              fontSize: 12,
              justifyContent: 'center',
              color: 'var(--danger)',
              borderColor: 'var(--danger)',
            }}
          >
            <Icon name="trash" size={12} />
            <span style={LABEL}>Delete</span>
          </button>
        </div>
      ) : null}
      <div style={{ flex: 1, minWidth: 0 }}>
        <AddPiecesButton />
      </div>
      {hasAnyOverride && (
        <Tooltip label="Put everything back">
          <IconButton
            icon="rotate-ccw"
            label="Put every piece back where the room started"
            variant="outline"
            size={32}
            onClick={async () => {
              const ok = await confirm({
                title: 'Put every piece back?',
                body: 'Every move, turn and resize returns to where the room started. Colours, styles and pieces you added stay.',
                confirmLabel: 'Put them back',
                danger: true,
              });
              if (!ok) return;
              resetTransforms();
              toast({ title: 'Everything is back where it started', ttl: 4000 });
            }}
          />
        </Tooltip>
      )}
    </div>
  );
}

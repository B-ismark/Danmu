'use client';

// The two actions that are about the ROOM rather than about one piece: add a
// piece, and put every piece back.
//
// They were the left rail's pinned footer, which put them in the bottom-left
// corner of the window — the furthest point on screen from where a hand rests
// while it is editing a piece, and diagonally opposite the Inspector that answers
// every other question about what is selected. They are the right rail's footer
// now, pinned the same way: the last non-growing flex child of a column, so it
// never scrolls away without being `position: absolute` in a rail that clips.
//
// Two things about the pair worth stating, because both were decisions:
//
//   · It is a ROW, not a column. "Put everything back" is icon-only, sitting
//     beside Add rather than under it — the revert is the rarer of the two by a
//     wide margin, and it appears and disappears (see `hasAnyOverride`), so a
//     stacked layout would make the Add button jump every time the first drag
//     lands.
//   · The glyph is `rotate-ccw`, NOT `refresh`. `refresh` is Re-scan's icon in the
//     left rail's Room header, and it is also `CATEGORY_ICON.fan`. Once a control
//     loses its words the glyph IS the name, so two different verbs may not share
//     one — and `RotateCcw` is what a revert looks like everywhere else.
//
// `hasAnyOverride` lives here rather than in `PartTree` because this is now its
// only consumer. It is a raw read of the three override maps with no fallback,
// which is exactly the case `lib/transforms.ts` allows: the question is "has
// anything been overridden", not "what is this piece's transform".

import { useStudio } from '@/lib/store';
import { IconButton } from '@/components/ui/primitives';
import { Tooltip } from '@/components/ui/Tooltip';
import { useConfirm } from '@/components/ui/Confirm';
import { toast } from '@/components/ui/StorageToast';
import { AddPiecesButton } from './CatalogPanel';

export function RoomActions() {
  const resetTransforms = useStudio((s) => s.resetTransforms);
  const hasAnyOverride = useStudio(
    (s) =>
      Object.keys(s.positions).length > 0 ||
      Object.keys(s.rotations).length > 0 ||
      Object.keys(s.dims).length > 0,
  );
  const confirm = useConfirm();

  return (
    <div className="rail-footer">
      {/* `minWidth: 0` on the flex child, not on the button: `.ds-btn` is
          `white-space: nowrap`, so without this the "Close library" label plus a
          32px square pushes the row wider than the rail and the rail's
          `overflow: hidden` eats the difference with no scrollbar and no clue. */}
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

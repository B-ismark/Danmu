'use client';

// Adding pieces — ONE surface, two triggers.
//
// There used to be two. The rail's "Add furniture" opened a 520px modal with a
// Catalog / Describe-it pair over `PART_LIBRARY` + real-product presets; the
// canvas had a floating strip with its own grouped list over `PART_LIBRARY`
// alone. Same feature, two component trees, two item lists — and only the strip
// could drag a piece onto the floor, while only the modal could take a piece
// described in words. Whichever one you found first was missing something.
//
// What is left is the strip, because a modal cannot be dragged out of: it covers
// the room you are placing pieces into, and the drop point is the whole reason
// the canvas accepts a drag at all. It carries the modal's full item list, and both
// triggers (`AddPiecesButton` in the rail, `CatalogToggle` on the canvas) open this
// one panel through `useStudio`.
//
// The Describe-it tab that used to sit above the list is GONE, and its worth is
// not: it read as a way to reach models the library does not have, which rule 1
// forbids and no procedural catalog can do, while the part of it that was real —
// synonym-folded scoring and "queen bed 160x200cm" arriving at that size — is on
// the ordinary search box inside `LibraryPicker` now. One field, not two tabs.

import { useEffect } from 'react';
import { useStudio } from '@/lib/store';

import { type LibraryItem } from '@/lib/scene-spec';
import { addPieceToRoom } from '@/lib/add-piece';
import { sayAdded } from './say-added';
import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/primitives';
import { LibraryPicker } from './LibraryPicker';
import { isTypingOrDialog } from './KeyboardShortcuts';
import { announce } from '@/lib/announce';
import { usePhoneStudio } from './NarrowViewportBanner';
import { usePublishedBox } from './CanvasChrome';

/** The id the pages put on their canvas element, so the rail's trigger can bring
 *  the panel into view when the studio is stacked and the rail sits below the
 *  room. Without it, pressing Add on a narrow window opens a panel off-screen. */
export const STUDIO_CANVAS_ID = 'studio-canvas';

/** Rail trigger — the labelled one, in the right rail's pinned footer
 *  (`RailFooter`), beside Delete and the revert. */
export function AddPiecesButton() {
  const open = useStudio((s) => s.catalogOpen);
  const setOpen = useStudio((s) => s.setCatalogOpen);
  return (
    <button
      onClick={() => {
        const next = !open;
        setOpen(next);
        if (!next) return;
        // The CSS reduced-motion block cannot reach a JS-requested smooth scroll.
        const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        document
          .getElementById(STUDIO_CANVAS_ID)
          ?.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
      }}
      aria-expanded={open}
      title="Add a piece to the room"
      className="ds-btn ds-btn--sm"
      style={{
        background: 'var(--accent-tint)',
        // --accent as type on --accent-tint measures 2.89:1; --accent-text is
        // the accent-coloured ink that clears 4.5:1 on the same tint.
        borderColor: 'var(--accent-text)',
        color: 'var(--accent-text)',
      }}
    >
      {/* The label says the action, not the state: a button that reads "Library is
          open" is a status line you can press.
          It says "Add", not "Browse the library", because the user asked for a CTA
          that names what pressing it achieves. "Library" survives as the name of
          the collection it opens — the search field inside still searches the
          library, and `StudioHelp` still teaches Catalog-vs-Library — so rule 4's
          distinction is intact and the screen gains no second Catalog. The panel
          this opens is headed "Library"; see the note on that heading for why the
          button and the heading are named on different principles.

          One word rather than "Add a piece", and the reason is the row it sits in
          rather than brevity for its own sake: `RailFooter` puts it beside a
          labelled Delete and a 32px square inside a rail that floors at
          `--rail-right-min`, and the two longer labels together ask for more width
          than that leaves. The object is not lost — the `title` says "Add a piece
          to the room", the panel it opens is headed "Library", and the canvas
          trigger has read a bare "Add" all along, so the two triggers now agree.

          The label gets its own element so it can ellipsise: `.ds-btn` is
          `white-space: nowrap` and a bare text node beside an icon is an anonymous
          flex item that no per-site rule can reach, which sends the overflow out
          through the border instead. `globals.css` names this opt-out. */}
      <Icon name={open ? 'x' : 'plus'} size={12} />
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>
        {open ? 'Close' : 'Add'}
      </span>
    </button>
  );
}

/** Canvas trigger — sits in the top-left toolbar with the other controls that
 *  change a piece, rather than floating on its own. */
export function CatalogToggle() {
  const open = useStudio((s) => s.catalogOpen);
  const setOpen = useStudio((s) => s.setCatalogOpen);
  // A `.chrome-pill` like the rest of the cluster; open reads as the tinted capsule
  // (`aria-expanded`, globals.css). It sits in `CanvasTools`, which wraps, and
  // pills hold their width there — so it goes to a row of its own rather than being
  // compressed to an icon and half a word.
  return (
    <div className="chrome-pill">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="chrome-pill__text"
        title="Add a piece"
      >
        <Icon name="plus" size={12} /> Add
      </button>
    </div>
  );
}

/** Gravity-aware spawn: wall-hung items mount at height, everything else rests on
 *  the floor or on whatever surface is under it. Shared by both tabs — the piece
 *  you picked and the piece you described land the same way.
 *
 *  A CLICK has no aim point, so `openSpotForNewPart` finds one (§ H.3). It returns
 *  `undefined` for the first piece into an empty room, which is `placeNewPart`'s own
 *  no-aim behaviour unchanged; the drag-and-drop paths in `PlanView` and `Room` do not
 *  call it at all, because there the user aimed and being placed where you aimed is a
 *  promise.
 *
 *  The placing itself is `addPieceToRoom` (`lib/add-piece.ts`), shared with both
 *  tabs' drop handlers — see there for why it reads the parts itself rather than
 *  taking them.
 *
 *  `silent` is for the MANY case only. One press that adds seven pieces should say
 *  "7 pieces added.", not name seven of them in a row; one press that adds one
 *  should name it, which is what the 2D drop has always done and what neither this
 *  path nor the 3D drop did. Three ways to add a piece and one of them spoke.
 *
 *  `ownSize` is the Library row pressed with a size typed into the search — the retired
 *  Will it fit tab's question. Returns the new id, or null when the piece was refused
 *  (`sayAdded` has already said why). */
function spawn(item: LibraryItem, opts?: { silent?: boolean; ownSize?: boolean }): string | null {
  return sayAdded(addPieceToRoom({ label: item.label, category: item.category, shape: item.shape, dimMM: [...item.dimMM] }, undefined, opts), item.label);
}

/** Several at once, from a marked set.
 *
 *  Placed one after another rather than in parallel, and nothing already in the room
 *  moves — "add three of these" is not permission to rearrange what is there.
 *
 *  The sequencing now buys what an older version of this comment wrongly claimed it
 *  already did. That version said `placeNewPart` reads the parts in the room "so each
 *  piece avoids the one before it"; it reads `existing` in exactly ONE place —
 *  `findSupportDetailed`, and only when `isTabletopProne(cat)` — so a chair is not one,
 *  and four chairs landed at one point all facing the same way. **§ H.3, answered
 *  2026-09-03: fan out from the drop point with a legality gate.** `spawn` asks
 *  `openSpotForNewPart` first, and because each piece is added before the next one is
 *  placed, the loop really does step around what it has already put down. */
function spawnMany(items: LibraryItem[]) {
  const ids: string[] = [];
  // A refused piece is said on its own (`sayAdded`) and simply not counted: three
  // marked, one wider than every wall, is "2 pieces added." and one card naming it.
  for (const item of items) {
    const id = spawn(item, { silent: true });
    if (id) ids.push(id);
  }
  if (ids.length === 0) return;
  useStudio.getState().setSelection(ids, ids[ids.length - 1]);
  announce(`${ids.length} ${ids.length === 1 ? 'piece' : 'pieces'} added.`);
}

/** Floating, non-blocking model catalog docked on the RIGHT edge of the canvas.
 *  Items can be DRAGGED onto the 3D room (Room's onDrop raycasts the drop point)
 *  or CLICKED to drop at the first clear spot (§ H.3 — `openSpotForNewPart`).
 *  Deliberately a narrow strip so the rest of the canvas stays a valid drop target.
 *
 *  Right, not left, because both of its triggers are now on the right: the rail's
 *  `AddPiecesButton` moved to the right rail's footer, and pressing a control on
 *  one side to have a list appear on the other is a trip across the whole product.
 *  It also leaves the entire left of the canvas clear. */
export function CatalogPanel({
  /** false on the 2D plan, which has no drop handler — see LibraryPicker. */
  canDrag = false,
  /** How far to stop short of the bottom edge.
   *
   *  The reason this used to give was the help button in the bottom-LEFT corner.
   *  Help moved to the top bar, and `CanvasChrome` and `PlanChrome` both now state
   *  that bottom-left and bottom-centre are deliberately empty — so that reason had
   *  been false for a while and the number was surviving on nothing.
   *
   *  Docked right, it is load-bearing again, and against something real: the
   *  bottom-right `CanvasAide` slot. On the 3D tab that is `ViewGizmo`; on the 2D
   *  tab it is the taller `ComfortLegend`, and only while shading is on — which is
   *  why the plan passes a bigger number rather than sharing this one. */
  bottomGap = 56,
}: {
  canDrag?: boolean;
  bottomGap?: number;
}) {
  const setOpen = useStudio((s) => s.setCatalogOpen);
  const phone = usePhoneStudio();
  // Its width, so the sun's row over the canvas keeps clear of it (`CanvasDay`).
  const boxRef = usePublishedBox('--canvas-panel-width', null);

  // Esc closes it, like every other panel in the studio (Look, Room, help). It
  // yields to a field being edited or a dialog in front — so Esc out of the search
  // box goes to the box, not to the panel around it — and it stops the event from
  // reaching the canvas, whose global Esc means "deselect".
  useEffect(() => {
    // The phone's sheet closes on its own Escape; a window-wide one here would
    // take the key from a field inside it.
    if (phone) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape' || isTypingOrDialog(e.target)) return;
      e.stopPropagation();
      setOpen(false);
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [setOpen, phone]);

  // On a phone the Library is a sheet, not a card over the room: `SheetShell` shows
  // `LibraryBody` for the same `catalogOpen` flag.
  if (phone) return null;

  return (
    <div
      ref={boxRef}
      className="ds-card"
      style={{
        position: 'absolute',
        // Below the top-right cluster, measured rather than assumed. `CanvasView`
        // wraps — on the 2D tab it is undo/redo AND the whole zoom / rotate / fit
        // toolbar — so it is not one height, and a flat `54` (12 + a 30px control
        // + 12) slid this panel under a folded two-row cluster. It publishes its
        // own height for exactly this; the fallback reproduces the old number for
        // the one frame before the ResizeObserver reports, and for a jsdom render
        // where there is no layout at all.
        top: 'calc(12px + var(--canvas-view-height, 30px) + 12px)',
        right: 12,
        // Stops short of the bottom-RIGHT corner, which is where the one canvas
        // aide lives — see `bottomGap` above.
        bottom: bottomGap,
        // Capped against the canvas, not just stated: at 268px flat this covered
        // two thirds of a stacked layout's room, and you cannot drag a piece into
        // a room the panel you are dragging from is sitting on.
        width: 'min(268px, calc(100% - 24px))',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        zIndex: 'var(--z-canvas-ui)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 12px 8px' }}>
        {/* "Library", and the word came BACK rather than never having left.
            The heading read "Add pieces" — named for what you do with the list
            rather than for what the list holds — and the user's report was simply
            that "Library isn't on there". They were right, and the interesting part
            is how many places already said it was: THREE separate user-visible
            strings name this panel the Library — the help card's
            "Catalog is what is in this room; Library is what you can add", the sun
            note in the left rail's Look section ("Add a window or a door from the
            Library"), and the right-click menu's "Add from the Library…". Every one of
            them pointed at a panel whose own heading used a different word.

            So the fix is one heading rather than three strings, and the direction
            follows CLAUDE.md rule 4 instead of fighting it: the two lists are named
            for WHAT THEY HOLD, and "Add pieces" names what you do. It also makes
            rule 4's own sentence true again without editing the rule.

            The BUTTON stays "Add" and that is not the same decision: a button is
            named for its action and a list for its contents, so the pair is
            "press Add, the Library opens" — which is what every one of those three
            strings already assumed. */}
        <span className="ds-label" style={{ flex: 1 }}>Library</span>
        {/* Names the panel it closes, because an accessible name of bare "Close"
            tells a screen-reader user nothing about what is closing. */}
        <IconButton icon="x" label="Close the Library" onClick={() => setOpen(false)} size={24} iconSize={12} />
      </div>

      <LibraryBody canDrag={canDrag} />
    </div>
  );
}

/** The Library's list and its one line of instruction, without the floating card
 *  around it — so a phone can show the same list in its sheet (`SheetShell`) rather
 *  than a 268px card over a 360px room. */
export function LibraryBody({ canDrag = false, touch = false }: { canDrag?: boolean; touch?: boolean }) {
  // `item.dimMM` is already the size the search words asked for, clamped per
  // piece — `LibraryPicker` resolves it before handing the item over, so this path
  // and the drag path cannot disagree about what a query meant.
  function addItem(item: LibraryItem, how?: { ownSize?: boolean }) {
    spawn(item, { ownSize: how?.ownSize });
  }
  return (
    <div
      className={touch ? 'catalog-touch' : undefined}
      style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: touch ? '4px 16px 12px' : '0 12px 12px' }}
    >
      <LibraryPicker onPick={addItem} onPickMany={spawnMany} columns={1} draggable={canDrag && !touch} maxHeight={null} />
    </div>
  );
}

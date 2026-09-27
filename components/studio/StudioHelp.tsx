'use client';

// The studio's one help surface, for both tabs, in the top bar.
//
// It used to hold the canvas's bottom-left corner permanently — a 30px button
// most people press once, defending a slot with `--z-canvas-hint` so no panel
// could bury it. Moving it to the top bar frees that corner and puts it where
// every other tool keeps help.
//
// It used to fire one-time coach marks after the first drag and the first wall
// selection. They were deleted with the rest of the unsolicited tips: help is
// here when someone asks for it, and nothing pops up to teach a gesture.
//
// Both tabs' shortcut content lives here rather than in either page, because the
// two used to describe the same app differently and nobody comparing them was
// looking at both.

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Icon } from '@/components/ui/Icon';
import { HelpCard, HelpGroup, HelpLine, Kb } from './HelpCard';
import { isTypingOrDialog } from './KeyboardShortcuts';
import { usePhoneStudio, useStudioLayout } from './NarrowViewportBanner';
import { useMediaQuery } from '@/lib/use-media-query';

/** `hideTrigger` + `open` / `onOpenChange` are for the phone app bar, where the card
 *  is opened from the More menu rather than from its own button. */
export function StudioHelp({
  hideTrigger = false,
  open: openProp,
  onOpenChange,
}: {
  hideTrigger?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
} = {}) {
  const pathname = usePathname();
  const onModel = pathname?.endsWith('/model') ?? false;
  const touch = useMediaQuery('(pointer: coarse)');

  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  // Read through a ref so the Escape listener below can close a controlled card
  // without re-subscribing on every render of its owner.
  const control = useRef({ controlled: openProp !== undefined, onOpenChange });
  control.current = { controlled: openProp !== undefined, onOpenChange };
  const setOpen = (next: boolean) => {
    if (control.current.controlled) control.current.onOpenChange?.(next);
    else setOpenState(next);
  };
  const btnRef = useRef<HTMLButtonElement>(null);

  // Esc closes help before it reaches the global "deselect" binding. Capture on
  // window runs first and stops the event from ever bubbling back there.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      // Escape belongs to a field being edited, or to a dialog in front of us,
      // before it belongs to the help card.
      if (isTypingOrDialog(e.target)) return;
      // See ExportMenu: a plain stop still lets a sibling capture listener on
      // window fire, so one Esc closed both popovers.
      e.stopImmediatePropagation();
      e.stopPropagation();
      if (control.current.controlled) control.current.onOpenChange?.(false);
      else setOpenState(false);
      btnRef.current?.focus();
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open]);

  return (
    <div style={{ position: 'relative', display: 'flex' }}>
      {/* A question mark, not a sentence. "How this works" spent 150px saying what
          the universal glyph says in 30, on a control most people press once. The
          accessible name still carries the words. */}
      {/* Not rendered, rather than `hidden`: `.icon-btn` sets `display`, which
          outranks the attribute, and the trigger was drawn beside More anyway. */}
      {!hideTrigger && (
        <button
          ref={btnRef}
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-label="How this works"
          title="How this works"
          className="icon-btn"
          style={{
            width: 28,
            height: 28,
            borderRadius: 'var(--r-full)',
            border: `1px solid ${open ? 'var(--accent-text)' : 'var(--edge)'}`,
            background: open ? 'var(--accent-tint)' : 'var(--paper)',
            color: open ? 'var(--accent-text)' : 'var(--ink-2)',
          }}
        >
          <Icon name="help" size={14} />
        </button>
      )}

      {open && (
        <div className="help-pop">
          <HelpCard
            title="How this works"
            onClose={() => {
              setOpen(false);
              btnRef.current?.focus();
            }}
          >
            {/* A touch screen gets the card for its hands. The desktop cards teach
                right-click, Alt-click, Shift-click and a row of keys, and none of
                those exist under a finger — on a phone this card was a list of
                things you cannot do. The verb follows the POINTER, not the width:
                a tablet is a touch screen at a laptop's width. */}
            {touch ? onModel ? <ModelTouchHelp /> : <PlanTouchHelp /> : onModel ? <ModelHelp /> : <PlanHelp />}
          </HelpCard>
        </div>
      )}
    </div>
  );
}

function ModelHelp() {
  return (
    <>
      <HelpGroup title="Moving furniture">
        <HelpLine>Drag a piece to slide it around the floor. It stops against whatever is in the way.</HelpLine>
        <HelpLine>Scroll while dragging to spin the piece.</HelpLine>
        <HelpLine>Shift-click to select more than one piece. Drag any of them to move them all.</HelpLine>
        <HelpLine>
          <b>Group</b> keeps a selection together. One click then selects the whole set.
        </HelpLine>
        <HelpLine>Double-click a wardrobe or a nightstand to open its doors and drawers.</HelpLine>
        <HelpLine>
          Where pieces overlap, <Kb>Alt</Kb>-click lists everything under the pointer. <Kb>Alt</Kb>-click again to
          step through them.
        </HelpLine>
        <HelpLine>
          Add <Kb>Shift</Kb> to add that piece to the selection instead of replacing it.
        </HelpLine>
      </HelpGroup>

      <TwoLists />

      <HelpGroup title="Walls and the room">
        <HelpLine>Click a wall to pick a colour for it. Drag it to make the room bigger or smaller.</HelpLine>
      </HelpGroup>

      <HelpGroup title="Getting around">
        <HelpLine>Left-drag to orbit, scroll to zoom.</HelpLine>
        <HelpLine>
          Hold <Kb>Space</Kb> and drag to pan.
        </HelpLine>
        <HelpLine>Right-click a piece or the room to see what you can do.</HelpLine>
        <HelpLine>
          <Kb>↑</Kb>
          <Kb>↓</Kb>
          <Kb>←</Kb>
          <Kb>→</Kb> pan the camera · <Kb>Q</Kb>
          <Kb>E</Kb> swing it round
        </HelpLine>
      </HelpGroup>

      <HelpGroup title="Keys" note="Click the room first. Keys do nothing while you are in a panel.">
        <HelpLine>
          <Kb>W</Kb> move · <Kb>S</Kb> resize · <Kb>R</Kb> spin
        </HelpLine>
        <HelpLine>
          <Kb>F</Kb> fly to the selection · <Kb>H</Kb> hide it · <Kb>Esc</Kb> put a drag back, or deselect
        </HelpLine>
        <HelpLine>
          <Kb>Del</Kb> remove the selection · <Kb>Ctrl</Kb>
          <Kb>D</Kb> duplicate · <Kb>Ctrl</Kb>
          <Kb>A</Kb> select everything
        </HelpLine>
        <HelpLine>
          <Kb>Ctrl</Kb>
          <Kb>Z</Kb> undo · add <Kb>Shift</Kb> to redo
        </HelpLine>
      </HelpGroup>
    </>
  );
}

// The one group both cards render, and the reason it is a component rather than a
// paragraph in each: it names WHERE two panels are, and a direction is the thing that
// goes stale. It went stale once already — "the lists on the left" was true of both
// until the Library moved to the right edge of the canvas with its trigger, and the
// piece list's empty state was saying "Add a piece above" of a button that had moved to
// the other rail in the same round. So the heading names the lists instead of a side,
// the line says which is where, and there is one copy of it to keep true.
//
// (The sun note's "from the Library" is not one of these: it names the list, not a
// direction, so it was true before that round and is true after.)
//
// Both tabs get it because both tabs HAVE both lists: `DockedShell` is the one shell,
// so `PartTree` is in the left rail on the plan as well, and the plan page renders the
// same `CatalogPanel` on the right. A person who opened Help on the plan used to be
// told about pieces, panning and keys and never what the two lists were — a signpost
// gap one tab wide, filed as § G.3.
// Where the Catalog is depends on the shell, so the sentence reads the shell rather
// than asserting one answer. Below `STACK_WIDTH` (1023px) `DockedShell` renders ONE
// column with the Catalog as a full-width panel under the room and there is no left
// rail at all — and that is not an exotic viewport: 200% zoom on an ordinary 1280px
// laptop reports 640px, so the reader most likely to be told to look in a rail that
// does not exist is the one least able to go hunting for it.
//
// The Library half needs no branch: `CatalogPanel` is `position: absolute; right: 12`
// inside the canvas at every width, so "on the right of the canvas" is true stacked
// or not. Deriving only the half that moves is deliberate — a second branch that
// always picks the same answer is a second thing to keep true for nothing.
function TwoLists() {
  const { layout } = useStudioLayout();
  const phone = usePhoneStudio();
  const touch = useMediaQuery('(pointer: coarse)');
  // Three shells, three places. A phone has no Library card on the canvas at all:
  // both lists are sheets, opened from the toolbar.
  const catalogAt = phone
    ? 'under Room in the toolbar'
    : layout === 'stacked'
      ? 'on the Room tab of the panel beside the room'
      : 'in the left rail';
  const libraryAt = phone ? 'under Add' : 'on the right of the canvas';
  return (
    <HelpGroup title="The two lists">
      <HelpLine>
        <b>Catalog</b>, {catalogAt}, is what is in this room; <b>Library</b>, {libraryAt}, is what you can add.
      </HelpLine>
      {touch ? (
        <HelpLine>Tap a piece in the Library to drop it into the first clear spot.</HelpLine>
      ) : (
        <HelpLine>
          In either list, <Kb>Shift</Kb>-click picks a run of rows. <Kb>Ctrl</Kb>-click adds that piece to the
          room.
        </HelpLine>
      )}
    </HelpGroup>
  );
}

// The two touch cards. Every line is a gesture this app actually answers under a
// finger, and each was checked against the code that answers it rather than
// assumed from the desktop card: one finger orbits and two pinch and pan in 3D
// (drei's OrbitControls, whose touch defaults `CameraRig` does not override); one
// finger pans and two pinch on the plan (`PlanView`'s own touch branch); a piece
// drags under a finger on both. What has no touch form — multi-select, the
// context menu, Alt-click's list, the keys — is left out rather than translated
// into a gesture that does nothing.
function ModelTouchHelp() {
  const phone = usePhoneStudio();
  return (
    <>
      <HelpGroup title="Moving furniture">
        <HelpLine>Drag a piece to slide it around the floor. It stops against whatever is in the way.</HelpLine>
        <HelpLine>
          <b>Move</b>, <b>Scale</b> and <b>Rotate</b> at the top choose what dragging does.
        </HelpLine>
        <HelpLine>
          Tap a piece to select it. Then {phone ? 'tap its name in the toolbar' : 'open Details'} for its colour,
          style and size.
        </HelpLine>
      </HelpGroup>

      <TwoLists />

      <HelpGroup title="Walls and the room">
        <HelpLine>Tap a wall to pick a colour for it. Drag it to make the room bigger or smaller.</HelpLine>
      </HelpGroup>

      <HelpGroup title="Getting around">
        <HelpLine>One finger on empty space turns the view. Two fingers pinch to zoom and pan.</HelpLine>
        <HelpLine>The buttons in the corner jump to set views: from above, the front wall, the corner.</HelpLine>
        {phone && <HelpLine>Snap and the exports are under More (⋯) at the top.</HelpLine>}
      </HelpGroup>
    </>
  );
}

function PlanTouchHelp() {
  const phone = usePhoneStudio();
  return (
    <>
      <HelpGroup title="Moving furniture">
        <HelpLine>Drag a piece to move it. It stops against whatever is in the way.</HelpLine>
        <HelpLine>It tints red if it cannot go there.</HelpLine>
        <HelpLine>Drag the handle on a chosen piece to turn it.</HelpLine>
        <HelpLine>Tap a wall to paint it, or drag it to make the room bigger or smaller.</HelpLine>
      </HelpGroup>

      <TwoLists />

      <HelpGroup title="Getting around">
        <HelpLine>One finger on empty floor slides the drawing. Two fingers pinch to zoom.</HelpLine>
        {phone && <HelpLine>Snap and the exports are under More (⋯) at the top.</HelpLine>}
      </HelpGroup>
    </>
  );
}

// The plan tab's half. It lived in `PlanChrome.tsx` — beside the zoom toolbar and the
// legend — while the 3D half lived here, which is exactly the split this file and
// `HelpCard.tsx` both already warned about in prose: "nobody comparing them was ever
// looking at both". Two cards describing one app belong where a reader can read them
// together, and the drift that split produced was a whole group missing from one of
// them for as long as anyone had been looking.
function PlanHelp() {
  return (
    <>
      <HelpGroup title="Moving furniture">
        <HelpLine>Drag a piece to move it. It stops against whatever is in the way.</HelpLine>
        <HelpLine>It tints red if it cannot go there. So does any selected piece that runs out of room.</HelpLine>
        <HelpLine>While you drag, it shows the distance to the nearest walls.</HelpLine>
        <HelpLine>
          <Kb>Esc</Kb> part-way through a drag puts the piece back where it was.
        </HelpLine>
        <HelpLine>Drag the handle on a selected piece to turn it.</HelpLine>
        <HelpLine>Click a wall to paint it, or drag it to make the room bigger or smaller.</HelpLine>
      </HelpGroup>

      <TwoLists />

      <HelpGroup title="Choosing pieces">
        <HelpLine>Drag across empty floor to lasso several pieces.</HelpLine>
        <HelpLine>
          Hold <Kb>Shift</Kb> to add to the selection, by lasso or by click.
        </HelpLine>
        <HelpLine>
          {/* The line break must not fall between a word and a keycap. JSX strips the
              trailing newline and indent from a text chunk, and `Kb` has `marginRight`
              but no left margin, so "Keep" followed by a newline and <Kb>Alt</Kb>
              rendered as "KeepAlt". The sibling line in `ModelHelp` is safe only
              because its break happens to fall inside one text chunk — which is why
              this is written with the space made explicit rather than moved. */}
          Where pieces overlap, <Kb>Alt</Kb>-click lists everything under the pointer and lets you pick.
          Keep{' '}
          <Kb>Alt</Kb>-clicking the same spot to step through them.
        </HelpLine>
        <HelpLine>Right-click a piece or the plan to see what you can do, including that same list.</HelpLine>
      </HelpGroup>

      <HelpGroup title="Getting around">
        <HelpLine>Pinch or scroll to zoom.</HelpLine>
        <HelpLine>
          To pan: two fingers, middle-drag, <Kb>Shift</Kb>-scroll, or hold <Kb>Space</Kb> and drag.
        </HelpLine>
        <HelpLine>
          <Kb>[</Kb>
          <Kb>]</Kb> turn the page, not the furniture · <Kb>0</Kb> puts the view back
        </HelpLine>
      </HelpGroup>

      <HelpGroup title="Keys" note="Click the drawing first. Keys do nothing while you are in a panel.">
        <HelpLine>
          <Kb>↑</Kb>
          <Kb>↓</Kb>
          <Kb>←</Kb>
          <Kb>→</Kb> nudge whatever is focused · hold <Kb>Shift</Kb> to turn it
        </HelpLine>
        <HelpLine>
          <Kb>F</Kb> brings the selected piece to the middle · <Kb>H</Kb> hides it
        </HelpLine>
        <HelpLine>
          <Kb>Tab</Kb> steps through the pieces and the walls · <Kb>Esc</Kb> deselects
        </HelpLine>
      </HelpGroup>
    </>
  );
}

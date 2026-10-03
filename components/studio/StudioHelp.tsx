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
// looking at both. Each card is a list of sections (`HelpSectionSpec`) that
// `HelpDialog` lays out; keys are rows of a table, not sentences with keycaps in.

import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePathname } from 'next/navigation';
import { Icon } from '@/components/ui/Icon';
import { Tooltip } from '@/components/ui/Tooltip';
import { HelpDialog, HelpKey, HelpKeys, HelpLine, Kb, type HelpSectionSpec } from './HelpCard';
import { usePhoneStudio, useStudioLayout } from './NarrowViewportBanner';
import { useMediaQuery } from '@/lib/use-media-query';

/** `hideTrigger` + `open` / `onOpenChange` are for the phone app bar, where the dialog
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
  const phone = usePhoneStudio();

  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const setOpen = (next: boolean) => {
    if (openProp !== undefined) onOpenChange?.(next);
    else setOpenState(next);
  };
  const btnRef = useRef<HTMLButtonElement>(null);

  // A touch screen gets the sections for its hands. The desktop ones teach
  // right-click, Alt-click, Shift-click and a row of keys, and none of those
  // exist under a finger — on a phone that was a list of things you cannot do.
  // The verb follows the POINTER, not the width: a tablet is a touch screen at
  // a laptop's width.
  const sections = touch
    ? onModel
      ? modelTouchSections(phone)
      : planTouchSections(phone)
    : onModel
      ? modelSections()
      : planSections();

  return (
    <>
      {/* A question mark, not a sentence. "How this works" spent 150px saying what
          the universal glyph says in 30, on a control most people press once. The
          accessible name still carries the words, and the hover label is the app's
          own Tooltip rather than a native title. */}
      {/* Not rendered, rather than `hidden`: `.icon-btn` sets `display`, which
          outranks the attribute, and the trigger was drawn beside More anyway. */}
      {!hideTrigger && (
        <Tooltip label="How this works" placement="bottom">
          <button
            ref={btnRef}
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            aria-haspopup="dialog"
            aria-label="How this works"
            className="icon-btn icon-btn--round"
          >
            <Icon name="help" size={14} />
          </button>
        </Tooltip>
      )}

      {/* Portalled out of the bar: a `position: fixed` box inside an ancestor with a
          backdrop filter is placed against that ancestor, not the screen. `Modal` owns
          Esc, the scrim press, the focus trap and giving focus back to whatever opened
          it — the trigger, or the More row on a phone. */}
      {open &&
        createPortal(<HelpDialog title="How this works" sections={sections} onClose={() => setOpen(false)} />, document.body)}
    </>
  );
}

function modelSections(): HelpSectionSpec[] {
  return [
    {
      id: 'move',
      nav: 'Moving',
      icon: 'pointer',
      title: 'Moving furniture',
      body: (
        <>
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
        </>
      ),
    },
    twoListsSection(),
    {
      id: 'walls',
      nav: 'Walls',
      icon: 'home',
      title: 'Walls and the room',
      body: <HelpLine>Click a wall to pick a colour for it. Drag it to make the room bigger or smaller.</HelpLine>,
    },
    {
      id: 'around',
      nav: 'Around',
      icon: 'compass',
      title: 'Getting around',
      body: (
        <>
          <HelpLine>Left-drag to orbit, scroll to zoom.</HelpLine>
          <HelpLine>
            Hold <Kb>Space</Kb> and drag to pan.
          </HelpLine>
          <HelpLine>Right-click a piece or the room to see what you can do.</HelpLine>
          <HelpKeys>
            <HelpKey
              keys={
                <>
                  <Kb>↑</Kb>
                  <Kb>↓</Kb>
                  <Kb>←</Kb>
                  <Kb>→</Kb>
                </>
              }
            >
              pan the camera
            </HelpKey>
            <HelpKey
              keys={
                <>
                  <Kb>Q</Kb>
                  <Kb>E</Kb>
                </>
              }
            >
              swing it round
            </HelpKey>
          </HelpKeys>
        </>
      ),
    },
    {
      id: 'keys',
      nav: 'Shortcuts',
      icon: 'key',
      title: 'Keys',
      note: 'Click the room first. Keys do nothing while you are in a panel.',
      body: (
        <HelpKeys>
          <HelpKey keys={<Kb>W</Kb>}>move</HelpKey>
          <HelpKey keys={<Kb>S</Kb>}>resize</HelpKey>
          <HelpKey keys={<Kb>R</Kb>}>spin</HelpKey>
          <HelpKey keys={<Kb>F</Kb>}>fly to the selection</HelpKey>
          <HelpKey keys={<Kb>H</Kb>}>hide it</HelpKey>
          <HelpKey keys={<Kb>Esc</Kb>}>put a drag back, or deselect</HelpKey>
          <HelpKey keys={<Kb>Del</Kb>}>remove the selection</HelpKey>
          <HelpKey
            keys={
              <>
                <Kb>Ctrl</Kb>
                <Kb>D</Kb>
              </>
            }
          >
            duplicate
          </HelpKey>
          <HelpKey
            keys={
              <>
                <Kb>Ctrl</Kb>
                <Kb>A</Kb>
              </>
            }
          >
            select everything
          </HelpKey>
          <HelpKey
            keys={
              <>
                <Kb>Ctrl</Kb>
                <Kb>Z</Kb>
              </>
            }
          >
            undo · add <Kb>Shift</Kb> to redo
          </HelpKey>
        </HelpKeys>
      ),
    },
  ];
}

// The one section both desktop and touch cards render, and the reason it is a component
// rather than a paragraph in each: it names WHERE two panels are, and a direction is the
// thing that goes stale. It went stale once already — "the lists on the left" was true of
// both until the Library moved to the right edge of the canvas with its trigger, and the
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
    <>
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
    </>
  );
}

function twoListsSection(): HelpSectionSpec {
  return { id: 'lists', nav: 'Lists', icon: 'list', title: 'The two lists', body: <TwoLists /> };
}

// The two touch cards. Every line is a gesture this app actually answers under a
// finger, and each was checked against the code that answers it rather than
// assumed from the desktop card: one finger orbits and two pinch and pan in 3D
// (drei's OrbitControls, whose touch defaults `CameraRig` does not override); one
// finger pans and two pinch on the plan (`PlanView`'s own touch branch); a piece
// drags under a finger on both. What has no touch form — multi-select, the
// context menu, Alt-click's list, the keys — is left out rather than translated
// into a gesture that does nothing.
function modelTouchSections(phone: boolean): HelpSectionSpec[] {
  return [
    {
      id: 'move',
      nav: 'Moving',
      icon: 'pointer',
      title: 'Moving furniture',
      body: (
        <>
          <HelpLine>Drag a piece to slide it around the floor. It stops against whatever is in the way.</HelpLine>
          <HelpLine>
            <b>Move</b>, <b>Scale</b> and <b>Rotate</b> at the top choose what dragging does.
          </HelpLine>
          <HelpLine>
            Tap a piece to select it. Then {phone ? 'tap its name in the toolbar' : 'open Details'} for its colour,
            style and size.
          </HelpLine>
        </>
      ),
    },
    twoListsSection(),
    {
      id: 'walls',
      nav: 'Walls',
      icon: 'home',
      title: 'Walls and the room',
      body: <HelpLine>Tap a wall to pick a colour for it. Drag it to make the room bigger or smaller.</HelpLine>,
    },
    {
      id: 'around',
      nav: 'Around',
      icon: 'compass',
      title: 'Getting around',
      body: (
        <>
          <HelpLine>One finger on empty space turns the view. Two fingers pinch to zoom and pan.</HelpLine>
          <HelpLine>The buttons in the corner jump to set views: from above, the front wall, the corner.</HelpLine>
          {phone && <HelpLine>Snap and the exports are under More (⋯) at the top.</HelpLine>}
        </>
      ),
    },
  ];
}

function planTouchSections(phone: boolean): HelpSectionSpec[] {
  return [
    {
      id: 'move',
      nav: 'Moving',
      icon: 'pointer',
      title: 'Moving furniture',
      body: (
        <>
          <HelpLine>Drag a piece to move it. It stops against whatever is in the way.</HelpLine>
          <HelpLine>It tints red if it cannot go there.</HelpLine>
          <HelpLine>Drag the handle on a chosen piece to turn it.</HelpLine>
          <HelpLine>Tap a wall to paint it, or drag it to make the room bigger or smaller.</HelpLine>
        </>
      ),
    },
    twoListsSection(),
    {
      id: 'around',
      nav: 'Around',
      icon: 'compass',
      title: 'Getting around',
      body: (
        <>
          <HelpLine>One finger on empty floor slides the drawing. Two fingers pinch to zoom.</HelpLine>
          {phone && <HelpLine>Snap and the exports are under More (⋯) at the top.</HelpLine>}
        </>
      ),
    },
  ];
}

// The plan tab's half. It lived in `PlanChrome.tsx` — beside the zoom toolbar and the
// legend — while the 3D half lived here, which is exactly the split this file and
// `HelpCard.tsx` both already warned about in prose: "nobody comparing them was ever
// looking at both". Two cards describing one app belong where a reader can read them
// together, and the drift that split produced was a whole group missing from one of
// them for as long as anyone had been looking.
function planSections(): HelpSectionSpec[] {
  return [
    {
      id: 'move',
      nav: 'Moving',
      icon: 'pointer',
      title: 'Moving furniture',
      body: (
        <>
          <HelpLine>Drag a piece to move it. It stops against whatever is in the way.</HelpLine>
          <HelpLine>It tints red if it cannot go there. So does any selected piece that runs out of room.</HelpLine>
          <HelpLine>While you drag, it shows the distance to the nearest walls.</HelpLine>
          <HelpLine>
            <Kb>Esc</Kb> part-way through a drag puts the piece back where it was.
          </HelpLine>
          <HelpLine>Drag the handle on a selected piece to turn it.</HelpLine>
          <HelpLine>Click a wall to paint it, or drag it to make the room bigger or smaller.</HelpLine>
        </>
      ),
    },
    twoListsSection(),
    {
      id: 'choose',
      nav: 'Choosing',
      icon: 'crosshair',
      title: 'Choosing pieces',
      body: (
        <>
          <HelpLine>Drag across empty floor to lasso several pieces.</HelpLine>
          <HelpLine>
            Hold <Kb>Shift</Kb> to add to the selection, by lasso or by click.
          </HelpLine>
          <HelpLine>
            {/* The line break must not fall between a word and a keycap. JSX strips the
                trailing newline and indent from a text chunk, so "Keep" followed by a
                newline and <Kb>Alt</Kb> would render as "KeepAlt". The space is made
                explicit rather than trusting where the break falls. */}
            Where pieces overlap, <Kb>Alt</Kb>-click lists everything under the pointer and lets you pick.
            Keep{' '}
            <Kb>Alt</Kb>-clicking the same spot to step through them.
          </HelpLine>
          <HelpLine>Right-click a piece or the plan to see what you can do, including that same list.</HelpLine>
        </>
      ),
    },
    {
      id: 'around',
      nav: 'Around',
      icon: 'compass',
      title: 'Getting around',
      body: (
        <>
          <HelpLine>Pinch or scroll to zoom.</HelpLine>
          <HelpLine>
            To pan: two fingers, middle-drag, <Kb>Shift</Kb>-scroll, or hold <Kb>Space</Kb> and drag.
          </HelpLine>
          <HelpKeys>
            <HelpKey
              keys={
                <>
                  <Kb>[</Kb>
                  <Kb>]</Kb>
                </>
              }
            >
              turn the page, not the furniture
            </HelpKey>
            <HelpKey keys={<Kb>0</Kb>}>puts the view back</HelpKey>
          </HelpKeys>
        </>
      ),
    },
    {
      id: 'keys',
      nav: 'Shortcuts',
      icon: 'key',
      title: 'Keys',
      note: 'Click the drawing first. Keys do nothing while you are in a panel.',
      body: (
        <HelpKeys>
          <HelpKey
            keys={
              <>
                <Kb>↑</Kb>
                <Kb>↓</Kb>
                <Kb>←</Kb>
                <Kb>→</Kb>
              </>
            }
          >
            nudge whatever is focused
          </HelpKey>
          <HelpKey
            keys={
              <>
                <Kb>Shift</Kb>
                <Kb>←</Kb>
                <Kb>→</Kb>
              </>
            }
          >
            hold Shift with the arrows to turn it
          </HelpKey>
          <HelpKey keys={<Kb>F</Kb>}>brings the selected piece to the middle</HelpKey>
          <HelpKey keys={<Kb>H</Kb>}>hides it</HelpKey>
          <HelpKey keys={<Kb>Tab</Kb>}>steps through the pieces and the walls</HelpKey>
          <HelpKey keys={<Kb>Esc</Kb>}>deselects</HelpKey>
        </HelpKeys>
      ),
    },
  ];
}

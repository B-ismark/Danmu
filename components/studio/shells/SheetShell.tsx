'use client';

// The studio below 1024px, in the two shapes a small screen actually wants — and
// neither of them is the laptop layout made smaller.
//
// **A tablet (600–1023px) gets the room with ONE panel docked beside it** —
// Material's "supporting pane" canonical layout, which at a medium width class puts
// the supporting content side by side with the primary content rather than under
// it. Two rails do not fit beside a room at 768px (they left it ~300px), so the
// laptop's two become one, with a tab each. Docked, not floating: the same verdict
// `DockedShell` records, because the piece being placed is what hides under a panel.
//
// **A phone (under 600px) gets the room full-screen, a toolbar under the thumb, and
// panels that rise as a sheet.** The shape of that is taken from the platforms rather
// than invented here, and each choice has a source:
//
// · A toolbar, not a tab bar. Apple: "use a tab bar to support navigation, not to
//   provide actions"; Room / Add / Details are things you DO to this room, so they
//   are toolbar items, and Material 3 Expressive's floating toolbar is the same
//   answer ("contextual actions relevant to the body content").
// · The toolbar changes with the selection — tap a sofa and it offers the sofa —
//   which is what Canva and IKEA Kreativ do on a phone: tools for the thing you
//   touched, where your thumb already is.
// · One primary action, and it is Add (Apple: "only specify one primary action";
//   Material: one FAB, "the primary or the most common action").
// · The sheet is NONMODAL, so the room stays live under it while you recolour a
//   piece (HIG § Sheets: "people use its functionality to affect the parent view
//   without dismissing the sheet"). Two detents — about half, and nearly full — and
//   a grabber that cycles them when tapped (HIG). A visible close button beside it,
//   because NN/g's testing found the grab handle alone "easy to ignore". One sheet
//   at a time: Room, Add and Details replace one another rather than stack (NN/g,
//   HIG).
// · The toolbar is a grid ROW, not `position: fixed`: bars in flow are what iOS
//   Safari's collapsing toolbar leaves alone, and a row costs the room nothing it was
//   not already giving up.
//
// **Selecting a piece does not open the sheet.** Tapping a piece on a phone is also
// how you start dragging it; a sheet that rose on every tap would cover the room at
// exactly the moment the room is in use. The toolbar takes the piece's name instead,
// so the selection is visible and one tap away.

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { useStudio } from '@/lib/store';
import { useScene } from '@/lib/scene-store';
import { Icon, type IconName } from '@/components/ui/Icon';
import { LibraryBody } from '../CatalogPanel';
import { usePhoneStudio } from '../NarrowViewportBanner';
import { LeftRailBody, RightRailBody } from './shell-parts';
import { ViewOptions } from '../ViewOptions';
import { cycleSheet, settleSheet, sheetHeights, TAP_PX, type SheetSnap } from '@/lib/sheet-detents';

type Panel = 'room' | 'add' | 'details' | 'view';

function useSelectionName(): { selected: boolean; name: string | null } {
  const selectedPartId = useStudio((s) => s.selectedPartId);
  const selectionCount = useStudio((s) => s.selection.length);
  const selectedWall = useStudio((s) => s.selectedWall);
  const partName = useScene((s) => s.parts.find((p) => p.id === selectedPartId)?.name);
  if (selectionCount > 1) return { selected: true, name: `${selectionCount} selected` };
  if (partName) return { selected: true, name: partName };
  if (selectedWall != null) return { selected: true, name: `Wall ${selectedWall + 1}` };
  return { selected: false, name: null };
}

export function SheetShell({ surface }: { surface: ReactNode }) {
  return usePhoneStudio() ? <PhoneShell surface={surface} /> : <PaneShell surface={surface} />;
}

// ─── Tablet: the room and one docked panel ──────────────────────────────────

function PaneShell({ surface }: { surface: ReactNode }) {
  const [tab, setTab] = useState<'room' | 'details'>('room');
  const { selected, name } = useSelectionName();
  const selectedPartId = useStudio((s) => s.selectedPartId);
  const selectedWall = useStudio((s) => s.selectedWall);

  // A new selection points the panel at what acts on it; here the panel is always
  // open, so switching costs the room nothing.
  useEffect(() => {
    if (selected) setTab('details');
  }, [selectedPartId, selectedWall, selected]);

  return (
    <div className="pane-shell">
      <div className="shell-room">{surface}</div>
      <aside className="rail pane" aria-label="Studio panels">
        <div className="panel-tabs" role="tablist" aria-label="Panel">
          <PanelTab id="room" active={tab === 'room'} onChoose={() => setTab('room')}>
            Room
          </PanelTab>
          <PanelTab id="details" active={tab === 'details'} onChoose={() => setTab('details')} dot={selected}>
            {name ?? 'Details'}
          </PanelTab>
        </div>
        <div
          id="studio-pane-body"
          className="pane__body"
          role="tabpanel"
          aria-labelledby={`studio-pane-tab-${tab}`}
        >
          {/* Both bodies stay mounted: the catalog's search and a half-typed
              dimension survive switching tabs, as they do on a laptop. */}
          <div className="rail sheet__rail" hidden={tab !== 'room'}>
            <LeftRailBody open />
          </div>
          <div className="rail sheet__rail" hidden={tab !== 'details'}>
            <RightRailBody open />
          </div>
        </div>
      </aside>
    </div>
  );
}

function PanelTab({
  id,
  active,
  onChoose,
  dot = false,
  children,
}: {
  id: string;
  active: boolean;
  onChoose: () => void;
  dot?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      id={`studio-pane-tab-${id}`}
      aria-selected={active}
      aria-controls="studio-pane-body"
      className="panel-tab"
      onClick={onChoose}
    >
      {dot && <span className="panel-tab__dot" aria-hidden="true" />}
      <span className="truncate">{children}</span>
    </button>
  );
}

// ─── Phone: full-screen room, toolbar, sheet ────────────────────────────────

const SHEET_ID = 'studio-sheet';

function PhoneShell({ surface }: { surface: ReactNode }) {
  const [snap, setSnap] = useState<SheetSnap>('closed');
  const [panel, setPanel] = useState<Panel>('room');
  const sheetRef = useRef<HTMLElement>(null);
  const drag = useRef<{ y: number; h: number; lastY: number; lastT: number; moved: boolean } | null>(null);

  const { selected, name } = useSelectionName();
  const catalogOpen = useStudio((s) => s.catalogOpen);
  const setCatalogOpen = useStudio((s) => s.setCatalogOpen);
  const setSelected = useStudio((s) => s.setSelected);
  const setSelectedWall = useStudio((s) => s.setSelectedWall);

  const open = snap !== 'closed';

  // The Library is the same `catalogOpen` flag on every layout, so anything that
  // opens it — the rail's Add, the right-click menu's "Add from the Library…" —
  // opens it here as a sheet.
  const panelRef = useRef(panel);
  panelRef.current = panel;
  useEffect(() => {
    if (catalogOpen) {
      setPanel('add');
      setSnap((s) => (s === 'closed' ? 'half' : s));
    } else if (panelRef.current === 'add') {
      setSnap('closed');
    }
  }, [catalogOpen]);

  // View holds nothing about a piece, so picking one while it is up swaps it for the
  // piece's Details. Otherwise the sheet goes on showing view settings over the piece
  // you just chose, and the only sign you chose it is the dot on another button. Room
  // and the Library stay put: the Catalog's rows ARE how you pick from Room, and
  // swapping the list away under the finger that just used it would be worse.
  const selectedPartId = useStudio((s) => s.selectedPartId);
  const selectedWallId = useStudio((s) => s.selectedWall);
  useEffect(() => {
    if (selected && panelRef.current === 'view') setPanel('details');
  }, [selected, selectedPartId, selectedWallId]);

  const show = (p: Panel) => {
    // Pressing the button for the sheet already showing lowers it: a toolbar item
    // that only ever opens leaves the close button as the one way down.
    if (open && panel === p) return close();
    setPanel(p);
    setCatalogOpen(p === 'add');
    setSnap((s) => (s === 'closed' ? 'half' : s));
  };

  const close = () => {
    setSnap('closed');
    if (catalogOpen) setCatalogOpen(false);
  };

  // Escape lowers the sheet — only when focus is inside it, so Escape in the room
  // keeps meaning what the studio's shortcuts say it means.
  useEffect(() => {
    const el = sheetRef.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open && !e.defaultPrevented) {
        e.stopPropagation();
        close();
      }
    };
    el.addEventListener('keydown', onKey);
    return () => el.removeEventListener('keydown', onKey);
  });

  const restingHeights = (): [number, number, number] => {
    const stage = sheetRef.current?.parentElement;
    if (!stage) return [0, 0, 0];
    const css = getComputedStyle(stage);
    const half = (parseFloat(css.getPropertyValue('--sheet-half')) || 0) / 100;
    const gap = parseFloat(css.getPropertyValue('--sheet-top-gap')) || 0;
    return sheetHeights(stage.clientHeight, half, gap);
  };

  // View is four switches and a picker: the sheet is as tall as they are (`data-fit`
  // in globals.css), with one open height. Its drag can only lower it.
  const fit = panel === 'view';
  const dragHeights = (d: { h: number }): [number, number, number] => (fit ? [0, d.h, d.h] : restingHeights());
  const cycle = () => {
    const next = cycleSheet(snap, fit);
    if (next === 'closed') close();
    else setSnap(next);
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    // The close button is a press, never a drag.
    if ((e.target as HTMLElement).closest('.sheet__close')) return;
    const el = sheetRef.current;
    if (!el) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { y: e.clientY, h: el.getBoundingClientRect().height, lastY: e.clientY, lastT: performance.now(), moved: false };
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const el = sheetRef.current;
    if (!d || !el) return;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.abs(dy) < TAP_PX) return;
    d.moved = true;
    const [, , full] = dragHeights(d);
    el.dataset.dragging = '1';
    el.style.height = `${Math.min(full, Math.max(0, d.h - dy))}px`;
    d.lastY = e.clientY;
    d.lastT = performance.now();
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const el = sheetRef.current;
    drag.current = null;
    if (!d || !el) return;
    if (!d.moved) {
      // A tap on the grabber cycles the detents (HIG); a tap elsewhere on the
      // header is nothing.
      if ((e.target as HTMLElement).closest('.sheet__handle')) cycle();
      return;
    }
    const velocity = -(e.clientY - d.lastY) / Math.max(1, performance.now() - d.lastT);
    const next = settleSheet(el.getBoundingClientRect().height, velocity, dragHeights(d));
    delete el.dataset.dragging;
    el.style.height = '';
    if (next === 'closed') close();
    else setSnap(next);
  };

  // The toolbar already carries the piece's name, and the panel's own header says
  // it again with its kind beneath; the sheet's title names the panel.
  const title = panel === 'room' ? 'Room' : panel === 'add' ? 'Library' : panel === 'view' ? 'View' : 'Details';

  const deselect = () => {
    setSelected(null);
    setSelectedWall(null);
  };

  return (
    <div className="sheet-shell">
      {/* The sheet rises from the TOOLBAR's top edge, not the screen's: the toolbar
          stays put under it, so switching Room ↔ Add ↔ Details, or pressing the
          open one again to lower it, never needs the sheet closed first — Apple
          Maps' sheet over its bar, Canva's panels over its tools. */}
      <div className="sheet-shell__stage">
        <div className="shell-room">{surface}</div>

      <section
        ref={sheetRef}
        id={SHEET_ID}
        className="sheet"
        data-snap={snap}
        data-fit={fit || undefined}
        aria-label={title}
        // Hidden from everyone at rest — it is off-screen, and a keyboard must not
        // tab into a panel nobody can see.
        inert={!open}
      >
        <div
          className="sheet__head"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <button
            type="button"
            className="sheet__handle"
            aria-label={fit ? `Close ${title}` : snap === 'full' ? 'Shrink the panel' : 'Expand the panel'}
            // The head's pointer handlers turn a tap into a cycle; a click here is
            // the keyboard's Enter / Space, which has no pointer.
            onClick={(e) => {
              if (e.detail === 0) cycle();
            }}
          >
            <span aria-hidden="true" />
          </button>
          <h2 className="sheet__title truncate">{title}</h2>
          <button type="button" className="icon-btn sheet__close" aria-label={`Close ${title}`} onClick={close}>
            <Icon name="x" size={18} />
          </button>
        </div>
        <div className="sheet__body">
          <div className="rail sheet__rail" hidden={panel !== 'room'}>
            <LeftRailBody open />
          </div>
          <div className="rail sheet__rail" hidden={panel !== 'details'}>
            <RightRailBody open />
          </div>
          {panel === 'view' && (
            <div className="rail sheet__rail sheet__pad">
              <ViewOptions />
            </div>
          )}
          {panel === 'add' && (
            <div className="rail sheet__rail">
              <LibraryBody touch />
            </div>
          )}
        </div>
      </section>
      </div>

      <nav className="phone-toolbar" aria-label="Studio">
        <ToolButton icon="list" label="Room" pressed={open && panel === 'room'} onPress={() => show('room')} />
        {selected ? (
          <>
            <ToolButton
              icon="edit"
              label={name ?? 'Details'}
              prominent
              pressed={open && panel === 'details'}
              onPress={() => show('details')}
            />
            <ToolButton icon="check" label="Done" onPress={deselect} title="Finish with this selection" />
          </>
        ) : (
          <>
            <ToolButton icon="plus" label="Add" prominent pressed={open && panel === 'add'} onPress={() => show('add')} />
            {/* Its own sheet: the laptop's top-bar gear (ViewMenu). It used to open
                Details, which held these controls under an empty Inspector. */}
            <ToolButton icon="sliders" label="View" pressed={open && panel === 'view'} onPress={() => show('view')} />
          </>
        )}
      </nav>
    </div>
  );
}

function ToolButton({
  icon,
  label,
  onPress,
  pressed,
  prominent = false,
  title,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  pressed?: boolean;
  prominent?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      className="phone-tool"
      data-prominent={prominent || undefined}
      aria-expanded={pressed}
      aria-controls={pressed === undefined ? undefined : SHEET_ID}
      title={title}
      onClick={onPress}
    >
      <Icon name={icon} size={20} />
      <span className="truncate">{label}</span>
    </button>
  );
}

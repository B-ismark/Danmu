'use client';

// The studio's right-click menu, shared by the 3D room and the 2D plan.
//
// The right button used to pan the camera. Panning moved to Space + left-drag —
// the gesture every 3D tool shares — which freed the one press in this app that
// had no meaning, and right-click on a 3D view with no menu behind it reads as
// broken. Three menus, chosen by what is under the cursor:
//
//   · on a piece — the handful of actions that were otherwise a trip to the
//     Inspector or a single-character shortcut nobody had discovered yet
//   · on the room — the things that are about the whole scene
//   · over a STACK — which of these overlapping pieces did you mean (`pick`),
//     raised by Alt-click on either surface and by the "Select what's here" row
//     that the first two grow when the caller can say what else is under the
//     cursor. That row is the picker's only route on a touch screen, which has
//     no modifier keys at all.
//
// The menu itself still knows nothing about either surface: the caller passes in
// the piece under the pointer, which both surfaces now genuinely know — the plan
// did NOT write `hoveredPartId` until the pass that added the picker, so this
// comment used to claim a parity that existed in one tab only, and a right-click
// in the plan opened the room's menu on top of a piece.

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { useStudio, useSettings } from '@/lib/store';
import { useScene } from '@/lib/scene-store';
import { hasOverride } from '@/lib/transforms';
import { formatDim } from '@/lib/units';
import { CATEGORY_ICON, Icon, type IconName } from '@/components/ui/Icon';
import {
  STUDIO_SURFACE_ID,
  duplicateSelection,
  isTypingOrDialog,
  removeParts,
  selectAllParts,
  selectedIds,
  spinSelection,
} from './KeyboardShortcuts';

const MENU_EVENT = 'danmu:scene-menu';

type MenuRequest = {
  /** viewport coordinates of the press */
  x: number;
  y: number;
  /** the piece under the cursor, or null for bare room */
  partId: string | null;
  /**
   * Present when this is a *disambiguation* menu rather than an action menu:
   * every piece under the cursor, front-to-back, for the user to choose between.
   * The two share this component because they share everything that is hard
   * about a floating menu — clamping into the canvas, dismissal, focus, arrow
   * keys — and differ only in what the rows do.
   */
  pick?: string[];
  /** Everything under the cursor, when the surface could work it out. Turns into
   *  the "Select what's here" row — the route to the picker that needs no
   *  modifier, and therefore the only one available on a touch screen or under a
   *  window manager that claims Alt for itself. */
  candidates?: string[];
};

/** Open the studio context menu at a viewport point. Called from the 3D canvas
 *  and the 2D plan; a window event rather than a store field so neither surface
 *  needs a store contract to raise one. */
export function openSceneMenu(x: number, y: number, partId: string | null, candidates?: string[]) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<MenuRequest>(MENU_EVENT, { detail: { x, y, partId, candidates } }));
}

/** Open the "which of these did you mean" menu over a stack of overlapping
 *  pieces. Both studio surfaces raise it: the 3D tab from the depth-sorted
 *  raycast it already has, the plan from `lib/plan-hit`. */
export function openPickMenu(x: number, y: number, ids: string[]) {
  if (typeof window === 'undefined' || ids.length === 0) return;
  window.dispatchEvent(new CustomEvent<MenuRequest>(MENU_EVENT, { detail: { x, y, partId: null, pick: ids } }));
}

type MenuEntry =
  | { kind: 'separator'; id: string }
  | {
      kind: 'item';
      id: string;
      label: string;
      icon: IconName;
      /** the keyboard route to the same action, so the menu teaches it */
      hint?: string;
      danger?: boolean;
      /** Highlight this piece in the room while the row is under the pointer or
       *  focused. A disambiguation list is names; the room is where you actually
       *  recognise which one you meant — two chairs of the same model produce two
       *  identical rows, and this is the only thing that tells them apart. */
      hoverId?: string;
      run: () => void;
    };

const MENU_WIDTH = 226;
/** Gap kept between the menu and the edge of the canvas it is clamped into. */
const EDGE = 8;

export function SceneContextMenu() {
  const [req, setReq] = useState<MenuRequest | null>(null);
  // Canvas-relative, after clamping. Null until measured, so the menu never
  // paints for one frame at the raw press point and then jumps.
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    setReq(null);
    setAt(null);
    // Focus goes back to the room, not to nowhere: the studio's single-character
    // shortcuts are armed by the surface holding focus, and a menu that left it
    // on <body> would silently disarm W / S / R / F / V / Delete.
    document.getElementById(STUDIO_SURFACE_ID)?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    function onOpen(e: Event) {
      const detail = (e as CustomEvent<MenuRequest>).detail;
      if (!detail) return;
      // Right-clicking a piece that is not in the selection selects it — the menu
      // acts on the selection, so what it will affect has to be visible first. A
      // piece already inside a multi-selection keeps the rest of it. A pick menu
      // changes nothing by opening: the caller has already selected the topmost
      // candidate, and choosing a row is what changes the selection.
      if (detail.partId && !detail.pick && !useStudio.getState().selection.includes(detail.partId)) {
        useStudio.getState().setSelected(detail.partId);
      }
      setAt(null);
      setReq(detail);
    }
    window.addEventListener(MENU_EVENT, onOpen);
    return () => window.removeEventListener(MENU_EVENT, onOpen);
  }, []);

  // A menu is built from a snapshot of the scene taken at the press. If the scene
  // changes under it — an undo, a delete, a re-scan — its rows are describing
  // pieces that may no longer exist, so it closes instead of acting on them. It
  // already closes for anything that moves the camera; this is the same argument
  // one layer in.
  const parts = useScene((s) => s.parts);
  const partsAtOpen = useRef(parts);
  useEffect(() => {
    if (!req) {
      partsAtOpen.current = parts;
      return;
    }
    if (partsAtOpen.current !== parts) {
      partsAtOpen.current = parts;
      close();
    }
  }, [parts, req, close]);

  // A pick menu borrows the hover highlight to show which candidate a row means,
  // so it has to give it back — otherwise the room stays lit up around whatever
  // row the pointer left by.
  useEffect(() => {
    if (!req?.pick) return;
    return () => {
      if (useStudio.getState().hoveredPartId) useStudio.getState().setHovered(null);
    };
  }, [req?.pick]);

  // Clamp into the canvas once the menu has a measured size. Opening near the
  // bottom-right corner is the common case — that is where the room dock lives,
  // so that is where the pointer already is.
  useLayoutEffect(() => {
    if (!req) return;
    const el = menuRef.current;
    // The positioned ancestor IS the studio's canvas element — both pages render
    // this menu inside it — so there is nothing to look up by id.
    const host = el?.offsetParent as HTMLElement | null;
    if (!host || !el) return;
    const box = host.getBoundingClientRect();
    const h = el.offsetHeight;
    const w = el.offsetWidth;
    const left = Math.max(EDGE, Math.min(req.x - box.left, box.width - w - EDGE));
    const top = Math.max(EDGE, Math.min(req.y - box.top, box.height - h - EDGE));
    setAt({ left, top });
    // Arrow keys and Enter work from here; Tab still walks the items.
    el.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
  }, [req]);

  useEffect(() => {
    if (!req) return;
    function onDown(e: PointerEvent) {
      if (!menuRef.current?.contains(e.target as Node)) close();
    }
    // Capture, so Escape closes the menu before the global binding reads it as
    // "deselect everything".
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape' || isTypingOrDialog(e.target)) return;
      e.stopPropagation();
      close();
    }
    // Any camera move invalidates where the menu is pointing.
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('wheel', close, { passive: true });
    window.addEventListener('resize', close);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('wheel', close);
      window.removeEventListener('resize', close);
      window.removeEventListener('blur', close);
    };
  }, [req, close]);

  if (!req) return null;
  const entries = req.pick ? pickEntries(req.pick) : req.partId ? partEntries(req.partId, req) : roomEntries();
  if (entries.length === 0) return null;

  function onMenuKey(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [],
    );
    if (items.length === 0) return;
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === 'ArrowDown' ? i + 1 : i - 1;
    items[(next + items.length) % items.length].focus();
  }

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label={req.pick ? 'Pieces under the pointer' : 'Studio actions'}
      className="popover"
      onKeyDown={onMenuKey}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        position: 'absolute',
        left: at?.left ?? 0,
        top: at?.top ?? 0,
        // Hidden for the one frame between paint and measure — see the layout
        // effect above.
        visibility: at ? 'visible' : 'hidden',
        width: MENU_WIDTH,
        padding: 5,
        zIndex: 'var(--z-popover)',
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
      }}
    >
      {entries.map((entry) =>
        entry.kind === 'separator' ? (
          <span
            key={entry.id}
            aria-hidden="true"
            style={{ height: 1, background: 'var(--hairline)', margin: '4px 6px' }}
          />
        ) : (
          <button
            key={entry.id}
            role="menuitem"
            className="list-row"
            onClick={() => {
              entry.run();
              close();
            }}
            // Pointer AND focus, so the room highlights the candidate for someone
            // arrowing down the list as well as for someone reading it.
            onPointerEnter={entry.hoverId ? () => useStudio.getState().setHovered(entry.hoverId!) : undefined}
            onFocus={entry.hoverId ? () => useStudio.getState().setHovered(entry.hoverId!) : undefined}
            style={{ fontSize: 12.5, padding: '7px 9px', color: entry.danger ? 'var(--danger-text)' : undefined }}
          >
            <Icon name={entry.icon} size={14} />
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {entry.label}
            </span>
            {entry.hint && (
              <span className="mono" style={{ fontSize: 10, color: 'var(--ink-3)' }}>
                {entry.hint}
              </span>
            )}
          </button>
        ),
      )}
    </div>
  );
}

/**
 * One row per piece under the cursor, front-to-back — the answer to "I meant the
 * other one". Ids come from the caller's own hit test (the 3D raycast, or
 * `lib/plan-hit`), so this only has to turn them into rows and decline the ones
 * that have since gone.
 *
 * The measurement in each row is DERIVED from the piece, never a stored string,
 * and it is the footprint rather than all three dimensions because the question
 * being answered is "which of these overlapping shapes".
 */
function pickEntries(ids: string[]): MenuEntry[] {
  const parts = useScene.getState().parts;
  const dimUnit = useSettings.getState().dimUnit;
  const entries: MenuEntry[] = [];
  for (const id of ids) {
    const part = parts.find((p) => p.id === id);
    // Deleted or undone between the press and the paint. Dropping the row is the
    // honest answer; selecting a dead id is not.
    if (!part) continue;
    entries.push({
      kind: 'item',
      id: `pick-${id}`,
      label: part.name,
      icon: CATEGORY_ICON[part.category] ?? 'cube',
      hint: `${formatDim(part.dimMM[0], dimUnit)} × ${formatDim(part.dimMM[1], dimUnit)}`,
      hoverId: id,
      run: () => {
        // The member, not its group: choosing from this list is the one gesture
        // whose entire point is picking out one specific piece. What it belongs to
        // is the Inspector's job to say.
        useStudio.getState().setSelected(id);
      },
    });
  }
  return entries;
}

/** Actions on the piece under the cursor. Read through getState() rather than a
 *  subscription: the menu is built once, at the moment of the press. */
function partEntries(partId: string, req: MenuRequest): MenuEntry[] {
  const s = useStudio.getState();
  const sc = useScene.getState();
  const part = sc.parts.find((p) => p.id === partId);
  if (!part) return [];

  const ids = selectedIds();
  const many = ids.length > 1;
  const groupMembers = part.groupId ? sc.parts.filter((p) => p.groupId === part.groupId).map((p) => p.id) : [];
  const hasOverrides = hasOverride(partId, s);
  const isHidden = !!s.hidden[partId];

  const entries: MenuEntry[] = [
    { kind: 'item', id: 'duplicate', label: many ? `Duplicate ${ids.length}` : 'Duplicate', icon: 'copy', hint: 'Ctrl D', run: duplicateSelection },
    { kind: 'item', id: 'spin', label: 'Turn a quarter', icon: 'rotate-cw', run: () => spinSelection(1) },
    { kind: 'item', id: 'frame', label: 'Fly to it', icon: 'crosshair', hint: 'F', run: () => s.frameSelected() },
    {
      kind: 'item',
      id: 'hide',
      label: isHidden ? 'Show it' : 'Hide it',
      icon: isHidden ? 'eye' : 'eye-off',
      hint: 'H',
      run: () => s.toggleHidden(partId),
    },
  ];

  // Only worth offering when there IS something else under the cursor. The count
  // is in the label because the value of the row is knowing the answer is more
  // than one before you open it.
  const others = req.candidates ?? [];
  if (others.length > 1) {
    entries.push({
      kind: 'item',
      id: 'pick',
      label: `Select what's here (${others.length})`,
      icon: 'layers',
      hint: 'Alt click',
      // A microtask, because the row's own handler calls `close()` immediately
      // after `run()` — opening the pick menu synchronously would be undone by
      // the close that follows it.
      run: () => queueMicrotask(() => openPickMenu(req.x, req.y, others)),
    });
  }

  if (hasOverrides) {
    entries.push({
      kind: 'item',
      id: 'reset',
      label: 'Back where it was',
      icon: 'refresh',
      run: () => s.resetTransforms(partId),
    });
  }

  if (groupMembers.length > 1) {
    entries.push({ kind: 'separator', id: 'sep-group' });
    entries.push({
      kind: 'item',
      id: 'ungroup',
      label: `Ungroup ${groupMembers.length}`,
      icon: 'swap',
      run: () => {
        sc.ungroupParts(groupMembers);
        s.setSelected(partId);
      },
    });
  } else if (many) {
    entries.push({ kind: 'separator', id: 'sep-group' });
    entries.push({
      kind: 'item',
      id: 'merge',
      label: `Group ${ids.length}`,
      icon: 'layers',
      run: () => sc.groupParts(ids),
    });
  }

  entries.push({ kind: 'separator', id: 'sep-remove' });
  entries.push({
    kind: 'item',
    id: 'remove',
    label: many ? `Remove ${ids.length}` : 'Remove',
    icon: 'trash',
    hint: 'Del',
    danger: true,
    run: () => removeParts(ids),
  });
  return entries;
}

/** Actions on the room itself — a right-click that landed on floor, wall or air. */
function roomEntries(): MenuEntry[] {
  const s = useStudio.getState();
  return [
    // "Library", not "furniture": the same panel holds doors, windows, curtains,
    // appliances and lighting, so the narrower word described about half of it.
    // And the LIBRARY rather than the catalog, because the rail's list of what is
    // already in the room is the Catalog now — one screen may not hold two lists
    // with one name.
    { kind: 'item', id: 'add', label: 'Add from library…', icon: 'plus', run: () => s.setCatalogOpen(true) },
    { kind: 'item', id: 'all', label: 'Select everything', icon: 'layers', hint: 'Ctrl A', run: selectAllParts },
    { kind: 'separator', id: 'sep-view' },
    { kind: 'item', id: 'view', label: 'Reset the view', icon: 'fit', run: () => s.setView('iso') },
    {
      kind: 'item',
      id: 'grid',
      label: s.showGrid ? 'Hide the floor grid' : 'Show the floor grid',
      icon: 'grid',
      run: () => s.toggleGrid(),
    },
  ];
}

'use client';

// The studio's right-click menu, shared by the 3D room and the 2D plan.
//
// The right button used to pan the camera. Panning moved to Space + left-drag —
// the gesture every 3D tool shares — which freed the one press in this app that
// had no meaning, and right-click on a 3D view with no menu behind it reads as
// broken. Two menus, chosen by what is under the cursor:
//
//   · on a piece — the handful of actions that were otherwise a trip to the
//     Inspector or a single-character shortcut nobody had discovered yet
//   · on the room — the things that are about the whole scene
//
// It does not raycast. Both surfaces keep `hoveredPartId` current, so the piece
// under the pointer is already known by the time the press lands; the caller
// passes it in. That also means the two surfaces answer identically without the
// menu knowing anything about either.

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { useStudio } from '@/lib/store';
import { useScene } from '@/lib/scene-store';
import { Icon, type IconName } from '@/components/ui/Icon';
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
};

/** Open the studio context menu at a viewport point. Called from the 3D canvas
 *  and the 2D plan; a window event rather than a store field so neither surface
 *  needs a store contract to raise one. */
export function openSceneMenu(x: number, y: number, partId: string | null) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<MenuRequest>(MENU_EVENT, { detail: { x, y, partId } }));
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
      // piece already inside a multi-selection keeps the rest of it.
      if (detail.partId && !useStudio.getState().selection.includes(detail.partId)) {
        useStudio.getState().setSelected(detail.partId);
      }
      setAt(null);
      setReq(detail);
    }
    window.addEventListener(MENU_EVENT, onOpen);
    return () => window.removeEventListener(MENU_EVENT, onOpen);
  }, []);

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
  const entries = req.partId ? partEntries(req.partId) : roomEntries();
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
      aria-label="Studio actions"
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

/** Actions on the piece under the cursor. Read through getState() rather than a
 *  subscription: the menu is built once, at the moment of the press. */
function partEntries(partId: string): MenuEntry[] {
  const s = useStudio.getState();
  const sc = useScene.getState();
  const part = sc.parts.find((p) => p.id === partId);
  if (!part) return [];

  const ids = selectedIds();
  const many = ids.length > 1;
  const groupMembers = part.groupId ? sc.parts.filter((p) => p.groupId === part.groupId).map((p) => p.id) : [];
  const hasOverrides = !!s.positions[partId] || !!s.rotations[partId] || !!s.dims[partId];
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
      hint: 'V',
      run: () => s.toggleHidden(partId),
    },
  ];

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
      label: `Merge ${ids.length}`,
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
    { kind: 'item', id: 'add', label: 'Add furniture…', icon: 'plus', run: () => s.setCatalogOpen(true) },
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

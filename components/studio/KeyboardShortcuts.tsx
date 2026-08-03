'use client';

// Studio-wide keyboard input, plus the studio's one live region. Both are mounted
// once by the room layout.
//
// Character-key scoping (WCAG 2.1.4): W / S / R / F / V / Delete are single
// characters and used to be bound to `window` with only a text-field guard — so
// tabbing to any button and typing "s" silently switched the gizmo to Scale.
// They now fire only while the studio *surface* itself holds focus. The surface
// takes focus when you press on the room rather than on a control (see
// `studioSurfaceProps`), so clicking the room arms the keys and clicking chrome
// disarms them. Modifier combos (undo, duplicate, select-all, settings) are
// exempt from 2.1.4 and stay live anywhere in the studio — this component only
// exists on studio routes.
//
// The live region lives here because it is the output half of the same problem:
// the 3D canvas is opaque to assistive tech, so selection, the position a piece
// actually resolved to, the snap mode and any refusal have to be spoken by the
// shell instead.

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useRouter } from 'next/navigation';
import { v4 as uuid } from 'uuid';
import { useStudio, useSettings } from '@/lib/store';
import { useScene } from '@/lib/scene-store';
import { currentRoomScene, useRoomScene } from '@/lib/room-scene';
import { useHistory, applySnapshot, startHistoryRecording } from '@/lib/history';
import { collidesAt, type ScenePart } from '@/lib/scene-spec';
import { clampIntoFootprint } from '@/lib/footprint';
import { formatDim } from '@/lib/units';
import { toast } from '@/components/ui/StorageToast';

export const STUDIO_SURFACE_ID = 'danmu-studio-surface';

/** Anything the browser can focus. Pressing on one of these means the user is
 *  operating chrome, so the surface must not steal the focus back. */
const FOCUSABLE =
  'button, a[href], input, select, textarea, [contenteditable="true"], [tabindex]:not([tabindex="-1"])';

function surfaceEl(): HTMLElement | null {
  return typeof document === 'undefined' ? null : document.getElementById(STUDIO_SURFACE_ID);
}

/** The arming condition for bare character keys: focus is on the studio surface
 *  itself, not on any control inside it. */
export function studioSurfaceFocused(): boolean {
  const el = surfaceEl();
  return !!el && document.activeElement === el;
}

/** Spread onto the element that wraps the studio's work surface (rails + canvas).
 *  Makes it programmatically focusable and gives it focus on a press that isn't
 *  on a control, which is what scopes the single-character shortcuts. */
export function studioSurfaceProps() {
  return {
    id: STUDIO_SURFACE_ID,
    tabIndex: -1,
    onPointerDown: (e: ReactPointerEvent) => {
      const t = e.target as Element | null;
      if (t?.closest?.(FOCUSABLE)) return;
      surfaceEl()?.focus({ preventScroll: true });
    },
    // The surface is a focus *scope*, not a control — a ring around the whole
    // work area would read as an error.
    style: { outline: 'none' as const },
  };
}

/** Guard for the capture-phase Escape handlers the floating panels install. They
 *  run before anything else sees the key, so they have to yield to a field being
 *  edited and to any dialog stacked in front of them. */
export function isTypingOrDialog(target: EventTarget | null): boolean {
  const t = target as HTMLElement | null;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return true;
  return typeof document !== 'undefined' && !!document.querySelector('[role="dialog"]');
}

// ─── Announcements ──────────────────────────────────────────────────────────

const ANNOUNCE_EVENT = 'danmu:announce';

/** Speak one sentence in the studio's live region. For things a screen reader
 *  cannot otherwise know: a move that was refused, a piece that was duplicated.
 *  A window event rather than a store field so any surface — including the 3D
 *  canvas — can call it without a store contract change. */
export function announce(message: string) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<string>(ANNOUNCE_EVENT, { detail: message }));
}

export function StudioAnnouncer() {
  // Resolved: what it reads out is where the piece is now, not where it started.
  const parts = useRoomScene();
  const selectedPartId = useStudio((s) => s.selectedPartId);
  const selection = useStudio((s) => s.selection);
  const selectedWall = useStudio((s) => s.selectedWall);
  const snapMode = useStudio((s) => s.snapMode);
  const draggingId = useStudio((s) => s.draggingId);
  const dimUnit = useSettings((s) => s.dimUnit);
  // `seq` forces a text change when the same sentence is announced twice: a live
  // region only speaks when its content differs from last time.
  const [spoken, setSpoken] = useState<{ text: string; seq: number }>({ text: '', seq: 0 });

  useEffect(() => {
    function onMsg(e: Event) {
      const text = (e as CustomEvent<string>).detail ?? '';
      setSpoken((prev) => ({ text, seq: prev.seq + 1 }));
    }
    window.addEventListener(ANNOUNCE_EVENT, onMsg);
    return () => window.removeEventListener(ANNOUNCE_EVENT, onMsg);
  }, []);

  const primary = parts.find((p) => p.id === selectedPartId);
  const pos = primary?.pos ?? null;
  const snapLabel =
    snapMode === 'off' ? 'Snap off' : snapMode === 'fine' ? 'Snap on, fine steps' : 'Snap on, coarse steps';

  // Held back mid-drag: announcing every frame of a drag is noise. The committed
  // position is what matters.
  let state = '';
  if (!draggingId) {
    if (primary && pos) {
      state =
        `${primary.name} selected, ${formatDim(pos[0] * 1000, dimUnit)} across and ` +
        `${formatDim(pos[2] * 1000, dimUnit)} back, in ${dimUnit}. ${snapLabel}.` +
        (selection.length > 1 ? ` ${selection.length} pieces selected.` : '');
    } else if (selectedWall !== null) {
      state = `Wall ${selectedWall + 1} selected. Drag it to resize the room, or paint it in the panel on the right.`;
    }
  }

  return (
    <div className="sr-only">
      <div role="status" aria-live="polite">
        {state}
      </div>
      <div role="status" aria-live="polite">
        {spoken.text}
        {spoken.seq % 2 === 1 ? ' ' : ''}
      </div>
    </div>
  );
}

// ─── Selection-wide actions the accelerators need ───────────────────────────

/** Where to try putting a copy, in order, so it never lands buried in the piece
 *  it was copied from. */
const COPY_OFFSETS: Array<[number, number]> = [
  [0.35, 0.35],
  [-0.35, 0.35],
  [0.35, -0.35],
  [-0.35, -0.35],
  [0.7, 0],
  [0, 0.7],
  [0, 0],
];

export function selectedIds(): string[] {
  const s = useStudio.getState();
  if (s.selection.length > 0) return s.selection;
  return s.selectedPartId ? [s.selectedPartId] : [];
}

/** The one way a piece leaves the room, from every surface: the row trash, the
 *  Inspector button, the plan and the Delete key.
 *
 *  No confirmation dialog. Removing a chair is cheap and fully reversible —
 *  history covers structure, and the toast puts the reversal one click away, on
 *  the same screen, without asking permission first. A dialog on a reversible
 *  action only teaches people to dismiss dialogs, which is what makes the
 *  irreversible ones (deleting a saved layout, resetting every transform)
 *  dangerous. Those keep their confirm; this doesn't.
 *
 *  Undo here restores through the store rather than through `applySnapshot`:
 *  history snapshots are debounced 250ms, so a fast click on Undo would
 *  otherwise pop the state *before* the delete. Re-inserting the parts is a
 *  normal edit, and history records it like any other. */
export function removeParts(ids: string[], opts?: { selectAfter?: string | null }) {
  if (ids.length === 0) return;
  const before = useScene.getState().parts;
  const doomed = before.filter((p) => ids.includes(p.id));
  if (doomed.length === 0) return;

  useScene.setState({ parts: before.filter((p) => !ids.includes(p.id)) });

  // Selection survives everything that didn't just leave: deleting one row of a
  // multi-select must not collapse the rest of it. `selectAfter` overrides for
  // the list, which has a specific next row in mind.
  const st = useStudio.getState();
  if (opts && 'selectAfter' in opts) {
    st.setSelected(opts.selectAfter ?? null);
  } else {
    const gone = new Set(ids);
    const kept = st.selection.filter((x) => !gone.has(x));
    const primary =
      st.selectedPartId && !gone.has(st.selectedPartId)
        ? st.selectedPartId
        : kept[kept.length - 1] ?? null;
    st.setSelection(kept, primary);
  }

  // Spoken by the toast, not by `announce`: the toast host is itself a polite
  // live region, so doing both says the removal twice.
  //
  // Title and action only. "Undo brings it straight back" was a second line of
  // prose restating the button sitting next to it, and it doubled the height of a
  // card that floats over the room.
  const many = doomed.length > 1;
  toast({
    title: many ? `${doomed.length} pieces removed` : `“${doomed[0].name}” removed`,
    action: { label: 'Undo', onClick: () => restoreParts(doomed, before) },
    ttl: 8000,
  });
}

/** Put removed parts back where they sat in the list, skipping any that are
 *  already there (a second click, or an undo that beat the toast to it). */
function restoreParts(doomed: ScenePart[], before: ScenePart[]) {
  const current = useScene.getState().parts;
  const present = new Set(current.map((p) => p.id));
  const revived = [...current];
  for (const p of doomed) {
    if (present.has(p.id)) continue;
    const at = before.findIndex((b) => b.id === p.id);
    revived.splice(at < 0 || at > revived.length ? revived.length : at, 0, p);
  }
  if (revived.length === current.length) return;
  useScene.setState({ parts: revived });
  const back = doomed.filter((p) => !present.has(p.id));
  if (back.length === 1) useStudio.getState().setSelected(back[0].id);
  announce(back.length === 1 ? `“${back[0].name}” is back.` : `${back.length} pieces are back.`);
}

function deleteSelection() {
  removeParts(selectedIds());
}

export function duplicateSelection() {
  const ids = selectedIds();
  if (ids.length === 0) return;
  const sc = useScene.getState();
  const created: string[] = [];

  // Duplicating copies the piece as it STANDS, not as it was authored.
  const live = currentRoomScene();
  for (const id of ids) {
    const base = sc.parts.find((p) => p.id === id);
    const eff = live.find((p) => p.id === id);
    if (!base || !eff) continue;
    const { pos, rot, dimMM } = eff;

    // Probe with a stand-in that IS in the parts list, so the original counts as
    // an obstacle — collidesAt exempts whatever id you name as the mover.
    const probeId = '__duplicate-probe__';
    const probeParts = [...useScene.getState().parts, { ...base, id: probeId }];
    let placed: [number, number, number] = [pos[0], pos[1], pos[2]];
    for (const [dx, dz] of COPY_OFFSETS) {
      const [cx, cz] = clampIntoFootprint(pos[0] + dx, pos[2] + dz, sc.room.footprint);
      if (!collidesAt(probeParts, probeId, [cx, pos[1], cz], rot, dimMM)) {
        placed = [cx, pos[1], cz];
        break;
      }
    }

    const copy: ScenePart = {
      ...base,
      id: `${base.category}-${uuid().slice(0, 6)}`,
      pos: placed,
      rot,
      dimMM,
      // A copy is its own piece: inheriting the merge group would make it move
      // with a group the user never added it to.
      groupId: undefined,
    };
    useScene.getState().addPart(copy);
    created.push(copy.id);
  }

  if (created.length === 0) return;
  useStudio.getState().setSelection(created, created[created.length - 1]);
  announce(created.length === 1 ? 'Copy added and selected.' : `${created.length} copies added and selected.`);
}

/** A quarter turn on every selected piece, about its own centre.
 *
 *  It deliberately does NOT shuffle anything to make room. If the turn puts a
 *  wardrobe corner through the plaster, the piece keeps its real rotation and
 *  Room check reports it — silently nudging furniture to make an action succeed
 *  is the one thing this app must never do. */
export function spinSelection(quarterTurns = 1) {
  const ids = selectedIds();
  if (ids.length === 0) return;
  const setRotation = useStudio.getState().setRotation;
  // From where each piece effectively faces — off `base.rot` alone, a second quarter
  // turn would start over from the authored heading and undo the first.
  for (const p of currentRoomScene()) {
    if (!ids.includes(p.id)) continue;
    setRotation(p.id, p.rot + (quarterTurns * Math.PI) / 2);
  }
  announce(ids.length === 1 ? 'Turned a quarter turn.' : `${ids.length} pieces turned a quarter turn.`);
}

export function selectAllParts() {
  const { parts } = useScene.getState();
  const { hidden } = useStudio.getState();
  const ids = parts.filter((p) => !hidden[p.id]).map((p) => p.id);
  if (ids.length === 0) return;
  useStudio.getState().setSelection(ids, ids[ids.length - 1]);
  announce(`${ids.length} pieces selected.`);
}

// ─── The key bindings ───────────────────────────────────────────────────────

export function KeyboardShortcuts() {
  const router = useRouter();
  const routerRef = useRef(router);
  routerRef.current = router;

  useEffect(() => {
    const unsubHistory = startHistoryRecording();

    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const meta = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();

      // Modifier combos — allowed wherever focus is in the studio.
      if (meta) {
        if (key === 'z') {
          e.preventDefault();
          const snap = e.shiftKey ? useHistory.getState().redo() : useHistory.getState().undo();
          if (snap) applySnapshot(snap);
          return;
        }
        if (e.key === ',') {
          e.preventDefault();
          routerRef.current.push('/settings');
          return;
        }
        if (key === 'd') {
          e.preventDefault();
          duplicateSelection();
          return;
        }
        if (key === 'a') {
          e.preventDefault();
          selectAllParts();
          return;
        }
        return; // leave every other browser shortcut alone
      }

      // Esc is the one bare key that stays live everywhere: it is the universal
      // way out, and there is nothing it can silently change.
      if (e.key === 'Escape') {
        useStudio.getState().setSelected(null);
        return;
      }

      // Everything below is a single character, so it only fires while the room
      // itself has focus (WCAG 2.1.4).
      if (!studioSurfaceFocused()) return;

      const s = useStudio.getState();
      switch (e.key) {
        case 'Delete':
        case 'Backspace':
          e.preventDefault();
          deleteSelection();
          return;
      }
      switch (key) {
        case 'w':
          s.setTransformMode('translate');
          break;
        case 's':
          s.setTransformMode('scale');
          break;
        case 'r':
          s.setTransformMode('rotate');
          break;
        case 'f':
          if (s.selectedPartId) s.frameSelected();
          break;
        case 'v':
          if (s.selectedPartId) s.toggleHidden(s.selectedPartId);
          break;
      }
    }

    // ── Space: the camera's pan modifier ────────────────────────────────────
    // Held rather than pressed. While it is down, CameraRig swaps the left mouse
    // button from orbit to pan and Draggable/Pickable refuse to grab or select,
    // so the gesture works over furniture as well as over bare floor. Tracked
    // here, not in CameraRig, because the 2D plan pans on the same key and this
    // component is the one thing mounted on both tabs.
    //
    // Armed only while the room itself has focus, or while nothing is focused at
    // all. Space is how a keyboard user activates the button they have tabbed to;
    // swallowing it across the whole studio would cost more than the gesture is
    // worth.
    function panKeyArmed(): boolean {
      const active = document.activeElement;
      return studioSurfaceFocused() || !active || active === document.body;
    }
    function onSpaceDown(e: KeyboardEvent) {
      if (e.code !== 'Space') return;
      if (isTypingOrDialog(e.target) || !panKeyArmed()) return;
      // Every repeat too, not just the first: Space scrolls the page otherwise.
      e.preventDefault();
      useStudio.getState().setPanKeyHeld(true);
    }
    function onSpaceUp(e: KeyboardEvent) {
      if (e.code === 'Space') useStudio.getState().setPanKeyHeld(false);
    }
    // Alt-tabbing away mid-pan never delivers the keyup, and a modifier stuck on
    // means the left button quietly stops selecting furniture.
    function releasePanKey() {
      useStudio.getState().setPanKeyHeld(false);
    }

    window.addEventListener('keydown', onKey);
    window.addEventListener('keydown', onSpaceDown);
    window.addEventListener('keyup', onSpaceUp);
    window.addEventListener('blur', releasePanKey);
    document.addEventListener('visibilitychange', releasePanKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keydown', onSpaceDown);
      window.removeEventListener('keyup', onSpaceUp);
      window.removeEventListener('blur', releasePanKey);
      document.removeEventListener('visibilitychange', releasePanKey);
      releasePanKey();
      unsubHistory();
    };
  }, []);
  return null;
}

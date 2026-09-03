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
import { usePathname, useRouter } from 'next/navigation';
import { v4 as uuid } from 'uuid';
import { useStudio, useSettings } from '@/lib/store';
import { useScene } from '@/lib/scene-store';
import { currentRoomScene, useRoomScene } from '@/lib/room-scene';
import { riderRelation } from '@/lib/rider-height';
import { turnInPlace, refusalCause } from '@/lib/drag-resolve';
import { planConvoy, travellingWorld } from '@/lib/drag-convoy';
import { cascadeTransform } from '@/lib/rigid-parent';
import { turnNudge } from '@/lib/refusal';
import { useHistory, applySnapshot, startHistoryRecording } from '@/lib/history';
import { collidesAt, type ScenePart } from '@/lib/scene-spec';
import { clampIntoFootprint } from '@/lib/footprint';
import { formatDim, formatLength } from '@/lib/units';
import { ANNOUNCE_EVENT, announce } from '@/lib/announce';
import { toast } from '@/components/ui/StorageToast';
import { confirmDialog } from '@/components/ui/Confirm';

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
//
// `announce` itself moved to `lib/announce.ts`. Only the RENDERING is left here,
// which is the half that needs to be a component; the dispatch had to be reachable
// from `lib/`, where a wall move now has a refusal to speak and cannot import a
// component to do it.

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
 *  No confirmation dialog HERE, and that is a statement about this function
 *  rather than about every delete. Removing a chair is cheap and fully reversible
 *  — history covers structure, and the toast puts the reversal one click away, on
 *  the same screen, without asking permission first. A dialog on a reversible
 *  action only teaches people to dismiss dialogs, which is what makes the
 *  irreversible ones (deleting a saved layout, resetting every transform)
 *  dangerous. Those keep their confirm; this doesn't.
 *
 *  **One caller does ask first, and the axis is intent, not blast radius.**
 *  `deleteSelection` — Delete/Backspace — puts a dialog in front of this, because
 *  a keypress can be a typing reflex that missed a field while a button labelled
 *  Delete cannot be pressed by accident in the same way. The prompt belongs to
 *  that gesture, so it lives there and not in here, where it would also catch the
 *  row trash, the context menu and the rail button.
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

/** Delete/Backspace, and the ONE delete gesture that asks first.
 *
 *  The rail's Delete button, the tree's row trash and the context menu all go
 *  straight to `removeParts` and answer with an Undo toast — that argument is
 *  unchanged and it is written out above `removeParts`. This one is different for
 *  a reason that has nothing to do with blast radius and everything to do with
 *  INTENT: pressing a button labelled Delete is a decision, and hitting Backspace
 *  is very often a typing reflex that missed a text field. Same outcome, two
 *  completely different levels of "did you mean it", so the dialog goes on the
 *  gesture that can be made by accident rather than on the one that cannot.
 *
 *  The user asked for it whether or not a group is involved, so there is no size
 *  threshold here. A count-based rule ("ask above three pieces") would put the
 *  prompt exactly where it is least needed — the deliberate multi-select — and
 *  omit it from the slip.
 *
 *  `ids` is captured BEFORE the await. The dialog is async and the selection is
 *  live; resolving it afterwards would delete whatever happened to be selected
 *  when the user pressed Delete in the dialog, which is the same class of defect
 *  as a convoy member resolving against a fresh world instead of a snapshot. */
export async function deleteSelection() {
  const ids = selectedIds();
  if (ids.length === 0) return;
  const sc = useScene.getState().parts;
  const names = ids
    .map((id) => sc.find((p) => p.id === id)?.name)
    .filter((n): n is string => !!n);

  const ok = await confirmDialog({
    title: names.length === 1 ? `Delete “${names[0]}”?` : `Delete ${ids.length} pieces?`,
    // Enumerated rather than counted: `body` is a ReactNode precisely so a
    // destructive dialog can say WHAT it destroys. A merged set is the case that
    // needs it — "3 pieces" does not tell you the two nightstands are going with
    // the bed, and that surprise is what this whole item started as.
    body:
      names.length === 1 ? (
        'It leaves the room. You can undo this.'
      ) : (
        <>
          <div style={{ marginBottom: 8 }}>These leave the room together:</div>
          <ul style={{ margin: 0, paddingInlineStart: 20 }}>
            {names.map((n, i) => (
              <li key={`${n}-${i}`}>{n}</li>
            ))}
          </ul>
        </>
      ),
    confirmLabel: 'Delete',
    danger: true,
  });
  if (!ok) return;
  removeParts(ids);
}

/** @param explicit which pieces to copy, when the gesture names them rather than
 *  meaning "the selection" — Ctrl-clicking one row in the rail says add another of
 *  THAT, whatever happens to be selected. */
export function duplicateSelection(explicit?: string[]) {
  const ids = explicit ?? selectedIds();
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
    // A copy of a rider is a rider. `pos` above came from `currentRoomScene()`, so it
    // carries the height its support was CORRECTED to — an authored Y that
    // `resetTransforms` cannot reach and `RoomSync` persists. Without the relation the
    // copy is severed from the piece it was cloned from: shrink the desk back and the
    // original returns while the copy stays where it was, two identical lamps 450 mm
    // apart on one desk. `riderRelation` answers for a seeded rider as well as a
    // dragged one, and if the copy landed clear of the support `stillOver` drops the
    // edge on the next read.
    const on = riderRelation(sc.parts, useStudio.getState().parentIds)[id];
    if (on) useStudio.getState().setParent(copy.id, on);
    created.push(copy.id);
  }

  if (created.length === 0) return;
  useStudio.getState().setSelection(created, created[created.length - 1]);
  announce(created.length === 1 ? 'Copy added and selected.' : `${created.length} copies added and selected.`);
}

/** A quarter turn on every selected piece, about its own centre.
 *
 *  **The angle is always taken; that is what "keep and report" means here** (§ B.14,
 *  decided 2026-09-03). Refusing a turn would make a piece in a tight corner
 *  unturnable, which no report has ever asked for. What the turn does NOT do is
 *  succeed in silence: the resolve says whether the piece still fits at the new
 *  angle, and this says so out loud.
 *
 *  It used to do neither. `spinSelection` wrote `setRotation` raw — the fourth turn
 *  gesture in the app and the only one that ran through no pipeline at all, so it
 *  had no containment, no legality answer, and left a piece's rigid children behind
 *  when it turned: a quarter turn on a nightstand spun the nightstand and left the
 *  lamp facing the old way, beside it. Its docblock defended that as rule 2's "never
 *  silently nudge furniture", which reads well and was the wrong half of the rule —
 *  the plan's turn handle, its two keyboard paths and the 3D gizmo all clamp AND
 *  report, and one gesture reached four ways must not be four answers. `turnInPlace`
 *  is where those three decisions live; this is now the fourth caller rather than
 *  the exception. Two documents in this repo had drifted into calling the same
 *  outcome the contract and the defect, which is what a rule with no single owner
 *  does.
 *
 *  Each selected piece is an INDEPENDENT turn about its own centre — a set does not
 *  pivot about one of its members, which is the rule `resolveConvoy` states for
 *  'turn' — so the scene is re-read per piece and the second piece sees where the
 *  first one ended up. */
export function spinSelection(quarterTurns = 1) {
  const ids = selectedIds();
  if (ids.length === 0) return;
  const { setRotation, setPosition, setTransformsFor } = useStudio.getState();
  const room = useScene.getState().room;
  const dimUnit = useSettings.getState().dimUnit;

  /** Pieces the room would not take at the new angle, in selection order. */
  const refused: Array<{ name: string; why: string }> = [];
  /** Pieces the containment clamp had to SLIDE to keep the turn inside the room.
   *  Not a refusal — the turn is taken — but not silence either. */
  const nudged: Array<{ name: string; by: number }> = [];

  for (const id of ids) {
    const scene = currentRoomScene();
    const part = scene.find((p) => p.id === id);
    if (!part) continue;
    const parentIds = useStudio.getState().parentIds;
    const convoy = planConvoy({
      draggedId: id,
      parts: scene,
      // `[id]`, not the live selection: every selected piece turns on its own axis,
      // so none of the others is company — they stay in the world as obstacles,
      // which is exactly what they are.
      selection: [id],
      parentIds,
      footprint: room.footprint,
      roomHeight: room.height,
    });
    const turned = turnInPlace({
      part,
      at: part.pos,
      // From where the piece effectively faces — off the AUTHORED `rot` alone, a
      // second quarter turn would start over from the authored heading and undo
      // the first.
      rot: part.rot + (quarterTurns * Math.PI) / 2,
      dim: part.dimMM,
      // Delta zero — a turn moves nobody sideways — so this is the world with the
      // piece's own rigid children taken out, which is what the pipeline asks for:
      // a lamp riding a nightstand must not be able to obstruct the nightstand.
      parts: convoy.travelling.size > 1 ? travellingWorld(convoy, scene, 0, 0, convoy.own) : scene,
      footprint: room.footprint,
      roomHeight: room.height,
    });

    const pos = turned.pos;
    if (pos[0] !== part.pos[0] || pos[1] !== part.pos[1] || pos[2] !== part.pos[2]) setPosition(id, pos);
    setRotation(id, turned.rot);
    // …and everything standing on it turns with it, about the pivot it ACTUALLY
    // ended on: cascading from `part.pos` while the clamp had moved the piece
    // elsewhere would leave the lamp orbiting where the nightstand used to be.
    if (convoy.own.length > 0) setTransformsFor(cascadeTransform(id, pos, turned.rot, convoy.own));
    if (!turned.valid) refused.push({ name: part.name, why: refusalCause(turned) });
    else {
      // Only when it FITS. A piece that is refused already has a sentence, and two
      // sentences about one piece is worse than one.
      const by = turnNudge(part.pos, pos);
      if (by > 0) nudged.push({ name: part.name, by });
    }
  }

  const said = ids.length === 1 ? 'Turned a quarter turn.' : `${ids.length} pieces turned a quarter turn.`;
  // Named rather than counted: "one of them does not fit" sends the user hunting.
  // The wording matches `PlanView`'s `turnByKey`, which is the same sentence about
  // the same outcome on the other surface.
  const parts: string[] = [said];
  if (refused.length > 0) {
    parts.push(`${refused[0].name} does not fit at that angle — ${refused[0].why}`);
    if (refused.length > 1) parts.push(`${refused.length - 1} more do not fit either.`);
  }
  if (nudged.length > 0) {
    parts.push(`${nudged[0].name} moved ${formatLength(nudged[0].by * 1000, dimUnit)} to stay in the room.`);
    if (nudged.length > 1) parts.push(`${nudged.length - 1} more moved too.`);
  }
  announce(parts.join(' '));
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
  // Which tab is on screen. Read through a ref for the same reason the router is:
  // the key handler is installed once and must not be re-bound per navigation.
  const pathname = usePathname();
  const onPlanTab = useRef(false);
  onPlanTab.current = !!pathname?.endsWith('/plan');

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
          // Not while a gesture is in flight. `lib/history.ts` makes the drag the
          // unit of an undo step by refusing to SNAPSHOT during one, but nothing
          // refused the undo itself: taken mid-drag, `applySnapshot` replaces the
          // whole `positions` map, and the drop then writes the dragged piece from
          // its live object3D and the convoy from the pre-undo `startPos` — putting
          // both back where the drag had them. The gesture-end push that follows
          // clears `future`, so the undo is undone AND its redo is gone. Swallowed
          // rather than queued: the gesture is what the user is doing, and it ends
          // on release a moment later.
          if (useStudio.getState().draggingId) return;
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
          // `void`: the dialog is async and nothing here waits on it. The key
          // handler must stay synchronous so `preventDefault` above still lands.
          void deleteSelection();
          return;
      }
      // The gizmo's three modes only exist on the 3D tab. Armed on the plan they
      // silently changed a setting on the other screen — press R over a floor plan
      // and nothing happens here, while the 3D gizmo quietly becomes Rotate.
      if (!onPlanTab.current) {
        switch (key) {
          case 'w':
            s.setTransformMode('translate');
            return;
          case 's':
            s.setTransformMode('scale');
            return;
          case 'r':
            s.setTransformMode('rotate');
            return;
        }
      }
      switch (key) {
        case 'f':
          if (s.selectedPartId) s.frameSelected();
          break;
        // H, not V. V was the modelling-tool convention (Blender, Maya) and it is
        // the one binding here nobody could guess from the app itself — the word
        // on the menu item, in the layer tree's tooltip and in the help card is
        // "Hide". A mnemonic that matches the label is worth more than a
        // convention borrowed from software this app is not.
        case 'h':
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

'use client';

// The 2D plan. It used to be the 3D view minus features; it now has two things
// the 3D view cannot do:
//
//   · It shades the ergonomic rules from lib/clearance.ts as actual floor
//     regions — the walkway a person needs between bulky pieces, the arc a door
//     sweeps, the strip beside a bed. Those rules previously only existed as a
//     list of complaints in Room check. Here they are geometry you can design
//     against before you get told off.
//   · It is reachable without a pointer. Pieces, walls and the rotate handle are
//     focusable and take arrow keys, and the view pinches, pans and zooms by
//     touch instead of by modifier key.
//
// It also no longer refuses work silently: a drag that collides tints red and
// slides along whatever it hit, matching the 3D Draggable.

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { useStudio, useSettings } from '@/lib/store';
import { currentRoomScene, useRoomScene } from '@/lib/room-scene';
import { useScene } from '@/lib/scene-store';
import { DND_MIME, placeNewPart, selectionForPick, type Category, type ScenePart, type Shape } from '@/lib/scene-spec';
import { entranceComponents, floorBlockers } from '@/lib/clearance';
import { buildClearanceField, fieldRuns, FREE_CELL } from '@/lib/clearance-field';
import { accessZones } from '@/lib/layout-rules';
import { footFromPart, obbExtentAlong, obbFromPart, rayToBoundary } from '@/lib/geometry';
import { hitsAt, hitsInRect, nextInCycle, planPaintOrder, type CycleState } from '@/lib/plan-hit';
import { wallSegments, footprintBounds } from '@/lib/footprint';
import { moveWallCarrying, wallAttachments } from '@/lib/wall-actions';
import { resolvePlacement, snapSteps, turnInPlace } from '@/lib/drag-resolve';
import { refusalAfterGesture, REFUSAL_HOLD_MS } from '@/lib/refusal';
import { snapGuideEnds, type SnapLine } from '@/lib/item-snap';
import { convoyRestore, planConvoy, resolveConvoy, travellingWorld, type Convoy } from '@/lib/drag-convoy';
import { cascadeTransform } from '@/lib/rigid-parent';
import { formatDim } from '@/lib/units';
import { clientDeltaToViewBox, clientToViewBox } from '@/lib/plan-view-transform';
import { v4 as uuid } from 'uuid';
import { announce, removeParts, studioSurfaceFocused } from './KeyboardShortcuts';
import { openPickMenu, openSceneMenu } from './SceneContextMenu';

const SCALE = 100; // px per metre at zoom = 1, in viewBox units
const PAD = 80;
/** Exported so the page's toolbar can disable at the limits — it used to own
 *  the buttons and the bounds together. */
export const MIN_ZOOM = 0.4;
export const MAX_ZOOM = 4;
/** How far one arrow press moves a wall. */
const WALL_STEP = 0.05;

// There are no ergonomic thresholds in this file. There used to be: 600 mm in
// front of doors and drawers, a 500 mm bedside strip, and the three categories
// that get a front band — a third hand-kept copy of numbers that also live in the
// room report and the layout solver, with nothing tying any of them together. The
// bands are read off `accessZones` now, which is where the rules are, so the plan
// draws exactly what Room check measures and what Suggest optimises. It also gains
// the rules it never knew about: a desk's chair, a dining table's seats, a window's
// band, and the difference between a single bed (one side) and a double (both).
//
// Circulation went the same way earlier: the walkway used to be each bulky piece's
// footprint inflated by half of 600 mm, which is a decent picture of one rule and a
// poor picture of the room. `lib/clearance-field.ts` owns it, and the plan reads
// the same raster the room report does.

/** Run states for the circulation overlay. */
const WALKABLE = 0;
const CUT_OFF = 1;

/**
 * What the page can do to this drawing. The view controls used to live in here,
 * which is why the 2D tab's chrome and the 3D tab's chrome drifted apart: one was
 * owned by a component, the other by a page. The drawing owns its own transform
 * (pinch, wheel and drag all write it) so the state stays here; the page drives it
 * through this handle and reads it back through `onViewChange`.
 */
export type PlanViewHandle = {
  zoomIn: () => void;
  zoomOut: () => void;
  rotateLeft: () => void;
  rotateRight: () => void;
  /** Back to the default framing. */
  fit: () => void;
  /** Bring the selected piece to the middle, at the current magnification. */
  frameSelection: () => void;
};

export const PlanView = forwardRef<PlanViewHandle, {
  /**
   * Reports live magnification, page rotation, and whether any walkable run is
   * cut off from the door — the last is the only thing the page's comfort legend
   * needs that it cannot compute for itself.
   */
  onViewChange?: (v: { zoom: number; rot: number; hasCutOff: boolean }) => void;
  showComfort?: boolean;
}>(function PlanView({ onViewChange, showComfort = false }, ref) {
  const ROOM_DYN = useScene((s) => s.room);
  // Footprints can be off-centre (independent wall moves), so map world↔pixels
  // through the bounding box, not ±width/2.
  const bounds = footprintBounds(ROOM_DYN.footprint);
  const baseW = bounds.width * SCALE + PAD * 2;
  const baseH = bounds.depth * SCALE + PAD * 2;
  const parts = useRoomScene();
  const dimUnit = useSettings((s) => s.dimUnit);
  const selected = useStudio((s) => s.selectedPartId);
  const selection = useStudio((s) => s.selection);
  const setSelected = useStudio((s) => s.setSelected);
  const setSelection = useStudio((s) => s.setSelection);
  const toggleInSelection = useStudio((s) => s.toggleInSelection);
  const setPosition = useStudio((s) => s.setPosition);
  const setRotation = useStudio((s) => s.setRotation);
  const setTransformsFor = useStudio((s) => s.setTransformsFor);
  const setDragging = useStudio((s) => s.setDragging);
  const panKey = useStudio((s) => s.panKeyHeld);
  const selectedWall = useStudio((s) => s.selectedWall);
  const setSelectedWall = useStudio((s) => s.setSelectedWall);
  const snapMode = useStudio((s) => s.snapMode);
  const hovered = useStudio((s) => s.hoveredPartId);
  const setHovered = useStudio((s) => s.setHovered);
  const hidden = useStudio((s) => s.hidden);

  // What the drawing shows, and what a pointer can therefore reach. `H` hides a
  // piece from the plan exactly as it hides one from the 3D tree
  // (`Room.tsx` filters the same way) — a piece that is invisible in one tab and
  // draggable in the other is not a state the UI can name.
  //
  // `parts` stays the full list everywhere the ROOM is being measured rather than
  // drawn: collision, the circulation field and the comfort rules all keep hidden
  // furniture, because hiding is a way of looking at the arrangement and not a
  // deletion from it — and because Room check counts hidden pieces too. Hiding a
  // sofa must not make the room read as walkable through the sofa.
  const visible = useMemo(() => parts.filter((p) => !hidden[p.id]), [parts, hidden]);
  // Back-to-front, so the rug ends up under the table and a click lands on the
  // smallest thing under the cursor rather than on whatever was added last.
  const painted = useMemo(() => planPaintOrder(visible), [visible]);

  // Circulation, straight off the same field lib/clearance.ts reports from — and
  // only while the overlay is on, since building it costs a distance transform.
  const walkRuns = useMemo(() => {
    if (!showComfort) return [];
    const blockers = floorBlockers(parts);
    const field = buildClearanceField(
      blockers.map((p) => obbFromPart(p.pos, p.rot, p.dimMM)),
      ROOM_DYN.footprint,
    );
    if (!field) return [];
    // No door means no way to know which side anyone comes in from, so every
    // walkable region is drawn as walkable rather than guessed at.
    const entrance = entranceComponents(field, parts);
    return fieldRuns(field, (at) => {
      if (field.cover[at] !== FREE_CELL) return -1;
      const id = field.component[at];
      if (id < 0) return -1; // free floor, but too tight to stand in
      return !entrance || entrance.has(id) ? WALKABLE : CUT_OFF;
    });
  }, [showComfort, parts, ROOM_DYN.footprint]);

  // Hoisted to sit with walkRuns rather than with the view controls: the effect
  // that reports it upward runs earlier in the body than `fit` does.
  const hasCutOff = useMemo(() => walkRuns.some((r) => r.state === CUT_OFF), [walkRuns]);

  // Keyboard steps track the gizmo's snap setting so the two agree: 10 mm / 15°
  // fine, 50 mm / 45° coarse. "Off" still steps — a key press has to be discrete —
  // which is why this asks `snapSteps` for the coarse/fine pair and then supplies
  // its own floor rather than using the null it returns for 'off'.
  const steps = snapSteps(snapMode === 'off' ? 'fine' : snapMode);
  const nudge = steps.translate ?? 0.01;
  const spin = steps.rotate ?? Math.PI / 12;

  // Wall-drag bookkeeping — measure the pointer along the wall's outward normal
  // and feed incremental deltas to the store (matches the 3D handle). `attached`
  // is what this wall carries, resolved once on pointer-down: re-resolving it per
  // frame lets a piece near the tolerance detach mid-drag (lib/wall-actions.ts).
  const wallDragRef = useRef<{
    index: number;
    outX: number;
    outZ: number;
    downAlong: number;
    prevTotal: number;
    attached: string[];
  } | null>(null);

  const rootRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{
    id: string;
    mode: 'translate' | 'rotate';
    startAngle: number;
    startRot: number;
    startX: number;
    startY: number;
    moved: boolean;
    /** Where the piece was before the gesture, so Escape can put it back. */
    startPos: [number, number, number];
    /**
     * What was selected when the press landed — before this gesture's own
     * press-time write, which is the whole point of recording it.
     *
     * Drill-in asks "did this pick come from inside the group" (see
     * `selectionForPick`), and the press answers that question once already by
     * selecting an unselected set WHOLE. Asking the live selection again on release
     * therefore reads the answer the press just wrote and drills straight into it,
     * so a single click on a merged set would land on one piece and the set could
     * never be selected by clicking it at all.
     */
    selDown: readonly string[];
    /**
     * Where inside the piece the press landed, in world metres — subtracted from
     * every later pointer position so the piece travels WITH the cursor instead of
     * jumping its own centre under it.
     *
     * The 3D tab has always done this (`Draggable`'s `offX`/`offZ`); the plan
     * passed `svgToWorld(e)` straight to `moveTo`, so the two tabs disagreed about
     * what a drag even means. On one piece it read as a shrug — the piece jumps
     * once and then tracks. With a SET it was a bug with a bad message: the convoy
     * delta is measured from `startPos`, so grabbing a 2 m sofa near its end made
     * the delta ~1 m before the pointer had moved at all, and every companion was
     * flung a metre and the set refused, naming whichever member ran out of room.
     */
    grab: { x: number; z: number };
    /**
     * The scene as it stood at pointer-down, and it must be a snapshot.
     *
     * `travellingWorld` and `resolveConvoy` both place the company at
     * `startPos + delta`, where the delta is measured from pointer-down — so a
     * list whose travelling pieces have ALREADY been written forward by the
     * previous frames shifts them a second time and puts every phantom at
     * `start + 2×delta`. This passed the live `useRoomScene()` memo, so the plan
     * alone lost a lamp off its desk on a multi-select drag and refused sets with
     * a collision against a phantom that was never there. The 3D tab was right
     * only because `Draggable` happens to cache `effParts()` for the gesture.
     */
    world: ScenePart[];
    /**
     * Everything travelling with this piece — what is resting on it, the rest of
     * the multi-selection, whatever merged group any of them belongs to, and where
     * each of them started. Resolved ONCE at pointer-down: re-resolving per frame
     * is what lets a piece near a tolerance detach mid-drag, the same trap
     * `wallAttachments` documents for walls.
     *
     * Both the membership and the start transforms live in `lib/drag-convoy.ts`
     * now, which is also where the reason each start position matters is written
     * down — and it is not the scheduling story this comment used to tell. It is
     * that a member's own resolve applies corrections the set then accepts, so
     * stepping from the last frame compounds them while stepping from the start is
     * idempotent. See `ConvoyMember.startPos`.
     */
    convoy: Convoy;
    /**
     * The alignment guides the last accepted resolve produced, so the drawing can
     * show them. `resolvePlacement` has always returned these and the 3D tab has
     * always drawn them (`MeasureGuides`); the plan silently dropped them, which
     * made the shared pipeline's most visible output tab-specific — and this is the
     * tab where "is that level with the wardrobe?" is the question being asked.
     *
     * Written from `moveTo`, not from a memo: `moveTo` tries the full move and then
     * each axis alone, so only IT knows which candidate was accepted, and the lines
     * belong to that one. Recomputing them for the render would re-run the snap
     * against a position the piece may not have taken.
     */
    snapLines: SnapLine[];
  } | null>(null);
  const [, force] = useState(0);

  // Which piece is currently refusing to move, and which element has keyboard
  // focus (SVG shapes get no :focus-visible ring of their own).
  /** Everything to outline on a refusal: ALWAYS the piece under the hand, plus the
   *  member that actually ran out of room when that is someone else.
   *
   *  It was the blocker alone, which is invisible in the two cases that matter — a
   *  member hidden by a filter, or one simply outside the current pan — leaving a
   *  drag that silently stops with nothing on screen to say why (the naming
   *  sentence goes to an `.sr-only` live region). The 3D tab always reddens the
   *  dragged piece and names the member in its size tag; this is the same promise,
   *  and the two tabs must not answer "which piece is wrong" differently. */
  const [blockedIds, setBlockedIds] = useState<string[]>([]);
  const blockedRef = useRef(false);
  /** What the last refusal SAID, so a streak that changes its mind says so.
   *
   *  `blockedRef` alone gated the announcement, and it is a boolean: once a drag was
   *  refusing, dragging on until a DIFFERENT member became the blocker announced
   *  nothing, so the spoken sentence went on naming a piece that was no longer the
   *  answer. Keyed on the blocker rather than incremented, so holding against one
   *  obstacle still says it once. */
  const announcedRef = useRef<string | null>(null);
  const blockTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);

  // Pan + zoom + rotate
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  /** view rotation in radians around viewport center */
  const [rot, setRot] = useState(0);
  const panRef = useRef<{ startX: number; startY: number; ox: number; oy: number } | null>(null);
  // An Alt-press waiting to become a pick on release, and the cycle it belongs to.
  // The cycle lives in a ref rather than in the store: it is the memory of one
  // gesture, and `nextInCycle` already restarts itself when the pointer moves or
  // the candidates change under it.
  const altRef = useRef<{ x: number; z: number; sx: number; sy: number; pointerId: number } | null>(null);
  const cycleRef = useRef<CycleState | null>(null);
  // A marquee in progress. The live rectangle is state (it has to paint) while the
  // gesture itself is a ref (it must not re-render per frame to stay correct).
  const marqueeRef = useRef<{
    x0: number;
    y0: number;
    left: number;
    top: number;
    pointerId: number;
    extend: boolean;
    moved: boolean;
  } | null>(null);
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  // Live touch points, so two fingers can pinch. Without this the plan was
  // buttons-only for zoom and had no pan gesture at all on a touch screen.
  const touchRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchRef = useRef<{ dist: number; zoom: number; cx: number; cy: number; ox: number; oy: number } | null>(null);

  useEffect(() => () => {
    if (blockTimer.current) clearTimeout(blockTimer.current);
    // Leaving this tab must not leave a hover behind. `hoveredPartId` is studio-
    // wide — the 3D tab's Highlight and the shared HoverCard both read it — so an
    // id written here outlives the view that wrote it, which is the same trap
    // `Pickable`'s unmount effect exists for.
    if (useStudio.getState().hoveredPartId) useStudio.getState().setHovered(null);
    // …and the same is true of `draggingId`, which now costs more than a stuck
    // hover. Press a piece or a wall handle here and hit Ctrl+, — the router
    // leaves for /settings with no drag guard, this view unmounts mid-gesture,
    // and the flag survives in the studio store. `lib/history.ts` returns early
    // from `scheduleSnapshot` while it is set, so from that moment nothing in any
    // room is recorded again: undo does not look broken, it looks fine, until one
    // Ctrl+Z rolls back an arbitrary amount of unrecorded work. `Draggable` has
    // had this cleanup since before the history gate existed.
    if (useStudio.getState().draggingId) setDragging(null);
  }, [setDragging]);

  useEffect(() => {
    onViewChange?.({ zoom, rot, hasCutOff });
  }, [zoom, rot, hasCutOff, onViewChange]);

  // Escape, during a drag, puts the piece back — the way it does in every 3D
  // tool. It is bound in the capture phase so it beats the studio's global
  // Escape (which means "deselect"), and it declines the key whenever no drag is
  // in flight, so that global meaning is untouched the rest of the time.
  //
  // It puts back EVERYTHING the drag moved, not just the piece under the pointer.
  // It used to restore only that one, which left a lamp that had ridden along on a
  // desk hanging in mid-air where the cancelled drag had abandoned it, and every
  // member of a merged group scattered. `convoyRestore` answers that in one place
  // for both surfaces, and answers it by replaying the pure cascade from the start
  // transform rather than by snapshotting a second copy of it.
  //
  // Only a piece-drag is undone, not a wall-drag: a wall moves incrementally and
  // carries what is mounted on it, so "where it started" is not one number to put
  // back. Ctrl+Z is the route there, and it is one gesture in history.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      const d = dragRef.current;
      if (!d) return;
      e.preventDefault();
      e.stopPropagation();
      setTransformsFor(
        convoyRestore(
          d.convoy,
          d.id,
          d.startPos,
          d.startRot,
          // `d.mode === 'rotate'` used to stand where the second of these does. It
          // is honest and it is incomplete: `moveTo` re-aims a wall rider on a
          // TRANSLATE (`if (r.rot !== part.rot) setRotation(...)`), so cancelling a
          // picture slid along a wall left it facing the wall it never reached.
          (id) => useStudio.getState().positions[id] !== undefined,
          (id) => useStudio.getState().rotations[id] !== undefined,
        ),
      );
      dragRef.current = null;
      setDragging(null);
      if (blockedRef.current) clearBlocked();
      announce('Put back where it was.');
      force((v) => v + 1);
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [setTransformsFor, setDragging]);

  const fit = useCallback(() => {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
    setRot(0);
  }, []);


  // The page's toolbar drives these. Zoom steps are 1.15× to match the wheel, so
  // the buttons and the wheel do not disagree about what "one step" means.
  /** Put the selected piece in the middle of the view, keeping the current
   *  magnification. `fit` resets the whole view, which is a different question —
   *  and the reason `F` did nothing here at all: it is bound to the CAMERA's
   *  frameSelected, and the plan has no camera. */
  const frameSelection = useCallback(() => {
    const id = useStudio.getState().selectedPartId;
    if (!id) return;
    const part = currentRoomScene().find((p) => p.id === id);
    if (!part) return;
    // Where the piece sits in the un-panned drawing, then the pan that brings
    // that point to the centre of the viewBox. Rotation is applied about the
    // centre, so a centred point stays centred whatever the page angle.
    const sx = PAD + (part.pos[0] - bounds.minX) * SCALE;
    const sy = PAD + (part.pos[2] - bounds.minZ) * SCALE;
    setOffset({ x: baseW / 2 - sx * zoom, y: baseH / 2 - sy * zoom });
  }, [bounds.minX, bounds.minZ, baseW, baseH, zoom]);

  useImperativeHandle(
    ref,
    () => ({
      zoomIn: () => setZoom((z) => Math.min(MAX_ZOOM, z * 1.15)),
      zoomOut: () => setZoom((z) => Math.max(MIN_ZOOM, z / 1.15)),
      rotateLeft: () => setRot((r) => r - Math.PI / 12),
      rotateRight: () => setRot((r) => r + Math.PI / 12),
      fit,
      frameSelection,
    }),
    [fit, frameSelection],
  );
  function toViewBox(clientX: number, clientY: number): { x: number; y: number } {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    // Through lib/plan-view-transform, which knows the <svg> is `xMidYMid meet`
    // and so maps by one uniform scale plus a centring offset. Doing it by
    // `baseW / rect.width` per axis is the mapping for a drawing we do not draw,
    // and it is wrong by both terms whenever the canvas's aspect is not the
    // room's — i.e. whenever a rail has been resized.
    return clientToViewBox(svg.getBoundingClientRect(), baseW, baseH, clientX, clientY);
  }

  function svgToWorld(e: React.PointerEvent | PointerEvent): { x: number; z: number } {
    return svgToWorldAt(e.clientX, e.clientY);
  }

  /** The same mapping from a bare point, which a marquee needs: its first corner
   *  is remembered from a press that is long over by the time it is resolved. */
  function svgToWorldAt(clientX: number, clientY: number): { x: number; z: number } {
    const p = toViewBox(clientX, clientY);
    // undo view rotation around viewport center
    const cx = baseW / 2;
    const cy = baseH / 2;
    const dx = p.x - cx;
    const dy = p.y - cy;
    const cos = Math.cos(-rot);
    const sin = Math.sin(-rot);
    const ux = dx * cos - dy * sin + cx;
    const uy = dx * sin + dy * cos + cy;
    // undo pan + zoom
    const sx = (ux - offset.x) / zoom;
    const sy = (uy - offset.y) / zoom;
    return {
      x: (sx - PAD) / SCALE + bounds.minX,
      z: (sy - PAD) / SCALE + bounds.minZ,
    };
  }

  function zoomAbout(next: number, cx: number, cy: number, fromZoom: number, ox: number, oy: number) {
    const k = next / fromZoom;
    setOffset({ x: cx - (cx - ox) * k, y: cy - (cy - oy) * k });
    setZoom(next);
  }

  /**
   * A piece dragged out of the library, dropped where the pointer is.
   *
   * The plan used to catch no drop at all, so the library's rows were made
   * un-draggable here and it offered click-to-drop-in-the-centre instead — a
   * reasonable answer to "there is nowhere to drop", and a strange one for the
   * view that is literally a map of the floor. Same contract as the 3D tab's
   * `onDrop`, and it is now the whole contract: `placeNewPart` decides the piece's
   * own rules — a piece that RIDES a wall takes the wall nearest where you let go,
   * and everything else is placed at the drop point, kept inside the room by
   * `placeNewPart` itself.
   *
   * This comment used to say the pointer supplied the spot "for the ones that
   * stand on the floor", and both handlers clamped the drop only for those. That
   * was the ceiling fan's bug: a fan is wall-MOUNTED by the centred-geometry test
   * and rides no wall, so nothing put it on a wall and nothing pulled it into the
   * room either, and it landed wherever you released the pointer — outside the
   * walls included.
   */
  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    const raw = e.dataTransfer.getData(DND_MIME);
    if (!raw) return;
    let item: { label: string; category: Category; shape: Shape; dimMM: [number, number, number] };
    try {
      item = JSON.parse(raw);
    } catch {
      return;
    }
    const { room, parts: existing, addPart } = useScene.getState();
    // The drop point goes IN, exactly as it does on the 3D tab: a wall-mounted piece
    // takes the wall nearest where it was aimed rather than the wall nearest the
    // room's centre. Leaving it out is what made "same contract as the 3D tab's
    // onDrop" false above — a TV let go against the left wall landed on whichever
    // wall the default picked.
    const w = svgToWorldAt(e.clientX, e.clientY);
    const { pos, rot, wallMounted } = placeNewPart(item.category, item.shape, item.dimMM, room, existing, [
      w.x,
      w.z,
    ]);
    // Keeping the drop inside the room is `placeNewPart`'s job now — see there.
    const [x, y, z] = pos;
    const id = `${item.category}-${uuid().slice(0, 6)}`;
    addPart({
      id,
      category: item.category,
      name: item.label,
      shape: item.shape,
      pos: [x, y, z],
      rot,
      dimMM: item.dimMM,
      locked: false,
      wallMounted,
    });
    setSelected(id);
    announce(`${item.label} added.`);
  }

  function onWheel(e: React.WheelEvent) {
    e.preventDefault();
    const p = toViewBox(e.clientX, e.clientY);

    // A trackpad's two-finger scroll arrives here as a wheel event, which is why
    // this view had no pan on a laptop at all: every scroll was a zoom, and the
    // three pans left all wanted a key or a button a laptop does not have.
    //
    //   · Ctrl + wheel is what a PINCH reports on macOS and Windows, so it stays
    //     zoom. (Blender spends Ctrl+wheel on panning; here pinch wins — losing
    //     pinch-to-zoom on a laptop costs more than a third pan gesture gains.)
    //   · A horizontal component means a real two-axis gesture: a mouse wheel
    //     essentially never sends deltaX, a trackpad routinely does. Pan.
    //   · Shift + wheel pans sideways, as it does in most 2D editors.
    //   · Everything else is a mouse wheel, and keeps zooming exactly as before.
    const svg = svgRef.current;
    const pan = !e.ctrlKey && (e.shiftKey || e.deltaX !== 0);
    if (pan && svg) {
      const dx = e.shiftKey && e.deltaX === 0 ? -e.deltaY : -e.deltaX;
      const dy = e.shiftKey && e.deltaX === 0 ? 0 : -e.deltaY;
      const d = clientDeltaToViewBox(svg.getBoundingClientRect(), baseW, baseH, dx, dy);
      setOffset({ x: offset.x + d.x, y: offset.y + d.y });
      return;
    }

    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    zoomAbout(clamp(zoom * factor, MIN_ZOOM, MAX_ZOOM), p.x, p.y, zoom, offset.x, offset.y);
  }

  // ── Moving a piece ────────────────────────────────────────────────────────

  /** Resolve a target through the SHARED pipeline — the same one the 3D drag
   *  uses (`lib/drag-resolve`), so the snap setting, the wall magnetism, the
   *  item-to-item alignment and gravity all behave identically in both tabs.
   *
   *  `parts` rather than `visible`: a hidden piece is still furniture in the way,
   *  and dragging through one because you cannot see it would be a trap. */
  function resolveAt(
    part: ScenePart,
    rawX: number,
    rawZ: number,
    convoy: Convoy,
    /** The pointer-down snapshot — see `world` on `dragRef`. */
    world: ScenePart[],
    /** Where the dragged piece began, so the company can be shifted by the delta. */
    startPos: [number, number, number],
  ) {
    return resolvePlacement({
      part,
      rawX,
      rawZ,
      rot: part.rot,
      dim: part.dimMM,
      parts:
        convoy.travelling.size > 1
          ? travellingWorld(convoy, world, rawX - startPos[0], rawZ - startPos[2], convoy.own)
          : world,
      footprint: ROOM_DYN.footprint,
      roomHeight: ROOM_DYN.height,
      snapMode,
      // The plan has no live object to read a mount height off, so the stored one
      // is the answer — which is also what keeps a picture at picture height when
      // it is slid along a wall from up here.
      currentY: part.pos[1],
      // Null unless this piece rides a wall and has company: a wall flip mid-drag
      // is a jump the whole set would translate by. See `Convoy.leadEdge`.
      wallEdge: convoy.leadEdge,
    });
  }

  function clearBlocked() {
    blockedRef.current = false;
    announcedRef.current = null;
    if (blockTimer.current) clearTimeout(blockTimer.current);
    // Let the red linger a moment so a refusal is still visible if the user lets
    // go the instant it happens.
    blockTimer.current = setTimeout(() => setBlockedIds([]), REFUSAL_HOLD_MS);
  }

  /** Try the full move, then each axis alone, so a piece slides along whatever it
   *  hit rather than freezing. Returns false if nothing was possible — and says
   *  so, out loud and in colour, instead of returning silently. */
  function moveTo(part: ScenePart, rawX: number, rawZ: number): boolean {
    // A drag has its convoy already; an arrow-key nudge has no gesture to hang one
    // off, so it asks for the same answer on the spot. Both routes therefore carry
    // the same company, which they did not: the keys moved one piece out of a
    // selection while the mouse moved one piece out of a selection differently.
    const drag = dragRef.current;
    const convoy =
      drag?.convoy ??
      planConvoy({
        draggedId: part.id,
        parts,
        selection: useStudio.getState().selection,
        parentIds: useStudio.getState().parentIds,
        footprint: ROOM_DYN.footprint,
        roomHeight: ROOM_DYN.height,
      });
    const startPos = drag?.startPos ?? part.pos;
    // A nudge has no gesture, so the live scene IS its pointer-down state and the
    // delta is measured from where the piece is standing now.
    const world = drag?.world ?? parts;
    const candidates: Array<[number, number]> = [
      [rawX, rawZ],
      [rawX, part.pos[2]],
      [part.pos[0], rawZ],
    ];
    let blocker: ScenePart | undefined;
    /** Every member of the FIRST refused candidate, so the drawing can outline them
     *  all. `blocked` names one piece because a sentence naming four is a sentence
     *  nobody finishes; the outline has no such limit and used to inherit it anyway,
     *  so a set stopped by three pieces sent the user to fix one at a time while the
     *  refusal appeared to wander round the room. */
    let refusers: string[] = [];
    for (const [tx, tz] of candidates) {
      const r = resolveAt(part, tx, tz, convoy, world, startPos);
      if (!r.valid) continue;
      // Where the company lands, and its veto. A candidate this piece could take
      // but its set cannot is not a candidate: the set refuses as a unit rather
      // than deforming or shoving a member through the plaster.
      const co = resolveConvoy({
        convoy,
        // Always: the plan's rotate never comes through here — it writes the angle
        // directly, and its rigid children ride the cascade below.
        gesture: 'move',
        draggedId: part.id,
        pos: r.pos,
        rot: r.rot,
        startPos,
        parts: world,
        footprint: ROOM_DYN.footprint,
        roomHeight: ROOM_DYN.height,
        // `setTransformsFor` below is what creates these, so the question has to be
        // asked of the store as it stands this frame, not of the pointer-down
        // snapshot in `dragRef`.
        memberHasPosOverride: (id) => useStudio.getState().positions[id] !== undefined,
      });
      if (!co.valid) {
        // Remembered for the message, but the slide candidates are still tried: a
        // set stopped from moving diagonally can usually still go along one axis.
        blocker = blocker ?? co.blocked;
        refusers = refusers.length > 0 ? refusers : co.blockedIds;
        continue;
      }
      // The guides belong to the candidate that was ACCEPTED — assigned here
      // rather than derived in the render, for the reason on `snapLines` above.
      // Empty when nothing snapped, which is the common case and draws nothing.
      if (drag) drag.snapLines = r.snapLines ?? [];
      const moved = r.pos[0] !== part.pos[0] || r.pos[1] !== part.pos[1] || r.pos[2] !== part.pos[2];
      if (moved) setPosition(part.id, r.pos);
      // A wall-mounted piece is turned by the wall it lands on, not by the drag.
      if (r.rot !== part.rot) setRotation(part.id, r.rot);
      // Everything travelling, in ONE store update: what is resting on this piece
      // (the plan used to leave a lamp behind while its desk moved), the rest of
      // the selection, and any merged group. See lib/drag-convoy.ts.
      if (moved && co.moves.length > 0) setTransformsFor(co.moves);
      if (blockedRef.current) clearBlocked();
      return true;
    }
    // Nothing was possible, so no alignment holds either — a guide left over from
    // the last frame that DID move would keep claiming an edge is level while the
    // piece sits refusing to go there.
    if (drag) drag.snapLines = [];
    // Cancel any pending fade — a second refusal must not be wiped by the
    // timer the first one left behind.
    if (blockTimer.current) clearTimeout(blockTimer.current);
    // The piece that refused is not always the piece under the hand: with a set in
    // motion it is whichever member ran out of room, so the sentence names that one
    // — saying "the sofa will not fit" while the sofa has clear floor all round it
    // is worse than saying nothing. Both are outlined, though: the member because
    // it is the answer, and the dragged piece because it is the only one guaranteed
    // to be on screen and unfiltered.
    setBlockedIds([part.id, ...refusers.filter((id) => id !== part.id)]);
    blockedRef.current = true;
    const saying = blocker ? `blocker:${blocker.id}` : `self:${part.id}`;
    if (announcedRef.current !== saying) {
      announcedRef.current = saying;
      announce(
        blocker
          ? `${blocker.name} will not fit there — the rest of the selection cannot follow.`
          : `${part.name} will not fit there — something is in the way.`,
      );
    }
    return false;
  }

  /**
   * Turn a piece, keeping it in the room and taking whatever stands on it along.
   *
   * Every turn in this tab ends here: the handle drag, the handle's own arrow keys
   * and Shift+arrow on the piece itself. The two keyboard paths wrote the raw angle
   * and nothing else — so a sofa could be turned through the wall a chevron at a
   * time, and the lamp standing on a desk stayed behind, facing the way it always
   * had, while the desk turned under it. That is the same pair of defects the handle
   * drag had, surviving in the path nobody clicks; three call sites is exactly how
   * it survived.
   */
  function turnTo(part: ScenePart, next: number) {
    // Same rule as `moveTo`: a drag has its convoy already, a key press has no
    // gesture to hang one off and asks for the same answer on the spot.
    const drag = dragRef.current;
    const convoy =
      drag?.convoy ??
      planConvoy({
        draggedId: part.id,
        parts,
        selection: useStudio.getState().selection,
        parentIds: useStudio.getState().parentIds,
        footprint: ROOM_DYN.footprint,
        roomHeight: ROOM_DYN.height,
      });
    const world = drag?.world ?? parts;
    const turned = turnInPlace({
      part,
      at: part.pos,
      rot: next,
      dim: part.dimMM,
      // Delta zero — a turn moves nobody sideways — so this is `world` with the
      // piece's own rigid children taken out, which is what the pipeline asks for.
      parts: convoy.travelling.size > 1 ? travellingWorld(convoy, world, 0, 0, convoy.own) : world,
      footprint: ROOM_DYN.footprint,
      roomHeight: ROOM_DYN.height,
    });
    const pos = turned.pos;
    if (pos[0] !== part.pos[0] || pos[1] !== part.pos[1] || pos[2] !== part.pos[2]) setPosition(part.id, pos);
    setRotation(part.id, turned.rot);
    // …and everything standing on it turns with it, about the pivot it ACTUALLY
    // ended on: cascading from `part.pos` while the clamp had moved the piece
    // elsewhere would leave the lamp orbiting where the desk used to be. The
    // convoy's own MEMBERS are deliberately not moved — a set does not pivot about
    // the piece being turned, which is the rule `resolveConvoy` states for 'turn'.
    if (convoy.own.length > 0) setTransformsFor(cascadeTransform(part.id, pos, turned.rot, convoy.own));
    // The turn is TAKEN either way — refusing an invalid frame would make a piece in
    // a tight spot unturnable, which no report has asked for. But "taken" is not
    // "fine": the clamp keeps it in the room and something can still be in the way,
    // and that is a finding, which per this repo's own scar is not a finding until a
    // caller says it. A drag says it in colour; a turn said it nowhere.
    // Through lib/refusal.ts rather than written out here, so the two tabs cannot
    // drift on what counts as a refusal — 3D reads the same function on commit. A turn
    // moves nobody sideways, so there is no company to fail: convoyValid is true by
    // construction, and the members are deliberately not moved (see resolveConvoy).
    const refusal = refusalAfterGesture({
      draggedId: part.id,
      placementValid: turned.valid,
      convoyValid: true,
    });
    if (!refusal) {
      if (blockedRef.current) clearBlocked();
    } else if (!blockedRef.current) {
      if (blockTimer.current) clearTimeout(blockTimer.current);
      setBlockedIds(refusal.ids);
      blockedRef.current = true;
    }
    return turned;
  }

  // ── Pointer handling ──────────────────────────────────────────────────────

  /** How far a press may travel and still count as a click, in screen pixels. The
   *  same slop the piece-drag already used, shared so a marquee, an Alt-pick and a
   *  drag all agree on what "did not move" means. */
  const MOVE_SLOP = 4;

  /**
   * Alt-press: the user is asking WHICH piece, not moving one. Answered on the
   * release, because a press that turns into a drag is not a pick — and because
   * Alt-drag has to stay inert now that it no longer turns the page.
   */
  function beginAltPick(e: React.PointerEvent): boolean {
    if (!e.altKey || e.button !== 0 || e.pointerType === 'touch') return false;
    const w = svgToWorld(e);
    altRef.current = { x: w.x, z: w.z, sx: e.clientX, sy: e.clientY, pointerId: e.pointerId };
    // Firefox treats Alt+click as "download this"; a Linux window manager may
    // treat Alt-drag as "move the window". Neither belongs to the plan.
    e.preventDefault();
    return true;
  }

  function finishAltPick(e: React.PointerEvent) {
    const a = altRef.current;
    altRef.current = null;
    if (!a || e.pointerId !== a.pointerId) return;
    if (Math.hypot(e.clientX - a.sx, e.clientY - a.sy) > MOVE_SLOP) return;
    // World decides which pieces are candidates, screen decides whether this is the
    // same press repeated — and the screen point is the PRESS, not this release, so
    // it pairs with the world point beside it. See lib/plan-hit.
    const step = nextInCycle({ x: a.x, z: a.z }, { x: a.sx, y: a.sy }, visible, cycleRef.current);
    cycleRef.current = step.state;
    // Bare floor under an Alt-click is not a click on nothing: it does not clear
    // the selection, it simply has no answer.
    if (!step.id) return;
    if (e.shiftKey) toggleInSelection(step.id);
    else setSelected(step.id);
    if (step.fresh && step.candidates.length > 1) {
      openPickMenu(e.clientX, e.clientY, step.candidates);
    }
  }

  function onCanvasPointerDown(e: React.PointerEvent) {
    if (dragRef.current) return;
    // There is deliberately NO test that the press landed on the <svg> itself.
    // There was one, and it quietly killed almost everything below it: the room
    // floor is a FILLED <path>, so every press inside the room outline arrives with
    // `e.target` set to that path and returned here. Marquee, one-finger touch pan,
    // two-finger pinch, middle-drag pan and Space-drag pan therefore worked only in
    // the grey margin outside the walls — and the help card was busy advertising
    // "drag across empty floor to lasso several".
    //
    // It was redundant as well as wrong. Pieces and walls claim their own presses by
    // calling `stopPropagation`, which is why this handler never sees them; anything
    // that does reach it is floor or decoration, and for both of those a marquee is
    // the right answer. Do not reintroduce a target check here: the forgiving
    // direction is to act, and the failure mode of the strict one is a dead canvas
    // with nothing in the console.
    if (beginAltPick(e)) return;

    // Touch: one finger pans, two fingers pinch. There are no modifier keys on a
    // touch screen, so the desktop gestures below are unreachable there.
    if (e.pointerType === 'touch') {
      touchRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      (e.target as Element).setPointerCapture?.(e.pointerId);
      if (touchRef.current.size >= 2) {
        const [a, b] = [...touchRef.current.values()];
        const mid = toViewBox((a.x + b.x) / 2, (a.y + b.y) / 2);
        pinchRef.current = {
          dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
          zoom,
          cx: mid.x,
          cy: mid.y,
          ox: offset.x,
          oy: offset.y,
        };
        panRef.current = null;
      } else {
        panRef.current = { startX: e.clientX, startY: e.clientY, ox: offset.x, oy: offset.y };
      }
      e.preventDefault();
      return;
    }

    // Alt used to free-rotate the drawing from here. It does not any more: the
    // page turns in 15° steps from `[` / `]` and the two toolbar buttons, which is
    // what a measured drawing wants (a freely rotated plan has every label and
    // dimension line fighting its own angle), and Alt is worth more as the
    // modifier that chooses between overlapping pieces — the one thing the plan
    // could not do at all.
    //
    // Space + left-drag, as in the 3D tab, or the middle button. Shift-drag used
    // to pan too and does not any more: a left-drag from empty floor is a marquee
    // in every 2D tool there is, and that gesture was doing nothing here at all
    // while pan already had two other routes (three, counting the wheel).
    const startPan = e.button === 1 || (e.button === 0 && useStudio.getState().panKeyHeld);
    if (startPan) {
      panRef.current = { startX: e.clientX, startY: e.clientY, ox: offset.x, oy: offset.y };
      (e.target as Element).setPointerCapture?.(e.pointerId);
      e.preventDefault();
      return;
    }

    // Marquee. Deliberately NOT clearing the selection here: that waits for the
    // release, so a press that turns out to be a drag replaces the selection with
    // what it caught, and a Shift-drag adds to it. Clearing on press made the
    // selection flicker away under every marquee.
    if (e.button !== 0) return;
    const box = rootRef.current?.getBoundingClientRect();
    marqueeRef.current = {
      x0: e.clientX,
      y0: e.clientY,
      // The container's own origin, taken once: the box cannot move mid-gesture,
      // and reading it per frame would be a layout flush per pointermove.
      left: box?.left ?? 0,
      top: box?.top ?? 0,
      pointerId: e.pointerId,
      extend: e.shiftKey,
      moved: false,
    };
    setMarquee(null);
    (e.target as Element).setPointerCapture?.(e.pointerId);
    e.preventDefault();
  }

  function onPointerDown(e: React.PointerEvent, id: string, mode: 'translate' | 'rotate') {
    // Space held = the press belongs to the pan. Left unstopped so it reaches the
    // svg's own handler, which is where panning starts.
    if (useStudio.getState().panKeyHeld) return;
    // Alt on a piece is the same question as Alt on the floor — which piece did I
    // mean — so it is answered by the same code and must not start a drag.
    if (beginAltPick(e)) {
      e.stopPropagation();
      return;
    }
    e.stopPropagation();
    // Shift adds to (or removes from) the selection, matching the 3D tab. A piece
    // toggled into a set must not also become the thing a drag moves, so this
    // returns before the drag bookkeeping below.
    if (e.shiftKey && mode === 'translate') {
      toggleInSelection(id);
      return;
    }
    // A press on a piece ALREADY in the selection keeps the set, so the drag that
    // may follow has something to carry. Collapsing to one piece is what a CLICK
    // means, and it happens on release (see onPointerUp) once the press has turned
    // out not to be a drag. This line used to be an unconditional `setSelected`,
    // which is why the plan could not move a multi-selection at all: the set was
    // gone before the first pointermove, and the highlight visibly collapsed under
    // the cursor.
    // …and what a press on a piece OUTSIDE the selection selects is
    // `selectionForPick` — a merged set comes whole. The plan had no group
    // handling at all; `planConvoy` closed over `groupId` and covered for it, so
    // dragging looked right while the selection was wrong the entire time.
    // Captured before that write, not after — `setSelection` is synchronous, so a
    // read one line lower is a read of this gesture's own answer. See `selDown`.
    const selDown = useStudio.getState().selection;
    if (!selDown.includes(id)) setSelection(selectionForPick(parts, id, selDown), id);
    setDragging(id);
    (e.target as Element).setPointerCapture?.(e.pointerId);

    const part = parts.find((p) => p.id === id);
    if (!part) return;

    const startPos: [number, number, number] = [part.pos[0], part.pos[1], part.pos[2]];
    const down = svgToWorld(e);
    const convoy = planConvoy({
      draggedId: id,
      parts,
      selection: useStudio.getState().selection,
      parentIds: useStudio.getState().parentIds,
      footprint: ROOM_DYN.footprint,
      roomHeight: ROOM_DYN.height,
    });
    const common = {
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
      startPos,
      selDown,
      convoy,
      // Frozen here for the whole gesture — see `world` on the ref.
      world: parts,
      snapLines: [] as SnapLine[],
      grab: { x: down.x - part.pos[0], z: down.z - part.pos[2] },
    };
    if (mode === 'rotate') {
      const w = down;
      const startAngle = Math.atan2(w.z - part.pos[2], w.x - part.pos[0]);
      dragRef.current = { id, mode, startAngle, startRot: part.rot, ...common };
    } else {
      dragRef.current = { id, mode: 'translate', startAngle: 0, startRot: part.rot, ...common };
    }
  }

  /**
   * Hover, geometrically. The plan never wrote `hoveredPartId` at all before
   * this, which is why it had no hover feedback, never showed the HoverCard, and
   * handed the right-click menu either nothing or a stale id from the 3D tab —
   * the menu's own comment claimed both surfaces kept this current.
   *
   * It asks `hitsAt` rather than relying on per-shape pointer events so that the
   * outline and the click can never disagree about which piece is on top, and so
   * that it stays right when Alt-click starts choosing between them.
   */
  function updateHover(e: React.PointerEvent) {
    // No hover on touch: there is no pointer at rest, and a tap would leave a
    // highlight behind with nothing to clear it.
    if (e.pointerType === 'touch') return;
    // A gesture owns the pointer — the piece being dragged keeps the highlight.
    if (dragRef.current || panRef.current || wallDragRef.current) return;
    const w = svgToWorld(e);
    const next = hitsAt(w.x, w.z, visible)[0] ?? null;
    if (useStudio.getState().hoveredPartId !== next) setHovered(next);
  }

  function onPointerMove(e: React.PointerEvent) {
    updateHover(e);
    if (e.pointerType === 'touch' && touchRef.current.has(e.pointerId)) {
      touchRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
    if (pinchRef.current && touchRef.current.size >= 2) {
      const [a, b] = [...touchRef.current.values()];
      const p = pinchRef.current;
      const next = clamp((p.zoom * Math.hypot(a.x - b.x, a.y - b.y)) / p.dist, MIN_ZOOM, MAX_ZOOM);
      zoomAbout(next, p.cx, p.cy, p.zoom, p.ox, p.oy);
      return;
    }

    if (marqueeRef.current) {
      const m = marqueeRef.current;
      if (!m.moved && Math.hypot(e.clientX - m.x0, e.clientY - m.y0) > MOVE_SLOP) m.moved = true;
      if (m.moved) {
        // Drawn in viewport pixels over the drawing, not in the rotated/zoomed
        // group: a marquee is a screen gesture and must stay a screen-aligned
        // rectangle however the page is turned.
        setMarquee({
          x: Math.min(m.x0, e.clientX) - m.left,
          y: Math.min(m.y0, e.clientY) - m.top,
          w: Math.abs(e.clientX - m.x0),
          h: Math.abs(e.clientY - m.y0),
        });
      }
      return;
    }

    if (panRef.current) {
      const svg = svgRef.current;
      if (!svg) return;
      // One scale for both axes, or a diagonal drag pans off its own angle.
      const d = clientDeltaToViewBox(
        svg.getBoundingClientRect(),
        baseW,
        baseH,
        e.clientX - panRef.current.startX,
        e.clientY - panRef.current.startY,
      );
      setOffset({ x: panRef.current.ox + d.x, y: panRef.current.oy + d.y });
      return;
    }

    if (wallDragRef.current) {
      const wd = wallDragRef.current;
      const w = svgToWorld(e);
      const total = w.x * wd.outX + w.z * wd.outZ - wd.downAlong;
      const step = total - wd.prevTotal;
      wd.prevTotal = total;
      // Only the grabbed wall moves; it tracks the pointer 1:1 along its normal,
      // and takes what is mounted on it along.
      if (step !== 0) moveWallCarrying(wd.index, step, wd.attached);
      force((v) => v + 1);
      return;
    }

    if (!dragRef.current) return;
    if (!dragRef.current.moved) {
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      if (Math.hypot(dx, dy) > 4) dragRef.current.moved = true;
    }
    const { id, mode } = dragRef.current;
    const part = parts.find((p) => p.id === id);
    if (!part) return;
    const w = svgToWorld(e);

    if (mode === 'translate') {
      // Minus the grab offset — see `grab` on the ref. Handed to `moveTo`
      // UNROUNDED: `resolvePlacement` quantises to the snap grid as its first step,
      // and rounding here as well is how two surfaces drift over where the grid is.
      moveTo(part, w.x - dragRef.current.grab.x, w.z - dragRef.current.grab.z);
    } else {
      const a = Math.atan2(w.z - part.pos[2], w.x - part.pos[0]);
      const delta = -(a - dragRef.current.startAngle);
      const raw = dragRef.current.startRot + delta;
      // Quantised the way the 3D gizmo quantises it. The plan took the raw pointer
      // angle, so the same snap setting gave you 45° steps in one tab and 0.7° in
      // the other.
      const step = snapSteps(snapMode).rotate;
      const next = step ? Math.round(raw / step) * step : raw;
      // Containment and the cascade both live in `turnTo` — this gesture had
      // neither until recently, and the two keyboard turns still had neither after
      // that, which is what one more copy of this block would have preserved.
      turnTo(part, next);
    }
    force((v) => v + 1);
  }

  function onWallPointerDown(e: React.PointerEvent, index: number) {
    e.stopPropagation();
    setSelectedWall(index);
    setDragging('__wall__');
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const seg = wallSegments(ROOM_DYN.footprint)[index];
    if (!seg) return;
    // Outward normal (away from centroid). wallSegments yaw encodes the inward
    // normal as (sin yaw, cos yaw); negate for outward.
    const outX = -Math.sin(seg.yaw);
    const outZ = -Math.cos(seg.yaw);
    const w = svgToWorld(e);
    wallDragRef.current = {
      index,
      outX,
      outZ,
      downAlong: w.x * outX + w.z * outZ,
      prevTotal: 0,
      attached: wallAttachments(index),
    };
  }

  function onPointerUp(e: React.PointerEvent) {
    finishAltPick(e);

    if (marqueeRef.current && marqueeRef.current.pointerId === e.pointerId) {
      const m = marqueeRef.current;
      marqueeRef.current = null;
      setMarquee(null);
      (e.target as Element).releasePointerCapture?.(e.pointerId);
      if (m.moved) {
        // World coordinates, so the catch is right whatever the view rotation:
        // `svgToWorld` undoes rotation, pan and zoom in that order.
        const a = svgToWorldAt(m.x0, m.y0);
        const b = svgToWorldAt(e.clientX, e.clientY);
        const caught = hitsInRect({ x0: a.x, z0: a.z, x1: b.x, z1: b.z }, visible);
        if (caught.length > 0) {
          const ids = m.extend ? [...new Set([...selection, ...caught])] : caught;
          setSelection(ids, ids[ids.length - 1]);
          announce(`${ids.length} ${ids.length === 1 ? 'piece' : 'pieces'} selected.`);
        } else if (!m.extend) {
          setSelected(null);
        }
      } else if (!m.extend) {
        // A press on bare floor that went nowhere is still a click on nothing.
        setSelected(null);
      }
    }

    if (e.pointerType === 'touch') {
      touchRef.current.delete(e.pointerId);
      if (touchRef.current.size < 2) pinchRef.current = null;
    }
    if (wallDragRef.current) {
      wallDragRef.current = null;
      setDragging(null);
      (e.target as Element).releasePointerCapture?.(e.pointerId);
    }
    if (panRef.current) {
      panRef.current = null;
      (e.target as Element).releasePointerCapture?.(e.pointerId);
    }
    if (dragRef.current) {
      // A press that never moved is a click, and a click means "just this one" —
      // the release is where a multi-selection collapses, because the press itself
      // has to keep the set in case a drag follows it (see onPointerDown).
      if (!dragRef.current.moved && dragRef.current.mode === 'translate') {
        const clicked = dragRef.current.id;
        // …and what says whether that click came from inside the group is the
        // selection as the GESTURE began, not as it stands now: the press has
        // already answered once by selecting an unselected set whole, and reading it
        // back here would drill into the press's own answer, so one click on a
        // merged set would land on one piece and the set could never be clicked at
        // all. See `selDown` and `selectionForPick`.
        setSelection(selectionForPick(parts, clicked, dragRef.current.selDown), clicked);
      }
      // The per-gesture convoy snapshot dies with it — see the comment on the ref.
      dragRef.current = null;
      setDragging(null);
      (e.target as Element).releasePointerCapture?.(e.pointerId);
    }
    if (blockedRef.current) clearBlocked();
  }

  // ── Keyboard ──────────────────────────────────────────────────────────────

  // View keys are armed only while focus is inside the plan or on the studio
  // surface itself — they were bound to `window` behind a comment claiming they
  // were scoped, so typing "0" anywhere in the studio reset the plan's view.
  useEffect(() => {
    function armed(): boolean {
      const root = rootRef.current;
      if (root && document.activeElement && root.contains(document.activeElement)) return true;
      return studioSurfaceFocused();
    }
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (!armed()) return;
      if (e.key === '0' || e.key === 'Home') fit();
      // `f` is the studio's "look at this" key. On the 3D tab it flies the camera;
      // here there is no camera, so it does the 2D equivalent and centres the
      // piece. Before this it was a key that appeared to do nothing on one of the
      // two tabs it was armed on.
      else if (e.key === 'f' || e.key === 'F') frameSelection();
      else if (e.key === '=' || e.key === '+') setZoom((z) => Math.min(MAX_ZOOM, z * 1.15));
      else if (e.key === '-' || e.key === '_') setZoom((z) => Math.max(MIN_ZOOM, z / 1.15));
      else if (e.key === '[') setRot((r) => r - Math.PI / 12);
      else if (e.key === ']') setRot((r) => r + Math.PI / 12);
      else return;
      e.preventDefault();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fit, frameSelection]);

  const ARROWS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];

  function onPartKeyDown(e: React.KeyboardEvent, part: ScenePart) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setSelection(selectionForPick(parts, part.id, useStudio.getState().selection), part.id);
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      removeParts([part.id]);
      return;
    }
    if (!ARROWS.includes(e.key)) return;
    e.preventDefault();
    e.stopPropagation();
    // Same rule as a press: a piece already in the selection keeps the set, so the
    // nudge below moves the set. Unconditionally selecting here made the keys the
    // one gesture that could not move more than one piece, which is not a
    // distinction a keyboard user asked for.
    if (!useStudio.getState().selection.includes(part.id)) {
      setSelection(selectionForPick(parts, part.id, useStudio.getState().selection), part.id);
    }
    if (e.shiftKey) {
      turnByKey(e, part);
      return;
    }
    const dx = e.key === 'ArrowLeft' ? -nudge : e.key === 'ArrowRight' ? nudge : 0;
    const dz = e.key === 'ArrowUp' ? -nudge : e.key === 'ArrowDown' ? nudge : 0;
    moveTo(part, part.pos[0] + dx, part.pos[2] + dz);
    force((v) => v + 1);
  }

  /**
   * Shift+arrow on a piece and the arrow keys on its turn handle are one gesture
   * reached two ways, so they are one function — see `turnTo` for what both of them
   * were missing while they were two.
   *
   * The angle announced is the one the room ACCEPTED, not the one asked for: a wall
   * rider is re-aimed by the wall it lands on, and a sentence that reports the
   * request rather than the result is the hand-typed measurement this repo keeps
   * finding. The refusal is said out loud here and only drawn in colour on the
   * pointer path, which is not a divergence — someone driving this from the keyboard
   * cannot see the outline that colour is.
   */
  function turnByKey(e: React.KeyboardEvent, part: ScenePart) {
    const dir = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1;
    const turned = turnTo(part, part.rot + dir * spin);
    const said = `${part.name} turned to ${Math.round((turned.rot * 180) / Math.PI)} degrees.`;
    announce(turned.valid ? said : `${said} It does not fit at that angle — something is in the way.`);
  }

  function onRotateKeyDown(e: React.KeyboardEvent, part: ScenePart) {
    if (!ARROWS.includes(e.key)) return;
    e.preventDefault();
    e.stopPropagation();
    turnByKey(e, part);
  }

  function onWallKeyDown(e: React.KeyboardEvent, index: number, label: string) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setSelectedWall(index);
      return;
    }
    if (!ARROWS.includes(e.key)) return;
    e.preventDefault();
    e.stopPropagation();
    const out = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? WALL_STEP : -WALL_STEP;
    setSelectedWall(index);
    moveWallCarrying(index, out);
    force((v) => v + 1);
    const b = footprintBounds(useScene.getState().room.footprint);
    announce(
      `${label} moved ${out > 0 ? 'out' : 'in'}. Room is now ${formatDim(b.width * 1000, dimUnit)} by ${formatDim(
        b.depth * 1000,
        dimUnit,
      )} ${dimUnit}.`,
    );
  }

  // ── Drawing ───────────────────────────────────────────────────────────────

  const toLocal = (x: number, z: number) => ({
    x: PAD + (x - bounds.minX) * SCALE,
    y: PAD + (z - bounds.minZ) * SCALE,
  });

  // Everything in the drawing lives inside one `scale(zoom)` group, which is
  // right for the room and wrong for the controls: at 0.4x the rotate handle was a
  // 4-unit dot and the wall grab lines were 6 units wide, and at 4x the same handle
  // was a 36-unit blob sitting over the furniture. Dividing a control's size by the
  // magnification keeps it the size it was drawn at — the way a gizmo behaves in
  // every tool that has one — while the room itself still zooms.
  //
  // "Constant" here means constant against the drawing's own fitted size: the <svg>
  // additionally scales itself into whatever box the rails leave it, which is a
  // factor no element inside can see. That outer fit is stable during a zoom, which
  // is the case this fixes.
  const k = 1 / zoom;
  /** Below this the label cannot be read anyway, so it is dropped rather than
   *  drawn as a smudge — the footprint and its colour still say what the piece is,
   *  and the hover card names it. */
  const LABEL_MIN_PX = 22;

  // The piece under an active translate-drag, and its clearance to the nearest
  // wall on each axis. Recomputed per frame — `onPointerMove` already forces a
  // render for the move itself, so this costs two ray casts on a frame that was
  // happening anyway.
  const measuring = (() => {
    const d = dragRef.current;
    if (!d || d.mode !== 'translate') return null;
    const part = visible.find((p) => p.id === d.id);
    if (!part) return null;
    const foot = footFromPart(part.pos, part.rot, part.dimMM, part.circle);
    const [cx, , cz] = part.pos;
    const axes: Array<{ axis: 'x' | 'z'; dirs: Array<[number, number]> }> = [
      { axis: 'x', dirs: [[-1, 0], [1, 0]] },
      { axis: 'z', dirs: [[0, -1], [0, 1]] },
    ];
    const gaps = [];
    for (const { axis, dirs } of axes) {
      let best: { gap: number; dir: [number, number] } | null = null;
      for (const dir of dirs) {
        const reach = rayToBoundary(cx, cz, dir[0], dir[1], ROOM_DYN.footprint);
        const gap = reach - obbExtentAlong(foot, dir[0], dir[1]);
        if (!best || gap < best.gap) best = { gap, dir };
      }
      // A negative gap means the piece is already through the plaster, which
      // `clearance.ts` is the thing that reports. A measurement line pointing
      // backwards would just be wrong, so it is left out.
      if (!best || best.gap < 0) continue;
      const ext = obbExtentAlong(foot, best.dir[0], best.dir[1]);
      gaps.push({
        axis,
        gap: best.gap,
        fromX: cx + best.dir[0] * ext,
        fromZ: cz + best.dir[1] * ext,
        toX: cx + best.dir[0] * (ext + best.gap),
        toZ: cz + best.dir[1] * (ext + best.gap),
      });
    }
    // The alignment guides ride along in the same derivation, but they are NOT
    // gated on it: a piece already through the plaster has no wall gap worth
    // drawing (see above) and can still be dead level with the wardrobe.
    const lines = d.snapLines;
    return gaps.length > 0 || lines.length > 0 ? { gaps, lines } : null;
  })();

  const segs = wallSegments(ROOM_DYN.footprint);
  // Compass names only mean something on a four-edge room. An L / T / U footprint
  // has six or eight edges, and the Inspector already falls back to "Wall n".
  const useCompass = ROOM_DYN.footprint.length === 4;
  const viewRotDeg = (rot * 180) / Math.PI;

  const widthLabel = `${formatDim(bounds.width * 1000, dimUnit)} ${dimUnit}`;
  const depthLabel = `${formatDim(bounds.depth * 1000, dimUnit)} ${dimUnit}`;
  const planW = bounds.width * SCALE;
  const planH = bounds.depth * SCALE;

  return (
    <div
      ref={rootRef}
      style={{ width: '100%', height: '100%', position: 'relative' }}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }}
      onDrop={onDrop}
    >
      <svg
        ref={svgRef}
        viewBox={`0 0 ${baseW} ${baseH}`}
        onPointerDown={onCanvasPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        // Leaving the drawing ends any gesture AND surrenders the hover. Without
        // the second half, sweeping off the edge leaves the last piece
        // highlighted, and the studio-wide `hoveredPartId` it is written to is
        // read by the shared HoverCard and by the right-click menu.
        onPointerLeave={(e) => {
          onPointerUp(e);
          if (useStudio.getState().hoveredPartId) setHovered(null);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          // Hover is now written by this view (it never was before), so the piece
          // this menu acts on is finally the piece under the pointer. The full
          // stack goes with it, for the "Select what's here" row — the picker's
          // no-modifier route, and the only one a touch screen has.
          const w = svgToWorldAt(e.clientX, e.clientY);
          openSceneMenu(e.clientX, e.clientY, useStudio.getState().hoveredPartId, hitsAt(w.x, w.z, visible));
        }}
        onWheel={onWheel}
        style={{ width: '100%', height: '100%', maxWidth: 1100, touchAction: 'none', cursor: panRef.current ? 'grabbing' : panKey ? 'grab' : 'default' }}
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <pattern id="lockHatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="6" stroke="var(--locked)" strokeWidth="0.4" opacity="0.35" />
          </pattern>
        </defs>

        <g transform={`rotate(${viewRotDeg} ${baseW / 2} ${baseH / 2}) translate(${offset.x} ${offset.y}) scale(${zoom})`}>
          <path
            d={
              ROOM_DYN.footprint
                .map((p, i) => {
                  const l = toLocal(p[0], p[1]);
                  return `${i ? 'L' : 'M'}${l.x} ${l.y}`;
                })
                .join(' ') + ' Z'
            }
            fill="var(--hairline-soft)"
            stroke="var(--ink)"
            strokeWidth="3"
          />

          {/* Where a person actually fits, cell by cell. Runs rather than cells:
              a 6 x 4 m room is ~10 000 cells but only a few hundred horizontal
              runs, so this stays plain SVG and keeps reading the design tokens
              instead of needing a canvas and a fourth copy of the palette.
              A half-cell overlap on each rect closes the hairlines that otherwise
              show between rows at high zoom. */}
          {showComfort && walkRuns.length > 0 && (
            <g style={{ pointerEvents: 'none' }} aria-hidden="true">
              {walkRuns.map((r, i) => {
                const a = toLocal(r.x, r.z);
                return (
                  <rect
                    key={`walk-${i}`}
                    x={a.x}
                    y={a.y}
                    width={r.w * SCALE + 0.5}
                    height={r.h * SCALE + 0.5}
                    fill={r.state === CUT_OFF ? 'var(--warn-tint)' : 'var(--accent-2-tint)'}
                  />
                );
              })}
            </g>
          )}

          {/* Comfort zones — the per-piece clearance rules as floor regions, under
              the furniture so a piece is never obscured by its own band. */}
          {showComfort && (
            <g style={{ pointerEvents: 'none' }}>
              {visible.map((part) => {
                const bands = comfortBands(part);
                if (!bands) return null;
                const c = toLocal(part.pos[0], part.pos[2]);
                return (
                  <g key={`comfort-${part.id}`} transform={`translate(${c.x} ${c.y}) rotate(${-(part.rot * 180) / Math.PI})`}>
                    {bands}
                  </g>
                );
              })}
            </g>
          )}

          {/* Interactive wall edges — click or focus to select, drag or arrow to
              resize. Wide transparent hit line over a thin visible accent. */}
          {ROOM_DYN.footprint.map((a, i) => {
            const b = ROOM_DYN.footprint[(i + 1) % ROOM_DYN.footprint.length];
            const la = toLocal(a[0], a[1]);
            const lb = toLocal(b[0], b[1]);
            const sel = selectedWall === i;
            const focused = focusKey === `wall:${i}`;
            const label = wallLabelFor(segs[i]?.yaw ?? 0, i, useCompass);
            return (
              <g
                key={`wall-${i}`}
                tabIndex={0}
                role="button"
                aria-label={`${label}. Arrow keys move it.`}
                style={{ cursor: 'grab', outline: 'none' }}
                onPointerDown={(e) => onWallPointerDown(e, i)}
                onKeyDown={(e) => onWallKeyDown(e, i, label)}
                onFocus={() => setFocusKey(`wall:${i}`)}
                onBlur={() => setFocusKey(null)}
              >
                <line x1={la.x} y1={la.y} x2={lb.x} y2={lb.y} stroke="transparent" strokeWidth={16 * k} strokeLinecap="round" />
                {(sel || focused) && (
                  <line
                    x1={la.x}
                    y1={la.y}
                    x2={lb.x}
                    y2={lb.y}
                    stroke="var(--accent)"
                    strokeWidth={5 * k}
                    strokeLinecap="round"
                    strokeDasharray={focused && !sel ? `${7 * k} ${4 * k}` : undefined}
                  />
                )}
              </g>
            );
          })}

          {/* Wall labels — placed from each edge's own midpoint and outward
              normal, so they stay correct on a six-edge L or U room. */}
          {segs.map((seg, i) => {
            const l = toLocal(seg.x, seg.z);
            const x = l.x - Math.sin(seg.yaw) * 26;
            const y = l.y - Math.cos(seg.yaw) * 26;
            return (
              <text
                key={`wall-label-${i}`}
                x={x}
                y={y}
                textAnchor="middle"
                dominantBaseline="middle"
                transform={`rotate(${-viewRotDeg} ${x} ${y})`}
                fontFamily="var(--font-sans)"
                fontSize="11"
                fill="var(--ink-2)"
                fontWeight="600"
                style={{ pointerEvents: 'none' }}
              >
                {wallLabelFor(seg.yaw, i, useCompass)}
              </text>
            );
          })}

          {/* Overall dimensions, in the unit Settings owns — this used to print a
              bare millimetre number with no unit at all. */}
          <g fontFamily="var(--font-mono)" fontSize="10" fill="var(--accent-text)" style={{ pointerEvents: 'none' }}>
            <line x1={PAD} y1={PAD - 18} x2={PAD + planW} y2={PAD - 18} stroke="var(--accent-text)" strokeWidth="0.8" />
            <line x1={PAD} y1={PAD - 22} x2={PAD} y2={PAD - 14} stroke="var(--accent-text)" />
            <line x1={PAD + planW} y1={PAD - 22} x2={PAD + planW} y2={PAD - 14} stroke="var(--accent-text)" />
            <rect
              x={PAD + planW / 2 - (widthLabel.length * 3.3 + 6)}
              y={PAD - 26}
              width={widthLabel.length * 6.6 + 12}
              height="15"
              fill="var(--paper)"
            />
            <text x={PAD + planW / 2} y={PAD - 15} textAnchor="middle">
              {widthLabel}
            </text>

            <line x1={PAD + planW + 18} y1={PAD} x2={PAD + planW + 18} y2={PAD + planH} stroke="var(--accent-text)" strokeWidth="0.8" />
            <line x1={PAD + planW + 14} y1={PAD} x2={PAD + planW + 22} y2={PAD} stroke="var(--accent-text)" />
            <line x1={PAD + planW + 14} y1={PAD + planH} x2={PAD + planW + 22} y2={PAD + planH} stroke="var(--accent-text)" />
            <g transform={`rotate(90 ${PAD + planW + 18} ${PAD + planH / 2})`}>
              <rect
                x={PAD + planW + 18 - (depthLabel.length * 3.3 + 6)}
                y={PAD + planH / 2 - 13}
                width={depthLabel.length * 6.6 + 12}
                height="15"
                fill="var(--paper)"
              />
              <text x={PAD + planW + 18} y={PAD + planH / 2 - 2} textAnchor="middle">
                {depthLabel}
              </text>
            </g>
          </g>

          {painted.map((part) => {
            const pos = part.pos;
            const rotY = part.rot;
            const fpW = part.dimMM[0] / 1000;
            const fpD = part.dimMM[1] / 1000;
            const center = toLocal(pos[0], pos[2]);
            const wpx = fpW * SCALE;
            const hpx = fpD * SCALE;
            const blocked = blockedIds.includes(part.id);
            // Stroke tokens are boundaries (≥3:1); the label uses the *-text pair
            // because 9px type has to clear 4.5:1.
            const color = blocked ? 'var(--danger)' : part.locked ? 'var(--locked)' : 'var(--accent)';
            const labelColor = blocked ? 'var(--danger-text)' : part.locked ? 'var(--locked)' : 'var(--accent-text)';
            const fill = blocked ? 'var(--danger-tint)' : part.locked ? 'var(--locked-tint)' : 'var(--accent-tint)';
            // In the selection, and separately whether it is the PRIMARY of it:
            // every selected piece draws heavier, but only one carries the rotate
            // handle, or a five-piece selection would sprout five of them.
            const isSel = selection.includes(part.id);
            const isPrimary = selected === part.id;
            // Weight, not only colour. `--accent-tint` and `--danger-tint` are 0.077
            // apart in OKLab — the distance `lib/themes.ts` itself calls
            // indistinguishable — so the refusal was being signalled by a hue shift
            // nobody with a red-green deficiency can read, on the one surface that
            // has no text tag to fall back on (3D says "… will not fit" out loud in
            // `MeasureGuides`; the plan only recolours). A blocked piece is always
            // selected, so 2.5 is the weight it is stepping up FROM.
            const strokeW = (blocked ? 4 : isSel ? 2.5 : 1.4) * k;
            const isHovered = hovered === part.id && !isSel;
            const focused = focusKey === `part:${part.id}`;
            const rotDeg = -(rotY * 180) / Math.PI;
            return (
              <g
                key={part.id}
                transform={`translate(${center.x} ${center.y}) rotate(${rotDeg})`}
                tabIndex={0}
                role="button"
                aria-label={`${part.name}. Arrow keys move it, hold Shift to turn it.`}
                onPointerDown={(e) => onPointerDown(e, part.id, 'translate')}
                onKeyDown={(e) => onPartKeyDown(e, part)}
                onFocus={() => setFocusKey(`part:${part.id}`)}
                onBlur={() => setFocusKey(null)}
                style={{ cursor: 'grab', outline: 'none' }}
              >
                {/* Hover. The plan had no hover state at all before it wrote
                    `hoveredPartId`, so a piece under the pointer looked exactly
                    like one that was not — and with Alt-click choosing between
                    overlapping pieces, "which one is the pointer on" became a
                    question the drawing has to answer. Solid, where focus is
                    dashed, so the two never read as the same thing. */}
                {isHovered && (
                  <rect
                    x={-wpx / 2 - 3 * k}
                    y={-hpx / 2 - 3 * k}
                    width={wpx + 6 * k}
                    height={hpx + 6 * k}
                    fill="none"
                    stroke="var(--accent-text)"
                    strokeWidth={1.2 * k}
                    rx={3 * k}
                  />
                )}
                {focused && (
                  <rect
                    x={-wpx / 2 - 5 * k}
                    y={-hpx / 2 - 5 * k}
                    width={wpx + 10 * k}
                    height={hpx + 10 * k}
                    fill="none"
                    stroke="var(--accent-text)"
                    strokeWidth={1.5 * k}
                    strokeDasharray={`${4 * k} ${3 * k}`}
                    rx={4 * k}
                  />
                )}
                {part.circle ? (
                  // An ellipse, not a circle of radius W/2: a round part is
                  // authored square, but W and D are separately editable, and
                  // `lib/geometry`'s Foot models the inscribed ELLIPSE — so a
                  // stretched plant pot has to draw as the shape the collision
                  // and coverage maths is using.
                  <ellipse
                    cx={0}
                    cy={0}
                    rx={wpx / 2}
                    ry={hpx / 2}
                    fill={fill}
                    stroke={color}
                    strokeWidth={strokeW}
                    strokeDasharray={part.locked ? undefined : `${4 * k} ${3 * k}`}
                  />
                ) : (
                  <>
                    <rect
                      x={-wpx / 2}
                      y={-hpx / 2}
                      width={wpx}
                      height={hpx}
                      fill={fill}
                      stroke={color}
                      strokeWidth={strokeW}
                      strokeDasharray={part.locked ? undefined : `${4 * k} ${3 * k}`}
                    />
                    {part.locked && <rect x={-wpx / 2} y={-hpx / 2} width={wpx} height={hpx} fill="url(#lockHatch)" />}
                    <line x1={0} y1={-hpx / 2} x2={0} y2={-hpx / 2 - 8 * k} stroke={color} strokeWidth={1.4 * k} />
                  </>
                )}
                {/* Counter-rotate label so it stays upright regardless of part + view rotation */}
                {/* The label used to be the first WORD, cut to eight characters, so two
                    dining chairs both read "Dining" and a "TV bench" read "TV". It is
                    the whole name now, cut to what the footprint can actually hold at
                    the current magnification — and dropped entirely when that is
                    nothing, rather than drawn illegibly. */}
                {Math.min(wpx, hpx) > LABEL_MIN_PX * k && (
                  <g transform={`rotate(${-rotDeg - viewRotDeg})`}>
                    <text
                      x={0}
                      y={3 * k}
                      textAnchor="middle"
                      fontFamily="var(--font-sans)"
                      fontSize={9 * k}
                      fill={labelColor}
                      fontWeight="600"
                      style={{ pointerEvents: 'none' }}
                    >
                      {fitLabel(part.name, Math.max(wpx, hpx), 9 * k)}
                    </text>
                  </g>
                )}

                {isPrimary && (
                  <g transform={`translate(0 ${-hpx / 2 - 26 * k})`}>
                    <line
                      x1={0}
                      y1={18 * k}
                      x2={0}
                      y2={hpx / 2 + (26 - 8) * k}
                      stroke={color}
                      strokeWidth={1.2 * k}
                      strokeDasharray={`${2 * k} ${2 * k}`}
                    />
                    <circle
                      cx={0}
                      cy={0}
                      r={9 * k}
                      fill="var(--paper)"
                      stroke={focusKey === `rot:${part.id}` ? 'var(--accent-text)' : color}
                      strokeWidth={(focusKey === `rot:${part.id}` ? 3 : 2) * k}
                      tabIndex={0}
                      role="button"
                      aria-label={`Turn ${part.name}. Arrow keys turn it.`}
                      onPointerDown={(e) => onPointerDown(e, part.id, 'rotate')}
                      onKeyDown={(e) => onRotateKeyDown(e, part)}
                      onFocus={() => setFocusKey(`rot:${part.id}`)}
                      onBlur={() => setFocusKey(null)}
                      style={{ cursor: 'grab', outline: 'none' }}
                    />
                    <g transform={`scale(${k})`} style={{ pointerEvents: 'none' }}>
                      <path d="M -4 -1 A 4 4 0 1 1 4 -1" fill="none" stroke={color} strokeWidth="1.4" />
                      <polygon points="3,-1 5,-3 3,-3" fill={color} />
                    </g>
                  </g>
                )}
              </g>
            );
          })}

          {/* How far the piece being moved is from the walls it is heading for.
              This is the tab whose whole premise is that the dimensions are real,
              and it measured nothing while you moved something. Two numbers, one
              per axis, each to the NEARER wall — the question while dragging is
              "does it fit here", and four numbers answer a different one.

              Both are derived: the reach comes from `rayToBoundary` against the
              actual footprint polygon (so an L-shaped room is measured as an L),
              less the piece's own extent along that direction from
              `obbExtentAlong`. Nothing here is a typed-in string. */}
          {measuring && (
            <g style={{ pointerEvents: 'none' }}>
              {/* Item-to-item alignment guides, first so the wall measurements
                  above paint over them. `lib/item-snap.ts` produced these, the
                  shared resolve returned them, and until now only the 3D tab drew
                  them — leaving the plan snapping pieces into line with no way to
                  see what they had lined up with. A centre line is dashed and a
                  shade lighter, exactly as `MeasureGuides` draws it, so the same
                  event looks the same in both tabs.

                  Where the line's two ends are is `snapGuideEnds` in
                  `lib/item-snap.ts`, beside the code that decided the snap — the
                  axis-to-span mapping transposes silently, and having written it
                  out in both renderers once is enough. */}
              {measuring.lines.map((s, i) => {
                const { from, to } = snapGuideEnds(s);
                const a = toLocal(from[0], from[1]);
                const b = toLocal(to[0], to[1]);
                const centre = s.kind === 'center';
                return (
                  <line
                    key={`snap-${s.axis}-${i}`}
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    stroke={centre ? 'var(--snap-center)' : 'var(--snap-edge)'}
                    strokeWidth={(centre ? 1.2 : 1.6) * k}
                    strokeDasharray={centre ? `${4 * k} ${2.5 * k}` : undefined}
                    strokeLinecap="round"
                  />
                );
              })}
              {measuring.gaps.map((g) => {
                const from = toLocal(g.fromX, g.fromZ);
                const to = toLocal(g.toX, g.toZ);
                const mx = (from.x + to.x) / 2;
                const my = (from.y + to.y) / 2;
                const label = `${formatDim(g.gap * 1000, dimUnit)} ${dimUnit}`;
                return (
                  <g key={g.axis}>
                    <line
                      x1={from.x}
                      y1={from.y}
                      x2={to.x}
                      y2={to.y}
                      stroke="var(--accent-text)"
                      strokeWidth={1 * k}
                      strokeDasharray={`${3 * k} ${2 * k}`}
                    />
                    <g transform={`rotate(${-viewRotDeg} ${mx} ${my})`}>
                      <rect
                        x={mx - (label.length * 2.6 + 4) * k}
                        y={my - 7 * k}
                        width={(label.length * 5.2 + 8) * k}
                        height={13 * k}
                        rx={3 * k}
                        fill="var(--paper)"
                        stroke="var(--hairline)"
                        strokeWidth={0.75 * k}
                      />
                      <text
                        x={mx}
                        y={my + 2.5 * k}
                        textAnchor="middle"
                        fontFamily="var(--font-mono)"
                        fontSize={8.5 * k}
                        fill="var(--accent-text)"
                      >
                        {label}
                      </text>
                    </g>
                  </g>
                );
              })}
            </g>
          )}

          {/* North rose. The needle turns with the drawing — that is the point of
              it — but the letter stays upright and readable. */}
          <g transform={`translate(${PAD - 30} ${PAD - 30})`} style={{ pointerEvents: 'none' }}>
            <circle r="14" fill="var(--paper)" stroke="var(--ink)" />
            <path d="M0 -9 L3 0 L0 9 L-3 0 Z" fill="var(--accent)" />
            <g transform={`rotate(${-viewRotDeg})`}>
              <text y="-18" textAnchor="middle" fontFamily="var(--font-sans)" fontSize="9" fill="var(--ink)" fontWeight="700">
                N
              </text>
            </g>
          </g>
        </g>
      </svg>

      {/* The marquee. An overlay rather than part of the drawing, because it is a
          screen gesture: inside the rotated / zoomed group it would shear with the
          page and stop matching the two corners the pointer actually described. */}
      {marquee && (
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: marquee.x,
            top: marquee.y,
            width: marquee.w,
            height: marquee.h,
            border: '1px solid var(--accent-text)',
            background: 'var(--accent-tint)',
            opacity: 0.55,
            borderRadius: 2,
            pointerEvents: 'none',
          }}
        />
      )}
    </div>
  );
});

/** The comfort bands for one piece, drawn in its own local frame — which is
 *  exactly the frame `accessZones` authors them in, so this is a unit conversion
 *  and nothing more. Returns null when the piece has no rule attached to it.
 *
 *  Local +y here is the piece's front. `accessZones` returns world coordinates for
 *  a placement, so it is asked for the zones of a piece at the origin facing +z,
 *  and its `cz` is that same local +y. Nothing about the geometry is restated. */
function comfortBands(part: ScenePart): React.ReactNode[] | null {
  const zones = accessZones(part, 0, 0, 0);
  if (zones.length === 0) return null;
  const soft = { fill: 'var(--accent-2-tint)', stroke: 'var(--accent-2)', strokeWidth: 0.8, strokeDasharray: '5 4' };
  return zones.map((zn, i) => (
    <rect
      key={`${zn.rule.id}-${zn.side}-${i}`}
      x={(zn.foot.cx - zn.foot.hw) * SCALE}
      y={(zn.foot.cz - zn.foot.hd) * SCALE}
      width={zn.foot.hw * 2 * SCALE}
      height={zn.foot.hd * 2 * SCALE}
      {...soft}
      fillOpacity={0.9}
    />
  ));
}

/** As much of a name as a footprint can hold, with an ellipsis when it is cut.
 *  SVG text has no `text-overflow`, so the budget is estimated from the font size —
 *  0.55em is a fair average for Nunito's lowercase, and erring narrow costs a
 *  character rather than spilling over the furniture. */
function fitLabel(name: string, widthPx: number, fontSize: number): string {
  const budget = Math.floor(widthPx / (fontSize * 0.55));
  if (budget >= name.length) return name;
  if (budget <= 1) return name.slice(0, 1);
  return name.slice(0, budget - 1).trimEnd() + '…';
}

/** Mirrors the Inspector's wall naming so the two screens can never disagree. */
function wallLabelFor(yaw: number, index: number, useCompass: boolean): string {
  if (!useCompass) return `Wall ${index + 1}`;
  const inX = Math.sin(yaw);
  const inZ = Math.cos(yaw);
  if (Math.abs(inZ) >= Math.abs(inX)) return inZ > 0 ? 'North wall' : 'South wall';
  return inX > 0 ? 'West wall' : 'East wall';
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}
